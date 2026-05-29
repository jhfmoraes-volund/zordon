import { streamText, stepCountIs, type ModelMessage } from "ai";
import { getModel, DEFAULT_MODEL } from "@/lib/ai/provider";
import { buildMessageHistory } from "./context";
import { recordAgentUsage } from "./usage";
import type { AgentRunRequest, AgentRunResult } from "./types";

/**
 * Single entry point for running ANY agent (Vitor, Alpha, ...).
 *
 * Every connector — web, telegram, trigger — goes through this function.
 * The engine returns the raw streamText handle (never consuming it) so
 * each connector can map it to its own transport.
 *
 * The agent's identity (prompt, tools, context) comes from the
 * AgentDefinition passed in req.agent. Persisting the assistant response
 * is the connector's responsibility (via toUIMessageStreamResponse onFinish),
 * so we keep the parts array intact for UI rebuilds.
 *
 * Cache strategy (Anthropic prompt cache via OpenRouter):
 * `buildPrompt` returns { stable, volatile }. We send them as a system
 * message with `providerOptions.openrouter.cacheControl = ephemeral` so the
 * stable prefix gets cached for ~5min. The volatile suffix is injected as a
 * leading user-message part right before the chat history — this keeps the
 * Anthropic ordering intact (system → user → assistant → ...) without
 * polluting the cacheable system block. See docs/agents/vitor/vitor-cost-reduction-plan.md.
 */
export async function runAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const { agent, thread, capabilities, userMessage } = req;

  const [agentContext, messageHistory] = await Promise.all([
    agent.loadContext(req),
    buildMessageHistory(thread.id),
  ]);

  const promptContext = { messageHistory, capabilities, agentContext };
  const [systemPrompt, tools] = await Promise.all([
    agent.buildPrompt(promptContext),
    agent.buildTools(promptContext),
  ]);

  const { stable, volatile } = systemPrompt;

  // Build a system message with cacheControl on the stable prefix.
  // The AI SDK 6 SystemModelMessage accepts only `content: string`, so we
  // attach providerOptions at the message level (validated empirically in
  // scripts/spike-cache.ts — both message-level and part-level work for
  // OpenRouter→Anthropic).
  const systemMessages: ModelMessage[] = [];
  if (stable.length > 0) {
    systemMessages.push({
      role: "system",
      content: stable,
      providerOptions: {
        openrouter: { cacheControl: { type: "ephemeral" } },
      },
    });
  }
  if (volatile.length > 0) {
    systemMessages.push({
      role: "system",
      content: volatile,
    });
  }

  const messages: ModelMessage[] = [
    ...systemMessages,
    ...messageHistory,
    { role: "user", content: userMessage },
  ];

  const modelId = agent.model ?? DEFAULT_MODEL;
  const turnStartedAt = Date.now();

  // projectId é opcional — agentes que não rodam num escopo de projeto
  // (ex Alpha global) podem omitir. Quando presente, agrupa custos no painel.
  const projectId =
    typeof agentContext === "object" && agentContext !== null
      ? ((agentContext as Record<string, unknown>).projectId as string | null | undefined) ?? null
      : null;

  const result = streamText({
    model: getModel(modelId),
    messages,
    tools,
    stopWhen: stepCountIs(capabilities.maxSteps),
    // `onFinish` recebe `usage` (do ULTIMO step apenas) e `totalUsage` (agregado
    // de todos os steps). Quando o agente faz tool calls, sao N chamadas
    // Anthropic — cada uma com seu prompt+completion+cost. Pra bater com a
    // fatura do OpenRouter, persistimos `totalUsage` + somamos `cost` de cada
    // step via `event.steps[].providerMetadata`.
    onFinish: (event) => {
      void recordAgentUsage({
        agentName: agent.name,
        threadId: thread.id,
        memberId: req.memberId ?? null,
        modelId,
        totalUsage: event.totalUsage,
        steps: event.steps,
        generationId: event.response?.id ?? null,
        projectId,
        callKind: "turn",
        latencyMs: Date.now() - turnStartedAt,
      });
    },
  });

  return { streamText: result };
}
