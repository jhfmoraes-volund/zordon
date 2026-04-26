import { type ReactNode } from "react";

/**
 * Wrapper pros itens da zona direita do header. Mantém alinhamento e gap
 * consistentes. Separadores verticais entre grupos podem ser inline:
 * `<div className="h-5 w-px bg-border/50 mx-1" />`.
 */
export function ShellHeaderTriggerGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}
