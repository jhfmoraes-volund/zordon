"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Lightbulb,
  Pencil,
  Settings as SettingsIcon,
  Shield,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
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
import { SuggestSprintsSheet } from "@/components/sprint/suggest-sprints-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { createClient } from "@/lib/supabase/client";
import {
  ModuleDialog,
  PersonaDialog,
  StoriesList,
  StorySheet,
  TaskSheet,
  TaskDuplicateDialog,
  TaskCloneDialog,
  type ProjectLite,
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
  SprintActionDialog,
  SprintDeleteDialog,
  SprintRibbon,
  type NavValue,
  type Sprint as SprintView,
  type SprintDeleteAction,
  type SprintMemberCapacity,
} from "@/components/sprint";
import type { AcceptanceCriterionRow } from "@/lib/dal/story-hierarchy";
import { toast } from "sonner";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { tempId as makeTempId } from "@/lib/optimistic/reconcile";
import { suggestFunctionPoints } from "@/lib/function-points";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";

import type { RawTask, TabKey } from "./_types";
import { useProjectMeta } from "./_hooks/use-project-meta";
import { useStoryHierarchy } from "./_hooks/use-story-hierarchy";
import { useTasksAndSprints } from "./_hooks/use-tasks-and-sprints";
import { useProjectMembers } from "./_hooks/use-project-members";
import { SprintsTab } from "./_tabs/sprints-tab";
import { SettingsTab } from "./_tabs/settings-tab";

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
  const { effectiveAccessLevel } = useAuth();
  const canManageSprint = hasMinAccessLevel(effectiveAccessLevel, "manager");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTabParam = searchParams.get("tab");
  // Legacy: `?tab=tasks` agora aponta pra Sprints → Todas. Mantém deep-links antigos vivos.
  // Legacy: `?tab=forge` foi removido (Forge virou sandbox em /dev/forge-sandbox).
  const tabParam: TabKey | null =
    rawTabParam === "tasks"
      ? "sprints"
      : rawTabParam === "forge"
        ? "stories"
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

  // ─── Data hooks ────────────────────────────────────────────────────────────
  const { project, reload: loadProject } = useProjectMeta(id);
  const {
    rawModules,
    rawPersonas,
    rawStories,
    setRawStories,
    taskAcRows,
    acRowsCollection,
    acIdAliasRef,
    resolveAcId,
    reload: loadStoryHierarchy,
  } = useStoryHierarchy(id);
  const {
    rawTasks,
    taskMutate,
    rawSprints,
    projectTags,
    setProjectTags,
    reload: loadTasksAndSprints,
  } = useTasksAndSprints(id);
  const sprintIds = useMemo(() => rawSprints.map((s) => s.id), [rawSprints]);
  const {
    rawMembers,
    rawProjectMembers,
    rawSprintMembers,
    reloadMembers: loadMembers,
  } = useProjectMembers(id, sprintIds);

  const [accessOpen, setAccessOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  const [suggestSheetOpen, setSuggestSheetOpen] = useState(false);
  const [suggestSheetTargetId, setSuggestSheetTargetId] = useState<
    string | null
  >(null);
  const [sprintAction, setSprintAction] = useState<
    | { mode: "activate-replacing" | "activate-fresh"; targetId: string }
    | { mode: "reopen-replacing" | "reopen-fresh"; targetId: string }
    | null
  >(null);
  const [sprintDeleteTargetId, setSprintDeleteTargetId] = useState<
    string | null
  >(null);
  const [sprintEditingId, setSprintEditingId] = useState<string | null>(null);
  const [sprintContextSheet, setSprintContextSheet] = useState<{
    sprintId: string;
    mode: SprintContextSheetMode;
  } | null>(null);
  const [selectedStoryRef, setSelectedStoryRef] = useState<string | null>(null);
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(taskParam);

  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    suggested?: string;
  }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({
    open: false,
  });
  const [duplicateTaskRef, setDuplicateTaskRef] = useState<string | null>(null);
  const [cloneTaskRef, setCloneTaskRef] = useState<string | null>(null);
  const [targetProjects, setTargetProjects] = useState<ProjectLite[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

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

  // "Members" do projeto = PM (Project.pmId) ∪ alocados (ProjectMember). PM
  // ganha precedência: se a mesma pessoa for PM e Builder, exibe só "PM".
  const members = useMemo(() => {
    const allocated = rawMembers.map(adaptMember).map((m) => ({
      ...m,
      isBuilder: true,
    }));
    const pm = project?.pm;
    if (!pm) return allocated;
    const idx = allocated.findIndex((m) => m.id === pm.id);
    if (idx >= 0) {
      const next = [...allocated];
      next[idx] = { ...next[idx], isPm: true, isBuilder: false };
      return next;
    }
    return [
      { ...adaptMember(pm), isPm: true, isBuilder: false },
      ...allocated,
    ];
  }, [rawMembers, project?.pm]);

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
   * Iterates over every (member × sprint), so the widget shows the PM and
   * task assignees too — not only ProjectMember rows. PM (Project.pmId) e
   * pessoas alocadas em tasks da sprint entram com fpCapacity como fallback
   * de allocation quando não há SprintMember/ProjectMember explícito.
   */
  const capacities: SprintMemberCapacity[] = useMemo(() => {
    const memberCapacityById = new Map(
      rawMembers.map((m) => [m.id, m.fpCapacity ?? 0]),
    );
    // PM costuma não estar em ProjectMember (e portanto não está em rawMembers),
    // então o Member.fpCapacity dele precisa entrar via project.pm pra evitar
    // cair pra 0 no fallback do fpAllocation abaixo.
    if (project?.pm?.id) {
      memberCapacityById.set(project.pm.id, project.pm.fpCapacity ?? 0);
    }
    const projectAllocById = new Map(
      rawProjectMembers.map((pm) => [pm.memberId, pm.fpAllocation]),
    );
    const sprintAllocByKey = new Map(
      rawSprintMembers.map(
        (sm) => [`${sm.sprintId}|${sm.memberId}`, sm.fpAllocation] as const,
      ),
    );

    const assigneesBySprint = new Map<string, Set<string>>();
    for (const t of rawTasks) {
      if (!t.sprintId) continue;
      let set = assigneesBySprint.get(t.sprintId);
      if (!set) {
        set = new Set();
        assigneesBySprint.set(t.sprintId, set);
      }
      for (const a of t.assignments ?? []) {
        if (a.memberId) set.add(a.memberId);
      }
    }

    const pmId = project?.pm?.id ?? null;

    return rawSprints.flatMap((sprint) => {
      const memberIds = new Set<string>(rawProjectMembers.map((pm) => pm.memberId));
      if (pmId) memberIds.add(pmId);
      const assignees = assigneesBySprint.get(sprint.id);
      if (assignees) for (const id of assignees) memberIds.add(id);

      return Array.from(memberIds).map((memberId) => {
        const fpCapacity = memberCapacityById.get(memberId) ?? 0;
        const sprintAlloc = sprintAllocByKey.get(`${sprint.id}|${memberId}`);
        const projectAlloc = projectAllocById.get(memberId) ?? 0;
        const fpAllocation =
          sprintAlloc !== undefined && sprintAlloc > 0
            ? sprintAlloc
            : projectAlloc > 0
              ? projectAlloc
              : fpCapacity;
        return {
          sprintId: sprint.id,
          memberId,
          fpCapacity,
          fpAllocation,
        };
      });
    });
  }, [rawSprints, rawSprintMembers, rawProjectMembers, rawMembers, rawTasks, project?.pm?.id, project?.pm?.fpCapacity]);

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
    const newId = crypto.randomUUID();
    const { error } = await supabase.from("Sprint").insert({
      id: newId,
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
    if (form.autoFillFromBacklog) {
      setSuggestSheetTargetId(newId);
      setSuggestSheetOpen(true);
    }
  }

  async function handleUpdateSprint(targetId: string, form: SprintFormData) {
    setSprintEditingId(null);
    const goal = form.goal.trim();
    try {
      await fetchOrThrow(`/api/sprints/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate,
          status: form.status,
          goal: goal === "" ? null : goal,
        }),
      });
      toast.success("Sprint atualizada");
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao atualizar sprint" });
    }
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

  function handleDeleteSprint(targetId: string) {
    setSprintDeleteTargetId(targetId);
  }

  async function deleteSprint(
    targetId: string,
    action: SprintDeleteAction,
    taskCount: number,
  ) {
    try {
      await fetchOrThrow(`/api/sprints/${targetId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskAction: action }),
      });
      // Mensagem reflete o que de fato aconteceu: sprint vazia não tem
      // tasks pra mover, mesmo que o action canônico seja "moveToBacklog".
      const message =
        taskCount === 0
          ? "Sprint excluída"
          : action === "moveToBacklog"
            ? "Sprint excluída · tasks movidas pro backlog"
            : "Sprint e tasks excluídas";
      toast.success(message);
      if (sprintView === targetId) setSprintView(null);
      await loadTasksAndSprints();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao excluir sprint" });
      throw e;
    }
  }

  /**
   * Create a stub story and open the StorySheet on it in edit mode. Mirrors
   * the TaskSheet pattern: the user fills in title/want/persona/module on the
   * form they already know. If it was a misclick, they delete via the row's
   * kebab menu like any other story.
   *
   * `refinementStatus="draft"` is reserved for AI-proposed stories pending
   * human review (revealed only inside the originating Design Session), and is
   * set explicitly by that flow — never by this manual button. Manual stubs
   * nascem 'refined' (default no DAL) e aparecem na lista do projeto na hora.
   */
  async function handleCreateStory() {
    if (!project?.referenceKey) {
      showErrorToast(
        new Error("Project precisa de referenceKey. Configure em Settings."),
        { label: "Não é possível criar story" },
      );
      return;
    }
    try {
      const res = await fetchOrThrow(`/api/projects/${id}/stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Nova story",
          want: "A definir.",
          personaId: personas[0]?.id ?? null,
          moduleId: null,
        }),
      });
      const { story } = (await res.json()) as { story: { reference: string } };
      await loadStoryHierarchy();
      setSelectedStoryRef(story.reference);
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

  async function handleStoryPatch(
    storyRef: string,
    patch: Partial<AdaptedStory>,
  ) {
    const dbStory = rawStories.find((s) => s.reference === storyRef);
    if (!dbStory) return;
    // Optimistic — keys in AdaptedStory map 1:1 to rawStory columns. Apply
    // immediately so the sheet's adapted view reflects the edit without
    // waiting for the PATCH + refetch round-trip.
    setRawStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef
          ? ({ ...s, ...patch } as typeof s)
          : s,
      ),
    );
    try {
      await fetchOrThrow(`/api/stories/${storyRef}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar story" });
      await loadStoryHierarchy();
    }
  }

  async function handleStoryAcCreate(
    storyRef: string,
    text: string,
    order: number,
  ) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, order }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Criar critério" });
    }
  }

  async function handleStoryAcUpdateText(
    storyRef: string,
    acId: string,
    text: string,
  ) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance/${acId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Salvar critério" });
    }
  }

  async function handleStoryAcToggle(
    storyRef: string,
    acId: string,
    checked: boolean,
  ) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance/${acId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Marcar critério" });
    }
  }

  async function handleStoryAcDelete(storyRef: string, acId: string) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance/${acId}`, {
        method: "DELETE",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Remover critério" });
    }
  }

  async function handleDeleteStory(storyRef: string) {
    setConfirmState({
      title: `Deletar story ${storyRef}?`,
      description: "Tasks relacionadas serão desvinculadas.",
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: async () => {
        if (selectedStoryRef === storyRef) setSelectedStoryRef(null);
        try {
          await fetchOrThrow(`/api/stories/${storyRef}`, { method: "DELETE" });
          await loadStoryHierarchy();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao deletar story" });
        }
      },
    });
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

    const memberLookup = new Map<string, { id: string; name: string }>(
      rawMembers.map((m) => [m.id, { id: m.id, name: m.name }]),
    );
    if (project?.pm && !memberLookup.has(project.pm.id)) {
      memberLookup.set(project.pm.id, {
        id: project.pm.id,
        name: project.pm.name,
      });
    }
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
    setConfirmState({
      title: `Deletar task ${taskRef}?`,
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: () => deleteTask(taskRef, taskId),
    });
  }

  async function deleteTask(taskRef: string, taskId: string) {
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
            const has = t.tags.some((tg) => tg.id === tagId);
            if (has) return t;
            return { ...t, tags: [...t.tags, tag] };
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
                  tags: t.tags.filter((tg) => tg.id !== tagId),
                }
              : t,
          ),
      },
    );
  }

  async function handleApproveProposedModule(story: AdaptedStory) {
    if (!story.proposedModuleName) return;
    try {
      await fetchOrThrow(
        `/api/stories/${story.reference}/promote-proposed-module`,
        { method: "POST" },
      );
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao promover módulo" });
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
    setConfirmState({
      title: "Deletar módulo?",
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/projects/${id}/modules/${modId}`, {
            method: "DELETE",
          });
          await loadStoryHierarchy();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao deletar módulo" });
        }
      },
    });
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
    setConfirmState({
      title: "Deletar persona?",
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/projects/${id}/personas/${perId}`, {
            method: "DELETE",
          });
          await loadStoryHierarchy();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao deletar persona" });
        }
      },
    });
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
                {sprints.length}
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
          }}
          onCreateStory={handleCreateStory}
          onDeleteStory={handleDeleteStory}
        />
      ) : activeTab === "sprints" ? (
        <SprintsTab
          sprints={sprints}
          tasks={tasks}
          backlogTasks={backlogTasks}
          stories={stories}
          modules={modules}
          members={members}
          projectTags={projectTags}
          backlogCount={backlogCount}
          allCount={allCount}
          activeSprintId={activeSprintId}
          focused={focused ?? null}
          isSyntheticView={isSyntheticView}
          sprintView={sprintView}
          canManageSprint={canManageSprint}
          setSprintView={setSprintView}
          setSelectedTaskRef={setSelectedTaskRef}
          setSprintContextSheet={setSprintContextSheet}
          setSprintDialogOpen={setSprintDialogOpen}
          setSuggestSheetOpen={setSuggestSheetOpen}
          setSprintEditingId={setSprintEditingId}
          requestActivateSprint={requestActivateSprint}
          requestCompleteSprint={requestCompleteSprint}
          requestReopenSprint={requestReopenSprint}
          handleDeleteSprint={handleDeleteSprint}
          handleCreateTask={handleCreateTask}
          handleInlineStatusChange={handleInlineStatusChange}
          handleInlineAssigneeChange={handleInlineAssigneeChange}
          handleInlineSprintChange={handleInlineSprintChange}
          openDuplicateDialog={openDuplicateDialog}
          openCloneDialog={openCloneDialog}
          handleCopyTaskRef={handleCopyTaskRef}
          handleDeleteTask={handleDeleteTask}
          handleBulkUpdate={handleBulkUpdate}
          handleBulkDelete={handleBulkDelete}
          handleBulkDuplicate={handleBulkDuplicate}
          handleBulkAddTag={handleBulkAddTag}
          handleBulkRemoveTag={handleBulkRemoveTag}
        />
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

      {/* Story sheet — always editable. New stories nascem via handleCreateStory
          (stub) e abrem direto pra o usuário editar inline. */}
      <StorySheet
        story={selectedStory}
        tasks={tasks}
        modules={modules}
        personas={personas}
        definitionOfDone={project.definitionOfDone}
        onClose={() => setSelectedStoryRef(null)}
        onPatch={(patch) =>
          selectedStory
            ? handleStoryPatch(selectedStory.reference, patch as Partial<AdaptedStory>)
            : undefined
        }
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
          setSelectedTaskRef(ref);
        }}
        onCreateTaskForStory={async (storyRef) => {
          const story = stories.find((s) => s.reference === storyRef);
          if (!story) return;
          setSelectedStoryRef(null);
          await handleCreateTask({ userStoryId: story.__id });
        }}
        onAcCreate={handleStoryAcCreate}
        onAcUpdateText={handleStoryAcUpdateText}
        onAcToggle={handleStoryAcToggle}
        onAcDelete={handleStoryAcDelete}
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

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />

      {/* Access sheet (legacy) */}
      <ProjectAccessSheet
        open={accessOpen}
        onOpenChange={setAccessOpen}
        projectId={id}
      />

      {/* Sprint create / edit dialog */}
      {(() => {
        const editingSprint = sprintEditingId
          ? rawSprints.find((s) => s.id === sprintEditingId) ?? null
          : null;
        const editingPayload = editingSprint
          ? {
              id: editingSprint.id,
              name: editingSprint.name,
              startDate: editingSprint.startDate,
              endDate: editingSprint.endDate,
              status: editingSprint.status,
              goal: editingSprint.goal,
            }
          : null;
        return (
          <SprintDialog
            open={sprintDialogOpen || sprintEditingId !== null}
            onOpenChange={(next) => {
              if (!next) {
                setSprintDialogOpen(false);
                setSprintEditingId(null);
              } else {
                setSprintDialogOpen(true);
              }
            }}
            editing={editingPayload}
            existingSprints={rawSprints
              .filter((s) => s.id !== sprintEditingId)
              .map((s) => ({ startDate: s.startDate, endDate: s.endDate }))}
            onSave={(form) =>
              editingPayload
                ? handleUpdateSprint(editingPayload.id, form)
                : handleCreateSprint(form)
            }
            allowAutoFill
          />
        );
      })()}

      <SuggestSprintsSheet
        open={suggestSheetOpen}
        onOpenChange={(next) => {
          setSuggestSheetOpen(next);
          if (!next) setSuggestSheetTargetId(null);
        }}
        projectId={id}
        backlogHint={backlogTasks.length}
        emptySprints={rawSprints
          .filter(
            (s) =>
              s.status === "upcoming" &&
              !rawTasks.some((t) => t.sprintId === s.id),
          )
          .map((s) => ({ id: s.id, name: s.name }))}
        initialTargetSprintId={suggestSheetTargetId}
        onApplied={() => loadTasksAndSprints()}
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

      {/* Sprint delete confirmation (with task-handling choice) */}
      {sprintDeleteTargetId ? (() => {
        const target = sprints.find((s) => s.id === sprintDeleteTargetId);
        if (!target) return null;
        // rawTasks já filtra drafts no loader; usar a fonte canônica evita
        // qualquer drift do pipeline de adapt.
        const taskCount = rawTasks.filter(
          (t) => t.sprintId === sprintDeleteTargetId,
        ).length;
        return (
          <SprintDeleteDialog
            open
            onOpenChange={(open) => !open && setSprintDeleteTargetId(null)}
            sprintName={target.name}
            taskCount={taskCount}
            onConfirm={(action) =>
              deleteSprint(sprintDeleteTargetId, action, taskCount)
            }
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

