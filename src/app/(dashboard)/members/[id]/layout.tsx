import { requireMinLevel } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

/**
 * Member detail page exposes capacity/allocation data — manager+ only.
 * Builders see the directory listing in the parent route, but the per-member
 * drilldown stays gated. The Gauge button that links here is hidden in the
 * listing UI for builders, so this is a defense-in-depth check.
 */
export default async function MemberDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(MANAGER);
  return children;
}
