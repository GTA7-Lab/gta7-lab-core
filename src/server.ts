import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCoreServer } from "./mcp-server.js";

/**
 * Entrypoint HTTP do Core. A Vercel usa este arquivo como servidor do projeto
 * (convenção `src/server.ts` com `export default`), então ele responde a todas
 * as rotas: `/mcp` fala MCP por Streamable HTTP, `/` é uma landing.
 *
 * O transporte é stateless — um servidor MCP por requisição — que é o que
 * combina com execução serverless.
 */

const LANDING = `<!doctype html>
<meta charset="utf-8">
<title>GTA7 Lab — Core Orchestrator</title>
<style>
  body { font: 15px/1.65 system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; color: #1c1c1c; }
  code { background: #f2f2f2; padding: .15em .4em; border-radius: 3px; }
  a { color: #0b5fff; }
</style>
<h1>GTA7 Lab — Core Orchestrator</h1>
<p>A cidade da GTA7 Lab como servidor MCP: ele conhece as entidades registradas,
chama as MCP tools delas e combina os resultados numa resposta só.</p>
<p>Endpoint MCP (Streamable HTTP): <code>POST /mcp</code></p>
<p>Código: <a href="https://github.com/GTA7-Lab/gta7-lab-city">GTA7-Lab/gta7-lab-city</a> ·
Entidades: <a href="https://github.com/GTA7-Lab/gta7-lab">GTA7-Lab/gta7-lab</a></p>
`;

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

/** A Vercel pré-parseia o body nas funções de `api/`, mas aqui o servidor é nosso. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const existing = (req as { body?: unknown }).body;
  if (existing !== undefined) return existing;

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createCoreServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req as never, res as never, await readJsonBody(req));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";

  try {
    if (path === "/mcp" || path === "/api/mcp") {
      if (req.method === "GET") {
        send(res, 200, "application/json", JSON.stringify({ name: "gta7-lab-city", transport: "streamable-http", method: "POST" }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json", allow: "GET, POST" });
        res.end(JSON.stringify({ error: "método não suportado" }));
        return;
      }
      await handleMcp(req, res);
      return;
    }

    if (path === "/") {
      send(res, 200, "text/html; charset=utf-8", LANDING);
      return;
    }

    send(res, 404, "application/json", JSON.stringify({ error: "não encontrado", tente: "/mcp" }));
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) send(res, 500, "application/json", JSON.stringify({ error: (err as Error).message }));
  }
}
