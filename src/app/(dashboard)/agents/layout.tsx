import { requireMinLevel } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export default async function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(MANAGER, { redirectTo: "/projects" });
  return children;
}
