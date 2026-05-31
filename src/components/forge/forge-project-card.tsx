"use client";

import Link from "next/link";
import { ArrowRight, FileText, Play, DollarSign, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import type { ProjectForgeSummary } from "@/lib/dal/forge-project";
import type { ChipTone } from "@/lib/status-chips";
import type { PrdState } from "@/lib/forge/prd-fs";

type ProjectInfo = {
  id: string;
  name: string;
  referenceKey: string | null;
};

type ForgeProjectCardProps = {
  project: ProjectInfo;
  summary: ProjectForgeSummary;
};

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Map PRD state to StatusChip tone
 */
function prdStateTone(state: PrdState): ChipTone {
  switch (state) {
    case "backlog":
      return "slate";
    case "ready":
      return "blue";
    case "in-progress":
      return "amber";
    case "blocked":
      return "red";
    case "done":
      return "green";
    case "archive":
      return "muted";
    default:
      return "muted";
  }
}

/**
 * Map ForgeRun status to StatusChip tone
 */
function runStatusTone(status: string): ChipTone {
  switch (status) {
    case "completed":
      return "green";
    case "running":
      return "blue";
    case "failed":
      return "red";
    default:
      return "muted";
  }
}

export function ForgeProjectCard({ project, summary }: ForgeProjectCardProps) {
  const { prds, runs, cost7d, runCount7d } = summary;
  const hasData = prds.length > 0 || runs.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo do projeto</CardTitle>
        <CardDescription>
          PRDs vinculados, runs recentes e custo dos últimos 7 dias
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Empty state */}
        {!hasData ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <Lightbulb className="size-12 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium">Nenhum PRD ou run neste projeto ainda</p>
              <p className="text-xs text-muted-foreground">
                Crie PRDs no Forge Spike e vincule-os ao projeto.
              </p>
            </div>
            <Link href={`/forge-spike?projectId=${project.id}`}>
              <Button>
                <Play className="size-4" />
                Abrir Forge Spike
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Stats grid - responsive: stacks on mobile, 3 cols on sm+ */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="size-4" />
                  <span>PRDs vinculados</span>
                </div>
                <div className="mt-2 text-2xl font-bold">{prds.length}</div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Play className="size-4" />
                  <span>Runs (7d)</span>
                </div>
                <div className="mt-2 text-2xl font-bold">{runCount7d}</div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="size-4" />
                  <span>Custo (7d)</span>
                </div>
                <div className="mt-2 text-2xl font-bold">{formatCost(cost7d)}</div>
              </div>
            </div>

            {/* PRDs list */}
            {prds.length > 0 ? (
              <div>
                <h3 className="mb-3 text-sm font-semibold">PRDs vinculados</h3>
                <div className="space-y-2">
                  {prds.slice(0, 5).map((prd) => (
                    <div
                      key={prd.slug}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{prd.title}</span>
                      </div>
                      <StatusChip tone={prdStateTone(prd.state)} size="sm">
                        {prd.state}
                      </StatusChip>
                    </div>
                  ))}
                  {prds.length > 5 ? (
                    <p className="text-xs text-muted-foreground">
                      +{prds.length - 5} PRDs — veja todos no Forge Spike
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Runs list */}
            {runs.length > 0 ? (
              <div>
                <h3 className="mb-3 text-sm font-semibold">Últimas runs</h3>
                <div className="space-y-2">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Play className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-mono text-xs">
                            {run.id.slice(0, 8)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(run.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {run.costUsdTotal ? (
                          <span className="text-xs text-muted-foreground">
                            {formatCost(run.costUsdTotal)}
                          </span>
                        ) : null}
                        <StatusChip tone={runStatusTone(run.status)} size="sm">
                          {run.status}
                        </StatusChip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* CTA */}
            <div className="flex justify-center pt-2">
              <Link href={`/forge-spike?projectId=${project.id}`}>
                <Button variant="outline" size="sm">
                  Abrir Forge Spike
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
