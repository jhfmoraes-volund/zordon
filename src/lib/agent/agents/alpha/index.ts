import { buildAlphaPrompt } from "./prompt";
import { assembleAlphaTools } from "./tools";
import { buildOpsContext } from "./context";
import { parseRoute, routeProjectId, routeSprintId, type RouteContext } from "./route-context";
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
    const route: RouteContext = (req.params?.route as RouteContext | undefined) ?? parseRoute(undefined);
    const ctx = await buildOpsContext({ meetingId, route });
    return {
      ...ctx,
      route,
      routeProjectId: routeProjectId(route),
      routeSprintId: routeSprintId(route),
      currentMemberId: req.memberId ?? null,
    };
  },

  buildPrompt(ctx) {
    return buildAlphaPrompt(ctx);
  },

  async buildTools({ capabilities, agentContext }) {
    const activeMeetingId = (agentContext.meetingId as string | null) ?? undefined;
    const routeProjectIdValue = (agentContext.routeProjectId as string | undefined) ?? undefined;
    const routeSprintIdValue = (agentContext.routeSprintId as string | undefined) ?? undefined;
    const currentMemberId = (agentContext.currentMemberId as string | null) ?? undefined;
    const nativeTools = assembleAlphaTools(capabilities, {
      activeMeetingId,
      routeProjectId: routeProjectIdValue,
      routeSprintId: routeSprintIdValue,
      currentMemberId,
    });

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
