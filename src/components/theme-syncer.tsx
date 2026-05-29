"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/contexts/theme-context";
import { isThemeId } from "@/lib/theme/themes";

/**
 * Reconcilia DB → cookie no primeiro mount após login.
 *
 * Cenário: user mudou tema em outro device. Cookie deste browser ainda
 * está no default; `Member.theme` no DB tem o tema escolhido. Aqui a
 * gente puxa o tema do DB (via prop do dashboard layout) e, se diferir
 * do tema atual do provider, chama `setTheme` — que reescreve o cookie
 * via server action.
 *
 * Roda só uma vez por mount (gated por ref). Renderiza null.
 */
export function ThemeSyncer({ dbTheme }: { dbTheme: string | null | undefined }) {
  const { theme, setTheme } = useTheme();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (dbTheme && isThemeId(dbTheme) && dbTheme !== theme) {
      void setTheme(dbTheme);
    }
  }, [dbTheme, theme, setTheme]);

  return null;
}
