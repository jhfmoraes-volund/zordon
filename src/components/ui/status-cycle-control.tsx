"use client";

import { CheckCircle2, Circle, Clock } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { ACTION_ITEM_STATUS, lookupChip } from "@/lib/status-chips";

// Controle de ciclo de status para action items / To-dos (todo → doing → done).
// Fonte única dos mapas de ícone/cor/ciclo, antes duplicados na página de reunião.
// Renderiza em duas peças porque numa linha o ícone fica à esquerda e o chip à
// direita: <StatusCycleIcon/> + <StatusCycleChip/>. Ambos chamam onCycle.

export type CycleStatus = "todo" | "doing" | "done";

const ICONS: Record<string, typeof Circle> = {
  todo: Circle,
  doing: Clock,
  done: CheckCircle2,
};

const ICON_COLOR: Record<string, string> = {
  todo: "text-red-500",
  doing: "text-yellow-500",
  done: "text-green-500",
};

const CYCLE: Record<string, CycleStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

/** Próximo status no ciclo todo → doing → done → todo. */
export function nextCycleStatus(status: string): CycleStatus {
  return CYCLE[status] ?? "doing";
}

type CommonProps = {
  status: string;
  onCycle: () => void;
  /** false → render-only (sem clique, sem hover). */
  canEdit?: boolean;
  /** true → desabilita o clique mesmo com canEdit (ex.: sugestão pendente). */
  disabled?: boolean;
};

/** Ícone circular colorido que cicla o status ao clicar. Para o lado esquerdo
 *  da linha. Faz stopPropagation pra não disparar o onClick da linha (abrir sheet). */
export function StatusCycleIcon({
  status,
  onCycle,
  canEdit = true,
  disabled = false,
  className = "",
}: CommonProps & { className?: string }) {
  const Icon = ICONS[status] ?? Circle;
  const color = ICON_COLOR[status] ?? "text-muted-foreground";
  const interactive = canEdit && !disabled;
  const chip = lookupChip(ACTION_ITEM_STATUS, status);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (interactive) onCycle();
      }}
      disabled={!interactive}
      className={`shrink-0 ${color} ${
        interactive ? "hover:opacity-70 transition-opacity" : "cursor-default"
      } ${className}`}
      title={
        disabled
          ? "Aprove a sugestão para mexer no status"
          : canEdit
            ? `Clique para mudar: ${chip.label}`
            : chip.label
      }
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

/** StatusChip clicável que cicla o status. Para o lado direito da linha.
 *  Quando !canEdit, vira um chip estático (sem botão). */
export function StatusCycleChip({
  status,
  onCycle,
  canEdit = true,
  disabled = false,
}: CommonProps) {
  const chip = lookupChip(ACTION_ITEM_STATUS, status);
  if (!canEdit || disabled) return <StatusChip {...chip} />;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCycle();
      }}
      className="cursor-pointer"
    >
      <StatusChip {...chip} />
    </button>
  );
}
