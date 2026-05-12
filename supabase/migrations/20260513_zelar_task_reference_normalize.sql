-- Normaliza references das tasks do Zelar geradas via Design Session.
-- Padrão divergente: ZLAR-V2-T-NNN (346 tasks, criadas pela skill task-gen)
-- Padrão canônico (RPC next_task_reference):  ZLAR-T-NNN
-- A numeração V2 (001..346) é densa e não colide com ZLAR-T-347..351,
-- então basta remover o "V2-" mantendo o número.

BEGIN;

DO $$
DECLARE
  v_project_id constant uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_before int;
  v_updated int;
  v_remaining int;
BEGIN
  SELECT count(*) INTO v_before
  FROM "Task"
  WHERE "projectId" = v_project_id
    AND reference LIKE 'ZLAR-V2-T-%';

  RAISE NOTICE 'Tasks ZLAR-V2-T-* antes: %', v_before;

  UPDATE "Task"
  SET reference = REPLACE(reference, 'ZLAR-V2-T-', 'ZLAR-T-')
  WHERE "projectId" = v_project_id
    AND reference LIKE 'ZLAR-V2-T-%';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*) INTO v_remaining
  FROM "Task"
  WHERE "projectId" = v_project_id
    AND reference LIKE 'ZLAR-V2-T-%';

  RAISE NOTICE 'Linhas atualizadas: %  |  Remanescentes ZLAR-V2-T-*: %', v_updated, v_remaining;

  IF v_updated <> v_before THEN
    RAISE EXCEPTION 'Update count (%) <> contagem inicial (%)', v_updated, v_before;
  END IF;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Sobraram % refs no padrão antigo', v_remaining;
  END IF;
END $$;

COMMIT;
