-- Task references por projeto + tabela TaskDependency com kinds.
--
-- Mudanças (uma transação só):
--   1. Backups defensivos (refs antigas Zordon + JSON deps).
--   2. Substitui next_task_reference() global por next_task_reference(uuid)
--      com formato <KEY>-T-NNN (espelha next_user_story_reference).
--   3. Backfill Zordon: 89 tasks renumeradas pra ZRDN-T-001..NNN por createdAt.
--   4. Cria tabela TaskDependency (taskId, dependsOn, kind, createdAt) com:
--      - kind ∈ {blocks, relates_to}
--      - cycle detection (trigger), só pra kind='blocks'
--      - RLS espelhando TaskTagAssignment (projeto-scoped via Task)
--   5. Backfill do JSON Task.dependencies → rows TaskDependency (kind='blocks').
--      UUIDs órfãos descartados com NOTICE.
--   6. Drop coluna Task.dependencies.
--
-- Pré-requisito: rodado via psql "$DIRECT_URL" -f <este arquivo>.

BEGIN;

-- ─── 1. BACKUPS DEFENSIVOS ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._backup_zordon_refs_20260505 AS
SELECT id, reference, "createdAt"
FROM public."Task"
WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f';

CREATE TABLE IF NOT EXISTS public._backup_task_dependencies_20260505 AS
SELECT id, dependencies, "updatedAt"
FROM public."Task"
WHERE dependencies IS NOT NULL
  AND dependencies::text <> 'null'
  AND dependencies::text <> '[]';

-- ─── 2. NOVA RPC next_task_reference(uuid) ──────────────────────────────────

DROP FUNCTION IF EXISTS public.next_task_reference();

CREATE OR REPLACE FUNCTION public.next_task_reference(p_project_id uuid)
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
    CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."Task"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-T-' || LPAD(v_seq::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_task_reference(uuid) TO authenticated;

-- ─── 3. BACKFILL ZORDON ──────────────────────────────────────────────────────

-- Stage temporário: remove refs do Zordon antes de renumerar pra evitar
-- colisão na constraint UNIQUE caso ordem produza alguma sobreposição.
UPDATE public."Task"
SET reference = NULL
WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f';

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
)
UPDATE public."Task" t
SET reference = 'ZRDN-T-' || LPAD(r.rn::text, 3, '0'),
    "updatedAt" = now()
FROM ranked r
WHERE t.id = r.id;

DO $$
DECLARE
  v_count int;
  v_max_seq int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
    AND reference ~ '^ZRDN-T-\d+$';

  SELECT MAX(CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int))
  INTO v_max_seq
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f';

  IF v_count <> COALESCE(v_max_seq, 0) THEN
    RAISE EXCEPTION 'Backfill Zordon inconsistente: count=% max_seq=%', v_count, v_max_seq;
  END IF;

  RAISE NOTICE 'Zordon refs OK: % tasks renumeradas (ZRDN-T-001..ZRDN-T-%)',
    v_count, LPAD(v_max_seq::text, 3, '0');
END $$;

-- ─── 4. TABELA TaskDependency ────────────────────────────────────────────────

CREATE TABLE public."TaskDependency" (
  "taskId"    uuid NOT NULL REFERENCES public."Task"(id) ON DELETE CASCADE,
  "dependsOn" uuid NOT NULL REFERENCES public."Task"(id) ON DELETE RESTRICT,
  "kind"      text NOT NULL DEFAULT 'blocks'
    CHECK ("kind" IN ('blocks', 'relates_to')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("taskId", "dependsOn", "kind"),
  CONSTRAINT taskdep_no_self_loop CHECK ("taskId" <> "dependsOn")
);

CREATE INDEX taskdep_dependson_idx ON public."TaskDependency" ("dependsOn");
CREATE INDEX taskdep_kind_idx ON public."TaskDependency" ("kind");

ALTER TABLE public."TaskDependency" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."TaskDependency"
  FOR SELECT TO authenticated
  USING (
    is_manager() OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "TaskDependency"."taskId"
        AND can_view_project(t."projectId")
    )
  );

CREATE POLICY "manager_or_editor_insert" ON public."TaskDependency"
  FOR INSERT TO authenticated
  WITH CHECK (
    is_manager() OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "TaskDependency"."taskId"
        AND can_edit_tasks(t."projectId")
    )
  );

CREATE POLICY "manager_or_editor_delete" ON public."TaskDependency"
  FOR DELETE TO authenticated
  USING (
    is_manager() OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "TaskDependency"."taskId"
        AND can_edit_tasks(t."projectId")
    )
  );

