---
name: x402-merchant
description: Turn an agent into a reliable paid merchant on Pharos Atlantic using x402, and let an agent pay for 402-gated resources. Use when an agent needs to charge for an endpoint, verify an incoming x402 payment without ever billing twice, mint a session token after payment, reconcile earnings, or pay another service per call. Built for Pharos Atlantic Testnet (chain id 688689).
---

# x402-merchant (Tollgate)

Tollgate is the reliability layer the official Pharos x402 example leaves to you.
An x402 demo gets a single payment through. Tollgate makes an agent a production
merchant: idempotent verification that can never grant or bill the same payment
twice, verifiable receipts, post-payment session tokens, earnings reconciliation,
and a bundled facilitator, since Pharos has no hosted one. It is two-sided, so the
same skill also lets an agent pay for resources.

## Reliability model

- Idempotency is the headline feature. Every payment is keyed by its settlement
  tx hash in a persistent log that survives restart. The first verify of a tx
  grants access and prints a PAID receipt. Any repeat is blocked and prints a
  VOID receipt that points at the original. Settlement results are reused by tx
  hash, never resubmitted.
- The Atlantic test USDC is a plain ERC-20 with no EIP-3009 (confirmed in STEP 0,
  see DECISION.md). So a payment is an on-chain ERC-20 transfer the buyer
  broadcasts, and the bundled facilitator confirms it idempotently on settle.
- Safety rails: dry-run mode, per-tx and per-session spend caps on the buyer,
  address and amount validation, retry with backoff, and respect for Atlantic's
  rate and pending-tx limits. The private key is read from env and redacted from
  all logs and errors.
- Claim binding: the buyer signs tollgate-claim:<txHash> with the paying key, so
  an observer cannot steal a confirmed tx hash and claim the resource first.
  Always checked when present; mandatory with TOLLGATE_REQUIRE_CLAIM_SIGNATURE.

## Tools

Merchant (seller) side:
- protect_endpoint: build the x402 paymentMiddleware config to gate one route by price.
- verify_payment: idempotently verify an incoming x402 payment and decide the grant. The differentiator.
- issue_access_token: mint a short-lived signed session token after a verified payment.
- verify_access_token: check a presented session token's signature and expiry without touching the chain.
- get_receipt: fetch one signed receipt and confirm its signature.
- list_receipts: list receipts with filters plus an earnings reconciliation summary.

Buyer side:
- pay_for_resource: pay a 402-gated endpoint per call and return the resource plus a receipt with the settlement tx hash.

Infra:
- facilitator_status: health of the bundled Atlantic facilitator and its account.

## Example

```
# 1. A buyer paid 0.10 USDC. Verify it once; a repeat is blocked.
verify_payment({ priceUsdc: "0.10", resource: "GET /report", payTo: "0xMerchant", paymentHeader: "<base64 X-PAYMENT>" })
# -> { grant: true, receipt: { id: "rcpt_...", status: "PAID", txHash: "0x..." } }

# 2. Mint a session so the agent does not re-verify on chain every request.
issue_access_token({ receiptId: "rcpt_..." })
# -> { token: "<jwt>", expiresAt: "..." }
```
