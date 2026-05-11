-- =============================================================================
-- RPC: delete_project_cascade — remove project respeitando dois bloqueios
-- =============================================================================
-- Dois bloqueios existem no schema que impedem o cascade direto do Project:
--
-- 1) FK TaskDependency.dependsOn → Task ON DELETE RESTRICT
--    Proteção contra delete direto de Task que outras dependem. No cascade
--    do Project, o RESTRICT é checado imediatamente e bloqueia mesmo quando
--    a task "dependente" também está prestes a sair no mesmo cascade.
--
-- 2) Trigger sprint_block_delete_with_tasks (BEFORE DELETE on Sprint)
--    Levanta exception se a sprint tem tasks apontando pra ela. No cascade
--    do Project, se o Sprint for processado antes do Task, vê tasks e aborta.
--
-- Esta RPC resolve ambos numa transação:
--   - Limpa TaskDependency das tasks do projeto (contorna #1)
--   - Apaga Task do projeto (zera referências de Sprint, contorna #2)
--   - Apaga Project (cascade resolve o resto)
--
-- A regra RESTRICT e o trigger continuam valendo pra delete direto de Task
-- ou Sprint na UI (proteção preservada).
--
-- SECURITY DEFINER: precisa ignorar RLS de TaskDependency/Task (delete policies
-- exigem can_edit_tasks). Check de permissão é embutido — só manager OR
-- can_edit_tasks no projeto pode chamar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_project_cascade(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_manager() OR public.can_edit_tasks(p_project_id)) THEN
    RAISE EXCEPTION 'forbidden: not allowed to delete project %', p_project_id
      USING ERRCODE = '42501';
  END IF;

  -- 1) Limpa dependências que tocam tasks deste projeto (contorna RESTRICT)
  DELETE FROM public."TaskDependency" td
  USING public."Task" t
  WHERE (td."taskId" = t.id OR td."dependsOn" = t.id)
    AND t."projectId" = p_project_id;

  -- 2) Apaga tasks do projeto (zera referências de Sprint, contorna trigger)
  DELETE FROM public."Task" WHERE "projectId" = p_project_id;

  -- 3) Apaga Project — cascade limpa Sprint, Module, UserStory, DesignSession etc
  DELETE FROM public."Project" WHERE id = p_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_project_cascade(uuid) TO authenticated, service_role;
