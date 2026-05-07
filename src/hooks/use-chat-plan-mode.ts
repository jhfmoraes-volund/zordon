"use client";

import { useCallback, useState, useEffect } from "react";

const STORAGE_KEY = "design-session.planMode";
const EVENT_NAME = "chat-plan-mode-change";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared plan/act toggle state for any Vitor chat composer.
 *
 * Persists in localStorage so the choice survives reloads. Uses a custom
 * window event so multiple <ChatComposer> instances on the same page (e.g.
 * pre-work + lateral chat) stay in sync without prop-drilling.
 *
 * Default: ACT (false).
 */
export function useChatPlanMode(): {
  planMode: boolean;
  setPlanMode: (next: boolean) => void;
} {
  const [planMode, setLocal] = useState<boolean>(readStored);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ value: boolean }>).detail;
      if (typeof detail?.value === "boolean") setLocal(detail.value);
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, []);

  const setPlanMode = useCallback((next: boolean) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // localStorage write blocked — keep in-memory only via the event below.
    }
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: { value: next } }),
    );
  }, []);

  return { planMode, setPlanMode };
}

/**
 * Read the current plan mode without subscribing — for use inside transport
 * body getters that re-run on every request. Avoids needing a hook in
 * non-React code paths.
 */
export function readPlanMode(): boolean {
  return readStored();
}
