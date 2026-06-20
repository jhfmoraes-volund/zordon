/**
 * Planning Vivo Versionado — Fase 1 (Log). Data Access Layer.
 *
 * § docs/runbooks/planning-versioned-living-runbook.md §6, §11.
 *
 * INVARIANTE (tatuar): build on the live board, remember the plan, learn from
 * the outcome. O PlanningEvent é um SNAPSHOT imutável que INFORMA versões
 * futuras — nunca vira o estado a restaurar (senão ressuscita task fechada/
 * deletada e atropela o builder).
 *
 * Keyed por PlanningSession (estável), não por PlanningCeremony: a companion
 * ceremony é reciclada a cada apply (ver ensureReleasePlanningCeremony), então
 * a cadeia de versões vive na sessão.
 *
 * Convenções: `db()` (service_role) bypassa RLS — caller valida acesso antes.
 */
import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type PlanningEventRow = Tables["PlanningEvent"]["Row"];
export type PlanningEventSprintRow = Tables["PlanningEventSprint"]["Row"];
export type PlanningEventTaskRow = Tables["PlanningEventTask"]["Row"];

/** Evento + child rows de PFV por sprint + nome de quem aplicou — shape pra UI. */
export type PlanningEventWithSprints = PlanningEventRow & {
  sprints: PlanningEventSprintRow[];
  createdByName: string | null;
};

/** Evento + snapshot COMPLETO (PFV por sprint + lista de tasks) — pro canvas histórico. */
export type PlanningEventSnapshot = PlanningEventWithSprints & {
  tasks: PlanningEventTaskRow[];
};

/** Label do bucket de tasks sem sprint (backlog/não-agendado). */
const BACKLOG_LABEL = "Sem sprint";

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Grava um PlanningEvent a partir da companion ceremony recém-concluída.
 *
 * Resolve a PlanningSession dona da ceremony. Se não houver (a ceremony é uma
 * Sprint Planning real, não a companion de um Release Planning), retorna null —
 * Fase 1 só loga Release Planning (D10).
 *
 * Best-effort por design: o caller já aplicou as tasks (a mutação que importa).
 * Uma falha aqui NÃO deve derrubar o apply — o caller chama dentro de try/catch
 * e apenas loga.
 */
export async function recordPlanningEventFromCeremony(input: {
  planningCeremonyId: string;
  createdById: string;
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
}): Promise<PlanningEventRow | null> {
  const supabase = db();

  // 1. Resolve a sessão dona da companion (confiável no instante do conclude:
  //    a ceremony ainda é a planningCeremonyId corrente da sessão).
  const { data: session, error: sErr } = await supabase
    .from("PlanningSession")
    .select("id, projectId")
    .eq("planningCeremonyId", input.planningCeremonyId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!session) return null; // Sprint Planning → fora de escopo da Fase 1.

  // 2. Briefing = CÓPIA do último turn assistant do thread (auto-contido).
  const { briefingMarkdown, chatMessageId } = await loadLatestBriefing(session.id);

  // 3. Snapshot CUMULATIVO do plano nesse instante: agregado de PFV por sprint +
  //    a lista COMPLETA de tasks (o board exato daquela versão).
  const { sprints: sprintRows, tasks: taskRows } = await snapshotPlan(session.projectId);

  // 4. Insere o evento (counts vêm do executor via concludePlanning).
  const { data: event, error: eErr } = await supabase
    .from("PlanningEvent")
    .insert({
      planningSessionId: session.id,
      createdById: input.createdById,
      appliedCount: input.appliedCount,
      failedCount: input.failedCount,
      skippedCount: input.skippedCount,
      briefingMarkdown,
      chatMessageId,
    })
    .select("*")
    .single();
  if (eErr) throw eErr;

  // 5. Child rows denormalizadas (sem jsonb, D8): agregado por sprint…
  if (sprintRows.length > 0) {
    const { error: psErr } = await supabase.from("PlanningEventSprint").insert(
      sprintRows.map((s) => ({
        planningEventId: event.id,
        sprintId: s.sprintId,
        sprintLabel: s.sprintLabel,
        fpTotal: s.fpTotal,
        taskCount: s.taskCount,
      })),
    );
    if (psErr) throw psErr;
  }

  // 6. …e a lista COMPLETA de tasks (o board exato daquela versão, pro canvas
  //    histórico). Tudo denormalizado/imutável — sobrevive a delete/rename.
  if (taskRows.length > 0) {
    const { error: ptErr } = await supabase.from("PlanningEventTask").insert(
      taskRows.map((t) => ({
        planningEventId: event.id,
        taskId: t.taskId,
        reference: t.reference,
        title: t.title,
        status: t.status,
        sprintId: t.sprintId,
        sprintLabel: t.sprintLabel,
        functionPoints: t.functionPoints,
        assignees: t.assignees,
      })),
    );
    if (ptErr) throw ptErr;
  }

  return event;
}

/** Último turn `assistant` do thread do release planning (briefing imutável). */
async function loadLatestBriefing(sessionId: string): Promise<{
  briefingMarkdown: string | null;
  chatMessageId: string | null;
}> {
  const supabase = db();
  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id")
    .eq("agentName", sessionId)
    .eq("channel", "release_planning")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!thread) return { briefingMarkdown: null, chatMessageId: null };

  const { data: msg } = await supabase
    .from("ChatMessage")
    .select("id, content")
    .eq("threadId", thread.id)
    .eq("role", "assistant")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!msg) return { briefingMarkdown: null, chatMessageId: null };
  return { briefingMarkdown: msg.content ?? null, chatMessageId: msg.id };
}

