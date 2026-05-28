import { db } from "@/lib/db";
import { buildVitoriaPrompt } from "./prompt";
import { buildVitoriaTools } from "./tools";
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

    // Conta ações pendentes pra Vitoria saber se tem algo pra revisar
    const { count: pendingActionCount } = await db()
      .from("MeetingTaskAction")
      .select("id", { count: "exact", head: true })
      .eq("planningCeremonyId", planningId)
      .eq("decision", "pending");

    return {
      planningId,
      phase: planning.phase,
      projectId: planning.projectId,
      sprintId: planning.sprintId,
      sprintName: (planning.sprint as { name: string } | null)?.name ?? null,
      linkedMeetings: planning.linkedMeetings ?? [],
      linkedTranscripts: planning.linkedTranscripts ?? [],
      activeNotes,
      pendingActionCount: pendingActionCount ?? 0,
      memberId: req.memberId ?? null,
    };
  },

  buildPrompt(ctx) {
    return buildVitoriaPrompt(ctx);
  },

  buildTools({ agentContext }) {
    const planningId = agentContext.planningId as string;
    return buildVitoriaTools(planningId);
  },
};
