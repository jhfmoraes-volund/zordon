"use client";

import React, { useEffect, useState, use } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  ArrowLeft, Bot, User, Eye, Zap, Calendar, Link2,
  CheckSquare, Code, Briefcase, Ban, Layout, FileText, Pencil,
} from "lucide-react";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SprintDeployPanel } from "@/components/sprint-deploy-panel";

// ─── Types ─────────────────────────────────────────────────

type Task = {
  id: string;
  title: string;
  reference: string;
  status: string;
  complexity: string;
  scope: string;
  functionPoints: number | null;
  executionMode: string;
  assignments: { member: { name: string } | null; agent: { name: string } | null }[];
};

type FullTask = Task & {
  description: string | null;
  type: string;
  dueDate: string | null;
  dependencies: string | null;
  acceptanceCriteria: string | null;
  technicalNotes: string | null;
  businessContext: string | null;
  outOfScope: string | null;
  uiGuidance: string | null;
  project: { name: string };
  sprint: { name: string } | null;
  iterations: {
    id: string; number: number; type: string; trigger: string;
    resultSummary: string | null; success: boolean;
    startedAt: string; completedAt: string | null;
  }[];
};

// ─── Constants ─────────────────────────────────────────────

const columns = [
  { id: "backlog", label: "Backlog", color: "bg-muted/40" },
  { id: "todo", label: "To Do", color: "bg-blue-500/10" },
  { id: "in_progress", label: "In Progress", color: "bg-yellow-500/10" },
  { id: "review", label: "Review", color: "bg-purple-500/10" },
  { id: "changes_requested", label: "Changes Req.", color: "bg-orange-500/10" },
  { id: "approved", label: "Approved", color: "bg-emerald-500/10" },
  { id: "staging", label: "Staging", color: "bg-cyan-500/10" },
  { id: "done", label: "Done", color: "bg-green-500/10" },
];

const errorStatuses = ["merge_conflict", "staging_failed"];

