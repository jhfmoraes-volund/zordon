import { buildZordonPrompt } from "./prompt";
import { assembleZordonTools } from "./tools";
import { buildOpsContext } from "./context";
import { getComposioTools } from "@/lib/composio/client";
import type { AgentDefinition, AgentRunRequest } from "../../types";

/**
 * Zordon — Operations agent.
 * Helps PMs manage sprints, allocate team, create tasks and monitor ops health.
 */
export const zordonAgent: AgentDefinition = {
  name: "zordon",

  async loadContext(_req: AgentRunRequest) {
    return await buildOpsContext();
  },

  buildPrompt(ctx) {
    return buildZordonPrompt(ctx);
  },

  async buildTools({ capabilities }) {
    const nativeTools = assembleZordonTools(capabilities);

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
