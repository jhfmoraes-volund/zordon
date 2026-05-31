-- ============================================================================
-- ForgeRun cost aggregation trigger
--
-- Mantém ForgeRun.{costUsdTotal, tokensInTotal, tokensOutTotal} sincronizado
-- com a soma de ForgeTask.{costUsd, tokensIn, tokensOut} para o mesmo run.
--
-- Dispara em INSERT/UPDATE/DELETE de ForgeTask.
-- ============================================================================

BEGIN;

-- Função que recalcula os totais do run
CREATE OR REPLACE FUNCTION public.forge_update_run_cost_agg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  -- Determinar qual run precisa ser recalculado
  IF TG_OP = 'DELETE' THEN
    v_run_id := OLD."runId";
  ELSE
    v_run_id := NEW."runId";
  END IF;

  -- Se não tem runId, não faz nada (task sem run associado)
  IF v_run_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Recalcular os totais do run
  UPDATE "ForgeRun"
  SET
    "costUsdTotal" = COALESCE((
      SELECT SUM("costUsd")
      FROM "ForgeTask"
      WHERE "runId" = v_run_id
    ), 0),
    "tokensInTotal" = COALESCE((
      SELECT SUM("tokensIn")
      FROM "ForgeTask"
      WHERE "runId" = v_run_id
    ), 0),
    "tokensOutTotal" = COALESCE((
      SELECT SUM("tokensOut")
      FROM "ForgeTask"
      WHERE "runId" = v_run_id
    ), 0)
  WHERE id = v_run_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger em ForgeTask
CREATE TRIGGER forge_task_cost_agg_trigger
  AFTER INSERT OR UPDATE OF "costUsd", "tokensIn", "tokensOut", "runId" OR DELETE
  ON "ForgeTask"
  FOR EACH ROW
  EXECUTE FUNCTION public.forge_update_run_cost_agg();

COMMIT;
