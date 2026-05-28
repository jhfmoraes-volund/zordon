import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  addContextNote,
  updatePlanningPhase,
  getPlanningPhaseContext,
} from "@/lib/dal/planning";
import { transition } from "@/lib/planning/phase";
import type { Json } from "@/lib/supabase/database.types";

export function buildVitoriaTools(planningId: string) {
  return {
    add_context_note: tool({
      description:
        "Adiciona uma nota de contexto ao briefing da planning. Use para registrar temas, riscos, sinais de capacidade, observações de código ou questões extraídas das transcrições.",
      inputSchema: z.object({
        kind: z
          .enum(["summary", "theme", "risk", "capacity_signal", "code_observation", "open_question"])
          .describe("Tipo da nota"),
        content: z
          .string()
          .min(10)
          .describe("Conteúdo da nota. Seja específico e conciso."),
        sourceMeetingIds: z
          .array(z.string())
          .optional()
          .describe("IDs de reuniões que embasam esta nota"),
        sourceTranscriptIds: z
          .array(z.string())
          .optional()
          .describe("IDs de TranscriptRef que embasam esta nota"),
        priority: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Prioridade 0-10. Default 5."),
      }),
      execute: async ({ kind, content, sourceMeetingIds, sourceTranscriptIds, priority }) => {
        const note = await addContextNote({
          planningCeremonyId: planningId,
          kind,
          content,
          sourceMeetingIds: sourceMeetingIds ?? [],
          sourceTranscriptIds: sourceTranscriptIds ?? [],
          priority: priority ?? 5,
          generatedByAgent: "alpha", // Vitoria usa "alpha" como actor até ter entrada própria no DB
        });
        return { ok: true, noteId: note.id, kind: note.kind };
      },
    }),

    propose_task_action: tool({
      description:
        "Cria uma proposta de ação no backlog (MeetingTaskAction) para aprovação do PM. Use para propor criar, atualizar, mover ou excluir tasks com base no contexto.",
      inputSchema: z.object({
        projectId: z.string().describe("ID do projeto"),
        type: z
          .enum(["create", "update", "delete", "move"])
          .describe("Tipo de ação"),
        taskId: z
          .string()
          .optional()
          .describe("ID da task alvo (omita em create)"),
        targetSprintId: z
          .string()
          .optional()
          .describe("Sprint destino para ações move"),
        payload: z
          .record(z.string(), z.unknown())
          .describe(
            "Dados: create={ title, description?, type?, scope?, priority? }, update=campos a alterar, move/delete={}",
          ),
        aiReasoning: z
          .string()
          .describe("Explicação de POR QUÊ esta ação é proposta. O PM lê para decidir."),
        aiConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Confiança 0-1. Default 0.8."),
        sourceNoteIds: z
          .array(z.string())
          .optional()
          .describe("IDs de notas que embasam esta proposta"),
      }),
      execute: async ({
        projectId,
        type,
        taskId,
        targetSprintId,
        payload,
        aiReasoning,
        aiConfidence,
        sourceNoteIds,
      }) => {
        const { data, error } = await db()
          .from("MeetingTaskAction")
          .insert({
            planningCeremonyId: planningId,
            projectId,
            type,
            taskId: taskId ?? null,
            targetSprintId: targetSprintId ?? null,
            payload: payload as Json,
            aiReasoning,
            aiConfidence: aiConfidence ?? 0.8,
            sourceNoteIds: (sourceNoteIds ?? []) as unknown as string[],
            decision: "pending",
            execution: "pending",
            source: "ai",
            notes: null,
          })
          .select("id, type, decision")
          .single();

        if (error) throw new Error(`Falha ao criar proposta: ${error.message}`);
        return { ok: true, actionId: data.id, type: data.type };
      },
    }),

    transition_phase: tool({
      description:
        "Transiciona a planning para 'proposing' depois que todas as notas estiverem prontas. Requer ≥1 nota kind=summary e ≥3 outras notas.",
      inputSchema: z.object({
        summary: z
          .string()
          .describe("Texto do resumo do briefing (salvo como nota kind=summary antes da transição)."),
      }),
      execute: async ({ summary }) => {
        await addContextNote({
          planningCeremonyId: planningId,
          kind: "summary",
          content: summary,
          generatedByAgent: "alpha",
        });

        const ctx = await getPlanningPhaseContext(planningId);

        const { data: row } = await db()
          .from("PlanningCeremony")
          .select("phase")
          .eq("id", planningId)
          .single();

        const current = row?.phase ?? "reading";
        const result = transition(current, "proposing", ctx, "vitoria");

        if (!result.ok) {
          return { ok: false, reason: result.reason, detail: result.detail };
        }

        await updatePlanningPhase(planningId, result.to, result.stamps);
        return { ok: true, from: current, to: result.to };
      },
    }),

    read_transcript_content: tool({
      description:
        "Lê o conteúdo de um transcript linkado. Use para extrair insights detalhados antes de criar notas.",
      inputSchema: z.object({
        transcriptRefId: z.string().describe("ID do TranscriptRef"),
      }),
      execute: async ({ transcriptRefId }) => {
        const { data: ref } = await db()
          .from("TranscriptRef")
          .select("id, title, source, sourceId, capturedAt, meetingId, fullText")
          .eq("id", transcriptRefId)
          .single();

        if (!ref) return { ok: false, error: "TranscriptRef não encontrado" };

        if (ref.fullText) {
          return {
            ok: true,
            id: ref.id,
            title: ref.title,
            capturedAt: ref.capturedAt,
            content: ref.fullText,
          };
        }

        if (ref.meetingId) {
          const { data: meeting } = await db()
            .from("Meeting")
            .select("id, title, date, notes, transcript")
            .eq("id", ref.meetingId)
            .single();
          if (meeting) {
            return {
              ok: true,
              id: ref.id,
              title: ref.title ?? meeting.title,
              capturedAt: ref.capturedAt,
              content: meeting.transcript ?? meeting.notes ?? "(sem conteúdo)",
            };
          }
        }

        return {
          ok: true,
          id: ref.id,
          title: ref.title,
          capturedAt: ref.capturedAt,
          content: "(conteúdo não disponível — só metadados)",
        };
      },
    }),
  };
}
