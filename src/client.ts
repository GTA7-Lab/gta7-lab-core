import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { packageRoot } from "./registry.js";
import type { Entity } from "./types.js";

/**
 * Pool de clientes MCP. O Core é servidor MCP para o ChatGPT/Claude e cliente
 * dos servidores MCP das entidades. Cada entidade é conectada sob demanda e
 * reaproveitada enquanto a configuração dela não mudar.
 */

const CALL_TIMEOUT_MS = Number(process.env.GTA7_TOOL_TIMEOUT_MS ?? 15000);

interface Pooled {
  client: Client;
  fingerprint: string;
}

const pool = new Map<string, Pooled>();

function fingerprint(e: Entity): string {
  return JSON.stringify([e.transport, e.endpoint, e.command, e.args]);
}

async function connect(entity: Entity): Promise<Client> {
  const fp = fingerprint(entity);
  const existing = pool.get(entity.id);
  if (existing && existing.fingerprint === fp) return existing.client;
  if (existing) {
    pool.delete(entity.id);
    void existing.client.close().catch(() => {});
  }

  const client = new Client({ name: "gta7-lab-city-core", version: "0.1.0" });
  const transport =
    entity.transport === "stdio"
      ? new StdioClientTransport({
          command: entity.command!,
          args: entity.args,
          cwd: packageRoot()
        })
      : new StreamableHTTPClientTransport(new URL(entity.endpoint!));

  await client.connect(transport);
  pool.set(entity.id, { client, fingerprint: fp });
  return client;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Lista as tools que a entidade realmente expõe (fonte de verdade ao vivo). */
export async function listEntityTools(entity: Entity): Promise<ToolInfo[]> {
  const client = await connect(entity);
  const res = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS });
  return res.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export interface RawCallResult {
  isError: boolean;
  structuredContent?: unknown;
  text: string;
}

export async function callEntityTool(
  entity: Entity,
  tool: string,
  args: Record<string, unknown>
): Promise<RawCallResult> {
  const client = await connect(entity);
  const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
  const content = Array.isArray(res.content) ? res.content : [];
  const text = content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => String(c.text ?? ""))
    .join("\n");
  return { isError: res.isError === true, structuredContent: (res as any).structuredContent, text };
}

/** Extrai uma lista de itens do resultado, aceitando os formatos mais comuns. */
export function extractItems(result: RawCallResult): { items: Record<string, unknown>[]; raw: unknown } {
  let payload: unknown = result.structuredContent;
  if (payload === undefined && result.text) {
    try {
      payload = JSON.parse(result.text);
    } catch {
      payload = undefined;
    }
  }
  if (payload === undefined) return { items: [], raw: result.text };

  const pick = (v: unknown): Record<string, unknown>[] => {
    if (Array.isArray(v)) return v.filter(x => x && typeof x === "object") as Record<string, unknown>[];
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      for (const key of ["items", "results", "data", "list"]) {
        if (Array.isArray(obj[key])) return pick(obj[key]);
      }

      // Cada entidade batiza a própria coleção: `shows`, `products`, `flavors`.
      // Em vez de manter uma lista de nomes que nunca acaba, procuramos a maior
      // lista de objetos que houver dentro.
      const arrays = Object.values(obj).filter(Array.isArray);
      if (arrays.length > 0) {
        // Ter uma lista dentro, ainda que vazia, já diz que isto é um envelope
        // de resultados. Busca sem resultado é zero itens — devolver o envelope
        // faria "nenhum show hoje" virar um item chamado "Rock Live House".
        const listas = arrays.map(pick).filter(l => l.length > 0);
        return listas.length > 0 ? listas.sort((a, b) => b.length - a.length)[0] : [];
      }

      return [obj];
    }
    return [];
  };

  return { items: pick(payload), raw: payload };
}

export async function closeAll(): Promise<void> {
  await Promise.allSettled([...pool.values()].map(p => p.client.close()));
  pool.clear();
}
