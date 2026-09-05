/**
 * Léxico de intenção: palavra-chave -> tag de capacidade.
 * É deliberadamente simples e determinístico. Para ensinar o Core sobre um novo
 * tipo de entidade, basta acrescentar uma linha aqui e usar a mesma tag no
 * registro da entidade.
 */
export const LEXICON: Record<string, string[]> = {
  food: [
    "jantar", "jantando", "janta", "almoço", "almoco", "almocar", "comer", "comida",
    "restaurante", "restaurantes", "gastronomia", "culinaria", "culinária", "bistro",
    "dinner", "lunch", "eat", "food", "restaurant"
  ],
  music: [
    "show", "shows", "banda", "bandas", "rock", "musica", "música", "concerto",
    "casa de shows", "balada", "live", "concert", "gig", "band"
  ],
  movie: ["cinema", "filme", "filmes", "movie", "movies", "film", "sessao", "sessão"],
  event: ["evento", "eventos", "event", "events", "agenda", "programacao", "programação", "festival"],
  lodging: ["hotel", "hoteis", "hotéis", "hospedagem", "pousada", "dormir", "hostel", "stay", "lodging"],
  transport: [
    "transporte", "carona", "uber", "taxi", "táxi", "carro", "onibus", "ônibus",
    "metro", "metrô", "ride", "transport"
  ],
  grocery: [
    "mercado", "supermercado", "supermercados", "compras", "fazer compras", "feira",
    "hortifruti", "mantimentos", "acougue", "açougue", "padaria", "peixaria",
    "grocery", "groceries", "supermarket", "market"
  ],
  dessert: [
    "sorvete", "sorvetes", "sorveteria", "gelato", "gelatto", "sobremesa", "sobremesas",
    "acai", "açaí", "casquinha", "milkshake", "picole", "picolé", "doce", "doces",
    "ice cream", "dessert", "sundae"
  ],
  activity: [
    "atividade", "atividades", "fazer alguma coisa", "fazer algo", "diversao", "diversão",
    "passeio", "lazer", "entretenimento", "rolê", "role", "activity", "something to do", "fun"
  ]
};

/**
 * Tags genéricas que se expandem em tags concretas na hora de escolher entidades.
 * "atividade" não é um serviço; é qualquer coisa de lazer.
 */
export const TAG_EXPANSIONS: Record<string, string[]> = {
  activity: ["activity", "music", "movie", "event"]
};

/** Tags consideradas "refeição" na hora de montar combinações jantar + atividade. */
export const FOOD_TAGS = new Set(["food"]);

export function detectTags(text: string): string[] {
  const haystack = ` ${text.toLowerCase()} `;
  const found = new Set<string>();
  for (const [tag, words] of Object.entries(LEXICON)) {
    for (const w of words) {
      if (haystack.includes(w.length > 4 ? w : ` ${w} `) || haystack.includes(`${w},`) || haystack.includes(`${w}.`)) {
        found.add(tag);
        break;
      }
    }
  }
  return [...found];
}

export function expandTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    out.add(t);
    for (const e of TAG_EXPANSIONS[t] ?? []) out.add(e);
  }
  return [...out];
}
