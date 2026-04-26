"use client";

import React, { useEffect, useState, use } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Plus, LayoutGrid, List,
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
import { TaskSheet } from "@/components/task-sheet";
import { TaskList } from "@/components/task-list";
import { AlphaChat } from "@/components/alpha-chat";
import { useIsMobile } from "@/hooks/use-mobile";

// ─── Types ─────────────────────────────────────────────────

type Assignment = {
  member: { id: string; name: string } | null;
};

type Task = {
  id: string;
  title: string;
  reference: string;
  status: string;
  type: string;
  complexity: string;
  scope: string;
  functionPoints: number | null;
  dueDate: string | null;
  assignments: Assignment[];
};

type ProjectMember = { id: string; name: string; role: string };

type ViewMode = "board" | "list";

// ─── Constants ─────────────────────────────────────────────

const columns = [
  { id: "backlog", label: "Backlog", color: "bg-muted/40" },
  { id: "todo", label: "To Do", color: "bg-blue-500/10" },
  { id: "in_progress", label: "In Progress", color: "bg-yellow-500/10" },
  { id: "review", label: "Review", color: "bg-purple-500/10" },
  { id: "done", label: "Done", color: "bg-green-500/10" },
];

// ─── Task Card ─────────────────────────────────────────────

function TaskCard({ task, onOpenDetail }: { task: Task; onOpenDetail: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { status: task.status } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Only treat as click (not drag) — distance constraint on sensor handles drag detection
        if (!isDragging) {
          e.stopPropagation();
          onOpenDetail(task.id);
        }
      }}
    >
      <Card className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {task.reference}
            </span>
            {task.functionPoints != null && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {task.functionPoints} FP
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium leading-tight">{task.title}</p>
          <div className="flex flex-wrap gap-1">
            {task.assignments.map((a, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {a.member?.name}
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
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprint, setSprint] = useState<{ name: string; projectId: string; project: { name: string } } | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const didDefaultToMobile = React.useRef(false);

  // No primeiro render em mobile, default para list (evita scroll horizontal de board em telefone)
  useEffect(() => {
    if (isMobile && !didDefaultToMobile.current) {
      didDefaultToMobile.current = true;
      setViewMode("list");
    }
  }, [isMobile]);

  // Single sheet handles detail + create (taskId=null → create draft)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);

  // Project members for list view assignment
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const load = () => {
    fetch(`/api/tasks?sprintId=${id}`).then((r) => r.json()).then(setTasks);
    fetch(`/api/sprints`).then((r) => r.json()).then((allSprints) => {
      const s = allSprints.find((sp: { id: string }) => sp.id === id);
      if (s) setSprint(s);
    });
  };

  useEffect(() => { load(); }, [id]);

  // Fetch project members when we know the projectId
  useEffect(() => {
    if (!sprint?.projectId) return;
    fetch(`/api/projects/${sprint.projectId}`)
      .then((r) => r.json())
      .then((project) => {
        const members: ProjectMember[] = (project.projectMembers ?? []).map(
          (pm: { member: { id: string; name: string; role: string } }) => ({
            id: pm.member.id,
            name: pm.member.name,
            role: pm.member.role ?? "",
          })
        );
        setProjectMembers(members);
      });
  }, [sprint?.projectId]);

  // ─── Sheet open/close ──────────────────────────────────

  const openDetail = (taskId: string) => {
    setSheetTaskId(taskId);
    setSheetOpen(true);
  };

  const openCreateTask = () => {
    setSheetTaskId(null);
    setSheetOpen(true);
  };

  // ─── Inline updates (list view) ────────────────────────

  const handleStatusChange = async (taskId: string, status: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t))
    );
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) load();
  };

  const handleAssigneeChange = async (taskId: string, memberId: string | null) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const member = memberId
          ? projectMembers.find((m) => m.id === memberId)
          : null;
        return {
          ...t,
          assignments: member
            ? [{ member: { id: member.id, name: member.name } }]
            : [],
        };
      })
    );
    const assigneeIds = memberId ? [{ memberId }] : [];
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds }),
    });
    if (!res.ok) load();
  };

  // ─── Drag & drop ───────────────────────────────────────

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
    return baseTasks;
  };

  const totalFp = tasks
    .filter((t) => t.status === "done")
    .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={sprint ? `/projects/${sprint.projectId}` : "/projects"}>
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
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center rounded-lg border p-0.5">
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode("board")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode("list")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button onClick={openCreateTask} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Task
          </Button>
        </div>
      </div>

      {/* Board View */}
      {viewMode === "board" && (
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
      )}

      {/* List View */}
      {viewMode === "list" && (
        <TaskList
          tasks={tasks}
          members={projectMembers}
          onOpenDetail={openDetail}
          onStatusChange={handleStatusChange}
          onAssigneeChange={handleAssigneeChange}
          onDelete={async (taskId) => {
            await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
            load();
          }}
          showSprint={false}
          emptyMessage="Nenhuma task neste sprint."
        />
      )}

      {/* Alpha Chat */}
      <AlphaChat
        contextLabel={sprint?.name}
        contextParams={{ sprintId: id }}
      />

      {/* Task Sheet (detail + create) */}
      <TaskSheet
        taskId={sheetTaskId}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) load();
        }}
        createDefaults={{
          projectId: sprint?.projectId,
          sprintId: id,
        }}
        onChange={load}
      />
    </div>
  );
}
