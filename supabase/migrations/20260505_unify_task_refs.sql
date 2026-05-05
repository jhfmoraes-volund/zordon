-- Unifica sequencia de task references: D-NNN deixa de existir.
--
-- Motivo: a sequencia separada D-NNN (drafts) vs T-NNN (backlog+) virou fonte
-- de complexidade sem ganho real. Status='draft' ja sinaliza efemeralidade.
-- Ref como identidade estavel > sequencia contigua T-NNN.
--
-- Mudancas:
--   1. Backfill: tasks em <KEY>-D-NNN viram <KEY>-T-NNN seguindo MAX(T)+1.
--   2. DROP next_draft_task_reference(uuid).
--
-- Pos-migration: drafts criadas pelo Vitor consomem a mesma sequencia T-NNN
-- que tasks REST/Alpha. Promocao draft->backlog so muda status, nao ref.

BEGIN;

-- ─── 1. Backup defensivo ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._backup_d_refs_20260505 AS
SELECT id, reference, "projectId", status, "createdAt"
FROM public."Task"
WHERE reference ~ '^[A-Z]+-D-\d+$';

-- ─── 2. Backfill D-NNN -> T-NNN ─────────────────────────────────────────────

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
    WHERE t.reference ~ '^[A-Z]+-D-\d+$'
  LOOP
    v_key := v_proj.key;

    -- Pega max T-NNN atual no projeto
    SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int)), 0)
    INTO v_seq
    FROM public."Task"
    WHERE "projectId" = v_proj.pid AND reference ~ '^[A-Z]+-T-\d+$';

    -- Nullify D-NNN primeiro (libera UNIQUE pra reuso)
    UPDATE public."Task"
    SET reference = NULL
    WHERE "projectId" = v_proj.pid AND reference ~ '^[A-Z]+-D-\d+$';

    -- Renumera por createdAt, continuando T sequence
    FOR v_task IN
      SELECT id FROM public."Task"
      WHERE "projectId" = v_proj.pid
        AND reference IS NULL
        AND status = 'draft'
      ORDER BY "createdAt" ASC, id ASC
    LOOP
      v_seq := v_seq + 1;
      v_new_ref := v_key || '-T-' || LPAD(v_seq::text, 3, '0');
      UPDATE public."Task"
      SET reference = v_new_ref, "updatedAt" = now()
      WHERE id = v_task.id;
      RAISE NOTICE 'Draft renumerado: % (%) -> %', v_task.id, v_key, v_new_ref;
    END LOOP;
  END LOOP;
END $$;

-- ─── 3. Drop RPC obsoleta ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.next_draft_task_reference(uuid);

-- ─── 4. Sanity ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_drafts_d int;
  v_drafts_total int;
BEGIN
  SELECT count(*) INTO v_drafts_d
  FROM public."Task"
  WHERE reference ~ '^[A-Z]+-D-\d+$';

  SELECT count(*) INTO v_drafts_total
  FROM public."Task"
  WHERE status = 'draft';

  RAISE NOTICE 'Drafts em D-NNN remanescentes (deve ser 0): %', v_drafts_d;
  RAISE NOTICE 'Total drafts no sistema: %', v_drafts_total;

  IF v_drafts_d > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % drafts ainda em D-NNN', v_drafts_d;
  END IF;
END $$;

COMMIT;
