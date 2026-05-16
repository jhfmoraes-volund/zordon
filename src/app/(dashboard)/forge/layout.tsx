import { requireMinLevel } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";

export default async function ForgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(BUILDER, { redirectTo: "/projects" });
  return children;
}
