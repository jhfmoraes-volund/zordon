-- Migration E: Backfill Meetings linkados em PMReviewMeetingLink → ContextSource
-- Cria ContextSource kind='meeting' para cada Meeting referenciado.
-- Idempotente via NOT EXISTS.

INSERT INTO public."ContextSource" (
  id,
  kind,
  "projectId",
  title,
  "externalId",
  summary,
  "capturedAt",
  "createdBy",
  "createdAt",
  "updatedAt",
  payload
)
SELECT
  gen_random_uuid() AS id,
  'meeting'::public.context_source_kind AS kind,
  pr."projectId",
  COALESCE(m.title, 'Reunião sem título') AS title,
  m.id::text AS "externalId",
  m.notes AS summary, -- Meeting.notes → summary
  m.date AS "capturedAt",
  m."createdById" AS "createdBy",
  now() AS "createdAt",
  now() AS "updatedAt",
  jsonb_build_object(
    'meetingId', m.id,
    'date', m.date,
    'type', m.type,
    'kind', m.kind
  ) AS payload
FROM public."Meeting" m
INNER JOIN public."PMReviewMeetingLink" link ON link."meetingId" = m.id
INNER JOIN public."PMReview" pr ON pr.id = link."pmReviewId"
WHERE NOT EXISTS (
  SELECT 1
  FROM public."ContextSource" cs
  WHERE cs.kind = 'meeting'
    AND cs."externalId" = m.id::text
);
