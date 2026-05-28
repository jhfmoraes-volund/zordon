import { db } from "@/lib/db";
import {
  buildSessionContext,
  type SessionContextVerbosity,
} from "@/lib/task-generator";
import type { ModelMessage, UIMessage } from "ai";
import type { Json } from "@/lib/supabase/database.types";

type SupabaseJson = Json;

/**
 * Loads full session context as formatted text.
 * Re-exports from task-generator for agent use.
 */
export { buildSessionContext, type SessionContextVerbosity };

/**
 * Loads detailed data for a specific step.
 */
export async function getStepData(
  sessionId: string,
  stepKey: string
): Promise<Record<string, unknown>> {
  const { data } = await db()
    .from("DesignSessionStepData")
    .select("data")
    .eq("sessionId", sessionId)
    .eq("stepKey", stepKey)
    .maybeSingle();
  return (data?.data as Record<string, unknown>) || {};
}

/**
 * Applies a mutation to step data (read-modify-write).
 */
export async function updateStepData(
  sessionId: string,
  stepKey: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = await getStepData(sessionId, stepKey);
  const updated = mutate(current);

  await db()
    .from("DesignSessionStepData")
    .upsert(
      {
        id: crypto.randomUUID(),
        sessionId,
        stepKey,
        stepIndex: 0,
        data: updated as unknown as SupabaseJson,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId,stepKey" }
    );

  return updated;
}

/**
 * Loads chat history from ChatMessage table and converts to AI SDK message format.
 *
 * F2: defaults to the last 40 messages (~20 turnos). Threads no Vitor podem
 * passar de 200 mensagens; sem cap, o histórico inflate o prompt sem ganho
 * (o agente raramente precisa de contexto de >50 turnos atrás — info crítica
 * já vai pra DesignDecision/DesignOpenQuestion via agentContext).
 *
 * Hoje só emitimos `{ role, content }` em texto puro (sem `parts` com tool
 * calls), então não há risco de orphan tool_use/tool_result. Se voltar a
 * hidratar tool calls no histórico, o cap precisa respeitar boundaries de
 * turno.
 */
export async function buildMessageHistory(
  threadId: string,
  opts: { maxMessages?: number } = {}
): Promise<ModelMessage[]> {
  const limit = opts.maxMessages ?? 40;
  const { data: messages } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", threadId)
    .in("role", ["user", "assistant"])
    .order("createdAt", { ascending: false })
    .limit(limit);

  if (!messages?.length) return [];

  return messages
    .slice()
    .reverse()
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

/**
 * Persists a user message to the ChatMessage table.
 */
export async function persistUserMessage(
  threadId: string,
  content: string
): Promise<void> {
  await db().from("ChatMessage").insert({
    threadId,
    role: "user",
    content,
  });
}

/**
 * Persists an assistant message to the ChatMessage table.
 * `parts` stores the full UIMessage parts array (text + tool calls + reasoning),
 * letting the client rebuild visual chips (tools running, results, etc.) on reload.
 * `content` keeps the plain text for back-compat and prompt-history reconstruction.
 */
export async function persistAssistantMessage(
  threadId: string,
  content: string,
  parts?: unknown
): Promise<void> {
  await db().from("ChatMessage").insert({
    threadId,
    role: "assistant",
    content,
    parts: (parts as SupabaseJson) ?? null,
  });
}

/**
 * onFinish callback factory for `result.toUIMessageStreamResponse`.
 * Persists the full UIMessage (text + tool parts) once the assistant stream
 * completes, so chat history can be rebuilt with chips intact on reload.
 */
export function persistResponseMessage(threadId: string) {
  return async ({ responseMessage }: { responseMessage: UIMessage }) => {
    const text = responseMessage.parts
      .filter((p): p is Extract<UIMessage["parts"][number], { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    await persistAssistantMessage(threadId, text, responseMessage.parts);
  };
}

/**
 * Ensures a thread exists for the given session + channel.
 * Returns existing thread or creates a new one.
 */
export async function ensureThread(
  sessionId: string,
  channel: "web" | "telegram" | "trigger" | "briefing" | "planning",
  createdBy?: string
): Promise<string> {
  const { data: existing } = await db()
    .from("ChatThread")
    .select("id")
    .eq("sessionId", sessionId)
    .eq("channel", channel)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await db()
    .from("ChatThread")
    .insert({
      sessionId,
      channel,
      createdBy: createdBy || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ensureThread] insert failed:", error.message, error.details, error.hint);
    throw new Error(`Failed to create chat thread: ${error.message}`);
  }

  return created!.id;
}

/**
 * Ensures a thread exists for a PlanningCeremony.
 * Uses agentName = planningId + channel = "planning" so each planning
 * has its own thread without touching the DesignSession FK on sessionId.
 */
export async function ensurePlanningThread(
  planningId: string,
  createdBy?: string,
): Promise<string> {
  const { data: existing } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", planningId)
    .eq("channel", "planning")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await db()
    .from("ChatThread")
    .insert({
      sessionId: null,
      agentName: planningId,
      channel: "planning",
      createdBy: createdBy || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ensurePlanningThread] insert failed:", error.message);
    throw new Error(`Failed to create planning thread: ${error.message}`);
  }

  return created!.id;
}

/**
 * Ensures a thread exists for a standalone agent (no DesignSession),
 * scoped to a specific member so each user keeps a private history.
 * Uses agentName + channel + createdBy as the unique key.
 */
export async function ensureAgentThread(
  agentName: string,
  channel: "web" | "telegram" | "trigger",
  createdBy: string
): Promise<string> {
  const { data: existing } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", agentName)
    .eq("channel", channel)
    .eq("createdBy", createdBy)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await db()
    .from("ChatThread")
    .insert({
      agentName,
      channel,
      createdBy,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ensureAgentThread] insert failed:", error.message, error.details, error.hint);
    throw new Error(`Failed to create agent chat thread: ${error.message}`);
  }

  return created!.id;
}
