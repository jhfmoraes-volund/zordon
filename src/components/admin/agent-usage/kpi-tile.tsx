import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "./sparkline";
import { fmtDelta } from "./format";

type Props = {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  spark?: Array<{ bucket: string; costUsd: number }>;
  sparkColor?: string;
};

export function KpiTile({ label, value, sublabel, delta, spark, sparkColor }: Props) {
  const deltaPositive = (delta ?? 0) > 0;
  const deltaText = fmtDelta(delta ?? null);
  const showDelta = delta !== undefined;

  return (
    <Card>
      <CardContent className="space-y-2 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {showDelta && (
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums " +
                (delta === null
                  ? "text-muted-foreground"
                  : deltaPositive
                    ? "bg-orange-500/10 text-orange-500"
                    : "bg-emerald-500/10 text-emerald-500")
              }
              title="vs período anterior de mesma duração"
            >
              {deltaText}
            </span>
          )}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sublabel && (
          <div className="text-[11px] text-muted-foreground tabular-nums">{sublabel}</div>
        )}
        {spark && spark.length > 0 && (
          <div className="-mx-1 pt-1">
            <Sparkline data={spark} color={sparkColor} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
