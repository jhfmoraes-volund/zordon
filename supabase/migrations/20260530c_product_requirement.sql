-- 20260530c_product_requirement.sql
-- PRD = entidade de 1ª classe. Output do Vitor (reposicionado como PM).
-- Module continua como agrupador. UserStory permanece (legacy) — coexiste.
--
-- NOTA: runbook docs/runbooks/vitor-as-pm-runbook.md §2.1 manda usar fallback
-- "só manager edita" porque can_edit_project() ainda não existe no Postgres.

BEGIN;

-- ============================================================
-- 1) ProductRequirement
-- ============================================================
CREATE TABLE IF NOT EXISTS public."ProductRequirement" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "moduleId" uuid REFERENCES public."Module"(id) ON DELETE SET NULL,
  "designSessionId" uuid REFERENCES public."DesignSession"(id) ON DELETE SET NULL,

  reference text NOT NULL,                       -- ex: EVZL-PRD-001
  title text NOT NULL,
  "oneLiner" text NOT NULL DEFAULT '',
  "personaIds" uuid[] NOT NULL DEFAULT '{}',

  problem text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  "userJourney" jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{actor, action, expectation}]
  "acceptanceCriteria" jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{given, when, then}]
  "successMetrics" jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{metric, baseline?, target}]
  "outOfScope" text[] NOT NULL DEFAULT '{}',
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,         -- [{prdId, kind}]
  "technicalNotes" text NOT NULL DEFAULT '',
  "risksAndAssumptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sourceCardIds" text[] NOT NULL DEFAULT '{}',

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','approved','superseded')),
  version int NOT NULL DEFAULT 1,
  markdown text NOT NULL DEFAULT '',

  "approvedAt" timestamptz,
  "approvedBy" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "dismissedAt" timestamptz,

  CONSTRAINT prd_reference_per_project UNIQUE ("projectId", reference)
);

CREATE INDEX IF NOT EXISTS prd_project_idx        ON public."ProductRequirement"("projectId");
CREATE INDEX IF NOT EXISTS prd_module_idx         ON public."ProductRequirement"("moduleId");
CREATE INDEX IF NOT EXISTS prd_design_session_idx ON public."ProductRequirement"("designSessionId");
CREATE INDEX IF NOT EXISTS prd_status_idx         ON public."ProductRequirement"(status);

-- ============================================================
-- 2) ProductRequirementActivity (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public."ProductRequirementActivity" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productRequirementId" uuid NOT NULL REFERENCES public."ProductRequirement"(id) ON DELETE CASCADE,
  "actorMemberId" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "actorAgent" text,                              -- 'vitor' | 'vitoria' | 'system'
  kind text NOT NULL,                             -- 'created'|'updated'|'approved'|'superseded'|'materialized'
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,        -- {before, after} dos campos mudados
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prd_activity_prd_idx ON public."ProductRequirementActivity"("productRequirementId");

-- ============================================================
-- 3) Task.productRequirementId — handoff Vitoria
-- ============================================================
ALTER TABLE public."Task"
  ADD COLUMN IF NOT EXISTS "productRequirementId" uuid
    REFERENCES public."ProductRequirement"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS task_prd_idx ON public."Task"("productRequirementId");

-- Nota: na v1 NÃO ativamos CHECK forçando "exatamente uma FK preenchida"
-- (userStoryId xor productRequirementId). Coexistência permitida durante transição.
-- Quando todos US legacy migrarem (Fase 4 do PRD), adicionar:
--   CHECK ("userStoryId" IS NOT NULL OR "productRequirementId" IS NOT NULL)

-- ============================================================
-- 4) Trigger: markdown derivado
-- ============================================================
CREATE OR REPLACE FUNCTION public.prd_render_markdown(p public."ProductRequirement")
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  md text;
  ac jsonb;
  m  jsonb;
  dep jsonb;
  oos text;
BEGIN
  md := format('# [%s] %s', p.reference, p.title) || E'\n\n';
  md := md || coalesce(p."oneLiner", '') || E'\n\n';
  md := md || '## Problema' || E'\n' || coalesce(p.problem,'') || E'\n\n';
  md := md || '## Goal'     || E'\n' || coalesce(p.goal,'')    || E'\n\n';

  IF jsonb_array_length(p."acceptanceCriteria") > 0 THEN
    md := md || '## Acceptance Criteria' || E'\n';
    FOR ac IN SELECT * FROM jsonb_array_elements(p."acceptanceCriteria") LOOP
      md := md || format('- **Given** %s **When** %s **Then** %s',
              coalesce(ac->>'given',''), coalesce(ac->>'when',''), coalesce(ac->>'then','')) || E'\n';
    END LOOP;
    md := md || E'\n';
  END IF;

  IF jsonb_array_length(p."successMetrics") > 0 THEN
    md := md || '## Métricas' || E'\n';
    FOR m IN SELECT * FROM jsonb_array_elements(p."successMetrics") LOOP
      md := md || format('- %s: baseline %s → target %s',
              coalesce(m->>'metric',''), coalesce(m->>'baseline','n/a'), coalesce(m->>'target','')) || E'\n';
    END LOOP;
    md := md || E'\n';
  END IF;

  IF array_length(p."outOfScope", 1) > 0 THEN
    md := md || '## Out of scope' || E'\n';
    FOREACH oos IN ARRAY p."outOfScope" LOOP
      md := md || '- ' || oos || E'\n';
    END LOOP;
    md := md || E'\n';
  END IF;

  IF jsonb_array_length(p.dependencies) > 0 THEN
    md := md || '## Dependências' || E'\n';
    FOR dep IN SELECT * FROM jsonb_array_elements(p.dependencies) LOOP
      md := md || format('- %s: %s', coalesce(dep->>'kind','related'), coalesce(dep->>'prdId','')) || E'\n';
    END LOOP;
  END IF;

  RETURN md;
END $$;

CREATE OR REPLACE FUNCTION public.prd_set_markdown() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.markdown := public.prd_render_markdown(NEW);
  NEW."updatedAt" := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prd_set_markdown_trg ON public."ProductRequirement";
CREATE TRIGGER prd_set_markdown_trg
  BEFORE INSERT OR UPDATE ON public."ProductRequirement"
  FOR EACH ROW EXECUTE FUNCTION public.prd_set_markdown();

-- ============================================================
-- 5) RLS
-- ============================================================
ALTER TABLE public."ProductRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductRequirementActivity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prd_read     ON public."ProductRequirement";
DROP POLICY IF EXISTS prd_write    ON public."ProductRequirement";
DROP POLICY IF EXISTS prd_act_read ON public."ProductRequirementActivity";

-- Read: quem tem acesso ao projeto enxerga
CREATE POLICY prd_read ON public."ProductRequirement"
  FOR SELECT
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- Write: fallback manager-only (can_edit_project ainda não existe no schema —
-- runbook §2.1 prescreve este fallback). Quando o helper aparecer, trocar por
-- (public.is_manager() OR public.can_edit_project("projectId")).
CREATE POLICY prd_write ON public."ProductRequirement"
  FOR ALL
  USING  (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY prd_act_read ON public."ProductRequirementActivity"
  FOR SELECT
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."ProductRequirement" p
      WHERE p.id = "productRequirementId"
        AND public.can_view_project(p."projectId")
    )
  );

COMMIT;
