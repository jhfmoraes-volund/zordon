import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAccessLevel, getActorMemberId, getUser } from "@/lib/dal";
import { notifySprintLifecycle } from "@/lib/dal/notifications";
// mondayOf do pm-review snapa PRA TRÁS (segunda da semana ISO que contém a
// data) — mesma função que a régua da overview usa. O mondayOf de
// sprint-dates snapa pra frente (próxima segunda) e divergiria da régua.
import { mondayOf as mondayOfWeekISO } from "@/lib/dal/pm-review";
import { hasMinAccessLevel } from "@/lib/roles";
import { sundayOf, toDateStr } from "@/lib/sprint-dates";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

/** Soma N semanas a uma segunda ISO (YYYY-MM-DD) — espelho do project-overview. */
function addWeeksISO(mondayISO: string, weeks: number): string {
  const d = new Date(`${mondayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 10);
}

function mondayOfDateStr(dateStr: string): string {
  return mondayOfWeekISO(new Date(`${dateStr.slice(0, 10)}T00:00:00Z`));
}

/**
 * POST /api/projects/:id/generate-sprints
 *
 * Cria todas as sprints semanais (seg→dom) faltantes entre a semana corrente
 * e o prazo do projeto (Project.startDate → Project.endDate) — espelha a grade
 * de semanas que a overview calcula em computeStats (project-overview.ts).
 *
 * Regras:
 * - Semana com sprint existente é pulada (UNIQUE (projectId, startDate)).
 * - Semanas passadas sem sprint NÃO são criadas retroativamente — sprint vazia
 *   "completed" inflaria donePct; a régua da overview já as mostra como buraco.
 * - Se o projeto não tem sprint ativa, a da semana corrente é ativada via RPC
 *   activate_sprint (mesma invariante + notificação do POST /activate).
 * - Nomes entram como placeholder; o trigger renumber_sprints_chronologically
 *   renomeia tudo pra "Sprint N" por ordem de startDate no mesmo statement.
 *
 * `{ dryRun: true }` só devolve o plano (a UI usa pra montar o ConfirmDialog).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const accessLevel = await getAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    return NextResponse.json(
      { error: "Apenas PMs e admins podem gerar sprints." },
      { status: 403 },
    );
  }

  const { id: projectId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const supabase = db();

  const projectRes = await supabase
    .from("Project")
    .select("startDate, endDate")
    .eq("id", projectId)
    .single();
  if (projectRes.error) {
    return NextResponse.json(
      { error: "Projeto não encontrado." },
      { status: 404 },
    );
  }
  const { startDate, endDate } = projectRes.data;
  if (!startDate || !endDate) {
    return NextResponse.json(
      {
        error:
          "Projeto sem data de início e/ou prazo. Defina as datas do projeto pra gerar a grade de sprints.",
      },
      { status: 422 },
    );
  }

  const sprintsRes = await supabase
    .from("Sprint")
    .select("id, startDate, status")
    .eq("projectId", projectId);
  if (sprintsRes.error) {
    return NextResponse.json(
      { error: sprintsRes.error.message },
      { status: 500 },
    );
  }
  const existing = sprintsRes.data ?? [];

  // Grade de semanas do prazo — mesma conta da régua da overview
  // (computeStats em project-overview.ts): segundas de startDate→endDate.
  const startMonday = mondayOfDateStr(startDate);
  const endMonday = mondayOfDateStr(endDate);
  const weeks: string[] = [];
  for (let m = startMonday; m <= endMonday; m = addWeeksISO(m, 1)) {
    weeks.push(m);
  }
  const currentMonday = mondayOfWeekISO(new Date());
  const existingMondays = new Set(
    existing.map((s) => mondayOfDateStr(s.startDate)),
  );

  const toCreate = weeks.filter(
    (m) => m >= currentMonday && !existingMondays.has(m),
  );
  const pastHoles = weeks.filter(
    (m) => m < currentMonday && !existingMondays.has(m),
  ).length;
  const hasActive = existing.some((s) => s.status === "active");
  const willActivateCurrentWeek =
    !hasActive && toCreate.includes(currentMonday);

  const plan = {
    totalWeeks: weeks.length,
    count: toCreate.length,
    pastHoles,
    existingInWindow: weeks.length - toCreate.length - pastHoles,
    willActivateCurrentWeek,
    firstStart: toCreate[0] ?? null,
    lastStart: toCreate[toCreate.length - 1] ?? null,
  };

  if (parsed.data.dryRun || toCreate.length === 0) {
    return NextResponse.json({ ...plan, created: 0 });
  }

  const nowIso = new Date().toISOString();
  const rows = toCreate.map((monday) => ({
    id: crypto.randomUUID(),
    projectId,
    // Placeholder único — o trigger de renumeração troca pra "Sprint N".
    name: `__gen_${monday}`,
    startDate: monday,
    endDate: toDateStr(sundayOf(new Date(`${monday}T00:00:00`))),
    status: "upcoming",
    updatedAt: nowIso,
  }));

  const insertRes = await supabase.from("Sprint").insert(rows);
  if (insertRes.error) {
    if (insertRes.error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Sprints foram criadas nessas semanas por outra pessoa enquanto você decidia. Recarregue.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: insertRes.error.message },
      { status: 500 },
    );
  }

  let activatedSprintId: string | null = null;
  if (willActivateCurrentWeek) {
    const currentRow = rows.find((r) => r.startDate === currentMonday)!;
    const actRes = await supabase.rpc("activate_sprint", {
      p_sprint_id: currentRow.id,
    });
    if (actRes.error) {
      // Geração já persistiu — falha de ativação não derruba a request.
      console.error("[generate-sprints] activate_sprint failed", actRes.error);
    } else {
      activatedSprintId = currentRow.id;
      const actorMemberId = await getActorMemberId();
      notifySprintLifecycle({
        sprintId: currentRow.id,
        kind: "sprint_started",
        actorMemberId,
      }).catch((e) =>
        console.error("[notifications] sprint_started fanout failed", e),
      );
    }
  }

  return NextResponse.json({ ...plan, created: rows.length, activatedSprintId });
}
