import Link from "next/link";
import { Bot, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AGENT_SETTINGS_REGISTRY } from "@/lib/agent/settings-registry";
import { AgentBadge } from "@/components/ui/conversation";
import type { AgentOverviewRow } from "@/lib/agent/usage-aggregation";
import { fmtUsd, fmtPct, delta, fmtDelta } from "./format";

export type AgentRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  modelId: string;
  isActive: boolean;
  updatedAt: string;
};

function AgentSlugBadge({ slug, name }: { slug: string; name: string }) {
  if (slug === "ops" || slug === "alpha")
    return <AgentBadge agent="alpha" size="md" label={name} />;
  if (slug === "design-session" || slug === "vitor")
    return <AgentBadge agent="vitor" size="md" label={name} />;
  return (
    <span className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground/90">
      <Bot className="h-4 w-4 text-muted-foreground" />
      {name}
    </span>
  );
}

function overviewKeyFor(slug: string): string {
  // Map UI slug → agentName used in AgentUsage. /ops uses agentName "alpha".
  if (slug === "ops") return "alpha";
  if (slug === "design-session") return "vitor";
  return slug;
}

function CostStrip({ overview }: { overview: AgentOverviewRow | undefined }) {
  if (!overview) {
    return (
      <div className="text-[11px] text-muted-foreground tabular-nums">
        Sem chamadas nos últimos 7 dias.
      </div>
    );
  }
  const d = delta(overview.costUsd, overview.costUsdPrev);
  const trend =
    d === null ? null : d > 0 ? "up" : "down";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
      <div className="flex flex-col leading-tight">
        <span className="text-base font-semibold tabular-nums">
          {fmtUsd(overview.costUsd)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          7d · {overview.callsCurr} calls
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 leading-tight">
        {trend && (
          <span
            className={
              "inline-flex items-center gap-1 text-[11px] tabular-nums " +
              (trend === "up" ? "text-orange-500" : "text-emerald-500")
            }
          >
            {trend === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {fmtDelta(d)}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          cache {fmtPct(overview.cacheRatio)}
        </span>
      </div>
    </div>
  );
}

type Props = {
  agents: AgentRow[];
  overview?: Map<string, AgentOverviewRow>;
};

export function AgentsList({ agents, overview }: Props) {
  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum agente ativo.</p>;
  }

  const sorted = overview
    ? [...agents].sort((a, b) => {
        const ca = overview.get(overviewKeyFor(a.slug))?.costUsd ?? -1;
        const cb = overview.get(overviewKeyFor(b.slug))?.costUsd ?? -1;
        return cb - ca;
      })
    : agents;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((a) => {
        const hasSchema = Boolean(AGENT_SETTINGS_REGISTRY[a.slug]);
        const ov = overview?.get(overviewKeyFor(a.slug));
        return (
          <Link key={a.id} href={`/agents/${a.slug}/usage`} className="group">
            <Card className="transition-colors group-hover:border-primary/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <AgentSlugBadge slug={a.slug} name={a.name} />
                    <p className="text-xs text-muted-foreground truncate font-mono pl-0.5">{a.slug}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
                <CostStrip overview={ov} />
                {a.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{a.description}</p>
                )}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-mono truncate">{a.modelId.replace(/^anthropic\//, "")}</span>
                  <span className={hasSchema ? "text-emerald-500" : "text-amber-500"}>
                    {hasSchema ? "tunável" : "sem schema"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
