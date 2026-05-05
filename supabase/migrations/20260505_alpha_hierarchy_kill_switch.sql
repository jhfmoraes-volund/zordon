-- Adds a per-project kill switch for Alpha's hierarchy + planner write tools.
-- Default true: existing projects keep behavior as today.
-- Set to false via SQL/UI when a project starts misbehaving in prod —
-- avoids needing a code rollback.
--
-- Read tools (list_modules, list_personas, list_stories, get_story,
-- get_project_capacity, list_unplanned_tasks) stay enabled regardless;
-- they are safe and don't mutate state.
--
-- Affected when false:
--   create_user_story, update_user_story, set_story_refinement,
--   approve_module, manage_story_ac, bulk_update_tasks

alter table "Project"
  add column if not exists "alphaHierarchyEnabled" boolean not null default true;

comment on column "Project"."alphaHierarchyEnabled" is
  'Kill switch for Alpha agent write operations on hierarchy + planner. Read tools always work.';
