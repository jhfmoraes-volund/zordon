import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Supabase = SupabaseClient<Database>;
type ActionRow = Database["public"]["Tables"]["MeetingTaskAction"]["Row"];
type TaskUpdate = Database["public"]["Tables"]["Task"]["Update"];

type ApplyResult = {
  applied: number;
  failed: number;
  skipped: number;
  details: Array<{ id: string; type: string; status: "applied" | "failed" | "skipped"; error?: string }>;
};

const ORDER: Record<ActionRow["type"], number> = {
  create: 0,
  update: 1,
  review: 2,
  move: 3,
  delete: 4,
};

/**
 * D4 (Planning Vivo Versionado) — "trabalho em curso é congelado ao re-planning".
 * Status que representam trabalho que o builder JÁ COMEÇOU: o agente não pode
 * mover/editar/remover via re-plano sem atropelar o builder. Mais amplo que o
 * literal "in_progress/done" do D4 de propósito — `review` também é trabalho
 * começado. O PM ainda muta direto na TaskSheet (não passa por este executor).
 */
const FROZEN_STATUSES = new Set(["in_progress", "review", "done"]);

/** Sinaliza "pula esta action" (vs falhar) quando bate no guard de status D4. */
class FrozenTaskSkip extends Error {
  constructor(taskStatus: string) {
    super(
      `task '${taskStatus}' — congelada (trabalho em curso); não tocada pra não atropelar o builder (D4)`,
    );
    this.name = "FrozenTaskSkip";
  }
}

/**
 * Guard D4: se a action é da IA e a task-alvo está em status congelado, lança
 * FrozenTaskSkip → applyActions marca `skipped` (não `failed`). A realidade do
 * board é INPUT, não erro. Actions de origem humana passam direto (intenção do PM).
 */
async function guardFrozenForAi(
  supabase: Supabase,
  action: ActionRow,
): Promise<void> {
  if (action.source !== "ai" || !action.taskId) return;
  const { data: task } = await supabase
    .from("Task")
    .select("status")
    .eq("id", action.taskId)
    .maybeSingle();
  if (task && FROZEN_STATUSES.has(task.status)) {
    throw new FrozenTaskSkip(task.status);
  }
}

export async function applyApprovedActions(
  supabase: Supabase,
  meetingId: string
): Promise<ApplyResult> {
  const { data: actions, error } = await supabase
    .from("MeetingTaskAction")
    .select("*")
    .eq("meetingId", meetingId)
    .eq("decision", "approved")
    .eq("execution", "pending");

  if (error) throw new Error(`Failed to load actions: ${error.message}`);

  return applyActions(supabase, actions ?? []);
}

/**
 * Staging-commit: ao Concluir uma planning, todas as MeetingTaskAction
 * pendentes são auto-aprovadas e aplicadas em cascata. Sem aprovação por
 * card — discordâncias acontecem via chat (Vitoria apaga a action) antes do
 * commit.
 */
export async function applyPendingActionsForPlanning(
  supabase: Supabase,
  planningCeremonyId: string,
  decidedById: string,
): Promise<ApplyResult> {
  const { data: actions, error } = await supabase
    .from("MeetingTaskAction")
    .select("*")
    .eq("planningCeremonyId", planningCeremonyId)
    .eq("decision", "pending")
    .eq("execution", "pending");

  if (error) throw new Error(`Failed to load planning actions: ${error.message}`);

  const list = actions ?? [];
  if (list.length === 0) return { applied: 0, failed: 0, skipped: 0, details: [] };

  // Sprint da planning = destino default dos creates. Propostas da Vitoria não
  // carregam sprint (targetSprintId é contrato do move); sem este fallback as
  // tasks criadas no conclude caíam no backlog em vez da sprint planejada.
  const { data: planning, error: planningErr } = await supabase
    .from("PlanningCeremony")
    .select("sprintId")
    .eq("id", planningCeremonyId)
    .single();
  if (planningErr) throw new Error(`Failed to load planning sprint: ${planningErr.message}`);

  // Auto-aprova em batch antes de aplicar — apply* assume action.decision já
  // resolvido (e usa decidedById em apply create pra carimbar createdById).
  const nowIso = new Date().toISOString();
  const { error: approveErr } = await supabase
    .from("MeetingTaskAction")
    .update({ decision: "approved", decidedAt: nowIso, decidedById, updatedAt: nowIso })
    .eq("planningCeremonyId", planningCeremonyId)
    .eq("decision", "pending");
  if (approveErr) throw new Error(`Auto-approve failed: ${approveErr.message}`);

  const refreshed = list.map((a) => ({
    ...a,
    decision: "approved" as const,
    decidedAt: nowIso,
    decidedById,
  }));

  return applyActions(supabase, refreshed, planning.sprintId);
}

