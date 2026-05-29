import { getUser, getCurrentMember, requireProjectViewApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { runAgent } from "../engine";
import {
  ensurePMReviewThread,
  persistResponseMessage,
  persistUserMessage,
} from "../context";
import { vitoriaAgent } from "../agents/vitoria";
import type { Capabilities } from "../types";

const PM_REVIEW_CAPABILITIES: Capabilities = {
  maxSteps: 30,
  writeTools: true,
  readTools: true,
  webSearch: false,
};

/**
 * PM Review connector — mesma Vitoria do Planning, surface 'pm_review'.
 * Chamado por POST /api/pm-review/[id]/chat.
 */
export const pmReviewChatConnector = {
  name: "pm_review" as const,

  async handle(req: Request, pmReviewId: string): Promise<Response> {
    const user = await getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const { data: pm } = await db()
      .from("PMReview")
      .select("projectId")
      .eq("id", pmReviewId)
      .maybeSingle();
    if (!pm) return new Response("PM Review não encontrado", { status: 404 });

    const denied = await requireProjectViewApi(pm.projectId);
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
      requestedThreadId ?? (await ensurePMReviewThread(pmReviewId, member?.id));

    await persistUserMessage(threadId, message);

    const capabilities: Capabilities = {
      ...PM_REVIEW_CAPABILITIES,
      planMode: !!planMode,
      memberId: member?.id,
    };

    const result = await runAgent({
      agent: vitoriaAgent,
      thread: { id: threadId },
      capabilities,
      userMessage: message,
      memberId: member?.id ?? null,
      params: { surface: "pm_review", pmReviewId },
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
