-- ═══════════════════════════════════════════════════════════
-- Volund RLS Setup — Execute no Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ─── Helper Functions ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role',
    ''
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.get_my_role() IN ('ceo', 'head-ops')
$$;

-- ─── Enable RLS on ALL tables ──────────────────────────────

ALTER TABLE public."Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Squad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectSquad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SquadMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Sprint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TaskAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TaskIteration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SprintDeploy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DesignSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DesignSessionParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DesignSessionStepData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DesignSessionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectGuideline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WeeklyMeeting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MeetingProjectReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MeetingActionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectWikiSection" ENABLE ROW LEVEL SECURITY;

-- ─── Member: everyone reads, only admins write ─────────────

CREATE POLICY "authenticated_read" ON public."Member"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_insert" ON public."Member"
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "admin_update" ON public."Member"
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "admin_delete" ON public."Member"
  FOR DELETE TO authenticated USING (public.is_admin());

-- ─── All other tables: authenticated full access ───────────
-- (App interno — todos autenticados podem ler e escrever)

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Client', 'Project', 'Squad', 'ProjectSquad',
      'ProjectMember', 'SquadMember', 'Sprint', 'Task',
      'TaskAssignment', 'TaskIteration', 'SprintDeploy',
      'DesignSession', 'DesignSessionParticipant',
      'DesignSessionStepData', 'DesignSessionItem',
      'ProjectGuideline', 'WeeklyMeeting',
      'MeetingProjectReview', 'MeetingActionItem',
      'ProjectWikiSection'
    ])
  LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated_select" ON public.%I FOR SELECT TO authenticated USING (true)',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "authenticated_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "authenticated_update" ON public.%I FOR UPDATE TO authenticated USING (true)',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "authenticated_delete" ON public.%I FOR DELETE TO authenticated USING (true)',
      tbl
    );
  END LOOP;
END $$;

-- ─── Table-level GRANT (Prisma tables don't grant by default) ──

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Client', 'Project', 'Squad', 'ProjectSquad',
      'Member', 'ProjectMember', 'SquadMember', 'Sprint', 'Task',
      'TaskAssignment', 'TaskIteration', 'SprintDeploy',
      'DesignSession', 'DesignSessionParticipant',
      'DesignSessionStepData', 'DesignSessionItem',
      'ProjectGuideline', 'WeeklyMeeting',
      'MeetingProjectReview', 'MeetingActionItem',
      'ProjectWikiSection'
    ])
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', tbl);
  END LOOP;
END $$;

-- ─── View: member_capacity_overview ────────────────────────

CREATE OR REPLACE VIEW public.member_capacity_overview AS
SELECT
  m.id,
  m.name,
  m.role,
  m."fpCapacity" AS fp_capacity,
  COALESCE(SUM(t."functionPoints") FILTER (
    WHERE t.status IN ('todo','in_progress','review','changes_requested')
  ), 0)::int AS fp_allocated,
  COUNT(ta.id) FILTER (
    WHERE t.status IN ('todo','in_progress','review','changes_requested')
  )::int AS active_task_count
FROM public."Member" m
LEFT JOIN public."TaskAssignment" ta ON ta."memberId" = m.id
LEFT JOIN public."Task" t ON t.id = ta."taskId"
GROUP BY m.id, m.name, m.role, m."fpCapacity";

-- ─── RPC: next_task_reference ──────────────────────────────

CREATE OR REPLACE FUNCTION public.next_task_reference()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  last_ref text;
  next_num int;
BEGIN
  SELECT reference INTO last_ref
  FROM public."Task"
  WHERE reference LIKE 'TASK-%'
  ORDER BY reference DESC
  LIMIT 1;

  next_num := COALESCE(
    (regexp_replace(last_ref, '^TASK-', ''))::int,
    0
  ) + 1;

  RETURN 'TASK-' || lpad(next_num::text, 3, '0');
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- Done! Verify with:
--   SELECT * FROM public.member_capacity_overview LIMIT 5;
--   SELECT public.next_task_reference();
-- ═══════════════════════════════════════════════════════════
