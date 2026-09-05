import { z } from "zod";

/**
 * Slots canônicos do Core. Cada entidade mapeia esses slots para os nomes de
 * parâmetro das suas próprias MCP tools via `argsMap`, o que evita código
 * específico de entidade dentro do orquestrador.
 */
export const CANONICAL_SLOTS = [
  "query",
  "people",
  "maxPricePerPerson",
  "when",
  "near",
  "limit"
] as const;

export type CanonicalSlot = (typeof CANONICAL_SLOTS)[number];

export const RequestSlotsSchema = z.object({
  query: z.string().optional(),
  people: z.number().int().positive().optional(),
  maxPricePerPerson: z.number().positive().optional(),
  when: z.string().optional(),
  near: z.string().optional(),
  limit: z.number().int().positive().optional()
});

export type RequestSlots = z.infer<typeof RequestSlotsSchema>;

export const EntityToolSchema = z.object({
  name: z.string().min(1),
  /**
   * search  -> tool de descoberta; o orquestrador pode chamá-la sozinho
   * detail  -> busca por id
   * other   -> só acessível por call_entity_tool
   */
  kind: z.enum(["search", "detail", "other"]).default("other"),
  /** slot canônico -> nome do parâmetro nesta tool. Ex.: { people: "partySize" } */
  argsMap: z.record(z.string()).default({})
});

export type EntityTool = z.infer<typeof EntityToolSchema>;

export const EntitySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "id deve ser kebab/snake case minúsculo"),
    name: z.string().min(1),
    description: z.string().default(""),
    transport: z.enum(["http", "stdio"]).default("http"),
    /** transport http */
    endpoint: z.string().url().optional(),
    /** transport stdio */
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    /** tags de capacidade usadas pelo orquestrador para escolher entidades */
    tags: z.array(z.string()).default([]),
    tools: z.array(EntityToolSchema).default([]),
    enabled: z.boolean().default(true)
  })
  .superRefine((e, ctx) => {
    if (e.transport === "http" && !e.endpoint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "transport 'http' exige 'endpoint'" });
    }
    if (e.transport === "stdio" && !e.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "transport 'stdio' exige 'command'" });
    }
  });

export type Entity = z.infer<typeof EntitySchema>;

/** Item devolvido por uma entidade, já anotado com a origem. */
export interface CityItem extends Record<string, unknown> {
  entityId: string;
  entityName: string;
  tool: string;
}

export interface PlanStep {
  entityId: string;
  entityName: string;
  tool: string;
  /** tags que fizeram esta entidade ser escolhida */
  matchedTags: string[];
  /** argumentos já traduzidos para os nomes que a entidade espera */
  args: Record<string, unknown>;
  reason: string;
}

export interface Plan {
  request: string;
  detectedTags: string[];
  slots: RequestSlots;
  steps: PlanStep[];
  notes: string[];
}

export interface StepResult {
  step: PlanStep;
  ok: boolean;
  items: CityItem[];
  /** a busca voltou vazia com `query` e foi repetida sem ela */
  retriedWithoutQuery?: boolean;
  error?: string;
  /** conteúdo bruto devolvido pela entidade, para depuração */
  raw?: unknown;
}
