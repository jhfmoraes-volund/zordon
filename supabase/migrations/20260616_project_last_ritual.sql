-- View project_last_ritual — "contexto vivo" do projeto: a última movimentação
-- em QUALQUER ritual (PM Review, Sprint Planning, Release Planning). Alimenta o
-- chip de freshness do board (/overview): o dot diz a health, este chip diz se
-- ainda existe contexto de status sendo mantido.
--
-- "Movimentação" = GREATEST de todos os carimbos relevantes da linha, incluindo
-- updatedAt (qualquer toque). Prefere a conclusão, mas um ritual EM PROGRESSO
-- (só updatedAt) conta — o uso da aba de Rituais já é o sinal. GREATEST ignora
-- NULL, e updatedAt é NOT NULL nas 3 tabelas, então moved_at nunca é nulo.
--
-- Archived não conta: ritual arquivado não é contexto vivo (PMReview e
-- PlanningCeremony têm archivedAt; PlanningSession não tem). DISTINCT ON pega só
-- a movimentação mais recente por projeto, com o kind dela.

BEGIN;

CREATE VIEW project_last_ritual AS
WITH movements AS (
  SELECT
    "projectId"                                          AS project_id,
    'review'::text                                       AS kind,
    GREATEST("updatedAt", "publishedAt")                 AS moved_at
  FROM "PMReview"
  WHERE "archivedAt" IS NULL

  UNION ALL

  SELECT
    "projectId",
    'planning'::text,
    GREATEST("updatedAt", "closedAt", "startedAt", "briefingGeneratedAt")
  FROM "PlanningCeremony"
  WHERE "archivedAt" IS NULL

  UNION ALL

  SELECT
    "projectId",
    'release'::text,
    GREATEST("updatedAt", "approvedAt")
  FROM "PlanningSession"
)
SELECT DISTINCT ON (project_id)
  project_id  AS "projectId",
  kind        AS "lastRitualKind",
  moved_at    AS "lastRitualAt"
FROM movements
ORDER BY project_id, moved_at DESC;

GRANT SELECT ON project_last_ritual TO service_role, authenticated;

COMMENT ON VIEW project_last_ritual IS
  'Última movimentação em qualquer ritual (review/planning/release) por projeto — freshness de "contexto vivo" do board. moved_at = GREATEST dos carimbos da linha incluindo updatedAt (ritual em progresso conta); archived nao conta. DISTINCT ON = movimentação mais recente + seu kind.';

COMMIT;
