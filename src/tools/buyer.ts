// tools/buyer.ts
// Buyer-side MCP tool: pay_for_resource. Pays a 402-gated endpoint per call and
// returns the resource plus a receipt carrying the settlement tx hash. Honors
// per-tx and per-session spend caps. Supports dry-run (no broadcast).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseUnits, formatUnits, getAddress, encodeFunctionData, type Address, type Hash } from "viem";
import {
  NETWORK,
  CHAIN_ID,
  EXPLORER_URL,
  erc20Abi,
  publicClient,
  walletClient,
  loadAccount,
  assertAddress,
  assertPositiveAmount,
  assertCanSubmitTx,
  withRetry,
  rateBudget,
  redact,
  stringifyError,
} from "../chain.js";
import { TOLLGATE_SCHEME, claimMessage } from "../facilitator.js";
import type { Runtime } from "../runtime.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// Cumulative spend this process, per asset, for the per-session cap.
const sessionSpent = new Map<string, bigint>();

interface ParsedRequirement {
  scheme: string;
  network: string;
  asset: Address;
  amount: string; // atomic
  payTo: Address;
  resource?: string;
  decimals?: number;
}

// Pull the first usable requirement out of a 402 body. Accepts our scheme on
// Atlantic. Tolerates both the atomic `amount` field and the v1 `maxAmountRequired`.
function pickRequirement(body: any): ParsedRequirement {
  const accepts: any[] = body?.accepts ?? [];
  const match =
    accepts.find((a) => a?.network === NETWORK && a?.scheme === TOLLGATE_SCHEME) ??
    accepts.find((a) => a?.network === NETWORK) ??
    accepts[0];
  if (!match) throw new Error("402 response carried no payment requirements.");
  const amount = String(match.amount ?? match.maxAmountRequired ?? match.price?.amount);
  return {
    scheme: match.scheme ?? TOLLGATE_SCHEME,
    network: match.network ?? NETWORK,
    asset: assertAddress(match.asset ?? match.price?.asset),
    amount,
    payTo: assertAddress(match.payTo),
    resource: match.resource,
    decimals: match.decimals ?? match.price?.decimals,
  };
}

