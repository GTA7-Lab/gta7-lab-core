import { callEntityTool, extractItems } from "../client.js";
import { paramFor, toolsOf } from "../discovery.js";
import { getEntity } from "../registry.js";
import type { BaseAgent } from "./base-agent.js";

/**
 * A ponte entre um agente e as entidades da cidade.
 *
 * Fica aqui, e não dentro do `BaseAgent`, porque é a única parte que conhece o
 * Core (registro e cliente MCP). O agente continua sem saber que banco ou
 * sorveteria existem — ele passa um id e um nome de tool.
 *
 * O RequestContext só é enviado quando a entidade **pede** por ele, declarando
 * `"context"` no `argsMap` da tool:
 *
 *     { "name": "place_order", "argsMap": { "context": "requester" } }
 *
 * Isso reaproveita o contrato que o Core já tem para traduzir argumentos, e
 * evita empurrar um campo extra para entidades com schema estrito, que
 * recusariam a chamada inteira.
 */

export interface AgentCallResult {
  ok: boolean;
  items: Record<string, unknown>[];
  text: string;
  error?: string;
}

export async function executeForAgent(
  agent: BaseAgent,
  entityId: string,
  toolName: string,
  input: Record<string, unknown> = {}
): Promise<AgentCallResult> {
  const entity = getEntity(entityId);
  if (!entity) {
    const error = `não há nenhum lugar chamado '${entityId}' na cidade`;
    agent.memory.remember("chamada", `tentou usar ${entityId} e não encontrou`, { entityId, toolName });
    return { ok: false, items: [], text: "", error };
  }

  const info = (await toolsOf(entity)).find(t => t.name === toolName);
  const contextParam = info ? paramFor(info, "context") : undefined;
  const args = contextParam ? { ...input, [contextParam]: agent.createRequestContext() } : { ...input };

  try {
    const result = await callEntityTool(entity, toolName, args);
    const { items } = extractItems(result);
    agent.memory.remember(
      "chamada",
      `usou ${toolName} em ${entity.name}${result.isError ? " e deu erro" : ""}`,
      { entityId, toolName, itens: items.length }
    );
    return { ok: !result.isError, items, text: result.text, error: result.isError ? result.text : undefined };
  } catch (err) {
    const error = (err as Error).message;
    agent.memory.remember("chamada", `não conseguiu falar com ${entity.name}`, { entityId, toolName, error });
    return { ok: false, items: [], text: "", error };
  }
}
