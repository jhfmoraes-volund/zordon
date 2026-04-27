"use client";

import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { fmtDate, isOverdue } from "@/lib/task-constants";
import { StatusChip } from "@/components/ui/status-chip";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { TASK_STATUS, TASK_TYPE, lookupChip } from "@/lib/status-chips";

// ─── Types ────────────────────────────────────────────────

type Assignment = {
  member: { id: string; name: string } | null;
};

export type TaskListItem = {
  id: string;
  title: string;
  reference: string;
  status: string;
  type: string;
  functionPoints: number | null;
  dueDate: string | null;
  project?: { name: string } | null;
  sprint?: { name: string } | null;
  designSession?: { id: string; title: string } | null;
  assignments: Assignment[];
};

type Member = { id: string; name: string; role?: string };

type Props = {
  tasks: TaskListItem[];
  members: Member[];
  /** Open the task in detail sheet */
  onOpenDetail: (taskId: string) => void;
  /** PATCH status inline */
  onStatusChange: (taskId: string, status: string) => void;
  /** PATCH assignee inline (null = unassign) */
  onAssigneeChange: (taskId: string, memberId: string | null) => void;
  /** DELETE task */
  onDelete: (taskId: string) => void;
  /** DELETE multiple tasks */
  onBulkDelete?: (taskIds: string[]) => void;
  /** Show project column (useful in global lists) */
  showProject?: boolean;
  /** Show sprint column (useful when not scoped to one sprint) */
  showSprint?: boolean;
  /** Show design session column (useful to trace task origin) */
  showSession?: boolean;
  emptyMessage?: string;
};

// ─── Component ────────────────────────────────────────────

export function TaskList({
  tasks,
  members,
  onOpenDetail,
  onStatusChange,
  onAssigneeChange,
  onDelete,
  onBulkDelete,
  showProject = false,
  showSprint = true,
  showSession = false,
  emptyMessage = "Nenhuma task.",
}: Props) {
  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && selected.size < tasks.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tasks.map((t) => t.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!confirm(`Remover ${count} task${count > 1 ? "s" : ""}?`)) return;
    onBulkDelete?.(Array.from(selected));
    setSelected(new Set());
  };

  const colCount = 8 + (showProject ? 1 : 0) + (showSprint ? 1 : 0) + (showSession ? 1 : 0);

  return (
    <div className="space-y-2">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/60 border">
          <span className="text-sm font-medium">
            {selected.size} task{selected.size > 1 ? "s" : ""} selecionada{selected.size > 1 ? "s" : ""}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Deletar selecionadas
          </Button>
        </div>
      )}

      <div className="surface rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
              </TableHead>
              <TableHead className="w-[100px]">Ref</TableHead>
            <TableHead>Titulo</TableHead>
            <TableHead className="w-[90px]">Tipo</TableHead>
            <TableHead className="w-[160px]">Status</TableHead>
            <TableHead className="w-[180px]">Atribuido a</TableHead>
            {showProject && <TableHead>Projeto</TableHead>}
            {showSprint && <TableHead>Sprint</TableHead>}
            {showSession && <TableHead>Session</TableHead>}
            <TableHead className="w-[60px] text-center">FP</TableHead>
            <TableHead className="w-[90px]">Prazo</TableHead>
            <TableHead className="w-[40px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const currentAssignee = task.assignments[0]?.member;
            return (
              <TableRow
                key={task.id}
                className="group cursor-pointer hover:bg-muted/50"
                onClick={() => onOpenDetail(task.id)}
              >
                <TableCell onClick={stop} onPointerDown={stop}>
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={() => toggleOne(task.id)}
                    className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  />
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {task.reference}
                </TableCell>
                <TableCell className="font-medium text-sm max-w-[300px] truncate">
                  {task.title}
                </TableCell>
                <TableCell>
                  <StatusChip {...lookupChip(TASK_TYPE, task.type)} />
                </TableCell>
                <TableCell onClick={stop} onPointerDown={stop}>
                  <StatusChipSelect
                    value={task.status}
                    options={TASK_STATUS}
                    onValueChange={(v) => onStatusChange(task.id, v)}
                  />
                </TableCell>
                <TableCell onClick={stop} onPointerDown={stop}>
                  <Select
                    value={currentAssignee?.id ?? "__none__"}
                    onValueChange={(v) =>
                      onAssigneeChange(task.id, v === "__none__" ? null : v)
                    }
                  >
                    <SelectTrigger className="h-7 text-xs w-[160px]">
                      <SelectValue placeholder="Ninguem">
                        {(value: string | null) => {
                          if (!value || value === "__none__") return <span className="text-muted-foreground">Ninguem</span>;
                          return members.find((m) => m.id === value)?.name ?? "Ninguem";
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">Ninguem</span>
                      </SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span>{m.name}</span>
                          {m.role && (
                            <span className="text-muted-foreground ml-1 text-xs">({m.role})</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                {showProject && (
                  <TableCell className="text-xs text-muted-foreground">
                    {task.project?.name || "—"}
                  </TableCell>
                )}
                {showSprint && (
                  <TableCell className="text-xs text-muted-foreground">
                    {task.sprint?.name || "—"}
                  </TableCell>
                )}
                {showSession && (
                  <TableCell className="text-xs" onClick={stop} onPointerDown={stop}>
                    {task.designSession ? (
                      <Link
                        href={`/design-sessions/${task.designSession.id}`}
                        className="text-primary hover:underline truncate inline-block max-w-[180px]"
                      >
                        {task.designSession.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-center">
                  <span className="font-medium tabular-nums text-sm">
                    {task.functionPoints ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`text-xs tabular-nums ${isOverdue(task.dueDate, task.status) ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                    {fmtDate(task.dueDate)}
                  </span>
                </TableCell>
                <TableCell onClick={stop} onPointerDown={stop}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      }
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          if (confirm("Remover esta task?")) onDelete(task.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Remover
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
          {tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        </Table>
      </div>
    </div>
  );
}
