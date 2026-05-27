// ─── Date formatting — single source of truth ────────────
//
// Antes desta home, fmtDate/fmtShortDate eram redefinidos em 10+ arquivos
// com formatos divergentes (a mesma data saía "27 mai" numa tela e
// "27/05/2026" em outra). Os 4 formatos abaixo cobrem todos os call sites.
// Placeholder de data ausente é sempre "—" (em-dash).

const LOCALE = "pt-BR";
const EMPTY = "—";

type DateInput = string | Date | null | undefined;

function toDate(d: DateInput): Date | null {
  if (!d) return null;
  return d instanceof Date ? d : new Date(d);
}

/** "27 mai" — dia + mês curto. O formato mais usado (listas, cards). */
export function fmtDate(d: DateInput): string {
  const date = toDate(d);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, { day: "2-digit", month: "short" });
}

/** "27 mai 2026" — dia + mês curto + ano. Para contextos com histórico longo. */
export function fmtDateLong(d: DateInput): string {
  const date = toDate(d);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "quarta-feira, 27 de maio de 2026" — por extenso. Header de detalhe. */
export function fmtDateFull(d: DateInput): string {
  const date = toDate(d);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** "27/05" — dia/mês numérico. Para contextos densos (widgets, linhas compactas). */
export function fmtDateNumeric(d: DateInput): string {
  const date = toDate(d);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit" });
}

/** "qua, 27 mai 2026" — weekday curto + data média. Lista de reuniões. */
export function fmtWeekdayShort(d: DateInput): string {
  const date = toDate(d);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** true se a data já passou E o item não está concluído. */
export function isOverdue(d: string | null, status: string): boolean {
  if (!d || status === "done") return false;
  return new Date(d) < new Date();
}
