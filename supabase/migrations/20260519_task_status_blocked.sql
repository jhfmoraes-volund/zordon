-- Adiciona "blocked" como status válido de Task.
-- "Task".status é text livre (sem CHECK constraint), mas há dois pontos que
-- enumeram explicitamente os status válidos:
--
--   1. RPC bulk_update_tasks: c_valid_statuses (rejeita o que não estiver lá)
--   2. View sprint_member_capacity: filtro de fp_open (carga em aberto)
--
-- Decisão: blocked conta como fp_open (= carga em aberto) — task blocked
-- ainda é trabalho planejado e não-entregue. Mantém a invariante:
--   fp_planned = fp_done + fp_open

BEGIN;

-- ─── 1) RPC bulk_update_tasks ─────────────────────────────────────────────
-- Apenas adiciona 'blocked' em c_valid_statuses. Resto idêntico ao definido
-- em 20260505_bulk_update_tasks_rpc.sql.

create or replace function public.bulk_update_tasks(
  p_project_id uuid,
  p_updates jsonb,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upd jsonb;
  v_task_id uuid;
  v_task_ref text;
  v_sprint_id uuid;
  v_status text;
  v_assignee_ids uuid[];
  v_results jsonb := '[]'::jsonb;
  v_count int := 0;
  c_valid_statuses text[] := array['backlog','todo','in_progress','blocked','review','done'];
begin
  if p_project_id is null then
    raise exception 'p_project_id is required';
  end if;
  if p_actor_id is null then
    raise exception 'p_actor_id is required';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'p_updates must be a jsonb array';
  end if;
  if jsonb_array_length(p_updates) = 0 then
    raise exception 'p_updates is empty — pass at least one update';
  end if;
  if jsonb_array_length(p_updates) > 200 then
    raise exception 'p_updates exceeds max of 200 — split into multiple calls';
  end if;

  if not exists (
    select 1 from "Member" m where m.id = p_actor_id and m.role in ('ceo','head-ops','cro','principal-engineer')
  ) and not exists (
    select 1 from "Project" p where p.id = p_project_id and p."pmId" = p_actor_id
  ) and not exists (
    select 1 from "ProjectMember" pm where pm."projectId" = p_project_id and pm."memberId" = p_actor_id
  ) then
    raise exception 'Actor % sem permissão de edição em tasks do projeto %', p_actor_id, p_project_id;
  end if;

  for v_upd in select * from jsonb_array_elements(p_updates) loop
    v_task_ref := v_upd->>'taskRef';
    if v_task_ref is null or v_task_ref = '' then
      raise exception 'Update sem taskRef: %', v_upd::text;
    end if;

    select id into v_task_id
    from "Task"
    where reference = v_task_ref and "projectId" = p_project_id;
    if v_task_id is null then
      raise exception 'Task % não encontrada no projeto %', v_task_ref, p_project_id;
    end if;

    v_sprint_id := nullif(v_upd->>'sprintId', '');
    if v_upd ? 'sprintId' and v_sprint_id is not null then
      if not exists (
        select 1 from "Sprint"
        where id = v_sprint_id::uuid and "projectId" = p_project_id
      ) then
        raise exception 'Sprint % não pertence ao projeto %', v_sprint_id, p_project_id;
      end if;
    end if;

    v_status := v_upd->>'status';
    if v_upd ? 'status' and v_status is not null then
      if not (v_status = any(c_valid_statuses)) then
        raise exception 'Status inválido %, válidos: %', v_status, c_valid_statuses;
      end if;
    end if;

    update "Task" set
      "sprintId" = case
        when v_upd ? 'sprintId' then nullif(v_upd->>'sprintId', '')::uuid
        else "sprintId"
      end,
      status = case
        when v_upd ? 'status' then v_upd->>'status'
        else status
      end,
      "doneAt" = case
        when v_upd ? 'status' and v_upd->>'status' = 'done' and status <> 'done' then now()
        when v_upd ? 'status' and v_upd->>'status' <> 'done' and status = 'done' then null
        else "doneAt"
      end,
      "updatedAt" = now()
    where id = v_task_id;

    if v_upd ? 'assigneeIds' then
      delete from "TaskAssignment" where "taskId" = v_task_id;

      v_assignee_ids := array(
        select jsonb_array_elements_text(v_upd->'assigneeIds')
      )::uuid[];

      if array_length(v_assignee_ids, 1) is not null then
        insert into "TaskAssignment" ("taskId", "memberId")
        select v_task_id, m_id
        from unnest(v_assignee_ids) as m_id
        where exists (
          select 1 from "ProjectMember"
          where "projectId" = p_project_id and "memberId" = m_id
        ) or exists (
          select 1 from "Project"
          where id = p_project_id and "pmId" = m_id
        );
      end if;
    end if;

    v_results := v_results || jsonb_build_object('taskRef', v_task_ref, 'ok', true);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'updated', v_count,
    'results', v_results
  );
end;
$$;

