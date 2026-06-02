-- Modelo "1 planning viva por sprint": dedup de dados legados.
--
-- O modelo antigo (staging-commit) permitia N plannings não-arquivadas por
-- sprint. Antes de criar o índice único parcial (migration 20260601b), é
-- preciso colapsar as duplicatas: pra cada (projectId, sprintId) com >1
-- planning ativa, mantém a com MAIS actions aplicadas (tiebreak createdAt
-- desc) e arquiva o resto. Histórico preservado (archived, não deletado).

BEGIN;

WITH ranked AS (
  SELECT pc.id,
    ROW_NUMBER() OVER (
      PARTITION BY pc."projectId", pc."sprintId"
      ORDER BY (
        SELECT count(*) FROM "MeetingTaskAction" a
        WHERE a."planningCeremonyId" = pc.id AND a.execution = 'applied'
      ) DESC,
      pc."createdAt" DESC
    ) AS rn
  FROM "PlanningCeremony" pc
  WHERE pc.phase <> 'archived' AND pc."sprintId" IS NOT NULL
)
UPDATE "PlanningCeremony"
SET phase = 'archived',
    "archivedAt" = now(),
    "updatedAt" = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;
