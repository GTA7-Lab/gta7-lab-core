/** Checagem do CRUD do registro. Roda contra o arquivo apontado por GTA7_ENTITIES_FILE. */
import { getEntity, listEntities, registerEntity, removeEntity, updateEntity } from "../src/registry.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(process.env.GTA7_ENTITIES_FILE, "GTA7_ENTITIES_FILE não definido");

const { entity } = registerEntity({
  id: "cinema",
  name: "Cinema Central",
  description: "entidade de teste",
  transport: "http",
  endpoint: "https://exemplo.gta7.lab/mcp",
  tags: ["movie", "activity"]
});
assert(entity.enabled === true, "enabled deveria ter default true");
assert(entity.tags.includes("movie"), "tags não foram preservadas");

assert(getEntity("cinema")?.name === "Cinema Central", "get_entity falhou");
assert(listEntities().length === 1, "list_entities deveria ter 1 entidade");

const { entity: updated } = updateEntity("cinema", { name: "Cinema Central 2", enabled: false });
assert(updated.name === "Cinema Central 2", "update não aplicou o patch");
assert(listEntities({ enabledOnly: true }).length === 0, "enabledOnly não filtrou");

let duplicated = false;
try {
  registerEntity({ id: "cinema", name: "x", transport: "http", endpoint: "https://a.b/mcp" });
} catch {
  duplicated = true;
}
assert(duplicated, "registrar id duplicado deveria falhar");

let invalid = false;
try {
  registerEntity({ id: "sem-endpoint", name: "x", transport: "http" });
} catch {
  invalid = true;
}
assert(invalid, "transport http sem endpoint deveria falhar");

removeEntity("cinema");
assert(listEntities().length === 0, "remove não removeu");

console.log("CRUD ok");
