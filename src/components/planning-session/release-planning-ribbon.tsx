"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Radio, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import { fmtDate } from "@/lib/date-utils";
import { InsumosButton } from "@/components/agent/context-import";

type Props = {
  title: string;
  /** Fase DERIVADA (planner vivo): Rascunho / Em staging / Aplicado / … */
  phaseLabel: string;
  phaseTone: ChipTone;
  scheduledFor: string | null;
  sprintCount: number;
  /** Counts do painel — alimentam o subtítulo (sem "0 PRDs"). */
  pendingCount: number;
  /** Tasks no board vivo (Fase 2.0). */
  planCount: number;
  doneCount: number;
  insumoCount: number;
  backHref: string;
  /** Chat streaming → desabilita "Montar plano". */
  busy: boolean;
  /** Sessão legada aprovada (read-only). */
  readOnly: boolean;
  /** Navegando uma versão antiga no cronograma → canvas/chat congelados. */
  historyMode: boolean;
  onMontar: () => void;
  onOpenContext: () => void;
  onEdit: () => void;
  /** Sai do modo histórico → volta ao plano vivo. */
  onExitHistory: () => void;
};

/**
 * Cabeçalho do Release Planning. PRD↔sprint board saiu (2026-06-19): a planning
 * LÊ fontes (insumos + PRDs) e produz tasks/stories. O header reflete isso —
 * fase derivada dos counts (não mais o status PRD), "Montar plano" (pede pra
 * Vitoria sintetizar das fontes), sem "Vincular PRD" nem "Aprovar".
 */
export function ReleasePlanningRibbon({
  title,
  phaseLabel,
  phaseTone,
  scheduledFor,
  sprintCount,
  pendingCount,
  planCount,
  doneCount,
  insumoCount,
  backHref,
  busy,
  readOnly,
  historyMode,
  onMontar,
  onOpenContext,
  onEdit,
  onExitHistory,
}: Props) {
  const stats = [
    `${sprintCount} sprint${sprintCount === 1 ? "" : "s"}`,
    pendingCount > 0 ? `${pendingCount} em staging` : null,
    planCount > 0 ? `${planCount} no plano` : null,
    doneCount > 0 ? `${doneCount} entregue${doneCount === 1 ? "" : "s"}` : null,
    insumoCount > 0 ? `${insumoCount} insumo${insumoCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];

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

        <StatusChip
          tone={historyMode ? "amber" : phaseTone}
          label={historyMode ? "Histórico" : phaseLabel}
          dot
        />

        {historyMode ? (
          // Modo histórico: única ação é voltar ao plano vivo. Edit/Montar somem
          // (canvas + chat estão congelados).
          <Button
            size="sm"
            onClick={onExitHistory}
            title="Sair do histórico e voltar ao plano vivo"
          >
            <Radio className="mr-1.5 h-3.5 w-3.5" />
            Ao vivo
          </Button>
        ) : (
          <>
            {!readOnly && (
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

            <InsumosButton
              count={insumoCount}
              onClick={onOpenContext}
              variant="outline"
              className="h-8"
            />

            {!readOnly && (
              <Button size="sm" disabled={busy} onClick={onMontar} title="Vitoria lê as fontes (insumos + PRDs) e propõe as tasks">
                {busy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Montar plano
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {stats.map((s, i) => (
          <span key={s} className="flex items-center gap-3">
            {i > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
