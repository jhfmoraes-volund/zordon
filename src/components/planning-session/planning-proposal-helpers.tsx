/**
 * Helpers compartilhados das lentes do canvas do Planning (Board + Propostas).
 * Centraliza formatação de janela de sprint, chip de status de task e o chip de
 * INTENÇÃO da proposta (criar/atualizar/remover/mover) — cor por intenção, é o
 * que torna o "diff" da Vitoria legível.
 */
import { StatusChip } from "@/components/ui/status-chip";
import { TASK_STATUS } from "@/lib/status-chips";
import { cn } from "@/lib/utils";

/** "16–22 jun" (mesmo mês) ou "30 jun – 6 jul" — janela seg→dom da sprint. */
export function formatSprintWeek(
  start: string | null,
  end: string | null,
): string | null {
  if (!start || !end) return null;
  // Parse local (T00:00:00) pra evitar o drift de UTC do `new Date("YYYY-MM-DD")`.
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const mon = (d: Date) =>
    d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${mon(e)}`
    : `${s.getDate()} ${mon(s)} – ${e.getDate()} ${mon(e)}`;
}

/** Descritor de status (board vivo) com fallback pra valor desconhecido. */
export function statusChip(status: string): {
  label: string;
  tone: Parameters<typeof StatusChip>[0]["tone"];
} {
  const desc = TASK_STATUS[status as keyof typeof TASK_STATUS];
  return desc ?? { label: status, tone: "muted" };
}

// ─── Chip de intenção da proposta (diff) ──────────────────────────────────────

const TYPE_META: Record<string, { label: string; cls: string }> = {
  create: { label: "criar", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  update: { label: "atualizar", cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10" },
  delete: { label: "remover", cls: "text-red-600 dark:text-red-400 bg-red-500/10" },
  move: { label: "mover", cls: "text-blue-600 dark:text-blue-400 bg-blue-500/10" },
  review: { label: "revisar", cls: "text-muted-foreground bg-muted" },
};

export function proposalTypeLabel(type: string): string {
  return TYPE_META[type]?.label ?? type;
}

/** Chip mono, cor por intenção. Sem emoji — glifo só via texto. */
export function TypeBadge({ type }: { type: string }) {
  const m = TYPE_META[type] ?? { label: type, cls: "text-muted-foreground bg-muted" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}
