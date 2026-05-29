-- ═══════════════════════════════════════════════════════════
-- PlanningContextNote — habilita kind='scope_creep' e generatedByAgent='vitoria'
--
-- Contexto:
--   • `kind` hoje só aceita summary/theme/risk/capacity_signal/code_observation/open_question.
--     'scope_creep' é o sinal canônico pra propostas tardias em fase 'in_review' ou
--     que estouram capacity — chega na vitoria-v2 G2 como skill, mas o enum precisa
--     existir antes pra eval suite (case-07) sair de assertion morta.
--   • `generatedByAgent` hoje só aceita 'alpha'. Vitoria escreve sob alias 'alpha'
--     desde o start (src/lib/agent/agents/vitoria/tools.ts:48). Como Vitoria é o
--     agente da PlanningCeremony e Alpha é o de Meeting, separar os autores no
--     histórico importa pra telemetria (AgentUsage, AgentProposalOutcome) ficar
--     coerente — outcome wiring em task-action-executor já usa agentName='vitoria'.
--
-- Backfill:
--   Rows criadas pela Vitoria em planejamentos (planningCeremonyId IS NOT NULL)
--   ficam como 'vitoria'. Rows de Alpha em reuniões soltas (meetingId IS NOT NULL
--   e planningCeremonyId IS NULL) mantêm 'alpha'. Mantém o histórico correto.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Estender kind ──────────────────────────────────────────────────────
ALTER TABLE public."PlanningContextNote"
  DROP CONSTRAINT IF EXISTS "PlanningContextNote_kind_check";
ALTER TABLE public."PlanningContextNote"
  ADD CONSTRAINT "PlanningContextNote_kind_check"
  CHECK (kind = ANY (ARRAY[
    'summary'::text,
    'theme'::text,
    'risk'::text,
    'capacity_signal'::text,
    'code_observation'::text,
    'open_question'::text,
    'scope_creep'::text
  ]));

-- ── 2. Estender generatedByAgent ──────────────────────────────────────────
ALTER TABLE public."PlanningContextNote"
  DROP CONSTRAINT IF EXISTS "PlanningContextNote_generatedByAgent_check";
ALTER TABLE public."PlanningContextNote"
  ADD CONSTRAINT "PlanningContextNote_generatedByAgent_check"
  CHECK (
    "generatedByAgent" IS NULL
    OR "generatedByAgent" = ANY (ARRAY['alpha'::text, 'vitoria'::text])
  );

-- ── 3. Backfill: notes de planning passam pra 'vitoria' ───────────────────
UPDATE public."PlanningContextNote"
SET "generatedByAgent" = 'vitoria'
WHERE "generatedByAgent" = 'alpha'
  AND "planningCeremonyId" IS NOT NULL;

COMMIT;
