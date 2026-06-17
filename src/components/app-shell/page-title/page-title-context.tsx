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
  /**
   * When true, the shell header suppresses the title/subtitle (the page's hero
   * is showing it). Driven by <PageTitle revealOnScroll> via an IntersectionObserver.
   */
  hidden: boolean;
  set: (state: PageTitleState) => void;
  setHidden: (hidden: boolean) => void;
  clear: () => void;
};

const PageTitleContext = createContext<Ctx | null>(null);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageTitleState>({
    title: null,
    subtitle: null,
    backHref: null,
  });
  const [hidden, setHiddenState] = useState(false);

  const set = useCallback((next: PageTitleState) => setState(next), []);
  const setHidden = useCallback((next: boolean) => setHiddenState(next), []);
  const clear = useCallback(
    () => setState({ title: null, subtitle: null, backHref: null }),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ ...state, hidden, set, setHidden, clear }),
    [state, hidden, set, setHidden, clear],
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
