-- =============================================================================
-- Fix: apply_sprint_suggestion deixava Task.status='backlog' ao mover task pra
-- sprint. Como o filtro da página /projects/[id] conta `sprintId IS NULL OR
-- status='backlog'`, o contador de Backlog não diminuía mesmo após apply
-- bem-sucedido. Também impedia que o totalFp da sprint (que filtra
-- `status != 'backlog'`) contasse essas tasks.
--
-- Fix:
--   1) CREATE OR REPLACE FUNCTION: o UPDATE de Task agora promove
--      status='backlog' → 'todo' ao setar sprintId. Status diferente de
--      'backlog' (ex.: 'in_progress', 'review') é preservado.
--   2) Backfill pontual: corrige tasks já movidas em sprints anteriores
--      pelo apply quebrado (sprintId NOT NULL E status='backlog').
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

      SELECT COUNT(*) INTO v_existing_count
        FROM "Task"
       WHERE "sprintId" = v_sprint_id;
      IF v_existing_count > 0 THEN
        RAISE EXCEPTION 'sprint_not_empty: % already has % task(s)',
                        v_sprint_id, v_existing_count
          USING ERRCODE = '40001';
      END IF;

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

    -- Move tasks atomicamente. Promove status='backlog' → 'todo' (compromisso
    -- com a sprint); outros valores (in_progress, review, done) são preservados.
    IF v_expected > 0 THEN
      WITH ids AS (
        SELECT jsonb_array_elements_text(s->'taskIds')::uuid AS id
      )
      UPDATE "Task" t
         SET "sprintId"  = v_sprint_id,
             status      = CASE
                             WHEN t.status = 'backlog' THEN 'todo'
                             ELSE t.status
                           END,
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
  'Cria sprints OU preenche sprint existente vazia, move tasks atomicamente e promove status=backlog → todo. Falha 40001 se task ou sprint já foi tocada.';

-- ─── Backfill: tasks já movidas pelo apply quebrado ────────────────────────
-- Qualquer task que está numa sprint mas continua status=backlog é fruto do
-- bug — promove pra 'todo' pra refletir o estado correto (committed-to-sprint).
UPDATE "Task"
   SET status = 'todo',
       "updatedAt" = NOW()
 WHERE "sprintId" IS NOT NULL
   AND status = 'backlog';

COMMIT;
