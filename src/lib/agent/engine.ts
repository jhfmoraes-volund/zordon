import { streamText, stepCountIs } from "ai";
import { getModel, DEFAULT_MODEL } from "@/lib/ai/provider";
import { buildMessageHistory, persistAssistantMessage } from "./context";
import type { AgentRunRequest, AgentRunResult } from "./types";

/**
 * Single entry point for running ANY agent (Vitor, Zordon, ...).
 *
 * Every connector — web, telegram, trigger — goes through this function.
 * The engine returns the raw streamText handle (never consuming it) so
 * each connector can map it to its own transport.
 *
 * The agent's identity (prompt, tools, context) comes from the
 * AgentDefinition passed in req.agent.
 */
export async function runAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const { agent, thread, capabilities, userMessage } = req;

  // Load agent-specific context + chat history in parallel
  const [agentContext, messageHistory] = await Promise.all([
    agent.loadContext(req),
    buildMessageHistory(thread.id),
  ]);

  // Build prompt and tools using the agent definition
  const promptContext = { messageHistory, capabilities, agentContext };
  const [systemPrompt, tools] = await Promise.all([
    agent.buildPrompt(promptContext),
    agent.buildTools(promptContext),
  ]);

  // Append the new user message to history
  const messages = [
    ...messageHistory,
    { role: "user" as const, content: userMessage },
  ];

  const result = streamText({
    model: getModel(DEFAULT_MODEL),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(capabilities.maxSteps),
    onFinish: async (event) => {
      // Persist even partial text if the stream was aborted mid-generation
      if (event.text) {
        await persistAssistantMessage(thread.id, event.text);
      }
    },
  });

  // Ensure persistence even if the client disconnects and onFinish doesn't fire.
  // consumeStream drains the provider stream server-side, guaranteeing onFinish triggers.
  Promise.resolve(result.consumeStream()).catch(() => {});

  return { streamText: result };
}
