#!/usr/bin/env node
/**
 * Entidade DEMO — existe só para o Core ter duas entidades reais para conversar
 * durante o desenvolvimento. As entidades de verdade da GTA7 Lab são projetos
 * separados; basta registrá-las com `register_entity` apontando para o MCP delas.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const RESTAURANTS = [
  { id: "r1", name: "Trattoria do Porto", area: "Marina", cuisine: "italiana", pricePerPerson: 120, capacity: 40, rating: 4.6 },
  { id: "r2", name: "Boteco da Sé", area: "Centro", cuisine: "brasileira", pricePerPerson: 65, capacity: 60, rating: 4.3 },
  { id: "r3", name: "Sushi Norte", area: "Vila Norte", cuisine: "japonesa", pricePerPerson: 180, capacity: 24, rating: 4.8 },
  { id: "r4", name: "Grelha & Brasa", area: "Centro", cuisine: "churrasco", pricePerPerson: 95, capacity: 120, rating: 4.4 },
  { id: "r5", name: "Verde Vivo", area: "Marina", cuisine: "vegetariana", pricePerPerson: 78, capacity: 30, rating: 4.5 }
];

const server = new McpServer({ name: "gta7-demo-restaurants", version: "0.1.0" });

server.registerTool(
  "search_restaurants",
  {
    title: "Buscar restaurantes",
    description: "Busca restaurantes por texto livre, tamanho do grupo e preço máximo por pessoa.",
    inputSchema: {
      query: z.string().optional(),
      partySize: z.number().int().positive().optional(),
      maxPrice: z.number().positive().optional(),
      area: z.string().optional(),
      limit: z.number().int().positive().optional()
    }
  },
  async ({ query, partySize, maxPrice, area, limit }) => {
    const q = (query ?? "").toLowerCase();
    const base = RESTAURANTS.filter(r => {
      if (partySize !== undefined && r.capacity < partySize) return false;
      if (maxPrice !== undefined && r.pricePerPerson > maxPrice) return false;
      if (area && !r.area.toLowerCase().includes(area.toLowerCase())) return false;
      return true;
    });

    // `query` costuma vir como frase inteira do usuário; só filtra se casar com algo.
    const byQuery = q ? base.filter(r => q.includes(r.cuisine) || q.includes(r.area.toLowerCase())) : [];
    const items = (byQuery.length > 0 ? byQuery : base)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit ?? 5);

    return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
  }
);

server.registerTool(
  "get_restaurant",
  {
    title: "Detalhes do restaurante",
    description: "Devolve um restaurante pelo id.",
    inputSchema: { id: z.string() }
  },
  async ({ id }) => {
    const found = RESTAURANTS.find(r => r.id === id);
    return found
      ? { content: [{ type: "text" as const, text: JSON.stringify(found, null, 2) }] }
      : { isError: true, content: [{ type: "text" as const, text: `restaurante '${id}' não encontrado` }] };
  }
);

await server.connect(new StdioServerTransport());