export function registerBuyerTools(server: McpServer, rt: Runtime): void {
  server.registerTool(
    "pay_for_resource",
    {
      title: "Pay for a 402-gated resource",
      description:
        "Fetch a resource that returns HTTP 402 on Pharos Atlantic, pay the required amount in USDC, then return the resource and a receipt with the settlement tx hash. Enforces per-tx and per-session spend caps. Set dryRun to simulate without broadcasting. Set prepareOnly with fromAddress for non-custodial use: no private key is loaded, and the unsigned transfer is returned for an external wallet (a browser wallet, a human in the loop) to sign and broadcast.",
      inputSchema: {
        url: z.string().describe("The 402-gated resource URL."),
        method: z.string().optional().describe("HTTP method. Default GET."),
        maxUsdc: z.string().optional().describe("Reject if the price exceeds this many USDC. Overrides the per-tx cap downward only."),
        dryRun: z.boolean().optional().describe("Simulate the payment without broadcasting."),
        prepareOnly: z.boolean().optional().describe("Non-custodial: build the unsigned transfer for an external wallet to sign, instead of broadcasting with a server-held key. Requires fromAddress. No private key is loaded."),
        fromAddress: z.string().optional().describe("The payer's wallet address. Required with prepareOnly so the unsigned transaction can be built."),
      },
    },
    async (args) => {
      const method = (args.method ?? "GET").toUpperCase();
      const dryRun = args.dryRun ?? rt.settings.dryRun;

      // 1. First request. Expect 402 with payment requirements.
      const first = await withRetry(() => fetch(args.url, { method }), { label: "fetch resource" });
      if (first.status !== 402) {
        const text = await first.text();
        return ok({ paid: false, status: first.status, note: "Resource did not ask for payment.", body: safeJson(text) });
      }
      const reqBody = await first.json().catch(() => ({}));
      const req = pickRequirement(reqBody);

      const decimals =
        req.decimals ??
        (await tokenDecimals(req.asset));
      const atomic = assertPositiveAmount(BigInt(req.amount));

      // 2. Spend caps. Per-tx cap is the lower of the env cap and any explicit maxUsdc.
      const perTxCapUsdc = Math.min(
        rt.settings.maxPerTxUsdc,
        args.maxUsdc ? Number(args.maxUsdc) : Number.POSITIVE_INFINITY,
      );
      const priceUsdc = Number(formatUnits(atomic, decimals));
      if (priceUsdc > perTxCapUsdc) {
        return ok({
          paid: false,
          reason: `price ${priceUsdc} USDC exceeds per-tx cap ${perTxCapUsdc} USDC`,
        });
      }
      const spentKey = req.asset.toLowerCase();
      const already = sessionSpent.get(spentKey) ?? 0n;
      const sessionCapAtomic = parseUnits(String(rt.settings.maxPerSessionUsdc), decimals);
      if (already + atomic > sessionCapAtomic) {
        return ok({
          paid: false,
          reason: `payment would exceed per-session cap of ${rt.settings.maxPerSessionUsdc} USDC`,
          sessionSpentUsdc: formatUnits(already, decimals),
        });
      }

      // 3. Non-custodial mode: build the unsigned transfer for an external
      // wallet to sign. No private key is loaded or needed. The caller supplies
      // the payer's address; their wallet signs, broadcasts, then assembles the
      // X-PAYMENT header. This is how a browser wallet or human-in-the-loop
      // client pays without ever handing Tollgate a key.
      if (args.prepareOnly) {
        if (!args.fromAddress) {
          return ok({
            paid: false,
            reason: "prepareOnly requires fromAddress, the payer's wallet address, so the unsigned transaction can be built.",
          });
        }
        const from = assertAddress(args.fromAddress);
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [req.payTo, atomic],
        });
        return ok({
          paid: false,
          prepareOnly: true,
          unsignedTransaction: {
            from,
            to: req.asset,
            data,
            value: "0x0",
            chainId: CHAIN_ID,
          },
          requirement: {
            asset: req.asset,
            amountUsdc: formatUnits(atomic, decimals),
            payTo: req.payTo,
            scheme: req.scheme,
            network: req.network,
          },
          claim: {
            messageTemplate: claimMessage("<txHash>"),
            note: "After the wallet broadcasts the transfer, sign the claim message for the resulting txHash with the same wallet, so only the payer can redeem the payment.",
          },
          next:
            "Sign and broadcast unsignedTransaction in the user's wallet. Then sign the claim message for the resulting txHash, base64-encode an X-PAYMENT payload { x402Version: 1, scheme, network, payload: { txHash, from, to, asset, value, claimSignature } }, and re-request the resource with that X-PAYMENT header. The merchant's verify_payment is idempotent, so a claim can be retried safely without paying twice.",
        });
      }

      const account = loadAccount();

      // 4. Dry-run: simulate, do not broadcast.
      if (dryRun) {
        const { request } = await publicClient().simulateContract({
          account,
          address: req.asset,
          abi: erc20Abi,
          functionName: "transfer",
          args: [req.payTo, atomic],
        });
        return ok({
          paid: false,
          dryRun: true,
          wouldPay: {
            asset: req.asset,
            amountUsdc: formatUnits(atomic, decimals),
            payTo: req.payTo,
            from: account.address,
            scheme: req.scheme,
            network: req.network,
          },
          note: "Dry run. No transaction was broadcast. Simulation succeeded.",
        });
      }

      // 5. Broadcast the ERC-20 transfer (buyer pays gas; token is not EIP-3009).
      await assertCanSubmitTx(account.address);
      rateBudget.take();
      const wallet = walletClient();
      let txHash: Hash;
      try {
        txHash = await wallet.writeContract({
          account,
          chain: undefined,
          address: req.asset,
          abi: erc20Abi,
          functionName: "transfer",
          args: [req.payTo, atomic],
        });
      } catch (err) {
        return ok({ paid: false, reason: redact(stringifyError(err)) });
      }

      const receipt = await withRetry(
        () => publicClient().waitForTransactionReceipt({ hash: txHash }),
        { label: "waitForTransactionReceipt" },
      );
      if (receipt.status !== "success") {
        return ok({ paid: false, reason: "payment transaction reverted", txHash });
      }
      sessionSpent.set(spentKey, already + atomic);

      // 6. Sign the claim so only this payer can redeem the tx hash, build the
      // X-PAYMENT header, and re-request the resource.
      const claimSignature = await account.signMessage({
        message: claimMessage(txHash),
      });
      const payment = {
        x402Version: 1,
        scheme: req.scheme,
        network: req.network,
        payload: {
          txHash,
          from: account.address,
          to: req.payTo,
          asset: req.asset,
          value: atomic.toString(),
          claimSignature,
        },
      };
      const header = Buffer.from(JSON.stringify(payment)).toString("base64");

      let paidResp: Response;
      try {
        paidResp = await withRetry(
          () => fetch(args.url, { method, headers: { "X-PAYMENT": header } }),
          { label: "fetch with payment" },
        );
      } catch (err) {
        // The money moved but the claim could not be delivered. Hand the agent
        // everything it needs to retry the claim without paying again.
        return ok({
          paid: true,
          claimed: false,
          reason: redact(stringifyError(err)),
          settlementTxHash: txHash,
          explorerUrl: `${EXPLORER_URL}/tx/${txHash}`,
          paymentHeader: header,
          hint: "Retry the request with this X-PAYMENT header. The payment is settled on-chain and the merchant's idempotency will honor the first claim.",
        });
      }
      const resourceText = await paidResp.text();

      return ok({
        paid: true,
        status: paidResp.status,
        settlementTxHash: txHash,
        explorerUrl: `${EXPLORER_URL}/tx/${txHash}`,
        amountUsdc: formatUnits(atomic, decimals),
        payTo: req.payTo,
        from: account.address,
        sessionSpentUsdc: formatUnits(already + atomic, decimals),
        resource: safeJson(resourceText),
        receipt: {
          settlementTxHash: txHash,
          asset: req.asset,
          amount: atomic.toString(),
          network: req.network,
        },
      });
    },
  );
}

const decimalsCache = new Map<string, number>();
async function tokenDecimals(asset: Address): Promise<number> {
  const key = asset.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  const d = (await publicClient().readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  })) as number;
  decimalsCache.set(key, d);
  return d;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
