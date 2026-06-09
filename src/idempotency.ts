// idempotency.ts
// The core reliability primitive. A persistent, restart-surviving dedupe store
// so the same on-chain payment can never grant access or bill twice.
//
// Storage is an append-only JSONL log with an in-memory index rebuilt on open.
// Append-only means a crash mid-write loses at most the last partial line, and
// the prior state is always intact. No native dependency, no database to run.

import { appendFileSync, mkdirSync, readFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// A tiny append-only JSONL log with a last-write-wins in-memory index. Shared by
// the idempotency store and the receipts ledger so both survive restart the same way.
export class JsonlStore<T extends object> {
  private index = new Map<string, T>();
  private mutex: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly keyOf: (row: T) => string,
  ) {}

  static open<T extends object>(
    path: string,
    keyOf: (row: T) => string,
  ): JsonlStore<T> {
    const store = new JsonlStore<T>(path, keyOf);
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) store.replay();
    return store;
  }

  private replay(): void {
    const text = readFileSync(this.path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as T;
        this.index.set(this.keyOf(row), row);
      } catch {
        // Ignore a torn final line from an unclean shutdown.
      }
    }
  }

  get(key: string): T | undefined {
    return this.index.get(key);
  }

  has(key: string): boolean {
    return this.index.has(key);
  }

  all(): T[] {
    return [...this.index.values()];
  }

  // Serialize writes so concurrent handlers cannot interleave a partial line.
  put(row: T): Promise<void> {
    const run = async () => {
      appendFileSync(this.path, JSON.stringify(row) + "\n");
      this.index.set(this.keyOf(row), row);
    };
    this.mutex = this.mutex.then(run, run);
    return this.mutex;
  }

  // Compact the log to one line per key. Optional housekeeping, never required.
  async compact(): Promise<void> {
    const rows = this.all();
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    renameSync(tmp, this.path);
  }
}

export type IdemStatus = "reserved" | "complete";

export interface IdemRecord {
  key: string;
  status: IdemStatus;
  // Free-form metadata captured at reserve time, for example the resource and amount.
  meta: Record<string, unknown>;
  // The settled result captured at completion, reused verbatim on any retry.
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveFresh {
  fresh: true;
  record: IdemRecord;
}

export interface ReserveExisting {
  fresh: false;
  record: IdemRecord;
}

export type ReserveOutcome = ReserveFresh | ReserveExisting;

// The idempotency store. Key by anything that uniquely identifies one payment.
// For Tollgate the key is the settlement tx hash, optionally namespaced by the
// payment nonce, so a transfer can be consumed exactly once.
export class IdempotencyStore {
  private constructor(private readonly log: JsonlStore<IdemRecord>) {}

  static open(path: string): IdempotencyStore {
    return new IdempotencyStore(
      JsonlStore.open<IdemRecord>(path, (r) => r.key),
    );
  }

  // Build a composite key. txHash alone is enough for an on-chain transfer; the
  // nonce is included when a scheme carries one, to be conservative.
  static keyFor(txHash: string, nonce?: string): string {
    const tx = txHash.toLowerCase();
    return nonce ? `${tx}:${nonce.toLowerCase()}` : tx;
  }

  // Atomically reserve a key. If it already exists, return the existing record
  // so the caller can reuse the prior decision instead of acting twice. The
  // first caller to see fresh:true owns the work of completing it.
  async reserve(key: string, meta: Record<string, unknown>): Promise<ReserveOutcome> {
    const existing = this.log.get(key);
    if (existing) return { fresh: false, record: existing };
    const now = new Date().toISOString();
    const record: IdemRecord = {
      key,
      status: "reserved",
      meta,
      createdAt: now,
      updatedAt: now,
    };
    await this.log.put(record);
    return { fresh: true, record };
  }

  // Record the settled result for a reserved key. Subsequent reserves return it.
  async complete(key: string, result: Record<string, unknown>): Promise<IdemRecord> {
    const prev = this.log.get(key);
    const now = new Date().toISOString();
    const record: IdemRecord = {
      key,
      status: "complete",
      meta: prev?.meta ?? {},
      result,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    await this.log.put(record);
    return record;
  }

  get(key: string): IdemRecord | undefined {
    return this.log.get(key);
  }

  all(): IdemRecord[] {
    return this.log.all();
  }
}
