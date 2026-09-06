# GTA7 Lab — Core Orchestrator

A cidade da GTA7 Lab como servidor MCP. Ele conhece as entidades registradas, chama as
MCP tools delas e combina os resultados em uma única resposta.

## Rodando

```bash
npm install
npm run build
npm run smoke
```

`npm run smoke` sobe as duas entidades demo, descobre as tools delas por MCP, roda três
pedidos de exemplo e verifica o CRUD do registro.

## Tools do Core

| Tool | Para quê |
|---|---|
| `list_entities` / `get_entity` | ler o registro |
| `register_entity` / `update_entity` / `remove_entity` | CRUD do registro |
| `submit_entity` / `submission_status` | uma entidade pede para entrar, e acompanha |
| `list_submissions` / `approve_entity` / `deny_entity` | decidir quem entra |
| `list_residents` … `remove_resident` | CRUD de moradores |
| `list_city_tools` | tools que as entidades expõem **agora** (compara com o registro) |
| `call_entity_tool` | proxy direto para uma tool de uma entidade |
| `plan_request` | mostra o plano sem executar nada |
| `orchestrate` | plano + execução + combinação |

## Conectando o Core

**Claude Desktop / Claude Code** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gta7-lab-city": {
      "command": "node",
      "args": ["C:/caminho/para/gta7-lab-city/dist/src/stdio.js"]
    }
  }
}
```

**Via HTTP** (ChatGPT, Claude connectors): `POST https://gta7-lab-city.vercel.app/mcp`.

O endereço antigo `gta7-lab-core.vercel.app/mcp` serve o mesmo projeto e continua válido.
Se um conector travar mostrando uma lista de tools velha, adicioná-lo pelo outro endereço
força uma descoberta nova — o servidor também atende em `/api/mcp`.

## Palavra mágica

O endpoint MCP é público, então as tools que **alteram** o registro — `register_entity`,
`update_entity` e `remove_entity` — exigem a palavra mágica da cidade, conferida contra a
variável de ambiente `GTA7_MAGIC_WORD`. Sem ela definida, ninguém altera nada, inclusive
rodando local:

```bash
GTA7_MAGIC_WORD=escolha-uma npm run dev
```

Na Vercel, defina em Settings → Environment Variables. Consultar a cidade e orquestrar
pedidos continua livre para qualquer um.

As tools de **morador** (`list_residents`, `get_resident`, `register_resident`,
`update_resident`, `remove_resident`) pedem a palavra mágica **até para ler**: entidade é
serviço público da cidade, morador é gente.

## Moradores gravam no próprio repositório

O filesystem da Vercel é somente-leitura, então cadastrar um morador em produção precisa
de outro lugar para gravar. Em vez de um banco, o Core escreve `data/residents.json` de
volta neste repositório, pela API do GitHub — cada cadastro vira um commit, com `[skip ci]`
para não disparar um deploy.

Defina `GTA7_GITHUB_TOKEN` com um token de acesso que tenha permissão de **Contents:
read and write** neste repositório. Sem ele, o Core grava no arquivo local, que é o
comportamento em desenvolvimento.

O repositório é público, então **a lista de moradores é pública**. Não guarde aí nada
que não possa ser lido por qualquer um.

## Registrando uma entidade

A entidade pede sozinha, pela tool `submit_entity` — não precisa de senha. Ela informa
apenas como chegar nela e em que tipo de pedido entra:

```json
{
  "id": "cinema",
  "name": "Cinema Central",
  "description": "Cinema da GTA7 Lab",
  "endpoint": "https://cinema.example/mcp",
  "tags": ["movie", "activity"],
  "contato": "quem procurar em caso de dúvida"
}
```

**Não declare suas tools.** O Core conecta no seu endpoint e descobre pelo próprio MCP o
que você sabe fazer. Ele chama sozinho só o que parece vitrine: nome de verbo de catálogo,
**sem parâmetro obrigatório**, e que não seja dado de cliente. Se nada seu se encaixar, o
pedido é recusado na hora com o motivo — porque você entraria na cidade e nunca seria
acionado.

As **`tags`** decidem em que pedidos você é chamado. Peça só as suas: elas são recurso
compartilhado, e quem reivindica demais aparece em tudo e atrapalha os outros. Para uma
tag que ainda não existe, ela precisa entrar em `src/lexicon.ts`.

Os **argumentos** são casados por apelido contra o schema das suas tools — `partySize`,
`groupSize` e `seats` são todos entendidos como "quantidade de pessoas", e o Core só
envia quando o tipo bate.

Sua entidade não precisa seguir schema de resposta. O Core aceita um array direto, um
objeto com `items`/`results`/`data`, ou qualquer envelope com uma lista dentro, e
reconhece apelidos comuns de campo (`name`/`nome`/`title`/`band`,
`pricePerPerson`/`ticketPrice`/`preco`, `capacity`/`capacidade`, `area`/`bairro`).
Devolver uma área e um preço por pessoa faz você aparecer nas combinações.

Entrar de verdade depende da aprovação de quem cuida da cidade.

## Deploy na Vercel

O Core está na raiz do repo e a Vercel usa `src/server.ts` como entrypoint do servidor.

```bash
npx vercel deploy --prod
```

O filesystem da Vercel é somente-leitura: em produção as tools de escrita do registro
valem só durante a requisição e devolvem um `warning`. Para mudar o registro publicado,
edite `data/entities.json` e faça deploy.

## Entidades demo

`src/entities/restaurants.ts` e `src/entities/venues.ts` existem só para desenvolvimento,
para o Core ter dois servidores MCP reais com que conversar. Substitua-as pelas entidades
dos participantes quando elas estiverem no ar.
