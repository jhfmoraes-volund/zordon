"use client";

import { icons } from "lucide-react";
import { TOWERS } from "@/lib/memberSkills";
import { PixelBar, pixelBarLabel } from "@/components/ui/pixel-bar";

type Props = {
  /** null = no data; number = computed score 0-100 */
  scores: Partial<Record<string, number | null>>;
  onTowerClick?: (towerKey: string) => void;
  compact?: boolean;
};

export function SkillBars({ scores, onTowerClick, compact = false }: Props) {
  const cells = compact ? 14 : 18;
  const height = compact ? 10 : 12;

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {TOWERS.map((tower) => {
        const Icon = (icons as Record<string, React.ComponentType<{ className?: string }>>)[tower.icon];
        const raw = scores[tower.key];
        const score = raw === undefined ? null : raw;
        const isUnset = score === null;
        const { label: hudLabel, fg: hudFg } = pixelBarLabel(score);
        const clickable = !!onTowerClick;

        return (
          <button
            key={tower.key}
            type="button"
            onClick={() => onTowerClick?.(tower.key)}
            disabled={!clickable}
            className={`w-full grid items-center gap-3 ${compact ? "py-1" : "py-1.5"} px-2 rounded-md text-left ${
              clickable ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
            }`}
            style={{ gridTemplateColumns: "1.25rem 11rem 1fr 3rem 2.75rem" }}
          >
            {Icon ? (
              <Icon
                className={`h-4 w-4 shrink-0 ${isUnset ? "text-muted-foreground/50" : "text-foreground"}`}
              />
            ) : (
              <span />
            )}
            <span
              className={`text-sm truncate ${
                isUnset ? "text-muted-foreground/70" : "text-foreground"
              }`}
            >
              {tower.label}
            </span>
            <PixelBar score={score} cells={cells} height={height} variant="skill" />
            <span
              className="font-sans font-semibold text-[10px] tracking-[0.12em] uppercase text-right leading-none"
              style={{ color: hudFg }}
            >
              {hudLabel}
            </span>
            <span
              className={`font-mono text-base tabular-nums text-right leading-none ${
                isUnset ? "text-muted-foreground/60" : "text-foreground"
              }`}
            >
              {isUnset ? "—" : score}
            </span>
          </button>
        );
      })}
    </div>
  );
}
