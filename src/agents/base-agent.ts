import { Inventory } from "../shared/inventory.js";
import { Memory } from "../shared/memory.js";
import { createRequestContext, type RequestContext } from "../shared/request-context.js";
import { Wallet } from "../shared/wallet.js";
import type { Resident } from "../residents.js";

/**
 * Um morador que sabe agir.
 *
 * O estado vive na ficha do morador (`data/residents.json`) — o agente não tem
 * cadastro próprio. Esta classe é o comportamento em volta dessa ficha:
 * componentes com regra (carteira, mochila, memória) e o ciclo de vida.
 *
 * O que ela deliberadamente NÃO faz:
 *  - não conhece entidade concreta. Chamar o banco ou a sorveteria é assunto
 *    de `executeForAgent`, que recebe o agente de fora.
 *  - não decide autorização. Ela só diz quem é (`createRequestContext`); quem
 *    permite ou nega é a entidade.
 */

export type AgentState = Resident;

/** O que o agente enxerga do mundo num dado momento. Cresce quando houver o quê. */
export interface CityPerception {
  entities: Array<{ id: string; name: string; tags: string[] }>;
  at: string;
}

/** O que ele decidiu fazer. Uma intenção, ainda não executada. */
export interface AgentDecision {
  kind: "call_entity" | "move" | "idle";
  reason: string;
  entityId?: string;
  tool?: string;
  input?: Record<string, unknown>;
  location?: string;
}

export abstract class BaseAgent {
  readonly wallet: Wallet;
  readonly inventory: Inventory;
  readonly memory: Memory;

  private state: AgentState;

  constructor(state: AgentState) {
    this.state = { ...state };
    this.wallet = new Wallet(state.wallet);
    this.inventory = new Inventory(state.inventory);
    this.memory = new Memory(state.memory);
  }

  get id(): string {
    return this.state.id;
  }
  get name(): string {
    return this.state.name;
  }
  get type(): string {
    return this.state.type;
  }
  get status(): AgentState["status"] {
    return this.state.status;
  }
  get roles(): string[] {
    return [...this.state.roles];
  }
  get location(): string | undefined {
    return this.state.location;
  }
  get goals(): string[] {
    return [...this.state.goals];
  }
  get needs(): AgentState["needs"] {
    return { ...this.state.needs };
  }

  moveTo(location: string): void {
    const anterior = this.state.location;
    this.state.location = location;
    this.memory.remember("movimento", anterior ? `foi de ${anterior} para ${location}` : `chegou em ${location}`);
  }

  setActivity(activity: string | undefined): void {
    this.state.currentActivity = activity;
  }

  addGoal(goal: string): void {
    if (!this.state.goals.includes(goal)) this.state.goals.push(goal);
  }

  completeGoal(goal: string): void {
    this.state.goals = this.state.goals.filter(g => g !== goal);
    this.memory.remember("objetivo", `concluiu: ${goal}`);
  }

  /** Ajuste pontual de necessidade, limitado a 0..100. Sem decaimento automático. */
  adjustNeed(need: keyof AgentState["needs"], delta: number): void {
    const atual = this.state.needs[need];
    this.state.needs[need] = Math.max(0, Math.min(100, atual + delta));
  }

  /** Quem ele é, para a entidade decidir se atende. */
  createRequestContext(extra: Partial<RequestContext> = {}): RequestContext {
    return createRequestContext({
      requesterId: this.id,
      requesterType: this.type,
      roles: this.roles,
      location: this.location,
      ...extra
    });
  }

  /** Estado completo e serializável — é isto que vai para o JSON. */
  getState(): AgentState {
    return {
      ...this.state,
      wallet: this.wallet.toJSON(),
      inventory: this.inventory.toJSON(),
      memory: this.memory.toJSON()
    };
  }

  toJSON(): AgentState {
    return this.getState();
  }

  // --- ciclo -------------------------------------------------------------
  // Sem loop, sem worker, sem autonomia: as três etapas são chamadas à mão.
  // O contrato existe para que ligar um ciclo depois não mude esta classe.

  abstract perceive(city: CityPerception): CityPerception;
  abstract decide(perception: CityPerception): AgentDecision;
  abstract act(decision: AgentDecision): Promise<unknown>;
}
