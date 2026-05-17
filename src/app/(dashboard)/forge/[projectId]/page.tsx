import { redirect } from "next/navigation";

/**
 * Caminho legado. Forja agora vive como aba dentro do projeto.
 *
 * Mantemos esta rota só pra preservar deep-links existentes — ela redireciona
 * pra `/projects/[id]?tab=forge`, que renderiza o mesmo painel da Forja com o
 * contexto completo de gestão do projeto (Stories, Sprints, Sessions, etc).
 */
export default async function ProjectForgeRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}?tab=forge`);
}
