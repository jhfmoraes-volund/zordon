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
  FolderKanban, ListTodo, ArrowRight, Sparkles, ArrowUpRight, Star, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { fmtDate, fmtDateNumeric, isOverdue } from "@/lib/date-utils";
import { StatusChip } from "@/components/ui/status-chip";
import { SPRINT_STATUS, TASK_STATUS, TASK_TYPE, lookupChip } from "@/lib/status-chips";
import {
  TOWERS,
  derivePrimaryTowers,
  isFullstack,
  assessmentProgress,
  towerLabel,
  type MemberSkillRow,
} from "@/lib/memberSkills";
import { PixelBar, pixelBarLabel, PixelHud } from "@/components/ui/pixel-bar";
import { PdiWidget } from "@/components/pdi-widget";
import { TodosWidget } from "@/components/todos-widget";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
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
  status: "upcoming" | "active" | "completed";
  startDate: string;
  endDate: string;
  projectId: string;
  projectName: string;
  taskCount: number;
  fpTotal: number;
  doneCount: number;
  fpDone: number;
};

type MeProject = {
  id: string;
  name: string;
  status: string;
};

type MeData = {
  member: { id: string; name: string; role: string; position: string; fpCapacity: number };
  fpOpen: number;
  tasks: MeTask[];
  sprints: MeSprint[];
  projects: MeProject[];
};

// ─── Helpers ──────────────────────────────────────────────

type SprintGroup = {
  projectId: string;
  projectName: string;
  sprints: MeSprint[];
};

function groupSprintsByProject(sprints: MeSprint[]): SprintGroup[] {
  const groups = new Map<string, SprintGroup>();
  for (const s of sprints) {
    const existing = groups.get(s.projectId);
    if (existing) {
      existing.sprints.push(s);
    } else {
      groups.set(s.projectId, {
        projectId: s.projectId,
        projectName: s.projectName,
        sprints: [s],
      });
    }
  }
  for (const g of groups.values()) {
    g.sprints.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName, "pt-BR"),
  );
}

// ─── Data fetching (module-level — stable, no component closure) ──────────

const FETCH_STATUSES = [...OPEN_STATUSES, "backlog"];

async function loadProfile(
  memberId: string,
  memberInfo: { name: string; role: string; position: string; fpCapacity: number },
): Promise<MeData> {
  const supabase = createClient();
  const [assignmentsRes, allocationsRes, pmProjectsRes] = await Promise.all([
    supabase
      .from("TaskAssignment")
      .select("*, task:Task(id, title, reference, status, type, functionPoints, dueDate, sprintId, projectId, project:Project(name), sprint:Sprint(id, name, status, startDate, endDate))")
      .eq("memberId", memberId),
    supabase
      .from("ProjectMember")
      .select("*, project:Project(id, name, status)")
      .eq("memberId", memberId),
    // Projetos onde sou PM (sem ProjectMember explícito). Sem isso, PMs
    // perdem a contagem de "Projetos" e a lista "Meus Projetos" no /profile.
    supabase
      .from("Project")
      .select("id, name, status")
      .eq("pmId", memberId),
  ]);

  const assignments = (assignmentsRes.data ?? []) as {
    task: MeTask & {
      sprint: { id: string; name: string; status: MeSprint["status"]; startDate: string; endDate: string } | null;
    };
  }[];
  const tasks = assignments
    .map((a) => a.task)
    .filter((t) => FETCH_STATUSES.includes(t.status));
  const projectMap = new Map<string, MeProject>();
  for (const pa of (allocationsRes.data ?? []) as { project: MeProject }[]) {
    if (pa.project) projectMap.set(pa.project.id, pa.project);
  }
  for (const p of (pmProjectsRes.data ?? []) as MeProject[]) {
    if (p && !projectMap.has(p.id)) projectMap.set(p.id, p);
  }
  const projects = Array.from(projectMap.values());

  const fpOpen = tasks
    .filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status))
    .reduce((sum, t) => sum + (t.functionPoints ?? 0), 0);

  const sprintMap = new Map<string, MeSprint>();
  for (const t of tasks) {
    if (!t.sprint) continue;
    const fp = t.functionPoints ?? 0;
    const isDone = t.status === "done";
    const existing = sprintMap.get(t.sprint.id);
    if (existing) {
      existing.taskCount++;
      existing.fpTotal += fp;
      if (isDone) { existing.doneCount++; existing.fpDone += fp; }
    } else {
      sprintMap.set(t.sprint.id, {
        id: t.sprint.id,
        name: t.sprint.name,
        status: t.sprint.status,
        startDate: t.sprint.startDate,
        endDate: t.sprint.endDate,
        projectId: t.projectId,
        projectName: t.project.name,
        taskCount: 1,
        fpTotal: fp,
        doneCount: isDone ? 1 : 0,
        fpDone: isDone ? fp : 0,
      });
    }
  }

  return {
    member: { id: memberId, name: memberInfo.name, role: memberInfo.role, position: memberInfo.position, fpCapacity: memberInfo.fpCapacity },
    fpOpen,
    tasks,
    sprints: Array.from(sprintMap.values()),
    projects,
  };
}

// ─── Page ─────────────────────────────────────────────────

type SkillsSummary = {
  skills: MemberSkillRow[];
  status: "in_progress" | "completed" | null;
};

export default function ProfilePage() {
  const { member } = useAuth();
  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [skillsSummary, setSkillsSummary] = useState<SkillsSummary | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const reload = () => {
    if (!member) return;
    loadProfile(member.id, member).then(setData).catch(() => {});
  };

  useEffect(() => {
    if (!member) return;
    void (async () => {
      setLoading(true);
      try {
        const result = await loadProfile(member.id, member);
        setData(result);
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    })();

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
  }, [member]);

  if (!member) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Sua conta ainda não está vinculada a um membro. Peça ao admin.
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="py-12 text-center text-muted-foreground">Carregando...</div>
    );
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
                  <TableHead className="w-[50px] text-center">PFV</TableHead>
                  <TableHead className="w-[80px]">Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTasks.map((t) => {
                  return (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setOpenTaskId(t.id)}
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

      {/* My Sprints — carrossel por projeto (estilo Ribbon) */}
      {data.sprints.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Meus Sprints</h2>
          {groupSprintsByProject(data.sprints).map((group) => (
            <div key={group.projectId} className="space-y-2">
              <div className="flex items-center justify-between">
                <Link
                  href={`/projects/${group.projectId}`}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {group.projectName}
                </Link>
                <span className="text-[11px] text-muted-foreground">
                  {group.sprints.length} sprint{group.sprints.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="overflow-x-auto pb-2">
                <div className="flex gap-2">
                  {group.sprints.map((s) => {
                    const pct = s.fpTotal > 0 ? Math.round((s.fpDone / s.fpTotal) * 100) : 0;
                    return (
                      <Link
                        key={s.id}
                        href={`/projects/${s.projectId}?tab=sprints&sprint=${s.id}`}
                        style={{ minWidth: 180 }}
                        className="flex shrink-0 flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/40 hover:border-primary/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{s.name}</span>
                          <StatusChip {...lookupChip(SPRINT_STATUS, s.status)} />
                        </div>
                        <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {fmtDateNumeric(s.startDate)} → {fmtDateNumeric(s.endDate)}
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {s.fpDone}/{s.fpTotal} PFV
                          </span>
                          <span className="font-mono tabular-nums font-medium">
                            {pct}%
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-[width]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
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

      <TaskSheetByRef
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onAfterChange={reload}
      />
    </div>
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

