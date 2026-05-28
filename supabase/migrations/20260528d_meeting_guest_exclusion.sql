-- Meeting guest exclusion: guests never see public meetings, even if attendee.
-- Private meetings stay creator-only as before (no change needed there).
-- All `public` visibility branches now require access_level <> 'guest'.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_view_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    -- private: só quem criou, sem admin bypass.
    EXISTS (
      SELECT 1
      FROM public."Meeting" m
      WHERE m.id = p_meeting_id
        AND m."visibility" = 'private'
        AND m."createdById" = public.get_my_member_id()
        AND public.get_my_member_id() IS NOT NULL
    )
    OR (
      -- public: admin vê tudo (admin nunca é guest).
      public.is_admin()
      AND public.get_my_access_level() <> 'guest'
      AND EXISTS (
        SELECT 1 FROM public."Meeting" m
        WHERE m.id = p_meeting_id AND m."visibility" = 'public'
      )
    )
    OR (
      -- public: attendee vê, desde que não seja guest.
      public.get_my_access_level() <> 'guest'
      AND EXISTS (
        SELECT 1
        FROM public."Meeting" m
        JOIN public."MeetingAttendee" a ON a."meetingId" = m.id
        WHERE m.id = p_meeting_id
          AND m."visibility" = 'public'
          AND a."memberId" = public.get_my_member_id()
      )
    )
    OR (
      -- public + linkada a projeto: PM do projeto vê (cerimônias legadas), desde que não seja guest.
      public.get_my_access_level() <> 'guest'
      AND EXISTS (
        SELECT 1
        FROM public."Meeting" m
        JOIN public."MeetingProjectLink" mpl ON mpl."meetingId" = m.id
        JOIN public."Project" p ON p.id = mpl."projectId"
        WHERE m.id = p_meeting_id
          AND m."visibility" = 'public'
          AND p."pmId" = public.get_my_member_id()
      )
    )
$$;

COMMIT;
