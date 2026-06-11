-- Job state do wiki composer em tabela desde a v1 (runbook D9 — emenda ao PRD
-- que dizia Map<jobId,status> em memória): Cloud Run roda multi-instância,
-- Map em memória quebra o poll de status. Tabela também é o que o cron precisa.
CREATE TABLE "WikiJob" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  trigger      text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','cron')),
  error        text,
  "startedAt"  timestamptz,
  "finishedAt" timestamptz,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wiki_job_project ON "WikiJob"("projectId", "createdAt" DESC);
ALTER TABLE "WikiJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY wj_select ON "WikiJob" FOR SELECT USING (can_view_project("projectId"));
REVOKE INSERT, UPDATE, DELETE ON "WikiJob" FROM authenticated;
