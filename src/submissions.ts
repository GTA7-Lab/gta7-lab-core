import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { listEntityTools } from "./client.js";
import { githubConfig, readGithubJson, writeGithubJson } from "./github-file.js";
import { searchToolsOf } from "./discovery.js";
import type { Entity } from "./types.js";
import seed from "../data/submissions.json" with { type: "json" };

/**
 * Fila de entidades pedindo para entrar na cidade.
 *
 * Cadastrar não é ser admitido: qualquer entidade envia o pedido sozinha, sem
 * segredo nenhum, mas quem admite é a cidade. Duas razões para não aceitar
 * direto:
 *
 *  - as `tags` são um recurso compartilhado. Uma entidade que reivindica meia
 *    dúzia delas passa a ser chamada em quase todo pedido e polui o resultado
 *    das outras. Esse julgamento não dá para automatizar.
 *  - a palavra mágica que hoje protege o registro protege tudo junto. Se ela
 *    circulasse para as entidades se cadastrarem, quem entra também consegue
 *    remover as outras.
 *
 * O que dá para automatizar é a checagem de honestidade: antes de entrar na
 * fila, o Core conecta no endpoint declarado e confere que as tools existem
 * mesmo. Entidade que promete o que não tem é recusada na hora.
 */

export const SubmissionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "o apelido deve ser minúsculo, sem espaços nem acentos"),
  name: z.string().min(1),
  description: z.string().default(""),
  /** só http: a cidade fala com as entidades pela rede, nunca rodando processo local */
  endpoint: z.string().url(),
  tags: z.array(z.string()).min(1),
  /** quem mandou, texto livre — ajuda a saber com quem falar */
  contato: z.string().optional(),
  enviadoEm: z.string().optional(),
  /** o que o MCP da entidade respondeu de verdade quando o Core conferiu */
  toolsVerificadas: z.array(z.string()).default([])
});

export type Submission = z.infer<typeof SubmissionSchema>;

const RELATIVE_PATH = "data/submissions.json";
const CACHE_TTL_MS = 15_000;

function findDataFile(): string {
  if (process.env.GTA7_SUBMISSIONS_FILE) return resolve(process.env.GTA7_SUBMISSIONS_FILE);
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

let cache: Submission[] | null = null;
let cacheAt = 0;

function parseList(parsed: unknown): Submission[] {
  const list = Array.isArray(parsed) ? parsed : [];
  return list.flatMap((raw, i) => {
    const r = SubmissionSchema.safeParse(raw);
    if (!r.success) {
      console.error(`[pedidos] pedido inválido no índice ${i}, ignorado:`, r.error.issues[0]?.message);
      return [];
    }
    return [r.data];
  });
}

async function load(): Promise<Submission[]> {
  const cfg = githubConfig(RELATIVE_PATH);

  if (cfg) {
    if (cache !== null && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
    try {
      const { value } = await readGithubJson(cfg);
      cache = parseList(value ?? seed);
      cacheAt = Date.now();
      return cache;
    } catch (err) {
      console.error("[pedidos] falha ao ler do repositório, usando o que já tinha:", err);
      return cache ?? parseList(seed);
    }
  }

  if (cache) return cache;
  let parsed: unknown = seed;
  try {
    if (existsSync(DATA_FILE)) parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`[pedidos] falha ao ler ${DATA_FILE}:`, err);
  }
  cache = parseList(parsed);
  return cache;
}

async function persist(pedidos: Submission[], message: string): Promise<{ warning?: string }> {
  const cfg = githubConfig(RELATIVE_PATH);
  if (cfg) {
    try {
      // `[skip ci]`: a fila muda muito e não vale um deploy por pedido.
      await writeGithubJson(cfg, pedidos, message, { skipDeploy: true });
      cacheAt = Date.now();
      return {};
    } catch (err) {
      console.error("[pedidos] falha ao gravar no repositório:", err);
      return { warning: "somente-leitura" };
    }
  }
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(pedidos, null, 2) + "\n", "utf8");
    return {};
  } catch {
    return { warning: "somente-leitura" };
  }
}

export async function listSubmissions(): Promise<Submission[]> {
  return [...(await load())];
}

export async function getSubmission(id: string): Promise<Submission | undefined> {
  return (await load()).find(s => s.id === id);
}

export interface VerificationFailure {
  ok: false;
  reason: string;
}

/**
 * Conecta no MCP declarado e confere que as tools prometidas existem. É o que
 * permite deixar o envio aberto: a cidade não acredita na descrição, ela olha.
 */
export async function verifySubmission(
  pedido: Submission
): Promise<{ ok: true; toolsVerificadas: string[] } | VerificationFailure> {
  const comoEntidade = {
    id: pedido.id,
    name: pedido.name,
    description: pedido.description,
    transport: "http" as const,
    endpoint: pedido.endpoint,
    args: [],
    tags: pedido.tags,
    enabled: true
  } satisfies Entity;

  let aoVivo: Awaited<ReturnType<typeof listEntityTools>>;
  try {
    aoVivo = await listEntityTools(comoEntidade);
  } catch (err) {
    return {
      ok: false,
      reason: `não consegui falar com o MCP em ${pedido.endpoint} (${(err as Error).message}). Confira se está no ar e sem proteção de acesso.`
    };
  }

  if (aoVivo.length === 0) {
    return { ok: false, reason: "o MCP respondeu, mas não expõe tool nenhuma." };
  }

  // A entidade não declara mais quais tools tem — o MCP informa. O que o Core
  // precisa checar é se sobra alguma que ele possa chamar por conta própria ao
  // atender um pedido; sem isso, ela entraria na cidade e nunca seria acionada.
  const vitrine = await searchToolsOf(comoEntidade);
  if (vitrine.length === 0) {
    return {
      ok: false,
      reason:
        "nenhuma das tools serve como vitrine: o Core só chama sozinho o que dá para chamar sem argumento " +
        `obrigatório e que não seja dado de cliente. O MCP oferece: ${aoVivo.map(t => t.name).join(", ")}.`
    };
  }

  return { ok: true, toolsVerificadas: aoVivo.map(t => t.name) };
}

export async function addSubmission(pedido: Submission): Promise<{ warning?: string }> {
  const todos = await load();
  const idx = todos.findIndex(s => s.id === pedido.id);
  if (idx >= 0) todos[idx] = pedido;
  else todos.push(pedido);
  return persist(todos, `${pedido.name} pede para entrar na cidade`);
}

export async function removeSubmission(id: string, motivo: string): Promise<{ warning?: string }> {
  const todos = await load();
  const idx = todos.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`não há pedido de '${id}' na fila`);
  const [pedido] = todos.splice(idx, 1);
  return persist(todos, `${motivo}: ${pedido.name}`);
}

/** O pedido aprovado vira o registro da entidade. */
export function submissionToEntity(pedido: Submission): Entity {
  return {
    id: pedido.id,
    name: pedido.name,
    description: pedido.description,
    transport: "http",
    endpoint: pedido.endpoint,
    args: [],
    tags: pedido.tags,
    enabled: true
  };
}

export function resetSubmissionsCache(): void {
  cache = null;
  cacheAt = 0;
}
