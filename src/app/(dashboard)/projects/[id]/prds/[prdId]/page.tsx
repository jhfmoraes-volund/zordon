import { notFound, redirect } from "next/navigation";
import { canEditTasks, canViewProject } from "@/lib/dal";
import { db } from "@/lib/db";
import { getPrdById } from "@/lib/dal/product-requirements";
import { PageContainer } from "@/components/app-shell";
import { PrdDetail } from "@/components/prd/prd-detail";
import { PrdExecutionPanel } from "@/components/forge/prd-execution-panel";

export const dynamic = "force-dynamic";

export default async function PrdDetailPage({
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
  const [
    { data: project },
    { data: modules },
    { data: personas },
    { data: activity },
  ] = await Promise.all([
    supabase
      .from("Project")
      .select("id, name, referenceKey")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("Module")
      .select("id, name")
      .eq("projectId", projectId)
      .order("name"),
    supabase
      .from("ProjectPersona")
      .select("id, name")
      .eq("projectId", projectId)
      .order("name"),
    supabase
      .from("ProductRequirementActivity")
      .select("id, kind, actorAgent, actorMemberId, diff, createdAt")
      .eq("productRequirementId", prdId)
      .order("createdAt", { ascending: false })
      .limit(10),
  ]);

  if (!project) notFound();

  // Look up actor names for activity log
  const actorIds = Array.from(
    new Set(
      (activity ?? [])
        .map((a) => a.actorMemberId)
        .filter((x): x is string => !!x),
    ),
  );
  let actorById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: members } = await supabase
      .from("Member")
      .select("id, name")
      .in("id", actorIds);
    actorById = new Map((members ?? []).map((m) => [m.id, m.name]));
  }

  const canEdit = await canEditTasks(projectId);

  return (
    <PageContainer>
      <PrdDetail
        prd={prd}
        project={{ id: project.id, name: project.name }}
        modules={modules ?? []}
        personas={personas ?? []}
        activity={(activity ?? []).map((a) => ({
          id: a.id,
          kind: a.kind,
          actorAgent: a.actorAgent,
          actorName: a.actorMemberId
            ? actorById.get(a.actorMemberId) ?? null
            : null,
          createdAt: a.createdAt,
        }))}
        canEdit={canEdit}
      />

      <section className="mt-8 space-y-3">
        <header>
          <h2 className="text-base font-semibold">Execução na Forja</h2>
          <p className="text-xs text-muted-foreground">
            Runs que cobrem este PRD, AC checklist e stream live do servidor.
          </p>
        </header>
        <PrdExecutionPanel
          projectId={projectId}
          prdId={prdId}
          backHref={`/projects/${projectId}/prds/${prdId}`}
        />
      </section>
    </PageContainer>
  );
}
