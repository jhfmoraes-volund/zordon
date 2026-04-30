"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Calendar,
  KanbanSquare,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PixelBar, PixelDot, PixelHud, pixelTone } from "@/components/ui/pixel-bar";
import {
  bucketSprintsByWeek,
  type SprintInput,
  type WeekBucket,
  type WeekSprintRow,
} from "@/lib/weekBuckets";

type Props = {
  sprints: SprintInput[];
  /** Member's weekly capacity (Member.fpCapacity, since 1 sprint = 1 week). */
  weeklyCapacity: number;
  projects: { id: string; name: string }[];
};

const RANGE_OPTIONS = [
  { value: "8", label: "Próximas 8 semanas" },
  { value: "4", label: "Próximas 4 semanas" },
  { value: "12", label: "Próximas 12 semanas" },
  { value: "26", label: "Próximas 26 semanas" },
];

export function WeeklyAllocation({ sprints, weeklyCapacity, projects }: Props) {
  const [rangeWeeks, setRangeWeeks] = useState("8");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const buckets = useMemo(
    () =>
      bucketSprintsByWeek(sprints, {
        weeks: Number(rangeWeeks),
        includePast: true,
        projectId: projectFilter === "all" ? null : projectFilter,
      }),
    [sprints, rangeWeeks, projectFilter],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Alocação por semana
            <PixelHud size="xs" tone="muted">
              cap. {weeklyCapacity} FP/sem
            </PixelHud>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={projectFilter} onValueChange={(v) => v && setProjectFilter(v)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue>
                  {(v: string | null) =>
                    v === "all" || !v
                      ? "Todos os projetos"
                      : projects.find((p) => p.id === v)?.name ?? "…"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os projetos</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rangeWeeks} onValueChange={(v) => v && setRangeWeeks(v)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue>
                  {(v: string | null) =>
                    RANGE_OPTIONS.find((o) => o.value === v)?.label ?? "Range"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {buckets.map((bucket) => (
          <WeekBlock
            key={bucket.weekStart.toISOString()}
            bucket={bucket}
            weeklyCapacity={weeklyCapacity}
          />
        ))}
        {buckets.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground text-center">
            Nenhuma alocação no range selecionado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const fmtShort = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

function WeekBlock({
  bucket,
  weeklyCapacity,
}: {
  bucket: WeekBucket;
  weeklyCapacity: number;
}) {
  const [expanded, setExpanded] = useState(bucket.isCurrent);
  // Numerador primário = planejado da semana (status ≠ backlog).
  // Sub-barra mostra fpDone vs fpOpen pra burndown.
  const usagePct =
    weeklyCapacity > 0 ? (bucket.totalPlanned / weeklyCapacity) * 100 : 0;
  const tone = pixelTone(usagePct, "load");
  const overcommit = bucket.totalPlanned > weeklyCapacity && weeklyCapacity > 0;
  const empty = bucket.sprints.length === 0;

  return (
    <div
      className={`surface-inset overflow-hidden ${
        bucket.isPast ? "opacity-60" : ""
      }`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => !empty && setExpanded((v) => !v)}
        disabled={empty}
        className={`w-full flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 p-3 text-left ${
          !empty ? "hover:bg-muted/30 cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Top row (mobile) / inline (desktop): chevron + badge + range */}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:gap-3 sm:contents">
          {empty ? (
            <div className="w-3.5 shrink-0" />
          ) : expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}

          {bucket.isCurrent && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/20">
              atual
            </Badge>
          )}

          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium tabular-nums">
              {fmtShort(bucket.weekStart)} — {fmtShort(bucket.weekEnd)}
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              {bucket.sprints.length} sprint{bucket.sprints.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* Bottom row (mobile) / inline (desktop): bar + FP + % */}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:gap-3 sm:contents">
          {/* Pixel bar of weekly load */}
          <div className="flex items-center gap-2 flex-1 sm:flex-none sm:w-40 shrink-0 sm:shrink">
            <div className="flex-1">
              {empty ? (
                <span className="text-xs text-muted-foreground italic">sem alocação</span>
              ) : (
                <PixelBar
                  score={Math.min(usagePct, 100)}
                  cells={16}
                  height={8}
                  variant="load"
                />
              )}
            </div>
          </div>

          {/* FP planejado / capacity da semana (com sub-info done/open) */}
          <div className="text-right shrink-0 w-24">
            {!empty && (
              <>
                <p className="text-sm font-bold tabular-nums">
                  <span style={{ color: tone.fg }}>{bucket.totalPlanned}</span>
                  <span className="text-muted-foreground/70"> / {weeklyCapacity}</span>
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums inline-flex items-center gap-1 justify-end">
                  <PixelDot variant="done" size={6} />
                  {bucket.totalDone}
                  <PixelDot variant="open" size={6} />
                  {bucket.totalOpen}
                </p>
              </>
            )}
          </div>

          {/* % */}
          <div className="text-right shrink-0 w-12">
            {!empty && (
              <span
                className="font-mono tabular-nums text-sm font-semibold"
                style={{ color: tone.fg }}
              >
                {Math.round(usagePct)}%
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded: sprints inside this week */}
      {expanded && !empty && (
        <div className="border-t border-foreground/5 px-3 py-2.5 space-y-1.5 bg-background/40">
          {bucket.sprints.map((row) => (
            <SprintRowInWeek key={row.sprintId} row={row} />
          ))}
          {overcommit && (
            <div className="flex items-center gap-1.5 text-xs pt-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              <span className="text-amber-500">
                +{bucket.totalPlanned - weeklyCapacity} FP acima da capacity semanal
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SprintRowInWeek({ row }: { row: WeekSprintRow }) {
  // Bar = planejado vs contrato (fpAllocationWeek = contrato prorrateado).
  const usagePct = row.fpAllocationWeek > 0
    ? Math.round((row.fpPlannedWeek / row.fpAllocationWeek) * 100)
    : 0;
  const tone = pixelTone(usagePct, "load");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      {/* Top row (mobile) / inline (desktop): badge + name */}
      <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:gap-3 sm:contents">
        <SprintStatusBadge status={row.sprintStatus} />

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{row.sprintName}</span>
          <span className="text-xs text-muted-foreground ml-2">· {row.projectName}</span>
          {row.hasOverride && (
            <span className="ml-2 text-[9px] px-1 rounded bg-amber-500/20 text-amber-500 font-mono uppercase tracking-wider">
              ovr
            </span>
          )}
        </div>
      </div>

      {/* Bottom row (mobile) / inline (desktop): bar + FP + Board button */}
      <div className="flex items-center gap-2 w-full sm:w-auto sm:gap-3 sm:contents">
        {/* Allocation usage bar */}
        <div className="flex items-center gap-2 flex-1 sm:flex-none sm:w-36 shrink-0 sm:shrink">
          <div className="flex-1">
            <PixelBar
              score={Math.min(usagePct, 100)}
              cells={14}
              height={8}
              variant="load"
            />
          </div>
          <span
            className="font-mono text-[10px] tabular-nums leading-none w-7 text-right"
            style={{ color: tone.fg }}
          >
            {usagePct}%
          </span>
        </div>

        {/* FP planejado / contrato (com sub done/open) */}
        <div className="text-right shrink-0 w-20">
          <p className="text-sm font-bold tabular-nums">
            <span style={{ color: tone.fg }}>{row.fpPlannedWeek}</span>
            <span className="text-muted-foreground/70"> / {row.fpAllocationWeek}</span>
          </p>
          <p className="text-[10px] text-muted-foreground tabular-nums inline-flex items-center gap-1 justify-end">
            <PixelDot variant="done" size={6} />
            {row.fpDoneWeek}
            <PixelDot variant="open" size={6} />
            {row.fpOpenWeek}
          </p>
        </div>

        <Link href={`/sprints/${row.sprintId}/board`} aria-label="Abrir board">
          <Button variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0">
            <KanbanSquare className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function SprintStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={
        status === "active"
          ? "bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/20"
          : status === "done"
          ? "bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
          : "bg-muted text-muted-foreground hover:bg-muted"
      }
    >
      {status}
    </Badge>
  );
}
