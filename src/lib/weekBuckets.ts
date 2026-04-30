/**
 * Bucket sprint allocations into ISO weeks (Monday → Sunday) and
 * prorate FP by the overlapping days. Assumes weekly capacity =
 * Member.fpCapacity, since the company runs 7-day sprints.
 *
 * A sprint that starts on a Monday fits exactly in one week. A sprint
 * shifted by N days splits across two weeks proportionally:
 *   weekFp = sprintFp × (overlapDays / sprintTotalDays)
 */

export type SprintInput = {
  sprintId: string;
  sprintName: string;
  startDate: string; // ISO
  endDate: string; // ISO
  status: string;
  projectId: string;
  projectName: string;
  fpAllocation: number;
  /** Status ≠ backlog. Métrica primária. */
  fpPlanned: number;
  /** Status = done. */
  fpDone: number;
  /** Status ∈ OPEN_STATUSES. */
  fpOpen: number;
  /** @deprecated alias de fpOpen — removido na Fase 16 */
  fpUsed: number;
  hasOverride: boolean;
};

export type WeekSprintRow = {
  sprintId: string;
  sprintName: string;
  projectId: string;
  projectName: string;
  sprintStart: Date;
  sprintEnd: Date;
  sprintStatus: string;
  /** Days of this sprint that fall inside the week (1..7). */
  overlapDays: number;
  /** Total days of the sprint (used for ratio display). */
  sprintTotalDays: number;
  /** Prorated FP allocation (contract) for the week. */
  fpAllocationWeek: number;
  /** Prorated FP planned (≠ backlog) for the week. */
  fpPlannedWeek: number;
  /** Prorated FP done for the week. */
  fpDoneWeek: number;
  /** Prorated FP open for the week. */
  fpOpenWeek: number;
  /** @deprecated alias de fpOpenWeek — removido na Fase 16 */
  fpUsedWeek: number;
  hasOverride: boolean;
};

export type WeekBucket = {
  weekStart: Date;
  weekEnd: Date;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  sprints: WeekSprintRow[];
  totalAllocation: number;
  /** Métrica primária: planejado da semana (≠ backlog). */
  totalPlanned: number;
  totalDone: number;
  totalOpen: number;
  /** @deprecated alias de totalOpen — removido na Fase 16 */
  totalUsed: number;
};

// ─── Date utilities ──────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday of the week the date falls in. BR convention: week starts Monday. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * Inclusive overlap in whole days between two date ranges.
 * All inputs MUST be at startOfDay (midnight) — keep it simple, no mixing.
 */
export function overlapDays(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end < start) return 0;
  return diffDays(start, end) + 1;
}

// ─── Bucketing ───────────────────────────────────────────

type Options = {
  /** Start of the visible range, defaults to current week's Monday. */
  rangeStart?: Date;
  /** Number of weeks to render. */
  weeks: number;
  /** When true, also includes 1 past week before rangeStart. */
  includePast?: boolean;
  /** Optional project filter. */
  projectId?: string | null;
};

/**
 * Build the list of week buckets for the given range, populating each
 * with the sprints that overlap and their prorated FP.
 */
export function bucketSprintsByWeek(
  sprints: SprintInput[],
  options: Options,
): WeekBucket[] {
  const today = startOfDay(new Date());
  const currentWeekStart = startOfWeek(today);
  const baseStart = options.rangeStart
    ? startOfWeek(options.rangeStart)
    : currentWeekStart;
  const firstWeek = options.includePast ? addDays(baseStart, -7) : baseStart;

  const buckets: WeekBucket[] = [];
  for (let i = 0; i < options.weeks; i++) {
    const weekStart = addDays(firstWeek, i * 7);
    const weekEnd = addDays(weekStart, 6);
    const isCurrent = weekStart.getTime() === currentWeekStart.getTime();
    const isPast = weekEnd < currentWeekStart;
    const isFuture = weekStart > currentWeekStart;

    const rows: WeekSprintRow[] = [];
    for (const s of sprints) {
      if (options.projectId && s.projectId !== options.projectId) continue;
      // Normalize all dates to startOfDay so day arithmetic is unambiguous.
      const sprintStart = startOfDay(new Date(s.startDate));
      const sprintEnd = startOfDay(new Date(s.endDate));
      const overlap = overlapDays(weekStart, weekEnd, sprintStart, sprintEnd);
      if (overlap <= 0) continue;
      const sprintTotalDays = Math.max(1, diffDays(sprintStart, sprintEnd) + 1);
      const ratio = overlap / sprintTotalDays;
      const fpOpenWeek = Math.round(s.fpOpen * ratio);
      rows.push({
        sprintId: s.sprintId,
        sprintName: s.sprintName,
        projectId: s.projectId,
        projectName: s.projectName,
        sprintStart,
        sprintEnd,
        sprintStatus: s.status,
        overlapDays: overlap,
        sprintTotalDays,
        fpAllocationWeek: Math.round(s.fpAllocation * ratio),
        fpPlannedWeek: Math.round(s.fpPlanned * ratio),
        fpDoneWeek: Math.round(s.fpDone * ratio),
        fpOpenWeek,
        fpUsedWeek: fpOpenWeek,
        hasOverride: s.hasOverride,
      });
    }

    rows.sort((a, b) => b.fpAllocationWeek - a.fpAllocationWeek);

    const totalOpen = rows.reduce((acc, r) => acc + r.fpOpenWeek, 0);
    buckets.push({
      weekStart,
      weekEnd,
      isCurrent,
      isPast,
      isFuture,
      sprints: rows,
      totalAllocation: rows.reduce((acc, r) => acc + r.fpAllocationWeek, 0),
      totalPlanned: rows.reduce((acc, r) => acc + r.fpPlannedWeek, 0),
      totalDone: rows.reduce((acc, r) => acc + r.fpDoneWeek, 0),
      totalOpen,
      totalUsed: totalOpen,
    });
  }

  return buckets;
}
