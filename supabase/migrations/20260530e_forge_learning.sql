-- ============================================================================
-- ForgeLearning — persistência de aprendizados cross-spec
--
-- Worker detecta anti-pattern, grava lesson via tool record_learning.
-- Planner consulta learnings filtrados por profileScope (db|api|ui|...)
-- antes de spawnar worker, injeta inline no system prompt.
--
-- RLS: learning é privado ao owner (não project-scoped).
-- ============================================================================

BEGIN;

CREATE TABLE "ForgeLearning" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId"     uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  "projectId"   uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  slug          text NOT NULL, -- spec slug que gerou o learning
  lesson        text NOT NULL, -- aprendizado em texto livre
  "profileScope" text CHECK ("profileScope" IN ('db','api','ui','wiring','test','doc','all')),
  severity      text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','block')),
  "addedAt"     timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX "ForgeLearning_owner_idx" ON "ForgeLearning"("ownerId", "addedAt" DESC);
CREATE INDEX "ForgeLearning_profile_idx" ON "ForgeLearning"("profileScope", "addedAt" DESC);

-- RLS: learning é privado ao owner (similar a ForgeSpec)
ALTER TABLE "ForgeLearning" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeLearning_select" ON "ForgeLearning"
  FOR SELECT USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeLearning_insert" ON "ForgeLearning"
  FOR INSERT WITH CHECK (
    "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeLearning_update" ON "ForgeLearning"
  FOR UPDATE USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeLearning_delete" ON "ForgeLearning"
  FOR DELETE USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeLearning";

COMMIT;
