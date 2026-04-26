-- ═══════════════════════════════════════════════════════════
-- Member Skills v3 — deterministic scores, no LLM evaluator
-- Rename level (0-5) → score (0-100). Drop agent-evaluation
-- fields. Add goals on assessment for future PDI agent.
-- ═══════════════════════════════════════════════════════════

-- ─── MemberSkill: level → score (0-100) ──────────────────

ALTER TABLE public."MemberSkill"
  DROP CONSTRAINT IF EXISTS "MemberSkill_level_check";

ALTER TABLE public."MemberSkill"
  RENAME COLUMN "level" TO "score";

ALTER TABLE public."MemberSkill"
  ADD CONSTRAINT "MemberSkill_score_check"
  CHECK ("score" IS NULL OR ("score" BETWEEN 0 AND 100));

-- Drop agent-evaluation fields (never produced data; v2 staging).
ALTER TABLE public."MemberSkill"
  DROP COLUMN IF EXISTS "levelRationale";

ALTER TABLE public."MemberSkill"
  DROP COLUMN IF EXISTS "evaluatedAt";

-- ─── MemberAssessment: career goals (free text) ──────────

ALTER TABLE public."MemberAssessment"
  ADD COLUMN IF NOT EXISTS "goals" text;
