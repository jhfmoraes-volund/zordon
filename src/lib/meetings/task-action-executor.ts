import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Supabase = SupabaseClient<Database>;
type ActionRow = Database["public"]["Tables"]["MeetingTaskAction"]["Row"];
type TaskActionUpdate = Database["public"]["Tables"]["MeetingTaskAction"]["Update"];
type TaskInsert = Database["public"]["Tables"]["Task"]["Insert"];
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
 * Quantas actions escrever em paralelo na fase de writes. supabase-js fala HTTP
 * (PostgREST), então "concorrência" = N requests simultâneas — sem pool de
 * conexão pra estourar. 8 dá ~10× de ganho de wall-clock sem martelar o banco.
 */
const WRITE_CONCURRENCY = 8;

/**
 * D4 (Planning Vivo Versionado) — "trabalho em curso é congelado ao re-planning".
 * Status que representam trabalho que o builder JÁ COMEÇOU: o agente não pode
 * mover/editar/remover via re-plano sem atropelar o builder. Mais amplo que o
 * literal "in_progress/done" do D4 de propósito — `review` também é trabalho
 * começado. O PM ainda muta direto na TaskSheet (não passa por este executor).
 */
const FROZEN_STATUSES = new Set(["in_progress", "review", "done"]);

export async function applyApprovedActions(
  supabase: Supabase,
  meetingId: string,
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

  // Auto-aprova em batch antes de aplicar — applyActions assume action.decision já
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

// ─── Orquestração: plan → allocate → write ───────────────────
//
// Antes: loop sequencial, 6-9 round-trips de DB por action (guards + RPC de
// reference + inserts em série). 59 propostas = ~500 chamadas serializadas =
// 15-50s → request estourava e a UI travava.
//
// Agora, 4 fases:
//   1. READS em lote   — uma query por projeto resolve TODOS os guards (status
//      congelado D4, títulos existentes pro anti-dup, story/tag ids válidos).
//   2. PLAN em memória — classifica cada action em create/update/move/delete ou
//      skip/fail SEM tocar o banco (decisão determinística antes de qualquer write).
//   3. ALLOCATE refs   — uma RPC por projeto aloca o bloco de references dos creates.
//   4. WRITE concorrente — cada action escreve isolada (applied|failed), sem reads.
//
// Semânticas preservadas 1:1: skip-vs-fail, D4, anti-duplicador, link de taskId
// no create (transição atômica que satisfaz o CHECK), outcome só pra source='ai',
// ordem create→update→review→move→delete.

async function applyActions(
  supabase: Supabase,
  actions: ActionRow[],
  fallbackSprintId: string | null = null,
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, failed: 0, skipped: 0, details: [] };
  const sorted = actions.slice().sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  if (sorted.length === 0) return result;

  // ── FASE 1: reads em lote ─────────────────────────────────
  const ctx = await loadApplyContext(supabase, sorted);

  // ── FASE 2: plan em memória ───────────────────────────────
  const plan = planActions(sorted, ctx, fallbackSprintId);

  // Skips (review + D4 congelado + anti-dup) num único UPDATE.
  if (plan.skipped.length > 0) {
    const nowIso = new Date().toISOString();
    await supabase
      .from("MeetingTaskAction")
      .update({ execution: "skipped", appliedAt: nowIso, updatedAt: nowIso })
      .in("id", plan.skipped.map((s) => s.id));
    for (const s of plan.skipped) {
      result.skipped++;
      result.details.push({ id: s.id, type: s.type, status: "skipped", error: s.error });
    }
  }

  // Falhas de planejamento (taskId/targetSprintId ausente) — raras, per-row.
  for (const f of plan.failed) {
    await markFailed(supabase, f.id, f.error);
    result.failed++;
    result.details.push({ id: f.id, type: f.type, status: "failed", error: f.error });
  }

  // ── FASE 3: aloca references dos creates (uma RPC por projeto) ──
  await allocateReferences(supabase, plan.writes);

  // ── FASE 4: writes concorrentes (isolados por action) ─────
  const written = await mapPool(plan.writes, WRITE_CONCURRENCY, async (w) => {
    try {
      let createdTaskId: string | null = null;
      switch (w.kind) {
        case "create":
          if (w.refError) throw new Error(`Failed to get task reference: ${w.refError}`);
          await writeCreate(supabase, w);
          createdTaskId = w.taskId;
          break;
        case "update":
          await writeUpdate(supabase, w);
          break;
        case "move":
          await writeMove(supabase, w);
          break;
        case "delete":
          await writeDelete(supabase, w);
          break;
      }
      // Seta execution='applied' + taskId (do create) na MESMA update — a
      // transição atômica satisfaz o CHECK que só admite create+taskId aplicado.
      await markExecuted(supabase, w.action.id, "applied", createdTaskId);
      await recordProposalOutcome(supabase, w.action);
      return {
        id: w.action.id,
        type: w.action.type,
        status: "applied" as const,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markFailed(supabase, w.action.id, msg);
      return {
        id: w.action.id,
        type: w.action.type,
        status: "failed" as const,
        error: msg,
      };
    }
  });

  for (const r of written) {
    if (r.status === "applied") result.applied++;
    else result.failed++;
    result.details.push(r);
  }

  return result;
}

// ─── FASE 1: contexto de reads em lote ───────────────────────

type ApplyContext = {
  /** taskId → status, só pras tasks-alvo de update/move/delete da IA (guard D4). */
  frozenStatus: Map<string, string>;
  /** projectId → (título minúsculo → reference da task existente) (anti-dup). */
  titlesByProject: Map<string, Map<string, string>>;
  /** `${projectId}:${storyId}` válidos (existem no projeto). */
  validStoryKeys: Set<string>;
  /** `${projectId}:${tagId}` válidos (existem no projeto). */
  validTagKeys: Set<string>;
};

function payloadOf(a: ActionRow): Record<string, unknown> {
  return (a.payload ?? {}) as Record<string, unknown>;
}

/** Map.get com lazy-init — evita o boilerplate de checar-criar-pegar. */
function getOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = init();
    map.set(key, v);
  }
  return v;
}

