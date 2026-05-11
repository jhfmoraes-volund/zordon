-- =============================================================================
-- apply_sprint_suggestion — materializa sugestão do sprint planner em uma
-- transação única.
--
-- Input (jsonb array). Cada elemento é UMA das duas formas:
--
--   CREATE (cria sprint nova):
--     { "name": "Sprint 6", "goal": "...", "startDate": "...", "endDate": "...",
--       "taskIds": ["..."] }
--
--   FILL  (preenche sprint existente vazia):
--     { "existingSprintId": "uuid", "goal": "...", "taskIds": ["..."] }
--       - existingSprintId precisa ser do mesmo projeto (p_project_id) e estar
--         atualmente sem nenhuma task. Se já tem task, falha 40001.
--       - goal é opcional. Se vier, sobrescreve. Nome não é tocado.
--
-- Comportamento comum:
--   - Tasks: UPDATE Task SET sprintId=<sprintId> WHERE id=… AND projectId=…
--     AND sprintId IS NULL. Se alguma task já tinha sprint, aborta tudo (40001).
--   - Retorna [{id, name, goal, startDate, endDate, taskCount}, ...]
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION apply_sprint_suggestion(
  p_project_id uuid,
  p_sprints    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  s            jsonb;
  v_sprint_id  uuid;
  v_expected   int;
  v_updated    int;
  v_existing_count int;
  v_name       text;
  v_goal       text;
  v_start      date;
  v_end        date;
  v_result     jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_sprints) <> 'array' THEN
    RAISE EXCEPTION 'p_sprints must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  FOR s IN SELECT * FROM jsonb_array_elements(p_sprints)
  LOOP
    v_expected := COALESCE(jsonb_array_length(s->'taskIds'), 0);

    IF s ? 'existingSprintId' THEN
      -- ── FILL existing empty sprint ────────────────────────────────────
      v_sprint_id := (s->>'existingSprintId')::uuid;

      SELECT name, goal, "startDate", "endDate"
        INTO v_name, v_goal, v_start, v_end
        FROM "Sprint"
       WHERE id = v_sprint_id
         AND "projectId" = p_project_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'sprint_not_found_or_wrong_project: %', v_sprint_id
          USING ERRCODE = '22023';
      END IF;

      -- Sprint precisa estar vazia (sem tasks alocadas).
      SELECT COUNT(*) INTO v_existing_count
        FROM "Task"
       WHERE "sprintId" = v_sprint_id;
      IF v_existing_count > 0 THEN
        RAISE EXCEPTION 'sprint_not_empty: % already has % task(s)',
                        v_sprint_id, v_existing_count
          USING ERRCODE = '40001';
      END IF;

      -- Atualiza goal se vier no payload.
      IF s ? 'goal' THEN
        UPDATE "Sprint"
           SET goal       = NULLIF(s->>'goal', ''),
               "updatedAt" = NOW()
         WHERE id = v_sprint_id;
        v_goal := NULLIF(s->>'goal', '');
      END IF;
    ELSE
      -- ── CREATE new sprint ─────────────────────────────────────────────
      v_name  := s->>'name';
      v_goal  := NULLIF(s->>'goal', '');
      v_start := (s->>'startDate')::date;
      v_end   := (s->>'endDate')::date;

      INSERT INTO "Sprint"(
        id, name, goal, "startDate", "endDate", status, "projectId", "updatedAt"
      ) VALUES (
        gen_random_uuid(), v_name, v_goal, v_start, v_end,
        'upcoming', p_project_id, NOW()
      )
      RETURNING id INTO v_sprint_id;
    END IF;

    -- Move tasks atomicamente — falha se outro PM/processo as alocou.
    IF v_expected > 0 THEN
      WITH ids AS (
        SELECT jsonb_array_elements_text(s->'taskIds')::uuid AS id
      )
      UPDATE "Task" t
         SET "sprintId"  = v_sprint_id,
             "updatedAt" = NOW()
        FROM ids
       WHERE t.id          = ids.id
         AND t."projectId" = p_project_id
         AND t."sprintId"  IS NULL;
      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated <> v_expected THEN
        RAISE EXCEPTION
          'task_already_allocated: expected % tasks, updated %',
          v_expected, v_updated
          USING ERRCODE = '40001';
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      'id',         v_sprint_id,
      'name',       v_name,
      'goal',       v_goal,
      'startDate',  v_start,
      'endDate',    v_end,
      'taskCount',  v_expected
    );
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION apply_sprint_suggestion(uuid, jsonb) IS
  'Cria sprints (status=upcoming) OU preenche sprints existentes vazias, e migra tasks do backlog atomicamente. Falha com 40001 se task ou sprint já foi tocada por outro PM.';

COMMIT;
