-- ═══════════════════════════════════════════════════════════
-- TranscriptRef + bucket planning-sources — suporte a planilhas (XLSX/CSV)
-- como fonte de contexto da Planning, lida pela Vitória.
--
-- Decisões:
--   • Reutiliza TranscriptRef ao invés de nova tabela: PlanningTranscriptLink,
--     fullText, RLS e tool `read_transcript_content` já existem e bastam.
--   • `source = 'spreadsheet'` entra no CHECK constraint.
--   • `storagePath` nullable: rastreia o arquivo original no Storage pra
--     re-extração futura (e auditoria). Roam/Granola continuam sem path.
--   • sourceId pra spreadsheet = storagePath (único pelo path). Mantém o
--     unique index (source, sourceId) WHERE sourceId IS NOT NULL servindo.
--
-- Bucket privado `planning-sources`: mesmo molde do `design-session-files`
-- (20260513c). Uploads sempre via service_role do server; signed URL não é
-- usado nesta fase 1 — o pipeline é FormData → parse → Storage upload server.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Estender CHECK constraint pra aceitar 'spreadsheet' ─────────────────
ALTER TABLE public."TranscriptRef"
  DROP CONSTRAINT IF EXISTS "TranscriptRef_source_check";
ALTER TABLE public."TranscriptRef"
  ADD CONSTRAINT "TranscriptRef_source_check"
  CHECK ("source" = ANY (ARRAY[
    'roam'::text,
    'granola'::text,
    'manual'::text,
    'spreadsheet'::text
  ]));

-- ── 2. Adicionar storagePath ───────────────────────────────────────────────
ALTER TABLE public."TranscriptRef"
  ADD COLUMN IF NOT EXISTS "storagePath" text;

COMMENT ON COLUMN public."TranscriptRef"."storagePath" IS
  'Path no Storage do arquivo original (bucket varia por source). Populado pra source=spreadsheet (bucket planning-sources). Roam/Granola ficam null.';

-- ── 3. Bucket privado planning-sources ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'planning-sources',
  'planning-sources',
  false,
  26214400,  -- 25 MB por arquivo (mesmo cap do design-session-files)
  NULL       -- validação de mime é app-level
)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: authenticated pode ler via signed URL (download futuro);
-- writes via service_role (server-only). Mesmo padrão do design-session-files.
DROP POLICY IF EXISTS "planning_sources_authenticated_can_read_via_signed_url"
  ON storage.objects;
CREATE POLICY "planning_sources_authenticated_can_read_via_signed_url"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'planning-sources');

COMMIT;
