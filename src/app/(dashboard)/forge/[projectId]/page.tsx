import { notFound, redirect } from "next/navigation";
import { canViewProject } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ProjectForgeShell } from "../_components/project-forge-shell";

type ProjectMeta = {
  id: string;
  name: string;
  status: string;
  client: { name: string } | null;
};

export const metadata = {
  title: "FORGE · Observatório",
};

export default async function ProjectForgePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const ok = await canViewProject(projectId);
  if (!ok) redirect("/forge");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("Project")
    .select("id, name, status, client:Client(name)")
    .eq("id", projectId)
    .single();

  if (error || !data) notFound();

  const project: ProjectMeta = {
    id: data.id,
    name: data.name,
    status: data.status,
    client: (data.client as { name: string } | null) ?? null,
  };

  return <ProjectForgeShell project={project} />;
}
