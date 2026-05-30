"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

// Portal-based slot for step-contributed actions in the SubHeader.
//
// Why a portal and not setState(node):
// Consumers pass inline JSX (`<StepActions><button .../></StepActions>`),
// which is a new React element every render. Storing that element in
// provider state caused setState→render→setState loops ("Maximum update
// depth exceeded") that froze the whole DS page. With a portal, the
// provider only tracks the host DOM node; children re-render in place.

type Listener = (host: HTMLElement | null) => void;

type Ctx = {
  readonly hostRef: { current: HTMLElement | null };
  subscribe: (l: Listener) => () => void;
  setHost: (el: HTMLElement | null) => void;
};

const StepActionsContext = createContext<Ctx | null>(null);

function createCtx(): Ctx {
  const listeners = new Set<Listener>();
  const hostRef: { current: HTMLElement | null } = { current: null };
  return {
    hostRef,
    subscribe(l) {
      // Emit current host immediately so late subscribers don't miss it.
      l(hostRef.current);
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setHost(el) {
      if (hostRef.current === el) return;
      hostRef.current = el;
      listeners.forEach((l) => l(el));
    },
  };
}

export function StepActionsProvider({ children }: { children: React.ReactNode }) {
  const [ctx] = useState(createCtx);
  return (
    <StepActionsContext.Provider value={ctx}>
      {children}
    </StepActionsContext.Provider>
  );
}

/**
 * Render where step-contributed actions should appear (typically inside
 * StepSubHeader's actions slot). Registers itself as the portal host.
 */
export function StepActionsSlot({ className }: { className?: string }) {
  const ctx = useContext(StepActionsContext);
  const ref = useCallback(
    (el: HTMLSpanElement | null) => {
      ctx?.setHost(el);
    },
    [ctx],
  );
  return <span ref={ref} className={className} />;
}

/**
 * Step content uses this to render JSX into the SubHeader slot. Children
 * portal into the registered host; identity changes are fine — no provider
 * state is written on every render.
 */
export function StepActions({ children }: { children: React.ReactNode }) {
  const ctx = useContext(StepActionsContext);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(setHost);
  }, [ctx]);
  if (!host) return null;
  return createPortal(children, host);
}
