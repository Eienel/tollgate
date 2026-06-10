// tools/merchant.ts
// Seller-side MCP tools: protect_endpoint, verify_payment (the idempotent
// differentiator), issue_access_token, get_receipt, list_receipts.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseUnits, type Address } from "viem";
import {
  NETWORK,
  USDC_ADDRESS,
  publicClient,
  erc20Abi,
  assertAddress,
  assertPositiveAmount,
} from "../chain.js";
import { TOLLGATE_SCHEME, type PaymentPayload } from "../facilitator.js";
import { processPayment } from "../grant.js";
import { issueAccessToken, verifyAccessToken } from "../jwt.js";
import type { Runtime } from "../runtime.js";

// Cache token decimals so amount math does not hit the RPC every call.
const decimalsCache = new Map<string, number>();
async function tokenDecimals(asset: Address): Promise<number> {
  const key = asset.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  const d = (await publicClient().readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  })) as number;
  decimalsCache.set(key, d);
  return d;
}

function ok(data: unknown) {
  const text = JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

// Decode an x402 payment, either from a base64 X-PAYMENT header or a plain object.
function decodePayment(input: {
  paymentHeader?: string;
  payment?: Record<string, unknown>;
}): PaymentPayload {
  if (input.payment) return input.payment as unknown as PaymentPayload;
  if (input.paymentHeader) {
    const json = Buffer.from(input.paymentHeader, "base64").toString("utf8");
    return JSON.parse(json) as PaymentPayload;
  }
  throw new Error("Provide either paymentHeader (base64) or payment (object).");
}

export function registerMerchantTools(server: McpServer, rt: Runtime): void {
  // -------------------------------------------------------------------------
  // protect_endpoint: build a ready-to-use @x402/express paymentMiddleware
  // config for one route. Pure config, no side effects.
  // -------------------------------------------------------------------------
  server.registerTool(
    "protect_endpoint",
    {
      title: "Protect an endpoint with x402",
      description:
        "Build the x402 paymentMiddleware config to gate one route on Pharos Atlantic. Give a route path and a price in USDC; get back a config object ready to drop into an Express server.",
      inputSchema: {
        route: z.string().describe("Route to protect, for example GET /report"),
        priceUsdc: z.string().describe("Price in whole USDC, for example 0.10"),
        payTo: z.string().optional().describe("Recipient address. Defaults to TOLLGATE_PAY_TO."),
        asset: z.string().optional().describe("Token address. Defaults to the Atlantic test USDC."),
        description: z.string().optional(),
      },
    },
    async (args) => {
      const asset = assertAddress(args.asset ?? USDC_ADDRESS);
      const decimals = await tokenDecimals(asset);
      const atomic = assertPositiveAmount(parseUnits(args.priceUsdc, decimals));
      const payTo = assertAddress(
        args.payTo ?? process.env.TOLLGATE_PAY_TO ?? "",
      );
      const config = {
        facilitator: { kind: "bundled", network: NETWORK, note: "Tollgate runs the facilitator; no hosted Pharos facilitator exists." },
        routes: {
          [args.route]: {
            price: { amount: atomic.toString(), asset, decimals, displayUsdc: args.priceUsdc },
            network: NETWORK,
            payTo,
            scheme: TOLLGATE_SCHEME,
            config: {
              description: args.description ?? `Paid access to ${args.route}`,
              mimeType: "application/json",
              maxTimeoutSeconds: 120,
            },
          },
        },
      };
      return ok({
        ready: true,
        usage:
          "Pass routes into x402-express paymentMiddleware, and verify incoming payments with verify_payment for restart-safe idempotency.",
        config,
      });
    },
  );

  // -------------------------------------------------------------------------
  // verify_payment: idempotent, restart-safe verification. The same tx hash can
  // never grant access twice. A fresh valid payment yields a PAID receipt; a
  // repeat yields a VOID receipt and a denied grant. This is the differentiator.
  // -------------------------------------------------------------------------
  server.registerTool(
    "verify_payment",
    {
      title: "Verify an x402 payment (idempotent)",
      description:
        "Verify an incoming x402 payment on Pharos Atlantic and decide whether to grant access. Deduplicated by settlement tx hash against a persistent store, so a payment can never be billed or granted twice. Returns a grant decision and a signed receipt.",
      inputSchema: {
        priceUsdc: z.string().describe("Required price in whole USDC."),
        resource: z.string().describe("The protected resource, for example GET /report."),
        payTo: z.string().optional().describe("Expected recipient. Defaults to TOLLGATE_PAY_TO."),
        asset: z.string().optional().describe("Expected token. Defaults to Atlantic test USDC."),
        paymentHeader: z.string().optional().describe("Base64 X-PAYMENT header from the buyer."),
        payment: z.record(z.any()).optional().describe("Decoded payment payload object."),
      },
    },
    async (args) => {
      const asset = assertAddress(args.asset ?? USDC_ADDRESS);
      const decimals = await tokenDecimals(asset);
      const amount = assertPositiveAmount(parseUnits(args.priceUsdc, decimals)).toString();
      const payTo = assertAddress(args.payTo ?? process.env.TOLLGATE_PAY_TO ?? "");

      const payload = decodePayment(args);
      const result = await processPayment(rt, {
        payload,
        asset,
        amount,
        payTo,
        resource: args.resource,
        decimals,
      });
      if (result.grant) {
        return ok({
          ...result,
          hint: "Call issue_access_token with this receipt id to mint a session credential.",
        });
      }
      return ok(result);
    },
  );

  // -------------------------------------------------------------------------
  // issue_access_token: mint a short-lived session JWT after a verified payment.
  // -------------------------------------------------------------------------
  server.registerTool(
    "issue_access_token",
    {
      title: "Issue a session token for a paid receipt",
      description:
        "After a successful verify_payment, mint a short-lived signed session token so the agent does not re-verify on-chain on every request. The token references the receipt and payment.",
      inputSchema: {
        receiptId: z.string().optional().describe("Receipt id from verify_payment."),
        txHash: z.string().optional().describe("Settlement tx hash, if the receipt id is unknown."),
        ttlSeconds: z.number().optional().describe("Token lifetime. Defaults to TOLLGATE_TOKEN_TTL_SECONDS."),
      },
    },
    async (args) => {
      const receipt = args.receiptId
        ? rt.receipts.get(args.receiptId)
        : args.txHash
          ? rt.receipts.byTxHash(args.txHash)
          : undefined;
      if (!receipt) throw new Error("No PAID receipt found for the given receiptId or txHash.");
      if (receipt.status !== "PAID") throw new Error("Cannot issue a token for a VOID receipt.");
      const issued = issueAccessToken({
        payer: receipt.payer,
        txHash: receipt.txHash,
        receiptId: receipt.id,
        resource: receipt.resource,
        ttlSeconds: args.ttlSeconds ?? rt.settings.tokenTtlSeconds,
      });
      return ok(issued);
    },
  );

  // -------------------------------------------------------------------------
  // verify_access_token: the other half of sessions. Check a presented token's
  // signature and expiry without touching the chain.
  // -------------------------------------------------------------------------
  server.registerTool(
    "verify_access_token",
    {
      title: "Verify a session token",
      description:
        "Check a session token issued by issue_access_token: signature, structure, and expiry. No on-chain calls. Returns the claims (payer, receipt id, tx hash, resource) when valid.",
      inputSchema: {
        token: z.string().describe("The session token to verify."),
      },
    },
    async (args) => {
      const result = verifyAccessToken(args.token);
      if (result.valid && result.claims?.receiptId) {
        const receipt = rt.receipts.get(result.claims.receiptId);
        return ok({ ...result, receiptStatus: receipt?.status ?? "unknown" });
      }
      return ok(result);
    },
  );

  // -------------------------------------------------------------------------
  // get_receipt: fetch one signed receipt and confirm its signature.
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_receipt",
    {
      title: "Get a receipt",
      description: "Fetch a single signed receipt by id and confirm its signature is intact.",
      inputSchema: { id: z.string().describe("Receipt id, for example rcpt_...") },
    },
    async (args) => {
      const receipt = rt.receipts.get(args.id);
      if (!receipt) throw new Error(`No receipt with id ${args.id}.`);
      const { verifyReceipt } = await import("../receipts.js");
      return ok({ receipt, signatureValid: verifyReceipt(receipt) });
    },
  );

  // -------------------------------------------------------------------------
  // list_receipts: list receipts with filters, plus an earnings reconciliation.
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_receipts",
    {
      title: "List receipts and reconcile earnings",
      description:
        "List receipts newest first with optional filters, and return an earnings reconciliation summary: total received, per-endpoint, and per-payer. Voided duplicates never count toward totals.",
      inputSchema: {
        status: z.enum(["PAID", "VOID"]).optional(),
        payer: z.string().optional(),
        resource: z.string().optional(),
        limit: z.number().optional().describe("Max rows to return. Default 50."),
      },
    },
    async (args) => {
      const receipts = rt.receipts.list({
        status: args.status,
        payer: args.payer,
        resource: args.resource,
        limit: args.limit ?? 50,
      });
      const reconciliation = rt.receipts.reconcile();
      return ok({ count: receipts.length, receipts, reconciliation });
    },
  );
}
