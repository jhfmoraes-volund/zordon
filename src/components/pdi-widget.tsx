"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Target, ArrowUpRight, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PixelBar, PixelHud } from "@/components/ui/pixel-bar";
import { towerLabel } from "@/lib/memberSkills";
import { ACTION_STATUS_LABELS, type ActionStatus } from "@/lib/pdiCycles";
import { fmtDate } from "@/lib/date-utils";

type PdiAction = {
  id: string;
  towerKey: string | null;
  title: string;
  criterion: string;
  dueAt: string | null;
  status: ActionStatus;
};

type PdiSummary = {
  cycle: { label: string; startDate: string; endDate: string };
  actions: PdiAction[];
};

export function PdiWidget() {
  const [summary, setSummary] = useState<PdiSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/pdi")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setSummary({
          cycle: d.cycle,
          actions: (d.actions ?? []) as PdiAction[],
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Carregando PDI...
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Não foi possível carregar o PDI.
        </CardContent>
      </Card>
    );
  }

  const total = summary.actions.length;
  const done = summary.actions.filter((a) => a.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Top 3 ações: in_progress primeiro, depois pending, ordenadas por dueAt asc
  const visible = [...summary.actions]
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => {
      const order: Record<ActionStatus, number> = {
        in_progress: 0,
        pending: 1,
        done: 2,
        cancelled: 3,
      };
      const diff = order[a.status] - order[b.status];
      if (diff !== 0) return diff;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return aDue - bDue;
    })
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            PDI · {summary.cycle.label}
          </CardTitle>
          <Link href="/profile/pdi">
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Ver completo
              <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <EmptyWidget />
        ) : (
          <>
            {/* Progresso */}
            <div className="space-y-1.5">
              <PixelBar score={pct} cells={20} height={10} variant="skill" />
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono tabular-nums">
                  <span className="font-semibold">{done}</span>
                  <span className="text-muted-foreground"> / {total} ações</span>
                </span>
                <span className="font-mono tabular-nums font-semibold">{pct}%</span>
              </div>
            </div>

            {/* Ações */}
            <ul className="space-y-2.5">
              {visible.map((a, i) => {
                const overdue = a.dueAt && new Date(a.dueAt) < new Date() && a.status !== "done";
                return (
                  <li key={a.id} className="flex gap-3">
                    <span
                      className="font-mono tabular-nums text-xs font-medium tracking-[0.05em] shrink-0 mt-0.5"
                      style={{ color: "oklch(0.82 0.2 22)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.towerKey && (
                          <Badge variant="outline" className="text-[9px]">
                            {towerLabel(a.towerKey)}
                          </Badge>
                        )}
                        <PixelHud size="xs" tone={a.status === "in_progress" ? "accent" : "muted"}>
                          {ACTION_STATUS_LABELS[a.status].toLowerCase()}
                        </PixelHud>
                        {a.dueAt && (
                          <span
                            className={`text-[10px] font-mono tabular-nums ${
                              overdue ? "text-red-500" : "text-muted-foreground"
                            }`}
                          >
                            · {fmtDate(a.dueAt)}
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-sm font-medium leading-snug ${
                          a.status === "done" ? "line-through text-muted-foreground" : ""
                        }`}
                      >
                        {a.title}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {total > 3 && (
              <p className="text-[11px] text-muted-foreground">
                +{total - 3} ações no ciclo. Veja completo →
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyWidget() {
  return (
    <div className="rounded-lg border border-dashed border-foreground/10 p-5 text-center space-y-2">
      <p className="text-xs text-muted-foreground">
        Você ainda não definiu ações pra esse ciclo.
      </p>
      <Link href="/profile/pdi">
        <Button size="sm" variant="outline">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Criar primeira ação
        </Button>
      </Link>
    </div>
  );
}
