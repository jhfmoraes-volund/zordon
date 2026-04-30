"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Story,
  TaskArea,
  TaskComplexity,
  TaskScope,
  TaskStatus,
  TaskType,
} from "./types";

export type TaskCreateInput = {
  title: string;
  description?: string;
  type: TaskType;
  scope: TaskScope;
  complexity: TaskComplexity;
  area: TaskArea;
  status: TaskStatus;
  /** UserStory id (DB), or null if standalone. */
  userStoryId: string | null;
  functionPoints: number;
};

type StoryWithDbId = Story & { __id: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stories with the DB id attached as `__id` (sandbox keys by reference). */
  stories: StoryWithDbId[];
  defaultStoryId?: string | null;
  onSubmit: (input: TaskCreateInput) => void | Promise<void>;
};

const FP_MATRIX: Record<TaskScope, Record<TaskComplexity, number>> = {
  micro: { trivial: 3, low: 4, medium: 5, high: 7 },
  small: { trivial: 4, low: 5, medium: 7, high: 10 },
  medium: { trivial: 5, low: 7, medium: 10, high: 15 },
  large: { trivial: 7, low: 10, medium: 15, high: 21 },
};

const TYPES: TaskType[] = [
  "feature",
  "bugfix",
  "refactor",
  "setup",
  "component",
  "seed",
  "management",
];
const SCOPES: TaskScope[] = ["micro", "small", "medium", "large"];
const COMPLEXITIES: TaskComplexity[] = ["trivial", "low", "medium", "high"];
const AREAS: { v: Exclude<TaskArea, null> | "_none"; label: string }[] = [
  { v: "_none", label: "—" },
  { v: "front", label: "Front" },
  { v: "back", label: "Back" },
  { v: "infra", label: "Infra" },
  { v: "ops", label: "Ops" },
  { v: "mixed", label: "Mixed" },
];
const STATUSES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
];

const STORY_NONE = "__none__";

export function TaskCreateDialog({
  open,
  onOpenChange,
  stories,
  defaultStoryId,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("feature");
  const [scope, setScope] = useState<TaskScope>("small");
  const [complexity, setComplexity] = useState<TaskComplexity>("medium");
  const [area, setArea] = useState<TaskArea>(null);
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [storyId, setStoryId] = useState<string>(STORY_NONE);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setType("feature");
      setScope("small");
      setComplexity("medium");
      setArea(null);
      setStatus("backlog");
      setStoryId(defaultStoryId ?? STORY_NONE);
      setSubmitting(false);
    }
  }, [open, defaultStoryId]);

  const fp = FP_MATRIX[scope][complexity];
  const valid = title.trim().length >= 3;

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        scope,
        complexity,
        area,
        status,
        userStoryId: storyId === STORY_NONE ? null : storyId,
        functionPoints: fp,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova task</DialogTitle>
          <DialogDescription>
            Quebrar uma story em ações executáveis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Título</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Implementar endpoint /auth/magic-link"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Descrição</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Story</Label>
              <Select
                value={storyId}
                onValueChange={(v) => v !== null && setStoryId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha story" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STORY_NONE}>Sem story (avulsa)</SelectItem>
                  {stories.map((s) => (
                    <SelectItem key={s.__id} value={s.__id}>
                      <span className="font-mono text-xs">{s.reference}</span>{" "}
                      · {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => v !== null && setStatus(v as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => v !== null && setType(v as TaskType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Area</Label>
              <Select
                value={area ?? "_none"}
                onValueChange={(v) =>
                  v !== null &&
                  setArea(v === "_none" ? null : (v as TaskArea))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((a) => (
                    <SelectItem key={a.v} value={a.v}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) => v !== null && setScope(v as TaskScope)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Complexity</Label>
              <Select
                value={complexity}
                onValueChange={(v) =>
                  v !== null && setComplexity(v as TaskComplexity)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPLEXITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>FP (auto)</Label>
              <Input value={fp} readOnly className="font-mono tabular-nums" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? "Criando…" : "Criar task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
