import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Zap } from "lucide-react";
import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { db } from "@/lib/db";
import { getProjectForgeSummary } from "@/lib/dal/forge-project";
import { PageContainer } from "@/components/app-shell";
import { ForgeProjectCard } from "@/components/forge/forge-project-card";

export const dynamic = "force-dynamic";

export default async function ProjectForgePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  // Access control: manager+ only (D2)
  const accessLevel = await getEffectiveAccessLevel();
  if (!hasMinAccessLevel(accessLevel, "manager")) {
    redirect("/projects");
  }

  // Fetch project basic info
  const supabase = db();
  const { data: project } = await supabase
    .from("Project")
    .select("id, name, referenceKey")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  // Fetch Forge summary
  const summary = await getProjectForgeSummary(projectId);

  return (
    <PageContainer>
      <div className="flex flex-col gap-6 py-6">
        <div className="flex items-start gap-3">
          <Link
            href={`/projects/${projectId}`}
            aria-label={`Voltar para ${project.name}`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold">Forge</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Automação de implementação — PRDs vinculados ao projeto e execuções recentes.
            </p>
          </div>
        </div>

        <ForgeProjectCard project={project} summary={summary} />
      </div>
    </PageContainer>
  );
}
