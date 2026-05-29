import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TopCall, TopSession } from "@/lib/agent/usage-aggregation";
import { fmtMs, fmtUsd, fmtCompactInt } from "./format";

export function TopSessionsCard({ sessions }: { sessions: TopSession[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 sessões por custo</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {sessions.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Sem sessões.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/20">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Thread</th>
                <th className="px-2 py-2">Agente</th>
                <th className="px-2 py-2 text-right">Custo</th>
                <th className="px-2 py-2 text-right">Calls</th>
                <th className="px-2 py-2 text-right">$/call</th>
                <th className="px-3 py-2 pr-4 text-right">Lat. média</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.threadId} className="border-b border-border/40 last:border-b-0">
                  <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                    {s.threadId.slice(0, 8)}…
                  </td>
                  <td className="px-2 py-2 font-mono text-xs uppercase">{s.agentName}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd(s.costUsd)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{s.calls}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtUsd(s.costUsd / s.calls, { precision: 4 })}
                  </td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtMs(s.avgLatencyMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export function TopCallsCard({ calls }: { calls: TopCall[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 chamadas mais caras</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {calls.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Sem chamadas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/20">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Quando</th>
                <th className="px-2 py-2">Agente</th>
                <th className="px-2 py-2">Modelo</th>
                <th className="px-2 py-2 text-right">Custo</th>
                <th className="px-2 py-2 text-right">Tokens (in/out)</th>
                <th className="px-3 py-2 pr-4 text-right">Latência</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b border-border/40 last:border-b-0">
                  <td className="px-4 py-2 text-[11px] text-muted-foreground tabular-nums">
                    {new Date(c.createdAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs uppercase">{c.agentName}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">
                    {c.modelId.replace(/^anthropic\//, "")}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd(c.costUsd)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtCompactInt(c.inputTokens)} / {fmtCompactInt(c.outputTokens)}
                  </td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums text-xs text-muted-foreground">
                    {fmtMs(c.latencyMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
