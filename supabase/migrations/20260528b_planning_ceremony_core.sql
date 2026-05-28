-- ═══════════════════════════════════════════════════════════
-- Planning Ceremony — core schema.
--
-- 4 mudanças:
--   1. Project.planningCadence + Project.planningActive (2 colunas)
--   2. PlanningCeremony (artefato central — NÃO funde com Meeting)
--   3. PlanningMeetingLink (N:N tipado planning↔meeting)
--   4. PlanningTranscriptLink (N:N tipado planning↔transcript, com weight)
--
-- Decisão SQL-first (2026-05-27, pós-aprendizado DesignSession):
--   • cada conceito = tabela. Sem jsonb.
--   • links tipados próprios (FK real), não MeetingArtifactLink polimórfico.
--   • PlanningCeremony separado de Meeting respeita fronteira EVENTO↔ARTEFATO.
--   • 1 série por projeto vira 2 colunas no Project — sem ProjectCeremonySeries.
--
-- Visibility: PlanningCeremony segue can_view_project. Links: precisa ver
-- ambos os lados (planning + meeting/transcript). Manager bypass via is_manager().
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Project — cadência inline
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."Project"
  ADD COLUMN IF NOT EXISTS "planningCadence" text,
  ADD COLUMN IF NOT EXISTS "planningActive" boolean NOT NULL DEFAULT false;

ALTER TABLE public."Project"
  DROP CONSTRAINT IF EXISTS "Project_planningCadence_check";
ALTER TABLE public."Project"
  ADD CONSTRAINT "Project_planningCadence_check"
  CHECK ("planningCadence" IS NULL OR "planningCadence" = ANY (ARRAY['weekly'::text, 'biweekly'::text]));

-- ═════════════════════════════════════════════════════════════════════════
-- 2. PlanningCeremony — artefato central
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PlanningCeremony" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"            uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "sprintId"             uuid REFERENCES public."Sprint"(id) ON DELETE SET NULL,
  phase                  text NOT NULL DEFAULT 'idle',
  "scheduledFor"         timestamptz,
  "startedAt"            timestamptz,
  "briefingGeneratedAt"  timestamptz,
  "closedAt"             timestamptz,
  "archivedAt"           timestamptz,
  "facilitatorId"        uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PlanningCeremony_project_sprint_key" UNIQUE ("projectId", "sprintId")
);

ALTER TABLE public."PlanningCeremony"
  DROP CONSTRAINT IF EXISTS "PlanningCeremony_phase_check";
ALTER TABLE public."PlanningCeremony"
  ADD CONSTRAINT "PlanningCeremony_phase_check"
  CHECK (phase = ANY (ARRAY[
    'idle'::text, 'reading'::text, 'proposing'::text,
    'approving'::text, 'closed'::text, 'archived'::text
  ]));

CREATE INDEX IF NOT EXISTS "PlanningCeremony_projectId_phase_idx"
  ON public."PlanningCeremony" ("projectId", phase)
  WHERE phase NOT IN ('closed', 'archived');

CREATE INDEX IF NOT EXISTS "PlanningCeremony_sprintId_idx"
  ON public."PlanningCeremony" ("sprintId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PlanningCeremony" TO authenticated;

ALTER TABLE public."PlanningCeremony" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planningceremony_select" ON public."PlanningCeremony"
  FOR SELECT USING (
    public.is_manager() OR public.can_view_project("projectId")
  );

CREATE POLICY "planningceremony_insert" ON public."PlanningCeremony"
  FOR INSERT WITH CHECK (
    public.is_manager() OR public.can_view_project("projectId")
  );

CREATE POLICY "planningceremony_update" ON public."PlanningCeremony"
  FOR UPDATE
  USING (public.is_manager() OR public.can_view_project("projectId"))
  WITH CHECK (public.is_manager() OR public.can_view_project("projectId"));

CREATE POLICY "planningceremony_delete" ON public."PlanningCeremony"
  FOR DELETE USING (
    public.is_manager()
    OR ("facilitatorId" = public.get_my_member_id())
  );

-- Auto-touch updatedAt em UPDATE.
CREATE OR REPLACE FUNCTION public.tg_planning_ceremony_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "PlanningCeremony_touch_updated_at" ON public."PlanningCeremony";
CREATE TRIGGER "PlanningCeremony_touch_updated_at"
  BEFORE UPDATE ON public."PlanningCeremony"
  FOR EACH ROW EXECUTE FUNCTION public.tg_planning_ceremony_touch_updated_at();

COMMENT ON TABLE public."PlanningCeremony" IS
  'Artefato de planning ceremony por (projeto, sprint). Separada de Meeting (fronteira EVENTO↔ARTEFATO). Phase governada pela state machine em src/lib/planning/phase.ts.';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. PlanningMeetingLink — N:N planning↔meeting (TIPADO)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PlanningMeetingLink" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningCeremonyId" uuid NOT NULL REFERENCES public."PlanningCeremony"(id) ON DELETE CASCADE,
  "meetingId"          uuid NOT NULL REFERENCES public."Meeting"(id) ON DELETE CASCADE,
  "linkedById"         uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "linkedAt"           timestamptz NOT NULL DEFAULT now(),
  note                 text,
  CONSTRAINT "PlanningMeetingLink_planning_meeting_key" UNIQUE ("planningCeremonyId", "meetingId")
);

