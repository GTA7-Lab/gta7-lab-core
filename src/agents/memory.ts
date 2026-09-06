/**
 * Memória do agente. Fica em `agents/`, não em `shared/`: é cognição de
 * morador, não conceito do mundo — nenhuma entidade tem uso para ela. Uma
 * lista de acontecimentos em ordem,
 * com um teto para não crescer sem fim — o estado do agente é serializado
 * inteiro a cada gravação, então memória infinita viraria arquivo infinito.
 */

export interface MemoryEntry {
  /** quando aconteceu, ISO */
  at: string;
  /** que tipo de acontecimento: "compra", "conversa", "chamada"... texto livre */
  kind: string;
  /** o que aconteceu, em uma frase */
  text: string;
  /** dados extras, se houver */
  data?: Record<string, unknown>;
}

const TETO_PADRAO = 200;

export class Memory {
  private entradas: MemoryEntry[];

  constructor(
    state: MemoryEntry[] = [],
    private readonly teto: number = TETO_PADRAO
  ) {
    this.entradas = state.slice(-this.teto);
  }

  remember(kind: string, text: string, data?: Record<string, unknown>): MemoryEntry {
    const entrada: MemoryEntry = { at: new Date().toISOString(), kind, text, ...(data ? { data } : {}) };
    this.entradas.push(entrada);
    if (this.entradas.length > this.teto) this.entradas = this.entradas.slice(-this.teto);
    return entrada;
  }

  /** As mais recentes primeiro — é assim que se olha para trás. */
  recent(quantas = 10): MemoryEntry[] {
    return this.entradas.slice(-quantas).reverse();
  }

  byKind(kind: string): MemoryEntry[] {
    return this.entradas.filter(e => e.kind === kind);
  }

  get size(): number {
    return this.entradas.length;
  }

  toJSON(): MemoryEntry[] {
    return this.entradas.map(e => ({ ...e }));
  }
}
