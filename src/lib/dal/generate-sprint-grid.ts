import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { notifySprintLifecycle } from "@/lib/dal/notifications";
// mondayOf do pm-review snapa PRA TRÁS (segunda da semana ISO que contém a
// data) — mesma função que a régua da overview usa. O mondayOf de
// sprint-dates snapa pra frente (próxima segunda) e divergiria da régua.
import { mondayOf as mondayOfWeekISO } from "@/lib/dal/pm-review";
import { sundayOf, toDateStr } from "@/lib/sprint-dates";

/** Soma N semanas a uma segunda ISO (YYYY-MM-DD) — espelho do project-overview. */
function addWeeksISO(mondayISO: string, weeks: number): string {
  const d = new Date(`${mondayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 10);
}

function mondayOfDateStr(dateStr: string): string {
  return mondayOfWeekISO(new Date(`${dateStr.slice(0, 10)}T00:00:00Z`));
}

export type SprintGridPlan = {
  totalWeeks: number;
  count: number;
  pastHoles: number;
  existingInWindow: number;
  willActivateCurrentWeek: boolean;
  firstStart: string | null;
  lastStart: string | null;
};

export type SprintGridResult =
  | {
      ok: true;
      plan: SprintGridPlan;
      created: number;
      activatedSprintId: string | null;
    }
  | {
      ok: false;
      reason: "project_not_found" | "missing_dates" | "conflict" | "error";
      message: string;
    };

/**
 * Materializa a grade semanal (seg→dom) faltante entre a semana corrente e o
 * prazo do projeto (Project.startDate → Project.endDate, que vêm da vigência do
 * contrato via trigger contract_sync_project_dates) — espelha a grade que a
 * overview calcula em computeStats (project-overview.ts).
 *
 * Núcleo compartilhado entre o endpoint manual (POST .../generate-sprints) e o
 * seed automático na ativação do contrato (finance/dal.ts).
 *
 * Regras:
 * - Semana com sprint existente é pulada (dedupe por segunda; UNIQUE
 *   (projectId, startDate) é a trava final).
 * - Semanas passadas sem sprint NÃO são criadas retroativamente — sprint vazia
 *   "completed" inflaria donePct; a régua da overview já as mostra como buraco.
 * - Se o projeto não tem sprint ativa, a da semana corrente é ativada via RPC
 *   activate_sprint (mesma invariante + notificação do POST /activate).
 * - Nomes entram como placeholder; o trigger renumber_sprints_chronologically
 *   renomeia tudo pra "Sprint N" por ordem de startDate no mesmo statement.
 *
 * `dryRun` devolve só o plano (a UI usa pra montar o ConfirmDialog). Idempotente:
 * re-rodar só cria semanas que ainda não existem.
 */
export async function generateSprintGrid(
  supabase: SupabaseClient<Database>,
  projectId: string,
  opts: { dryRun?: boolean; actorMemberId?: string | null } = {},
): Promise<SprintGridResult> {
  const projectRes = await supabase
    .from("Project")
    .select("startDate, endDate")
    .eq("id", projectId)
    .single();
  if (projectRes.error) {
    return { ok: false, reason: "project_not_found", message: "Projeto não encontrado." };
  }
  const { startDate, endDate } = projectRes.data;
  if (!startDate || !endDate) {
    return {
      ok: false,
      reason: "missing_dates",
      message:
        "Projeto sem data de início e/ou prazo. Defina a vigência do contrato pra gerar a grade de sprints.",
    };
  }

  const sprintsRes = await supabase
    .from("Sprint")
    .select("id, startDate, status")
    .eq("projectId", projectId);
  if (sprintsRes.error) {
    return { ok: false, reason: "error", message: sprintsRes.error.message };
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
  const existingMondays = new Set(existing.map((s) => mondayOfDateStr(s.startDate)));

  const toCreate = weeks.filter((m) => m >= currentMonday && !existingMondays.has(m));
  const pastHoles = weeks.filter(
    (m) => m < currentMonday && !existingMondays.has(m),
  ).length;
  const hasActive = existing.some((s) => s.status === "active");
  const willActivateCurrentWeek = !hasActive && toCreate.includes(currentMonday);

  const plan: SprintGridPlan = {
    totalWeeks: weeks.length,
    count: toCreate.length,
    pastHoles,
    existingInWindow: weeks.length - toCreate.length - pastHoles,
    willActivateCurrentWeek,
    firstStart: toCreate[0] ?? null,
    lastStart: toCreate[toCreate.length - 1] ?? null,
  };

  if (opts.dryRun || toCreate.length === 0) {
    return { ok: true, plan, created: 0, activatedSprintId: null };
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
      return {
        ok: false,
        reason: "conflict",
        message:
          "Sprints foram criadas nessas semanas por outra pessoa enquanto você decidia. Recarregue.",
      };
    }
    return { ok: false, reason: "error", message: insertRes.error.message };
  }

  let activatedSprintId: string | null = null;
  if (willActivateCurrentWeek) {
    const currentRow = rows.find((r) => r.startDate === currentMonday)!;
    const actRes = await supabase.rpc("activate_sprint", { p_sprint_id: currentRow.id });
    if (actRes.error) {
      // Geração já persistiu — falha de ativação não derruba a operação.
      console.error("[generate-sprints] activate_sprint failed", actRes.error);
    } else {
      activatedSprintId = currentRow.id;
      notifySprintLifecycle({
        sprintId: currentRow.id,
        kind: "sprint_started",
        actorMemberId: opts.actorMemberId ?? null,
      }).catch((e) =>
        console.error("[notifications] sprint_started fanout failed", e),
      );
    }
  }

  return { ok: true, plan, created: rows.length, activatedSprintId };
}
