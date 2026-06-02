-- Modelo "1 planning viva por sprint": garantia dura no banco.
--
-- Só pode existir UMA planning não-arquivada por (projectId, sprintId).
-- Índice parcial:
--   • exclui phase='archived' → arquivar libera criar outra ("começar do zero")
--   • exclui sprintId IS NULL → plannings sem sprint não colidem entre si
--
-- Rodar DEPOIS de 20260601a (dedup), senão a criação do índice falha com
-- duplicatas existentes.

CREATE UNIQUE INDEX IF NOT EXISTS "PlanningCeremony_one_active_per_sprint"
  ON public."PlanningCeremony" ("projectId", "sprintId")
  WHERE phase <> 'archived' AND "sprintId" IS NOT NULL;
