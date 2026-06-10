# Tollgate (x402-merchant)

Tollgate turns any AI agent into a reliable paid merchant on Pharos, and lets an
agent pay for resources, using x402. Agents are becoming on-chain economic actors.
An agent that sells a service needs to take payment without ever billing the same
transaction twice, hand out a session credential, keep verifiable receipts, and
reconcile what it earned. An agent that buys a service needs to pay per call within
a budget. Tollgate is the production layer that makes both sides dependable on
Pharos Atlantic, and it ships the facilitator Pharos does not host for you.

This is a TypeScript MCP server. Default transport is stdio; an HTTP transport is
optional. The headline feature is idempotency: a payment can never grant access or
be billed twice, and that guarantee survives a restart. It runs on both Pharos
networks: Atlantic testnet (688689) by default, or Pacific mainnet (1672) by
setting `TOLLGATE_NETWORK=mainnet`.

## Why this exists

The official Pharos x402 example gets you a demo. Shipping a real paid service runs
into a cluster of gaps that Pharos documents but does not solve for you. Tollgate
closes the four of them:

1. No hosted facilitator for Pharos. You must run your own verify and settle
   service, and the docs warn it is a single point of failure needing retry and
   health checks. Tollgate bundles a preconfigured facilitator for Atlantic with
   retry, idempotent settle, and a `facilitator_status` health probe.
2. Idempotency is left to the developer. The docs state the server must ensure the
   same on-chain tx is not billed or granted twice. Tollgate makes this first
   class: a persistent, restart-surviving dedupe store keyed by tx hash.
3. Post-payment sessions are left to the developer. The docs recommend a
   short-lived token after payment to avoid re-verifying on-chain every request.
   Tollgate mints a signed session token with `issue_access_token`.
4. Network and token confusion. Two testnets, internal-looking RPC, and a test
   USDC flagged as not official. Tollgate defines Atlantic (688689) once, pins the
   verified RPC and token, and confirms the token's capabilities in STEP 0.

## STEP 0: the test USDC has no EIP-3009

Before building the payment path, Tollgate confirms whether the Atlantic test USDC
supports EIP-3009 (`transferWithAuthorization`), which the gasless x402 exact scheme
needs. It does not. The token at `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` is a
plain ERC-20 (USD Coin, 6 decimals): `DOMAIN_SEPARATOR()` reverts and neither
`transferWithAuthorization` nor `permit` is present in its bytecode.

So Tollgate's payment path is an on-chain ERC-20 transfer the buyer broadcasts, and
the bundled facilitator confirms it idempotently on settle. The moment Pharos ships
an EIP-3009 token, swap to the gasless exact scheme by changing the settle mechanism;
the reliability layer above it does not change. Reproduce the finding with:

```
npm run step0
```

## Install and run

Requires Node 20 or newer.

```
npm install
cp .env.example .env        # set TOLLGATE_SIGNING_SECRET, and a key for paying
npm run build
```

Run as an MCP server over stdio (the default):

```
npm start
```

Run over HTTP instead:

```
TOLLGATE_TRANSPORT=http TOLLGATE_HTTP_PORT=8402 npm start
# POST JSON-RPC to http://localhost:8402/mcp, health at /healthz
```

## Demo: seller, buyer, and the live ledger

```
# Terminal 1: the demo dashboard (the live receipts ledger)
npm run dashboard           # http://localhost:8088

# Terminal 2: a paid endpoint built on the skill
TOLLGATE_PAY_TO=0xYourMerchantAddress npm run seller

# Terminal 3: a buyer agent that pays per call, then replays to show a block
TOLLGATE_PRIVATE_KEY=0xYourFundedKey npm run buyer -- --replay
```

The first claim clears and a PAID stamp presses onto a ticket. The replay sends the
same payment and the seller blocks it with a VOID stamp. The reconciliation totals
update, counting the cleared payment once. With no funded wallet, click Run demo on
the dashboard to seed a PAID and a duplicate VOID and see the same story.

## Environment

