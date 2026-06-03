import { tool, type ToolSet } from "ai";
import { buildSystemPrompt } from "../../prompt";
import { assembleTools } from "../../tools";
import {
  buildSessionContext,
  type SessionContextVerbosity,
} from "../../context";
import { db } from "@/lib/db";
import {
  getModulesForProject,
  getPersonasForProject,
  getRecentStoriesForProject,
} from "@/lib/dal/story-hierarchy";
import { listSessionTranscripts } from "@/lib/dal/design-session-transcripts";
import {
  BRIEFING_SUB_PHASES,
  DEFAULT_BRIEFING_SUB_PHASE,
} from "@/lib/design-sessions/constants";
import { getStepsForSession } from "@/lib/design-session-steps";
import {
  createPrd,
  getPrdById,
  updatePrd,
  approvePrd,
  getPrdsForProject,
} from "@/lib/dal/product-requirements";
import {
  ProposePrdInput,
  UpdatePrdInput,
  ApprovePrdInput,
  LinkPrdDependencyInput,
} from "./prd-schemas";
import { z } from "zod";
import type { AgentDefinition, AgentRunRequest } from "../../types";
import { buildVitorTools } from "./tools";

function pickVerbosity(
  currentStepKey: string,
  subPhase: string | undefined,
  sessionType: string,
  selectedSteps: string[] | null,
): SessionContextVerbosity {
  if (currentStepKey === "briefing") {
    const phase = subPhase ?? DEFAULT_BRIEFING_SUB_PHASE;
    switch (phase) {
      case BRIEFING_SUB_PHASES.MODULE_DISCOVERY:
        return "discovery";
      case BRIEFING_SUB_PHASES.PRD_DRAFTING:
        return "refinement";
      case BRIEFING_SUB_PHASES.PRD_REVIEW:
        return "execution";
      default:
        // Fallback para DSs antigas com valores legacy (story_tree, story_detail, task_breakdown)
        return "discovery";
    }
  }
  if (currentStepKey === "brainstorm" || currentStepKey === "prioritization") {
    return "full";
  }

  // F3 — steps pos-brainstorm renderizam brainstorm/prioritization compact.
  // Guard de selectedSteps: sessoes "super" podem nao ter brainstorm; nesse
  // caso mantem comportamento atual ("full").
  const steps = getStepsForSession({ type: sessionType, selectedSteps });
  const order = steps.map((s) => s.key);
  const brainstormIndex = order.indexOf("brainstorm");
  if (brainstormIndex === -1) return "full";

  const currentIndex = order.indexOf(currentStepKey);
  if (currentIndex > brainstormIndex) return "compact-vision";
  return "full";
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
      .select(
        "title, type, projectId, selectedSteps, briefingSubPhase, briefingTargetStoryId",
      )
      .eq("id", sessionId)
      .single();

    if (!session) throw new Error("Session not found");

    const isBriefing = currentStepKey === "briefing";

    // briefingSubPhase agora vive em coluna escalar de DesignSession (não mais em step_data JSON).
    const briefingSubPhase =
      (session as { briefingSubPhase?: string | null }).briefingSubPhase ?? null;
    const briefingTargetStoryId =
      (session as { briefingTargetStoryId?: string | null }).briefingTargetStoryId ?? null;
    const sessionSelectedSteps =
      (session as { selectedSteps?: string[] | null }).selectedSteps ?? null;
    const verbosity = pickVerbosity(
      currentStepKey,
      briefingSubPhase ?? undefined,
      session.type,
      sessionSelectedSteps,
    );

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
      // Vitor olha TODAS as design sessions ativas do projeto (não-draft,
      // não-completed) — não só as 10 últimas. Memória cross-session só vale
      // se ele enxerga o panorama inteiro do que está em andamento.
      // Sessions arquivadas/encerradas ficam no histórico via Project.memoryMd.
      db()
        .from("DesignSession")
        .select("id, title, type, status, memoryAbstract, updatedAt")
        .eq("projectId", session.projectId)
        .neq("id", sessionId)
        .in("status", ["active", "in_progress"])
        .order("updatedAt", { ascending: false }),
      listSessionTranscripts(db(), sessionId).then((items) => ({
        data: items.map((t) => ({
          id: t.transcriptRefId,
          meetingTitle: t.meetingTitle ?? "Sem título",
          meetingStart: t.meetingStart ?? "",
          meetingEnd: t.meetingEnd ?? t.meetingStart ?? "",
          participants: t.participants,
          summary: t.summary,
          actionItems: t.actionItems,
        })),
      })),
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
      briefingSubPhase,
      briefingTargetStoryId,
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
      briefingSubPhase: agentContext.briefingSubPhase as string | null,
      briefingTargetStoryId: agentContext.briefingTargetStoryId as string | null,
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
    const sessionId = agentContext.sessionId as string;
    const projectId =
      (agentContext.projectId as string) ?? capabilities.projectId;
    const memberId =
      (agentContext.memberId as string | undefined) ?? capabilities.memberId;

    const baseTools = assembleTools(sessionId, {
      ...capabilities,
      projectId,
      memberId,
      vitorAsPm: true,
    });

    // CTXIMP-008: adicionar tools Vitor-específicas (read_transcript_content)
    const vitorSpecificTools = buildVitorTools();

    if (!projectId) {
      return { ...baseTools, ...vitorSpecificTools };
    }

    const prdTools: ToolSet = {
      propose_prd: tool({
        description:
          "Propoe um OU MAIS PRDs num unico call via `prds: [...]`. Passe TODOS os PRDs do scaffold de uma vez (NAO faca um call por PRD — isso para no meio). Cada PRD requer problem (>=50 chars), goal (>=20 chars), >=3 acceptance criteria E `stories` (§16): >=1 story implementavel, cada uma com >=1 `verifiable` automatizavel (typecheck/sql/http/lint — NAO use manual_browser como unico check), estimateMinutes <=30, `dependsOn` (DAG) e `agentProfile` (db/api/ui/wiring/test/doc). Sem stories validas o PRD nao roda na Forja. Retorna { created: [{id, reference, title, status, storiesCount}] }.",
        inputSchema: z.object({
          prds: z
            .array(
              ProposePrdInput.omit({
                projectId: true,
                designSessionId: true,
              }),
            )
            .min(1),
        }),
        execute: async ({ prds }) => {
          const created: Array<{
            id: string;
            reference: string;
            title: string;
            status: string;
            storiesCount: number;
          }> = [];
          for (const args of prds) {
            const row = await createPrd({
              projectId,
              designSessionId: sessionId,
              moduleId: args.moduleId ?? null,
              title: args.title,
              oneLiner: args.oneLiner,
              personaIds: args.personaIds,
              problem: args.problem,
              goal: args.goal,
              userJourney: args.userJourney,
              acceptanceCriteria: args.acceptanceCriteria,
              successMetrics: args.successMetrics,
              outOfScope: args.outOfScope,
              technicalNotes: args.technicalNotes,
              risksAndAssumptions: args.risksAndAssumptions,
              sourceCardIds: args.sourceCardIds,
              // §16 — stories implementáveis (Forge executa por-story c/ verifiable).
              stories: args.stories as never,
              actorAgent: "vitor",
              actorMemberId: memberId ?? null,
            });
            created.push({
              id: row.id,
              reference: row.reference,
              title: row.title,
              status: row.status,
              storiesCount: args.stories.length,
            });
          }
          return { created };
        },
      }),

      update_prd: tool({
        description:
          "Edita um PRD draft/review. Nao pode editar PRD approved (proponha uma nova versao ou peca pra mover pra review primeiro).",
        inputSchema: UpdatePrdInput.omit({
          projectId: true,
          designSessionId: true,
        }),
        execute: async ({ id, ...patch }) => {
          const current = await getPrdById(id);
          if (!current) throw new Error("PRD not found");
          if (current.status === "approved") {
            throw new Error("PRD approved — use uma nova versao");
          }
          const row = await updatePrd(id, patch, {
            actorAgent: "vitor",
            actorMemberId: memberId ?? null,
          });
          return { id: row.id, version: row.version, status: row.status };
        },
      }),

      approve_prd: tool({
        description:
          "Aprova um PRD (status=approved). Valida que o PRD tem problem/goal/AC suficientes. Apos aprovacao, Vitoria pode materializar em Tasks.",
        inputSchema: ApprovePrdInput,
        execute: async ({ id }) => {
          if (!memberId) throw new Error("approve_prd requires memberId");
          const row = await approvePrd(id, { actorMemberId: memberId });
          return { id: row.id, status: row.status, approvedAt: row.approvedAt };
        },
      }),

      link_prd_dependency: tool({
        description:
          "Liga dois PRDs por uma dependencia (blocks/enables/shares-data). Edita o array dependencies do fromPrdId.",
        inputSchema: LinkPrdDependencyInput,
        execute: async ({ fromPrdId, toPrdId, kind }) => {
          const from = await getPrdById(fromPrdId);
          if (!from) throw new Error("fromPrd not found");
          const existing = Array.isArray(from.dependencies)
            ? (from.dependencies as Array<{ prdId: string; kind: string }>)
            : [];
          const deps = [...existing, { prdId: toPrdId, kind }];
          await updatePrd(
            fromPrdId,
            { dependencies: deps },
            { actorAgent: "vitor", actorMemberId: memberId ?? null },
          );
          return { ok: true };
        },
      }),

      list_prds: tool({
        description:
          "Lista PRDs do projeto. Opcional filtro por status. Use pra checar o que ja foi criado antes de duplicar.",
        inputSchema: z.object({
          status: z
            .array(z.enum(["draft", "review", "approved", "superseded"]))
            .optional(),
        }),
        execute: async ({ status }) => {
          const rows = await getPrdsForProject(projectId, { status });
          return rows.map((r) => ({
            id: r.id,
            reference: r.reference,
            title: r.title,
            status: r.status,
            moduleId: r.moduleId,
          }));
        },
      }),
    };

    return { ...baseTools, ...vitorSpecificTools, ...prdTools };
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
