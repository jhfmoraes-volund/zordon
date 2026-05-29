import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BreakdownRow } from "@/lib/agent/usage-aggregation";
import { fmtUsd, fmtCompactInt, fmtPct } from "./format";

type Props = {
  title: string;
  rows: BreakdownRow[];
  totalCost: number;
  empty?: string;
  /** Show cache-related columns; off for project/member where it's noise. */
  showCache?: boolean;
};

export function BreakdownTable({ title, rows, totalCost, empty, showCache = true }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{empty ?? "Sem dados."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/20">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2">Item</th>
                  <th className="px-2 py-2 text-right">Custo</th>
                  <th className="px-2 py-2 text-right w-[80px]">Share</th>
                  <th className="px-2 py-2 text-right">Calls</th>
                  <th className="px-2 py-2 text-right">$/call</th>
                  {showCache && (
                    <>
                      <th className="px-2 py-2 text-right">Cache</th>
                      <th className="px-3 py-2 text-right pr-4">Eco $</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const share = totalCost > 0 ? r.costUsd / totalCost : 0;
                  const cacheRatio = r.inputTokens > 0 ? r.cachedInputTokens / r.inputTokens : 0;
                  const perCall = r.calls > 0 ? r.costUsd / r.calls : 0;
                  return (
                    <tr key={r.key} className="border-b border-border/40 last:border-b-0">
                      <td className="px-4 py-2 font-mono text-xs">
                        <div className="truncate max-w-[220px]">{r.label}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-foreground/70"
                              style={{ width: `${Math.min(100, share * 100)}%` }}
                            />
                          </div>
                          <span className="w-9 text-right">{fmtPct(share)}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-xs">{r.calls}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">
                        {fmtUsd(perCall, { precision: 4 })}
                      </td>
                      {showCache && (
                        <>
                          <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">
                            {fmtPct(cacheRatio)} <span className="text-[10px]">({fmtCompactInt(r.cachedInputTokens)})</span>
                          </td>
                          <td className="px-3 py-2 pr-4 text-right tabular-nums text-xs text-emerald-500">
                            {r.cacheSavedUsd > 0 ? fmtUsd(r.cacheSavedUsd) : "—"}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
