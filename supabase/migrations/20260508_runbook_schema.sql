-- =============================================================================
-- Runbook 2.0 — schema isolado pra auditoria de geração de tasks
-- =============================================================================
-- Schema `runbook` isola este toolkit do produto Volund. Contém:
--   - task_anchor: liga cada Task gerada à(s) feature(s) do brainstorm
--                  e aos AC produto que ela cobre
--   - story_coverage: registra stories marcadas como cobertas por outras
--   - mark_story_covered_by(): função pra marcar e materializar
--   - tasks_without_brainstorm_anchor(): detecta invenções
--   - unmapped_brainstorm_features(): detecta buracos de cobertura
--   - story_coverage_report(): visão geral por story
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS runbook;
COMMENT ON SCHEMA runbook IS
  'Toolkit de auditoria de geração de tasks (Claude/Vitor) — não vai pra produção';

-- ─── 1. task_anchor: rastreabilidade Task → brainstorm + AC ──────────────────
CREATE TABLE IF NOT EXISTS runbook.task_anchor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"        uuid NOT NULL REFERENCES public."Task"(id) ON DELETE CASCADE,

  -- De qual feature do brainstorm essa task deriva (nullable: pode ser
  -- gap-fill explícito sem origem no brainstorm — ex: middleware /provider/**)
  "brainstormFeatureId" text,
  "brainstormSessionId" uuid,

  -- Quais AC produto da story essa task cobre (índices em "AcceptanceCriterion".order)
  "coversAcIndices" int[] NOT NULL DEFAULT '{}',

  -- Por que existe (humano ou LLM): "from_brainstorm" | "gap_fill" | "infra_setup" | "manual"
  source          text NOT NULL DEFAULT 'from_brainstorm'
                    CHECK (source IN ('from_brainstorm', 'gap_fill', 'infra_setup', 'manual')),

  -- Justificativa quando source != from_brainstorm
  "gapReason"     text,

  "createdAt"     timestamptz NOT NULL DEFAULT now(),

  -- 1 anchor por task (1:1) — se quiser N anchors no futuro, remover unique
  UNIQUE ("taskId"),

  -- FK lógica pro brainstorm: se feature_id presente, session deve estar presente.
  -- Não fazemos FK formal porque PK é (id, sessionId) composta.
  CHECK (("brainstormFeatureId" IS NULL AND "brainstormSessionId" IS NULL)
      OR ("brainstormFeatureId" IS NOT NULL AND "brainstormSessionId" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS task_anchor_brainstorm_idx
  ON runbook.task_anchor ("brainstormSessionId", "brainstormFeatureId");

CREATE INDEX IF NOT EXISTS task_anchor_source_idx
  ON runbook.task_anchor (source);


-- ─── 2. story_coverage: stories marcadas como cobertas por outras ────────────
CREATE TABLE IF NOT EXISTS runbook.story_coverage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "storyId"         uuid NOT NULL REFERENCES public."UserStory"(id) ON DELETE CASCADE UNIQUE,

  -- Refs textuais das tasks que cobrem (stable durante a vida da task)
  "coveredByTaskRefs" text[] NOT NULL,

  reason            text NOT NULL,
  "createdAt"       timestamptz NOT NULL DEFAULT now()
);


-- ─── 3. mark_story_covered_by: marca em runbook.story_coverage ──────────────
-- Não polui o produto (UserStory não tem campo notes). Toda info fica na
-- tabela runbook.story_coverage; queries de cobertura usam JOIN.
CREATE OR REPLACE FUNCTION runbook.mark_story_covered_by(
  p_story_ref text,
  p_task_refs text[],
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_story_id uuid;
BEGIN
  SELECT id INTO v_story_id
  FROM public."UserStory"
  WHERE reference = p_story_ref;

  IF v_story_id IS NULL THEN
    RAISE EXCEPTION 'Story % not found', p_story_ref;
  END IF;

  INSERT INTO runbook.story_coverage ("storyId", "coveredByTaskRefs", reason)
  VALUES (v_story_id, p_task_refs, p_reason)
  ON CONFLICT ("storyId") DO UPDATE SET
    "coveredByTaskRefs" = EXCLUDED."coveredByTaskRefs",
    reason = EXCLUDED.reason,
    "createdAt" = now();

  RETURN jsonb_build_object(
    'storyRef', p_story_ref,
    'storyId', v_story_id,
    'coveredBy', p_task_refs,
    'marked', true
  );
END;
$$;


-- ─── 4. attach_task_anchor: registra origem de uma task ──────────────────────
CREATE OR REPLACE FUNCTION runbook.attach_task_anchor(
  p_task_ref            text,
  p_brainstorm_feature  text DEFAULT NULL,
  p_brainstorm_session  uuid DEFAULT NULL,
  p_covers_ac           int[] DEFAULT '{}',
  p_source              text DEFAULT 'from_brainstorm',
  p_gap_reason          text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id uuid;
  v_anchor_id uuid;
BEGIN
  SELECT id INTO v_task_id FROM public."Task" WHERE reference = p_task_ref;
  IF v_task_id IS NULL THEN
    RAISE EXCEPTION 'Task % not found', p_task_ref;
  END IF;

  INSERT INTO runbook.task_anchor (
    "taskId", "brainstormFeatureId", "brainstormSessionId",
    "coversAcIndices", source, "gapReason"
  ) VALUES (
    v_task_id, p_brainstorm_feature, p_brainstorm_session,
    p_covers_ac, p_source, p_gap_reason
  )
  ON CONFLICT ("taskId") DO UPDATE SET
    "brainstormFeatureId" = EXCLUDED."brainstormFeatureId",
    "brainstormSessionId" = EXCLUDED."brainstormSessionId",
    "coversAcIndices" = EXCLUDED."coversAcIndices",
    source = EXCLUDED.source,
    "gapReason" = EXCLUDED."gapReason"
  RETURNING id INTO v_anchor_id;

  RETURN v_anchor_id;
END;
$$;


-- ─── 5. tasks_without_brainstorm_anchor: detecta invenções ──────────────────
-- Lista tasks que não têm anchor (= criadas sem ligação a brainstorm/gap/setup).
CREATE OR REPLACE FUNCTION runbook.tasks_without_brainstorm_anchor(
  p_session_id uuid
) RETURNS TABLE (
  task_ref text,
  story_ref text,
  task_title text,
  reason text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.reference,
    s.reference,
    t.title,
    CASE
      WHEN ta.id IS NULL THEN 'sem anchor — origem não declarada'
      WHEN ta.source = 'manual' THEN 'anchor manual sem fonte do brainstorm'
      ELSE 'inconsistência'
    END
  FROM public."Task" t
  JOIN public."UserStory" s ON t."userStoryId" = s.id
  LEFT JOIN runbook.task_anchor ta ON ta."taskId" = t.id
  WHERE t."designSessionId" = p_session_id
    AND (ta.id IS NULL OR (ta.source = 'manual' AND ta."brainstormFeatureId" IS NULL))
  ORDER BY t.reference;
$$;


-- ─── 6. unmapped_brainstorm_features: detecta features sem task ──────────────
-- Features (não-archived, bucket=mvp ou null) que nenhuma task aponta.
CREATE OR REPLACE FUNCTION runbook.unmapped_brainstorm_features(
  p_session_id uuid
) RETURNS TABLE (
  feature_id text,
  module_hint text,
  bucket text,
  title text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    f.id,
    f."moduleHint",
    f.bucket,
    f.title
  FROM public."DesignSessionBrainstormFeature" f
  WHERE f."sessionId" = p_session_id
    AND NOT f.archived
    AND (f.bucket IS NULL OR f.bucket = 'mvp')  -- só MVP merece task
    AND NOT EXISTS (
      SELECT 1 FROM runbook.task_anchor ta
      WHERE ta."brainstormFeatureId" = f.id
        AND ta."brainstormSessionId" = f."sessionId"
    )
  ORDER BY f."moduleHint" NULLS LAST, f."orderIndex";
$$;


-- ─── 7. story_coverage_report: visão por story ───────────────────────────────
CREATE OR REPLACE FUNCTION runbook.story_coverage_report(
  p_session_id uuid
) RETURNS TABLE (
  story_ref text,
  story_title text,
  module_name text,
  refinement_status text,
  ac_count int,
  task_count int,
  task_refs text[],
  total_fp int,
  covered_marker text  -- 'covered_by_other' se story foi marcada coberta
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.reference,
    s.title,
    COALESCE(m.name, s."proposedModuleName", '(sem módulo)'),
    s."refinementStatus",
    (SELECT count(*)::int FROM public."AcceptanceCriterion" ac WHERE ac."userStoryId" = s.id),
    (SELECT count(*)::int FROM public."Task" t WHERE t."userStoryId" = s.id),
    (SELECT array_agg(t.reference ORDER BY t.reference) FROM public."Task" t WHERE t."userStoryId" = s.id),
    (SELECT COALESCE(sum(t."functionPoints"), 0)::int FROM public."Task" t WHERE t."userStoryId" = s.id),
    (SELECT 'covered_by:' || array_to_string(sc."coveredByTaskRefs", ',')
       FROM runbook.story_coverage sc WHERE sc."storyId" = s.id)
  FROM public."UserStory" s
  LEFT JOIN public."Module" m ON s."moduleId" = m.id
  WHERE s."designSessionId" = p_session_id
  ORDER BY COALESCE(m.name, s."proposedModuleName", 'zzz'), s.reference;
$$;


-- ─── 8. v_zelar_session_state: "onde paramos?" em 1 SELECT ───────────────────
CREATE OR REPLACE VIEW runbook.session_state AS
SELECT
  s.id           AS session_id,
  s.title        AS session_title,
  s."projectId"  AS project_id,
  p.name         AS project_name,
  p."referenceKey" AS project_key,

  -- Counters
  (SELECT count(*) FROM public."UserStory" us WHERE us."designSessionId" = s.id) AS total_stories,
  (SELECT count(*) FROM public."Task" t WHERE t."designSessionId" = s.id) AS total_tasks,
  (SELECT count(*) FROM public."DesignSessionBrainstormFeature" f WHERE f."sessionId" = s.id AND NOT f.archived) AS active_features,

  -- Quality signals
  (SELECT count(*) FROM runbook.tasks_without_brainstorm_anchor(s.id)) AS tasks_without_anchor,
  (SELECT count(*) FROM runbook.unmapped_brainstorm_features(s.id))    AS features_without_task,
  (SELECT count(*) FROM runbook.story_coverage sc
     JOIN public."UserStory" us ON sc."storyId" = us.id
     WHERE us."designSessionId" = s.id) AS stories_covered_by_other,

  -- Last activity
  (SELECT max(t."updatedAt") FROM public."Task" t WHERE t."designSessionId" = s.id) AS last_task_at,
  (SELECT max(reference) FROM public."Task" t WHERE t."designSessionId" = s.id) AS last_task_ref
FROM public."DesignSession" s
JOIN public."Project" p ON s."projectId" = p.id;

COMMIT;
