/**
 * Formatação de dinheiro. Valores no banco vivem em centavos (bigint) — ver
 * decisão D5 do plano de Finanças (docs/features/finance/finance-app-plan.md).
 */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const BRL_CENTS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Reais a partir de centavos, sem casas (R$ 12.345). */
export function brlFromCents(cents: number | null | undefined): string {
  return BRL.format((cents ?? 0) / 100);
}

/** Reais a partir de centavos, com centavos (R$ 12.345,67). */
export function brlCentsExact(cents: number | null | undefined): string {
  return BRL_CENTS.format((cents ?? 0) / 100);
}

/** Percentual inteiro (42%); null → "—". */
export function pct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}
