-- ═══════════════════════════════════════════════════════════
-- Member roles & access: RLS for Task and DesignSession*
-- Backfills member_id into auth.users.app_metadata so RLS can
-- check allocation (ProjectMember) directly from the JWT with
-- zero extra DB lookups per request.
-- ═══════════════════════════════════════════════════════════

-- ─── Helpers ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_member_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->'app_metadata'->>'member_id',
    ''
  )
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.get_my_role() IN ('pm', 'head-ops', 'ceo')
$$;

CREATE OR REPLACE FUNCTION public.is_allocated_to(p_project_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectMember"
    WHERE "memberId" = public.get_my_member_id()
      AND "projectId" = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.is_allocated_to(ds."projectId")
  )
$$;

-- ─── Index for ProjectMember lookups ───────────────────────
-- Speeds up is_allocated_to() by giving Postgres a covering index.

CREATE INDEX IF NOT EXISTS "ProjectMember_memberId_projectId_idx"
  ON public."ProjectMember" ("memberId", "projectId");

-- ─── Backfill member_id into auth.users.app_metadata ──────
-- For every Member with a linked userId, copy its id into the
-- auth user's app_metadata.member_id. New members get this set
-- at creation time (see src/app/api/members/route.ts).

UPDATE auth.users u
SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('member_id', m.id)
FROM public."Member" m
WHERE m."userId" = u.id
  AND (u.raw_app_meta_data->>'member_id') IS DISTINCT FROM m.id;

-- ─── Task: tighten mutations to manager OR allocated ──────
-- SELECT stays open (Builder vê tasks de projetos que vê).

DROP POLICY IF EXISTS "authenticated_insert" ON public."Task";
DROP POLICY IF EXISTS "authenticated_update" ON public."Task";
DROP POLICY IF EXISTS "authenticated_delete" ON public."Task";

CREATE POLICY "manager_or_allocated_insert" ON public."Task"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR public.is_allocated_to("projectId"));

CREATE POLICY "manager_or_allocated_update" ON public."Task"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.is_allocated_to("projectId"));

CREATE POLICY "manager_or_allocated_delete" ON public."Task"
  FOR DELETE TO authenticated
  USING (public.is_manager() OR public.is_allocated_to("projectId"));

-- ─── TaskAssignment & TaskIteration: derive via Task ──────

DROP POLICY IF EXISTS "authenticated_insert" ON public."TaskAssignment";
DROP POLICY IF EXISTS "authenticated_update" ON public."TaskAssignment";
DROP POLICY IF EXISTS "authenticated_delete" ON public."TaskAssignment";

CREATE POLICY "manager_or_allocated_insert" ON public."TaskAssignment"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskAssignment"."taskId"
      AND public.is_allocated_to(t."projectId")
  ));

CREATE POLICY "manager_or_allocated_update" ON public."TaskAssignment"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskAssignment"."taskId"
      AND public.is_allocated_to(t."projectId")
  ));

CREATE POLICY "manager_or_allocated_delete" ON public."TaskAssignment"
  FOR DELETE TO authenticated
  USING (public.is_manager() OR EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskAssignment"."taskId"
      AND public.is_allocated_to(t."projectId")
  ));

DROP POLICY IF EXISTS "authenticated_insert" ON public."TaskIteration";
DROP POLICY IF EXISTS "authenticated_update" ON public."TaskIteration";
DROP POLICY IF EXISTS "authenticated_delete" ON public."TaskIteration";

CREATE POLICY "manager_or_allocated_insert" ON public."TaskIteration"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskIteration"."taskId"
      AND public.is_allocated_to(t."projectId")
  ));

CREATE POLICY "manager_or_allocated_update" ON public."TaskIteration"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskIteration"."taskId"
      AND public.is_allocated_to(t."projectId")
  ));

CREATE POLICY "manager_or_allocated_delete" ON public."TaskIteration"
  FOR DELETE TO authenticated
  USING (public.is_manager() OR EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskIteration"."taskId"
      AND public.is_allocated_to(t."projectId")
  ));

-- ─── DesignSession: SELECT + mutations restricted ─────────

DROP POLICY IF EXISTS "authenticated_select" ON public."DesignSession";
DROP POLICY IF EXISTS "authenticated_insert" ON public."DesignSession";
DROP POLICY IF EXISTS "authenticated_update" ON public."DesignSession";
DROP POLICY IF EXISTS "authenticated_delete" ON public."DesignSession";

CREATE POLICY "manager_or_allocated_select" ON public."DesignSession"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.is_allocated_to("projectId"));

CREATE POLICY "manager_or_allocated_insert" ON public."DesignSession"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR public.is_allocated_to("projectId"));

CREATE POLICY "manager_or_allocated_update" ON public."DesignSession"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.is_allocated_to("projectId"));

CREATE POLICY "manager_or_allocated_delete" ON public."DesignSession"
  FOR DELETE TO authenticated
  USING (public.is_manager() OR public.is_allocated_to("projectId"));

-- ─── DesignSession children: derive via sessionId ─────────

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'DesignSessionParticipant',
    'DesignSessionStepData',
    'DesignSessionItem'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_select" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_insert" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_update" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_delete" ON public.%I', tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_allocated_select" ON public.%I
        FOR SELECT TO authenticated
        USING (public.can_access_session("sessionId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_allocated_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public.can_access_session("sessionId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_allocated_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (public.can_access_session("sessionId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_allocated_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (public.can_access_session("sessionId"))
    $p$, tbl);
  END LOOP;
END $$;

-- ─── WeeklyMeeting & children: manager-only (no allocation) ─

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'WeeklyMeeting',
    'MeetingProjectReview',
    'MeetingActionItem'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_select" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_insert" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_update" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_delete" ON public.%I', tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_select" ON public.%I
        FOR SELECT TO authenticated USING (public.is_manager())
    $p$, tbl);
    EXECUTE format($p$
      CREATE POLICY "manager_insert" ON public.%I
        FOR INSERT TO authenticated WITH CHECK (public.is_manager())
    $p$, tbl);
    EXECUTE format($p$
      CREATE POLICY "manager_update" ON public.%I
        FOR UPDATE TO authenticated USING (public.is_manager())
    $p$, tbl);
    EXECUTE format($p$
      CREATE POLICY "manager_delete" ON public.%I
        FOR DELETE TO authenticated USING (public.is_manager())
    $p$, tbl);
  END LOOP;
END $$;
