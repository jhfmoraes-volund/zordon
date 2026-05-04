"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import type { Sprint } from "./types";

type Mode = "activate-replacing" | "activate-fresh" | "complete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  /** Sprint sendo ativada/concluída */
  target: Sprint;
  /** Sprint que será marcada como concluída (só em activate-replacing) */
  previousActive?: Sprint | null;
  /** Contagem de tasks da sprint anterior (só em activate-replacing) */
  previousActiveTaskStats?: { total: number; done: number };
  onConfirm: () => Promise<void>;
};

function fmtRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt.format(s)} – ${fmt.format(e)}`;
}

export function SprintActionDialog({
  open,
  onOpenChange,
  mode,
  target,
  previousActive,
  previousActiveTaskStats,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "complete" ? `Concluir ${target.name}?` : `Ativar ${target.name}?`;

  const primaryLabel =
    mode === "complete" ? "Concluir" : "Ativar";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-3 py-2 text-sm">
          {mode === "activate-replacing" && previousActive ? (
            <>
              <p>
                A sprint <strong>{previousActive.name}</strong>{" "}
                (atualmente ativa) será marcada como concluída.
              </p>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <div>{fmtRange(previousActive.startDate, previousActive.endDate)}</div>
                {previousActiveTaskStats ? (
                  <div className="mt-0.5">
                    {previousActiveTaskStats.done} de {previousActiveTaskStats.total}{" "}
                    {previousActiveTaskStats.total === 1 ? "task concluída" : "tasks concluídas"}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {mode === "activate-fresh" ? (
            <p>
              <strong>{target.name}</strong> passará a ser a sprint ativa do projeto.
            </p>
          ) : null}

          {mode === "complete" ? (
            <p>
              O projeto ficará sem sprint ativa até você ativar a próxima.
            </p>
          ) : null}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? "Salvando..." : primaryLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
