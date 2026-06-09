// grant.ts
// The idempotent grant decision, shared by the verify_payment MCP tool and the
// seller example so there is exactly one code path for the headline feature.
//
// Fresh valid payment -> reserve the tx hash, settle, record a PAID receipt.
// Repeat of the same tx hash -> deny and record a VOID receipt that points at
// the original. A payment can never grant or bill twice, across restarts.

import { getAddress, type Address } from "viem";
import { NETWORK } from "./chain.js";
import { IdempotencyStore } from "./idempotency.js";
import {
  type PaymentPayload,
  type PaymentRequirements,
} from "./facilitator.js";
import type { Receipt } from "./receipts.js";
import type { Runtime } from "./runtime.js";

export interface GrantResult {
  grant: boolean;
  reason?: string;
  receipt?: Receipt;
  duplicateOf?: string;
  settlement?: Record<string, unknown>;
}

export async function processPayment(
  rt: Runtime,
  input: {
    payload: PaymentPayload;
    asset: Address;
    amount: string;
    payTo: Address;
    resource: string;
    decimals: number;
  },
): Promise<GrantResult> {
  const { payload, asset, amount, payTo, resource, decimals } = input;
  const txHash = payload.payload?.txHash;
  if (!txHash) throw new Error("Payment payload is missing a txHash.");

  const req: PaymentRequirements = {
    scheme: payload.scheme,
    network: NETWORK,
    asset,
    amount,
    payTo,
    resource,
    description: `Paid access to ${resource}`,
  };
  const key = IdempotencyStore.keyFor(txHash, payload.payload.nonce);
  const grantKey = `grant:${key}`;

  // Duplicate: this tx hash already granted. Block it and stamp VOID.
  const existing = rt.idem.get(grantKey);
  if (existing?.result) {
    const original = existing.result as { receiptId: string; payer: string };
    const voidReceipt = await rt.receipts.recordVoid({
      txHash,
      payer: getAddress((payload.payload.from ?? original.payer) as Address),
      payTo,
      asset,
      amount,
      decimals,
      network: NETWORK,
      resource,
      duplicateOf: original.receiptId,
    });
    return {
      grant: false,
      reason: "duplicate payment blocked by idempotency",
      duplicateOf: original.receiptId,
      receipt: voidReceipt,
    };
  }

  // Fresh: verify on-chain.
  const verified = await rt.facilitator.verify(payload, req);
  if (!verified.isValid) {
    return { grant: false, reason: verified.invalidReason ?? "verification failed" };
  }

  // Reserve. If a concurrent request won the race, treat as duplicate.
  const reserved = await rt.idem.reserve(grantKey, {
    resource,
    amount,
    payer: verified.payer,
  });
  if (!reserved.fresh && reserved.record.result) {
    const original = reserved.record.result as { receiptId: string };
    return {
      grant: false,
      reason: "duplicate payment blocked by idempotency",
      duplicateOf: original.receiptId,
    };
  }

  const settlement = await rt.facilitator.settle(payload, req);
  const receipt = await rt.receipts.recordPaid({
    txHash,
    payer: verified.payer as Address,
    payTo,
    asset,
    amount: verified.settledValue ?? amount,
    decimals,
    network: NETWORK,
    resource,
  });
  await rt.idem.complete(grantKey, {
    receiptId: receipt.id,
    payer: verified.payer as string,
    txHash,
  });

  return {
    grant: true,
    receipt,
    settlement: settlement as unknown as Record<string, unknown>,
  };
}
