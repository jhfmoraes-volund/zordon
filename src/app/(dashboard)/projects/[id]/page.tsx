"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  FileText,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Shield,
  Target,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageTitle } from "@/components/app-shell";
import { ProjectAccessSheet } from "@/components/project-access-sheet";
import { ProjectEditSheet } from "@/components/project-edit-sheet";
import { ProjectSessionsTab } from "@/components/project-sessions-tab";
import { ProjectWiki } from "@/components/project-wiki";
import {
  SprintDialog,
  type SprintFormData,
} from "@/components/sprint-dialog";
import {
  SprintContextSheet,
  type SprintContextSheetMode,
} from "@/components/sprint/sprint-context-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { createClient } from "@/lib/supabase/client";
import {
  ModuleDialog,
  PersonaDialog,
  SettingsPanel,
  StoriesList,
  StorySheet,
  TasksList,
  TaskSheet,
  TaskDuplicateDialog,
  TaskCloneDialog,
  type ProjectLite,
  type StoryCreateInput,
  type TaskTag,
} from "@/components/story-hierarchy";
import type { ChipTone } from "@/lib/status-chips";
import {
  adaptMember,
  adaptModule,
  adaptPersona,
  adaptStory,
  adaptTask,
  buildTaskAdapterContext,
  type AdaptedStory,
  type AdaptedTask,
} from "@/components/story-hierarchy/adapters";
import {
  findCurrentSprint,
  SprintDetail,
  SprintNavigator,
  SprintActionDialog,
  SprintRibbon,
  type NavValue,
  type Sprint as SprintView,
  type SprintMemberCapacity,
} from "@/components/sprint";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  PersonaRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";
import { toast } from "sonner";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { tempId as makeTempId } from "@/lib/optimistic/reconcile";
import { suggestFunctionPoints } from "@/lib/function-points";

// ─── Types ──────────────────────────────────────────────────────────────────

type TabKey =
  | "stories"
  | "sprints"
  | "sessions"
  | "wiki"
  | "settings";

type ProjectMeta = {
  id: string;
  name: string;
  status: string;
  client: { name: string } | null;
  clientId: string;
  pmId: string | null;
  pm: { id: string; name: string; role: string | null } | null;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string | null;
  referenceKey: string | null;
  definitionOfDone: string[];
};

type RawTask = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  type: string | null;
  scope: string | null;
  complexity: string | null;
  functionPoints: number | null;
  billable: boolean | null;
  dueDate: string | null;
  doneAt: string | null;
  notes: string | null;
  sprintId: string | null;
  userStoryId: string | null;
  projectId: string;
  createdByAgent: boolean | null;
  assignments: Array<{ memberId: string; member: { id: string; name: string } | null }>;
  tags: Array<{
    TaskTag: { id: string; name: string; tone: string } | null;
  }>;
};

type RawSprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  goal: string | null;
  deployedToStagingAt: string | null;
  deployedToProductionAt: string | null;
};

type RawMember = {
  id: string;
  name: string;
  role: string | null;
  fpCapacity: number | null;
};

type RawSprintMember = {
  sprintId: string;
  memberId: string;
  fpAllocation: number;
};

type RawProjectMember = {
  memberId: string;
  fpAllocation: number;
};

