"use client";

import { useState } from "react";
import { ArrowLeft, Pencil, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";
import { useOpenSource } from "@/hooks/use-open-source";
import type {
  OpenSourceCardRow,
  OpenSourceCardInput,
} from "@/lib/dal/open-source";
import { OpenSourceCard } from "./open-source-card";
import { OpenSourceCardPreview } from "./open-source-card-preview";
import { OpenSourceSheet } from "./open-source-sheet";

/** Keep the URL in sync with the selected card without a full navigation. */
function syncUrl(id: string | null) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", id ? `/open-source/${id}` : "/open-source");
}

export function OpenSourceGallery({
  initial,
  selectedId: initialSelectedId,
}: {
  initial: OpenSourceCardRow[];
  selectedId?: string;
}) {
  const { effectiveAccessLevel } = useAuth();
  const canManage = hasMinAccessLevel(effectiveAccessLevel, "admin");

  const { cards, create, patch, remove } = useOpenSource(initial);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<OpenSourceCardRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // Only honor a deep-linked id that actually exists.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && initial.some((c) => c.id === initialSelectedId)
      ? initialSelectedId
      : null,
  );

  // On desktop the detail panel always shows something (falls back to the
  // first card); on mobile it only opens once a card is explicitly selected.
  const detailCard = cards.find((c) => c.id === selectedId) ?? cards[0] ?? null;
  const detailOpen = selectedId !== null;

  function select(card: OpenSourceCardRow) {
    setSelectedId(card.id);
    syncUrl(card.id);
  }

  function backToList() {
    setSelectedId(null);
    syncUrl(null);
  }

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
        if (selectedId === card.id) backToList();
      },
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
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
        <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-6">
          {/* Master list — hidden on mobile while a card is open */}
          <aside
            className={cn(
              "lg:sticky lg:top-6 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto",
              detailOpen ? "hidden lg:block" : "block",
            )}
          >
            <div className="space-y-2 lg:pr-1">
              {cards.map((card) => (
                <OpenSourceCardPreview
                  key={card.id}
                  card={card}
                  selected={detailCard?.id === card.id}
                  canManage={canManage}
                  onSelect={select}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </aside>

          {/* Detail panel */}
          <div className={cn("min-w-0", detailOpen ? "block" : "hidden lg:block")}>
            {detailCard ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={backToList}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
                  >
                    <ArrowLeft className="size-4" />
                    Lista
                  </button>
                  {canManage ? (
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(detailCard)}
                      >
                        <Pencil className="mr-1 size-3.5" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(detailCard)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        Excluir
                      </Button>
                    </div>
                  ) : null}
                </div>
                <OpenSourceCard card={detailCard} />
              </div>
            ) : null}
          </div>
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
