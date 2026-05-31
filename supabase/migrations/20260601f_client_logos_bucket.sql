-- ═══════════════════════════════════════════════════════════
-- Storage bucket pra logos de clientes
--
-- Layout: client-logos/<clientId>/logo.<ext>
-- - SELECT: qualquer authenticated (logos não são sensíveis;
--   simplifica <img> sem signed URLs).
-- - INSERT/UPDATE/DELETE: managers (is_manager()).
--
-- Pareado com 20260601e (colunas Client.logoStoragePath /
-- logoUpdatedAt).
-- ═══════════════════════════════════════════════════════════

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-logos',
  'client-logos',
  false,
  2097152,  -- 2 MB por arquivo
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "client_logos_authenticated_read" ON storage.objects;
CREATE POLICY "client_logos_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'client-logos');

DROP POLICY IF EXISTS "client_logos_manager_insert" ON storage.objects;
CREATE POLICY "client_logos_manager_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'client-logos' AND public.is_manager());

DROP POLICY IF EXISTS "client_logos_manager_update" ON storage.objects;
CREATE POLICY "client_logos_manager_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'client-logos' AND public.is_manager())
  WITH CHECK (bucket_id = 'client-logos' AND public.is_manager());

DROP POLICY IF EXISTS "client_logos_manager_delete" ON storage.objects;
CREATE POLICY "client_logos_manager_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'client-logos' AND public.is_manager());

COMMIT;