CREATE INDEX IF NOT EXISTS "PlanningMeetingLink_planning_idx"
  ON public."PlanningMeetingLink" ("planningCeremonyId");

CREATE INDEX IF NOT EXISTS "PlanningMeetingLink_meeting_idx"
  ON public."PlanningMeetingLink" ("meetingId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PlanningMeetingLink" TO authenticated;

ALTER TABLE public."PlanningMeetingLink" ENABLE ROW LEVEL SECURITY;

-- Visível se vê AMBOS os lados.
CREATE POLICY "planningmeetinglink_select" ON public."PlanningMeetingLink"
  FOR SELECT USING (
    public.is_manager()
    OR (
      EXISTS (
        SELECT 1 FROM public."PlanningCeremony" pc
        WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
      )
      AND public.can_view_meeting("meetingId")
    )
  );

CREATE POLICY "planningmeetinglink_insert" ON public."PlanningMeetingLink"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR (
      EXISTS (
        SELECT 1 FROM public."PlanningCeremony" pc
        WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
      )
      AND public.can_view_meeting("meetingId")
    )
  );

CREATE POLICY "planningmeetinglink_delete" ON public."PlanningMeetingLink"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

-- Update raro (só `note`). Mesma regra do delete.
CREATE POLICY "planningmeetinglink_update" ON public."PlanningMeetingLink"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 4. PlanningTranscriptLink — N:N planning↔transcript (com weight)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PlanningTranscriptLink" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningCeremonyId" uuid NOT NULL REFERENCES public."PlanningCeremony"(id) ON DELETE CASCADE,
  "transcriptRefId"    uuid NOT NULL REFERENCES public."TranscriptRef"(id) ON DELETE CASCADE,
  "linkedById"         uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "linkedAt"           timestamptz NOT NULL DEFAULT now(),
  weight               text,
  note                 text,
  CONSTRAINT "PlanningTranscriptLink_planning_transcript_key"
    UNIQUE ("planningCeremonyId", "transcriptRefId")
);

ALTER TABLE public."PlanningTranscriptLink"
  DROP CONSTRAINT IF EXISTS "PlanningTranscriptLink_weight_check";
ALTER TABLE public."PlanningTranscriptLink"
  ADD CONSTRAINT "PlanningTranscriptLink_weight_check"
  CHECK (weight IS NULL OR weight = ANY (ARRAY['primary'::text, 'supporting'::text, 'background'::text]));

CREATE INDEX IF NOT EXISTS "PlanningTranscriptLink_planning_idx"
  ON public."PlanningTranscriptLink" ("planningCeremonyId");

CREATE INDEX IF NOT EXISTS "PlanningTranscriptLink_transcript_idx"
  ON public."PlanningTranscriptLink" ("transcriptRefId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PlanningTranscriptLink" TO authenticated;

ALTER TABLE public."PlanningTranscriptLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planningtranscriptlink_select" ON public."PlanningTranscriptLink"
  FOR SELECT USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

CREATE POLICY "planningtranscriptlink_insert" ON public."PlanningTranscriptLink"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

CREATE POLICY "planningtranscriptlink_update" ON public."PlanningTranscriptLink"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

CREATE POLICY "planningtranscriptlink_delete" ON public."PlanningTranscriptLink"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

COMMIT;
