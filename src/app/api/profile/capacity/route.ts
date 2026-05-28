import { NextResponse } from "next/server";
import { loadCapacityPayload } from "@/lib/profile/capacity-load";

/**
 * GET /api/profile/capacity
 *
 * Self-access version of /api/members/[id]/capacity. Returns the same
 * shape so the WeeklyAllocation/MemberBattery components can share types.
 * Builders can read their OWN data here without manager rights.
 */
export async function GET() {
  const result = await loadCapacityPayload();
  if (result === null) return new NextResponse("Unauthorized", { status: 401 });
  if (result === "guest") return new NextResponse("Forbidden", { status: 403 });
  return NextResponse.json(result.payload);
}
