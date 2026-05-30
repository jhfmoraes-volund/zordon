"use client";

import { createContext, useContext, useEffect, useState, useMemo } from "react";

type StepActionsContextValue = {
  actions: React.ReactNode;
  setActions: (node: React.ReactNode) => void;
};

const StepActionsContext = createContext<StepActionsContextValue | null>(null);

export function StepActionsProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<React.ReactNode>(null);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return (
    <StepActionsContext.Provider value={value}>
      {children}
    </StepActionsContext.Provider>
  );
}

export function useStepActionsSlot(): React.ReactNode {
  const ctx = useContext(StepActionsContext);
  return ctx?.actions ?? null;
}

/**
 * Step content uses this to inject contextual chips/buttons into the
 * StepSubHeader's right-side `actions` slot. The slot resets to null on
 * unmount, so navigating to another step clears it automatically.
 */
export function useProvideStepActions(node: React.ReactNode) {
  const ctx = useContext(StepActionsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(node);
    return () => ctx.setActions(null);
  }, [ctx, node]);
}
