-- 20260620c_next_task_references_batch.sql
-- Alocação EM LOTE de referências de Task: next_task_references(project, count)
-- devolve N referências distintas <KEY>-T-NNN numa única leitura atômica.
--
-- Motivo: aplicar um Release Planning criava as tasks num loop SEQUENCIAL, uma
-- chamada de next_task_reference() por create (cada uma relê MAX(reference)+1).
-- Com 59 propostas isso vira ~59 round-trips só pra numerar + centenas pros
-- inserts → 15-50s, estoura o budget da request e a UI "trava".
--
-- O fix paraleliza os writes do executor. Mas next_task_reference() é MAX-based:
-- dois creates concorrentes leriam o MESMO MAX → mesma reference (e Task.reference
-- NÃO tem unique constraint → duplicata silenciosa). Esta função resolve isso
-- alocando o BLOCO inteiro de uma vez (MAX+1 .. MAX+count) antes dos inserts.
--
-- Espelha o formato e a semântica de next_task_reference(uuid) (20260505):
-- mesmo <KEY>-T-NNN, mesmo LPAD(3), SECURITY DEFINER, GRANT a authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.next_task_references(p_project_id uuid, p_count int)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key  text;
  v_seq  int;
  v_refs text[] := '{}';
  i      int;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN v_refs;
  END IF;

  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."Task"
  WHERE "projectId" = p_project_id;

  FOR i IN 0..(p_count - 1) LOOP
    v_refs := array_append(v_refs, v_key || '-T-' || LPAD((v_seq + i)::text, 3, '0'));
  END LOOP;

  RETURN v_refs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_task_references(uuid, int) TO authenticated;

COMMIT;
