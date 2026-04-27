-- ============================================================
-- Meetings: Daily + Super Planning + Task Action proposals
--
-- 1. Adiciona tipos 'daily' e 'super_planning' ao Meeting
-- 2. Meeting.sprintId — usado por super_planning (fixa a sprint
--    objeto do planning daquela segunda-feira)
-- 3. Cria MeetingTaskAction — propostas de mudança em Tasks
--    discutidas em reuniões (daily / super_planning), com
--    aprovação manual e execução em batch via "Aplicar plano".
-- 4. Atualiza RPC create_meeting_with_reviews para aceitar
--    p_sprint_id.
-- 5. Wipe das Todos antigas (fresh start, conforme alinhado).
-- ============================================================

BEGIN;

-- ── 1. Meeting.type — aceita daily + super_planning ───────
ALTER TABLE public."Meeting"
  DROP CONSTRAINT IF EXISTS "Meeting_type_check";

ALTER TABLE public."Meeting"
  ADD CONSTRAINT "Meeting_type_check"
  CHECK ("type" IN ('pm_review', 'general', 'daily', 'super_planning'));

-- ── 2. Meeting.sprintId ───────────────────────────────────
ALTER TABLE public."Meeting"
  ADD COLUMN "sprintId" text
  REFERENCES public."Sprint"(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX "Meeting_sprintId_idx"
  ON public."Meeting" ("sprintId") WHERE "sprintId" IS NOT NULL;

-- ── 3. MeetingTaskAction ──────────────────────────────────
-- Propostas de ação sobre Tasks discutidas em reunião.
-- Lifecycle: decision (pending/approved/rejected) +
--            execution (pending/applied/failed/skipped)
--            separados pra permitir aprovar durante a reunião
--            e aplicar em batch num momento separado.
CREATE TABLE public."MeetingTaskAction" (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "meetingId"       text NOT NULL
    REFERENCES public."Meeting"(id) ON DELETE CASCADE,
  "projectId"       text NOT NULL
    REFERENCES public."Project"(id) ON DELETE CASCADE,

  -- Tipo de ação
  "type"            text NOT NULL
    CHECK ("type" IN ('create','update','delete','move','review')),

  -- Task afetada (NULL pra 'create' até ser aplicada)
  "taskId"          text
    REFERENCES public."Task"(id) ON UPDATE CASCADE ON DELETE SET NULL,

  -- Sprint destino (só pra 'move')
  "targetSprintId"  text
    REFERENCES public."Sprint"(id) ON UPDATE CASCADE ON DELETE SET NULL,

  -- Payload — campos propostos (create/update) ou config (review)
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle de aprovação
  decision          text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','approved','rejected')),
  "decidedAt"       timestamptz,
  "decidedById"     text REFERENCES public."Member"(id) ON DELETE SET NULL,
  "wasEdited"       boolean NOT NULL DEFAULT false,

  -- Lifecycle de execução
  execution         text NOT NULL DEFAULT 'pending'
    CHECK (execution IN ('pending','applied','failed','skipped')),
  "appliedAt"       timestamptz,
  "errorMessage"    text,

  -- Origem
  source            text NOT NULL
    CHECK (source IN ('ai','manual')),
  "aiReasoning"     text,
  "aiConfidence"    numeric,

  -- Justificativa do PM (livre)
  notes             text,

  -- Específico do REVIEW (helper)
  "reviewReasons"   text[],
  "reviewNote"      text,

  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),

  -- Consistência: 'create' não tem taskId; outros tipos exigem taskId
  CONSTRAINT "MeetingTaskAction_taskId_consistency" CHECK (
    ("type" = 'create' AND "taskId" IS NULL)
    OR ("type" <> 'create' AND ("taskId" IS NOT NULL OR execution = 'applied'))
  ),

  -- Consistência: 'move' exige targetSprintId
  CONSTRAINT "MeetingTaskAction_move_consistency" CHECK (
    ("type" = 'move' AND "targetSprintId" IS NOT NULL)
    OR "type" <> 'move'
  )
);

CREATE INDEX "MeetingTaskAction_meeting_idx"
  ON public."MeetingTaskAction" ("meetingId", decision);
