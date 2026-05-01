"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PageTitleState = {
  title: ReactNode | null;
  subtitle: ReactNode | null;
  /** When set, the shell header renders a back button to this href before the title. */
  backHref: string | null;
};

type Ctx = PageTitleState & {
  set: (state: PageTitleState) => void;
  clear: () => void;
};

const PageTitleContext = createContext<Ctx | null>(null);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageTitleState>({
    title: null,
    subtitle: null,
    backHref: null,
  });

  const set = useCallback((next: PageTitleState) => setState(next), []);
  const clear = useCallback(
    () => setState({ title: null, subtitle: null, backHref: null }),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ ...state, set, clear }),
    [state, set, clear],
  );

  return (
    <PageTitleContext.Provider value={value}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  if (!ctx) {
    throw new Error("usePageTitle must be used within PageTitleProvider");
  }
  return ctx;
}
