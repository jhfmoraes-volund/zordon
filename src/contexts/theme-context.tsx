"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  isThemeId,
  type ThemeId,
} from "@/lib/theme/themes";

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME_ID,
}: {
  children: ReactNode;
  initialTheme?: ThemeId;
}) {
  const [theme, setThemeState] = useState<ThemeId>(initialTheme);

  // Sync React state with localStorage (the bootstrap script já tratou o DOM).
  // Hydration-safe: server e client primeiro paint usam `initialTheme`; o
  // ajuste vem só num effect, evitando mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored && isThemeId(stored) && stored !== theme) {
        setThemeState(stored);
      }
    } catch {
      // localStorage indisponível (modo privado/SSR snapshot) — ignora.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplica mudanças: DOM + storage.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignora
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}
