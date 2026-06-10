// jwt.ts
// Short-lived signed session tokens (HS256) so an agent does not re-verify a
// payment on-chain on every request. Implemented with node:crypto to avoid a
// dependency. The token carries a reference to the payment that bought it.

import { createHmac, timingSafeEqual } from "node:crypto";
import { signingSecret } from "./secret.js";

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

const secret = signingSecret;

export interface AccessTokenClaims {
  // Subject: the payer address that bought this session.
  sub: string;
  // Payment reference so a resource server can tie the session to a receipt.
  txHash: string;
  receiptId: string;
  resource?: string;
  // Standard timestamps in seconds.
  iat: number;
  exp: number;
  // Free-form extras.
  [key: string]: unknown;
}

export interface IssuedToken {
  token: string;
  claims: AccessTokenClaims;
  expiresAt: string;
}

// Mint a session token referencing a verified payment.
export function issueAccessToken(input: {
  payer: string;
  txHash: string;
  receiptId: string;
  resource?: string;
  ttlSeconds?: number;
  extra?: Record<string, unknown>;
}): IssuedToken {
  const ttl =
    input.ttlSeconds ??
    Number(process.env.TOLLGATE_TOKEN_TTL_SECONDS ?? "900");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttl;
  const claims: AccessTokenClaims = {
    sub: input.payer,
    txHash: input.txHash,
    receiptId: input.receiptId,
    resource: input.resource,
    iat,
    exp,
    ...(input.extra ?? {}),
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const sig = b64url(createHmac("sha256", secret()).update(signingInput).digest());
  return {
    token: `${signingInput}.${sig}`,
    claims,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  claims?: AccessTokenClaims;
}

// Verify a session token: signature, structure, and expiry.
export function verifyAccessToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed token" };
  const [h, p, s] = parts as [string, string, string];
  const signingInput = `${h}.${p}`;
  const expected = createHmac("sha256", secret()).update(signingInput).digest();
  const got = fromB64url(s);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { valid: false, reason: "bad signature" };
  }
  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(fromB64url(p).toString("utf8")) as AccessTokenClaims;
  } catch {
    return { valid: false, reason: "unparseable claims" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, claims };
}
