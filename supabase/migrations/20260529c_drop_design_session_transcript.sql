-- ═══════════════════════════════════════════════════════════
-- Fundação B (parte 2) — DROP `DesignSessionTranscript`.
--
-- Dados migrados pra TranscriptRef + DesignSessionTranscriptLink na mig
-- 20260529b_design_session_transcript_link.sql (2 rows, validado:
-- dstl_rows=2, todas as DST com TranscriptRef linkado + has_fulltext=true).
--
-- Código migrado em paralelo (mesma PR Fundação B):
--   • src/lib/agent/agents/vitor/index.ts        — usa listSessionTranscripts.
--   • src/app/api/design-sessions/[id]/transcripts/route.ts        — upsert + link.
--   • src/app/api/design-sessions/[id]/transcripts/[transcriptId]/route.ts — delete por link.id.
--   • src/app/api/design-sessions/[id]/full/route.ts — via DAL.
--   • src/components/design-session/transcript-modal.tsx           — shape leve local.
--
-- Sem leitores/escritores restantes na DST — pode dropar.
-- ═══════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS public."DesignSessionTranscript" CASCADE;

COMMIT;
