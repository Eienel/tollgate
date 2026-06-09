#!/usr/bin/env node
// index.ts
// Entrypoint. Chooses transport from TOLLGATE_TRANSPORT (stdio default, or http).

import { startStdio, startHttp } from "./server.js";

async function main(): Promise<void> {
  const transport = (process.env.TOLLGATE_TRANSPORT ?? "stdio").toLowerCase();
  if (transport === "http") {
    const port = Number(process.env.TOLLGATE_HTTP_PORT ?? "8402");
    await startHttp(port);
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
