-- ═══════════════════════════════════════════════════════════
-- Volund Migration Helpers — Execute no Supabase Dashboard > SQL Editor
-- Pré-requisito para migração Prisma → Supabase
-- ═══════════════════════════════════════════════════════════

-- ─── RPCs ─────────────────────────────────────────────────

-- 1. Tasks sem assignment em sprints ativos
CREATE OR REPLACE FUNCTION public.unassigned_active_task_count()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT count(*)
  FROM public."Task" t
  WHERE t."sprintId" IN (
    SELECT id FROM public."Sprint" WHERE status = 'active'
  )
  AND t.status IN ('todo','in_progress','review','changes_requested')
  AND NOT EXISTS (
    SELECT 1 FROM public."TaskAssignment" ta WHERE ta."taskId" = t.id
  )
$$;

-- 2. Wiki sections batch create (substitui $transaction)
CREATE OR REPLACE FUNCTION public.ensure_wiki_sections(
  p_project_id text,
  p_sections jsonb
) RETURNS SETOF public."ProjectWikiSection" LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public."ProjectWikiSection" (id, "projectId", "sectionKey", title, data, "order", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    p_project_id,
    s->>'sectionKey',
    s->>'title',
    COALESCE(s->'data', '[]'::jsonb),
    (s->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_sections) s
  ON CONFLICT ("projectId", "sectionKey") DO NOTHING;

  RETURN QUERY
  SELECT * FROM public."ProjectWikiSection"
  WHERE "projectId" = p_project_id
  ORDER BY "order";
END;
$$;

-- 3. Meeting creation atômica (substitui nested create + carryover)
CREATE OR REPLACE FUNCTION public.create_meeting_with_reviews(
  p_date timestamptz,
  p_reviews jsonb,
  p_carry_actions jsonb DEFAULT '[]'::jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_meeting_id text;
BEGIN
  v_meeting_id := gen_random_uuid()::text;

  -- Create meeting
  INSERT INTO public."WeeklyMeeting" (id, date, status, "createdAt", "updatedAt")
  VALUES (v_meeting_id, p_date, 'scheduled', now(), now());

  -- Create project reviews
  INSERT INTO public."MeetingProjectReview" (id, "meetingId", "projectId", "memberId", "order", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    v_meeting_id,
    r->>'projectId',
    r->>'memberId',
    (r->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_reviews) r;

  -- Carry over pending actions from previous meeting
  INSERT INTO public."MeetingActionItem" (id, "meetingId", description, "assigneeId", "dueDate", status, "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    v_meeting_id,
    a->>'description',
    a->>'assigneeId',
    (a->>'dueDate')::timestamptz,
    'todo',
    now(),
    now()
  FROM jsonb_array_elements(p_carry_actions) a
  WHERE a->>'description' IS NOT NULL;

  RETURN v_meeting_id;
END;
$$;

-- ─── Views ────────────────────────────────────────────────

-- Design sessions com contagem de items
CREATE OR REPLACE VIEW public.design_session_summary AS
SELECT
  ds.*,
  COUNT(dsi.id)::int AS item_count
FROM public."DesignSession" ds
LEFT JOIN public."DesignSessionItem" dsi ON dsi."sessionId" = ds.id
GROUP BY ds.id;

-- Membros com contagens de squads e tasks ativas
CREATE OR REPLACE VIEW public.member_summary AS
SELECT
  m.*,
  (SELECT count(*) FROM public."SquadMember" sm WHERE sm."memberId" = m.id)::int AS squad_count,
  (SELECT count(*) FROM public."TaskAssignment" ta
   JOIN public."Task" t ON t.id = ta."taskId"
   WHERE ta."memberId" = m.id
   AND t.status IN ('todo','in_progress','review','changes_requested'))::int AS active_task_count
FROM public."Member" m;

-- Clients com contagem de projetos
CREATE OR REPLACE VIEW public.client_summary AS
SELECT
  c.*,
  (SELECT count(*) FROM public."Project" p WHERE p."clientId" = c.id)::int AS project_count
FROM public."Client" c;

-- ═══════════════════════════════════════════════════════════
-- Verificação:
--   SELECT public.unassigned_active_task_count();
--   SELECT * FROM public.design_session_summary LIMIT 3;
--   SELECT * FROM public.member_summary LIMIT 3;
--   SELECT * FROM public.client_summary LIMIT 3;
-- ═══════════════════════════════════════════════════════════
