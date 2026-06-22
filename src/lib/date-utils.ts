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

/** "27 mai 2026, 14:30" — data longa + hora. Para timelines com vários eventos/dia. */
export function fmtDateTime(d: DateInput): string {
  const date = toDate(d);
  if (!date) return EMPTY;
  return date.toLocaleString(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/**
 * "Semana de 16/jun" — rótulo da semana a partir de um YYYY-MM-DD (segunda).
 * UTC-safe de propósito: referenceWeek é date-only; parsear no fuso local
 * deslocaria pra o domingo anterior em fusos a oeste de UTC.
 */
export function fmtWeek(yyyyMmDd: string): string {
  try {
    const d = new Date(yyyyMmDd + "T00:00:00Z");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `Semana de ${day}/${MONTHS_SHORT[d.getUTCMonth()]}`;
  } catch {
    return yyyyMmDd;
  }
}

/**
 * "14 jun" — dia + mês curto a partir de um YYYY-MM-DD (date-only).
 * UTC-safe de propósito (igual `fmtWeek`): o `fmtDate` comum parseia no fuso
 * local e renderiza o dia −1 em fusos a oeste de UTC para datas date-only.
 * Usado pelos chips do Cronograma (sprint/semana têm data date-only).
 */
export function fmtDayMonth(yyyyMmDd: string): string {
  try {
    const d = new Date(yyyyMmDd.slice(0, 10) + "T00:00:00Z");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${day} ${MONTHS_SHORT[d.getUTCMonth()]}`;
  } catch {
    return yyyyMmDd;
  }
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
