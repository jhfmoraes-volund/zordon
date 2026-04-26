-- ═══════════════════════════════════════════════════════════
-- Meetings: rename WeeklyMeeting → Meeting, add type/title,
-- new tables MeetingAttendee + MeetingProjectLink, recreate
-- create_meeting_with_reviews RPC and RLS policies.
-- ═══════════════════════════════════════════════════════════

-- ─── Rename WeeklyMeeting → Meeting ───────────────────────
-- Postgres carries FK references and existing RLS policies
-- across the rename, so MeetingActionItem.meetingId and
-- MeetingProjectReview.meetingId continue to point to the
-- renamed table.

ALTER TABLE public."WeeklyMeeting" RENAME TO "Meeting";

-- ─── New columns on Meeting ───────────────────────────────

ALTER TABLE public."Meeting"
  ADD COLUMN "type" text NOT NULL DEFAULT 'pm_review'
    CHECK ("type" IN ('pm_review', 'general'));

ALTER TABLE public."Meeting"
  ADD COLUMN "title" text;

-- ─── MeetingAttendee ──────────────────────────────────────
-- Used by both types:
--   pm_review : the selected PMs (role='pm')
--   general   : any member or external participant

CREATE TABLE public."MeetingAttendee" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "meetingId" text NOT NULL REFERENCES public."Meeting"("id") ON DELETE CASCADE,
  "memberId" text REFERENCES public."Member"("id") ON DELETE SET NULL,
  "externalName" text,
  "externalEmail" text,
  "externalRole" text,
  "role" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MeetingAttendee_member_or_external"
    CHECK ("memberId" IS NOT NULL OR "externalName" IS NOT NULL)
);

CREATE INDEX "MeetingAttendee_meetingId_idx"
  ON public."MeetingAttendee" ("meetingId");
CREATE INDEX "MeetingAttendee_memberId_idx"
  ON public."MeetingAttendee" ("memberId");

-- ─── MeetingProjectLink ───────────────────────────────────
-- Used by general meetings to associate one or more projects
-- without creating a structured MeetingProjectReview.
-- pm_review meetings still use MeetingProjectReview as before.

CREATE TABLE public."MeetingProjectLink" (
  "meetingId" text NOT NULL REFERENCES public."Meeting"("id") ON DELETE CASCADE,
  "projectId" text NOT NULL REFERENCES public."Project"("id") ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("meetingId", "projectId")
);

CREATE INDEX "MeetingProjectLink_projectId_idx"
  ON public."MeetingProjectLink" ("projectId");

-- ─── RLS: enable + manager-only on new tables ─────────────

ALTER TABLE public."MeetingAttendee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MeetingProjectLink" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MeetingAttendee" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MeetingProjectLink" TO anon, authenticated;

CREATE POLICY "manager_select" ON public."MeetingAttendee"
  FOR SELECT TO authenticated USING (public.is_manager());
CREATE POLICY "manager_insert" ON public."MeetingAttendee"
  FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY "manager_update" ON public."MeetingAttendee"
  FOR UPDATE TO authenticated USING (public.is_manager());
CREATE POLICY "manager_delete" ON public."MeetingAttendee"
  FOR DELETE TO authenticated USING (public.is_manager());

CREATE POLICY "manager_select" ON public."MeetingProjectLink"
  FOR SELECT TO authenticated USING (public.is_manager());
CREATE POLICY "manager_insert" ON public."MeetingProjectLink"
  FOR INSERT TO authenticated WITH CHECK (public.is_manager());
CREATE POLICY "manager_update" ON public."MeetingProjectLink"
  FOR UPDATE TO authenticated USING (public.is_manager());
CREATE POLICY "manager_delete" ON public."MeetingProjectLink"
  FOR DELETE TO authenticated USING (public.is_manager());

-- ─── Recreate create_meeting_with_reviews RPC ─────────────
-- Now points to Meeting (renamed). Adds optional p_type,
-- p_title, p_attendees, p_project_ids params.

CREATE OR REPLACE FUNCTION public.create_meeting_with_reviews(
  p_date timestamptz,
  p_reviews jsonb DEFAULT '[]'::jsonb,
  p_carry_actions jsonb DEFAULT '[]'::jsonb,
  p_type text DEFAULT 'pm_review',
  p_title text DEFAULT NULL,
  p_attendees jsonb DEFAULT '[]'::jsonb,
  p_project_ids jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_meeting_id text;
BEGIN
  v_meeting_id := gen_random_uuid()::text;

  INSERT INTO public."Meeting"
    (id, date, status, "type", title, notes, "createdAt", "updatedAt")
  VALUES
    (v_meeting_id, p_date, 'scheduled', p_type, p_title, p_notes, now(), now());

  -- Project reviews (pm_review only — caller passes [] for general)
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

  -- Attendees (members + externals)
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

  -- Project links (general meetings)
  INSERT INTO public."MeetingProjectLink" ("meetingId", "projectId", "createdAt")
  SELECT v_meeting_id, value::text, now()
  FROM jsonb_array_elements_text(p_project_ids)
  ON CONFLICT DO NOTHING;

  -- Carry-over actions from previous done meeting
  INSERT INTO public."MeetingActionItem"
    (id, "meetingId", description, "assigneeId", "dueDate", status, "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    v_meeting_id,
    a->>'description',
    a->>'assigneeId',
    NULLIF(a->>'dueDate', '')::timestamptz,
    'todo',
    now(),
    now()
  FROM jsonb_array_elements(p_carry_actions) a
  WHERE a->>'description' IS NOT NULL;

  RETURN v_meeting_id;
END;
$$;
