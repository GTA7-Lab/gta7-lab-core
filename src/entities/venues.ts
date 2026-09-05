#!/usr/bin/env node
/**
 * Entidade DEMO — casa de shows de rock. Mesmo papel do demo de restaurantes:
 * dar ao Core um segundo servidor MCP real para orquestrar durante o dev.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SHOWS = [
  { id: "s1", name: "Motor Alta — Rock Nacional", venue: "Galpão 7", area: "Centro", genre: "rock nacional", ticketPrice: 80, capacity: 400, startsAt: "2026-09-05T22:00:00-03:00" },
  { id: "s2", name: "Fio Terra — Hard Rock", venue: "Galpão 7", area: "Centro", genre: "hard rock", ticketPrice: 120, capacity: 400, startsAt: "2026-09-06T22:30:00-03:00" },
  { id: "s3", name: "Sirene Azul — Indie Rock", venue: "Cais Norte", area: "Marina", genre: "indie rock", ticketPrice: 60, capacity: 250, startsAt: "2026-09-05T21:00:00-03:00" },
  { id: "s4", name: "Bloco de Ruído — Punk", venue: "Subsolo", area: "Vila Norte", genre: "punk", ticketPrice: 45, capacity: 180, startsAt: "2026-09-07T20:00:00-03:00" },
  { id: "s5", name: "Trovão Lento — Stoner", venue: "Cais Norte", area: "Marina", genre: "stoner rock", ticketPrice: 95, capacity: 250, startsAt: "2026-09-06T23:00:00-03:00" }
];

const server = new McpServer({ name: "gta7-demo-venues", version: "0.1.0" });

server.registerTool(
  "search_shows",
  {
    title: "Buscar shows",
    description: "Busca shows da casa por texto livre, tamanho do grupo, preço máximo do ingresso e data.",
    inputSchema: {
      query: z.string().optional(),
      groupSize: z.number().int().positive().optional(),
      maxTicketPrice: z.number().positive().optional(),
      date: z.string().optional().describe("texto livre de data, ex.: 'hoje', 'sábado'"),
      limit: z.number().int().positive().optional()
    }
  },
  async ({ query, groupSize, maxTicketPrice, limit }) => {
    const q = (query ?? "").toLowerCase();
    const base = SHOWS.filter(s => {
      if (groupSize !== undefined && s.capacity < groupSize) return false;
      if (maxTicketPrice !== undefined && s.ticketPrice > maxTicketPrice) return false;
      return true;
    });

    const byQuery = q ? base.filter(s => q.includes(s.genre) || q.includes(s.area.toLowerCase())) : [];
    const items = (byQuery.length > 0 ? byQuery : base)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, limit ?? 5);

    return { content: [{ type: "text" as const, text: JSON.stringify({ items }, null, 2) }] };
  }
);

server.registerTool(
  "get_show",
  {
    title: "Detalhes do show",
    description: "Devolve um show pelo id.",
    inputSchema: { id: z.string() }
  },
  async ({ id }) => {
    const found = SHOWS.find(s => s.id === id);
    return found
      ? { content: [{ type: "text" as const, text: JSON.stringify(found, null, 2) }] }
      : { isError: true, content: [{ type: "text" as const, text: `show '${id}' não encontrado` }] };
  }
);

await server.connect(new StdioServerTransport());
