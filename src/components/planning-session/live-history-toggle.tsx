"use client";

type Props = {
  /** Volta ao plano vivo (sai do modo histórico). */
  onGoLive: () => void;
  /** Reabre o navegador de versões (mini-régua / side-sheet). */
  onOpenVersions: () => void;
};

/**
 * Toggle temporal do Release Planning em modo histórico. Substitui o par
 * "chip âmbar + botão vermelho Ao vivo" — que era visualmente idêntico ao
 * "Montar plano" — por um segmented control. O vermelho some do botão e vira
 * só o dot pulsante "ao vivo" (luz de REC), convidando a voltar ao presente.
 *
 * Renderizado só quando `historyMode` é true: o segmento "Histórico" é o estado
 * atual (ativo) e reabre as versões; "Ao vivo" é a ação de sair pro plano vivo.
 */
export function LiveHistoryToggle({ onGoLive, onOpenVersions }: Props) {
  return (
    <div
      role="group"
      aria-label="Vivo ou histórico"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-foreground/5 p-0.5"
    >
      <button
        type="button"
        onClick={onGoLive}
        title="Voltar ao plano vivo"
        className="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        Ao vivo
      </button>
      <button
        type="button"
        onClick={onOpenVersions}
        aria-pressed
        title="Ver versões do histórico"
        className="inline-flex h-6 items-center rounded-full bg-amber-500/20 px-2.5 text-xs font-medium text-amber-700 transition-colors dark:text-amber-300"
      >
        Histórico
      </button>
    </div>
  );
}
