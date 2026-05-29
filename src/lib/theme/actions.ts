"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isThemeId, type ThemeId } from "./themes";
import { THEME_COOKIE_NAME, THEME_COOKIE_MAX_AGE } from "./server";

/**
 * Persiste o tema do usuário em duas camadas:
 *  - cookie `volund.theme` (sessão atual, lido no SSR sem flash)
 *  - Member.theme no Supabase (cross-device, cross-browser)
 *
 * Não autenticado: só cookie. Autenticado: cookie + DB.
 */
export async function setUserTheme(
  next: ThemeId,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isThemeId(next)) {
    return { ok: false, reason: "invalid_theme_id" };
  }

  const store = await cookies();
  store.set(THEME_COOKIE_NAME, next, {
    maxAge: THEME_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: false, // client (ThemeProvider) também precisa ler em casos de fallback
  });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    // Visitante (página de auth) — só cookie. Sem erro.
    return { ok: true };
  }

  const { error } = await supabase
    .from("Member")
    .update({ theme: next, updatedAt: new Date().toISOString() })
    .eq("userId", userId);

  if (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}
