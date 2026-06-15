"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type {
  OpenSourceCardRow,
  OpenSourceCardInput,
} from "@/lib/dal/open-source";
import { OpenSourceSheet } from "./open-source-sheet";

export function OpenSourceDetailActions({ card }: { card: OpenSourceCardRow }) {
  const { effectiveAccessLevel } = useAuth();
  const canManage = hasMinAccessLevel(effectiveAccessLevel, "admin");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  if (!canManage) return null;

  async function handleSubmit(values: OpenSourceCardInput) {
    try {
      await fetchOrThrow(`/api/open-source/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      router.refresh();
    } catch (e) {
      showErrorToast(e, { label: "Atualizar card" });
    }
  }

  function handleDelete() {
    setConfirm({
      title: "Excluir card?",
      description: `O card de ${card.name} será removido permanentemente.`,
      destructive: true,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/open-source/${card.id}`, {
            method: "DELETE",
          });
          router.push("/open-source");
        } catch (e) {
          showErrorToast(e, { label: "Excluir card" });
        }
      },
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1 size-3.5" />
        Editar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="mr-1 size-3.5" />
        Excluir
      </Button>

      <OpenSourceSheet
        open={open}
        card={card}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
