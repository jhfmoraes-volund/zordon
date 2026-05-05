"use client";

// Lightweight proposal views for actions that don't need the full TaskSheet:
//   - MoveProposalView: pick destination sprint
//   - DeleteProposalView: confirm with a banner
//   - ReviewProposalView: pick reasons + note

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MeetingTaskAction } from "./meeting-task-action-sheet";

type SprintLite = { id: string; name: string; status: string };

type TaskHeader = {
  reference: string | null;
  title: string;
  currentSprintName?: string | null;
};

function Header({ task }: { task: TaskHeader }) {
  return (
    <div className="border-b px-6 py-4 space-y-1">
      {task.reference && (
        <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
          {task.reference}
        </span>
      )}
      <h2 className="text-xl font-bold leading-tight">{task.title}</h2>
      {task.currentSprintName && (
        <p className="text-xs text-muted-foreground">
          Sprint atual: <strong>{task.currentSprintName}</strong>
        </p>
      )}
    </div>
  );
}

// ─── MoveProposalView ─────────────────────────────────────────────────────────

export function MoveProposalView({
  task,
  sprints,
  initialTargetSprintId,
  onTargetChange,
}: {
  task: TaskHeader;
  sprints: SprintLite[];
  initialTargetSprintId: string | null;
  onTargetChange: (id: string | null) => void;
}) {
  const [target, setTarget] = useState<string | null>(initialTargetSprintId);

  useEffect(() => {
    onTargetChange(target);
  }, [target, onTargetChange]);

  return (
    <>
      <Header task={task} />
      <div className="px-6 py-5 space-y-4">
        <div className="grid gap-2">
          <Label>Sprint destino</Label>
          <Select
            value={target ?? "__none__"}
            onValueChange={(v) => setTarget(v === "__none__" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione a sprint" />
            </SelectTrigger>
            <SelectContent>
              {sprints.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  Nenhuma sprint disponível
                </SelectItem>
              ) : (
                sprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({s.status})
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}

// ─── DeleteProposalView ───────────────────────────────────────────────────────

export function DeleteProposalView({ task }: { task: TaskHeader }) {
  return (
    <>
      <Header task={task} />
      <div className="px-6 py-5">
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm">
          <p>
            Ao aprovar, esta task será <strong>removida da sprint</strong> e
            voltará pro backlog do projeto. A task em si <strong>não</strong> é
            deletada.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── ReviewProposalView ───────────────────────────────────────────────────────

const REVIEW_REASONS: Array<{ key: string; label: string }> = [
  { key: "scope", label: "Escopo" },
  { key: "acceptance_criteria", label: "Critérios de aceitação" },
  { key: "dependencies", label: "Dependências" },
  { key: "estimate", label: "Estimativa (FP / scope / complexity)" },
  { key: "assignee", label: "Quem assume" },
  { key: "other", label: "Outro" },
];

export function ReviewProposalView({
  task,
  initial,
  onChange,
}: {
  task: TaskHeader;
  initial: { reasons: string[]; note: string };
  onChange: (next: { reasons: string[]; note: string }) => void;
}) {
  const [reasons, setReasons] = useState<string[]>(initial.reasons);
  const [note, setNote] = useState(initial.note);

  useEffect(() => {
    onChange({ reasons, note });
  }, [reasons, note, onChange]);

  const toggle = (k: string) =>
    setReasons((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );

  return (
    <>
      <Header task={task} />
      <div className="px-6 py-5 space-y-4">
        <div className="grid gap-2">
          <Label>O que não ficou claro?</Label>
          <div className="grid grid-cols-2 gap-2">
            {REVIEW_REASONS.map((r) => {
              const checked = reasons.includes(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => toggle(r.key)}
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex: precisa alinhar com o cliente sobre o fluxo de erro"
          />
        </div>
      </div>
    </>
  );
}

// We intentionally don't expose a "type" for this file beyond the components
// — callers know which view they want based on action.type.

export type { MeetingTaskAction };
