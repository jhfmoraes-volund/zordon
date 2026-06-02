-- Project.phase — fase do ciclo de entrega do projeto (não confundir com
-- PlanningCeremony.phase, que é por cerimônia, nem ProjectBusinessContext.stage,
-- que é estágio de negócio do cliente).
--
--   commercial → Comercial (pré-contrato / proposta)
--   immersion  → Imersão (discovery / DS Inception)
--   ops        → Ops (entrega / sprints rodando)
--   post_ops   → Pós-Ops (manutenção / suporte pós-entrega)
--
-- Setada manualmente pelo PM no edit do projeto. Default 'ops' (maioria dos
-- ativos está entregando); fase corrige-se no edit, sem backfill heurístico.

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'ops'
  CHECK (phase IN ('commercial', 'immersion', 'ops', 'post_ops'));
