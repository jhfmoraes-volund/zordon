"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shell canônico das superfícies de agente: ribbon (chrome da página) + canvas
 * (mesa) à esquerda + chat (rail elevado) à direita. Abaixo de xl o split não
 * cabe → o chat vira drawer (FAB + bottom sheet via `drawer`).
 *
 * Antes este layout vivia copiado em pm-review-workspace, release planning e
 * ops. Centralizado aqui pra paridade de UI entre agentes (diferença por prop).
 *
 * As 3 camadas de cor (rail/mesa/folha) vêm dos tokens --canvas-* + classes
 * `.canvas-rail` / `.canvas-stage` / `.canvas-paper` (ver <CanvasStage>).
 */
export function AgentSplit({
  ribbon,
  canvas,
  chat,
  chatAsDrawer,
  drawer,
  className,
}: {
  /** Chrome da página acima do split (status, ações, cronograma, banners). */
  ribbon?: ReactNode;
  /** Conteúdo do canvas — tipicamente um <CanvasStage>. */
  canvas: ReactNode;
  /** Painel de chat desktop (ConversationPanel variant="desktop"). */
  chat: ReactNode;
  /** true abaixo de xl: esconde o painel desktop e renderiza `drawer`. */
  chatAsDrawer: boolean;
  /** FAB + ConversationPanel variant="mobile", renderizado quando chatAsDrawer. */
  drawer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      {ribbon}
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(400px,1fr)]">
        <div className="min-h-0 overflow-hidden">{canvas}</div>
        {!chatAsDrawer && (
          <div className="canvas-rail min-h-0 border-l">{chat}</div>
        )}
      </div>
      {chatAsDrawer && drawer}
    </div>
  );
}
