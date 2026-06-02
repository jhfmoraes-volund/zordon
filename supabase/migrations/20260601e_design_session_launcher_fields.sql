-- QAL-001 — Quick-Ask Launcher: campos de launcher na DesignSession
--
-- launcherBrief: brief opcional digitado no launcher do Quick-Ask
--   (substitui PrdQuickAskJob.brief no fluxo novo, sem job single-shot).
-- firstAnalysisStatus: gatilho idempotente da 1ª análise do Vitor no step
--   prd_briefing (pending → done|skipped). Evita re-disparo a cada mount.
--
-- RLS: nenhuma policy nova — colunas herdam a policy de DesignSession
-- (can_view_project / can_edit_session). Sem tabela nova.

ALTER TABLE "DesignSession"
  ADD COLUMN IF NOT EXISTS "launcherBrief" text,
  ADD COLUMN IF NOT EXISTS "firstAnalysisStatus" text NOT NULL DEFAULT 'pending'
    CHECK ("firstAnalysisStatus" IN ('pending', 'done', 'skipped'));

COMMENT ON COLUMN "DesignSession"."launcherBrief" IS
  'Brief opcional digitado no launcher do Quick-Ask (substitui PrdQuickAskJob.brief no fluxo novo).';
COMMENT ON COLUMN "DesignSession"."firstAnalysisStatus" IS
  'Gatilho idempotente da 1a analise do Vitor no step prd_briefing: pending -> done|skipped.';
