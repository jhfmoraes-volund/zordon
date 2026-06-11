"use client";

import { useCallback, useEffect, useState } from "react";

export type AgentSlug = "vitor" | "vitoria" | "alpha";
export type AgentChatMode = "openrouter" | "claude-daemon";

type AgentModeRow = { agentSlug: AgentSlug; mode: AgentChatMode };

/**
 * Hook que lê e escreve a preferência de modo do agente (openrouter | claude-daemon).
 *
 * - Default 'claude-daemon' até carregar do servidor (regra 2026-06: daemon é o
 *   caminho padrão; openrouter só sobra como fallback offline).
 * - `setMode` faz PUT otimista (atualiza local instantâneo, rollback em erro).
 * - Decisão é global por (user, agentSlug). Não muda por thread.
 *
 * Uso:
 *   const { mode, setMode, isLoading } = useAgentMode("vitor");
 */
export function useAgentMode(agentSlug: AgentSlug): {
  mode: AgentChatMode;
  setMode: (mode: AgentChatMode) => Promise<void>;
  isLoading: boolean;
  error: string | null;
} {
  const [mode, setLocalMode] = useState<AgentChatMode>("claude-daemon");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent-mode")
      .then((r) => (r.ok ? r.json() : { modes: [] }))
      .then((data: { modes: AgentModeRow[] }) => {
        if (cancelled) return;
        const row = data.modes?.find((m) => m.agentSlug === agentSlug);
        setLocalMode(row?.mode ?? "claude-daemon");
        setIsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentSlug]);

  const setMode = useCallback(
    async (next: AgentChatMode) => {
      const previous = mode;
      setLocalMode(next); // optimistic
      setError(null);
      try {
        const res = await fetch("/api/agent-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentSlug, mode: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setLocalMode(previous); // rollback
        setError(String(e));
      }
    },
    [agentSlug, mode],
  );

  return { mode, setMode, isLoading, error };
}

/**
 * Helper sem hook: lê todos os modes do user (útil em settings page).
 */
export async function fetchAllAgentModes(): Promise<AgentModeRow[]> {
  const res = await fetch("/api/agent-mode");
  if (!res.ok) return [];
  const data = (await res.json()) as { modes: AgentModeRow[] };
  return data.modes ?? [];
}
