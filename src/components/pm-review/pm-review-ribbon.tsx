"use client";

import Link from "next/link";
import { ArrowLeft, ChartLine, Edit3, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { InsumosButton } from "@/components/agent/context-import";
import { fmtWeek } from "@/lib/date-utils";

type PMReviewStatus = "draft" | "published" | "archived";

type Props = {
  status: PMReviewStatus;
  referenceWeek: string;
  publishedAt: string | null;
  linkedMeetingCount: number;
  linkedTranscriptCount: number;
  noteTotal: number;
  reportGenerated: boolean;
  backHref: string;
  busy?: boolean;
  onEdit?: () => void;
  onPublish?: () => void;
  onOpenContext?: () => void;
};

const STATUS_LABEL: Record<PMReviewStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

const STATUS_TONE: Record<PMReviewStatus, "blue" | "green" | "muted"> = {
  draft: "blue",
  published: "green",
  archived: "muted",
};

export function PMReviewRibbon({
  status,
  referenceWeek,
  publishedAt,
  linkedMeetingCount,
  linkedTranscriptCount,
  noteTotal,
  reportGenerated,
  backHref,
  busy = false,
  onEdit,
  onPublish,
  onOpenContext,
}: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Link
        href={backHref}
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
        aria-label="Voltar"
      >
        <ArrowLeft className="size-4" />
      </Link>

      <div className="flex min-w-0 items-center gap-2">
        <ChartLine className="size-4 text-violet-600 dark:text-violet-300" />
        <span className="truncate text-sm font-semibold">PM Review</span>
        <span className="text-sm text-muted-foreground">·</span>
        <span className="truncate text-sm text-muted-foreground">
          {fmtWeek(referenceWeek)}
        </span>
        <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
        {publishedAt && status === "published" && (
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            · publicado {new Date(publishedAt).toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <InsumosButton
          count={linkedMeetingCount + linkedTranscriptCount}
          onClick={() => onOpenContext?.()}
          variant="outline"
        />

        <span
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
          title="Notes ativas (não-dismissed)"
        >
          <span className="font-mono tabular-nums">{noteTotal}</span>
          <span className="hidden sm:inline text-muted-foreground">notas</span>
        </span>

        {reportGenerated && (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400">
            <ChartLine className="size-3" /> report sintetizado
          </span>
        )}

        {onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
            <Edit3 className="size-3.5" /> Editar
          </Button>
        )}

        {status === "draft" && onPublish && (
          <Button size="sm" onClick={onPublish} disabled={busy}>
            <Send className="size-3.5" />
            {busy ? "Publicando…" : "Publicar"}
          </Button>
        )}
      </div>
    </header>
  );
}
