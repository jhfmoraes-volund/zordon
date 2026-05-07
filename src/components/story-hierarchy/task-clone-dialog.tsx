"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskStatus } from "./types";

export type ProjectLite = { id: string; name: string };

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "backlog",     label: "Backlog"     },
  { value: "todo",        label: "To do"       },
  { value: "in_progress", label: "In progress" },
  { value: "review",      label: "Review"      },
  { value: "done",        label: "Done"        },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskRef: string | null;
  /** Projects the user can clone INTO (excludes current). */
  targetProjects: ProjectLite[];
  onSubmit: (input: {
    targetProjectId: string;
    status: TaskStatus;
  }) => void | Promise<void>;
};

export function TaskCloneDialog({
  open,
  onOpenChange,
  taskRef,
  targetProjects,
  onSubmit,
}: Props) {
  const [targetProjectId, setTargetProjectId] = useState<string>("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTargetProjectId(targetProjects[0]?.id ?? "");
      setStatus("backlog");
      setSubmitting(false);
    }
  }, [open, targetProjects]);

  async function handleSubmit() {
    if (submitting || !targetProjectId) return;
    setSubmitting(true);
    try {
      await onSubmit({ targetProjectId, status });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const empty = targetProjects.length === 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Clonar para projeto</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {taskRef ? (
              <>
                Clona <span className="font-mono">{taskRef}</span> para outro
                projeto. Sprint, story e assignees são resetados.
              </>
            ) : (
              "Clona a task para outro projeto."
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <FormBody>
            <Field name="clone-project" required>
              <Field.Label>Projeto destino</Field.Label>
              {empty ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Você não tem outros projetos com permissão de edição.
                </p>
              ) : (
                <Field.Control>
                  <Select
                    value={targetProjectId}
                    onValueChange={(v) => v && setTargetProjectId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um projeto" />
                    </SelectTrigger>
                    <SelectContent>
                      {targetProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              )}
            </Field>

            <Field name="clone-status">
              <Field.Label>Status</Field.Label>
              <Field.Control>
                <Select
                  value={status}
                  onValueChange={(v) => v && setStatus(v as TaskStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || empty || !targetProjectId}
          >
            {submitting ? "Clonando…" : "Clonar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
