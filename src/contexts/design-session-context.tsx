"use client";

import { createContext, useContext, useCallback, type ReactNode } from "react";

interface DesignSessionContextValue {
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  currentStepKey: string;
  currentStepIndex: number;
  stepData: Record<string, unknown>;
  saveStepData: (data: Record<string, unknown>) => void;
  refreshStepData: () => Promise<void>;
}

const DesignSessionContext = createContext<DesignSessionContextValue | null>(null);

export function DesignSessionProvider({
  sessionId,
  sessionTitle,
  sessionType,
  currentStepKey,
  currentStepIndex,
  stepData,
  saveStepData,
  refreshStepData,
  children,
}: DesignSessionContextValue & { children: ReactNode }) {
  return (
    <DesignSessionContext.Provider
      value={{
        sessionId,
        sessionTitle,
        sessionType,
        currentStepKey,
        currentStepIndex,
        stepData,
        saveStepData,
        refreshStepData,
      }}
    >
      {children}
    </DesignSessionContext.Provider>
  );
}

export function useDesignSession() {
  const ctx = useContext(DesignSessionContext);
  if (!ctx) throw new Error("useDesignSession must be used within DesignSessionProvider");
  return ctx;
}
