-- Rollback: 20260602g_chat_local_forge_job_kind.sql
-- Remove ForgeJob.kind column + index.
--
-- Pré-requisito: rollback dos 3 outros (h, i, j) primeiro, ou pelo menos
-- garantir que não há ChatTurn ativa apontando pra ForgeJob com kind=chat.

BEGIN;

DROP INDEX IF EXISTS "ForgeJob_kind_status_idx";

ALTER TABLE "ForgeJob" DROP COLUMN IF EXISTS "kind";

COMMIT;
