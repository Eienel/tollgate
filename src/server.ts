// server.ts
// The MCP server. Registers the merchant tools, the buyer tool, and the
// facilitator_status infra tool. Default transport is stdio; an optional HTTP
// transport is available for remote agents and the demo.

import { z } from "zod";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getRuntime } from "./runtime.js";
import { registerMerchantTools } from "./tools/merchant.js";
import { registerBuyerTools } from "./tools/buyer.js";
import { facilitatorStatus } from "./facilitator.js";

export function buildServer(): McpServer {
  const rt = getRuntime();
  const server = new McpServer(
    { name: "x402-merchant", version: "0.1.0" },
    {
      instructions:
        "Tollgate turns an agent into a reliable paid merchant on Pharos Atlantic using x402, and lets an agent pay for 402-gated resources. Verification is idempotent and restart-safe, so a payment can never grant or bill twice.",
    },
  );

  registerMerchantTools(server, rt);
  registerBuyerTools(server, rt);

  // facilitator_status: health of the bundled facilitator and its account.
  server.registerTool(
    "facilitator_status",
    {
      title: "Facilitator health",
      description:
        "Report the health of the bundled Atlantic facilitator: RPC reachability, chain id, rate-limit budget, and the signing account balance and pending tx count.",
      inputSchema: {},
    },
    async () => {
      const status = await facilitatorStatus(rt.settings.dryRun);
      return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
    },
  );

  return server;
}

export async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stdio servers must not write to stdout; log to stderr only.
  process.stderr.write("x402-merchant MCP server running on stdio\n");
}

export async function startHttp(port: number): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Stateless Streamable HTTP: a fresh server and transport per request keeps
  // the surface simple and avoids cross-request session state.
  app.post("/mcp", async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
      }
    }
  });

  app.get("/healthz", async (_req, res) => {
    const status = await facilitatorStatus(getRuntime().settings.dryRun);
    res.json(status);
  });

  app.listen(port, () => {
    process.stderr.write(`x402-merchant MCP server running on http://localhost:${port}/mcp\n`);
  });
}
