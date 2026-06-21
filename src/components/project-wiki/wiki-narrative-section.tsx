"use client";

import { CornerDownRight, EyeOff, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isSuppressed, type SuppressedEntry } from "@/lib/wiki/suppressed";
import type { WikiBullet } from "@/lib/wiki/schemas";

/**
 * Seção narrativa da Wiki (PRD §9): bullets com "↳ fonte" clicável + menu ⋯
 * "Ocultar bullet" (suppress, D2 — única edição humana). Bullets supressos
 * somem antes do render; voltam quando a fonte muda (hash novo).
 */

export type WikiSectionView = {
  id: string;
  sectionKey: string;
  title: string;
  data: unknown;
  suppressed: SuppressedEntry[];
  generatedAt: string | null;
  generatedBy: string | null;
  sources: Array<{
    bulletHash: string;
    sourceType: string;
    sourceId: string;
    title: string | null;
    url: string | null;
  }>;
};

type LabeledBullet = WikiBullet & { label?: string; date?: string | null };

const SOURCE_TYPE_LABELS: Record<string, string> = {
  meeting: "meeting",
  design_session: "DS",
  task: "task",
  sprint: "sprint",
  pm_review: "PM review",
  context_source: "doc",
};

/** Achata o data persistido da seção em bullets renderizáveis, por key. */
function extractBullets(section: WikiSectionView): LabeledBullet[] {
  const data = (section.data ?? {}) as Record<string, unknown>;
  if (section.sectionKey === "objectives") {
    // 'vision' sobe pro header (WikiIdentity, D6) — aqui só problema + sinais.
    const out: LabeledBullet[] = [];
    const problem = data.problem as WikiBullet | null;
    if (problem?.bulletHash) out.push({ ...problem, label: "Problema" });
    for (const s of (data.success_signals as WikiBullet[]) ?? []) {
      if (s?.bulletHash) out.push({ ...s, label: "Sinal de sucesso" });
    }
    return out;
  }
  return (((data.bullets as LabeledBullet[]) ?? []) as LabeledBullet[]).filter(
    (b) => b?.bulletHash
  );
}

export function WikiNarrativeSection({
  section,
  emptyHint,
  canSuppress,
  onSuppress,
}: {
  section: WikiSectionView;
  emptyHint: string;
  canSuppress: boolean;
  onSuppress: (bulletHash: string) => void;
}) {
  const bullets = extractBullets(section).filter(
    (b) => !isSuppressed(b, section.suppressed)
  );

  return (
    <section className="surface space-y-2 px-4 py-3">
      <h3 className="text-sm font-semibold">{section.title}</h3>
      {bullets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul className="space-y-2">
          {bullets.map((b) => {
            const source = section.sources.find(
              (s) => s.bulletHash === b.bulletHash
            );
            const sourceLabel = source
              ? (source.title ??
                SOURCE_TYPE_LABELS[source.sourceType] ??
                source.sourceType)
              : null;
            return (
              <li key={b.bulletHash} className="group flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {b.label && (
                      <span className="font-medium">{b.label}: </span>
                    )}
                    {b.text}
                    {b.date && (
                      <span className="text-muted-foreground"> ({b.date})</span>
                    )}
                  </p>
                  {sourceLabel && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CornerDownRight className="h-3 w-3" />
                      {source?.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:underline"
                        >
                          {sourceLabel}
                        </a>
                      ) : (
                        <span className="truncate">{sourceLabel}</span>
                      )}
                    </p>
                  )}
                </div>
                {canSuppress && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[popup-open]:opacity-100"
                          title="Ações do bullet"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onSuppress(b.bulletHash)}>
                        <EyeOff className="h-3.5 w-3.5" />
                        Ocultar bullet
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
