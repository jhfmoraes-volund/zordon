// read_context_source — tool pro Vitor consumir anexos da DS (transcripts,
// docs, planilhas) sem cair em bash/grep no filesystem. ContextSource já
// é o SSOT pra esses materiais; aqui só expomos pra LLM com signed URL pra
// storage quando aplicável.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Database } from "@/lib/supabase/database.types";
import { detectStructuredFormat } from "./structured-detect";

/** Escopo do ritual atual → colunas de EntityLink. Usado pra resolver os
 *  insumos que o PM curou (linked) em cada surface. */
export type ContextSourceScope = {
  sessionId?: string | null;
  pmReviewId?: string | null;
  planningId?: string | null; // EntityLink.planningCeremonyId
  releasePlanningId?: string | null; // EntityLink.planningSessionId
};

export function createReadContextSourceTool(
  /** Para self-correcting errors — quando id não casar, listamos os IDs
   *  realmente linkados ao escopo atual (DS / PM Review / Planning). */
  scope?: ContextSourceScope,
): Tool {
  return tool({
    description:
      "Le um ContextSource anexado (transcript de reuniao, doc subido pelo PM, planilha) por id, em JANELA (chunk). Retorna fullText paginado quando disponivel, ou metadata + URL/storagePath. Pagine com offset: comece em 0; enquanto hasMore=true, chame de novo com offset=nextOffset ate hasMore=false. SEMPRE prefira esta tool a tentar bash/Read no filesystem pra acessar anexos — eles vivem no DB, nao em disco.",
    inputSchema: z.object({
      id: z.string().uuid(),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Caractere inicial da janela (default 0). Pagine com o nextOffset retornado até hasMore=false.",
        ),
    }),
    execute: async ({ id, offset }) => {
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
        const available = await listLinkedSources(scope);
        const list =
          available.length > 0
            ? `\n\nIDs disponíveis neste contexto:\n${available
                .map((a) => `- ${a.id} · [${a.kind}] ${a.title}`)
                .join("\n")}`
            : "\n\nNenhum ContextSource linkado a este escopo. Não invente — diga ao user que não tem anexo.";
        throw new Error(`context_source_not_found (id=${id}).${list}`);
      }

      if (data.fullText && data.fullText.length > 0) {
        const totalLength = data.fullText.length;

        // D10 (roteamento): fonte ESTRUTURADA grande não devolve o blob —
        // truncar/paginar JSON/CSV é inútil e queima o turno. Devolve um stub
        // apontando pras structured tools (describe/query_structured_source),
        // que consultam via SQL sem inlinar o conteúdo. Runbook §6/§9.
        const STRUCTURED_INLINE_MAX = 50_000;
        if (totalLength > STRUCTURED_INLINE_MAX) {
          const format = detectStructuredFormat(data);
          if (format) {
            return {
              id: data.id,
              kind: data.kind,
              title: data.title,
              capturedAt: data.capturedAt,
              structured: true,
              format,
              totalLength,
              note:
                `Fonte ESTRUTURADA (${format.toUpperCase()}, ${totalLength.toLocaleString("pt-BR")} chars) — ` +
                `grande demais pra ler inteira. Use describe_structured_source(sourceId='${data.id}') ` +
                `pro shape (colunas/tipos/contagem), depois query_structured_source pra consultar via SQL. ` +
                `NÃO tente ler o blob — ancore decisões em agregados.`,
            };
          }
        }

        // Texto não-estruturado: JANELA por offset. O daemon roda só tools MCP
        // (Read nativo disallowed) e o SDK derrama resultado > ~25k chars pra um
        // arquivo em disco — inacessível. Janela de 18k + paginação lê 100% em
        // pedaços (mesma mecânica do read_transcript_content). Runbook §4.
        const WINDOW = 18_000;
        const start = Math.min(Math.max(offset ?? 0, 0), totalLength);
        const slice = data.fullText.slice(start, start + WINDOW);
        const nextOffset = start + slice.length;
        const hasMore = nextOffset < totalLength;
        return {
          id: data.id,
          kind: data.kind,
          title: data.title,
          capturedAt: data.capturedAt,
          fullText: slice,
          offset: start,
          returnedChars: slice.length,
          totalLength,
          hasMore,
          nextOffset: hasMore ? nextOffset : null,
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

/**
 * list_context_sources — lista o pool de insumos do projeto (ContextSource por
 * projectId). Project-scoped: só precisa de projectId, então serve qualquer
 * surface da Vitoria (PM Review / Planning / Release Planning).
 *
 * Por que existe como TOOL (e não só no system prompt): o bloco "Fontes de
 * contexto linkadas" do prompt é um SNAPSHOT do início da conversa — em resume
 * a sessão Claude congela o prompt no 1º turn (ver zordon-daemon
 * exec-chat-turn.ts). Insumo anexado no meio do chat nunca aparece lá. Esta
 * tool re-consulta o pool ao vivo, fechando o buraco de descoberta.
 */
export function createListContextSourcesTool(
  projectId: string,
  /** Ritual atual — pra marcar `linked` (true = o PM curou este insumo neste
   *  ritual via aba INSUMOS). Sem scope, todos voltam linked=false. */
  scope?: ContextSourceScope,
): Tool {
  return tool({
    description:
      "Lista o pool de insumos do projeto (transcripts, docs, planilhas, " +
      "Notion, Drive, GitHub) com id, kind, título, resumo e `linked`. Use pra " +
      "DESCOBRIR insumos — inclusive os anexados DEPOIS que a conversa começou " +
      "(o bloco 'Fontes de contexto linkadas' do seu contexto é snapshot do " +
      "início e não atualiza no meio do chat). `linked: true` = o PM curou este " +
      "insumo NESTE ritual (aba INSUMOS) — PRIORIZE esses; os demais são só do " +
      "pool do projeto. NÃO traz o design system (referência de UI, não é " +
      "insumo). Pegue o id e leia com read_context_source; nunca diga que não " +
      "achou sem antes rodar esta tool.",
    inputSchema: z.object({
      kind: z
        .string()
        .optional()
        .describe("Filtra por kind (ex: transcript, document, notion, gdrive_file)"),
    }),
    execute: async ({ kind }) => {
      let q = db()
        .from("ContextSource")
        .select("id, kind, title, source, capturedAt, summary")
        .eq("projectId", projectId)
        // design_system é referência de UI (settings do projeto), nunca insumo
        // de PM Review/Planning — fora da descoberta pra não virar decoy.
        .neq("kind", "design_system")
        .order("capturedAt", { ascending: false, nullsFirst: false })
        .limit(50);
      if (kind) {
        q = q.eq(
          "kind",
          kind as Database["public"]["Enums"]["context_source_kind"],
        );
      }
      const { data, error } = await q;
      if (error) return { ok: false, error: error.message };

      // Marca quais já estão linkados ao ritual atual (curados pelo PM).
      const linked = await listLinkedSources(scope);
      const linkedIds = new Set(linked.map((l) => l.id));
      const sources = (data ?? []).map((s) => ({
        ...s,
        linked: linkedIds.has(s.id),
      }));
      return { ok: true, sources };
    },
  });
}

type LinkedSource = {
  id: string;
  kind: string;
  title: string;
  capturedAt: string | null;
};

/**
 * Insumos LINKADOS ao ritual atual (EntityLink → ContextSource), por surface:
 * DS→designSessionId, PM Review→pmReviewId, Planning→planningCeremonyId,
 * Release Planning→planningSessionId. É exatamente o que a aba INSUMOS mostra.
 * Fonte única tanto da tool `list_linked_sources` quanto do self-correct do
 * `read_context_source`.
 */
async function listLinkedSources(
  scope?: ContextSourceScope,
): Promise<LinkedSource[]> {
  if (
    !scope ||
    (!scope.sessionId &&
      !scope.pmReviewId &&
      !scope.planningId &&
      !scope.releasePlanningId)
  )
    return [];
  const supabase = db();
  const query = supabase
    .from("EntityLink")
    .select(
      `ContextSource:ContextSource!EntityLink_contextSourceId_fkey(id, kind, title, capturedAt)`,
    )
    .not("contextSourceId", "is", null)
    .limit(50);
  if (scope.sessionId) query.eq("designSessionId", scope.sessionId);
  if (scope.pmReviewId) query.eq("pmReviewId", scope.pmReviewId);
  if (scope.planningId) query.eq("planningCeremonyId", scope.planningId);
  if (scope.releasePlanningId)
    query.eq("planningSessionId", scope.releasePlanningId);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? [])
    .map((link) => link.ContextSource as LinkedSource | null)
    .filter((x): x is LinkedSource => x !== null);
}

/**
 * list_linked_sources — lista SÓ os insumos linkados ao ritual atual (a aba
 * INSUMOS). É a fonte ESTRITA de insumos do PM Review: não expõe o pool aberto
 * do projeto, só o que o PM curou pra ESTA análise. Resolve o freeze do prompt
 * em resume (o bloco de fontes é snapshot do 1º turn) sem vazar fontes que o PM
 * não escolheu — contraste com createListContextSourcesTool (pool, p/ curadoria
 * em Release Planning).
 */
export function createListLinkedSourcesTool(scope: ContextSourceScope): Tool {
  return tool({
    description:
      "Lista os insumos LINKADOS a este ritual — exatamente o que está na aba " +
      "INSUMOS (transcripts, docs, reuniões que o PM curou pra ESTA análise). " +
      "É a sua ÚNICA fonte de insumos: você NÃO vê o pool aberto do projeto, só " +
      "o que foi explicitamente linkado. Atualiza ao vivo (o bloco 'Fontes de " +
      "contexto linkadas' do seu contexto é snapshot do 1º turn). Pegue o id e " +
      "leia: transcript → read_transcript_content; doc/planilha → " +
      "read_context_source. Se vier vazio, NÃO há insumo linkado — avise o PM " +
      "(não saia procurando no pool nem invente).",
    inputSchema: z.object({}),
    execute: async () => {
      const sources = await listLinkedSources(scope);
      return { ok: true, sources };
    },
  });
}
