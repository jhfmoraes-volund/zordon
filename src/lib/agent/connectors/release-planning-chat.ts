import { getUser, getCurrentMember, requireProjectViewApi } from "@/lib/dal";
import { getSession } from "@/lib/dal/planning-session";
import { runAgent } from "../engine";
import {
  ensureReleasePlanningThread,
  persistResponseMessage,
  persistUserMessage,
} from "../context";
import { vitoriaAgent } from "../agents/vitoria";
import type { Capabilities } from "../types";

const RELEASE_PLANNING_CAPABILITIES: Capabilities = {
  maxSteps: 40,
  writeTools: true,
  readTools: true,
  webSearch: false,
};

/**
 * Release Planning connector (Vitoria agent, surface 'release_planning').
 * Espelha planning-chat.ts — mesma forma, surface diferente.
 *
 * Chamado por POST /api/planning-sessions/[id]/chat.
 */
export const releasePlanningChatConnector = {
  name: "release_planning" as const,

  async handle(req: Request, sessionId: string): Promise<Response> {
    const user = await getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const session = await getSession(sessionId);
    if (!session) return new Response("Release Planning não encontrado", { status: 404 });

    const denied = await requireProjectViewApi(session.projectId);
    if (denied) return denied;

    const body = await req.json();
    const {
      messages,
      threadId: requestedThreadId,
      planMode,
    } = body as {
      messages: Array<{
        role: string;
        content?: string;
        parts?: Array<{ type: string; text?: string }>;
      }>;
      threadId?: string;
      planMode?: boolean;
    };

    const lastUserMsg = [...(messages ?? [])].reverse().find((m) => m.role === "user");
    const message =
      lastUserMsg?.content ??
      lastUserMsg?.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n") ??
      "";

    if (!message?.trim()) {
      return new Response("Missing message", { status: 400 });
    }

    const member = await getCurrentMember();
    const threadId =
      requestedThreadId ??
      (await ensureReleasePlanningThread(sessionId, member?.id));

    await persistUserMessage(threadId, message);

    const capabilities: Capabilities = {
      ...RELEASE_PLANNING_CAPABILITIES,
      planMode: !!planMode,
      memberId: member?.id,
    };

    const result = await runAgent({
      agent: vitoriaAgent,
      thread: { id: threadId },
      capabilities,
      userMessage: message,
      memberId: member?.id ?? null,
      params: { surface: "release_planning", sessionId },
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
  },
};