const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
  { key: "stories", label: "Stories", icon: BookOpen },
  { key: "sprints", label: "Sprints", icon: Zap },
  { key: "sessions", label: "Sessions", icon: Lightbulb },
  { key: "wiki", label: "Wiki", icon: FileText },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = useMemo(() => createClient(), []);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTabParam = searchParams.get("tab");
  // Legacy: `?tab=tasks` agora aponta pra Sprints → Todas. Mantém deep-links antigos vivos.
  const tabParam: TabKey | null =
    rawTabParam === "tasks"
      ? "sprints"
      : (rawTabParam as TabKey | null);
  const sprintParam = searchParams.get("sprint");
  const viewParam = searchParams.get("view");
  const taskParam = searchParams.get("task");

  const [activeTab, setActiveTab] = useState<TabKey>(tabParam ?? "stories");
  // View dentro da aba Sprints: id de sprint real OU "backlog" / "all".
  // Init: respeita ?view= explícito; senão ?sprint=…; senão null (resolvido pra
  // sprint ativa quando carregar — ver useEffect abaixo).
  const initialSprintView: NavValue | null =
    rawTabParam === "tasks"
      ? "all"
      : viewParam === "backlog" || viewParam === "all"
        ? viewParam
        : sprintParam ?? null;
  const [sprintView, setSprintView] = useState<NavValue | null>(initialSprintView);
  const [project, setProject] = useState<ProjectMeta | null>(null);

  const [rawModules, setRawModules] = useState<ModuleRow[]>([]);
  const [rawPersonas, setRawPersonas] = useState<PersonaRow[]>([]);
  const [rawStories, setRawStories] = useState<StoryWithRelations[]>([]);
  const tasksCollection = useOptimisticCollection<RawTask>([]);
  const rawTasks = tasksCollection.items;
  const setRawTasks = tasksCollection.setCommitted;
  const taskMutate = tasksCollection.mutate;
  const [projectTags, setProjectTags] = useState<TaskTag[]>([]);
  const acRowsCollection =
    useOptimisticCollection<AcceptanceCriterionRow>([]);
  const taskAcRows = acRowsCollection.items;
  const setTaskAcRows = acRowsCollection.setCommitted;
  // Map client-side tempId → real DB id. Lets us keep the tempId as the React
  // key after the create resolves, avoiding a remount/flicker on the row.
  const acIdAliasRef = useRef<Map<string, string>>(new Map());
  const resolveAcId = useCallback(
    (clientId: string) => acIdAliasRef.current.get(clientId) ?? clientId,
    [],
  );
  const [rawSprints, setRawSprints] = useState<RawSprint[]>([]);
  const [rawMembers, setRawMembers] = useState<RawMember[]>([]);
  const [rawProjectMembers, setRawProjectMembers] = useState<RawProjectMember[]>(
    [],
  );
  const [rawSprintMembers, setRawSprintMembers] = useState<RawSprintMember[]>(
    [],
  );

  const [accessOpen, setAccessOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  const [sprintAction, setSprintAction] = useState<
    | { mode: "activate-replacing" | "activate-fresh"; targetId: string }
    | { mode: "reopen-replacing" | "reopen-fresh"; targetId: string }
    | null
  >(null);
  const [sprintContextSheet, setSprintContextSheet] = useState<{
    sprintId: string;
    mode: SprintContextSheetMode;
  } | null>(null);
  const [selectedStoryRef, setSelectedStoryRef] = useState<string | null>(null);
  const [editingStory, setEditingStory] = useState(false);
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(taskParam);

  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    suggested?: string;
  }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({
    open: false,
  });
  const [storyCreateOpen, setStoryCreateOpen] = useState(false);
  const [duplicateTaskRef, setDuplicateTaskRef] = useState<string | null>(null);
  const [cloneTaskRef, setCloneTaskRef] = useState<string | null>(null);
  const [targetProjects, setTargetProjects] = useState<ProjectLite[]>([]);

  // Sprint focada (id de sprint real) derivada do sprintView.
  // null quando view sintética ("backlog"/"all") ou ainda não resolvida.
  const focusSprintId =
    sprintView && sprintView !== "backlog" && sprintView !== "all"
      ? sprintView
      : null;

  // Sync activeTab + sprintView → URL search params.
  // Sprint real: ?sprint=<id>.  View sintética: ?view=backlog|all.
  // Allows deep-link from /profile, weekly-allocation widget, etc.
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "stories") params.set("tab", activeTab);
    if (activeTab === "sprints" && sprintView) {
      if (sprintView === "backlog" || sprintView === "all") {
        params.set("view", sprintView);
      } else {
        params.set("sprint", sprintView);
      }
    }
    const qs = params.toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    if (next !== window.location.pathname + window.location.search) {
      router.replace(next, { scroll: false });
    }
  }, [activeTab, sprintView, pathname, router]);

  // ─── Loaders ───────────────────────────────────────────────────────────────

  const loadProject = useCallback(async () => {
    const { data } = await supabase
      .from("Project")
      .select(
        "id, name, status, clientId, pmId, repoUrl, startDate, endDate, githubRepoOwner, githubRepoName, githubDefaultBranch, referenceKey, definitionOfDone, client:Client(name), pm:Member!Project_pmId_fkey(id, name, role)",
      )
      .eq("id", id)
      .single();
    if (!data) return;
    setProject({
      id: data.id,
      name: data.name,
      status: data.status,
      client: (data.client as { name: string } | null) ?? null,
      clientId: data.clientId,
      pmId: data.pmId ?? null,
      pm:
        (data.pm as {
          id: string;
          name: string;
          role: string | null;
        } | null) ?? null,
      repoUrl: data.repoUrl ?? null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      githubRepoOwner: data.githubRepoOwner ?? null,
      githubRepoName: data.githubRepoName ?? null,
      githubDefaultBranch: data.githubDefaultBranch ?? null,
      referenceKey: data.referenceKey ?? null,
      definitionOfDone: Array.isArray(data.definitionOfDone)
        ? (data.definitionOfDone as string[])
        : [],
    });
  }, [id, supabase]);

  const loadStoryHierarchy = useCallback(async () => {
    // Project view shows only APPROVED modules (Module.approvedAt IS NOT NULL).
    // Stories whose moduleId points to a draft module — or whose moduleId is
    // null (still in proposedModuleName) — are excluded. Drafts live exclusively
    // in the Design Session briefing tree until approved.
    const [modulesRes, personasRes, storiesRes, taskAcRes] = await Promise.all([
      supabase
        .from("Module")
        .select("*")
        .eq("projectId", id)
        .not("approvedAt", "is", null)
        .order("name"),
      supabase
        .from("ProjectPersona")
        .select("*")
        .eq("projectId", id)
        .order("name"),
      supabase
        .from("UserStory")
        .select(
          "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module!inner(id, name, description, approvedAt), persona:ProjectPersona(id, name, description)",
        )
        .eq("projectId", id)
        .not("module.approvedAt", "is", null)
        .order("createdAt", { ascending: false }),
      supabase
        .from("AcceptanceCriterion")
        .select("*")
        .not("taskId", "is", null),
    ]);

    setRawModules((modulesRes.data ?? []) as ModuleRow[]);
    setRawPersonas((personasRes.data ?? []) as PersonaRow[]);
    setRawStories(
      ((storiesRes.data ?? []) as unknown) as StoryWithRelations[],
    );
    setTaskAcRows((taskAcRes.data ?? []) as AcceptanceCriterionRow[]);
    // After a hard reload, all rows carry real ids — aliases are obsolete.
    acIdAliasRef.current.clear();
  }, [id, supabase]);

  const loadTasksAndSprints = useCallback(async () => {
    const [tasksRes, sprintsRes, tagsRes] = await Promise.all([
      supabase
        .from("Task")
        .select(
          "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, name, tone))",
        )
        .eq("projectId", id)
        .neq("status", "draft")
        .order("createdAt", { ascending: false }),
      supabase
        .from("Sprint")
        .select("*")
        .eq("projectId", id)
        .order("startDate"),
      supabase
        .from("TaskTag")
        .select("id, name, tone")
        .eq("projectId", id)
        .order("name"),
    ]);
    setRawTasks((tasksRes.data ?? []) as unknown as RawTask[]);
    setRawSprints((sprintsRes.data ?? []) as RawSprint[]);
    setProjectTags((tagsRes.data ?? []) as TaskTag[]);
  }, [id, supabase]);

  const loadMembers = useCallback(async () => {
    const { data: pms, error } = await supabase
      .from("ProjectMember")
      .select(
        "memberId, fpAllocation, member:Member!ProjectMember_memberId_fkey(id, name, role, fpCapacity)",
      )
      .eq("projectId", id);
    if (error) {
      console.error("[loadMembers]", error);
      return;
    }

    const projectMemberRows: RawProjectMember[] = (pms ?? []).map((pm) => ({
      memberId: pm.memberId,
      fpAllocation: pm.fpAllocation ?? 0,
    }));
    setRawProjectMembers(projectMemberRows);

    const memberRows: RawMember[] = (pms ?? [])
      .map((pm) => {
        const m = pm.member as
          | RawMember
          | RawMember[]
          | null
          | undefined;
        if (!m) return null;
        return Array.isArray(m) ? m[0] ?? null : m;
      })
      .filter((m): m is RawMember => m !== null);
    setRawMembers(memberRows);
  }, [id, supabase]);

  const loadSprintMembers = useCallback(async () => {
    const sprintIds = rawSprints.map((s) => s.id);
    if (sprintIds.length === 0) {
      setRawSprintMembers([]);
      return;
    }
    const { data: sm } = await supabase
      .from("SprintMember")
      .select("sprintId, memberId, fpAllocation")
      .in("sprintId", sprintIds);
    setRawSprintMembers((sm ?? []) as RawSprintMember[]);
  }, [supabase, rawSprints]);

  useEffect(() => {
    loadProject();
    loadStoryHierarchy();
    loadTasksAndSprints();
    loadMembers();
  }, [loadProject, loadStoryHierarchy, loadTasksAndSprints, loadMembers]);

  useEffect(() => {
    loadSprintMembers();
  }, [loadSprintMembers]);

  // ─── Adapt ─────────────────────────────────────────────────────────────────

  const modules = useMemo(() => rawModules.map(adaptModule), [rawModules]);
  const personas = useMemo(() => rawPersonas.map(adaptPersona), [rawPersonas]);
  const stories: AdaptedStory[] = useMemo(
    () => rawStories.map(adaptStory),
    [rawStories],
  );
  // The SQL loader already filters `.neq("status","draft")`, so `rawTasks`
  // never contains AI-proposed drafts (those are reviewed inside the
  // originating Design Session sheet, not the project board).
  const tasks: AdaptedTask[] = useMemo(() => {
    const ctx = buildTaskAdapterContext(stories, taskAcRows);
    return rawTasks.map((t) => adaptTask(t, ctx));
  }, [rawTasks, stories, taskAcRows]);

  // View "Backlog" da aba Sprints: tasks sem sprint OU com status=backlog
  // (uma task pode estar em ambas — backlog do projeto e dentro de uma sprint
  //  com status=backlog é intencional).
  const backlogTasks = useMemo(
    () => tasks.filter((t) => t.sprintId === null || t.status === "backlog"),
    [tasks],
  );

  const members = useMemo(() => rawMembers.map(adaptMember), [rawMembers]);

  const sprints: SprintView[] = useMemo(
    () =>
      rawSprints.map((s) => ({
        id: s.id,
        name: s.name,
        startDate: s.startDate.slice(0, 10),
        endDate: s.endDate.slice(0, 10),
        status: s.status as "upcoming" | "active" | "completed",
        goal: s.goal,
        deployedToStagingAt: s.deployedToStagingAt,
        deployedToProductionAt: s.deployedToProductionAt,
      })),
    [rawSprints],
  );

  /**
   * Build per-(sprint × member) capacity rows.
   *
   * Source-of-truth cascade for `fpAllocation`:
   *   1. SprintMember.fpAllocation  — explicit override per sprint
   *   2. ProjectMember.fpAllocation — project-wide default
   *   3. Member.fpCapacity          — full battery (member exists but never
   *                                   had allocation set; assume available)
   *
   * Iterates over every ProjectMember × every Sprint, so the widget shows
   * everyone allocated to the project — not just those manually written
   * into SprintMember (which is a manual-only table with no DB trigger).
   */
  const capacities: SprintMemberCapacity[] = useMemo(() => {
    const memberCapacityById = new Map(
      rawMembers.map((m) => [m.id, m.fpCapacity ?? 0]),
    );
    const projectAllocById = new Map(
      rawProjectMembers.map((pm) => [pm.memberId, pm.fpAllocation]),
    );
    const sprintAllocByKey = new Map(
      rawSprintMembers.map(
        (sm) => [`${sm.sprintId}|${sm.memberId}`, sm.fpAllocation] as const,
      ),
    );

    return rawSprints.flatMap((sprint) =>
      rawProjectMembers.map((pm) => {
        const fpCapacity = memberCapacityById.get(pm.memberId) ?? 0;
        const sprintAlloc = sprintAllocByKey.get(`${sprint.id}|${pm.memberId}`);
        const projectAlloc = projectAllocById.get(pm.memberId) ?? 0;
        const fpAllocation =
          sprintAlloc !== undefined && sprintAlloc > 0
            ? sprintAlloc
            : projectAlloc > 0
              ? projectAlloc
              : fpCapacity;
        return {
          sprintId: sprint.id,
          memberId: pm.memberId,
          fpCapacity,
          fpAllocation,
        };
      }),
    );
  }, [rawSprints, rawSprintMembers, rawProjectMembers, rawMembers]);

  const moduleUsage = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of stories) {
      if (s.moduleId) acc[s.moduleId] = (acc[s.moduleId] ?? 0) + 1;
    }
    return acc;
  }, [stories]);

  const personaUsage = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of stories) {
      acc[s.personaId] = (acc[s.personaId] ?? 0) + 1;
    }
    return acc;
  }, [stories]);

  const activeSprintId = useMemo(
    () => findCurrentSprint(sprints)?.id ?? null,
    [sprints],
  );

  // Default da aba Sprints: sprint ativa. Aplica só na primeira resolução
  // (sprintView == null) — usuário pode ter escolhido "backlog"/"all" ou outra
  // sprint depois e a gente respeita.
  useEffect(() => {
    if (sprintView === null && activeSprintId !== null) {
      setSprintView(activeSprintId);
    }
  }, [activeSprintId, sprintView]);

  const selectedStory =
    stories.find((s) => s.reference === selectedStoryRef) ?? null;
  const selectedTask =
    tasks.find((t) => t.reference === selectedTaskRef) ?? null;

  // ─── Mutators ──────────────────────────────────────────────────────────────

  async function handleCreateSprint(form: SprintFormData) {
    const now = new Date().toISOString();
    setSprintDialogOpen(false);
    const goal = form.goal.trim();
    const { error } = await supabase.from("Sprint").insert({
      id: crypto.randomUUID(),
      projectId: id,
      name: form.name,
      startDate: form.startDate,
      endDate: form.endDate,
      status: form.status,
      goal: goal === "" ? null : goal,
      updatedAt: now,
    });
    if (error) {
      const message =
        error.code === "23505"
          ? error.message.includes("sprint_unique_week_per_project")
            ? "Já existe um sprint nessa semana neste projeto."
            : "Já existe um sprint com esse nome neste projeto."
          : error.message;
      showErrorToast(new Error(message), { label: "Falha ao criar sprint" });
      return;
    }
    await loadTasksAndSprints();
  }

  function requestActivateSprint(targetId: string) {
    const hasActive = sprints.some((s) => s.status === "active");
    setSprintAction({
      mode: hasActive ? "activate-replacing" : "activate-fresh",
      targetId,
    });
  }

  function requestCompleteSprint(targetId: string) {
    setSprintContextSheet({ sprintId: targetId, mode: "complete" });
  }

  function requestReopenSprint(targetId: string) {
    const hasActive = sprints.some((s) => s.status === "active");
    setSprintAction({
      mode: hasActive ? "reopen-replacing" : "reopen-fresh",
      targetId,
    });
  }

  async function handleActivateSprint(targetId: string) {
    try {
      await fetchOrThrow(`/api/sprints/${targetId}/activate`, { method: "POST" });
      toast.success("Sprint ativada");
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao ativar sprint" });
    }
  }

  async function handleReopenSprint(targetId: string) {
    try {
      await fetchOrThrow(`/api/sprints/${targetId}/reopen`, { method: "POST" });
      toast.success("Sprint reaberta");
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao reabrir sprint" });
    }
  }

  async function handleCreateStory(input: StoryCreateInput) {
    if (!project?.referenceKey) {
      showErrorToast(
        new Error("Project precisa de referenceKey. Configure em Settings."),
        { label: "Não é possível criar story" },
      );
      return;
    }
    try {
      await fetchOrThrow(`/api/projects/${id}/stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          want: input.want,
          soThat: input.soThat ?? null,
          personaId: input.personaId,
          moduleId: input.moduleId,
          proposedModuleName: input.proposedModuleName ?? null,
        }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao criar story" });
    }
  }

  /**
   * Create a backlog task and open the unified TaskSheet on it. The sheet
   * persists each field inline (saved on blur via the inline mutators), so
   * there's no "create form" — the user just edits the new task. The task
   * appears in the list immediately; if it was a misclick, the user deletes
   * via the row's kebab menu like any other task.
   *
   * `status="draft"` is reserved for AI-proposed tasks pending human review
   * (revealed only inside the originating Design Session), and is set
   * explicitly by that flow — never by this manual button.
   */
  async function handleCreateTask(opts?: {
    userStoryId?: string | null;
    sprintId?: string | null;
  }) {
    const tempTaskId = makeTempId("task");
    const now = new Date().toISOString();
    const optimistic: RawTask = {
      id: tempTaskId,
      reference: "…",
      title: "Nova task",
      description: null,
      status: "backlog",
      type: "feature",
      scope: "small",
      complexity: "medium",
      functionPoints: suggestFunctionPoints("small", "medium"),
      billable: true,
      dueDate: null,
      doneAt: null,
      notes: null,
      sprintId: opts?.sprintId ?? null,
      userStoryId: opts?.userStoryId ?? null,
      projectId: id,
      createdByAgent: false,
      assignments: [],
      tags: [],
    } as unknown as RawTask;

    const result = await taskMutate(
      { type: "create", entity: optimistic },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: id,
            title: "Nova task",
            type: "feature",
            scope: "small",
            complexity: "medium",
            status: "backlog",
            userStoryId: opts?.userStoryId ?? null,
            sprintId: opts?.sprintId ?? null,
            functionPoints: suggestFunctionPoints("small", "medium"),
            billable: true,
            updatedAt: now,
          }),
          signal,
        });
        return (await res.json()) as RawTask & { id: string };
      },
      {
        errorLabel: "Falha ao criar task",
        reconcile: (prev, server) => {
          const without = prev.filter((t) => t.id !== tempTaskId);
          return [server, ...without];
        },
      },
    );

    if (result?.reference) {
      setSelectedTaskRef(result.reference);
    }
  }

  async function handleCreateTag(name: string, tone: ChipTone): Promise<TaskTag> {
    const res = await fetch(`/api/projects/${id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tone }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Falha ao criar tag");
    }
    const created = (await res.json()) as TaskTag;
    setProjectTags((cur) =>
      [...cur, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return created;
  }

  async function handleChangeTaskTags(taskRef: string, tagIds: string[]) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds }),
    });
    if (!res.ok) {
      showErrorToast(new Error("Falha ao atualizar tags"), {
        label: "Tags",
      });
      return;
    }
    await loadTasksAndSprints();
  }

  async function handleSaveStory(updated: AdaptedStory) {
    const dbStory = rawStories.find((s) => s.reference === updated.reference);
    if (!dbStory) return;
    try {
      await fetchOrThrow(`/api/stories/${updated.reference}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: updated.title,
          want: updated.want,
          soThat: updated.soThat,
          personaId: updated.personaId,
          moduleId: updated.moduleId,
          proposedModuleName: updated.proposedModuleName ?? null,
          refinementStatus: updated.refinementStatus,
        }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar story" });
    }
  }

  /** Inline edits from the TasksList row. taskRef is the public reference;
   *  resolve to id via current `tasks` state (adapter exposes __id). */
  function findTaskIdByRef(ref: string): string | null {
    return tasks.find((t) => t.reference === ref)?.__id ?? null;
  }

  async function handleInlineStatusChange(
    taskRef: string,
    status: AdaptedTask["status"],
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    await taskMutate(
      { type: "patch", id: taskId, patch: { status } },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao atualizar status",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...server } : t)),
      },
    );
  }

  async function handleInlineSprintChange(
    taskRef: string,
    sprintId: string | null,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    await taskMutate(
      { type: "patch", id: taskId, patch: { sprintId } },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sprintId }),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao atualizar sprint",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...server } : t)),
      },
    );
  }

  /** Sets a single assignee — replaces all existing TaskAssignment rows. */
  async function handleInlineAssigneeChange(
    taskRef: string,
    memberId: string | null,
  ) {
    return handleInlineAssigneesChange(taskRef, memberId ? [memberId] : []);
  }

  /** Sets the full assignee list for a task (delete-all + insert). */
  async function handleInlineAssigneesChange(
    taskRef: string,
    memberIds: string[],
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;

    const memberLookup = new Map(rawMembers.map((m) => [m.id, m]));
    const optimisticAssignments = memberIds
      .map((memberId) => {
        const m = memberLookup.get(memberId);
        return m
          ? { memberId, member: { id: m.id, name: m.name } }
          : null;
      })
      .filter(
        (a): a is { memberId: string; member: { id: string; name: string } } =>
          a !== null,
      );

    await taskMutate(
      {
        type: "patch",
        id: taskId,
        patch: { assignments: optimisticAssignments } as Partial<RawTask>,
      },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigneeIds: memberIds.map((memberId) => ({ memberId })),
          }),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao atribuir",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...server } : t)),
      },
    );
  }

  async function handleSaveTask(updated: AdaptedTask) {
    const userStoryId =
      updated.userStoryRef === null
        ? null
        : stories.find((s) => s.reference === updated.userStoryRef)?.__id ??
          null;

    const fieldsPatch: Partial<RawTask> = {
      title: updated.title,
      description: updated.description,
      notes: updated.notes,
      status: updated.status,
      type: updated.type,
      scope: updated.scope,
      complexity: updated.complexity,
      functionPoints: updated.functionPoints,
      billable: updated.billable,
      dueDate: updated.dueDate,
      userStoryId,
    };

    await taskMutate(
      { type: "patch", id: updated.__id, patch: fieldsPatch },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${updated.__id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fieldsPatch),
          signal,
        });
        return (await res.json()) as RawTask;
      },
      {
        errorLabel: "Falha ao salvar task",
        reconcile: (prev, server) =>
          prev.map((t) => (t.id === updated.__id ? { ...t, ...server } : t)),
      },
    );
  }

  // ─── AC handlers (granular optimistic via acRowsCollection) ────────────────

  async function handleAcCreate(taskRef: string, text: string, order: number) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const tempId = makeTempId("ac");
    const optimistic: AcceptanceCriterionRow = {
      id: tempId,
      taskId,
      userStoryId: null,
      text,
      order,
      checkedAt: null,
      checkedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AcceptanceCriterionRow;
    await acRowsCollection.mutate(
      { type: "create", entity: optimistic },
      async (signal) => {
        const res = await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, order }),
            signal,
          },
        );
        const data = (await res.json()) as {
          acceptance: AcceptanceCriterionRow;
        };
        acIdAliasRef.current.set(tempId, data.acceptance.id);
        return data.acceptance;
      },
      {
        errorLabel: "Falha ao criar critério",
        // Keep tempId as the row's id in client state so the React key stays
        // stable (no remount/flicker). Server fields are merged in; URL ops
        // resolve through `acIdAliasRef`.
        reconcile: (prev, server) => {
          const merged: AcceptanceCriterionRow = { ...server, id: tempId };
          const exists = prev.some((r) => r.id === tempId);
          return exists
            ? prev.map((r) => (r.id === tempId ? merged : r))
            : [...prev, merged];
        },
      },
    );
  }

  async function handleAcUpdateText(
    taskRef: string,
    acId: string,
    text: string,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const realAcId = resolveAcId(acId);
    await acRowsCollection.mutate(
      {
        type: "patch",
        id: acId,
        patch: { text } as Partial<AcceptanceCriterionRow>,
      },
      async (signal) => {
        const res = await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance/${realAcId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal,
          },
        );
        return (await res.json()) as { acceptance: AcceptanceCriterionRow };
      },
      { errorLabel: "Falha ao salvar critério" },
    );
  }

  async function handleAcToggle(
    taskRef: string,
    acId: string,
    checked: boolean,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const realAcId = resolveAcId(acId);
    const now = new Date().toISOString();
    await acRowsCollection.mutate(
      {
        type: "patch",
        id: acId,
        patch: {
          checkedAt: checked ? now : null,
        } as Partial<AcceptanceCriterionRow>,
      },
      async (signal) => {
        const res = await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance/${realAcId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checked }),
            signal,
          },
        );
        return (await res.json()) as { acceptance: AcceptanceCriterionRow };
      },
      { errorLabel: "Falha ao marcar critério" },
    );
  }

  async function handleAcDelete(taskRef: string, acId: string) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    const realAcId = resolveAcId(acId);
    await acRowsCollection.mutate(
      { type: "delete", id: acId },
      async (signal) => {
        await fetchOrThrow(
          `/api/tasks/${taskId}/acceptance/${realAcId}`,
          { method: "DELETE", signal },
        );
        acIdAliasRef.current.delete(acId);
        return realAcId;
      },
      { errorLabel: "Falha ao remover critério" },
    );
  }

  async function loadTargetProjects() {
    const { data, error } = await supabase
      .from("Project")
      .select("id, name")
      .neq("id", id)
      .order("name");
    if (error) {
      console.error("[loadTargetProjects]", error);
      setTargetProjects([]);
      return;
    }
    setTargetProjects((data ?? []) as ProjectLite[]);
  }

  function openDuplicateDialog(taskRef: string) {
    setDuplicateTaskRef(taskRef);
  }

  async function openCloneDialog(taskRef: string) {
    await loadTargetProjects();
    setCloneTaskRef(taskRef);
  }

  async function handleCopyTaskRef(taskRef: string) {
    try {
      await navigator.clipboard.writeText(taskRef);
    } catch {
      // ignore
    }
  }

  async function handleConfirmDuplicate(input: {
    sprintId: string | null;
    status: AdaptedTask["status"];
  }) {
    if (!duplicateTaskRef) return;
    const taskId = findTaskIdByRef(duplicateTaskRef);
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao duplicar task");
      showErrorToast(new Error(msg), { label: "Duplicar task" });
      return;
    }
    const created = await res.json().catch(() => null);
    await loadTasksAndSprints();
    if (created?.reference) {
      setSelectedTaskRef(created.reference);
    }
  }

  async function handleConfirmClone(input: {
    targetProjectId: string;
    status: AdaptedTask["status"];
  }) {
    if (!cloneTaskRef) return;
    const taskId = findTaskIdByRef(cloneTaskRef);
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao clonar task");
      showErrorToast(new Error(msg), { label: "Clonar task" });
      return;
    }
    const data = await res.json().catch(() => null);
    const projectName = data?.targetProjectName ?? "outro projeto";
    const newRef = data?.task?.reference ?? "";
    toast.success(
      `Clonada para ${projectName}${newRef ? ` (${newRef})` : ""}.`,
    );
  }

  async function handleDeleteTask(taskRef: string) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    if (!confirm(`Deletar task ${taskRef}? Essa ação não pode ser desfeita.`)) {
      return;
    }
    if (selectedTaskRef === taskRef) setSelectedTaskRef(null);
    await taskMutate(
      { type: "delete", id: taskId },
      async (signal) => {
        const res = await fetchOrThrow(`/api/tasks/${taskId}`, {
          method: "DELETE",
          signal,
        });
        return (await res.json()) as { ok: true; id: string };
      },
      {
        errorLabel: "Falha ao deletar task",
        reconcile: (prev) => prev.filter((t) => t.id !== taskId),
      },
    );
  }

  function refsToIds(taskRefs: string[]): string[] {
    return taskRefs
      .map((ref) => findTaskIdByRef(ref))
      .filter((id): id is string => !!id);
  }

  async function handleBulkUpdate(
    taskRefs: string[],
    patch: {
      status?: AdaptedTask["status"];
      assigneeId?: string | null;
      sprintId?: string | null;
    },
  ) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;

    const localPatch: Partial<RawTask> = {};
    if (patch.status !== undefined) localPatch.status = patch.status;
    if (patch.sprintId !== undefined) localPatch.sprintId = patch.sprintId;
    if (patch.assigneeId !== undefined) {
      const m = patch.assigneeId
        ? rawMembers.find((mem) => mem.id === patch.assigneeId)
        : null;
      localPatch.assignments = m
        ? [{ memberId: m.id, member: { id: m.id, name: m.name } }]
        : [];
    }

    await taskMutate(
      { type: "bulkPatch", ids: taskIds, patch: localPatch },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds, action: "update", patch }),
          signal,
        });
        return (await res.json()) as { ids: string[] };
      },
      {
        errorLabel: "Falha ao atualizar em massa",
        reconcile: (prev) =>
          prev.map((t) =>
            taskIds.includes(t.id) ? { ...t, ...localPatch } : t,
          ),
      },
    );
  }

  async function handleBulkDelete(taskRefs: string[]) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    if (selectedTaskRef && taskRefs.includes(selectedTaskRef)) {
      setSelectedTaskRef(null);
    }
    await taskMutate(
      { type: "bulkDelete", ids: taskIds },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds, action: "delete" }),
          signal,
        });
        return (await res.json()) as { ids: string[] };
      },
      {
        errorLabel: "Falha ao deletar em massa",
        reconcile: (prev) => prev.filter((t) => !taskIds.includes(t.id)),
      },
    );
  }

  async function handleBulkDuplicate(taskRefs: string[]) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    // Reuse single-task duplicate endpoint in a sequential loop. Bulk duplicate
    // dedicated endpoint can come later if this gets slow at >50 tasks.
    let failures = 0;
    for (const taskId of taskIds) {
      const res = await fetch(`/api/tasks/${taskId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId: null }),
      });
      if (!res.ok) failures += 1;
    }
    if (failures > 0) {
      showErrorToast(
        new Error(
          `${failures} duplicação(ões) falharam de ${taskIds.length}.`,
        ),
        { label: "Bulk duplicate" },
      );
    }
    await loadTasksAndSprints();
  }

  async function handleBulkAddTag(taskRefs: string[], tagId: string) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    const tag = projectTags.find((t) => t.id === tagId);
    if (!tag) return;

    const optimisticTagEntry = {
      TaskTag: { id: tag.id, name: tag.name, tone: tag.tone ?? "" },
    };

    await taskMutate(
      { type: "bulkPatch", ids: taskIds, patch: {} as Partial<RawTask> },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskIds,
            action: "update",
            patch: { addTagIds: [tagId] },
          }),
          signal,
        });
        return (await res.json()) as {
          ids: string[];
          skippedDueToLimit?: string[];
        };
      },
      {
        errorLabel: "Falha ao adicionar tag",
        reconcile: (prev, server) => {
          const skipped = new Set(server.skippedDueToLimit ?? []);
          if (skipped.size > 0) {
            const n = skipped.size;
            showErrorToast(
              new Error(
                `${n} task${n > 1 ? "s" : ""} não recebe${n > 1 ? "ram" : "u"} a tag (limite de 10).`,
              ),
              { label: "Limite de tags" },
            );
          }
          return prev.map((t) => {
            if (!taskIds.includes(t.id) || skipped.has(t.id)) return t;
            const has = t.tags.some(
              (entry) => entry.TaskTag?.id === tagId,
            );
            if (has) return t;
            return { ...t, tags: [...t.tags, optimisticTagEntry] };
          });
        },
      },
    );
  }

  async function handleBulkRemoveTag(taskRefs: string[], tagId: string) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    await taskMutate(
      { type: "bulkPatch", ids: taskIds, patch: {} as Partial<RawTask> },
      async (signal) => {
        const res = await fetchOrThrow("/api/tasks/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskIds,
            action: "update",
            patch: { removeTagIds: [tagId] },
          }),
          signal,
        });
        return (await res.json()) as { ids: string[] };
      },
      {
        errorLabel: "Falha ao remover tag",
        reconcile: (prev) =>
          prev.map((t) =>
            taskIds.includes(t.id)
              ? {
                  ...t,
                  tags: t.tags.filter(
                    (entry) => entry.TaskTag?.id !== tagId,
                  ),
                }
              : t,
          ),
      },
    );
  }

  async function handleApproveProposedModule(story: AdaptedStory) {
    if (!story.proposedModuleName) return;
    try {
      await fetchOrThrow(`/api/stories/${story.reference}/approve-module`, {
        method: "POST",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao aprovar módulo" });
    }
  }

  async function handleValidateAc(story: AdaptedStory) {
    try {
      await fetchOrThrow(`/api/stories/${story.reference}/validate-ac`, {
        method: "POST",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao validar AC" });
    }
  }

  async function handleCreateModule(data: {
    name: string;
    description?: string;
  }) {
    try {
      await fetchOrThrow(`/api/projects/${id}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao criar módulo" });
    }
  }

  async function handleUpdateModule(
    modId: string,
    data: { name?: string; description?: string },
  ) {
    try {
      await fetchOrThrow(`/api/projects/${id}/modules/${modId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao editar módulo" });
    }
  }

  async function handleDeleteModule(modId: string) {
    if (!confirm("Deletar módulo?")) return;
    try {
      await fetchOrThrow(`/api/projects/${id}/modules/${modId}`, {
        method: "DELETE",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao deletar módulo" });
    }
  }

  async function handleCreatePersona(data: {
    name: string;
    description?: string;
  }) {
    try {
      await fetchOrThrow(`/api/projects/${id}/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao criar persona" });
    }
  }

  async function handleUpdatePersona(
    perId: string,
    data: { name?: string; description?: string },
  ) {
    try {
      await fetchOrThrow(`/api/projects/${id}/personas/${perId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao editar persona" });
    }
  }

  async function handleDeletePersona(perId: string) {
    if (!confirm("Deletar persona?")) return;
    try {
      await fetchOrThrow(`/api/projects/${id}/personas/${perId}`, {
        method: "DELETE",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao deletar persona" });
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!project) {
    return <div className="p-6 text-muted-foreground">Carregando…</div>;
  }

  const activeSprint = sprints.find((s) => s.status === "active");
  const focused = sprints.find((s) => s.id === focusSprintId) ?? activeSprint ?? sprints[0];

  // Estamos numa view sintética dentro da aba Sprints?
  const isSyntheticView = sprintView === "backlog" || sprintView === "all";
  const backlogCount = backlogTasks.length;
  const allCount = tasks.length;

  return (
    <div className="space-y-6">
      <PageTitle
        title={project.name}
        subtitle={`${project.client?.name ?? "—"} · ${project.status}`}
      />

      {/* Hero */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Link href="/projects">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold">{project.name}</h1>
              <StatusChip
                tone={project.status === "active" ? "green" : "muted"}
                dot
              >
                {project.status}
              </StatusChip>
            </div>
            <p className="text-sm text-muted-foreground">
              {project.client?.name ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="size-4" />
            <span className="hidden sm:inline">Editar projeto</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAccessOpen(true)}
          >
            <Shield className="size-4" />
            <span className="hidden sm:inline">Access</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {project.referenceKey ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {project.referenceKey}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-amber-500/40 font-mono text-[10px] text-amber-700 dark:text-amber-400"
          >
            sem referenceKey
          </Badge>
        )}
        {project.pm ? (
          <span className="text-xs text-muted-foreground">
            PM:{" "}
            <span className="font-medium text-foreground">
              {project.pm.name}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">PM: —</span>
        )}
        {rawMembers.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            ·{" "}
            <span className="font-mono tabular-nums text-foreground">
              {rawMembers.length}
            </span>{" "}
            membro{rawMembers.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {/* Sprint Ribbon — sticky, vale pra todas as tabs */}
      {focused ? (
        <SprintRibbon
          sprint={focused}
          sprints={sprints}
          activeSprintId={activeSprintId}
          tasks={tasks}
          members={members}
          capacities={capacities}
          onJumpToActive={() => activeSprintId && setSprintView(activeSprintId)}
          onSelectSprint={(sid) => {
            setSprintView(sid);
            setActiveTab("sprints");
          }}
          className="-mx-3 md:-mx-6"
        />
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="size-4" />
            {tab.label}
            {tab.key === "stories" ? (
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {stories.length}
              </Badge>
            ) : null}
            {tab.key === "sprints" ? (
              <Badge variant="secondary" className="ml-1 h-5 text-xs">
                {tasks.length}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "stories" ? (
        <StoriesList
          stories={stories}
          tasks={tasks}
          modules={modules}
          onOpenStory={(ref) => {
            setSelectedStoryRef(ref);
            setEditingStory(false);
          }}
          onCreateStory={() => setStoryCreateOpen(true)}
        />
      ) : activeTab === "sprints" ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sprints
            </h3>

            {focused && !isSyntheticView ? (
              <button
                type="button"
                onClick={() =>
                  setSprintContextSheet({
                    sprintId: focused.id,
                    mode: focused.status === "completed" ? "view" : "edit-goal",
                  })
                }
                title={focused.goal ?? "Definir objetivo do sprint"}
                className={`hidden lg:flex flex-1 min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/40 ${
                  focused.goal ? "text-foreground" : "text-muted-foreground italic"
                }`}
              >
                <Target className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {focused.goal ?? "Definir objetivo do sprint…"}
                </span>
              </button>
            ) : (
              <div className="hidden lg:block flex-1" />
            )}

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() =>
                  handleCreateTask(
                    focused && !isSyntheticView
                      ? { sprintId: focused.id }
                      : undefined,
                  )
                }
              >
                <Plus className="size-3.5" />
                Nova task
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => setSprintDialogOpen(true)}
              >
                <Plus className="size-3.5" />
                Novo sprint
              </Button>

              {focused && !isSyntheticView ? (
                <>
                  <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border/70" />

                  {focused.status === "upcoming" ? (
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => requestActivateSprint(focused.id)}
                    >
                      <Play className="size-3.5" />
                      Ativar sprint
                    </Button>
                  ) : focused.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => requestCompleteSprint(focused.id)}
                    >
                      <CheckCircle2 className="size-3.5" />
                      Concluir
                    </Button>
                  ) : null}

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label="Mais ações da sprint"
                          className="shrink-0 px-2"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          setSprintContextSheet({
                            sprintId: focused.id,
                            mode:
                              focused.status === "completed" ? "view" : "edit-goal",
                          })
                        }
                      >
                        <Target className="size-3.5" />
                        {focused.status === "completed"
                          ? "Ver retrospectiva"
                          : focused.goal
                          ? "Editar objetivo"
                          : "Definir objetivo"}
                      </DropdownMenuItem>
                      {focused.status === "completed" ? (
                        <DropdownMenuItem
                          onClick={() => requestReopenSprint(focused.id)}
                        >
                          <RotateCcw className="size-3.5" />
                          Reabrir sprint
                        </DropdownMenuItem>
                      ) : null}
                      {focused.status === "active" ? (
                        <DropdownMenuItem
                          onClick={() => requestCompleteSprint(focused.id)}
                        >
                          <CheckCircle2 className="size-3.5" />
                          Concluir sprint
                        </DropdownMenuItem>
                      ) : null}
                      {focused.status === "upcoming" ? (
                        <DropdownMenuItem
                          onClick={() => requestActivateSprint(focused.id)}
                        >
                          <Play className="size-3.5" />
                          Ativar sprint
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
            </div>
          </div>

          {sprints.length === 0 && !isSyntheticView ? (
            <Card>
              <CardHeader>
                <CardTitle>Nenhum sprint cadastrado</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Crie o primeiro sprint pra começar a planejar — ou navegue pro
                Backlog/Todas pra ver tasks soltas.
              </CardContent>
            </Card>
          ) : (
            <>
              <SprintNavigator
                sprints={sprints}
                currentId={
                  isSyntheticView
                    ? sprintView!
                    : focused?.id ?? "all"
                }
                activeId={activeSprintId}
                tasks={tasks}
                onChange={(v) => setSprintView(v)}
                onJumpToActive={() =>
                  activeSprintId && setSprintView(activeSprintId)
                }
                showSyntheticViews
                backlogCount={backlogCount}
                allCount={allCount}
              />

              {isSyntheticView ? (
                <section className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {sprintView === "backlog" ? "Backlog" : "Todas as tasks"}
                  </h3>
                  <TasksList
                    tasks={sprintView === "backlog" ? backlogTasks : tasks}
                    stories={stories}
                    modules={modules}
                    members={members}
                    sprints={sprints}
                    availableTags={projectTags}
                    onOpenTask={(ref) => setSelectedTaskRef(ref)}
                    onChangeStatus={handleInlineStatusChange}
                    onChangeAssignee={handleInlineAssigneeChange}
                    onChangeSprint={handleInlineSprintChange}
                    onDuplicate={openDuplicateDialog}
                    onClone={openCloneDialog}
                    onCopyRef={handleCopyTaskRef}
                    onDelete={handleDeleteTask}
                    onBulkUpdate={handleBulkUpdate}
                    onBulkDelete={handleBulkDelete}
                    onBulkDuplicate={handleBulkDuplicate}
                    onBulkAddTag={handleBulkAddTag}
                    onBulkRemoveTag={handleBulkRemoveTag}
                  />
                </section>
              ) : focused ? (
                <SprintDetail
                  sprint={focused}
                  tasks={tasks}
                  stories={stories}
                  modules={modules}
                  members={members}
                  onOpenTask={(ref) => setSelectedTaskRef(ref)}
                  allSprints={sprints}
                  onChangeTaskStatus={handleInlineStatusChange}
                  onChangeTaskAssignee={handleInlineAssigneeChange}
                  onChangeTaskSprint={handleInlineSprintChange}
                  onDuplicateTask={openDuplicateDialog}
                  onCloneTask={openCloneDialog}
                  onCopyTaskRef={handleCopyTaskRef}
                  onDeleteTask={handleDeleteTask}
                  onBulkUpdate={handleBulkUpdate}
                  onBulkDelete={handleBulkDelete}
                  onBulkDuplicate={handleBulkDuplicate}
                  onBulkAddTag={handleBulkAddTag}
                  onBulkRemoveTag={handleBulkRemoveTag}
                  availableTags={projectTags}
                />
              ) : null}
            </>
          )}
        </div>
      ) : activeTab === "sessions" ? (
        <ProjectSessionsTab
          projectId={id}
          projectName={project.name}
        />
      ) : activeTab === "wiki" ? (
        <ProjectWiki projectId={id} />
      ) : activeTab === "settings" ? (
        <SettingsTab
          project={project}
          modules={modules}
          personas={personas}
          moduleUsage={moduleUsage}
          personaUsage={personaUsage}
          onCreateModule={handleCreateModule}
          onUpdateModule={handleUpdateModule}
          onDeleteModule={handleDeleteModule}
          onCreatePersona={handleCreatePersona}
          onUpdatePersona={handleUpdatePersona}
          onDeletePersona={handleDeletePersona}
          onUpdateProject={loadProject}
        />
      ) : null}

      {/* Story sheet — view, edit, AND create modes share the same panel. */}
      <StorySheet
        story={selectedStory}
        tasks={tasks}
        modules={modules}
        personas={personas}
        definitionOfDone={project.definitionOfDone}
        editing={editingStory}
        creating={storyCreateOpen}
        onClose={() => {
          setSelectedStoryRef(null);
          setEditingStory(false);
          setStoryCreateOpen(false);
        }}
        onEdit={() => setEditingStory(true)}
        onCancelEdit={() => setEditingStory(false)}
        onSave={(updated) => {
          handleSaveStory(updated as AdaptedStory);
          setEditingStory(false);
        }}
        onCreate={handleCreateStory}
        onCreateModuleRequested={(suggested) =>
          setModuleDialog({ open: true, suggested })
        }
        onCreatePersonaRequested={() => setPersonaDialog({ open: true })}
        onApproveProposedModule={(s) =>
          handleApproveProposedModule(s as AdaptedStory)
        }
        onValidateAc={(s) => handleValidateAc(s as AdaptedStory)}
        onOpenTask={(ref) => {
          setSelectedStoryRef(null);
          setEditingStory(false);
          setSelectedTaskRef(ref);
        }}
      />

      {/* Task sheet — inline edit + create share the same panel. */}
      <TaskSheet
        task={selectedTask}
        stories={stories}
        modules={modules}
        members={members}
        sprints={sprints}
        definitionOfDone={project.definitionOfDone}
        onClose={() => setSelectedTaskRef(null)}
        onSave={(updated) => handleSaveTask(updated as AdaptedTask)}
        onChangeSprint={handleInlineSprintChange}
        onChangeAssignees={handleInlineAssigneesChange}
        availableTags={projectTags}
        onCreateTag={handleCreateTag}
        onChangeTags={handleChangeTaskTags}
        onAcCreate={handleAcCreate}
        onAcUpdateText={handleAcUpdateText}
        onAcToggle={handleAcToggle}
        onAcDelete={handleAcDelete}
        onOpenStory={(ref) => {
          setSelectedTaskRef(null);
          setSelectedStoryRef(ref);
          setEditingStory(false);
        }}
        onOpenTaskByRef={(ref) => {
          setSelectedTaskRef(null);
          setTimeout(() => setSelectedTaskRef(ref), 0);
        }}
      />

      {/* Inline taxonomy dialogs (invoked from story-sheet edit form) */}
      <ModuleDialog
        open={moduleDialog.open}
        onOpenChange={(open) =>
          setModuleDialog((s) => ({
            ...s,
            open,
            suggested: open ? s.suggested : undefined,
          }))
        }
        suggestedName={moduleDialog.suggested}
        onSubmit={async (data) => {
          await handleCreateModule(data);
        }}
      />
      <PersonaDialog
        open={personaDialog.open}
        onOpenChange={(open) => setPersonaDialog({ open })}
        onSubmit={async (data) => {
          await handleCreatePersona(data);
        }}
      />

      {/* Access sheet (legacy) */}
      <ProjectAccessSheet
        open={accessOpen}
        onOpenChange={setAccessOpen}
        projectId={id}
      />

      {/* Sprint create dialog */}
      <SprintDialog
        open={sprintDialogOpen}
        onOpenChange={setSprintDialogOpen}
        editing={null}
        existingSprints={rawSprints.map((s) => ({ startDate: s.startDate, endDate: s.endDate }))}
        onSave={handleCreateSprint}
      />

      {/* Sprint activate / complete / reopen confirmation */}
      {sprintAction ? (() => {
        const target = sprints.find((s) => s.id === sprintAction.targetId);
        if (!target) return null;
        const isReplacing =
          sprintAction.mode === "activate-replacing" ||
          sprintAction.mode === "reopen-replacing";
        const previousActive = isReplacing
          ? sprints.find((s) => s.status === "active") ?? null
          : null;
        const previousActiveTaskStats = previousActive
          ? {
              total: tasks.filter((t) => t.sprintId === previousActive.id).length,
              done: tasks.filter(
                (t) => t.sprintId === previousActive.id && t.status === "done",
              ).length,
            }
          : undefined;
        return (
          <SprintActionDialog
            open
            onOpenChange={(open) => !open && setSprintAction(null)}
            mode={sprintAction.mode}
            target={target}
            previousActive={previousActive}
            previousActiveTaskStats={previousActiveTaskStats}
            onConfirm={async () => {
              if (
                sprintAction.mode === "reopen-replacing" ||
                sprintAction.mode === "reopen-fresh"
              ) {
                await handleReopenSprint(sprintAction.targetId);
              } else {
                await handleActivateSprint(sprintAction.targetId);
              }
            }}
          />
        );
      })() : null}

      {/* Sprint context sheet (goal + retro) */}
      <SprintContextSheet
        open={sprintContextSheet !== null}
        onOpenChange={(open) => !open && setSprintContextSheet(null)}
        sprint={
          sprintContextSheet
            ? sprints.find((s) => s.id === sprintContextSheet.sprintId) ?? null
            : null
        }
        mode={sprintContextSheet?.mode ?? "view"}
        onSaved={() => loadTasksAndSprints()}
      />

      {/* Task duplicate / clone dialogs */}
      <TaskDuplicateDialog
        open={duplicateTaskRef !== null}
        onOpenChange={(open) => !open && setDuplicateTaskRef(null)}
        taskRef={duplicateTaskRef}
        sprints={sprints.map((s) => ({ id: s.id, name: s.name }))}
        defaultSprintId={
          duplicateTaskRef
            ? tasks.find((t) => t.reference === duplicateTaskRef)?.sprintId ??
              null
            : null
        }
        onSubmit={handleConfirmDuplicate}
      />

      <TaskCloneDialog
        open={cloneTaskRef !== null}
        onOpenChange={(open) => !open && setCloneTaskRef(null)}
        taskRef={cloneTaskRef}
        targetProjects={targetProjects}
        onSubmit={handleConfirmClone}
      />

      {/* Edit project sheet (PM, members, repo, dates, status) */}
      <ProjectEditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        project={
          project
            ? {
                id: project.id,
                name: project.name,
                repoUrl: project.repoUrl,
                startDate: project.startDate,
                endDate: project.endDate,
                status: project.status,
                clientId: project.clientId,
                pmId: project.pmId,
                githubRepoOwner: project.githubRepoOwner,
                githubRepoName: project.githubRepoName,
                githubDefaultBranch: project.githubDefaultBranch,
                memberIds: rawMembers.map((m) => m.id),
              }
            : null
        }
        onSaved={async () => {
          await Promise.all([loadProject(), loadMembers()]);
        }}
      />
    </div>
  );
}

// ─── Settings Tab ───────────────────────────────────────────────────────────

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";

function SettingsTab({
  project,
  modules,
  personas,
  moduleUsage,
  personaUsage,
  onCreateModule,
  onUpdateModule,
  onDeleteModule,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
  onUpdateProject,
}: {
  project: ProjectMeta;
  modules: ReturnType<typeof adaptModule>[];
  personas: ReturnType<typeof adaptPersona>[];
  moduleUsage: Record<string, number>;
  personaUsage: Record<string, number>;
  onCreateModule: (data: { name: string; description?: string }) => Promise<void>;
  onUpdateModule: (
    id: string,
    data: { name?: string; description?: string },
  ) => Promise<void>;
  onDeleteModule: (id: string) => Promise<void>;
  onCreatePersona: (data: { name: string; description?: string }) => Promise<void>;
  onUpdatePersona: (
    id: string,
    data: { name?: string; description?: string },
  ) => Promise<void>;
  onDeletePersona: (id: string) => Promise<void>;
  onUpdateProject: () => Promise<void>;
}) {
  const [refKey, setRefKey] = useState(project.referenceKey ?? "");
  const [savingRef, setSavingRef] = useState(false);
  const [dod, setDod] = useState<string[]>(project.definitionOfDone);
  const [dodNew, setDodNew] = useState("");
  const [savingDod, setSavingDod] = useState(false);

  useEffect(() => {
    setRefKey(project.referenceKey ?? "");
    setDod(project.definitionOfDone);
  }, [project]);

  async function saveRef() {
    setSavingRef(true);
    try {
      const supabase = createClient();
      const normalized = refKey.trim().toUpperCase();
      const { error } = await supabase
        .from("Project")
        .update({ referenceKey: normalized })
        .eq("id", project.id);
      if (error) {
        showErrorToast(new Error(error.message), {
          label: "Falha ao salvar reference",
        });
        return;
      }
      await onUpdateProject();
    } finally {
      setSavingRef(false);
    }
  }

  async function saveDod(items: string[]) {
    setSavingDod(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/dod`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        showErrorToast(new Error("Falha ao salvar DoD"), {
          label: "DoD",
        });
        return;
      }
      await onUpdateProject();
    } finally {
      setSavingDod(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* referenceKey */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reference key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Prefixo único pro código de stories deste projeto (CRM-US-001).
            2-5 letras maiúsculas.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={refKey}
              onChange={(e) =>
                setRefKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
              }
              maxLength={5}
              className="w-32 font-mono"
              placeholder="CRM"
            />
            <Button
              onClick={saveRef}
              disabled={
                savingRef ||
                !/^[A-Z]{2,5}$/.test(refKey) ||
                refKey === project.referenceKey
              }
            >
              {savingRef ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* DoD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definition of Done</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Critérios globais aplicados a todas as stories deste projeto.
          </p>
          <ul className="space-y-1.5">
            {dod.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="flex-1">{item}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={async () => {
                    const next = dod.filter((_, j) => j !== i);
                    setDod(next);
                    await saveDod(next);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={dodNew}
              onChange={(e) => setDodNew(e.target.value)}
              placeholder="ex: PR review aprovado"
              className="flex-1"
            />
            <Button
              onClick={async () => {
                if (!dodNew.trim()) return;
                const next = [...dod, dodNew.trim()];
                setDod(next);
                setDodNew("");
                await saveDod(next);
              }}
              disabled={savingDod || !dodNew.trim()}
            >
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <SettingsPanel
        modules={modules}
        personas={personas}
        moduleUsage={moduleUsage}
        personaUsage={personaUsage}
        onCreateModule={(data) => {
          onCreateModule(data);
        }}
        onUpdateModule={(id, data) => {
          onUpdateModule(id, data);
        }}
        onDeleteModule={(id) => {
          onDeleteModule(id);
        }}
        onCreatePersona={(data) => {
          onCreatePersona(data);
        }}
        onUpdatePersona={(id, data) => {
          onUpdatePersona(id, data);
        }}
        onDeletePersona={(id) => {
          onDeletePersona(id);
        }}
      />
    </div>
  );
}
