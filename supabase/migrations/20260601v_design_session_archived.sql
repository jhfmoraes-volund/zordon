-- Arquivamento de DesignSession.
--
-- Decisão (PRD-Forge separation): PRD é artefato de sessão. Sessão com PRDs
-- NÃO pode ser deletada (deletar órfanaria os PRDs, que perdem sua única casa de
-- spec e podem ter ForgeRun referenciando). Em vez disso, a sessão é arquivada.
--
-- `archivedAt` é ortogonal ao `status` (mesmo padrão de `dismissedAt` em Task /
-- ProductRequirement): a sessão preserva seu status de ciclo de vida, só sai das
-- listas ativas e fica read-only.

ALTER TABLE public."DesignSession"
  ADD COLUMN IF NOT EXISTS "archivedAt" timestamptz;

COMMENT ON COLUMN public."DesignSession"."archivedAt" IS
  'Quando preenchido, a sessão está arquivada (read-only, fora das listas ativas). PRDs vinculados continuam acessíveis. Sessão com PRD não pode ser deletada — só arquivada.';
