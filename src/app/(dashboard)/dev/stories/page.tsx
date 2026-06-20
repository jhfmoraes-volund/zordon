"use client";

import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/date-utils";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Eye,
  ListTodo,
  Settings as SettingsIcon,
  Settings2,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ModuleDialog,
  PersonaDialog,
  SettingsPanel,
  StoriesList,
  StorySheet,
  TaskSheet,
  TasksList,
  type Module,
  type Persona,
  type Story,
  type Task,
} from "@/components/story-hierarchy";
import {
  findCurrentSprint,
  projectStats,
  sprintFP,
  sprintTaskCounts,
  SprintDetail,
  SprintNavigator,
  SprintSummaryStats,
  SprintTimeline,
  type Sprint,
} from "@/components/sprint";
import {
  MEMBERS,
  MODULES_INITIAL,
  PERSONAS_INITIAL,
  PROJECT,
  SPRINT_CAPACITIES,
  SPRINTS_INITIAL,
  STORIES_INITIAL,
  TASKS_INITIAL,
} from "./mock-data";

type TabKey = "overview" | "stories" | "tasks" | "settings" | "sprints";

const TABS: { key: TabKey; label: string; icon: typeof Eye }[] = [
  { key: "overview", label: "Overview", icon: Eye         },
  { key: "stories",  label: "Stories",  icon: BookOpen    },
  { key: "tasks",    label: "Tasks",    icon: ListTodo    },
  { key: "sprints",  label: "Sprints",  icon: Zap         },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function genId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export default function ProjectStoriesMockPage() {
  // ─── State ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>("stories");

  const [modules, setModules]     = useState<Module[]>(MODULES_INITIAL);
  const [personas, setPersonas]   = useState<Persona[]>(PERSONAS_INITIAL);
  const [stories, setStories]     = useState<Story[]>(STORIES_INITIAL);
  const [tasks, setTasks]         = useState<Task[]>(TASKS_INITIAL);
  const [sprints]                 = useState<Sprint[]>(SPRINTS_INITIAL);

  /** Sprint id atualmente em foco na aba Sprints. Default = vigente. */
  const activeSprintId = useMemo(
    () => findCurrentSprint(sprints)?.id ?? null,
    [sprints],
  );
  const [focusSprintId, setFocusSprintId] = useState<string | null>(activeSprintId);

  const [selectedStoryRef, setSelectedStoryRef] = useState<string | null>(null);

  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(null);
  const [editingTask, setEditingTask]         = useState(false);

  /** Inline create/edit dialogs invoked from the StorySheet edit form. */
  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    suggested?: string;
  }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({
    open: false,
  });

  // ─── Derived ───────────────────────────────────────────────────────
  const selectedStory = stories.find((s) => s.reference === selectedStoryRef) ?? null;
  const selectedTask = tasks.find((t) => t.reference === selectedTaskRef) ?? null;

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

  // ─── Mutators ──────────────────────────────────────────────────────

  function patchStory(storyRef: string, patch: Partial<Story>) {
    setStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef ? { ...s, ...patch } : s,
      ),
    );
  }

  function createStoryAc(storyRef: string, text: string, order: number) {
    setStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef
          ? {
              ...s,
              acceptanceCriteria: [
                ...s.acceptanceCriteria,
                { id: genId("ac"), text, checked: false },
              ].sort(() => 0).map((ac, i) => (i === order ? ac : ac)),
            }
          : s,
      ),
    );
  }

  function updateStoryAcText(storyRef: string, acId: string, text: string) {
    setStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef
          ? {
              ...s,
              acceptanceCriteria: s.acceptanceCriteria.map((ac) =>
                ac.id === acId ? { ...ac, text } : ac,
              ),
            }
          : s,
      ),
    );
  }

  function toggleStoryAc(storyRef: string, acId: string, checked: boolean) {
    setStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef
          ? {
              ...s,
              acceptanceCriteria: s.acceptanceCriteria.map((ac) =>
                ac.id === acId
                  ? {
                      ...ac,
                      checked,
                      checkedBy: checked ? "Você" : undefined,
                    }
                  : ac,
              ),
            }
          : s,
      ),
    );
  }

  function deleteStoryAc(storyRef: string, acId: string) {
    setStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef
          ? {
              ...s,
              acceptanceCriteria: s.acceptanceCriteria.filter(
                (ac) => ac.id !== acId,
              ),
            }
          : s,
      ),
    );
  }

  function createTaskForStory(storyRef: string) {
    const ref = `${PROJECT.referenceKey}-T-${(tasks.length + 1).toString().padStart(3, "0")}`;
    const newTask: Task = {
      reference: ref,
      userStoryRef: storyRef,
      title: "Nova task",
      status: "backlog",
      type: "feature",
      scope: "small",
      complexity: "medium",
      tags: [],
      functionPoints: 3,
      billable: true,
      assigneeIds: [],
      acceptanceCriteria: [],
      createdByAgent: false,
    };
    setTasks((prev) => [newTask, ...prev]);
    setSelectedStoryRef(null);
    setSelectedTaskRef(ref);
  }

  function updateTask(updated: Task) {
    setTasks((prev) =>
      prev.map((t) => (t.reference === updated.reference ? updated : t)),
    );
  }

  function changeTaskStatus(taskRef: string, status: Task["status"]) {
    setTasks((prev) =>
      prev.map((t) =>
        t.reference === taskRef
          ? {
              ...t,
              status,
              // Trigger db `sync_task_done_at` mirror — set on entry, clear on exit
              doneAt:
                status === "done"
                  ? t.doneAt ?? new Date().toISOString()
                  : t.status === "done"
                    ? null
                    : t.doneAt,
            }
          : t,
      ),
    );
  }

  function changeTaskAssignee(taskRef: string, memberId: string | null) {
    setTasks((prev) =>
      prev.map((t) =>
        t.reference === taskRef
          ? { ...t, assigneeIds: memberId ? [memberId] : [] }
          : t,
      ),
    );
  }

  function changeTaskSprint(taskRef: string, sprintId: string | null) {
    setTasks((prev) =>
      prev.map((t) => (t.reference === taskRef ? { ...t, sprintId } : t)),
    );
  }

  function approveProposedModule(story: Story) {
    if (!story.proposedModuleName) return;
    const id = genId("mod");
    setModules((prev) => [
      ...prev,
      {
        id,
        name: story.proposedModuleName!,
        description: undefined,
      },
    ]);
    setStories((prev) =>
      prev.map((s) =>
        s.reference === story.reference
          ? { ...s, moduleId: id, proposedModuleName: undefined }
          : s,
      ),
    );
  }

  function validateAc(story: Story) {
    setStories((prev) =>
      prev.map((s) =>
        s.reference === story.reference
          ? {
              ...s,
              acValidatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
              acValidatedBy: "Você (PM)",
            }
          : s,
      ),
    );
  }

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      {/* Breadcrumb back to /dev */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          href="/dev"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Sandbox
        </Link>
        <span>/</span>
        <span>Story Hierarchy V2 mock</span>
      </div>

      {/* Project header */}
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{PROJECT.name}</h1>
            <StatusChip tone="green" dot>
              Ativo
            </StatusChip>
            <Badge variant="outline" className="font-mono text-[10px]">
              {PROJECT.referenceKey}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{PROJECT.client}</p>
        </div>
        <Button variant="outline" size="icon" className="size-8">
          <Settings2 className="size-4" />
        </Button>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 border-b -mx-3 px-3 md:mx-0 md:px-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
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
      {activeTab === "stories" ? (
        <StoriesList
          stories={stories}
          tasks={tasks}
          modules={modules}
          onOpenStory={(ref) => {
            setSelectedStoryRef(ref);
          }}
        />
      ) : activeTab === "tasks" ? (
        <TasksList
          tasks={tasks}
          stories={stories}
          modules={modules}
          members={MEMBERS}
          sprints={sprints}
          onOpenTask={(ref) => {
            setSelectedTaskRef(ref);
            setEditingTask(false);
          }}
          onChangeStatus={changeTaskStatus}
          onChangeAssignee={changeTaskAssignee}
          onChangeSprint={changeTaskSprint}
        />
      ) : activeTab === "settings" ? (
        <SettingsPanel
          modules={modules}
          personas={personas}
          moduleUsage={moduleUsage}
          personaUsage={personaUsage}
          onCreateModule={(data) =>
            setModules((prev) => [...prev, { id: genId("mod"), ...data }])
          }
          onUpdateModule={(id, data) =>
            setModules((prev) =>
              prev.map((m) => (m.id === id ? { ...m, ...data } : m)),
            )
          }
          onDeleteModule={(id) =>
            setModules((prev) => prev.filter((m) => m.id !== id))
          }
          onCreatePersona={(data) =>
            setPersonas((prev) => [...prev, { id: genId("per"), ...data }])
          }
          onUpdatePersona={(id, data) =>
            setPersonas((prev) =>
              prev.map((p) => (p.id === id ? { ...p, ...data } : p)),
            )
          }
          onDeletePersona={(id) =>
            setPersonas((prev) => prev.filter((p) => p.id !== id))
          }
        />
      ) : activeTab === "sprints" ? (
        <SprintsTab
          sprints={sprints}
          tasks={tasks}
          stories={stories}
          modules={modules}
          activeSprintId={activeSprintId}
          focusSprintId={focusSprintId}
          onChangeFocus={setFocusSprintId}
          onJumpToActive={() => setFocusSprintId(activeSprintId)}
          onOpenTask={(ref) => {
            setSelectedTaskRef(ref);
            setEditingTask(false);
          }}
          onChangeTaskStatus={changeTaskStatus}
          onChangeTaskAssignee={changeTaskAssignee}
          onChangeTaskSprint={changeTaskSprint}
        />
      ) : activeTab === "overview" ? (
        <OverviewTab
          sprints={sprints}
          tasks={tasks}
          activeSprintId={activeSprintId}
          onOpenSprint={(id) => {
            setFocusSprintId(id);
            setActiveTab("sprints");
          }}
        />
      ) : (
        <PlaceholderTab tab={activeTab} />
      )}

      {/* Story sheet — always editable */}
      <StorySheet
        story={selectedStory}
        tasks={tasks}
        modules={modules}
        personas={personas}
        definitionOfDone={PROJECT.definitionOfDone}
        onClose={() => setSelectedStoryRef(null)}
        onPatch={(patch) => {
          if (selectedStory) patchStory(selectedStory.reference, patch);
        }}
        onCreateModuleRequested={(suggested) =>
          setModuleDialog({ open: true, suggested })
        }
        onCreatePersonaRequested={() =>
          setPersonaDialog({ open: true })
        }
        onApproveProposedModule={approveProposedModule}
        onValidateAc={validateAc}
        onOpenTask={(ref) => {
          setSelectedStoryRef(null);
          setSelectedTaskRef(ref);
          setEditingTask(false);
        }}
        onCreateTaskForStory={createTaskForStory}
        onAcCreate={createStoryAc}
        onAcUpdateText={updateStoryAcText}
        onAcToggle={toggleStoryAc}
        onAcDelete={deleteStoryAc}
      />

      {/* Task sheet */}
      <TaskSheet
        task={selectedTask}
        stories={stories}
        modules={modules}
        members={MEMBERS}
        definitionOfDone={PROJECT.definitionOfDone}
        onClose={() => setSelectedTaskRef(null)}
        onSave={(updated) => updateTask(updated)}
        onOpenStory={(ref) => {
          setSelectedTaskRef(null);
          setSelectedStoryRef(ref);
        }}
      />

      {/* Inline dialogs invoked from the story-sheet edit form */}
      <ModuleDialog
        open={moduleDialog.open}
        onOpenChange={(open) =>
          setModuleDialog((s) => ({ ...s, open, suggested: open ? s.suggested : undefined }))
        }
        suggestedName={moduleDialog.suggested}
        onSubmit={(data) => {
          const id = genId("mod");
          setModules((prev) => [...prev, { id, ...data }]);
          // If a story is currently in edit mode, attach it
          if (selectedStoryRef) {
            setStories((prev) =>
              prev.map((s) =>
                s.reference === selectedStoryRef
                  ? { ...s, moduleId: id, proposedModuleName: undefined }
                  : s,
              ),
            );
          }
        }}
      />

      <PersonaDialog
        open={personaDialog.open}
        onOpenChange={(open) => setPersonaDialog({ open })}
        onSubmit={(data) => {
          const id = genId("per");
          setPersonas((prev) => [...prev, { id, ...data }]);
          if (selectedStoryRef) {
            setStories((prev) =>
              prev.map((s) =>
                s.reference === selectedStoryRef ? { ...s, personaId: id } : s,
              ),
            );
          }
        }}
      />
    </div>
  );
}

