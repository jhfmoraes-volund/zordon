"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sparkles, Wand2 } from "lucide-react";
import {
  TASK_STATUSES, STATUS_LABELS,
  TASK_TYPES, TYPE_LABELS,
  SCOPES, COMPLEXITIES,
} from "@/lib/task-constants";
import { StatusChip } from "@/components/ui/status-chip";
import { ACTION_TYPE, lookupChip } from "@/lib/status-chips";
import { showErrorToast } from "@/lib/optimistic/toast";

// ─── Types ────────────────────────────────────────────────

type Member = { id: string; name: string };
type Sprint = { id: string; name: string; status: string };

type Task = {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  status: string;
  type: string;
  scope: string;
  complexity: string;
  priority: number;
  notes: string | null;
  dueDate: string | null;
  projectId: string;
  sprintId: string | null;
  assignments: { member: { id: string; name: string } | null }[];
};

type ActionType = "create" | "update" | "delete" | "move" | "review";

export type MeetingTaskAction = {
  id: string;
  projectId: string;
  type: ActionType;
  taskId: string | null;
  targetSprintId: string | null;
  payload: Record<string, unknown>;
  decision: "pending" | "approved" | "rejected";
  execution: "pending" | "applied" | "failed" | "skipped";
  source: "ai" | "manual";
  aiReasoning: string | null;
  aiConfidence: number | null;
  errorMessage: string | null;
  notes: string | null;
  reviewReasons: string[] | null;
  reviewNote: string | null;
  task?: Task | null;
};

const REVIEW_REASONS: Array<{ key: string; label: string }> = [
  { key: "scope", label: "Escopo" },
  { key: "acceptance_criteria", label: "Critérios de aceitação" },
  { key: "dependencies", label: "Dependências" },
  { key: "estimate", label: "Estimativa (FP / scope / complexity)" },
  { key: "assignee", label: "Quem assume" },
  { key: "other", label: "Outro" },
];

// ─── Component ────────────────────────────────────────────

export type MeetingTaskActionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  action: MeetingTaskAction;
  projectId: string;
  /** Callback após decidir/editar — reflete em payload + decision */
  onChange?: () => void;
};

