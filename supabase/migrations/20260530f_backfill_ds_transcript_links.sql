-- Migration F: backfill DesignSessionTranscriptLink → DesignSessionContextLink
-- Depends on: CTXSRC-002 (DesignSessionContextLink table), CTXSRC-004 (TranscriptRef → ContextSource backfill)
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING

INSERT INTO "DesignSessionContextLink" (
  designsessionid,
  contextsourceid,
  weight,
  addedby,
  addedat
)
SELECT
  "designSessionId",
  "transcriptRefId" AS contextsourceid,  -- TranscriptRef.id = ContextSource.id (preserved in CTXSRC-004)
  weight,
  "linkedById",
  "linkedAt"
FROM "DesignSessionTranscriptLink"
ON CONFLICT (designsessionid, contextsourceid) DO NOTHING;
