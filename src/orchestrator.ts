import { callEntityTool, extractItems } from "./client.js";
import { FOOD_TAGS, detectTags, expandTags } from "./lexicon.js";
import { listEntities } from "./registry.js";
import { NEAR_RE, extractSlots } from "./slots.js";
import { AREA_FIELDS, CAPACITY_FIELDS, NAME_FIELDS, PRICE_FIELDS, numberOf, textOf } from "./fields.js";
import type { CityItem, Entity, Plan, PlanStep, RequestSlots, StepResult } from "./types.js";

const DEFAULT_LIMIT = 5;

// ---------------------------------------------------------------------- plano

/** Traduz os slots canônicos para os nomes de parâmetro que a tool espera. */
function buildArgs(tool: { argsMap: Record<string, string> }, slots: RequestSlots): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [slot, paramName] of Object.entries(tool.argsMap)) {
    const value = (slots as Record<string, unknown>)[slot];
    if (value !== undefined) args[paramName] = value;
  }
  return args;
}

export function buildPlan(request: string, opts: { limit?: number } = {}): Plan {
  const slots = extractSlots(request);
  slots.limit = opts.limit ?? DEFAULT_LIMIT;

  const detected = detectTags(request);
  const wanted = new Set(expandTags(detected));
  const notes: string[] = [];

  const entities = listEntities({ enabledOnly: true });
  const steps: PlanStep[] = [];

  for (const entity of entities) {
    const searchTools = entity.tools.filter(t => t.kind === "search");
    if (searchTools.length === 0) {
      notes.push(`'${entity.id}' ignorada: nenhuma tool com kind 'search' registrada`);
      continue;
    }
    const matched = entity.tags.filter(t => wanted.has(t));
    if (detected.length > 0 && matched.length === 0) continue;

    for (const tool of searchTools) {
      steps.push({
        entityId: entity.id,
        entityName: entity.name,
        tool: tool.name,
        matchedTags: matched,
        args: buildArgs(tool, slots),
        reason:
          matched.length > 0
            ? `tags em comum com o pedido: ${matched.join(", ")}`
            : "nenhuma tag reconhecida no pedido; consultando todas as entidades ativas"
      });
    }
  }

  if (detected.length === 0) {
    notes.push("nenhuma tag reconhecida no pedido; o Core consultou todas as entidades ativas");
  }
  if (NEAR_RE.test(request) && slots.near === undefined) {
    notes.push("o pedido pede proximidade entre serviços; as combinações priorizam itens na mesma área");
  }
  if (steps.length === 0) notes.push("nenhuma entidade registrada consegue atender este pedido");

  return { request, detectedTags: detected, slots, steps, notes };
}

// ------------------------------------------------------------------- execução

export async function runPlan(plan: Plan): Promise<StepResult[]> {
  const byId = new Map(listEntities().map(e => [e.id, e]));

  return Promise.all(
    plan.steps.map(async (step): Promise<StepResult> => {
      const entity = byId.get(step.entityId) as Entity | undefined;
      if (!entity) return { step, ok: false, items: [], error: `entidade '${step.entityId}' sumiu do registro` };
      try {
        const result = await callEntityTool(entity, step.tool, step.args);
        let { items, raw } = extractItems(result);
        if (result.isError) {
          return { step, ok: false, items: [], error: result.text || "a entidade devolveu isError", raw };
        }

        // O Core manda a frase inteira do usuário em `query`. Entidades que
        // filtram por token não casam nada com ela e devolvem vazio. Em vez de
        // tentar adivinhar o vocabulário de cada uma, repetimos a busca sem
        // `query` — no pior caso uma segunda chamada, e o que aconteceu fica
        // explícito em `retriedWithoutQuery`.
        let retriedWithoutQuery = false;
        const queryParam = entity.tools.find(t => t.name === step.tool)?.argsMap.query;
        if (items.length === 0 && queryParam !== undefined && step.args[queryParam] !== undefined) {
          const { [queryParam]: _dropped, ...withoutQuery } = step.args;
          const retry = await callEntityTool(entity, step.tool, withoutQuery);
          if (!retry.isError) {
            const second = extractItems(retry);
            if (second.items.length > 0) {
              items = second.items;
              raw = second.raw;
              retriedWithoutQuery = true;
            }
          }
        }

        const annotated: CityItem[] = items.map(i => ({
          ...i,
          entityId: entity.id,
          entityName: entity.name,
          tool: step.tool
        }));
        return { step, ok: true, items: annotated, retriedWithoutQuery, raw };
      } catch (err) {
        return { step, ok: false, items: [], error: (err as Error).message };
      }
    })
  );
}

// ----------------------------------------------------------------- combinação

/**
 * Filtro aplicado pelo Core depois das chamadas: garante que as restrições
 * valham mesmo quando a entidade ignora os parâmetros. Itens sem o campo
 * correspondente passam — o Core não descarta o que não sabe avaliar.
 */
