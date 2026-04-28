/**
 * Tools genéricas de "drafts" pra qualquer step do wizard.
 *
 * Pattern de área de rascunho: items densos vão pra `data._drafts[arrayKey][]`
 * em vez de virem como add_item direto. O retorno da tool é enxuto (ids+title)
 * — Vitor apresenta sumário no chat e o conteúdo pesado fica estruturado no DB.
 *
 * Cobre brainstorm.solutions, risks_gaps.gaps/risks, prioritization.items,
 * hypotheses.hypotheses, technical_specs.integrations/rules — qualquer step
 * com array de items.
 *
 * O draft NAO é renderizado pelo UI atual (só `solutions[]`, `gaps[]`, etc são).
 * Ele só vira visível depois de `apply_step_drafts`.
 */

import { tool } from "ai";
import { z } from "zod";
import { getStepData, updateStepData } from "../context";

// stepKey enum espelha o do tools.ts (mantido aqui pra evitar import circular)
const stepKeySchema = z
  .enum([
    "pre_work",
    "product_vision",
    "scope_definition",
    "personas_journeys",
    "brainstorm",
    "risks_gaps",
    "prioritization",
    "technical_specs",
    "hypotheses",
  ])
  .describe("Chave do step");

interface DraftItem {
  id: string;
  draftedAt?: string;
  [key: string]: unknown;
}

const genId = () => Math.random().toString(36).slice(2, 9);

function getDraftBag(data: Record<string, unknown>): Record<string, DraftItem[]> {
  return ((data._drafts as Record<string, DraftItem[]>) || {}) as Record<string, DraftItem[]>;
}

function pickShortLabel(item: Record<string, unknown>): string {
  // Tenta achar um title/text/statement curto pra exibir como label
  for (const k of ["title", "text", "name", "statement", "hypothesis", "question"]) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      return s.length > 80 ? `${s.slice(0, 80)}…` : s;
    }
  }
  // Fallback: primeira chave string-valued
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      return `${k}=${s.length > 60 ? s.slice(0, 60) + "…" : s}`;
    }
  }
  return "(sem label)";
}

export function createDraftStepItemsTool(sessionId: string) {
  return tool({
    description:
      "Persiste items de step em area de rascunho (`_drafts[arrayKey][]`) sem virarem items visiveis ainda. " +
      "Use SEMPRE que for adicionar 5+ items densos num turno (cards de brainstorm, gaps/risks, hipoteses, integracoes...) — " +
      "evita despejar texto longo no chat (que trava o UI). " +
      "Retorno enxuto (ids+labels), permitindo apresentar sumario no chat. " +
      "Apos confirmacao do usuario, chame `apply_step_drafts` pra mover tudo pra o array final do step.",
    inputSchema: z.object({
      stepKey: stepKeySchema,
      arrayKey: z
        .string()
        .min(1)
        .describe(
          "Nome do array final no step (ex: 'solutions' pra brainstorm, 'gaps' ou 'risks' pra risks_gaps, 'hypotheses', 'integrations', 'rules', 'items'...). Drafts vao pra `_drafts[arrayKey]`.",
        ),
      items: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .describe(
          "Lista de items a rascunhar. Cada item segue o schema do array final do step (ver tabela de schemas). Voce nao precisa incluir 'id' — sera gerado automaticamente.",
        ),
    }),
    execute: async ({
      stepKey,
      arrayKey,
      items,
    }: {
      stepKey: string;
      arrayKey: string;
      items: Record<string, unknown>[];
    }) => {
      const now = new Date().toISOString();
      const drafted: DraftItem[] = items.map((it) => ({
        id: genId(),
        draftedAt: now,
        ...it,
      }));

      await updateStepData(sessionId, stepKey, (data) => {
        const bag = getDraftBag(data);
        const existing = bag[arrayKey] || [];
        return {
          ...data,
          _drafts: { ...bag, [arrayKey]: [...existing, ...drafted] },
        };
      });

      return {
        ok: true,
        stepKey,
        arrayKey,
        count: drafted.length,
        drafts: drafted.map((d) => ({ id: d.id, label: pickShortLabel(d) })),
        hint: `${drafted.length} item(s) rascunhado(s) em ${stepKey}._drafts.${arrayKey}. Apresente sumario ao usuario e aguarde confirmacao. Para aplicar todos: apply_step_drafts({ stepKey: "${stepKey}", arrayKey: "${arrayKey}" }). Para subset: ...{ ids: [...] }.`,
      };
    },
  });
}

