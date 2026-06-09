// test/idempotency.test.ts
// The core reliability guarantee: a key can be reserved once, a completed result
// is reused on retry, and all of it survives a restart (reopening the store).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdempotencyStore } from "../src/idempotency.js";

function tmpFile(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "tollgate-idem-"));
  return { path: join(dir, "idem.jsonl"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("reserve is fresh the first time and not fresh after", async () => {
  const { path, cleanup } = tmpFile();
  try {
    const store = IdempotencyStore.open(path);
    const key = IdempotencyStore.keyFor("0xABC123");
    const first = await store.reserve(key, { resource: "/report" });
    assert.equal(first.fresh, true);
    const second = await store.reserve(key, { resource: "/report" });
    assert.equal(second.fresh, false);
  } finally {
    cleanup();
  }
});

test("a completed result is reused on retry", async () => {
  const { path, cleanup } = tmpFile();
  try {
    const store = IdempotencyStore.open(path);
    const key = IdempotencyStore.keyFor("0xdeadbeef", "nonce-1");
    await store.reserve(key, { resource: "/data" });
    await store.complete(key, { receiptId: "rcpt_1", txHash: "0xdeadbeef" });
    const retry = await store.reserve(key, { resource: "/data" });
    assert.equal(retry.fresh, false);
    assert.equal(retry.record.status, "complete");
    assert.equal((retry.record.result as any).receiptId, "rcpt_1");
  } finally {
    cleanup();
  }
});

test("state survives a restart (reopen rebuilds the index)", async () => {
  const { path, cleanup } = tmpFile();
  try {
    const key = IdempotencyStore.keyFor("0xfeed");
    const a = IdempotencyStore.open(path);
    await a.reserve(key, { resource: "/x" });
    await a.complete(key, { receiptId: "rcpt_persist" });

    // Simulate a process restart by opening a fresh store on the same file.
    const b = IdempotencyStore.open(path);
    const seen = await b.reserve(key, { resource: "/x" });
    assert.equal(seen.fresh, false);
    assert.equal((seen.record.result as any).receiptId, "rcpt_persist");
  } finally {
    cleanup();
  }
});

test("distinct tx hashes do not collide", async () => {
  const { path, cleanup } = tmpFile();
  try {
    const store = IdempotencyStore.open(path);
    const k1 = IdempotencyStore.keyFor("0x1111");
    const k2 = IdempotencyStore.keyFor("0x2222");
    assert.equal((await store.reserve(k1, {})).fresh, true);
    assert.equal((await store.reserve(k2, {})).fresh, true);
  } finally {
    cleanup();
  }
});
