-- ═══════════════════════════════════════════════════════════
-- Member Skills v2 — let the agent decide the level
-- The member only marks subskills + writes practical cases.
-- An evaluator agent computes the level and stores rationale.
-- ═══════════════════════════════════════════════════════════

-- ─── MemberSkill: level nullable, add cases + rationale ──

-- Drop existing CHECK so we can allow NULL.
ALTER TABLE public."MemberSkill"
  DROP CONSTRAINT IF EXISTS "MemberSkill_level_check";

ALTER TABLE public."MemberSkill"
  ALTER COLUMN "level" DROP NOT NULL;

ALTER TABLE public."MemberSkill"
  ALTER COLUMN "level" DROP DEFAULT;

ALTER TABLE public."MemberSkill"
  ADD CONSTRAINT "MemberSkill_level_check"
  CHECK ("level" IS NULL OR ("level" BETWEEN 0 AND 5));

ALTER TABLE public."MemberSkill"
  ADD COLUMN IF NOT EXISTS "cases" text;

ALTER TABLE public."MemberSkill"
  ADD COLUMN IF NOT EXISTS "levelRationale" text;

ALTER TABLE public."MemberSkill"
  ADD COLUMN IF NOT EXISTS "evaluatedAt" timestamptz;
