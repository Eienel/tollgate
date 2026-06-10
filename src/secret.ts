// secret.ts
// The HMAC secret used to sign receipts and session tokens. Resolved once so
// the same value is used everywhere and stays stable across restarts.
//
// Frictionless by default: if TOLLGATE_SIGNING_SECRET is not set, Tollgate
// generates a strong random secret on first run and persists it under the data
// directory, so the merchant tools work out of the box with zero configuration
// while keeping receipts and tokens verifiable after a restart. Set the env var
// explicitly in production, or to share one secret across several processes.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

let cached: string | undefined;

export function signingSecret(): string {
  if (cached) return cached;

  const fromEnv = process.env.TOLLGATE_SIGNING_SECRET?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  const dataDir = process.env.TOLLGATE_DATA_DIR ?? "./.tollgate";
  const path = join(dataDir, "signing-secret");

  if (existsSync(path)) {
    cached = readFileSync(path, "utf8").trim();
    if (cached) return cached;
  }

  const generated = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generated, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
  cached = generated;
  process.stderr.write(
    `x402-merchant: no TOLLGATE_SIGNING_SECRET set; generated one and saved it to ${path}. ` +
      `Set the env var explicitly for production or to share across processes.\n`,
  );
  return cached;
}
