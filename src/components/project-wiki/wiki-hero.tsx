"use client";

import { useCanSeeFunctionPoints } from "@/hooks/use-can-see-function-points";
import type { WikiMetrics } from "@/lib/dal/wiki-metrics";

/**
 * Linha Hero da Wiki (PRD §9): status do projeto legível em 1s.
 * "Sprint N (d/7d) · X% · Y/Z FP · marco em Wd" — FP some pra guest (D9).
 */
export function WikiHero({ hero }: { hero: WikiMetrics["hero"] }) {
  const canSeeFP = useCanSeeFunctionPoints();

  const parts: string[] = [];
  if (hero.sprintName) {
    parts.push(
      hero.sprintDay
        ? `${hero.sprintName} (${hero.sprintDay}/7d)`
        : hero.sprintName
    );
  }
  parts.push(`${hero.completionPercent}%`);
  if (canSeeFP && hero.fpTotal > 0) {
    parts.push(`${hero.fpDone}/${hero.fpTotal} FP`);
  }
  if (hero.nextMilestoneDays !== null) {
    parts.push(
      hero.nextMilestoneDays === 0
        ? "marco hoje"
        : `marco em ${hero.nextMilestoneDays}d`
    );
  }

  return (
    <div className="surface px-4 py-3">
      <p className="text-sm font-semibold tracking-tight">
        {parts.join(" · ")}
      </p>
    </div>
  );
}
