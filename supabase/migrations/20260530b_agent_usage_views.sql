-- Agent usage hourly aggregation materialized view
-- Aggregates AgentUsage by hour x (agent, model, callKind, project, member)
-- Refreshed every 5 minutes via pg_cron.

DROP MATERIALIZED VIEW IF EXISTS public.agent_usage_hourly_mv CASCADE;

CREATE MATERIALIZED VIEW public.agent_usage_hourly_mv AS
SELECT
  date_trunc('hour', "createdAt")        AS bucket_hour,
  "agentName"                            AS agent_name,
  "modelId"                              AS model_id,
  "callKind"                             AS call_kind,
  "projectId"                            AS project_id,
  "memberId"                             AS member_id,
  COUNT(*)::integer                      AS calls,
  SUM("costUsd")::numeric(18, 8)         AS cost_usd,
  SUM("promptTokens")::bigint            AS input_tokens,
  SUM(COALESCE("cachedPromptTokens",0))::bigint AS cached_input_tokens,
  SUM("completionTokens")::bigint        AS output_tokens,
  SUM(COALESCE("reasoningTokens",0))::bigint    AS reasoning_tokens,
  SUM("totalTokens")::bigint             AS total_tokens
FROM public."AgentUsage"
GROUP BY 1, 2, 3, 4, 5, 6
WITH DATA;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX agent_usage_hourly_mv_unique_idx
  ON public.agent_usage_hourly_mv (
    bucket_hour, agent_name, model_id, call_kind,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(member_id,  '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX agent_usage_hourly_mv_bucket_idx
  ON public.agent_usage_hourly_mv (bucket_hour DESC);

CREATE INDEX agent_usage_hourly_mv_model_idx
  ON public.agent_usage_hourly_mv (model_id, bucket_hour DESC);

GRANT SELECT ON public.agent_usage_hourly_mv TO authenticated, service_role;

-- Refresh function: CONCURRENTLY so reads aren't blocked
CREATE OR REPLACE FUNCTION public.refresh_agent_usage_hourly_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.agent_usage_hourly_mv;
END;
$$;

-- Schedule cron: every 5 minutes
DO $$
DECLARE
  existing_jobid bigint;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'refresh_agent_usage_hourly_mv';

  IF existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'refresh_agent_usage_hourly_mv',
    '*/5 * * * *',
    $cron$SELECT public.refresh_agent_usage_hourly_mv();$cron$
  );
END;
$$;

COMMENT ON MATERIALIZED VIEW public.agent_usage_hourly_mv IS
  'Hourly rollup of AgentUsage by agent/model/callKind/project/member. Refreshed every 5min via pg_cron.';
