import { notFound, redirect } from "next/navigation";
import { canViewProject } from "@/lib/dal";
import { getPrdById } from "@/lib/dal/product-requirements";
import { db } from "@/lib/db";
import { PageContainer, PageTitle } from "@/components/app-shell";
import { StatusChip } from "@/components/ui/status-chip";
import { PrdExecutionPanel } from "@/components/forge/prd-execution-panel";
import type { ChipTone } from "@/lib/status-chips";

export const dynamic = "force-dynamic";

function statusTone(status: string): ChipTone {
  switch (status) {
    case "approved":
    case "ready":
      return "green";
    case "review":
      return "amber";
    case "draft":
      return "slate";
    case "superseded":
      return "muted";
    default:
      return "muted";
  }
}

/**
 * Forge PRD deep-dive — execution view (AC checklist + live run stream + run
 * history) for a single PRD in the Forge context. The PRD *spec* lives in its
 * design session (in-session sheet); this page is the "PRD turning into code"
 * surface. Reached from the Forge kanban.
 */
export default async function ForgePrdDeepDivePage({
  params,
}: {
  params: Promise<{ id: string; prdId: string }>;
}) {
  const { id: projectId, prdId } = await params;

  if (!(await canViewProject(projectId))) {
    redirect("/projects");
  }

  const prd = await getPrdById(prdId);
  if (!prd || prd.projectId !== projectId) notFound();

  const { data: project } = await db()
    .from("Project")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  const backHref = `/projects/${projectId}/forge/kanban`;

  return (
    <PageContainer>
      <PageTitle
        title={`${prd.reference} · Execução`}
        subtitle={prd.title}
        backHref={backHref}
      />

      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {prd.reference}
            </span>
            <h2 className="truncate text-sm font-semibold">{prd.title}</h2>
            <StatusChip tone={statusTone(prd.status)} size="sm">
              {prd.status}
            </StatusChip>
          </div>
        </header>

        <PrdExecutionPanel
          projectId={projectId}
          prdId={prdId}
          backHref={`/projects/${projectId}/forge/prds/${prdId}`}
        />
      </div>
    </PageContainer>
  );
}
