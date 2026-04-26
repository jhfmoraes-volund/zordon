"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PixelBar } from "@/components/ui/pixel-bar";
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
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-3 px-3 snap-x snap-mandatory scrollbar-none md:block md:space-y-1.5 md:overflow-visible md:m-0 md:p-0">
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
    <div className="surface-inset overflow-hidden min-w-[420px] shrink-0 snap-start md:min-w-0">
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
          <div className="flex-1">
            <PixelBar score={s.percent} cells={16} height={8} variant="skill" />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground leading-none">
            {s.done}/{s.total}
          </span>
        </div>

        <div className="text-right shrink-0 w-14">
          <p className="text-sm font-bold tabular-nums">{s.fpDone}/{s.totalFp}</p>
          <p className="text-[10px] text-muted-foreground">FP</p>
        </div>

        <Link href={`/sprints/${s.id}/board`} aria-label="Abrir board">
          <Button variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0">
            <KanbanSquare className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      {/* Expanded: member capacity */}
      {expanded && s.members.length > 0 && (
        <div className="border-t border-foreground/5 px-4 py-2.5 space-y-1.5">
          {s.members.map((m) => {
            const pct = m.fpCapacity > 0 ? (m.fpAllocated / m.fpCapacity) * 100 : 0;
            return (
              <div key={m.id} className="flex items-center gap-2">
                <span className="text-xs w-28 truncate">{m.name}</span>
                <div className="flex-1">
                  <PixelBar score={Math.min(pct, 100)} cells={14} height={8} variant="load" />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-14 text-right leading-none">
                  {m.fpAllocated}/{m.fpCapacity}
                </span>
                <span className="font-mono text-[10px] tabular-nums font-medium w-8 text-right leading-none">
                  {Math.round(pct)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