async function applyActions(
  supabase: Supabase,
  actions: ActionRow[],
  fallbackSprintId: string | null = null,
): Promise<ApplyResult> {
  const sorted = actions.slice().sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  const result: ApplyResult = { applied: 0, failed: 0, skipped: 0, details: [] };

  for (const action of sorted) {
    try {
      switch (action.type) {
        case "create":
          await applyCreate(supabase, action, fallbackSprintId);
          break;
        case "update":
          await applyUpdate(supabase, action);
          break;
        case "delete":
          await applyDelete(supabase, action);
          break;
        case "move":
          await applyMove(supabase, action);
          break;
        case "review":
          // REVIEW não modifica a Task — só fica registrado na reunião.
          await markExecuted(supabase, action.id, "skipped");
          result.skipped++;
          result.details.push({ id: action.id, type: action.type, status: "skipped" });
          continue;
      }
      await markExecuted(supabase, action.id, "applied");
      await recordProposalOutcome(supabase, action);
      result.applied++;
      result.details.push({ id: action.id, type: action.type, status: "applied" });
    } catch (e) {
      if (e instanceof FrozenTaskSkip) {
        // D4: trabalho em curso é congelado ao agente — skip, NÃO fail.
        await markExecuted(supabase, action.id, "skipped");
        result.skipped++;
        result.details.push({ id: action.id, type: action.type, status: "skipped", error: e.message });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await markFailed(supabase, action.id, msg);
        result.failed++;
        result.details.push({ id: action.id, type: action.type, status: "failed", error: msg });
      }
    }
  }

  return result;
}

/**
 * Registra AgentProposalOutcome quando uma MeetingTaskAction proposta pela
 * IA é commitada. Diferencia 'accepted' (sem edição do PM) de 'edited'
 * (PM mexeu via UI/chat antes do commit). Não registra propostas de origem
 * humana — outcome só faz sentido pra medir qualidade da IA.
 *
 * Heurística de agentName: planningCeremonyId → 'vitoria'; senão → 'alpha'.
 */
async function recordProposalOutcome(supabase: Supabase, action: ActionRow): Promise<void> {
  if (action.source !== "ai") return;

  const agentName = action.planningCeremonyId ? "vitoria" : "alpha";
  const decision = action.wasEdited ? "edited" : "accepted";
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const fpEstimated =
    typeof payload.functionPoints === "number" ? payload.functionPoints : null;

  const { error } = await supabase.from("AgentProposalOutcome").insert({
    proposalId: action.id,
    agentName,
    callKind: "turn",
    decision,
    fpEstimated,
  });

  if (error) {
    console.error("[recordProposalOutcome] insert failed:", error.message);
  }
}

/**
 * Normaliza acceptanceCriteria do payload pra `string[]` de textos limpos.
 * Aceita string (shape da Vitoria), `{text}` (legado/UI) ou `{criterion}`/
 * `{description}`. Descarta vazios. Espelha coerceAcList da sheet de proposta.
 */
function coerceAcTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return (o.text ?? o.criterion ?? o.description ?? "") as string;
      }
      return "";
    })
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
}

// ─── Per-type apply ──────────────────────────────────────

