import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, FolderKanban, ListTodo, Zap,
  AlertTriangle, Clock, UserX, TrendingDown,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { OPEN_STATUSES } from "@/lib/function-points";
import { WeeklyAllocation } from "@/components/weekly-allocation";
import { TeamCapacityWidget } from "@/components/team-capacity-widget";
import type { SprintInput } from "@/lib/weekBuckets";
import { requireMinLevel } from "@/lib/dal";
import { MANAGER, ADMIN, getRoleLevel } from "@/lib/roles";

export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function usageColor(pct: number) {
  if (pct <= 0.5) return "bg-green-500";
  if (pct <= 0.7) return "bg-blue-500";
  if (pct <= 0.85) return "bg-yellow-500";
  return "bg-red-500";
}

function usageLabel(pct: number) {
  if (pct <= 0.3) return "Ocioso";
  if (pct <= 0.7) return "Normal";
  if (pct <= 0.85) return "Alto";
  return "Critico";
}

// ─── Page ─────────────────────────────────────────────────

export default async function OverviewPage() {
  await requireMinLevel(MANAGER, { redirectTo: "/projects" });
  const now = new Date();
  const thisWeekStart = startOfWeek(now);
  const thisWeekEnd = endOfWeek(now);
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const nextWeekEnd = new Date(thisWeekEnd);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

  const supabase = db();

  // ─── Fetch data ───────────────────────────────────────

  const [
    clientsRes,
    projectsRes,
    activeSprintsRes,
    membersRes,
    overdueRes,
    unassignedRes,
    blockedRes,
  ] = await Promise.all([
    supabase.from("Client").select("*", { count: "exact", head: true }),
    supabase.from("Project").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("Sprint").select("*", { count: "exact", head: true }).eq("status", "active"),

    // Members with their task assignments + squads
    supabase.from("Member").select(`
      *,
      taskAssignments:TaskAssignment(
        *,
        task:Task(functionPoints, status, dueDate, sprintId,
          sprint:Sprint(name, status)
        )
      ),
      squadMemberships:SquadMember(
        squad:Squad(name)
      )
    `).order("name"),

    // Overdue tasks
    supabase.from("Task")
      .select("*, project:Project(name), assignments:TaskAssignment(*, member:Member(name))")
      .lt("dueDate", now.toISOString())
      .not("status", "eq", "done")
      .neq("status", "draft")
      .order("dueDate")
      .limit(10),

    // Unassigned via RPC
    supabase.rpc("unassigned_active_task_count"),

    // Stuck tasks (in_progress > 3 days)
    supabase.from("Task")
      .select("*, project:Project(name), assignments:TaskAssignment(*, member:Member(name))")
      .eq("status", "in_progress")
      .lt("updatedAt", new Date(now.getTime() - 3 * 86400000).toISOString())
      .limit(5),
  ]);

  const clientCount = clientsRes.count ?? 0;
  const projectCount = projectsRes.count ?? 0;
  const activeSprints = activeSprintsRes.count ?? 0;
  const members = membersRes.data ?? [];
  const overdueTasks = overdueRes.data ?? [];
  const unassignedTasks = unassignedRes.data ?? 0;
  const blockedTasks = blockedRes.data ?? [];

  // ─── Team weekly allocation data ───────────────────────
  // Sprints (active + planning) with team-aggregated capacity / used FP,
  // pulled from the sprint_capacity_overview view.
  const [sprintsRes, sprintCapsRes, projectsListRes] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId, project:Project(id, name)")
      .in("status", ["active", "planning"])
      .order("startDate"),
    supabase
      .from("sprint_capacity_overview")
      .select("sprintId, capacity, allocated"),
    supabase
      .from("Project")
      .select("id, name")
      .eq("status", "active")
      .order("name"),
  ]);

  const capByspring = new Map(
    (sprintCapsRes.data ?? []).map((c: any) => [c.sprintId, c]),
  );

  const teamSprints: SprintInput[] = (sprintsRes.data ?? []).map((s: any) => {
    const cap = capByspring.get(s.id);
    return {
      sprintId: s.id,
      sprintName: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
      projectId: s.projectId,
      projectName: s.project?.name ?? "?",
      fpAllocation: Number(cap?.capacity) || 0,
      fpUsed: Number(cap?.allocated) || 0,
      hasOverride: false,
    };
  });

  // Team weekly capacity = sum of fpCapacity across builders
  // (mesmo filtro do widget "Capacity do Time": exclui admin/principal-eng).
  const teamWeeklyCapacity = members
    .filter(
      (m: any) => getRoleLevel(m.role) < ADMIN && m.role !== "principal-engineer",
    )
    .reduce((sum: number, m: any) => sum + (m.fpCapacity ?? 0), 0);

  const projectsList = (projectsListRes.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
  }));

  // ─── Compute capacity per member per week ─────────────

  type WeekCapacity = {
    fpThisWeek: number;
    fpNextWeek: number;
    dueThisWeek: number;
    dueNextWeek: number;
  };

  const memberCapacity = members.map((m: any) => {
    const weekCap: WeekCapacity = { fpThisWeek: 0, fpNextWeek: 0, dueThisWeek: 0, dueNextWeek: 0 };

    for (const a of m.taskAssignments) {
      const sp = a.task.functionPoints ?? 0;
      const due = a.task.dueDate ? new Date(a.task.dueDate) : null;
      const isActive = [...OPEN_STATUSES].includes(a.task.status as any);

      if (!isActive) continue;

      if (due && due >= thisWeekStart && due <= thisWeekEnd) {
        weekCap.fpThisWeek += sp;
        weekCap.dueThisWeek++;
      } else if (due && due >= nextWeekStart && due <= nextWeekEnd) {
        weekCap.fpNextWeek += sp;
        weekCap.dueNextWeek++;
      } else if (!due) {
        weekCap.fpThisWeek += sp;
      }
    }

    const totalActiveFp = m.taskAssignments
      .filter((a: any) => [...OPEN_STATUSES].includes(a.task.status as any))
      .reduce((s: number, a: any) => s + (a.task.functionPoints ?? 0), 0);

    const squads = m.squadMemberships.map((sm: any) => sm.squad.name);

    return {
      id: m.id,
      name: m.name,
      role: m.role,
      fpCapacity: m.fpCapacity,
      totalActiveFp,
      squads,
      ...weekCap,
    };
  });

  // ─── Attention points ─────────────────────────────────

  type AttentionItem = {
    severity: "critical" | "warning" | "info";
    icon: typeof AlertTriangle;
    message: string;
    detail?: string;
  };

  const attentionPoints: AttentionItem[] = [];

  if (overdueTasks.length > 0) {
    attentionPoints.push({
      severity: "critical",
      icon: Clock,
      message: `${overdueTasks.length} task${overdueTasks.length > 1 ? "s" : ""} com prazo vencido`,
      detail: overdueTasks
        .slice(0, 3)
        .map((t: any) => `${t.reference} — ${t.project.name} (${fmtDate(new Date(t.dueDate))})`)
        .join(", "),
    });
  }

  if (unassignedTasks > 0) {
    attentionPoints.push({
      severity: "warning",
      icon: UserX,
      message: `${unassignedTasks} task${unassignedTasks > 1 ? "s" : ""} sem responsavel em sprints ativos`,
    });
  }

  if (blockedTasks.length > 0) {
    attentionPoints.push({
      severity: "warning",
      icon: AlertCircle,
      message: `${blockedTasks.length} task${blockedTasks.length > 1 ? "s" : ""} parada${blockedTasks.length > 1 ? "s" : ""} ha +3 dias`,
      detail: blockedTasks
        .slice(0, 3)
        .map((t: any) => {
          const assignee = t.assignments[0]?.member?.name || "sem responsavel";
          return `${t.reference} (${assignee})`;
        })
        .join(", "),
    });
  }

  const overloaded = memberCapacity.filter((m) => {
    const weeklyCapacity = m.fpCapacity / 2;
    return weeklyCapacity > 0 && (m.fpThisWeek / weeklyCapacity > 0.85 || m.fpNextWeek / weeklyCapacity > 0.85);
  });
  if (overloaded.length > 0) {
    attentionPoints.push({
      severity: "warning",
      icon: TrendingDown,
      message: `${overloaded.length} membro${overloaded.length > 1 ? "s" : ""} com carga acima de 85%`,
      detail: overloaded.map((m) => m.name).join(", "),
    });
  }

  const idle = memberCapacity.filter((m) => {
    const weeklyCapacity = m.fpCapacity / 2;
    return weeklyCapacity > 0 && m.fpThisWeek / weeklyCapacity < 0.1 && m.fpNextWeek / weeklyCapacity < 0.1;
  });
  if (idle.length > 0) {
    attentionPoints.push({
      severity: "info",
      icon: Users,
      message: `${idle.length} membro${idle.length > 1 ? "s" : ""} com baixa alocacao`,
      detail: idle.map((m) => m.name).join(", "),
    });
  }

  if (attentionPoints.length === 0) {
    attentionPoints.push({
      severity: "info",
      icon: CheckCircle2,
      message: "Nenhum ponto de atencao no momento",
    });
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  attentionPoints.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ─── Stats ────────────────────────────────────────────

  const [activeTasksRes, doneThisWeekRes] = await Promise.all([
    supabase.from("Task").select("*", { count: "exact", head: true }).in("status", [...OPEN_STATUSES]),
    supabase.from("Task").select("*", { count: "exact", head: true })
      .eq("status", "done")
      .gte("updatedAt", thisWeekStart.toISOString())
      .lte("updatedAt", thisWeekEnd.toISOString()),
  ]);

  const totalActiveTasksCount = activeTasksRes.count ?? 0;
  const doneThisWeekCount = doneThisWeekRes.count ?? 0;

  const stats = [
    { label: "Projetos ativos", shortLabel: "Projetos", value: projectCount, icon: FolderKanban },
    { label: "Sprints ativos", shortLabel: "Sprints", value: activeSprints, icon: Zap },
    { label: "Tasks em andamento", shortLabel: "Tasks", value: totalActiveTasksCount, icon: ListTodo },
    { label: "Entregues esta semana", shortLabel: "Entregues", value: doneThisWeekCount, icon: CheckCircle2 },
  ];

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Semana de {fmtDate(thisWeekStart)} a {fmtDate(thisWeekEnd)}
        </p>
      </div>

      {/* Stats — strip inline em mobile, grid de cards em desktop */}
      <div className="surface flex divide-x divide-border md:hidden">
        {stats.map((stat) => (
          <div key={stat.label} className="flex-1 min-w-0 px-2 py-3 text-center">
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
          <Card key={stat.label}>
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
        {/* ─── Attention Points ─── */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Pontos de Atencao
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {attentionPoints.map((item, i) => (
              <div
                key={i}
                className={`surface-inset p-3 ${
                  item.severity === "critical"
                    ? "!bg-red-500/10"
                    : item.severity === "warning"
                    ? "!bg-yellow-500/10"
                    : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <item.icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${
                      item.severity === "critical"
                        ? "text-red-400"
                        : item.severity === "warning"
                        ? "text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium">{item.message}</p>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ─── Capacity por Membro ─── */}
        <TeamCapacityWidget
          members={memberCapacity.filter(
            (m) => getRoleLevel(m.role) < ADMIN && m.role !== "principal-engineer",
          )}
        />
      </div>

      {/* ─── Alocação por semana (visão de time) ─── */}
      <WeeklyAllocation
        sprints={teamSprints}
        weeklyCapacity={teamWeeklyCapacity}
        projects={projectsList}
      />
    </div>
  );
}
