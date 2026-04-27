"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskSheet } from "@/components/task-sheet";
import { ArrowLeft, BookOpen, CheckCircle2, Loader2, Rocket } from "lucide-react";
import {
  SCOPES, COMPLEXITIES, fmtDate,
} from "@/lib/task-constants";
import { StatusChip } from "@/components/ui/status-chip";
import { TASK_TYPE, lookupChip } from "@/lib/status-chips";

type ReviewTask = {
  id: string;
  title: string;
  description: string | null;
  reference: string | null;
  status: string;
  type: string;
  scope: string;
  complexity: string;
  functionPoints: number | null;
  priority: number;
  dueDate: string | null;
  projectId: string;
};

type Session = {
  id: string;
  title: string;
  type: string;
  status: string;
  totalSteps: number;
  projectId: string;
  project: { name: string } | null;
};

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [sessionR, tasksR] = await Promise.all([
      fetch(`/api/design-sessions/${id}`),
      fetch(`/api/design-sessions/${id}/tasks`),
    ]);

    const sessionJson = await sessionR.json();
    const tasksJson = await tasksR.json();

    if (!sessionR.ok) {
      setLoadError(`sessão: ${sessionJson.error ?? sessionR.status}`);
    }
    if (!tasksR.ok) {
      setLoadError(
        (prev) =>
          `${prev ? prev + " · " : ""}tasks: ${tasksJson.error ?? tasksR.status}`
      );
    }

    console.log("[review] session", sessionJson);
    console.log("[review] tasks", tasksJson);

    setSession(sessionJson);
    setTasks(tasksJson.tasks ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const draftTasks = tasks.filter((t) => t.status === "draft");
  const isCompleted = session?.status === "completed";

  const totalFp = draftTasks.reduce(
    (sum, t) => sum + (t.functionPoints ?? 0),
    0
  );

  const byScope = SCOPES.map((s) => ({
    key: s,
    count: draftTasks.filter((t) => t.scope === s).length,
  })).filter((s) => s.count > 0);

  const byComplexity = COMPLEXITIES.map((c) => ({
    key: c,
    count: draftTasks.filter((t) => t.complexity === c).length,
  })).filter((c) => c.count > 0);

  const byType = Array.from(
    draftTasks.reduce((acc, t) => {
      acc.set(t.type, (acc.get(t.type) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  );

  const handleExport = async () => {
    if (draftTasks.length === 0) {
      toast.error("Nenhuma task para exportar");
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(`/api/design-sessions/${id}/export`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Falha ao exportar");
        return;
      }
      toast.success(
        `${json.exported} task(s) exportadas — ${json.totalFp} FP no backlog do projeto`
      );
      await load();
      if (session?.projectId) {
        router.push(`/projects/${session.projectId}`);
      }
    } catch (e) {
      toast.error("Falha ao exportar");
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 text-muted-foreground">Sessão não encontrada.</div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/design-sessions/${id}/steps/${Math.max(
                0,
                (session.totalSteps ?? 1) - 1
              )}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Voltar para o briefing
            </Link>
            <Link
              href={`/design-sessions/${id}/memoria`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <BookOpen className="h-3 w-3" />
              Memória
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">{session.title}</h1>
          <p className="text-sm text-muted-foreground">
            Revisão das tasks antes de exportar para {session.project?.name ?? "o projeto"}
          </p>
        </div>
        {isCompleted ? (
          <Badge className="bg-green-500/20 text-green-400 gap-1.5">
            <CheckCircle2 className="h-3 w-3" /> Sessão exportada
          </Badge>
        ) : (
          <Button
            size="lg"
            onClick={handleExport}
            disabled={exporting || draftTasks.length === 0}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4 mr-2" />
            )}
            Exportar para o projeto
          </Button>
        )}
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm">
          Erro ao carregar: {loadError}
        </div>
      )}

      {!loadError && tasks.length > 0 && draftTasks.length === 0 && !isCompleted && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 text-sm">
          {tasks.length} task(s) vinculada(s) a esta sessão, mas nenhuma está em
          status <code className="font-mono text-xs">draft</code>. Status atuais:{" "}
          {Array.from(new Set(tasks.map((t) => t.status))).join(", ")}.
        </div>
      )}

      {/* ── Dashboard ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Tasks" value={draftTasks.length} />
        <StatCard label="Function Points" value={totalFp} />
        <StatCard
          label="Por escopo"
          value={
            byScope.length > 0
              ? byScope.map((s) => `${s.count} ${s.key}`).join(" · ")
              : "—"
          }
          small
        />
        <StatCard
          label="Por complexidade"
          value={
            byComplexity.length > 0
              ? byComplexity.map((c) => `${c.count} ${c.key}`).join(" · ")
              : "—"
          }
          small
        />
      </div>

      {byType.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {byType.map(([type, count]) => {
            const chip = lookupChip(TASK_TYPE, type);
            return (
              <StatusChip key={type} tone={chip.tone}>
                {count} {chip.label}
              </StatusChip>
            );
          })}
        </div>
      )}

      {/* ── Task list ── */}
      <Card>
        <CardContent className="p-0">
          {draftTasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {isCompleted
                ? "Tasks desta sessão já foram exportadas para o backlog."
                : "Nenhuma task gerada ainda. Volte ao Briefing e peça ao Vitor para gerar."}
            </div>
          ) : (
            <ul className="divide-y">
              {draftTasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => setOpenTaskId(task.id)}
                    className="w-full flex items-center gap-4 px-4 py-3 hover:bg-accent/40 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">
                          {task.title}
                        </span>
                        <StatusChip {...lookupChip(TASK_TYPE, task.type)} />
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                          {task.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                      <span className="tabular-nums">
                        {task.functionPoints ?? 0} FP
                      </span>
                      <span>
                        {task.scope} · {task.complexity}
                      </span>
                      {task.dueDate && <span>{fmtDate(task.dueDate)}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!isCompleted && (
        <p className="text-xs text-muted-foreground">
          As tasks ficam em rascunho até o export. Nenhuma delas aparece no backlog
          do projeto ainda. Ao exportar, cada task recebe um identificador TASK-NNN
          e a sessão é marcada como concluída.
        </p>
      )}

      <TaskSheet
        taskId={openTaskId}
        open={openTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
        onChange={load}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={
            small ? "text-sm font-medium mt-1" : "text-2xl font-semibold mt-1 tabular-nums"
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
