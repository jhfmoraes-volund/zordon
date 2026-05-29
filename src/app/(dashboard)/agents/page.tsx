import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";
import { loadUsageWindow, loadAgentsOverview, WINDOWS, type Window } from "@/lib/agent/usage-aggregation";
import { AgentUsageDashboard, isWindow } from "@/components/admin/agent-usage/dashboard";
import { WindowTabs } from "@/components/admin/agent-usage/window-tabs";
import { AgentsHeaderTabs } from "@/components/admin/agent-usage/agents-tabs";
import { AgentsList, type AgentRow } from "@/components/admin/agent-usage/agents-list";

export const dynamic = "force-dynamic";

type Tab = "list" | "costs";

function asTab(value: string | undefined): Tab {
  return value === "costs" ? "costs" : "list";
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; window?: string }>;
}) {
  const params = await searchParams;
  const tab = asTab(params.tab);
  const window: Window = isWindow(params.window) ? params.window : "7d";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Agentes"
          description="Parâmetros, custos e telemetria dos agentes."
        />
        {tab === "costs" && <WindowTabs current={window} extraQuery={{ tab: "costs" }} />}
      </div>

      <AgentsHeaderTabs current={tab} preserve={tab === "costs" ? { window } : undefined} />

      {tab === "costs" ? <CostsTab window={window} /> : <ListTab />}
    </div>
  );
}

async function CostsTab({ window }: { window: Window }) {
  const data = await loadUsageWindow(window);
  return <AgentUsageDashboard data={data} spec={WINDOWS[window]} />;
}

async function ListTab() {
  const supabase = await createClient();
  const [agentsRes, overview] = await Promise.all([
    supabase
      .from("Agent")
      .select("id, slug, name, description, modelId, isActive, updatedAt")
      .eq("isActive", true)
      .order("name", { ascending: true }),
    loadAgentsOverview(),
  ]);

  return <AgentsList agents={(agentsRes.data ?? []) as AgentRow[]} overview={overview} />;
}
