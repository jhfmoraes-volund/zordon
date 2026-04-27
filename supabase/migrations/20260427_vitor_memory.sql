-- ═══════════════════════════════════════════════════════════
-- Vitor Memory — Fases 1+2+3
--
-- Plano: docs/vitor-memory-plan.md
--
-- Estrutura em 4 camadas:
--  1. Project memory   → Project.memoryMd + ProjectBusinessContext
--  2. Session memory   → DesignSession.memoryMd
--  3. Estruturada      → DesignDecision + DesignOpenQuestion
--  4. Auto-capturado   → DesignSessionResearch
--
-- RLS replica padrão: is_manager() bypass; can_view_project()/can_edit_sessions()
-- gating por ProjectAccess. Service-role bypassa via SUPABASE_SERVICE_ROLE_KEY.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Project: campos de memória narrativa ───────────────

ALTER TABLE public."Project"
  ADD COLUMN IF NOT EXISTS "memoryMd" text,
  ADD COLUMN IF NOT EXISTS "memoryUpdatedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "memoryVersion" integer NOT NULL DEFAULT 0;

-- ─── 2. DesignSession: campos de memória narrativa ─────────

ALTER TABLE public."DesignSession"
  ADD COLUMN IF NOT EXISTS "memoryMd" text,
  ADD COLUMN IF NOT EXISTS "memoryAbstract" text,
  ADD COLUMN IF NOT EXISTS "memoryUpdatedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "memoryVersion" integer NOT NULL DEFAULT 0;

-- ─── 3. ProjectBusinessContext (1:1 com Project) ───────────

CREATE TABLE IF NOT EXISTS public."ProjectBusinessContext" (
  "projectId"      text PRIMARY KEY REFERENCES public."Project"(id) ON DELETE CASCADE,
  "businessModel"  text,
  stage            text,
  icp              text,
  "ticketRangeBrl" int4range,
  "runwayMonths"   integer,
  competitors      jsonb,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedBy"      uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."ProjectBusinessContext" TO anon, authenticated;

ALTER TABLE public."ProjectBusinessContext" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."ProjectBusinessContext"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "manager_or_editor_insert" ON public."ProjectBusinessContext"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_update" ON public."ProjectBusinessContext"
  FOR UPDATE USING (public.is_manager() OR public.can_edit_sessions("projectId"));

-- ─── 4. DesignDecision (estruturada) ───────────────────────

CREATE TABLE IF NOT EXISTS public."DesignDecision" (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId"    text NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "projectId"    text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  statement      text NOT NULL,
  rationale      text NOT NULL,
  confidence     text NOT NULL CHECK (confidence IN ('hard_fact', 'inferred', 'assumption')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'under_review', 'reverted')),
  "supersededBy" text REFERENCES public."DesignDecision"(id) ON DELETE SET NULL,
  tags           text[],
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "createdBy"    text NOT NULL,
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "DesignDecision_projectId_status_idx"
  ON public."DesignDecision" ("projectId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "DesignDecision_sessionId_status_idx"
  ON public."DesignDecision" ("sessionId", status);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."DesignDecision" TO anon, authenticated;

ALTER TABLE public."DesignDecision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."DesignDecision"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "manager_or_editor_insert" ON public."DesignDecision"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_update" ON public."DesignDecision"
  FOR UPDATE USING (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_delete" ON public."DesignDecision"
  FOR DELETE USING (public.is_manager() OR public.can_edit_sessions("projectId"));

-- ─── 5. DesignOpenQuestion (estruturada) ───────────────────

CREATE TABLE IF NOT EXISTS public."DesignOpenQuestion" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId"  text NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "projectId"  text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  question     text NOT NULL,
  "blocksWhat" text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'obsolete')),
  answer       text,
  "answeredAt" timestamptz,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "DesignOpenQuestion_sessionId_status_idx"
  ON public."DesignOpenQuestion" ("sessionId", status);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."DesignOpenQuestion" TO anon, authenticated;

ALTER TABLE public."DesignOpenQuestion" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."DesignOpenQuestion"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "manager_or_editor_insert" ON public."DesignOpenQuestion"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_update" ON public."DesignOpenQuestion"
  FOR UPDATE USING (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_delete" ON public."DesignOpenQuestion"
  FOR DELETE USING (public.is_manager() OR public.can_edit_sessions("projectId"));

-- ─── 6. DesignSessionResearch (auto-capturado) ─────────────

CREATE TABLE IF NOT EXISTS public."DesignSessionResearch" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId" text NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "projectId" text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  query       text NOT NULL,
  summary     text NOT NULL,
  sources     jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "DesignSessionResearch_sessionId_idx"
  ON public."DesignSessionResearch" ("sessionId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "DesignSessionResearch_projectId_idx"
  ON public."DesignSessionResearch" ("projectId", "createdAt" DESC);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."DesignSessionResearch" TO anon, authenticated;

ALTER TABLE public."DesignSessionResearch" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."DesignSessionResearch"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
-- INSERT/UPDATE/DELETE só via service-role (agente). Sem policy = bloqueado pra anon/authenticated.