CREATE INDEX "MeetingTaskAction_project_idx"
  ON public."MeetingTaskAction" ("projectId");
CREATE INDEX "MeetingTaskAction_task_idx"
  ON public."MeetingTaskAction" ("taskId") WHERE "taskId" IS NOT NULL;

-- RLS — manager-only (espelha Meeting)
ALTER TABLE public."MeetingTaskAction" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MeetingTaskAction" TO anon, authenticated;

CREATE POLICY "manager_select" ON public."MeetingTaskAction"
  FOR SELECT TO authenticated USING (public.is_manager());
CREATE POLICY "manager_insert" ON public."MeetingTaskAction"
  FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY "manager_update" ON public."MeetingTaskAction"
  FOR UPDATE TO authenticated USING (public.is_manager());
CREATE POLICY "manager_delete" ON public."MeetingTaskAction"
  FOR DELETE TO authenticated USING (public.is_manager());

-- ── 4. RPC: create_meeting_with_reviews aceita p_sprint_id ─
DROP FUNCTION IF EXISTS public.create_meeting_with_reviews(
  timestamptz, jsonb, jsonb, text, text, jsonb, jsonb, text
);

CREATE OR REPLACE FUNCTION public.create_meeting_with_reviews(
  p_date timestamptz,
  p_reviews jsonb DEFAULT '[]'::jsonb,
  p_carry_actions jsonb DEFAULT '[]'::jsonb,
  p_type text DEFAULT 'pm_review',
  p_title text DEFAULT NULL,
  p_attendees jsonb DEFAULT '[]'::jsonb,
  p_project_ids jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL,
  p_sprint_id text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_meeting_id text;
BEGIN
  v_meeting_id := gen_random_uuid()::text;

  INSERT INTO public."Meeting"
    (id, date, status, "type", title, notes, "sprintId", "createdAt", "updatedAt")
  VALUES
    (v_meeting_id, p_date, 'scheduled', p_type, p_title, p_notes, p_sprint_id, now(), now());

  -- Project reviews (pm_review only)
  INSERT INTO public."MeetingProjectReview"
    (id, "meetingId", "projectId", "memberId", "order", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    v_meeting_id,
    r->>'projectId',
    r->>'memberId',
    (r->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_reviews) r;

  -- Attendees
  INSERT INTO public."MeetingAttendee"
    (id, "meetingId", "memberId", "externalName", "externalEmail", "externalRole", "role", "createdAt")
  SELECT
    gen_random_uuid()::text,
    v_meeting_id,
    NULLIF(a->>'memberId', ''),
    NULLIF(a->>'externalName', ''),
    NULLIF(a->>'externalEmail', ''),
    NULLIF(a->>'externalRole', ''),
    NULLIF(a->>'role', ''),
    now()
  FROM jsonb_array_elements(p_attendees) a
  WHERE COALESCE(a->>'memberId', a->>'externalName') IS NOT NULL;

  -- Project links (general / daily / super_planning)
  INSERT INTO public."MeetingProjectLink" ("meetingId", "projectId", "createdAt")
  SELECT v_meeting_id, value::text, now()
  FROM jsonb_array_elements_text(p_project_ids)
  ON CONFLICT DO NOTHING;

  -- Carry-over Todos do último meeting concluído.
  -- meetingId é obrigatório com source='meeting', então passamos
  -- o id da nova meeting (carry over = novo registro pra meeting nova).
  -- assigneeId vira createdById também (audit defensivo).
  INSERT INTO public."Todo"
    (id, "meetingId", description, "assigneeId", "createdById",
     "dueDate", status, source, "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    v_meeting_id,
    a->>'description',
    a->>'assigneeId',
    a->>'assigneeId',
    NULLIF(a->>'dueDate', '')::timestamptz,
    'todo',
    'meeting',
    now(),
    now()
  FROM jsonb_array_elements(p_carry_actions) a
  WHERE a->>'description' IS NOT NULL;

  RETURN v_meeting_id;
END;
$$;

-- ── 5. Wipe Todos antigas (fresh start) ───────────────────
DELETE FROM public."Todo";

COMMIT;
