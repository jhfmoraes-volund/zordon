-- ═══════════════════════════════════════════════════════════
-- Meeting visibility — tier por tipo + criador.
--
-- Regras:
--   1. Admin (head-ops/ceo/cro): vê e edita TUDO.
--   2. PM:
--      - vê pm_review/general se atendeu (MeetingAttendee.memberId)
--      - vê daily/super_planning se é PM do projeto linkado
--        (MeetingProjectLink → Project.pmId = my_member_id)
--      - edita/deleta SÓ o que criou (Meeting.createdById)
--   3. Builder/Guest: sem acesso.
--
-- Trade-off: meetings antigos têm createdById NULL. Na prática,
-- só admin edita esses até a próxima criação. Aceitável.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Coluna Meeting.createdById ─────────────────────────

ALTER TABLE public."Meeting"
  ADD COLUMN IF NOT EXISTS "createdById" text;

ALTER TABLE public."Meeting"
  DROP CONSTRAINT IF EXISTS "Meeting_createdById_fkey";

ALTER TABLE public."Meeting"
  ADD CONSTRAINT "Meeting_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES public."Member"(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Meeting_createdById_idx"
  ON public."Meeting" ("createdById")
  WHERE "createdById" IS NOT NULL;

COMMENT ON COLUMN public."Meeting"."createdById" IS
  'Member que criou esta meeting. NULL = legacy (criada antes do tracking). Admin sempre pode editar; PM só edita o que criou.';

-- ─── 2. Helpers RLS ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_view_meeting(p_meeting_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      -- pm_review / general: visibilidade por attendance
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingAttendee" a ON a."meetingId" = m.id
      WHERE m.id = p_meeting_id
        AND m.type IN ('pm_review','general')
        AND a."memberId" = public.get_my_member_id()
    )
    OR EXISTS (
      -- daily / super_planning: visibilidade por PM do projeto linkado
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingProjectLink" mpl ON mpl."meetingId" = m.id
      JOIN public."Project" p ON p.id = mpl."projectId"
      WHERE m.id = p_meeting_id
        AND m.type IN ('daily','super_planning')
        AND p."pmId" = public.get_my_member_id()
    )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_meeting(p_meeting_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public."Meeting"
      WHERE id = p_meeting_id
        AND "createdById" = public.get_my_member_id()
        AND public.get_my_member_id() <> ''
    )
$$;

-- ─── 3. RLS na Meeting ─────────────────────────────────────

DROP POLICY IF EXISTS "manager_select" ON public."Meeting";
DROP POLICY IF EXISTS "manager_insert" ON public."Meeting";
DROP POLICY IF EXISTS "manager_update" ON public."Meeting";
DROP POLICY IF EXISTS "manager_delete" ON public."Meeting";

CREATE POLICY "tier_select" ON public."Meeting"
  FOR SELECT TO authenticated
  USING (public.can_view_meeting(id));

-- INSERT: qualquer manager (pm/admin) cria meeting; createdById
-- é setado pelo app (POST /api/meetings) com o member do caller.
CREATE POLICY "manager_insert" ON public."Meeting"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

CREATE POLICY "creator_or_admin_update" ON public."Meeting"
  FOR UPDATE TO authenticated
  USING (public.can_edit_meeting(id));

CREATE POLICY "creator_or_admin_delete" ON public."Meeting"
  FOR DELETE TO authenticated
  USING (public.can_edit_meeting(id));

-- ─── 4. RLS nos filhos (MeetingAttendee, MeetingProjectLink,
--     MeetingProjectReview, MeetingTaskAction) ─────────────

DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'MeetingAttendee',
    'MeetingProjectLink',
    'MeetingProjectReview',
    'MeetingTaskAction'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "manager_select" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_insert" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_update" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_delete" ON public.%I', tbl);

    EXECUTE format($p$
      CREATE POLICY "tier_select" ON public.%I
        FOR SELECT TO authenticated
        USING (public.can_view_meeting("meetingId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "creator_or_admin_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public.can_edit_meeting("meetingId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "creator_or_admin_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (public.can_edit_meeting("meetingId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "creator_or_admin_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (public.can_edit_meeting("meetingId"))
    $p$, tbl);
  END LOOP;
END $$;
