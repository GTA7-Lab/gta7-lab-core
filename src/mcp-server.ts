import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callEntityTool, extractItems, listEntityTools } from "./client.js";
import { LEXICON } from "./lexicon.js";
import { getEntity, listEntities, registerEntity, removeEntity, updateEntity } from "./registry.js";
import { buildPlan, orchestrate } from "./orchestrator.js";
import { checkMagicWord } from "./magic-word.js";
import { addResident, getResident, listResidents, removeResident, updateResident } from "./residents.js";
import {
  presentCityTools,
  presentEntities,
  presentEntity,
  presentError,
  presentOrchestration,
  presentPlan,
  presentRegistered,
  presentRemoved,
  presentResident,
  presentResidentAdded,
  presentResidentRemoved,
  presentResidentUpdated,
  presentResidents,
  presentToolCall,
  presentUpdated
} from "./present.js";

/** Toda resposta do Core sai como texto em português — nunca JSON cru. */
function say(text: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text }] };
}

function fail(err: unknown) {
  return say(presentError(err), true);
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

const palavraMagica = z
  .string()
  .optional()
  .describe("palavra mágica da cidade; sem ela o registro não pode ser alterado");

const entityShape = {
  palavra_magica: palavraMagica,
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
    async ({ enabledOnly }) => say(presentEntities(listEntities({ enabledOnly: enabledOnly ?? false })))
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
      return entity ? say(presentEntity(entity)) : fail(`não achei nenhum lugar chamado '${id}' na cidade`);
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
      const { palavra_magica, ...dados } = input;
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      try {
        const { entity, warning } = registerEntity(dados);
        return say(presentRegistered(entity, warning));
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
        palavra_magica: palavraMagica,
        id: z.string(),
        patch: z.record(z.unknown()).describe("campos a sobrescrever; 'id' é ignorado")
      }
    },
    async ({ id, patch, palavra_magica }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      try {
        const { entity, warning } = updateEntity(id, patch as Record<string, unknown>);
        return say(presentUpdated(entity, warning));
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
      inputSchema: { palavra_magica: palavraMagica, id: z.string() }
    },
    async ({ id, palavra_magica }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      try {
        const { removed, warning } = removeEntity(id);
        return say(presentRemoved(removed, warning));
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
      if (targets.length === 0) {
        return fail(entityId ? `não achei nenhum lugar chamado '${entityId}' na cidade` : "a cidade ainda não tem nenhum lugar no ar");
      }

      const out = await Promise.all(
        targets.map(async entity => {
          try {
            const live = await listEntityTools(entity!);
            return { entityId: entity!.id, entityName: entity!.name, ok: true, tools: live };
          } catch (err) {
            return { entityId: entity!.id, entityName: entity!.name, ok: false, error: (err as Error).message, tools: [] };
          }
        })
      );
      return say(presentCityTools(out));
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
      if (!entity) return fail(`não achei nenhum lugar chamado '${entityId}' na cidade`);
      try {
        const result = await callEntityTool(entity, tool, (args as Record<string, unknown>) ?? {});
        const { items } = extractItems(result);
        return say(presentToolCall(entity.name, items, result.text), result.isError);
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
    async ({ request, limit }) => say(presentPlan(buildPlan(request, { limit })))
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
        return say(presentOrchestration(await orchestrate(request, { limit })));
      } catch (err) {
        return fail(err);
      }
    }
  );

  // ------------------------------------------------------------ moradores

  // Diferente das entidades, aqui até a leitura pede a palavra mágica:
  // morador é gente, não serviço público da cidade.

  server.registerTool(
    "list_residents",
    {
      title: "Listar moradores",
      description: "Lista quem mora na cidade. Precisa da palavra mágica.",
      inputSchema: { palavra_magica: palavraMagica }
    },
    async ({ palavra_magica }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      return say(presentResidents(await listResidents()));
    }
  );

  server.registerTool(
    "get_resident",
    {
      title: "Ver um morador",
      description: "Mostra os dados de um morador pelo apelido. Precisa da palavra mágica.",
      inputSchema: { palavra_magica: palavraMagica, id: z.string() }
    },
    async ({ id, palavra_magica }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      const morador = await getResident(id);
      return morador ? say(presentResident(morador)) : fail(`não encontrei ninguém com o apelido '${id}' na cidade`);
    }
  );

  server.registerTool(
    "register_resident",
    {
      title: "Registrar morador",
      description: "Coloca uma pessoa para morar na cidade. Precisa da palavra mágica.",
      inputSchema: {
        palavra_magica: palavraMagica,
        id: z.string().describe("apelido único, minúsculo (ex.: 'eric')"),
        name: z.string(),
        bio: z.string().optional(),
        bairro: z.string().optional(),
        interesses: z
          .array(z.string())
          .optional()
          .describe(`o que a pessoa gosta; use as tags da cidade: ${Object.keys(LEXICON).join(", ")}`)
      }
    },
    async ({ palavra_magica, ...dados }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      try {
        const { resident, warning } = await addResident(dados);
        return say(presentResidentAdded(resident, warning));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "update_resident",
    {
      title: "Atualizar morador",
      description: "Muda os dados de quem já mora na cidade. Precisa da palavra mágica.",
      inputSchema: {
        palavra_magica: palavraMagica,
        id: z.string(),
        patch: z.record(z.unknown()).describe("campos a mudar; o apelido não muda")
      }
    },
    async ({ id, patch, palavra_magica }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      try {
        const { resident, warning } = await updateResident(id, patch as Record<string, unknown>);
        return say(presentResidentUpdated(resident, warning));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "remove_resident",
    {
      title: "Remover morador",
      description: "Tira uma pessoa da cidade. Precisa da palavra mágica.",
      inputSchema: { palavra_magica: palavraMagica, id: z.string() }
    },
    async ({ id, palavra_magica }) => {
      const permitido = checkMagicWord(palavra_magica);
      if (!permitido.ok) return say(permitido.reason, true);
      try {
        const { resident, warning } = await removeResident(id);
        return say(presentResidentRemoved(resident, warning));
      } catch (err) {
        return fail(err);
      }
    }
  );

  return server;
}
