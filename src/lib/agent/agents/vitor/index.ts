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
      .select("title, type, projectId, selectedSteps")
      .eq("id", sessionId)
      .single();

    if (!session) throw new Error("Session not found");

    const [
      sessionContext,
      currentStepData,
      activeDecisions,
      openQuestions,
      businessContext,
      project,
      sessionIndex,
    ] = await Promise.all([
      buildSessionContext(sessionId),
      getStepData(sessionId, currentStepKey),
      db()
        .from("DesignDecision")
        .select("id, statement, rationale, confidence, status, tags, createdAt")
        .eq("projectId", session.projectId)
        .eq("status", "active")
        .order("createdAt", { ascending: false }),
      db()
        .from("DesignOpenQuestion")
        .select("id, question, blocksWhat, createdAt")
        .eq("sessionId", sessionId)
        .eq("status", "open")
        .order("createdAt", { ascending: false }),
      db()
        .from("ProjectBusinessContext")
        .select("*")
        .eq("projectId", session.projectId)
        .maybeSingle(),
      db()
        .from("Project")
        .select("memoryMd, memoryVersion, memoryUpdatedAt")
        .eq("id", session.projectId)
        .single(),
      db()
        .from("DesignSession")
        .select("id, title, type, status, memoryAbstract, updatedAt")
        .eq("projectId", session.projectId)
        .neq("id", sessionId)
        .neq("status", "draft")
        .order("updatedAt", { ascending: false })
        .limit(10),
    ]);

    return {
      sessionId,
      projectId: session.projectId,
      memberId: req.memberId ?? undefined,
      sessionTitle: session.title,
      sessionType: session.type,
      selectedSteps: (session as { selectedSteps?: string[] | null }).selectedSteps ?? null,
      currentStepKey,
      sessionContext,
      currentStepData,
      activeDecisions: activeDecisions.data ?? [],
      openQuestions: openQuestions.data ?? [],
      businessContext: businessContext.data ?? null,
      projectMemoryMd: project.data?.memoryMd ?? null,
      projectMemoryVersion: project.data?.memoryVersion ?? 0,
      sessionIndex: sessionIndex.data ?? [],
    };
  },

  buildPrompt({ capabilities, agentContext }) {
    return buildSystemPrompt({
      sessionTitle: agentContext.sessionTitle as string,
      sessionType: agentContext.sessionType as string,
      selectedSteps: agentContext.selectedSteps as string[] | null,
      currentStepKey: agentContext.currentStepKey as string,
      sessionContext: agentContext.sessionContext as string,
      currentStepData: agentContext.currentStepData as Record<string, unknown>,
      hasWebSearch: !!capabilities.webSearch,
      activeDecisions: agentContext.activeDecisions as ActiveDecision[],
      openQuestions: agentContext.openQuestions as OpenQuestion[],
      businessContext: agentContext.businessContext as BusinessContext | null,
      projectMemoryMd: agentContext.projectMemoryMd as string | null,
      sessionIndex: agentContext.sessionIndex as SessionIndexEntry[],
    });
  },

  buildTools({ capabilities, agentContext }) {
    return assembleTools(agentContext.sessionId as string, {
      ...capabilities,
      projectId: (agentContext.projectId as string) ?? capabilities.projectId,
      memberId: (agentContext.memberId as string | undefined) ?? capabilities.memberId,
    });
  },
};

// Types re-used by buildPrompt
export interface ActiveDecision {
  id: string;
  statement: string;
  rationale: string;
  confidence: "hard_fact" | "inferred" | "assumption";
  status: "active";
  tags: string[] | null;
  createdAt: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  blocksWhat: string | null;
  createdAt: string;
}

export interface BusinessContext {
  businessModel: string | null;
  stage: string | null;
  icp: string | null;
  ticketRangeBrl: string | null;
  runwayMonths: number | null;
  competitors: unknown;
  updatedAt: string;
}

export interface SessionIndexEntry {
  id: string;
  title: string;
  type: string;
  status: string;
  memoryAbstract: string | null;
  updatedAt: string;
}
