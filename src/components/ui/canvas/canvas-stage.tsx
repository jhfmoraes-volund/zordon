import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mesa recuada do canvas (estilo Canva): a folha de conteúdo (`children`)
 * flutua full-bleed dentro de uma mesa mais escura que o resto da tela, com
 * um header opcional FIXO no topo (não rola com o conteúdo).
 *
 * Camadas (ver tokens --canvas-* em globals.css):
 *   mesa (`.canvas-stage`, recuada) → folha (`.canvas-paper`, flutua + sombra).
 *
 * Substitui o antigo `<div className="surface overflow-y-auto p-6">` das
 * superfícies de agente. Use dentro do slot `canvas` de <AgentSplit>.
 */
export function CanvasStage({
  header,
  children,
  className,
  paperClassName,
  bleed = false,
}: {
  /** Header fixo no topo da mesa (título + meta + ações). Opcional. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  /** className extra na folha — ex. padding custom. */
  paperClassName?: string;
  /**
   * Conteúdo "chromeless" que ocupa a folha de borda a borda (board, tabela,
   * lista). A folha perde o padding e clipa o conteúdo no raio (overflow-hidden);
   * o próprio conteúdo cuida da densidade interna. Default false = padding de
   * leitura (relatório/markdown/mensagem).
   */
  bleed?: boolean;
}) {
  return (
    <div className={cn("canvas-stage h-full min-h-0 overflow-y-auto", className)}>
      {header && (
        <div className="canvas-stage-head sticky top-0 z-10 px-3 pb-2.5 pt-3">
          {header}
        </div>
      )}
      <div className={cn("px-3", header ? "pb-3" : "py-3")}>
        <div
          className={cn(
            "canvas-paper",
            bleed ? "overflow-hidden" : "p-5",
            paperClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
