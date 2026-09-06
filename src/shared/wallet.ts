/**
 * Carteira. Componente compartilhado: não conhece o Core, nem MCP, nem
 * entidade nenhuma — só dinheiro. Um dia isso vale para morador, loja e banco
 * igualmente, e é por isso que não importa nada daqui de dentro do projeto.
 */

export interface WalletState {
  balance: number;
}

export class Wallet {
  private saldo: number;

  constructor(state: WalletState = { balance: 0 }) {
    this.saldo = state.balance;
  }

  get balance(): number {
    return this.saldo;
  }

  credit(amount: number): void {
    if (!(amount > 0)) throw new Error("valor a creditar precisa ser positivo");
    this.saldo = round(this.saldo + amount);
  }

  /** Lança quando não há saldo: gastar mais do que se tem é erro, não saldo negativo. */
  debit(amount: number): void {
    if (!(amount > 0)) throw new Error("valor a debitar precisa ser positivo");
    if (amount > this.saldo) throw new Error(`saldo insuficiente: tem ${this.saldo}, precisa de ${amount}`);
    this.saldo = round(this.saldo - amount);
  }

  canAfford(amount: number): boolean {
    return amount <= this.saldo;
  }

  transferTo(outra: Wallet, amount: number): void {
    this.debit(amount);
    outra.credit(amount);
  }

  toJSON(): WalletState {
    return { balance: this.saldo };
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
