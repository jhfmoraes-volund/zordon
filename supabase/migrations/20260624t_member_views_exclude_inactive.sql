-- ═══════════════════════════════════════════════════════════════════════════
-- Exclui membros DESATIVADOS das views públicas de roster/capacidade/commitment.
--
-- Depende de 20260624r. Espelha 20260527_exclude_guests_from_team_views.sql,
-- adicionando o predicado m."deactivatedAt" IS NULL ao lado do isGuest=false que
-- já existia. Cobre de uma vez todas as consumidoras: headcount, página /members,
-- relatórios de commitment (getBuilderCommitments / getMemberCommitment em
-- src/lib/dal/capacity.ts leem member_commitment_overview).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624t_member_views_exclude_inactive.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.member_summary CASCADE;
CREATE VIEW public.member_summary AS
  SELECT
    m.id,
    m.name,
    m.email,
    m.role,
    m.position,
    m."githubUsername",
    m."fpCapacity",
    m."createdAt",
    m."updatedAt",
    m."userId",
    ((SELECT count(*) FROM "SquadMember" sm WHERE sm."memberId" = m.id))::integer AS squad_count,
    ((SELECT count(*) FROM "TaskAssignment" ta
        JOIN "Task" t ON t.id = ta."taskId"
       WHERE ta."memberId" = m.id
         AND t.status = ANY (ARRAY['todo','in_progress','review','changes_requested']::text[])
    ))::integer AS active_task_count
  FROM "Member" m
  WHERE m."isGuest" = false AND m."deactivatedAt" IS NULL;

DROP VIEW IF EXISTS public.member_capacity_overview CASCADE;
CREATE VIEW public.member_capacity_overview AS
  SELECT
    m.id,
    m.name,
    m.role,
    m.position,
    m."fpCapacity" AS fp_capacity,
    COALESCE(
      sum(t."functionPoints") FILTER (
        WHERE t.status = ANY (ARRAY['todo','in_progress','review','changes_requested']::text[])
      ), 0::bigint
    )::integer AS fp_allocated,
    count(ta.id) FILTER (
      WHERE t.status = ANY (ARRAY['todo','in_progress','review','changes_requested']::text[])
    )::integer AS active_task_count
  FROM "Member" m
  LEFT JOIN "TaskAssignment" ta ON ta."memberId" = m.id
  LEFT JOIN "Task" t            ON t.id = ta."taskId"
  WHERE m."isGuest" = false AND m."deactivatedAt" IS NULL
  GROUP BY m.id, m.name, m.role, m.position, m."fpCapacity";

DROP VIEW IF EXISTS public.member_commitment_overview CASCADE;
CREATE VIEW public.member_commitment_overview AS
  SELECT
    m.id,
    m.name,
    m.role,
    m.position,
    m."fpCapacity" AS capacity,
    COALESCE(sum(pm."fpAllocation"), 0::bigint)::integer AS committed,
    (m."fpCapacity" - COALESCE(sum(pm."fpAllocation"), 0::bigint))::integer AS remaining,
    count(DISTINCT pm."projectId")::integer AS project_count
  FROM "Member" m
  LEFT JOIN "ProjectMember" pm ON pm."memberId" = m.id
  WHERE m."isGuest" = false AND m."deactivatedAt" IS NULL
  GROUP BY m.id, m.name, m.role, m.position, m."fpCapacity";

GRANT SELECT ON public.member_summary,
                public.member_capacity_overview,
                public.member_commitment_overview
  TO anon, authenticated;

COMMIT;
