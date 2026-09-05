import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callEntityTool, extractItems, listEntityTools } from "./client.js";
import { LEXICON } from "./lexicon.js";
import { dataFilePath, getEntity, listEntities, registerEntity, removeEntity, updateEntity } from "./registry.js";
import { buildPlan, orchestrate } from "./orchestrator.js";

function json(payload: unknown, isError = false) {
  return {
    isError,
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
  };
}

function fail(err: unknown) {
  return json({ error: err instanceof Error ? err.message : String(err) }, true);
}

const entityToolShape = z.object({
  name: z.string().describe("nome da tool no servidor MCP da entidade"),
  kind: z
    .enum(["search", "detail", "other"])
    .optional()
    .describe("'search' habilita a tool para a orquestração automática"),
  argsMap: z
    .record(z.string())
    .optional()
    .describe("slot canônico -> parâmetro da tool. Ex.: { \"people\": \"partySize\" }")
});

const entityShape = {
  id: z.string().describe("identificador único, minúsculo (ex.: 'restaurants')"),
  name: z.string(),
  description: z.string().optional(),
  transport: z.enum(["http", "stdio"]).optional().describe("padrão: http"),
  endpoint: z.string().optional().describe("URL do MCP da entidade (transport http)"),
  command: z.string().optional().describe("executável (transport stdio)"),
  args: z.array(z.string()).optional(),
  tags: z
    .array(z.string())
    .optional()
    .describe(`capacidades da entidade; use as tags conhecidas: ${Object.keys(LEXICON).join(", ")}`),
  tools: z.array(entityToolShape).optional(),
  enabled: z.boolean().optional()
};

export function createCoreServer(): McpServer {
  const server = new McpServer(
    { name: "gta7-lab-city", version: "0.1.0" },
    {
      instructions:
        "Core Orchestrator da GTA7 Lab. Use 'orchestrate' para pedidos em linguagem natural " +
        "(ele escolhe as entidades, chama as MCP tools delas e combina os resultados), " +
        "'plan_request' para ver o plano sem executar, e as tools de registro para gerenciar entidades."
    }
  );

  // ------------------------------------------------------------- registro

  server.registerTool(
    "list_entities",
    {
      title: "Listar entidades",
      description: "Lista as entidades registradas na cidade.",
      inputSchema: { enabledOnly: z.boolean().optional().describe("padrão: false") }
    },
    async ({ enabledOnly }) =>
      json({ dataFile: dataFilePath(), entities: listEntities({ enabledOnly: enabledOnly ?? false }) })
  );

  server.registerTool(
    "get_entity",
    {
      title: "Obter entidade",
      description: "Devolve o registro completo de uma entidade.",
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      const entity = getEntity(id);
      return entity ? json(entity) : fail(`entidade '${id}' não encontrada`);
    }
  );

  server.registerTool(
    "register_entity",
    {
      title: "Registrar entidade",
      description:
        "Adiciona uma entidade à cidade. As 'tags' definem quando o orquestrador aciona a entidade; " +
        "as tools com kind 'search' são as que ele pode chamar sozinho.",
      inputSchema: entityShape
    },
    async input => {
      try {
        const { entity, warning } = registerEntity(input);
        return json({ registered: entity, warning });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "update_entity",
    {
      title: "Atualizar entidade",
      description: "Atualiza campos de uma entidade já registrada (merge raso).",
      inputSchema: {
        id: z.string(),
        patch: z.record(z.unknown()).describe("campos a sobrescrever; 'id' é ignorado")
      }
    },
    async ({ id, patch }) => {
      try {
        const { entity, warning } = updateEntity(id, patch as Record<string, unknown>);
        return json({ updated: entity, warning });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "remove_entity",
    {
      title: "Remover entidade",
      description: "Remove uma entidade do registro.",
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      try {
        const { removed, warning } = removeEntity(id);
        return json({ removed, warning });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ---------------------------------------------------------- descoberta

  server.registerTool(
    "list_city_tools",
    {
      title: "Listar tools da cidade",
      description:
        "Conecta nos servidores MCP das entidades e devolve as tools que elas realmente expõem agora. " +
        "Útil para conferir se o registro está de acordo com a realidade.",
      inputSchema: { entityId: z.string().optional().describe("omita para consultar todas as ativas") }
    },
    async ({ entityId }) => {
      const targets = entityId
        ? [getEntity(entityId)].filter(Boolean)
        : listEntities({ enabledOnly: true });
      if (targets.length === 0) return fail(entityId ? `entidade '${entityId}' não encontrada` : "nenhuma entidade ativa");

      const out = await Promise.all(
        targets.map(async entity => {
          try {
            const live = await listEntityTools(entity!);
            const declared = entity!.tools.map(t => t.name);
            return {
              entityId: entity!.id,
              ok: true,
              tools: live,
              declaredButMissing: declared.filter(d => !live.some(l => l.name === d)),
              liveButNotRegistered: live.map(l => l.name).filter(n => !declared.includes(n))
            };
          } catch (err) {
            return { entityId: entity!.id, ok: false, error: (err as Error).message, tools: [] };
          }
        })
      );
      return json(out);
    }
  );

  server.registerTool(
    "call_entity_tool",
    {
      title: "Chamar tool de uma entidade",
      description: "Proxy direto para uma MCP tool de uma entidade registrada.",
      inputSchema: {
        entityId: z.string(),
        tool: z.string(),
        arguments: z.record(z.unknown()).optional()
      }
    },
    async ({ entityId, tool, arguments: args }) => {
      const entity = getEntity(entityId);
      if (!entity) return fail(`entidade '${entityId}' não encontrada`);
      try {
        const result = await callEntityTool(entity, tool, (args as Record<string, unknown>) ?? {});
        const { items } = extractItems(result);
        return json({ entityId, tool, isError: result.isError, items, text: result.text });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // -------------------------------------------------------- orquestração

  server.registerTool(
    "plan_request",
    {
      title: "Planejar pedido",
      description:
        "Mostra, sem executar nada, o que o Core entendeu do pedido: tags detectadas, restrições " +
        "extraídas e quais tools de quais entidades seriam chamadas, com os argumentos já traduzidos.",
      inputSchema: {
        request: z.string().describe("pedido em linguagem natural"),
        limit: z.number().int().positive().optional()
      }
    },
    async ({ request, limit }) => json(buildPlan(request, { limit }))
  );

  server.registerTool(
    "orchestrate",
    {
      title: "Orquestrar pedido",
      description:
        "Recebe um pedido em linguagem natural, escolhe as entidades pelas tags, chama as MCP tools " +
        "delas em paralelo, aplica as restrições (pessoas, orçamento por pessoa) e devolve os " +
        "resultados por entidade mais combinações entre entidades.",
      inputSchema: {
        request: z.string().describe("ex.: 'Quero jantar e depois fazer alguma atividade'"),
        limit: z.number().int().positive().optional().describe("itens por entidade; padrão 5")
      }
    },
    async ({ request, limit }) => {
      try {
        return json(await orchestrate(request, { limit }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  return server;
}