// ─── Sprints tab ────────────────────────────────────────────────────────────

function SprintsTab({
  sprints,
  tasks,
  stories,
  modules,
  activeSprintId,
  focusSprintId,
  onChangeFocus,
  onJumpToActive,
  onOpenTask,
  onChangeTaskStatus,
  onChangeTaskAssignee,
  onChangeTaskSprint,
}: {
  sprints: Sprint[];
  tasks: Task[];
  stories: Story[];
  modules: Module[];
  activeSprintId: string | null;
  focusSprintId: string | null;
  onChangeFocus: (id: string) => void;
  onJumpToActive: () => void;
  onOpenTask: (ref: string) => void;
  onChangeTaskStatus: (taskRef: string, status: Task["status"]) => void;
  onChangeTaskAssignee: (taskRef: string, memberId: string | null) => void;
  onChangeTaskSprint: (taskRef: string, sprintId: string | null) => void;
}) {
  const focused =
    sprints.find((s) => s.id === focusSprintId) ??
    sprints.find((s) => s.id === activeSprintId) ??
    sprints[0];

  if (!focused) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhum sprint cadastrado</CardTitle>
          <CardDescription>
            Crie o primeiro sprint pra começar a planejar.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <SprintNavigator
        sprints={sprints}
        currentId={focused.id}
        activeId={activeSprintId}
        onChange={onChangeFocus}
        onJumpToActive={onJumpToActive}
      />

      {/* Mini-timeline horizontal: contexto multi-sprint sem perder foco */}
      <SprintTimeline
        sprints={sprints}
        tasks={tasks}
        activeId={focused.id}
        onSelect={onChangeFocus}
        cardWidth={170}
      />

      <SprintDetail
        sprint={focused}
        tasks={tasks}
        stories={stories}
        modules={modules}
        members={MEMBERS}
        onOpenTask={onOpenTask}
        allSprints={sprints}
        onChangeTaskStatus={onChangeTaskStatus}
        onChangeTaskAssignee={onChangeTaskAssignee}
        onChangeTaskSprint={onChangeTaskSprint}
      />
    </div>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────────────

function OverviewTab({
  sprints,
  tasks,
  activeSprintId,
  onOpenSprint,
}: {
  sprints: Sprint[];
  tasks: Task[];
  activeSprintId: string | null;
  onOpenSprint: (id: string) => void;
}) {
  const stats = projectStats(sprints, tasks);
  const active = sprints.find((s) => s.id === activeSprintId);
  return (
    <div className="space-y-6">
      <SprintSummaryStats stats={stats} />

      {/* Vigente em destaque */}
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
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {fmtDate(active.startDate)} → {fmtDate(active.endDate)}
            </span>
            <span className="ml-auto flex items-center gap-3 text-sm">
              <span className="font-mono tabular-nums">
                {sprintFP(active.id, tasks).done}
                <span className="text-muted-foreground">
                  {" / "}
                  {sprintFP(active.id, tasks).total} PFV
                </span>
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {sprintTaskCounts(active.id, tasks).done} /{" "}
                {sprintTaskCounts(active.id, tasks).total} tasks
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                abrir →
              </span>
            </span>
          </div>
        </button>
      ) : null}

      {/* Timeline */}
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

// ─── Placeholder ────────────────────────────────────────────────────────────

function PlaceholderTab({ tab }: { tab: TabKey }) {
  const labels: Record<TabKey, string> = {
    overview: "Overview do projeto",
    stories:  "Stories",
    tasks:    "Tasks",
    sprints:  "Sprints",
    settings: "Settings",
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels[tab]}</CardTitle>
        <CardDescription>
          Tab placeholder — só Overview, Stories, Tasks, Sprints e Settings
          estão implementadas.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Volte pra outras abas pra explorar.
      </CardContent>
    </Card>
  );
}
