import "server-only";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { getCurrentCycle, toIsoDate } from "@/lib/pdiCycles";

export type PdiPayload = NonNullable<Awaited<ReturnType<typeof loadPdiPayload>>>;

/**
 * Loads the current cycle's PDI for the logged-in member, with all actions.
 * Auto-creates the MemberPDI row on first read.
 *
 * Returns null if unauthenticated. Errors during create surface as thrown.
 */
export async function loadPdiPayload() {
  const member = await getCurrentMember();
  if (!member) return null;

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
    if (error) throw new Error(error.message);
    pdi = created;
  }

  const { data: actions } = await supabase
    .from("PDIAction")
    .select("*")
    .eq("pdiId", pdi.id)
    .order("orderIdx", { ascending: true })
    .order("createdAt", { ascending: true });

  return {
    cycle: {
      label: cycle.label,
      startDate: start,
      endDate: end,
    },
    pdi,
    actions: actions ?? [],
  };
}
