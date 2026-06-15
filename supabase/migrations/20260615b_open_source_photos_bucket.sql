-- ═══════════════════════════════════════════════════════════
-- Storage bucket pra fotos dos cards de Open Source
--
-- Layout: open-source-photos/<uuid>.<ext>
-- - SELECT: qualquer authenticated (fotos não são sensíveis;
--   simplifica <img> sem signed URLs).
-- - INSERT/UPDATE/DELETE: admins (is_admin()).
--
-- Pareado com 20260615 (tabela OpenSourceCard.photoStoragePath /
-- photoUpdatedAt).
-- ═══════════════════════════════════════════════════════════

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'open-source-photos',
  'open-source-photos',
  false,
  3145728,  -- 3 MB por arquivo
  ARRAY['image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "open_source_photos_authenticated_read" ON storage.objects;
CREATE POLICY "open_source_photos_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'open-source-photos');

DROP POLICY IF EXISTS "open_source_photos_admin_insert" ON storage.objects;
CREATE POLICY "open_source_photos_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'open-source-photos' AND public.is_admin());

DROP POLICY IF EXISTS "open_source_photos_admin_update" ON storage.objects;
CREATE POLICY "open_source_photos_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'open-source-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'open-source-photos' AND public.is_admin());

DROP POLICY IF EXISTS "open_source_photos_admin_delete" ON storage.objects;
CREATE POLICY "open_source_photos_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'open-source-photos' AND public.is_admin());

COMMIT;
