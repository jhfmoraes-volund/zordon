import { db } from "@/lib/db";
import { buildVitoriaPrompt } from "./prompt";
import { buildVitoriaTools } from "./tools";
import { buildProjectProfile } from "./profile";
import type { AgentDefinition, AgentRunRequest } from "../../types";

/**
 * Vitoria — Copiloto de Rituais de Planning.
 * Lê insumos (reuniões/transcripts), extrai contexto e propõe ações no backlog.
 * Modelo: anthropic/claude-haiku-4-5 via OpenRouter (leve, rápido, econômico).
 */
export const vitoriaAgent: AgentDefinition = {
  name: "vitoria",
  model: "anthropic/claude-haiku-4-5",

  async loadContext(req: AgentRunRequest) {
    const planningId = req.params.planningId as string;

    const { data: planning } = await db()
      .from("PlanningCeremony")
      .select(
        `
        id, phase, projectId, sprintId,
        project:Project(id, name, referenceKey, status, client:Client(id, name)),
        sprint:Sprint(name),
        linkedMeetings:PlanningMeetingLink(
          meetingId,
          meeting:Meeting(id, title, date)
        ),
        linkedTranscripts:PlanningTranscriptLink(
          transcriptRefId, weight,
          transcript:TranscriptRef(id, title, source, capturedAt)
        ),
        notes:PlanningContextNote(id, kind, content, dismissedAt, priority)
        `,
      )
      .eq("id", planningId)
      .single();

    if (!planning) throw new Error(`Planning ${planningId} não encontrada`);

    const activeNotes = (planning.notes as Array<{ id: string; kind: string; content: string; dismissedAt: string | null; priority: number }>)
      .filter((n) => !n.dismissedAt)
      .sort((a, b) => b.priority - a.priority);

    // Propostas pendentes — Vitoria precisa do payload completo pra responder
    // "edita a proposta X" / "remove a proposta Y" sem adivinhar ID.
    const { data: pendingRows } = await db()
      .from("MeetingTaskAction")
      .select("id, type, taskId, targetSprintId, payload, aiReasoning, aiConfidence, createdAt")
      .eq("planningCeremonyId", planningId)
      .eq("decision", "pending")
      .eq("execution", "pending")
      .order("createdAt", { ascending: true });

    const pendingActions = (pendingRows ?? []).map((r) => ({
      id: r.id,
      type: r.type,
      taskId: r.taskId,
      targetSprintId: r.targetSprintId,
      payload: r.payload,
      aiReasoning: r.aiReasoning,
      aiConfidence: r.aiConfidence,
    }));

    // Project profile (core + sprintScope): cacheado in-memory 5min.
    // Substitui a query pontual de sprintTasks anterior.
    // Memória do projeto curada pelo Vitor (Design Session agent) — Vitoria lê
    // o mesmo Project.memoryMd / ProjectBusinessContext / DesignDecision /
    // DesignOpenQuestion / Active DesignSessions pra ter contexto cross-agent
    // sem precisar conversar com o Vitor.
    const [profile, projectMem, businessCtx, activeDecisions, openQuestions, activeSessions] =
      await Promise.all([
        buildProjectProfile(planning.projectId, { currentSprintId: planning.sprintId }),
        db()
          .from("Project")
          .select("memoryMd, memoryVersion, memoryUpdatedAt")
          .eq("id", planning.projectId)
          .single(),
        db()
          .from("ProjectBusinessContext")
          .select("businessModel, stage, icp, ticketRangeBrl, runwayMonths, competitors, updatedAt")
          .eq("projectId", planning.projectId)
          .maybeSingle(),
        db()
          .from("DesignDecision")
          .select("id, statement, rationale, confidence, tags, createdAt")
          .eq("projectId", planning.projectId)
          .eq("status", "active")
          .order("createdAt", { ascending: false }),
        db()
          .from("DesignOpenQuestion")
          .select("id, question, blocksWhat, sessionId, createdAt")
          .eq("projectId", planning.projectId)
          .eq("status", "open")
          .order("createdAt", { ascending: false }),
        db()
          .from("DesignSession")
          .select("id, title, type, status, memoryAbstract, updatedAt")
          .eq("projectId", planning.projectId)
          .in("status", ["active", "in_progress"])
          .order("updatedAt", { ascending: false }),
      ]);

    const status: "open" | "closed" =
      planning.phase === "closed" || planning.phase === "archived" ? "closed" : "open";

    const projectRow = planning.project as
      | { id: string; name: string; referenceKey: string | null; status: string; client: { id: string; name: string } | null }
      | null;

    return {
      planningId,
      phase: planning.phase,
      status,
      projectId: planning.projectId,
      projectName: projectRow?.name ?? null,
      projectReferenceKey: projectRow?.referenceKey ?? null,
      projectStatus: projectRow?.status ?? null,
      clientName: projectRow?.client?.name ?? null,
      sprintId: planning.sprintId,
      sprintName: (planning.sprint as { name: string } | null)?.name ?? null,
      linkedMeetings: planning.linkedMeetings ?? [],
      linkedTranscripts: planning.linkedTranscripts ?? [],
      activeNotes,
      pendingActions,
      upcomingSprints: profile.core.upcomingSprints,
      activeStories: profile.core.activeStories,
      squadMembers: profile.core.squadMembers,
      sprintScopeTasks: profile.sprintScope?.tasks ?? [],
      sprintBlockers: profile.sprintScope?.blockers ?? [],
      memberId: req.memberId ?? null,
      projectMemoryMd: projectMem.data?.memoryMd ?? null,
      projectMemoryVersion: projectMem.data?.memoryVersion ?? 0,
      businessContext: businessCtx.data ?? null,
      activeDecisions: activeDecisions.data ?? [],
      openQuestions: openQuestions.data ?? [],
      activeDesignSessions: activeSessions.data ?? [],
    };
  },

  buildPrompt(ctx) {
    return buildVitoriaPrompt(ctx);
  },

  buildTools({ agentContext }) {
    const planningId = agentContext.planningId as string;
    const projectId = agentContext.projectId as string;
    return buildVitoriaTools(planningId, projectId);
  },
};
