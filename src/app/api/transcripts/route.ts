/**
 * GET /api/transcripts
 * Lista TranscriptRefs disponíveis pra linkar em uma PlanningCeremony.
 * Usado pelo picker de transcripts no Command Center.
 *
 * Query params:
 *   ?q=texto    → filtra por title (ilike)
 *   ?limit=N    → max resultados (default 50)
 *
 * Auth: requer membro autenticado (qualquer nível).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMinAccessLevelApi } from "@/lib/dal";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const denied = await requireMinAccessLevelApi("guest");
  if (denied) return denied;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10),
    100,
  );

  let query = db()
    .from("TranscriptRef")
    .select("id, source, sourceId, title, byline, capturedAt, meetingId")
    .order("capturedAt", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
