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
      "args": ["C:/caminho/para/gta7-lab/core/dist/src/stdio.js"]
    }
  }
}
```

**Via HTTP** (ChatGPT, Claude connectors): `POST https://<seu-deploy>.vercel.app/mcp`.

## Registrando uma entidade

Peça ao Claude/ChatGPT conectado ao Core, ou edite `data/entities.json` direto:

```json
{
  "id": "cinema",
  "name": "Cinema Central",
  "description": "Cinema da GTA7 Lab",
  "transport": "http",
  "endpoint": "https://cinema.example/mcp",
  "tags": ["movie", "activity"],
  "tools": [
    { "name": "search_sessions", "kind": "search",
      "argsMap": { "query": "q", "people": "seats", "maxPricePerPerson": "maxPrice", "when": "date" } }
  ],
  "enabled": true
}
```

Duas coisas importam:

- **`tags`** decidem quando o orquestrador aciona a entidade. Use as tags conhecidas
  (`food, music, movie, event, lodging, transport, activity`); para uma tag nova,
  acrescente as palavras-chave dela em `src/lexicon.ts`.
- **`argsMap`** traduz os slots canônicos do Core (`query`, `people`,
  `maxPricePerPerson`, `when`, `near`, `limit`) para os nomes de parâmetro da sua tool.
  Só entram no `argsMap` os slots que a tool realmente aceita.

Sua entidade não precisa seguir um schema de resposta. O Core lê `items`/`results`/`data`
ou um array direto, e reconhece apelidos comuns de campo (`name`/`nome`/`title`,
`pricePerPerson`/`ticketPrice`/`preco`, `capacity`/`capacidade`, `area`/`bairro`).
Devolver `area` e um preço por pessoa faz a entidade aparecer nas combinações.

## Deploy na Vercel

O projeto já vem com `vercel.json`; `api/mcp.ts` vira a função em `/mcp`.
Como o Core é uma subpasta do monorepo, o projeto na Vercel precisa de
**Root Directory = `core`**.

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
