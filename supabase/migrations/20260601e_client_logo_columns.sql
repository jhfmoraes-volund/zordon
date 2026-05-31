-- ═══════════════════════════════════════════════════════════
-- Client logo support — colunas em Client
--
-- logoStoragePath: caminho relativo do arquivo no bucket
--                  client-logos (ex: "<clientId>/logo.png").
-- logoUpdatedAt:   usado pra cache-bust no <img src> via
--                  ?v={updatedAt} sem precisar de signed URLs.
--
-- Bucket + policies vão na migration irmã (20260601f).
-- ═══════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public."Client"
  ADD COLUMN IF NOT EXISTS "logoStoragePath" text NULL,
  ADD COLUMN IF NOT EXISTS "logoUpdatedAt" timestamptz NULL;

COMMIT;
