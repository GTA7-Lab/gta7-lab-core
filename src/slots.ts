import { detectTags } from "./lexicon.js";
import type { RequestSlots } from "./types.js";

/** "1.200,50" -> 1200.5 ; "200" -> 200 */
export function parseBrlNumber(raw: string): number | undefined {
  let s = raw.trim().replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const PEOPLE_RE = /(\d+)\s*(?:pessoas?|convidados?|amigos?|people|pax|guests?)/i;
const PEOPLE_FALLBACK_RE = /\bpara\s+(\d+)\b/i;
const BUDGET_RE =
  /(?:at[ée]|no m[áa]ximo|m[áa]ximo de|max(?:imo|\.)?|abaixo de|under|budget de)\s*(?:R\$\s*)?(\d[\d.,]*)/i;
const MONEY_RE = /R\$\s*(\d[\d.,]*)/i;
const PER_PERSON_RE = /(?:por pessoa|per person|cada pessoa|p\/\s*pessoa|por cabe[çc]a)/i;
const WHEN_RE =
  /\b(hoje[\s\wàa]*noite|hoje|amanh[ãa]|esta noite|esse fim de semana|fim de semana|final de semana|s[áa]bado|domingo|sexta(?:-feira)?|s[áa]b|tonight|tomorrow|weekend)\b/i;
export const NEAR_RE =
  /\b(?:perto de|pr[óo]xim[oa]s? (?:a|ao|de|do|da)|nas? proximidades de|near)\s+([^,.;!?]{2,60})/i;

/**
 * Extração de restrições por regex. Previsível e fácil de depurar — o resultado
 * aparece inteiro em `plan_request`, então dá para ver exatamente o que o Core
 * entendeu antes de qualquer chamada a entidade.
 */
export function extractSlots(text: string): RequestSlots {
  const slots: RequestSlots = { query: text.trim() };

  const people = text.match(PEOPLE_RE) ?? text.match(PEOPLE_FALLBACK_RE);
  if (people) {
    const n = Number(people[1]);
    if (Number.isInteger(n) && n > 0) slots.people = n;
  }

  const budgetMatch = text.match(BUDGET_RE) ?? text.match(MONEY_RE);
  if (budgetMatch) {
    const value = parseBrlNumber(budgetMatch[1]);
    if (value !== undefined && value > 0) {
      if (PER_PERSON_RE.test(text)) slots.maxPricePerPerson = value;
      else if (slots.people) slots.maxPricePerPerson = value / slots.people;
      else slots.maxPricePerPerson = value;
    }
  }

  const when = text.match(WHEN_RE);
  if (when) {
    // "hoje" não serve para uma tool que valida data. Mandar o texto cru fazia
    // a entidade recusar a chamada inteira; melhor resolver para uma data de
    // verdade e, quando não der, não mandar nada.
    const data = resolveWhen(when[1]);
    if (data) slots.when = data;
  }

  const near = text.match(NEAR_RE);
  if (near) {
    const target = near[1].trim();
    // "próximo a algum evento" não nomeia um bairro: é um pedido de proximidade
    // entre serviços. Aí não vira filtro de área — quem cuida disso é a etapa de
    // combinação, que prioriza itens na mesma área.
    if (detectTags(target).length === 0) slots.near = target;
  }

  return slots;
}

const DIAS_DA_SEMANA: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, sábado: 6, sab: 6, sáb: 6
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somaDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}

/**
 * Converte "hoje", "amanhã", "sábado", "fim de semana" numa data ISO.
 *
 * Devolve `undefined` quando não dá para resolver — e aí o Core simplesmente
 * não manda o slot. É melhor buscar sem filtro de data do que mandar texto que
 * a entidade recusa, derrubando a chamada inteira.
 */
export function resolveWhen(frase: string, hoje = new Date()): string | undefined {
  const f = frase.toLowerCase().trim();

  if (/^hoje/.test(f) || f === "esta noite" || f === "tonight") return iso(hoje);
  if (/^amanh|^tomorrow/.test(f)) return iso(somaDias(hoje, 1));

  if (/fim de semana|final de semana|weekend/.test(f)) {
    const ateSabado = (6 - hoje.getDay() + 7) % 7;
    return iso(somaDias(hoje, ateSabado === 0 ? 0 : ateSabado));
  }

  const dia = Object.entries(DIAS_DA_SEMANA).find(([nome]) => f.startsWith(nome));
  if (dia) {
    const distancia = (dia[1] - hoje.getDay() + 7) % 7;
    return iso(somaDias(hoje, distancia === 0 ? 7 : distancia));
  }

  return undefined;
}
