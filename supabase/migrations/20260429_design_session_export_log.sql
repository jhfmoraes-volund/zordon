-- DesignSessionExportLog: audit trail for "Exportar JSON" on design sessions.
-- Written by the export-design-session Edge Function (service role).
-- Read-only para managers (PM/head-ops/CEO/CRO) via RLS.

CREATE TABLE public."DesignSessionExportLog" (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId" TEXT NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "memberId"  TEXT REFERENCES public."Member"(id) ON DELETE SET NULL,
  -- raw auth user id, kept for audit even if the Member is later deleted
  "userId"    UUID NOT NULL,
  format      TEXT NOT NULL DEFAULT 'json',
  "stepCount" INT  NOT NULL,
  "byteSize"  INT  NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dse_session_created
  ON public."DesignSessionExportLog"("sessionId", "createdAt" DESC);

CREATE INDEX idx_dse_member_created
  ON public."DesignSessionExportLog"("memberId", "createdAt" DESC);

ALTER TABLE public."DesignSessionExportLog" ENABLE ROW LEVEL SECURITY;

-- Read: managers only. No INSERT/UPDATE/DELETE policies for authenticated —
-- only the Edge Function (service role) writes here.
CREATE POLICY "managers can read export log"
  ON public."DesignSessionExportLog"
  FOR SELECT TO authenticated
  USING (public.is_manager());

GRANT ALL ON public."DesignSessionExportLog" TO service_role;
GRANT SELECT ON public."DesignSessionExportLog" TO authenticated;
