"use client";

/**
 * PlanningTree — Command Center da Planning.
 *
 * Combina duas camadas no mesmo componente visual:
 *   1. CAMADA REAL  → árvore Module → Story → Task (vinda do banco)
 *      • committed  = tasks com sprintId = sprint da planning
 *      • eligible   = backlog dos mesmos módulos (sprintId null)
 *   2. CAMADA PENDING → MeetingTaskAction(decision=pending OR execution=pending)
 *      • create  → ghost row dentro da story-alvo
 *      • update  → pin "≠ alterar" na task real
 *      • delete  → pin "− remover" + strikethrough na task real
 *      • move    → pin "→ saindo / entrando" na task real
 *      • review  → pin "? revisar" na task ou story
 *      • orphan  → bucket "Propostas sem âncora" abaixo do tree
 *
 * Click no nó real → TaskSheetByRef / StorySheetByRef (edição rica)
 * Click no pin OU ghost → MeetingTaskActionSheet (aprovar/rejeitar/editar payload)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Sparkles } from "lucide-react";
import { HierarchyTree } from "@/components/hierarchy-tree";
import type {
  GhostTaskNode,
  RowDecoration,
} from "@/components/hierarchy-tree";
import { DecorationPin } from "@/components/hierarchy-tree/task-row";
import { StorySheetByRef } from "@/components/story-sheet-by-ref";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import { MeetingTaskActionSheet } from "@/components/meetings/meeting-task-action-sheet";
import type { MeetingTaskAction } from "@/components/meetings/meeting-task-action-sheet";
import type {
  HierarchyModuleNode,
  HierarchyStats,
} from "@/lib/hierarchy-tree-types";
import type { PlanningAction } from "./proposal-card";
import { cn } from "@/lib/utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type TreeResponse = {
  planningId: string;
  projectId: string;
  sprintId: string | null;
  tree: HierarchyModuleNode[];
  stats: HierarchyStats;
};

/** Estado do TaskSheetByRef: abre por id (click em task real) OU por ref
 *  (navegação a partir do StorySheet). Apenas um simultâneo. */
type TaskSheetState = { kind: "id"; id: string } | { kind: "ref"; ref: string } | null;

type Props = {
  planningId: string;
  sprintId: string | null;
  /** Reportar stats agregados (tree + actions) pro PlanningRibbon. */
  onStatsChange?: (stats: PlanningTreeStats) => void;
};

export type PlanningTreeStats = HierarchyStats & {
  pendingActionCount: number;
  orphanActionCount: number;
};

