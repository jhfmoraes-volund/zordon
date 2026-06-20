"use client";

import { useIsGuest } from "@/hooks/use-is-guest";

/**
 * PFV é métrica interna: guest não vê (memory project_guest_access, PRD
 * project-wiki D9). Wrapper semântico sobre useIsGuest pra leitura no Hero.
 */
export function useCanSeeFunctionPoints(): boolean {
  return !useIsGuest();
}
