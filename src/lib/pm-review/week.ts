/**
 * Aritmética de semana do PM Review — PURA e client-safe (sem deps de server).
 * Fonte ÚNICA da "segunda da semana em BRT" (D16 do runbook pm-review-unified):
 * tanto o cron/refresh quanto a régua do cronograma derivam daqui, pra a célula
 * da semana corrente casar com a review que o cron cria.
 *
 * BRT = Brasil sem DST desde 2019 → UTC-3 fixo.
 */

/** Segunda-feira da semana de `now` em BRT, como YYYY-MM-DD. */
export function brtMonday(now: Date): string {
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // wall-clock BRT em campos UTC
  const dow = brt.getUTCDay(); // 0=Dom..6=Sáb
  const sinceMonday = (dow + 6) % 7; // dias desde segunda
  brt.setUTCDate(brt.getUTCDate() - sinceMonday);
  return brt.toISOString().slice(0, 10);
}

/** Adiciona `n` semanas a uma segunda (YYYY-MM-DD), retornando YYYY-MM-DD. */
export function addWeeks(monday: string, n: number): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Lista de segundas (YYYY-MM-DD) de `from` até `to` inclusive, ascendente.
 * Cap de segurança em ~520 semanas (10 anos) pra blindar régua absurda.
 */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let w = from;
  for (let i = 0; w <= to && i < 520; i++) {
    out.push(w);
    w = addWeeks(w, 1);
  }
  return out;
}

/** dd/mm de uma data YYYY-MM-DD (eixo da régua). */
export function ddmm(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
