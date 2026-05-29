-- ═══════════════════════════════════════════════════════════
-- PM Review — ritual semanal onde Vitoria atua como "PM inteligente".
--
-- Tabela própria (não kind em PlanningCeremony) — Planning é staging-commit
-- (propostas → cascata de tasks), PM Review é síntese (report-driven, zero
-- cascata). Decisão refinada com João em 2026-05-29 (ver
-- docs/features/meetings/pm-review-plan.md).
--
-- 4 tabelas + 1 helper SQL + extend ChatThread.channel:
--   1. PMReview              — artefato (1 por projeto/semana).
--   2. PMReviewMeetingLink   — N:N tipado (espelha PlanningMeetingLink).
--   3. PMReviewTranscriptLink — N:N tipado com weight (espelha PlanningTranscriptLink).
--   4. PMReviewNote          — notes tipadas com 7 kinds (síntese da Vitoria).
--   + can_create_pm_review() — admin global OR ProjectAccess.role='lead'.
--   + ChatThread.channel += 'pm_review'.
--
-- Estados: draft → published → archived (sem state machine complexa;
-- published continua editável; archive é manual ou cron 90d).
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. PMReview — artefato central
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PMReview" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"         uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "referenceWeek"     date NOT NULL,
    -- segunda-feira da semana. CHECK abaixo garante.
  status              text NOT NULL DEFAULT 'draft',
  "reportMarkdown"    text,
    -- síntese gerada pela Vitoria. Exceção consciente ao princípio
    -- "rows tipadas, sem jsonb-light" — é 1 string monolítica gerada por IA,
    -- não dado consultável. Notes ficam na PMReviewNote (rows tipadas).
  "reportGeneratedAt" timestamptz,
  "facilitatorId"     uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "scheduledFor"      timestamptz,
  "publishedAt"       timestamptz,
  "archivedAt"        timestamptz,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PMReview_project_week_key" UNIQUE ("projectId", "referenceWeek")
);

ALTER TABLE public."PMReview"
  DROP CONSTRAINT IF EXISTS "PMReview_status_check";
ALTER TABLE public."PMReview"
  ADD CONSTRAINT "PMReview_status_check"
  CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]));

ALTER TABLE public."PMReview"
  DROP CONSTRAINT IF EXISTS "PMReview_referenceWeek_monday_check";
ALTER TABLE public."PMReview"
  ADD CONSTRAINT "PMReview_referenceWeek_monday_check"
  CHECK (EXTRACT(dow FROM "referenceWeek") = 1);

CREATE INDEX IF NOT EXISTS "PMReview_project_week_idx"
  ON public."PMReview" ("projectId", "referenceWeek" DESC);

CREATE INDEX IF NOT EXISTS "PMReview_status_idx"
  ON public."PMReview" (status) WHERE status != 'archived';

COMMENT ON TABLE public."PMReview" IS
  'Ritual semanal. Vitoria atua como "PM inteligente", sintetiza transcripts/sistema/código num report estruturado. Tabela própria, irmã de PlanningCeremony (semântica diferente: report-driven vs staging-commit).';
COMMENT ON COLUMN public."PMReview"."reportMarkdown" IS
  'Markdown monolítico gerado por IA (Vitoria). Notes consultáveis ficam em PMReviewNote.';

-- ─── 1.b helper SQL — permissão pra criar/editar PMReview ────────────────
CREATE OR REPLACE FUNCTION public.can_create_pm_review(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public."ProjectAccess"
      WHERE "userId" = auth.uid()
        AND "projectId" = p_project_id
        AND role = 'lead'
    );
$$;

COMMENT ON FUNCTION public.can_create_pm_review(uuid) IS
  'PM Review: só admin global OU ProjectAccess.role=lead. Helper espelhado em src/lib/roles.ts (canCreatePMReview).';

-- ─── 1.c RLS ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PMReview" TO authenticated;

ALTER TABLE public."PMReview" ENABLE ROW LEVEL SECURITY;

