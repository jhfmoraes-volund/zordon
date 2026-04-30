"use client";

import { useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import type { Task } from "@/components/story-hierarchy";
import { burndownSeries, projectCompletion } from "./helpers";
import type { Sprint } from "./types";

type Props = {
  sprint: Sprint;
  tasks: Task[];
  /** Whether the chart starts expanded. Default: false (collapsed). */
  defaultExpanded?: boolean;
};

const W = 600;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 36 };

export function SprintBurndown({
  sprint,
  tasks,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { points, totalFP, totalDays } = useMemo(
    () => burndownSeries(sprint, tasks),
    [sprint, tasks],
  );
  const completion = useMemo(
    () => projectCompletion(sprint, tasks),
    [sprint, tasks],
  );

  if (totalFP === 0) {
    return (
      <section className="rounded-xl border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
        Sem tasks no sprint — burndown indisponível.
      </section>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xFor = (day: number) => PAD.left + (day / totalDays) * innerW;
  const yFor = (fp: number) => PAD.top + (1 - fp / totalFP) * innerH;

  // Paths
  const idealPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.day)} ${yFor(p.ideal)}`)
    .join(" ");

  const actualPoints = points.filter((p) => p.actual !== null);
  const actualPath =
    actualPoints.length > 1
      ? actualPoints
          .map(
            (p, i) =>
              `${i === 0 ? "M" : "L"} ${xFor(p.day)} ${yFor(p.actual!)}`,
          )
          .join(" ")
      : null;

  const projectedPoints = points.filter((p) => p.projected !== null);
  const projectedPath =
    projectedPoints.length > 1
      ? projectedPoints
          .map(
            (p, i) =>
              `${i === 0 ? "M" : "L"} ${xFor(p.day)} ${yFor(p.projected!)}`,
          )
          .join(" ")
      : null;

  // Tone for projection + pill
  const tone =
    completion.status === "ahead" || completion.status === "complete"
      ? "green"
      : completion.status === "on_track"
        ? "blue"
        : completion.status === "behind" && completion.etaDays <= 2
          ? "amber"
          : "red";

  const projectionStrokeClass = {
    green: "text-green-500",
    blue:  "text-blue-500",
    amber: "text-amber-500",
    red:   "text-red-500",
  }[tone];

  const pillClass = {
    green: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
    blue:  "border-blue-500/30  bg-blue-500/10  text-blue-700  dark:text-blue-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    red:   "border-red-500/30   bg-red-500/10   text-red-700   dark:text-red-300",
  }[tone];

  const lastActual = [...actualPoints].pop();
  const doneFP = lastActual ? totalFP - lastActual.actual! : 0;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        aria-expanded={expanded}
      >
        <h3 className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <Activity className="size-3.5" />
          Burndown
        </h3>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-muted-foreground">
            Velocity:{" "}
            <span className="font-mono tabular-nums text-foreground">
              {completion.velocity.toFixed(1)}
            </span>{" "}
            FP/dia
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${pillClass}`}
          >
            {completion.etaText}
          </span>
        </div>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t px-4 py-4">
          <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-48 w-full sm:h-56"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Burndown — ${doneFP} de ${totalFP} FP entregues, ${completion.etaText}`}
      >
        {/* Y grid + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const fp = totalFP * frac;
          const y = yFor(fp);
          return (
            <g key={frac}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeDasharray="2,3"
                strokeWidth="0.5"
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[9px]"
              >
                {Math.round(fp)}
              </text>
            </g>
          );
        })}

        {/* X ticks */}
        {Array.from({ length: totalDays + 1 }).map((_, d) => {
          const x = xFor(d);
          return (
            <g key={d}>
              <line
                x1={x}
                x2={x}
                y1={H - PAD.bottom}
                y2={H - PAD.bottom + 3}
                className="stroke-border"
                strokeWidth="0.5"
              />
              <text
                x={x}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {d === 0 ? "S" : `D${d}`}
              </text>
            </g>
          );
        })}

        {/* Axis */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          className="stroke-border"
        />

        {/* Ideal line */}
        <path
          d={idealPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4,3"
          className="text-muted-foreground/50"
        />

        {/* Actual line */}
        {actualPath ? (
          <path
            d={actualPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-primary"
          />
        ) : null}

        {/* Actual points */}
        {actualPoints.map((p) => (
          <circle
            key={p.day}
            cx={xFor(p.day)}
            cy={yFor(p.actual!)}
            r="3"
            className="fill-primary"
          />
        ))}

        {/* Projection */}
        {projectedPath ? (
          <path
            d={projectedPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="3,3"
            className={projectionStrokeClass}
          />
        ) : null}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <Legend
          label="Ideal"
          swatchClass="bg-muted-foreground/40"
          dashed
        />
        <Legend
          label={`Real · ${doneFP}/${totalFP} FP entregues`}
          swatchClass="bg-primary"
        />
        {projectedPath ? (
          <Legend
            label="Projeção (ritmo dos últimos 3 dias)"
            swatchClass={
              tone === "red"
                ? "bg-red-500"
                : tone === "amber"
                  ? "bg-amber-500"
                  : tone === "blue"
                    ? "bg-blue-500"
                    : "bg-green-500"
            }
            dashed
          />
        ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Legend({
  label,
  swatchClass,
  dashed = false,
}: {
  label: string;
  swatchClass: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-[2px] w-4 ${swatchClass} ${dashed ? "opacity-70" : ""}`}
        style={
          dashed
            ? {
                backgroundImage:
                  "repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px)",
                background: undefined,
              }
            : undefined
        }
      />
      {label}
    </span>
  );
}
