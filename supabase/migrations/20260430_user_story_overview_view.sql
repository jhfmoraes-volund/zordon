-- Story Hierarchy V2 — Wave 1.7
-- View de overview: agrega tasks de cada story em totalTasks/doneTasks/FP +
-- computa status derivado.

CREATE OR REPLACE VIEW public.user_story_overview AS
SELECT
  us.id                                                                           AS "userStoryId",
  us."projectId",
  us."moduleId",
  us.reference,
  us.title,
  us."refinementStatus",
  us."acValidatedAt",
  COUNT(t.id)                                                                     AS "totalTasks",
  COUNT(t.id) FILTER (WHERE t.status = 'done')                                    AS "doneTasks",
  COALESCE(SUM(t."functionPoints"), 0)                                            AS "totalFunctionPoints",
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status = 'done'), 0)           AS "doneFunctionPoints",
  CASE
    WHEN COUNT(t.id) = 0
      THEN 'pending'
    WHEN COUNT(t.id) FILTER (WHERE t.status = 'done') = COUNT(t.id)
         AND us."acValidatedAt" IS NOT NULL
      THEN 'done'
    WHEN COUNT(t.id) FILTER (WHERE t.status = 'done') = COUNT(t.id)
      THEN 'tasks_complete'
    WHEN COUNT(t.id) FILTER (WHERE t.status IN ('done','in_progress','review')) > 0
      THEN 'in_progress'
    ELSE 'pending'
  END                                                                             AS "computedStatus"
FROM public."UserStory" us
LEFT JOIN public."Task" t ON t."userStoryId" = us.id
GROUP BY us.id;
