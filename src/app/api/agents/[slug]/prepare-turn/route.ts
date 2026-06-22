import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { vitorAgent } from "@/lib/agent/agents/vitor";
import { vitoriaAgent } from "@/lib/agent/agents/vitoria";
import { alphaAgent } from "@/lib/agent/agents/alpha";
import { parseRoute } from "@/lib/agent/agents/alpha/route-context";
import type { AgentDefinition, Capabilities } from "@/lib/agent/types";

export const dynamic = "force-dynamic";

const DEFAULT_CAPABILITIES: Capabilities = {
  maxSteps: 60,
  writeTools: true,
  readTools: true,
  webSearch: true,
};

const AGENTS: Record<string, AgentDefinition> = {
  vitor: vitorAgent,
  vitoria: vitoriaAgent,
  alpha: alphaAgent,
};

/**
 * POST /api/agents/[slug]/prepare-turn
 *
 * Chamado pelo daemon (exec-chat-turn.ts) no início de cada turn pra obter o
 * estado completo necessário pra invocar Claude via SDK. Reusa
 * AgentDefinition.loadContext + buildPrompt do agente (mesma lógica do
 * connector original openrouter) — single source of truth.
 *
 * Dispatch:
 *   - vitor    → vitorAgent (DS, params: {sessionId, currentStepKey})
 *   - vitoria  → vitoriaAgent (PM Review/Planning, surface por thread.channel)
 *   - alpha    → alphaAgent (ops global, params: {route} — global no daemon v1;
 *                route-scoping via currentPath é Fase 2 do alpha-daemon-plan)
 *
 * Body: { chatTurnId }
 * Returns: { systemPrompt, history, sessionId, projectId, currentStepKey }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const agent = AGENTS[slug];
  if (!agent) {
    return NextResponse.json(
      { error: "unknown_agent", slug },
      { status: 404 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { chatTurnId?: string };
  if (!body.chatTurnId) {
    return NextResponse.json({ error: "chatTurnId required" }, { status: 400 });
  }

  const supabase = db();

  const { data: turn } = await supabase
    .from("ChatTurn")
    .select("id, threadId, agentSlug, routePath, turnParams")
    .eq("id", body.chatTurnId)
    .maybeSingle();
  if (!turn) {
    return NextResponse.json({ error: "chat_turn_not_found" }, { status: 404 });
  }

  const { data: thread } = await supabase
    .from("ChatThread")
    .select("id, sessionId, channel, agentName")
    .eq("id", turn.threadId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }

  // Histórico cronológico (últimas 40 msgs)
  const { data: historyRows } = await supabase
    .from("ChatMessage")
    .select("role, content, createdAt")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: true })
    .limit(40);
  const history = (historyRows ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Monta params por slug + surface (Alpha usa o routePath do turn pra
  // enriquecer route-aware — mesma fonte do tool router).
  const { params: agentParams, sessionId, projectId } =
    await resolveAgentParams(slug, thread, turn.routePath, turn.turnParams);

  const capabilities: Capabilities = {
    ...DEFAULT_CAPABILITIES,
    projectId: projectId ?? undefined,
  };

  let agentContext: Record<string, unknown>;
  try {
    agentContext = await agent.loadContext({
      agent,
      thread: { id: thread.id },
      capabilities,
      userMessage: "",
      memberId: null,
      params: agentParams,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "load_context_failed", details: String(err) },
      { status: 500 },
    );
  }

  const result = agent.buildPrompt({
    capabilities,
    agentContext,
    messageHistory: history,
  });
  const systemPrompt = `${result.stable}\n\n${result.volatile}`.trim();

  return NextResponse.json({
    systemPrompt,
    history,
    sessionId,
    projectId,
    currentStepKey: (agentParams.currentStepKey as string | undefined) ?? null,
    surface: (agentParams.surface as string | undefined) ?? null,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type ThreadRow = {
  id: string;
  sessionId: string | null;
  channel: string;
  agentName: string | null;
};

async function resolveAgentParams(
  slug: string,
  thread: ThreadRow,
  routePath?: string | null,
  turnParams?: unknown,
): Promise<{
  params: Record<string, unknown>;
  sessionId: string | null;
  projectId: string | null;
}> {
  const supabase = db();

  // ── Vitor: DS chat — channel='web'|'briefing', sessionId=DesignSession.id
  if (slug === "vitor") {
    if (!thread.sessionId) {
      return { params: { sessionId: null, currentStepKey: "pre_work" }, sessionId: null, projectId: null };
    }
    const { data: session } = await supabase
      .from("DesignSession")
      .select("projectId, currentStep")
      .eq("id", thread.sessionId)
      .maybeSingle();
    const currentStepKey =
      (session as { currentStep?: string | null } | null)?.currentStep ??
      "pre_work";
    return {
      params: { sessionId: thread.sessionId, currentStepKey },
      sessionId: thread.sessionId,
      projectId: session?.projectId ?? null,
    };
  }

  // ── Vitoria: surface por channel
  if (slug === "vitoria") {
    if (thread.channel === "pm_review" && thread.agentName) {
      // agentName carrega o pmReviewId neste canal
      const pmReviewId = thread.agentName;
      const { data: pm } = await supabase
        .from("PMReview")
        .select("projectId")
        .eq("id", pmReviewId)
        .maybeSingle();
      // Params do playbook (audiência + ênfase) — vêm do ChatTurn.turnParams,
      // que o cron/manual populam via derivePromptParams.
      const tp = (turnParams ?? {}) as {
        audienceFloor?: "detail" | "executive";
        emphasisSections?: string[];
      };
      return {
        params: {
          surface: "pm_review",
          pmReviewId,
          audienceFloor: tp.audienceFloor ?? "detail",
          emphasisSections: tp.emphasisSections ?? [],
        },
        sessionId: null,
        projectId: pm?.projectId ?? null,
      };
    }
    if (thread.channel === "planning" && thread.agentName) {
      // Planning Ceremony — agentName carrega o planningId. loadContext da
      // Vitoria (surface=planning) exige params.planningId, senão dá throw.
      const planningId = thread.agentName;
      const { data: planning } = await supabase
        .from("PlanningCeremony")
        .select("projectId")
        .eq("id", planningId)
        .maybeSingle();
      return {
        params: { surface: "planning", planningId },
        sessionId: null,
        projectId: planning?.projectId ?? null,
      };
    }
    if (thread.channel === "release_planning" && thread.agentName) {
      // Release Planning — agentName carrega o sessionId (PlanningSession).
      const sessionId = thread.agentName;
      const { data: ps } = await supabase
        .from("PlanningSession")
        .select("projectId")
        .eq("id", sessionId)
        .maybeSingle();
      return {
        params: { surface: "release_planning", sessionId },
        sessionId,
        projectId: ps?.projectId ?? null,
      };
    }
    if (thread.channel === "wiki" && thread.agentName) {
      // Wiki copiloto — agentName carrega o projectId (1 thread por projeto).
      const projectId = thread.agentName;
      return {
        params: { surface: "wiki", projectId },
        sessionId: null,
        projectId,
      };
    }
    // Fallback: surface padrão (sem contexto resolvível)
    return {
      params: { surface: "planning" },
      sessionId: null,
      projectId: null,
    };
  }

  // ── Alpha: ops. thread.channel='web', agentName='alpha'. Fase 2: a rota vem
  // do ChatTurn.routePath (a página onde o PM está). parseRoute → buildOpsContext
  // renderiza o bloco de foco do projeto/sprint quando há rota, senão o bloco
  // global (sprint ativo + backlog + bateria). Mesma fonte do tool router, então
  // prompt e tools enxergam o mesmo escopo. Estado vivo o agente puxa via reads.
  if (slug === "alpha") {
    return {
      params: { route: parseRoute(routePath ?? undefined) },
      sessionId: null,
      projectId: null,
    };
  }

  return { params: {}, sessionId: null, projectId: null };
}
