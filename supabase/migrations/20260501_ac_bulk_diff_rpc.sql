-- task_acceptance_bulk_diff(task_id, payload)
-- Atomic create/update/delete for AcceptanceCriterion rows of a single Task.
-- Payload shape:
--   { creates: [{ id?, text, order?, checkedAt?, checkedBy? }],
--     updates: [{ id, text?, order?, checked?, checkedBy? }],
--     deletes: [id, ...] }
--
-- All ids in updates/deletes must belong to task_id (enforced); creates
-- always assign taskId = task_id. Function runs in an implicit transaction —
-- any error rolls back all changes. Returns the final list of AC rows for
-- task_id (ordered by `order`).

create or replace function public.task_acceptance_bulk_diff(
  p_task_id uuid,
  p_payload jsonb
) returns setof public."AcceptanceCriterion"
language plpgsql
security definer
set search_path = public
as $$
declare
  v_create jsonb;
  v_update jsonb;
  v_delete_ids uuid[];
  v_member_id uuid;
begin
  if p_task_id is null then
    raise exception 'task_id is required';
  end if;

  -- Deletes
  if p_payload ? 'deletes' then
    select coalesce(array_agg((d)::uuid), array[]::uuid[])
      into v_delete_ids
      from jsonb_array_elements_text(p_payload->'deletes') as d;

    if array_length(v_delete_ids, 1) > 0 then
      delete from public."AcceptanceCriterion"
        where id = any(v_delete_ids)
          and "taskId" = p_task_id;
    end if;
  end if;

  -- Updates
  if p_payload ? 'updates' then
    for v_update in
      select * from jsonb_array_elements(p_payload->'updates')
    loop
      v_member_id := nullif(v_update->>'checkedBy', '')::uuid;

      update public."AcceptanceCriterion"
        set
          "text" = coalesce(v_update->>'text', "text"),
          "order" = coalesce((v_update->>'order')::int, "order"),
          "checkedAt" = case
            when v_update ? 'checked' and (v_update->>'checked')::boolean = true
              then coalesce("checkedAt", now())
            when v_update ? 'checked' and (v_update->>'checked')::boolean = false
              then null
            else "checkedAt"
          end,
          "checkedBy" = case
            when v_update ? 'checked' and (v_update->>'checked')::boolean = true
              then coalesce(v_member_id, "checkedBy")
            when v_update ? 'checked' and (v_update->>'checked')::boolean = false
              then null
            else "checkedBy"
          end,
          "updatedAt" = now()
        where id = (v_update->>'id')::uuid
          and "taskId" = p_task_id;
    end loop;
  end if;

  -- Creates
  if p_payload ? 'creates' then
    for v_create in
      select * from jsonb_array_elements(p_payload->'creates')
    loop
      insert into public."AcceptanceCriterion" (
        id, "taskId", "userStoryId", "text", "order", "checkedAt", "checkedBy", "createdAt", "updatedAt"
      ) values (
        coalesce(nullif(v_create->>'id', '')::uuid, gen_random_uuid()),
        p_task_id,
        null,
        v_create->>'text',
        coalesce((v_create->>'order')::int, 0),
        nullif(v_create->>'checkedAt', '')::timestamptz,
        nullif(v_create->>'checkedBy', '')::uuid,
        now(),
        now()
      );
    end loop;
  end if;

  return query
    select * from public."AcceptanceCriterion"
      where "taskId" = p_task_id
      order by "order" asc, "createdAt" asc;
end;
$$;

grant execute on function public.task_acceptance_bulk_diff(uuid, jsonb) to authenticated;
grant execute on function public.task_acceptance_bulk_diff(uuid, jsonb) to service_role;
