-- DROP de tabelas legadas órfãs + a view que dependia de uma delas.
--
-- Pré-condições (verificadas read-only em 2026-06-01):
--   • TaskAcceptanceCriterion (772 linhas, 288 tasks): tabela de junção Task↔AC
--     LEGADA. Substituída pela coluna AcceptanceCriterion.taskId (3185 linhas /
--     373 tasks — modelo atual, mais populado). Único leitor de código vivo era
--     o suggest-sprints (migrado pra AcceptanceCriterion.taskId no mesmo PR).
--   • task_coverage_v: view de cobertura task×AC que joinava via TaskAcceptanceCriterion.
--     0 refs de código; semântica M:N obsoleta no modelo novo (AC→1 task). Dropada.
--   • DesignSessionStepData_backup_20260512: backup pontual da janela de
--     normalização da DS. Já passou.
--
-- Rodar depois do teste manual + do deploy do code change do suggest-sprints.

BEGIN;

-- View depende de TaskAcceptanceCriterion — cai primeiro.
DROP VIEW IF EXISTS task_coverage_v;

DROP TABLE IF EXISTS "TaskAcceptanceCriterion";
DROP TABLE IF EXISTS "DesignSessionStepData_backup_20260512";

COMMIT;
