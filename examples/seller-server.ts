// examples/seller-server.ts
// A demo paid endpoint built on Tollgate. GET /report returns HTTP 402 with
// payment requirements. When the buyer retries with an X-PAYMENT header, the
// server verifies the payment idempotently, records a receipt, and returns the
// report. Pay twice with the same tx and the second is blocked with a VOID.
//
// Run: TOLLGATE_PAY_TO=0xYourAddress npm run seller

import express from "express";
import { parseUnits, formatUnits } from "viem";
import {
  NETWORK,
  USDC_ADDRESS,
  EXPLORER_URL,
  assertAddress,
} from "../src/chain.js";
import { TOLLGATE_SCHEME, type PaymentPayload } from "../src/facilitator.js";
import { processPayment } from "../src/grant.js";
import { issueAccessToken } from "../src/jwt.js";
import { getRuntime } from "../src/runtime.js";

const PORT = Number(process.env.SELLER_PORT ?? "4021");
const PRICE_USDC = process.env.SELLER_PRICE_USDC ?? "0.10";
const DECIMALS = 6;
const RESOURCE = "GET /report";

const rt = getRuntime();
const payTo = assertAddress(process.env.TOLLGATE_PAY_TO ?? "");
const amountAtomic = parseUnits(PRICE_USDC, DECIMALS).toString();

const requirements = {
  x402Version: 1,
  accepts: [
    {
      scheme: TOLLGATE_SCHEME,
      network: NETWORK,
      asset: USDC_ADDRESS,
      amount: amountAtomic,
      decimals: DECIMALS,
      payTo,
      resource: RESOURCE,
      description: "Quarterly demand report",
      mimeType: "application/json",
      maxTimeoutSeconds: 120,
    },
  ],
};

const app = express();
app.use(express.json());

app.get("/report", async (req, res) => {
  const header = req.header("X-PAYMENT");
  if (!header) {
    res.status(402).json(requirements);
    return;
  }

  let payload: PaymentPayload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    res.status(400).json({ error: "malformed X-PAYMENT header" });
    return;
  }

  const result = await processPayment(rt, {
    payload,
    asset: USDC_ADDRESS,
    amount: amountAtomic,
    payTo,
    resource: RESOURCE,
    decimals: DECIMALS,
  });

  if (!result.grant) {
    res.status(409).json({
      error: "payment not accepted",
      reason: result.reason,
      duplicateOf: result.duplicateOf,
    });
    return;
  }

  const session = issueAccessToken({
    payer: result.receipt!.payer,
    txHash: result.receipt!.txHash,
    receiptId: result.receipt!.id,
    resource: RESOURCE,
  });

  res.json({
    report: {
      title: "Quarterly demand report",
      generatedAt: new Date().toISOString(),
      rows: [
        { region: "north", demand: 1240 },
        { region: "south", demand: 980 },
      ],
    },
    receiptId: result.receipt!.id,
    settlement: result.settlement,
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
  });
});

app.listen(PORT, () => {
  console.log(`seller listening on http://localhost:${PORT}/report`);
  console.log(`price ${PRICE_USDC} USDC, payTo ${payTo}`);
  console.log(`asset ${USDC_ADDRESS} on ${NETWORK}`);
  console.log(`explorer ${EXPLORER_URL}`);
  console.log(`session amount per call: ${formatUnits(BigInt(amountAtomic), DECIMALS)} USDC`);
});
