// runtime.ts
// Shared, process-wide singletons and settings. Built once and injected into the
// tool factories so the merchant tools, the buyer tools, and the facilitator all
// read and write the same persistent stores.

import { join } from "node:path";
import { IdempotencyStore } from "./idempotency.js";
import { ReceiptStore } from "./receipts.js";
import { Facilitator } from "./facilitator.js";

export interface Settings {
  dataDir: string;
  dryRun: boolean;
  tokenTtlSeconds: number;
  maxPerTxUsdc: number;
  maxPerSessionUsdc: number;
}

export interface Runtime {
  settings: Settings;
  idem: IdempotencyStore;
  receipts: ReceiptStore;
  facilitator: Facilitator;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

let _runtime: Runtime | undefined;

export function getRuntime(): Runtime {
  if (_runtime) return _runtime;

  const dataDir = process.env.TOLLGATE_DATA_DIR ?? "./.tollgate";
  const settings: Settings = {
    dataDir,
    dryRun: bool(process.env.TOLLGATE_DRY_RUN, false),
    tokenTtlSeconds: Number(process.env.TOLLGATE_TOKEN_TTL_SECONDS ?? "900"),
    maxPerTxUsdc: Number(process.env.TOLLGATE_MAX_PER_TX_USDC ?? "5"),
    maxPerSessionUsdc: Number(process.env.TOLLGATE_MAX_PER_SESSION_USDC ?? "25"),
  };

  const idem = IdempotencyStore.open(join(dataDir, "idempotency.jsonl"));
  const receipts = ReceiptStore.open(join(dataDir, "receipts.jsonl"));
  const facilitator = new Facilitator(idem, settings.dryRun);

  _runtime = { settings, idem, receipts, facilitator };
  return _runtime;
}
