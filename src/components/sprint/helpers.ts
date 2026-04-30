// Pure derivations for sprint computations. No side-effects, no fetching.

import type { Task } from "@/components/story-hierarchy";
import type { Sprint } from "./types";

/**
 * Resolve "current sprint" with the agreed fallback chain:
 *   1. Status === "active" (priorizado; mais antigo se múltiplos)
 *   2. Próximo sprint cujo endDate >= today (ordenado por startDate)
 *   3. Último sprint completed
 */
export function findCurrentSprint(
  sprints: Sprint[],
  now: Date = new Date(),
): Sprint | null {
  if (sprints.length === 0) return null;

  const active = sprints
    .filter((s) => s.status === "active")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (active.length > 0) return active[0];

  const today = now.toISOString().slice(0, 10);
  const future = sprints
    .filter((s) => s.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (future.length > 0) return future[0];

  const completed = sprints
    .filter((s) => s.status === "completed")
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
  if (completed.length > 0) return completed[0];

  return null;
}

export function tasksOfSprint(sprintId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.sprintId === sprintId);
}

export function sprintFP(
  sprintId: string,
  tasks: Task[],
): { total: number; done: number } {
  const own = tasksOfSprint(sprintId, tasks);
  return {
    total: own.reduce((acc, t) => acc + t.functionPoints, 0),
    done: own
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + t.functionPoints, 0),
  };
}

export function sprintTaskCounts(
  sprintId: string,
  tasks: Task[],
): { total: number; done: number } {
  const own = tasksOfSprint(sprintId, tasks);
  return {
    total: own.length,
    done: own.filter((t) => t.status === "done").length,
  };
}

export function projectStats(
  sprints: Sprint[],
  tasks: Task[],
): {
  sprints: number;
  totalTasks: number;
  doneTasks: number;
  totalFP: number;
  doneFP: number;
} {
  const sprintIds = new Set(sprints.map((s) => s.id));
  const sprintTasks = tasks.filter((t) => t.sprintId && sprintIds.has(t.sprintId));
  return {
    sprints: sprints.length,
    totalTasks: sprintTasks.length,
    doneTasks: sprintTasks.filter((t) => t.status === "done").length,
    totalFP: sprintTasks.reduce((acc, t) => acc + t.functionPoints, 0),
    doneFP: sprintTasks
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + t.functionPoints, 0),
  };
}

/** Days elapsed (1-based, clamped to total) and total span (inclusive). */
export function sprintDays(
  sprint: Sprint,
  now: Date = new Date(),
): { elapsed: number; total: number } {
  const start = new Date(sprint.startDate + "T00:00:00");
  const end = new Date(sprint.endDate + "T23:59:59");
  const dayMs = 1000 * 60 * 60 * 24;
  const total = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / dayMs) + 1,
  );
  const rawElapsed =
    Math.round((now.getTime() - start.getTime()) / dayMs) + 1;
  const elapsed = Math.max(0, Math.min(total, rawElapsed));
  return { elapsed, total };
}

/** Sum of done FP per memberId, across tasks of this sprint. */
export function deliveredFpByMember(
  sprintId: string,
  tasks: Task[],
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const t of tasksOfSprint(sprintId, tasks)) {
    if (t.status !== "done") continue;
    for (const id of t.assigneeIds) {
      acc[id] = (acc[id] ?? 0) + t.functionPoints;
    }
  }
  return acc;
}

// ─── Burndown ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export type BurndownPoint = {
  /** Day index 0..total. Day 0 = sprint start (anchor at totalFP). */
  day: number;
  /** YYYY-MM-DD of the day end. */
  date: string;
  /** Ideal FP remaining at end of this day (linear). */
  ideal: number;
  /** Actual FP remaining at end of this day. null if day is in the future. */
  actual: number | null;
  /** Projection from last actual day onward. null otherwise. */
  projected: number | null;
};