function applyConstraints(items: CityItem[], slots: RequestSlots): { kept: CityItem[]; dropped: number } {
  let dropped = 0;
  const kept = items.filter(item => {
    if (slots.people !== undefined) {
      const cap = numberOf(item, CAPACITY_FIELDS);
      if (cap !== undefined && cap < slots.people) {
        dropped++;
        return false;
      }
    }
    if (slots.maxPricePerPerson !== undefined) {
      const price = numberOf(item, PRICE_FIELDS);
      if (price !== undefined && price > slots.maxPricePerPerson) {
        dropped++;
        return false;
      }
    }
    return true;
  });
  return { kept, dropped };
}

export interface Combo {
  items: Array<{ entityId: string; name: string; area?: string; pricePerPerson?: number }>;
  totalPerPerson?: number;
  sameArea: boolean;
  why: string;
}

function summarize(item: CityItem) {
  return {
    entityId: item.entityId,
    name: textOf(item, NAME_FIELDS) ?? String(item.id ?? "(sem nome)"),
    area: textOf(item, AREA_FIELDS),
    pricePerPerson: numberOf(item, PRICE_FIELDS)
  };
}

/**
 * Combina resultados de entidades diferentes. Regra única e previsível: separa
 * "refeição" do resto e cruza o topo de cada lado, priorizando pares na mesma
 * área e dentro do orçamento por pessoa.
 */
export function buildCombos(results: StepResult[], slots: RequestSlots, max = 3): Combo[] {
  const entitiesById = new Map(listEntities().map(e => [e.id, e]));
  const isFood = (item: CityItem) => (entitiesById.get(item.entityId)?.tags ?? []).some(t => FOOD_TAGS.has(t));

  const all = results.filter(r => r.ok).flatMap(r => r.items);
  const food = all.filter(isFood);
  const other = all.filter(i => !isFood(i));
  if (food.length === 0 || other.length === 0) return [];

  const combos: Combo[] = [];
  for (const f of food) {
    for (const o of other) {
      const a = summarize(f);
      const b = summarize(o);
      const sameArea = !!a.area && !!b.area && a.area.toLowerCase() === b.area.toLowerCase();
      const total =
        a.pricePerPerson !== undefined && b.pricePerPerson !== undefined
          ? Number((a.pricePerPerson + b.pricePerPerson).toFixed(2))
          : undefined;
      if (slots.maxPricePerPerson !== undefined && total !== undefined && total > slots.maxPricePerPerson) continue;
      combos.push({
        items: [a, b],
        totalPerPerson: total,
        sameArea,
        why: sameArea ? `ambos em ${a.area}` : "combinação entre entidades diferentes"
      });
    }
  }

  combos.sort((x, y) => {
    if (x.sameArea !== y.sameArea) return x.sameArea ? -1 : 1;
    return (x.totalPerPerson ?? Infinity) - (y.totalPerPerson ?? Infinity);
  });
  return combos.slice(0, max);
}

export interface OrchestrationResult {
  plan: Plan;
  results: Array<{
    entityId: string;
    entityName: string;
    tool: string;
    ok: boolean;
    error?: string;
    items: CityItem[];
    droppedByConstraints: number;
    /** a busca voltou vazia com o texto do pedido e foi repetida sem `query` */
    retriedWithoutQuery: boolean;
  }>;
  combos: Combo[];
  notes: string[];
}

export async function orchestrate(request: string, opts: { limit?: number } = {}): Promise<OrchestrationResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const plan = buildPlan(request, { limit });
  const raw = await runPlan(plan);
  const notes = [...plan.notes];

  const results = raw.map(r => {
    const { kept, dropped } = applyConstraints(r.items, plan.slots);
    if (!r.ok && r.error) notes.push(`'${r.step.entityId}.${r.step.tool}' falhou: ${r.error}`);
    if (r.retriedWithoutQuery) {
      notes.push(`'${r.step.entityId}.${r.step.tool}' não casou com o texto do pedido; repetido sem 'query'`);
    }
    return {
      entityId: r.step.entityId,
      entityName: r.step.entityName,
      tool: r.step.tool,
      ok: r.ok,
      error: r.error,
      items: kept.slice(0, limit),
      droppedByConstraints: dropped,
      retriedWithoutQuery: r.retriedWithoutQuery === true
    };
  });

  const combos = buildCombos(
    raw.map((r, i) => ({ ...r, items: results[i].items })),
    plan.slots
  );

  const total = results.reduce((n, r) => n + r.items.length, 0);
  if (total === 0 && plan.steps.length > 0) {
    notes.push("as entidades consultadas não devolveram itens dentro das restrições");
  }

  return { plan, results, combos, notes };
}
