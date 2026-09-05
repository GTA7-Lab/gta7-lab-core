/**
 * Guarda um arquivo JSON no próprio repositório da cidade, pela API do GitHub.
 *
 * É o que permite cadastrar morador em produção: o filesystem da Vercel é
 * somente-leitura, mas o repo aceita escrita. Cada alteração vira um commit, e
 * o JSON continua sendo a fonte da verdade — sem banco, e com histórico de
 * quem entrou e saiu da cidade de brinde.
 *
 * Os commits levam `[skip ci]` para não disparar um deploy a cada cadastro.
 */

const API = "https://api.github.com";

export interface GithubFileConfig {
  token: string;
  repo: string; // "owner/name"
  branch: string;
  path: string;
}

/** Devolve a configuração se o ambiente tiver tudo; senão, undefined. */
export function githubConfig(path: string): GithubFileConfig | undefined {
  const token = process.env.GTA7_GITHUB_TOKEN?.trim();
  if (!token) return undefined;
  return {
    token,
    repo: process.env.GTA7_GITHUB_REPO?.trim() || "GTA7-Lab/gta7-lab-core",
    branch: process.env.GTA7_GITHUB_BRANCH?.trim() || "main",
    path
  };
}

function headers(cfg: GithubFileConfig): Record<string, string> {
  return {
    authorization: `Bearer ${cfg.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "gta7-lab-city"
  };
}

function url(cfg: GithubFileConfig): string {
  return `${API}/repos/${cfg.repo}/contents/${cfg.path}`;
}

export interface RemoteFile {
  value: unknown;
  /** sha do blob atual; necessário para sobrescrever sem atropelar ninguém */
  sha?: string;
}

/** Lê o arquivo. Arquivo inexistente devolve `{ value: undefined }`, não erro. */
export async function readGithubJson(cfg: GithubFileConfig): Promise<RemoteFile> {
  const res = await fetch(`${url(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(cfg) });
  if (res.status === 404) return { value: undefined };
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao ler ${cfg.path}`);

  const body = (await res.json()) as { content?: string; sha?: string };
  if (!body.content) return { value: undefined, sha: body.sha };
  const texto = Buffer.from(body.content, "base64").toString("utf8");
  try {
    return { value: JSON.parse(texto), sha: body.sha };
  } catch {
    throw new Error(`o conteúdo de ${cfg.path} no repositório não é JSON válido`);
  }
}

/**
 * Grava o arquivo. Se alguém tiver escrito no meio do caminho, o GitHub recusa
 * pelo sha e nós relemos e tentamos de novo — uma vez só, para não insistir
 * num conflito de verdade.
 */
export async function writeGithubJson(cfg: GithubFileConfig, value: unknown, message: string): Promise<void> {
  const enviar = async (sha?: string): Promise<Response> =>
    fetch(url(cfg), {
      method: "PUT",
      headers: { ...headers(cfg), "content-type": "application/json" },
      body: JSON.stringify({
        message: `${message} [skip ci]`,
        content: Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8").toString("base64"),
        branch: cfg.branch,
        sha
      })
    });

  const atual = await readGithubJson(cfg);
  let res = await enviar(atual.sha);

  if (res.status === 409 || res.status === 422) {
    const novamente = await readGithubJson(cfg);
    res = await enviar(novamente.sha);
  }

  if (!res.ok) {
    throw new Error(`GitHub respondeu ${res.status} ao gravar ${cfg.path}`);
  }
}
