/**
 * As tools que alteram o registro (registrar, atualizar, remover entidade) só
 * funcionam com a palavra mágica da cidade. O Core é um endpoint MCP público:
 * sem isso, qualquer um tira uma entidade do ar.
 *
 * A palavra vive em `GTA7_MAGIC_WORD`, fora do código. Se ela não estiver
 * definida, as alterações ficam bloqueadas — falhar fechado é o certo aqui,
 * porque um deploy sem a variável estaria aberto para qualquer um.
 */

export type MagicWordCheck = { ok: true } | { ok: false; reason: string };

export function checkMagicWord(informada: string | undefined): MagicWordCheck {
  const esperada = process.env.GTA7_MAGIC_WORD?.trim();

  if (!esperada) {
    return {
      ok: false,
      reason:
        "A cidade ainda não definiu a palavra mágica, então ninguém pode mexer no registro por enquanto. " +
        "Quem cuida da cidade precisa configurar isso antes."
    };
  }
  if (!informada?.trim()) {
    return { ok: false, reason: "Isso precisa da palavra mágica da cidade. Me diga qual é e eu faço." };
  }
  if (informada.trim() !== esperada) {
    return { ok: false, reason: "Essa não é a palavra mágica da cidade, então não fiz nada." };
  }
  return { ok: true };
}
