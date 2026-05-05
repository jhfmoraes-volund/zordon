-- Drop the auto-seed of Builder/PM/Cliente personas on every new Project.
--
-- These default personas were Volund-internal role placeholders and end up
-- polluting product-specific persona lists (e.g. a Zelar project has
-- personas Lucas/Carlos/Ana from the design session). The Vitor agent now
-- owns persona reconciliation through `sync_project_personas`, so the seed
-- is no longer useful and is actively harmful.
--
-- Existing rows are left intact — projects already populated with their
-- own personas via the design-session flow won't be touched. New projects
-- start with zero personas and rely on the agent (or the UI) to populate.

DROP TRIGGER IF EXISTS "project_seed_personas_trigger" ON public."Project";
DROP FUNCTION IF EXISTS public.seed_project_personas();
