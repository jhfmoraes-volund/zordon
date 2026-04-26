"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Range = "7d" | "30d" | "all";

type Totals = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

type ByModel = { modelId: string; calls: number; totalTokens: number; costUsd: number };
type ByMember = {
  memberId: string | null;
  memberName: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
};
type ByDay = { day: string; costUsd: number; calls: number };
type RecentRow = {
  id: string;
  createdAt: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number;
  threadId: string | null;
  memberId: string | null;
  memberName: string | null;
};

type ApiResponse = {
  range: Range;
  agent: { slug: string; name: string };
  totals: Totals;
  byModel: ByModel[];
  byMember: ByMember[];
  byDay: ByDay[];
  recent: RecentRow[];
};

const RANGES: { value: Range; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "all", label: "Tudo" },
];

const usd = (n: number) =>
  n >= 1
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 })
    : `$${n.toFixed(6)}`;

const num = (n: number) => n.toLocaleString("pt-BR");

export default function AgentUsagePage() {
  const { slug } = useParams<{ slug: string }>();
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    fetch(`/api/agents/${slug}/usage?range=${range}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || "Falha ao carregar custos");
        setData(d as ApiResponse);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, range]);

  const maxDayCost = useMemo(() => {
    if (!data) return 0;
    return data.byDay.reduce((m, d) => Math.max(m, d.costUsd), 0);
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Custos do agente</h2>
          <p className="text-sm text-muted-foreground">
            Tokens e custo em USD reportados pelo OpenRouter por chamada.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 transition-colors ${
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {data && !loading && (
        <>
          {/* Totals */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Custo total" value={usd(data.totals.costUsd)} />
            <StatCard label="Chamadas" value={num(data.totals.calls)} />
            <StatCard label="Tokens (total)" value={num(data.totals.totalTokens)} />
            <StatCard
              label="Prompt / completion"
              value={`${num(data.totals.promptTokens)} / ${num(data.totals.completionTokens)}`}
            />
          </div>

          {/* Daily chart */}
          {data.byDay.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Custo por dia</h3>
                <div className="flex items-end gap-1 h-32">
                  {data.byDay.map((d) => {
                    const h = maxDayCost > 0 ? (d.costUsd / maxDayCost) * 100 : 0;
                    return (
                      <div
                        key={d.day}
                        className="flex-1 flex flex-col items-center gap-1 group min-w-0"
                        title={`${d.day} — ${usd(d.costUsd)} (${d.calls} chamadas)`}
                      >
                        <div className="flex-1 flex items-end w-full">
                          <div
                            className="w-full bg-primary/70 group-hover:bg-primary rounded-sm transition-colors"
                            style={{ height: `${Math.max(h, 2)}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                          {d.day.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* By model + by member */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Por modelo</h3>
                {data.byModel.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem dados.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Modelo</TableHead>
                        <TableHead className="text-right">Chamadas</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byModel.map((m) => (
                        <TableRow key={m.modelId}>
                          <TableCell className="font-mono text-xs">{m.modelId}</TableCell>
                          <TableCell className="text-right">{num(m.calls)}</TableCell>
                          <TableCell className="text-right">{num(m.totalTokens)}</TableCell>
                          <TableCell className="text-right">{usd(m.costUsd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Por membro</h3>
                {data.byMember.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem dados.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Membro</TableHead>
                        <TableHead className="text-right">Chamadas</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byMember.map((m) => (
                        <TableRow key={m.memberId ?? "null"}>
                          <TableCell>{m.memberName}</TableCell>
                          <TableCell className="text-right">{num(m.calls)}</TableCell>
                          <TableCell className="text-right">{num(m.totalTokens)}</TableCell>
                          <TableCell className="text-right">{usd(m.costUsd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent calls */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">Últimas chamadas</h3>
              {data.recent.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma chamada registrada no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Membro</TableHead>
                        <TableHead>Modelo</TableHead>
                        <TableHead className="text-right">Prompt</TableHead>
                        <TableHead className="text-right">Output</TableHead>
                        <TableHead className="text-right">Cache</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recent.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.memberName ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.modelId}</TableCell>
                          <TableCell className="text-right text-xs">
                            {num(r.promptTokens)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {num(r.completionTokens)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {r.cachedPromptTokens ? num(r.cachedPromptTokens) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {usd(r.costUsd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-semibold mt-1 tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
