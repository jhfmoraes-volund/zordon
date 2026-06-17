"use client";

import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenSourceCardRow } from "@/lib/dal/open-source";
import { OpenSourcePhoto } from "./open-source-photo";

function formatArchive(n: number): string {
  return `#${String(n).padStart(3, "0")}`;
}

type Props = {
  card: OpenSourceCardRow;
  selected: boolean;
  canManage: boolean;
  onSelect: (card: OpenSourceCardRow) => void;
  onEdit: (card: OpenSourceCardRow) => void;
  onDelete: (card: OpenSourceCardRow) => void;
};

/**
 * Compact, selectable row used in the master list (left column) of the
 * Open Source gallery. Selecting it opens the full card in the detail panel.
 */
export function OpenSourceCardPreview({
  card,
  selected,
  canManage,
  onSelect,
  onEdit,
  onDelete,
}: Props) {
  const isTemp = card.id.startsWith("os-tmp-");

  return (
    <div className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        disabled={isTemp}
        onClick={() => onSelect(card)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border p-3 text-left text-white transition-colors",
          selected
            ? "border-brand/50 bg-brand/10"
            : "border-white/10 bg-[#0a0a0b] hover:border-white/25 hover:bg-white/[0.03]",
          isTemp && "pointer-events-none opacity-60",
        )}
      >
        <OpenSourcePhoto
          name={card.name}
          photoStoragePath={card.photoStoragePath}
          photoUpdatedAt={card.photoUpdatedAt}
          className="size-11 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-brand/70">
            {formatArchive(card.archiveNumber)}
          </span>
          <h3 className="truncate text-sm font-semibold leading-tight">
            {card.name}
          </h3>
          {card.title ? (
            <p className="truncate font-mono text-[11px] text-white/45">
              {`// ${card.title}`}
            </p>
          ) : null}
        </div>
      </button>

      {canManage && !isTemp ? (
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label="Editar card"
            onClick={() => onEdit(card)}
            className="rounded-md border border-white/15 bg-black/60 p-1.5 text-white/70 backdrop-blur hover:text-white"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Excluir card"
            onClick={() => onDelete(card)}
            className="rounded-md border border-white/15 bg-black/60 p-1.5 text-white/70 backdrop-blur hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
