-- Migration C: PMReviewContextLink + RLS
-- Substitui PMReviewTranscriptLink + PMReviewMeetingLink com FK pra ContextSource (polimórfico)

CREATE TABLE public."PMReviewContextLink" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pmReviewId      uuid NOT NULL REFERENCES public."PMReview"(id) ON DELETE CASCADE,
  contextSourceId uuid NOT NULL REFERENCES public."ContextSource"(id) ON DELETE CASCADE,
  weight          text CHECK (weight IN ('primary','supporting','background')),
  addedBy         uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  addedAt         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PMReviewContextLink_pm_source_key"
    UNIQUE (pmReviewId, contextSourceId)
);

CREATE INDEX "PMRCtxLink_pm_idx"     ON public."PMReviewContextLink" (pmReviewId);
CREATE INDEX "PMRCtxLink_source_idx" ON public."PMReviewContextLink" (contextSourceId);

ALTER TABLE public."PMReviewContextLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmrctxlink_select" ON public."PMReviewContextLink"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = pmReviewId AND public.can_view_project(pm."projectId")
    )
  );

CREATE POLICY "pmrctxlink_insert" ON public."PMReviewContextLink"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = pmReviewId AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmrctxlink_update" ON public."PMReviewContextLink"
  FOR UPDATE TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = pmReviewId AND public.can_create_pm_review(pm."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = pmReviewId AND public.can_create_pm_review(pm."projectId")
    )
  );

CREATE POLICY "pmrctxlink_delete" ON public."PMReviewContextLink"
  FOR DELETE TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PMReview" pm
      WHERE pm.id = pmReviewId AND public.can_create_pm_review(pm."projectId")
    )
  );
