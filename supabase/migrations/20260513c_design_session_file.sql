-- DesignSessionFile: user-uploaded files attached to a session (pre_work step).
-- File binaries live in the `design-session-files` Supabase Storage bucket;
-- this table is the metadata index + extracted text for search/agent context.
--
-- Distinct from:
--   - DesignSessionResearch  (agent-generated web search results)
--   - DesignSessionTranscript (Roam meeting transcripts)

BEGIN;

-- ============================================================
-- 1. TABLE
-- ============================================================

CREATE TABLE "DesignSessionFile" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  name text NOT NULL,
  size bigint NOT NULL,
  "mimeType" text NOT NULL,
  "storagePath" text NOT NULL,
  "extractedText" text,
  "extractionStatus" text NOT NULL DEFAULT 'pending'
    CHECK ("extractionStatus" IN ('pending','success','unsupported','failed')),
  "uploadedByMemberId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON "DesignSessionFile"("sessionId", "createdAt" DESC);

-- ============================================================
-- 2. RLS
-- ============================================================

ALTER TABLE "DesignSessionFile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON "DesignSessionFile"
  FOR SELECT USING (can_access_session("sessionId"));

CREATE POLICY "manager_or_editor_insert" ON "DesignSessionFile"
  FOR INSERT WITH CHECK (can_edit_session("sessionId"));

CREATE POLICY "manager_or_editor_update" ON "DesignSessionFile"
  FOR UPDATE
    USING (can_edit_session("sessionId"))
    WITH CHECK (can_edit_session("sessionId"));

CREATE POLICY "manager_or_editor_delete" ON "DesignSessionFile"
  FOR DELETE USING (can_edit_session("sessionId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON "DesignSessionFile" TO authenticated;

-- ============================================================
-- 3. STORAGE BUCKET
-- ============================================================

-- Bucket privado: download/upload sempre via signed URL ou service-role.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-session-files',
  'design-session-files',
  false,
  26214400,  -- 25 MB por arquivo
  NULL       -- aceitamos qualquer mime; validação fina é app-level
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: o app server faz upload/delete via service_role (bypass).
-- Authenticated clients NÃO acessam o bucket diretamente — passam pelo
-- endpoint /files/[id]/download que emite signed URL. Por isso só liberamos
-- SELECT no authenticated pra signed-url resolver, e bloqueamos qualquer
-- coisa direta. Storage policies:

-- Path convention: {sessionId}/{fileId}/{originalName}
-- A authorization real fica na tabela DesignSessionFile (RLS acima) +
-- na geração de signed URL (server-side, valida acesso antes de assinar).

CREATE POLICY "ds_files_authenticated_can_read_via_signed_url"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'design-session-files');

-- Insert/update/delete só via service_role (não criamos policy pra
-- authenticated — sem policy = bloqueado pra non-service_role).

COMMIT;
