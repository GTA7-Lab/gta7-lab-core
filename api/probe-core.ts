// SONDA TEMPORARIA - remover depois do diagnostico
import type { IncomingMessage, ServerResponse } from "node:http";
import { dataFilePath, listEntities } from "../src/registry.js";

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, probe: "core", dataFile: dataFilePath(), entidades: listEntities().map(e => e.id) }));
}
