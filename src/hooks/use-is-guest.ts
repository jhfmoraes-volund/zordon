"use client";

import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";

/**
 * True iff o nível efetivo do usuário é 'guest' (abaixo de builder).
 *
 * Use em componentes que precisam esconder PFV / botões internos / etc. quando
 * o viewer é guest. Para impersonation, segue o nível efetivo (admin
 * impersonando guest vê como guest).
 */
export function useIsGuest(): boolean {
  const { effectiveAccessLevel } = useAuth();
  return !hasMinAccessLevel(effectiveAccessLevel, "builder");
}
