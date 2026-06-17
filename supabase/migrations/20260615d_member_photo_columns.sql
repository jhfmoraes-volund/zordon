-- ═══════════════════════════════════════════════════════════
-- Foto de perfil no Member.
--
-- Espelha OpenSourceCard.photoStoragePath / photoUpdatedAt:
--   - photoStoragePath: path relativo dentro do bucket member-photos
--     (layout: <memberId>/<uuid>.<ext> — folder = dono, pra RLS).
--   - photoUpdatedAt: timestamp pra cache-bust (?v=) na URL pública.
--
-- Pareado com 20260615e (bucket member-photos + policies).
-- ═══════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE "Member"
  ADD COLUMN IF NOT EXISTS "photoStoragePath" text,
  ADD COLUMN IF NOT EXISTS "photoUpdatedAt" timestamptz;

COMMIT;
