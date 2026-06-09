// scripts/check-eip3009.ts
// STEP 0. Confirm whether the Atlantic test USDC supports EIP-3009
// (transferWithAuthorization) before building the payment path. If it does, the
// buyer flow can be gasless via the exact scheme. If it does not, Tollgate uses
// an on-chain ERC-20 transfer that the buyer broadcasts, and settle confirms it.
//
// Run: npm run step0

import { createPublicClient, http, toFunctionSelector } from "viem";
import { atlantic, USDC_ADDRESS, RPC_URL } from "../src/chain.js";

const client = createPublicClient({ chain: atlantic, transport: http(RPC_URL) });

async function supports(selectorSig: string, dataPadded = ""): Promise<boolean> {
  const selector = toFunctionSelector(selectorSig);
  try {
    await client.call({ to: USDC_ADDRESS, data: (selector + dataPadded) as `0x${string}` });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("STEP 0: probing test USDC for EIP-3009");
  console.log("  token:", USDC_ADDRESS);
  console.log("  rpc:  ", RPC_URL);

  const code = await client.getBytecode({ address: USDC_ADDRESS });
  if (!code || code === "0x") {
    console.error("No contract bytecode at the token address. Aborting.");
    process.exit(1);
  }

  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address: USDC_ADDRESS, abi: erc20View, functionName: "name" }),
    client.readContract({ address: USDC_ADDRESS, abi: erc20View, functionName: "symbol" }),
    client.readContract({ address: USDC_ADDRESS, abi: erc20View, functionName: "decimals" }),
  ]);
  console.log(`  token is ${name} (${symbol}), ${decimals} decimals`);

  // EIP-3009 / EIP-2612 markers. DOMAIN_SEPARATOR is required for both.
  const hasDomainSeparator = await supports("DOMAIN_SEPARATOR()");
  const sel3009 = toFunctionSelector(
    "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
  );
  const selPermit = toFunctionSelector(
    "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  );
  const codeHasTransferWithAuth = code.toLowerCase().includes(sel3009.slice(2).toLowerCase());
  const codeHasPermit = code.toLowerCase().includes(selPermit.slice(2).toLowerCase());

  console.log("\nResults:");
  console.log("  DOMAIN_SEPARATOR() present:        ", hasDomainSeparator);
  console.log("  transferWithAuthorization in code: ", codeHasTransferWithAuth);
  console.log("  permit (EIP-2612) in code:         ", codeHasPermit);

  const eip3009 = hasDomainSeparator && codeHasTransferWithAuth;
  console.log("\nVerdict:");
  if (eip3009) {
    console.log("  SUPPORTED. The gasless exact scheme can be used: the buyer signs a");
    console.log("  transferWithAuthorization and the facilitator submits it.");
  } else {
    console.log("  NOT SUPPORTED. This is a plain ERC-20 with no EIP-3009.");
    console.log("  Tollgate uses an on-chain ERC-20 transfer broadcast by the buyer,");
    console.log("  and the bundled facilitator confirms it idempotently on settle.");
    console.log("  Swap to the gasless exact scheme once Pharos ships an EIP-3009 token.");
  }
  process.exit(eip3009 ? 0 : 0);
}

const erc20View = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

main().catch((err) => {
  console.error("step0 failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
