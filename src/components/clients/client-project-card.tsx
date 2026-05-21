"use client";

import Link from "next/link";
import { Heart, ListChecks, Settings2, Users } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";
import type { ChipTone } from "@/lib/status-chips";

export type ClientProject = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  memberCount: number;
  taskCount: number;
};

export type ProjectInsightSummary = {
  relationalHealth: string | null;
  technicalHealth: string | null;
  generatedAt: string;
};

const HEALTH_TONE: Record<string, ChipTone> = {
  healthy: "green",
  watch: "amber",
  at_risk: "amber",
  critical: "red",
};

const HEALTH_LABEL: Record<string, string> = {
  healthy: "saudável",
  watch: "observar",
  at_risk: "em risco",
  critical: "crítico",
};

function fmtDate(d: string | null): string {
  return d
    ? new Date(d).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      })
    : "–";
}

export function ClientProjectCard({
  project,
  insight,
}: {
  project: ClientProject;
  insight?: ProjectInsightSummary | null;
}) {
  const relTone = insight?.relationalHealth
    ? HEALTH_TONE[insight.relationalHealth]
    : undefined;
  const techTone = insight?.technicalHealth
    ? HEALTH_TONE[insight.technicalHealth]
    : undefined;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="surface block p-4 space-y-3 transition-colors active:bg-accent/40 hover:border-border/80"
    >
      <div className="space-y-0.5">
        <h3 className="font-medium text-sm leading-tight truncate">
          {project.name}
        </h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusChip {...lookupChip(PROJECT_STATUS, project.status)} dot />
        <span className="text-muted-foreground tabular-nums">
          {fmtDate(project.startDate)} → {fmtDate(project.endDate)}
        </span>
      </div>

      {insight && (relTone || techTone) ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {relTone ? (
            <StatusChip tone={relTone} dot>
              <Heart className="h-3 w-3 mr-0.5" />
              {HEALTH_LABEL[insight.relationalHealth!]}
            </StatusChip>
          ) : null}
          {techTone ? (
            <StatusChip tone={techTone} dot>
              <Settings2 className="h-3 w-3 mr-0.5" />
              {HEALTH_LABEL[insight.technicalHealth!]}
            </StatusChip>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {project.memberCount}{" "}
          {project.memberCount === 1 ? "membro" : "membros"}
        </span>
        <span className="inline-flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5" />
          {project.taskCount} {project.taskCount === 1 ? "task" : "tasks"}
        </span>
      </div>
    </Link>
  );
}
