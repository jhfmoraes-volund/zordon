-- Sprint Goal + Sprint Retrospective
-- Goal: campo opcional no Sprint (manifesto de objetivo, max 280 chars)
-- Retro: tabela separada (1:1 com Sprint via UNIQUE em sprintId), 3 textos Quebom/Quepena/Quetal

BEGIN;

-- 1. Sprint.goal — texto livre, opcional, limite 280
ALTER TABLE "Sprint"
  ADD COLUMN "goal" text;

ALTER TABLE "Sprint"
  ADD CONSTRAINT sprint_goal_length
  CHECK ("goal" IS NULL OR char_length("goal") <= 280);

-- 2. SprintRetrospective — 1 retro por sprint (UNIQUE)
CREATE TABLE "SprintRetrospective" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sprintId" uuid NOT NULL REFERENCES "Sprint"("id") ON DELETE CASCADE,
  "goodPoints" text,
  "badPoints" text,
  "ideas" text,
  "completedAt" timestamptz NOT NULL DEFAULT now(),
  "completedBy" uuid REFERENCES "Member"("id") ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sprint_retrospective_one_per_sprint
  ON "SprintRetrospective" ("sprintId");

CREATE INDEX sprint_retrospective_sprint_idx
  ON "SprintRetrospective" ("sprintId");

-- 3. RLS — espelha Sprint (select via project access, mutações via authenticated)
ALTER TABLE "SprintRetrospective" ENABLE ROW LEVEL SECURITY;

CREATE POLICY manager_or_viewer_select ON public."SprintRetrospective"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    is_manager() OR can_view_project(
      (SELECT "projectId" FROM "Sprint" WHERE "Sprint"."id" = "SprintRetrospective"."sprintId")
    )
  );

CREATE POLICY authenticated_insert ON public."SprintRetrospective"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY authenticated_update ON public."SprintRetrospective"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY authenticated_delete ON public."SprintRetrospective"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);

-- 4. Trigger updatedAt
CREATE OR REPLACE FUNCTION sprint_retrospective_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sprint_retrospective_updated_at
  BEFORE UPDATE ON "SprintRetrospective"
  FOR EACH ROW EXECUTE FUNCTION sprint_retrospective_set_updated_at();

COMMIT;
