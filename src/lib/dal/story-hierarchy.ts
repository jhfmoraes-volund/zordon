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

/**
 * Seed the 3 default personas (Builder/PM/Cliente) for an existing project.
 * Idempotent — uses ON CONFLICT to skip if already present. Useful for
 * projects created before the trigger existed.
 */
export async function seedDefaultPersonas(projectId: string): Promise<void> {
  const rows = [
    { projectId, name: "Builder", description: "Membro do time que executa tasks" },
    { projectId, name: "PM", description: "Gestor do projeto, define prioridades e valida entregas" },
    { projectId, name: "Cliente", description: "Stakeholder externo / usuário final do produto" },
  ];
  for (const row of rows) {
    const { error } = await db()
      .from("ProjectPersona")
      .insert(row)
      .select("id");
    if (error && !/duplicate|persona_unique_per_project/.test(error.message)) {
      throw error;
    }
  }
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
      refinementStatus: input.refinementStatus ?? "draft",
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
export async function approveProposedModule(
  storyId: string,
  projectId: string,
  proposedName: string,
): Promise<{ module: ModuleRow; story: UserStoryRow }> {
  const existing = await db()
    .from("Module")
    .select("*")
    .eq("projectId", projectId)
    .eq("name", proposedName)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const mod =
    existing.data ?? (await createModule({ projectId, name: proposedName }));

  const story = await updateStory(storyId, {
    moduleId: mod.id,
    proposedModuleName: null,
  });
  return { module: mod, story };
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

export async function setProjectUseStoryHierarchy(
  projectId: string,
  enabled: boolean,
): Promise<ProjectRow> {
  const { data, error } = await db()
    .from("Project")
    .update({ useStoryHierarchy: enabled })
    .eq("id", projectId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