async function loadApplyContext(
  supabase: Supabase,
  actions: ActionRow[],
): Promise<ApplyContext> {
  // tasks-alvo de mutação da IA (guard D4 só roda pra source='ai' com taskId).
  const frozenTaskIds = [
    ...new Set(
      actions
        .filter(
          (a) =>
            a.source === "ai" &&
            !!a.taskId &&
            (a.type === "update" || a.type === "move" || a.type === "delete"),
        )
        .map((a) => a.taskId as string),
    ),
  ];

  // projetos com create da IA → precisam do mapa de títulos pro anti-dup.
  const aiCreateProjects = [
    ...new Set(
      actions.filter((a) => a.source === "ai" && a.type === "create").map((a) => a.projectId),
    ),
  ];

  // story/tag ids referenciados, agrupados por projeto (validação project-scoped).
  const storyIdsByProject = new Map<string, Set<string>>();
  const tagIdsByProject = new Map<string, Set<string>>();
  for (const a of actions) {
    if (a.type !== "create" && a.type !== "update") continue;
    const p = payloadOf(a);
    if (typeof p.userStoryId === "string" && p.userStoryId) {
      getOrInit(storyIdsByProject, a.projectId, () => new Set<string>()).add(p.userStoryId);
    }
    if (Array.isArray(p.tagIds)) {
      const set = getOrInit(tagIdsByProject, a.projectId, () => new Set<string>());
      for (const t of p.tagIds as unknown[]) if (typeof t === "string") set.add(t);
    }
  }

  const ctx: ApplyContext = {
    frozenStatus: new Map(),
    titlesByProject: new Map(),
    validStoryKeys: new Set(),
    validTagKeys: new Set(),
  };

  await Promise.all([
    // Status das tasks-alvo (D4).
    (async () => {
      if (frozenTaskIds.length === 0) return;
      const { data } = await supabase
        .from("Task")
        .select("id, status")
        .in("id", frozenTaskIds);
      for (const t of data ?? []) ctx.frozenStatus.set(t.id, t.status);
    })(),
    // Títulos existentes por projeto (anti-dup). Não-dismissed, como o guard original.
    ...aiCreateProjects.map(async (projectId) => {
      const { data } = await supabase
        .from("Task")
        .select("id, reference, title")
        .eq("projectId", projectId)
        .is("dismissedAt", null);
      const map = new Map<string, string>();
      for (const t of data ?? []) {
        const key = (t.title ?? "").trim().toLowerCase();
        if (key && !map.has(key)) map.set(key, t.reference ?? t.id);
      }
      ctx.titlesByProject.set(projectId, map);
    }),
    // Story ids válidos por projeto.
    ...[...storyIdsByProject.entries()].map(async ([projectId, ids]) => {
      const { data } = await supabase
        .from("UserStory")
        .select("id")
        .eq("projectId", projectId)
        .in("id", [...ids]);
      for (const s of data ?? []) ctx.validStoryKeys.add(`${projectId}:${s.id}`);
    }),
    // Tag ids válidos por projeto.
    ...[...tagIdsByProject.entries()].map(async ([projectId, ids]) => {
      const { data } = await supabase
        .from("TaskTag")
        .select("id")
        .eq("projectId", projectId)
        .in("id", [...ids]);
      for (const t of data ?? []) ctx.validTagKeys.add(`${projectId}:${t.id}`);
    }),
  ]);

  return ctx;
}