-- SELECT — todo mundo que vê o projeto vê o PM Review (read-only é "sempre consultado").
CREATE POLICY "pmreview_select" ON public."PMReview"
  FOR SELECT USING (
    public.is_manager() OR public.can_view_project("projectId")
  );

-- INSERT/UPDATE/DELETE — só PM (lead) ou admin global.
CREATE POLICY "pmreview_insert" ON public."PMReview"
  FOR INSERT WITH CHECK (
    public.is_manager() OR public.can_create_pm_review("projectId")
  );

CREATE POLICY "pmreview_update" ON public."PMReview"
  FOR UPDATE
  USING (public.is_manager() OR public.can_create_pm_review("projectId"))
  WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));

CREATE POLICY "pmreview_delete" ON public."PMReview"
  FOR DELETE USING (
    public.is_manager() OR public.can_create_pm_review("projectId")
  );

-- Touch updatedAt.
CREATE OR REPLACE FUNCTION public.tg_pm_review_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "PMReview_touch_updated_at" ON public."PMReview";
CREATE TRIGGER "PMReview_touch_updated_at"
  BEFORE UPDATE ON public."PMReview"
  FOR EACH ROW EXECUTE FUNCTION public.tg_pm_review_touch_updated_at();

-- ═════════════════════════════════════════════════════════════════════════
-- 2. PMReviewMeetingLink — N:N tipado (espelha PlanningMeetingLink)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PMReviewMeetingLink" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pmReviewId"  uuid NOT NULL REFERENCES public."PMReview"(id) ON DELETE CASCADE,
  "meetingId"   uuid NOT NULL REFERENCES public."Meeting"(id) ON DELETE CASCADE,
  "linkedById"  uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "linkedAt"    timestamptz NOT NULL DEFAULT now(),
  note          text,
  CONSTRAINT "PMReviewMeetingLink_pm_meeting_key" UNIQUE ("pmReviewId", "meetingId")
);

CREATE INDEX IF NOT EXISTS "PMReviewMeetingLink_pm_idx"
  ON public."PMReviewMeetingLink" ("pmReviewId");
CREATE INDEX IF NOT EXISTS "PMReviewMeetingLink_meeting_idx"
  ON public."PMReviewMeetingLink" ("meetingId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PMReviewMeetingLink" TO authenticated;
ALTER TABLE public."PMReviewMeetingLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmreviewmeetinglink_select" ON public."PMReviewMeetingLink"
  FOR SELECT USING (
    public.is_manager()
    OR (
      EXISTS (
        SELECT 1 FROM public."PMReview" pm
        WHERE pm.id = "pmReviewId" AND public.can_view_project(pm."projectId")
      )
      AND public.can_view_meeting("meetingId")
    )
  );

CREATE POLICY "pmreviewmeetinglink_insert" ON public."PMReviewMeetingLink"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR (
      EXISTS (
        SELECT 1 FROM public."PMReview" pm
        WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
      )
      AND public.can_view_meeting("meetingId")
    )
  );

CREATE POLICY "pmreviewmeetinglink_update" ON public."PMReviewMeetingLink"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmreviewmeetinglink_delete" ON public."PMReviewMeetingLink"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 3. PMReviewTranscriptLink — N:N tipado com weight (espelha PlanningTranscriptLink)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PMReviewTranscriptLink" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pmReviewId"      uuid NOT NULL REFERENCES public."PMReview"(id) ON DELETE CASCADE,
  "transcriptRefId" uuid NOT NULL REFERENCES public."TranscriptRef"(id) ON DELETE CASCADE,
  "linkedById"      uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "linkedAt"        timestamptz NOT NULL DEFAULT now(),
  weight            text,
  note              text,
  CONSTRAINT "PMReviewTranscriptLink_pm_transcript_key"
    UNIQUE ("pmReviewId", "transcriptRefId")
);

ALTER TABLE public."PMReviewTranscriptLink"
  DROP CONSTRAINT IF EXISTS "PMReviewTranscriptLink_weight_check";
