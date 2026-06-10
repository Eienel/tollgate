// receipts.ts
// Verifiable receipts anchored to settlement tx hashes, plus an earnings
// reconciliation summary. Each receipt is signed (HMAC-SHA256) so anyone with
// the signing secret can confirm it was issued by this merchant and unaltered.

import { createHmac, randomUUID } from "node:crypto";
import { formatUnits } from "viem";
import { JsonlStore } from "./idempotency.js";
import { EXPLORER_URL } from "./chain.js";
import { signingSecret } from "./secret.js";

export type ReceiptStatus = "PAID" | "VOID";

export interface Receipt {
  id: string;
  // PAID: a fresh, verified payment. VOID: a duplicate that was blocked.
  status: ReceiptStatus;
  txHash: string;
  payer: string;
  payTo: string;
  asset: string;
  // Atomic token units as a decimal string.
  amount: string;
  // Token decimals so amount can be rendered without another lookup.
  decimals: number;
  network: string;
  // The protected resource this payment was for.
  resource: string;
  // For a VOID, the id of the original PAID receipt this duplicates.
  duplicateOf?: string;
  explorerUrl: string;
  createdAt: string;
  // HMAC over the canonical fields. Verifiable, tamper-evident.
  signature: string;
}

// The exact bytes that get signed. Order matters and must never change for a
// given receipt, so verification is stable across restarts and machines.
function canonical(r: Omit<Receipt, "signature">): string {
  return [
    r.id,
    r.status,
    r.txHash.toLowerCase(),
    r.payer.toLowerCase(),
    r.payTo.toLowerCase(),
    r.asset.toLowerCase(),
    r.amount,
    String(r.decimals),
    r.network,
    r.resource,
    r.duplicateOf ?? "",
    r.createdAt,
  ].join("|");
}

export function signReceipt(r: Omit<Receipt, "signature">): string {
  return createHmac("sha256", signingSecret()).update(canonical(r)).digest("hex");
}

export function verifyReceipt(r: Receipt): boolean {
  const { signature, ...rest } = r;
  const expected = signReceipt(rest);
  return expected === signature;
}

export interface Reconciliation {
  totalReceived: string;
  totalReceivedFormatted: string;
  asset: string;
  decimals: number;
  paidCount: number;
  voidedCount: number;
  perEndpoint: Array<{ resource: string; count: number; amount: string; amountFormatted: string }>;
  perPayer: Array<{ payer: string; count: number; amount: string; amountFormatted: string }>;
  generatedAt: string;
}

export class ReceiptStore {
  private constructor(private readonly log: JsonlStore<Receipt>) {}

  static open(path: string): ReceiptStore {
    return new ReceiptStore(JsonlStore.open<Receipt>(path, (r) => r.id));
  }

  // Record a fresh, verified payment.
  async recordPaid(input: {
    txHash: string;
    payer: string;
    payTo: string;
    asset: string;
    amount: string;
    decimals: number;
    network: string;
    resource: string;
  }): Promise<Receipt> {
    return this.record({ ...input, status: "PAID" });
  }

  // Record a blocked duplicate, pointing back at the original.
  async recordVoid(input: {
    txHash: string;
    payer: string;
    payTo: string;
    asset: string;
    amount: string;
    decimals: number;
    network: string;
    resource: string;
    duplicateOf: string;
  }): Promise<Receipt> {
    return this.record({ ...input, status: "VOID" });
  }

  private async record(
    input: Omit<Receipt, "id" | "explorerUrl" | "createdAt" | "signature">,
  ): Promise<Receipt> {
    const base: Omit<Receipt, "signature"> = {
      id: `rcpt_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      explorerUrl: `${EXPLORER_URL}/tx/${input.txHash}`,
      ...input,
    };
    const receipt: Receipt = { ...base, signature: signReceipt(base) };
    await this.log.put(receipt);
    return receipt;
  }

  get(id: string): Receipt | undefined {
    return this.log.get(id);
  }

  // List receipts newest first, with optional filters.
  list(filter: { status?: ReceiptStatus; payer?: string; resource?: string; limit?: number } = {}): Receipt[] {
    let rows = this.log.all();
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.payer) {
      const p = filter.payer.toLowerCase();
      rows = rows.filter((r) => r.payer.toLowerCase() === p);
    }
    if (filter.resource) rows = rows.filter((r) => r.resource === filter.resource);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  byTxHash(txHash: string): Receipt | undefined {
    const tx = txHash.toLowerCase();
    return this.log.all().find((r) => r.txHash.toLowerCase() === tx && r.status === "PAID");
  }

  // Earnings summary across all PAID receipts. Voids never count toward totals,
  // which is the whole point of idempotency made visible.
  reconcile(): Reconciliation {
    const all = this.log.all();
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
      perEndpoint: [...endpoints.entries()]
        .map(([resource, v]) => ({
          resource,
          count: v.count,
          amount: v.amount.toString(),
          amountFormatted: fmt(v.amount),
        }))
        .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1)),
      perPayer: [...payers.entries()]
        .map(([payer, v]) => ({
          payer,
          count: v.count,
          amount: v.amount.toString(),
          amountFormatted: fmt(v.amount),
        }))
        .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1)),
      generatedAt: new Date().toISOString(),
    };
  }
}