export function createReviewStepDraftTool(sessionId: string) {
  return tool({
    description:
      "Le um draft completo pelo id. Use quando o usuario pedir pra revisar um item especifico antes de aplicar.",
    inputSchema: z.object({
      stepKey: stepKeySchema,
      arrayKey: z.string().describe("Mesmo arrayKey usado em draft_step_items"),
      id: z.string().describe("ID do draft a revisar"),
    }),
    execute: async ({
      stepKey,
      arrayKey,
      id,
    }: {
      stepKey: string;
      arrayKey: string;
      id: string;
    }) => {
      const data = await getStepData(sessionId, stepKey);
      const bag = getDraftBag(data);
      const drafts = bag[arrayKey] || [];
      const found = drafts.find((d) => d.id === id);
      if (!found) {
        return {
          ok: false,
          error: `Draft ${id} nao encontrado em ${stepKey}._drafts.${arrayKey}. Drafts ativos: ${drafts.map((d) => d.id).join(", ") || "(nenhum)"}`,
        };
      }
      return { ok: true, stepKey, arrayKey, draft: found };
    },
  });
}

export function createApplyStepDraftsTool(sessionId: string) {
  return tool({
    description:
      "Move drafts (de `_drafts[arrayKey][]`) pro array final do step (`solutions`, `gaps`, etc) — passam a aparecer no UI. " +
      "Sem `ids`, aplica TODOS os drafts daquele arrayKey. Com `ids`, aplica subset. Cards aplicados sao removidos de `_drafts`.",
    inputSchema: z.object({
      stepKey: stepKeySchema,
      arrayKey: z.string().describe("Array de destino — mesmo usado no draft_step_items"),
      ids: z
        .array(z.string())
        .optional()
        .describe("Subset de ids a aplicar. Vazio/omitido = todos do arrayKey."),
    }),
    execute: async ({
      stepKey,
      arrayKey,
      ids,
    }: {
      stepKey: string;
      arrayKey: string;
      ids?: string[];
    }) => {
      let applied: Array<{ id: string; label: string }> = [];

      await updateStepData(sessionId, stepKey, (data) => {
        const bag = getDraftBag(data);
        const drafts = bag[arrayKey] || [];
        const target = (data[arrayKey] as DraftItem[]) || [];

        const targetSet = ids?.length ? new Set(ids) : null;
        const toApply = targetSet ? drafts.filter((d) => targetSet.has(d.id)) : drafts;
        const toKeep = targetSet ? drafts.filter((d) => !targetSet.has(d.id)) : [];

        const newItems: DraftItem[] = toApply.map((d) => {
          const { draftedAt: _drafted, ...rest } = d;
          void _drafted;
          return rest;
        });

        applied = newItems.map((i) => ({ id: i.id, label: pickShortLabel(i) }));

        return {
          ...data,
          [arrayKey]: [...target, ...newItems],
          _drafts: { ...bag, [arrayKey]: toKeep },
        };
      });

      return {
        ok: true,
        stepKey,
        arrayKey,
        applied: applied.length,
        appliedIds: applied.map((a) => a.id),
        hint:
          applied.length === 0
            ? `Nenhum draft aplicado em ${stepKey}.${arrayKey}. Confira ids com get_step_data('${stepKey}') no campo _drafts.${arrayKey}.`
            : `${applied.length} item(s) movido(s) de _drafts.${arrayKey} para ${arrayKey}. Visiveis no UI do step.`,
      };
    },
  });
}

export function createDiscardStepDraftsTool(sessionId: string) {
  return tool({
    description:
      "Descarta drafts permanentemente. Use quando o usuario rejeitar a proposta. " +
      "Sem `ids`, descarta TODOS os drafts daquele arrayKey. Com `ids`, descarta subset.",
    inputSchema: z.object({
      stepKey: stepKeySchema,
      arrayKey: z.string(),
      ids: z.array(z.string()).optional(),
    }),
    execute: async ({
      stepKey,
      arrayKey,
      ids,
    }: {
      stepKey: string;
      arrayKey: string;
      ids?: string[];
    }) => {
      let discardedCount = 0;
      await updateStepData(sessionId, stepKey, (data) => {
        const bag = getDraftBag(data);
        const drafts = bag[arrayKey] || [];
        const targetSet = ids?.length ? new Set(ids) : null;
        const toKeep = targetSet ? drafts.filter((d) => !targetSet.has(d.id)) : [];
        discardedCount = drafts.length - toKeep.length;
        return {
          ...data,
          _drafts: { ...bag, [arrayKey]: toKeep },
        };
      });
      return {
        ok: true,
        stepKey,
        arrayKey,
        discarded: discardedCount,
        hint: `${discardedCount} draft(s) removido(s) de ${stepKey}._drafts.${arrayKey}.`,
      };
    },
  });
}
