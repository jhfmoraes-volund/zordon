"use client";

/**
 * Aba Insights (read-only) — produtividade e tendências do member.
 *
 * Duas fontes combinadas por semana (alinhadas por weekStart ISO):
 *   - DONE (entrega real): GET /api/members/[id]/insights → Task.doneAt.
 *   - PLANNED/CONTRACT: bucketizado dos sprints da aba Gestão (bucketSprintsByWeek).
 *
 * Sparklines feitas com pixels (sem lib de chart) pra manter a estética arcade.
 */

import { useMemo } from "react";
import { Sparkles, TrendingUp, TrendingDown, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PixelHud, pixelTone } from "@/components/ui/pixel-bar";
import { OK_GREEN, WARN_RED } from "./types";

export type InsightWeekDone = {
  weekStart: string; // ISO
  doneFp: number;
  byProject: { projectId: string; projectName: string; doneFp: number }[];
};

export type InsightWeekPlan = {
  weekStart: string; // ISO (mesmo grid)
  planned: number;
  contract: number;
};

const MIX_COLORS = [
  "oklch(0.6 0.13 250)",
  "oklch(0.74 0.18 145)",
  "oklch(0.82 0.15 65)",
  "oklch(0.82 0.2 22)",
  "oklch(0.7 0.16 320)",
];

