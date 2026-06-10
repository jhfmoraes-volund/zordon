-- Project.phaseChangedAt — quando o projeto entrou na fase atual
-- (commercial/immersion/ops/post_ops). Alimenta "idade na fase" no Overview
-- (ex.: "em comercial há 42d"). Stamp acontece no PUT /api/projects/[id]
-- quando o patch muda a phase. Backfill: createdAt é o melhor proxy.
ALTER TABLE "Project"
  ADD COLUMN "phaseChangedAt" timestamptz NOT NULL DEFAULT now();

UPDATE "Project" SET "phaseChangedAt" = "createdAt";
