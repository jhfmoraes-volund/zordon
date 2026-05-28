import { notFound } from "next/navigation";
import {
  loadMemberCapacity,
  loadMemberInsights,
} from "@/lib/members/member-capacity-load";
import { MemberCapacityView } from "@/components/members/member-capacity-view";
import type { CapacityPayload } from "./_components/types";
import type { InsightWeekDone } from "./_components/insights-tab";

// Auth gate: o layout pai (members/[id]/layout.tsx) já chama requireMinLevel(MANAGER).
export const dynamic = "force-dynamic";

const WINDOW_WEEKS = 12;

export default async function MemberCapacityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [capacity, insights] = await Promise.all([
    loadMemberCapacity(id),
    loadMemberInsights(id, WINDOW_WEEKS),
  ]);

  if (!capacity) notFound();

  return (
    <MemberCapacityView
      memberId={id}
      initialPayload={capacity as CapacityPayload}
      initialDoneWeeks={(insights.weeks ?? []) as InsightWeekDone[]}
    />
  );
}
