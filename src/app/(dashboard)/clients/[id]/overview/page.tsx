"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderKanban, Lightbulb, MessageSquareHeart, StickyNote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { ClientInsightsCard } from "@/components/insights/client-insights-card";
import { useClientContext } from "../_context/client-context";

type Counts = {
  projects: number;
  csat: number;
  opportunities: number;
  csatAvg: number | null;
};

export default function OverviewPage() {
  const { client, clientId, canSeeInsights, loading: clientLoading } =
    useClientContext();
  const supabase = useMemo(() => createClient(), []);
  const [counts, setCounts] = useState<Counts | null>(null);

  const load = useCallback(async () => {
    const [projectsRes, csatRes, oppRes, csatScoresRes] = await Promise.all([
      supabase
        .from("Project")
        .select("id", { count: "exact", head: true })
        .eq("clientId", clientId),
      supabase
        .from("CsatResponse")
        .select("id", { count: "exact", head: true })
        .eq("clientId", clientId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
      supabase.from("Opportunity" as any)
        .select("id", { count: "exact", head: true })
        .eq("clientId", clientId),
      supabase
        .from("CsatResponse")
        .select("csatScore")
        .eq("clientId", clientId),
    ]);

    const scores = ((csatScoresRes.data ?? []) as Array<{ csatScore: number }>)
      .map((r) => r.csatScore)
      .filter((n) => typeof n === "number");
    const csatAvg = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

    setCounts({
      projects: projectsRes.count ?? 0,
      csat: csatRes.count ?? 0,
      opportunities: oppRes.count ?? 0,
      csatAvg,
    });
  }, [clientId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data loading pattern
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {clientLoading || !client ? (
        <Skeleton className="h-20" />
      ) : client.notes ? (
        <div className="surface p-4 flex gap-3 text-sm">
          <StickyNote className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="whitespace-pre-wrap text-muted-foreground">
            {client.notes}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<FolderKanban className="h-4 w-4" />}
          label="Projetos"
          value={counts?.projects ?? null}
        />
        <KpiCard
          icon={<MessageSquareHeart className="h-4 w-4" />}
          label="Entrevistas CSAT"
          value={counts?.csat ?? null}
        />
        <KpiCard
          icon={<Lightbulb className="h-4 w-4" />}
          label="Oportunidades"
          value={counts?.opportunities ?? null}
        />
        <KpiCard
          icon={<MessageSquareHeart className="h-4 w-4" />}
          label="CSAT médio"
          value={
            counts?.csatAvg == null
              ? null
              : counts.csatAvg.toFixed(1)
          }
          suffix={counts?.csatAvg == null ? null : "/10"}
        />
      </div>

      {canSeeInsights ? <ClientInsightsCard clientId={clientId} /> : null}
    </div>
  );
}

type KpiCardProps = {
  icon: React.ReactNode;
  label: string;
  value: number | string | null;
  suffix?: string | null;
};

function KpiCard({ icon, label, value, suffix }: KpiCardProps) {
  return (
    <div className="surface p-4 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {value === null ? (
        <Skeleton className="h-7 w-12" />
      ) : (
        <div className="text-2xl font-semibold tabular-nums">
          {value}
          {suffix ? (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
