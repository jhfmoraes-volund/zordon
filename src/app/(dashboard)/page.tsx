import { requireMinLevel } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { fmtDate } from "@/lib/date-utils";
import { OverviewTabs, type OverviewTab } from "@/components/overview/overview-tabs";
import { OperacaoView } from "@/components/overview/operacao-view";
import { ProjetosView } from "@/components/overview/projetos-view";

export const dynamic = "force-dynamic";

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const end = startOfWeek(date);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireMinLevel(MANAGER, { redirectTo: "/projects" });
  const sp = await searchParams;
  const tab: OverviewTab = sp?.tab === "ops" ? "ops" : "projetos";

  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Semana de {fmtDate(weekStart)} a {fmtDate(weekEnd)}
        </p>
      </div>

      <OverviewTabs current={tab} />

      {tab === "projetos" ? <ProjetosView /> : <OperacaoView />}
    </div>
  );
}
