"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, FlaskConical } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PixelBar } from "@/components/ui/pixel-bar";
import { StatusChip } from "@/components/ui/status-chip";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";

type ForgeRunLite = {
  id: string;
  status: string;
  progress: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

type HubProject = {
  id: string;
  name: string;
  status: string;
  client: { name: string } | null;
  lastRun: ForgeRunLite | null;
  agentCount: number;
  taskCount: number;
};

function lastActivityAt(p: HubProject): number {
  const r = p.lastRun;
  if (r) {
    const ts = r.startedAt ?? r.createdAt;
    return new Date(ts).getTime();
  }
  return 0;
}

export function ForgeHub() {
  const [projects, setProjects] = useState<HubProject[] | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: projectsRes } = await supabase
        .from("Project")
        .select(
          'id, name, status, client:Client(name), runs:ForgeRun(id, status, progress, startedAt, endedAt, createdAt)',
        )
        .order("createdAt", { ascending: false });

      if (!projectsRes) {
        setProjects([]);
        return;
      }

      const ids = projectsRes.map((p) => p.id);
      const [tasksRes, agentsRes] = await Promise.all([
        ids.length > 0
          ? supabase.from("ForgeTask").select("projectId").in("projectId", ids)
          : Promise.resolve({ data: [] }),
        ids.length > 0
          ? supabase
              .from("ForgeAgent")
              .select('id, run:ForgeRun!inner(projectId)')
              .in("status", ["spawning", "thinking", "tool", "streaming"])
          : Promise.resolve({ data: [] }),
      ]);

      const taskCount = new Map<string, number>();
      for (const t of (tasksRes.data ?? []) as { projectId: string }[]) {
        taskCount.set(t.projectId, (taskCount.get(t.projectId) ?? 0) + 1);
      }

      const agentCount = new Map<string, number>();
      for (const a of (agentsRes.data ?? []) as {
        run: { projectId: string } | null;
      }[]) {
        const pid = a.run?.projectId;
        if (!pid) continue;
        agentCount.set(pid, (agentCount.get(pid) ?? 0) + 1);
      }

      const hub: HubProject[] = projectsRes.map((p) => {
        const runs = (p.runs ?? []) as ForgeRunLite[];
        const sorted = [...runs].sort(
          (a, b) =>
            new Date(b.startedAt ?? b.createdAt).getTime() -
            new Date(a.startedAt ?? a.createdAt).getTime(),
        );
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          client: (p.client as { name: string } | null) ?? null,
          lastRun: sorted[0] ?? null,
          taskCount: taskCount.get(p.id) ?? 0,
          agentCount: agentCount.get(p.id) ?? 0,
        };
      });

      hub.sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
      setProjects(hub);
    };
    load();
  }, []);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">FORGE</h1>
            <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              hub
            </span>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Flame className="size-3.5" aria-hidden />
            Selecione um projeto pra entrar no observatório da forja.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/forge/sandbox" />}
        >
          <FlaskConical />
          Sandbox (mock)
        </Button>
      </header>

      {projects === null ? (
        <HubLoading />
      ) : projects.length === 0 ? (
        <HubEmpty />
      ) : (
        <Card className="overflow-hidden">
          <HubHeader />
          <div className="divide-y divide-border/60">
            {projects.map((p) => (
              <HubRow key={p.id} project={p} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const GRID_COLS = "minmax(220px, 1fr) 140px 120px 200px 70px 70px";

function HubHeader() {
  return (
    <div
      className="grid gap-3 border-b bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span>Projeto</span>
      <span>Cliente</span>
      <span>Status</span>
      <span>Forge</span>
      <span className="text-right">Agentes</span>
      <span className="text-right">Tasks</span>
    </div>
  );
}

function HubRow({ project }: { project: HubProject }) {
  const run = project.lastRun;
  const score = run ? run.progress : null;
  const runLabel = run
    ? run.status === "running"
      ? "rodando"
      : run.status === "done"
        ? "concluído"
        : run.status === "error"
          ? "erro"
          : run.status === "queued"
            ? "na fila"
            : run.status
    : "ocioso";

  return (
    <Link
      href={`/projects/${project.id}?tab=forge`}
      className="grid items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <span className="truncate font-medium">{project.name}</span>
      <span className="truncate text-muted-foreground">
        {project.client?.name ?? "—"}
      </span>
      <span>
        <StatusChip {...lookupChip(PROJECT_STATUS, project.status)} dot />
      </span>
      <div className="flex items-center gap-2">
        <PixelBar
          score={score}
          cells={12}
          height={6}
          variant="skill"
          glow={false}
        />
        <span className="w-16 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {runLabel}
        </span>
      </div>
      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {project.agentCount}
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {project.taskCount}
      </span>
    </Link>
  );
}

function HubLoading() {
  return (
    <Card className="grid min-h-[280px] place-items-center p-8 text-center">
      <p className="text-sm text-muted-foreground">Carregando forjas…</p>
    </Card>
  );
}

function HubEmpty() {
  return (
    <Card className="grid min-h-[280px] place-items-center p-8 text-center">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Nenhum projeto disponível.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Você precisa ter acesso a um projeto pra ver a forja dele.
        </p>
      </div>
    </Card>
  );
}
