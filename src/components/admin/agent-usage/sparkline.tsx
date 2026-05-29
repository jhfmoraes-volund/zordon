"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

type Props = {
  data: Array<{ bucket: string; costUsd: number }>;
  color?: string;
  height?: number;
};

export function Sparkline({ data, color = "hsl(220, 70%, 60%)", height = 36 }: Props) {
  if (data.length === 0) {
    return <div className="h-9 w-full rounded bg-muted/30" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="costUsd"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${color})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
