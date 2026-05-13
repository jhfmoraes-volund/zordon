/**
 * DS entity write tools — 1 write tool por entidade (Vitor normalization v2).
 *
 * Cada write tool é uma discriminated union sobre `action`:
 *   create | update | delete (+ alguns extras como `move` ou `archive`).
 *
 * Princípio: write atômico por id, sem read-modify-write.
 * Validação Zod no input; execução direta via Supabase client ou RPC.
 *
 * Plano: docs/vitor-normalization-plan-v2.md §2.2-2.3.
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";
import { genId } from "@/lib/utils";

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

export function createWriteBrainstormTool(sessionId: string) {
  return tool({
    description:
      "CRUD de feature do brainstorm. action=create (title required), action=update (id + campos), action=archive (id, toggle archived), action=delete (id).",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        title: z.string().min(1),
        howItSolves: z.string().optional(),
        targetPersona: z.string().optional(),
        keyScreens: z.string().optional(),
        userFlows: z.string().optional(),
        painPointRef: z.string().optional(),
        technicalNotes: z.string().optional(),
        moduleHint: z.string().optional(),
        bucket: bucketEnum.optional(),
      }),
      z.object({
        action: z.literal("update"),
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
      }),
      z.object({
        action: z.literal("archive"),
        id: z.string().min(1),
        archived: z.boolean(),
      }),
      z.object({
        action: z.literal("delete"),
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "create") {
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
            title: input.title,
            howItSolves: input.howItSolves ?? null,
            targetPersona: input.targetPersona ?? null,
            keyScreens: input.keyScreens ?? null,
            userFlows: input.userFlows ?? null,
            painPointRef: input.painPointRef ?? null,
            technicalNotes: input.technicalNotes ?? null,
            moduleHint: input.moduleHint ?? null,
            bucket: input.bucket ?? null,
            orderIndex,
          })
          .select()
          .single();
        if (error) throw new Error(`write_brainstorm create: ${error.message}`);
        return { ok: true, feature: data, action: "create" };
      }

      if (input.action === "delete") {
        const { error } = await db()
          .from("DesignSessionBrainstormFeature")
          .delete()
          .eq("sessionId", sessionId)
          .eq("id", input.id);
        if (error) throw new Error(`write_brainstorm delete: ${error.message}`);
        return { ok: true, removed: input.id };
      }

      if (input.action === "archive") {
        const { data, error } = await db()
          .from("DesignSessionBrainstormFeature")
          .update({ archived: input.archived, updatedAt: new Date().toISOString() })
          .eq("sessionId", sessionId)
          .eq("id", input.id)
          .select()
          .maybeSingle();
        if (error) throw new Error(`write_brainstorm archive: ${error.message}`);
        if (!data) return { ok: false, error: "feature_not_found", id: input.id };
        return { ok: true, feature: data };
      }

      // update
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      const fields: Array<keyof typeof input> = [
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (input as any)[f];
        if (v !== undefined) updates[f as string] = v;
      }
      const { data, error } = await db()
        .from("DesignSessionBrainstormFeature")
        .update(updates as never)
        .eq("sessionId", sessionId)
        .eq("id", input.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(`write_brainstorm update: ${error.message}`);
      if (!data) return { ok: false, error: "feature_not_found", id: input.id };
      return { ok: true, feature: data, action: "update" };
    },
  });
}

// ============================================================
// priority — 1:N. action=move é atalho pra trocar bucket.
// ============================================================

export function createWritePriorityTool(sessionId: string) {
  return tool({
    description:
      "CRUD de item de priorização. action=create (title+bucket required), action=update (id + campos), action=move (id + bucket — atalho), action=delete (id). Antes de move pra bucket=mvp, use mvp_check pra validar.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        title: z.string().min(1),
        bucket: bucketEnum,
        howItSolves: z.string().optional(),
        targetPersona: z.string().optional(),
        keyScreens: z.string().optional(),
        userFlows: z.string().optional(),
        painPointRef: z.string().optional(),
        technicalNotes: z.string().optional(),
      }),
      z.object({
        action: z.literal("update"),
        id: z.string().min(1),
        title: z.string().optional(),
        howItSolves: z.string().optional(),
        targetPersona: z.string().optional(),
        keyScreens: z.string().optional(),
        userFlows: z.string().optional(),
        painPointRef: z.string().optional(),
        technicalNotes: z.string().optional(),
        bucket: bucketEnum.optional(),
      }),
      z.object({
        action: z.literal("move"),
        id: z.string().min(1),
        bucket: bucketEnum,
      }),
      z.object({
        action: z.literal("delete"),
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "create") {
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
            title: input.title,
            bucket: input.bucket,
            howItSolves: input.howItSolves ?? "",
            targetPersona: input.targetPersona ?? "",
            keyScreens: input.keyScreens ?? null,
            userFlows: input.userFlows ?? null,
            painPointRef: input.painPointRef ?? null,
            technicalNotes: input.technicalNotes ?? null,
            orderIndex,
          })
          .select()
          .single();
        if (error) throw new Error(`write_priority create: ${error.message}`);
        return { ok: true, item: data, action: "create" };
      }

      if (input.action === "delete") {
        const { error } = await db()
          .from("DesignSessionPriorityItem")
          .delete()
          .eq("sessionId", sessionId)
          .eq("id", input.id);
        if (error) throw new Error(`write_priority delete: ${error.message}`);
        return { ok: true, removed: input.id };
      }

      if (input.action === "move") {
        const { data, error } = await db()
          .from("DesignSessionPriorityItem")
          .update({ bucket: input.bucket, updatedAt: new Date().toISOString() })
          .eq("sessionId", sessionId)
          .eq("id", input.id)
          .select()
          .maybeSingle();
        if (error) throw new Error(`write_priority move: ${error.message}`);
        if (!data) return { ok: false, error: "item_not_found", id: input.id };
        return { ok: true, item: data, action: "move" };
      }

      // update
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      const fields = [
        "title",
        "howItSolves",
        "targetPersona",
        "keyScreens",
        "userFlows",
        "painPointRef",
        "technicalNotes",
        "bucket",
      ] as const;
      for (const f of fields) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (input as any)[f];
        if (v !== undefined) updates[f] = v;
      }
      const { data, error } = await db()
        .from("DesignSessionPriorityItem")
        .update(updates as never)
        .eq("sessionId", sessionId)
        .eq("id", input.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(`write_priority update: ${error.message}`);
      if (!data) return { ok: false, error: "item_not_found", id: input.id };
      return { ok: true, item: data, action: "update" };
    },
  });
}

// ============================================================
// risk — 1:N
// ============================================================

const riskCategoryEnum = z.enum(["business", "technical"]);
const severityEnum = z.enum(["high", "medium", "low"]);

export function createWriteRiskTool(sessionId: string) {
  return tool({
    description:
      "CRUD de risco. action=create (text required), action=update (id + campos), action=delete (id).",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        text: z.string().min(1),
        category: riskCategoryEnum.optional(),
        severity: severityEnum.optional(),
        relatedFeature: z.string().optional(),
        mitigation: z.string().optional(),
      }),
      z.object({
        action: z.literal("update"),
        id: z.string().min(1),
        text: z.string().optional(),
        category: riskCategoryEnum.optional(),
        severity: severityEnum.optional(),
        relatedFeature: z.string().optional(),
        mitigation: z.string().optional(),
      }),
      z.object({
        action: z.literal("delete"),
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "create") {
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
            text: input.text,
            category: input.category ?? "business",
            severity: input.severity ?? "medium",
            relatedFeature: input.relatedFeature ?? null,
            mitigation: input.mitigation ?? null,
            orderIndex,
          })
          .select()
          .single();
        if (error) throw new Error(`write_risk create: ${error.message}`);
        return { ok: true, risk: data, action: "create" };
      }

      if (input.action === "delete") {
        const { error } = await db()
          .from("DesignSessionRisk")
          .delete()
          .eq("sessionId", sessionId)
          .eq("id", input.id);
        if (error) throw new Error(`write_risk delete: ${error.message}`);
        return { ok: true, removed: input.id };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const f of ["text", "category", "severity", "relatedFeature", "mitigation"] as const) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (input as any)[f];
        if (v !== undefined) updates[f] = v;
      }
      const { data, error } = await db()
        .from("DesignSessionRisk")
        .update(updates as never)
        .eq("sessionId", sessionId)
        .eq("id", input.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(`write_risk update: ${error.message}`);
      if (!data) return { ok: false, error: "risk_not_found", id: input.id };
      return { ok: true, risk: data, action: "update" };
    },
  });
}

// ============================================================
// gap — 1:N
// ============================================================

export function createWriteGapTool(sessionId: string) {
  return tool({
    description:
      "CRUD de gap (lacuna). action=create (text required), action=update (id + campos), action=delete (id).",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        text: z.string().min(1),
        category: z.string().optional(),
        severity: z.string().optional(),
        relatedFeature: z.string().optional(),
        mitigation: z.string().optional(),
      }),
      z.object({
        action: z.literal("update"),
        id: z.string().min(1),
        text: z.string().optional(),
        category: z.string().optional(),
        severity: z.string().optional(),
        relatedFeature: z.string().optional(),
        mitigation: z.string().optional(),
      }),
      z.object({
        action: z.literal("delete"),
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "create") {
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
            text: input.text,
            category: input.category ?? null,
            severity: input.severity ?? null,
            relatedFeature: input.relatedFeature ?? null,
            mitigation: input.mitigation ?? null,
            orderIndex,
          })
          .select()
          .single();
        if (error) throw new Error(`write_gap create: ${error.message}`);
        return { ok: true, gap: data, action: "create" };
      }

      if (input.action === "delete") {
        const { error } = await db()
          .from("DesignSessionGap")
          .delete()
          .eq("sessionId", sessionId)
          .eq("id", input.id);
        if (error) throw new Error(`write_gap delete: ${error.message}`);
        return { ok: true, removed: input.id };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const f of ["text", "category", "severity", "relatedFeature", "mitigation"] as const) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (input as any)[f];
        if (v !== undefined) updates[f] = v;
      }
      const { data, error } = await db()
        .from("DesignSessionGap")
        .update(updates as never)
        .eq("sessionId", sessionId)
        .eq("id", input.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(`write_gap update: ${error.message}`);
      if (!data) return { ok: false, error: "gap_not_found", id: input.id };
      return { ok: true, gap: data, action: "update" };
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

export function createWriteHypothesisTool(sessionId: string) {
  return tool({
    description:
      "CRUD de hipótese. action=create (hypothesis+indicator+target+expectedResult required), action=update (id + campos), action=delete (id).",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        hypothesis: z.string().min(1),
        indicator: z.string().min(1),
        target: z.string().min(1),
        expectedResult: z.string().min(1),
        evidence: z.string().optional(),
      }),
      z.object({
        action: z.literal("update"),
        id: z.string().min(1),
        hypothesis: z.string().optional(),
        indicator: z.string().optional(),
        target: z.string().optional(),
        expectedResult: z.string().optional(),
        evidence: z.string().optional(),
      }),
      z.object({
        action: z.literal("delete"),
        id: z.string().min(1),
      }),
    ]),
    execute: async (input) => {
      if (input.action === "create") {
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
            hypothesis: input.hypothesis,
            indicator: input.indicator,
            target: input.target,
            expectedResult: input.expectedResult,
            evidence: input.evidence ?? null,
            orderIndex,
          })
          .select()
          .single();
        if (error) throw new Error(`write_hypothesis create: ${error.message}`);
        return { ok: true, hypothesis: data, action: "create" };
      }

      if (input.action === "delete") {
        const { error } = await db()
          .from("DesignSessionHypothesis")
          .delete()
          .eq("sessionId", sessionId)
          .eq("id", input.id);
        if (error) throw new Error(`write_hypothesis delete: ${error.message}`);
        return { ok: true, removed: input.id };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const f of [
        "hypothesis",
        "indicator",
        "target",
        "expectedResult",
        "evidence",
      ] as const) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (input as any)[f];
        if (v !== undefined) updates[f] = v;
      }
      const { data, error } = await db()
        .from("DesignSessionHypothesis")
        .update(updates as never)
        .eq("sessionId", sessionId)
        .eq("id", input.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(`write_hypothesis update: ${error.message}`);
      if (!data) return { ok: false, error: "hypothesis_not_found", id: input.id };
      return { ok: true, hypothesis: data, action: "update" };
    },
  });
}
