"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenSourceCardRow } from "@/lib/dal/open-source";
import { OpenSourcePhoto } from "./open-source-photo";

function formatArchive(n: number): string {
  return `#${String(n).padStart(3, "0")}`;
}

type Props = {
  card: OpenSourceCardRow;
  canManage: boolean;
  onEdit: (card: OpenSourceCardRow) => void;
  onDelete: (card: OpenSourceCardRow) => void;
};

export function OpenSourceCardPreview({
  card,
  canManage,
  onEdit,
  onDelete,
}: Props) {
  const isTemp = card.id.startsWith("os-tmp-");

  return (
    <div className="group relative">
      <Link
        href={isTemp ? "#" : `/open-source/${card.id}`}
        className={cn(
          "block h-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0b] p-5 text-white transition-colors hover:border-brand/40",
          isTemp && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand/70">
            Arquivo {formatArchive(card.archiveNumber)}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
            {card.category}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <OpenSourcePhoto
            name={card.name}
            photoStoragePath={card.photoStoragePath}
            photoUpdatedAt={card.photoUpdatedAt}
            className="size-16"
          />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold">{card.name}</h3>
            {card.title ? (
              <p className="truncate font-mono text-xs text-white/45">
                {`// ${card.title}`}
              </p>
            ) : null}
          </div>
        </div>

        {card.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {card.tags.slice(0, 4).map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-white/70"
              >
                {t}
              </span>
            ))}
            {card.tags.length > 4 ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] text-white/35">
                +{card.tags.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}
      </Link>

      {canManage && !isTemp ? (
        <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
