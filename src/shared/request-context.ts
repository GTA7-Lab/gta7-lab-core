/**
 * Quem está pedindo.
 *
 * Vai junto quando um agente usa a tool de uma entidade. A entidade decide o
 * que fazer com isso — autorizar, recusar, cobrar preço de morador. O Core não
 * conhece regra de autorização de ninguém; ele só carimba a identidade.
 *
 * Contrato deliberadamente pequeno e serializável: ele atravessa a rede como
 * argumento de uma MCP tool. Tudo é opcional porque nem toda chamada tem tudo,
 * e `metadata` existe para crescer sem quebrar quem já lê os campos de cima.
 */
export interface RequestContext {
  /** quem pede (id do agente na cidade) */
  requesterId?: string;
  /** o que ele é: "resident", "agent", "city"... */
  requesterType?: string;
  /** em que papel está pedindo: ["customer"], ["owner"], ["worker"] */
  roles?: string[];
  /** onde está no momento do pedido */
  location?: string;
  /** de onde veio a chamada */
  source?: string;
  /** prova de identidade, se um dia a entidade exigir */
  credential?: string;
  metadata?: Record<string, unknown>;
}

export const CITY_SOURCE = "gta7-lab-city";

export function createRequestContext(base: RequestContext): RequestContext {
  const ctx: RequestContext = { source: CITY_SOURCE, ...base };
  // Campos vazios só poluem o argumento que vai para a entidade.
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete (ctx as Record<string, unknown>)[k];
  }
  return ctx;
}
