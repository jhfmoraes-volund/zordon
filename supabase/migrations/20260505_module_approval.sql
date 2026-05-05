-- Module.approvedAt — flag de aprovação. NULL = draft (não aparece no projeto);
-- timestamp = aprovado e visível em /projects/[id]. Aprovação cascateia: ao
-- aprovar um Module, todas as UserStories vinculadas (moduleId) e suas Tasks
-- "aparecem" no projeto via filtros nas queries de leitura — sem UPDATE em cascata.
--
-- approvedBy é nullable porque: (a) tools do agente podem aprovar sem memberId
-- explícito, (b) seed/migrations futuras podem aprovar em batch.

ALTER TABLE "Module"
  ADD COLUMN "approvedAt" timestamptz NULL,
  ADD COLUMN "approvedBy" uuid NULL REFERENCES "Member"(id) ON DELETE SET NULL;

CREATE INDEX "Module_projectId_approvedAt_idx"
  ON "Module" ("projectId", "approvedAt");

-- Backfill: módulos pré-existentes neste projeto são considerados aprovados
-- (eles já estavam visíveis em /projects/[id] antes desta mudança). Nada
-- desaparece da UI por causa desta migration.
UPDATE "Module" SET "approvedAt" = "createdAt" WHERE "approvedAt" IS NULL;
