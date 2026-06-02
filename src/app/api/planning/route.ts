/**
 * POST /api/planning
 * Cria uma PlanningCeremony em phase='idle'. Modelo "1 planning viva por
 * sprint": só pode existir UMA planning não-arquivada por sprint. Se já houver,
 * retorna 409 com { existingPlanningId } pra UI redirecionar pra ela.
 *
 * Body: { projectId, sprintId?, facilitatorId?, scheduledFor? }
 *
 * Auto-sprint: se sprintId NÃO for passado, garante uma sprint da semana
 * corrente (seg→dom). Se já existe sprint cobrindo hoje no projeto, usa ela;
 * senão cria uma nova com nome calculado pelo helper (Sprint N pela ordem
 * cronológica). Evita o erro "associe uma sprint primeiro" no fluxo da UI.
 *
 * Auth: caller precisa ter acesso ao projeto (canViewProject).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { createPlanning, findActivePlanningForSprint } from "@/lib/dal/planning";
import { db } from "@/lib/db";
import {
  getNextSprintDefaults,
  mondayOf,
  sundayOf,
  toDateStr,
} from "@/lib/sprint-dates";

type Body = {
  projectId: string;
  sprintId?: string | null;
  facilitatorId?: string | null;
  scheduledFor?: string | null;
};

async function ensureCurrentWeekSprint(projectId: string): Promise<string | null> {
  const supabase = db();
  const today = new Date();
  const weekStart = toDateStr(mondayOf(today));
  const weekEnd = toDateStr(sundayOf(mondayOf(today)));

  // Já há sprint cobrindo a semana corrente? (interseção de janelas)
  const { data: existingForWeek } = await supabase
    .from("Sprint")
    .select("id")
    .eq("projectId", projectId)
    .lte("startDate", weekEnd)
    .gte("endDate", weekStart)
    .limit(1);
  if (existingForWeek && existingForWeek.length > 0) {
    return existingForWeek[0].id;
  }

  // Calcula próxima Sprint N pela posição cronológica.
  const { data: all } = await supabase
    .from("Sprint")
    .select("startDate, endDate")
    .eq("projectId", projectId);
  const defaults = getNextSprintDefaults(all ?? [], weekStart);

  const { data: created, error } = await supabase
    .from("Sprint")
    .insert({
      id: crypto.randomUUID(),
      projectId,
      name: defaults.name,
      startDate: defaults.startDate,
      endDate: defaults.endDate,
      status: "active",
      updatedAt: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.projectId) {
    return NextResponse.json({ error: "projectId obrigatório" }, { status: 400 });
  }

  const denied = await requireProjectViewApi(body.projectId);
  if (denied) return denied;

  try {
    const sprintId = body.sprintId ?? (await ensureCurrentWeekSprint(body.projectId));

    // "1 planning viva por sprint": se já existe uma ativa, devolve ela pro
    // caller redirecionar em vez de criar duplicata.
    if (sprintId) {
      const existing = await findActivePlanningForSprint(body.projectId, sprintId);
      if (existing) {
        return NextResponse.json(
          { error: "Já existe uma planning ativa pra essa sprint", existingPlanningId: existing.id },
          { status: 409 },
        );
      }
    }

    const planning = await createPlanning({
      projectId: body.projectId,
      sprintId,
      facilitatorId: body.facilitatorId ?? null,
      scheduledFor: body.scheduledFor ?? new Date().toISOString(),
    });
    return NextResponse.json(planning, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Falha ao criar Planning", detail: msg }, { status: 500 });
  }
}
