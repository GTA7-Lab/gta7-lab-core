# GTA7 Lab — Core Orchestrator (a cidade)

## Objetivo
Este repositório **é a cidade** da GTA7 Lab, não uma entidade. Ele é um servidor MCP
(consumido por Claude/ChatGPT) que também age como **cliente MCP** das entidades
registradas (restaurante, casa de shows, cinema, hotel, transporte...), escolhe quais
entidades atendem um pedido, chama as tools delas e combina os resultados.

## Onde isto vive
`GTA7-Lab/gta7-lab-city` tem só o Core, na raiz — na Vercel, sem Root Directory especial.
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
| `src/discovery.ts` | pergunta as tools ao MCP, escolhe a vitrine e monta os argumentos |
| `src/mcp-server.ts` | as 19 MCP tools do Core |
| `src/stdio.ts` | entrypoint local (stdio) |
| `src/server.ts` | entrypoint HTTP (Vercel): `/mcp` streamable http stateless, e a landing |
| `src/entities/*.ts` | duas entidades **demo** locais, só para desenvolvimento |
| `src/submissions.ts` | fila de entidades pedindo para entrar, em `data/submissions.json` |
| `src/residents.ts` | moradores da cidade, em `data/residents.json` |
| `src/github-file.ts` | grava JSON de volta no repo pela API do GitHub |
| `src/magic-word.ts` | confere a palavra mágica das operações protegidas |
| `src/present.ts` | transforma tudo em texto amigável antes de sair pelo MCP |
| `src/shared/*.ts` | superfície pública: RequestContext, Wallet, Inventory |
| `src/agents/memory.ts` | memória do agente (cognição, não conceito do mundo) |
| `src/agents/base-agent.ts` | morador que sabe agir: componentes, ciclo, RequestContext |
| `src/agents/resident-agent.ts` | agente concreto de teste |
| `src/agents/execute.ts` | ponte agente -> entidade MCP |
| `scripts/smoke.ts` | prova os critérios de sucesso ponta a ponta |
| `scripts/agents-check.ts` | prova a fundação de agentes (`npm run agents`) |

## Decisões importantes
- **O MCP é a fonte de verdade das capacidades.** O registro guarda só como chegar na
  entidade (`endpoint`) e em que tipo de pedido ela entra (`tags`). Não há manifesto de
  tools: `discovery.ts` pergunta ao MCP dela na hora, com cache de 5 min.
- **Qual tool o Core pode chamar sozinho** é inferido, não declarado: nome de verbo de
  catálogo (`search_`, `list_`, `get_`...), **zero parâmetros obrigatórios** e nome fora
  de uma denylist de assunto privado. As duas últimas regras não são zelo teórico: o banco
  expõe `list_customers` e `search_transactions`, o supermercado expõe `list_purchases`,
  e todas passariam numa regra ingênua — o Core despejaria dado de cliente na resposta de
  quem só perguntou o que fazer na cidade. Exigir zero obrigatórios já derruba `send_pix`
  e `get_show(id)`; a denylist cuida do resto.
- **Os argumentos são casados por apelido** contra o schema da tool, e só quando o **tipo**
  bate — simétrico à tabela que `fields.ts` usa para ler as respostas. Mandar texto num
  parâmetro numérico faz a entidade recusar a chamada inteira, e já aconteceu com data.
- **Filtro depois da chamada** — o Core reaplica pessoas/orçamento sobre os itens, então
  a restrição vale mesmo se a entidade ignorar os parâmetros. Item sem o campo passa.
- **Repetir a busca sem `query`** — o Core manda a frase inteira do usuário em `query`, e
  entidades que filtram por token não casam nada com ela. Quando uma busca volta vazia e
  havia `query`, o Core repete sem ela. Preserva a precisão de "arroz" e evita o vazio de
  "quero fazer compras", sem o Core precisar conhecer o vocabulário de cada entidade.
  Sai em `retriedWithoutQuery` no resultado.
- **Campos com apelidos** — `name/nome/title`, `pricePerPerson/ticketPrice/preco`,
  `capacity/capacidade`, `area/bairro/neighborhood`. Entidade não precisa seguir schema.
- **Persistência em JSON.** Sem banco, sem Docker. Na Vercel o filesystem é somente-leitura.
  Entidades: alterar em produção vale só durante a requisição e devolve `warning`; para
  valer de verdade, editar `data/entities.json` e fazer deploy.
- **Moradores gravam no próprio repo.** Com `GTA7_GITHUB_TOKEN` definido, cadastrar um
  morador vira um commit em `data/residents.json` pela API do GitHub (`src/github-file.ts`),
  com `[skip ci]` na mensagem para não disparar deploy a cada cadastro. Sem o token, vale o
  arquivo em disco — que é o caso local. Escolhido no lugar de um banco para não trazer
  serviço novo e manter o JSON como fonte da verdade, com histórico de brinde. Como o repo
  é público, a lista de moradores é pública: não guardar aí nada realmente sensível.
