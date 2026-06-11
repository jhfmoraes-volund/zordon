-- Add 'notion' to context_source_kind enum.
-- Notion pages/databases become ContextSource rows (fetched live via Composio
-- notion toolkit), linkable to any Insumos surface (DesignSession, PlanningSession,
-- PlanningCeremony, PMReview) and read by agents via read_context_source.
-- Foundation para o Notion alimentar a Wiki auto-gerada quando o composer existir.
-- NOTE: ALTER TYPE ... ADD VALUE must run outside a transaction block; this
-- file is executed standalone via psql.
ALTER TYPE context_source_kind ADD VALUE IF NOT EXISTS 'notion';
