import { db } from "@/lib/db";

/**
 * Sprint Outcome digest — "memória de sprint" da Vitoria (runbook D11 / Fase 1).
 * Lê a view determinística sprint_outcome_digest e devolve as últimas N sprints
 * CONCLUÍDAS do projeto (o que fechou tem outcome; ativas/futuras já estão no
 * profile da planning). Alimenta continuidade semana-a-semana: velocity, o que
 * carregou pra frente e os temas de retro.
 */
export type SprintOutcome = {
  sprintId: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  goal: string | null;
  /** Tasks com status = 'done'. */
  doneCount: number;
  /** Tasks planejadas (status ∉ {draft,backlog}) que NÃO terminaram. */
  carryoverCount: number;
  /** Tasks planejadas no total (status ∉ {draft,backlog}). */
  totalCount: number;
  /** Σ FP done — a velocity da sprint. */
  velocityFp: number;
  /** Σ FP planejado (status ∉ {draft,backlog}). */
  plannedFp: number;
  /** Texto livre da retrospectiva, se preenchida. */
  retro: { good: string | null; bad: string | null; ideas: string | null } | null;
};

/**
 * Últimas `limit` sprints concluídas do projeto, mais recente primeiro.
 * Determinístico: a view faz toda a agregação no Postgres.
 */
export async function getSprintOutcomes(
  projectId: string,
  limit = 3,
): Promise<SprintOutcome[]> {
  const { data, error } = await db()
    .from("sprint_outcome_digest")
    .select(
      'sprintId, name, startDate, endDate, status, goal, planned_fp, velocity_fp, done_count, total_count, carryover_count, retro_good, retro_bad, retro_ideas, retro_completed_at',
    )
    .eq("projectId", projectId)
    .eq("status", "completed")
    .order("endDate", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((r) => {
    const hasRetro =
      r.retro_completed_at != null ||
      r.retro_good != null ||
      r.retro_bad != null ||
      r.retro_ideas != null;
    return {
      sprintId: r.sprintId as string,
      name: r.name,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      goal: r.goal,
      doneCount: r.done_count ?? 0,
      carryoverCount: r.carryover_count ?? 0,
      totalCount: r.total_count ?? 0,
      velocityFp: r.velocity_fp ?? 0,
      plannedFp: r.planned_fp ?? 0,
      retro: hasRetro
        ? { good: r.retro_good, bad: r.retro_bad, ideas: r.retro_ideas }
        : null,
    };
  });
}
