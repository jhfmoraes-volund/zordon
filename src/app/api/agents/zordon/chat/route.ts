import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { runAgent } from "@/lib/agent/engine";
import { ensureAgentThread, persistUserMessage } from "@/lib/agent/context";
import { zordonAgent } from "@/lib/agent/agents/zordon";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import type { Capabilities } from "@/lib/agent/types";

export const maxDuration = 300;

const ZORDON_CAPABILITIES: Capabilities = {
  maxSteps: 30,
  writeTools: true,
  readTools: true,
  // Composio will be added when the user has connected accounts
};

/**
 * GET /api/agents/zordon/chat
 * Returns chat history for Zordon's thread.
 */
export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { db } = await import("@/lib/db");
  const { data: thread } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", "zordon")
    .eq("channel", "web")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    return NextResponse.json({ threadId: null, messages: [] });
  }

  const { data: messages } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", thread.id)
    .order("createdAt", { ascending: true });

  return NextResponse.json({
    threadId: thread.id,
    messages: messages || [],
  });
}

/**
 * POST /api/agents/zordon/chat
 * Sends a message to Zordon and streams the AI response.
 */
export async function POST(req: NextRequest) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const body = await req.json();
  const { messages, threadId: requestedThreadId } = body as {
    messages: Array<{ role: string; content?: string; parts?: Array<{ type: string; text?: string }> }>;
    threadId?: string;
  };

  // Extract last user message
  const lastUserMsg = [...(messages || [])].reverse().find((m) => m.role === "user");
  const message =
    lastUserMsg?.content ??
    lastUserMsg?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("\n") ??
    "";

  if (!message?.trim()) {
    return new Response("Missing message", { status: 400 });
  }

  // Resolve thread — Zordon uses agentName, not sessionId
  const member = await getCurrentMember();
  const threadId = requestedThreadId || await ensureAgentThread(
    "zordon",
    "web",
    member?.id
  );

  await persistUserMessage(threadId, message);

  // Build capabilities — load per-PM Roam token (null if not connected).
  const roamToken = member
    ? await getMemberIntegrationToken(member.id, "roam")
    : null;
  const capabilities: Capabilities = {
    ...ZORDON_CAPABILITIES,
    ...(roamToken ? { roamToken } : {}),
  };
  // TODO: load user's Composio connected accounts and add to capabilities.composio

  const result = await runAgent({
    agent: zordonAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: message,
    params: {},
  });

  const response = result.streamText.toUIMessageStreamResponse();

  const headers = new Headers(response.headers);
  headers.set("X-Thread-Id", threadId);

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
