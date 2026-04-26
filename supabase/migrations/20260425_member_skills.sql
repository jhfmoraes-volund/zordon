-- ═══════════════════════════════════════════════════════════
-- Member Skills Assessment
-- Self-assessment of each Member across 10 specialty towers,
-- with per-tower level (0-5) and a JSON map of subskill states.
-- ═══════════════════════════════════════════════════════════

-- ─── MemberSkill ──────────────────────────────────────────
-- One row per (member, tower). Subskills live inside `subskills`
-- as a JSONB map: { "<subskillKey>": "knows" | "ref" }.
-- Subskills not present in the map are treated as "none".

CREATE TABLE public."MemberSkill" (
  "id"        text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "memberId"  text NOT NULL REFERENCES public."Member"("id") ON DELETE CASCADE,
  "towerKey"  text NOT NULL,
  "level"     int  NOT NULL DEFAULT 0 CHECK ("level" BETWEEN 0 AND 5),
  "subskills" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("memberId", "towerKey")
);

CREATE INDEX "MemberSkill_memberId_idx"
  ON public."MemberSkill" ("memberId");

-- ─── MemberAssessment ─────────────────────────────────────
-- One row per Member tracking the assessment session: progress
-- (lastStepIndex), status, and timestamps. PK on memberId so
-- we always upsert the same record when re-doing the assessment.

CREATE TABLE public."MemberAssessment" (
  "memberId"      text PRIMARY KEY REFERENCES public."Member"("id") ON DELETE CASCADE,
  "status"        text NOT NULL DEFAULT 'in_progress'
    CHECK ("status" IN ('in_progress', 'completed')),
  "lastStepIndex" int  NOT NULL DEFAULT 0,
  "startedAt"     timestamptz NOT NULL DEFAULT now(),
  "completedAt"   timestamptz,
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS ──────────────────────────────────────────────────
-- Internal app: any authenticated user can read/write. App-level
-- guards in the API enforce "only the member edits their own".

ALTER TABLE public."MemberSkill"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MemberAssessment" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MemberSkill"      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MemberAssessment" TO anon, authenticated;

CREATE POLICY "authenticated_select" ON public."MemberSkill"
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON public."MemberSkill"
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON public."MemberSkill"
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated_delete" ON public."MemberSkill"
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "authenticated_select" ON public."MemberAssessment"
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_insert" ON public."MemberAssessment"
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update" ON public."MemberAssessment"
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated_delete" ON public."MemberAssessment"
  FOR DELETE TO authenticated USING (true);
