import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { getCurrentCycle, toIsoDate, ACTION_STATUSES } from "@/lib/pdiCycles";
import { TOWER_KEYS } from "@/lib/memberSkills";

/**
 * POST /api/profile/pdi/actions
 * Body: { title*, criterion*, dueAt?, towerKey?, why?, how?, status? }
 * Adds an action to the current member's active cycle (auto-creating it).
 */
export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  const criterion = String(body.criterion ?? "").trim();
  if (!title || !criterion) {
    return NextResponse.json({ error: "title e criterion obrigatórios" }, { status: 400 });
  }

  const towerKey =
    body.towerKey && (TOWER_KEYS as string[]).includes(body.towerKey)
      ? (body.towerKey as string)
      : null;
  const status =
    body.status && (ACTION_STATUSES as readonly string[]).includes(body.status)
      ? (body.status as string)
      : "pending";

  const cycle = getCurrentCycle();
  const start = toIsoDate(cycle.startDate);
  const end = toIsoDate(cycle.endDate);
  const supabase = db();

  // Get-or-create the current cycle PDI
  let { data: pdi } = await supabase
    .from("MemberPDI")
    .select("id")
    .eq("memberId", member.id)
    .eq("cycleStartDate", start)
    .maybeSingle();
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
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    pdi = created;
  }

  // Next orderIdx
  const { data: lastOrder } = await supabase
    .from("PDIAction")
    .select("orderIdx")
    .eq("pdiId", pdi.id)
    .order("orderIdx", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIdx = (lastOrder?.orderIdx ?? -1) + 1;

  const now = new Date().toISOString();
  const { data: action, error } = await supabase
    .from("PDIAction")
    .insert({
      id: crypto.randomUUID(),
      pdiId: pdi.id,
      towerKey,
      title: title.slice(0, 200),
      why: body.why ? String(body.why).trim().slice(0, 1000) : null,
      how: body.how ? String(body.how).trim().slice(0, 2000) : null,
      criterion: criterion.slice(0, 500),
      dueAt: body.dueAt ? String(body.dueAt) : null,
      status,
      orderIdx: nextIdx,
      updatedAt: now,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(action, { status: 201 });
}
