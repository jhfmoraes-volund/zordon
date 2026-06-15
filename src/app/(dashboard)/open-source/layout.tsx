import { requireMinLevel } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";

/**
 * Open Source é visível pra time interno (builder+). Guests não veem o item
 * no sidebar e são redirecionados aqui também (defense-in-depth). A curadoria
 * (criar/editar/excluir) é admin-only — gated na UI, na API e via RLS.
 */
export default async function OpenSourceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(BUILDER, { redirectTo: "/projects" });
  return children;
}
