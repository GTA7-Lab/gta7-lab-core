/**
 * Mochila. Componente compartilhado: itens e quantidades, sem saber o que é um
 * item — quem dá sentido a `itemId` é a entidade que vendeu.
 */

export interface InventoryItem {
  itemId: string;
  quantity: number;
  /** nome legível, quando a entidade devolveu um */
  name?: string;
}

export class Inventory {
  private itens: InventoryItem[];

  constructor(state: InventoryItem[] = []) {
    this.itens = state.map(i => ({ ...i }));
  }

  add(itemId: string, quantity = 1, name?: string): void {
    if (!(quantity > 0)) throw new Error("quantidade a adicionar precisa ser positiva");
    const existente = this.itens.find(i => i.itemId === itemId);
    if (existente) {
      existente.quantity += quantity;
      if (name && !existente.name) existente.name = name;
      return;
    }
    this.itens.push({ itemId, quantity, ...(name ? { name } : {}) });
  }

  remove(itemId: string, quantity = 1): void {
    if (!(quantity > 0)) throw new Error("quantidade a remover precisa ser positiva");
    const existente = this.itens.find(i => i.itemId === itemId);
    if (!existente || existente.quantity < quantity) {
      throw new Error(`não há ${quantity} de '${itemId}' na mochila`);
    }
    existente.quantity -= quantity;
    if (existente.quantity === 0) this.itens = this.itens.filter(i => i !== existente);
  }

  quantityOf(itemId: string): number {
    return this.itens.find(i => i.itemId === itemId)?.quantity ?? 0;
  }

  list(): InventoryItem[] {
    return this.itens.map(i => ({ ...i }));
  }

  get size(): number {
    return this.itens.reduce((n, i) => n + i.quantity, 0);
  }

  toJSON(): InventoryItem[] {
    return this.list();
  }
}
