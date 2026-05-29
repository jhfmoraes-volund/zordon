ALTER TABLE "ProjectWikiSection"
  ADD COLUMN IF NOT EXISTS "generatedAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "generatedBy"    text,
  ADD COLUMN IF NOT EXISTS "schemaVersion"  int       DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "suppressed"     jsonb     NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "ProjectWikiSection"."generatedBy" IS
  'manual | cron | event:ds_completed | event:sprint_closed | event:pm_review';
COMMENT ON COLUMN "ProjectWikiSection"."suppressed" IS
  'array<{ bulletHash:text, suppressedBy:uuid, suppressedAt:timestamptz }>';

-- RLS: existente já cobre SELECT via ProjectAccess.
-- INSERT/UPDATE/DELETE: revogar de roles autenticados; só service role escreve.
REVOKE INSERT, UPDATE, DELETE ON "ProjectWikiSection" FROM authenticated;
-- (suppress endpoint usa service role e checa canEditProject no Next layer)
