-- RPC: ativa uma sprint upcoming, completando a active anterior do mesmo projeto na mesma transação.
-- Plano: docs/sprint-lifecycle-plan.md (Fase 2)

CREATE OR REPLACE FUNCTION activate_sprint(p_sprint_id uuid)
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
  -- Lock + read da sprint alvo
  SELECT "projectId", status INTO v_project_id, v_current_status
    FROM "Sprint" WHERE id = p_sprint_id FOR UPDATE;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Sprint não encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status = 'active' THEN
    RAISE EXCEPTION 'Sprint já está ativa' USING ERRCODE = 'P0001';
  END IF;

  IF v_current_status = 'completed' THEN
    RAISE EXCEPTION 'Sprint já foi concluída e não pode ser reativada' USING ERRCODE = 'P0001';
  END IF;

  -- Completar a ativa anterior do mesmo projeto (se houver)
  UPDATE "Sprint"
     SET status = 'completed', "updatedAt" = NOW()
   WHERE "projectId" = v_project_id AND status = 'active';

  -- Promover a alvo
  UPDATE "Sprint"
     SET status = 'active', "updatedAt" = NOW()
   WHERE id = p_sprint_id
   RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION activate_sprint(uuid) TO authenticated;
