"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  ListChecks,
  Layers,
  FileText,
  Wrench,
} from "lucide-react";

// ─── Types (mirror /api/design-sessions/[id]/tree response) ─────────────────

export interface TreeTask {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  functionPoints: number | null;
  complexity: string;
  scope: string;
  acTechnicalCount: number;
}

export interface TreeStory {
  id: string;
  reference: string;
  title: string;
  want: string;
  soThat: string | null;
  refinementStatus: string;
  persona: { id: string; name: string } | null;
  acProductCount: number;
  tasks: TreeTask[];
}

export interface TreeModule {
  key: string;
  moduleId: string | null;
  name: string;
  approved: boolean;
  approvedAt: string | null;
  stories: TreeStory[];
}

export interface TreeStats {
  totalStories: number;
  totalTasks: number;
  draftTasks: number;
  totalFp: number;
  proposedModulesCount: number;
  approvedModulesCount: number;
}

interface TreeResponse {
  sessionId: string;
  projectId: string;
  tree: TreeModule[];
  stats: TreeStats;
}

// ─── Action contract ────────────────────────────────────────────────────────

export type TreeAction =
  | { type: "detail-story"; storyId: string; storyRef: string; title: string }
  | { type: "breakdown-story"; storyId: string; storyRef: string; title: string };

interface DesignSessionTreeProps {
  sessionId: string;
  /** When provided, action buttons appear and call this callback with the
   *  intended action. Parent is responsible for setting subPhase + sending
   *  a chat message. When omitted, the tree is read-only. */
  onAction?: (action: TreeAction) => Promise<void> | void;
  /** Open the StorySheet for read/edit. Decoupled from `onAction` (which
   *  drives Vitor) so clicking the title never sends a chat message. */
  onOpenStory?: (storyRef: string) => void;
  /** External refresh trigger — bump to force a re-fetch (e.g. after the
   *  parent sees Vitor finish streaming). */
  refreshKey?: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function DesignSessionTree({
  sessionId,
  onAction,
  onOpenStory,
  refreshKey = 0,
}: DesignSessionTreeProps) {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/tree`);
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setData(j);
      // Auto-expand modules that have stories — first load only.
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        for (const m of j.tree as TreeModule[]) {
          if (m.stories.length > 0) next.add(m.key);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // ── Realtime subscription on UserStory + Task changes for this project ───
  // We don't have projectId until the first fetch lands, so subscribe lazily.
  useEffect(() => {
    if (!data?.projectId) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), 500);
    };

    const channel = client
      .channel(`tree:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "UserStory", filter: `designSessionId=eq.${sessionId}` },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Task", filter: `designSessionId=eq.${sessionId}` },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Module", filter: `projectId=eq.${data.projectId}` },
        debouncedReload,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [data?.projectId, sessionId, load]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Aprovação granular (per-módulo, per-story) foi descontinuada. A briefing
  // tree é puramente espaço de trabalho — governance acontece atomicamente
  // pela SessionGovernanceBar do step de briefing (POST .../complete e .../reopen).

  const fireAction = async (action: TreeAction) => {
    if (!onAction) return;
    setBusyId(
      action.type === "detail-story"
        ? `detail:${action.storyId}`
        : `breakdown:${action.storyId}`,
    );
    try {
      await onAction(action);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm">
        Erro ao carregar árvore: {error}
      </div>
    );
  }

  if (!data || data.tree.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
        Nenhuma user story criada ainda. Peça ao Vitor para gerar o esqueleto da
        árvore (modo Tree).
      </div>
    );
  }

  // Stats agora vivem no BriefingRibbon do parent. Tree só renderiza módulos.

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {data.tree.map((mod) => (
          <li key={mod.key}>
            <ModuleNode
              mod={mod}
              expanded={expanded.has(mod.key)}
              onToggle={() => toggle(mod.key)}
              busy={busyId}
              onAction={onAction ? fireAction : undefined}
              onOpenStory={onOpenStory}
              onOpenTask={(taskId) => setOpenTaskId(taskId)}
            />
          </li>
        ))}
      </ul>

      <TaskSheetByRef
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onAfterChange={load}
      />
    </div>
  );
}

// ─── Module node ────────────────────────────────────────────────────────────

