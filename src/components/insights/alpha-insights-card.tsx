"use client";

// AlphaInsightsCard
//
// Renders the latest ProjectInsight for a project: two side-by-side blocks
// (Relational + Technical), each with a health chip, summary, and a list of
// signals/risks + watch points. Subscribed to realtime so a fresh insight
// generation reflects without page refresh.
//
// Gating: parent must decide whether to render this card (canEditTasks).
// We don't enforce here — see /api/projects/[id]/insights for the API gate.

import { useEffect, useState, useTransition } from "react";
import { RefreshCw, Heart, Settings2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChipTone } from "@/lib/status-chips";
import type {
  RelationalAnalysis,
  TechnicalAnalysis,
  HealthLevel,
} from "@/lib/insights/schemas";

type Insight = Tables<"ProjectInsight">;
type Job = Pick<Tables<"InsightJob">, "id" | "status" | "source" | "createdAt">;

type LoadResponse = {
  insight: Insight | null;
  pendingJob: Job | null;
};

const HEALTH_TONE: Record<HealthLevel, ChipTone> = {
  healthy: "green",
  watch: "amber",
  at_risk: "amber",
  critical: "red",
};

const HEALTH_LABEL: Record<HealthLevel, string> = {
  healthy: "saudável",
  watch: "observar",
  at_risk: "em risco",
  critical: "crítico",
};

function timeAgoPt(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function AlphaInsightsCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<LoadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/insights`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setData({ insight: null, pendingJob: null });
        return;
      }
      const json = (await res.json()) as LoadResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const client = createClient();
    const channel = client
      .channel(`project-insights:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ProjectInsight",
          filter: `projectId=eq.${projectId}`,
        },
        () => load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "InsightJob",
          filter: `projectId=eq.${projectId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function rerun() {
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/insights/rerun`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Atualizando insights…");
        load();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        toast.error(body?.message ?? "Aguarde antes do próximo rerun");
      } else if (res.status === 409) {
        toast.info("Atualização já em andamento");
      } else {
        toast.error("Falha ao acionar rerun");
      }
    });
  }

  if (loading) {
    return (
      <Card size="sm" className="px-4 py-4">
        <Skeleton className="h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </Card>
    );
  }

  if (!data?.insight) {
    return (
      <Card size="sm" className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Alpha Insights</h2>
          <Button size="sm" variant="outline" onClick={rerun} disabled={pending}>
            <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
            Gerar agora
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Alpha ainda não analisou este projeto. A próxima execução automática roda às 07:00.
        </p>
      </Card>
    );
  }

  const insight = data.insight;
  const relational = parseRelational(insight);
  const technical = parseTechnical(insight);
  const generating = Boolean(data.pendingJob);

  return (
    <Card size="sm" className="px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Alpha Insights</h2>
          <span className="text-[11px] text-muted-foreground">
            {generating ? "atualizando…" : `atualizado ${timeAgoPt(insight.generatedAt)}`}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={rerun}
          disabled={pending || generating}
          title="Atualizar agora"
        >
          <RefreshCw
            className={`size-3.5 ${pending || generating ? "animate-spin" : ""}`}
          />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Block
          icon={<Heart className="size-4" />}
          title="Relacional"
          health={insight.relationalHealth as HealthLevel | null}
          summary={insight.relationalSummary}
          error={insight.errorRelational}
          items={relational.signals}
          itemsLabel="Sinais"
          watch={relational.watch}
        />
        <Block
          icon={<Settings2 className="size-4" />}
          title="Técnico"
          health={insight.technicalHealth as HealthLevel | null}
          summary={insight.technicalSummary}
          error={insight.errorTechnical}
          items={technical.risks}
          itemsLabel="Riscos"
          watch={technical.watch}
        />
      </div>
    </Card>
  );
}

// ─── Block ────────────────────────────────────────────────────────────────

type Item = { primary: string; secondary?: string; severity?: "low" | "medium" | "high" };

function Block({
  icon,
  title,
  health,
  summary,
  error,
  items,
  itemsLabel,
  watch,
}: {
  icon: React.ReactNode;
  title: string;
  health: HealthLevel | null;
  summary: string | null;
  error: string | null;
  items: Item[];
  itemsLabel: string;
  watch: Array<{ primary: string; secondary: string }>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{title}</span>
        </div>
        {health ? (
          <StatusChip tone={HEALTH_TONE[health]} dot>
            {HEALTH_LABEL[health]}
          </StatusChip>
        ) : (
          <StatusChip tone="muted">sem dado</StatusChip>
        )}
      </div>

      {error ? (
        <div className="flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600 dark:text-red-300">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>Falha na análise — exibindo snapshot anterior.</span>
        </div>
      ) : null}

      {summary ? (
        <p className="text-xs leading-relaxed text-foreground/90">{summary}</p>
      ) : null}

      {items.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {itemsLabel}
          </span>
          <ul className="flex flex-col gap-1">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                {item.severity ? (
                  <SeverityDot severity={item.severity} />
                ) : (
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                )}
                <div className="min-w-0">
                  <div className="text-foreground/90">{item.primary}</div>
                  {item.secondary ? (
                    <div className="text-muted-foreground">{item.secondary}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {watch.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Observar
          </span>
          <ul className="flex flex-col gap-1">
            {watch.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                <div className="min-w-0">
                  <div className="text-foreground/90">{w.primary}</div>
                  <div className="text-muted-foreground">{w.secondary}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SeverityDot({ severity }: { severity: "low" | "medium" | "high" }) {
  const tone =
    severity === "high"
      ? "bg-red-500"
      : severity === "medium"
        ? "bg-amber-500"
        : "bg-slate-400";
  return <span className={`mt-1 size-1.5 shrink-0 rounded-full ${tone}`} />;
}

// ─── Parsers (defensive) ──────────────────────────────────────────────────
//
// The DB columns are jsonb so we receive `unknown` at the type level. We
// don't re-validate with Zod here because run-job.ts already did at write
// time — but we tolerate empty/null arrays.

function parseRelational(insight: Insight): {
  signals: Item[];
  watch: Array<{ primary: string; secondary: string }>;
} {
  const raw = (insight.relationalSignals as RelationalAnalysis["signals"] | null) ?? [];
  const rawWatch = (insight.relationalWatch as RelationalAnalysis["watch"] | null) ?? [];
  return {
    signals: raw.map((s) => ({ primary: s.signal, secondary: s.evidence })),
    watch: rawWatch.map((w) => ({ primary: w.point, secondary: w.why })),
  };
}

function parseTechnical(insight: Insight): {
  risks: Item[];
  watch: Array<{ primary: string; secondary: string }>;
} {
  const raw = (insight.technicalRisks as TechnicalAnalysis["risks"] | null) ?? [];
  const rawWatch = (insight.technicalWatch as TechnicalAnalysis["watch"] | null) ?? [];
  return {
    risks: raw.map((r) => ({
      primary: r.risk,
      secondary: r.evidence,
      severity: r.severity,
    })),
    watch: rawWatch.map((w) => ({
      primary: `${w.metric}: ${w.value}`,
      secondary: w.why,
    })),
  };
}
