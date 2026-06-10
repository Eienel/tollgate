// chain.ts
// The Pharos chain Tollgate runs on, defined once with viem and reused
// everywhere. Holds the network presets (Atlantic testnet and Pacific
// mainnet), the verified test USDC address, a minimal ERC-20 ABI,
// retry-with-backoff, a rate-limit and pending-tx budget, and key redaction.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  getAddress,
  isAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// The Pharos networks Tollgate knows. Select with TOLLGATE_NETWORK=atlantic
// (default) or mainnet; any field can still be overridden by its own env var.
// Both chain ids and RPCs are verified live (see DECISION.md).
interface NetworkPreset {
  id: number;
  name: string;
  rpc: string;
  wss?: string;
  explorer: string;
  symbol: string;
  testnet: boolean;
  // Default payment token, where one is known and verified. On mainnet there
  // is no verified default; set TOLLGATE_USDC_ADDRESS explicitly.
  usdc?: Address;
}

const PRESETS: Record<string, NetworkPreset> = {
  atlantic: {
    id: 688689,
    name: "Pharos Atlantic Testnet",
    rpc: "https://atlantic.dplabs-internal.com",
    wss: "wss://atlantic.dplabs-internal.com",
    explorer: "https://atlantic.pharosscan.xyz",
    symbol: "PHRS",
    testnet: true,
    usdc: "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
  },
  mainnet: {
    id: 1672,
    name: "Pharos Pacific Mainnet",
    rpc: "https://rpc.pharos.xyz",
    explorer: "https://pharosscan.xyz",
    symbol: "PROS",
    testnet: false,
  },
};

const presetName = (process.env.TOLLGATE_NETWORK ?? "atlantic").trim().toLowerCase();
const preset = PRESETS[presetName];
if (!preset) {
  throw new Error(
    `Unknown TOLLGATE_NETWORK "${presetName}". Use one of: ${Object.keys(PRESETS).join(", ")}.`,
  );
}

export const IS_TESTNET = preset.testnet;
export const NETWORK_LABEL = preset.name;
export const CHAIN_ID = Number(process.env.TOLLGATE_CHAIN_ID ?? preset.id);

// x402 networks are namespaced strings. For an EVM chain this is eip155:<id>.
export const NETWORK = `eip155:${CHAIN_ID}` as const;

export const RPC_URL = process.env.TOLLGATE_RPC_URL ?? preset.rpc;
export const WSS_URL = process.env.TOLLGATE_WSS_URL ?? preset.wss;
export const EXPLORER_URL = process.env.TOLLGATE_EXPLORER_URL ?? preset.explorer;

// The payment token. On Atlantic this defaults to the verified test USDC, a
// plain ERC-20 with no EIP-3009 (see DECISION.md / npm run step0). On mainnet
// there is no verified default; the merchant chooses and sets it explicitly.
const envToken = process.env.TOLLGATE_USDC_ADDRESS?.trim();
const resolvedToken = envToken ?? preset.usdc;
if (!resolvedToken) {
  throw new Error(
    `No payment token configured for ${preset.name}. Set TOLLGATE_USDC_ADDRESS to the ERC-20 you charge in.`,
  );
}
export const USDC_ADDRESS = resolvedToken as Address;

// The selected Pharos chain, defined once.
export const pharosChain = defineChain({
  id: CHAIN_ID,
  name: preset.name,
  nativeCurrency: { name: "Pharos", symbol: preset.symbol, decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL], webSocket: WSS_URL ? [WSS_URL] : undefined },
  },
  blockExplorers: {
    default: { name: "PharosScan", url: EXPLORER_URL },
  },
  testnet: preset.testnet,
});

// Backwards-compatible alias; most of the codebase grew up on Atlantic.
export const atlantic = pharosChain;

// Minimal ERC-20 surface. This token only supports the standard methods.
export const erc20Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

let _publicClient: PublicClient | undefined;

export function publicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: atlantic,
      transport: http(RPC_URL),
    });
  }
  return _publicClient;
}

// Read the private key from env, never from arguments or files. Returns the
// viem account and a wallet client. Throws a redacted error if absent or bad.
export function loadAccount() {
  const raw = process.env.TOLLGATE_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      "TOLLGATE_PRIVATE_KEY is not set. Set it in the environment to sign transactions.",
    );
  }
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  try {
    const account = privateKeyToAccount(hex);
    return account;
  } catch {
    // Never echo the key material in the error.
    throw new Error("TOLLGATE_PRIVATE_KEY is not a valid hex private key.");
  }
}

export function walletClient(): WalletClient {
  const account = loadAccount();
  return createWalletClient({
    account,
    chain: atlantic,
    transport: http(RPC_URL),
  });
}

// The address that receives merchant payments.
export function payToAddress(): Address {
  const explicit = process.env.TOLLGATE_PAY_TO?.trim();
  if (explicit) return assertAddress(explicit);
  return loadAccount().address;
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

export function assertAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Not a valid address: ${value}`);
  }
  const checksummed = getAddress(value);
  if (checksummed === "0x0000000000000000000000000000000000000000") {
    throw new Error("Address must not be the zero address.");
  }
  return checksummed;
}

export function assertPositiveAmount(atomic: bigint): bigint {
  if (atomic <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return atomic;
}

// Redact anything that looks like a 32-byte hex private key from a string, so
// stray key material can never reach a log or an error returned to a client.
export function redact(text: string): string {
  const key = process.env.TOLLGATE_PRIVATE_KEY?.trim();
  let out = text;
  if (key) {
    const bare = key.startsWith("0x") ? key.slice(2) : key;
    out = out.split(key).join("[redacted]").split(bare).join("[redacted]");
  }
  return out.replace(/0x[0-9a-fA-F]{64}/g, "[redacted-hex]");
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff for flaky RPC calls.
// ---------------------------------------------------------------------------

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 300;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const wait = baseMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const label = opts.label ? `${opts.label}: ` : "";
  throw new Error(redact(`${label}${stringifyError(lastError)}`));
}

export function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Rate limit budget. Atlantic allows 500 requests per 5 minutes per source and
// at most 64 pending transactions per address. This is a soft client-side guard
// so the skill stays a good citizen and fails clearly before the node rejects.
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 500;
const PENDING_TX_MAX = 64;

class RateBudget {
  private hits: number[] = [];

  take(): void {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (this.hits.length >= RATE_MAX) {
      throw new Error(
        "Atlantic rate limit budget reached (500 per 5 minutes). Backing off.",
      );
    }
    this.hits.push(now);
  }

  remaining(): number {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < RATE_WINDOW_MS);
    return RATE_MAX - this.hits.length;
  }
}

export const rateBudget = new RateBudget();

// Number of pending transactions for an address (pending nonce minus latest nonce).
export async function pendingTxCount(address: Address): Promise<number> {
  const client = publicClient();
  const [pending, latest] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "pending" }),
    client.getTransactionCount({ address, blockTag: "latest" }),
  ]);
  return Math.max(0, pending - latest);
}

export async function assertCanSubmitTx(address: Address): Promise<void> {
  const pending = await pendingTxCount(address);
  if (pending >= PENDING_TX_MAX) {
    throw new Error(
      `Address has ${pending} pending transactions (max ${PENDING_TX_MAX}). Wait for them to clear.`,
    );
  }
}
