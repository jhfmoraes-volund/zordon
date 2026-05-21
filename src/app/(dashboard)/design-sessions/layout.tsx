import { requireMinLevel } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";

/**
 * Design sessions são colaborativas: builders, managers e admins entram.
 * O acesso por session é gateado nas API routes via `requireSessionAccessApi` /
 * `requireSessionEditApi`, que checam ProjectAccess. Aqui o layout só barra
 * guests (sem nível mínimo pra colaborar).
 */
export default async function DesignSessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(BUILDER, { redirectTo: "/projects" });
  return children;
}
