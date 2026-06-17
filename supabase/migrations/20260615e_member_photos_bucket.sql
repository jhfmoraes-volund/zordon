-- ═══════════════════════════════════════════════════════════
-- Storage bucket pra fotos de perfil de Member.
--
-- Layout: member-photos/<memberId>/<uuid>.<ext>
--   - public=true → getPublicUrl/URL pública serve direto. O path tem uuid
--     aleatório (não-enumerável), então não vaza diretório.
--   - SELECT: authenticated (a policy não governa a URL pública, mas mantém
--     o object API coerente).
--   - INSERT/UPDATE/DELETE: o DONO (folder[1] = get_my_member_id()) OU admin.
--     Self-service (membro sobe a própria) + admin seta de qualquer um.
--
-- Pareado com 20260615d (Member.photoStoragePath / photoUpdatedAt).
-- ═══════════════════════════════════════════════════════════

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-photos',
  'member-photos',
  true,
  3145728,  -- 3 MB por arquivo
  ARRAY['image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "member_photos_authenticated_read" ON storage.objects;
CREATE POLICY "member_photos_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'member-photos');

DROP POLICY IF EXISTS "member_photos_owner_or_admin_insert" ON storage.objects;
CREATE POLICY "member_photos_owner_or_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'member-photos'
    AND (
      (storage.foldername(name))[1] = public.get_my_member_id()::text
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "member_photos_owner_or_admin_update" ON storage.objects;
CREATE POLICY "member_photos_owner_or_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND (
      (storage.foldername(name))[1] = public.get_my_member_id()::text
      OR public.is_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'member-photos'
    AND (
      (storage.foldername(name))[1] = public.get_my_member_id()::text
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "member_photos_owner_or_admin_delete" ON storage.objects;
CREATE POLICY "member_photos_owner_or_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND (
      (storage.foldername(name))[1] = public.get_my_member_id()::text
      OR public.is_admin()
    )
  );

COMMIT;
