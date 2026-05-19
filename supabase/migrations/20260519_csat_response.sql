-- ============================================================================
-- CsatResponse — entrevista CSAT ad-hoc por cliente
--
-- Captura 4 notas (Metodologia/Time/CSAT/NPS) 0..10 + 2 textos (o que está bom
-- / o que melhorar). Preenchida internamente por PM em call/whatsapp.
--
-- Sem cadência fixa: cliente pode ter 0, 1 ou N entrevistas. Histórico ordenado
-- por interviewedAt desc no card.
--
-- RLS: espelha o padrão atual de "Client" (authenticated USING true). Gating
-- por role (manager+) acontece na sidebar/UI; apertar RLS é PR separado que
-- cobre Client+Project+CsatResponse no mesmo passo.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "CsatResponse" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId"          uuid NOT NULL REFERENCES "Client"(id) ON DELETE CASCADE,
  "interviewedAt"     timestamptz NOT NULL DEFAULT now(),
  "interviewedBy"     uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "contactName"       text,
  "methodologyScore"  smallint NOT NULL,
  "teamScore"         smallint NOT NULL,
  "csatScore"         smallint NOT NULL,
  "npsScore"          smallint NOT NULL,
  "whatsGood"         text,
  "whatsToImprove"    text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csat_methodology_score_range CHECK ("methodologyScore" BETWEEN 0 AND 10),
  CONSTRAINT csat_team_score_range        CHECK ("teamScore"        BETWEEN 0 AND 10),
  CONSTRAINT csat_csat_score_range        CHECK ("csatScore"        BETWEEN 0 AND 10),
  CONSTRAINT csat_nps_score_range         CHECK ("npsScore"         BETWEEN 0 AND 10)
);

CREATE INDEX "CsatResponse_client_idx"
  ON "CsatResponse" ("clientId", "interviewedAt" DESC);

-- ─── updatedAt trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.csat_response_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END$$;

CREATE TRIGGER csat_response_set_updated_at
  BEFORE UPDATE ON "CsatResponse"
  FOR EACH ROW
  EXECUTE FUNCTION public.csat_response_set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE "CsatResponse" ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_select ON "CsatResponse"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY authenticated_insert ON "CsatResponse"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY authenticated_update ON "CsatResponse"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY authenticated_delete ON "CsatResponse"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);

COMMIT;
