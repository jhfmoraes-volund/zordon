-- Fix: agent_usage_hourly_mv never refreshes → KPIs "últimas 24h" show zero.
--
-- Root cause: refresh_agent_usage_hourly_mv() runs REFRESH ... CONCURRENTLY,
-- which requires a unique index over SIMPLE COLUMNS. The existing unique index
-- used COALESCE(...) expressions (to dedup NULL project_id/member_id), and
-- Postgres rejects expression-based unique indexes for CONCURRENT refresh.
-- Result: the cron failed every 5 min and the MV was frozen at 2026-05-30.
--
-- Fix: replace the expression unique index with a simple-column unique index
-- using NULLS NOT DISTINCT (Postgres 15+), so NULL project_id/member_id rows
-- still dedup correctly AND CONCURRENTLY works. Then repopulate immediately.

DROP INDEX IF EXISTS public.agent_usage_hourly_mv_unique_idx;

CREATE UNIQUE INDEX agent_usage_hourly_mv_unique_idx
  ON public.agent_usage_hourly_mv (
    bucket_hour, agent_name, model_id, call_kind, project_id, member_id
  )
  NULLS NOT DISTINCT;

-- Repopulate now (non-concurrent: takes a brief lock, MV is tiny).
-- Subsequent cron runs will use CONCURRENTLY against the new index.
REFRESH MATERIALIZED VIEW public.agent_usage_hourly_mv;