export function MeetingTaskActionSheet(props: MeetingTaskActionSheetProps) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "h-[92dvh] max-h-[92dvh] gap-0 rounded-t-xl p-0"
            : "w-full !sm:max-w-[720px] gap-0 p-0"
        }
      >
        {isMobile && (
          <div
            aria-hidden="true"
            className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-12 rounded-full bg-muted z-10"
          />
        )}
        {props.open && <Body {...props} key={props.action.id} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ action, meetingId, projectId, onChange, onOpenChange }: MeetingTaskActionSheetProps) {
  const supabase = createClient();
  const [members, setMembers] = useState<Member[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [busy, setBusy] = useState(false);

  // Buffer local — só persiste ao Aprovar
  const [payload, setPayload] = useState<Record<string, unknown>>(() => ({ ...action.payload }));
  const [targetSprintId, setTargetSprintId] = useState<string | null>(action.targetSprintId);
  const [reviewReasons, setReviewReasons] = useState<string[]>(action.reviewReasons ?? []);
  const [reviewNote, setReviewNote] = useState<string>(action.reviewNote ?? "");
  const [notes, setNotes] = useState<string>(action.notes ?? "");

  useEffect(() => {
    Promise.all([
      supabase.from("Member").select("id, name").order("name"),
      supabase
        .from("Sprint")
        .select("id, name, status")
        .eq("projectId", projectId)
        .in("status", ["upcoming", "active"])
        .order("name"),
    ]).then(([m, s]) => {
      setMembers((m.data ?? []) as Member[]);
      setSprints((s.data ?? []) as Sprint[]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const set = (k: string, v: unknown) => setPayload((p) => ({ ...p, [k]: v }));

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      const wasEdited =
        decision === "approved" &&
        (
          JSON.stringify(payload) !== JSON.stringify(action.payload) ||
          targetSprintId !== action.targetSprintId ||
          JSON.stringify(reviewReasons) !== JSON.stringify(action.reviewReasons ?? []) ||
          reviewNote !== (action.reviewNote ?? "") ||
          notes !== (action.notes ?? "")
        );

      const body: Record<string, unknown> = {
        decision,
        notes,
      };
      if (decision === "approved") {
        body.payload = payload;
        body.targetSprintId = targetSprintId;
        body.reviewReasons = reviewReasons;
        body.reviewNote = reviewNote;
        body.wasEdited = wasEdited;
      }

      const res = await fetch(
        `/api/meetings/${meetingId}/task-actions/${action.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      onChange?.();
      onOpenChange(false);
    } catch (e) {
      console.error("decide failed:", e);
      showErrorToast(e, { label: "Falha ao registrar decisão" });
    } finally {
      setBusy(false);
    }
  };

  const currentTitle =
    action.type === "create"
      ? ((payload.title as string) || "Nova task (proposta)")
      : action.task?.title || "Task";

  const ref = action.task?.reference;

  // Action labels overridden locally — registry has shorter labels for inline chips
  const actionLongLabels: Record<ActionType, string> = {
    create: "Criar",
    update: "Atualizar",
    delete: "Remover da sprint",
    move: "Mover sprint",
    review: "Revisar",
  };
  const actionChip = lookupChip(ACTION_TYPE, action.type);

  return (
    <>
      {/* Header proposal banner */}
      <div className="shrink-0 border-b">
        <div className="px-6 pt-6 pb-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30">
          <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-400">
            {action.source === "ai" ? (
              <Sparkles className="h-3.5 w-3.5" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            <span className="font-medium uppercase tracking-wide">
              Proposta de {actionLongLabels[action.type]} ·{" "}
              {action.source === "ai" ? "Sugestão da IA" : "Manual"}
            </span>
            {action.source === "ai" && action.aiConfidence != null && (
              <span className="ml-auto text-amber-700/70">
                conf {(action.aiConfidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {action.aiReasoning && (
            <p className="mt-1.5 text-sm text-amber-900 dark:text-amber-200/90">
              {action.aiReasoning}
            </p>
          )}
        </div>

        <div className="px-6 pt-4 pb-3 space-y-2">
          {ref && (
            <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              {ref}
            </span>
          )}
          <h2 className="text-xl font-bold leading-tight">{currentTitle}</h2>
          <StatusChip tone={actionChip.tone} label={actionLongLabels[action.type]} />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {action.type === "create" && (
          <CreateUpdateForm
            payload={payload}
            set={set}
            members={members}
            sprints={sprints}
            mode="create"
          />
        )}
        {action.type === "update" && (
          <CreateUpdateForm
            payload={payload}
            set={set}
            members={members}
            sprints={sprints}
            mode="update"
            currentTask={action.task ?? null}
          />
        )}
        {action.type === "delete" && (
          <div className="surface-inset rounded p-4 space-y-2">
            <p className="text-sm">
              Esta task será <strong>removida da sprint</strong> e voltará pro backlog
              do projeto. A task em si <strong>não</strong> é deletada.
            </p>
            {action.task && (
              <div className="text-xs text-muted-foreground">
                Sprint atual: {action.task.sprintId ? "definida" : "nenhuma"}
              </div>
            )}
          </div>
        )}
        {action.type === "move" && (
          <div className="grid gap-2">
            <Label>Sprint destino</Label>
            <Select
              value={targetSprintId ?? "__none__"}
              onValueChange={(v) => v && setTargetSprintId(v === "__none__" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a sprint" />
              </SelectTrigger>
              <SelectContent>
                {sprints.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    Nenhuma sprint planning/active disponível
                  </SelectItem>
                )}
                {sprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} <span className="text-xs text-muted-foreground">({s.status})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {action.type === "review" && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>O que não ficou claro?</Label>
              <div className="grid grid-cols-2 gap-2">
                {REVIEW_REASONS.map((r) => {
                  const checked = reviewReasons.includes(r.key);
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() =>
                        setReviewReasons((prev) =>
                          checked ? prev.filter((x) => x !== r.key) : [...prev, r.key]
                        )
                      }
                      className={`text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                        checked
                          ? "bg-amber-50 dark:bg-amber-500/10 border-amber-300"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      <span className="mr-2">{checked ? "☑" : "☐"}</span>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Observação</Label>
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={3}
                placeholder="Ex: precisa alinhar com o cliente sobre o fluxo de erro"
              />
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <Label>Notas (opcional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Justificativa, contexto..."
          />
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-6 py-3 flex gap-2 items-center justify-end bg-background">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Fechar
        </Button>
        {action.decision !== "rejected" && (
          <Button variant="destructive" onClick={() => decide("rejected")} disabled={busy}>
            Rejeitar
          </Button>
        )}
        {action.decision !== "approved" && (
          <Button onClick={() => decide("approved")} disabled={busy}>
            Aprovar
          </Button>
        )}
      </div>
    </>
  );
}

// ─── CREATE / UPDATE form ────────────────────────────────

function CreateUpdateForm({
  payload, set, members, sprints, mode, currentTask,
}: {
  payload: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
  members: Member[];
  sprints: Sprint[];
  mode: "create" | "update";
  currentTask?: Task | null;
}) {
  const get = <T,>(key: string, fallback?: T): T | undefined => {
    if (key in payload) return payload[key] as T;
    if (mode === "update" && currentTask) {
      return (currentTask as unknown as Record<string, unknown>)[key] as T;
    }
    return fallback;
  };

  const assigneeIds = (payload.assigneeIds as string[] | undefined)
    ?? currentTask?.assignments.map((a) => a.member?.id).filter(Boolean) as string[]
    ?? [];

  const toggleAssignee = (id: string) => {
    const next = assigneeIds.includes(id)
      ? assigneeIds.filter((x) => x !== id)
      : [...assigneeIds, id];
    set("assigneeIds", next);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Título</Label>
        <Input
          value={(get<string>("title") ?? "")}
          onChange={(e) => set("title", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label>Status</Label>
          <Select
            value={get<string>("status") ?? "todo"}
            onValueChange={(v) => v && set("status", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Tipo</Label>
          <Select
            value={get<string>("type") ?? "feature"}
            onValueChange={(v) => v && set("type", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Scope</Label>
          <Select
            value={get<string>("scope") ?? "small"}
            onValueChange={(v) => v && set("scope", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Complexity</Label>
          <Select
            value={get<string>("complexity") ?? "medium"}
            onValueChange={(v) => v && set("complexity", v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPLEXITIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Prioridade (0-10)</Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={get<number>("priority") ?? 0}
            onChange={(e) => set("priority", parseInt(e.target.value) || 0)}
          />
        </div>

        <div className="grid gap-2">
          <Label>Sprint</Label>
          <Select
            value={(get<string>("sprintId") ?? "__none__")}
            onValueChange={(v) => set("sprintId", v === "__none__" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nenhuma</SelectItem>
              {sprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Atribuído a</Label>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => {
            const selected = assigneeIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleAssignee(m.id)}
                className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-accent"
                }`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Descrição</Label>
        <Textarea
          value={get<string>("description") ?? ""}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
        />
      </div>

    </div>
  );
}
