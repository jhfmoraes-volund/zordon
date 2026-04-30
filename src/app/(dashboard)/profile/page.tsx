"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  User, Zap, FolderKanban, ListTodo, ArrowRight, Sparkles, ArrowUpRight, Star, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { TaskSheet } from "@/components/task-sheet";
import { fmtDate, isOverdue } from "@/lib/task-constants";
import { StatusChip } from "@/components/ui/status-chip";
import { TASK_STATUS, TASK_TYPE, lookupChip } from "@/lib/status-chips";
import { roleLabel, specialtyLabel } from "@/lib/roles";
import {
  TOWERS,
  derivePrimaryTowers,
  isFullstack,
  assessmentProgress,
  towerLabel,
  type MemberSkillRow,
} from "@/lib/memberSkills";
import { PixelBar, PixelDot, pixelBarLabel, PixelHud, pixelTone } from "@/components/ui/pixel-bar";
import { MemberBattery } from "@/components/member-battery";
import { PdiWidget } from "@/components/pdi-widget";
import { TodosWidget } from "@/components/todos-widget";
import { bucketSprintsByWeek, type SprintInput } from "@/lib/weekBuckets";
import { OPEN_STATUSES } from "@/lib/function-points";

// ─── Types ────────────────────────────────────────────────

type MeTask = {
  id: string;
  title: string;
  reference: string;
  status: string;
  type: string;
  functionPoints: number | null;
  dueDate: string | null;
  sprintId: string | null;
  projectId: string;
  project: { name: string };
  sprint: { id: string; name: string } | null;
};

type MeSprint = {
  id: string;
  name: string;
  projectName: string;
  taskCount: number;
  fpTotal: number;
  doneCount: number;
};

type MeProject = {
  id: string;
  name: string;
  status: string;
};

type MeData = {
  member: { id: string; name: string; role: string; fpCapacity: number };
  fpOpen: number;
  tasks: MeTask[];
  sprints: MeSprint[];
  projects: MeProject[];
};

// ─── Page ─────────────────────────────────────────────────

type SkillsSummary = {
  skills: MemberSkillRow[];
  status: "in_progress" | "completed" | null;
};

type CapacityProject = {
  projectId: string;
  projectName: string;
  fpContract: number;
  fpPlanned: number;
  fpDone: number;
  fpOpen: number;
};

type CapacitySummary = {
  fpCapacity: number;
  committed: number;
  remaining: number;
  /** Métrica primária da semana corrente (≠ backlog), somada das sprints. */
  weekPlanned: number;
  weekDone: number;
  weekOpen: number;
  weekActiveSprints: { id: string; name: string; projectName: string }[];
  projects: CapacityProject[];
};