/** Agregado de PFV por sprint (chip do briefing/timeline). */
type SprintAgg = {
  sprintId: string | null;
  sprintLabel: string;
  fpTotal: number;
  taskCount: number;
};

/** Uma task do snapshot (espelha as colunas de PlanningEventTask, sem ids do evento). */
type TaskSnap = {
  taskId: string | null;
  reference: string | null;
  title: string;
  status: string;
  sprintId: string | null;
  sprintLabel: string;
  functionPoints: number | null;
  assignees: string[];
};

/**
 * Snapshot CUMULATIVO do plano num instante: lê as Task do projeto UMA vez e
 * deriva dois recortes — o agregado de PFV por sprint (briefing) e a lista
 * completa de tasks (o board exato, pro canvas histórico). Não é delta: inclui
 * tasks de todas as fases/status. Exclui dismissed E draft — mesmo recorte do
 * board vivo (`/api/tasks`), pra bater com o que o canvas mostra. sprintId
 * NULL = bucket backlog ("Sem sprint").
 */
async function snapshotPlan(
  projectId: string,
): Promise<{ sprints: SprintAgg[]; tasks: TaskSnap[] }> {
  const supabase = db();
  const { data, error } = await supabase
    .from("Task")
    .select(
      "id, reference, title, status, sprintId, functionPoints, sprint:Sprint(name), assignments:TaskAssignment(member:Member(name))",
    )
    .eq("projectId", projectId)
    .neq("status", "draft")
    .is("dismissedAt", null);
  if (error) throw error;

  const map = new Map<string, SprintAgg>();
  const tasks: TaskSnap[] = [];
  for (const t of data ?? []) {
    const label = (t.sprint as { name: string } | null)?.name ?? BACKLOG_LABEL;
    const key = t.sprintId ?? "__backlog__";

    // Agregado por sprint.
    let g = map.get(key);
    if (!g) {
      g = { sprintId: t.sprintId ?? null, sprintLabel: label, fpTotal: 0, taskCount: 0 };
      map.set(key, g);
    } else if (g.sprintLabel === BACKLOG_LABEL && label !== BACKLOG_LABEL) {
      g.sprintLabel = label;
    }
    g.fpTotal += t.functionPoints ?? 0;
    g.taskCount += 1;

    // Linha por task (board exato).
    const assignees = ((t.assignments ?? []) as Array<{ member: { name: string | null } | null }>)
      .map((a) => a.member?.name)
      .filter((n): n is string => !!n);
    tasks.push({
      taskId: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
      sprintId: t.sprintId ?? null,
      sprintLabel: label,
      functionPoints: t.functionPoints,
      assignees,
    });
  }

  return { sprints: Array.from(map.values()), tasks };
}

// ─── Read ─────────────────────────────────────────────────────────────────

/**
 * Lista os PlanningEvent de uma sessão (mais recente primeiro) com os child
 * rows de PFV por sprint e o nome de quem aplicou. Alimenta a timeline do canvas.
 */
export async function listPlanningEventsForSession(
  sessionId: string,
): Promise<PlanningEventWithSprints[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("PlanningEvent")
    .select(
      `
      *,
      sprints:PlanningEventSprint(*),
      createdBy:Member!PlanningEvent_createdById_fkey(name)
      `,
    )
    .eq("planningSessionId", sessionId)
    .order("createdAt", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { createdBy, sprints, ...rest } = row as PlanningEventRow & {
      createdBy: { name: string | null } | null;
      sprints: PlanningEventSprintRow[];
    };
    // Ordena os chips por label numérico (Sprint 1, 2, …); backlog por último.
    const sortedSprints = (sprints ?? []).slice().sort((a, b) => {
      if (a.sprintId === null) return 1;
      if (b.sprintId === null) return -1;
      return a.sprintLabel.localeCompare(b.sprintLabel, undefined, {
        numeric: true,
      });
    });
    return {
      ...rest,
      sprints: sortedSprints,
      createdByName: createdBy?.name ?? null,
    };
  });
}

/**
 * Um PlanningEvent + snapshot COMPLETO (PFV por sprint + lista de tasks) — o
 * "canvas histórico" de uma versão. Retorna null se o evento não existe. O
 * caller valida acesso ao projeto (db() bypassa RLS).
 */
export async function getPlanningEventSnapshot(
  eventId: string,
): Promise<PlanningEventSnapshot | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("PlanningEvent")
    .select(
      `
      *,
      sprints:PlanningEventSprint(*),
      tasks:PlanningEventTask(*),
      createdBy:Member!PlanningEvent_createdById_fkey(name)
      `,
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { createdBy, sprints, tasks, ...rest } = data as PlanningEventRow & {
    createdBy: { name: string | null } | null;
    sprints: PlanningEventSprintRow[];
    tasks: PlanningEventTaskRow[];
  };

  // Ordena chips de sprint por label numérico (Sprint 1, 2, …); backlog por último.
  const sortedSprints = (sprints ?? []).slice().sort((a, b) => {
    if (a.sprintId === null) return 1;
    if (b.sprintId === null) return -1;
    return a.sprintLabel.localeCompare(b.sprintLabel, undefined, { numeric: true });
  });

  return {
    ...rest,
    sprints: sortedSprints,
    tasks: tasks ?? [],
    createdByName: createdBy?.name ?? null,
  };
}