async function applyCreate(
  supabase: Supabase,
  action: ActionRow,
  fallbackSprintId: string | null = null,
) {
  const p = (action.payload ?? {}) as Record<string, unknown>;

  const { data: reference, error: rpcErr } = await supabase.rpc(
    "next_task_reference",
    { p_project_id: action.projectId },
  );
  if (rpcErr || !reference) {
    throw new Error(`Failed to get next task reference: ${rpcErr?.message ?? "no value"}`);
  }

  // Validate userStoryId belongs to this project (fail-soft: link null + log)
  let userStoryId: string | null = null;
  if (typeof p.userStoryId === "string" && p.userStoryId) {
    const { data: story } = await supabase
      .from("UserStory")
      .select("id")
      .eq("id", p.userStoryId)
      .eq("projectId", action.projectId)
      .maybeSingle();
    if (story) {
      userStoryId = p.userStoryId;
    } else {
      console.warn(
        `applyCreate: userStoryId ${p.userStoryId} not found in project ${action.projectId}, linking null`,
      );
    }
  }

  const taskId = crypto.randomUUID();
  // Precedência: payload explícito > targetSprintId da action > sprint da planning.
  const sprintId =
    (p.sprintId as string | null) ?? action.targetSprintId ?? fallbackSprintId;
  // Default de status acompanha sprintId: sem sprint = backlog, com sprint = todo.
  // Protege contra Alpha propondo create sem sprint+status (resultado seria
  // task "todo" órfã, que não aparece no kanban da sprint nem no backlog).
  const defaultStatus = sprintId ? "todo" : "backlog";
  const status = (p.status as string) ?? defaultStatus;
  // Backfill: task criada já 'done' carrega quando foi entregue (payload.doneAt
  // explícito > dueDate > agora) pra timeline/métricas não ficarem furadas.
  const doneAt =
    status === "done"
      ? ((p.doneAt as string) ?? (p.dueDate as string) ?? new Date().toISOString())
      : null;
  const { error: insErr } = await supabase.from("Task").insert({
    id: taskId,
    reference: reference as string,
    title: (p.title as string) ?? "Nova task",
    description: (p.description as string) ?? null,
    status,
    type: (p.type as string) ?? "feature",
    scope: (p.scope as string) ?? "small",
    complexity: (p.complexity as string) ?? "medium",
    priority: (p.priority as number) ?? 0,
    billable: (p.billable as boolean) ?? true,
    functionPoints: (p.functionPoints as number | null) ?? null,
    notes: (p.notes as string) ?? null,
    dueDate: (p.dueDate as string) ?? null,
    doneAt,
    projectId: action.projectId,
    sprintId,
    userStoryId,
    createdById: action.decidedById,
    createdByAgent: action.source === "ai",
    updatedAt: new Date().toISOString(),
  });
  if (insErr) throw new Error(`Insert task failed: ${insErr.message}`);

  // Assignments (se vierem)
  const assigneeIds = Array.isArray(p.assigneeIds) ? (p.assigneeIds as string[]) : [];
  if (assigneeIds.length > 0) {
    const { error: aErr } = await supabase.from("TaskAssignment").insert(
      assigneeIds.map((memberId) => ({
        id: crypto.randomUUID(),
        taskId,
        memberId,
      }))
    );
    if (aErr) throw new Error(`Assignments failed: ${aErr.message}`);
  }

  // Acceptance criteria. Vitoria grava AC como array de STRINGS; legado/UI usa
  // {text}. coerceAcTexts normaliza ambos — sem isso, AC de proposta da IA
  // sumiam silenciosamente ao concluir a planning (capture infra-bug e853c860).
  const acTexts = coerceAcTexts(p.acceptanceCriteria);
  if (acTexts.length > 0) {
    const { error: acErr } = await supabase.from("AcceptanceCriterion").insert(
      acTexts.map((text, i) => ({
        id: crypto.randomUUID(),
        taskId,
        text,
        order: i,
      })),
    );
    if (acErr) throw new Error(`AC insert failed: ${acErr.message}`);
  }

  // Tags — validate tagIds belong to project before inserting
  const tagIds = Array.isArray(p.tagIds) ? (p.tagIds as string[]) : [];
  if (tagIds.length > 0) {
    const { data: validTags } = await supabase
      .from("TaskTag")
      .select("id")
      .eq("projectId", action.projectId)
      .in("id", tagIds);
    const okIds = (validTags ?? []).map((t) => t.id);
    if (okIds.length > 0) {
      const { error: tagErr } = await supabase.from("TaskTagAssignment").insert(
        okIds.map((tagId) => ({ taskId, tagId })),
      );
      if (tagErr) throw new Error(`Tag assign failed: ${tagErr.message}`);
    }
  }

  // Linka taskId no action pra rastreamento
  await supabase
    .from("MeetingTaskAction")
    .update({ taskId })
    .eq("id", action.id);
}

