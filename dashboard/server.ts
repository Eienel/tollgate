// dashboard/server.ts
// The live receipts ledger for the demo. Serves the static dashboard and a small
// JSON API that reads the receipts log fresh on every request, so receipts the
// seller writes in another process appear live. Read-only over real data, with a
// seed endpoint for an offline demo when there is no funded wallet on hand.

import express from "express";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHmac } from "node:crypto";
import type { Receipt, Reconciliation } from "../src/receipts.js";
import { formatUnits } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TOLLGATE_DATA_DIR ?? "./.tollgate";
const RECEIPTS_PATH = join(DATA_DIR, "receipts.jsonl");
const PORT = Number(process.env.TOLLGATE_DASHBOARD_PORT ?? "8088");
const EXPLORER_URL = process.env.TOLLGATE_EXPLORER_URL ?? "https://atlantic.pharosscan.xyz";

// Read the ledger fresh so cross-process writes show up live.
function readReceipts(): Receipt[] {
  if (!existsSync(RECEIPTS_PATH)) return [];
  const rows: Receipt[] = [];
  for (const line of readFileSync(RECEIPTS_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t) as Receipt);
    } catch {
      // ignore a torn final line
    }
  }
  // last write wins per id
  const byId = new Map<string, Receipt>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

function reconcile(all: Receipt[]): Reconciliation {
  const paid = all.filter((r) => r.status === "PAID");
  const voided = all.filter((r) => r.status === "VOID");
  const decimals = paid[0]?.decimals ?? 6;
  const asset = paid[0]?.asset ?? "";
  let total = 0n;
  const endpoints = new Map<string, { count: number; amount: bigint }>();
  const payers = new Map<string, { count: number; amount: bigint }>();
  for (const r of paid) {
    const amt = BigInt(r.amount);
    total += amt;
    const e = endpoints.get(r.resource) ?? { count: 0, amount: 0n };
    e.count += 1;
    e.amount += amt;
    endpoints.set(r.resource, e);
    const p = payers.get(r.payer.toLowerCase()) ?? { count: 0, amount: 0n };
    p.count += 1;
    p.amount += amt;
    payers.set(r.payer.toLowerCase(), p);
  }
  const fmt = (v: bigint) => formatUnits(v, decimals);
  return {
    totalReceived: total.toString(),
    totalReceivedFormatted: fmt(total),
    asset,
    decimals,
    paidCount: paid.length,
    voidedCount: voided.length,
    perEndpoint: [...endpoints].map(([resource, v]) => ({
      resource,
      count: v.count,
      amount: v.amount.toString(),
      amountFormatted: fmt(v.amount),
    })),
    perPayer: [...payers].map(([payer, v]) => ({
      payer,
      count: v.count,
      amount: v.amount.toString(),
      amountFormatted: fmt(v.amount),
    })),
    generatedAt: new Date().toISOString(),
  };
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.get("/api/ledger", (_req, res) => {
  const receipts = readReceipts().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ receipts, reconciliation: reconcile(receipts), explorer: EXPLORER_URL });
});

// Offline demo seed: append a realistic PAID, then a duplicate VOID of it. Lets
// the dashboard tell its story without a funded wallet. Signed like real ones.
app.post("/api/demo/seed", (_req, res) => {
  mkdirSync(DATA_DIR, { recursive: true });
  const secret = process.env.TOLLGATE_SIGNING_SECRET ?? "demo-secret";
  const hex = (n: number) =>
    "0x" +
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const txHash = hex(64);
  const payer = hex(40);
  const base = {
    payTo: "0x2222222222222222222222222222222222222222",
    asset: process.env.TOLLGATE_USDC_ADDRESS ?? "0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8",
    amount: "100000",
    decimals: 6,
    network: "eip155:688689",
    resource: "GET /report",
  };
  const paid = makeReceipt({ ...base, txHash, payer, status: "PAID" }, secret);
  const voided = makeReceipt(
    { ...base, txHash, payer, status: "VOID", duplicateOf: paid.id },
    secret,
  );
  appendFileSync(RECEIPTS_PATH, JSON.stringify(paid) + "\n");
  setTimeout(() => appendFileSync(RECEIPTS_PATH, JSON.stringify(voided) + "\n"), 1200);
  res.json({ seeded: true, paid: paid.id, voided: voided.id });
});

function makeReceipt(
  input: Omit<Receipt, "id" | "explorerUrl" | "createdAt" | "signature">,
  secret: string,
): Receipt {
  const base: Omit<Receipt, "signature"> = {
    id: `rcpt_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    explorerUrl: `${EXPLORER_URL}/tx/${input.txHash}`,
    ...input,
  };
  const canonical = [
    base.id,
    base.status,
    base.txHash.toLowerCase(),
    base.payer.toLowerCase(),
    base.payTo.toLowerCase(),
    base.asset.toLowerCase(),
    base.amount,
    String(base.decimals),
    base.network,
    base.resource,
    base.duplicateOf ?? "",
    base.createdAt,
  ].join("|");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return { ...base, signature };
}

app.listen(PORT, () => {
  console.log(`Tollgate ledger on http://localhost:${PORT}`);
  console.log(`reading ${RECEIPTS_PATH}`);
});
