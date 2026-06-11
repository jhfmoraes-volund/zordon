import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users, FolderKanban, ListTodo, Zap,
  AlertTriangle, Clock, UserX, TrendingDown,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { OPEN_STATUSES } from "@/lib/function-points";
import { WeeklyAllocation } from "@/components/weekly-allocation";
import { TeamCapacityWidget } from "@/components/team-capacity-widget";
import type { SprintInput } from "@/lib/weekBuckets";
import { sprintWeekOf } from "@/lib/sprint-dates";
import { computeMetric, createMetricCtx } from "@/lib/metrics/compute";
import { getMetricDef } from "@/lib/metrics/registry";
import { computeAlerts } from "@/lib/metrics/alerts";

// ─── Row types (boundary casts — evita `any`) ─────────────

type MemberRow = {
  id: string;
  name: string;
  role: string;
  position: string;
  fpCapacity: number | null;
  squadMemberships: { squad: { name: string } }[];
};
type SprintRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  projectId: string;
  project: { id: string; name: string } | null;
};
type CapRow = { sprintId: string; capacity: number; planned: number; done: number; open: number };
type CommitmentRow = { id: string; committed: number };

// Ícone por alerta do ALERT_REGISTRY; fallback = AlertTriangle.
const ALERT_ICONS: Record<string, typeof AlertTriangle> = {
  "alert.tasks_overdue": Clock,
  "alert.tasks_unassigned": UserX,
  "alert.tasks_stuck": AlertCircle,
  "alert.builders_overbooked": TrendingDown,
  "alert.builders_idle": Users,
};

// ─── View ─────────────────────────────────────────────────

