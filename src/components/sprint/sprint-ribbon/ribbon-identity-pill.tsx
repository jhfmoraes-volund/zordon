"use client";

import { CheckCircle2, Flag, Locate, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelDot, PixelHud } from "@/components/ui/pixel-bar";
import { StatusChip } from "@/components/ui/status-chip";
import { lookupChip, SPRINT_STATUS } from "@/lib/status-chips";
import type { Sprint } from "../types";

type Props = {
  sprint: Sprint;
  /** Whether the ribbon is in "viewing" mode (focused sprint ≠ active sprint). */
  isViewing: boolean;
  /** Drawer open state for the identity pill ("info"). */
  active: boolean;
  onToggle: () => void;
  onJumpToActive?: () => void;
  /** Trigger pra ativar a sprint atual (só faz sentido em status=upcoming). */
  onActivate?: () => void;
  /** Trigger pra concluir a sprint atual (só faz sentido em status=active). */
  onComplete?: () => void;
};

/**
 * Esquerda da ribbon — identidade do sprint focado.
 * Em modo "vigente": chip verde "Ativo" / azul "Concluído" / muted "Planning".
 * Em modo "visualizando": chip amber + botão "ir pro vigente".
 */
export function RibbonIdentityPill({
  sprint,
  isViewing,
  active,
  onToggle,
  onJumpToActive,
  onActivate,
  onComplete,
}: Props) {
  const statusChip = lookupChip(SPRINT_STATUS, sprint.status);

  return (
    <div className="flex shrink-0 items-center gap-1 md:gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={active}
        aria-controls="sprint-ribbon-drawer"
        className={[
          "group inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 md:gap-2 md:px-2",
          "transition-colors hover:bg-muted/50",
          active ? "bg-muted/40" : "",
        ].join(" ")}
      >
        <span
          aria-hidden
          className="inline-flex size-5 items-center justify-center rounded-sm bg-muted/60 text-muted-foreground ring-1 ring-border/70"
        >
          <Flag className="size-3" />
        </span>
        <PixelHud size="sm" className="leading-none">
          {sprint.name}
        </PixelHud>
        {isViewing ? (
          <StatusChip tone="amber" size="sm">
            <PixelDot variant="open" size={5} glow={false} />
            <span className="hidden sm:inline">Visualizando</span>
          </StatusChip>
        ) : (
          <StatusChip tone={statusChip.tone} size="sm" dot>
            <span className="hidden sm:inline">{statusChip.label}</span>
          </StatusChip>
        )}
      </button>

      {isViewing && onJumpToActive ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onJumpToActive}
          aria-label="Ir pro sprint vigente"
          className="h-7 shrink-0 gap-1 px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground md:px-2"
        >
          <Locate className="size-3" />
          <span className="hidden md:inline">Ir pro vigente</span>
        </Button>
      ) : null}

      {sprint.status === "upcoming" && onActivate ? (
        <Button
          size="sm"
          variant="default"
          onClick={onActivate}
          aria-label="Ativar sprint"
          className="h-7 shrink-0 gap-1 px-2 text-[10px] uppercase tracking-wider"
        >
          <Play className="size-3" />
          <span className="hidden md:inline">Ativar sprint</span>
          <span className="md:hidden">Ativar</span>
        </Button>
      ) : null}

      {sprint.status === "active" && !isViewing && onComplete ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onComplete}
          aria-label="Concluir sprint"
          className="h-7 shrink-0 gap-1 px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground md:px-2"
        >
          <CheckCircle2 className="size-3" />
          <span className="hidden md:inline">Concluir</span>
        </Button>
      ) : null}
    </div>
  );
}
