"use client";

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ModuleRow } from "./module-row";
import { StoryRow } from "./story-row";
import type {
  HierarchyModuleNode,
  HierarchyTreeCallbacks,
  HierarchyTreeSlots,
} from "./types";

type Props = HierarchyTreeCallbacks &
  HierarchyTreeSlots & {
    tree: HierarchyModuleNode[] | null;
    loading?: boolean;
    error?: string | null;
    /** Quando o tree carregar pela primeira vez, módulos com stories abrem por default. */
    autoExpandWithStories?: boolean;
    /** Mensagem custom pro estado vazio. */
    emptyMessage?: string;
  };

/**
 * Componente presentational: renderiza uma árvore Module → Story → Task.
 * Não busca dados, não conhece sheets, não conhece MeetingTaskAction —
 * tudo vem via props/slots.
 *
 * Wrappers (DesignSessionTree, PlanningTree) ficam responsáveis por:
 *   • fetch do endpoint correspondente
 *   • realtime subscription
 *   • abrir sheets (TaskSheetByRef, StorySheetByRef, MeetingTaskActionSheet)
 *   • mapear actions → decorações/ghosts
 */
export function HierarchyTree({
  tree,
  loading,
  error,
  autoExpandWithStories = true,
  emptyMessage = "Nenhuma user story neste escopo.",
  onOpenTask,
  onOpenStory,
  onOpenAction,
  extraStoryActions,
  taskDecorations,
  storyDecorations,
  ghostTasksForStory,
}: Props) {
  // Overrides do usuário: chave → boolean (true=aberto, false=fechado).
  // Default vem dos props (auto-expand módulos com stories). Assim evitamos
  // setState em effect — o estado derivado é puro.
  const [userToggled, setUserToggled] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  const isExpanded = (mod: HierarchyModuleNode) => {
    const override = userToggled.get(mod.key);
    if (override !== undefined) return override;
    return autoExpandWithStories && mod.stories.length > 0;
  };

  const toggle = (mod: HierarchyModuleNode) => {
    const current = isExpanded(mod);
    setUserToggled((prev) => {
      const next = new Map(prev);
      next.set(mod.key, !current);
      return next;
    });
  };

  if (loading && !tree) {
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

  if (!tree || tree.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {tree.map((mod) => (
        <li key={mod.key}>
          <ModuleRow
            mod={mod}
            expanded={isExpanded(mod)}
            onToggle={() => toggle(mod)}
          >
            {mod.stories.map((story) => (
              <StoryRow
                key={story.id}
                story={story}
                decorations={storyDecorations?.(story.id)}
                ghostTasks={ghostTasksForStory?.(story.id)}
                getTaskDecorations={taskDecorations}
                extraActions={extraStoryActions?.(story)}
                onOpenStory={onOpenStory}
                onOpenTask={onOpenTask}
                onOpenAction={onOpenAction}
              />
            ))}
          </ModuleRow>
        </li>
      ))}
    </ul>
  );
}
