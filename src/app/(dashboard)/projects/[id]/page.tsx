"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  FileText,
  Flame,
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
import { ProjectEditSheet } from "@/components/projects/project-edit-sheet";
import { ProjectCeremoniesTab } from "@/components/project-ceremonies-tab";
import { ProjectSessionsTab } from "@/components/project-sessions-tab";
import { ProjectWikiSheet } from "@/components/project-wiki";
import { SprintDialog } from "@/components/sprint-dialog";
import { SprintContextSheet } from "@/components/sprint/sprint-context-sheet";
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
} from "@/components/story-hierarchy";
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
  type SprintMemberCapacity,
} from "@/components/sprint";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";

import type { TabKey } from "./_types";
import { useProjectMeta } from "./_hooks/use-project-meta";
import { useStoryHierarchy } from "./_hooks/use-story-hierarchy";
import { useTasksAndSprints } from "./_hooks/use-tasks-and-sprints";
import { useProjectMembers } from "./_hooks/use-project-members";
import { useTaxonomyActions } from "./_hooks/use-taxonomy-actions";
import { useSprintActions } from "./_hooks/use-sprint-actions";
import { useStoryActions } from "./_hooks/use-story-actions";
import { useTaskActions } from "./_hooks/use-task-actions";
import { SprintsTab } from "./_tabs/sprints-tab";
import { SettingsTab } from "./_tabs/settings-tab";
import { ForgeTab } from "./_tabs/forge-tab";

