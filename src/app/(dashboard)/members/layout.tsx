import { requireMinLevel } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";

/**
 * Members directory is open to builder+. Builders see the listing (name,
 * cargo, skills) read-only — the page itself hides destructive buttons
 * (invite/edit/delete) and the per-member capacity drilldown via Gauge.
 *
 * The detail page `/members/[id]` keeps a stricter gate (MANAGER+) since
 * it exposes capacity/allocation data — builders shouldn't reach it
 * because the entry point (Gauge button) is hidden, but defense-in-depth.
 */
export default async function MembersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireMinLevel(BUILDER);
  return children;
}
