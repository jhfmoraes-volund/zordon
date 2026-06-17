import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import type { ZodTypeAny } from "zod";
import { db } from "@/lib/db";
import { TOOL_REGISTRY } from "@/lib/agent/tools-registry";
import { resolveWorkspacePath } from "@/lib/forge/paths";

export const dynamic = "force-dynamic";
// build-bump: 2026-06-02 read_prd


/**
 * POST /api/agents/tools/:toolName
 *
 * Generic tool router — invocado pelo MCP server do repo zordon-daemon
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
  let planningId: string | null = null;

  // Alpha (ops) roda GLOBAL: thread channel='web', agentName='alpha', sem
  // sessionId nem projeto. Suas tools de leitura filtram via supabase direto
  // (não usam ctx.projectId), então dispensamos a resolução de projeto.
  const isAlpha = thread.agentName === "alpha";

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
  } else if (thread.channel === "planning" && thread.agentName) {
    // Planning Ceremony thread — agentName carrega o planningId.
    planningId = thread.agentName;
    const { data: planning } = await supabase
      .from("PlanningCeremony")
      .select("projectId")
      .eq("id", planningId)
      .maybeSingle();
    projectId = planning?.projectId ?? null;
  }

  if (!projectId && !isAlpha) {
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

  // Resolve workspacePath se projeto tem workspace clonado na Forja.
  // Workspace tools (read/glob/grep) validam todo path contra este prefix.
  // Alpha global não tem projeto → pula.
  let workspacePath: string | null = null;
  if (projectId) {
    const { data: project } = await supabase
      .from("Project")
      .select("id, name, referenceKey")
      .eq("id", projectId)
      .maybeSingle();
    if (project) {
      const candidate = resolveWorkspacePath({
        id: project.id,
        name: project.name,
        referenceKey: project.referenceKey,
      });
      if (existsSync(candidate)) workspacePath = candidate;
    }
  }

  const ctx = {
    sessionId,
    projectId: projectId ?? "",
    pmReviewId,
    planningId,
    memberId,
    workspacePath,
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
    // Valida args contra o inputSchema ANTES de executar. O MCP client valida
    // contra o schema do lado do daemon — que pode estar dessincronizado deste
    // deploy (caso .panorama, calibração 0ca428d4). Sem este parse, campo
    // faltante vira TypeError dentro do execute; com ele, o modelo recebe o
    // nome do campo que faltou e consegue se corrigir.
    let toolArgs: Record<string, unknown> = body.args ?? {};
    const inputSchema = (tool as { inputSchema?: ZodTypeAny }).inputSchema;
    if (inputSchema && typeof inputSchema.safeParse === "function") {
      const parsed = inputSchema.safeParse(toolArgs);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        return NextResponse.json(
          { ok: false, error: `invalid_args — ${detail}` },
          { status: 400 },
        );
      }
      toolArgs = parsed.data as Record<string, unknown>;
    }
    const result = await execute(toolArgs, {});
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
