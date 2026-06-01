import { notFound, redirect } from "next/navigation";
import { canViewProject } from "@/lib/dal";
import { db } from "@/lib/db";
import { PageContainer, PageTitle } from "@/components/app-shell";
import { StatusChip } from "@/components/ui/status-chip";
import { RunEventStream } from "@/components/forge/run-event-stream";
import type { ChipTone } from "@/lib/status-chips";

export const dynamic = "force-dynamic";

function statusTone(status: string): ChipTone {
  if (status === "done") return "green";
  if (status === "error") return "red";
  if (status === "running") return "amber";
  return "muted";
}

export default async function ForgeRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id: projectId, runId } = await params;
  const { back } = await searchParams;

  if (!(await canViewProject(projectId))) {
    redirect("/projects");
  }

  const { data: run } = await db()
    .from("ForgeRun")
    .select("id, projectId, title, status, progress, startedAt, createdAt")
    .eq("id", runId)
    .maybeSingle();

  if (!run || run.projectId !== projectId) notFound();

  const backHref = back ?? `/projects/${projectId}/forge/kanban`;

  return (
    <PageContainer>
      <PageTitle
        title={run.title ?? "Forge Run"}
        subtitle={`Run ${runId.slice(0, 8)}`}
        backHref={backHref}
      />

      <div className="space-y-4">
        <header className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {runId}
          </code>
          <StatusChip tone={statusTone(run.status)} dot size="sm">
            {run.status}
          </StatusChip>
          {run.progress != null && run.status === "running" && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.round(run.progress * 100)}%
            </span>
          )}
        </header>

        <RunEventStream runId={runId} />
      </div>
    </PageContainer>
  );
}
