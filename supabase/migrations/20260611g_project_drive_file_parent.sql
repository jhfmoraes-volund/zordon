-- Migration: ProjectDriveFile.parentId (navegação em árvore na aba Drive)
-- Description: parentId = fileId da pasta-mãe no Drive; NULL = filho direto da
--   pasta linkada (raiz). Sync recursivo grava a árvore; UI navega filtrando
--   o índice local (sem chamada ao Google por clique).
-- Ref: docs/runbooks/project-drive-runbook.md (Fase 1.5 — supersede D10)
-- Date: 2026-06-11

ALTER TABLE "ProjectDriveFile" ADD COLUMN "parentId" text;

CREATE INDEX ix_pdf_project_parent ON "ProjectDriveFile"("projectId", "parentId");
