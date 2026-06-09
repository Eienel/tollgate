// facilitator.ts
// A bundled, minimal x402 facilitator preconfigured for Pharos Atlantic. Pharos
// has no hosted facilitator, so the skill ships one. It verifies an incoming
// payment on-chain and settles idempotently. Because the Atlantic test USDC is
// a plain ERC-20 with no EIP-3009 (confirmed in STEP 0), the payment is an
// on-chain ERC-20 transfer the buyer broadcasts; settlement is the idempotent
// confirmation of that transfer rather than a second broadcast. The same code
// path supports a future gasless exact scheme by swapping the settle mechanism.

import {
  type Address,
  type Hash,
  formatEther,
  getAddress,
  parseEventLogs,
} from "viem";
import {
  publicClient,
  erc20Abi,
  NETWORK,
  CHAIN_ID,
  USDC_ADDRESS,
  EXPLORER_URL,
  withRetry,
  rateBudget,
  pendingTxCount,
  loadAccount,
  redact,
  stringifyError,
} from "./chain.js";
import type { IdempotencyStore } from "./idempotency.js";

// The scheme this facilitator settles. Tuned for Atlantic's non-EIP-3009 token.
export const TOLLGATE_SCHEME = "exact-evm-erc20";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  // Token contract address.
  asset: Address;
  // Atomic token units required, as a decimal string.
  amount: string;
  // Recipient of the payment.
  payTo: Address;
  // The protected resource this payment is for.
  resource: string;
  description?: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    txHash: string;
    from: Address;
    to: Address;
    asset: Address;
    value: string;
    nonce?: string;
  };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: Address;
  txHash?: string;
  // Atomic value actually transferred on-chain.
  settledValue?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network: string;
  payer?: Address;
  amount?: string;
  // True when this result was reused from a prior settle of the same tx.
  idempotentReuse?: boolean;
  // True when produced by dry-run, with no broadcast.
  simulated?: boolean;
  explorerUrl?: string;
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export class Facilitator {
  constructor(
    private readonly idem: IdempotencyStore,
    private readonly dryRun: boolean,
  ) {}

  // Verify a payment by inspecting the on-chain transfer it references. No state
  // is changed. The buyer's transfer must be confirmed, to the right recipient,
  // in the right asset, for at least the required amount.
  async verify(
    payload: PaymentPayload,
    req: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      if (payload.scheme !== req.scheme) {
        return { isValid: false, invalidReason: `scheme mismatch: ${payload.scheme}` };
      }
      if (payload.network !== req.network || req.network !== NETWORK) {
        return { isValid: false, invalidReason: `network mismatch: ${payload.network}` };
      }
      if (getAddress(payload.payload.asset) !== getAddress(req.asset)) {
        return { isValid: false, invalidReason: "asset mismatch" };
      }

      const txHash = payload.payload.txHash as Hash;
      rateBudget.take();
      const receipt = await withRetry(
        () => publicClient().getTransactionReceipt({ hash: txHash }),
        { label: "getTransactionReceipt" },
      );
      if (receipt.status !== "success") {
        return { isValid: false, invalidReason: "transaction reverted", txHash };
      }

      // Decode the ERC-20 Transfer event from the token contract and match it to
      // the requirements. This works for both transfer and transferFrom.
      const logs = parseEventLogs({
        abi: erc20Abi,
        eventName: "Transfer",
        logs: receipt.logs.filter(
          (l) =>
            getAddress(l.address) === getAddress(req.asset) &&
            l.topics[0] === TRANSFER_TOPIC,
        ),
      });

      const required = BigInt(req.amount);
      for (const log of logs) {
        const args = log.args as { from: Address; to: Address; value: bigint };
        if (getAddress(args.to) === getAddress(req.payTo) && args.value >= required) {
          return {
            isValid: true,
            payer: getAddress(args.from),
            txHash,
            settledValue: args.value.toString(),
          };
        }
      }
      return {
        isValid: false,
        invalidReason: "no matching transfer to payTo for the required amount",
        txHash,
      };
    } catch (err) {
      return { isValid: false, invalidReason: redact(stringifyError(err)) };
    }
  }

  // Settle idempotently. For this scheme the funds already moved on-chain, so
  // settle confirms the verified transfer and records it once. On any retry with
  // the same tx hash, the stored result is returned rather than re-confirming.
  async settle(
    payload: PaymentPayload,
    req: PaymentRequirements,
  ): Promise<SettleResponse> {
    const txHash = payload.payload.txHash;
    const key = `settle:${txHash.toLowerCase()}`;

    const reserved = await this.idem.reserve(key, {
      resource: req.resource,
      amount: req.amount,
    });
    if (!reserved.fresh && reserved.record.result) {
      // Reuse the prior settlement verbatim. Never resubmit.
      return { ...(reserved.record.result as unknown as SettleResponse), idempotentReuse: true };
    }

    if (this.dryRun) {
      const result: SettleResponse = {
        success: true,
        transaction: txHash,
        network: req.network,
        amount: req.amount,
        simulated: true,
        explorerUrl: `${EXPLORER_URL}/tx/${txHash}`,
      };
      await this.idem.complete(key, result as unknown as Record<string, unknown>);
      return result;
    }

    const verified = await this.verify(payload, req);
    if (!verified.isValid) {
      const result: SettleResponse = {
        success: false,
        errorReason: verified.invalidReason ?? "verification failed",
        transaction: txHash,
        network: req.network,
      };
      // Do not store a failed settle as a completed result; let it be retried.
      return result;
    }

    const result: SettleResponse = {
      success: true,
      transaction: txHash,
      network: req.network,
      payer: verified.payer,
      amount: verified.settledValue ?? req.amount,
      explorerUrl: `${EXPLORER_URL}/tx/${txHash}`,
    };
    await this.idem.complete(key, result as unknown as Record<string, unknown>);
    return result;
  }
}

export interface FacilitatorStatus {
  healthy: boolean;
  network: string;
  chainId: number;
  rpcReachable: boolean;
  rateBudgetRemaining: number;
  account?: {
    address: Address;
    phrsBalance: string;
    pendingTxCount: number;
    pendingTxCapReached: boolean;
  };
  dryRun: boolean;
  note?: string;
  checkedAt: string;
}

// Health probe for the facilitator and its account.
export async function facilitatorStatus(dryRun: boolean): Promise<FacilitatorStatus> {
  const base: FacilitatorStatus = {
    healthy: false,
    network: NETWORK,
    chainId: CHAIN_ID,
    rpcReachable: false,
    rateBudgetRemaining: rateBudget.remaining(),
    dryRun,
    checkedAt: new Date().toISOString(),
  };
  try {
    const id = await withRetry(() => publicClient().getChainId(), { label: "getChainId" });
    base.rpcReachable = true;
    if (id !== CHAIN_ID) {
      base.note = `RPC reports chain id ${id}, expected ${CHAIN_ID}`;
      return base;
    }
  } catch (err) {
    base.note = redact(stringifyError(err));
    return base;
  }

  try {
    const account = loadAccount();
    const [bal, pending] = await Promise.all([
      publicClient().getBalance({ address: account.address }),
      pendingTxCount(account.address),
    ]);
    base.account = {
      address: account.address,
      phrsBalance: formatEther(bal),
      pendingTxCount: pending,
      pendingTxCapReached: pending >= 64,
    };
  } catch {
    base.note = "No signing key configured. Verify works; settle and buyer payments need TOLLGATE_PRIVATE_KEY.";
  }

  base.healthy = base.rpcReachable;
  return base;
}

// A convenience for the merchant tools: the token used by default.
export const DEFAULT_ASSET = USDC_ADDRESS;
