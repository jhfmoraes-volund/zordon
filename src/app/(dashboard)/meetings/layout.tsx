import { requireMinLevel } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export default async function MeetingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(MANAGER, { redirectTo: "/projects" });
  return children;
}
