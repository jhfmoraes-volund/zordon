-- Renumeração cronológica automática de sprints + bloqueio de delete com tasks.
--
-- Invariante: pra cada projeto, Sprint N é a N-ésima sprint em ordem de startDate ASC.
-- Triggers garantem a invariante em qualquer caminho de escrita.
--
-- A unique constraint (projectId, name) impede UPDATE direto (Sprint 2 -> Sprint 3
-- colide com a Sprint 3 atual). Solução: duas passadas dentro de transação,
-- usando prefixo temporário pra desviar da constraint.

BEGIN;

-- ─── RPC: renumeração cronológica ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.renumber_sprints_chronologically(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_idx int := 0;
BEGIN
  -- Passada 1: nomes temporários (evita colisão com unique (projectId, name))
  FOR v_row IN
    SELECT id
    FROM "Sprint"
    WHERE "projectId" = p_project_id
    ORDER BY "startDate" ASC, "createdAt" ASC
  LOOP
    v_idx := v_idx + 1;
    UPDATE "Sprint"
       SET name = '__renumber_tmp_' || v_idx::text
     WHERE id = v_row.id;
  END LOOP;

  -- Passada 2: nomes finais
  v_idx := 0;
  FOR v_row IN
    SELECT id
    FROM "Sprint"
    WHERE "projectId" = p_project_id
    ORDER BY "startDate" ASC, "createdAt" ASC
  LOOP
    v_idx := v_idx + 1;
    UPDATE "Sprint"
       SET name = 'Sprint ' || v_idx::text,
           "updatedAt" = now()
     WHERE id = v_row.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.renumber_sprints_chronologically(uuid) TO authenticated, service_role;

-- ─── Trigger: bloqueia DELETE se sprint tem tasks ────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_sprint_block_delete_with_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM "Task" WHERE "sprintId" = OLD.id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'sprint_has_tasks: cannot delete sprint % (has % tasks)', OLD.id, v_count
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS sprint_block_delete_with_tasks ON public."Sprint";
CREATE TRIGGER sprint_block_delete_with_tasks
  BEFORE DELETE ON public."Sprint"
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sprint_block_delete_with_tasks();

-- ─── Trigger: renumera após mudanças que afetam a ordem cronológica ─────────

CREATE OR REPLACE FUNCTION public.trg_sprint_renumber_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  -- Recursion guard: a RPC faz UPDATEs que disparariam este trigger de novo.
  -- pg_trigger_depth() = 1 quando chamado pelo evento original; > 1 quando
  -- aninhado (ex: UPDATE feito pela própria RPC).
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    FOR v_project_id IN SELECT DISTINCT "projectId" FROM new_rows LOOP
      PERFORM public.renumber_sprints_chronologically(v_project_id);
    END LOOP;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Só renumera se startDate ou projectId mudou (mudanças de name não disparam).
    FOR v_project_id IN
      SELECT DISTINCT n."projectId"
        FROM new_rows n
        JOIN old_rows o ON o.id = n.id
       WHERE n."startDate" IS DISTINCT FROM o."startDate"
          OR n."projectId" IS DISTINCT FROM o."projectId"
    LOOP
      PERFORM public.renumber_sprints_chronologically(v_project_id);
    END LOOP;
    -- Se a sprint mudou de projeto, renumera o projeto antigo também.
    FOR v_project_id IN
      SELECT DISTINCT o."projectId"
        FROM old_rows o
        JOIN new_rows n ON n.id = o.id
       WHERE n."projectId" IS DISTINCT FROM o."projectId"
    LOOP
      PERFORM public.renumber_sprints_chronologically(v_project_id);
    END LOOP;
  ELSIF (TG_OP = 'DELETE') THEN
    FOR v_project_id IN SELECT DISTINCT "projectId" FROM old_rows LOOP
      PERFORM public.renumber_sprints_chronologically(v_project_id);
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sprint_renumber_after_insert ON public."Sprint";
CREATE TRIGGER sprint_renumber_after_insert
  AFTER INSERT ON public."Sprint"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_sprint_renumber_after_change();

-- Postgres não permite UPDATE OF (cols) com transition tables; filtramos dentro do trigger.
DROP TRIGGER IF EXISTS sprint_renumber_after_update ON public."Sprint";
CREATE TRIGGER sprint_renumber_after_update
  AFTER UPDATE ON public."Sprint"
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_sprint_renumber_after_change();

DROP TRIGGER IF EXISTS sprint_renumber_after_delete ON public."Sprint";
CREATE TRIGGER sprint_renumber_after_delete
  AFTER DELETE ON public."Sprint"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_sprint_renumber_after_change();

-- ─── Renumeração inicial: aplica a invariante a todos os projetos ────────────

DO $$
DECLARE
  v_project_id uuid;
BEGIN
  FOR v_project_id IN
    SELECT DISTINCT "projectId" FROM "Sprint"
  LOOP
    PERFORM public.renumber_sprints_chronologically(v_project_id);
  END LOOP;
END $$;

COMMIT;