export function PlanningTree({ planningId, sprintId, onStatsChange }: Props) {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [actions, setActions] = useState<PlanningAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [taskSheet, setTaskSheet] = useState<TaskSheetState>(null);
  const [openStoryRef, setOpenStoryRef] = useState<string | null>(null);
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [treeRes, actionsRes] = await Promise.all([
        fetch(`/api/planning/${planningId}/tree`),
        fetch(`/api/planning/${planningId}/actions`),
      ]);
      if (!treeRes.ok) {
        const j = await treeRes.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${treeRes.status}`);
        return;
      }
      const treeJson = (await treeRes.json()) as TreeResponse;
      setData(treeJson);
      if (actionsRes.ok) {
        const acts = (await actionsRes.json()) as PlanningAction[];
        setActions(acts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [planningId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Realtime subscription ──────────────────────────────────────────────
  useEffect(() => {
    if (!data?.projectId) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadAll(), 500);
    };

    const channel = client
      .channel(`planning-tree:${planningId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "MeetingTaskAction",
          filter: `planningCeremonyId=eq.${planningId}`,
        },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "Task",
          filter: `projectId=eq.${data.projectId}`,
        },
        debouncedReload,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "UserStory",
          filter: `projectId=eq.${data.projectId}`,
        },
        debouncedReload,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [data?.projectId, planningId, loadAll]);

  // ── Indexar actions ativas ──────────────────────────────────────────────
  // storyIdsInTree: ghost de create só renderiza pendurado num nó de story —
  // se a story-alvo não está na árvore (ex: dismissada), a proposta cai no
  // bucket de órfãs em vez de ficar invisível. null enquanto a árvore carrega.
  const storyIdsInTree = useMemo(() => {
    if (!data) return null;
    const ids = new Set<string>();
    for (const g of data.tree) for (const s of g.stories) ids.add(s.id);
    return ids;
  }, [data]);

  const decorations = useMemo(
    () => buildDecorations(actions, sprintId, storyIdsInTree),
    [actions, sprintId, storyIdsInTree],
  );

  // ── Reportar stats ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!data) return;
    onStatsChange?.({
      ...data.stats,
      pendingActionCount: actions.filter((a) => a.decision === "pending").length,
      orphanActionCount: decorations.orphans.length,
    });
  }, [data, actions, decorations.orphans.length, onStatsChange]);

  // ── Action selecionada (para o sheet) ───────────────────────────────────
  const selectedAction = useMemo(
    () => actions.find((a) => a.id === openActionId) ?? null,
    [actions, openActionId],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  if (!sprintId) {
    return (
      <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
        Sem sprint associada. Adicione uma sprint a esta planning para ver o
        backlog committed + elegível.
      </div>
    );
  }

  return (
    <>
      <HierarchyTree
        tree={data?.tree ?? null}
        loading={loading}
        error={error}
        emptyMessage="Nenhuma task na sprint nem backlog elegível neste escopo."
        onOpenTask={(id) => setTaskSheet({ kind: "id", id })}
        onOpenStory={(ref) => setOpenStoryRef(ref)}
        onOpenAction={(id) => setOpenActionId(id)}
        taskDecorations={(taskId) => decorations.byTaskId.get(taskId)}
        storyDecorations={(storyId) => decorations.byStoryId.get(storyId)}
        ghostTasksForStory={(storyId) => decorations.ghostsByStoryId.get(storyId)}
      />

      {decorations.orphans.length > 0 && (
        <OrphanProposalsPanel
          orphans={decorations.orphans}
          onOpenAction={(id) => setOpenActionId(id)}
        />
      )}

      <TaskSheetByRef
        taskId={taskSheet?.kind === "id" ? taskSheet.id : null}
        taskRef={taskSheet?.kind === "ref" ? taskSheet.ref : null}
        onClose={() => setTaskSheet(null)}
        onAfterChange={loadAll}
        onOpenStory={(ref) => {
          setTaskSheet(null);
          setOpenStoryRef(ref);
        }}
        onOpenTaskByRef={(ref) => {
          setTaskSheet(null);
          // Reabre no próximo tick para o keyed remount do TaskSheetByRef.
          setTimeout(() => setTaskSheet({ kind: "ref", ref }), 0);
        }}
      />

      <StorySheetByRef
        storyRef={openStoryRef}
        onClose={() => setOpenStoryRef(null)}
        onAfterChange={loadAll}
        onOpenTask={(taskRef) => {
          setOpenStoryRef(null);
          setTimeout(() => setTaskSheet({ kind: "ref", ref: taskRef }), 0);
        }}
      />

      {selectedAction && data && (
        <MeetingTaskActionSheet
          open={true}
          onOpenChange={(open) => !open && setOpenActionId(null)}
          action={selectedAction as MeetingTaskAction}
          projectId={data.projectId}
          decisionUrl={`/api/planning/${planningId}/actions/${selectedAction.id}`}
          onChange={() => {
            setOpenActionId(null);
            loadAll();
          }}
        />
      )}
    </>
  );
}

// ─── Mapeamento de actions → decorações + ghosts ───────────────────────────

type DecorationsIndex = {
  byTaskId: Map<string, RowDecoration[]>;
  byStoryId: Map<string, RowDecoration[]>;
  ghostsByStoryId: Map<string, GhostTaskNode[]>;
  orphans: PlanningAction[];
};

