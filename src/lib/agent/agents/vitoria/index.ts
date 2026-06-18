import { db } from "@/lib/db";
import { buildVitoriaPrompt } from "./prompt";
import { buildVitoriaTools } from "./tools";
import { buildProjectProfile } from "./profile";
import {
  loadPMReviewContext,
  buildPMReviewPrompt,
  buildPMReviewTools,
} from "./pm-review";
import {
  loadReleasePlanningContext,
  buildReleasePlanningPrompt,
  buildReleasePlanningTools,
} from "./release-planning";
import { getConnectionStatus, getUserTools } from "@/lib/composio/client";
import { getSprintOutcomes } from "@/lib/dal/sprint-outcomes";

/**
 * Slugs Composio v3 (confirmados via REST 2026-05-29). Cap em 4 tools:
 * read content (serve pra arquivo + diretório), search code, get repo meta,
 * list branches. Sem essas a Vitória só tem T1 (manifest no prompt).
 */
const VITORIA_GITHUB_TOOLS = [
  "GITHUB_GET_REPOSITORY_CONTENT",
  "GITHUB_SEARCH_CODE",
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_LIST_BRANCHES",
];
import type { AgentDefinition, AgentRunRequest } from "../../types";

/**
 * Vitoria — Copiloto de Rituais de Planning.
 * Lê insumos (reuniões/transcripts), extrai contexto e propõe ações no backlog.
 * Modelo: anthropic/claude-haiku-4-5 via OpenRouter (leve, rápido, econômico).
 */
export const vitoriaAgent: AgentDefinition = {
  name: "vitoria",
  model: "anthropic/claude-sonnet-4.6",

  async loadContext(req: AgentRunRequest) {
    // Dispatch por surface — Vitoria opera Planning E PM Review com mesma
    // identidade, contextos/prompts/tools diferentes.
    const surface = (req.params.surface as string | undefined) ?? "planning";
    if (surface === "pm_review") {
      const pmReviewId = req.params.pmReviewId as string;
      return loadPMReviewContext(pmReviewId, req.memberId ?? null, {
        audienceFloor: req.params.audienceFloor as "detail" | "executive" | undefined,
        emphasisSections: req.params.emphasisSections as string[] | undefined,
      });
    }
    if (surface === "release_planning") {
      const sessionId = req.params.sessionId as string;
      return loadReleasePlanningContext(sessionId, req.memberId ?? null);
    }

    const planningId = req.params.planningId as string;

    const { data: planning } = await db()
      .from("PlanningCeremony")
      .select(
        `
        id, phase, projectId, sprintId,
        project:Project(id, name, referenceKey, status, repoUrl, githubRepoOwner, githubRepoName, githubDefaultBranch, repoManifest, repoManifestUpdatedAt, client:Client(id, name)),
        sprint:Sprint(name),
        linkedMeetings:EntityLink!EntityLink_planningCeremonyId_fkey(
          meetingId,
          meeting:Meeting!EntityLink_meetingId_fkey(id, title, date)
        ),
        linkedTranscripts:EntityLink!EntityLink_planningCeremonyId_fkey(
          contextSourceId, weight,
          transcript:ContextSource!EntityLink_contextSourceId_fkey(id, title, source, capturedAt)
        ),
        notes:PlanningContextNote(id, kind, content, dismissedAt, priority)
        `,
      )
      .eq("id", planningId)
      .not("linkedMeetings.meetingId", "is", null)
      .not("linkedTranscripts.contextSourceId", "is", null)
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
    const [profile, projectMem, businessCtx, activeDecisions, openQuestions, activeSessions, sprintOutcomes] =
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
        // Sprint Outcome digest (D11): memória das últimas 3 sprints concluídas
        // — velocity, carryover e temas de retro pra dar continuidade semanal.
        // Degrada pra [] se a view falhar — enriquecimento, não pode derrubar o chat.
        getSprintOutcomes(planning.projectId, 3).catch(() => []),
      ]);

    const status: "open" | "closed" =
      planning.phase === "closed" || planning.phase === "archived" ? "closed" : "open";

    const projectRow = planning.project as
      | {
          id: string;
          name: string;
          referenceKey: string | null;
          status: string;
          repoUrl: string | null;
          githubRepoOwner: string | null;
          githubRepoName: string | null;
          githubDefaultBranch: string | null;
          repoManifest: string | null;
          repoManifestUpdatedAt: string | null;
          client: { id: string; name: string } | null;
        }
      | null;

    // Composio: detecta se o member que disparou o turno tem GitHub conectado.
    // Se sim, buildTools vai puxar as tools dele (custom — não vai no loadContext
    // pra não bloquear). Flag aqui só guia o prompt.
    let githubConnected = false;
    if (req.memberId) {
      const gh = await getConnectionStatus(req.memberId, "github");
      githubConnected = gh.status === "active";
    }

    return {
      planningId,
      phase: planning.phase,
      status,
      projectId: planning.projectId,
      projectName: projectRow?.name ?? null,
      projectReferenceKey: projectRow?.referenceKey ?? null,
      projectStatus: projectRow?.status ?? null,
      projectRepoUrl: projectRow?.repoUrl ?? null,
      projectRepoOwner: projectRow?.githubRepoOwner ?? null,
      projectRepoName: projectRow?.githubRepoName ?? null,
      projectRepoBranch: projectRow?.githubDefaultBranch ?? null,
      projectRepoManifest: projectRow?.repoManifest ?? null,
      projectRepoManifestUpdatedAt: projectRow?.repoManifestUpdatedAt ?? null,
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
      sprintOutcomes,
      githubConnected,
    };
  },

  buildPrompt(ctx) {
    const surface = (ctx.agentContext as { surface?: string }).surface;
    if (surface === "pm_review") {
      return buildPMReviewPrompt(ctx);
    }
    if (surface === "release_planning") {
      return buildReleasePlanningPrompt(ctx);
    }
    return buildVitoriaPrompt(ctx);
  },

  async buildTools({ agentContext }) {
    const surface = (agentContext.surface as string | undefined) ?? "planning";
    const projectId = agentContext.projectId as string;
    const memberId = agentContext.memberId as string | null;

    if (surface === "pm_review") {
      const pmReviewId = agentContext.pmReviewId as string;
      // PM Review NÃO usa Composio/GitHub tools (manifest do projeto está no
      // prompt; indicadores via get_project_indicators). Mantém prompt enxuto.
      return buildPMReviewTools(pmReviewId, projectId);
    }

    if (surface === "release_planning") {
      const sessionId = agentContext.sessionId as string;
      return await buildReleasePlanningTools(sessionId, projectId, memberId);
    }

    const planningId = agentContext.planningId as string;
    const githubConnected = Boolean(agentContext.githubConnected);

    const nativeTools = buildVitoriaTools(planningId, projectId);

    // Carrega tools do GitHub via Composio se o member tem conexão ativa.
    // Cap em 4 tools (VITORIA_GITHUB_TOOLS) pra Vitória ter precisão sem
    // estourar contexto — sem isso a SDK manda todas as 823 tools do GitHub.
    if (githubConnected && memberId) {
      const composioTools = await getUserTools(memberId, ["github"], {
        toolSlugs: VITORIA_GITHUB_TOOLS,
      });
      return { ...nativeTools, ...composioTools };
    }

    return nativeTools;
  },
};
