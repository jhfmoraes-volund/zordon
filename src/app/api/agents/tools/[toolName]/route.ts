import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TOOL_REGISTRY } from "@/lib/agent/tools-registry";

export const dynamic = "force-dynamic";

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

  // Resolve sessionId + projectId a partir do chatTurnId
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
    .select("sessionId")
    .eq("id", turn.threadId)
    .maybeSingle();
  if (!thread?.sessionId) {
    return NextResponse.json(
      { ok: false, error: "thread_session_not_found" },
      { status: 404 },
    );
  }

  const { data: session } = await supabase
    .from("DesignSession")
    .select("projectId")
    .eq("id", thread.sessionId)
    .maybeSingle();
  if (!session?.projectId) {
    return NextResponse.json(
      { ok: false, error: "project_not_found_for_session" },
      { status: 404 },
    );
  }

  const ctx = {
    sessionId: thread.sessionId,
    projectId: session.projectId,
    memberId: null,
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
