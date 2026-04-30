"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Eye,
  FileText,
  Lightbulb,
  ListTodo,
  Settings as SettingsIcon,
  Shield,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/app-shell";
import { ProjectAccessSheet } from "@/components/project-access-sheet";
import { ProjectWiki } from "@/components/project-wiki";
import { StatusChip } from "@/components/ui/status-chip";
import { createClient } from "@/lib/supabase/client";
import {
  ModuleDialog,
  PersonaDialog,
  SettingsPanel,
  StoriesList,
  StoryCreateDialog,
  StorySheet,
  TaskCreateDialog,
  TasksList,
  TaskSheet,
  type StoryCreateInput,
  type TaskCreateInput,
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
  projectStats,
  SprintDetail,
  SprintNavigator,
  SprintSummaryStats,
  SprintTimeline,
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
  | "overview"
  | "stories"
  | "tasks"
  | "sprints"
  | "wiki"
  | "settings";

type ProjectMeta = {
  id: string;
  name: string;
  status: string;
  client: { name: string } | null;
  referenceKey: string | null;
  definitionOfDone: string[];
  useStoryHierarchy: boolean;
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
  area: string | null;
  functionPoints: number | null;
  billable: boolean | null;
  dueDate: string | null;
  doneAt: string | null;
  sprintId: string | null;
  userStoryId: string | null;
  projectId: string;
  createdByAgent: boolean | null;
  assignments: Array<{ memberId: string; member: { id: string; name: string } | null }>;
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

const TABS: { key: TabKey; label: string; icon: typeof Eye }[] = [
  { key: "overview", label: "Overview", icon: Eye },
  { key: "stories", label: "Stories", icon: BookOpen },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "sprints", label: "Sprints", icon: Zap },
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

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [project, setProject] = useState<ProjectMeta | null>(null);

  const [rawModules, setRawModules] = useState<ModuleRow[]>([]);
  const [rawPersonas, setRawPersonas] = useState<PersonaRow[]>([]);
  const [rawStories, setRawStories] = useState<StoryWithRelations[]>([]);
  const [rawTasks, setRawTasks] = useState<RawTask[]>([]);
  const [taskAcRows, setTaskAcRows] = useState<AcceptanceCriterionRow[]>([]);
  const [rawSprints, setRawSprints] = useState<RawSprint[]>([]);
  const [rawMembers, setRawMembers] = useState<RawMember[]>([]);
  const [rawSprintMembers, setRawSprintMembers] = useState<RawSprintMember[]>(
    [],
  );

  const [accessOpen, setAccessOpen] = useState(false);
  const [selectedStoryRef, setSelectedStoryRef] = useState<string | null>(null);
  const [editingStory, setEditingStory] = useState(false);
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState(false);

  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    suggested?: string;
  }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({
    open: false,
  });
  const [storyCreateOpen, setStoryCreateOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);

  const [focusSprintId, setFocusSprintId] = useState<string | null>(null);

  // ─── Loaders ───────────────────────────────────────────────────────────────

  const loadProject = useCallback(async () => {
    const { data } = await supabase
      .from("Project")
      .select(
        "id, name, status, referenceKey, definitionOfDone, useStoryHierarchy, client:Client(name)",
      )
      .eq("id", id)
      .single();
    if (!data) return;
    setProject({
      id: data.id,
      name: data.name,
      status: data.status,
      client: (data.client as { name: string } | null) ?? null,
      referenceKey: data.referenceKey ?? null,
      definitionOfDone: Array.isArray(data.definitionOfDone)
        ? (data.definitionOfDone as string[])
        : [],
      useStoryHierarchy: data.useStoryHierarchy ?? false,
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
    const [tasksRes, sprintsRes] = await Promise.all([
      supabase
        .from("Task")
        .select(
          "*, assignments:TaskAssignment(memberId, member:Member(id, name))",
        )
        .eq("projectId", id)
        .neq("status", "draft")
        .order("createdAt", { ascending: false }),
      supabase
        .from("Sprint")
        .select("*")
        .eq("projectId", id)
        .order("startDate"),
    ]);
    setRawTasks((tasksRes.data ?? []) as unknown as RawTask[]);
    setRawSprints((sprintsRes.data ?? []) as RawSprint[]);
  }, [id, supabase]);

  const loadMembers = useCallback(async () => {
    const { data: pms } = await supabase
      .from("ProjectMember")
      .select("memberId, member:Member(id, name, role, fpCapacity)")
      .eq("projectId", id);

    const memberRows: RawMember[] = (pms ?? [])
      .map((pm) => pm.member)
      .filter((m) => m !== null) as RawMember[];
    setRawMembers(memberRows);

    const sprintIds = rawSprints.map((s) => s.id);
    if (sprintIds.length > 0) {
      const { data: sm } = await supabase
        .from("SprintMember")
        .select("sprintId, memberId, fpAllocation")
        .in("sprintId", sprintIds);
      setRawSprintMembers((sm ?? []) as RawSprintMember[]);
    } else {
      setRawSprintMembers([]);
    }
  }, [id, supabase, rawSprints]);

  useEffect(() => {
    loadProject();
    loadStoryHierarchy();
    loadTasksAndSprints();
  }, [loadProject, loadStoryHierarchy, loadTasksAndSprints]);

  useEffect(() => {
    if (rawSprints.length > 0) loadMembers();
  }, [rawSprints, loadMembers]);

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

  const capacities: SprintMemberCapacity[] = useMemo(() => {
    const memberCapacityById = new Map(
      rawMembers.map((m) => [m.id, m.fpCapacity ?? 0]),
    );
    return rawSprintMembers.map((sm) => ({
      sprintId: sm.sprintId,
      memberId: sm.memberId,
      fpCapacity: memberCapacityById.get(sm.memberId) ?? 0,
      fpAllocation: sm.fpAllocation,
    }));
  }, [rawSprintMembers, rawMembers]);

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
    const { error } = await supabase.from("Task").insert({
      id: crypto.randomUUID(),
      projectId: id,
      reference: (refData as unknown as string) ?? null,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      scope: input.scope,
      complexity: input.complexity,
      area: input.area,
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

  async function handleSaveTask(updated: AdaptedTask) {
    const { error } = await supabase
      .from("Task")
      .update({
        title: updated.title,
        description: updated.description,
        status: updated.status,
        type: updated.type,
        scope: updated.scope,
        complexity: updated.complexity,
        area: updated.area,
        functionPoints: updated.functionPoints,
        billable: updated.billable,
        dueDate: updated.dueDate,
      })
      .eq("id", updated.__id);
    if (error) {
      alert(`Falha ao salvar task: ${error.message}`);
      return;
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
        <StatusChip
          tone={project.status === "active" ? "green" : "muted"}
          dot
        >
          {project.status}
        </StatusChip>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAccessOpen(true)}
        >
          <Shield className="size-4" />
          Access
        </Button>
        <Link href="/design-sessions">
          <Button variant="outline" size="sm">
            <Lightbulb className="size-4" />
            Sessions
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
      {activeTab === "overview" ? (
        <OverviewTab
          sprints={sprints}
          tasks={tasks}
          activeSprintId={activeSprintId}
          onOpenSprint={(sid) => {
            setFocusSprintId(sid);
            setActiveTab("sprints");
          }}
        />
      ) : activeTab === "stories" ? (
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
          onOpenTask={(ref) => {
            setSelectedTaskRef(ref);
            setEditingTask(false);
          }}
          onCreateTask={() => setTaskCreateOpen(true)}
        />
      ) : activeTab === "sprints" ? (
        focused ? (
          <div className="space-y-5">
            <SprintNavigator
              sprints={sprints}
              currentId={focused.id}
              activeId={activeSprintId}
              onChange={setFocusSprintId}
              onJumpToActive={() => setFocusSprintId(activeSprintId)}
            />
            <SprintTimeline
              sprints={sprints}
              tasks={tasks}
              activeId={focused.id}
              onSelect={setFocusSprintId}
              cardWidth={170}
            />
            <SprintDetail
              sprint={focused}
              tasks={tasks}
              stories={stories}
              modules={modules}
              members={members}
              capacities={capacities}
              onOpenTask={(ref) => {
                setSelectedTaskRef(ref);
                setEditingTask(false);
              }}
            />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Nenhum sprint cadastrado</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Crie o primeiro sprint pra começar a planejar.
            </CardContent>
          </Card>
        )
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

      {/* Story sheet */}
      <StorySheet
        story={selectedStory}
        tasks={tasks}
        modules={modules}
        personas={personas}
        definitionOfDone={project.definitionOfDone}
        editing={editingStory}
        onClose={() => {
          setSelectedStoryRef(null);
          setEditingStory(false);
        }}
        onEdit={() => setEditingStory(true)}
        onCancelEdit={() => setEditingStory(false)}
        onSave={(updated) => {
          handleSaveStory(updated as AdaptedStory);
          setEditingStory(false);
        }}
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
          setEditingTask(false);
        }}
      />

      {/* Task sheet */}
      <TaskSheet
        task={selectedTask}
        stories={stories}
        modules={modules}
        members={members}
        definitionOfDone={project.definitionOfDone}
        editing={editingTask}
        onClose={() => {
          setSelectedTaskRef(null);
          setEditingTask(false);
        }}
        onEdit={() => setEditingTask(true)}
        onCancelEdit={() => setEditingTask(false)}
        onSave={(updated) => {
          handleSaveTask(updated as AdaptedTask);
          setEditingTask(false);
        }}
        onOpenStory={(ref) => {
          setSelectedTaskRef(null);
          setEditingTask(false);
          setSelectedStoryRef(ref);
          setEditingStory(false);
        }}
      />

      {/* Create dialogs */}
      <StoryCreateDialog
        open={storyCreateOpen}
        onOpenChange={setStoryCreateOpen}
        modules={modules}
        personas={personas}
        onSubmit={handleCreateStory}
      />
      <TaskCreateDialog
        open={taskCreateOpen}
        onOpenChange={setTaskCreateOpen}
        stories={stories}
        defaultStoryId={
          selectedStoryRef
            ? stories.find((s) => s.reference === selectedStoryRef)?.__id ?? null
            : null
        }
        onSubmit={handleCreateTask}
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
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({
  sprints,
  tasks,
  activeSprintId,
  onOpenSprint,
}: {
  sprints: SprintView[];
  tasks: AdaptedTask[];
  activeSprintId: string | null;
  onOpenSprint: (id: string) => void;
}) {
  const stats = projectStats(sprints, tasks);
  const active = sprints.find((s) => s.id === activeSprintId);

  return (
    <div className="space-y-6">
      <SprintSummaryStats stats={stats} />

      {active ? (
        <button
          type="button"
          onClick={() => onOpenSprint(active.id)}
          className="block w-full overflow-hidden rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Sprint vigente
              </p>
              <p className="text-base font-semibold">{active.name}</p>
            </div>
            <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              abrir →
            </span>
          </div>
        </button>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Timeline
        </h3>
        <SprintTimeline
          sprints={sprints}
          tasks={tasks}
          activeId={activeSprintId}
          onSelect={onOpenSprint}
        />
      </section>
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
