#!/usr/bin/env node
/** Entrypoint local: expõe o Core como servidor MCP via stdio (Claude Desktop, Claude Code, etc.). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeAll } from "./client.js";
import { createCoreServer } from "./server.js";

const server = createCoreServer();
await server.connect(new StdioServerTransport());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await closeAll();
    await server.close();
    process.exit(0);
  });
}
