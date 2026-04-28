/**
 * Tools de "drafts" pro brainstorm — pattern de área de rascunho.
 *
 * Motivação: cards densos do brainstorm (com howItSolves, keyScreens, userFlows,
 * technicalNotes) facilmente passam de 1-2k chars cada. Quando Vitor desenvolve
 * 30+ cards num turno, o output texto vai pra 30-60k chars que travam o navegador
 * ao renderizar a ChatMessage.
 *
 * Solução: cards desenvolvidos vão pra `brainstorm._drafts[]` (campo interno,
 * NAO renderizado no UI normal que mostra `solutions[]`). No chat, Vitor manda
 * apenas sumário (titles + 1 frase). Quando aprovado, `apply_drafts` move tudo
 * pra `solutions[]` em uma única chamada.
 *
 * Tools:
 * - draft_brainstorm_cards(cards: []) — cria drafts em _drafts[]. Retorna ids+titles.
 * - review_draft({ id }) — leitura, retorna draft completo
 * - apply_drafts({ ids? }) — move drafts pra solutions[]. Sem ids = todos.
 * - discard_drafts({ ids? }) — remove drafts. Sem ids = todos.
 */

import { tool } from "ai";
import { z } from "zod";
import { getStepData, updateStepData } from "../context";

const cardSchema = z.object({
  title: z.string().describe("Titulo curto e acionavel da feature"),
  howItSolves: z
    .string()
    .describe("2-3 frases explicando POR QUE a feature existe e como resolve a dor"),
  targetPersona: z
    .string()
    .describe("Persona-alvo (ex: 'Cliente', 'Profissional', 'Admin')"),
  painPointRef: z
    .string()
    .optional()
    .describe(
      "Ancoragem na dor: ID de OQ (f17990d7), step de jornada AS-IS, ou descricao curta da dor",
    ),
  keyScreens: z
    .string()
    .optional()
    .describe("Telas envolvidas, separadas por ' | ' ou em lista markdown"),
  userFlows: z
    .string()
    .optional()
    .describe("Fluxos do usuario (principal + edge cases relevantes), em lista"),
  technicalNotes: z
    .string()
    .optional()
    .describe("Mecanismo tecnico, tabelas, integracoes. Cite secao do doc quando aplicavel"),
});

interface BrainstormDraft extends z.infer<typeof cardSchema> {
  id: string;
  draftedAt: string;
}

interface BrainstormSolution extends z.infer<typeof cardSchema> {
  id: string;
}

const genId = () => Math.random().toString(36).slice(2, 9);

export function createDraftBrainstormCardsTool(sessionId: string) {
  return tool({
    description:
      "Persiste cards de brainstorm em area de rascunho (`_drafts[]`) sem virar `solutions[]` ainda. " +
      "Use SEMPRE que for desenvolver 5+ cards num turno — evita despejar texto longo no chat (que trava o UI). " +
      "Retorno e enxuto (apenas ids + titles), permitindo voce apresentar sumario no chat. " +
      "Apos confirmacao do usuario, chame `apply_drafts` pra mover tudo pra solutions.",
    inputSchema: z.object({
      cards: z
        .array(cardSchema)
        .min(1)
        .describe("Lista de cards a rascunhar. Schema id-genus de brainstorm.solutions[] sem o id."),
    }),
    execute: async ({ cards }: { cards: z.infer<typeof cardSchema>[] }) => {
      const now = new Date().toISOString();
      const drafted: BrainstormDraft[] = cards.map((c) => ({
        id: genId(),
        draftedAt: now,
        ...c,
      }));

      await updateStepData(sessionId, "brainstorm", (data) => {
        const existing = (data._drafts as BrainstormDraft[]) || [];
        return { ...data, _drafts: [...existing, ...drafted] };
      });

      return {
        ok: true,
        count: drafted.length,
        drafts: drafted.map((d) => ({ id: d.id, title: d.title, persona: d.targetPersona })),
        hint: `${drafted.length} card(s) rascunhado(s). Apresente sumario ao usuario (titles + 1 frase) e aguarde confirmacao. Para aplicar todos: apply_drafts({}). Para subset: apply_drafts({ ids: [...] }).`,
      };
    },
  });
}

