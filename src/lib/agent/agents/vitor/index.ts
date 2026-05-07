import { buildSystemPrompt } from "../../prompt";
import { assembleTools } from "../../tools";
import {
  buildSessionContext,
  getStepData,
  type SessionContextVerbosity,
} from "../../context";
import { db } from "@/lib/db";
import {
  getModulesForProject,
  getPersonasForProject,
  getRecentStoriesForProject,
} from "@/lib/dal/story-hierarchy";
import {
  BRIEFING_SUB_PHASES,
  DEFAULT_BRIEFING_SUB_PHASE,
} from "@/lib/design-sessions/constants";
import type { AgentDefinition, AgentRunRequest } from "../../types";

function pickVerbosity(
  currentStepKey: string,
  subPhase: string | undefined,
): SessionContextVerbosity {
  if (currentStepKey !== "briefing") return "full";
  const phase = subPhase ?? DEFAULT_BRIEFING_SUB_PHASE;
  switch (phase) {
    case BRIEFING_SUB_PHASES.MODULE_DISCOVERY:
      return "discovery";
    case BRIEFING_SUB_PHASES.STORY_TREE:
      return "refinement";
    case BRIEFING_SUB_PHASES.STORY_DETAIL:
    case BRIEFING_SUB_PHASES.TASK_BREAKDOWN:
      return "execution";
    default:
      return "full";
  }
}

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

    const isBriefing = currentStepKey === "briefing";

    // Load step data first so we can pick context verbosity from subPhase.
    // Cheap (single row) and unblocks the parallel fan-out below.
    const currentStepData = await getStepData(sessionId, currentStepKey);
    const subPhase = (currentStepData as { subPhase?: string } | null)?.subPhase;
    const verbosity = pickVerbosity(currentStepKey, subPhase);

    const [
      sessionContext,
      activeDecisions,
      openQuestions,
      businessContext,
      project,
      sessionIndex,
      transcripts,
      existingModules,
      existingStories,
      existingPersonas,
    ] = await Promise.all([
      buildSessionContext(sessionId, verbosity),
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
      db()
        .from("DesignSessionTranscript")
        .select(
          "id, meetingTitle, meetingStart, meetingEnd, participants, summary, actionItems, fullText",
        )
        .eq("sessionId", sessionId)
        .order("meetingStart", { ascending: false }),
      // Hierarchy context — only loaded on briefing to keep prompt token budget tight.
      isBriefing
        ? getModulesForProject(session.projectId)
        : Promise.resolve([]),
      isBriefing
        ? getRecentStoriesForProject(session.projectId, { limit: 50 })
        : Promise.resolve([]),
      isBriefing
        ? getPersonasForProject(session.projectId)
        : Promise.resolve([]),
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
      transcripts: transcripts.data ?? [],
      existingModules,
      existingStories,
      existingPersonas,
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
      transcripts: agentContext.transcripts as TranscriptContextItem[],
      existingModules: agentContext.existingModules as ExistingModule[],
      existingStories: agentContext.existingStories as ExistingStory[],
      existingPersonas: agentContext.existingPersonas as ExistingPersona[],
      planMode: !!capabilities.planMode,
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

export interface TranscriptContextItem {
  id: string;
  meetingTitle: string;
  meetingStart: string;
  meetingEnd: string;
  participants: { name: string; email?: string }[];
  summary: string | null;
  actionItems: { title: string; description: string }[];
  fullText: string;
}

export interface ExistingModule {
  id: string;
  name: string;
  description: string | null;
  approvedAt: string | null;
}

export interface ExistingStory {
  id: string;
  reference: string;
  title: string;
  refinementStatus: string;
  moduleId: string | null;
  proposedModuleName: string | null;
  designSessionId: string | null;
}

export interface ExistingPersona {
  id: string;
  name: string;
  description: string | null;
}
