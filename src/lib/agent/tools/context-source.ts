// read_context_source — tool pro Vitor consumir anexos da DS (transcripts,
// docs, planilhas) sem cair em bash/grep no filesystem. ContextSource já
// é o SSOT pra esses materiais; aqui só expomos pra LLM com signed URL pra
// storage quando aplicável.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

export function createReadContextSourceTool(
  /** Para self-correcting errors — quando id não casar, listamos os IDs
   *  realmente linkados ao escopo atual (DS ou PM Review). */
  scope?: {
    sessionId?: string | null;
    pmReviewId?: string | null;
  },
): Tool {
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
      if (!data) {
        // Self-correcting: lista IDs realmente linkados ao escopo atual
        // pra LLM tentar de novo com o certo (em vez de pedir ao user).
        const available = await listAvailableInScope(scope);
        const list =
          available.length > 0
            ? `\n\nIDs disponíveis neste contexto:\n${available
                .map((a) => `- ${a.id} · [${a.kind}] ${a.title}`)
                .join("\n")}`
            : "\n\nNenhum ContextSource linkado a este escopo. Não invente — diga ao user que não tem anexo.";
        throw new Error(`context_source_not_found (id=${id}).${list}`);
      }

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

async function listAvailableInScope(scope?: {
  sessionId?: string | null;
  pmReviewId?: string | null;
}): Promise<Array<{ id: string; kind: string; title: string }>> {
  if (!scope || (!scope.sessionId && !scope.pmReviewId)) return [];
  const supabase = db();
  const query = supabase
    .from("EntityLink")
    .select(
      `ContextSource:ContextSource!EntityLink_contextSourceId_fkey(id, kind, title)`,
    )
    .not("contextSourceId", "is", null)
    .limit(20);
  if (scope.sessionId) query.eq("designSessionId", scope.sessionId);
  if (scope.pmReviewId) query.eq("pmReviewId", scope.pmReviewId);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? [])
    .map((link) => link.ContextSource as { id: string; kind: string; title: string } | null)
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
