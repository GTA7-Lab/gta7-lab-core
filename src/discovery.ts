import { listEntityTools, type ToolInfo } from "./client.js";
import type { Entity, RequestSlots } from "./types.js";

/**
 * O MCP é a fonte de verdade das capacidades: o registro guarda só como chegar
 * na entidade e em que tipo de pedido ela entra (`tags`). Quais tools existem,
 * e com que parâmetros, vem de `listTools` na hora.
 *
 * Isso tira o manifesto manual, que envelhecia sozinho — mas cobra dois
 * julgamentos que antes eram declarados: qual tool o Core pode chamar por
 * conta própria, e como preencher os argumentos dela.
 */

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; tools: ToolInfo[] }>();

export async function toolsOf(entity: Entity): Promise<ToolInfo[]> {
  const chave = `${entity.id}|${entity.endpoint ?? entity.command}`;
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.at < CACHE_TTL_MS) return guardado.tools;

  const tools = await listEntityTools(entity);
  cache.set(chave, { at: Date.now(), tools });
  return tools;
}

export function forgetTools(entityId?: string): void {
  if (!entityId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${entityId}|`)) cache.delete(k);
}

/* ------------------------------------------------- que tool pode ser usada */

/** Verbos de catálogo. Nada fora disto é chamado sem alguém pedir. */
const VERBO_DE_BUSCA = /^(search|find|browse|list|get|recommend)[_-]/i;

/**
 * Coisas que uma entidade lista mas que **não** são a vitrine dela.
 *
 * O banco expõe `list_customers` e `search_transactions`; a casa de shows,
 * `list_customers`. Todas passam em qualquer regra baseada em "é uma busca sem
 * parâmetro obrigatório" — e o Core acabaria despejando dado de cliente na
 * resposta de quem só perguntou o que tem para fazer na cidade. Nome e schema
 * não distinguem catálogo público de registro privado, então a linha é
 * explícita.
 */
const ASSUNTO_PRIVADO =
  /(customer|client|cliente|account|conta|transaction|transac|order|pedido|purchase|compra|sale|venda|patient|paciente|record|prontuario|invoice|fatura|payment|pagamento|card|cartao|loan|emprestimo|reservation|reserva|booking)/i;

function semObrigatorios(tool: ToolInfo): boolean {
  const schema = tool.inputSchema as { required?: unknown } | undefined;
  const req = Array.isArray(schema?.required) ? schema!.required : [];
  return req.length === 0;
}

export interface ToolChoice {
  tool: ToolInfo;
  reason: string;
}

/**
 * As tools que o Core pode chamar sozinho ao atender um pedido: vitrine da
 * entidade, chamável sem argumento nenhum, e que não mexe nem expõe dado de
 * ninguém. Exigir zero obrigatórios já derruba `get_show(id)` e `send_pix`;
 * a denylist cuida do resto.
 */
export async function searchToolsOf(entity: Entity): Promise<ToolChoice[]> {
  const todas = await toolsOf(entity);
  return todas
    .filter(t => VERBO_DE_BUSCA.test(t.name) && semObrigatorios(t) && !ASSUNTO_PRIVADO.test(t.name))
    .map(t => ({ tool: t, reason: "vitrine pública, chamável sem argumentos" }));
}

/* --------------------------------------------- como preencher os argumentos */

/**
 * Como cada entidade batiza os parâmetros. Simétrico à tabela de apelidos que
 * o Core já usa para ler as respostas (`fields.ts`): lá para entender o que
 * volta, aqui para preencher o que vai.
 */
const APELIDOS: Record<keyof RequestSlots | "context", string[]> = {
  query: ["query", "q", "search", "texto", "text", "term", "termo", "busca"],
  people: ["people", "partysize", "party_size", "groupsize", "group_size", "guests", "pax", "seats", "pessoas"],
  maxPricePerPerson: [
    "maxprice", "max_price", "max_price_brl", "maxticketprice", "max_ticket_price",
    "precomax", "preco_max", "valor_max", "budget"
  ],
  when: ["date", "data", "day", "dia", "when", "quando"],
  near: ["area", "bairro", "neighborhood", "regiao", "region", "district", "distrito", "zona", "local"],
  limit: ["limit", "limite", "max", "take", "quantidade"],
  context: ["context", "requestcontext", "request_context", "requester", "caller", "solicitante"]
};

function tipoDoParametro(schema: unknown, nome: string): string | undefined {
  const props = (schema as { properties?: Record<string, { type?: string }> } | undefined)?.properties;
  return props?.[nome]?.type;
}

function compativel(tipoEsperado: string | undefined, valor: unknown): boolean {
  if (!tipoEsperado) return true;
  if (tipoEsperado === "number" || tipoEsperado === "integer") return typeof valor === "number";
  if (tipoEsperado === "string") return typeof valor === "string";
  if (tipoEsperado === "boolean") return typeof valor === "boolean";
  return true;
}

/** Acha, no schema da tool, o parâmetro que corresponde a um slot do Core. */
export function paramFor(tool: ToolInfo, slot: string): string | undefined {
  const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props) return undefined;

  const apelidos = APELIDOS[slot as keyof typeof APELIDOS];
  if (!apelidos) return undefined;

  const porMinusculo = new Map(Object.keys(props).map(p => [p.toLowerCase().replace(/[_-]/g, ""), p]));
  for (const a of apelidos) {
    const achado = porMinusculo.get(a.replace(/[_-]/g, ""));
    if (achado) return achado;
  }
  return undefined;
}

/**
 * Traduz os slots do pedido para os argumentos da tool. Só manda o que casa em
 * nome **e** em tipo — mandar texto num parâmetro numérico faz a entidade
 * recusar a chamada inteira, e já aconteceu com data.
 */
export function argsFor(tool: ToolInfo, slots: RequestSlots): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [slot, valor] of Object.entries(slots)) {
    if (valor === undefined) continue;
    const nome = paramFor(tool, slot);
    if (!nome) continue;
    if (!compativel(tipoDoParametro(tool.inputSchema, nome), valor)) continue;
    args[nome] = valor;
  }
  return args;
}
