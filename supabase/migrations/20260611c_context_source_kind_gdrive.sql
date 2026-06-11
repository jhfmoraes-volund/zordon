-- Add 'gdrive_file' to context_source_kind enum (runbook D6).
-- Arquivos do Drive importados explicitamente da aba Drive viram ContextSource
-- (pool por projeto), com fullText extraído (export Google-native ou download +
-- pipeline de extração) e dedup por (kind, externalId=fileId, projectId).
-- NOTE: ALTER TYPE ... ADD VALUE must run outside a transaction block; this
-- file is executed standalone via psql.
ALTER TYPE context_source_kind ADD VALUE IF NOT EXISTS 'gdrive_file';
