import type { Window, WindowData, WindowSpec } from "@/lib/agent/usage-aggregation";
import { KpiTile } from "./kpi-tile";
import { TimeseriesChart } from "./timeseries-chart";
import { BreakdownTable } from "./breakdown-table";
import { TopSessionsCard, TopCallsCard } from "./outliers";
import { fmtUsd, fmtCompactInt, fmtMs, delta, fmtPct } from "./format";

type Props = {
  data: WindowData;
  spec: WindowSpec;
  /** When filtered to a single agent, omit the "Por agente" breakdown (redundant). */
  hideAgentBreakdown?: boolean;
};

export function AgentUsageDashboard({ data, spec, hideAgentBreakdown = false }: Props) {
  const totalCost = data.totals.costUsd;
  const cacheRatio = data.totals.inputTokens > 0
    ? data.totals.cachedInputTokens / data.totals.inputTokens
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Custo total"
          value={fmtUsd(totalCost)}
          sublabel={`${data.totals.calls} chamadas · ${data.sessionCount} sessões`}
          delta={delta(totalCost, data.totalsPrev.costUsd)}
          spark={data.series.map((p) => ({ bucket: p.bucket, costUsd: p.costUsd }))}
          sparkColor="hsl(220, 70%, 60%)"
        />
        <KpiTile
          label="Economia por cache"
          value={fmtUsd(data.cacheSavedUsd)}
          sublabel={`${fmtPct(cacheRatio)} dos input tokens (${fmtCompactInt(data.totals.cachedInputTokens)})`}
          sparkColor="hsl(150, 60%, 50%)"
        />
        <KpiTile
          label="Custo médio"
          value={fmtUsd(data.avgCostPerCall, { precision: 4 })}
          sublabel={`por chamada · ${fmtUsd(data.avgCostPerSession)} por sessão`}
          delta={delta(
            data.avgCostPerCall,
            data.totalsPrev.calls > 0 ? data.totalsPrev.costUsd / data.totalsPrev.calls : 0,
          )}
        />
        <KpiTile
          label="Latência"
          value={fmtMs(data.latency.p50)}
          sublabel={`p50 · p95 ${fmtMs(data.latency.p95)} · avg ${fmtMs(data.latency.avg)}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Input tokens"
          value={fmtCompactInt(data.totals.inputTokens)}
          sublabel={`${fmtCompactInt(data.totals.cachedInputTokens)} cached`}
        />
        <KpiTile
          label="Output tokens"
          value={fmtCompactInt(data.totals.outputTokens)}
          sublabel={
            data.totals.reasoningTokens > 0
              ? `${fmtCompactInt(data.totals.reasoningTokens)} reasoning`
              : "0 reasoning"
          }
        />
        <KpiTile
          label="Modelos ativos"
          value={data.byModel.length.toString()}
          sublabel={data.byModel[0]?.label ?? "—"}
        />
        <KpiTile
          label={hideAgentBreakdown ? "Tipos de chamada" : "Agentes ativos"}
          value={(hideAgentBreakdown ? data.byCallKind.length : data.byAgent.length).toString()}
          sublabel={(hideAgentBreakdown ? data.byCallKind[0] : data.byAgent[0])?.label ?? "—"}
        />
      </div>

      <TimeseriesChart
        bucket={spec.bucket}
        byAgent={data.stackedByAgent}
        byModel={data.stackedByModel}
        byCallKind={data.stackedByCallKind}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownTable title="Por modelo" rows={data.byModel} totalCost={totalCost} />
        {!hideAgentBreakdown && (
          <BreakdownTable title="Por agente" rows={data.byAgent} totalCost={totalCost} />
        )}
        <BreakdownTable title="Por tipo de chamada" rows={data.byCallKind} totalCost={totalCost} />
        <BreakdownTable
          title="Por projeto"
          rows={data.byProject}
          totalCost={totalCost}
          showCache={false}
        />
      </div>

      <BreakdownTable
        title="Por member"
        rows={data.byMember}
        totalCost={totalCost}
        showCache={false}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopSessionsCard sessions={data.topSessions} />
        <TopCallsCard calls={data.topCalls} />
      </div>
    </div>
  );
}

export function isWindow(value: string | undefined): value is Window {
  return value === "24h" || value === "7d" || value === "30d";
}
