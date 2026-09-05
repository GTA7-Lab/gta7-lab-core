/**
 * Smoke test do Core: prova os critérios de sucesso da primeira versão —
 * conhecer duas entidades, falar MCP com elas e combinar informação das duas
 * em uma única solicitação. Roda com `npm run smoke` (depois de `npm run build`).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeAll, listEntityTools } from "../src/client.js";
import { listEntities } from "../src/registry.js";
import { orchestrate } from "../src/orchestrator.js";

let failures = 0;

function check(label: string, cond: unknown, detail?: unknown): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FALHOU  ${label}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  }
}

// 1) registro -----------------------------------------------------------------
console.log("\n[1] registro de entidades");
const entities = listEntities({ enabledOnly: true });
check("pelo menos duas entidades ativas", entities.length >= 2, entities.map(e => e.id));

// 2) descoberta de tools ao vivo (MCP client) ---------------------------------
console.log("\n[2] tools expostas pelas entidades (via MCP)");
for (const entity of entities) {
  try {
    const tools = await listEntityTools(entity);
    check(`${entity.id}: ${tools.map(t => t.name).join(", ")}`, tools.length > 0);
  } catch (err) {
    check(`${entity.id} respondeu listTools`, false, (err as Error).message);
  }
}

// 3) orquestração -------------------------------------------------------------
const scenarios = [
  "Quero jantar e depois fazer alguma atividade.",
  "Encontre alguma coisa para 10 pessoas gastando no máximo R$ 200 por pessoa.",
  "Quero um restaurante próximo a algum evento interessante."
];

for (const [i, request] of scenarios.entries()) {
  console.log(`\n[3.${i + 1}] "${request}"`);
  const out = await orchestrate(request, { limit: 3 });
  console.log(`  tags: [${out.plan.detectedTags.join(", ")}]  slots: ${JSON.stringify(out.plan.slots)}`);
  for (const r of out.results) {
    console.log(
      `  ${r.entityId}.${r.tool} -> ${r.ok ? `${r.items.length} itens` : `erro: ${r.error}`}` +
        (r.droppedByConstraints ? ` (${r.droppedByConstraints} descartados pelas restrições)` : "")
    );
    for (const item of r.items) console.log(`      - ${item.name ?? item.id}`);
  }
  for (const c of out.combos) {
    const total = c.totalPerPerson === undefined ? "?" : `R$ ${c.totalPerPerson}`;
    console.log(`  combo: ${c.items.map(x => `${x.name} (${x.entityId})`).join("  +  ")} = ${total}/pessoa — ${c.why}`);
  }

  const usedEntities = new Set(out.results.filter(r => r.ok && r.items.length > 0).map(r => r.entityId));
  check("todas as chamadas às entidades funcionaram", out.results.every(r => r.ok), out.results.filter(r => !r.ok));

  if (i === 0 || i === 2) {
    check("combinou mais de uma entidade", usedEntities.size >= 2, [...usedEntities]);
    check("gerou pelo menos uma combinação", out.combos.length > 0);
  }
  if (i === 1) {
    check("entendeu 10 pessoas", out.plan.slots.people === 10, out.plan.slots);
    check("entendeu R$ 200 por pessoa", out.plan.slots.maxPricePerPerson === 200, out.plan.slots);
    const all = out.results.flatMap(r => r.items);
    check(
      "todos os itens cabem 10 pessoas e custam <= 200",
      all.every(x => Number(x.capacity ?? Infinity) >= 10 && Number(x.pricePerPerson ?? x.ticketPrice ?? 0) <= 200),
      all.map(x => ({ n: x.name, cap: x.capacity, p: x.pricePerPerson ?? x.ticketPrice }))
    );
  }
}

await closeAll();

// 4) CRUD do registro (arquivo temporário, não toca no data/entities.json) -----
console.log("\n[4] CRUD do registro");
const tmp = join(mkdtempSync(join(tmpdir(), "gta7-")), "entities.json");
writeFileSync(tmp, "[]\n", "utf8");
const crudScript = fileURLToPath(new URL("./crud.js", import.meta.url));
const crud = spawnSync(process.execPath, [crudScript], {
  env: { ...process.env, GTA7_ENTITIES_FILE: tmp },
  encoding: "utf8"
});
check("CRUD passou", crud.status === 0, (crud.stderr || crud.stdout || "").trim().split("\n").slice(-3));

console.log(failures === 0 ? "\nTudo ok.\n" : `\n${failures} verificação(ões) falharam.\n`);
process.exit(failures === 0 ? 0 : 1);