- **Palavra mágica** — conferida contra `GTA7_MAGIC_WORD` (`src/magic-word.ts`), porque o
  endpoint é público e sem isso qualquer um tira uma entidade do ar. Falha fechado: sem a
  variável definida, ninguém altera nada. Protege as **alterações de entidade**
  (`register_entity`, `update_entity`, `remove_entity`) e **tudo de morador, inclusive
  ler** — entidade é serviço público da cidade, morador é gente. Consultar a cidade e
  orquestrar pedidos seguem livres.
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
  "enabled": true
}
```
`transport: "stdio"` usa `command` + `args` no lugar de `endpoint`. **Não há campo
`tools`**: quais existem vem do MCP.
Tags conhecidas: `food, music, movie, event, lodging, transport, grocery, dessert, activity` (`src/lexicon.ts`).

## Formato de morador (`data/residents.json`)
```json
{
  "id": "eric",
  "name": "Eric Gomes",
  "bio": "Cuida da cidade.",
  "bairro": "Marina",
  "interesses": ["food", "music"],
  "desde": "2026-09-05"
}
```
`interesses` usa as mesmas tags das entidades. Hoje elas só descrevem a pessoa; ligá-las
à orquestração (sugerir pelo gosto de quem pede) é o passo natural seguinte.

## Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `GTA7_MAGIC_WORD` | libera as operações protegidas; sem ela ninguém altera nada |
| `GTA7_GITHUB_TOKEN` | grava moradores no repo; sem ela, só disco (local) |
| `GTA7_GITHUB_REPO` | padrão `GTA7-Lab/gta7-lab-city` |
| `GTA7_GITHUB_BRANCH` | padrão `main` |
| `GTA7_ENTITIES_FILE`, `GTA7_RESIDENTS_FILE`, `GTA7_SUBMISSIONS_FILE` | apontam os JSON para outro lugar (testes) |

## Status
No ar em **https://gta7-lab-city.vercel.app/mcp** (Streamable HTTP), com deploy
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

## Como uma entidade entra na cidade
Tudo por MCP; ninguém edita o JSON de ninguém.

1. A entidade chama **`submit_entity`** — aberto, sem palavra mágica. Ela **não declara
   tools**: informa id, nome, descrição, endpoint e tags. O Core conecta, chama
   `listTools` e recusa se não sobrar nenhuma tool que ele possa chamar sozinho — senão a
   entidade entraria na cidade e nunca seria acionada. Aceito, entra em
   `data/submissions.json`.
2. `submission_status` (aberto) deixa a entidade acompanhar o próprio pedido.
3. Quem cuida da cidade usa **`list_submissions`**, **`approve_entity`** e
   **`deny_entity`**, todos com a palavra mágica.

**Por que não aceitar direto:** as `tags` são recurso compartilhado — quem reivindica
muitas passa a ser chamada em quase todo pedido e polui o resultado das outras. Esse
julgamento não dá para automatizar. O que dá é a checagem de honestidade, e é o que o
`submit_entity` faz. Além disso, a palavra mágica atual protege tudo junto: se
circulasse para as entidades se cadastrarem, quem entra também removeria as outras.

`approve_entity` grava o registro **sem** `[skip ci]`, de propósito: o `data/entities.json`
viaja no bundle, então admitir alguém precisa gerar deploy. A fila de pedidos e os
moradores usam `[skip ci]`, porque mudam demais para valer um deploy cada.

## Agentes (fundação)
Um **morador é a ficha; um agente é o mesmo morador sabendo agir**. Não há
`agents.json`: o estado de agente foi acrescentado ao `ResidentSchema`, tudo com default,
para não existirem duas listas de gente para conciliar. `bairro` é onde mora, `location`
é onde está agora.

- `src/shared/` são componentes **puros**: não importam nada do Core. É o que permite
  extraí-los depois para um pacote comum sem refatoração.
- `BaseAgent` não conhece entidade nenhuma. Quem chama o MCP é `executeForAgent`, que
  fica em `agents/` justamente porque conhece registro e cliente.
- **RequestContext viaja pelo `argsMap`.** A entidade que quiser recebê-lo declara
  `"context": "<nome do parâmetro dela>"` na tool. Assim ela opta por receber, escolhe o
  nome, e entidades com schema estrito não quebram com um campo extra.
- Criados só Wallet, Inventory e Memory. Location, Needs e Goals são campos simples —
  classe para guardar uma string não paga o custo. Relationships, Schedule e Ownership
  ficaram de fora: nada produz nem consome esses dados ainda.
- Ciclo `perceive/decide/act` existe como contrato, chamado à mão. Sem loop nem worker.

**O que vai forçar decisão depois:** o estado do morador é gravado por commit no GitHub.
Serve para cadastro, que é raro. Se um dia houver ciclo automático, seria um commit por
passo do agente — aí o armazenamento precisa mudar.

## `shared` é superfície pública
Uma Entity de outro repositório pode consumir os contratos comuns da cidade:

```bash
npm install github:GTA7-Lab/gta7-lab-city
```
```ts
import { createRequestContext, Wallet, type RequestContext } from "gta7-lab-city/shared";
```

O `exports` do `package.json` expõe **só** `./shared`. Orquestrador, registro de entidades
e agentes não são importáveis de fora — testado: `import("gta7-lab-city/dist/src/orchestrator.js")`
falha. Entity que precisasse dessas partes seria sinal de separação errada.

Regra que sustenta isso: **nada em `src/shared/` importa nada do Core.** `npm run agents`
verifica isso a cada execução varrendo os imports, porque é o tipo de invariante que se
perde no primeiro atalho.

Compartilhar modelo é uma coisa; **comunicação entre projetos continua sendo MCP, sempre.**
`shared` distribui tipos e componentes locais, nunca substitui a chamada MCP.

**O que entrou e por quê:** `RequestContext` (é o contrato que Entity precisa para ler quem
pede), `Wallet` e `Inventory` (loja tem saldo e estoque tanto quanto morador). `Memory`
saiu de `shared` para `agents/`: é cognição de morador, e nenhuma entidade tem uso para
ela. `Schedule`, `Ownership`, `Relationships` e `Needs` ficaram de fora — nada produz nem
consome esses dados hoje.

**Instalação a partir do git:** o `prepare` compila no install, mas o npm mais novo bloqueia
scripts de dependência por padrão. Se `dist/` não aparecer, o consumidor roda
`npm approve-scripts gta7-lab-city` ou compila na mão.
