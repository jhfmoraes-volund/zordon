import { getUser, getCurrentMember, requireProjectViewApi } from "@/lib/dal";
import { getPlanningById } from "@/lib/dal/planning";
import { runAgent } from "../engine";
import {
  ensureThread,
  persistResponseMessage,
  persistUserMessage,
} from "../context";
import { vitoriaAgent } from "../agents/vitoria";
import type { Capabilities } from "../types";

const PLANNING_CAPABILITIES: Capabilities = {
  maxSteps: 40,
  writeTools: true,
  readTools: true,
  webSearch: false,
};

/**
 * Planning Ceremony connector (Vitoria agent).
 * Mirrors web.ts — same shape, different agent + context.
 *
 * Called by POST /api/planning/[id]/chat.
 */
export const planningChatConnector = {
  name: "planning" as const,

  async handle(req: Request, planningId: string): Promise<Response> {
    const user = await getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const planning = await getPlanningById(planningId);
    if (!planning) return new Response("Planning não encontrada", { status: 404 });

    const denied = await requireProjectViewApi(planning.projectId);
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

    // Extract last user message text
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
      (await ensureThread(planningId, "planning", member?.id));

    await persistUserMessage(threadId, message);

    const capabilities: Capabilities = {
      ...PLANNING_CAPABILITIES,
      planMode: !!planMode,
      memberId: member?.id,
    };

    const result = await runAgent({
      agent: vitoriaAgent,
      thread: { id: threadId },
      capabilities,
      userMessage: message,
      memberId: member?.id ?? null,
      params: { planningId },
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
