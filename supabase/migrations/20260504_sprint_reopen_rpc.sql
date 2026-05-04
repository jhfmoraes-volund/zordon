-- RPC: reabre uma sprint completed, completando a active anterior do mesmo projeto na mesma transação.
-- Plano: docs/sprint-lifecycle-plan.md (Opção 3 — kebab inclui Reabrir)

CREATE OR REPLACE FUNCTION reopen_sprint(p_sprint_id uuid)
RETURNS "Sprint"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_current_status text;
  v_result "Sprint";
BEGIN
  SELECT "projectId", status INTO v_project_id, v_current_status
    FROM "Sprint" WHERE id = p_sprint_id FOR UPDATE;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Sprint não encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status <> 'completed' THEN
    RAISE EXCEPTION 'Apenas sprints concluídas podem ser reabertas' USING ERRCODE = 'P0001';
  END IF;

  -- Completar a ativa atual do mesmo projeto (se houver)
  UPDATE "Sprint"
     SET status = 'completed', "updatedAt" = NOW()
   WHERE "projectId" = v_project_id AND status = 'active';

  -- Reativar a sprint alvo
  UPDATE "Sprint"
     SET status = 'active', "updatedAt" = NOW()
   WHERE id = p_sprint_id
   RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION reopen_sprint(uuid) TO authenticated;
