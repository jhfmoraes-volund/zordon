/**
 * Sprint date rules — single source of truth.
 *
 * Sprint = 7 dias, sempre segunda → domingo (local time).
 * FDS conta na sprint corrente (não vira buffer da próxima).
 *
 * Trava paralela: CHECK constraint no Postgres garante a mesma regra
 * mesmo em inserts diretos via SQL.
 */

/** Returns the Monday of the week containing `d`, or `d` itself if Monday. */
export function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}

/** Sprint end = Monday + 6 days = Sunday. */
export function sundayOf(monday: Date): Date {
  return new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6,
  );
}

/** Local YYYY-MM-DD — avoids the toISOString() UTC drift. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Is this a Monday in local time? */
export function isMonday(d: Date): boolean {
  return d.getDay() === 1;
}

export type ExistingSprint = { startDate: string; endDate: string };

/**
 * Defaults para a próxima sprint de um projeto.
 *
 * - Sem `targetStartDate`: sugere a segunda imediatamente após a última sprint
 *   (ou a segunda da semana corrente, se não há sprints).
 * - Com `targetStartDate`: assume que o usuário escolheu uma semana específica
 *   (ex: antecipou pra antes da Sprint 1) e calcula o número pela posição
 *   cronológica naquela data — quantas sprints começam antes + 1.
 *
 * O número final no banco é garantido pelo trigger Postgres
 * (renumber_sprints_chronologically); este helper produz só o label inicial
 * que aparece na UI antes do save.
 */
export function getNextSprintDefaults(
  existing: ExistingSprint[],
  targetStartDate?: string,
) {
  let monday: Date;
  if (targetStartDate) {
    monday = mondayOf(new Date(`${targetStartDate}T00:00:00`));
  } else {
    const sortedDesc = [...existing].sort(
      (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime(),
    );
    const lastSprint = sortedDesc[0];
    if (lastSprint) {
      const afterLast = new Date(lastSprint.endDate);
      afterLast.setDate(afterLast.getDate() + 1);
      monday = mondayOf(afterLast);
    } else {
      monday = mondayOf(new Date());
    }
  }

  const startStr = toDateStr(monday);
  const earlierCount = existing.filter((s) => s.startDate < startStr).length;

  return {
    name: `Sprint ${earlierCount + 1}`,
    startDate: startStr,
    endDate: toDateStr(sundayOf(monday)),
  };
}

/** Shift a sprint window by ±N weeks. Returns fresh start/end strings. */
export function shiftSprintByWeeks(startDateStr: string, weeks: number) {
  const start = new Date(startDateStr);
  const shifted = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + weeks * 7,
  );
  const monday = mondayOf(shifted); // re-snap (defensivo, contra TZ drift)
  return {
    startDate: toDateStr(monday),
    endDate: toDateStr(sundayOf(monday)),
  };
}
