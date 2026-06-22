"use client";

import { useMemo } from "react";
import { CornerDownRight } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { ClientLogo } from "@/app/(dashboard)/clients/[id]/_components/client-logo";
import { Cronograma, type CronogramaBlock } from "@/components/timeline/cronograma";
import { fmtDayMonth } from "@/lib/date-utils";
import type { WikiMetrics } from "@/lib/dal/wiki-metrics";

/**
 * Introdução executiva da Wiki (WER-003): cliente + projeto + status/fase +
 * objetivo (vision da DS, com fonte) + cronograma de blocos reusando
 * Cronograma (1 bloco por sprint, cor = atividade). Determinístico:
 * renderiza antes de qualquer "Gerar Wiki".
 */

const PHASE_LABELS: Record<string, string> = {
  commercial: "Comercial",
  immersion: "Imersão",
  ops: "Operação",
  post_ops: "Pós-operação",
};

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** "2026-05-12" → "12 mai 2026". Null → null. */
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  const day = d.slice(8, 10);
  const month = MONTHS_PT[Number(d.slice(5, 7)) - 1];
  const year = d.slice(0, 4);
  if (!day || !month || !year) return null;
  return `${Number(day)} ${month} ${year}`;
}

export type WikiObjective = {
  text: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
} | null;

export function WikiIdentity({
  identity,
  sprints,
  objective,
}: {
  identity: WikiMetrics["identity"];
  sprints: WikiMetrics["sprints"];
  objective: WikiObjective;
}) {
  const { blocks, currentKey } = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const sorted = [...sprints].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );
    const list: CronogramaBlock[] = sorted.map((s, i) => {
      const start = s.startDate.slice(0, 10);
      const end = s.endDate.slice(0, 10);
      const kind =
        today < start ? "future" : today > end ? "past" : "current";
      return {
        key: s.id,
        indicator: String(i + 1),
        dateLabel: fmtDayMonth(start),
        kind,
        logCount: s.doneTaskCount,
        value: s.doneTaskCount > 0 ? String(s.doneTaskCount) : undefined,
        title: `${s.name} · ${s.doneTaskCount} entregue${s.doneTaskCount === 1 ? "" : "s"}`,
      };
    });
    return {
      blocks: list,
      currentKey: list.find((b) => b.kind === "current")?.key ?? null,
    };
  }, [sprints]);

  const phase = PHASE_LABELS[identity.phase] ?? identity.phase;
  const startLabel = fmtDate(identity.startDate);
  const endLabel = fmtDate(identity.endDate);

  return (
    <section className="surface px-4 py-3">
      <div className="flex items-start gap-3">
        <ClientLogo
          name={identity.clientName}
          logoStoragePath={identity.clientLogoPath}
          logoUpdatedAt={identity.clientLogoUpdatedAt}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-muted-foreground">
            Cliente · {identity.clientName}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold leading-tight tracking-tight">
              {identity.projectName}
            </h2>
            {identity.status && (
              <StatusChip
                tone={identity.status === "active" ? "green" : "muted"}
                dot
              >
                {identity.status}
              </StatusChip>
            )}
            {phase && (
              <StatusChip tone="blue" variant="subtle">
                {phase}
              </StatusChip>
            )}
          </div>
        </div>
      </div>

      {/* Objetivo (vision da DS) */}
      <div className="mt-3 border-t border-border pt-3">
        {objective ? (
          <>
            <p className="text-sm">
              <span className="font-medium">Objetivo. </span>
              {objective.text}
            </p>
            {objective.sourceLabel && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <CornerDownRight className="h-3 w-3" />
                {objective.sourceUrl ? (
                  <a
                    href={objective.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate hover:underline"
                  >
                    {objective.sourceLabel}
                  </a>
                ) : (
                  <span className="truncate">{objective.sourceLabel}</span>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Objetivo aparece ao aprovar uma DS de Inception.
          </p>
        )}
      </div>

      {/* Cronograma de blocos + linha do tempo */}
      {blocks.length > 0 && (
        <div className="mt-3">
          <Cronograma
            shape="chip"
            layout="wrap"
            collapsible={{ previewCount: 8 }}
            blocks={blocks}
            selectedKey={currentKey}
          />
          {(startLabel || endLabel) && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {startLabel ? (
                  <>
                    Início · <b className="font-semibold text-foreground">{startLabel}</b>
                  </>
                ) : (
                  "em andamento"
                )}
              </span>
              {endLabel && (
                <span>
                  Entrega prevista ·{" "}
                  <b className="font-semibold text-foreground">{endLabel}</b>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