const TABS: { key: TabKey; label: string; icon: typeof BookOpen; minAccessLevel?: "manager" | "builder" }[] = [
  { key: "stories", label: "Stories", icon: BookOpen },
  { key: "sprints", label: "Sprints", icon: Zap },
  { key: "ceremonies", label: "Rituais", icon: CalendarClock },
  { key: "sessions", label: "Sessions", icon: Lightbulb },
  { key: "forge", label: "Forge", icon: Flame, minAccessLevel: "manager" },
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
  const isGuest = !hasMinAccessLevel(effectiveAccessLevel, "builder");
  // Settings é gerencial. Guest não vê.
  // Forge também é gerencial (manager+).
  const visibleTabs = TABS.filter((tab) => {
    if (isGuest && tab.key === "settings") return false;
    if (tab.minAccessLevel && !hasMinAccessLevel(effectiveAccessLevel, tab.minAccessLevel)) {
      return false;
    }
    return true;
  });

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTabParam = searchParams.get("tab");
  // Legacy: `?tab=tasks` agora aponta pra Sprints → Todas. Mantém deep-links antigos vivos.
  // `?tab=wiki` virou sheet no hero — cai na tab default com o sheet aberto.
  const tabParam: TabKey | null =
    rawTabParam === "tasks"
      ? "sprints"
      : rawTabParam === "wiki"
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
  const [wikiOpen, setWikiOpen] = useState(rawTabParam === "wiki");
  const [selectedStoryRef, setSelectedStoryRef] = useState<string | null>(null);
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(taskParam);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // ─── Action hooks ────────────────────────────────────────────────────────────
  const taxonomy = useTaxonomyActions({ id, loadStoryHierarchy, setConfirmState });

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

  const storyActions = useStoryActions({
    id,
    project,
    personas,
    rawStories,
    setRawStories,
    loadStoryHierarchy,
    setConfirmState,
    selectedStoryRef,
    setSelectedStoryRef,
  });
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

  const taskActions = useTaskActions({
    id,
    supabase,
    tasks,
    taskMutate,
    loadTasksAndSprints,
    stories,
    rawMembers,
    project,
    projectTags,
    setProjectTags,
    acRowsCollection,
    resolveAcId,
    acIdAliasRef,
    setConfirmState,
    selectedTaskRef,
    setSelectedTaskRef,
  });

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

  const sprintActions = useSprintActions({
    id,
    supabase,
    sprints,
    loadTasksAndSprints,
    sprintView,
    setSprintView,
  });

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
  }, [rawSprints, rawSprintMembers, rawProjectMembers, rawMembers, rawTasks, project]);

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

  // Default da aba Sprints: sprint ativa. Antes era setado via useEffect
  // (setSprintView(activeSprintId)) — removido pra cumprir a regra
  // react-hooks/set-state-in-effect. O componente filho `SprintRibbon`
  // recebe `activeSprintId` separado, e `focused` (linha abaixo) já tem
  // fallback `?? activeSprint ?? sprints[0]`. Resultado idêntico ao olhar
  // do usuário; única diferença é a URL não auto-stampa `?sprint=<active>`
  // quando o user não escolhe (deep-link explícito segue funcionando).

  const selectedStory =
    stories.find((s) => s.reference === selectedStoryRef) ?? null;
  const selectedTask =
    tasks.find((t) => t.reference === selectedTaskRef) ?? null;

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
            onClick={() => setWikiOpen(true)}
          >
            <FileText className="size-4" />
            <span className="hidden sm:inline">Wiki</span>
          </Button>
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

      {/* Tabs — mobile: só ícones, distribuídos, sem scroll. Desktop: ícone + label + badge. */}
      <div className="flex border-b -mx-3 px-3 md:mx-0 md:px-0 md:gap-1">
        {visibleTabs.map((tab) => {
          const node = (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-label={tab.label}
              className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap md:flex-none md:justify-start md:px-4 md:py-2 ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="size-5 md:size-4" />
              <span className="hidden md:inline">{tab.label}</span>
              {tab.key === "stories" ? (
                <Badge variant="secondary" className="ml-1 hidden h-5 text-xs md:inline-flex">
                  {stories.length}
                </Badge>
              ) : null}
              {tab.key === "sprints" ? (
                <Badge variant="secondary" className="ml-1 hidden h-5 text-xs md:inline-flex">
                  {sprints.length}
                </Badge>
              ) : null}
            </button>
          );

          return node;
        })}
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
          onCreateStory={storyActions.handleCreateStory}
          onDeleteStory={storyActions.handleDeleteStory}
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
          setSprintContextSheet={sprintActions.setSprintContextSheet}
          setSprintDialogOpen={sprintActions.setSprintDialogOpen}
          setSuggestSheetOpen={sprintActions.setSuggestSheetOpen}
          setSprintEditingId={sprintActions.setSprintEditingId}
          requestActivateSprint={sprintActions.requestActivateSprint}
          requestCompleteSprint={sprintActions.requestCompleteSprint}
          requestReopenSprint={sprintActions.requestReopenSprint}
          handleDeleteSprint={sprintActions.handleDeleteSprint}
          handleCreateTask={taskActions.handleCreateTask}
          handleInlineStatusChange={taskActions.handleInlineStatusChange}
          handleInlineAssigneeChange={taskActions.handleInlineAssigneeChange}
          handleInlineSprintChange={taskActions.handleInlineSprintChange}
          openDuplicateDialog={taskActions.openDuplicateDialog}
          openCloneDialog={taskActions.openCloneDialog}
          handleCopyTaskRef={taskActions.handleCopyTaskRef}
          handleDeleteTask={taskActions.handleDeleteTask}
          handleHardDeleteTask={taskActions.handleHardDeleteTask}
          handleBulkUpdate={taskActions.handleBulkUpdate}
          handleBulkDelete={taskActions.handleBulkDelete}
          handleBulkDuplicate={taskActions.handleBulkDuplicate}
          handleBulkAddTag={taskActions.handleBulkAddTag}
          handleBulkRemoveTag={taskActions.handleBulkRemoveTag}
        />
      ) : activeTab === "sessions" ? (
        <ProjectSessionsTab
          projectId={id}
          projectName={project.name}
          canManage={canManageSprint}
        />
      ) : activeTab === "ceremonies" ? (
        <ProjectCeremoniesTab
          projectId={id}
          projectName={project.name}
          canManage={canManageSprint}
        />
      ) : activeTab === "forge" ? (
        <ForgeTab projectId={id} />
      ) : activeTab === "settings" ? (
        <SettingsTab
          project={project}
          modules={modules}
          personas={personas}
          moduleUsage={moduleUsage}
          personaUsage={personaUsage}
          onCreateModule={taxonomy.handleCreateModule}
          onUpdateModule={taxonomy.handleUpdateModule}
          onDeleteModule={taxonomy.handleDeleteModule}
          onCreatePersona={taxonomy.handleCreatePersona}
          onUpdatePersona={taxonomy.handleUpdatePersona}
          onDeletePersona={taxonomy.handleDeletePersona}
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
            ? storyActions.handleStoryPatch(selectedStory.reference, patch as Partial<AdaptedStory>)
            : undefined
        }
        onCreateModuleRequested={(suggested) =>
          taxonomy.setModuleDialog({ open: true, suggested })
        }
        onCreatePersonaRequested={() => taxonomy.setPersonaDialog({ open: true })}
        onApproveProposedModule={(s) =>
          taxonomy.handleApproveProposedModule(s as AdaptedStory)
        }
        onValidateAc={(s) => taxonomy.handleValidateAc(s as AdaptedStory)}
        onOpenTask={(ref) => {
          setSelectedStoryRef(null);
          setSelectedTaskRef(ref);
        }}
        onCreateTaskForStory={async (storyRef) => {
          const story = stories.find((s) => s.reference === storyRef);
          if (!story) return;
          setSelectedStoryRef(null);
          await taskActions.handleCreateTask({ userStoryId: story.__id });
        }}
        onAcCreate={storyActions.handleStoryAcCreate}
        onAcUpdateText={storyActions.handleStoryAcUpdateText}
        onAcToggle={storyActions.handleStoryAcToggle}
        onAcDelete={storyActions.handleStoryAcDelete}
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
        onSave={(updated) => taskActions.handleSaveTask(updated as AdaptedTask)}
        onChangeSprint={taskActions.handleInlineSprintChange}
        onChangeAssignees={taskActions.handleInlineAssigneesChange}
        availableTags={projectTags}
        onCreateTag={taskActions.handleCreateTag}
        onChangeTags={taskActions.handleChangeTaskTags}
        onAcCreate={taskActions.handleAcCreate}
        onAcUpdateText={taskActions.handleAcUpdateText}
        onAcToggle={taskActions.handleAcToggle}
        onAcDelete={taskActions.handleAcDelete}
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
        open={taxonomy.moduleDialog.open}
        onOpenChange={(open) =>
          taxonomy.setModuleDialog((s) => ({
            ...s,
            open,
            suggested: open ? s.suggested : undefined,
          }))
        }
        suggestedName={taxonomy.moduleDialog.suggested}
        onSubmit={async (data) => {
          await taxonomy.handleCreateModule(data);
        }}
      />
      <PersonaDialog
        open={taxonomy.personaDialog.open}
        onOpenChange={(open) => taxonomy.setPersonaDialog({ open })}
        onSubmit={async (data) => {
          await taxonomy.handleCreatePersona(data);
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

      {/* Wiki — botão no hero, sheet read-first */}
      <ProjectWikiSheet
        projectId={id}
        projectName={project.name}
        open={wikiOpen}
        onOpenChange={setWikiOpen}
      />

      {/* Sprint create / edit dialog */}
      {(() => {
        const editingSprint = sprintActions.sprintEditingId
          ? rawSprints.find((s) => s.id === sprintActions.sprintEditingId) ?? null
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
            open={sprintActions.sprintDialogOpen || sprintActions.sprintEditingId !== null}
            onOpenChange={(next) => {
              if (!next) {
                sprintActions.setSprintDialogOpen(false);
                sprintActions.setSprintEditingId(null);
              } else {
                sprintActions.setSprintDialogOpen(true);
              }
            }}
            editing={editingPayload}
            existingSprints={rawSprints
              .filter((s) => s.id !== sprintActions.sprintEditingId)
              .map((s) => ({ startDate: s.startDate, endDate: s.endDate }))}
            onSave={(form) =>
              editingPayload
                ? sprintActions.handleUpdateSprint(editingPayload.id, form)
                : sprintActions.handleCreateSprint(form)
            }
            allowAutoFill
          />
        );
      })()}

      <SuggestSprintsSheet
        open={sprintActions.suggestSheetOpen}
        onOpenChange={(next) => {
          sprintActions.setSuggestSheetOpen(next);
          if (!next) sprintActions.setSuggestSheetTargetId(null);
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
        initialTargetSprintId={sprintActions.suggestSheetTargetId}
        onApplied={() => loadTasksAndSprints()}
      />

      {/* Sprint activate / complete / reopen confirmation */}
      {sprintActions.sprintAction ? (() => {
        const action = sprintActions.sprintAction;
        const target = sprints.find((s) => s.id === action.targetId);
        if (!target) return null;
        const isReplacing =
          action.mode === "activate-replacing" ||
          action.mode === "reopen-replacing";
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
            onOpenChange={(open) => !open && sprintActions.setSprintAction(null)}
            mode={action.mode}
            target={target}
            previousActive={previousActive}
            previousActiveTaskStats={previousActiveTaskStats}
            onConfirm={async () => {
              if (
                action.mode === "reopen-replacing" ||
                action.mode === "reopen-fresh"
              ) {
                await sprintActions.handleReopenSprint(action.targetId);
              } else {
                await sprintActions.handleActivateSprint(action.targetId);
              }
            }}
          />
        );
      })() : null}

      {/* Sprint delete confirmation (with task-handling choice) */}
      {sprintActions.sprintDeleteTargetId ? (() => {
        const deleteTargetId = sprintActions.sprintDeleteTargetId;
        const target = sprints.find((s) => s.id === deleteTargetId);
        if (!target) return null;
        // rawTasks já filtra drafts no loader; usar a fonte canônica evita
        // qualquer drift do pipeline de adapt.
        const taskCount = rawTasks.filter(
          (t) => t.sprintId === deleteTargetId,
        ).length;
        return (
          <SprintDeleteDialog
            open
            onOpenChange={(open) => !open && sprintActions.setSprintDeleteTargetId(null)}
            sprintName={target.name}
            taskCount={taskCount}
            onConfirm={(action) =>
              sprintActions.deleteSprint(deleteTargetId, action, taskCount)
            }
          />
        );
      })() : null}

      {/* Sprint context sheet (goal + retro) */}
      <SprintContextSheet
        open={sprintActions.sprintContextSheet !== null}
        onOpenChange={(open) => !open && sprintActions.setSprintContextSheet(null)}
        sprint={
          sprintActions.sprintContextSheet
            ? sprints.find((s) => s.id === sprintActions.sprintContextSheet!.sprintId) ?? null
            : null
        }
        mode={sprintActions.sprintContextSheet?.mode ?? "view"}
        onSaved={() => loadTasksAndSprints()}
      />

      {/* Task duplicate / clone dialogs */}
      <TaskDuplicateDialog
        open={taskActions.duplicateTaskRef !== null}
        onOpenChange={(open) => !open && taskActions.setDuplicateTaskRef(null)}
        taskRef={taskActions.duplicateTaskRef}
        sprints={sprints.map((s) => ({ id: s.id, name: s.name }))}
        defaultSprintId={
          taskActions.duplicateTaskRef
            ? tasks.find((t) => t.reference === taskActions.duplicateTaskRef)
                ?.sprintId ?? null
            : null
        }
        onSubmit={taskActions.handleConfirmDuplicate}
      />

      <TaskCloneDialog
        open={taskActions.cloneTaskRef !== null}
        onOpenChange={(open) => !open && taskActions.setCloneTaskRef(null)}
        taskRef={taskActions.cloneTaskRef}
        targetProjects={taskActions.targetProjects}
        onSubmit={taskActions.handleConfirmClone}
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
                category: project.category,
                phase: project.phase,
                engagementType: project.engagementType,
                clientId: project.clientId,
                pmId: project.pmId,
                githubRepoOwner: project.githubRepoOwner,
                githubRepoName: project.githubRepoName,
                githubDefaultBranch: project.githubDefaultBranch,
                driveFolderId: project.driveFolderId,
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

