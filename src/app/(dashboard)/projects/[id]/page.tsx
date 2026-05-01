"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Lightbulb,
  ListTodo,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/app-shell";
import { ProjectAccessSheet } from "@/components/project-access-sheet";
import { ProjectEditSheet } from "@/components/project-edit-sheet";
import { ProjectSessionsTab } from "@/components/project-sessions-tab";
import { ProjectWiki } from "@/components/project-wiki";
import {
  SprintDialog,
  type SprintFormData,
} from "@/components/sprint-dialog";
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
  type TaskCreateInput,
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
  SprintRibbon,
  type Sprint as SprintView,
  type SprintMemberCapacity,
} from "@/components/sprint";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  PersonaRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";

// ─── Types ──────────────────────────────────────────────────────────────────

type TabKey =
  | "stories"
  | "tasks"
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
  { key: "tasks", label: "Tasks", icon: ListTodo },
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
  const tabParam = searchParams.get("tab") as TabKey | null;
  const sprintParam = searchParams.get("sprint");

  const [activeTab, setActiveTab] = useState<TabKey>(tabParam ?? "stories");
  const [project, setProject] = useState<ProjectMeta | null>(null);

  const [rawModules, setRawModules] = useState<ModuleRow[]>([]);
  const [rawPersonas, setRawPersonas] = useState<PersonaRow[]>([]);
  const [rawStories, setRawStories] = useState<StoryWithRelations[]>([]);
  const [rawTasks, setRawTasks] = useState<RawTask[]>([]);
  const [projectTags, setProjectTags] = useState<TaskTag[]>([]);
  const [taskAcRows, setTaskAcRows] = useState<AcceptanceCriterionRow[]>([]);
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
  const [selectedStoryRef, setSelectedStoryRef] = useState<string | null>(null);
  const [editingStory, setEditingStory] = useState(false);
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(null);

  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    suggested?: string;
  }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({
    open: false,
  });
  const [storyCreateOpen, setStoryCreateOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [duplicateTaskRef, setDuplicateTaskRef] = useState<string | null>(null);
  const [cloneTaskRef, setCloneTaskRef] = useState<string | null>(null);
  const [targetProjects, setTargetProjects] = useState<ProjectLite[]>([]);

  const [focusSprintId, setFocusSprintId] = useState<string | null>(sprintParam);

  // Sync activeTab + focusSprintId → URL search params (?tab=...&sprint=...).
  // Allows deep-link from /profile, weekly-allocation widget, etc.
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "stories") params.set("tab", activeTab);
    if (activeTab === "sprints" && focusSprintId) params.set("sprint", focusSprintId);
    const qs = params.toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    if (next !== window.location.pathname + window.location.search) {
      router.replace(next, { scroll: false });
    }
  }, [activeTab, focusSprintId, pathname, router]);

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
    const [modulesRes, personasRes, storiesRes, taskAcRes] = await Promise.all([
      supabase
        .from("Module")
        .select("*")
        .eq("projectId", id)
        .order("name"),
      supabase
        .from("ProjectPersona")
        .select("*")
        .eq("projectId", id)
        .order("name"),
      supabase
        .from("UserStory")
        .select(
          "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module(id, name, description), persona:ProjectPersona(id, name, description)",
        )
        .eq("projectId", id)
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
  const tasks: AdaptedTask[] = useMemo(() => {
    const ctx = buildTaskAdapterContext(stories, taskAcRows);
    return rawTasks.map((t) => adaptTask(t, ctx));
  }, [rawTasks, stories, taskAcRows]);

  const members = useMemo(() => rawMembers.map(adaptMember), [rawMembers]);

  const sprints: SprintView[] = useMemo(
    () =>
      rawSprints.map((s) => ({
        id: s.id,
        name: s.name,
        startDate: s.startDate.slice(0, 10),
        endDate: s.endDate.slice(0, 10),
        status: s.status as "planning" | "active" | "completed",
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

  useEffect(() => {
    if (focusSprintId === null && activeSprintId !== null) {
      setFocusSprintId(activeSprintId);
    }
  }, [activeSprintId, focusSprintId]);

  const selectedStory =
    stories.find((s) => s.reference === selectedStoryRef) ?? null;
  const selectedTask =
    tasks.find((t) => t.reference === selectedTaskRef) ?? null;

  // ─── Mutators ──────────────────────────────────────────────────────────────

  async function handleCreateSprint(form: SprintFormData) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("Sprint").insert({
      id: crypto.randomUUID(),
      projectId: id,
      name: form.name,
      startDate: form.startDate,
      endDate: form.endDate,
      status: form.status,
      updatedAt: now,
    });
    if (error) {
      if (error.code === "23505") {
        alert(
          error.message.includes("sprint_unique_week_per_project")
            ? "Já existe um sprint nessa semana neste projeto."
            : "Já existe um sprint com esse nome neste projeto.",
        );
      } else {
        alert(`Falha ao criar sprint: ${error.message}`);
      }
      return;
    }
    setSprintDialogOpen(false);
    await loadTasksAndSprints();
  }

  async function handleCreateStory(input: StoryCreateInput) {
    if (!project?.referenceKey) {
      alert(
        "Project precisa de referenceKey antes de criar stories. Configure em Settings.",
      );
      return;
    }
    const res = await fetch(`/api/projects/${id}/stories`, {
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
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Falha ao criar story: ${JSON.stringify(err)}`);
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleCreateTask(input: TaskCreateInput) {
    const now = new Date().toISOString();
    const { data: refData, error: refErr } = await supabase.rpc(
      "next_task_reference",
    );
    if (refErr) {
      alert(`Falha ao gerar reference: ${refErr.message}`);
      return;
    }
    const newTaskId = crypto.randomUUID();
    const { error } = await supabase.from("Task").insert({
      id: newTaskId,
      projectId: id,
      reference: (refData as unknown as string) ?? null,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      scope: input.scope,
      complexity: input.complexity,
      status: input.status,
      userStoryId: input.userStoryId,
      functionPoints: input.functionPoints,
      billable: true,
      updatedAt: now,
    });
    if (error) {
      alert(`Falha ao criar task: ${error.message}`);
      return;
    }
    if (input.tagIds.length > 0) {
      await supabase
        .from("TaskTagAssignment")
        .insert(input.tagIds.map((tagId) => ({ taskId: newTaskId, tagId })));
    }
    await loadTasksAndSprints();
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
      alert("Falha ao atualizar tags");
      return;
    }
    await loadTasksAndSprints();
  }

  async function handleSaveStory(updated: AdaptedStory) {
    const dbStory = rawStories.find((s) => s.reference === updated.reference);
    if (!dbStory) return;
    const res = await fetch(`/api/stories/${updated.reference}`, {
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
    if (!res.ok) {
      alert("Falha ao salvar story");
      return;
    }
    await loadStoryHierarchy();
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

    // Optimistic: update local state immediately so the chip flips with no
    // perceived delay. Revert on failure.
    const snapshot = rawTasks;
    setRawTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, status } : t)),
    );

    const { error } = await supabase
      .from("Task")
      .update({ status, updatedAt: new Date().toISOString() })
      .eq("id", taskId);
    if (error) {
      setRawTasks(snapshot);
      alert(`Falha ao atualizar status: ${error.message}`);
      return;
    }
    // Reload in background to pick up server-derived fields (e.g. doneAt)
    // without blocking the UI.
    void loadTasksAndSprints();
  }

  async function handleInlineSprintChange(
    taskRef: string,
    sprintId: string | null,
  ) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;

    const snapshot = rawTasks;
    setRawTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, sprintId } : t)),
    );

    const { error } = await supabase
      .from("Task")
      .update({ sprintId, updatedAt: new Date().toISOString() })
      .eq("id", taskId);
    if (error) {
      setRawTasks(snapshot);
      alert(`Falha ao atualizar sprint: ${error.message}`);
      return;
    }
    void loadTasksAndSprints();
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

    // Optimistic: rebuild assignments locally with the requested members so
    // the avatar/name flips instantly.
    const snapshot = rawTasks;
    const memberLookup = new Map(rawMembers.map((m) => [m.id, m]));
    const optimisticAssignments = memberIds
      .map((memberId) => {
        const m = memberLookup.get(memberId);
        return m
          ? { memberId, member: { id: m.id, name: m.name } }
          : null;
      })
      .filter((a): a is { memberId: string; member: { id: string; name: string } } => a !== null);
    setRawTasks((cur) =>
      cur.map((t) =>
        t.id === taskId ? { ...t, assignments: optimisticAssignments } : t,
      ),
    );

    const { error: delErr } = await supabase
      .from("TaskAssignment")
      .delete()
      .eq("taskId", taskId);
    if (delErr) {
      setRawTasks(snapshot);
      alert(`Falha ao limpar assignment: ${delErr.message}`);
      return;
    }

    if (memberIds.length > 0) {
      const { error: insErr } = await supabase.from("TaskAssignment").insert(
        memberIds.map((memberId) => ({
          id: crypto.randomUUID(),
          taskId,
          memberId,
        })),
      );
      if (insErr) {
        setRawTasks(snapshot);
        alert(`Falha ao atribuir: ${insErr.message}`);
        return;
      }
    }
    void loadTasksAndSprints();
  }

  async function handleSaveTask(updated: AdaptedTask) {
    const before = tasks.find((t) => t.__id === updated.__id);
    const userStoryId =
      updated.userStoryRef === null
        ? null
        : stories.find((s) => s.reference === updated.userStoryRef)?.__id ??
          null;

    const { error } = await supabase
      .from("Task")
      .update({
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
        updatedAt: new Date().toISOString(),
      })
      .eq("id", updated.__id);
    if (error) {
      alert(`Falha ao salvar task: ${error.message}`);
      return;
    }

    // ─── AC diff ────────────────────────────────────────────────────────────
    if (before) {
      const beforeMap = new Map(
        before.acceptanceCriteria.map((ac) => [ac.id, ac]),
      );
      const afterMap = new Map(
        updated.acceptanceCriteria.map((ac) => [ac.id, ac]),
      );

      // Deletions
      for (const id of beforeMap.keys()) {
        if (!afterMap.has(id)) {
          await fetch(`/api/tasks/${updated.__id}/acceptance/${id}`, {
            method: "DELETE",
          });
        }
      }

      // Inserts + updates
      for (const [id, after] of afterMap) {
        if (id.startsWith("ac-new-")) {
          await fetch(`/api/tasks/${updated.__id}/acceptance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: after.text }),
          });
          continue;
        }
        const prev = beforeMap.get(id);
        if (!prev) continue;
        const textChanged = prev.text !== after.text;
        const checkedChanged = prev.checked !== after.checked;
        if (textChanged || checkedChanged) {
          await fetch(`/api/tasks/${updated.__id}/acceptance/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(textChanged ? { text: after.text } : {}),
              ...(checkedChanged ? { checked: after.checked } : {}),
            }),
          });
        }
      }
      await loadStoryHierarchy();
    }

    await loadTasksAndSprints();
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
      alert(msg);
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
      alert(msg);
      return;
    }
    const data = await res.json().catch(() => null);
    const projectName = data?.targetProjectName ?? "outro projeto";
    const newRef = data?.task?.reference ?? "";
    alert(`Clonada para ${projectName}${newRef ? ` (${newRef})` : ""}.`);
  }

  async function handleDeleteTask(taskRef: string) {
    const taskId = findTaskIdByRef(taskRef);
    if (!taskId) return;
    if (!confirm(`Deletar task ${taskRef}? Essa ação não pode ser desfeita.`)) {
      return;
    }
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao deletar task");
      alert(msg);
      return;
    }
    if (selectedTaskRef === taskRef) setSelectedTaskRef(null);
    await loadTasksAndSprints();
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
    const res = await fetch("/api/tasks/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds, action: "update", patch }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao atualizar em massa");
      alert(msg);
      return;
    }
    await loadTasksAndSprints();
  }

  async function handleBulkDelete(taskRefs: string[]) {
    const taskIds = refsToIds(taskRefs);
    if (taskIds.length === 0) return;
    const res = await fetch("/api/tasks/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds, action: "delete" }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "Falha ao deletar em massa");
      alert(msg);
      return;
    }
    if (selectedTaskRef && taskRefs.includes(selectedTaskRef)) {
      setSelectedTaskRef(null);
    }
    await loadTasksAndSprints();
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
      alert(`${failures} duplicação(ões) falharam de ${taskIds.length}.`);
    }
    await loadTasksAndSprints();
  }

  async function handleApproveProposedModule(story: AdaptedStory) {
    if (!story.proposedModuleName) return;
    const res = await fetch(
      `/api/stories/${story.reference}/approve-module`,
      { method: "POST" },
    );
    if (!res.ok) {
      alert("Falha ao aprovar módulo");
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleValidateAc(story: AdaptedStory) {
    const res = await fetch(
      `/api/stories/${story.reference}/validate-ac`,
      { method: "POST" },
    );
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(`Falha ao validar AC: ${JSON.stringify(e)}`);
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleCreateModule(data: {
    name: string;
    description?: string;
  }) {
    const res = await fetch(`/api/projects/${id}/modules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      alert("Falha ao criar módulo");
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleUpdateModule(
    modId: string,
    data: { name?: string; description?: string },
  ) {
    const res = await fetch(`/api/projects/${id}/modules/${modId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      alert("Falha ao editar módulo");
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleDeleteModule(modId: string) {
    if (!confirm("Deletar módulo?")) return;
    const res = await fetch(`/api/projects/${id}/modules/${modId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      alert("Falha ao deletar módulo");
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleCreatePersona(data: {
    name: string;
    description?: string;
  }) {
    const res = await fetch(`/api/projects/${id}/personas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      alert("Falha ao criar persona");
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleUpdatePersona(
    perId: string,
    data: { name?: string; description?: string },
  ) {
    const res = await fetch(`/api/projects/${id}/personas/${perId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      alert("Falha ao editar persona");
      return;
    }
    await loadStoryHierarchy();
  }

  async function handleDeletePersona(perId: string) {
    if (!confirm("Deletar persona?")) return;
    const res = await fetch(`/api/projects/${id}/personas/${perId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      alert("Falha ao deletar persona");
      return;
    }
    await loadStoryHierarchy();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!project) {
    return <div className="p-6 text-muted-foreground">Carregando…</div>;
  }

  const activeSprint = sprints.find((s) => s.status === "active");
  const focused = sprints.find((s) => s.id === focusSprintId) ?? activeSprint ?? sprints[0];

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
          onJumpToActive={() => setFocusSprintId(activeSprintId)}
          onSelectSprint={(sid) => {
            setFocusSprintId(sid);
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
            {tab.key === "tasks" ? (
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
      ) : activeTab === "tasks" ? (
        <TasksList
          tasks={tasks}
          stories={stories}
          modules={modules}
          members={members}
          sprints={sprints}
          availableTags={projectTags}
          onOpenTask={(ref) => setSelectedTaskRef(ref)}
          onCreateTask={() => setTaskCreateOpen(true)}
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
        />
      ) : activeTab === "sprints" ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sprints
            </h3>
            <Button size="sm" onClick={() => setSprintDialogOpen(true)}>
              <Plus className="size-3.5" />
              Novo sprint
            </Button>
          </div>

          {focused ? (
            <>
              <SprintNavigator
                sprints={sprints}
                currentId={focused.id}
                activeId={activeSprintId}
                tasks={tasks}
                onChange={setFocusSprintId}
                onJumpToActive={() => setFocusSprintId(activeSprintId)}
              />
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
              />
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Nenhum sprint cadastrado</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Crie o primeiro sprint pra começar a planejar.
              </CardContent>
            </Card>
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
        creating={taskCreateOpen}
        defaultStoryId={
          selectedStoryRef
            ? stories.find((s) => s.reference === selectedStoryRef)?.__id ?? null
            : null
        }
        onClose={() => {
          setSelectedTaskRef(null);
          setTaskCreateOpen(false);
        }}
        onSave={(updated) => handleSaveTask(updated as AdaptedTask)}
        onCreate={handleCreateTask}
        onChangeSprint={handleInlineSprintChange}
        onChangeAssignees={handleInlineAssigneesChange}
        availableTags={projectTags}
        onCreateTag={handleCreateTag}
        onChangeTags={handleChangeTaskTags}
        onOpenStory={(ref) => {
          setSelectedTaskRef(null);
          setSelectedStoryRef(ref);
          setEditingStory(false);
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
        existingSprints={rawSprints.map((s) => ({ endDate: s.endDate }))}
        onSave={handleCreateSprint}
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
        alert(`Falha: ${error.message}`);
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
        alert("Falha ao salvar DoD");
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
