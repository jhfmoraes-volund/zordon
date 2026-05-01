"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Copy,
  ChevronDown,
  Trash2,
  X,
  CalendarDays,
  CircleDot,
  UserCircle2,
} from "lucide-react";
import { TASK_STATUS } from "@/lib/status-chips";
import { StatusChip } from "@/components/ui/status-chip";
import type { Member, TaskStatus } from "./types";

type SprintLite = { id: string; name: string };

type Props = {
  count: number;
  onClear: () => void;

  members: Member[];
  sprints?: SprintLite[];

  onChangeStatus: (status: TaskStatus) => void;
  onChangeAssignee: (memberId: string | null) => void;
  onChangeSprint?: (sprintId: string | null) => void;

  onDuplicate?: () => void;
  onDelete: () => void;
};

export function BulkActionsBar({
  count,
  onClear,
  members,
  sprints,
  onChangeStatus,
  onChangeAssignee,
  onChangeSprint,
  onDuplicate,
  onDelete,
}: Props) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <span className="text-sm font-medium">
        {count} task{count > 1 ? "s" : ""} selecionada{count > 1 ? "s" : ""}
      </span>

      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
        Limpar
      </Button>

      <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" />

      {/* Status ─────────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" />
          }
        >
          <CircleDot className="size-3.5" />
          Status
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mudar status
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.entries(TASK_STATUS).map(([key, desc]) => (
            <DropdownMenuItem
              key={key}
              onClick={() => onChangeStatus(key as TaskStatus)}
            >
              <StatusChip {...desc} size="sm" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Assignee ───────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" />
          }
        >
          <UserCircle2 className="size-3.5" />
          Atribuir
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Atribuir a
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChangeAssignee(null)}>
            <span className="text-muted-foreground">Ninguém</span>
          </DropdownMenuItem>
          {members.length > 0 && <DropdownMenuSeparator />}
          {members.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onChangeAssignee(m.id)}>
              {m.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sprint ─────────────────────────────────────────── */}
      {onChangeSprint && sprints ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" />
            }
          >
            <CalendarDays className="size-3.5" />
            Sprint
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Mover para sprint
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChangeSprint(null)}>
              <span className="text-muted-foreground">Sem sprint</span>
            </DropdownMenuItem>
            {sprints.length > 0 && <DropdownMenuSeparator />}
            {sprints.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => onChangeSprint(s.id)}>
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" />

      {/* Duplicate ──────────────────────────────────────── */}
      {onDuplicate ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onDuplicate}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <Copy className="size-3.5" />
          Duplicar
        </Button>
      ) : null}

      {/* Delete ─────────────────────────────────────────── */}
      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        <Trash2 className="size-3.5" />
        Deletar
      </Button>
    </div>
  );
}
