# GTA7 Lab — Core Orchestrator (a cidade)

## Objetivo
Este repositório **é a cidade** da GTA7 Lab, não uma entidade. Ele é um servidor MCP
(consumido por Claude/ChatGPT) que também age como **cliente MCP** das entidades
registradas (restaurante, casa de shows, cinema, hotel, transporte...), escolhe quais
entidades atendem um pedido, chama as tools delas e combina os resultados.

## Onde isto vive
`GTA7-Lab/gta7-lab-core` tem só o Core, na raiz — na Vercel, sem Root Directory especial.
As entidades ficam em `GTA7-Lab/gta7-lab`, uma pasta cada em `entities/<id>/`. O Core não
depende daquele repo em tempo de execução: fala com as entidades pelos endpoints MCP
registrados em `data/entities.json`.

| Entidade | MCP |
|---|---|
| `bank` | http em `/api/mcp` |
| `supermercado` | http (streamable) em `/api/mcp` |
| `icecream` | http (streamable) em `/api/mcp`, e stdio local |
| `restaurante-ai-q-fome` | stdio |

## Arquitetura
```
pedido em linguagem natural
  -> slots.ts      extrai people / maxPricePerPerson / when / near  (regex)
  -> lexicon.ts    detecta tags de capacidade                       (palavra-chave -> tag)
  -> orchestrator  escolhe entidades por interseção de tags, traduz slots via argsMap
  -> client.ts     conecta nos MCPs das entidades e chama as tools em paralelo
  -> orchestrator  aplica restrições nos itens e monta combinações entre entidades
```
Nada de agente autônomo: o plano é determinístico e inspecionável por `plan_request`
antes de qualquer chamada.

## Arquivos principais
| Arquivo | Papel |
|---|---|
| `src/types.ts` | schemas zod de `Entity`, slots canônicos, tipos de plano/resultado |
| `src/registry.ts` | CRUD do registro, persistido em `data/entities.json` |
| `src/lexicon.ts` | palavra-chave -> tag, e expansão de tags genéricas (`activity`) |
| `src/slots.ts` | extração de restrições do texto |
| `src/client.ts` | pool de clientes MCP (http e stdio) + normalização de resultados |
| `src/orchestrator.ts` | plano, execução, filtros e combinações |
| `src/mcp-server.ts` | as 9 MCP tools do Core |
| `src/stdio.ts` | entrypoint local (stdio) |
| `api/mcp.ts` | entrypoint HTTP para a Vercel (`/mcp`, streamable http stateless) |
| `src/entities/*.ts` | duas entidades **demo** locais, só para desenvolvimento |
| `scripts/smoke.ts` | prova os critérios de sucesso ponta a ponta |

## Decisões importantes
- **`argsMap` no registro** — o Core tem slots canônicos (`query`, `people`,
  `maxPricePerPerson`, `when`, `near`, `limit`) e cada entidade mapeia esses slots para
  os nomes de parâmetro das próprias tools. É isso que mantém o orquestrador genérico:
  adicionar uma entidade é editar JSON, não código.
- **`kind: "search"`** marca as tools que o orquestrador pode chamar sozinho. O resto só
  por `call_entity_tool`.
- **Filtro depois da chamada** — o Core reaplica pessoas/orçamento sobre os itens, então
  a restrição vale mesmo se a entidade ignorar os parâmetros. Item sem o campo passa.
- **Campos com apelidos** — `name/nome/title`, `pricePerPerson/ticketPrice/preco`,
  `capacity/capacidade`, `area/bairro/neighborhood`. Entidade não precisa seguir schema.
- **Persistência em JSON.** Sem banco, sem auth, sem Docker. Na Vercel o filesystem é
  somente-leitura: as tools de escrita valem só durante a requisição e devolvem `warning`.

## Formato de registro (`data/entities.json`)
```json
{
  "id": "restaurants",
  "name": "Restaurants",
  "description": "Serviço de restaurantes da GTA7 Lab",
  "transport": "http",
  "endpoint": "https://restaurants.example/mcp",
  "tags": ["food"],
  "tools": [
    { "name": "search_restaurants", "kind": "search",
      "argsMap": { "query": "query", "people": "partySize", "maxPricePerPerson": "maxPrice" } },
    { "name": "get_restaurant", "kind": "detail", "argsMap": {} }
  ],
  "enabled": true
}
```
`transport: "stdio"` usa `command` + `args` no lugar de `endpoint`.
Tags conhecidas: `food, music, movie, event, lodging, transport, grocery, dessert, activity` (`src/lexicon.ts`).

## Status
`npm run build && npm run smoke` passa. Registro atual: duas entidades demo (stdio) mais
`supermercado` e `icecream` (Sorveteria Polar), entidades reais por MCP http.
`icecream` responde em https://gta7-icecream.vercel.app/api/mcp e trouxe a tag `dessert`.
O deploy do Core na Vercel ainda não aconteceu.

## Problema conhecido
O Core manda a **frase inteira** do usuário no slot `query`. Entidades que filtram por
token devolvem vazio para pedidos genéricos: "Preciso fazer compras no mercado" traz 0
produtos, enquanto `query: "arroz"` traz o item certo. As entidades demo disfarçam isso
porque ignoram `query` quando ela não casa com nada. A correção é do lado do Core —
limpar as palavras de intenção antes de mandar, ou não mandar `query` quando sobra só
intenção.

## Próxima tarefa
1. Resolver o `query` acima.
2. Registrar `bank` (MCP http em `/api/mcp`) — hoje bloqueado: o deploy dele está com
   Vercel Authentication ligada e responde 302 para SSO.
3. `icecream` e `restaurante-ai-q-fome` são stdio; valem no Core local.
4. Publicar o Core: depende do GitHub App da Vercel ter acesso ao repo e da integração
   MCP enxergar o projeto. Root Directory = `core`.
