import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themes";

/**
 * Cookie name. Lido pelo root layout no SSR pra setar `<html data-theme>`
 * sem flash. Escrito pela server action `setUserTheme` em ./actions.ts.
 *
 * Long TTL (1 ano) — tema é preferência estável; raramente muda.
 */
export const THEME_COOKIE_NAME = "volund.theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Server-side: lê o tema salvo no cookie. Retorna o default se ausente
 * ou inválido. Usado pelo root layout pra pintar data-theme no SSR.
 */
export async function readThemeCookie(): Promise<ThemeId> {
  const store = await cookies();
  const raw = store.get(THEME_COOKIE_NAME)?.value;
  return raw && isThemeId(raw) ? raw : DEFAULT_THEME_ID;
}
