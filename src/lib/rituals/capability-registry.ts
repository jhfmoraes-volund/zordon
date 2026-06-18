// Ritual Playbook — registry code-first das capabilities (espelha apps/registry
// e tools-registry). SSOT do que cada capability É; o DB nunca guarda
// comportamento, só params. Os Zod schemas são consumidos pela rota de autoria
// (src/app/api/**) pra validar o playbook na escrita — a validação acontece na
// borda da API, o schema só mora aqui pra ficar junto da definição (DRY).

import { z } from "zod";
import type { CapabilityKey, RitualType } from "./types";
import { EMPHASIS_TEXT_MAX } from "./types";

// ─── Param schemas (1 por capability) ─────────────────────

// discriminatedUnion + .strict(): cada kind carrega exatamente seu ref e rejeita
// keys cruzadas/extras na borda (em vez de depender de stripper downstream).
const weightSchema = z.enum(["primary", "supporting", "background"]).optional();
const contextSourceRef = z.object({ contextSourceId: z.string().uuid() }).strict();

export const loadContextParamsSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("granola_folder"),
      ref: z.object({ folderId: z.string().min(1) }).strict(),
      weight: weightSchema,
    })
    .strict(),
  z.object({ kind: z.literal("drive_folder"), ref: contextSourceRef, weight: weightSchema }).strict(),
  z.object({ kind: z.literal("drive_file"), ref: contextSourceRef, weight: weightSchema }).strict(),
  z.object({ kind: z.literal("notion_page"), ref: contextSourceRef, weight: weightSchema }).strict(),
  z.object({ kind: z.literal("spreadsheet"), ref: contextSourceRef, weight: weightSchema }).strict(),
]);

export const redactParamsSchema = z.object({
  audience: z.enum(["detail", "executive"]),
});

export const emphasisParamsSchema = z.object({
  text: z.string().min(1).max(EMPHASIS_TEXT_MAX),
});

// ─── Registry ─────────────────────────────────────────────

export type CapabilityDef = {
  key: CapabilityKey;
  /** A=ênfase (prompt bounded) · B=load_context (EntityLink) · C=redact (audiência). */
  category: "A" | "B" | "C";
  name: string;
  tagline: string;
  /** Rituais que expõem esta capability (PoC: só pm_review). */
  appliesTo: RitualType[];
  paramsSchema: z.ZodTypeAny;
};

export const CAPABILITY_REGISTRY: CapabilityDef[] = [
  {
    key: "load_context",
    category: "B",
    name: "Puxar contexto",
    tagline: "Linka uma fonte (Granola/Drive/Notion/planilha) no ritual a cada run.",
    appliesTo: ["pm_review"],
    paramsSchema: loadContextParamsSchema,
  },
  {
    key: "redact",
    category: "C",
    name: "Redação por audiência",
    tagline: "Restringe estruturalmente o que entra no contexto da Vitoria.",
    appliesTo: ["pm_review"],
    paramsSchema: redactParamsSchema,
  },
  {
    key: "emphasis",
    category: "A",
    name: "Ênfase",
    tagline: "Direciona o foco do report (preset + nota curta).",
    appliesTo: ["pm_review"],
    paramsSchema: emphasisParamsSchema,
  },
];

export function getCapability(key: string): CapabilityDef | undefined {
  return CAPABILITY_REGISTRY.find((c) => c.key === key);
}

// ─── Validação de instância (usada na rota de autoria) ────

/**
 * Valida UMA instância de capability contra o registry: capabilityKey conhecida
 * + params batendo no paramsSchema dela. Skip-on-unknown não vale aqui (escrita
 * deve rejeitar); o runtime é que ignora instância inválida (parse-then-skip).
 */
export const capabilityInstanceSchema = z
  .object({
    capabilityKey: z.enum(["load_context", "redact", "emphasis"]),
    enabled: z.boolean().default(true),
    params: z.unknown(),
  })
  .superRefine((inst, ctx) => {
    const def = getCapability(inst.capabilityKey);
    if (!def) {
      ctx.addIssue({ code: "custom", message: `capability desconhecida: ${inst.capabilityKey}` });
      return;
    }
    const r = def.paramsSchema.safeParse(inst.params);
    if (!r.success) {
      ctx.addIssue({
        code: "custom",
        message: `params inválidos para ${inst.capabilityKey}: ${r.error.issues[0]?.message ?? "shape inesperado"}`,
      });
    }
  });

/** Playbook inteiro (array ordenado de instâncias). Cap em 20 por sanidade. */
export const playbookCapabilitiesSchema = z.array(capabilityInstanceSchema).max(20);