export type BurndownSeries = {
  points: BurndownPoint[];
  totalFP: number;
  totalDays: number;
};

/**
 * Daily burndown series for a sprint.
 *
 * Conventions:
 *  - Day 0 anchor sits at sprint start with `totalFP` (so the chart starts at the top).
 *  - Day d (1..total) represents end-of-day d.
 *  - `actual` is filled for days whose end is <= today; otherwise null.
 *  - `projected` is filled for days after the last actual point, using the
 *     simple velocity heuristic (avg FP done per day in last `lookbackDays`).
 */
export function burndownSeries(
  sprint: Sprint,
  tasks: Task[],
  now: Date = new Date(),
  lookbackDays = 3,
): BurndownSeries {
  const own = tasksOfSprint(sprint.id, tasks);
  const totalFP = own.reduce((acc, t) => acc + t.functionPoints, 0);

  const start = new Date(sprint.startDate + "T00:00:00");
  const end = new Date(sprint.endDate + "T23:59:59");
  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
  );

  // End-of-today as the cutoff for "actual"
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Aggregate FP done by day index (1..totalDays) using doneAt timestamps.
  const doneByDay: Record<number, number> = {};
  for (const t of own) {
    if (t.status !== "done" || !t.doneAt) continue;
    const doneTime = new Date(t.doneAt).getTime();
    const idx = Math.floor((doneTime - start.getTime()) / DAY_MS) + 1;
    if (idx >= 1 && idx <= totalDays) {
      doneByDay[idx] = (doneByDay[idx] ?? 0) + t.functionPoints;
    }
  }

  const points: BurndownPoint[] = [];

  // Day 0 anchor — sprint hasn't started consuming yet.
  points.push({
    day: 0,
    date: sprint.startDate,
    ideal: totalFP,
    actual: totalFP,
    projected: null,
  });

  let cumulativeDone = 0;
  let lastActualValue = totalFP;
  let lastActualDay = 0;

  for (let d = 1; d <= totalDays; d++) {
    const dayEnd = new Date(start.getTime() + (d - 1) * DAY_MS);
    dayEnd.setHours(23, 59, 59, 999);
    const dateStr = dayEnd.toISOString().slice(0, 10);

    cumulativeDone += doneByDay[d] ?? 0;
    const remaining = Math.max(0, totalFP - cumulativeDone);

    // Linear ideal: full at day 0, 0 at day total.
    const ideal = Math.max(0, totalFP * (1 - d / totalDays));

    const isPast = dayEnd.getTime() <= todayEnd.getTime();
    const actual = isPast ? remaining : null;

    if (actual !== null) {
      lastActualValue = actual;
      lastActualDay = d;
    }

    points.push({
      day: d,
      date: dateStr,
      ideal,
      actual,
      projected: null,
    });
  }

  // Projection — only if sprint isn't fully measured yet and there is signal.
  if (lastActualDay > 0 && lastActualDay < totalDays) {
    const lookbackStart = Math.max(1, lastActualDay - lookbackDays + 1);
    let recentDone = 0;
    for (let d = lookbackStart; d <= lastActualDay; d++) {
      recentDone += doneByDay[d] ?? 0;
    }
    const daysCounted = lastActualDay - lookbackStart + 1;
    const velocity = daysCounted > 0 ? recentDone / daysCounted : 0;

    if (velocity > 0) {
      // Anchor projection at the last actual point so the line starts there.
      points[lastActualDay].projected = lastActualValue;
      let proj = lastActualValue;
      for (let d = lastActualDay + 1; d <= totalDays; d++) {
        proj = Math.max(0, proj - velocity);
        points[d].projected = proj;
      }
    }
  }

  return { points, totalFP, totalDays };
}

export type Completion = {
  status: "ahead" | "on_track" | "behind" | "stalled" | "complete" | "unknown";
  /** Days vs sprint end. Negative = ahead, positive = behind. */
  etaDays: number;
  /** Short label for UI. */
  etaText: string;
  /** Average FP done per day in the lookback window. */
  velocity: number;
  /** FP still remaining today. */
  remaining: number;
};

