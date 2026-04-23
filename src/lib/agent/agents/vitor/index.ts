import { buildSystemPrompt } from "../../prompt";
import { assembleTools } from "../../tools";
import { buildSessionContext, getStepData } from "../../context";
import { db } from "@/lib/db";
import type { AgentDefinition, AgentRunRequest } from "../../types";

/**
 * Vitor — Design Session agent.
 * Guides teams through structured product design sessions.
 */
export const vitorAgent: AgentDefinition = {
  name: "vitor",

  async loadContext(req: AgentRunRequest) {
    const { sessionId, currentStepKey } = req.params;

    const { data: session } = await db()
      .from("DesignSession")
      .select("title, type")
      .eq("id", sessionId)
      .single();

    if (!session) throw new Error("Session not found");

    const [sessionContext, currentStepData] = await Promise.all([
      buildSessionContext(sessionId),
      getStepData(sessionId, currentStepKey),
    ]);

    return {
      sessionId,
      sessionTitle: session.title,
      sessionType: session.type,
      currentStepKey,
      sessionContext,
      currentStepData,
    };
  },

  buildPrompt({ capabilities, agentContext }) {
    return buildSystemPrompt({
      sessionTitle: agentContext.sessionTitle as string,
      sessionType: agentContext.sessionType as string,
      currentStepKey: agentContext.currentStepKey as string,
      sessionContext: agentContext.sessionContext as string,
      currentStepData: agentContext.currentStepData as Record<string, unknown>,
      hasWebSearch: !!capabilities.webSearch,
    });
  },

  buildTools({ capabilities, agentContext }) {
    return assembleTools(agentContext.sessionId as string, capabilities);
  },
};