export function createReviewDraftTool(sessionId: string) {
  return tool({
    description:
      "Le um draft completo do brainstorm pelo id. Use quando o usuario pedir pra revisar um card especifico antes de aplicar.",
    inputSchema: z.object({
      id: z.string().describe("ID do draft a revisar"),
    }),
    execute: async ({ id }: { id: string }) => {
      const data = await getStepData(sessionId, "brainstorm");
      const drafts = (data._drafts as BrainstormDraft[]) || [];
      const found = drafts.find((d) => d.id === id);
      if (!found) {
        return {
          ok: false,
          error: `Draft ${id} nao encontrado. Drafts ativos: ${drafts.map((d) => d.id).join(", ") || "(nenhum)"}`,
        };
      }
      return { ok: true, draft: found };
    },
  });
}

export function createApplyDraftsTool(sessionId: string) {
  return tool({
    description:
      "Move drafts (de `_drafts[]`) pra `solutions[]` — eles passam a aparecer normalmente no UI do brainstorm. " +
      "Sem `ids`, aplica TODOS os drafts. Com `ids`, aplica subset. Cards aplicados sao removidos de `_drafts[]`.",
    inputSchema: z.object({
      ids: z
        .array(z.string())
        .optional()
        .describe("Subset de ids de drafts a aplicar. Vazio/omitido = todos."),
    }),
    execute: async ({ ids }: { ids?: string[] }) => {
      let appliedCount = 0;
      let appliedIds: string[] = [];

      await updateStepData(sessionId, "brainstorm", (data) => {
        const drafts = (data._drafts as BrainstormDraft[]) || [];
        const solutions = (data.solutions as BrainstormSolution[]) || [];

        const targetSet = ids?.length ? new Set(ids) : null;
        const toApply = targetSet ? drafts.filter((d) => targetSet.has(d.id)) : drafts;
        const toKeep = targetSet ? drafts.filter((d) => !targetSet.has(d.id)) : [];

        const newSolutions: BrainstormSolution[] = toApply.map((d) => {
          const { draftedAt: _drafted, ...rest } = d;
          void _drafted;
          return rest;
        });

        appliedCount = newSolutions.length;
        appliedIds = newSolutions.map((s) => s.id);

        return {
          ...data,
          solutions: [...solutions, ...newSolutions],
          _drafts: toKeep,
        };
      });

      return {
        ok: true,
        applied: appliedCount,
        appliedIds,
        hint:
          appliedCount === 0
            ? "Nenhum draft aplicado. Confira se os ids existem com get_step_data('brainstorm') no campo _drafts."
            : `${appliedCount} card(s) movido(s) de _drafts pra solutions. Visiveis no UI do brainstorm.`,
      };
    },
  });
}

export function createDiscardDraftsTool(sessionId: string) {
  return tool({
    description:
      "Descarta drafts permanentemente. Use quando o usuario rejeitar uma proposta inteira. " +
      "Sem `ids`, descarta TODOS. Com `ids`, descarta subset.",
    inputSchema: z.object({
      ids: z
        .array(z.string())
        .optional()
        .describe("Subset de ids a descartar. Vazio/omitido = todos."),
    }),
    execute: async ({ ids }: { ids?: string[] }) => {
      let discardedCount = 0;
      await updateStepData(sessionId, "brainstorm", (data) => {
        const drafts = (data._drafts as BrainstormDraft[]) || [];
        const targetSet = ids?.length ? new Set(ids) : null;
        const toKeep = targetSet ? drafts.filter((d) => !targetSet.has(d.id)) : [];
        discardedCount = drafts.length - toKeep.length;
        return { ...data, _drafts: toKeep };
      });
      return {
        ok: true,
        discarded: discardedCount,
        hint: `${discardedCount} draft(s) removido(s).`,
      };
    },
  });
}
