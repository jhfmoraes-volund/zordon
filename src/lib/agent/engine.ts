import { streamText, stepCountIs } from "ai";
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

  const messages = [
    ...messageHistory,
    { role: "user" as const, content: userMessage },
  ];

  const modelId = agent.model ?? DEFAULT_MODEL;

  const result = streamText({
    model: getModel(modelId),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(capabilities.maxSteps),
    onFinish: ({ usage, providerMetadata, response }) => {
      void recordAgentUsage({
        agentName: agent.name,
        threadId: thread.id,
        memberId: req.memberId ?? null,
        modelId,
        usage,
        providerMetadata,
        generationId: response?.id ?? null,
      });
    },
  });

  return { streamText: result };
}
