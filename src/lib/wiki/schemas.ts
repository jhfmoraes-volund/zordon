import { z } from "zod";

/**
 * Schemas Zod do output narrativo da Wiki (PRD project-wiki §6.2/§6.3).
 *
 * Duas variantes por seção:
 *   - `Raw*Schema`: o que o LLM devolve (sem bulletHash — hash é determinístico,
 *     computado server-side via computeBulletHash, nunca pelo modelo).
 *   - `*Schema`: shape persistido em ProjectWikiSection.data (com bulletHash).
 *
 * Regra grounded do repo: bullet sem source ref tipada não persiste — o
 * composer descarta e loga (runbook §8).
 */

export const WIKI_SOURCE_TYPES = [
  "meeting",
  "design_session",
  "task",
  "sprint",
  "pm_review",
  "context_source",
] as const;

export const SourceRefSchema = z.object({
  type: z.enum(WIKI_SOURCE_TYPES),
  id: z.string().uuid(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** Bullet como o LLM devolve: texto curto + ref obrigatória. */
const RawBulletSchema = z.object({
  text: z.string().min(1).max(280),
  source: SourceRefSchema,
});
export type RawBullet = z.infer<typeof RawBulletSchema>;

/** Bullet persistido: + hash determinístico (suppress key). */
const BulletSchema = RawBulletSchema.extend({
  bulletHash: z.string().min(1),
});
export type WikiBullet = z.infer<typeof BulletSchema>;

// ── objectives — 1 entrada (problema/visão/sinais), fonte: DS Inception ──

export const RawObjectivesSchema = z.object({
  problem: RawBulletSchema,
  vision: RawBulletSchema,
  success_signals: z.array(RawBulletSchema).max(5),
});
export type RawObjectives = z.infer<typeof RawObjectivesSchema>;

export const ObjectivesSchema = z.object({
  problem: BulletSchema,
  vision: BulletSchema,
  success_signals: z.array(BulletSchema).max(5),
});
export type Objectives = z.infer<typeof ObjectivesSchema>;

// ── highlights — máx 5 bullets, fonte: pm_review + tasks na janela ──

export const RawHighlightsSchema = z.object({
  bullets: z.array(RawBulletSchema).max(5),
});
export type RawHighlights = z.infer<typeof RawHighlightsSchema>;

export const HighlightsSchema = z.object({
  bullets: z.array(BulletSchema).max(5),
});
export type Highlights = z.infer<typeof HighlightsSchema>;

// ── chaves narrativas (sectionKey em ProjectWikiSection) ──
// 'decisions' saiu (WER-006): decisões aparecem no log de Atividade recente.

export const NARRATIVE_SECTION_KEYS = ["objectives", "highlights"] as const;
export type NarrativeSectionKey = (typeof NARRATIVE_SECTION_KEYS)[number];
