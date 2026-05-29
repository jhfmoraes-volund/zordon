-- ═══════════════════════════════════════════════════════════
-- Agent Calibration — sistema contínuo de captura, fix e score por agente
--
-- Loop:
--   capture (PM observa comportamento torto em prod)
--   → categoriza (taxonomy compartilhada entre agentes)
--   → fix (prompt/schema/tool/modelo)
--   → score (weekly snapshot contra fixture canônica)
--   → eval (promote captured scenario pra src/eval/<agent>/cases/)
--
-- 3 tabelas:
--   • AgentCalibrationCapture — evidência (1 row por bug observado)
--   • AgentCalibrationFix     — tentativas de fix (N rows por capture)
--   • AgentCalibrationScoreboard — snapshot semanal por agente
--
-- agentSlug é text livre (não enum) — cada agente novo só plota no registry
-- da skill, sem precisar de migration. Categoria É enum porque vocabulary
-- compartilhada é o ponto da calibração.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. AgentCalibrationCapture ────────────────────────────────────────────
CREATE TABLE public."AgentCalibrationCapture" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug"           text NOT NULL,

  "capturedAt"          timestamptz NOT NULL DEFAULT now(),
  "capturedById"        uuid REFERENCES public."Member"(id) ON DELETE SET NULL,

  -- Source context: qualquer combinação pode ser NULL conforme onde o bug rodou
  "projectId"           uuid REFERENCES public."Project"(id) ON DELETE SET NULL,
  "planningCeremonyId"  uuid REFERENCES public."PlanningCeremony"(id) ON DELETE SET NULL,
  "designSessionId"     uuid REFERENCES public."DesignSession"(id) ON DELETE SET NULL,
  "meetingId"           uuid REFERENCES public."Meeting"(id) ON DELETE SET NULL,
  "threadId"            uuid REFERENCES public."ChatThread"(id) ON DELETE SET NULL,

  -- Evidência
  "screenshotPath"      text,                -- path em supabase storage
  "chatDump"            text,                -- raw chat dump
  "userPrompt"          text NOT NULL,       -- o que o PM disse pro agente
  "observedBehavior"    text NOT NULL,       -- o que aconteceu errado
  "expectedBehavior"    text,                -- o que devia ter acontecido

  -- Classificação (vocabulary compartilhada — todo agente usa)
  category              text NOT NULL CHECK (category = ANY (ARRAY[
    'sem-tool'::text,
    'sem-contexto'::text,
    'prompt-confuso'::text,
    'modelo-alucina'::text,
    'schema-rejeita'::text,
    'tool-off-topic'::text,
    'manifest-blindspot'::text,
    'scope-tangent'::text,
    'gate-bypass'::text,
    'confidence-missing'::text,
    'confidence-fabricated'::text,
    'outcome-missing'::text,
    'infra-bug'::text,
    'correto'::text
  ])),
  severity              text NOT NULL DEFAULT 'medium' CHECK (severity = ANY (ARRAY[
    'low'::text, 'medium'::text, 'high'::text, 'critical'::text
  ])),

  -- Lifecycle
  status                text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY[
    'open'::text, 'investigating'::text, 'fixed'::text, 'wontfix'::text, 'duplicate'::text
  ])),
  "duplicateOfId"       uuid REFERENCES public."AgentCalibrationCapture"(id) ON DELETE SET NULL,

  -- Links
  "runbookScenarioRef"  text,                -- "V6" ou "V2.2"
  "evalCaseAdded"       boolean NOT NULL DEFAULT false,
  "evalCaseFile"        text,                -- path src/eval/<agent>/cases/...

  notes                 text,

  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ACC_agent_captured_idx"
  ON public."AgentCalibrationCapture" ("agentSlug", "capturedAt" DESC);
CREATE INDEX "ACC_agent_category_idx"
  ON public."AgentCalibrationCapture" ("agentSlug", category);
CREATE INDEX "ACC_open_idx"
  ON public."AgentCalibrationCapture" (status, "agentSlug")
  WHERE status IN ('open', 'investigating');

COMMENT ON TABLE public."AgentCalibrationCapture" IS
  'Evidência de comportamento torto observado em prod. 1 row por bug; alimenta o calibration loop.';
COMMENT ON COLUMN public."AgentCalibrationCapture".category IS
  'Vocabulary compartilhada entre agentes — ver docs/runbooks/agent-audits/README.md';

