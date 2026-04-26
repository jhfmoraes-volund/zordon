import { buildAlphaPrompt } from "./prompt";
import { assembleAlphaTools } from "./tools";
import { buildOpsContext } from "./context";
import { getComposioTools } from "@/lib/composio/client";
import type { AgentDefinition, AgentRunRequest } from "../../types";

/**
 * Alpha — Operations agent.
 * Helps PMs manage sprints, allocate team, create tasks and monitor ops health.
 */
export const alphaAgent: AgentDefinition = {
  name: "alpha",

  async loadContext(req: AgentRunRequest) {
    const meetingId = (req.params?.meetingId as string | undefined) || undefined;
    return await buildOpsContext({ meetingId });
  },

  buildPrompt(ctx) {
    return buildAlphaPrompt(ctx);
  },

  async buildTools({ capabilities, agentContext }) {
    const activeMeetingId = (agentContext.meetingId as string | null) ?? undefined;
    const nativeTools = assembleAlphaTools(capabilities, { activeMeetingId });

    // Merge Composio tools if configured
    if (capabilities.composio) {
      const composioTools = await getComposioTools(
        capabilities.composio.userId,
        capabilities.composio.toolkits
      );
      return { ...nativeTools, ...composioTools };
    }

    return nativeTools;
  },
};
