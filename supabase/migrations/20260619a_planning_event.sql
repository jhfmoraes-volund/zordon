-- 20260619a_planning_event.sql
-- Planning Vivo Versionado — Fase 1 (Log): artefato durável versionado.
-- § docs/runbooks/planning-versioned-living-runbook.md §6 (D1)
--
-- INVARIANTE (tatuar): build on the live board, remember the plan, learn from
-- the outcome. O snapshot/briefing INFORMA a próxima versão; NUNCA vira o estado
-- a restaurar (senão ressuscita task fechada/deletada e atropela o builder).
--
-- 1 linha por "Aplicar" de Release Planning. Append-only (sem policy de
-- UPDATE/DELETE — só CASCADE da PlanningSession). Keyed por planningSessionId
-- (estável) e NÃO por PlanningCeremony: a companion ceremony é reciclada a cada
-- apply (ensureReleasePlanningCeremony), então a cadeia de versões vive na
-- sessão, não na cerimônia.

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanningEvent" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningSessionId" uuid NOT NULL REFERENCES "PlanningSession"(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdById" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "appliedCount" int NOT NULL DEFAULT 0,
  "failedCount" int NOT NULL DEFAULT 0,
  "skippedCount" int NOT NULL DEFAULT 0,
  -- CÓPIA do último turn assistant do thread no instante do apply (auto-contido,
  -- imutável — não aponta pro ChatMessage vivo, que pode ser compactado/apagado).
  "briefingMarkdown" text,
  -- Âncora pro turn original (referência; pode virar NULL se a mensagem sumir).
  "chatMessageId" uuid REFERENCES "ChatMessage"(id) ON DELETE SET NULL
);

-- Read endpoint lista por sessão, mais recente primeiro.
CREATE INDEX IF NOT EXISTS idx_planning_event_session
  ON "PlanningEvent"("planningSessionId", "createdAt" DESC);

-- ============================================================
-- RLS — espelha PlanningSession (projectId vem via join à sessão).
-- DAL usa service_role (bypassa RLS); policies são defense-in-depth.
-- Append-only: sem policy de UPDATE/DELETE (deny by default).
-- ============================================================
ALTER TABLE "PlanningEvent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_event_read ON "PlanningEvent";
CREATE POLICY planning_event_read ON "PlanningEvent"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "PlanningSession" ps
      WHERE ps.id = "PlanningEvent"."planningSessionId"
        AND can_view_project(ps."projectId")
    )
  );

DROP POLICY IF EXISTS planning_event_insert ON "PlanningEvent";
CREATE POLICY planning_event_insert ON "PlanningEvent"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "PlanningSession" ps
      WHERE ps.id = "PlanningEvent"."planningSessionId"
        AND can_edit_project(ps."projectId")
    )
  );

COMMIT;
