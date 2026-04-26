-- Rename agent: Zordon → Alpha.
-- Touches Agent.id (opaque internal pk), Agent.name, plus every child row
-- whose FK points at it (AgentConfig, AgentHeuristic, AgentVersion, ChatThread)
-- and the lowercase agentName identifier in ChatThread + AgentUsage so the
-- chat history and cost log stay attached.
-- Slug ('ops') is preserved on purpose — describes the function, not the name.

BEGIN;

ALTER TABLE public."AgentConfig"    DROP CONSTRAINT "AgentConfig_agentId_fkey";
ALTER TABLE public."AgentHeuristic" DROP CONSTRAINT "AgentHeuristic_agentId_fkey";
ALTER TABLE public."AgentVersion"   DROP CONSTRAINT "AgentVersion_agentId_fkey";
ALTER TABLE public."ChatThread"     DROP CONSTRAINT "ChatThread_agentId_fkey";

UPDATE public."Agent"
   SET id = 'agent-alpha',
       name = 'Alpha'
 WHERE id = 'agent-zordon';

UPDATE public."AgentConfig"    SET "agentId" = 'agent-alpha' WHERE "agentId" = 'agent-zordon';
UPDATE public."AgentHeuristic" SET "agentId" = 'agent-alpha' WHERE "agentId" = 'agent-zordon';
UPDATE public."AgentVersion"   SET "agentId" = 'agent-alpha' WHERE "agentId" = 'agent-zordon';
UPDATE public."ChatThread"     SET "agentId" = 'agent-alpha' WHERE "agentId" = 'agent-zordon';

UPDATE public."ChatThread" SET "agentName" = 'alpha' WHERE "agentName" = 'zordon';
UPDATE public."AgentUsage" SET "agentName" = 'alpha' WHERE "agentName" = 'zordon';

ALTER TABLE public."AgentConfig"
  ADD CONSTRAINT "AgentConfig_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON DELETE CASCADE;

ALTER TABLE public."AgentHeuristic"
  ADD CONSTRAINT "AgentHeuristic_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON DELETE CASCADE;

ALTER TABLE public."AgentVersion"
  ADD CONSTRAINT "AgentVersion_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES public."Agent"(id) ON DELETE CASCADE;

ALTER TABLE public."ChatThread"
  ADD CONSTRAINT "ChatThread_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES public."Agent"(id);

COMMIT;
