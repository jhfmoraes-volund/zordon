import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { addDays, startOfDay, startOfWeek, bucketTasksByWeek, type DoneTaskEvent } from "@/lib/weekBuckets";

/**
 * GET /api/members/[id]/insights?weeks=12
 *
 * Throughput histórico: FP *entregue* (Task.doneAt) por semana, nas últimas
 * N semanas, com breakdown por projeto. Difere de sprint_member_capacity.fp_done
 * (que é baseado em status atual, não em timestamp) — aqui a métrica é
 * doneAt-based, pra refletir entrega ao longo do tempo.
 *
 * O "planejado por semana" (plan vs done, aderência ao contrato) NÃO vem daqui:
 * a aba Gestão já tem os sprints com fp_allocation/fp_planned prorráveis via
 * bucketSprintsByWeek. O client combina as duas séries. Evita duplicar proração.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const url = new URL(req.url);
  const weeks = Math.min(Math.max(Number(url.searchParams.get("weeks")) || 12, 1), 52);

  // Janela: início da semana corrente − (weeks-1) semanas.
  const windowStart = addDays(startOfWeek(startOfDay(new Date())), -7 * (weeks - 1));

  const supabase = db();

  // Tasks DONE atribuídas a este membro dentro da janela.
  // TaskAssignment → Task (status done, doneAt na janela). Projeto vem de Task.projectId.
  const { data, error } = await supabase
    .from("TaskAssignment")
    .select("task:Task!inner(doneAt, functionPoints, projectId, status, project:Project(id, name))")
    .eq("memberId", id)
    .eq("task.status", "done")
    .gte("task.doneAt", windowStart.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    task: {
      doneAt: string | null;
      functionPoints: number | null;
      projectId: string;
      status: string;
      project: { id: string; name: string } | null;
    } | null;
  };

  const events: DoneTaskEvent[] = [];
  for (const row of (data as Row[] | null) ?? []) {
    const t = row.task;
    if (!t || !t.doneAt) continue;
    events.push({
      doneAt: t.doneAt,
      fp: Number(t.functionPoints) || 0,
      projectId: t.projectId,
      projectName: t.project?.name ?? "?",
    });
  }

  const buckets = bucketTasksByWeek(events, weeks);

  return NextResponse.json({
    weeks: buckets.map((b) => ({
      weekStart: b.weekStart.toISOString(),
      weekEnd: b.weekEnd.toISOString(),
      isCurrent: b.isCurrent,
      doneFp: b.doneFp,
      byProject: b.byProject,
    })),
  });
}
