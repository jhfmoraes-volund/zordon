"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  /** Constrai o conteúdo da barra ao mesmo max-w da página (ex: "max-w-3xl"). */
  maxWidth?: string;
  className?: string;
};

/**
 * Footer fixo no fundo da viewport. Padronizado pra:
 * - cobrir safe-area-inset-bottom (iPhone home indicator) via pb-safe
 * - z-40 (acima do conteúdo, abaixo de Sheet z-50)
 * - bg + backdrop-blur consistente com a chrome do app
 *
 * Cuidado: a página precisa reservar espaço atrás (ex: pb-32 no container)
 * pra não esconder conteúdo.
 */
export function ActionBar({ children, maxWidth, className }: Props) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 pb-safe backdrop-blur",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center justify-between gap-2 px-6 py-3 lg:px-10",
          maxWidth,
        )}
      >
        {children}
      </div>
    </div>
  );
}
