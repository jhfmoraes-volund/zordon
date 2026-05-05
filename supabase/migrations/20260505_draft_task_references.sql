-- Draft tasks usam sequencia <KEY>-D-NNN propria, separada de <KEY>-T-NNN.
--
-- Motivo: drafts sao efemeros (criados pelo Vitor, podem ser descartados).
-- Se consumirem T-NNN, descartes deixam buracos na sequencia principal.
-- Solucao: D-NNN propria. Promocao draft->backlog substitui ref por T-NNN.
--
-- Mudancas:
--   1. Funcao next_draft_task_reference(uuid) — formato <KEY>-D-NNN.
--   2. Backfill: drafts existentes que estao com T-NNN viram D-NNN, e a
--      sequencia T-NNN ganha ZRDN-T-030 de volta (sem buraco).

BEGIN;

-- 1. Funcao nova
CREATE OR REPLACE FUNCTION public.next_draft_task_reference(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-D\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."Task"
  WHERE "projectId" = p_project_id
    AND reference ~ '^[A-Z]+-D-\d+$';

  RETURN v_key || '-D-' || LPAD(v_seq::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_draft_task_reference(uuid) TO authenticated;

-- 2. Backfill: drafts existentes com T-NNN -> D-NNN.
-- Tira o ref primeiro (libera UNIQUE), depois renumera por createdAt.
DO $$
DECLARE
  v_proj RECORD;
  v_task RECORD;
  v_seq int;
  v_key text;
  v_new_ref text;
BEGIN
  FOR v_proj IN
    SELECT DISTINCT t."projectId" AS pid, p."referenceKey" AS key
    FROM public."Task" t
    JOIN public."Project" p ON p.id = t."projectId"
    WHERE t.status = 'draft'
      AND t.reference ~ '^[A-Z]+-T-\d+$'
  LOOP
    v_key := v_proj.key;
    v_seq := COALESCE((
      SELECT MAX(CAST(SUBSTRING(reference FROM '\-D\-(\d+)$') AS int))
      FROM public."Task"
      WHERE "projectId" = v_proj.pid
        AND reference ~ '^[A-Z]+-D-\d+$'
    ), 0);

    -- Limpa refs primeiro (libera UNIQUE pra reuso futuro do numero T)
    UPDATE public."Task"
    SET reference = NULL
    WHERE "projectId" = v_proj.pid
      AND status = 'draft'
      AND reference ~ '^[A-Z]+-T-\d+$';

    -- Renumera por createdAt
    FOR v_task IN
      SELECT id FROM public."Task"
      WHERE "projectId" = v_proj.pid
        AND status = 'draft'
        AND reference IS NULL
      ORDER BY "createdAt" ASC, id ASC
    LOOP
      v_seq := v_seq + 1;
      v_new_ref := v_key || '-D-' || LPAD(v_seq::text, 3, '0');
      UPDATE public."Task"
      SET reference = v_new_ref, "updatedAt" = now()
      WHERE id = v_task.id;
      RAISE NOTICE 'Draft renumbered: % -> %', v_task.id, v_new_ref;
    END LOOP;
  END LOOP;
END $$;

-- 3. Compactar sequencia T-NNN: gaps deixados por drafts removidas devem ser
-- absorvidos. So Zordon precisa: drafts antigas tinham T-030 etc.
-- Renumera Zordon por createdAt SO em status != 'draft' pra eliminar buracos.
DO $$
DECLARE
  v_t RECORD;
  v_seq int := 0;
  v_zordon_id uuid := '6f9b7443-547e-418e-b0a5-6f3bb38d762f';
BEGIN
  -- Limpa T-NNN no Zordon (status != draft)
  UPDATE public."Task"
  SET reference = NULL
  WHERE "projectId" = v_zordon_id
    AND status <> 'draft'
    AND reference ~ '^ZRDN-T-\d+$';

  -- Renumera contiguamente
  FOR v_t IN
    SELECT id FROM public."Task"
    WHERE "projectId" = v_zordon_id
      AND status <> 'draft'
      AND reference IS NULL
    ORDER BY "createdAt" ASC, id ASC
  LOOP
    v_seq := v_seq + 1;
    UPDATE public."Task"
    SET reference = 'ZRDN-T-' || LPAD(v_seq::text, 3, '0'),
        "updatedAt" = now()
    WHERE id = v_t.id;
  END LOOP;

  RAISE NOTICE 'Zordon T-NNN compactada: % tasks', v_seq;
END $$;

-- 4. Sanity
DO $$
DECLARE
  v_drafts_d int;
  v_drafts_t int;
  v_zordon_t int;
  v_zordon_max_t int;
BEGIN
  SELECT count(*) INTO v_drafts_d
  FROM public."Task"
  WHERE status = 'draft' AND reference ~ '^[A-Z]+-D-\d+$';

  SELECT count(*) INTO v_drafts_t
  FROM public."Task"
  WHERE status = 'draft' AND reference ~ '^[A-Z]+-T-\d+$';

  SELECT count(*) INTO v_zordon_t
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
    AND reference ~ '^ZRDN-T-\d+$';

  SELECT MAX(CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int))
  INTO v_zordon_max_t
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f';

  RAISE NOTICE 'Drafts em D-NNN: %, drafts em T-NNN (deve ser 0): %', v_drafts_d, v_drafts_t;
  RAISE NOTICE 'Zordon T-NNN: % tasks, max seq: %', v_zordon_t, v_zordon_max_t;

  IF v_drafts_t > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % drafts ainda em T-NNN', v_drafts_t;
  END IF;
  IF v_zordon_t <> v_zordon_max_t THEN
    RAISE EXCEPTION 'Zordon T-NNN nao contigua: count=% max=%', v_zordon_t, v_zordon_max_t;
  END IF;
END $$;

COMMIT;
