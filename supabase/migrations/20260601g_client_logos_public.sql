-- ═══════════════════════════════════════════════════════════
-- client-logos: tornar bucket público.
--
-- Motivo: logos de cliente não são informação sensível em
-- ambiente single-tenant. Bucket público dispensa signed URLs
-- (síncrono, browser-cacheável) e simplifica o <img src>.
--
-- Policies de write (INSERT/UPDATE/DELETE) continuam exigindo
-- is_manager() — ver 20260601f.
-- ═══════════════════════════════════════════════════════════

BEGIN;

UPDATE storage.buckets
   SET public = true
 WHERE id = 'client-logos';

COMMIT;
