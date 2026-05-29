type UsageRow = {
  id: string;
  agentName: string;
  callKind: string;
  modelId: string;
  costUsd: number;
  promptTokens: number;
  cachedPromptTokens: number | null;
  completionTokens: number;
  latencyMs: number | null;
  threadId: string | null;
  projectId: string | null;
  createdAt: string;
};

export function AgentUsageTable({ rows }: { rows: UsageRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        Sem chamadas registradas ainda. Após o primeiro turno de um agente, as
        rows aparecem aqui em fire-and-forget (telemetria nunca bloqueia a
        resposta).
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/30">
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Quando</th>
            <th className="px-3 py-2">Agente</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2">Modelo</th>
            <th className="px-3 py-2 text-right">Custo</th>
            <th className="px-3 py-2 text-right">Tokens (in / cached / out)</th>
            <th className="px-3 py-2 text-right">Latência</th>
            <th className="px-3 py-2">Thread</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 hover:bg-muted/20">
              <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                {new Date(r.createdAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-3 py-2 font-mono text-xs uppercase tracking-wide">
                {r.agentName}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {r.callKind}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.modelId}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                ${Number(r.costUsd).toFixed(4)}
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">
                {r.promptTokens.toLocaleString("pt-BR")}
                {r.cachedPromptTokens
                  ? ` (${r.cachedPromptTokens.toLocaleString("pt-BR")})`
                  : ""}{" "}
                / {r.completionTokens.toLocaleString("pt-BR")}
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">
                {r.latencyMs != null ? `${r.latencyMs}ms` : "—"}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                {r.threadId ? `${r.threadId.slice(0, 8)}…` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