// ─── FASE 2: planejamento (em memória, sem DB) ───────────────

type CreateWrite = {
  kind: "create";
  action: ActionRow;
  taskId: string;
  reference: string | null;
  refError?: string;
  taskRow: TaskInsert;
  assigneeIds: string[];
  acTexts: string[];
  tagIds: string[];
};
type UpdateWrite = {
  kind: "update";
  action: ActionRow;
  taskId: string;
  patch: TaskUpdate;
  // undefined = payload não trouxe o campo → não mexe no set.
  assigneeIds?: string[];
  tagIds?: string[];
  acTexts?: string[];
};
type MoveWrite = { kind: "move"; action: ActionRow; taskId: string; targetSprintId: string };
type DeleteWrite = { kind: "delete"; action: ActionRow; taskId: string };
type Write = CreateWrite | UpdateWrite | MoveWrite | DeleteWrite;

type PlanOutcome = {
  writes: Write[];
  skipped: Array<{ id: string; type: string; error?: string }>;
  failed: Array<{ id: string; type: string; error: string }>;
};

function isFrozenForAi(action: ActionRow, ctx: ApplyContext): boolean {
  if (action.source !== "ai" || !action.taskId) return false;
  const status = ctx.frozenStatus.get(action.taskId);
  return !!status && FROZEN_STATUSES.has(status);
}

const FROZEN_SKIP_MSG = (status: string) =>
  `task '${status}' — congelada (trabalho em curso); não tocada pra não atropelar o builder (D4)`;

