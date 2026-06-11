import { redirect } from "next/navigation";

// Legacy route — Forge agora vive como app no tab Apps (/projects/[id]?tab=apps&app=forge).
// Mantemos este arquivo só pra preservar deep-links antigos.
export default async function ProjectForgeLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}?tab=apps&app=forge`);
}
