-- ============================================================
-- Drop Meeting.status
--
-- O campo `status` (scheduled/in_progress/done) era atualizado
-- manualmente via botões "Iniciar reunião / Concluir / Reabrir".
-- A UI agora deriva o status pela data da reunião, e o carry-over
-- de Todos pendentes filtra por `date < now()` em vez de
-- `status = 'done'`. A coluna virou inerte.
--
-- 1. Recria a RPC `create_meeting_with_reviews` sem inserir status.
-- 2. Dropa a coluna Meeting.status.
-- ============================================================

BEGIN;

-- ── 1. RPC sem status ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_meeting_with_reviews(
  timestamptz, jsonb, jsonb, text, text, jsonb, jsonb, text, text
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
    (id, date, "type", title, notes, "sprintId", "createdAt", "updatedAt")
  VALUES
    (v_meeting_id, p_date, p_type, p_title, p_notes, p_sprint_id, now(), now());

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

  -- Carry-over Todos
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

-- ── 2. Drop column ────────────────────────────────────────
ALTER TABLE public."Meeting" DROP COLUMN status;

COMMIT;
