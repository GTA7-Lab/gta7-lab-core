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
| `src/server.ts` | entrypoint HTTP (Vercel): `/mcp` streamable http stateless, e a landing |
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
- **Repetir a busca sem `query`** — o Core manda a frase inteira do usuário em `query`, e
  entidades que filtram por token não casam nada com ela. Quando uma busca volta vazia e
  havia `query`, o Core repete sem ela. Preserva a precisão de "arroz" e evita o vazio de
  "quero fazer compras", sem o Core precisar conhecer o vocabulário de cada entidade.
  Sai em `retriedWithoutQuery` no resultado.
- **Campos com apelidos** — `name/nome/title`, `pricePerPerson/ticketPrice/preco`,
  `capacity/capacidade`, `area/bairro/neighborhood`. Entidade não precisa seguir schema.
- **Persistência em JSON.** Sem banco, sem auth, sem Docker. Na Vercel o filesystem é
  somente-leitura: as tools de escrita valem só durante a requisição e devolvem `warning`.
- **Palavra mágica nas alterações** — `register_entity`, `update_entity` e `remove_entity`
  exigem `palavra_magica` conferida contra `GTA7_MAGIC_WORD` (`src/magic-word.ts`). O
  endpoint é público; sem isso qualquer um tira uma entidade do ar. Falha fechado: sem a
  variável definida, ninguém altera nada. Leitura e orquestração seguem livres.
- **Respostas em português, nunca JSON** — tudo passa por `src/present.ts` antes de sair.
  Quem lê do outro lado é uma pessoa, via Claude ou ChatGPT.

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
No ar em **https://gta7-lab-core.vercel.app/mcp** (Streamable HTTP), com deploy
automático a cada push. `npm run build && npm run smoke` passa. Registro: duas entidades
demo (stdio) mais `supermercado`, `icecream` e `bank`, reais, por MCP http.

## Armadilhas da Vercel (custaram caro, não repetir)
- O projeto usa o **preset de servidor Node**: a plataforma procura `src/server.ts` com
  `export default` e ignora funções em `api/`. Um arquivo com esse nome e o export
  errado derruba **todas** as rotas com `Invalid export found in module`; renomeá-lo sem
  repor o entrypoint quebra o build com `No entrypoint found`.
- Só o **grafo de módulos** viaja no deploy. `data/entities.json` é importado como módulo
  por isso; lido apenas do disco, o registro chega vazio em produção.
- **Deployment Protection** ligada devolve 302 para SSO e nenhum cliente MCP conecta.

## Próxima tarefa
Registrar `restaurante-ai-q-fome`, a última entidade fora da cidade. O MCP dela é stdio,
então vale no Core local; para produção precisa de endpoint http.
