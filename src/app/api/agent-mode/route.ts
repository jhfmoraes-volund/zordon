import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMember } from "@/lib/dal";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const KNOWN_AGENTS = ["vitor", "vitoria", "alpha"] as const;
const MODES = ["openrouter", "claude-daemon"] as const;

type AgentSlug = (typeof KNOWN_AGENTS)[number];
type Mode = (typeof MODES)[number];

const PutBody = z.object({
  agentSlug: z.enum(KNOWN_AGENTS),
  mode: z.enum(MODES),
});

/**
 * GET /api/agent-mode
 * Returns the AgentMode preferences for the current user, one row per agent.
 * Agents with no row default to 'claude-daemon' (regra 2026-06: daemon é o
 * caminho padrão de todo chat; openrouter só sobra como fallback offline).
 */
export async function GET(): Promise<NextResponse> {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const { data, error } = await db()
    .from("AgentMode")
    .select("agentSlug, mode")
    .eq("userId", member.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Garante 1 entrada por agente conhecido (default 'claude-daemon').
  const byAgent = new Map<string, Mode>();
  for (const r of data ?? []) byAgent.set(r.agentSlug, r.mode as Mode);
  const modes = KNOWN_AGENTS.map<{ agentSlug: AgentSlug; mode: Mode }>(
    (slug) => ({
      agentSlug: slug,
      mode: byAgent.get(slug) ?? "claude-daemon",
    }),
  );

  return NextResponse.json({ modes });
}

/**
 * PUT /api/agent-mode
 * Body: { agentSlug: 'vitor'|'vitoria'|'alpha', mode: 'openrouter'|'claude-daemon' }
 * Upsert da preferência. Decisão global por user — sticky até trocar de novo.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PutBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { agentSlug, mode } = parsed.data;

  const { error } = await db()
    .from("AgentMode")
    .upsert(
      {
        userId: member.id,
        agentSlug,
        mode,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "userId,agentSlug" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
