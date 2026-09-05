import { AREA_FIELDS, DESCRIPTION_FIELDS, NAME_FIELDS, PRICE_FIELDS, numberOf, textOf } from "./fields.js";
import type { ToolInfo } from "./client.js";
import type { Combo, OrchestrationResult } from "./orchestrator.js";
import type { Resident } from "./residents.js";
import type { CityItem, Entity, Plan } from "./types.js";

/**
 * Tudo que o Core devolve pelo MCP passa por aqui e sai como texto em
 * português. Quem lê do outro lado é uma pessoa (por meio do Claude ou do
 * ChatGPT), então nada de JSON, nome de campo ou jargão de implementação.
 */

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function brl(value: number | undefined): string | undefined {
  return value === undefined ? undefined : money.format(value);
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? `1 ${um}` : `${n} ${muitos}`;
}

/** "a, b e c" */
function lista(itens: string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function describeItem(item: CityItem): string {
  const nome = textOf(item, NAME_FIELDS) ?? String(item.id ?? "sem nome");
  const detalhes = [brl(numberOf(item, PRICE_FIELDS)), textOf(item, AREA_FIELDS)].filter(Boolean);
  const sobre = textOf(item, DESCRIPTION_FIELDS);

  let linha = `• ${nome}`;
  if (detalhes.length > 0) linha += ` — ${detalhes.join(", ")}`;
  if (sobre && sobre.length <= 120) linha += `\n  ${sobre}`;
  return linha;
}

function describeCombo(combo: Combo): string {
  const nomes = lista(combo.items.map(i => i.name));
  const extras: string[] = [];
  if (combo.totalPerPerson !== undefined) extras.push(`${brl(combo.totalPerPerson)} por pessoa`);
  if (combo.sameArea && combo.items[0]?.area) extras.push(`os dois em ${combo.items[0].area}`);
  return `• ${nomes}${extras.length > 0 ? ` — ${extras.join(", ")}` : ""}`;
}

/* ------------------------------------------------------------- orquestração */

export function presentOrchestration(out: OrchestrationResult): string {
  const comItens = out.results.filter(r => r.ok && r.items.length > 0);
  const falharam = out.results.filter(r => !r.ok);
  const total = comItens.reduce((n, r) => n + r.items.length, 0);
  const partes: string[] = [];

  if (total === 0) {
    if (out.plan.steps.length === 0) {
      partes.push("Não encontrei nenhum lugar da cidade que atenda esse pedido. Tente dizer de outro jeito — por exemplo, se quer comer, ouvir música, fazer compras ou resolver algo no banco.");
    } else {
      const consultados = lista([...new Set(out.results.map(r => r.entityName))]);
      partes.push(`Procurei em ${consultados}, mas não achei nada que sirva dessa vez.`);
      const descartados = out.results.reduce((n, r) => n + r.droppedByConstraints, 0);
      if (descartados > 0) {
        partes.push(`Havia ${plural(descartados, "opção que não cabia", "opções que não cabiam")} no que você pediu — talvez valha soltar um pouco o número de pessoas ou o valor.`);
      }
    }
  } else {
    partes.push(`Achei ${plural(total, "opção", "opções")} em ${plural(comItens.length, "lugar", "lugares")} da cidade.`);
    for (const r of comItens) {
      partes.push(`**${r.entityName}**\n${r.items.map(describeItem).join("\n")}`);
    }

    if (out.combos.length > 0) {
      partes.push(`Se quiser juntar as coisas:\n${out.combos.map(describeCombo).join("\n")}`);
    }

    const descartados = out.results.reduce((n, r) => n + r.droppedByConstraints, 0);
    if (descartados > 0) {
      partes.push(`Deixei de fora ${plural(descartados, "opção que não cabia", "opções que não cabiam")} no seu limite de pessoas ou de valor.`);
    }
  }

  if (falharam.length > 0) {
    partes.push(`${lista(falharam.map(r => r.entityName))} não respondeu agora — se for importante, dá para tentar de novo em instantes.`);
  }

  return partes.join("\n\n");
}

/* -------------------------------------------------------------------- plano */

export function presentPlan(plan: Plan): string {
  const partes: string[] = [];
  const entendi: string[] = [];

  if (plan.detectedTags.length > 0) {
    const nomes: Record<string, string> = {
      food: "comer",
      music: "música ao vivo",
      movie: "cinema",
      event: "eventos",
      lodging: "hospedagem",
      transport: "transporte",
      grocery: "compras de mercado",
      dessert: "doces",
      finance: "banco",
      activity: "alguma atividade"
    };
    entendi.push(`você quer ${lista(plan.detectedTags.map(t => nomes[t] ?? t))}`);
  }
  if (plan.slots.people !== undefined) entendi.push(`são ${plural(plan.slots.people, "pessoa", "pessoas")}`);
  if (plan.slots.maxPricePerPerson !== undefined) entendi.push(`até ${brl(plan.slots.maxPricePerPerson)} por pessoa`);
  if (plan.slots.when !== undefined) entendi.push(`para ${plan.slots.when}`);
  if (plan.slots.near !== undefined) entendi.push(`perto de ${plan.slots.near}`);

  partes.push(entendi.length > 0 ? `Entendi que ${lista(entendi)}.` : "Não consegui identificar nada específico nesse pedido.");

  if (plan.steps.length === 0) {
    partes.push("Nenhum lugar da cidade atende isso por enquanto.");
  } else {
    const lugares = [...new Set(plan.steps.map(s => s.entityName))];
    partes.push(`Vou perguntar em ${lista(lugares)}.`);
  }

  return partes.join("\n\n");
}

/* ------------------------------------------------------------------ cidade */

function entityLine(e: Entity): string {
  const estado = e.enabled ? "" : " (fora do ar no momento)";
  const sobre = e.description ? ` — ${e.description}` : "";
  return `• ${e.name}${estado}${sobre}\n  Para falar direto com ele, use o apelido: ${e.id}`;
}

export function presentEntities(entities: Entity[]): string {
  if (entities.length === 0) return "A cidade ainda não tem nenhum lugar cadastrado.";
  return `A cidade tem ${plural(entities.length, "lugar", "lugares")}:\n\n${entities.map(entityLine).join("\n\n")}`;
}

export function presentEntity(e: Entity): string {
  const partes = [`**${e.name}**`];
  if (e.description) partes.push(e.description);
  if (e.tools.length > 0) partes.push(`Sabe fazer: ${lista(e.tools.map(t => t.name))}.`);
  partes.push(e.enabled ? "Está no ar." : "Está fora do ar no momento.");
  partes.push(`Apelido dele na cidade: ${e.id}`);
  return partes.join("\n\n");
}

export function presentCityTools(
  resultados: Array<{ entityId: string; entityName?: string; ok: boolean; error?: string; tools: ToolInfo[] }>
): string {
  const partes: string[] = [];
  for (const r of resultados) {
    const nome = r.entityName ?? r.entityId;
    if (!r.ok) {
      partes.push(`**${nome}** não respondeu agora.`);
      continue;
    }
    if (r.tools.length === 0) {
      partes.push(`**${nome}** não ofereceu nada no momento.`);
      continue;
    }
    const linhas = r.tools.map(t => `• ${t.name}${t.description ? ` — ${t.description}` : ""}`);
    partes.push(`**${nome}**\n${linhas.join("\n")}`);
  }
  return partes.length > 0 ? `O que cada lugar sabe fazer agora:\n\n${partes.join("\n\n")}` : "Nenhum lugar respondeu agora.";
}

export function presentToolCall(entityName: string, items: Record<string, unknown>[], texto: string): string {
  if (items.length === 0) {
    return texto.trim().length > 0 ? `${entityName} respondeu:\n\n${texto.trim()}` : `${entityName} não devolveu nada dessa vez.`;
  }
  const linhas = items.map(i => describeItem(i as CityItem)).join("\n");
  return `${entityName} respondeu com ${plural(items.length, "item", "itens")}:\n\n${linhas}`;
}

/* --------------------------------------------------------------- alterações */

function comAviso(texto: string, warning?: string): string {
  if (!warning) return texto;
  return `${texto}\n\nSó um aviso: a mudança vale enquanto esta sessão durar. Para deixar permanente, ela precisa ser gravada no projeto da cidade.`;
}

export function presentRegistered(e: Entity, warning?: string): string {
  return comAviso(`Pronto! ${e.name} agora faz parte da cidade e já pode ser consultado.`, warning);
}

export function presentUpdated(e: Entity, warning?: string): string {
  return comAviso(`Atualizei ${e.name}.`, warning);
}

export function presentRemoved(e: Entity, warning?: string): string {
  return comAviso(`${e.name} saiu da cidade.`, warning);
}

/* -------------------------------------------------------------------- erros */

export function presentError(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    const detalhes = issues.map(i => `• ${i.path.join(".") || "dados"}: ${i.message}`).join("\n");
    return `Não consegui fazer isso porque faltou informação:\n\n${detalhes}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Não consegui fazer isso: ${msg}`;
}

/* ---------------------------------------------------------------- moradores */

function residentLine(r: Resident): string {
  const detalhes = [r.bairro, r.interesses.length > 0 ? `gosta de ${lista(r.interesses)}` : undefined].filter(Boolean);
  let linha = `• ${r.name}`;
  if (detalhes.length > 0) linha += ` — ${detalhes.join(", ")}`;
  if (r.bio) linha += `\n  ${r.bio}`;
  linha += `\n  Apelido na cidade: ${r.id}`;
  return linha;
}

export function presentResidents(moradores: Resident[]): string {
  if (moradores.length === 0) return "Ainda não mora ninguém na cidade.";
  return `A cidade tem ${plural(moradores.length, "morador", "moradores")}:\n\n${moradores.map(residentLine).join("\n\n")}`;
}

export function presentResident(r: Resident): string {
  const partes = [`**${r.name}**`];
  if (r.bio) partes.push(r.bio);
  const detalhes: string[] = [];
  if (r.bairro) detalhes.push(`mora em ${r.bairro}`);
  if (r.interesses.length > 0) detalhes.push(`gosta de ${lista(r.interesses)}`);
  if (r.desde) detalhes.push(`na cidade desde ${r.desde}`);
  if (detalhes.length > 0) partes.push(`${detalhes.join(", ")}.`);
  partes.push(`Apelido na cidade: ${r.id}`);
  return partes.join("\n\n");
}

export function presentResidentAdded(r: Resident, warning?: string): string {
  return comAviso(`Boas-vindas, ${r.name}! Agora você mora na GTA7 Lab.`, warning);
}

export function presentResidentUpdated(r: Resident, warning?: string): string {
  return comAviso(`Atualizei os dados de ${r.name}.`, warning);
}

export function presentResidentRemoved(r: Resident, warning?: string): string {
  return comAviso(`${r.name} mudou de cidade.`, warning);
}
