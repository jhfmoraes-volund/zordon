/**
 * DS entity write tools — 1 write tool por entidade (Vitor normalization v2).
 *
 * Cada write tool é uma discriminated union sobre `action`:
 *   create | update | delete (+ alguns extras como `move` ou `archive`).
 *
 * Princípio: write atômico por id, sem read-modify-write.
 * Validação Zod no input; execução direta via Supabase client ou RPC.
 *
 * Plano: docs/agents/vitor/vitor-normalization-plan-v2.md §2.2-2.3.
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";
import { genId } from "@/lib/utils";
import { defineBatchedWriteTool, type ActionItemResult } from "./_batched-write";

// ============================================================
// product_vision — 1:1, só update (upsert por sessionId)
// ============================================================

export function createWriteProductVisionTool(sessionId: string) {
  return tool({
    description:
      "Atualiza campos da Product Vision (upsert 1:1). Passa apenas os campos a alterar — os outros ficam intactos. Campos válidos: problem, whoSuffers, consequences, successVision, impactMetrics.",
    inputSchema: z.object({
      problem: z.string().optional(),
      whoSuffers: z.string().optional(),
      consequences: z.string().optional(),
      successVision: z.string().optional(),
      impactMetrics: z.string().optional(),
    }),
    execute: async (patch) => {
      // upsert: se row não existe, cria; senão, atualiza só os campos passados.
      const { data: existing } = await db()
        .from("DesignSessionProductVision")
        .select("sessionId")
        .eq("sessionId", sessionId)
        .maybeSingle();

      if (!existing) {
        const { data, error } = await db()
          .from("DesignSessionProductVision")
          .insert({
            sessionId,
            problem: patch.problem ?? "",
            whoSuffers: patch.whoSuffers ?? "",
            consequences: patch.consequences ?? "",
            successVision: patch.successVision ?? "",
            impactMetrics: patch.impactMetrics ?? "",
          })
          .select()
          .single();
        if (error) throw new Error(`write_product_vision: ${error.message}`);
        return { ok: true, vision: data };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (patch.problem !== undefined) updates.problem = patch.problem;
      if (patch.whoSuffers !== undefined) updates.whoSuffers = patch.whoSuffers;
      if (patch.consequences !== undefined) updates.consequences = patch.consequences;
      if (patch.successVision !== undefined) updates.successVision = patch.successVision;
      if (patch.impactMetrics !== undefined) updates.impactMetrics = patch.impactMetrics;

      const { data, error } = await db()
        .from("DesignSessionProductVision")
        .update(updates as never)
        .eq("sessionId", sessionId)
        .select()
        .single();
      if (error) throw new Error(`write_product_vision: ${error.message}`);
      return { ok: true, vision: data };
    },
  });
}

// ============================================================
// scope — 1:1 com 4 jsonb arrays. Usa RPC scope_item_upsert/delete.
// ============================================================

const scopeBucketSchema = z.enum(["inScope", "outOfScope", "does", "doesNot"]);

export function createWriteScopeItemTool(sessionId: string) {
  return tool({
    description:
      "Cria/atualiza/remove 1 item de uma das 4 listas de Scope (inScope, outOfScope, does, doesNot). Item shape: {id?, text, ...}. action=create gera id se vier vazio; action=update precisa id; action=delete precisa id.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        bucket: scopeBucketSchema,
        text: z.string().min(1),
      }),
      z.object({
        action: z.literal("update"),
        bucket: scopeBucketSchema,
        id: z.string().min(1),
        text: z.string().min(1),
      }),
      z.object({
        action: z.literal("delete"),
        bucket: scopeBucketSchema,
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "delete") {
        const { data, error } = await db().rpc("scope_item_delete", {
          p_session_id: sessionId,
          p_bucket: input.bucket,
          p_item_id: input.id,
        });
        if (error) throw new Error(`write_scope_item delete: ${error.message}`);
        return { ok: true, removed: data === true };
      }

      const id = input.action === "update" ? input.id : genId();
      const { data, error } = await db().rpc("scope_item_upsert", {
        p_session_id: sessionId,
        p_bucket: input.bucket,
        p_item: { id, text: input.text } as Json,
      });
      if (error) throw new Error(`write_scope_item ${input.action}: ${error.message}`);
      return { ok: true, item: data, bucket: input.bucket, action: input.action };
    },
  });
}

// ============================================================
// persona — 1:N + journey jsonb. CRUD da persona + journey upsert/delete via RPC.
// ============================================================

const journeyStepInputSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  painOrGain: z.string().optional(),
});

export function createWritePersonaTool(sessionId: string) {
  return tool({
    description:
      "CRUD de Persona + journey steps. action=create cria persona (name+role required). action=update altera campos (id required). action=delete remove persona inteira. action=add_journey_step / update_journey_step / delete_journey_step mexe em asIsSteps/toBeSteps via RPC atômica.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        name: z.string().min(1),
        role: z.string().min(1),
        context: z.string().optional(),
        asIsSteps: z.array(journeyStepInputSchema).optional(),
        toBeSteps: z.array(journeyStepInputSchema).optional(),
      }),
      z.object({
        action: z.literal("update"),
        id: z.string().min(1),
        name: z.string().optional(),
        role: z.string().optional(),
        context: z.string().optional(),
      }),
      z.object({
        action: z.literal("delete"),
        id: z.string().min(1),
      }),
      z.object({
        action: z.literal("add_journey_step"),
        personaId: z.string().min(1),
        kind: z.enum(["asIs", "toBe"]),
        step: journeyStepInputSchema,
      }),
      z.object({
        action: z.literal("update_journey_step"),
        personaId: z.string().min(1),
        kind: z.enum(["asIs", "toBe"]),
        stepId: z.string().min(1),
        step: journeyStepInputSchema,
      }),
      z.object({
        action: z.literal("delete_journey_step"),
        personaId: z.string().min(1),
        kind: z.enum(["asIs", "toBe"]),
        stepId: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "create") {
        // pick next orderIndex
        const { data: last } = await db()
          .from("DesignSessionPersona")
          .select("orderIndex")
          .eq("sessionId", sessionId)
          .order("orderIndex", { ascending: false })
          .limit(1)
          .maybeSingle();
        const orderIndex = (last?.orderIndex ?? -1) + 1;

        const { data, error } = await db()
          .from("DesignSessionPersona")
          .insert({
            sessionId,
            name: input.name,
            role: input.role,
            context: input.context ?? "",
            asIsSteps: (input.asIsSteps ?? []) as Json,
            toBeSteps: (input.toBeSteps ?? []) as Json,
            orderIndex,
          })
          .select()
          .single();
        if (error) throw new Error(`write_persona create: ${error.message}`);
        return { ok: true, persona: data, action: "create" };
      }

      if (input.action === "update") {
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (input.name !== undefined) updates.name = input.name;
        if (input.role !== undefined) updates.role = input.role;
        if (input.context !== undefined) updates.context = input.context;

        const { data, error } = await db()
          .from("DesignSessionPersona")
          .update(updates as never)
          .eq("sessionId", sessionId)
          .eq("id", input.id)
          .select()
          .maybeSingle();
        if (error) throw new Error(`write_persona update: ${error.message}`);
        if (!data) return { ok: false, error: "persona_not_found", id: input.id };
        return { ok: true, persona: data, action: "update" };
      }

      if (input.action === "delete") {
        const { error } = await db()
          .from("DesignSessionPersona")
          .delete()
          .eq("sessionId", sessionId)
          .eq("id", input.id);
        if (error) throw new Error(`write_persona delete: ${error.message}`);
        return { ok: true, removed: input.id, action: "delete" };
      }

      if (input.action === "delete_journey_step") {
        const { data, error } = await db().rpc("persona_journey_delete", {
          p_persona_id: input.personaId,
          p_kind: input.kind,
          p_step_id: input.stepId,
        });
        if (error) throw new Error(`write_persona delete_journey_step: ${error.message}`);
        return { ok: true, removed: data === true };
      }

      // add_journey_step | update_journey_step
      const stepPayload =
        input.action === "update_journey_step"
          ? { ...input.step, id: input.stepId }
          : input.step;
      const { data, error } = await db().rpc("persona_journey_upsert", {
        p_persona_id: input.personaId,
        p_kind: input.kind,
        p_step: stepPayload as Json,
      });
      if (error) throw new Error(`write_persona ${input.action}: ${error.message}`);
      return { ok: true, step: data, action: input.action };
    },
  });
}

// ============================================================
// brainstorm — 1:N
// ============================================================

const bucketEnum = z.enum(["mvp", "next", "out"]);

// Item schemas (sem `action` — o helper injeta o envelope { action, items: [...] }).
const brainstormCreateItem = z.object({
  title: z.string().min(1),
  howItSolves: z.string().optional(),
  targetPersona: z.string().optional(),
  keyScreens: z.string().optional(),
  userFlows: z.string().optional(),
  painPointRef: z.string().optional(),
  technicalNotes: z.string().optional(),
  moduleHint: z.string().optional(),
  bucket: bucketEnum.optional(),
});
type BrainstormCreateItem = z.infer<typeof brainstormCreateItem>;

const brainstormUpdateItem = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  howItSolves: z.string().optional(),
  targetPersona: z.string().optional(),
  keyScreens: z.string().optional(),
  userFlows: z.string().optional(),
  painPointRef: z.string().optional(),
  technicalNotes: z.string().optional(),
  moduleHint: z.string().optional(),
  bucket: bucketEnum.optional(),
});
type BrainstormUpdateItem = z.infer<typeof brainstormUpdateItem>;

const brainstormArchiveItem = z.object({
  id: z.string().min(1),
  archived: z.boolean(),
});
type BrainstormArchiveItem = z.infer<typeof brainstormArchiveItem>;

const idOnlyItem = z.object({ id: z.string().min(1) });
type IdOnlyItem = z.infer<typeof idOnlyItem>;

export function createWriteBrainstormTool(sessionId: string) {
  return defineBatchedWriteTool({
    description:
      "CRUD batched de features do brainstorm. Forma: { action, items: [...] }. " +
      "action=create cria N features (items=[{ title, howItSolves?, targetPersona?, ... }]). " +
      "action=update aplica patch em N features (items=[{ id, ...patch }]). " +
      "action=archive alterna archived em N (items=[{ id, archived }]). " +
      "action=delete remove N (items=[{ id }]). " +
      "Use 1 chamada por turno com items[] em vez de N chamadas singulares.",
    actions: {
      create: {
        itemSchema: brainstormCreateItem,
        sequential: true, // orderIndex sequencial — race em paralelo
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as BrainstormCreateItem;
          const { data: last } = await db()
            .from("DesignSessionBrainstormFeature")
            .select("orderIndex")
            .eq("sessionId", sessionId)
            .order("orderIndex", { ascending: false })
            .limit(1)
            .maybeSingle();
          const orderIndex = (last?.orderIndex ?? -1) + 1;

          const { data, error } = await db()
            .from("DesignSessionBrainstormFeature")
            .insert({
              id: genId(),
              sessionId,
              title: item.title,
              howItSolves: item.howItSolves ?? null,
              targetPersona: item.targetPersona ?? null,
              keyScreens: item.keyScreens ?? null,
              userFlows: item.userFlows ?? null,
              painPointRef: item.painPointRef ?? null,
              technicalNotes: item.technicalNotes ?? null,
              moduleHint: item.moduleHint ?? null,
              bucket: item.bucket ?? null,
              orderIndex,
            })
            .select()
            .single();
          if (error) return { ok: false, code: "db_error", error: error.message };
          return { ok: true, feature: data };
        },
      },
      update: {
        itemSchema: brainstormUpdateItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as BrainstormUpdateItem;
          const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
          const fields: Array<keyof BrainstormUpdateItem> = [
            "title",
            "howItSolves",
            "targetPersona",
            "keyScreens",
            "userFlows",
            "painPointRef",
            "technicalNotes",
            "moduleHint",
            "bucket",
          ];
          for (const f of fields) {
            const v = item[f];
            if (v !== undefined) updates[f as string] = v;
          }
          const { data, error } = await db()
            .from("DesignSessionBrainstormFeature")
            .update(updates as never)
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "feature_not_found", id: item.id };
          return { ok: true, feature: data };
        },
      },
      archive: {
        itemSchema: brainstormArchiveItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as BrainstormArchiveItem;
          const { data, error } = await db()
            .from("DesignSessionBrainstormFeature")
            .update({ archived: item.archived, updatedAt: new Date().toISOString() })
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "feature_not_found", id: item.id };
          return { ok: true, feature: data };
        },
      },
      delete: {
        itemSchema: idOnlyItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as IdOnlyItem;
          const { error } = await db()
            .from("DesignSessionBrainstormFeature")
            .delete()
            .eq("sessionId", sessionId)
            .eq("id", item.id);
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          return { ok: true, removed: item.id };
        },
      },
    },
  });
}

// ============================================================
// priority — 1:N. action=move é atalho pra trocar bucket.
// ============================================================

const priorityCreateItem = z.object({
  title: z.string().min(1),
  bucket: bucketEnum,
  howItSolves: z.string().optional(),
  targetPersona: z.string().optional(),
  keyScreens: z.string().optional(),
  userFlows: z.string().optional(),
  painPointRef: z.string().optional(),
  technicalNotes: z.string().optional(),
});
type PriorityCreateItem = z.infer<typeof priorityCreateItem>;

const priorityUpdateItem = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  howItSolves: z.string().optional(),
  targetPersona: z.string().optional(),
  keyScreens: z.string().optional(),
  userFlows: z.string().optional(),
  painPointRef: z.string().optional(),
  technicalNotes: z.string().optional(),
  bucket: bucketEnum.optional(),
});
type PriorityUpdateItem = z.infer<typeof priorityUpdateItem>;

const priorityMoveItem = z.object({
  id: z.string().min(1),
  bucket: bucketEnum,
});
type PriorityMoveItem = z.infer<typeof priorityMoveItem>;

export function createWritePriorityTool(sessionId: string) {
  return defineBatchedWriteTool({
    description:
      "CRUD batched de itens de priorização. Forma: { action, items: [...] }. " +
      "action=create cria N items (items=[{ title, bucket, ... }]). " +
      "action=update aplica patch (items=[{ id, ...patch }]). " +
      "action=move troca bucket (items=[{ id, bucket }]). " +
      "action=delete remove (items=[{ id }]). " +
      "Antes de mover items pra bucket=mvp, use mvp_check pra validar.",
    actions: {
      create: {
        itemSchema: priorityCreateItem,
        sequential: true,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as PriorityCreateItem;
          const { data: last } = await db()
            .from("DesignSessionPriorityItem")
            .select("orderIndex")
            .eq("sessionId", sessionId)
            .order("orderIndex", { ascending: false })
            .limit(1)
            .maybeSingle();
          const orderIndex = (last?.orderIndex ?? -1) + 1;

          const { data, error } = await db()
            .from("DesignSessionPriorityItem")
            .insert({
              sessionId,
              title: item.title,
              bucket: item.bucket,
              howItSolves: item.howItSolves ?? "",
              targetPersona: item.targetPersona ?? "",
              keyScreens: item.keyScreens ?? null,
              userFlows: item.userFlows ?? null,
              painPointRef: item.painPointRef ?? null,
              technicalNotes: item.technicalNotes ?? null,
              orderIndex,
            })
            .select()
            .single();
          if (error) return { ok: false, code: "db_error", error: error.message };
          return { ok: true, item: data };
        },
      },
      update: {
        itemSchema: priorityUpdateItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as PriorityUpdateItem;
          const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
          const fields: Array<keyof PriorityUpdateItem> = [
            "title",
            "howItSolves",
            "targetPersona",
            "keyScreens",
            "userFlows",
            "painPointRef",
            "technicalNotes",
            "bucket",
          ];
          for (const f of fields) {
            const v = item[f];
            if (v !== undefined) updates[f as string] = v;
          }
          const { data, error } = await db()
            .from("DesignSessionPriorityItem")
            .update(updates as never)
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "item_not_found", id: item.id };
          return { ok: true, item: data };
        },
      },
      move: {
        itemSchema: priorityMoveItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as PriorityMoveItem;
          const { data, error } = await db()
            .from("DesignSessionPriorityItem")
            .update({ bucket: item.bucket, updatedAt: new Date().toISOString() })
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "item_not_found", id: item.id };
          return { ok: true, item: data };
        },
      },
      delete: {
        itemSchema: idOnlyItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as IdOnlyItem;
          const { error } = await db()
            .from("DesignSessionPriorityItem")
            .delete()
            .eq("sessionId", sessionId)
            .eq("id", item.id);
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          return { ok: true, removed: item.id };
        },
      },
    },
  });
}

// ============================================================
// risk — 1:N
// ============================================================

const riskCategoryEnum = z.enum(["business", "technical"]);
const severityEnum = z.enum(["high", "medium", "low"]);

const riskCreateItem = z.object({
  text: z.string().min(1),
  category: riskCategoryEnum.optional(),
  severity: severityEnum.optional(),
  relatedFeature: z.string().optional(),
  mitigation: z.string().optional(),
});
type RiskCreateItem = z.infer<typeof riskCreateItem>;

const riskUpdateItem = z.object({
  id: z.string().min(1),
  text: z.string().optional(),
  category: riskCategoryEnum.optional(),
  severity: severityEnum.optional(),
  relatedFeature: z.string().optional(),
  mitigation: z.string().optional(),
});
type RiskUpdateItem = z.infer<typeof riskUpdateItem>;

export function createWriteRiskTool(sessionId: string) {
  return defineBatchedWriteTool({
    description:
      "CRUD batched de riscos. Forma: { action, items: [...] }. " +
      "action=create cria N riscos (items=[{ text, category?, severity?, ... }]). " +
      "action=update aplica patch (items=[{ id, ...patch }]). " +
      "action=delete remove (items=[{ id }]).",
    actions: {
      create: {
        itemSchema: riskCreateItem,
        sequential: true,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as RiskCreateItem;
          const { data: last } = await db()
            .from("DesignSessionRisk")
            .select("orderIndex")
            .eq("sessionId", sessionId)
            .order("orderIndex", { ascending: false })
            .limit(1)
            .maybeSingle();
          const orderIndex = (last?.orderIndex ?? -1) + 1;

          const { data, error } = await db()
            .from("DesignSessionRisk")
            .insert({
              sessionId,
              text: item.text,
              category: item.category ?? "business",
              severity: item.severity ?? "medium",
              relatedFeature: item.relatedFeature ?? null,
              mitigation: item.mitigation ?? null,
              orderIndex,
            })
            .select()
            .single();
          if (error) return { ok: false, code: "db_error", error: error.message };
          return { ok: true, risk: data };
        },
      },
      update: {
        itemSchema: riskUpdateItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as RiskUpdateItem;
          const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
          const fields: Array<keyof RiskUpdateItem> = [
            "text",
            "category",
            "severity",
            "relatedFeature",
            "mitigation",
          ];
          for (const f of fields) {
            const v = item[f];
            if (v !== undefined) updates[f as string] = v;
          }
          const { data, error } = await db()
            .from("DesignSessionRisk")
            .update(updates as never)
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "risk_not_found", id: item.id };
          return { ok: true, risk: data };
        },
      },
      delete: {
        itemSchema: idOnlyItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as IdOnlyItem;
          const { error } = await db()
            .from("DesignSessionRisk")
            .delete()
            .eq("sessionId", sessionId)
            .eq("id", item.id);
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          return { ok: true, removed: item.id };
        },
      },
    },
  });
}

// ============================================================
// gap — 1:N
// ============================================================

const gapCreateItem = z.object({
  text: z.string().min(1),
  category: z.string().optional(),
  severity: z.string().optional(),
  relatedFeature: z.string().optional(),
  mitigation: z.string().optional(),
});
type GapCreateItem = z.infer<typeof gapCreateItem>;

const gapUpdateItem = z.object({
  id: z.string().min(1),
  text: z.string().optional(),
  category: z.string().optional(),
  severity: z.string().optional(),
  relatedFeature: z.string().optional(),
  mitigation: z.string().optional(),
});
type GapUpdateItem = z.infer<typeof gapUpdateItem>;

export function createWriteGapTool(sessionId: string) {
  return defineBatchedWriteTool({
    description:
      "CRUD batched de gaps (lacunas). Forma: { action, items: [...] }. " +
      "action=create cria N gaps (items=[{ text, category?, severity?, ... }]). " +
      "action=update aplica patch (items=[{ id, ...patch }]). " +
      "action=delete remove (items=[{ id }]).",
    actions: {
      create: {
        itemSchema: gapCreateItem,
        sequential: true,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as GapCreateItem;
          const { data: last } = await db()
            .from("DesignSessionGap")
            .select("orderIndex")
            .eq("sessionId", sessionId)
            .order("orderIndex", { ascending: false })
            .limit(1)
            .maybeSingle();
          const orderIndex = (last?.orderIndex ?? -1) + 1;

          const { data, error } = await db()
            .from("DesignSessionGap")
            .insert({
              sessionId,
              text: item.text,
              category: item.category ?? null,
              severity: item.severity ?? null,
              relatedFeature: item.relatedFeature ?? null,
              mitigation: item.mitigation ?? null,
              orderIndex,
            })
            .select()
            .single();
          if (error) return { ok: false, code: "db_error", error: error.message };
          return { ok: true, gap: data };
        },
      },
      update: {
        itemSchema: gapUpdateItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as GapUpdateItem;
          const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
          const fields: Array<keyof GapUpdateItem> = [
            "text",
            "category",
            "severity",
            "relatedFeature",
            "mitigation",
          ];
          for (const f of fields) {
            const v = item[f];
            if (v !== undefined) updates[f as string] = v;
          }
          const { data, error } = await db()
            .from("DesignSessionGap")
            .update(updates as never)
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "gap_not_found", id: item.id };
          return { ok: true, gap: data };
        },
      },
      delete: {
        itemSchema: idOnlyItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as IdOnlyItem;
          const { error } = await db()
            .from("DesignSessionGap")
            .delete()
            .eq("sessionId", sessionId)
            .eq("id", item.id);
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          return { ok: true, removed: item.id };
        },
      },
    },
  });
}

// ============================================================
// tech_specs — 1:1 (stack/performance escalares) + 2 jsonb arrays (integrations, rules)
// ============================================================

export function createWriteTechSpecsTool(sessionId: string) {
  return tool({
    description:
      "Mexe em TechnicalSpecs. action=update altera stack/performance (escalares). action=add_integration / update_integration / delete_integration / add_rule / update_rule / delete_rule mexem nos jsonb arrays via RPC atômica.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("update"),
        stack: z.string().optional(),
        performance: z.string().optional(),
      }),
      z.object({
        action: z.literal("add_integration"),
        text: z.string().min(1),
      }),
      z.object({
        action: z.literal("update_integration"),
        id: z.string().min(1),
        text: z.string().min(1),
      }),
      z.object({
        action: z.literal("delete_integration"),
        id: z.string().min(1),
      }),
      z.object({
        action: z.literal("add_rule"),
        text: z.string().min(1),
      }),
      z.object({
        action: z.literal("update_rule"),
        id: z.string().min(1),
        text: z.string().min(1),
      }),
      z.object({
        action: z.literal("delete_rule"),
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "update") {
        // Upsert 1:1
        const { data: existing } = await db()
          .from("DesignSessionTechnicalSpecs")
          .select("sessionId")
          .eq("sessionId", sessionId)
          .maybeSingle();

        if (!existing) {
          const { data, error } = await db()
            .from("DesignSessionTechnicalSpecs")
            .insert({
              sessionId,
              stack: input.stack ?? "",
              performance: input.performance ?? "",
            })
            .select()
            .single();
          if (error) throw new Error(`write_tech_specs update: ${error.message}`);
          return { ok: true, specs: data, action: "update" };
        }

        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (input.stack !== undefined) updates.stack = input.stack;
        if (input.performance !== undefined) updates.performance = input.performance;
        const { data, error } = await db()
          .from("DesignSessionTechnicalSpecs")
          .update(updates as never)
          .eq("sessionId", sessionId)
          .select()
          .single();
        if (error) throw new Error(`write_tech_specs update: ${error.message}`);
        return { ok: true, specs: data, action: "update" };
      }

      if (
        input.action === "delete_integration" ||
        input.action === "delete_rule"
      ) {
        const kind = input.action === "delete_integration" ? "integration" : "rule";
        const { data, error } = await db().rpc("tech_specs_item_delete", {
          p_session_id: sessionId,
          p_kind: kind,
          p_item_id: input.id,
        });
        if (error) throw new Error(`write_tech_specs ${input.action}: ${error.message}`);
        return { ok: true, removed: data === true };
      }

      // add_X / update_X
      const kind =
        input.action === "add_integration" || input.action === "update_integration"
          ? "integration"
          : "rule";
      const id =
        input.action === "update_integration" || input.action === "update_rule"
          ? input.id
          : genId();
      const { data, error } = await db().rpc("tech_specs_item_upsert", {
        p_session_id: sessionId,
        p_kind: kind,
        p_item: { id, text: input.text } as Json,
      });
      if (error) throw new Error(`write_tech_specs ${input.action}: ${error.message}`);
      return { ok: true, item: data, action: input.action };
    },
  });
}

// ============================================================
// hypothesis — 1:N
// ============================================================

const hypothesisCreateItem = z.object({
  hypothesis: z.string().min(1),
  indicator: z.string().min(1),
  target: z.string().min(1),
  expectedResult: z.string().min(1),
  evidence: z.string().optional(),
});
type HypothesisCreateItem = z.infer<typeof hypothesisCreateItem>;

const hypothesisUpdateItem = z.object({
  id: z.string().min(1),
  hypothesis: z.string().optional(),
  indicator: z.string().optional(),
  target: z.string().optional(),
  expectedResult: z.string().optional(),
  evidence: z.string().optional(),
});
type HypothesisUpdateItem = z.infer<typeof hypothesisUpdateItem>;

export function createWriteHypothesisTool(sessionId: string) {
  return defineBatchedWriteTool({
    description:
      "CRUD batched de hipóteses. Forma: { action, items: [...] }. " +
      "action=create cria N hipóteses (items=[{ hypothesis, indicator, target, expectedResult, evidence? }]). " +
      "action=update aplica patch (items=[{ id, ...patch }]). " +
      "action=delete remove (items=[{ id }]).",
    actions: {
      create: {
        itemSchema: hypothesisCreateItem,
        sequential: true,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as HypothesisCreateItem;
          const { data: last } = await db()
            .from("DesignSessionHypothesis")
            .select("orderIndex")
            .eq("sessionId", sessionId)
            .order("orderIndex", { ascending: false })
            .limit(1)
            .maybeSingle();
          const orderIndex = (last?.orderIndex ?? -1) + 1;

          const { data, error } = await db()
            .from("DesignSessionHypothesis")
            .insert({
              sessionId,
              hypothesis: item.hypothesis,
              indicator: item.indicator,
              target: item.target,
              expectedResult: item.expectedResult,
              evidence: item.evidence ?? null,
              orderIndex,
            })
            .select()
            .single();
          if (error) return { ok: false, code: "db_error", error: error.message };
          return { ok: true, hypothesis: data };
        },
      },
      update: {
        itemSchema: hypothesisUpdateItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as HypothesisUpdateItem;
          const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
          const fields: Array<keyof HypothesisUpdateItem> = [
            "hypothesis",
            "indicator",
            "target",
            "expectedResult",
            "evidence",
          ];
          for (const f of fields) {
            const v = item[f];
            if (v !== undefined) updates[f as string] = v;
          }
          const { data, error } = await db()
            .from("DesignSessionHypothesis")
            .update(updates as never)
            .eq("sessionId", sessionId)
            .eq("id", item.id)
            .select()
            .maybeSingle();
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          if (!data) return { ok: false, code: "not_found", error: "hypothesis_not_found", id: item.id };
          return { ok: true, hypothesis: data };
        },
      },
      delete: {
        itemSchema: idOnlyItem,
        sequential: false,
        async handler(rawItem): Promise<ActionItemResult> {
          const item = rawItem as IdOnlyItem;
          const { error } = await db()
            .from("DesignSessionHypothesis")
            .delete()
            .eq("sessionId", sessionId)
            .eq("id", item.id);
          if (error) return { ok: false, code: "db_error", error: error.message, id: item.id };
          return { ok: true, removed: item.id };
        },
      },
    },
  });
}