| Variable | Meaning | Default |
| --- | --- | --- |
| `TOLLGATE_NETWORK` | Preset: `atlantic` (testnet) or `mainnet` (Pacific) | `atlantic` |
| `TOLLGATE_CHAIN_ID` | Override the preset chain id | preset (688689 / 1672) |
| `TOLLGATE_RPC_URL` | Override the preset RPC | preset |
| `TOLLGATE_EXPLORER_URL` | Override the preset explorer | preset |
| `TOLLGATE_USDC_ADDRESS` | Payment token. Required on mainnet (no default) | Atlantic test USDC |
| `TOLLGATE_PRIVATE_KEY` | Hex key for paying and settling. Read from env, redacted from logs | none |
| `TOLLGATE_PAY_TO` | Address that receives merchant payments | the key's address |
| `TOLLGATE_DATA_DIR` | Where the idempotency log and receipts ledger live | `./.tollgate` |
| `TOLLGATE_SIGNING_SECRET` | HMAC secret for receipts and session tokens | none, required |
| `TOLLGATE_TOKEN_TTL_SECONDS` | Session token lifetime | `900` |
| `TOLLGATE_DRY_RUN` | Simulate without broadcasting | `false` |
| `TOLLGATE_REQUIRE_CLAIM_SIGNATURE` | Require buyers to sign claims with the paying key | `false` |
| `TOLLGATE_MAX_PER_TX_USDC` | Buyer per-tx spend cap | `5` |
| `TOLLGATE_MAX_PER_SESSION_USDC` | Buyer per-session spend cap | `25` |
| `TOLLGATE_TRANSPORT` | `stdio` or `http` | `stdio` |
| `TOLLGATE_HTTP_PORT` | HTTP MCP port | `8402` |
| `TOLLGATE_DASHBOARD_PORT` | Dashboard port | `8088` |

Get testnet PHRS for gas from testnet.pharosnetwork.xyz, Stakely, Chainlink, or ZAN.

## Tools

| Tool | Side | What it does |
| --- | --- | --- |
| `protect_endpoint` | seller | Build the x402 paymentMiddleware config to gate one route by price. |
| `verify_payment` | seller | Idempotently verify an incoming payment and decide the grant. Never bills twice. |
| `issue_access_token` | seller | Mint a short-lived signed session token after a verified payment. |
| `verify_access_token` | seller | Check a presented session token: signature, expiry, claims. No on-chain calls. |
| `get_receipt` | seller | Fetch one signed receipt and confirm its signature. |
| `list_receipts` | seller | List receipts with filters plus an earnings reconciliation summary. |
| `pay_for_resource` | buyer | Pay a 402-gated endpoint per call and return the resource plus a receipt. |
| `facilitator_status` | infra | Health of the bundled Atlantic facilitator and its account. |

## Claim binding

A settlement tx hash is public the moment it confirms, so a bare tx hash is a
bearer instrument: whoever presents it first would win the grant. Tollgate
closes this with claim signatures. The buyer signs `tollgate-claim:<txHash>`
with the paying key and sends the signature inside the payment payload; the
facilitator only grants when the signature recovers the on-chain payer.
`pay_for_resource` signs automatically. Signatures are always verified when
present, and a merchant can make them mandatory with
`TOLLGATE_REQUIRE_CLAIM_SIGNATURE=true`.

## Tests

```
npm test
```

The suite covers the idempotency guarantee (reserve once, reuse on retry, survive
restart, no cross-tx collisions), receipt signing and tamper detection,
reconciliation excluding voids, and one live Atlantic smoke test that confirms the
chain id and the token. On-chain tests skip cleanly when the RPC is unreachable; a
live settlement test runs only when a funded key is present.

## Phase 2 Agent: a paid data merchant

Tollgate is the foundation for an Agent Arena entrant: a paid data merchant agent.
It exposes a `protect_endpoint`-gated resource (for example a fresh on-chain metric
or a model inference), takes payment through `verify_payment` with idempotency so it
is never double-billed under load, hands buyers a session token, and watches its own
earnings through `list_receipts`. Because the skill is two-sided, the same agent can
turn around and pay other merchants with `pay_for_resource` within a budget, so it
both earns and spends. In a usage-weighted campaign every paid interaction pulls two
agents through the skill, the buyer and the seller.

## License

Apache-2.0.
