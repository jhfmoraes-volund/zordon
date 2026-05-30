-- Migration J — criar bucket Supabase Storage pra arquivos CSV uploadados

-- 1) Bucket privado com 10 MB limit
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'context-source-files',
  'context-source-files',
  false, -- privado (RLS)
  10485760, -- 10 MB
  ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel']
)
ON CONFLICT (id) DO NOTHING;

-- 2) RLS policies (mesma lógica de project-level: projectId derivado via ContextSource → Project)

-- Policy: SELECT — pode ver se tem acesso ao projeto
CREATE POLICY "context_source_files_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'context-source-files'
    AND EXISTS (
      SELECT 1
      FROM "ContextSource" cs
      WHERE cs.id::text = (storage.objects.name)::text
        AND can_view_project(cs."projectId")
    )
  );

-- Policy: INSERT — pode upload se pode editar projeto
CREATE POLICY "context_source_files_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'context-source-files'
    AND EXISTS (
      SELECT 1
      FROM "ContextSource" cs
      WHERE cs.id::text = (name)::text
        AND can_view_project(cs."projectId")
    )
  );

-- Policy: DELETE — pode deletar se pode editar projeto
CREATE POLICY "context_source_files_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'context-source-files'
    AND EXISTS (
      SELECT 1
      FROM "ContextSource" cs
      WHERE cs.id::text = (storage.objects.name)::text
        AND can_view_project(cs."projectId")
    )
  );
