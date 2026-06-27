import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { getNextSprintDefaults } from "@/lib/sprint-dates";
import { SPRINT_GOAL_MAX_LENGTH } from "@/components/sprint/types";

export const dynamic = "force-dynamic";

const createSprintSchema = z.object({
  mode: z.literal("create"),
  name: z.string().min(1).max(80),
  goal: z.string().max(SPRINT_GOAL_MAX_LENGTH).optional().default(""),
  taskIds: z.array(z.string().uuid()).min(0).max(500),
});

const fillSprintSchema = z.object({
  mode: z.literal("fill"),
  existingSprintId: z.string().uuid(),
  goal: z.string().max(SPRINT_GOAL_MAX_LENGTH).optional(),
  taskIds: z.array(z.string().uuid()).min(0).max(500),
});

const sprintSchema = z.discriminatedUnion("mode", [
  createSprintSchema,
  fillSprintSchema,
]);

const bodySchema = z.object({
  sprints: z.array(sprintSchema).min(1).max(3),
});

type AppliedSprint = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  taskCount: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("sprint.write", { projectId });
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = db();

  // Para CREATE-mode, precisamos das datas. Buscamos sprints existentes pra
  // encadear (Monday → Sunday). FILL-mode usa datas da própria sprint.
  const hasCreate = parsed.data.sprints.some((s) => s.mode === "create");
  let existing: Array<{ startDate: string; endDate: string }> = [];
  if (hasCreate) {
    const existingRes = await supabase
      .from("Sprint")
      .select("startDate, endDate")
      .eq("projectId", projectId);
    if (existingRes.error) {
      return NextResponse.json(
        { error: existingRes.error.message },
        { status: 500 },
      );
    }
    existing = (existingRes.data ?? []).map((s) => ({
      startDate: s.startDate,
      endDate: s.endDate,
    }));
  }

  type CreatePayload = {
    name: string;
    goal: string;
    startDate: string;
    endDate: string;
    taskIds: string[];
  };
  type FillPayload = {
    existingSprintId: string;
    goal?: string;
    taskIds: string[];
  };
  const payload: Array<CreatePayload | FillPayload> = [];

  const accumulated = [...existing];
  for (const s of parsed.data.sprints) {
    if (s.mode === "create") {
      const defaults = getNextSprintDefaults(accumulated);
      payload.push({
        name: s.name,
        goal: s.goal ?? "",
        startDate: defaults.startDate,
        endDate: defaults.endDate,
        taskIds: s.taskIds,
      });
      accumulated.push({
        startDate: defaults.startDate,
        endDate: defaults.endDate,
      });
    } else {
      const item: FillPayload = {
        existingSprintId: s.existingSprintId,
        taskIds: s.taskIds,
      };
      if (s.goal !== undefined) item.goal = s.goal;
      payload.push(item);
    }
  }

  const rpcRes = await supabase.rpc("apply_sprint_suggestion" as never, {
    p_project_id: projectId,
    p_sprints: payload,
  } as never);

  if (rpcRes.error) {
    const msg = rpcRes.error.message ?? "apply failed";
    const code = rpcRes.error.code ?? "";
    const hint = rpcRes.error.hint ?? "";
    const details = rpcRes.error.details ?? "";
    // Log completo no servidor pra debug.
    console.error("[apply-sprint-suggestion] RPC error", {
      code,
      message: msg,
      hint,
      details,
      payload,
    });

    // RPC ausente — Supabase/PostgREST retorna PGRST202 ou erro tipo
    // "Could not find the function public.apply_sprint_suggestion".
    const fnMissing =
      code === "PGRST202" ||
      msg.includes("Could not find the function") ||
      msg.includes("does not exist") ||
      msg.includes("schema cache");
    if (fnMissing) {
      return NextResponse.json(
        {
          error:
            "A função apply_sprint_suggestion não está no banco. Rode a migration `supabase/migrations/20260511_apply_sprint_suggestion.sql` via psql.",
        },
        { status: 503 },
      );
    }

    // SQLSTATE 40001 = race (task already allocated OR sprint not empty).
    if (
      code === "40001" ||
      msg.includes("task_already_allocated") ||
      msg.includes("sprint_not_empty")
    ) {
      const friendly = msg.includes("sprint_not_empty")
        ? "A sprint escolhida não está mais vazia (alguém adicionou tasks). Recarregue."
        : "Uma ou mais tasks foram alocadas em outra sprint enquanto você decidia. Recarregue e sugira de novo.";
      return NextResponse.json({ error: friendly }, { status: 409 });
    }

    // Outros erros — devolve a mensagem real pra facilitar debug.
    return NextResponse.json(
      { error: `${msg}${details ? ` (${details})` : ""}` },
      { status: 500 },
    );
  }

  const data = (rpcRes.data ?? []) as AppliedSprint[];
  return NextResponse.json({ sprints: data });
}
