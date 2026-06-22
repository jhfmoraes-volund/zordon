"use client";

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

export type TasksViewMode = "list" | "kanban";

// Global (project-agnostic) preference — todas as instâncias de <TasksList>
// (sprint focado, backlog, all) compartilham o mesmo modo. Espelha o
// precedente de overview/projetos-board (VIEW_STORAGE_KEY + localStorage).
const STORAGE_KEY = "sprints:tasksViewMode";
// CustomEvent namespaceado pra sincronizar múltiplas toolbars na mesma página
// sem prop-drilling — mesmo padrão de use-chat-plan-mode.
const EVENT_NAME = "zordon:tasks-view-mode";

function readStored(): TasksViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "list" || v === "kanban" ? v : null;
  } catch {
    // localStorage bloqueado (private mode/iframe) — cai no default.
    return null;
  }
}

/**
 * Estado compartilhado do toggle Lista ↔ Kanban das listas de task.
 *
 * - Persiste em localStorage (sobrevive reload); escolha do usuário sempre vence.
 * - Mobile FORÇA "list" (colunas de Kanban não empilham bem < 768px); o toggle
 *   nem aparece no mobile. Default no desktop = "kanban" (espelha projetos-board).
 * - `isMobile` é exposto pra a toolbar decidir se renderiza o botão.
 */
export function useTasksViewMode(): {
  viewMode: TasksViewMode;
  setViewMode: (next: TasksViewMode) => void;
  isMobile: boolean;
} {
  const isMobile = useIsMobile();
  const [stored, setStored] = useState<TasksViewMode | null>(() => readStored());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ value: TasksViewMode }>).detail;
      if (detail?.value === "list" || detail?.value === "kanban") {
        setStored(detail.value);
      }
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, []);

  const setViewMode = useCallback((next: TasksViewMode) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // write bloqueado — fica só em memória via o evento abaixo.
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { value: next } }));
  }, []);

  const viewMode: TasksViewMode = isMobile ? "list" : stored ?? "kanban";

  return { viewMode, setViewMode, isMobile };
}
