"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Copy,
  ChevronDown,
  Minus,
  Plus,
  Tag as TagIcon,
  Trash2,
  X,
  CalendarDays,
  CircleDot,
  UserCircle2,
} from "lucide-react";

const BULK_LIMIT = 100;
import { TASK_STATUS, type ChipTone } from "@/lib/status-chips";
import { StatusChip } from "@/components/ui/status-chip";
import { TagChip } from "@/components/tags/tag-chip";
import type { Member, TaskStatus, TaskTag } from "./types";

type SprintLite = { id: string; name: string };

type Props = {
  count: number;
  onClear: () => void;

  members: Member[];
  sprints?: SprintLite[];
  /** Project-scoped tag list. Required for the Tag bulk action. */
  tags?: TaskTag[];

  onChangeStatus: (status: TaskStatus) => void;
  onChangeAssignee: (memberId: string | null) => void;
  onChangeSprint?: (sprintId: string | null) => void;
  /** Add a tag to all selected tasks. Tasks at the 10-tag limit are skipped
   *  server-side and surfaced via the response. */
  onAddTag?: (tagId: string) => void;
  /** Remove a tag from all selected tasks. No-op for tasks that don't have it. */
  onRemoveTag?: (tagId: string) => void;

  onDuplicate?: () => void;
  onDelete: () => void;
};

export function BulkActionsBar({
  count,
  onClear,
  members,
  sprints,
  tags,
  onChangeStatus,
  onChangeAssignee,
  onChangeSprint,
  onAddTag,
  onRemoveTag,
  onDuplicate,
  onDelete,
}: Props) {
  const overLimit = count > BULK_LIMIT;
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <span className="text-sm font-medium">
        {count} task{count > 1 ? "s" : ""} selecionada{count > 1 ? "s" : ""}
      </span>

      {overLimit ? (
        <span
          className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
          title={`Ações em massa estão limitadas a ${BULK_LIMIT} tasks por vez. Refine sua seleção.`}
        >
          <AlertTriangle className="size-3" />
          Máx. {BULK_LIMIT} por ação
        </span>
      ) : null}

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
          disabled={overLimit}
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={overLimit}
              className="h-7 gap-1.5 px-2 text-xs"
            />
          }
        >
          <CircleDot className="size-3.5" />
          Status
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <div className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Mudar status
          </div>
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
          disabled={overLimit}
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={overLimit}
              className="h-7 gap-1.5 px-2 text-xs"
            />
          }
        >
          <UserCircle2 className="size-3.5" />
          Atribuir
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
          <div className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Atribuir a
          </div>
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
            disabled={overLimit}
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={overLimit}
                className="h-7 gap-1.5 px-2 text-xs"
              />
            }
          >
            <CalendarDays className="size-3.5" />
            Sprint
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
            <div className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Mover para sprint
            </div>
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

      {/* Tag ────────────────────────────────────────────── */}
      {tags && (onAddTag || onRemoveTag) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={overLimit}
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={overLimit}
                className="h-7 gap-1.5 px-2 text-xs"
              />
            }
          >
            <TagIcon className="size-3.5" />
            Tag
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <div className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Tags
            </div>
            <DropdownMenuSeparator />
            {tags.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Sem tags neste projeto
              </div>
            ) : (
              <>
                {onAddTag ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Plus className="size-3.5" />
                      Adicionar
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[280px] overflow-y-auto">
                      {tags.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={() => onAddTag(t.id)}
                        >
                          <TagChip
                            name={t.name}
                            tone={t.tone as ChipTone}
                            variant="linear"
                            size="sm"
                          />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                {onRemoveTag ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Minus className="size-3.5" />
                      Remover
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[280px] overflow-y-auto">
                      {tags.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onClick={() => onRemoveTag(t.id)}
                        >
                          <TagChip
                            name={t.name}
                            tone={t.tone as ChipTone}
                            variant="linear"
                            size="sm"
                          />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
              </>
            )}
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
          disabled={overLimit}
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
        disabled={overLimit}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        <Trash2 className="size-3.5" />
        Deletar
      </Button>
    </div>
  );
}
