// read_context_source — tool pro Vitor consumir anexos da DS (transcripts,
// docs, planilhas) sem cair em bash/grep no filesystem. ContextSource já
// é o SSOT pra esses materiais; aqui só expomos pra LLM com signed URL pra
// storage quando aplicável.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

export function createReadContextSourceTool(): Tool {
  return tool({
    description:
      "Le um ContextSource anexado (transcript de reuniao, doc subido pelo PM, planilha) por id. Retorna fullText quando disponivel, ou metadata + URL/storagePath. SEMPRE prefira esta tool a tentar bash/Read no filesystem pra acessar anexos — eles vivem no DB, nao em disco.",
    inputSchema: z.object({
      id: z.string().uuid(),
    }),
    execute: async ({ id }) => {
      const { data, error } = await db()
        .from("ContextSource")
        .select(
          "id, kind, title, summary, fullText, externalUrl, storagePath, payload, capturedAt, source, sourceId",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("context_source_not_found");

      // Se tem fullText longo, retorna ele direto (até 50k chars — pra não
      // estourar context). Acima disso, indica truncamento.
      if (data.fullText && data.fullText.length > 0) {
        const MAX = 50_000;
        const truncated = data.fullText.length > MAX;
        return {
          id: data.id,
          kind: data.kind,
          title: data.title,
          capturedAt: data.capturedAt,
          fullText: truncated ? data.fullText.slice(0, MAX) : data.fullText,
          truncated,
          totalLength: data.fullText.length,
        };
      }

      // Sem fullText: devolve metadata + ponteiros. Vitor decide se busca
      // a URL externa ou pede mais info.
      return {
        id: data.id,
        kind: data.kind,
        title: data.title,
        summary: data.summary,
        externalUrl: data.externalUrl,
        storagePath: data.storagePath,
        capturedAt: data.capturedAt,
        source: data.source,
        sourceId: data.sourceId,
        payload: data.payload,
        note: "Sem fullText extraido. Use externalUrl/summary ou peca ao PM pra reprocessar.",
      };
    },
  });
}
