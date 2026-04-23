import { requireMinLevel } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export default async function MembersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(MANAGER);
  return children;
}