async function applyUpdate(supabase: Supabase, action: ActionRow) {
  if (!action.taskId) throw new Error("update requires taskId");
  await guardFrozenForAi(supabase, action); // D4
  const taskId = action.taskId;
  const p = (action.payload ?? {}) as Record<string, unknown>;

  const allowed = [
    "title", "description", "status", "type", "scope", "complexity",
    "priority", "billable", "functionPoints",
    "notes", "dueDate", "sprintId",
  ] as const;
  const patch: TaskUpdate = { updatedAt: new Date().toISOString() };
  for (const k of allowed) {
    if (k in p) (patch as Record<string, unknown>)[k] = p[k];
  }

  // userStoryId: validate against project (project unchanged on update)
  if ("userStoryId" in p) {
    if (p.userStoryId === null) {
      patch.userStoryId = null;
    } else if (typeof p.userStoryId === "string" && p.userStoryId) {
      const { data: story } = await supabase
        .from("UserStory")
        .select("id")
        .eq("id", p.userStoryId)
        .eq("projectId", action.projectId)
        .maybeSingle();
      if (story) {
        patch.userStoryId = p.userStoryId;
      } else {
        console.warn(
          `applyUpdate: userStoryId ${p.userStoryId} invalid for project ${action.projectId}, skipping`,
        );
      }
    }
  }

  const { error } = await supabase.from("Task").update(patch).eq("id", taskId);
  if (error) throw new Error(`Update task failed: ${error.message}`);

  // Assignments — se vierem, substitui o set
  if (Array.isArray(p.assigneeIds)) {
    const ids = p.assigneeIds as string[];
    const { error: dErr } = await supabase
      .from("TaskAssignment")
      .delete()
      .eq("taskId", taskId);
    if (dErr) throw new Error(`Clear assignments failed: ${dErr.message}`);

    if (ids.length > 0) {
      const { error: iErr } = await supabase.from("TaskAssignment").insert(
        ids.map((memberId) => ({
          id: crypto.randomUUID(),
          taskId,
          memberId,
        }))
      );
      if (iErr) throw new Error(`Set assignments failed: ${iErr.message}`);
    }
  }

  // Tags — when payload.tagIds present, replace the set
  if (Array.isArray(p.tagIds)) {
    const ids = p.tagIds as string[];
    const { error: dErr } = await supabase
      .from("TaskTagAssignment")
      .delete()
      .eq("taskId", taskId);
    if (dErr) throw new Error(`Clear tags failed: ${dErr.message}`);

    if (ids.length > 0) {
      const { data: validTags } = await supabase
        .from("TaskTag")
        .select("id")
        .eq("projectId", action.projectId)
        .in("id", ids);
      const okIds = (validTags ?? []).map((t) => t.id);
      if (okIds.length > 0) {
        const { error: iErr } = await supabase.from("TaskTagAssignment").insert(
          okIds.map((tagId) => ({ taskId, tagId })),
        );
        if (iErr) throw new Error(`Set tags failed: ${iErr.message}`);
      }
    }
  }

  // AC — when payload.acceptanceCriteria present, replace the set wholesale.
  // Granular reconciliation (keep checked state on text edits) is a future
  // refinement; for now treat the proposal as the source of truth.
  if (Array.isArray(p.acceptanceCriteria)) {
    const acs = (p.acceptanceCriteria as Array<{ text: string }>).filter(
      (a) => a && typeof a.text === "string" && a.text.trim(),
    );
    const { error: dErr } = await supabase
      .from("AcceptanceCriterion")
      .delete()
      .eq("taskId", taskId);
    if (dErr) throw new Error(`Clear AC failed: ${dErr.message}`);

    if (acs.length > 0) {
      const { error: iErr } = await supabase.from("AcceptanceCriterion").insert(
        acs.map((ac, i) => ({
          id: crypto.randomUUID(),
          taskId,
          text: ac.text.trim(),
          order: i,
        })),
      );
      if (iErr) throw new Error(`Set AC failed: ${iErr.message}`);
    }
  }
}

async function applyDelete(supabase: Supabase, action: ActionRow) {
  if (!action.taskId) throw new Error("delete requires taskId");
  await guardFrozenForAi(supabase, action); // D4
  const { error } = await supabase
    .from("Task")
    .update({ sprintId: null, status: "backlog", updatedAt: new Date().toISOString() })
    .eq("id", action.taskId);
  if (error) throw new Error(`Remove from sprint failed: ${error.message}`);
}

async function applyMove(supabase: Supabase, action: ActionRow) {
  if (!action.taskId) throw new Error("move requires taskId");
  if (!action.targetSprintId) throw new Error("move requires targetSprintId");
  await guardFrozenForAi(supabase, action); // D4
  const { error } = await supabase
    .from("Task")
    .update({ sprintId: action.targetSprintId, updatedAt: new Date().toISOString() })
    .eq("id", action.taskId);
  if (error) throw new Error(`Move task failed: ${error.message}`);
}

// ─── Helpers ─────────────────────────────────────────────

async function markExecuted(
  supabase: Supabase,
  id: string,
  execution: "applied" | "skipped"
) {
  await supabase
    .from("MeetingTaskAction")
    .update({
      execution,
      appliedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
}

async function markFailed(supabase: Supabase, id: string, errorMessage: string) {
  await supabase
    .from("MeetingTaskAction")
    .update({
      execution: "failed",
      errorMessage,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
}
