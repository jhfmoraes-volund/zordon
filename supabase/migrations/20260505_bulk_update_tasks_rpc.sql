-- bulk_update_tasks(project_id, updates, actor_id)
-- Atomic update of N tasks in a single project — sprint, assignees, status.
-- Used by Alpha's Sprint Planner Mode after PM confirms the plan in text.
--
-- Payload shape:
--   updates: [
--     { taskRef: "ZRDN-TASK-NN",
--       sprintId?: uuid | null,        -- null = move back to backlog
--       assigneeIds?: uuid[],          -- replace TaskAssignment set; empty array = clear
--       status?: "backlog"|"todo"|"in_progress"|"review"|"done"
--     },
--     ...
--   ]
--
-- Rolls back ALL changes on any error. Returns:
--   { ok: true, updated: N, results: [{taskRef, ok}, ...] }
--
-- Authorization: actor must have can_edit_tasks(project_id) — same gate the
-- UI uses. The function runs SECURITY DEFINER, so we still pass actor_id
-- explicitly and re-check authorization rather than relying on the JWT.

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
  c_valid_statuses text[] := array['backlog','todo','in_progress','review','done'];
begin
  -- Validate inputs
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

  -- Authorize: actor must be able to edit tasks in this project.
  -- can_edit_tasks reads the auth.uid() — but this RPC runs SECURITY DEFINER,
  -- so we must check membership of p_actor_id directly instead. Mirror the
  -- logic of can_edit_tasks: admins, project PM, or ProjectMember row.
  if not exists (
    select 1 from "Member" m where m.id = p_actor_id and m.role in ('ceo','head-ops','cro','principal-engineer')
  ) and not exists (
    select 1 from "Project" p where p.id = p_project_id and p."pmId" = p_actor_id
  ) and not exists (
    select 1 from "ProjectMember" pm where pm."projectId" = p_project_id and pm."memberId" = p_actor_id
  ) then
    raise exception 'Actor % sem permissão de edição em tasks do projeto %', p_actor_id, p_project_id;
  end if;

  -- Iterate updates
  for v_upd in select * from jsonb_array_elements(p_updates) loop
    v_task_ref := v_upd->>'taskRef';
    if v_task_ref is null or v_task_ref = '' then
      raise exception 'Update sem taskRef: %', v_upd::text;
    end if;

    -- Resolve task by reference, scoped to project
    select id into v_task_id
    from "Task"
    where reference = v_task_ref and "projectId" = p_project_id;
    if v_task_id is null then
      raise exception 'Task % não encontrada no projeto %', v_task_ref, p_project_id;
    end if;

    -- Validate sprintId belongs to project (when present and not null)
    v_sprint_id := nullif(v_upd->>'sprintId', '');
    if v_upd ? 'sprintId' and v_sprint_id is not null then
      if not exists (
        select 1 from "Sprint"
        where id = v_sprint_id::uuid and "projectId" = p_project_id
      ) then
        raise exception 'Sprint % não pertence ao projeto %', v_sprint_id, p_project_id;
      end if;
    end if;

    -- Validate status (when present)
    v_status := v_upd->>'status';
    if v_upd ? 'status' and v_status is not null then
      if not (v_status = any(c_valid_statuses)) then
        raise exception 'Status inválido %, válidos: %', v_status, c_valid_statuses;
      end if;
    end if;

    -- Apply Task UPDATE — only fields explicitly present in payload
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
        -- Maintain doneAt invariant: set when transitioning into done; clear on exit
        when v_upd ? 'status' and v_upd->>'status' = 'done' and status <> 'done' then now()
        when v_upd ? 'status' and v_upd->>'status' <> 'done' and status = 'done' then null
        else "doneAt"
      end,
      "updatedAt" = now()
    where id = v_task_id;

    -- Replace TaskAssignment set when assigneeIds is present
    if v_upd ? 'assigneeIds' then
      delete from "TaskAssignment" where "taskId" = v_task_id;

      v_assignee_ids := array(
        select jsonb_array_elements_text(v_upd->'assigneeIds')
      )::uuid[];

      if array_length(v_assignee_ids, 1) is not null then
        -- Only insert for members who actually belong to this project
        -- (or are the project's PM — handle the orphan-PM case)
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
