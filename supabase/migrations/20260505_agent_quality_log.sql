-- AgentQualityLog: structured log of meaningful Alpha decisions, used to
-- measure agent quality over time. Each log entry captures one structured
-- decision the agent made (story_created, module_classified, plan_proposed,
-- plan_executed) along with its reasoning. A separate verdict process — heur-
-- istic cron, PM review, or auto-rollback detection — fills `humanVerdict`
-- to compute pct_correct on the dashboard.
--
-- This is NOT a full audit log of every tool call — that's `AgentUsage`.
-- AgentQualityLog only records decisions where "right vs wrong" is meaningful
-- and verifiable.

create table if not exists "AgentQualityLog" (
  id uuid primary key default gen_random_uuid(),
  "agentSlug" text not null default 'alpha',
  "projectId" uuid references "Project"(id) on delete set null,
  "memberId" uuid references "Member"(id) on delete set null,
  "threadId" uuid references "ChatThread"(id) on delete set null,
  -- Category — drives the verdict heuristic and the dashboard breakdown.
  -- Allowed values: 'story_created', 'module_classified', 'module_proposed',
  --                 'plan_proposed', 'plan_executed', 'ac_managed'
  category text not null,
  -- Free-form structured payload. Examples per category:
  --   story_created: { storyRef, moduleId, personaId, acCount, reasoning }
  --   module_proposed: { storyRef, proposedName, reasoning }
  --   plan_proposed: { sprintsCovered, taskCount, totalFp, reasoning }
  --   plan_executed: { sprintsAffected, tasksUpdated, reasoning }
  payload jsonb not null,
  -- Filled later: 'correct' | 'wrong' | 'edited' | null
  "humanVerdict" text,
  "verdictAt" timestamptz,
  -- Source of the verdict: 'cron_heuristic' | 'pm_review' | 'auto_detect'
  "verdictSource" text,
  "createdAt" timestamptz not null default now()
);

create index if not exists "agent_quality_log_agent_created_idx"
  on "AgentQualityLog" ("agentSlug", "createdAt" desc);

-- Partial index for the unverified queue (most queries hit this)
create index if not exists "agent_quality_log_unverified_idx"
  on "AgentQualityLog" ("agentSlug", "createdAt" desc)
  where "humanVerdict" is null;

-- Index for project-scoped queries (PM dashboard "show my project's logs")
create index if not exists "agent_quality_log_project_idx"
  on "AgentQualityLog" ("projectId", "createdAt" desc)
  where "projectId" is not null;

-- RLS: managers can read all; ops members can read their projects.
alter table "AgentQualityLog" enable row level security;

create policy "agent_quality_log_manager_read" on "AgentQualityLog"
  for select to authenticated
  using (is_manager());

create policy "agent_quality_log_project_read" on "AgentQualityLog"
  for select to authenticated
  using ("projectId" is not null and can_view_project("projectId"));

-- Inserts only via service role (the wrappers run server-side with service key)
create policy "agent_quality_log_service_insert" on "AgentQualityLog"
  for insert to service_role
  with check (true);

-- Verdict updates by service role (cron) or manager (manual review)
create policy "agent_quality_log_verdict_update" on "AgentQualityLog"
  for update to authenticated
  using (is_manager());

grant select on "AgentQualityLog" to authenticated;
grant insert, update on "AgentQualityLog" to service_role;
