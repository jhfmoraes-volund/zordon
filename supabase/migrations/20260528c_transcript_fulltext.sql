-- TranscriptRef.fullText — armazena o texto completo da transcrição.
--
-- Necessário para que a Vitória leia o conteúdo sem depender de chamadas
-- externas (Granola/Roam) em tempo de execução. Padrão idêntico ao
-- DesignSessionTranscript.fullText e DesignSessionFile.extractedText.
--
-- Backfill: copia Meeting.transcript para TranscriptRefs que têm meetingId
-- e cujo Meeting tem transcript preenchido.

BEGIN;

ALTER TABLE public."TranscriptRef"
  ADD COLUMN IF NOT EXISTS "fullText" text;

-- Backfill: propaga Meeting.transcript → TranscriptRef.fullText
-- para refs que já existem e têm meetingId.
UPDATE public."TranscriptRef" tr
SET "fullText" = m.transcript
FROM public."Meeting" m
WHERE tr."meetingId" = m.id
  AND m.transcript IS NOT NULL
  AND tr."fullText" IS NULL;

COMMENT ON COLUMN public."TranscriptRef"."fullText" IS
  'Texto completo da transcrição. Populado no import (Granola/Roam) ou manualmente. Usado pela Vitória como contexto de planning.';

COMMIT;
