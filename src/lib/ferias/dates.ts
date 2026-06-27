/**
 * Contagem de dias pro saldo de férias. Sem calendário de feriados no v1
 * (não-objetivo) — úteis = seg–sex. Datas em ISO YYYY-MM-DD, contadas em UTC
 * pra não sofrer com fuso/DST.
 */
import type { ContractType } from "./types";

/** Allowance anual de férias por regime (D3). PJ conta úteis, CLT conta corridos. */
export const FERIAS_ALLOWANCE: Record<ContractType, number> = { pj: 10, clt: 30 };

function toUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Dias corridos, inclusivo (CLT). */
export function calendarDays(start: string, end: string): number {
  const ms = toUTC(end).getTime() - toUTC(start).getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

/** Dias úteis (seg–sex), inclusivo (PJ). */
export function businessDays(start: string, end: string): number {
  const s = toUTC(start);
  const e = toUTC(end);
  if (e.getTime() < s.getTime()) return 0;
  let count = 0;
  for (const d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

/** Dias de férias consumidos por um range, conforme o regime. */
export function feriasDays(
  contractType: ContractType,
  start: string,
  end: string,
): number {
  return contractType === "pj"
    ? businessDays(start, end)
    : calendarDays(start, end);
}
