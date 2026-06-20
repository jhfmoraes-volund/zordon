"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ConfirmState = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

type ConfirmDialogProps = {
  state: ConfirmState | null;
  onClose: () => void;
};

export function ConfirmDialog({ state, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const open = state !== null;

  async function handleConfirm() {
    if (!state) return;
    try {
      setBusy(true);
      await state.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.title ?? ""}</DialogTitle>
          {state?.description ? (
            <DialogDescription>{state.description}</DialogDescription>
          ) : null}
          {state?.destructive ? (
            <p className="text-sm font-medium text-destructive">
              Essa ação não pode ser desfeita.
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {state?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            variant={state?.destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {state?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { ConfirmState };
