-- =============================================================================
-- One-shot: apaga o projeto "Zelar (Backup 2026-05-09)" (referenceKey ZLAR_BAK)
-- =============================================================================
-- Faz o equivalente da RPC delete_project_cascade inline (sem o gate de
-- permissão, já que está rodando como superuser via psql).
--
-- O schema backup_zelar_20260509 (snapshot read-only criado em
-- 20260509_zelar_backup_pre_module_reorg.sql) é mantido — independente do
-- Project visível na UI.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_pid uuid;
BEGIN
  SELECT id INTO v_pid FROM public."Project" WHERE "referenceKey" = 'ZLAR_BAK';

  IF v_pid IS NULL THEN
    RAISE NOTICE 'Projeto ZLAR_BAK não encontrado, nada a fazer.';
  ELSE
    -- Mesma sequência da RPC delete_project_cascade. Inline aqui pois esta
    -- migration roda via psql como owner — sem auth.uid(), o gate da RPC
    -- (is_manager/can_edit_tasks) retornaria false e bloqueia.
    DELETE FROM public."TaskDependency" td
    USING public."Task" t
    WHERE (td."taskId" = t.id OR td."dependsOn" = t.id)
      AND t."projectId" = v_pid;

    DELETE FROM public."Task" WHERE "projectId" = v_pid;

    DELETE FROM public."Project" WHERE id = v_pid;
    RAISE NOTICE 'Projeto ZLAR_BAK (%) removido.', v_pid;
  END IF;
END $$;

COMMIT;
