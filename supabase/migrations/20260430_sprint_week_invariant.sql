-- Sprint = 7 dias, sempre segunda → domingo (local time).
-- 1) Normaliza sprints existentes que estão fora do invariante.
-- 2) Backfill: cria "Sprint 1" pra projetos sem sprint.
-- 3) CHECK constraint trava a regra a partir daqui.

BEGIN;

-- ─── 1. Normalize existing sprints ────────────────────────────────────────
-- startDate snap pra segunda da semana (ISO), endDate = startDate + 6 dias.
-- date_trunc('week', ...) no Postgres usa ISO week (segunda).
UPDATE "Sprint"
SET
  "startDate" = date_trunc('week', "startDate")::timestamp,
  "endDate"   = (date_trunc('week', "startDate") + interval '6 days')::timestamp,
  "updatedAt" = NOW()
WHERE
  EXTRACT(ISODOW FROM "startDate") <> 1
  OR ("endDate"::date - "startDate"::date) <> 6;

-- ─── 2. Backfill: 1 sprint por projeto sem sprint ─────────────────────────
INSERT INTO "Sprint" (id, name, "projectId", "startDate", "endDate", status, "updatedAt")
SELECT
  gen_random_uuid(),
  'Sprint 1',
  p.id,
  date_trunc('week', CURRENT_DATE)::timestamp,
  (date_trunc('week', CURRENT_DATE) + interval '6 days')::timestamp,
  'planning',
  NOW()
FROM "Project" p
LEFT JOIN "Sprint" s ON s."projectId" = p.id
WHERE s.id IS NULL;

-- ─── 3. CHECK constraint — invariante permanente ──────────────────────────
ALTER TABLE "Sprint"
  ADD CONSTRAINT sprint_week_invariant
  CHECK (
    EXTRACT(ISODOW FROM "startDate") = 1
    AND ("endDate"::date - "startDate"::date) = 6
  );

COMMIT;
