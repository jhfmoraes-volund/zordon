-- ═══════════════════════════════════════════════════════════════════════════
-- TaskTag + TaskTagAssignment
-- Substitui o campo Task.area (enum fechado: front/back/infra/ops/mixed) por
-- tags livres por projeto, com cor da paleta ChipTone, hard limit de 10/task.
--
-- Ordem:
--   1. Cria tabelas + índices + trigger de limite
--   2. Habilita RLS espelhando o pattern de Task (manager OR can_view/edit)
--   3. Cria as 3 tags default (Front, Back, Bug) em todo projeto existente
--   4. Cria tags adicionais (Infra/Ops/Mixed) só nos projetos que tinham tasks
--      com aqueles areas (preserva semântica original sem poluir os outros)
--   5. Backfill: atribui tags às tasks com area set
--   6. Drop column area + constraint
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Tabelas ────────────────────────────────────────────────────────────────

CREATE TABLE public."TaskTag" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES public."Project"("id") ON DELETE CASCADE,
  "name"      text NOT NULL,
  "tone"      text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tasktag_name_length"  CHECK (length(trim("name")) BETWEEN 1 AND 32),
  CONSTRAINT "tasktag_tone_valid"   CHECK ("tone" IN (
    'blue','green','amber','red','purple','cyan','teal','pink','slate','brand','muted'
  ))
);

CREATE UNIQUE INDEX "tasktag_project_name_idx"
  ON public."TaskTag" ("projectId", lower("name"));

CREATE TABLE public."TaskTagAssignment" (
  "taskId"    uuid NOT NULL REFERENCES public."Task"("id")    ON DELETE CASCADE,
  "tagId"     uuid NOT NULL REFERENCES public."TaskTag"("id") ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("taskId", "tagId")
);

CREATE INDEX "tasktagassignment_tag_idx" ON public."TaskTagAssignment" ("tagId");

-- 2. Trigger: hard limit 10 tags/task ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_task_tag_limit()
RETURNS trigger AS $$
DECLARE
  current_count int;
BEGIN
  SELECT count(*) INTO current_count
    FROM public."TaskTagAssignment"
    WHERE "taskId" = NEW."taskId";
  IF current_count >= 10 THEN
    RAISE EXCEPTION 'Task can have at most 10 tags' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tasktagassignment_limit_check"
  BEFORE INSERT ON public."TaskTagAssignment"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_tag_limit();

-- 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public."TaskTag"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TaskTagAssignment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY manager_or_viewer_select ON public."TaskTag"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_manager() OR can_view_project("projectId"));

CREATE POLICY manager_or_editor_insert ON public."TaskTag"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_manager() OR can_edit_tasks("projectId"));

CREATE POLICY manager_or_editor_update ON public."TaskTag"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_manager() OR can_edit_tasks("projectId"));

CREATE POLICY manager_or_editor_delete ON public."TaskTag"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_manager() OR can_edit_tasks("projectId"));

CREATE POLICY manager_or_viewer_select ON public."TaskTagAssignment"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_manager() OR (EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t."id" = "TaskTagAssignment"."taskId"
      AND can_view_project(t."projectId")
  )));

CREATE POLICY manager_or_editor_insert ON public."TaskTagAssignment"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_manager() OR (EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t."id" = "TaskTagAssignment"."taskId"
      AND can_edit_tasks(t."projectId")
  )));

CREATE POLICY manager_or_editor_delete ON public."TaskTagAssignment"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_manager() OR (EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t."id" = "TaskTagAssignment"."taskId"
      AND can_edit_tasks(t."projectId")
  )));

-- 4. Seed defaults (Front/Back/Bug) em todo projeto existente ──────────────

INSERT INTO public."TaskTag" ("projectId", "name", "tone")
SELECT p."id", d."name", d."tone"
FROM public."Project" p
CROSS JOIN (VALUES
  ('Front', 'blue'),
  ('Back',  'purple'),
  ('Bug',   'red')
) AS d("name", "tone")
ON CONFLICT DO NOTHING;

-- 5. Seed legados (Infra/Ops/Mixed) só onde havia tasks com area set ───────

INSERT INTO public."TaskTag" ("projectId", "name", "tone")
SELECT DISTINCT p."id", d."name", d."tone"
FROM public."Project" p
CROSS JOIN (VALUES
  ('front', 'Front', 'blue'),
  ('back',  'Back',  'purple'),
  ('infra', 'Infra', 'slate'),
  ('ops',   'Ops',   'teal'),
  ('mixed', 'Mixed', 'amber')
) AS d("areaValue", "name", "tone")
WHERE EXISTS (
  SELECT 1 FROM public."Task" t
  WHERE t."projectId" = p."id" AND t."area" = d."areaValue"
)
ON CONFLICT DO NOTHING;

-- 6. Backfill: atribui tags às tasks com area set ──────────────────────────

INSERT INTO public."TaskTagAssignment" ("taskId", "tagId")
SELECT t."id", tt."id"
FROM public."Task" t
JOIN public."TaskTag" tt
  ON tt."projectId" = t."projectId"
  AND lower(tt."name") = CASE t."area"
    WHEN 'front' THEN 'front'
    WHEN 'back'  THEN 'back'
    WHEN 'infra' THEN 'infra'
    WHEN 'ops'   THEN 'ops'
    WHEN 'mixed' THEN 'mixed'
  END
WHERE t."area" IS NOT NULL;

-- 7. Drop coluna area + constraint ─────────────────────────────────────────

ALTER TABLE public."Task" DROP CONSTRAINT IF EXISTS "task_area_valid";
ALTER TABLE public."Task" DROP COLUMN IF EXISTS "area";

COMMIT;
