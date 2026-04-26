"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageTitleSlot } from "./page-title/page-title-slot";

type Props = {
  /** Itens da zona esquerda (ex: SidebarTrigger). */
  left: ReactNode;
  /** Itens da zona direita (ex: trigger group com botões de ação). */
  right?: ReactNode;
  className?: string;
};

/**
 * Header sticky da app — 3 zonas (left, title slot central, right).
 * Pixel-equivalent ao header anterior em altura/cor; a única mudança
 * estrutural é o sticky positioning + o slot central de PageTitle.
 */
export function ShellHeader({ left, right, className }: Props) {
  return (
    <header
      className={cn(
        // pt-safe respeita o notch em PWA standalone iOS (env(safe-area-inset-top));
        // fora de PWA o valor é 0, então não há diff visual.
        "sticky top-0 z-30 border-b border-border bg-background/95 pt-safe backdrop-blur",
        className,
      )}
    >
      <div className="flex h-12 items-center gap-2 px-3 md:h-14 md:px-4">
        <div className="flex shrink-0 items-center gap-2">{left}</div>
        <div className="min-w-0 flex-1">
          <PageTitleSlot />
        </div>
        {right && (
          <div className="flex shrink-0 items-center gap-1">{right}</div>
        )}
      </div>
    </header>
  );
}