const fmtWeek = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export function InsightsTab({
  done,
  plan,
  totalCapacity,
  windowWeeks,
}: {
  done: InsightWeekDone[];
  plan: InsightWeekPlan[];
  totalCapacity: number;
  windowWeeks: number;
}) {
  const m = useMemo(() => {
    // alinha por weekStart (date-only) — done e plan vêm do mesmo grid de semanas
    const planByWeek = new Map<string, InsightWeekPlan>();
    for (const p of plan) planByWeek.set(p.weekStart.slice(0, 10), p);

    const series = done.map((d) => {
      const key = d.weekStart.slice(0, 10);
      const p = planByWeek.get(key);
      return {
        weekStart: d.weekStart,
        done: d.doneFp,
        planned: p?.planned ?? 0,
        contract: p?.contract ?? 0,
      };
    });

    const active = series.filter((s) => s.contract > 0 || s.done > 0);
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

    const avgDone = avg(active.map((s) => s.done));
    const avgContract = avg(active.map((s) => s.contract));
    const avgPlanned = avg(active.map((s) => s.planned));

    const adherence = avgContract > 0 ? Math.round((avgDone / avgContract) * 100) : 0;
    const planAccuracy = avgPlanned > 0 ? Math.round((avgDone / avgPlanned) * 100) : 0;

    const loadPcts = series.map((s) => (totalCapacity > 0 ? (s.contract / totalCapacity) * 100 : 0));
    const avgLoad = avg(loadPcts.map((p) => Math.round(p)));
    const overweeks = loadPcts.filter((p) => p > 100).length;

    // tendência: média da 1ª metade vs 2ª metade do done (só semanas ativas)
    const half = Math.floor(active.length / 2) || 1;
    const a = avg(active.slice(0, half).map((s) => s.done));
    const b = avg(active.slice(-half).map((s) => s.done));
    const trendPct = a > 0 ? Math.round(((b - a) / a) * 100) : 0;

    // mix por projeto (Σ done na janela)
    const byProject = new Map<string, number>();
    for (const d of done) for (const p of d.byProject) byProject.set(p.projectName, (byProject.get(p.projectName) ?? 0) + p.doneFp);
    const totalDone = Array.from(byProject.values()).reduce((x, v) => x + v, 0) || 1;
    const mix = Array.from(byProject.entries())
      .map(([name, fp]) => ({ name, fp, pct: Math.round((fp / totalDone) * 100) }))
      .sort((x, y) => y.fp - x.fp);

    return {
      series,
      doneSeries: series.map((s) => s.done),
      plannedSeries: series.map((s) => s.planned),
      loadPcts,
      avgDone, avgContract, adherence, planAccuracy, avgLoad, overweeks, trendPct, mix,
      weekCount: series.length,
    };
  }, [done, plan, totalCapacity]);

  const adherenceTone = m.adherence >= 90 ? OK_GREEN : m.adherence >= 70 ? "oklch(0.82 0.15 65)" : WARN_RED;
  const hasData = m.avgDone > 0 || m.avgContract > 0;

  if (!hasData) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Sem dados de entrega nas últimas {windowWeeks} semanas.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PixelHud size="sm">Insights</PixelHud>
        <PixelHud size="xs" tone="muted">últimas {windowWeeks} semanas · entrega real</PixelHud>
      </div>

      {/* HERÓI — entrega o que promete? */}
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <StatBlock
              label="entrega o que promete? · aderência ao contrato"
              value={`${m.adherence}%`}
              trend={{ dir: m.trendPct >= 0 ? "up" : "down", pct: m.trendPct }}
              color={adherenceTone}
            />
            <div className="text-right text-xs text-muted-foreground">
              entregou <span className="font-mono tabular-nums text-foreground">{m.avgDone}</span> FP/sprint em média<br />
              contrato médio <span className="font-mono tabular-nums text-foreground">{m.avgContract}</span> FP ·
              plan accuracy <span className="font-mono tabular-nums text-foreground">{m.planAccuracy}%</span>
            </div>
          </div>
          <div className="surface-inset space-y-2 p-3">
            <div className="flex items-center justify-between">
              <PixelHud size="xs" tone="muted">planejado vs entregue por semana</PixelHud>
              <span className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <Legend color="oklch(0.6 0.13 250 / 0.4)" label="planejado" />
                <Legend color="oklch(0.6 0.13 250)" label="entregue" />
              </span>
            </div>
            <PlanVsDone planned={m.plannedSeries} done={m.doneSeries} labels={m.series.map((s) => fmtWeek(s.weekStart))} />
          </div>
        </CardContent>
      </Card>

      {/* grid: produz? + tempo? */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <StatBlock
              label="quanto produz? · throughput médio"
              value={m.avgDone}
              unit="FP/sprint"
              trend={{ dir: m.trendPct >= 0 ? "up" : "down", pct: m.trendPct }}
            />
            <PixelSparkline values={m.doneSeries} height={40} />
            <p className="text-[10px] text-muted-foreground">
              tendência {m.trendPct >= 0 ? "de alta" : "de queda"} comparando 1ª vs 2ª metade da janela
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-5">
            <PixelHud size="xs" tone="muted">onde o tempo vai? · mix por projeto</PixelHud>
            {m.mix.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem entregas no período.</p>
            ) : (
              <>
                <div className="flex h-3 overflow-hidden rounded-[2px]">
                  {m.mix.map((x, i) => (
                    <div key={x.name} title={`${x.name} ${x.pct}%`} style={{ width: `${x.pct}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {m.mix.map((x, i) => (
                    <div key={x.name} className="flex items-center gap-2 text-xs">
                      <span className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                      <span className="flex-1 truncate">{x.name}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">{x.fp} FP</span>
                      <span className="w-10 text-right font-mono tabular-nums">{x.pct}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* saúde */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <StatBlock
              label="saúde · carga média no período"
              value={`${m.avgLoad}%`}
              color={m.avgLoad > 100 ? WARN_RED : m.avgLoad > 85 ? "oklch(0.82 0.15 65)" : OK_GREEN}
            />
            <div className="text-right text-xs text-muted-foreground">
              <span className="font-mono tabular-nums" style={{ color: m.overweeks > 0 ? WARN_RED : OK_GREEN }}>{m.overweeks}</span>{" "}
              de {m.weekCount} semanas em sobrecarga
            </div>
          </div>
          <div className="surface-inset space-y-1.5 p-3">
            <PixelHud size="xs" tone="muted">carga semana a semana (verde→vermelho)</PixelHud>
            <PixelHeatstrip pcts={m.loadPcts} />
            <div className="flex justify-between text-[9px] text-muted-foreground/70">
              <span>{m.series[0] && fmtWeek(m.series[0].weekStart)}</span>
              <span>{m.series[m.series.length - 1] && fmtWeek(m.series[m.series.length - 1].weekStart)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alpha slot — reservado */}
      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-muted-foreground">
          <Sparkles className="h-4 w-4 opacity-50" />
          <span className="text-sm">Análise do Alpha</span>
          <span className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider">
            <Lock className="h-3 w-3" /> em breve
          </span>
          <span className="ml-auto text-[11px] italic opacity-60">síntese em linguagem natural + recomendações de alocação</span>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── primitivos visuais ──────────────────────────────────

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: color }} /> {label}
    </span>
  );
}

function StatBlock({
  label, value, unit, trend, color,
}: {
  label: string;
  value: string | number;
  unit?: string;
  trend?: { dir: "up" | "down"; pct: number };
  color?: string;
}) {
  return (
    <div className="space-y-1">
      <PixelHud size="xs" tone="muted">{label}</PixelHud>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-bold leading-none tabular-nums" style={{ color }}>{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        {trend && trend.pct !== 0 && (
          <span className="ml-1 inline-flex items-center gap-0.5 font-mono text-xs tabular-nums" style={{ color: trend.dir === "up" ? OK_GREEN : WARN_RED }}>
            {trend.dir === "up" ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {trend.pct > 0 ? "+" : ""}{trend.pct}%
          </span>
        )}
      </div>
    </div>
  );
}

function PixelSparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const peak = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1"
          title={`${v}`}
          style={{
            height: Math.max(2, Math.round((v / peak) * height)),
            minWidth: 4,
            background: "oklch(0.6 0.13 250)",
            borderRadius: 1,
            boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.25)",
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

function PixelHeatstrip({ pcts }: { pcts: number[] }) {
  return (
    <div className="flex gap-[3px]">
      {pcts.map((pct, i) => {
        const tone = pixelTone(pct, "load");
        return (
          <div
            key={i}
            className="h-5 flex-1"
            title={`${Math.round(pct)}%`}
            style={{
              minWidth: 8,
              background: pct > 0 ? tone.bar : "oklch(0.25 0 0)",
              borderRadius: 1,
              boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.2)",
            }}
          />
        );
      })}
    </div>
  );
}

function PlanVsDone({ planned, done, labels }: { planned: number[]; done: number[]; labels: string[] }) {
  const peak = Math.max(1, ...planned, ...done);
  const H = 48;
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: H }}>
        {planned.map((p, i) => (
          <div key={i} className="relative flex-1" style={{ minWidth: 5, height: H }} title={`plan ${p} · done ${done[i]}`}>
            <div className="absolute bottom-0 w-full" style={{ height: Math.max(2, Math.round((p / peak) * H)), background: "oklch(0.6 0.13 250 / 0.3)", borderRadius: 1 }} />
            <div className="absolute bottom-0 w-full" style={{ height: Math.max(0, Math.round((done[i] / peak) * H)), background: "oklch(0.6 0.13 250)", borderRadius: 1, boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.25)" }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/70">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}
