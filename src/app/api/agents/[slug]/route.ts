import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { ADMIN } from "@/lib/roles";

/**
 * GET /api/agents/[slug] — retorna o agente, seus configs e índice de heurísticas.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = await requireMinLevelApi(ADMIN);
  if (denied) return denied;

  const { slug } = await params;
  const supabase = db();

  const { data: agent, error: agentError } = await supabase
    .from("Agent")
    .select("id, slug, name, description, modelId, systemPrompt, capabilities, isActive, updatedAt")
    .eq("slug", slug)
    .maybeSingle();

  if (agentError) return NextResponse.json({ error: agentError.message }, { status: 500 });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const [{ data: configs }, { data: heuristics }] = await Promise.all([
    supabase
      .from("AgentConfig")
      .select("key, value, description, updatedAt")
      .eq("agentId", agent.id),
    supabase
      .from("AgentHeuristic")
      .select("id, name, title, description, category, isActive, updatedAt")
      .eq("agentId", agent.id)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  const configMap: Record<string, unknown> = {};
  for (const row of configs || []) configMap[row.key] = row.value;

  return NextResponse.json({
    agent,
    configs: configMap,
    heuristics: heuristics || [],
  });
}