-- ─── 5. CYCLE DETECTION TRIGGER (apenas em kind='blocks') ───────────────────

CREATE OR REPLACE FUNCTION public.taskdep_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_path boolean;
BEGIN
  -- Só checa ciclo em kind='blocks'. relates_to é informativo, ciclo permitido.
  IF NEW."kind" <> 'blocks' THEN
    RETURN NEW;
  END IF;

  -- Procura caminho NEW.dependsOn → ... → NEW.taskId considerando SOMENTE
  -- arestas blocks. Se existe, inserir NEW criaria ciclo bloqueante.
  WITH RECURSIVE path AS (
    SELECT "dependsOn" AS node FROM public."TaskDependency"
      WHERE "taskId" = NEW."dependsOn" AND "kind" = 'blocks'
    UNION
    SELECT td."dependsOn" FROM public."TaskDependency" td
    JOIN path p ON p.node = td."taskId"
    WHERE td."kind" = 'blocks'
  )
  SELECT EXISTS (SELECT 1 FROM path WHERE node = NEW."taskId")
  INTO v_has_path;

  IF v_has_path THEN
    RAISE EXCEPTION 'Cycle detected: task % cannot block % (would create blocks-cycle)',
      NEW."taskId", NEW."dependsOn";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER taskdep_cycle_check
  BEFORE INSERT OR UPDATE ON public."TaskDependency"
  FOR EACH ROW EXECUTE FUNCTION public.taskdep_no_cycle();

-- ─── 6. BACKFILL DO JSON ANTIGO ──────────────────────────────────────────────

DO $$
DECLARE
  v_task RECORD;
  v_dep_uuid uuid;
  v_dep_str text;
  v_inserted int := 0;
  v_orphaned int := 0;
BEGIN
  FOR v_task IN
    SELECT id, dependencies::jsonb AS deps
    FROM public."Task"
    WHERE dependencies IS NOT NULL
      AND dependencies::text <> 'null'
      AND dependencies::text <> '[]'
  LOOP
    -- Se não for array, pula
    IF jsonb_typeof(v_task.deps) <> 'array' THEN
      CONTINUE;
    END IF;

    FOR v_dep_str IN SELECT jsonb_array_elements_text(v_task.deps)
    LOOP
      BEGIN
        v_dep_uuid := v_dep_str::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_orphaned := v_orphaned + 1;
        RAISE NOTICE 'Skipped non-uuid dep: % (task %)', v_dep_str, v_task.id;
        CONTINUE;
      END;

      IF NOT EXISTS (SELECT 1 FROM public."Task" WHERE id = v_dep_uuid) THEN
        v_orphaned := v_orphaned + 1;
        RAISE NOTICE 'Skipped orphan dep: % (task %)', v_dep_uuid, v_task.id;
        CONTINUE;
      END IF;

      IF v_task.id = v_dep_uuid THEN
        v_orphaned := v_orphaned + 1;
        RAISE NOTICE 'Skipped self-loop dep on task %', v_task.id;
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO public."TaskDependency" ("taskId", "dependsOn", "kind")
        VALUES (v_task.id, v_dep_uuid, 'blocks')
        ON CONFLICT DO NOTHING;
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN OTHERS THEN
        v_orphaned := v_orphaned + 1;
        RAISE NOTICE 'Skipped dep % → % (constraint): %', v_task.id, v_dep_uuid, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Backfill TaskDependency: % rows inseridas, % orphaned/skipped',
    v_inserted, v_orphaned;
END $$;

-- ─── 7. DROP COLUNA antiga ───────────────────────────────────────────────────

ALTER TABLE public."Task" DROP COLUMN dependencies;

-- ─── 8. SANITY FINAL ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_zordon_refs int;
  v_dep_rows int;
  v_distinct_tasks_with_deps int;
BEGIN
  SELECT count(*) INTO v_zordon_refs
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
    AND reference ~ '^ZRDN-T-\d+$';

  SELECT count(*) INTO v_dep_rows FROM public."TaskDependency";
  SELECT count(DISTINCT "taskId") INTO v_distinct_tasks_with_deps FROM public."TaskDependency";

  RAISE NOTICE 'FINAL — Zordon refs: %, TaskDependency rows: %, distinct tasks com deps: %',
    v_zordon_refs, v_dep_rows, v_distinct_tasks_with_deps;
END $$;

COMMIT;
