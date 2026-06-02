/**
 * Chat com Vitória — Copiloto de Rituais.
 *
 *   POST /api/planning/[id]/chat
 *     Envia mensagem, stream da resposta. Delega ao planningChatConnector.
 *
 *   GET  /api/planning/[id]/chat?limit=30&before=<iso>
 *     Carrega histórico do thread da planning (agentName=planningId, channel='planning').
 *     Keyset por createdAt DESC. Sem `before` → mensagens mais recentes.
 *     Com `before` → próximas mais antigas (infinite scroll).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";
import { planningChatConnector } from "@/lib/agent/connectors/planning-chat";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planningId } = await params;

  const planning = await getPlanningById(planningId);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
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
    .eq("agentName", planningId)
    .eq("channel", "planning")
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

  // "1 planning viva por sprint": planning concluída/arquivada é read-only.
  // Pra editar, o PM precisa reabrir explicitamente (POST .../reopen). Evita
  // que a Vitoria crie propostas órfãs num plano já publicado.
  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  if (planning.phase === "closed" || planning.phase === "archived") {
    return NextResponse.json(
      { error: "Reabra a planning pra editar.", phase: planning.phase },
      { status: 409 },
    );
  }

  return planningChatConnector.handle(req, id);
}
