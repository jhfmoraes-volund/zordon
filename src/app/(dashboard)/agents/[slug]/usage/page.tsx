import { loadUsageWindow, WINDOWS, type Window } from "@/lib/agent/usage-aggregation";
import { AgentUsageDashboard, isWindow } from "@/components/admin/agent-usage/dashboard";
import { WindowTabs } from "@/components/admin/agent-usage/window-tabs";

export const dynamic = "force-dynamic";

export default async function AgentUsageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const window: Window = isWindow(sp.window) ? sp.window : "7d";
  const data = await loadUsageWindow({ window, agentFilter: slug });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Custos do agente</h2>
          <p className="text-sm text-muted-foreground">
            Tokens, custo USD, cache savings e latência. Janela: {WINDOWS[window].label.toLowerCase()}.
          </p>
        </div>
        <WindowTabs current={window} basePath={`/agents/${slug}/usage`} />
      </div>

      <AgentUsageDashboard
        data={data}
        spec={WINDOWS[window]}
        hideAgentBreakdown
      />
    </div>
  );
}
