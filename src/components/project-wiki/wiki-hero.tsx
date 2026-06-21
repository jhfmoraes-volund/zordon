"use client";

import { useCanSeeFunctionPoints } from "@/hooks/use-can-see-function-points";
import { cn } from "@/lib/utils";
import type { WikiMetrics } from "@/lib/dal/wiki-metrics";

/**
 * Pulso da Wiki (WER-004): strip de stats escaneável no lugar da string
 * concatenada. Sprint · Concluído (com barra) · PFV · Próximo marco.
 * PFV some pra guest (D10). Slot vazio vira "—" — o bloco nunca colapsa.
 */
export function WikiHero({ hero }: { hero: WikiMetrics["hero"] }) {
  const canSeeFP = useCanSeeFunctionPoints();

  const sprintValue = hero.sprintName
    ? hero.sprintName.replace(/^sprint\s*/i, "Sprint ")
    : "—";
  const sprintSub = hero.sprintDay ? `dia ${hero.sprintDay}/7` : null;

  const milestoneValue =
    hero.nextMilestoneDays === null
      ? "—"
      : hero.nextMilestoneDays === 0
        ? "hoje"
        : `${hero.nextMilestoneDays}d`;

  const stats: Array<{
    key: string;
    label: string;
    value: string;
    sub?: string | null;
    progress?: number;
  }> = [
    { key: "sprint", label: "Sprint", value: sprintValue, sub: sprintSub },
    {
      key: "done",
      label: "Concluído",
      value: `${hero.completionPercent}%`,
      progress: hero.completionPercent,
    },
  ];
  if (canSeeFP && hero.fpTotal > 0) {
    stats.push({
      key: "pfv",
      label: "PFV",
      value: `${hero.fpDone}`,
      sub: `/${hero.fpTotal}`,
    });
  }
  stats.push({ key: "milestone", label: "Próx. marco", value: milestoneValue });

  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-xl bg-border",
        "gap-px",
        stats.length === 4
          ? "grid-cols-2 sm:grid-cols-4"
          : "grid-cols-3"
      )}
    >
      {stats.map((s) => (
        <div key={s.key} className="bg-card px-3 py-2.5">
          <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {s.label}
          </p>
          <p className="mt-0.5 text-base font-bold tracking-tight tabular-nums">
            {s.value}
            {s.sub && (
              <span className="ml-0.5 text-xs font-medium text-muted-foreground">
                {s.sub}
              </span>
            )}
          </p>
          {s.progress !== undefined && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, Math.max(0, s.progress))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
