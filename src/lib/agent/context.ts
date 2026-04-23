import { db } from "@/lib/db";
import { buildSessionContext } from "@/lib/task-generator";
import type { ModelMessage } from "ai";
import type { Json } from "@/lib/supabase/database.types";

type SupabaseJson = Json;

/**
 * Loads full session context as formatted text.
 * Re-exports from task-generator for agent use.
 */
export { buildSessionContext };

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
 */
export async function buildMessageHistory(
  threadId: string
): Promise<ModelMessage[]> {
  const { data: messages } = await db()
    .from("ChatMessage")
    .select("*")
    .eq("threadId", threadId)
    .order("createdAt", { ascending: true });

  if (!messages?.length) return [];

  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
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
 * Persists an assistant message (with optional tool actions) to the ChatMessage table.
 */
export async function persistAssistantMessage(
  threadId: string,
  content: string,
  actions?: unknown
): Promise<void> {
  await db().from("ChatMessage").insert({
    threadId,
    role: "assistant",
    content,
    actions: (actions as SupabaseJson) || null,
  });
}

/**
 * Ensures a thread exists for the given session + channel.
 * Returns existing thread or creates a new one.
 */
export async function ensureThread(
  sessionId: string,
  channel: "web" | "telegram" | "trigger" | "briefing",
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
 * Ensures a thread exists for a standalone agent (no DesignSession).
 * Uses agentName + channel as the unique key.
 */
export async function ensureAgentThread(
  agentName: string,
  channel: "web" | "telegram" | "trigger",
  createdBy?: string
): Promise<string> {
  const { data: existing } = await db()
    .from("ChatThread")
    .select("id")
    .eq("agentName", agentName)
    .eq("channel", channel)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await db()
    .from("ChatThread")
    .insert({
      agentName,
      channel,
      createdBy: createdBy || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[ensureAgentThread] insert failed:", error.message, error.details, error.hint);
    throw new Error(`Failed to create agent chat thread: ${error.message}`);
  }

  return created!.id;
}
