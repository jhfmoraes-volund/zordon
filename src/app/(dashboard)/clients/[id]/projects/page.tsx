import { getEffectiveAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";
import { ProjetosView } from "@/components/overview/projetos-view";
import { ClientProjectsGrid } from "@/components/clients/client-projects-grid";

/**
 * Aba Projetos do cliente.
 *
 * Manager+ → board estratégico completo (ProjetosView) scoped por clientId,
 *   com a ribbon fábrica-wide oculta (D2). É o mesmo board do Overview org, que
 *   roda sobre service_role (bypassa RLS) e é gated por manager+ na origem.
 *   Replicamos esse gate aqui pra não introduzir bypass de RLS pra builder
 *   (D5: preservar gating, sem regressão de segurança).
 *
 * Builder → grid RLS-safe (ClientProjectsGrid) — comportamento idêntico ao
 *   anterior (browser client, só projetos visíveis ao usuário). Guest nem
 *   chega aqui (bloqueado no proxy.ts).
 */
export default async function ClientProjectsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accessLevel = await getEffectiveAccessLevel();

  if (hasMinAccessLevel(accessLevel, "manager")) {
    return <ProjetosView clientId={id} hideRibbon />;
  }

  return <ClientProjectsGrid />;
}
