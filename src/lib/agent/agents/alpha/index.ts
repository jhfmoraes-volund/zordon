import { buildAlphaPrompt } from "./prompt";
import { assembleAlphaTools } from "./tools";
import { buildOpsContext } from "./context";
import { parseRoute, routeProjectId, routeSprintId, type RouteContext } from "./route-context";
import { getComposioTools } from "@/lib/composio/client";
import { db } from "@/lib/db";
import type { AgentDefinition, AgentRunRequest } from "../../types";

/**
 * Alpha — Operations agent.
 * Helps PMs manage sprints, allocate team, create tasks and monitor ops health.
 */
export const alphaAgent: AgentDefinition = {
  name: "alpha",
  model: "anthropic/claude-sonnet-4.6",

  async loadContext(req: AgentRunRequest) {
    const meetingId = (req.params?.meetingId as string | undefined) || undefined;
    const route: RouteContext = (req.params?.route as RouteContext | undefined) ?? parseRoute(undefined);
    const ctx = await buildOpsContext({
      meetingId,
      route,
      userMessage: req.userMessage,
    });
    return {
      ...ctx,
      route,
      routeProjectId: routeProjectId(route),
      routeSprintId: routeSprintId(route),
      currentMemberId: req.memberId ?? null,
      threadId: req.thread.id,
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

    // Per-project kill switch for hierarchy + planner write tools.
    // Read tools always available — writes (create_user_story, bulk_update_tasks, etc.)
    // gated by Project.alphaHierarchyEnabled. Default true on schema.
    let alphaHierarchyEnabled = true;
    if (routeProjectIdValue) {
      const { data: project } = await db()
        .from("Project")
        .select("alphaHierarchyEnabled")
        .eq("id", routeProjectIdValue)
        .maybeSingle();
      if (project && project.alphaHierarchyEnabled === false) {
        alphaHierarchyEnabled = false;
      }
    }

    const threadId = (agentContext.threadId as string | undefined) ?? undefined;

    const nativeTools = assembleAlphaTools(capabilities, {
      activeMeetingId,
      routeProjectId: routeProjectIdValue,
      routeSprintId: routeSprintIdValue,
      currentMemberId,
      threadId,
      alphaHierarchyEnabled,
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
