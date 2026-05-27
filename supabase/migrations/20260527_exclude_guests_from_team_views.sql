-- ═══════════════════════════════════════════════════════════════════════════
-- Exclui guests (Member-stub, isGuest=true) das views de roster/capacidade.
--
-- Guests ganham um Member-stub só pra poder comentar em tasks. Eles não são
-- do time interno, não têm capacity nem alocação, e não devem aparecer em
-- nenhuma listagem de membros: Overview (Capacity do Time), página /members,
-- relatórios de commitment, etc. Filtrar nas views cobre todas as consumidoras
-- de uma vez (member_summary, member_capacity_overview, member_commitment_overview).
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
  WHERE m."isGuest" = false;

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
  WHERE m."isGuest" = false
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
  WHERE m."isGuest" = false
  GROUP BY m.id, m.name, m.role, m.position, m."fpCapacity";

GRANT SELECT ON public.member_summary,
                public.member_capacity_overview,
                public.member_commitment_overview
  TO anon, authenticated;

COMMIT;