ALTER TABLE public."PMReviewTranscriptLink"
  ADD CONSTRAINT "PMReviewTranscriptLink_weight_check"
  CHECK (weight IS NULL OR weight = ANY (ARRAY['primary'::text, 'supporting'::text, 'background'::text]));

CREATE INDEX IF NOT EXISTS "PMReviewTranscriptLink_pm_idx"
  ON public."PMReviewTranscriptLink" ("pmReviewId");
CREATE INDEX IF NOT EXISTS "PMReviewTranscriptLink_transcript_idx"
  ON public."PMReviewTranscriptLink" ("transcriptRefId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PMReviewTranscriptLink" TO authenticated;
ALTER TABLE public."PMReviewTranscriptLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmreviewtranscriptlink_select" ON public."PMReviewTranscriptLink"
  FOR SELECT USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_view_project(pm."projectId")
    )
  );

CREATE POLICY "pmreviewtranscriptlink_insert" ON public."PMReviewTranscriptLink"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmreviewtranscriptlink_update" ON public."PMReviewTranscriptLink"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmreviewtranscriptlink_delete" ON public."PMReviewTranscriptLink"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 4. PMReviewNote — notes tipadas (síntese da Vitoria)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PMReviewNote" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pmReviewId"          uuid NOT NULL REFERENCES public."PMReview"(id) ON DELETE CASCADE,
  kind                  text NOT NULL,
  content               text NOT NULL,
  "sourceTranscriptIds" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "sourceMeetingIds"    uuid[] NOT NULL DEFAULT '{}'::uuid[],
  priority              int NOT NULL DEFAULT 0,
  "dismissedAt"         timestamptz,
  "generatedAt"         timestamptz NOT NULL DEFAULT now(),
  "generatedByAgent"    text,
  "generatedByMemberId" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  CONSTRAINT "PMReviewNote_kind_check" CHECK (kind = ANY (ARRAY[
    'summary'::text,            -- panorama geral (entra no início do report)
    'project_direction'::text,  -- rumo do projeto
    'next_step'::text,
    'risk'::text,
    'need'::text,               -- recursos, decisões, inputs pendentes
    'team_signal'::text,        -- capacidade, moral, blockers do time
    'open_decision'::text
  ])),
  CONSTRAINT "PMReviewNote_generator_check" CHECK (
    ("generatedByAgent" IS NOT NULL AND "generatedByMemberId" IS NULL)
    OR ("generatedByAgent" IS NULL AND "generatedByMemberId" IS NOT NULL)
  ),
  CONSTRAINT "PMReviewNote_agent_check"
    CHECK ("generatedByAgent" IS NULL OR "generatedByAgent" = 'vitoria')
);

CREATE INDEX IF NOT EXISTS "PMReviewNote_pm_kind_idx"
  ON public."PMReviewNote" ("pmReviewId", kind) WHERE "dismissedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "PMReviewNote_pm_idx"
  ON public."PMReviewNote" ("pmReviewId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PMReviewNote" TO authenticated;
ALTER TABLE public."PMReviewNote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmreviewnote_select" ON public."PMReviewNote"
  FOR SELECT USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_view_project(pm."projectId")
    )
  );

CREATE POLICY "pmreviewnote_insert" ON public."PMReviewNote"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmreviewnote_update" ON public."PMReviewNote"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmreviewnote_delete" ON public."PMReviewNote"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = "pmReviewId" AND public.can_create_pm_review(pm."projectId")
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 5. ChatThread.channel — adiciona 'pm_review'
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."ChatThread" DROP CONSTRAINT IF EXISTS "ChatThread_channel_check";
ALTER TABLE public."ChatThread"
  ADD CONSTRAINT "ChatThread_channel_check"
  CHECK (channel = ANY (ARRAY[
    'web'::text,
    'telegram'::text,
    'trigger'::text,
    'briefing'::text,
    'planning'::text,
    'pm_review'::text
  ]));

COMMIT;
