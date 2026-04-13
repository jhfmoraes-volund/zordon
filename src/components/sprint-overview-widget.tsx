"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, KanbanSquare, ChevronDown, ChevronRight } from "lucide-react";

type SprintMember = {
  id: string;
  name: string;
  fpCapacity: number;
  fpAllocated: number;
};

type SprintData = {
  id: string;
  name: string;
  status: string;
  startDate: string | Date;
  endDate: string | Date;
  project: { name: string };
  total: number;
  done: number;
  percent: number;
  totalFp: number;
  fpDone: number;
  members: SprintMember[];
};

function usageColor(pct: number) {
  if (pct <= 0.5) return "bg-green-500";
  if (pct <= 0.7) return "bg-blue-500";
  if (pct <= 0.85) return "bg-yellow-500";
  return "bg-red-500";
}

const fmt = (d: string | Date) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export function SprintOverviewWidget({ sprints }: { sprints: SprintData[] }) {
  // Group by project
  const grouped = new Map<string, { projectName: string; sprints: SprintData[] }>();
  for (const s of sprints) {
    const key = s.project.name;
    if (!grouped.has(key)) grouped.set(key, { projectName: key, sprints: [] });
    grouped.get(key)!.sprints.push(s);
  }

  if (sprints.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Sprints
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from(grouped.values()).map(({ projectName, sprints: projectSprints }) => (
          <div key={projectName}>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {projectName}
            </p>
            <div className="space-y-1.5">
              {projectSprints.map((s) => (
                <SprintRow key={s.id} sprint={s} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SprintRow({ sprint: s }: { sprint: SprintData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="surface-inset overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 p-3">
        {/* Expand toggle */}
        {s.members.length > 0 ? (
          <button onClick={() => setExpanded(!expanded)} className="shrink-0">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            }
          </button>
        ) : (
          <div className="w-3.5" />
        )}

        <Badge className={
          s.status === "active" ? "bg-green-500/20 text-green-400" :
          s.status === "completed" ? "bg-blue-500/20 text-blue-400" :
          "bg-muted text-muted-foreground"
        }>
          {s.status}
        </Badge>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{s.name}</span>
          <span className="text-xs text-muted-foreground ml-2">{fmt(s.startDate)} — {fmt(s.endDate)}</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 w-32 shrink-0">
          <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full ${s.percent === 100 ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${s.percent}%` }}
            />
          </div>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
            {s.done}/{s.total}
          </span>
        </div>

        <div className="text-right shrink-0 w-14">
          <p className="text-sm font-bold tabular-nums">{s.fpDone}/{s.totalFp}</p>
          <p className="text-[10px] text-muted-foreground">FP</p>
        </div>

        <Link href={`/sprints/${s.id}/board`}>
          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">
            <KanbanSquare className="h-3.5 w-3.5 mr-1" /> Board
          </Button>
        </Link>
      </div>

      {/* Expanded: member capacity */}
      {expanded && s.members.length > 0 && (
        <div className="border-t border-foreground/5 px-4 py-2.5 space-y-1.5">
          {s.members.map((m) => {
            const pct = m.fpCapacity > 0 ? m.fpAllocated / m.fpCapacity : 0;
            return (
              <div key={m.id} className="flex items-center gap-2">
                <span className="text-xs w-28 truncate">{m.name}</span>
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full ${usageColor(pct)}`}
                    style={{ width: `${Math.min(pct * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground w-14 text-right">
                  {m.fpAllocated}/{m.fpCapacity}
                </span>
                <span className="text-[10px] tabular-nums font-medium w-8 text-right">
                  {Math.round(pct * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
