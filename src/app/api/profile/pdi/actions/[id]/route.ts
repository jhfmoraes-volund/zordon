import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { ACTION_STATUSES } from "@/lib/pdiCycles";
import { TOWER_KEYS } from "@/lib/memberSkills";

async function ensureOwnedAction(actionId: string, memberId: string) {
  const supabase = db();
  const { data } = await supabase
    .from("PDIAction")
    .select("id, pdiId, MemberPDI:pdiId(memberId)")
    .eq("id", actionId)
    .maybeSingle();
  if (!data) return null;
  // RLS already restricts, this is belt-and-suspenders
  const ownerId = (data as unknown as { MemberPDI: { memberId: string } | null })
    .MemberPDI?.memberId;
  if (ownerId !== memberId) return null;
  return data;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const owned = await ensureOwnedAction(id, member.id);
  if (!owned) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => ({}));
  const supabase = db();

  type ActionUpdate = {
    title?: string;
    criterion?: string;
    why?: string | null;
    how?: string | null;
    dueAt?: string | null;
    towerKey?: string | null;
    status?: string;
    completedAt?: string | null;
    orderIdx?: number;
    updatedAt: string;
  };
  const update: ActionUpdate = { updatedAt: new Date().toISOString() };

  if (typeof body.title === "string") update.title = body.title.trim().slice(0, 200);
  if (typeof body.criterion === "string") update.criterion = body.criterion.trim().slice(0, 500);
  if (body.why !== undefined) update.why = body.why ? String(body.why).trim().slice(0, 1000) : null;
  if (body.how !== undefined) update.how = body.how ? String(body.how).trim().slice(0, 2000) : null;
  if (body.dueAt !== undefined) update.dueAt = body.dueAt ? String(body.dueAt) : null;

  if (body.towerKey !== undefined) {
    update.towerKey =
      body.towerKey && (TOWER_KEYS as string[]).includes(body.towerKey)
        ? (body.towerKey as string)
        : null;
  }

  if (typeof body.status === "string" && (ACTION_STATUSES as readonly string[]).includes(body.status)) {
    update.status = body.status;
    update.completedAt =
      body.status === "done" ? new Date().toISOString() : null;
  }

  if (typeof body.orderIdx === "number") update.orderIdx = Math.floor(body.orderIdx);

  const { data, error } = await supabase
    .from("PDIAction")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const owned = await ensureOwnedAction(id, member.id);
  if (!owned) return new NextResponse("Not found", { status: 404 });

  const { error } = await db().from("PDIAction").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