function buildDecorations(
  actions: PlanningAction[],
  planningSprintId: string | null,
  storyIdsInTree: Set<string> | null,
): DecorationsIndex {
  const byTaskId = new Map<string, RowDecoration[]>();
  const byStoryId = new Map<string, RowDecoration[]>();
  const ghostsByStoryId = new Map<string, GhostTaskNode[]>();
  const orphans: PlanningAction[] = [];

  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };

  for (const a of actions) {
    // Ignora actions já aplicadas (viraram realidade) ou rejeitadas.
    if (a.execution === "applied") continue;
    if (a.decision === "rejected") continue;

    const isApproved = a.decision === "approved" && a.execution === "pending";
    const labelSuffix = isApproved ? " ✓" : "";

    switch (a.type) {
      case "create": {
        const storyId = (a.payload?.userStoryId as string | null) ?? null;
        if (!storyId || (storyIdsInTree && !storyIdsInTree.has(storyId))) {
          orphans.push(a);
          break;
        }
        push(ghostsByStoryId, storyId, {
          actionId: a.id,
          title:
            (a.payload?.title as string | undefined) ??
            (a.payload?.description as string | undefined) ??
            "— sem título —",
          reasoning: a.aiReasoning,
          confidence: a.aiConfidence,
          decoration: {
            id: a.id,
            label: `nova${labelSuffix}`,
            glyph: "+",
            tone: "create",
            hint: a.aiReasoning ?? undefined,
          },
        });
        break;
      }
      case "update": {
        if (!a.taskId) {
          orphans.push(a);
          break;
        }
        push(byTaskId, a.taskId, {
          id: a.id,
          label: `alterar${labelSuffix}`,
          glyph: "≠",
          tone: "update",
          hint: a.aiReasoning ?? "Alteração proposta",
        });
        break;
      }
      case "delete": {
        if (!a.taskId) {
          orphans.push(a);
          break;
        }
        push(byTaskId, a.taskId, {
          id: a.id,
          label: `remover${labelSuffix}`,
          glyph: "−",
          tone: "delete",
          strikethrough: true,
          hint: a.aiReasoning ?? "Remoção proposta",
        });
        break;
      }
      case "move": {
        if (!a.taskId) {
          orphans.push(a);
          break;
        }
        const target = a.targetSprintId;
        const direction =
          target === planningSprintId
            ? "entrando"
            : target === null
              ? "p/ backlog"
              : "saindo";
        push(byTaskId, a.taskId, {
          id: a.id,
          label: `${direction}${labelSuffix}`,
          glyph: "→",
          tone: "move",
          hint: a.aiReasoning ?? "Mudança de sprint proposta",
        });
        break;
      }
      case "review": {
        const taskId = a.taskId;
        const storyId = (a.payload?.userStoryId as string | null) ?? null;
        if (taskId) {
          push(byTaskId, taskId, {
            id: a.id,
            label: `revisar${labelSuffix}`,
            glyph: "?",
            tone: "review",
            hint: a.aiReasoning ?? "Revisão solicitada",
          });
        } else if (storyId) {
          push(byStoryId, storyId, {
            id: a.id,
            label: `revisar${labelSuffix}`,
            glyph: "?",
            tone: "review",
            hint: a.aiReasoning ?? "Revisão solicitada",
          });
        } else {
          orphans.push(a);
        }
        break;
      }
    }
  }

  return { byTaskId, byStoryId, ghostsByStoryId, orphans };
}

// ─── Bucket de propostas sem âncora ─────────────────────────────────────────

function OrphanProposalsPanel({
  orphans,
  onOpenAction,
}: {
  orphans: PlanningAction[];
  onOpenAction: (id: string) => void;
}) {
  return (
    <section className="mt-4 rounded-lg border border-dashed border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/10 p-3 space-y-2">
      <header className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        <Sparkles className="h-3 w-3" />
        Propostas sem âncora
        <span className="font-mono normal-case tracking-normal text-muted-foreground">
          ({orphans.length})
        </span>
      </header>
      <ul className="space-y-1.5">
        {orphans.map((a) => {
          const decoration: RowDecoration = {
            id: a.id,
            label: a.type,
            glyph: glyphFor(a.type),
            tone: toneFor(a.type),
          };
          const title =
            (a.payload?.title as string | undefined) ??
            (a.payload?.description as string | undefined) ??
            a.task?.title ??
            "— sem título —";
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpenAction(a.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm",
                  "hover:bg-accent/40 transition-colors",
                )}
              >
                <DecorationPin decoration={decoration} />
                <span className="truncate flex-1">{title}</span>
                {a.aiConfidence != null && (
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground shrink-0">
                    {(a.aiConfidence * 100).toFixed(0)}%
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function glyphFor(type: PlanningAction["type"]): string {
  return { create: "+", update: "≠", delete: "−", move: "→", review: "?" }[type];
}
function toneFor(type: PlanningAction["type"]): RowDecoration["tone"] {
  return type;
}
