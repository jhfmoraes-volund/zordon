"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Field, FormBody } from "@/components/ui/field";

type SprintOption = {
  id: string;
  name: string;
  status: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreate: (sprintId: string | null) => Promise<void>;
  creating: boolean;
};

export function PlanningCreateDialog({
  open,
  onOpenChange,
  projectId,
  onCreate,
  creating,
}: Props) {
  const [sprints, setSprints] = useState<SprintOption[]>([]);
  const [sprintId, setSprintId] = useState<string>("");
  const [loadingSprints, setLoadingSprints] = useState(false);

  const fetchSprints = useCallback(async () => {
    setLoadingSprints(true);
    try {
      const r = await fetch(`/api/sprints?projectId=${projectId}&status=all`);
      const data: SprintOption[] = r.ok ? await r.json() : [];
      setSprints(data ?? []);
    } catch {
      setSprints([]);
    } finally {
      setLoadingSprints(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    fetchSprints();
  }, [open, fetchSprints]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreate(sprintId || null);
    setSprintId("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setSprintId("");
    onOpenChange(next);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Nova Planning</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit}>
          <ResponsiveDialogBody>
            <FormBody density="comfortable">
              <Field name="sprintId">
                <Field.Label>Sprint</Field.Label>
                <Field.Control>
                  <select
                    id="sprintId"
                    value={sprintId}
                    onChange={(e) => setSprintId(e.target.value)}
                    disabled={loadingSprints}
                    className="flex h-[var(--field-h)] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">— sem sprint —</option>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.status === "active" ? " (ativa)" : s.status === "upcoming" ? " (futura)" : ""}
                      </option>
                    ))}
                  </select>
                </Field.Control>
                <Field.Hint>Associa a planning a uma sprint específica do projeto.</Field.Hint>
              </Field>
            </FormBody>
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={creating || loadingSprints}>
              {creating ? "Criando…" : "Criar Planning"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
