import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { getCurrentCycle, toIsoDate } from "@/lib/pdiCycles";

/**
 * GET /api/profile/pdi
 * Returns the current cycle's PDI for the logged-in member, with all
 * actions. Auto-creates the row on first read so the UI doesn't have
 * to bootstrap.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const cycle = getCurrentCycle();
  const start = toIsoDate(cycle.startDate);
  const end = toIsoDate(cycle.endDate);

  const supabase = db();
  const { data: existing } = await supabase
    .from("MemberPDI")
    .select("*")
    .eq("memberId", member.id)
    .eq("cycleStartDate", start)
    .maybeSingle();

  let pdi = existing;
  if (!pdi) {
    const { data: created, error } = await supabase
      .from("MemberPDI")
      .insert({
        id: crypto.randomUUID(),
        memberId: member.id,
        cycleStartDate: start,
        cycleEndDate: end,
        status: "active",
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    pdi = created;
  }

  const { data: actions } = await supabase
    .from("PDIAction")
    .select("*")
    .eq("pdiId", pdi.id)
    .order("orderIdx", { ascending: true })
    .order("createdAt", { ascending: true });

  return NextResponse.json({
    cycle: {
      label: cycle.label,
      startDate: start,
      endDate: end,
    },
    pdi,
    actions: actions ?? [],
  });
}