grant execute on function public.bulk_update_tasks(uuid, jsonb, uuid) to authenticated;
grant execute on function public.bulk_update_tasks(uuid, jsonb, uuid) to service_role;

-- ─── 2) View sprint_member_capacity ───────────────────────────────────────
-- Inclui 'blocked' no filtro de fp_open. Estrutura idêntica à definida em
-- 20260512_sprint_member_capacity_include_pm.sql (UNION ALL builders + PMs),
-- só altera o filtro de fp_open nos dois blocos.

DROP VIEW IF EXISTS sprint_capacity_overview CASCADE;
DROP VIEW IF EXISTS sprint_member_capacity CASCADE;

CREATE VIEW sprint_member_capacity AS
-- Builders (e qualquer PM que também esteja explícito em ProjectMember).
SELECT
  s.id                                                AS "sprintId",
  pm."memberId",
  m.name                                              AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", pm."fpAllocation")::int AS fp_allocation,
  COALESCE(agg.fp_planned, 0)::int                    AS fp_planned,
  COALESCE(agg.fp_done, 0)::int                       AS fp_done,
  COALESCE(agg.fp_open, 0)::int                       AS fp_open,
  (sm."fpAllocation" IS NOT NULL)                     AS has_sprint_override
FROM "Sprint" s
JOIN "ProjectMember" pm ON pm."projectId" = s."projectId"
JOIN "Member" m ON m.id = pm."memberId"
LEFT JOIN "SprintMember" sm
  ON sm."sprintId" = s.id AND sm."memberId" = pm."memberId"
LEFT JOIN LATERAL (
  SELECT
    SUM(t."functionPoints") FILTER (WHERE t.status <> 'backlog')                               AS fp_planned,
    SUM(t."functionPoints") FILTER (WHERE t.status = 'done')                                   AS fp_done,
    SUM(t."functionPoints") FILTER (
      WHERE t.status IN ('todo', 'in_progress', 'blocked', 'review', 'changes_requested')
    )                                                                                          AS fp_open
  FROM "Task" t
  JOIN "TaskAssignment" ta ON ta."taskId" = t.id
  WHERE t."sprintId" = s.id AND ta."memberId" = pm."memberId"
) agg ON true

UNION ALL

-- PMs do projeto SEM ProjectMember explícito. Allocation cai pra fpCapacity.
SELECT
  s.id                                                       AS "sprintId",
  p."pmId"                                                   AS "memberId",
  m.name                                                     AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", m."fpCapacity", 0)::int        AS fp_allocation,
  COALESCE(agg.fp_planned, 0)::int                           AS fp_planned,
  COALESCE(agg.fp_done, 0)::int                              AS fp_done,
  COALESCE(agg.fp_open, 0)::int                              AS fp_open,
  (sm."fpAllocation" IS NOT NULL)                            AS has_sprint_override
FROM "Sprint" s
JOIN "Project" p ON p.id = s."projectId"
JOIN "Member" m ON m.id = p."pmId"
LEFT JOIN "SprintMember" sm
  ON sm."sprintId" = s.id AND sm."memberId" = p."pmId"
LEFT JOIN LATERAL (
  SELECT
    SUM(t."functionPoints") FILTER (WHERE t.status <> 'backlog')                               AS fp_planned,
    SUM(t."functionPoints") FILTER (WHERE t.status = 'done')                                   AS fp_done,
    SUM(t."functionPoints") FILTER (
      WHERE t.status IN ('todo', 'in_progress', 'blocked', 'review', 'changes_requested')
    )                                                                                          AS fp_open
  FROM "Task" t
  JOIN "TaskAssignment" ta ON ta."taskId" = t.id
  WHERE t."sprintId" = s.id AND ta."memberId" = p."pmId"
) agg ON true
WHERE p."pmId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    WHERE pm."projectId" = s."projectId" AND pm."memberId" = p."pmId"
  );

GRANT SELECT ON sprint_member_capacity TO service_role, authenticated;

COMMENT ON VIEW sprint_member_capacity IS
  'Capacity por (sprint, member). Cobre ProjectMember ∪ Project.pmId (PMs sem ProjectMember herdam fpAllocation = Member.fpCapacity). fp_planned = todos status exceto backlog. fp_done = done. fp_open = todo+in_progress+blocked+review+changes_requested. Invariante: fp_planned = fp_done + fp_open.';

CREATE VIEW sprint_capacity_overview AS
SELECT
  "sprintId",
  SUM(fp_allocation)::int AS capacity,
  SUM(fp_planned)::int    AS planned,
  SUM(fp_done)::int       AS done,
  SUM(fp_open)::int       AS open
FROM sprint_member_capacity
GROUP BY "sprintId";

GRANT SELECT ON sprint_capacity_overview TO service_role, authenticated;

COMMENT ON VIEW sprint_capacity_overview IS
  'Agregação por sprint de sprint_member_capacity. capacity = Σ fp_allocation (contrato). planned/done/open = Σ das métricas correspondentes.';

COMMIT;
