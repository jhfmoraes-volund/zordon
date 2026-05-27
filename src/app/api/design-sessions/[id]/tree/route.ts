import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { isGuestActor } from "@/lib/guest-payload";

/**
 * GET /api/design-sessions/[id]/tree
 *
 * Returns the briefing hierarchy organized as the UI tree:
 *
 *   ModuleNode {                       — Module aprovado OU placeholder p/ proposedModuleName
 *     id: string | null                  null = grupo virtual de proposedModuleName
 *     name: string
 *     approved: boolean
 *     approvedAt: string | null
 *     stories: StoryNode[]
 *   }
 *
 *   StoryNode {
 *     id, reference, title, want, soThat,
 *     refinementStatus,
 *     persona: { id, name } | null,
 *     acProductCount: number,
 *     tasks: TaskNode[]
 *   }
 *
 *   TaskNode {
 *     id, reference, title,
 *     status,            — 'draft' | 'backlog' | 'todo' | ...
 *     functionPoints, complexity, scope,
 *     acTechnicalCount: number
 *   }
 *
 * Stories sem moduleId nem proposedModuleName ficam num grupo "(sem módulo)".
 * Tasks sem userStoryId não aparecem aqui — elas pertencem a sessions legadas.
 */

type ModuleRow = {
  id: string;
  name: string;
  description: string | null;
  approvedAt: string | null;
};

// Description is exposed at the group level. The UI doesn't render it yet,
// but the field is populated by `propose_modules` from module_discovery.

type StoryRow = {
  id: string;
  reference: string;
  title: string;
  want: string;
  soThat: string | null;
  refinementStatus: string;
  moduleId: string | null;
  proposedModuleName: string | null;
  personaId: string | null;
};

type TaskRow = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  functionPoints: number | null;
  complexity: string;
  scope: string;
  userStoryId: string | null;
};

type AcRow = {
  taskId: string | null;
  userStoryId: string | null;
};

