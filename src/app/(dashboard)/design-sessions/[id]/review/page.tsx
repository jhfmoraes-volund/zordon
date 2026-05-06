"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DesignSessionTree } from "@/components/design-session/design-session-tree";
import { StorySheetByRef } from "@/components/story-sheet-by-ref";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import { getStepsForSession } from "@/lib/design-session-steps";
import { ArrowLeft, BookOpen, CheckCircle2, Loader2, Flag } from "lucide-react";

type Session = {
  id: string;
  title: string;
  type: string;
  status: string;
  totalSteps: number;
  projectId: string;
  project: { name: string } | null;
  selectedSteps: string[] | null;
};

type TreeStats = {
  totalStories: number;
  totalTasks: number;
  draftTasks: number;
  totalFp: number;
  proposedModulesCount: number;
  approvedModulesCount: number;
};

type TreeData = {
  tree: Array<{
    key: string;
    name: string;
    approved: boolean;
    stories: Array<{
      id: string;
      reference: string;
      refinementStatus: string;
      tasks: Array<{ id: string }>;
    }>;
  }>;
  stats: TreeStats;
};

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openStoryRef, setOpenStoryRef] = useState<string | null>(null);
  const [openTaskRef, setOpenTaskRef] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [sessionR, treeR] = await Promise.all([
      fetch(`/api/design-sessions/${id}`),
      fetch(`/api/design-sessions/${id}/tree`),
    ]);

    const sessionJson = await sessionR.json();
    const treeJson = await treeR.json();

    if (!sessionR.ok) setLoadError(`sessão: ${sessionJson.error ?? sessionR.status}`);
    if (!treeR.ok) {
      setLoadError(
        (prev) => `${prev ? prev + " · " : ""}árvore: ${treeJson.error ?? treeR.status}`,
      );
    }

    setSession(sessionJson);
    setTreeData(treeJson);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isCompleted = session?.status === "completed";
  const stats = treeData?.stats;

  // ── Completion gating ────────────────────────────────────────────────────
  // Tasks are promoted to backlog at module-approval time (not here). To
  // close the session, every story needs to be wrapped into an approved
  // module — otherwise its tasks remain `draft` and orphaned.
  //
  // Block when:
  //   1. Any proposed module still pending → its tasks haven't been promoted.
  //   2. Any module exists but isn't approved → same problem.
  //   3. Any story has 0 tasks → incomplete breakdown, nothing to promote.
  const blockers: string[] = [];
  if (treeData) {
    if (stats && stats.proposedModulesCount > 0) {
      blockers.push(
        `Aprovar ${stats.proposedModulesCount} módulo(s) proposto(s)`,
      );
    }
    const draftModules = treeData.tree.filter(
      (m) => m.key.startsWith("module:") && !m.approved,
    );
    if (draftModules.length > 0) {
      blockers.push(
        `Aprovar ${draftModules.length} módulo(s) ainda em rascunho`,
      );
    }
    for (const mod of treeData.tree) {
      for (const s of mod.stories) {
        if (
          (s.refinementStatus === "draft" || s.refinementStatus === "refined") &&
          s.tasks.length === 0
        ) {
          blockers.push(`${s.reference}: gere as tasks ou descarte a story`);
        }
      }
    }
  }
  const canComplete = blockers.length === 0;

  const handleComplete = async () => {
    if (!canComplete) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/design-sessions/${id}/complete`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.message || json.error || "Falha ao concluir sessão");
        return;
      }
      toast.success("Sessão concluída");
      await load();
      if (session?.projectId) {
        router.push(`/projects/${session.projectId}`);
      }
    } catch (e) {
      toast.error("Falha ao concluir sessão");
      console.error(e);
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!session) {
    return <div className="p-6 text-muted-foreground">Sessão não encontrada.</div>;
  }

  // Derive briefing step index from canonical step list — `totalSteps` is a
  // legacy column that doesn't include the auto-injected `briefing` step.
  const steps = getStepsForSession({
    type: session.type,
    selectedSteps: session.selectedSteps ?? null,
  });
  const briefingIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === "briefing"),
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/design-sessions/${id}/steps/${briefingIndex}`}
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
            Revisão final — tasks já entram no backlog de{" "}
            {session.project?.name ?? "o projeto"} no momento que você aprova
            cada módulo. Aqui é só o fechamento da sessão.
          </p>
        </div>
        {isCompleted ? (
          <Badge className="bg-green-500/20 text-green-400 gap-1.5">
            <CheckCircle2 className="h-3 w-3" /> Sessão concluída
          </Badge>
        ) : (
          <Button
            size="lg"
            onClick={handleComplete}
            disabled={completing || !canComplete}
            title={blockers.join(" · ") || "Marcar sessão como concluída"}
          >
            {completing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Flag className="h-4 w-4 mr-2" />
            )}
            Concluir sessão
          </Button>
        )}
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm">
          Erro ao carregar: {loadError}
        </div>
      )}

      {/* ── Blockers ── */}
      {!isCompleted && blockers.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 text-sm space-y-1">
          <p className="font-semibold">Pendências para concluir a sessão:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {blockers.slice(0, 8).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
            {blockers.length > 8 && (
              <li className="text-muted-foreground">
                ... +{blockers.length - 8} pendência(s)
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ── Tree (read-only: no onAction) ── */}
      <DesignSessionTree
        sessionId={id}
        refreshKey={refreshKey}
        onOpenStory={(ref) => setOpenStoryRef(ref)}
      />

      <StorySheetByRef
        storyRef={openStoryRef}
        onClose={() => setOpenStoryRef(null)}
        onAfterChange={() => setRefreshKey((k) => k + 1)}
        onOpenTask={(taskRef) => {
          setOpenStoryRef(null);
          setOpenTaskRef(taskRef);
        }}
      />

      <TaskSheetByRef
        taskRef={openTaskRef}
        onClose={() => setOpenTaskRef(null)}
        onAfterChange={() => setRefreshKey((k) => k + 1)}
        onOpenStory={(storyRef) => {
          setOpenTaskRef(null);
          setOpenStoryRef(storyRef);
        }}
        onOpenTaskByRef={(taskRef) => {
          setOpenTaskRef(null);
          setTimeout(() => setOpenTaskRef(taskRef), 0);
        }}
      />

      {!isCompleted && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Tasks viram <code className="font-mono">backlog</code> no momento
            em que você aprova o módulo correspondente — não tem "exportação em
            massa". Refs <code className="font-mono">{"<KEY>-T-NNN"}</code> são
            estáveis desde a criação. Concluir a sessão só marca o status; pode
            ser feito quando todos os módulos estiverem aprovados.
          </span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="text-xs underline hover:text-foreground shrink-0"
          >
            Atualizar
          </button>
        </div>
      )}
    </div>
  );
}
