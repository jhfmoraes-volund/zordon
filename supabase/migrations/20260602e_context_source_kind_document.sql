-- Add 'document' to context_source_kind enum.
-- Unifies file upload (PDF/DOCX/CSV/XLSX/...) as a ContextSource that links to
-- any Insumos surface (DesignSession, PlanningSession, PlanningCeremony,
-- PMReview) and is read by agents via read_context_source.
-- NOTE: ALTER TYPE ... ADD VALUE must run outside a transaction block; this
-- file is executed standalone via psql.
ALTER TYPE context_source_kind ADD VALUE IF NOT EXISTS 'document';
