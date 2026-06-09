# DECISION.md

The why, what, and how behind Tollgate, for reviewers.

## The bet

The Pharos hackathon positions agents as on-chain economic actors, and names x402
as the payment pillar. The strongest skill is one that agents must reach for and
that solves a real, documented problem rather than re-skinning the official example.

We rejected two tempting ideas on purpose:

1. A basic x402 or wallet-ops skill. Pharos already ships an official x402 skill
   (server plus test client). Building next to it is the most crowded category and
   adds little.
2. A generic escrow skill. Not tied to any Pharos-specific gap, so it is
   undifferentiated and likely crowded.

Instead we traced the real path to ship a paid service on Pharos and found a cluster
of problems Pharos documents but does not solve for you. Tollgate is that missing
layer. The gaps are in Pharos's own docs, which is the strongest possible story.

## The four gaps Tollgate closes

1. No hosted facilitator for Pharos. You run your own verify and settle service,
   and the docs flag it as a single point of failure needing retry and health
   checks. Tollgate bundles a preconfigured Atlantic facilitator with retry,
   idempotent settle, and a health probe (`src/facilitator.ts`).
2. Idempotency is left to the developer. The docs require that the same on-chain tx
   is not billed or granted twice, with no turnkey solution. Tollgate makes this
   first class and persistent (`src/idempotency.ts`).
3. Post-payment sessions are left to the developer. The docs recommend a
   short-lived token after payment. Tollgate mints one (`src/jwt.ts`).
4. Network and token confusion. Two testnets, internal-looking RPC, a test USDC
   flagged as not official. Tollgate defines Atlantic once (`src/chain.ts`) and
   verifies the token in STEP 0.

## STEP 0 and what it changed

Before writing any payment code we asked whether the Atlantic test USDC supports
EIP-3009 (`transferWithAuthorization`), which the gasless x402 exact scheme depends
on. The script `scripts/check-eip3009.ts` and direct RPC probes agree:

- Token `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` is USD Coin, symbol USDC, 6 decimals.
- It is not a proxy (EIP-1967 implementation and beacon slots are zero).
- `DOMAIN_SEPARATOR()` reverts.
- `transferWithAuthorization`, `authorizationState`, and `permit` selectors are
  absent from its bytecode, while `transfer`, `transferFrom`, and `approve` are present.

Conclusion: it is a plain ERC-20 with no EIP-3009. The gasless exact scheme cannot
settle against it. This is exactly the kind of documented-but-unsolved gap the
project is about, and the test USDC being flagged as not official is in Pharos's docs.

So the payment path is: the buyer broadcasts an on-chain ERC-20 transfer to the
merchant, attaches an `X-PAYMENT` payload carrying the tx hash, and the bundled
facilitator verifies that transfer on-chain and settles idempotently. The buyer pays
gas; there is no gasless authorization to relay. When Pharos ships an EIP-3009 token
or deploys Permit2, only the settle mechanism changes. The reliability layer above
it, which is the actual product, does not.

## Architecture

- `src/chain.ts`: Atlantic (688689) defined once with viem, the verified USDC
  address and a minimal ERC-20 ABI, retry with backoff, a soft rate-limit and
  pending-tx budget (500 per 5 min, 64 pending tx), address and amount validation,
  and private-key redaction.
- `src/idempotency.ts`: the core primitive. An append-only JSONL log with a
  last-write-wins in-memory index rebuilt on open. `reserve` is fresh exactly once
  per key; `complete` stores a result reused on every retry. No native dependency
  and no database to operate, so it cannot fail to start.
- `src/receipts.ts`: HMAC-signed, tamper-evident receipts anchored to tx hashes,
  plus reconciliation that counts PAID and never counts VOID.
- `src/jwt.ts`: HS256 session tokens built on node:crypto, referencing the receipt.
- `src/facilitator.ts`: bundled verify and idempotent settle for Atlantic, plus a
  health probe.
- `src/grant.ts`: the one idempotent grant decision, shared by the `verify_payment`
  tool and the seller example so there is a single code path for the headline feature.
- `src/tools/*` and `src/server.ts`: the MCP surface over stdio or HTTP.
- `dashboard/`: the live receipts ledger that makes the invisible skill legible.

## Why a JSONL log instead of SQLite

The idempotency store is the reliability primitive, so it must never be the reason
the server fails to boot. A pure-Node append-only log has no native build step and
no daemon. A crash mid-write loses at most the final partial line, and the prior
state is always intact because the format is append-only. `compact()` is available
for housekeeping but is never required for correctness. SQLite would be a reasonable
swap behind the same interface if a deployment wants indexed queries at scale.

## Safety rails

Idempotent and restart-safe verify and settle; dry-run that simulates without
broadcasting; per-tx and per-session buyer spend caps; address and positive-amount
validation; retry with backoff; respect for Atlantic's rate and pending-tx limits;
and a private key that is read only from env and redacted from every log and error.

## Demo design

A backend skill is invisible, so the dashboard is the demo. The metaphor is a paper
toll ticket: HTTP 402 is pay at the gate, a verified payment is a stamped ticket,
reconciliation is the stack of tickets. The signature element is the stamp: a PAID
stamp presses on a fresh verify, a VOID stamp presses on a blocked duplicate. That
one element literally demonstrates idempotency, the headline feature. The palette is
paper and ink with a single deep ledger green held to mean cleared and settled, data
is set in monospace because toll tickets are monospaced figures, and motion is spring
physics on transform and opacity only, with a calm reduced-motion fallback.

## What is deliberately out of scope for day one

Multi-account facilitator redundancy is noted as a stretch goal, not built. The
gasless exact scheme is wired conceptually but not used, because the test token
cannot support it. Live settlement requires a funded Atlantic key and is gated behind
its presence in the tests rather than mocked into a false green.
