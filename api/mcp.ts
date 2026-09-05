/**
 * Entrypoint HTTP (Vercel): expõe o Core como servidor MCP em /mcp usando o
 * transporte Streamable HTTP em modo stateless — um servidor por requisição,
 * que é o que combina com funções serverless.
 *
 * Atenção: o filesystem da Vercel é somente-leitura, então as tools de escrita
 * do registro (register/update/remove) valem apenas durante a requisição.
 * Para mudar o registro em produção, edite data/entities.json e faça deploy.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCoreServer } from "../src/server.js";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: "gta7-lab-city", transport: "streamable-http", method: "POST" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json", allow: "GET, POST" });
    res.end(JSON.stringify({ error: "método não suportado" }));
    return;
  }

  const server = createCoreServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req as never, res as never, (req as { body?: unknown }).body);
  } catch (err) {
    console.error("[api/mcp]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }
}
