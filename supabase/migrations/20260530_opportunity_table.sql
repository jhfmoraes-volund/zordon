-- ═══════════════════════════════════════════════════════════
-- Opportunity: backlog de oportunidades por cliente
--
-- Oportunidade = candidata a virar Project. Ancorada em Client,
-- não em Project (D1 do PRD). PM cura backlog, sponsor vê matriz
-- impact×effort, PM promove pra Project via botão.
--
-- Schema conforme PRD §7.1 — enum + tabela + checks + índices.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Enum OpportunityStatus ──────────────────────────────

CREATE TYPE "OpportunityStatus" AS ENUM (
  'discovery',
  'evaluating',
  'approved',
  'in_project',
  'rejected'
);

CREATE TABLE "Opportunity" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId"   uuid NOT NULL REFERENCES "Client"(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description  text,
  impact       smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  effort       smallint NOT NULL CHECK (effort BETWEEN 1 AND 5),
  status       "OpportunityStatus" NOT NULL DEFAULT 'discovery',
  "priorityRank" integer,                       -- manual override; NULL = use score
  "sourceMeetingId"        uuid REFERENCES "Meeting"(id) ON DELETE SET NULL,
  "sourceDesignSessionId"  uuid REFERENCES "DesignSession"(id) ON DELETE SET NULL,
  "sourceTranscriptRefId"  uuid REFERENCES "TranscriptRef"(id) ON DELETE SET NULL,
  "promotedProjectId"      uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  "createdBy"  uuid NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Índices parciais ────────────────────────────────────

CREATE INDEX ix_opportunity_client_status
  ON "Opportunity" ("clientId", status)
  WHERE status <> 'rejected';

CREATE INDEX ix_opportunity_promoted
  ON "Opportunity" ("promotedProjectId")
  WHERE "promotedProjectId" IS NOT NULL;

-- ─── 3. RLS ─────────────────────────────────────────────────

ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
