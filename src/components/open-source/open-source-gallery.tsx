"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";
import { useOpenSource } from "@/hooks/use-open-source";
import type {
  OpenSourceCardRow,
  OpenSourceCardInput,
} from "@/lib/dal/open-source";
import { OpenSourceCardPreview } from "./open-source-card-preview";
import { OpenSourceSheet } from "./open-source-sheet";

export function OpenSourceGallery({
  initial,
}: {
  initial: OpenSourceCardRow[];
}) {
  const { effectiveAccessLevel } = useAuth();
  const canManage = hasMinAccessLevel(effectiveAccessLevel, "admin");

  const { cards, create, patch, remove } = useOpenSource(initial);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<OpenSourceCardRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(card: OpenSourceCardRow) {
    setEditing(card);
    setSheetOpen(true);
  }

  async function handleSubmit(values: OpenSourceCardInput) {
    if (editing) await patch(editing.id, values);
    else await create(values);
  }

  function handleDelete(card: OpenSourceCardRow) {
    setConfirm({
      title: "Excluir card?",
      description: `O card de ${card.name} será removido permanentemente.`,
      destructive: true,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        await remove(card.id);
      },
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Open Source"
        description="Cards de endomarketing — conheça quem constrói a Volund."
        onAdd={canManage ? openNew : undefined}
        addLabel="Novo card"
      />

      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-20 text-center">
          <Sparkles className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Nenhum card por aqui ainda.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <OpenSourceCardPreview
              key={card.id}
              card={card}
              canManage={canManage}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {canManage ? (
        <OpenSourceSheet
          open={sheetOpen}
          card={editing}
          onClose={() => setSheetOpen(false)}
          onSubmit={handleSubmit}
        />
      ) : null}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
