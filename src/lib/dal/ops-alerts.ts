/**
 * Ops alerts — Data Access Layer pros alertas operacionais
 * (`src/lib/metrics/alerts.ts`).
 *
 * Convenções (espelha src/lib/dal/capacity.ts):
 *   • `db()` (service_role) — bypassa RLS de propósito. Caller valida acesso
 *     ANTES (UI) ou roda como sistema (cron/Alpha).
 *   • Throw em erro; empty pra "não existe".
 *
 * As REGRAS (thresholds, recortes) moram no registry de alertas — aqui só
 * leitura. `count` é sempre o total real (`count: "exact"`); `items` é
 * amostra limitada pro detail da UI.
 */
import "server-only";
import { db } from "@/lib/db";

/** Quantos exemplares entram no detail do alerta (count é sempre total). */
export const ALERT_SAMPLE_LIMIT = 3;

export type TaskAlertRow = {
  reference: string;
  dueDate: string | null;
  projectName: string | null;
  assigneeName: string | null;
};

type TaskAlertQueryRow = {
  reference: string;
  dueDate: string | null;
  project: { name: string } | null;
  assignments: { member: { name: string } | null }[];
};

function toAlertRow(r: TaskAlertQueryRow): TaskAlertRow {
  return {
    reference: r.reference,
    dueDate: r.dueDate,
    projectName: r.project?.name ?? null,
    assigneeName: r.assignments[0]?.member?.name ?? null,
  };
}

/** Tasks abertas (fora done/draft, sem dismiss) com dueDate no passado. */
export async function getOverdueTasks(): Promise<{ count: number; items: TaskAlertRow[] }> {
  const { data, error, count } = await db()
    .from("Task")
    .select(
      "reference, dueDate, project:Project(name), assignments:TaskAssignment(member:Member(name))",
      { count: "exact" },
    )
    .lt("dueDate", new Date().toISOString())
    .neq("status", "done")
    .neq("status", "draft")
    .is("dismissedAt", null)
    .order("dueDate")
    .limit(ALERT_SAMPLE_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as unknown as TaskAlertQueryRow[];
  return { count: count ?? rows.length, items: rows.map(toAlertRow) };
}

/** Tasks in_progress sem update há `staleDays`+ dias (sem dismiss). */
export async function getStuckTasks(
  staleDays: number,
): Promise<{ count: number; items: TaskAlertRow[] }> {
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const { data, error, count } = await db()
    .from("Task")
    .select(
      "reference, dueDate, project:Project(name), assignments:TaskAssignment(member:Member(name))",
      { count: "exact" },
    )
    .eq("status", "in_progress")
    .lt("updatedAt", cutoff)
    .is("dismissedAt", null)
    .order("updatedAt")
    .limit(ALERT_SAMPLE_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as unknown as TaskAlertQueryRow[];
  return { count: count ?? rows.length, items: rows.map(toAlertRow) };
}

/** Tasks abertas em sprint ativa sem responsável — regra vive na RPC. */
export async function getUnassignedActiveCount(): Promise<number> {
  const { data, error } = await db().rpc("unassigned_active_task_count");
  if (error) throw error;
  return Number(data) || 0;
}
