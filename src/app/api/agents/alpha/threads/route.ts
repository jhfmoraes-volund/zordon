import { NextResponse } from "next/server";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { db } from "@/lib/db";

/**
 * GET /api/agents/alpha/threads
 * Lists the current member's Alpha conversations, newest activity first.
 */
export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  // Only surface conversations that have actually started — title is set on
  // the first user message, so a null title means "empty thread", filtered out.
  const { data: threads } = await db()
    .from("ChatThread")
    .select("id, title, createdAt, updatedAt")
    .eq("agentName", "alpha")
    .eq("channel", "web")
    .eq("createdBy", member.id)
    .not("title", "is", null)
    .order("updatedAt", { ascending: false });

  return NextResponse.json({ threads: threads || [] });
}
