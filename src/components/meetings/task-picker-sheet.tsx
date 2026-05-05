"use client";

// TaskPickerSheet — side-sheet picker that asks the user to choose a task to
// act on (for update / move / delete / review proposals). The eligible-set
// depends on the action type:
//   - update: any task in the project
//   - move:   tasks NOT done (sprint or backlog; we want to be able to bring
//             a task from another sprint into the current one too)
//   - delete: tasks currently in a sprint and not done (you can't "remove
//             from sprint" something already in backlog)
//   - review: tasks in the active sprint OR backlog (don't review done tasks)

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TaskStatusChip } from "@/components/story-hierarchy";
import type { TaskStatus } from "@/components/story-hierarchy";

export type PickerAction = "update" | "move" | "delete" | "review";

export type PickerTask = {
  id: string;
  reference: string | null;
  title: string;
  status: TaskStatus | string;
  sprintId: string | null;
};

export type PickerSprint = {
  id: string;
  name: string;
};

const ACTION_TITLE: Record<PickerAction, string> = {
  update: "Atualizar task",
  move: "Mover task",
  delete: "Tirar task da sprint",
  review: "Marcar task pra revisar",
};

const ACTION_HINT: Record<PickerAction, string> = {
  update:
    "Selecione qualquer task do projeto. Você poderá editar campos no próximo passo.",
  move: "Selecione a task. No próximo passo você escolhe a sprint destino.",
  delete: "Apenas tasks que estão em uma sprint. Vai voltar pro backlog.",
  review:
    "Apenas tasks ativas (sprint ou backlog). Marque pontos a revisar no próximo passo.",
};

function isEligible(task: PickerTask, action: PickerAction): boolean {
  if (action === "update") {
    return task.status !== "draft";
  }
  if (action === "move") {
    return task.status !== "done" && task.status !== "draft";
  }
  if (action === "delete") {
    // must be in a sprint, and not done
    return task.sprintId !== null && task.status !== "done";
  }
  if (action === "review") {
    // active work — sprint OR backlog
    return (
      task.status !== "done" &&
      task.status !== "draft" &&
      (task.sprintId !== null || task.status === "backlog")
    );
  }
  return false;
}

export type TaskPickerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: PickerAction;
  tasks: PickerTask[];
  sprints: PickerSprint[];
  /** Current sprint of the meeting (used as visual context, not as filter). */
  activeSprintId: string | null;
  onPick: (taskId: string) => void;
};

export function TaskPickerSheet({
  open,
  onOpenChange,
  action,
  tasks,
  sprints,
  activeSprintId,
  onPick,
}: TaskPickerSheetProps) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "active_sprint" | "other_sprints" | "backlog">(
    "all",
  );

  const eligible = useMemo(
    () => tasks.filter((t) => isEligible(t, action)),
    [tasks, action],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible.filter((t) => {
      if (scope === "active_sprint" && t.sprintId !== activeSprintId) return false;
      if (
        scope === "other_sprints" &&
        (t.sprintId === null || t.sprintId === activeSprintId)
      )
        return false;
      if (scope === "backlog" && t.sprintId !== null) return false;
      if (!q) return true;
      const ref = (t.reference ?? "").toLowerCase();
      const title = t.title.toLowerCase();
      return ref.includes(q) || title.includes(q);
    });
  }, [eligible, search, scope, activeSprintId]);

  const sprintNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sprints) m.set(s.id, s.name);
    return m;
  }, [sprints]);

  // Available scope filters depend on the action's eligible set.
  const scopeOptions: Array<{ value: typeof scope; label: string }> = [
    { value: "all", label: "Todas" },
  ];
  if (action !== "delete") {
    scopeOptions.push({ value: "active_sprint", label: "Sprint atual" });
  }
  if (action !== "delete") {
    scopeOptions.push({ value: "backlog", label: "Backlog" });
  }
  if (action === "move" || action === "update" || action === "delete") {
    scopeOptions.push({ value: "other_sprints", label: "Outras sprints" });
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{ACTION_TITLE[action]}</ResponsiveSheetTitle>
          <p className="text-sm text-muted-foreground">{ACTION_HINT[action]}</p>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-3 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por referência ou título…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {scopeOptions.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={scope === opt.value ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setScope(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "task" : "tasks"}
          </div>

          <div className="space-y-1">
            {filtered.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {eligible.length === 0
                  ? "Nenhuma task elegível pra esta ação."
                  : "Nenhum resultado pra essa busca."}
              </div>
            ) : (
              filtered.map((t) => {
                const sprintName = t.sprintId
                  ? sprintNameById.get(t.sprintId) ?? null
                  : null;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onPick(t.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50 hover:border-border"
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0 w-16">
                      {t.reference ?? "—"}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                    <span className="shrink-0">
                      <TaskStatusChip status={t.status as TaskStatus} />
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground w-20 truncate text-right">
                      {sprintName ?? <span className="opacity-50">backlog</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
