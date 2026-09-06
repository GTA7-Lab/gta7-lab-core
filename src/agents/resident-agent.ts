import { listEntities } from "../registry.js";
import { searchToolsOf } from "../discovery.js";
import { getResident, updateResident } from "../residents.js";
import { BaseAgent, type AgentDecision, type AgentState, type CityPerception } from "./base-agent.js";
import { executeForAgent } from "./execute.js";

/**
 * O agente concreto mais simples possível: um morador.
 *
 * Existe para provar que a fundação funciona — criar, carregar, mudar estado,
 * gerar RequestContext, salvar. A decisão é uma regra de três linhas, não uma
 * IA: escolhe a primeira entidade cuja tag bate com o primeiro objetivo. Vai
 * ser substituída quando houver comportamento de verdade; o ponto agora é que
 * o contrato do ciclo já esteja de pé.
 */
export class ResidentAgent extends BaseAgent {
  /** Carrega da ficha do morador. */
  static async load(id: string): Promise<ResidentAgent | undefined> {
    const ficha = await getResident(id);
    return ficha ? new ResidentAgent(ficha) : undefined;
  }

  /** Grava o estado de volta na ficha. */
  async save(): Promise<{ warning?: string }> {
    const { id, ...resto } = this.getState();
    const { warning } = await updateResident(id, resto as Record<string, unknown>);
    return { warning };
  }

  perceive(city?: CityPerception): CityPerception {
    if (city) return city;
    return {
      at: new Date().toISOString(),
      entities: listEntities({ enabledOnly: true }).map(e => ({ id: e.id, name: e.name, tags: e.tags }))
    };
  }

  async decide(perception: CityPerception): Promise<AgentDecision> {
    const objetivo = this.goals[0];
    if (!objetivo) return { kind: "idle", reason: "não tem objetivo nenhum agora" };

    // Regra deliberadamente boba: casa o texto do objetivo com as tags da
    // entidade. Serve para o ciclo rodar ponta a ponta, não para ser esperta.
    const alvo = perception.entities.find(e => e.tags.some(t => objetivo.toLowerCase().includes(t)));
    if (!alvo) return { kind: "idle", reason: `nenhum lugar da cidade atende "${objetivo}"` };

    // Qual tool chamar não está no registro: vem do MCP da entidade.
    const entidade = listEntities().find(e => e.id === alvo.id);
    const vitrine = entidade ? await searchToolsOf(entidade) : [];
    if (vitrine.length === 0) return { kind: "idle", reason: `${alvo.name} não tem tool que eu possa chamar` };

    return {
      kind: "call_entity",
      reason: `quer "${objetivo}" e ${alvo.name} atende isso`,
      entityId: alvo.id,
      tool: vitrine[0].tool.name,
      input: {}
    };
  }

  async act(decision: AgentDecision): Promise<unknown> {
    if (decision.kind === "move" && decision.location) {
      this.moveTo(decision.location);
      return { moved: decision.location };
    }
    if (decision.kind === "call_entity" && decision.entityId && decision.tool) {
      return executeForAgent(this, decision.entityId, decision.tool, decision.input ?? {});
    }
    this.memory.remember("parado", decision.reason);
    return { idle: true, reason: decision.reason };
  }
}

export type { AgentState };
