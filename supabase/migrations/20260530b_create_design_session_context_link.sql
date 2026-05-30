-- Migration B: DesignSessionContextLink + RLS
-- Substitui DesignSessionTranscriptLink com FK pra ContextSource (polimórfico)

CREATE TABLE public."DesignSessionContextLink" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  designSessionId uuid NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  contextSourceId uuid NOT NULL REFERENCES public."ContextSource"(id) ON DELETE CASCADE,
  weight          text CHECK (weight IN ('primary','supporting','background')),
  addedBy         uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  addedAt         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "DesignSessionContextLink_session_source_key"
    UNIQUE (designSessionId, contextSourceId)
);

CREATE INDEX "DSCtxLink_session_idx" ON public."DesignSessionContextLink" (designSessionId);
CREATE INDEX "DSCtxLink_source_idx"  ON public."DesignSessionContextLink" (contextSourceId);

ALTER TABLE public."DesignSessionContextLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dsctxlink_select" ON public."DesignSessionContextLink"
  FOR SELECT TO authenticated
  USING (public.can_view_design_session(designSessionId));

CREATE POLICY "dsctxlink_insert" ON public."DesignSessionContextLink"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_session(designSessionId));

CREATE POLICY "dsctxlink_update" ON public."DesignSessionContextLink"
  FOR UPDATE TO authenticated
  USING (public.can_edit_session(designSessionId))
  WITH CHECK (public.can_edit_session(designSessionId));

CREATE POLICY "dsctxlink_delete" ON public."DesignSessionContextLink"
  FOR DELETE TO authenticated
  USING (public.can_edit_session(designSessionId));
