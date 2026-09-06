/**
 * Superfície pública do `shared`.
 *
 * É por aqui que uma Entity de outro repositório consome os contratos comuns
 * da cidade — `import { RequestContext, Wallet } from "gta7-lab-core/shared"`.
 * O `exports` do package.json expõe só este caminho: orquestrador, registro de
 * entidades e agentes ficam de fora de propósito. Entity que precisasse deles
 * seria sinal de separação errada.
 *
 * Nada aqui importa nada do Core. Compartilhar modelo é uma coisa; comunicação
 * entre projetos continua sendo MCP, sempre.
 */
export { CITY_SOURCE, createRequestContext, type RequestContext } from "./request-context.js";
export { Wallet, type WalletState } from "./wallet.js";
export { Inventory, type InventoryItem } from "./inventory.js";
