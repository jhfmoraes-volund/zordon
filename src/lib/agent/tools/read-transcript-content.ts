import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Factory de tool read_transcript_content — compartilhada entre Vitoria e Vitor.
 * Lê o fullText de um TranscriptRef linkado. Fallback pra Meeting.notes se
 * fullText não existe.
 */
export function createReadTranscriptContentTool() {
  return tool({
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
        // Sem fullText no TranscriptRef → cai pra notas do Meeting.
        // (Meeting.transcript foi droppado; fullText vive só em TranscriptRef.)
        const { data: meeting } = await db()
          .from("Meeting")
          .select("id, title, date, notes")
          .eq("id", ref.meetingId)
          .single();
        if (meeting) {
          return {
            ok: true,
            id: ref.id,
            title: ref.title ?? meeting.title,
            capturedAt: ref.capturedAt,
            content: meeting.notes ?? "(sem conteúdo)",
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
  });
}
