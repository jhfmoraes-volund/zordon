import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { canViewProject } from "@/lib/dal";
import { getPrdById } from "@/lib/dal/product-requirements";
import { db } from "@/lib/db";
import { PageContainer, PageTitle } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
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

export default async function PrdRunPage({
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

  const supabase = db();
  const { data: project } = await supabase
    .from("Project")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  return (
    <PageContainer>
      <PageTitle
        title={`${prd.reference} · Execução`}
        subtitle={prd.title}
        backHref={`/projects/${projectId}/forge/kanban`}
      />

      <div className="space-y-4">
        {/* Header compacto com link pra spec completa */}
        <header className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 flex-wrap">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground shrink-0">
              {prd.reference}
            </span>
            <h2 className="text-sm font-semibold truncate">{prd.title}</h2>
            <StatusChip tone={statusTone(prd.status)} size="sm">
              {prd.status}
            </StatusChip>
          </div>
          <Link
            href={`/projects/${projectId}/prds/${prdId}`}
            className="shrink-0"
          >
            <Button variant="outline" size="sm" className="h-8">
              <FileText className="size-3.5 mr-1.5" />
              Ver spec completa
            </Button>
          </Link>
        </header>

        <PrdExecutionPanel
          projectId={projectId}
          prdId={prdId}
          backHref={`/projects/${projectId}/prds/${prdId}/run`}
        />
      </div>
    </PageContainer>
  );
}
