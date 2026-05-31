import { redirect } from "next/navigation";

// Legacy route — Forge agora vive como tab inline em /projects/[id]?tab=forge.
// Mantemos este arquivo só pra preservar deep-links antigos.
export default async function ProjectForgeLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}?tab=forge`);
}
