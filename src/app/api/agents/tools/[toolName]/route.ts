import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TOOL_REGISTRY } from "@/lib/agent/tools-registry";

export const dynamic = "force-dynamic";
// build-bump: 2026-06-02 read_prd


/**
 * POST /api/agents/tools/:toolName
 *
 * Generic tool router — invocado pelo MCP server (scripts/daemon/mcp-server.ts)
 * quando Claude CLI chama uma tool via JSON-RPC. Lookup no TOOL_REGISTRY,
 * resolve contexto a partir do chatTurnId, executa, retorna resultado.
 *
 * Body:
 *   { args: Record<string, unknown>, chatTurnId: string }
 *
 * Returns:
 *   - 200 { ok: true, result: <tool execute() return> }
 *   - 400 { ok: false, error } — args inválido ou chatTurnId faltando
 *   - 404 { ok: false, error: "unknown_tool" }
 *   - 500 { ok: false, error: <execution error message> }
 *
 * Sem Bearer auth nesta fase (MVP local — service_role via db()).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ toolName: string }> },
): Promise<NextResponse> {
  const { toolName } = await params;

  const factory = TOOL_REGISTRY[toolName];
  if (!factory) {
    return NextResponse.json(
      { ok: false, error: "unknown_tool", toolName },
      { status: 404 },
    );
  }

  let body: { args?: Record<string, unknown>; chatTurnId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body.chatTurnId) {
    return NextResponse.json(
      { ok: false, error: "chatTurnId required" },
      { status: 400 },
    );
  }

  // Resolve contexto (sessionId, projectId, pmReviewId) a partir do chatTurnId.
  // ChatThread pode ser de DS (sessionId populado) OU PM Review (agentName=pmReviewId, channel='pm_review').
  const supabase = db();
  const { data: turn } = await supabase
    .from("ChatTurn")
    .select("threadId")
    .eq("id", body.chatTurnId)
    .maybeSingle();
  if (!turn) {
    return NextResponse.json(
      { ok: false, error: "chat_turn_not_found" },
      { status: 404 },
    );
  }

  const { data: thread } = await supabase
    .from("ChatThread")
    .select("sessionId, channel, agentName, createdBy")
    .eq("id", turn.threadId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json(
      { ok: false, error: "thread_not_found" },
      { status: 404 },
    );
  }

  let sessionId: string | null = null;
  let projectId: string | null = null;
  let pmReviewId: string | null = null;

  if (thread.sessionId) {
    // DS thread
    sessionId = thread.sessionId;
    const { data: session } = await supabase
      .from("DesignSession")
      .select("projectId")
      .eq("id", thread.sessionId)
      .maybeSingle();
    projectId = session?.projectId ?? null;
  } else if (thread.channel === "pm_review" && thread.agentName) {
    // PM Review thread
    pmReviewId = thread.agentName;
    const { data: pm } = await supabase
      .from("PMReview")
      .select("projectId")
      .eq("id", pmReviewId)
      .maybeSingle();
    projectId = pm?.projectId ?? null;
  }

  if (!projectId) {
    return NextResponse.json(
      { ok: false, error: "project_not_resolvable" },
      { status: 404 },
    );
  }

  // Resolve memberId via ChatThread.createdBy (auth user id) → Member.userId.
  // PRD tools (propose_prd/update_prd) audit-trail; approve_prd requires.
  let memberId: string | null = null;
  if (thread.createdBy) {
    const { data: member } = await supabase
      .from("Member")
      .select("id")
      .eq("userId", thread.createdBy)
      .maybeSingle();
    memberId = member?.id ?? null;
  }

  const ctx = {
    sessionId,
    projectId,
    pmReviewId,
    memberId,
  };

  try {
    const tool = factory(ctx);
    // AI SDK Tool.execute signature aceita (input, options). Options vazio aqui.
    const execute = tool.execute as
      | ((args: Record<string, unknown>, options?: unknown) => Promise<unknown>)
      | undefined;
    if (!execute) {
      return NextResponse.json(
        { ok: false, error: "tool_has_no_execute" },
        { status: 500 },
      );
    }
    const result = await execute(body.args ?? {}, {});
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tools/${toolName}] execute failed:`, err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
