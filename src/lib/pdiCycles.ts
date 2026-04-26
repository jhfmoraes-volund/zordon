/**
 * PDI cycles run in fixed 6-month windows aligned with the calendar:
 *   H1 = Jan 1 → Jun 30
 *   H2 = Jul 1 → Dec 31
 *
 * Members who join mid-cycle take part in the current cycle until it ends.
 */

export type PdiCycle = {
  label: string;       // "H1/2026"
  startDate: Date;     // local time, midnight
  endDate: Date;       // local time, midnight (inclusive)
};

export function getCurrentCycle(today: Date = new Date()): PdiCycle {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-11
  if (month < 6) {
    return {
      label: `H1/${year}`,
      startDate: new Date(year, 0, 1),
      endDate: new Date(year, 5, 30),
    };
  }
  return {
    label: `H2/${year}`,
    startDate: new Date(year, 6, 1),
    endDate: new Date(year, 11, 31),
  };
}

/** ISO YYYY-MM-DD (date-only) for a Date — used as the DB primary cycle key. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Days remaining until the cycle ends (negative if expired). */
export function daysRemaining(cycle: PdiCycle, today: Date = new Date()): number {
  const ms = cycle.endDate.getTime() - today.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** Cycle that includes the given start date, used to label past cycles. */
export function cycleLabelForStart(startDate: Date): string {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  return month < 6 ? `H1/${year}` : `H2/${year}`;
}

export const ACTION_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluído",
  cancelled: "Cancelado",
};
