import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubConfig, writeGithubJson } from "./github-file.js";
import { EntitySchema, type Entity } from "./types.js";
// Importado como módulo, e não só lido do disco: assim o registro entra no
// grafo de módulos e sobrevive a ambientes que empacotam só isso (Vercel).
import seed from "../data/entities.json" with { type: "json" };

/**
 * Persistência local em JSON (sem banco). O arquivo em disco manda quando
 * existe — é o caso rodando local, e é o que as tools de escrita atualizam.
 * Sem ele, vale o seed importado acima. Em filesystem somente-leitura
 * (Vercel) as escritas falham e o registro vale só em memória.
 */

const FILE_NAME = join("data", "entities.json");

/**
 * Raiz do pacote: primeiro ancestral com package.json. Ancorar aí evita achar
 * a cópia de `data/` que o tsc emite dentro de `dist/` por causa do import.
 */
function findDataFile(): string {
  if (process.env.GTA7_ENTITIES_FILE) return resolve(process.env.GTA7_ENTITIES_FILE);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return join(dir, FILE_NAME);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), FILE_NAME);
}

const DATA_FILE = findDataFile();

let cache: Entity[] | null = null;
let writable = true;

function load(): Entity[] {
  if (cache) return cache;
  let parsed: unknown = seed;
  try {
    if (existsSync(DATA_FILE)) parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`[registry] falha ao ler ${DATA_FILE}, usando o seed embutido:`, err);
  }
  const list = Array.isArray(parsed) ? parsed : [];
  cache = list.flatMap((raw, i) => {
    const r = EntitySchema.safeParse(raw);
    if (!r.success) {
      console.error(`[registry] entidade inválida no índice ${i}, ignorada:`, r.error.issues[0]?.message);
      return [];
    }
    return [r.data];
  });
  return cache;
}

function persist(): { persisted: boolean; warning?: string } {
  if (!writable) return { persisted: false, warning: "filesystem somente-leitura: alteração vale apenas em memória" };
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(cache ?? [], null, 2) + "\n", "utf8");
    return { persisted: true };
  } catch (err) {
    writable = false;
    return {
      persisted: false,
      warning: `não foi possível gravar ${DATA_FILE} (${(err as Error).message}); alteração vale apenas em memória`
    };
  }
}

export function dataFilePath(): string {
  return DATA_FILE;
}

export function listEntities(opts: { enabledOnly?: boolean } = {}): Entity[] {
  const all = load();
  return opts.enabledOnly ? all.filter(e => e.enabled) : [...all];
}

export function getEntity(id: string): Entity | undefined {
  return load().find(e => e.id === id);
}

export function registerEntity(input: unknown): { entity: Entity; warning?: string } {
  const entity = EntitySchema.parse(input);
  const all = load();
  if (all.some(e => e.id === entity.id)) {
    throw new Error(`já existe uma entidade com id '${entity.id}'; use update_entity`);
  }
  all.push(entity);
  const { warning } = persist();
  return { entity, warning };
}

export function updateEntity(id: string, patch: Record<string, unknown>): { entity: Entity; warning?: string } {
  const all = load();
  const idx = all.findIndex(e => e.id === id);
  if (idx === -1) throw new Error(`entidade '${id}' não encontrada`);
  const merged = { ...all[idx], ...patch, id };
  const entity = EntitySchema.parse(merged);
  all[idx] = entity;
  const { warning } = persist();
  return { entity, warning };
}

export function removeEntity(id: string): { removed: Entity; warning?: string } {
  const all = load();
  const idx = all.findIndex(e => e.id === id);
  if (idx === -1) throw new Error(`entidade '${id}' não encontrada`);
  const [removed] = all.splice(idx, 1);
  const { warning } = persist();
  return { removed, warning };
}

/** usado nos testes para recarregar do disco */
export function resetCache(): void {
  cache = null;
  writable = true;
}

/** raiz do pacote do Core (pasta que contém data/) — usada como cwd de entidades stdio */
export function packageRoot(): string {
  return dirname(dirname(DATA_FILE));
}

/**
 * Admite uma entidade de verdade: entra no cache desta instância e é gravada
 * no `data/entities.json` do repositório, quando há token.
 *
 * Sem `[skip ci]` de propósito. O registro viaja no bundle do deploy, então
 * admitir uma entidade precisa gerar um deploy novo — senão a entidade some
 * na próxima instância que subir.
 */
export async function commitEntity(entity: Entity): Promise<{ deployed: boolean; warning?: string }> {
  const all = load();
  const idx = all.findIndex(e => e.id === entity.id);
  if (idx >= 0) all[idx] = entity;
  else all.push(entity);

  const cfg = githubConfig(join("data", "entities.json").split("\\").join("/"));
  if (!cfg) {
    const { warning } = persist();
    return { deployed: false, warning };
  }

  try {
    await writeGithubJson(cfg, all, `${entity.name} entra na cidade`, { skipDeploy: false });
    return { deployed: true };
  } catch (err) {
    console.error("[registro] falha ao gravar no repositório:", err);
    return { deployed: false, warning: "somente-leitura" };
  }
}
