"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createForgeStore, type ForgeStore } from "@/lib/forge/store";
import { createMockSource } from "@/lib/forge/sources/mock";
import type { ForgeSource } from "@/lib/forge/source";
import type { ForgeState } from "@/lib/forge/types";

type Ctx = {
  store: ForgeStore;
  source: ForgeSource;
};

const ForgeContext = createContext<Ctx | null>(null);

type SelectionCtx = {
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
};

const SelectionContext = createContext<SelectionCtx | null>(null);

export function ForgeProvider({ children }: { children: React.ReactNode }) {
  const ctx = useMemo<Ctx>(() => {
    const store = createForgeStore();
    const source = createMockSource();
    source.onEvent((e) => store.dispatch(e));
    return { store, source };
  }, []);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selection = useMemo<SelectionCtx>(
    () => ({ selectedTaskId, setSelectedTaskId }),
    [selectedTaskId],
  );

  useEffect(() => {
    return () => {
      ctx.source.reset();
      ctx.store.reset();
    };
  }, [ctx]);

  return (
    <ForgeContext.Provider value={ctx}>
      <SelectionContext.Provider value={selection}>
        {children}
      </SelectionContext.Provider>
    </ForgeContext.Provider>
  );
}

export function useTaskSelection(): SelectionCtx {
  const ctx = useContext(SelectionContext);
  if (!ctx)
    throw new Error("useTaskSelection must be used inside <ForgeProvider>");
  return ctx;
}

export function useForge(): Ctx {
  const ctx = useContext(ForgeContext);
  if (!ctx) throw new Error("useForge must be used inside <ForgeProvider>");
  return ctx;
}

export function useForgeSlice<T>(
  selector: (s: ForgeState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const { store } = useForge();
  const lastRef = useRef<{ value: T; state: ForgeState } | null>(null);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const last = lastRef.current;
    if (last && last.state === state) return last.value;
    const value = selector(state);
    if (last && isEqual(last.value, value)) {
      lastRef.current = { value: last.value, state };
      return last.value;
    }
    lastRef.current = { value, state };
    return value;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
