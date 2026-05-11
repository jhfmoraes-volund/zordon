"use client";

import { useState } from "react";
import { ArrowLeftToLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export type SprintDeleteAction = "moveToBacklog" | "delete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprintName: string;
  /** Quantidade de tasks vinculadas. Se 0, oferece confirmação simples. */
  taskCount: number;
  onConfirm: (action: SprintDeleteAction) => Promise<void> | void;
};

export function SprintDeleteDialog({
  open,
  onOpenChange,
  sprintName,
  taskCount,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState<SprintDeleteAction | null>(null);

  async function run(action: SprintDeleteAction) {
    if (busy) return;
    setBusy(action);
    try {
      await onConfirm(action);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  }

  const hasTasks = taskCount > 0;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Excluir {sprintName}?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {hasTasks
              ? `Essa sprint tem ${taskCount} task${taskCount === 1 ? "" : "s"} vinculada${taskCount === 1 ? "" : "s"}. Escolha o que fazer com ela${taskCount === 1 ? "" : "s"} antes de excluir a sprint.`
              : "Essa sprint não tem tasks vinculadas. Confirme a exclusão abaixo."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="py-4">
          <div className="flex flex-col gap-2">
            {/* Sempre oferece o caminho seguro (move tasks pro backlog OU,
                quando não há tasks, simplesmente exclui a sprint vazia). */}
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run("moveToBacklog")}
              className="flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              <ArrowLeftToLine className="size-4 shrink-0 mt-0.5 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {hasTasks
                    ? "Mover tasks pro backlog e excluir sprint"
                    : "Excluir sprint"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasTasks
                    ? `As ${taskCount} task${taskCount === 1 ? "" : "s"} voltam pro backlog do projeto. Só a sprint é apagada.`
                    : "A sprint está vazia. Nenhuma task afetada."}
                </p>
              </div>
              {busy === "moveToBacklog" ? (
                <span className="text-xs text-muted-foreground">…</span>
              ) : null}
            </button>

            {hasTasks ? (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => run("delete")}
                className="flex w-full items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-left transition-colors hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="size-4 shrink-0 mt-0.5 text-destructive" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-destructive">
                    Excluir sprint e tasks
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Apaga as {taskCount} task{taskCount === 1 ? "" : "s"} junto
                    com a sprint. Não tem volta.
                  </p>
                </div>
                {busy === "delete" ? (
                  <span className="text-xs text-muted-foreground">…</span>
                ) : null}
              </button>
            ) : null}
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={!!busy}
          >
            Cancelar
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
