-- Migration G: backfill PM Review links (transcript + meeting → context)
-- Dois INSERTs idempotentes: transcript links diretos + meeting links via JOIN

-- Part 1: Backfill transcript links (PMReviewTranscriptLink → PMReviewContextLink)
INSERT INTO "PMReviewContextLink" (pmreviewid, contextsourceid, addedby, addedat, weight)
SELECT
  "pmReviewId",
  "transcriptRefId",
  "linkedById",
  "linkedAt",
  weight
FROM "PMReviewTranscriptLink"
ON CONFLICT DO NOTHING;

-- Part 2: Backfill meeting links (PMReviewMeetingLink → PMReviewContextLink)
-- Resolve meetingId → contextSourceId via JOIN com ContextSource kind='meeting'
-- PMReviewMeetingLink não tem weight, então NULL
INSERT INTO "PMReviewContextLink" (pmreviewid, contextsourceid, addedby, addedat, weight)
SELECT
  pml."pmReviewId",
  cs.id,
  pml."linkedById",
  pml."linkedAt",
  NULL
FROM "PMReviewMeetingLink" pml
JOIN "ContextSource" cs ON cs.kind = 'meeting'
  AND (cs.payload->>'meetingId')::uuid = pml."meetingId"
ON CONFLICT DO NOTHING;
