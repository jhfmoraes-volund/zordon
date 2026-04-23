import { requireMinLevel } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export default async function SquadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(MANAGER);
  return children;
}
