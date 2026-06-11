-- Migration: Project.driveFolderId + driveLinkedBy
-- Description: Pasta do Google Drive linkada ao projeto (Fase 1 da integração Drive).
--   driveLinkedBy = member cujo connected account Composio executa o sync.
-- Ref: docs/runbooks/project-drive-runbook.md (D3/D4)
-- Date: 2026-06-10

ALTER TABLE "Project"
  ADD COLUMN "driveFolderId" text,
  ADD COLUMN "driveLinkedBy" uuid REFERENCES "Member"(id) ON DELETE SET NULL;
