"use client";

import type { ReactNode } from "react";
import type { HierarchyStoryNode } from "@/lib/hierarchy-tree-types";

export type {
  HierarchyModuleNode,
  HierarchyStoryNode,
  HierarchyTaskNode,
} from "@/lib/hierarchy-tree-types";

/**
 * Tipos de decoração para os row components.
 *
 * O tree é puramente presentational — não sabe nada de MeetingTaskAction
 * nem de Vitor. Quem fornece os slots:
 *   • DS Briefing  → `extraStoryActions` (botões do Vitor: Detalhar/Gerar)
 *   • Planning     → `taskDecorations` + `ghostTasksForStory` + etc.
 */

/** Badge inline mostrado ao lado do título de uma task ou story. */
export type RowDecoration = {
  /** ID da action (usado pra key + onClick callback). */
  id: string;
  /** Texto curto (≤ 12 chars). Ex: "alterar", "remover", "saindo". */
  label: string;
  /** Símbolo de 1 char. Ex: "≠", "−", "→", "?". */
  glyph: string;
  /** Cor semântica. */
  tone: "create" | "update" | "delete" | "move" | "review";
  /** Strikethrough no título quando true (para delete). */
  strikethrough?: boolean;
  /** Opcional: tooltip extra ao hover. */
  hint?: string;
};

/** "Ghost task" (proposta de create) renderizada DENTRO de uma story. */
export type GhostTaskNode = {
  /** ID da MeetingTaskAction. */
  actionId: string;
  /** Título preview vindo do payload. */
  title: string;
  /** Reasoning do agente, se houver. */
  reasoning?: string | null;
  /** Confiança 0-1 (mostra "(87%)" se presente). */
  confidence?: number | null;
  /** Decoração (sempre tone='create' aqui, mas reusa o tipo). */
  decoration: RowDecoration;
};

/**
 * Callbacks que o caller plumba pra reagir a cliques.
 * Tree não sabe quais sheets abrem — só dispara o callback.
 */
export type HierarchyTreeCallbacks = {
  /** Click no corpo de uma task real → abrir TaskSheetByRef. */
  onOpenTask?: (taskId: string) => void;
  /** Click no corpo de uma story → abrir StorySheetByRef. */
  onOpenStory?: (storyRef: string) => void;
  /** Click numa decoração / ghost row → abrir MeetingTaskActionSheet (planning). */
  onOpenAction?: (actionId: string) => void;
};

/**
 * Slots de extensão. Tudo opcional — sem nenhum, o tree fica read-only puro.
 */
export type HierarchyTreeSlots = {
  /** Botões custom à direita do título de cada story (ex: Vitor Detalhar/Gerar). */
  extraStoryActions?: (story: HierarchyStoryNode) => ReactNode;
  /** Decorações (pins) sobre o título de uma task real. */
  taskDecorations?: (taskId: string) => RowDecoration[] | undefined;
  /** Decorações (pins) sobre o título de uma story. */
  storyDecorations?: (storyId: string) => RowDecoration[] | undefined;
  /** Ghost tasks (propostas create) a renderizar dentro de uma story. */
  ghostTasksForStory?: (storyId: string) => GhostTaskNode[] | undefined;
};
