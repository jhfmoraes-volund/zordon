"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colorFromKey, fmtUsd } from "./format";

type StackedSeries = {
  keys: string[];
  data: Array<Record<string, string | number>>;
};

type Props = {
  bucket: "hour" | "day";
  byAgent: StackedSeries;
  byModel: StackedSeries;
  byCallKind: StackedSeries;
};

type Dim = "agent" | "model" | "callKind";

const DIM_LABEL: Record<Dim, string> = {
  agent: "Agente",
  model: "Modelo",
  callKind: "Tipo",
};

function fmtBucket(iso: string, kind: "hour" | "day"): string {
  const d = new Date(iso);
  if (kind === "hour") {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function TimeseriesChart({ bucket, byAgent, byModel, byCallKind }: Props) {
  const [dim, setDim] = useState<Dim>("agent");

  const series = dim === "agent" ? byAgent : dim === "model" ? byModel : byCallKind;
  const data = useMemo(
    () => series.data.map((p) => ({ ...p, _label: fmtBucket(String(p.bucket), bucket) })),
    [series.data, bucket],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Custo por {bucket === "hour" ? "hora" : "dia"}</CardTitle>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(["agent", "model", "callKind"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDim(d)}
              className={
                "px-2.5 py-1 text-xs font-medium rounded transition-colors " +
                (dim === d
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {DIM_LABEL[d]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              {series.keys.map((k) => {
                const c = colorFromKey(k);
                return (
                  <linearGradient key={k} id={`ts-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.65} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.05} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
            <XAxis
              dataKey="_label"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtUsd(Number(v), { precision: "auto" })}
              width={56}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}
              formatter={(value, name) => [fmtUsd(Number(value ?? 0)), String(name)]}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
            />
            {series.keys.map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stackId="1"
                stroke={colorFromKey(k)}
                fill={`url(#ts-${k})`}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
