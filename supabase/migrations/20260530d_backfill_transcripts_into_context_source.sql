-- Migration D: backfill TranscriptRef → ContextSource
-- Story: CTXSRC-004
--
-- Idempotente: INSERT com ON CONFLICT (id) DO NOTHING preserva id pra FK externas.
-- Mapeia TranscriptRef → ContextSource kind='transcript', payload jsonb contém source/sourceId,
-- fullText, capturedAt preservados. summary fica NULL por enquanto (não existe em TranscriptRef).

INSERT INTO public."ContextSource" (
  id,
  kind,
  "projectId",
  title,
  "externalId",
  "externalUrl",
  payload,
  summary,
  "fullText",
  "capturedAt",
  "createdBy",
  "createdAt",
  "updatedAt"
)
SELECT
  t.id,                                    -- Preserva id para FKs externas continuarem válidas
  'transcript'::public.context_source_kind,
  NULL,                                     -- projectId: TranscriptRef não tem projectId direto
  COALESCE(t.title, t.byline, 'Transcript sem título'),  -- title obrigatório
  t."sourceId",                            -- externalId mapeia sourceId (roamId, granolaId)
  NULL,                                     -- externalUrl: não existe em TranscriptRef
  jsonb_build_object(                      -- payload: dados kind-specific
    'source', t.source,
    'sourceId', t."sourceId",
    'byline', t.byline,
    'meetingId', t."meetingId"
  ),
  NULL,                                     -- summary: não existe em TranscriptRef
  t."fullText",                            -- fullText preservado
  t."capturedAt",                          -- capturedAt preservado
  t."importedById",                        -- createdBy mapeia importedById
  t."importedAt",                          -- createdAt mapeia importedAt
  t."importedAt"                           -- updatedAt = importedAt
FROM public."TranscriptRef" t
ON CONFLICT (id) DO NOTHING;              -- Idempotente: não duplica se já backfilled
