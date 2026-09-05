import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { githubConfig, readGithubJson, writeGithubJson } from "./github-file.js";
import seed from "../data/residents.json" with { type: "json" };

/**
 * Moradores da cidade.
 *
 * Duas formas de guardar, escolhidas pelo ambiente:
 *  - com `GTA7_GITHUB_TOKEN`, o arquivo vive no repositório da cidade e cada
 *    alteração vira um commit. É assim que cadastrar morador funciona em
 *    produção, onde o filesystem da Vercel é somente-leitura.
 *  - sem o token, vale `data/residents.json` no disco, que é o caso local.
 *
 * O seed importado é a rede de segurança: se as duas falharem, a cidade ainda
 * responde com o que foi para o deploy, em vez de fingir que não há ninguém.
 *
 * Ao contrário do registro de entidades, aqui até a leitura pede a palavra
 * mágica (ver `mcp-server.ts`): morador é gente, não serviço público.
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

const RELATIVE_PATH = "data/residents.json";
const CACHE_TTL_MS = 30_000;

function findDataFile(): string {
  if (process.env.GTA7_RESIDENTS_FILE) return resolve(process.env.GTA7_RESIDENTS_FILE);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return join(dir, ...RELATIVE_PATH.split("/"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), ...RELATIVE_PATH.split("/"));
}

const DATA_FILE = findDataFile();

let cache: Resident[] | null = null;
let cacheAt = 0;

function parseList(parsed: unknown): Resident[] {
  const list = Array.isArray(parsed) ? parsed : [];
  return list.flatMap((raw, i) => {
    const r = ResidentSchema.safeParse(raw);
    if (!r.success) {
      console.error(`[moradores] morador inválido no índice ${i}, ignorado:`, r.error.issues[0]?.message);
      return [];
    }
    return [r.data];
  });
}

async function load(): Promise<Resident[]> {
  const cfg = githubConfig(RELATIVE_PATH);

  if (cfg) {
    const fresco = cache !== null && Date.now() - cacheAt < CACHE_TTL_MS;
    if (fresco) return cache!;
    try {
      const { value } = await readGithubJson(cfg);
      cache = parseList(value ?? seed);
      cacheAt = Date.now();
      return cache;
    } catch (err) {
      console.error("[moradores] falha ao ler do repositório, usando o que já tinha:", err);
      return cache ?? parseList(seed);
    }
  }

  if (cache) return cache;
  let parsed: unknown = seed;
  try {
    if (existsSync(DATA_FILE)) parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`[moradores] falha ao ler ${DATA_FILE}, usando o seed embutido:`, err);
  }
  cache = parseList(parsed);
  return cache;
}

async function persist(moradores: Resident[], message: string): Promise<{ warning?: string }> {
  const cfg = githubConfig(RELATIVE_PATH);

  if (cfg) {
    try {
      await writeGithubJson(cfg, moradores, message);
      cacheAt = Date.now();
      return {};
    } catch (err) {
      console.error("[moradores] falha ao gravar no repositório:", err);
      return { warning: "somente-leitura" };
    }
  }

  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(moradores, null, 2) + "\n", "utf8");
    return {};
  } catch {
    return { warning: "somente-leitura" };
  }
}

export async function listResidents(): Promise<Resident[]> {
  return [...(await load())];
}

export async function getResident(id: string): Promise<Resident | undefined> {
  return (await load()).find(r => r.id === id);
}

export async function addResident(input: unknown): Promise<{ resident: Resident; warning?: string }> {
  const resident = ResidentSchema.parse(input);
  const all = await load();
  if (all.some(r => r.id === resident.id)) {
    throw new Error(`já mora alguém na cidade com o apelido '${resident.id}'`);
  }
  if (!resident.desde) resident.desde = new Date().toISOString().slice(0, 10);
  all.push(resident);
  return { resident, ...(await persist(all, `${resident.name} entra na cidade`)) };
}

export async function updateResident(
  id: string,
  patch: Record<string, unknown>
): Promise<{ resident: Resident; warning?: string }> {
  const all = await load();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`não encontrei ninguém com o apelido '${id}' na cidade`);
  const resident = ResidentSchema.parse({ ...all[idx], ...patch, id });
  all[idx] = resident;
  return { resident, ...(await persist(all, `Atualiza ${resident.name}`)) };
}

export async function removeResident(id: string): Promise<{ resident: Resident; warning?: string }> {
  const all = await load();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`não encontrei ninguém com o apelido '${id}' na cidade`);
  const [resident] = all.splice(idx, 1);
  return { resident, ...(await persist(all, `${resident.name} sai da cidade`)) };
}

export function resetResidentsCache(): void {
  cache = null;
  cacheAt = 0;
}