ALTER TABLE public."AgentCalibrationCapture" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ACC_read_authenticated" ON public."AgentCalibrationCapture"
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "ACC_write_manager" ON public."AgentCalibrationCapture"
  FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- updatedAt trigger
CREATE OR REPLACE FUNCTION public.set_acc_updated_at() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_ACC_updated_at"
  BEFORE UPDATE ON public."AgentCalibrationCapture"
  FOR EACH ROW EXECUTE FUNCTION public.set_acc_updated_at();

-- ── 2. AgentCalibrationFix ────────────────────────────────────────────────
CREATE TABLE public."AgentCalibrationFix" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "captureId"             uuid NOT NULL REFERENCES public."AgentCalibrationCapture"(id) ON DELETE CASCADE,
  "agentSlug"             text NOT NULL,

  "fixKind"               text NOT NULL CHECK ("fixKind" = ANY (ARRAY[
    'prompt'::text,
    'schema'::text,
    'tool'::text,
    'model'::text,
    'migration'::text,
    'infra'::text,
    'docs'::text,
    'other'::text
  ])),
  "filesChanged"          text[] NOT NULL DEFAULT '{}',
  "commitHash"            text,
  description             text NOT NULL,

  "scoreBefore"           jsonb,             -- {D1:10, D2:2, ...}
  "scoreAfter"            jsonb,
  "scenarioPassedBefore"  boolean,
  "scenarioPassedAfter"   boolean,

  "appliedAt"             timestamptz NOT NULL DEFAULT now(),
  "appliedById"           uuid REFERENCES public."Member"(id) ON DELETE SET NULL
);

CREATE INDEX "ACF_capture_idx"
  ON public."AgentCalibrationFix" ("captureId");
CREATE INDEX "ACF_agent_applied_idx"
  ON public."AgentCalibrationFix" ("agentSlug", "appliedAt" DESC);

COMMENT ON TABLE public."AgentCalibrationFix" IS
  'Tentativas de fix contra uma capture. N rows por capture (várias iterações até a passar).';

ALTER TABLE public."AgentCalibrationFix" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ACF_read_authenticated" ON public."AgentCalibrationFix"
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "ACF_write_manager" ON public."AgentCalibrationFix"
  FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── 3. AgentCalibrationScoreboard ─────────────────────────────────────────
CREATE TABLE public."AgentCalibrationScoreboard" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug"             text NOT NULL,
  "snapshotDate"          date NOT NULL,     -- weekly, segunda-feira

  scores                  jsonb NOT NULL,    -- {D1:10, D2:10, D3:null, ...}
  "totalScore"            int,
  "maxScore"              int NOT NULL,
  "passRate"              numeric(5,2),      -- 0.00 - 100.00

  "scenariosPassed"       int NOT NULL DEFAULT 0,
  "scenariosFailed"       int NOT NULL DEFAULT 0,
  "scenariosBlocked"      int NOT NULL DEFAULT 0,  -- pré-fase, esperado falhar

  "regressionFromPrior"   boolean NOT NULL DEFAULT false,
  "regressionNotes"       text,

  "fixtureRef"            text,              -- commit/ref da fixture rodada
  "runDurationMs"         int,
  "costUsd"               numeric(10,4),

  "createdAt"             timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("agentSlug", "snapshotDate")
);

CREATE INDEX "ACS_agent_date_idx"
  ON public."AgentCalibrationScoreboard" ("agentSlug", "snapshotDate" DESC);

COMMENT ON TABLE public."AgentCalibrationScoreboard" IS
  'Snapshot semanal de scorecard por agente. Cron roda fixture canônica e popula.';

ALTER TABLE public."AgentCalibrationScoreboard" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ACS_read_authenticated" ON public."AgentCalibrationScoreboard"
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Só service-role escreve (cron job server-side)
CREATE POLICY "ACS_write_service" ON public."AgentCalibrationScoreboard"
  FOR ALL USING (false) WITH CHECK (false);

-- ── 4. Storage bucket pra screenshots ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'calibration-evidence',
  'calibration-evidence',
  false,
  10485760,  -- 10 MB por arquivo
  ARRAY['image/png','image/jpeg','image/webp','text/plain','application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "calibration_evidence_authenticated_read" ON storage.objects;
CREATE POLICY "calibration_evidence_authenticated_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'calibration-evidence');

DROP POLICY IF EXISTS "calibration_evidence_manager_write" ON storage.objects;
CREATE POLICY "calibration_evidence_manager_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'calibration-evidence' AND is_manager());

COMMIT;
