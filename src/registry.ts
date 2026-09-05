import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EntitySchema, type Entity } from "./types.js";

/**
 * Persistência local em JSON (sem banco). Em ambientes com filesystem
 * somente-leitura (Vercel) as escritas falham silenciosamente e o registro
 * segue válido apenas em memória, durante a vida da função.
 */

const FILE_NAME = join("data", "entities.json");

function findDataFile(): string {
  if (process.env.GTA7_ENTITIES_FILE) return resolve(process.env.GTA7_ENTITIES_FILE);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // não encontrado: assume a raiz do processo (será criado na primeira escrita)
  return resolve(process.cwd(), FILE_NAME);
}

const DATA_FILE = findDataFile();

let cache: Entity[] | null = null;
let writable = true;

function load(): Entity[] {
  if (cache) return cache;
  let parsed: unknown = [];
  try {
    if (existsSync(DATA_FILE)) parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`[registry] falha ao ler ${DATA_FILE}:`, err);
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
