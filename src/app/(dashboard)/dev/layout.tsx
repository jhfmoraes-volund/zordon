import { requireMinLevel } from "@/lib/dal";
import { ADMIN } from "@/lib/roles";

export default async function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(ADMIN, { redirectTo: "/projects" });
  return children;
}
