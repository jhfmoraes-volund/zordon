/**
 * Chat com Vitoria — modo PM Review.
 *
 *   POST /api/pm-review/[id]/chat — stream da resposta.
 *   GET  /api/pm-review/[id]/chat?limit=30&before=<iso> — histórico do thread.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { pmReviewChatConnector } from "@/lib/agent/connectors/pm-review-chat";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: pmReviewId } = await params;

  const { data: pm } = await db()
    .from("PMReview")
    .select("projectId")
    .eq("id", pmReviewId)
    .maybeSingle();
  if (!pm)
    return NextResponse.json({ error: "PM Review não encontrado" }, { status: 404 });

  const denied = await requireProjectViewApi(pm.projectId);
  if (denied) return denied;

  const limitParam = parseInt(
    req.nextUrl.searchParams.get("limit") || `${DEFAULT_LIMIT}`,
    10,
  );
  const limit = Math.max(
    1,
    Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT),
  );
  const before = req.nextUrl.searchParams.get("before");

  const supabase = db();

  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id")
    .eq("agentName", pmReviewId)
    .eq("channel", "pm_review")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ threadId: null, messages: [], hasMore: false });
  }

  let q = supabase
    .from("ChatMessage")
    .select("*")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: false })
    .limit(limit + 1);

  if (before) q = q.lt("createdAt", before);

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const slice = rows ?? [];
  const hasMore = slice.length > limit;
  const trimmed = hasMore ? slice.slice(0, limit) : slice;
  const messages = trimmed.slice().reverse();

  return NextResponse.json({ threadId: thread.id, messages, hasMore });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return pmReviewChatConnector.handle(req, id);
}
