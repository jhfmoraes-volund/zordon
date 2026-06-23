"use client";

import React, { useState, useCallback } from "react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Calendar, FileText, Link2, User2, FolderKanban } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { ACTION_ITEM_STATUS, lookupChip } from "@/lib/status-chips";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDateLong } from "@/lib/date-utils";

// ─── Types ────────────────────────────────────────────────

const STATUSES = ["todo", "doing", "done"] as const;
type Status = (typeof STATUSES)[number];

// Re-export from the central chip registry so consumers don't duplicate labels.
const STATUS_LABELS: Record<Status, string> = {
  todo:  ACTION_ITEM_STATUS.todo.label,
  doing: ACTION_ITEM_STATUS.doing.label,
  done:  ACTION_ITEM_STATUS.done.label,
};

const SOURCE_LABELS: Record<string, string> = {
  meeting: "De reunião",
  manual: "Manual",
  agent: "Pelo Alpha",
};

export type Todo = {
  id: string;
  description: string;
  status: Status;
  dueDate: string | null;
  notes: string | null;
  source: string;
  meetingId: string | null;
  sourceReviewId: string | null;
  assigneeId?: string | null;
  createdAt: string;
  resolvedAt: string | null;
  meeting?: { id: string; date: string; title: string | null } | null;
  sourceReview?: { project: { name: string } | null } | null;
};

export type TodoMember = { id: string; name: string };
export type TodoProjectReview = {
  id: string;
  projectName: string;
  pmName?: string | null;
};

export type TodoEndpoint = {
  /** POST URL to create. Body shape matches /api/profile/todos. */
  create: string;
  /** Function returning PATCH/PUT URL for a given todo id. */
  itemUrl: (id: string) => string;
  /** HTTP verb for updates. Defaults to PATCH. */
  updateMethod?: "PATCH" | "PUT";
};

const DEFAULT_ENDPOINT: TodoEndpoint = {
  create: "/api/profile/todos",
  itemUrl: (id) => `/api/profile/todos/${id}`,
  updateMethod: "PATCH",
};

type TodoSheetProps = {
  /** Existing todo to edit. Null means create mode. */
  todo: Todo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after create / update / delete. Parent should refresh. */
  onChange?: (todo?: Todo) => void;
  /** Custom API endpoint. Defaults to /api/profile/todos. */
  endpoint?: TodoEndpoint;
  /** When provided, shows assignee picker (required in create mode). */
  members?: TodoMember[];
  /** When provided, shows "vincular a projeto" picker (optional). */
  projectReviews?: TodoProjectReview[];
  /** Default assignee id used when creating. */
  defaultAssigneeId?: string;
};

// ─── Wrapper ──────────────────────────────────────────────

