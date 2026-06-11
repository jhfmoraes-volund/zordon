-- Migration: ProjectDriveFile (índice de metadata da pasta Drive do projeto)
-- Description: Espelho read-only dos filhos diretos da pasta linkada. Drive é o
--   SSOT dos arquivos — binário nunca é armazenado aqui. Writes só server-side.
-- Ref: docs/runbooks/project-drive-runbook.md (D5/D8)
-- Date: 2026-06-10

CREATE TABLE "ProjectDriveFile" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"    uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "fileId"       text NOT NULL,
  name           text NOT NULL,
  "mimeType"     text NOT NULL,
  "sizeBytes"    bigint,
  "modifiedTime" timestamptz,
  "webViewLink"  text,
  "iconHint"     text,
  "syncedAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "fileId")
);

CREATE INDEX ix_pdf_project ON "ProjectDriveFile"("projectId");

ALTER TABLE "ProjectDriveFile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_select ON "ProjectDriveFile" FOR SELECT
  USING (can_view_project("projectId"));

-- Writes só server-side (API routes com service role)
REVOKE INSERT, UPDATE, DELETE ON "ProjectDriveFile" FROM authenticated;
