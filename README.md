# Tollgate (x402-merchant)

**Tollgate closes four gaps in Pharos's x402 spec that the docs acknowledge but
leave for developers to solve.** The official example gets you a demo; the gaps
are what stand between that demo and a service you can actually charge for.

| # | Pharos documents the gap | Tollgate's answer |
| --- | --- | --- |
| 1 | **No hosted facilitator.** [Pharos](https://docs.pharos.xyz/developer-guide/x402#development-recommendations) warns it "could become a single point of failure." | A bundled facilitator for both networks, with retry and a `facilitator_status` probe. |
| 2 | **Idempotency, on you.** [Pharos](https://docs.pharos.xyz/developer-guide/x402#development-recommendations): "the same on-chain transaction is not billed multiple times." | A restart-surviving dedupe keyed by tx hash. Never bills or grants twice. |
| 3 | **Sessions, on you.** [Pharos](https://docs.pharos.xyz/developer-guide/x402#development-recommendations) recommends "a short-term valid JSON Web Token (JWT)." | `issue_access_token` mints a signed session bound to the receipt. |
| 4 | **Network confusion.** [Pharos](https://docs.pharos.xyz/developer-guide/x402#skill) flags a test USDC "which is not an official address." | Pins the chain, RPC, and token, and verifies the token in STEP 0 below. |

Underneath the four answers, Tollgate is a two-sided TypeScript MCP server: an
agent can sell a service (take payment, issue a session, keep verifiable
receipts, reconcile earnings) and an agent can buy one (pay per call within a
budget). Default transport is stdio; HTTP is optional. It runs on both Pharos
networks: Atlantic testnet (688689) by default, or Pacific mainnet (1672) via
`TOLLGATE_NETWORK=mainnet`.

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

## Use it in one line

Tollgate is an MCP server. Point any MCP client at it with `npx`, no clone, no
build. It is zero-config by default: the signing secret is generated and
persisted on first run, so the merchant tools work immediately. A private key is
only needed to pay (buyer side) or to settle on-chain.

```jsonc
{
  "mcpServers": {
    "tollgate": {
      "command": "npx",
      "args": ["-y", "x402-merchant"],
      "env": {
        "TOLLGATE_NETWORK": "atlantic"
      }
    }
  }
}
```

That JSON drops straight into a Claude Desktop or any MCP client config. Add
`TOLLGATE_PRIVATE_KEY` when the agent needs to pay or settle. A `smithery.yaml`
is included for one-click discovery in MCP registries.

## Install as a Claude Code plugin

This repo is also a Claude Code plugin marketplace. Inside Claude Code, two lines
add the marketplace and install Tollgate, which registers the MCP server and the
skill in one step:

```
/plugin marketplace add Eienel/tollgate
/plugin install tollgate@tollgate
```

The bundled `.mcp.json` points at `x402-merchant` on npm, so the eight tools come
online with no extra config. The `SKILL.md` tells the agent when to reach for
them. To try it before installing, clone the repo and run
`claude --plugin-dir .`.

## Install from source

Requires Node 20 or newer.

```
npm install
cp .env.example .env        # optional: set a key for paying, pick a network
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

## Build on Tollgate

Tollgate is meant to be reused, not just run. Any builder can gate an endpoint
on Pharos with three calls and never write payment infrastructure:

```
# 1. Get a ready-to-use middleware config for your route and price.
protect_endpoint({ route: "GET /report", priceUsdc: "0.10", payTo: "0xYourMerchant" })

# 2. On each incoming request, verify the payment. Idempotent: a tx can never pay twice.
verify_payment({ priceUsdc: "0.10", resource: "GET /report", payTo: "0xYourMerchant", paymentHeader })
# -> { grant: true, receipt: { id, status: "PAID", txHash } }

# 3. Hand the buyer a session so they do not re-verify on-chain every request.
issue_access_token({ receiptId: "rcpt_..." })
```

The buyer side is just as small: `pay_for_resource({ url })` pays a 402-gated
endpoint within your spend caps and returns the resource plus a receipt. Two
agents, one skill, every paid call.

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