export function TodoSheet({
  todo,
  open,
  onOpenChange,
  onChange,
  endpoint = DEFAULT_ENDPOINT,
  members,
  projectReviews,
  defaultAssigneeId,
}: TodoSheetProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        {open && (
          <TodoSheetBody
            key={`${todo?.id ?? "new"}-${open}`}
            todo={todo}
            onChange={onChange}
            onClose={() => onOpenChange(false)}
            endpoint={endpoint}
            members={members}
            projectReviews={projectReviews}
            defaultAssigneeId={defaultAssigneeId}
          />
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

// ─── Body ──────────────────────────────────────────────────

type PatchChanges = Partial<{
  description: string;
  status: Status;
  dueDate: string | null;
  notes: string | null;
  assigneeId: string;
  sourceReviewId: string | null;
}>;

function TodoSheetBody({
  todo: initial,
  onChange,
  onClose,
  endpoint,
  members,
  projectReviews,
  defaultAssigneeId,
}: {
  todo: Todo | null;
  onChange?: (todo?: Todo) => void;
  onClose: () => void;
  endpoint: TodoEndpoint;
  members?: TodoMember[];
  projectReviews?: TodoProjectReview[];
  defaultAssigneeId?: string;
}) {
  const isCreate = !initial;
  const [todo, setTodo] = useState<Todo | null>(initial);
  const showAssignee = !!members && members.length > 0;
  const showProjectReview = !!projectReviews && projectReviews.length > 0;
  const updateMethod = endpoint.updateMethod ?? "PATCH";

  // Local draft for text fields (save on blur / explicit action)
  const [draft, setDraft] = useState({
    description: initial?.description ?? "",
    dueDate: initial?.dueDate ? initial.dueDate.slice(0, 10) : "",
    status: (initial?.status ?? "todo") as Status,
    notes: initial?.notes ?? "",
    assigneeId: initial?.assigneeId ?? defaultAssigneeId ?? "",
    sourceReviewId: initial?.sourceReviewId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // CREATE: persist on first explicit "Criar" click. UPDATE: save on blur.
  const persistCreate = useCallback(async (): Promise<Todo | null> => {
    const description = draft.description.trim();
    if (!description) return null;
    if (showAssignee && !draft.assigneeId) return null;
    setSaving(true);
    try {
      const notes = draft.notes.trim();
      const body: Record<string, unknown> = {
        description,
        status: draft.status,
        dueDate: draft.dueDate || null,
        notes: notes === "" ? null : notes,
      };
      if (showAssignee) body.assigneeId = draft.assigneeId;
      if (showProjectReview) body.sourceReviewId = draft.sourceReviewId || null;
      const res = await fetch(endpoint.create, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const created = (await res.json()) as Todo;
      setTodo(created);
      onChange?.(created);
      return created;
    } finally {
      setSaving(false);
    }
  }, [draft, onChange, endpoint, showAssignee, showProjectReview]);

  const patch = useCallback(
    async (changes: PatchChanges) => {
      if (!todo) return;
      const previous = todo;
      setTodo((prev) => (prev ? ({ ...prev, ...changes } as Todo) : prev));
      try {
        const res = await fetchOrThrow(endpoint.itemUrl(todo.id), {
          method: updateMethod,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        const fresh = (await res.json()) as Todo;
        setTodo(fresh);
        onChange?.(fresh);
      } catch (e) {
        setTodo(previous);
        showErrorToast(e, { label: "Falha ao salvar to-do" });
      }
    },
    [todo, onChange, endpoint, updateMethod],
  );

  const handleStatus = async (next: Status) => {
    setDraft((d) => ({ ...d, status: next }));
    if (isCreate && !todo) {
      // No-op; will be persisted on Criar
      return;
    }
    await patch({ status: next });
  };

  const handleDescriptionBlur = async () => {
    const desc = draft.description.trim();
    if (!todo) return;
    if (desc === todo.description) return;
    if (!desc) {
      // revert
      setDraft((d) => ({ ...d, description: todo.description }));
      return;
    }
    await patch({ description: desc });
  };

  const handleDueDate = async (value: string) => {
    setDraft((d) => ({ ...d, dueDate: value }));
    if (!todo) return;
    const iso = value ? new Date(value).toISOString() : null;
    await patch({ dueDate: iso });
  };

  const handleNotesBlur = async () => {
    if (!todo) return;
    const next = draft.notes.trim() === "" ? null : draft.notes.trim();
    if (next === (todo.notes ?? null)) return;
    await patch({ notes: next });
  };

  const handleCreate = async () => {
    await persistCreate();
  };

  const handleAssignee = async (value: string | null) => {
    if (!value) return;
    setDraft((d) => ({ ...d, assigneeId: value }));
    if (!todo) return;
    if (value === (todo.assigneeId ?? "")) return;
    await patch({ assigneeId: value });
  };

  const handleSourceReview = async (value: string | null) => {
    const next = !value || value === "__none" ? "" : value;
    setDraft((d) => ({ ...d, sourceReviewId: next }));
    if (!todo) return;
    const current = todo.sourceReviewId ?? "";
    if (next === current) return;
    await patch({ sourceReviewId: next || null });
  };

  const handleDelete = () => {
    if (!todo) {
      onClose();
      return;
    }
    const id = todo.id;
    setConfirmState({
      title: "Remover esta To-do?",
      description: "Essa To-do será removida permanentemente.",
      confirmLabel: "Remover",
      destructive: true,
      // O ConfirmDialog espera este onConfirm resolver antes de se fechar; só
      // então fechamos a TodoSheet (fechá-la antes desmontaria o próprio dialog
      // no meio do await). Erro vira toast e mantém a sheet aberta.
      onConfirm: async () => {
        try {
          await fetchOrThrow(endpoint.itemUrl(id), { method: "DELETE" });
          onChange?.();
          onClose();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover to-do" });
        }
      },
    });
  };

  const sourceLabel = todo?.source ? SOURCE_LABELS[todo.source] ?? todo.source : "Manual";
  const sourceProject = todo?.sourceReview?.project?.name ?? null;

  return (
    <>
      {/* Header */}
      <ResponsiveSheetHeader className="space-y-3">
        <ResponsiveSheetTitle className="sr-only">
          {isCreate ? "Novo to-do" : "Editar to-do"}
        </ResponsiveSheetTitle>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-pointer"
            onClick={() => {
              const idx = STATUSES.indexOf(draft.status);
              const next = STATUSES[(idx + 1) % STATUSES.length];
              handleStatus(next);
            }}
          >
            <StatusChip
              tone={lookupChip(ACTION_ITEM_STATUS, draft.status).tone}
              label={STATUS_LABELS[draft.status]}
            />
          </button>
          {todo && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {sourceLabel}
              {sourceProject && ` · ${sourceProject}`}
            </span>
          )}
        </div>

        <Textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          onBlur={handleDescriptionBlur}
          placeholder="O que precisa ser feito?"
          rows={2}
          className="text-base font-medium border-none shadow-none bg-transparent dark:bg-transparent px-0 focus-visible:ring-0 resize-none"
          autoFocus={isCreate}
        />
      </ResponsiveSheetHeader>

      {/* Body */}
      <ResponsiveSheetBody className="space-y-5">
        <FieldBlock label="Status">
          <StatusChipSelect
            variant="input"
            value={draft.status}
            options={ACTION_ITEM_STATUS}
            onValueChange={(v) => handleStatus(v as Status)}
          />
        </FieldBlock>

        {showAssignee && (
          <FieldBlock label="Responsável" icon={<User2 className="h-3.5 w-3.5" />}>
            <Select
              value={draft.assigneeId || undefined}
              onValueChange={handleAssignee}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Selecione">
                  {(v: string | null) => {
                    if (!v) return <span className="text-muted-foreground">Selecione</span>;
                    return members!.find((m) => m.id === v)?.name ?? v;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {members!.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        )}

        <FieldBlock label="Prazo" icon={<Calendar className="h-3.5 w-3.5" />}>
          <DatePicker
            value={draft.dueDate}
            onChange={handleDueDate}
            clearable
            className="h-8"
          />
        </FieldBlock>

        {showProjectReview && (
          <FieldBlock
            label="Vinculado ao projeto"
            icon={<FolderKanban className="h-3.5 w-3.5" />}
          >
            <Select
              value={draft.sourceReviewId || "__none"}
              onValueChange={handleSourceReview}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Nenhum</SelectItem>
                {projectReviews!.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.projectName}
                    {r.pmName ? ` (${r.pmName})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
        )}

        <FieldBlock label="Notas" icon={<FileText className="h-3.5 w-3.5" />}>
          <Textarea
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            onBlur={handleNotesBlur}
            placeholder="Detalhes, contexto, links, snippets…"
            rows={4}
            className="font-mono text-sm"
          />
        </FieldBlock>

        {todo?.meeting && (
          <FieldBlock label="Origem" icon={<Link2 className="h-3.5 w-3.5" />}>
            <div className="surface-inset px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span>
                  Reunião de{" "}
                  {fmtDateLong(todo.meeting.date)}
                  {todo.meeting.title && ` — ${todo.meeting.title}`}
                </span>
              </div>
            </div>
          </FieldBlock>
        )}
      </ResponsiveSheetBody>

      {/* Footer */}
      <ResponsiveSheetFooter className="flex-row items-center justify-between sm:justify-between">
        {isCreate && !todo ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={
                saving ||
                !draft.description.trim() ||
                (showAssignee && !draft.assigneeId)
              }
              onClick={handleCreate}
            >
              {saving ? "Criando..." : "Criar"}
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {todo?.createdAt &&
                `Criada em ${fmtDateLong(todo.createdAt)}`}
            </span>
            <Button variant="ghost" size="sm" onClick={handleDelete} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remover
            </Button>
          </>
        )}
      </ResponsiveSheetFooter>

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────

function FieldBlock({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

export { STATUS_LABELS as TODO_STATUS_LABELS };