const typeLabels: Record<string, string> = {
  setup: "Setup", feature: "Feature", component: "Componente",
  seed: "Seed", bugfix: "Bugfix", refactor: "Refactor",
  management: "Gestao",
};
const typeColors: Record<string, string> = {
  setup: "bg-purple-500/20 text-purple-400", feature: "bg-blue-500/20 text-blue-400",
  component: "bg-teal-500/20 text-teal-400", seed: "bg-amber-500/20 text-amber-400",
  bugfix: "bg-red-500/20 text-red-400", refactor: "bg-muted text-muted-foreground",
  management: "bg-pink-500/20 text-pink-400",
};
const statusColors: Record<string, string> = {
  backlog: "bg-muted text-muted-foreground", todo: "bg-blue-500/20 text-blue-400",
  in_progress: "bg-yellow-500/20 text-yellow-400", review: "bg-purple-500/20 text-purple-400",
  done: "bg-green-500/20 text-green-400",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

// ─── Task Card ─────────────────────────────────────────────

function TaskCard({ task, onOpenDetail }: { task: Task; onOpenDetail: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { status: task.status } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isError = errorStatuses.includes(task.status);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className={`cursor-grab active:cursor-grabbing ${isError ? "ring-red-500/30 bg-red-500/10" : ""}`}>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {task.reference}
            </span>
            <div className="flex items-center gap-1">
              {task.functionPoints != null && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {task.functionPoints} FP
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onOpenDetail(task.id); }}
              >
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <p className="text-sm font-medium leading-tight">{task.title}</p>
          {isError && (
            <Badge className="bg-red-500/20 text-red-400 text-xs">
              {task.status === "merge_conflict" ? "Merge Conflict" : "Staging Failed"}
            </Badge>
          )}
          <div className="flex flex-wrap gap-1">
            {task.assignments.map((a, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {a.member?.name || a.agent?.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────

export default function SprintBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprint, setSprint] = useState<{ name: string; project: { name: string } } | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<FullTask | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const load = () => {
    fetch(`/api/tasks?sprintId=${id}`).then((r) => r.json()).then(setTasks);
    fetch(`/api/sprints`).then((r) => r.json()).then((sprints) => {
      const s = sprints.find((sp: { id: string }) => sp.id === id);
      if (s) setSprint(s);
    });
  };

  useEffect(() => { load(); }, [id]);

  const openDetail = async (taskId: string) => {
    setSheetOpen(true);
    setLoadingDetail(true);
    setSelectedTask(null);
    const res = await fetch(`/api/tasks/${taskId}`);
    const full = await res.json();
    setSelectedTask(full);
    setLoadingDetail(false);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    let targetStatus: string | null = null;

    const col = columns.find((c) => c.id === over.id);
    if (col) {
      targetStatus = col.id;
    } else {
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) targetStatus = overTask.status;
    }

    if (!targetStatus) return;

    const task = tasks.find((t) => t.id === active.id);
    if (!task || task.status === targetStatus) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: targetStatus } : t))
    );

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: targetStatus }),
    });

    if (!res.ok) {
      load();
    }
  };

  const columnTasks = (status: string) => tasks.filter((t) => t.status === status);

  const getColumnTasks = (status: string) => {
    const baseTasks = columnTasks(status);
    if (status === "in_progress") {
      return [...baseTasks, ...columnTasks("merge_conflict"), ...columnTasks("staging_failed")];
    }
    return baseTasks;
  };

  const totalFp = tasks
    .filter((t) => t.status === "done")
    .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);

  const approvedCount = tasks.filter((t) => t.status === "approved").length;
  const stagingCount = tasks.filter((t) => t.status === "staging").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/sprints">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            {sprint?.name || "Board"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {sprint?.project.name} — {totalFp} FP entregues
          </p>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => {
            const colTasks = getColumnTasks(col.id);
            return (
              <div key={col.id} className={`rounded-xl p-3 ${col.color} min-h-[400px] w-[260px] shrink-0`}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold">{col.label}</h3>
                  <span className="text-xs text-muted-foreground">
                    {colTasks.length}
                  </span>
                </div>
                <SortableContext
                  items={colTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {colTasks.map((task) => (
                      <TaskCard key={task.id} task={task} onOpenDetail={openDetail} />
                    ))}
                  </div>
                </SortableContext>
              </div>
            );
          })}
        </div>

        <DragOverlay>
          {activeTask ? (
            <Card className="w-[220px] shadow-lg">
              <CardContent className="p-3">
                <p className="text-sm font-medium">{activeTask.title}</p>
              </CardContent>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>

      <SprintDeployPanel
        sprintId={id}
        approvedCount={approvedCount}
        stagingCount={stagingCount}
      />

      {/* Task Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full !sm:max-w-[680px] overflow-y-auto p-0">
          {loadingDetail || !selectedTask ? (
            <div className="py-12 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <BoardTaskDetail task={selectedTask} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Task Detail Sheet Content ─────────────────────────────

function BoardTaskDetail({ task }: { task: FullTask }) {
  const deps: string[] = task.dependencies ? JSON.parse(task.dependencies) : [];
  const overdue = task.dueDate && task.status !== "done" && new Date(task.dueDate) < new Date();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{task.reference}</span>
          {task.type && (
            <Badge className={typeColors[task.type] || "bg-muted text-muted-foreground"}>
              {typeLabels[task.type] || task.type}
            </Badge>
          )}
          <Badge className={statusColors[task.status] || "bg-muted text-muted-foreground"}>
            {task.status}
          </Badge>
          {task.executionMode === "agent" && (
            <Badge variant="outline" className="text-xs gap-1"><Bot className="h-3 w-3" /> Agent</Badge>
          )}
        </div>
        <h2 className="text-lg font-semibold leading-snug">{task.title}</h2>
        {task.description && (
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{task.description}</p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Meta */}
        <div className="grid grid-cols-3 gap-3">
          <MetaItem label="Function Points" value={task.functionPoints != null ? `${task.functionPoints} FP` : "—"} icon={<Zap className="h-3.5 w-3.5" />} />
          <MetaItem
            label="Prazo"
            value={fmtDate(task.dueDate)}
            icon={<Calendar className="h-3.5 w-3.5" />}
            className={overdue ? "border-red-500/20 bg-red-500/10 text-red-400" : ""}
          />
          <MetaItem label="Sprint" value={task.sprint?.name || "—"} icon={<Zap className="h-3.5 w-3.5" />} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MetaItem label="Scope" value={task.scope} />
          <MetaItem label="Complexity" value={task.complexity} />
        </div>

        {/* Assignments */}
        {task.assignments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Atribuido a:</span>
            {task.assignments.map((a, i) => (
              <Badge key={i} variant="secondary" className="text-xs">{a.member?.name || a.agent?.name}</Badge>
            ))}
          </div>
        )}

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="surface-inset p-3">
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dependencias</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {deps.map((ref) => (
                <Badge key={ref} variant="outline" className="font-mono text-xs">{ref}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Spec sections */}
        {task.acceptanceCriteria && (
          <SpecSection icon={<CheckSquare className="h-4 w-4" />} title="Acceptance Criteria">
            <pre className="text-[13px] whitespace-pre-wrap font-sans leading-7">{task.acceptanceCriteria}</pre>
          </SpecSection>
        )}

        {task.technicalNotes && (
          <SpecSection icon={<Code className="h-4 w-4" />} title="Technical Notes">
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed bg-muted/60 border p-4 rounded-lg overflow-x-auto">{task.technicalNotes}</pre>
          </SpecSection>
        )}

        {task.businessContext && (
          <SpecSection icon={<Briefcase className="h-4 w-4" />} title="Business Context">
            <p className="text-sm leading-relaxed text-muted-foreground">{task.businessContext}</p>
          </SpecSection>
        )}

        {task.outOfScope && (
          <SpecSection icon={<Ban className="h-4 w-4" />} title="Out of Scope">
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-muted-foreground">{task.outOfScope}</pre>
          </SpecSection>
        )}

        {task.uiGuidance && (
          <SpecSection icon={<Layout className="h-4 w-4" />} title="UI Guidance">
            <p className="text-sm leading-relaxed text-muted-foreground">{task.uiGuidance}</p>
          </SpecSection>
        )}

        {task.iterations && task.iterations.length > 0 && (
          <SpecSection icon={<FileText className="h-4 w-4" />} title={`Historico (${task.iterations.length})`}>
            <div className="space-y-2">
              {task.iterations.map((it) => (
                <div key={it.id} className="flex items-start gap-3 text-sm border rounded-lg p-3">
                  <Badge variant={it.success ? "secondary" : "destructive"} className="text-xs mt-0.5">#{it.number}</Badge>
                  <div>
                    <p className="text-xs text-muted-foreground">{it.type} — {it.trigger}</p>
                    {it.resultSummary && <p className="text-xs mt-1">{it.resultSummary}</p>}
                  </div>
                </div>
              ))}
            </div>
          </SpecSection>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4">
        <Link href={`/tasks/${task.id}`}>
          <Button size="sm">
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Abrir / Editar
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Shared components ─────────────────────────────────────

function MetaItem({ label, value, icon, className }: { label: string; value: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={`surface-inset px-3 py-2 ${className || ""}`}>
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="text-sm font-medium">{value}</span>
      </div>
    </div>
  );
}

function SpecSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="surface-inset p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}
