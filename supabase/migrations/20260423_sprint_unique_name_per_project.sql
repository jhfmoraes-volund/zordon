-- Deduplicate Sprint rows by (projectId, name) and add a unique constraint
-- to prevent future duplicates from any insert path (API, client, agent).

-- For each (projectId, name) with duplicates, keep the row with the most
-- tasks (tie-break: earliest createdAt). Delete the rest.
WITH ranked AS (
  SELECT
    s.id,
    ROW_NUMBER() OVER (
      PARTITION BY s."projectId", s.name
      ORDER BY
        (SELECT COUNT(*) FROM public."Task" t WHERE t."sprintId" = s.id) DESC,
        s."createdAt" ASC
    ) AS rn
  FROM public."Sprint" s
)
DELETE FROM public."Sprint"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE public."Sprint"
  ADD CONSTRAINT "Sprint_projectId_name_key" UNIQUE ("projectId", "name");
