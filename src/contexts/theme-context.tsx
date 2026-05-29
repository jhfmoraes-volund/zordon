"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setUserTheme } from "@/lib/theme/actions";
import { DEFAULT_THEME_ID, type ThemeId } from "@/lib/theme/themes";

type ThemeContextValue = {
  theme: ThemeId;
  /**
   * Aplica o tema imediato no DOM (otimista) e persiste em cookie + DB
   * via server action. Retorna `false` se a persistência falhou (state
   * já foi revertido pro tema anterior nesse caso).
   */
  setTheme: (next: ThemeId) => Promise<boolean>;
  /** True enquanto a server action está em voo. */
  pending: boolean;
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
  const [pending, setPending] = useState(false);
  const appliedRef = useRef<ThemeId>(initialTheme);

  // Sincroniza data-theme no DOM sempre que o state muda. SSR já pintou
  // com initialTheme — esse effect só roda quando muda de tema runtime.
  useEffect(() => {
    if (appliedRef.current !== theme) {
      document.documentElement.dataset.theme = theme;
      appliedRef.current = theme;
    }
  }, [theme]);

  const setTheme = useCallback(
    async (next: ThemeId): Promise<boolean> => {
      if (next === theme) return true;
      const previous = theme;
      setThemeState(next);
      setPending(true);
      try {
        const result = await setUserTheme(next);
        if (!result.ok) {
          setThemeState(previous);
          return false;
        }
        return true;
      } catch {
        setThemeState(previous);
        return false;
      } finally {
        setPending(false);
      }
    },
    [theme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, pending }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}
