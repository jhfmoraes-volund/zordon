import { NextRequest, NextResponse } from "next/server";
import { requireMinAccessLevelApi, getActorMemberId } from "@/lib/dal";
import { list, create } from "@/lib/dal/open-source";
import { cardSchema } from "./schema";

/** GET /api/open-source — list all cards (builder+). */
export async function GET() {
  const denied = await requireMinAccessLevelApi("builder");
  if (denied) return denied;

  try {
    const cards = await list();
    return NextResponse.json({ cards }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/open-source — create a card (admin only). */
export async function POST(req: NextRequest) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = cardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const createdBy = await getActorMemberId();
    const card = await create(parsed.data, createdBy);
    return NextResponse.json({ card }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
