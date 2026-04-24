import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, FolderKanban, ListTodo, Zap,
  AlertTriangle, Clock, UserX, TrendingDown,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { ACTIVE_STATUSES } from "@/lib/function-points";
import { SprintOverviewWidget } from "@/components/sprint-overview-widget";
import { requireMinLevel } from "@/lib/dal";
import { MANAGER, ADMIN, roleLabel, getRoleLevel } from "@/lib/roles";

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

  // ─── Fetch sprints with stats + member capacity ────────
  const { data: sprintsRaw } = await supabase
    .from("Sprint")
    .select(`
      *,
      project:Project(name),
      tasks:Task(
        status, functionPoints,
        assignments:TaskAssignment(
          member:Member(id, name, fpCapacity)
        )
      )
    `)
    .in("status", ["active", "planning"])
    .order("status")
    .order("startDate");

  const sprintWidgets = (sprintsRaw ?? []).map(({ tasks, ...s }: any) => {
    const total = tasks.length;
    const done = tasks.filter((t: any) => t.status === "done").length;
    const totalFp = tasks.reduce((sum: number, t: any) => sum + (t.functionPoints ?? 0), 0);
    const fpDone = tasks.filter((t: any) => t.status === "done").reduce((sum: number, t: any) => sum + (t.functionPoints ?? 0), 0);

    const memberMap = new Map<string, { id: string; name: string; fpCapacity: number; fpAllocated: number }>();
    for (const task of tasks) {
      const sp = task.functionPoints ?? 0;
      for (const a of task.assignments) {
        if (a.member) {
          const existing = memberMap.get(a.member.id);
          if (existing) { existing.fpAllocated += sp; }
          else { memberMap.set(a.member.id, { ...a.member, fpAllocated: sp }); }
        }
      }
    }

    return {
      ...s,
      total,
      done,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      totalFp,
      fpDone,
      members: Array.from(memberMap.values()),
    };
  });

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
      const isActive = [...ACTIVE_STATUSES].includes(a.task.status as any);

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
      .filter((a: any) => [...ACTIVE_STATUSES].includes(a.task.status as any))
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
    supabase.from("Task").select("*", { count: "exact", head: true }).in("status", [...ACTIVE_STATUSES]),
    supabase.from("Task").select("*", { count: "exact", head: true })
      .eq("status", "done")
      .gte("updatedAt", thisWeekStart.toISOString())
      .lte("updatedAt", thisWeekEnd.toISOString()),
  ]);

  const totalActiveTasksCount = activeTasksRes.count ?? 0;
  const doneThisWeekCount = doneThisWeekRes.count ?? 0;

  const stats = [
    { label: "Projetos ativos", value: projectCount, icon: FolderKanban },
    { label: "Sprints ativos", value: activeSprints, icon: Zap },
    { label: "Tasks em andamento", value: totalActiveTasksCount, icon: ListTodo },
    { label: "Entregues esta semana", value: doneThisWeekCount, icon: CheckCircle2 },
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

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Capacity do Time
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              FP com prazo nesta e proxima semana vs capacity semanal (capacity sprint / 2)
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {memberCapacity
                .filter((m) =>
                  getRoleLevel(m.role) < ADMIN && m.role !== "principal-engineer",
                )
                .map((m) => {
                const weeklyCapacity = Math.round(m.fpCapacity / 2);
                const thisWeekPct = weeklyCapacity > 0 ? m.fpThisWeek / weeklyCapacity : 0;
                const nextWeekPct = weeklyCapacity > 0 ? m.fpNextWeek / weeklyCapacity : 0;

                return (
                  <div key={m.id} className="surface-inset p-3">
                    {/* Member header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{m.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {roleLabel(m.role)}
                        </Badge>
                        {m.squads.map((s: string) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {weeklyCapacity} FP/sprint
                      </span>
                    </div>

                    {/* Two-week bars */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* This week */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Esta semana
                          </span>
                          <span className="text-xs font-medium tabular-nums">
                            {m.fpThisWeek}/{weeklyCapacity} FP
                            {m.dueThisWeek > 0 && (
                              <span className="text-muted-foreground"> ({m.dueThisWeek} tasks)</span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${usageColor(thisWeekPct)}`}
                            style={{ width: `${Math.min(thisWeekPct * 100, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Next week */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Prox semana
                          </span>
                          <span className="text-xs font-medium tabular-nums">
                            {m.fpNextWeek}/{weeklyCapacity} FP
                            {m.dueNextWeek > 0 && (
                              <span className="text-muted-foreground"> ({m.dueNextWeek} tasks)</span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${usageColor(nextWeekPct)}`}
                            style={{ width: `${Math.min(nextWeekPct * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {memberCapacity.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum membro cadastrado.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Sprints Widget ─── */}
      <SprintOverviewWidget sprints={sprintWidgets} />
    </div>
  );
}