type PersonaRow = { id: string; name: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const supabase = db();

  const { data: session, error: sessErr } = await supabase
    .from("DesignSession")
    .select("id, projectId, status")
    .eq("id", sessionId)
    .single();
  if (sessErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const projectId = session.projectId;

  const [storiesRes, modulesRes, personasRes, tasksRes, acRes] = await Promise.all([
    // Stories created in THIS session (briefing scope). Dismissed stories are
    // hidden from the briefing tree — the user explicitly descarted them.
    supabase
      .from("UserStory")
      .select(
        "id, reference, title, want, soThat, refinementStatus, moduleId, proposedModuleName, personaId",
      )
      .eq("designSessionId", sessionId)
      .is("dismissedAt", null)
      .order("createdAt", { ascending: true }),
    // All project modules — both approved and (rare) draft. Stories link via moduleId.
    supabase
      .from("Module")
      .select("id, name, description, approvedAt")
      .eq("projectId", projectId),
    supabase
      .from("ProjectPersona")
      .select("id, name")
      .eq("projectId", projectId),
    // Tasks created in THIS session. Dismissed tasks are hidden from the tree.
    supabase
      .from("Task")
      .select(
        "id, reference, title, status, functionPoints, complexity, scope, userStoryId",
      )
      .eq("designSessionId", sessionId)
      .is("dismissedAt", null)
      .order("createdAt", { ascending: true }),
    // AC counts (we'll bucket below).
    supabase
      .from("AcceptanceCriterion")
      .select("taskId, userStoryId"),
  ]);

  if (storiesRes.error) {
    return NextResponse.json({ error: storiesRes.error.message }, { status: 500 });
  }
  if (modulesRes.error) {
    return NextResponse.json({ error: modulesRes.error.message }, { status: 500 });
  }
  if (tasksRes.error) {
    return NextResponse.json({ error: tasksRes.error.message }, { status: 500 });
  }

  const stories = (storiesRes.data ?? []) as StoryRow[];
  const modules = (modulesRes.data ?? []) as ModuleRow[];
  const personas = (personasRes.data ?? []) as PersonaRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const acRows = (acRes.data ?? []) as AcRow[];

  // ── Counts ────────────────────────────────────────────────────────────────
  const acByStory = new Map<string, number>();
  const acByTask = new Map<string, number>();
  for (const ac of acRows) {
    if (ac.userStoryId) {
      acByStory.set(ac.userStoryId, (acByStory.get(ac.userStoryId) ?? 0) + 1);
    } else if (ac.taskId) {
      acByTask.set(ac.taskId, (acByTask.get(ac.taskId) ?? 0) + 1);
    }
  }

  // ── Tasks bucketed by storyId ─────────────────────────────────────────────
  const tasksByStory = new Map<
    string,
    Array<{
      id: string;
      reference: string | null;
      title: string;
      status: string;
      functionPoints: number | null;
      complexity: string;
      scope: string;
      acTechnicalCount: number;
    }>
  >();
  for (const t of tasks) {
    if (!t.userStoryId) continue;
    const list = tasksByStory.get(t.userStoryId) ?? [];
    list.push({
      id: t.id,
      reference: t.reference,
      title: t.title,
      status: t.status,
      functionPoints: t.functionPoints,
      complexity: t.complexity,
      scope: t.scope,
      acTechnicalCount: acByTask.get(t.id) ?? 0,
    });
    tasksByStory.set(t.userStoryId, list);
  }

  // ── Module lookup ─────────────────────────────────────────────────────────
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const personaById = new Map(personas.map((p) => [p.id, p]));

  // ── Group stories by module key ───────────────────────────────────────────
  // Modules-first: every project Module gets a group, even with zero stories,
  // so `module_discovery` results show up immediately. Then stories are placed
  // into existing groups (real moduleId) or virtual `proposed:` groups.
  //
  // Key strategy:
  //   - moduleId present & exists  → key = `module:<id>`        (real Module)
  //   - proposedModuleName present → key = `proposed:<name>`    (virtual group)
  //   - neither                    → key = `_orphan_`           (sem módulo)
  type Group = {
    key: string;
    moduleId: string | null;
    name: string;
    description: string | null;
    approved: boolean;
    approvedAt: string | null;
    stories: Array<{
      id: string;
      reference: string;
      title: string;
      want: string;
      soThat: string | null;
      refinementStatus: string;
      persona: { id: string; name: string } | null;
      acProductCount: number;
      tasks: typeof tasksByStory extends Map<string, infer V> ? V : never;
    }>;
  };
  const groupByKey = new Map<string, Group>();

  // 1) Pre-populate one group per project module — even when empty.
  for (const m of modules) {
    groupByKey.set(`module:${m.id}`, {
      key: `module:${m.id}`,
      moduleId: m.id,
      name: m.name,
      description: m.description,
      approved: m.approvedAt !== null,
      approvedAt: m.approvedAt,
      stories: [],
    });
  }

  // 2) Place stories into existing module groups or create virtual ones.
  for (const s of stories) {
    let key: string;
    let moduleId: string | null;
    let name: string;
    let description: string | null;
    let approved: boolean;
    let approvedAt: string | null;

    if (s.moduleId && moduleById.has(s.moduleId)) {
      const m = moduleById.get(s.moduleId)!;
      key = `module:${m.id}`;
      moduleId = m.id;
      name = m.name;
      description = m.description;
      approved = m.approvedAt !== null;
      approvedAt = m.approvedAt;
    } else if (s.proposedModuleName) {
      key = `proposed:${s.proposedModuleName}`;
      moduleId = null;
      name = s.proposedModuleName;
      description = null;
      approved = false;
      approvedAt = null;
    } else {
      key = "_orphan_";
      moduleId = null;
      name = "(sem módulo)";
      description = null;
      approved = false;
      approvedAt = null;
    }

    let group = groupByKey.get(key);
    if (!group) {
      group = {
        key,
        moduleId,
        name,
        description,
        approved,
        approvedAt,
        stories: [],
      };
      groupByKey.set(key, group);
    }

    group.stories.push({
      id: s.id,
      reference: s.reference,
      title: s.title,
      want: s.want,
      soThat: s.soThat,
      refinementStatus: s.refinementStatus,
      persona: s.personaId ? personaById.get(s.personaId) ?? null : null,
      acProductCount: acByStory.get(s.id) ?? 0,
      tasks: tasksByStory.get(s.id) ?? [],
    });
  }

  // Order: approved modules first (alpha), then proposed (alpha), then orphan.
  const tree = Array.from(groupByKey.values()).sort((a, b) => {
    const rank = (g: Group) =>
      g.key.startsWith("module:") ? 0 : g.key.startsWith("proposed:") ? 1 : 2;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const totalStories = stories.length;
  const totalTasks = tasks.length;
  const draftTasks = tasks.filter((t) => t.status === "draft").length;
  const totalFp = tasks
    .filter((t) => t.status === "draft")
    .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);
  const proposedModulesCount = tree.filter((g) =>
    g.key.startsWith("proposed:"),
  ).length;
  const approvedModulesCount = tree.filter(
    (g) => g.key.startsWith("module:") && g.approved,
  ).length;

  const guest = await isGuestActor();
  const safeTree = guest
    ? tree.map((g) => ({
        ...g,
        stories: g.stories.map((s) => ({
          ...s,
          tasks: s.tasks.map((t) => ({ ...t, functionPoints: null })),
        })),
      }))
    : tree;

  return NextResponse.json({
    sessionId,
    projectId,
    tree: safeTree,
    stats: {
      totalStories,
      totalTasks,
      draftTasks,
      totalFp: guest ? null : totalFp,
      proposedModulesCount,
      approvedModulesCount,
    },
  });
}
