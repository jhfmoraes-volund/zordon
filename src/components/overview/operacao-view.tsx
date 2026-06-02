import { db } from "@/lib/db";
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
import { ADMIN, getRoleLevel } from "@/lib/roles";
import { fmtDate } from "@/lib/date-utils";

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
type TaskListItem = {
  reference: string;
  dueDate: string;
  status: string;
  project: { name: string } | null;
  assignments: { member: { name: string } | null }[];
};

// ─── View ─────────────────────────────────────────────────

export async function OperacaoView() {
  const now = new Date();
  const thisWeekStart = startOfWeek(now);
  const thisWeekEnd = endOfWeek(now);

  const supabase = db();

  // ─── Fetch data ───────────────────────────────────────

  const [
    projectsRes,
    activeSprintsRes,
    membersRes,
    overdueRes,
    unassignedRes,
    blockedRes,
  ] = await Promise.all([
    supabase.from("Project").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("Sprint").select("*", { count: "exact", head: true }).eq("status", "active"),

    // Members with their task assignments + squads.
    // Guests (Member-stub, isGuest=true) ficam fora — não são do time interno,
    // não têm capacity e não devem aparecer em relatórios de capacidade.
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
    `).eq("isGuest", false).order("name"),

    // Overdue tasks
    supabase.from("Task")
      .select("*, project:Project(name), assignments:TaskAssignment(*, member:Member(name))")
      .lt("dueDate", now.toISOString())
      .not("status", "eq", "done")
      .neq("status", "draft")
      .is("dismissedAt", null)
      .order("dueDate")
      .limit(10),

    // Unassigned via RPC
    supabase.rpc("unassigned_active_task_count"),

    // Stuck tasks (in_progress > 3 days)
    supabase.from("Task")
      .select("*, project:Project(name), assignments:TaskAssignment(*, member:Member(name))")
      .eq("status", "in_progress")
      .lt("updatedAt", new Date(now.getTime() - 3 * 86400000).toISOString())
      .is("dismissedAt", null)
      .limit(5),
  ]);

  const projectCount = projectsRes.count ?? 0;
  const activeSprints = activeSprintsRes.count ?? 0;
  const members = (membersRes.data ?? []) as unknown as MemberRow[];
  const overdueTasks = (overdueRes.data ?? []) as unknown as TaskListItem[];
  const unassignedTasks = (unassignedRes.data as number | null) ?? 0;
  const blockedTasks = (blockedRes.data ?? []) as unknown as TaskListItem[];

  // ─── Team weekly allocation data ───────────────────────
  // Sprints (active + planning) com capacity / used FP agregado por time,
  // puxados da view sprint_capacity_overview.
  const [sprintsRes, sprintCapsRes, projectsListRes] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId, project:Project(id, name)")
      .in("status", ["active", "upcoming"])
      .order("startDate"),
    supabase
      .from("sprint_capacity_overview")
      .select("sprintId, capacity, planned, done, open"),
    supabase
      .from("Project")
      .select("id, name")
      .eq("status", "active")
      .order("name"),
  ]);

  const sprintRows = (sprintsRes.data ?? []) as unknown as SprintRow[];
  const capByspring = new Map<string, CapRow>(
    ((sprintCapsRes.data ?? []) as CapRow[]).map((c) => [c.sprintId, c]),
  );

  const teamSprints: SprintInput[] = sprintRows.map((s) => {
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
      fpPlanned: Number(cap?.planned) || 0,
      fpDone: Number(cap?.done) || 0,
      fpOpen: Number(cap?.open) || 0,
      hasOverride: false,
    };
  });

  // Team weekly capacity = soma de fpCapacity entre builders
  // (mesmo filtro do widget "Capacity do Time": exclui admin/principal-eng).
  const teamWeeklyCapacity = members
    .filter((m) => getRoleLevel(m.position) < ADMIN && m.position !== "principal-engineer")
    .reduce((sum, m) => sum + (m.fpCapacity ?? 0), 0);

  const projectsList = ((projectsListRes.data ?? []) as { id: string; name: string }[]).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  // ─── Compute capacity por membro (sprint-based) ────────
  // Agrega fp_planned/done/open das sprints active+planning que SE SOBREPÕEM
  // com a semana atual (sprints semanais → 1 sprint = 1 semana).

  const sprintsThisWeek = sprintRows.filter((s) => {
    const start = new Date(s.startDate);
    const end = new Date(s.endDate);
    return end >= thisWeekStart && start <= thisWeekEnd;
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
  const { data: commitmentRows } = await supabase
    .from("member_commitment_overview")
    .select("id, committed");
  const contractByMember = new Map<string, number>();
  for (const c of (commitmentRows ?? []) as CommitmentRow[]) {
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
        .map((t) => `${t.reference} — ${t.project?.name ?? "?"} (${fmtDate(new Date(t.dueDate))})`)
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
        .map((t) => {
          const assignee = t.assignments[0]?.member?.name || "sem responsavel";
          return `${t.reference} (${assignee})`;
        })
        .join(", "),
    });
  }

  const overloaded = memberCapacity.filter((m) => {
    return m.fpCapacity > 0 && m.fpPlanned / m.fpCapacity > 0.85;
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
    return m.fpCapacity > 0 && m.fpPlanned / m.fpCapacity < 0.1;
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
    supabase.from("Task").select("*", { count: "exact", head: true }).in("status", [...OPEN_STATUSES]).is("dismissedAt", null),
    supabase.from("Task").select("*", { count: "exact", head: true })
      .eq("status", "done")
      .is("dismissedAt", null)
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
    <>
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
            (m) => getRoleLevel(m.position) < ADMIN && m.position !== "principal-engineer",
          )}
        />
      </div>

      {/* ─── Alocação por semana (visão de time) ─── */}
      <WeeklyAllocation
        sprints={teamSprints}
        weeklyCapacity={teamWeeklyCapacity}
        projects={projectsList}
      />
    </>
  );
}
