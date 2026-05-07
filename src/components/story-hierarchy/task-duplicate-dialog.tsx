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

type SprintLite = { id: string; name: string };

const SPRINT_NONE = "__none__";

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
  sprints: SprintLite[];
  defaultSprintId?: string | null;
  onSubmit: (input: {
    sprintId: string | null;
    status: TaskStatus;
  }) => void | Promise<void>;
};

export function TaskDuplicateDialog({
  open,
  onOpenChange,
  taskRef,
  sprints,
  defaultSprintId,
  onSubmit,
}: Props) {
  const [sprintId, setSprintId] = useState<string>(SPRINT_NONE);
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSprintId(defaultSprintId ?? SPRINT_NONE);
      setStatus("backlog");
      setSubmitting(false);
    }
  }, [open, defaultSprintId]);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        sprintId: sprintId === SPRINT_NONE ? null : sprintId,
        status,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Duplicar task</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {taskRef ? (
              <>
                Cria uma cópia de{" "}
                <span className="font-mono">{taskRef}</span> no mesmo projeto.
                Assignees são removidos; ACs são copiados.
              </>
            ) : (
              "Cria uma cópia da task no mesmo projeto."
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <FormBody>
            <Field name="duplicate-sprint">
              <Field.Label>Sprint</Field.Label>
              <Field.Control>
                <Select
                  value={sprintId}
                  onValueChange={(v) => v && setSprintId(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SPRINT_NONE}>
                      <span className="text-muted-foreground">Sem sprint</span>
                    </SelectItem>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>

            <Field name="duplicate-status">
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
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Duplicando…" : "Duplicar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
