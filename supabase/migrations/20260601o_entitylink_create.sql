-- Fase A da unificação das link-tables: cria a tabela polimórfica EntityLink.
-- Substitui (em fases futuras) 8 tabelas de link:
--   {DesignSession,Planning,PMReview}ContextLink, {DesignSession,Planning,PMReview}TranscriptLink,
--   {Planning,PMReview}MeetingLink
-- Design: FK TOTAL (opção 2) — exatamente 1 host E exatamente 1 ref, ambos com FK + CASCADE.
-- O banco recusa dado órfão e auto-limpa; integridade não depende do código.
-- ADITIVO: não toca em nenhuma tabela existente. Seguro rodar em prod.

CREATE TABLE IF NOT EXISTS "EntityLink" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- HOST (dono do link) — exatamente um preenchido (ver CHECK)
  "designSessionId"    uuid REFERENCES "DesignSession"(id)    ON DELETE CASCADE,
  "pmReviewId"         uuid REFERENCES "PMReview"(id)         ON DELETE CASCADE,
  "planningCeremonyId" uuid REFERENCES "PlanningCeremony"(id) ON DELETE CASCADE,
  "planningSessionId"  uuid REFERENCES "PlanningSession"(id)  ON DELETE CASCADE,

  -- REF (o que é anexado) — exatamente um preenchido (ver CHECK)
  "contextSourceId"    uuid REFERENCES "ContextSource"(id)    ON DELETE CASCADE,
  "transcriptRefId"    uuid REFERENCES "TranscriptRef"(id)    ON DELETE CASCADE,
  "meetingId"          uuid REFERENCES "Meeting"(id)          ON DELETE CASCADE,

  -- payload comum às link-tables antigas
  weight               text,
  note                 text,
  "linkedById"         uuid REFERENCES "Member"(id)           ON DELETE SET NULL,
  "linkedAt"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entitylink_one_host CHECK (
    num_nonnulls("designSessionId","pmReviewId","planningCeremonyId","planningSessionId") = 1
  ),
  CONSTRAINT entitylink_one_ref CHECK (
    num_nonnulls("contextSourceId","transcriptRefId","meetingId") = 1
  )
);

-- Índices parciais: "links deste host" e "links pra este ref".
CREATE INDEX IF NOT EXISTS entitylink_design_session_idx    ON "EntityLink" ("designSessionId")    WHERE "designSessionId"    IS NOT NULL;
CREATE INDEX IF NOT EXISTS entitylink_pm_review_idx          ON "EntityLink" ("pmReviewId")         WHERE "pmReviewId"         IS NOT NULL;
CREATE INDEX IF NOT EXISTS entitylink_planning_ceremony_idx  ON "EntityLink" ("planningCeremonyId") WHERE "planningCeremonyId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS entitylink_planning_session_idx   ON "EntityLink" ("planningSessionId")  WHERE "planningSessionId"  IS NOT NULL;
CREATE INDEX IF NOT EXISTS entitylink_context_source_idx     ON "EntityLink" ("contextSourceId")    WHERE "contextSourceId"    IS NOT NULL;
CREATE INDEX IF NOT EXISTS entitylink_transcript_ref_idx     ON "EntityLink" ("transcriptRefId")    WHERE "transcriptRefId"    IS NOT NULL;
CREATE INDEX IF NOT EXISTS entitylink_meeting_idx            ON "EntityLink" ("meetingId")          WHERE "meetingId"          IS NOT NULL;

-- ============================================================================
-- RLS — UMA policy consistente cobrindo os 4 hosts (corrige a inconsistência
-- atual onde DesignSessionTranscriptLink/PMReviewTranscriptLink ficaram UNRESTRICTED).
ALTER TABLE "EntityLink" ENABLE ROW LEVEL SECURITY;

-- Acesso de LEITURA ao host (espelha as policies de select das tabelas antigas).
CREATE OR REPLACE FUNCTION entitylink_can_view(el "EntityLink") RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_manager()
    OR (el."designSessionId" IS NOT NULL AND can_view_design_session(el."designSessionId"))
    OR (el."pmReviewId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "PMReview" pm WHERE pm.id = el."pmReviewId" AND can_view_project(pm."projectId")))
    OR (el."planningCeremonyId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "PlanningCeremony" pc WHERE pc.id = el."planningCeremonyId" AND can_view_project(pc."projectId")))
    OR (el."planningSessionId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "PlanningSession" ps WHERE ps.id = el."planningSessionId" AND can_view_project(ps."projectId")));
$$;

-- Acesso de ESCRITA ao host (espelha as policies de insert/update/delete).
CREATE OR REPLACE FUNCTION entitylink_can_edit(el "EntityLink") RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_manager()
    OR (el."designSessionId" IS NOT NULL AND can_edit_session(el."designSessionId"))
    OR (el."pmReviewId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "PMReview" pm WHERE pm.id = el."pmReviewId" AND can_edit_project(pm."projectId")))
    OR (el."planningCeremonyId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "PlanningCeremony" pc WHERE pc.id = el."planningCeremonyId" AND can_edit_project(pc."projectId")))
    OR (el."planningSessionId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "PlanningSession" ps WHERE ps.id = el."planningSessionId" AND can_edit_project(ps."projectId")));
$$;

CREATE POLICY entitylink_select ON "EntityLink" FOR SELECT USING (entitylink_can_view("EntityLink".*));
CREATE POLICY entitylink_insert ON "EntityLink" FOR INSERT WITH CHECK (entitylink_can_edit("EntityLink".*));
CREATE POLICY entitylink_update ON "EntityLink" FOR UPDATE USING (entitylink_can_edit("EntityLink".*)) WITH CHECK (entitylink_can_edit("EntityLink".*));
CREATE POLICY entitylink_delete ON "EntityLink" FOR DELETE USING (entitylink_can_edit("EntityLink".*));

-- Rollback: DROP TABLE "EntityLink" CASCADE; DROP FUNCTION entitylink_can_view("EntityLink"); DROP FUNCTION entitylink_can_edit("EntityLink");
