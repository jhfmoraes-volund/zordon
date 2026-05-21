-- Soft delete (escopo: descartar indicações do Vitor no briefing das Design Sessions).
--
-- Adiciona `dismissedAt` em UserStory e Task. NULL = ativo; timestamp = descartado.
-- Leituras do briefing tree (api/design-sessions/[id]/tree) e do StorySheetByRef
-- filtram `dismissedAt IS NULL`. Demais views (dashboard, agent, insights) seguem
-- enxergando — fora do escopo desta entrega.
--
-- RLS: nenhuma policy nova. Soft delete usa UPDATE, então `story_update` /
-- `task_update` existentes cobrem (manager OR can_edit_tasks).

ALTER TABLE public."UserStory"
  ADD COLUMN IF NOT EXISTS "dismissedAt" timestamptz NULL;

ALTER TABLE public."Task"
  ADD COLUMN IF NOT EXISTS "dismissedAt" timestamptz NULL;

-- Índices parciais — listas filtram quase sempre por `dismissedAt IS NULL`.
CREATE INDEX IF NOT EXISTS "UserStory_designSessionId_active_idx"
  ON public."UserStory" ("designSessionId")
  WHERE "dismissedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Task_designSessionId_active_idx"
  ON public."Task" ("designSessionId")
  WHERE "dismissedAt" IS NULL;
