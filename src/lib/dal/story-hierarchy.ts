import "server-only";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type ModuleRow = Tables["Module"]["Row"];
export type PersonaRow = Tables["ProjectPersona"]["Row"];
export type UserStoryRow = Tables["UserStory"]["Row"];
export type AcceptanceCriterionRow = Tables["AcceptanceCriterion"]["Row"];
export type TaskRow = Tables["Task"]["Row"];
export type ProjectRow = Tables["Project"]["Row"];
export type StoryOverviewRow =
  Database["public"]["Views"]["user_story_overview"]["Row"];

// ─── Modules ─────────────────────────────────────────────────────────────────

export async function getModulesForProject(
  projectId: string,
): Promise<ModuleRow[]> {
  const { data, error } = await db()
    .from("Module")
    .select("*")
    .eq("projectId", projectId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createModule(input: {
  projectId: string;
  name: string;
  description?: string | null;
}): Promise<ModuleRow> {
  const { data, error } = await db()
    .from("Module")
    .insert({
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateModule(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<ModuleRow> {
  const { data, error } = await db()
    .from("Module")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteModule(id: string): Promise<void> {
  const { error } = await db().from("Module").delete().eq("id", id);
  if (error) throw error;
}

// ─── Personas ────────────────────────────────────────────────────────────────

export async function getPersonasForProject(
  projectId: string,
): Promise<PersonaRow[]> {
  const { data, error } = await db()
    .from("ProjectPersona")
    .select("*")
    .eq("projectId", projectId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createPersona(input: {
  projectId: string;
  name: string;
  description?: string | null;
}): Promise<PersonaRow> {
  const { data, error } = await db()
    .from("ProjectPersona")
    .insert({
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updatePersona(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<PersonaRow> {
  const { data, error } = await db()
    .from("ProjectPersona")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deletePersona(id: string): Promise<void> {
  const { error } = await db().from("ProjectPersona").delete().eq("id", id);
  if (error) throw error;
}

// ─── Stories ─────────────────────────────────────────────────────────────────

export type StoryWithRelations = UserStoryRow & {
  acceptanceCriteria: AcceptanceCriterionRow[];
  module: Pick<ModuleRow, "id" | "name" | "description"> | null;
  persona: Pick<PersonaRow, "id" | "name" | "description"> | null;
  overview: StoryOverviewRow | null;
};

export async function getStoriesForProject(
  projectId: string,
): Promise<StoryWithRelations[]> {
  const { data, error } = await db()
    .from("UserStory")
    .select(
      `
      *,
      acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*),
      module:Module(id, name, description),
      persona:ProjectPersona(id, name, description)
    `,
    )
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false });
  if (error) throw error;

  // Overview view doesn't have FK metadata, so fetch separately and merge.
  const storyIds = (data ?? []).map((s) => s.id);
  let overviews: StoryOverviewRow[] = [];
  if (storyIds.length > 0) {
    const { data: ovData, error: ovErr } = await db()
      .from("user_story_overview")
      .select("*")
      .in("userStoryId", storyIds);
    if (ovErr) throw ovErr;
    overviews = ovData ?? [];
  }
  const overviewById = new Map(overviews.map((o) => [o.userStoryId, o]));

  return (data ?? []).map((s) => ({
    ...(s as UserStoryRow),
    acceptanceCriteria:
      (s as { acceptanceCriteria?: AcceptanceCriterionRow[] }).acceptanceCriteria ??
      [],
    module:
      (s as { module?: Pick<ModuleRow, "id" | "name" | "description"> | null })
        .module ?? null,
    persona:
      (s as { persona?: Pick<PersonaRow, "id" | "name" | "description"> | null })
        .persona ?? null,
    overview: overviewById.get(s.id) ?? null,
  }));
}

export async function getStoryByReference(
  reference: string,
): Promise<StoryWithRelations | null> {
  const { data, error } = await db()
    .from("UserStory")
    .select(
      `
      *,
      acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*),
      module:Module(id, name, description),
      persona:ProjectPersona(id, name, description)
    `,
    )
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: overviewData } = await db()
    .from("user_story_overview")
    .select("*")
    .eq("userStoryId", data.id)
    .maybeSingle();

  return {
    ...(data as UserStoryRow),
    acceptanceCriteria:
      (data as { acceptanceCriteria?: AcceptanceCriterionRow[] })
        .acceptanceCriteria ?? [],
    module:
      (data as { module?: Pick<ModuleRow, "id" | "name" | "description"> | null })
        .module ?? null,
    persona:
      (data as { persona?: Pick<PersonaRow, "id" | "name" | "description"> | null })
        .persona ?? null,
    overview: overviewData ?? null,
  };
}

export async function getRecentStoriesForProject(
  projectId: string,
  opts: { limit?: number } = {},
): Promise<UserStoryRow[]> {
  const { data, error } = await db()
    .from("UserStory")
    .select("*")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false })
    .limit(opts.limit ?? 20);
  if (error) throw error;
  return data ?? [];
}

export async function nextUserStoryReference(
  projectId: string,
): Promise<string> {
  const { data, error } = await db().rpc("next_user_story_reference", {
    p_project_id: projectId,
  });
  if (error) throw error;
  if (!data) throw new Error("next_user_story_reference returned null");
  return data as unknown as string;
}

export async function createStory(input: {
  projectId: string;
  moduleId?: string | null;
  proposedModuleName?: string | null;
  personaId?: string | null;
  title: string;
  want: string;
  soThat?: string | null;
  refinementStatus?: "draft" | "refined" | "committed";
  acceptanceCriteria?: string[];
  designSessionId?: string | null;
  designSessionItemId?: string | null;
  createdById?: string | null;
  createdByAgent?: boolean;
}): Promise<UserStoryRow> {
  const reference = await nextUserStoryReference(input.projectId);

  const { data: story, error } = await db()
    .from("UserStory")
    .insert({
      projectId: input.projectId,
      moduleId: input.moduleId ?? null,
      proposedModuleName: input.proposedModuleName ?? null,
      reference,
      title: input.title,
      personaId: input.personaId ?? null,
      want: input.want,
      soThat: input.soThat ?? null,
      // 'refined' por default: criação manual (UI/API) nasce visível na lista
      // do projeto. 'draft' é território exclusivo do agente em sub-fase de
      // descoberta dentro da Design Session — passado explicitamente por
      // quem precisa.
      refinementStatus: input.refinementStatus ?? "refined",
      designSessionId: input.designSessionId ?? null,
      designSessionItemId: input.designSessionItemId ?? null,
      createdById: input.createdById ?? null,
      createdByAgent: input.createdByAgent ?? false,
    })
    .select("*")
    .single();
  if (error) throw error;

  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    const acRows = input.acceptanceCriteria
      .map((text, i) => ({
        userStoryId: story.id,
        text: text.trim(),
        order: i,
      }))
      .filter((r) => r.text.length > 0);

    if (acRows.length > 0) {
      const { error: acErr } = await db()
        .from("AcceptanceCriterion")
        .insert(acRows);
      if (acErr) throw acErr;
    }
  }

  return story;
}

export async function updateStory(
  id: string,
  patch: Partial<{
    moduleId: string | null;
    proposedModuleName: string | null;
    personaId: string | null;
    title: string;
    want: string;
    soThat: string | null;
    refinementStatus: "draft" | "refined" | "committed";
  }>,
): Promise<UserStoryRow> {
  const { data, error } = await db()
    .from("UserStory")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStory(id: string): Promise<void> {
  const { error } = await db().from("UserStory").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Soft delete (dismiss) — flags `dismissedAt = now()` instead of removing the
 * row. Listings in the Inception briefing tree filter `dismissedAt IS NULL`,
 * so the story disappears from that surface while underlying data (AC, tasks,
 * activity) is preserved.
 */
export async function dismissStory(id: string): Promise<void> {
  const { error } = await db()
    .from("UserStory")
    .update({
      dismissedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function setStoryRefinement(
  id: string,
  status: "draft" | "refined" | "committed",
): Promise<UserStoryRow> {
  return updateStory(id, { refinementStatus: status });
}

export async function validateStoryAc(
  id: string,
  memberId: string,
): Promise<UserStoryRow> {
  const { data, error } = await db()
    .from("UserStory")
    .update({
      acValidatedAt: new Date().toISOString(),
      acValidatedBy: memberId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Approve a `proposedModuleName`: create the Module and re-attach the story.
 * Atomic-ish — if Module already exists with same name, reuse it.
 */
/**
 * Normalize a free-form proposed name into the UPPERCASE_SNAKE form required
 * by the `Module.name` CHECK constraint (`^[A-Z][A-Z0-9_]*$`). The agent often
 * proposes natural names like "Autenticação & Onboarding"; we only enforce
 * the Module shape at promotion time.
 */
export function normalizeModuleName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_") // any run of non-alphanum → single underscore
      .replace(/^_+|_+$/g, "") // trim leading/trailing underscores
      .replace(/^([0-9])/, "M_$1") || "MODULE" // ensure starts with letter
  );
}

export async function approveProposedModule(
  storyId: string,
  projectId: string,
  proposedName: string,
  approverId: string | null,
): Promise<{ module: ModuleRow; story: UserStoryRow }> {
  const normalized = normalizeModuleName(proposedName);

  const existing = await db()
    .from("Module")
    .select("*")
    .eq("projectId", projectId)
    .eq("name", normalized)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let mod =
    existing.data ?? (await createModule({ projectId, name: normalized }));

  // Idempotent: re-promoting a story whose proposed name matches an already-
  // approved module reuses the module without resetting approvedAt.
  if (!mod.approvedAt) {
    const updated = await db()
      .from("Module")
      .update({
        approvedAt: new Date().toISOString(),
        approvedBy: approverId,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", mod.id)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    if (updated.data) mod = updated.data;
  }

  const story = await updateStory(storyId, {
    moduleId: mod.id,
    proposedModuleName: null,
  });
  return { module: mod, story };
}

// ─── Cascading task promotion (Module approval) ──────────────────────────────

/**
 * Promote all draft tasks under a Module's stories into the project backlog.
 * Status flips draft → backlog. References are stable (already <KEY>-T-NNN
 * since creation) — promotion is purely a state transition.
 *
 * Why: approving a Module is the user's commitment that the breakdown is good.
 * From this point on, tasks are real work in the project, not session drafts.
 */
export async function promoteTasksForModule(
  moduleId: string,
): Promise<{ promoted: number; totalFp: number }> {
  const supabase = db();

  const { data: stories, error: storiesErr } = await supabase
    .from("UserStory")
    .select("id")
    .eq("moduleId", moduleId);
  if (storiesErr) throw storiesErr;
  const storyIds = (stories ?? []).map((s) => s.id);
  if (storyIds.length === 0) return { promoted: 0, totalFp: 0 };

  const { data: drafts, error: draftsErr } = await supabase
    .from("Task")
    .select("id, functionPoints")
    .in("userStoryId", storyIds)
    .eq("status", "draft")
    .order("createdAt", { ascending: true });
  if (draftsErr) throw draftsErr;

  if (!drafts || drafts.length === 0) return { promoted: 0, totalFp: 0 };

  const { error: updateErr } = await supabase
    .from("Task")
    .update({ status: "backlog", updatedAt: new Date().toISOString() })
    .in(
      "id",
      drafts.map((d) => d.id),
    );
  if (updateErr) throw updateErr;

  const totalFp = drafts.reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
  return { promoted: drafts.length, totalFp };
}

/**
 * Reverse promotion when a Module is unapproved. Backlog tasks under this
 * module's stories revert to status='draft'. References are stable through
 * the full lifecycle — only status changes.
 *
 * Throws if any task is past 'backlog' (todo / in_progress / review / done) —
 * caller is expected to resolve those before unapproving.
 *
 * NOTE: chamado hoje só pelo `reopenSession` em cascata. O endpoint legado
 * `/api/modules/[id]/approve` foi removido — aprovação granular não existe
 * mais no modelo "tudo ou nada" da Design Session.
 */
export async function revertTasksForModule(
  moduleId: string,
): Promise<{ reverted: number; blocking: Array<{ reference: string | null; status: string }> }> {
  const supabase = db();

  const { data: stories, error: storiesErr } = await supabase
    .from("UserStory")
    .select("id")
    .eq("moduleId", moduleId);
  if (storiesErr) throw storiesErr;
  const storyIds = (stories ?? []).map((s) => s.id);
  if (storyIds.length === 0) return { reverted: 0, blocking: [] };

  // Pre-flight: any task past 'backlog' blocks the unapprove.
  const { data: active, error: activeErr } = await supabase
    .from("Task")
    .select("reference, status")
    .in("userStoryId", storyIds)
    .in("status", ["todo", "in_progress", "review", "done"]);
  if (activeErr) throw activeErr;
  if ((active ?? []).length > 0) {
    return {
      reverted: 0,
      blocking: (active ?? []).map((t) => ({
        reference: t.reference,
        status: t.status,
      })),
    };
  }

  const { data: reverted, error: revertErr } = await supabase
    .from("Task")
    .update({ status: "draft", updatedAt: new Date().toISOString() })
    .in("userStoryId", storyIds)
    .eq("status", "backlog")
    .select("id");
  if (revertErr) throw revertErr;

  return { reverted: (reverted ?? []).length, blocking: [] };
}

// ─── Cascading session approval ──────────────────────────────────────────────

/**
 * Aprova uma Design Session inteira em cascata atômica:
 *
 *   1. Module.approvedAt = now (todos os módulos referenciados pelas stories
 *      da sessão, incluindo módulos criados a partir de proposedModuleName)
 *   2. UserStory.refinementStatus → 'committed' (todas as stories da sessão)
 *   3. Task.status → 'backlog' (todas as tasks 'draft' da sessão)
 *   4. DesignSession.status = 'completed', completedAt = now
 *   5. ModuleActivity row 'session_completed' por módulo (audit)
 *
 * Modelo "tudo ou nada": aprovação granular foi removida da Design Session.
 * Stories só ficam visíveis no projeto após a sessão ser concluída.
 */
export async function completeSession(
  sessionId: string,
  approverId: string | null,
): Promise<{
  modulesApproved: number;
  storiesCommitted: number;
  tasksPromoted: number;
  totalFp: number;
}> {
  const supabase = db();
  const nowIso = new Date().toISOString();

  // Snapshot da sessão
  const { data: session, error: sessErr } = await supabase
    .from("DesignSession")
    .select("id, projectId, status")
    .eq("id", sessionId)
    .single();
  if (sessErr) throw sessErr;
  if (!session) throw new Error("Session not found");
  if (session.status === "completed") {
    throw new Error("Sessão já está concluída");
  }

  // 1. Promover proposedModuleName → Module real (cria/reusa, vincula story).
  //    Isso normaliza o terreno antes do approval em massa.
  const { data: proposed, error: proposedErr } = await supabase
    .from("UserStory")
    .select("id, projectId, proposedModuleName")
    .eq("designSessionId", sessionId)
    .not("proposedModuleName", "is", null);
  if (proposedErr) throw proposedErr;
  for (const s of proposed ?? []) {
    if (!s.proposedModuleName) continue;
    await approveProposedModule(
      s.id,
      s.projectId,
      s.proposedModuleName,
      approverId,
    );
  }

  // 2. Coletar todos os módulos efetivamente envolvidos.
  const { data: storyRows, error: storyRowsErr } = await supabase
    .from("UserStory")
    .select("id, moduleId, refinementStatus")
    .eq("designSessionId", sessionId);
  if (storyRowsErr) throw storyRowsErr;

  const moduleIds = Array.from(
    new Set(
      (storyRows ?? [])
        .map((s) => s.moduleId)
        .filter((id): id is string => id !== null),
    ),
  );

  // 3. Module.approvedAt em todos.
  if (moduleIds.length > 0) {
    const { error: modErr } = await supabase
      .from("Module")
      .update({
        approvedAt: nowIso,
        approvedBy: approverId,
        updatedAt: nowIso,
      })
      .in("id", moduleIds)
      .is("approvedAt", null); // idempotente — não sobrescreve aprovações antigas
    if (modErr) throw modErr;
  }

  // 4. UserStory.refinementStatus → committed (todas, em massa).
  const storyIds = (storyRows ?? []).map((s) => s.id);
  let storiesCommitted = 0;
  if (storyIds.length > 0) {
    const { data: committed, error: refErr } = await supabase
      .from("UserStory")
      .update({ refinementStatus: "committed", updatedAt: nowIso })
      .in("id", storyIds)
      .neq("refinementStatus", "committed")
      .select("id");
    if (refErr) throw refErr;
    storiesCommitted = (committed ?? []).length;
  }

  // 5. Task.status draft → backlog em massa (filtrado por sessão).
  let tasksPromoted = 0;
  let totalFp = 0;
  const { data: drafts, error: draftsErr } = await supabase
    .from("Task")
    .select("id, functionPoints")
    .eq("designSessionId", sessionId)
    .eq("status", "draft");
  if (draftsErr) throw draftsErr;
  if ((drafts ?? []).length > 0) {
    const { error: promoteErr } = await supabase
      .from("Task")
      .update({ status: "backlog", updatedAt: nowIso })
      .in(
        "id",
        (drafts ?? []).map((d) => d.id),
      );
    if (promoteErr) throw promoteErr;
    tasksPromoted = (drafts ?? []).length;
    totalFp = (drafts ?? []).reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
  }

  // 6. DesignSession.status = completed.
  const { error: dsErr } = await supabase
    .from("DesignSession")
    .update({ status: "completed", completedAt: nowIso, updatedAt: nowIso })
    .eq("id", sessionId);
  if (dsErr) throw dsErr;

  // 7. Audit log: 1 row por módulo aprovado nessa sessão.
  if (moduleIds.length > 0) {
    const activityRows = moduleIds.map((moduleId) => ({
      moduleId,
      type: "session_completed",
      payload: { sessionId, storiesCommitted, tasksPromoted, totalFp },
      actorMemberId: approverId,
    }));
    const { error: actErr } = await supabase
      .from("ModuleActivity")
      .insert(activityRows);
    if (actErr) throw actErr;
  }

  return {
    modulesApproved: moduleIds.length,
    storiesCommitted,
    tasksPromoted,
    totalFp,
  };
}

/**
 * Reverte uma sessão concluída. Cascata pra trás:
 *
 *   1. Pre-flight: bloqueia se qualquer task da sessão saiu de backlog
 *      (todo/in_progress/review/done) — PM precisa resolver primeiro.
 *   2. Module.approvedAt = NULL (todos os módulos da sessão)
 *   3. UserStory.refinementStatus → 'draft' (todas as stories da sessão)
 *   4. Task.status backlog → draft (em massa)
 *   5. DesignSession.status = 'in_progress', completedAt = NULL
 *   6. ModuleActivity row 'session_reopened' por módulo (audit)
 */
export async function reopenSession(
  sessionId: string,
  reopenerId: string | null,
): Promise<
  | {
      ok: true;
      modulesReopened: number;
      storiesReverted: number;
      tasksReverted: number;
    }
  | {
      ok: false;
      blocking: Array<{ reference: string | null; status: string }>;
    }
> {
  const supabase = db();
  const nowIso = new Date().toISOString();

  // Snapshot da sessão
  const { data: session, error: sessErr } = await supabase
    .from("DesignSession")
    .select("id, status")
    .eq("id", sessionId)
    .single();
  if (sessErr) throw sessErr;
  if (!session) throw new Error("Session not found");
  if (session.status !== "completed") {
    throw new Error("Apenas sessões concluídas podem ser reabertas");
  }

  // 1. Pre-flight: tasks ativas bloqueiam.
  const { data: active, error: activeErr } = await supabase
    .from("Task")
    .select("reference, status")
    .eq("designSessionId", sessionId)
    .in("status", ["todo", "in_progress", "review", "done"]);
  if (activeErr) throw activeErr;
  if ((active ?? []).length > 0) {
    return {
      ok: false,
      blocking: (active ?? []).map((t) => ({
        reference: t.reference,
        status: t.status,
      })),
    };
  }

  // 2. Coletar módulos da sessão (via stories).
  const { data: storyRows, error: storyRowsErr } = await supabase
    .from("UserStory")
    .select("id, moduleId")
    .eq("designSessionId", sessionId);
  if (storyRowsErr) throw storyRowsErr;

  const moduleIds = Array.from(
    new Set(
      (storyRows ?? [])
        .map((s) => s.moduleId)
        .filter((id): id is string => id !== null),
    ),
  );
  const storyIds = (storyRows ?? []).map((s) => s.id);

  // 3. Module.approvedAt = null (todos da sessão).
  if (moduleIds.length > 0) {
    const { error: modErr } = await supabase
      .from("Module")
      .update({ approvedAt: null, approvedBy: null, updatedAt: nowIso })
      .in("id", moduleIds);
    if (modErr) throw modErr;
  }

  // 4. UserStory.refinementStatus → draft.
  let storiesReverted = 0;
  if (storyIds.length > 0) {
    const { data: reverted, error: refErr } = await supabase
      .from("UserStory")
      .update({ refinementStatus: "draft", updatedAt: nowIso })
      .in("id", storyIds)
      .select("id");
    if (refErr) throw refErr;
    storiesReverted = (reverted ?? []).length;
  }

  // 5. Task.status backlog → draft.
  const { data: revertedTasks, error: tasksErr } = await supabase
    .from("Task")
    .update({ status: "draft", updatedAt: nowIso })
    .eq("designSessionId", sessionId)
    .eq("status", "backlog")
    .select("id");
  if (tasksErr) throw tasksErr;
  const tasksReverted = (revertedTasks ?? []).length;

  // 6. DesignSession.status = in_progress.
  const { error: dsErr } = await supabase
    .from("DesignSession")
    .update({ status: "in_progress", completedAt: null, updatedAt: nowIso })
    .eq("id", sessionId);
  if (dsErr) throw dsErr;

  // 7. Audit log.
  if (moduleIds.length > 0) {
    const activityRows = moduleIds.map((moduleId) => ({
      moduleId,
      type: "session_reopened",
      payload: { sessionId, storiesReverted, tasksReverted },
      actorMemberId: reopenerId,
    }));
    const { error: actErr } = await supabase
      .from("ModuleActivity")
      .insert(activityRows);
    if (actErr) throw actErr;
  }

  return {
    ok: true,
    modulesReopened: moduleIds.length,
    storiesReverted,
    tasksReverted,
  };
}

// ─── Acceptance Criteria ─────────────────────────────────────────────────────

export async function getAcForStory(
  storyId: string,
): Promise<AcceptanceCriterionRow[]> {
  const { data, error } = await db()
    .from("AcceptanceCriterion")
    .select("*")
    .eq("userStoryId", storyId)
    .order("order");
  if (error) throw error;
  return data ?? [];
}

export async function getAcForTask(
  taskId: string,
): Promise<AcceptanceCriterionRow[]> {
  const { data, error } = await db()
    .from("AcceptanceCriterion")
    .select("*")
    .eq("taskId", taskId)
    .order("order");
  if (error) throw error;
  return data ?? [];
}

export async function createAc(input: {
  userStoryId?: string | null;
  taskId?: string | null;
  text: string;
  order?: number;
}): Promise<AcceptanceCriterionRow> {
  const { data, error } = await db()
    .from("AcceptanceCriterion")
    .insert({
      userStoryId: input.userStoryId ?? null,
      taskId: input.taskId ?? null,
      text: input.text,
      order: input.order ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateAc(
  id: string,
  patch: { text?: string; order?: number },
): Promise<AcceptanceCriterionRow> {
  const { data, error } = await db()
    .from("AcceptanceCriterion")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAc(id: string): Promise<void> {
  const { error } = await db().from("AcceptanceCriterion").delete().eq("id", id);
  if (error) throw error;
}

export async function toggleAcCheck(
  id: string,
  memberId: string,
  checked: boolean,
): Promise<AcceptanceCriterionRow> {
  const patch = checked
    ? {
        checkedAt: new Date().toISOString(),
        checkedBy: memberId,
      }
    : { checkedAt: null, checkedBy: null };
  const { data, error } = await db()
    .from("AcceptanceCriterion")
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ─── Task ↔ Story link ───────────────────────────────────────────────────────

export async function setTaskUserStory(
  taskId: string,
  userStoryId: string | null,
): Promise<TaskRow> {
  const { data, error } = await db()
    .from("Task")
    .update({ userStoryId, updatedAt: new Date().toISOString() })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ─── Project DoD ─────────────────────────────────────────────────────────────

export async function setDefinitionOfDone(
  projectId: string,
  items: string[],
): Promise<ProjectRow> {
  const { data, error } = await db()
    .from("Project")
    .update({ definitionOfDone: items })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setProjectReferenceKey(
  projectId: string,
  referenceKey: string,
): Promise<ProjectRow> {
  const normalized = referenceKey.trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(normalized)) {
    throw new Error(
      `Invalid referenceKey "${referenceKey}" — expected 2-5 uppercase letters`,
    );
  }
  const { data, error } = await db()
    .from("Project")
    .update({ referenceKey: normalized })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

