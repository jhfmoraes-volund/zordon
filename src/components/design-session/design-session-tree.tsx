"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import { ListChecks, Sparkles } from "lucide-react";
import { HierarchyTree } from "@/components/hierarchy-tree";
import type {
  HierarchyModuleNode,
  HierarchyStoryNode,
  HierarchyTaskNode,
} from "@/components/hierarchy-tree";

// ─── Re-exports (compat com callers existentes) ─────────────────────────────

export type TreeTask = HierarchyTaskNode;
export type TreeStory = HierarchyStoryNode;
export type TreeModule = HierarchyModuleNode;

export interface TreeStats {
  totalStories: number;
  totalTasks: number;
  draftTasks: number;
  totalFp: number;
  proposedModulesCount: number;
  approvedModulesCount: number;
}

// ─── Action contract — específico do Vitor na DS ────────────────────────────

export type TreeAction =
  | { type: "detail-story"; storyId: string; storyRef: string; title: string }
  | { type: "breakdown-story"; storyId: string; storyRef: string; title: string };

interface DesignSessionTreeProps {
  sessionId: string;
  /** Botões "Detalhar" / "Gerar tasks" chamam isto (sobe pro parent que dispara
   *  o Vitor via chat). Sem isto, o tree fica read-only. */
  onAction?: (action: TreeAction) => Promise<void> | void;
  /** Click no título da story → abrir StorySheetByRef no parent. */
  onOpenStory?: (storyRef: string) => void;
  /** Bump pra forçar re-fetch (ex: depois que Vitor termina streaming). */
  refreshKey?: number;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type TreeResponse = {
  sessionId: string;
  projectId: string;
  tree: TreeModule[];
  stats: TreeStats;
};

export function DesignSessionTree({
  sessionId,
  onAction,
  onOpenStory,
  refreshKey = 0,
}: DesignSessionTreeProps) {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // ── Realtime subscription (Story/Task/Module deste projeto) ──────────
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
        {
          event: "*",
          schema: "public",
          table: "UserStory",
          filter: `designSessionId=eq.${sessionId}`,
        },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "Task",
          filter: `designSessionId=eq.${sessionId}`,
        },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "Module",
          filter: `projectId=eq.${data.projectId}`,
        },
        debouncedReload,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [data?.projectId, sessionId, load]);

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

  const renderVitorActions = (story: TreeStory) => {
    if (!onAction) return null;
    const detailBusy = busyId === `detail:${story.id}`;
    const breakdownBusy = busyId === `breakdown:${story.id}`;
    return (
      <>
        {story.refinementStatus === "draft" && (
          <Button
            size="sm"
            variant="outline"
            disabled={detailBusy}
            onClick={(e) => {
              e.stopPropagation();
              fireAction({
                type: "detail-story",
                storyId: story.id,
                storyRef: story.reference,
                title: story.title,
              });
            }}
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
            onClick={(e) => {
              e.stopPropagation();
              fireAction({
                type: "breakdown-story",
                storyId: story.id,
                storyRef: story.reference,
                title: story.title,
              });
            }}
            className="h-7 text-xs gap-1"
          >
            <ListChecks className="h-3 w-3" />
            Gerar tasks
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      <HierarchyTree
        tree={data?.tree ?? null}
        loading={loading}
        error={error}
        onOpenStory={onOpenStory}
        onOpenTask={(taskId) => setOpenTaskId(taskId)}
        extraStoryActions={renderVitorActions}
        emptyMessage="Nenhum PRD criado ainda. Peça ao Vitor para gerar PRDs (modo PRD Tree)."
      />

      <TaskSheetByRef
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onAfterChange={load}
      />
    </>
  );
}
