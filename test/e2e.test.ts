// test/e2e.test.ts
// One live Atlantic smoke test plus receipt verifiability. The on-chain checks
// skip cleanly if the RPC is unreachable. A live settlement test runs only when
// TOLLGATE_PRIVATE_KEY is set, since it needs a funded account.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEventLogs } from "viem";
import { CHAIN_ID, USDC_ADDRESS, publicClient, erc20Abi } from "../src/chain.js";
import { ReceiptStore, verifyReceipt } from "../src/receipts.js";

process.env.TOLLGATE_SIGNING_SECRET ??= "test-secret-for-receipts";

async function rpcReachable(): Promise<boolean> {
  try {
    await publicClient().getChainId();
    return true;
  } catch {
    return false;
  }
}

test("Atlantic chain id is 688689 and token is USDC with 6 decimals", async (t) => {
  if (!(await rpcReachable())) {
    t.skip("Atlantic RPC unreachable in this environment");
    return;
  }
  const id = await publicClient().getChainId();
  assert.equal(id, CHAIN_ID);
  const [symbol, decimals] = await Promise.all([
    publicClient().readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "symbol" }),
    publicClient().readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" }),
  ]);
  assert.equal(symbol, "USDC");
  assert.equal(decimals, 6);
});

test("erc20Abi can decode a Transfer event (facilitator verify depends on it)", () => {
  // Regression: the on-chain verify decodes the Transfer event from this ABI.
  // If the event is missing, parseEventLogs returns nothing and every real
  // payment is rejected as "no matching transfer".
  const from = "0x1111111111111111111111111111111111111111";
  const to = "0x2222222222222222222222222222222222222222";
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
  const log = {
    address: USDC_ADDRESS,
    topics: [TRANSFER_TOPIC, pad(from), pad(to)] as `0x${string}`[],
    data: ("0x" + (100000n).toString(16).padStart(64, "0")) as `0x${string}`,
    blockNumber: 1n,
    blockHash: ("0x" + "00".repeat(32)) as `0x${string}`,
    logIndex: 0,
    transactionHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    transactionIndex: 0,
    removed: false,
  };
  const decoded = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: [log] });
  assert.equal(decoded.length, 1);
  const args = decoded[0]!.args as { from: string; to: string; value: bigint };
  assert.equal(args.value, 100000n);
});

test("a PAID receipt is signed and verifiable; tampering is detected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tollgate-rcpt-"));
  try {
    const store = ReceiptStore.open(join(dir, "receipts.jsonl"));
    const receipt = await store.recordPaid({
      txHash: "0x" + "ab".repeat(32),
      payer: "0x1111111111111111111111111111111111111111",
      payTo: "0x2222222222222222222222222222222222222222",
      asset: USDC_ADDRESS,
      amount: "100000",
      decimals: 6,
      network: `eip155:${CHAIN_ID}`,
      resource: "GET /report",
    });
    assert.equal(verifyReceipt(receipt), true);
    const tampered = { ...receipt, amount: "999999" };
    assert.equal(verifyReceipt(tampered), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconciliation excludes voided duplicates from totals", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tollgate-recon-"));
  try {
    const store = ReceiptStore.open(join(dir, "receipts.jsonl"));
    const common = {
      payer: "0x1111111111111111111111111111111111111111",
      payTo: "0x2222222222222222222222222222222222222222",
      asset: USDC_ADDRESS,
      amount: "100000",
      decimals: 6,
      network: `eip155:${CHAIN_ID}`,
      resource: "GET /report",
    };
    const paid = await store.recordPaid({ ...common, txHash: "0x" + "cd".repeat(32) });
    await store.recordVoid({ ...common, txHash: "0x" + "cd".repeat(32), duplicateOf: paid.id });
    const recon = store.reconcile();
    assert.equal(recon.paidCount, 1);
    assert.equal(recon.voidedCount, 1);
    assert.equal(recon.totalReceived, "100000");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
