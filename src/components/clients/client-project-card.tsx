"use client";

import Link from "next/link";
import { ListChecks, Users } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";

export type ClientProject = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  memberCount: number;
  taskCount: number;
};

function fmtDate(d: string | null): string {
  return d
    ? new Date(d).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      })
    : "–";
}

export function ClientProjectCard({ project }: { project: ClientProject }) {
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
