"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AGENT_THEMES,
  type AgentId,
} from "@/components/ui/conversation/agent-themes";

function readStored(storageKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared plan/act toggle state for any agent's chat composer.
 *
 * Persists in localStorage (key per agent) so the choice survives reloads.
 * Uses a namespaced custom event so multiple <ChatComposer> instances on the
 * same page (e.g. pre-work + lateral chat) stay in sync without prop-drilling.
 *
 * Default: ACT (false).
 */
export function useChatPlanMode(agent: AgentId): {
  planMode: boolean;
  setPlanMode: (next: boolean) => void;
} {
  const theme = AGENT_THEMES[agent];
  const eventName = theme.planEventName;
  const storageKey = theme.planStorageKey;

  const [planMode, setLocal] = useState<boolean>(() => readStored(storageKey));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ value: boolean }>).detail;
      if (typeof detail?.value === "boolean") setLocal(detail.value);
    };
    window.addEventListener(eventName, onChange);
    return () => window.removeEventListener(eventName, onChange);
  }, [eventName]);

  const setPlanMode = useCallback(
    (next: boolean) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // localStorage write blocked — keep in-memory only via the event below.
      }
      window.dispatchEvent(
        new CustomEvent(eventName, { detail: { value: next } }),
      );
    },
    [eventName, storageKey],
  );

  return { planMode, setPlanMode };
}

/**
 * Read the current plan mode for an agent without subscribing — for use
 * inside transport body getters that re-run on every request.
 */
export function readPlanMode(agent: AgentId): boolean {
  return readStored(AGENT_THEMES[agent].planStorageKey);
}
