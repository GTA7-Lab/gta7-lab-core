/**
 * Prova a fundação de agentes: criar, salvar, recarregar, mudar estado, gerar
 * RequestContext e rodar o ciclo. Roda contra um arquivo temporário, então não
 * mexe nos moradores de verdade.
 *
 *   GTA7_RESIDENTS_FILE=<tmp> node dist/scripts/agents-check.js
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.GTA7_RESIDENTS_FILE) {
  const tmp = join(mkdtempSync(join(tmpdir(), "gta7-agents-")), "residents.json");
  writeFileSync(tmp, "[]\n", "utf8");
  process.env.GTA7_RESIDENTS_FILE = tmp;
}

const { addResident, getResident } = await import("../src/residents.js");
const { ResidentAgent } = await import("../src/agents/resident-agent.js");

let falhas = 0;
function check(label: string, cond: unknown, detalhe?: unknown): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    falhas++;
    console.log(`  FALHOU  ${label}${detalhe === undefined ? "" : ` -> ${JSON.stringify(detalhe)}`}`);
  }
}

console.log("\n[0] contratos vêm do pacote, não de cópia local");
{
  const { readdirSync, readFileSync, statSync, existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  // Subir níveis fixos daria `dist/src` quando rodando compilado, e aí a varredura
  // olharia código gerado em vez do fonte. Ancorar no package.json acerta nos dois.
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  const raiz = join(dir, "src");

  // O contrato do RequestContext mora em gta7-shared. Uma cópia local aqui
  // volta a divergir do que as Entities leem, e é o tipo de coisa que ninguém
  // percebe até duas pontas discordarem do formato.
  const duplicatas: string[] = [];
  const varrer = (dir: string): void => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      // Ancorado no início da linha: `import { type RequestContext }` não é
      // declaração, é justamente o uso que queremos.
      else if (nome.endsWith(".ts") && /^\s*(export\s+)?(interface|type)\s+RequestContext\b/m.test(readFileSync(caminho, "utf8"))) {
        duplicatas.push(nome);
      }
    }
  };
  varrer(raiz);
  check("nenhuma definição local de RequestContext", duplicatas.length === 0, duplicatas);

  const shared = await import("gta7-shared");
  check("o pacote exporta o contrato", typeof shared.createRequestContext === "function");
}

console.log("\n[1] criar morador e carregar como agente");
await addResident({ id: "maria", name: "Maria", bairro: "Marina", interesses: ["music"] });
const maria = await ResidentAgent.load("maria");
check("agente carregou da ficha do morador", maria !== undefined);
if (!maria) process.exit(1);
check("defaults de agente aplicados", maria.status === "active" && maria.type === "resident", {
  status: maria.status,
  type: maria.type
});
check("carteira começa zerada", maria.wallet.balance === 0);

console.log("\n[2] componentes");
maria.wallet.credit(500);
maria.wallet.debit(120);
check("carteira credita e debita", maria.wallet.balance === 380, maria.wallet.balance);
let barrou = false;
try {
  maria.wallet.debit(10_000);
} catch {
  barrou = true;
}
check("carteira recusa gastar mais do que tem", barrou);

maria.inventory.add("ingresso-show-001", 2, "Ingresso Black Horizon");
maria.inventory.remove("ingresso-show-001", 1);
check("mochila soma e subtrai", maria.inventory.quantityOf("ingresso-show-001") === 1);

maria.memory.remember("teste", "primeira lembrança");
check("memória guarda e devolve a mais recente", maria.memory.recent(1)[0]?.text === "primeira lembrança");

console.log("\n[3] estado");
maria.moveTo("rock-venue");
maria.addGoal("ver um show de music");
maria.adjustNeed("fun", 30);
check("mudou de lugar", maria.location === "rock-venue");
check("necessidade fica no teto de 100", maria.needs.fun === 80, maria.needs);

console.log("\n[4] RequestContext");
const ctx = maria.createRequestContext();
check("identifica quem pede", ctx.requesterId === "maria" && ctx.requesterType === "resident", ctx);
check("leva papel e lugar", ctx.roles?.[0] === "customer" && ctx.location === "rock-venue", ctx);
check("carimba a origem", ctx.source === "gta7-lab-city", ctx);
check("é serializável", JSON.parse(JSON.stringify(ctx)).requesterId === "maria");

console.log("\n[5] salvar e recarregar");
await maria.save();
const recarregada = await ResidentAgent.load("maria");
check("saldo sobreviveu", recarregada?.wallet.balance === 380, recarregada?.wallet.balance);
check("mochila sobreviveu", recarregada?.inventory.quantityOf("ingresso-show-001") === 1);
check("lugar sobreviveu", recarregada?.location === "rock-venue");
// Duas: a lembrança de teste e a mudança de lugar. `addGoal` e `adjustNeed`
// não registram nada de propósito — ninguém quer memória de cada ajuste de fome.
check("memória sobreviveu", (recarregada?.memory.size ?? 0) === 2, recarregada?.memory.size);
check("ficha original intacta", (await getResident("maria"))?.bairro === "Marina");

console.log("\n[6] ciclo perceber -> decidir -> agir");
const percepcao = recarregada!.perceive();
const decisao = await recarregada!.decide(percepcao);
console.log(`  decidiu: ${decisao.kind} — ${decisao.reason}`);
check("decidiu algo coerente", ["call_entity", "idle"].includes(decisao.kind));
const resultado = await recarregada!.act(decisao);
check("agir devolveu resultado", resultado !== undefined);
check("a ação virou memória", recarregada!.memory.recent(1).length === 1);

console.log(falhas === 0 ? "\nTudo ok.\n" : `\n${falhas} verificação(ões) falharam.\n`);
process.exit(falhas === 0 ? 0 : 1);
