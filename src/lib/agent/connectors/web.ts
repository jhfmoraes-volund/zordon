import { getUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { runAgent } from "../engine";
import {
  ensureThread,
  persistResponseMessage,
  persistUserMessage,
} from "../context";
import { getCurrentMember } from "@/lib/dal";
import { vitorAgent } from "../agents/vitor";
import type { Capabilities } from "../types";

/**
 * Capabilities for the web chat in the design session wizard.
 * Full access: read + write tools, generous step budget.
 */
const WEB_CAPABILITIES: Capabilities = {
  maxSteps: 60,
  writeTools: true,
  readTools: true,
  webSearch: true,
};

/**
 * Web connector for the design session chat (Vitor agent).
 * Handles HTTP request → runAgent → SSE stream response.
 *
 * Inspired by Volund OS: lib/agent/connectors/web.ts
 */
export const webConnector = {
  name: "web" as const,
  capabilities: WEB_CAPABILITIES,

  async handle(
    req: Request,
    sessionId: string
  ): Promise<Response> {
    // Auth
    const user = await getUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse body — AI SDK v6 DefaultChatTransport sends { messages, ...body }
    const body = await req.json();
    const {
      messages,
      currentStepKey,
      threadId: requestedThreadId,
      channel: requestedChannel,
      planMode,
    } = body as {
      messages: Array<{ role: string; content?: string; parts?: Array<{ type: string; text?: string }> }>;
      currentStepKey: string;
      threadId?: string;
      channel?: "web" | "briefing";
      planMode?: boolean;
    };

    // Extract the last user message text from the messages array
    const lastUserMsg = [...(messages || [])].reverse().find((m) => m.role === "user");
    const message =
      lastUserMsg?.content ??
      lastUserMsg?.parts?.filter((p) => p.type === "text").map((p) => p.text).join("\n") ??
      "";

    if (!message?.trim() || !currentStepKey) {
      console.error("[web-connector] 400 — body keys:", Object.keys(body), "messages count:", messages?.length, "lastUserMsg:", JSON.stringify(lastUserMsg)?.slice(0, 200), "extracted message:", message?.slice(0, 100));
      return new Response("Missing message or currentStepKey", { status: 400 });
    }

    // Resolve or create thread
    const member = await getCurrentMember();
    const channel = requestedChannel || "web";
    const threadId = requestedThreadId || await ensureThread(
      sessionId,
      channel,
      member?.id
    );

    // Briefing scope marker: the first time the user sends a message while
    // in step=briefing, stamp DesignSession.briefingFirstMessageAt.
    // Stamped BEFORE persistUserMessage so the marker is older than the message
    // we're about to insert — the GET endpoint uses `>=` to include the message.
    // The briefing chat UI uses this to render only briefing-era messages by
    // default, even when the underlying thread is the same `web` channel
    // shared across earlier steps.
    if (currentStepKey === "briefing") {
      const { data: sess } = await db()
        .from("DesignSession")
        .select("briefingFirstMessageAt")
        .eq("id", sessionId)
        .maybeSingle();
      if (!sess?.briefingFirstMessageAt) {
        // Use a slightly-earlier timestamp so the row we insert next satisfies `>=`.
        const markerIso = new Date(Date.now() - 1).toISOString();
        await db()
          .from("DesignSession")
          .update({ briefingFirstMessageAt: markerIso })
          .eq("id", sessionId);
      }
    }

    // Persist user message
    await persistUserMessage(threadId, message);

    // Resolve projectId — required for memory tools + research auto-capture.
    // createTasks ainda fica gated por step=briefing.
    const { data: session } = await db()
      .from("DesignSession")
      .select("projectId")
      .eq("id", sessionId)
      .single();
    let capabilities = { ...WEB_CAPABILITIES, planMode: !!planMode };
    if (session?.projectId) {
      capabilities = { ...capabilities, projectId: session.projectId };
      if (currentStepKey === "briefing") {
        capabilities = { ...capabilities, createTasks: true };
      }
    }

    // Run the agent engine
    const result = await runAgent({
      agent: vitorAgent,
      thread: { id: threadId },
      capabilities,
      userMessage: message,
      memberId: member?.id ?? null,
      params: { sessionId, currentStepKey },
    });

    // Transport: UI message stream for DefaultChatTransport (AI SDK v6)
    const response = result.streamText.toUIMessageStreamResponse({
      onFinish: persistResponseMessage(threadId),
    });

    // Attach thread ID header so the client knows which thread was used
    const headers = new Headers(response.headers);
    headers.set("X-Thread-Id", threadId);

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};
