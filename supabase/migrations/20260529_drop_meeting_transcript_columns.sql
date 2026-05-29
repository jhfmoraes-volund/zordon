-- ═══════════════════════════════════════════════════════════
-- Fundação A — sweep das colunas legadas Meeting.transcript*.
--
-- TranscriptRef é a SSOT de transcrição (ver migs 20260528_transcript_ref e
-- 20260528c_transcript_fulltext). A relação Meeting↔transcript vive em
-- TranscriptRef.meetingId (FK opcional). Após sweep dos 6+ leitores + 4
-- escritores (PR Fundação A, 2026-05-29), nenhum código em src/ ainda lê
-- ou escreve nestas colunas — podem ser removidas com segurança.
--
-- Pré-requisitos (já satisfeitos antes desta migration):
--   • Backfill TranscriptRef completo (verificado via spot-check; 9 rows
--     com transcriptSource→9 rows em TranscriptRef após backfill manual
--     do 1 missing).
--   • Nenhum dos 9 meetings com transcriptSource tinha Meeting.transcript
--     populado (legacy_len=0 em todos) — DROP não perde texto histórico.
--   • src/lib/granola-auto-import.ts agora escreve em TranscriptRef.
--   • src/app/api/meetings/route.ts (POST) e [id]/route.ts (PATCH)
--     transformam payload de transcript/source/sourceId em upsertTranscriptRef.
--   • Leitores migrados pra `transcriptRefs:TranscriptRef!…(fullText)`.
--
-- Próximo: PR Fundação B (DesignSessionTranscript → TranscriptRef).
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- 1. CHECK + UNIQUE INDEX dependentes precisam sair antes das colunas.
ALTER TABLE public."Meeting"
  DROP CONSTRAINT IF EXISTS "Meeting_transcript_pair_ck";

DROP INDEX IF EXISTS public."Meeting_transcriptSource_sourceId_key";

-- 2. Colunas. `transcript` (texto bruto), `transcriptSource`, `transcriptSourceId`.
ALTER TABLE public."Meeting"
  DROP COLUMN IF EXISTS "transcript",
  DROP COLUMN IF EXISTS "transcriptSource",
  DROP COLUMN IF EXISTS "transcriptSourceId";

COMMIT;
