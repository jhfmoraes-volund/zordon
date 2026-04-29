-- ═══════════════════════════════════════════════════════════
-- DesignSessionTranscript — Roam meeting transcripts as Pre-Work context
--
-- Stores transcripts imported from Roam HQ via the Pre-Work step UI.
-- Vitor (design session agent) reads these in loadContext() and injects
-- them into the system prompt so he can answer questions about the
-- meetings as if he had attended them.
--
-- RLS replica padrão: is_manager() bypass; can_view_project()/can_edit_sessions()
-- gating por ProjectAccess.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public."DesignSessionTranscript" (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId"          text NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "projectId"          text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "roamTranscriptId"   text NOT NULL,
  "meetingTitle"       text NOT NULL,
  "meetingStart"       timestamptz NOT NULL,
  "meetingEnd"         timestamptz NOT NULL,
  participants         jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary              text,
  "actionItems"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "fullText"           text NOT NULL,
  "importedByMemberId" text REFERENCES public."Member"(id) ON DELETE SET NULL,
  "importedAt"         timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("sessionId", "roamTranscriptId")
);

CREATE INDEX IF NOT EXISTS "DesignSessionTranscript_sessionId_importedAt_idx"
  ON public."DesignSessionTranscript" ("sessionId", "importedAt" DESC);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."DesignSessionTranscript" TO anon, authenticated;

ALTER TABLE public."DesignSessionTranscript" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."DesignSessionTranscript"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "manager_or_editor_insert" ON public."DesignSessionTranscript"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_update" ON public."DesignSessionTranscript"
  FOR UPDATE USING (public.is_manager() OR public.can_edit_sessions("projectId"));
CREATE POLICY "manager_or_editor_delete" ON public."DesignSessionTranscript"
  FOR DELETE USING (public.is_manager() OR public.can_edit_sessions("projectId"));