function planActions(
  actions: ActionRow[],
  ctx: ApplyContext,
  fallbackSprintId: string | null,
): PlanOutcome {
  const out: PlanOutcome = { writes: [], skipped: [], failed: [] };
  // Títulos já reivindicados NESTE lote — dedup intra-batch determinístico (antes
  // dependia da visibilidade do insert anterior; agora é decidido sem DB).
  const claimed = new Map<string, Set<string>>();

  for (const action of actions) {
    const p = payloadOf(action);

    switch (action.type) {
      case "review": {
        // REVIEW não modifica a Task — só fica registrado na reunião.
        out.skipped.push({ id: action.id, type: action.type });
        break;
      }

      case "create": {
        const proposedTitle = ((p.title as string) ?? "").trim();
        // Anti-duplicador (§7): create da IA cujo título já existe no projeto (ou
        // já foi proposto neste mesmo lote) é PULADO — re-plano constrói sobre o
        // board, não recria. Conservador (título exato, case-insensitive). Humano passa.
        if (action.source === "ai" && proposedTitle) {
          const key = proposedTitle.toLowerCase();
          const existingRef = ctx.titlesByProject.get(action.projectId)?.get(key);
          if (existingRef) {
            out.skipped.push({
              id: action.id,
              type: action.type,
              error: `título duplicado de ${existingRef} no projeto — create pulado (re-plano não recria; referencie o taskId pra mover/editar)`,
            });
            break;
          }
          const claimedSet = getOrInit(claimed, action.projectId, () => new Set<string>());
          if (claimedSet.has(key)) {
            out.skipped.push({
              id: action.id,
              type: action.type,
              error: `título proposto 2× no mesmo plano — create pulado (dedup intra-lote)`,
            });
            break;
          }
          claimedSet.add(key);
        }

        const taskId = crypto.randomUUID();
        // Precedência: payload explícito > targetSprintId da action > sprint da planning.
        const sprintId =
          (p.sprintId as string | null) ?? action.targetSprintId ?? fallbackSprintId;
        // Default de status acompanha sprintId: sem sprint = backlog, com sprint = todo.
        const defaultStatus = sprintId ? "todo" : "backlog";
        const status = (p.status as string) ?? defaultStatus;
        // Backfill: task criada já 'done' carrega quando foi entregue (doneAt
        // explícito > dueDate > agora) pra timeline/métricas não ficarem furadas.
        const doneAt =
          status === "done"
            ? ((p.doneAt as string) ?? (p.dueDate as string) ?? new Date().toISOString())
            : null;

        // userStoryId: validado contra o projeto (fail-soft: link null + log).
        let userStoryId: string | null = null;
        if (typeof p.userStoryId === "string" && p.userStoryId) {
          if (ctx.validStoryKeys.has(`${action.projectId}:${p.userStoryId}`)) {
            userStoryId = p.userStoryId;
          } else {
            console.warn(
              `applyCreate: userStoryId ${p.userStoryId} not found in project ${action.projectId}, linking null`,
            );
          }
        }

        const assigneeIds = Array.isArray(p.assigneeIds)
          ? (p.assigneeIds as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        const acTexts = coerceAcTexts(p.acceptanceCriteria);
        const tagIds = Array.isArray(p.tagIds)
          ? (p.tagIds as unknown[]).filter(
              (x): x is string =>
                typeof x === "string" && ctx.validTagKeys.has(`${action.projectId}:${x}`),
            )
          : [];

        const taskRow: TaskInsert = {
          id: taskId,
          reference: "", // preenchido na FASE 3 (allocateReferences)
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
        };

        out.writes.push({
          kind: "create",
          action,
          taskId,
          reference: null,
          taskRow,
          assigneeIds,
          acTexts,
          tagIds,
        });
        break;
      }

      case "update": {
        if (!action.taskId) {
          out.failed.push({ id: action.id, type: action.type, error: "update requires taskId" });
          break;
        }
        if (isFrozenForAi(action, ctx)) {
          out.skipped.push({
            id: action.id,
            type: action.type,
            error: FROZEN_SKIP_MSG(ctx.frozenStatus.get(action.taskId)!),
          });
          break;
        }

        const allowed = [
          "title", "description", "status", "type", "scope", "complexity",
          "priority", "billable", "functionPoints", "notes", "dueDate", "sprintId",
        ] as const;
        const patch: TaskUpdate = { updatedAt: new Date().toISOString() };
        for (const k of allowed) {
          if (k in p) (patch as Record<string, unknown>)[k] = p[k];
        }
        if ("userStoryId" in p) {
          if (p.userStoryId === null) {
            patch.userStoryId = null;
          } else if (typeof p.userStoryId === "string" && p.userStoryId) {
            if (ctx.validStoryKeys.has(`${action.projectId}:${p.userStoryId}`)) {
              patch.userStoryId = p.userStoryId;
            } else {
              console.warn(
                `applyUpdate: userStoryId ${p.userStoryId} invalid for project ${action.projectId}, skipping`,
              );
            }
          }
        }

        const write: UpdateWrite = { kind: "update", action, taskId: action.taskId, patch };
        if (Array.isArray(p.assigneeIds)) {
          write.assigneeIds = (p.assigneeIds as unknown[]).filter(
            (x): x is string => typeof x === "string",
          );
        }
        if (Array.isArray(p.tagIds)) {
          write.tagIds = (p.tagIds as unknown[]).filter(
            (x): x is string =>
              typeof x === "string" && ctx.validTagKeys.has(`${action.projectId}:${x}`),
          );
        }
        if (Array.isArray(p.acceptanceCriteria)) {
          write.acTexts = coerceAcTexts(p.acceptanceCriteria);
        }
        out.writes.push(write);
        break;
      }

      case "move": {
        if (!action.taskId) {
          out.failed.push({ id: action.id, type: action.type, error: "move requires taskId" });
          break;
        }
        if (!action.targetSprintId) {
          out.failed.push({ id: action.id, type: action.type, error: "move requires targetSprintId" });
          break;
        }
        if (isFrozenForAi(action, ctx)) {
          out.skipped.push({
            id: action.id,
            type: action.type,
            error: FROZEN_SKIP_MSG(ctx.frozenStatus.get(action.taskId)!),
          });
          break;
        }
        out.writes.push({
          kind: "move",
          action,
          taskId: action.taskId,
          targetSprintId: action.targetSprintId,
        });
        break;
      }

      case "delete": {
        if (!action.taskId) {
          out.failed.push({ id: action.id, type: action.type, error: "delete requires taskId" });
          break;
        }
        if (isFrozenForAi(action, ctx)) {
          out.skipped.push({
            id: action.id,
            type: action.type,
            error: FROZEN_SKIP_MSG(ctx.frozenStatus.get(action.taskId)!),
          });
          break;
        }
        out.writes.push({ kind: "delete", action, taskId: action.taskId });
        break;
      }
    }
  }

  return out;
}

// ─── FASE 3: alocação de references em lote ──────────────────

async function allocateReferences(supabase: Supabase, writes: Write[]): Promise<void> {
  const creates = writes.filter((w): w is CreateWrite => w.kind === "create");
  if (creates.length === 0) return;

  const byProject = new Map<string, CreateWrite[]>();
  for (const w of creates) {
    getOrInit(byProject, w.action.projectId, () => [] as CreateWrite[]).push(w);
  }

  await Promise.all(
    [...byProject.entries()].map(async ([projectId, group]) => {
      const { data, error } = await supabase.rpc("next_task_references", {
        p_project_id: projectId,
        p_count: group.length,
      });
      const refs = (data as string[] | null) ?? [];
      if (error || refs.length < group.length) {
        // Falha catastrófica de numeração (ex: projeto sem referenceKey). Marca o
        // bloco como refError → cada create vira `failed` isolado na FASE 4 (não
        // derruba updates/moves/deletes que já planejaram).
        const msg = error?.message ?? `expected ${group.length} refs, got ${refs.length}`;
        group.forEach((w) => {
          w.refError = msg;
        });
        return;
      }
      group.forEach((w, i) => {
        w.reference = refs[i];
        w.taskRow.reference = refs[i];
      });
    }),
  );
}

// ─── FASE 4: writes (sem reads — tudo já validado/alocado) ───

async function writeCreate(supabase: Supabase, w: CreateWrite): Promise<void> {
  const { error: insErr } = await supabase.from("Task").insert(w.taskRow);
  if (insErr) throw new Error(`Insert task failed: ${insErr.message}`);

  if (w.assigneeIds.length > 0) {
    const { error: aErr } = await supabase.from("TaskAssignment").insert(
      w.assigneeIds.map((memberId) => ({ id: crypto.randomUUID(), taskId: w.taskId, memberId })),
    );
    if (aErr) throw new Error(`Assignments failed: ${aErr.message}`);
  }

  if (w.acTexts.length > 0) {
    const { error: acErr } = await supabase.from("AcceptanceCriterion").insert(
      w.acTexts.map((text, i) => ({ id: crypto.randomUUID(), taskId: w.taskId, text, order: i })),
    );
    if (acErr) throw new Error(`AC insert failed: ${acErr.message}`);
  }

  if (w.tagIds.length > 0) {
    const { error: tagErr } = await supabase.from("TaskTagAssignment").insert(
      w.tagIds.map((tagId) => ({ taskId: w.taskId, tagId })),
    );
    if (tagErr) throw new Error(`Tag assign failed: ${tagErr.message}`);
  }
}

async function writeUpdate(supabase: Supabase, w: UpdateWrite): Promise<void> {
  const { error } = await supabase.from("Task").update(w.patch).eq("id", w.taskId);
  if (error) throw new Error(`Update task failed: ${error.message}`);

  // Assignments — se vierem, substitui o set.
  if (w.assigneeIds !== undefined) {
    const { error: dErr } = await supabase.from("TaskAssignment").delete().eq("taskId", w.taskId);
    if (dErr) throw new Error(`Clear assignments failed: ${dErr.message}`);
    if (w.assigneeIds.length > 0) {
      const { error: iErr } = await supabase.from("TaskAssignment").insert(
        w.assigneeIds.map((memberId) => ({ id: crypto.randomUUID(), taskId: w.taskId, memberId })),
      );
      if (iErr) throw new Error(`Set assignments failed: ${iErr.message}`);
    }
  }

  // Tags — se vierem, substitui o set (já validadas no plan).
  if (w.tagIds !== undefined) {
    const { error: dErr } = await supabase.from("TaskTagAssignment").delete().eq("taskId", w.taskId);
    if (dErr) throw new Error(`Clear tags failed: ${dErr.message}`);
    if (w.tagIds.length > 0) {
      const { error: iErr } = await supabase.from("TaskTagAssignment").insert(
        w.tagIds.map((tagId) => ({ taskId: w.taskId, tagId })),
      );
      if (iErr) throw new Error(`Set tags failed: ${iErr.message}`);
    }
  }

  // AC — se vierem, substitui o set wholesale (proposal = source of truth).
  if (w.acTexts !== undefined) {
    const { error: dErr } = await supabase.from("AcceptanceCriterion").delete().eq("taskId", w.taskId);
    if (dErr) throw new Error(`Clear AC failed: ${dErr.message}`);
    if (w.acTexts.length > 0) {
      const { error: iErr } = await supabase.from("AcceptanceCriterion").insert(
        w.acTexts.map((text, i) => ({ id: crypto.randomUUID(), taskId: w.taskId, text, order: i })),
      );
      if (iErr) throw new Error(`Set AC failed: ${iErr.message}`);
    }
  }
}

async function writeMove(supabase: Supabase, w: MoveWrite): Promise<void> {
  const { error } = await supabase
    .from("Task")
    .update({ sprintId: w.targetSprintId, updatedAt: new Date().toISOString() })
    .eq("id", w.taskId);
  if (error) throw new Error(`Move task failed: ${error.message}`);
}

async function writeDelete(supabase: Supabase, w: DeleteWrite): Promise<void> {
  const { error } = await supabase
    .from("Task")
    .update({ sprintId: null, status: "backlog", updatedAt: new Date().toISOString() })
    .eq("id", w.taskId);
  if (error) throw new Error(`Remove from sprint failed: ${error.message}`);
}

// ─── Outcome / helpers ───────────────────────────────────────

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

async function markExecuted(
  supabase: Supabase,
  id: string,
  execution: "applied" | "skipped",
  taskId?: string | null,
) {
  const patch: TaskActionUpdate = {
    execution,
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Linka a task criada (só faz sentido em create aplicado). Setar junto com
  // execution='applied' é o que satisfaz o CHECK MeetingTaskAction_taskId_consistency.
  if (taskId) patch.taskId = taskId;
  const { error } = await supabase
    .from("MeetingTaskAction")
    .update(patch)
    .eq("id", id);
  // Não engole: o link de taskId já falhou silencioso por anos por causa disso.
  if (error) console.error(`[markExecuted] update falhou (action=${id}):`, error.message);
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

/**
 * Roda `fn` sobre `items` com no máximo `limit` em voo ao mesmo tempo,
 * preservando a ORDEM dos resultados. supabase-js é HTTP, então isto é só
 * controle de quantas requests simultâneas — sem risco de pool de conexão.
 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