export default function ProfilePage() {
  const { member } = useAuth();
  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);
  const [skillsSummary, setSkillsSummary] = useState<SkillsSummary | null>(null);
  const [capacity, setCapacity] = useState<CapacitySummary | null>(null);

  const FETCH_STATUSES = [...OPEN_STATUSES, "backlog"];

  const fetchProfile = async (memberId: string, memberInfo: typeof member) => {
    const supabase = createClient();
    const [assignmentsRes, allocationsRes] = await Promise.all([
      supabase
        .from("TaskAssignment")
        .select("*, task:Task(id, title, reference, status, type, functionPoints, dueDate, sprintId, projectId, project:Project(name), sprint:Sprint(id, name))")
        .eq("memberId", memberId),
      supabase
        .from("ProjectMember")
        .select("*, project:Project(id, name, status)")
        .eq("memberId", memberId),
    ]);

    const assignments = (assignmentsRes.data ?? []) as { task: MeTask & { sprint: { id: string; name: string } | null } }[];
    const tasks = assignments
      .map((a) => a.task)
      .filter((t) => FETCH_STATUSES.includes(t.status));
    const projects = (allocationsRes.data ?? []).map((pa: { project: MeProject }) => pa.project);

    // FP em aberto (open statuses)
    const fpOpen = tasks
      .filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status))
      .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);

    // Sprints where I have tasks
    const sprintMap = new Map<string, MeSprint>();
    for (const t of tasks) {
      if (!t.sprint) continue;
      const existing = sprintMap.get(t.sprint.id);
      if (existing) {
        existing.taskCount++;
        existing.fpTotal += t.functionPoints ?? 0;
        if (t.status === "done") existing.doneCount++;
      } else {
        sprintMap.set(t.sprint.id, {
          id: t.sprint.id,
          name: t.sprint.name,
          projectName: t.project.name,
          taskCount: 1,
          fpTotal: t.functionPoints ?? 0,
          doneCount: t.status === "done" ? 1 : 0,
        });
      }
    }

    return {
      member: { id: memberId, name: memberInfo!.name, role: memberInfo!.role, fpCapacity: memberInfo!.fpCapacity },
      fpOpen,
      tasks,
      sprints: Array.from(sprintMap.values()),
      projects,
    } as MeData;
  };

  const reload = () => {
    if (!member) return;
    fetchProfile(member.id, member).then(setData).catch(() => {});
  };

  useEffect(() => {
    if (!member) return;
    setLoading(true);
    fetchProfile(member.id, member)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/profile/skills")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setSkillsSummary({
          skills: (d.skills ?? []) as MemberSkillRow[],
          status: d.assessment?.status ?? null,
        });
      })
      .catch(() => {});

    fetch("/api/profile/capacity")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const sprints: SprintInput[] = d.sprints ?? [];
        const buckets = bucketSprintsByWeek(sprints, { weeks: 1, includePast: false });
        const current = buckets[0];

        // Agrega por projeto na semana corrente (planejado/done/open)
        const contractByProject = new Map<string, { name: string; fpContract: number }>();
        for (const p of (d.projects ?? []) as { projectId: string; projectName: string; fpAllocation: number }[]) {
          contractByProject.set(p.projectId, { name: p.projectName, fpContract: p.fpAllocation });
        }
        const weekProjects = new Map<string, CapacityProject>();
        for (const row of current?.sprints ?? []) {
          const existing = weekProjects.get(row.projectId);
          if (existing) {
            existing.fpPlanned += row.fpPlannedWeek;
            existing.fpDone += row.fpDoneWeek;
            existing.fpOpen += row.fpOpenWeek;
          } else {
            const contract = contractByProject.get(row.projectId);
            weekProjects.set(row.projectId, {
              projectId: row.projectId,
              projectName: row.projectName,
              fpContract: contract?.fpContract ?? 0,
              fpPlanned: row.fpPlannedWeek,
              fpDone: row.fpDoneWeek,
              fpOpen: row.fpOpenWeek,
            });
          }
        }
        // Adicionar projetos contratuais sem sprint ativa nessa semana (idle)
        for (const [projectId, c] of contractByProject) {
          if (!weekProjects.has(projectId)) {
            weekProjects.set(projectId, {
              projectId,
              projectName: c.name,
              fpContract: c.fpContract,
              fpPlanned: 0,
              fpDone: 0,
              fpOpen: 0,
            });
          }
        }

        setCapacity({
          fpCapacity: d.member.fpCapacity,
          committed: d.commitment.committed,
          remaining: d.commitment.remaining,
          weekPlanned: current?.totalPlanned ?? 0,
          weekDone: current?.totalDone ?? 0,
          weekOpen: current?.totalOpen ?? 0,
          weekActiveSprints: (current?.sprints ?? []).map((s) => ({
            id: s.sprintId,
            name: s.sprintName,
            projectName: s.projectName,
          })),
          projects: Array.from(weekProjects.values()).sort((a, b) => b.fpPlanned - a.fpPlanned),
        });
      })
      .catch(() => {});
  }, [member?.id]);

  if (!member) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Sua conta ainda não está vinculada a um membro. Peça ao admin.
      </div>
    );
  }

  if (loading || !data) {
    return <div className="py-12 text-center text-muted-foreground">Carregando...</div>;
  }

  // Sort tasks: in_progress first, then review, todo, backlog
  const statusOrder: Record<string, number> = {
    in_progress: 0, review: 1, todo: 2, backlog: 3,
  };
  const sortedTasks = [...data.tasks].sort(
    (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
          <User className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{data.member.name}</h1>
          <p className="text-sm text-muted-foreground">
            {roleLabel(data.member.role)}
          </p>
        </div>
      </div>

      {/* Capacity widget — bateria + esta semana */}
      <CapacityCard summary={capacity} />

      {/* To-dos pessoais */}
      <TodosWidget />

      {/* Tasks ativas + Projetos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ListTodo className="h-3.5 w-3.5" /> Tasks ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{data.tasks.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FolderKanban className="h-3.5 w-3.5" /> Projetos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{data.projects.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* My Tasks */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Minhas Tasks</h2>
        {sortedTasks.length > 0 ? (
          <div className="surface rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Ref</TableHead>
                  <TableHead>Titulo</TableHead>
                  <TableHead className="w-[90px]">Tipo</TableHead>
                  <TableHead>Projeto</TableHead>
                  <TableHead>Sprint</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[50px] text-center">FP</TableHead>
                  <TableHead className="w-[80px]">Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTasks.map((t) => {
                  return (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => { setSheetTaskId(t.id); setSheetOpen(true); }}
                    >
                      <TableCell className="font-mono text-xs text-primary">
                        {t.reference}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {t.title}
                      </TableCell>
                      <TableCell>
                        <StatusChip {...lookupChip(TASK_TYPE, t.type)} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.project.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.sprint?.name || "—"}</TableCell>
                      <TableCell>
                        <StatusChip {...lookupChip(TASK_STATUS, t.status)} dot />
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium tabular-nums text-sm">{t.functionPoints ?? "—"}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs tabular-nums ${isOverdue(t.dueDate, t.status) ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {fmtDate(t.dueDate)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="surface p-8 text-center text-muted-foreground">
            Nenhuma task atribuida.
          </div>
        )}
      </div>

      {/* My Sprints */}
      {data.sprints.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Meus Sprints</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.sprints.map((s) => {
              const pct = s.taskCount > 0 ? Math.round((s.doneCount / s.taskCount) * 100) : 0;
              return (
                <Link key={s.id} href={`/sprints/${s.id}/board`}>
                  <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">{s.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{s.projectName}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <span>{s.taskCount} tasks</span>
                        <span>{s.fpTotal} FP</span>
                        <span className="text-muted-foreground">{pct}% concluido</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* My Projects */}
      {data.projects.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Meus Projetos</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold">{p.name}</span>
                      <Badge variant="secondary" className="ml-2 text-xs">{p.status}</Badge>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Skills + PDI lado a lado — last row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SkillsWidget summary={skillsSummary} />
        <PdiWidget />
      </div>

      <TaskSheet
        taskId={sheetTaskId}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) reload();
        }}
        onChange={reload}
      />
    </div>
  );
}

// ─── Capacity card (battery + this-week) ─────────────────

function CapacityCard({ summary }: { summary: CapacitySummary | null }) {
  if (summary === null) {
    return (
      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Carregando capacity...
        </CardContent>
      </Card>
    );
  }

  const { fpCapacity, weekPlanned, weekDone, weekOpen, weekActiveSprints, projects } = summary;
  const weekPct = fpCapacity > 0 ? (weekPlanned / fpCapacity) * 100 : 0;
  const tone = pixelTone(weekPct, "load");
  const multiplier = fpCapacity > 0 ? weekPlanned / fpCapacity : 0;
  const overcommit = weekPlanned > fpCapacity;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Capacity
          </CardTitle>
          <Link href="/profile/capacity">
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Ver detalhes
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Linha 1 — bateria principal: planejado vs capacity */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <PixelHud size="xs" tone="muted">esta semana</PixelHud>
            {overcommit ? (
              <PixelHud size="xs" style={{ color: "oklch(0.82 0.2 22)" }}>
                {multiplier.toFixed(1)}× overcommit
              </PixelHud>
            ) : weekPlanned === 0 ? (
              <PixelHud size="xs" tone="muted">sem alocação</PixelHud>
            ) : null}
          </div>
          <MemberBattery
            capacity={fpCapacity}
            committed={weekPlanned}
            done={weekDone}
            size="md"
          />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <PixelDot variant="done" />
              <span className="font-mono tabular-nums" style={{ color: tone.fg }}>entregue {weekDone}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PixelDot variant="open" />
              <span className="font-mono tabular-nums">em aberto {weekOpen}</span>
            </span>
          </div>
        </div>

        {/* Linha 2 — por projeto: barra individual + planejado + contrato + flag */}
        {projects.length > 0 && (
          <div className="space-y-2">
            <PixelHud size="xs" tone="muted">por projeto</PixelHud>
            <div className="space-y-2">
              {projects.map((p) => {
                const ratio = fpCapacity > 0 ? p.fpPlanned / fpCapacity : 0;
                const overContract = p.fpContract > 0 && p.fpPlanned > p.fpContract;
                const idle = p.fpPlanned === 0 && p.fpContract > 0;
                const overMul = p.fpContract > 0 ? p.fpPlanned / p.fpContract : 0;
                const projectTone = pixelTone(ratio * 100, "load");
                return (
                  <div key={p.projectId} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate flex-1">{p.projectName}</span>
                      <span className="font-mono tabular-nums text-xs" style={{ color: projectTone.fg }}>
                        {p.fpPlanned} FP
                      </span>
                      <span className="font-mono tabular-nums text-[10px] text-muted-foreground">
                        contrato {p.fpContract}
                      </span>
                      {overContract ? (
                        <PixelHud size="xs" style={{ color: "oklch(0.82 0.2 22)" }}>
                          ⚠️ +{overMul.toFixed(1)}×
                        </PixelHud>
                      ) : idle ? (
                        <PixelHud size="xs" tone="muted">💤 ocioso</PixelHud>
                      ) : (
                        <PixelHud size="xs" style={{ color: "oklch(0.82 0.18 145)" }}>✓ ok</PixelHud>
                      )}
                    </div>
                    <PixelBar
                      score={Math.min(ratio * 100, 100)}
                      cells={20}
                      height={6}
                      variant="load"
                    />
                    {(p.fpDone > 0 || p.fpOpen > 0) && (
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <PixelDot variant="done" size={6} />
                          <span className="font-mono tabular-nums">{p.fpDone} entregue</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <PixelDot variant="open" size={6} />
                          <span className="font-mono tabular-nums">{p.fpOpen} em aberto</span>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Linha 3 — contagem de sprints ativas com nomes */}
        <p className="text-[11px] text-muted-foreground">
          {weekActiveSprints.length > 0
            ? `${weekActiveSprints.length} sprint${weekActiveSprints.length === 1 ? "" : "s"} ativ${weekActiveSprints.length === 1 ? "a" : "as"} · ${weekActiveSprints.map((s) => `${s.projectName} ${s.name}`).join(", ")}`
            : "Nada agendado pra essa semana"}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Skills widget ────────────────────────────────────────

function SkillsWidget({ summary }: { summary: SkillsSummary | null }) {
  const [expandedSkills, setExpandedSkills] = useState(false);

  if (summary === null) {
    return (
      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Carregando avaliação de skills...
        </CardContent>
      </Card>
    );
  }

  const { skills, status } = summary;
  const { answered, total } = assessmentProgress(skills);
  const isComplete = status === "completed";
  const hasStarted = answered > 0;
  const { primary, secondary } = derivePrimaryTowers(skills);
  const fullstack = isFullstack(skills);

  if (!hasStarted) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-5 flex items-center gap-4 flex-wrap">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <p className="text-sm font-semibold">Mapeie suas forças</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-avaliação rápida em {total} torres. Vira um card visível pro time.
            </p>
          </div>
          <Link href="/profile/skills">
            <Button size="sm">
              Começar
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // All 10 towers sorted by score desc; tower order tie-breaks via TOWERS index.
  const towerOrder = new Map<string, number>(TOWERS.map((t, i) => [t.key, i]));
  const allRows = TOWERS.map((t) => skills.find((s) => s.towerKey === t.key) ?? {
    towerKey: t.key,
    score: null as number | null,
    subskills: {},
  } as MemberSkillRow);
  const sorted = [...allRows].sort((a, b) => {
    const diff = (b.score ?? 0) - (a.score ?? 0);
    if (diff !== 0) return diff;
    return (towerOrder.get(a.towerKey) ?? 0) - (towerOrder.get(b.towerKey) ?? 0);
  });
  const visibleRows = expandedSkills ? sorted : sorted.slice(0, 4);

  return (
    <Card className="relative overflow-hidden">
      {/* Scanlines overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-overlay"
        style={{
          background:
            "repeating-linear-gradient(to bottom, oklch(1 0 0 / 0.018) 0 1px, transparent 1px 3px)",
        }}
      />

      <CardHeader className="pb-3 relative">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Star className="h-4 w-4 text-primary" />
            Avaliação de Skills
            {isComplete ? (
              <Badge variant="secondary" className="text-[10px]">Publicada</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">Rascunho</Badge>
            )}
          </CardTitle>
          <Link href="/profile/skills">
            <Button variant={isComplete ? "outline" : "default"} size="sm" className="h-7 text-xs">
              {isComplete ? "Atualizar" : "Continuar"}
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {/* Progresso */}
        <div className="flex items-center gap-2 leading-none">
          <span
            className="font-mono text-base tabular-nums leading-none"
            style={{ color: "oklch(0.82 0.2 22)" }}
          >
            {String(answered).padStart(2, "0")}/{String(total).padStart(2, "0")}
          </span>
          <PixelHud size="xs" tone="muted">torres avaliadas</PixelHud>
        </div>

        {/* Area strip — torre primária + secundária + selos */}
        <div
          className="flex items-center gap-2 flex-wrap rounded-lg px-3.5 py-2.5 bg-muted/50"
          style={{
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.05)",
          }}
        >
          <PixelHud size="xs" tone="muted">Torre primária</PixelHud>
          {primary ? (
            <Badge className="text-xs">{towerLabel(primary)}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground italic">—</span>
          )}
          {secondary && (
            <Badge variant="secondary" className="text-xs">{towerLabel(secondary)}</Badge>
          )}
          {fullstack && (
            <Badge className="text-xs bg-amber-500/15 text-amber-600 border-amber-500/30 border hover:bg-amber-500/15">
              <Star className="h-3 w-3 mr-1 fill-current" />
              Fullstack
            </Badge>
          )}
        </div>

        {/* Pixel skill bars — show 4, rest collapsible */}
        <div className="space-y-2">
          {visibleRows.map((s) => {
            const score = s.score;
            const { label, fg } = pixelBarLabel(score);
            return (
              <div
                key={s.towerKey}
                className="grid items-center gap-3"
                style={{ gridTemplateColumns: "9.5rem 1fr 3rem 2.5rem" }}
              >
                <span className="text-xs font-medium truncate">{towerLabel(s.towerKey)}</span>
                <PixelBar score={score} cells={20} height={12} />
                <span
                  className="font-sans font-semibold text-[10px] tracking-[0.12em] uppercase text-right leading-none"
                  style={{ color: fg }}
                >
                  {label}
                </span>
                <span className="font-mono text-base tabular-nums text-right leading-none">
                  {score === null ? "—" : score}
                  {score !== null && (
                    <span className="text-xs text-muted-foreground/70">/100</span>
                  )}
                </span>
              </div>
            );
          })}

          {sorted.length > 4 && (
            <button
              type="button"
              onClick={() => setExpandedSkills((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 pt-1 font-sans font-semibold text-[10px] tracking-[0.12em] uppercase text-muted-foreground hover:text-foreground transition-colors leading-none"
            >
              {expandedSkills ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Mostrar menos
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Ver todas ({sorted.length - 4} restantes)
                </>
              )}
            </button>
          )}
        </div>

      </CardContent>
    </Card>
  );
}

