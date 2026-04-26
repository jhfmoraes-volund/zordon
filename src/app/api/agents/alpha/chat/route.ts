import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { runAgent } from "@/lib/agent/engine";
import {
  ensureAgentThread,
  persistResponseMessage,
  persistUserMessage,
} from "@/lib/agent/context";
import { alphaAgent } from "@/lib/agent/agents/alpha";
import { parseRoute } from "@/lib/agent/agents/alpha/route-context";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import type { Capabilities } from "@/lib/agent/types";

export const maxDuration = 300;

const ALPHA_CAPABILITIES: Capabilities = {
  maxSteps: 30,
  writeTools: true,
  readTools: true,
  // Composio will be added when the user has connected accounts
};

/**
 * GET /api/agents/alpha/chat
 * Returns chat history. With ?threadId=X loads that specific thread (after
 * verifying ownership); without it falls back to the member's most recent thread.
 */
export async function GET(req: NextRequest) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const { db } = await import("@/lib/db");
  const requestedThreadId = req.nextUrl.searchParams.get("threadId");

  let threadId: string | null = null;
  if (requestedThreadId) {
    const { data: owned } = await db()
      .from("ChatThread")
      .select("id")
      .eq("id", requestedThreadId)
      .eq("createdBy", member.id)
      .eq("agentName", "alpha")
      .maybeSingle();
    if (!owned) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    threadId = owned.id;
  } else {
    // Restrict the fallback to threads that actually have content
    // (title is set on first user message), avoiding empty ghost threads.
    const { data: thread } = await db()
      .from("ChatThread")
      .select("id")
      .eq("agentName", "alpha")
      .eq("channel", "web")
      .eq("createdBy", member.id)
      .not("title", "is", null)
      .order("updatedAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    threadId = thread?.id ?? null;
  }

  if (!threadId) {
    return NextResponse.json({ threadId: null, messages: [] });
  }

  const { data: messages } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", threadId)
    .order("createdAt", { ascending: true });

  return NextResponse.json({
    threadId,
    messages: messages || [],
  });
}

/**
 * POST /api/agents/alpha/chat
 * Sends a message to Alpha and streams the AI response.
 */
export async function POST(req: NextRequest) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const body = await req.json();
  const {
    messages,
    threadId: requestedThreadId,
    newThread,
    meetingId,
    currentPath,
  } = body as {
    messages: Array<{ role: string; content?: string; parts?: Array<{ type: string; text?: string }> }>;
    threadId?: string;
    newThread?: boolean;
    meetingId?: string;
    currentPath?: string;
  };

  const route = parseRoute(currentPath);

  // Extract last user message
  const lastUserMsg = [...(messages || [])].reverse().find((m) => m.role === "user");
  const message =
    lastUserMsg?.content ??
    lastUserMsg?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("\n") ??
    "";

  if (!message?.trim()) {
    return new Response("Missing message", { status: 400 });
  }

  const member = await getCurrentMember();
  if (!member) {
    return new Response("Member not found", { status: 403 });
  }

  // Resolve thread — Alpha uses agentName, not sessionId.
  // Threads are scoped per member to keep conversations private.
  // `newThread:true` forces creation (used by /ops "Nova conversa"), otherwise
  // an explicit threadId is honoured, falling back to the member's latest.
  const { db } = await import("@/lib/db");
  let threadId: string;
  if (newThread) {
    const { data: created, error } = await db()
      .from("ChatThread")
      .insert({ agentName: "alpha", channel: "web", createdBy: member.id })
      .select("id")
      .single();
    if (error || !created) {
      return new Response(`Failed to create thread: ${error?.message ?? "unknown"}`, { status: 500 });
    }
    threadId = created.id;
  } else if (requestedThreadId) {
    const { data: owned } = await db()
      .from("ChatThread")
      .select("id")
      .eq("id", requestedThreadId)
      .eq("createdBy", member.id)
      .maybeSingle();
    if (!owned) {
      return new Response("Thread not found", { status: 404 });
    }
    threadId = owned.id;
  } else {
    threadId = await ensureAgentThread("alpha", "web", member.id);
  }

  const { data: existingTitle } = await db()
    .from("ChatThread")
    .select("title")
    .eq("id", threadId)
    .maybeSingle();

  await persistUserMessage(threadId, message);

  // First message in this thread becomes its title (truncated for the sidebar).
  // Always bump updatedAt so recently-active threads sort to the top.
  const updates: { updatedAt: string; title?: string } = {
    updatedAt: new Date().toISOString(),
  };
  if (!existingTitle?.title) {
    updates.title = message.length > 80 ? `${message.slice(0, 80).trimEnd()}…` : message;
  }
  await db().from("ChatThread").update(updates).eq("id", threadId);

  // Build capabilities — load per-PM Roam token (null if not connected).
  const roamToken = member
    ? await getMemberIntegrationToken(member.id, "roam")
    : null;
  const capabilities: Capabilities = {
    ...ALPHA_CAPABILITIES,
    ...(roamToken ? { roamToken } : {}),
  };
  // TODO: load user's Composio connected accounts and add to capabilities.composio

  const result = await runAgent({
    agent: alphaAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: message,
    memberId: member.id,
    params: { meetingId, route },
  });

  const response = result.streamText.toUIMessageStreamResponse({
    onFinish: persistResponseMessage(threadId),
  });

  const headers = new Headers(response.headers);
  headers.set("X-Thread-Id", threadId);

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