export async function OperacaoView() {
  const ctx = createMetricCtx();
  const supabase = ctx.supabase;
  const { monday: weekStart, sunday: weekEnd, nextMonday } = sprintWeekOf(new Date());

  // ─── Registry (D11) — número de fábrica + alertas, zero régua local ──

  const [linesActive, alerts] = await Promise.all([
    computeMetric(ctx, "factory.lines_active"),
    computeAlerts(ctx),
  ]);
  const activeAlerts = alerts.filter((a) => a.value.count > 0);

  // ─── Inventário de fluxo (counts crus — não são métricas do catálogo) ──

  const [activeSprintsRes, activeTasksRes, doneThisSprintRes] = await Promise.all([
    supabase.from("Sprint").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("Task").select("*", { count: "exact", head: true })
      .in("status", [...OPEN_STATUSES])
      .is("dismissedAt", null),
    supabase.from("Task").select("*", { count: "exact", head: true })
      .eq("status", "done")
      .is("dismissedAt", null)
      .gte("doneAt", weekStart.toISOString())
      .lt("doneAt", nextMonday.toISOString()),
  ]);

  // ─── Capacity do time — recorte canônico product-builder (D10) ──

  const [membersRes, sprintsRes, sprintCapsRes, projectsListRes, commitmentRes] =
    await Promise.all([
      supabase.from("Member")
        .select("id, name, role, position, fpCapacity, squadMemberships:SquadMember(squad:Squad(name))")
        .eq("isGuest", false)
        .eq("position", "product-builder")
        .order("name"),
      supabase.from("Sprint")
        .select("id, name, startDate, endDate, status, projectId, project:Project(id, name)")
        .in("status", ["active", "upcoming"])
        .order("startDate"),
      supabase.from("sprint_capacity_overview")
        .select("sprintId, capacity, planned, done, open"),
      supabase.from("Project")
        .select("id, name")
        .eq("status", "active")
        .order("name"),
      supabase.from("member_commitment_overview").select("id, committed"),
    ]);

  const members = (membersRes.data ?? []) as unknown as MemberRow[];
  const sprintRows = (sprintsRes.data ?? []) as unknown as SprintRow[];
  const capBySprint = new Map<string, CapRow>(
    ((sprintCapsRes.data ?? []) as CapRow[]).map((c) => [c.sprintId, c]),
  );

  const teamSprints: SprintInput[] = sprintRows.map((s) => {
    const cap = capBySprint.get(s.id);
    return {
      sprintId: s.id,
      sprintName: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
      projectId: s.projectId,
      projectName: s.project?.name ?? "?",
      fpAllocation: Number(cap?.capacity) || 0,
      fpPlanned: Number(cap?.planned) || 0,
      fpDone: Number(cap?.done) || 0,
      fpOpen: Number(cap?.open) || 0,
      hasOverride: false,
    };
  });

  // Capacity semanal do time = Σ fpCapacity dos product-builders (recorte já na query).
  const teamWeeklyCapacity = members.reduce((sum, m) => sum + (m.fpCapacity ?? 0), 0);

  const projectsList = ((projectsListRes.data ?? []) as { id: string; name: string }[]).map(
    (p) => ({ id: p.id, name: p.name }),
  );

  // ─── Capacity por membro na sprint corrente ────────────
  // Agrega fp_planned/done/open das sprints active+upcoming que se sobrepõem
  // à janela seg→dom corrente (sprints semanais → 1 sprint = 1 semana).

  const sprintsThisWeek = sprintRows.filter((s) => {
    const start = new Date(s.startDate);
    const end = new Date(s.endDate);
    return end >= weekStart && start <= weekEnd;
  });
  const sprintIdsThisWeek = sprintsThisWeek.map((s) => s.id);

  type SprintMemberCap = {
    sprintId: string;
    memberId: string;
    fp_planned: number;
    fp_done: number;
    fp_open: number;
    fp_allocation: number;
  };
  let memberCapsThisWeek: SprintMemberCap[] = [];
  if (sprintIdsThisWeek.length > 0) {
    const { data } = await supabase
      .from("sprint_member_capacity")
      .select("sprintId, memberId, fp_planned, fp_done, fp_open, fp_allocation")
      .in("sprintId", sprintIdsThisWeek);
    memberCapsThisWeek = (data ?? []) as unknown as SprintMemberCap[];
  }

  // Contrato total (committed) por membro de member_commitment_overview
  const contractByMember = new Map<string, number>();
  for (const c of (commitmentRes.data ?? []) as CommitmentRow[]) {
    if (c.id) contractByMember.set(c.id, Number(c.committed) || 0);
  }

  // Index sprints e agregação por membro
  const sprintMetaById = new Map<string, { id: string; name: string; projectName: string }>();
  for (const s of sprintsThisWeek) {
    sprintMetaById.set(s.id, {
      id: s.id,
      name: s.name,
      projectName: s.project?.name ?? "?",
    });
  }

  type MemberWeek = {
    fpPlanned: number;
    fpDone: number;
    fpOpen: number;
    activeSprints: { id: string; name: string; projectName: string }[];
  };
  const weekByMember = new Map<string, MemberWeek>();
  for (const r of memberCapsThisWeek) {
    if (!r.memberId) continue;
    const meta = sprintMetaById.get(r.sprintId);
    const existing = weekByMember.get(r.memberId);
    if (existing) {
      existing.fpPlanned += r.fp_planned ?? 0;
      existing.fpDone += r.fp_done ?? 0;
      existing.fpOpen += r.fp_open ?? 0;
      if (meta && !existing.activeSprints.find((s) => s.id === meta.id)) {
        existing.activeSprints.push(meta);
      }
    } else {
      weekByMember.set(r.memberId, {
        fpPlanned: r.fp_planned ?? 0,
        fpDone: r.fp_done ?? 0,
        fpOpen: r.fp_open ?? 0,
        activeSprints: meta ? [meta] : [],
      });
    }
  }

  const memberCapacity = members.map((m) => {
    const week = weekByMember.get(m.id) ?? {
      fpPlanned: 0, fpDone: 0, fpOpen: 0, activeSprints: [],
    };
    const squads = m.squadMemberships.map((sm) => sm.squad.name);
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      position: m.position,
      squads,
      fpCapacity: m.fpCapacity ?? 0,
      fpContract: contractByMember.get(m.id) ?? 0,
      fpPlanned: week.fpPlanned,
      fpDone: week.fpDone,
      fpOpen: week.fpOpen,
      activeSprints: week.activeSprints,
    };
  });

  // ─── Stats ────────────────────────────────────────────

  const linesDef = getMetricDef("factory.lines_active");
  const stats = [
    {
      label: linesDef?.name ?? "Linhas ativas",
      shortLabel: "Linhas",
      value: linesActive.value ?? 0,
      icon: FolderKanban,
      tip: linesDef?.defense,
    },
    {
      label: "Sprints ativos",
      shortLabel: "Sprints",
      value: activeSprintsRes.count ?? 0,
      icon: Zap,
      tip: "Sprints com status ativo agora — inventário de fluxo.",
    },
    {
      label: "Tasks em andamento",
      shortLabel: "Tasks",
      value: activeTasksRes.count ?? 0,
      icon: ListTodo,
      tip: "Tasks em status aberto (excl. done e backlog), sem dismiss.",
    },
    {
      label: "Entregues nesta sprint",
      shortLabel: "Entregues",
      value: doneThisSprintRes.count ?? 0,
      icon: CheckCircle2,
      tip: "Tasks com doneAt dentro da sprint corrente (seg→dom).",
    },
  ];

  // ─── Render ───────────────────────────────────────────

  return (
    <>
      {/* Stats — strip inline em mobile, grid de cards em desktop */}
      <div className="surface flex divide-x divide-border md:hidden">
        {stats.map((stat) => (
          <div key={stat.label} className="flex-1 min-w-0 px-2 py-3 text-center" title={stat.tip}>
            <div className="text-2xl font-bold tabular-nums leading-none">
              {stat.value}
            </div>
            <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground truncate">
              {stat.shortLabel}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:grid md:gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} title={stat.tip}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ─── Pontos de Atenção (ALERT_REGISTRY — D11) ─── */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Pontos de Atenção
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeAlerts.length === 0 && (
              <div className="surface-inset p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-medium">Nenhum ponto de atenção no momento</p>
                </div>
              </div>
            )}
            {activeAlerts.map(({ def, value }) => {
              const Icon = ALERT_ICONS[def.id] ?? AlertTriangle;
              return (
                <div
                  key={def.id}
                  title={def.defense}
                  className={`surface-inset p-3 ${
                    def.severity === "critical"
                      ? "!bg-red-500/10"
                      : def.severity === "warning"
                      ? "!bg-yellow-500/10"
                      : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      className={`h-4 w-4 mt-0.5 shrink-0 ${
                        def.severity === "critical"
                          ? "text-red-400"
                          : def.severity === "warning"
                          ? "text-yellow-400"
                          : "text-muted-foreground"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium">
                        <span className="tabular-nums">{value.count}</span> · {def.name}
                      </p>
                      {value.items.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {value.items.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ─── Capacity por Membro ─── */}
        <TeamCapacityWidget members={memberCapacity} />
      </div>

      {/* ─── Alocação por sprint (visão de time) ─── */}
      <WeeklyAllocation
        sprints={teamSprints}
        weeklyCapacity={teamWeeklyCapacity}
        projects={projectsList}
      />
    </>
  );
}
