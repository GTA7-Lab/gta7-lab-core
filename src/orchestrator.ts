import { callEntityTool, extractItems } from "./client.js";
import { FOOD_TAGS, detectTags, expandTags } from "./lexicon.js";
import { listEntities } from "./registry.js";
import { NEAR_RE, extractSlots } from "./slots.js";
import { argsFor, paramFor, searchToolsOf, toolsOf } from "./discovery.js";
import { AREA_FIELDS, CAPACITY_FIELDS, PRICE_FIELDS, displayName, numberOf, textOf } from "./fields.js";
import type { CityItem, Entity, Plan, PlanStep, RequestSlots, StepResult } from "./types.js";

const DEFAULT_LIMIT = 5;

// ---------------------------------------------------------------------- plano

/**
 * O registro guarda como chegar na entidade e em que pedidos ela entra
 * (`tags`). Quais tools existem, e com que parâmetros, vem do MCP na hora —
 * ver `discovery.ts`. Isso significa que montar o plano é uma operação de rede.
 */
export async function buildPlan(request: string, opts: { limit?: number } = {}): Promise<Plan> {
  const slots = extractSlots(request);
  slots.limit = opts.limit ?? DEFAULT_LIMIT;

  const detected = detectTags(request);
  const wanted = new Set(expandTags(detected));
  const notes: string[] = [];

  const entities = listEntities({ enabledOnly: true });
  const steps: PlanStep[] = [];

  await Promise.all(
    entities.map(async entity => {
      const matched = entity.tags.filter(t => wanted.has(t));
      if (detected.length > 0 && matched.length === 0) return;

      let escolhidas;
      try {
        escolhidas = await searchToolsOf(entity);
      } catch (err) {
        notes.push(`não consegui perguntar as capacidades de '${entity.id}': ${(err as Error).message}`);
        return;
      }
      if (escolhidas.length === 0) {
        notes.push(`'${entity.id}' não expõe nenhuma tool de vitrine que o Core possa chamar sozinho`);
        return;
      }

      for (const { tool, reason } of escolhidas) {
        steps.push({
          entityId: entity.id,
          entityName: entity.name,
          tool: tool.name,
          matchedTags: matched,
          args: argsFor(tool, slots),
          reason:
            matched.length > 0
              ? `tags em comum com o pedido: ${matched.join(", ")}; ${reason}`
              : `nenhuma tag reconhecida no pedido; ${reason}`
        });
      }
    })
  );

  // A descoberta é paralela, então a ordem chega ao sabor da rede. Ordenar
  // mantém o plano igual entre execuções, que é o ponto de poder inspecioná-lo.
  steps.sort((a, b) => a.entityId.localeCompare(b.entityId) || a.tool.localeCompare(b.tool));

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
        let result = await callEntityTool(entity, step.tool, step.args);
        let { items, raw } = extractItems(result);

        // Os filtros que o Core extrai do texto são palpites: a frase inteira
        // em `query` não casa com quem filtra por token, e uma data que a
        // entidade valida pode recusar a chamada toda. Quando a busca falha ou
        // volta vazia, repetimos sem os filtros — só com o limite. No pior caso
        // uma segunda chamada, e melhor uma lista ampla do que nada.
        let retriedSimplified = false;
        const info = (await toolsOf(entity)).find(t => t.name === step.tool);
        const limitParam = info ? paramFor(info, "limit") : undefined;
        const semFiltros = limitParam !== undefined && step.args[limitParam] !== undefined
          ? { [limitParam]: step.args[limitParam] }
          : {};
        const tinhaFiltros = Object.keys(step.args).some(k => k !== limitParam);

        if ((result.isError || items.length === 0) && tinhaFiltros) {
          const retry = await callEntityTool(entity, step.tool, semFiltros);
          if (!retry.isError) {
            const second = extractItems(retry);
            if (second.items.length > 0) {
              result = retry;
              items = second.items;
              raw = second.raw;
              retriedSimplified = true;
            }
          }
        }

        if (result.isError) {
          return { step, ok: false, items: [], error: result.text || "a entidade devolveu isError", raw };
        }

        const annotated: CityItem[] = items.map(i => ({
          ...i,
          entityId: entity.id,
          entityName: entity.name,
          tool: step.tool
        }));
        return { step, ok: true, items: annotated, retriedSimplified, raw };
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
    name: displayName(item) ?? String(item.id ?? "(sem nome)"),
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
    /** a busca falhou ou voltou vazia com os filtros, e foi repetida sem eles */
    retriedSimplified: boolean;
  }>;
  combos: Combo[];
  notes: string[];
}

export async function orchestrate(request: string, opts: { limit?: number } = {}): Promise<OrchestrationResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const plan = await buildPlan(request, { limit });
  const raw = await runPlan(plan);
  const notes = [...plan.notes];

  const results = raw.map(r => {
    const { kept, dropped } = applyConstraints(r.items, plan.slots);
    if (!r.ok && r.error) notes.push(`'${r.step.entityId}.${r.step.tool}' falhou: ${r.error}`);
    if (r.retriedSimplified) {
      notes.push(`'${r.step.entityId}.${r.step.tool}' não casou com os filtros do pedido; repetido sem eles`);
    }
    return {
      entityId: r.step.entityId,
      entityName: r.step.entityName,
      tool: r.step.tool,
      ok: r.ok,
      error: r.error,
      items: kept.slice(0, limit),
      droppedByConstraints: dropped,
      retriedSimplified: r.retriedSimplified === true
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
