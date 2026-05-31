-- ============================================================================
-- ForgeSpec — imutável waist entre Diamond 1 (Understand) e Diamond 2 (Build)
--
-- Spec.md é a cintura do duplo diamante. Aprovado por humano antes de entrar
-- no Diamond 2 (Construir). Referencia design-session, PRD, meeting etc.
-- Não tem RLS project-based porque spec pertence ao owner, não ao projeto.
-- ============================================================================

BEGIN;

CREATE TABLE "ForgeSpec" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  "ownerId"     uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  title         text NOT NULL,
  problem       text NOT NULL,
  solution      text NOT NULL,
  "nonGoals"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "userStories" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "successCriteria" jsonb NOT NULL DEFAULT '[]'::jsonb,
  upstream      jsonb, -- optional refs to DS/PRD/meeting
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  "approvedAt"  timestamptz,
  "approvedBy"  uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX "ForgeSpec_owner_idx" ON "ForgeSpec"("ownerId", "createdAt" DESC);
CREATE INDEX "ForgeSpec_status_idx" ON "ForgeSpec"(status, "createdAt" DESC);

-- RLS: spec é privado ao owner (não project-scoped)
ALTER TABLE "ForgeSpec" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeSpec_select" ON "ForgeSpec"
  FOR SELECT USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeSpec_insert" ON "ForgeSpec"
  FOR INSERT WITH CHECK (
    "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeSpec_update" ON "ForgeSpec"
  FOR UPDATE USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeSpec_delete" ON "ForgeSpec"
  FOR DELETE USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeSpec";

COMMIT;
