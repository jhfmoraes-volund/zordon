-- Drop coluna legacy `Task.acceptanceCriteria` (text) — Onda D do cleanup.
--
-- Substituto: tabela `AcceptanceCriterion` (rows interativos com checkbox).
--
-- Pré-condições satisfeitas em 2026-05-01:
--   - bunx tsc --noEmit passa zero erros
--   - grep -rn '\btask\.acceptanceCriteria\b' src/ retorna zero hits de string
--   - todos consumers de AC já leem da tabela AcceptanceCriterion via adapter
--   - meeting actions, Alpha tools, duplicate, clone refatorados (ZRD-JM-NN)
--
-- Backup do conteúdo prévio:
--   backups/task-acceptance-criteria-text-20260501-1208.csv (133 rows)
--
-- type/scope mantidos por enquanto (alimentam matriz suggestFunctionPoints 4×4).
-- Cleanup futuro com decisão sobre FP matrix.

BEGIN;

ALTER TABLE "Task"
  DROP COLUMN "acceptanceCriteria";

COMMIT;
