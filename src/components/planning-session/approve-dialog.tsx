"use client";

import { useState } from "react";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";

type Props = {
  sessionId: string;
  prdCount: number;
  onApproved: () => void;
};

export function useApproveDialog({ sessionId, prdCount, onApproved }: Props) {
  const [dialogState, setDialogState] = useState<ConfirmState | null>(null);

  const showApproveDialog = () => {
    setDialogState({
      title: "Aprovar plano de release?",
      description: `${prdCount} PRDs serão movidos de backlog/ para ready/ na ordem definida. Isso é irreversível.`,
      confirmLabel: "Aprovar e mover PRDs",
      onConfirm: async () => {
        const res = await fetch(`/api/planning-sessions/${sessionId}/approve`, {
          method: "POST",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Failed to approve");
        }

        onApproved();
      },
    });
  };

  const closeDialog = () => setDialogState(null);

  return {
    showApproveDialog,
    approveDialogElement: (
      <ConfirmDialog state={dialogState} onClose={closeDialog} />
    ),
  };
}
