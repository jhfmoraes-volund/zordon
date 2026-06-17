-- View sprint_outcome_digest — "memória de sprint" da Vitoria (runbook
-- vitoria-weekly-planning, D11 / Fase 1). Digest DETERMINÍSTICO via SQL das
-- sprints de um projeto: o que fechou, o que ficou pra trás, quanto andou.
--
-- Injetado em loadContext da Vitoria (planning surface) pra dar continuidade
-- semana-a-semana: velocity (FP done), carryover (planejado não-terminado) e
-- temas de retro (good/bad/ideas) das últimas N sprints.
--
-- Convenção de "planejado" alinhada à sprint_delivery_overview:
--   planned  = status ∉ {draft, backlog}      (entrou no compromisso da sprint)
--   done     = status = 'done'
--   carryover= planejado e NÃO done            (status ∉ {draft, backlog, done})
-- Sempre dismissedAt IS NULL. Sprint-rooted (LEFT JOIN Task) pra sprint vazia
-- também aparecer (caso "primeira planning"). Retro via LEFT JOIN (1:1).

BEGIN;

CREATE VIEW sprint_outcome_digest AS
SELECT
  s.id            AS "sprintId",
  s."projectId",
  s.name,
  s."startDate",
  s."endDate",
  s.status,
  s.goal,
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status NOT IN ('draft', 'backlog')), 0)::int      AS planned_fp,
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status = 'done'), 0)::int                          AS velocity_fp,
  COUNT(t.id) FILTER (WHERE t.status = 'done')::int                                                   AS done_count,
  COUNT(t.id) FILTER (WHERE t.status NOT IN ('draft', 'backlog'))::int                                AS total_count,
  COUNT(t.id) FILTER (WHERE t.status NOT IN ('draft', 'backlog', 'done'))::int                        AS carryover_count,
  sr."goodPoints"  AS retro_good,
  sr."badPoints"   AS retro_bad,
  sr.ideas         AS retro_ideas,
  sr."completedAt" AS retro_completed_at
FROM "Sprint" s
LEFT JOIN "Task" t
  ON t."sprintId" = s.id AND t."dismissedAt" IS NULL
LEFT JOIN "SprintRetrospective" sr
  ON sr."sprintId" = s.id
GROUP BY s.id, sr.id;

GRANT SELECT ON sprint_outcome_digest TO service_role, authenticated;

COMMENT ON VIEW sprint_outcome_digest IS
  'Digest determinístico por sprint pra memória da planning (Vitoria, runbook D11). planned_fp = Σ FP status ∉ {draft,backlog}; velocity_fp = Σ FP done; done_count/total_count/carryover_count = contagem de tasks (carryover = planejado não-done). retro_* = texto livre da SprintRetrospective. Sempre dismissedAt IS NULL. Sprint-rooted (sprint vazia aparece com zeros).';

COMMIT;
