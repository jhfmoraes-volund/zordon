"use client";

import Link from "next/link";
import { ArrowLeft, Check, FileText, Loader2, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import { fmtDate } from "@/lib/date-utils";
import { InsumosButton } from "@/components/agent/context-import";

type ReleaseStatus =
  | "draft"
  | "orchestrating"
  | "in-review"
  | "approved"
  | "aborted"
  | "error";

const STATUS_LABEL: Record<ReleaseStatus, string> = {
  draft: "Rascunho",
  orchestrating: "Orquestrando",
  "in-review": "Em revisão",
  approved: "Aprovado",
  aborted: "Abortado",
  error: "Erro",
};

function tone(s: ReleaseStatus): ChipTone {
  if (s === "approved") return "green";
  if (s === "error" || s === "aborted") return "red";
  if (s === "orchestrating") return "amber";
  return "blue";
}

type Props = {
  title: string;
  status: ReleaseStatus;
  scheduledFor: string | null;
  sprintCount: number;
  prdCount: number;
  insumoCount: number;
  facilitatorName: string | null;
  backHref: string;
  orchestrating: boolean;
  approving: boolean;
  onOrchestrate: () => void;
  onApprove: () => void;
  onOpenContext: () => void;
  onLinkPrd: () => void;
  onEdit: () => void;
};

/**
 * Cabeçalho do Release Planning. Espelha a PlanningRibbon: back, título, status,
 * InsumosButton, edit, + ações de modo (Gerar plano = automático / Aprovar).
 */
export function ReleasePlanningRibbon({
  title,
  status,
  scheduledFor,
  sprintCount,
  prdCount,
  insumoCount,
  facilitatorName,
  backHref,
  orchestrating,
  approving,
  onOrchestrate,
  onApprove,
  onOpenContext,
  onLinkPrd,
  onEdit,
}: Props) {
  const isApproved = status === "approved";
  const isOrchestrating = status === "orchestrating";

  return (
    <div className="shrink-0 border-b bg-background px-6 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={backHref}>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold truncate">{title}</h1>
          {scheduledFor && (
            <p className="text-xs text-muted-foreground">{fmtDate(scheduledFor)}</p>
          )}
        </div>

        <StatusChip tone={tone(status)} label={STATUS_LABEL[status]} dot />

        {!isApproved && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            className="h-8 w-8 p-0"
            title="Editar Release Planning"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}

        {!isApproved && (
          <Button size="sm" variant="outline" className="h-8" onClick={onLinkPrd}>
            <FileText className="h-3.5 w-3.5" />
            Vincular PRD
          </Button>
        )}

        <InsumosButton
          count={insumoCount}
          onClick={onOpenContext}
          variant="outline"
          className="h-8"
        />

        {status === "draft" && (
          <Button size="sm" disabled={orchestrating} onClick={onOrchestrate}>
            {orchestrating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Gerar plano
          </Button>
        )}

        {status === "in-review" && (
          <Button size="sm" disabled={approving} onClick={onApprove}>
            {approving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Aprovar
          </Button>
        )}

        {isOrchestrating && (
          <Button size="sm" disabled>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Orquestrando…
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>
          <strong className="font-mono tabular-nums text-foreground">{sprintCount}</strong>{" "}
          sprints
        </span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span>
          <strong className="font-mono tabular-nums text-foreground">{prdCount}</strong> PRD
          {prdCount === 1 ? "" : "s"}
        </span>
        {insumoCount > 0 && (
          <>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span>
              {insumoCount} insumo{insumoCount === 1 ? "" : "s"}
            </span>
          </>
        )}
        {facilitatorName && (
          <>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span>Facilitador: {facilitatorName}</span>
          </>
        )}
      </div>
    </div>
  );
}