/**
 * Project sprint completion using a simple velocity heuristic.
 * Suitable for both PM dashboards and Alpha responses ("how's the sprint?").
 */
export function projectCompletion(
  sprint: Sprint,
  tasks: Task[],
  now: Date = new Date(),
  lookbackDays = 3,
): Completion {
  const own = tasksOfSprint(sprint.id, tasks);
  const totalFP = own.reduce((acc, t) => acc + t.functionPoints, 0);
  if (totalFP === 0) {
    return {
      status: "unknown",
      etaDays: 0,
      etaText: "—",
      velocity: 0,
      remaining: 0,
    };
  }

  const start = new Date(sprint.startDate + "T00:00:00");
  const end = new Date(sprint.endDate + "T23:59:59");
  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
  );

  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const currentDay = Math.max(
    0,
    Math.min(
      totalDays,
      Math.floor((todayEnd.getTime() - start.getTime()) / DAY_MS) + 1,
    ),
  );

  const doneFP = own
    .filter(
      (t) =>
        t.status === "done" &&
        t.doneAt &&
        new Date(t.doneAt).getTime() <= todayEnd.getTime(),
    )
    .reduce((acc, t) => acc + t.functionPoints, 0);
  const remaining = Math.max(0, totalFP - doneFP);

  if (remaining === 0) {
    return {
      status: "complete",
      etaDays: currentDay - totalDays,
      etaText: "completo",
      velocity: 0,
      remaining: 0,
    };
  }

  // Velocity: avg FP done per day, last `lookbackDays` (clamped).
  const lookbackStart = Math.max(
    1,
    currentDay - lookbackDays + 1,
  );
  const lookbackEnd = currentDay;
  const lookbackWindowMs =
    Math.max(1, lookbackEnd - lookbackStart + 1) * DAY_MS;
  const windowStartTime =
    start.getTime() + (lookbackStart - 1) * DAY_MS;
  const windowEndTime = windowStartTime + lookbackWindowMs;

  const recentDone = own
    .filter(
      (t) =>
        t.status === "done" &&
        t.doneAt &&
        (() => {
          const ts = new Date(t.doneAt!).getTime();
          return ts >= windowStartTime && ts < windowEndTime;
        })(),
    )
    .reduce((acc, t) => acc + t.functionPoints, 0);

  const daysCounted = Math.max(1, lookbackEnd - lookbackStart + 1);
  const velocity = recentDone / daysCounted;

  if (velocity <= 0) {
    return {
      status: "stalled",
      etaDays: Number.POSITIVE_INFINITY,
      etaText: "sem velocity — replanejar",
      velocity: 0,
      remaining,
    };
  }

  const daysToZero = remaining / velocity;
  const projectedZeroDay = currentDay + daysToZero;
  const eta = projectedZeroDay - totalDays;
  const roundedEta = Math.round(eta * 10) / 10;

  if (roundedEta < -0.5) {
    const days = Math.abs(Math.round(roundedEta));
    return {
      status: "ahead",
      etaDays: roundedEta,
      etaText: `${days} dia${days === 1 ? "" : "s"} antes`,
      velocity,
      remaining,
    };
  }
  if (roundedEta <= 0.5) {
    return {
      status: "on_track",
      etaDays: roundedEta,
      etaText: "no ritmo",
      velocity,
      remaining,
    };
  }
  if (roundedEta <= 2) {
    const days = Math.max(1, Math.round(roundedEta));
    return {
      status: "behind",
      etaDays: roundedEta,
      etaText: `+${days} dia${days === 1 ? "" : "s"}`,
      velocity,
      remaining,
    };
  }
  return {
    status: "behind",
    etaDays: roundedEta,
    etaText: `+${Math.round(roundedEta)} dias — replanejar`,
    velocity,
    remaining,
  };
}
