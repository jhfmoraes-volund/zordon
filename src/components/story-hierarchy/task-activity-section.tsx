"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

type ActivityItem = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string | null } | null;
};

type Props = {
  /** Task DB id (uuid). When null/undefined, nothing is fetched. */
  taskId: string | null | undefined;
};

export function TaskActivitySection({ taskId }: Props) {
  if (!taskId) return null;
  return <TaskActivitySectionInner key={taskId} taskId={taskId} />;
}

function TaskActivitySectionInner({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/tasks/${taskId}/activity`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => "fetch failed"));
        return r.json();
      })
      .then((data) => {
        setItems((data?.activity ?? []) as ActivityItem[]);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Erro ao carregar atividades");
        setItems([]);
      });
    return () => ctrl.abort();
  }, [taskId]);

  if (items === null) {
    return (
      <SectionShell>
        <p className="text-[11px] text-muted-foreground">Carregando…</p>
      </SectionShell>
    );
  }
  if (error) {
    return (
      <SectionShell>
        <p className="text-[11px] text-destructive">{error}</p>
      </SectionShell>
    );
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <SectionShell>
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        {items.map((it) => (
          <li key={it.id}>{renderItem(it)}</li>
        ))}
      </ul>
    </SectionShell>
  );
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Activity className="size-3" />
        Atividade
      </div>
      {children}
    </div>
  );
}

function renderItem(it: ActivityItem): React.ReactNode {
  const actor = it.actor?.name ?? null;
  const when = formatRelative(it.createdAt);
  const p = it.payload ?? {};

  switch (it.type) {
    case "duplicated": {
      const ref = (p.newTaskRef as string | undefined) ?? "—";
      return (
        <>
          Duplicada como <span className="font-mono">{ref}</span>
          {actor ? <> por {actor}</> : null} · {when}
        </>
      );
    }
    case "cloned_to": {
      const ref = (p.newTaskRef as string | undefined) ?? "—";
      const proj = (p.targetProjectName as string | undefined) ?? "outro projeto";
      return (
        <>
          Clonada para <strong className="text-foreground">{proj}</strong> como{" "}
          <span className="font-mono">{ref}</span>
          {actor ? <> por {actor}</> : null} · {when}
        </>
      );
    }
    case "cloned_from": {
      const ref = (p.sourceTaskRef as string | undefined) ?? "—";
      const proj = (p.sourceProjectName as string | undefined) ?? "projeto origem";
      return (
        <>
          Clonada de <strong className="text-foreground">{proj}</strong> (
          <span className="font-mono">{ref}</span>)
          {actor ? <> por {actor}</> : null} · {when}
        </>
      );
    }
    default:
      return (
        <>
          {it.type}
          {actor ? <> por {actor}</> : null} · {when}
        </>
      );
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `${d}d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
