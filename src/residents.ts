import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import seed from "../data/residents.json" with { type: "json" };

/**
 * Moradores da cidade. Mesma persistência das entidades: JSON em disco quando
 * existe, seed importado quando não — o import garante que o arquivo viaje no
 * bundle da Vercel. Ao contrário do registro de entidades, aqui até a leitura
 * pede a palavra mágica: morador é gente, não serviço público.
 */

export const ResidentSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "o apelido deve ser minúsculo, sem espaços nem acentos"),
  name: z.string().min(1),
  bio: z.string().default(""),
  /** bairro onde mora; combina com a `area` que as entidades devolvem */
  bairro: z.string().optional(),
  /** o que a pessoa gosta, usando as mesmas tags da cidade (food, music, ...) */
  interesses: z.array(z.string()).default([]),
  desde: z.string().optional()
});

export type Resident = z.infer<typeof ResidentSchema>;

const FILE_NAME = join("data", "residents.json");

function findDataFile(): string {
  if (process.env.GTA7_RESIDENTS_FILE) return resolve(process.env.GTA7_RESIDENTS_FILE);
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

let cache: Resident[] | null = null;
let writable = true;

function load(): Resident[] {
  if (cache) return cache;
  let parsed: unknown = seed;
  try {
    if (existsSync(DATA_FILE)) parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`[moradores] falha ao ler ${DATA_FILE}, usando o seed embutido:`, err);
  }
  const list = Array.isArray(parsed) ? parsed : [];
  cache = list.flatMap((raw, i) => {
    const r = ResidentSchema.safeParse(raw);
    if (!r.success) {
      console.error(`[moradores] morador inválido no índice ${i}, ignorado:`, r.error.issues[0]?.message);
      return [];
    }
    return [r.data];
  });
  return cache;
}

function persist(): { warning?: string } {
  if (!writable) return { warning: "somente-leitura" };
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(cache ?? [], null, 2) + "\n", "utf8");
    return {};
  } catch {
    writable = false;
    return { warning: "somente-leitura" };
  }
}

export function listResidents(): Resident[] {
  return [...load()];
}

export function getResident(id: string): Resident | undefined {
  return load().find(r => r.id === id);
}

export function addResident(input: unknown): { resident: Resident; warning?: string } {
  const resident = ResidentSchema.parse(input);
  const all = load();
  if (all.some(r => r.id === resident.id)) {
    throw new Error(`já mora alguém na cidade com o apelido '${resident.id}'`);
  }
  if (!resident.desde) resident.desde = new Date().toISOString().slice(0, 10);
  all.push(resident);
  return { resident, ...persist() };
}

export function updateResident(id: string, patch: Record<string, unknown>): { resident: Resident; warning?: string } {
  const all = load();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`não encontrei ninguém com o apelido '${id}' na cidade`);
  const resident = ResidentSchema.parse({ ...all[idx], ...patch, id });
  all[idx] = resident;
  return { resident, ...persist() };
}

export function removeResident(id: string): { resident: Resident; warning?: string } {
  const all = load();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`não encontrei ninguém com o apelido '${id}' na cidade`);
  const [resident] = all.splice(idx, 1);
  return { resident, ...persist() };
}

export function resetResidentsCache(): void {
  cache = null;
  writable = true;
}
