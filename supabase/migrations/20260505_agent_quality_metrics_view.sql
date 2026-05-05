-- agent_quality_metrics: rolling 30-day quality dashboard for Alpha.
-- Each row = (agentSlug, category) with verdict counts and pct_correct.
-- Powers /api/agents/quality-metrics.

create or replace view agent_quality_metrics as
select
  "agentSlug",
  category,
  count(*) as total,
  count(*) filter (where "humanVerdict" = 'correct') as correct,
  count(*) filter (where "humanVerdict" = 'wrong') as wrong,
  count(*) filter (where "humanVerdict" = 'edited') as edited,
  count(*) filter (where "humanVerdict" is null) as pending,
  round(
    100.0 * count(*) filter (where "humanVerdict" = 'correct')
    / nullif(count(*) filter (where "humanVerdict" is not null), 0),
    1
  ) as pct_correct
from "AgentQualityLog"
where "createdAt" > now() - interval '30 days'
group by "agentSlug", category
order by "agentSlug", category;

grant select on agent_quality_metrics to authenticated, service_role;

comment on view agent_quality_metrics is
  'Rolling 30-day quality metrics for Alpha. pct_correct is null when no verdicts exist yet.';