function ModuleNode({
  mod,
  expanded,
  onToggle,
  busy,
  onAction,
  onOpenStory,
  onOpenTask,
}: {
  mod: TreeModule;
  expanded: boolean;
  onToggle: () => void;
  busy: string | null;
  onAction?: (a: TreeAction) => Promise<void>;
  onOpenStory?: (storyRef: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const isOrphan = mod.key === "_orphan_";

  // Briefing tree não exibe estado de aprovação per-módulo no header — o
  // ciclo de aprovação acontece atomicamente via "Concluir sessão" no próprio
  // step de briefing. Mantém só identificação visual do grupo.
  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{mod.name}</span>
          {isOrphan && (
            <Badge variant="outline" className="text-[10px] py-0 h-5">
              sem módulo
            </Badge>
          )}
          <span className="text-xs text-muted-foreground shrink-0 ml-auto">
            {mod.stories.length} {mod.stories.length === 1 ? "story" : "stories"}
          </span>
        </button>
      </div>

      {/* Stories */}
      {expanded && (
        <ul className="border-t divide-y">
          {mod.stories.map((s) => (
            <StoryNode
              key={s.id}
              story={s}
              busy={busy}
              onAction={onAction}
              onOpenStory={onOpenStory}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Story node ─────────────────────────────────────────────────────────────

function StoryNode({
  story,
  busy,
  onAction,
  onOpenStory,
  onOpenTask,
}: {
  story: TreeStory;
  busy: string | null;
  onAction?: (a: TreeAction) => Promise<void>;
  onOpenStory?: (storyRef: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const [taskOpen, setTaskOpen] = useState(false);
  const detailBusy = busy === `detail:${story.id}`;
  const breakdownBusy = busy === `breakdown:${story.id}`;

  const refinementBadge = (() => {
    if (story.refinementStatus === "committed") {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px] py-0 h-5">
          committed
        </Badge>
      );
    }
    if (story.refinementStatus === "refined") {
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-0 text-[10px] py-0 h-5">
          refined
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[10px] py-0 h-5 text-muted-foreground">
        draft
      </Badge>
    );
  })();

  const showTasks = story.tasks.length > 0 && taskOpen;

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setTaskOpen(!taskOpen)}
          className="mt-0.5 text-muted-foreground hover:text-foreground"
          title={story.tasks.length > 0 ? "Expandir tasks" : ""}
          disabled={story.tasks.length === 0}
        >
          {story.tasks.length > 0 ? (
            taskOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="block w-3.5 h-3.5" />
          )}
        </button>

        <FileText className="h-3.5 w-3.5 mt-1 shrink-0 text-muted-foreground" />

        {onOpenStory ? (
          <button
            type="button"
            onClick={() => onOpenStory(story.reference)}
            className="flex-1 min-w-0 text-left rounded -mx-1 px-1 py-0.5 hover:bg-accent/40 transition-colors"
            title="Abrir detalhes da story"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-[10px] font-mono text-muted-foreground">
                {story.reference}
              </code>
              <span className="text-sm font-medium truncate group-hover:underline">
                {story.title}
              </span>
              {refinementBadge}
              {story.persona && (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  👤 {story.persona.name}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {story.acProductCount} AC · {story.tasks.length} tasks
              </span>
            </div>
            {story.want && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {story.want}
              </p>
            )}
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-[10px] font-mono text-muted-foreground">
                {story.reference}
              </code>
              <span className="text-sm font-medium truncate">{story.title}</span>
              {refinementBadge}
              {story.persona && (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  👤 {story.persona.name}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {story.acProductCount} AC · {story.tasks.length} tasks
              </span>
            </div>
            {story.want && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {story.want}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        {onAction && (
          <div className="flex items-center gap-1 shrink-0">
            {story.refinementStatus === "draft" && (
              <Button
                size="sm"
                variant="outline"
                disabled={detailBusy}
                onClick={() =>
                  onAction({
                    type: "detail-story",
                    storyId: story.id,
                    storyRef: story.reference,
                    title: story.title,
                  })
                }
                className="h-7 text-xs gap-1"
              >
                <Sparkles className="h-3 w-3" />
                Detalhar
              </Button>
            )}
            {story.refinementStatus === "refined" && (
              <Button
                size="sm"
                variant="outline"
                disabled={breakdownBusy}
                onClick={() =>
                  onAction({
                    type: "breakdown-story",
                    storyId: story.id,
                    storyRef: story.reference,
                    title: story.title,
                  })
                }
                className="h-7 text-xs gap-1"
              >
                <ListChecks className="h-3 w-3" />
                Gerar tasks
              </Button>
            )}
            {/* Story 'committed' não tem ação granular aqui — pra reabrir,
                use "Reabrir sessão" na página de Review (cascata atômica). */}
          </div>
        )}
      </div>

      {/* Tasks */}
      {showTasks && (
        <ul className="mt-2 ml-7 space-y-1">
          {story.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onOpenTask(t.id)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/40 text-left"
              >
                <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                <code className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {t.reference ?? "—"}
                </code>
                <span className="text-xs truncate flex-1">{t.title}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] py-0 h-5 ${
                    t.status === "draft"
                      ? "text-muted-foreground"
                      : "text-blue-700 dark:text-blue-400 border-blue-500/30"
                  }`}
                >
                  {t.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {t.functionPoints ?? 0} FP · {t.scope}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

