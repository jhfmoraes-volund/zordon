-- ═══════════════════════════════════════════════════════════
-- MeetingPersonalNote — private notes per (meeting, member)
--
-- Each row is one member's private notes for one meeting. The block is
-- strictly private: NO bypass for manager/admin. The only way to read a
-- given row is to be authenticated as the member who owns it.
--
-- Built on the existing `public.get_my_member_id()` helper which resolves
-- the current `auth.uid()` to a Member.id.
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public."MeetingPersonalNote" (
  "meetingId" uuid NOT NULL REFERENCES public."Meeting"(id) ON DELETE CASCADE,
  "memberId"  uuid NOT NULL REFERENCES public."Member"(id) ON DELETE CASCADE,
  content     text NOT NULL DEFAULT '',
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("meetingId", "memberId")
);

CREATE INDEX "MeetingPersonalNote_memberId_idx"
  ON public."MeetingPersonalNote"("memberId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MeetingPersonalNote" TO anon, authenticated;

ALTER TABLE public."MeetingPersonalNote" ENABLE ROW LEVEL SECURITY;

-- Self-only policies. No is_manager()/is_admin() bypass on purpose:
-- a "private" note must remain private even from workspace admins.
CREATE POLICY "self_select" ON public."MeetingPersonalNote"
  FOR SELECT USING ("memberId" = public.get_my_member_id());

CREATE POLICY "self_insert" ON public."MeetingPersonalNote"
  FOR INSERT WITH CHECK ("memberId" = public.get_my_member_id());

CREATE POLICY "self_update" ON public."MeetingPersonalNote"
  FOR UPDATE
  USING ("memberId" = public.get_my_member_id())
  WITH CHECK ("memberId" = public.get_my_member_id());

CREATE POLICY "self_delete" ON public."MeetingPersonalNote"
  FOR DELETE USING ("memberId" = public.get_my_member_id());

COMMIT;
