/**
 * Leitura tolerante dos itens devolvidos pelas entidades. Cada entidade nomeia
 * os campos como quiser, então o Core procura por apelidos conhecidos em vez de
 * exigir um schema de resposta.
 */

export const NAME_FIELDS = ["name", "nome", "title", "titulo", "título"];
export const PRICE_FIELDS = [
  "pricePerPerson", "price_per_person", "precoPorPessoa", "preco_por_pessoa",
  "ticketPrice", "ticket_price", "price", "preco", "preço", "valor"
];
export const CAPACITY_FIELDS = ["capacity", "capacidade", "maxPartySize", "max_party_size", "seats", "lotacao", "lotação"];
export const AREA_FIELDS = ["area", "área", "neighborhood", "bairro", "region", "regiao", "região", "district", "zona", "local"];
export const DESCRIPTION_FIELDS = ["description", "descricao", "descrição", "resumo", "summary", "detalhe", "sobre"];

export function field(item: Record<string, unknown>, aliases: string[]): unknown {
  const lower = new Map(Object.keys(item).map(k => [k.toLowerCase(), k]));
  for (const a of aliases) {
    const key = lower.get(a.toLowerCase());
    if (key !== undefined && item[key] !== null && item[key] !== undefined) return item[key];
  }
  return undefined;
}

export function numberOf(item: Record<string, unknown>, aliases: string[]): number | undefined {
  const v = field(item, aliases);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function textOf(item: Record<string, unknown>, aliases: string[]): string | undefined {
  const v = field(item, aliases);
  return typeof v === "string" ? v : undefined;
}
