-- Design Session normalization — Fase 1
-- Runbook: docs/design-session-normalization-runbook.md §1
-- One transaction: CREATE TABLES → RLS → BACKFILL → ASSERTIONS.
-- Rollback automático se qualquer RAISE EXCEPTION disparar.

BEGIN;

-- ============================================================
-- 1. CREATE TABLES
-- ============================================================

-- 1.1 DesignSessionStepNote (1:N) — sticky notes do facilitador, genérica por step
CREATE TABLE "DesignSessionStepNote" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "stepKey" text NOT NULL CHECK ("stepKey" IN (
    'pre_work','product_vision','scope_definition','personas_journeys',
    'brainstorm','risks_gaps','prioritization','technical_specs','hypotheses'
  )),
  text text NOT NULL DEFAULT '',
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionStepNote"("sessionId", "stepKey", "orderIndex");

-- (pre_work não tem tabela 1:1 — files/transcripts vivem em
--  DesignSessionResearch e DesignSessionTranscript desde 20260508;
--  sticky notes via DesignSessionStepNote acima)

-- 1.2 DesignSessionProductVision (1:1)
CREATE TABLE "DesignSessionProductVision" (
  "sessionId" uuid PRIMARY KEY REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  problem text NOT NULL DEFAULT '',
  "whoSuffers" text NOT NULL DEFAULT '',
  consequences text NOT NULL DEFAULT '',
  "successVision" text NOT NULL DEFAULT '',
  "impactMetrics" text NOT NULL DEFAULT '',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 1.3 DesignSessionScope (1:1) — renomeando is→inScope, isNot→outOfScope
CREATE TABLE "DesignSessionScope" (
  "sessionId" uuid PRIMARY KEY REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "inScope" jsonb NOT NULL DEFAULT '[]',
  "outOfScope" jsonb NOT NULL DEFAULT '[]',
  does jsonb NOT NULL DEFAULT '[]',
  "doesNot" jsonb NOT NULL DEFAULT '[]',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 1.4 DesignSessionPersona (1:N)
CREATE TABLE "DesignSessionPersona" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  context text NOT NULL DEFAULT '',
  "asIsSteps" jsonb NOT NULL DEFAULT '[]',
  "toBeSteps" jsonb NOT NULL DEFAULT '[]',
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionPersona"("sessionId", "orderIndex");

-- 1.5 DesignSessionBrainstormFeature já existe — RLS retroativa aplicada no bloco 2.

-- 1.6 DesignSessionRisk + DesignSessionGap (1:N cada)
CREATE TABLE "DesignSessionRisk" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'business' CHECK (category IN ('business','technical')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('high','medium','low')),
  "relatedFeature" text,
  mitigation text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionRisk"("sessionId", severity);

CREATE TABLE "DesignSessionGap" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  category text,
  severity text,
  "relatedFeature" text,
  mitigation text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionGap"("sessionId", "orderIndex");

-- 1.7 DesignSessionPriorityItem (1:N)
CREATE TABLE "DesignSessionPriorityItem" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  "howItSolves" text NOT NULL DEFAULT '',
  "targetPersona" text NOT NULL DEFAULT '',
  bucket text NOT NULL DEFAULT 'next' CHECK (bucket IN ('mvp','next','out')),
  "keyScreens" text,
  "userFlows" text,
  "painPointRef" text,
  "technicalNotes" text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionPriorityItem"("sessionId", bucket);
CREATE INDEX ON "DesignSessionPriorityItem"("sessionId", "orderIndex");

-- 1.8 DesignSessionTechnicalSpecs (1:1)
CREATE TABLE "DesignSessionTechnicalSpecs" (
  "sessionId" uuid PRIMARY KEY REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  stack text NOT NULL DEFAULT '',
  performance text NOT NULL DEFAULT '',
  integrations jsonb NOT NULL DEFAULT '[]',
  rules jsonb NOT NULL DEFAULT '[]',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 1.9 DesignSessionHypothesis (1:N)
CREATE TABLE "DesignSessionHypothesis" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  hypothesis text NOT NULL DEFAULT '',
  indicator text NOT NULL DEFAULT '',
  target text NOT NULL DEFAULT '',
  "expectedResult" text NOT NULL DEFAULT '',
  evidence text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionHypothesis"("sessionId", "orderIndex");

-- ============================================================
-- 2. RLS — padrão canônico (loop)
-- ============================================================

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'DesignSessionStepNote',
    'DesignSessionProductVision',
    'DesignSessionScope',
    'DesignSessionPersona',
    'DesignSessionBrainstormFeature',  -- retro-RLS
    'DesignSessionRisk',
    'DesignSessionGap',
    'DesignSessionPriorityItem',
    'DesignSessionTechnicalSpecs',
    'DesignSessionHypothesis'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "manager_or_viewer_select" ON %I FOR SELECT USING (can_access_session("sessionId"))', t
    );
    EXECUTE format(
      'CREATE POLICY "manager_or_editor_insert" ON %I FOR INSERT WITH CHECK (can_edit_session("sessionId"))', t
    );
    EXECUTE format(
      'CREATE POLICY "manager_or_editor_update" ON %I FOR UPDATE USING (can_edit_session("sessionId")) WITH CHECK (can_edit_session("sessionId"))', t
    );
    EXECUTE format(
      'CREATE POLICY "manager_or_editor_delete" ON %I FOR DELETE USING (can_edit_session("sessionId"))', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END $$;

-- ============================================================
-- 3. BACKFILL
-- ============================================================

-- 3.1 step notes (genérico, todos os steps) — _notes é array [{id, text}]
-- IDs legados podem ser nanoids do `genId()` da UI (não-UUID); só preservamos
-- se já forem UUID válido, senão geramos um novo.
INSERT INTO "DesignSessionStepNote" (id, "sessionId", "stepKey", text, "orderIndex", "createdAt", "updatedAt")
SELECT
  CASE
    WHEN (note->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (note->>'id')::uuid
    ELSE gen_random_uuid()
  END,
  sd."sessionId"::uuid,
  sd."stepKey",
  COALESCE(note->>'text', ''),
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'_notes') WITH ORDINALITY AS arr(note, ord)
WHERE jsonb_typeof(sd.data->'_notes') = 'array'
  AND jsonb_array_length(sd.data->'_notes') > 0
ON CONFLICT (id) DO NOTHING;

-- 3.2 product_vision
INSERT INTO "DesignSessionProductVision" ("sessionId", problem, "whoSuffers", consequences, "successVision", "impactMetrics", "updatedAt")
SELECT
  "sessionId"::uuid,
  COALESCE(data->>'problem', ''),
  COALESCE(data->>'whoSuffers', ''),
  COALESCE(data->>'consequences', ''),
  COALESCE(data->>'successVision', ''),
  COALESCE(data->>'impactMetrics', ''),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'product_vision'
ON CONFLICT ("sessionId") DO NOTHING;

-- 3.3 scope_definition (is→inScope, isNot→outOfScope)
INSERT INTO "DesignSessionScope" ("sessionId", "inScope", "outOfScope", does, "doesNot", "updatedAt")
SELECT
  "sessionId"::uuid,
  COALESCE(data->'is', '[]'::jsonb),
  COALESCE(data->'isNot', '[]'::jsonb),
  COALESCE(data->'does', '[]'::jsonb),
  COALESCE(data->'doesNot', '[]'::jsonb),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'scope_definition'
ON CONFLICT ("sessionId") DO NOTHING;

-- 3.4 personas_journeys → explode data->'personas'
-- IDs legados de UI são nanoids (ex: "8yzqk0u"), não UUIDs — gera novo se não casar.
INSERT INTO "DesignSessionPersona" (id, "sessionId", name, role, context, "asIsSteps", "toBeSteps", "orderIndex", "createdAt", "updatedAt")
SELECT
  CASE
    WHEN (persona->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (persona->>'id')::uuid
    ELSE gen_random_uuid()
  END,
  sd."sessionId"::uuid,
  COALESCE(persona->>'name', ''),
  COALESCE(persona->>'role', ''),
  COALESCE(persona->>'context', ''),
  COALESCE(persona->'asIsSteps', '[]'::jsonb),
  COALESCE(persona->'toBeSteps', '[]'::jsonb),
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'personas') WITH ORDINALITY AS arr(persona, ord)
WHERE sd."stepKey" = 'personas_journeys'
ON CONFLICT (id) DO NOTHING;

-- 3.5 brainstorm — JÁ está em DesignSessionBrainstormFeature via trigger. Validar contagem (§4).

-- 3.6 risks_gaps → explode 2 arrays
INSERT INTO "DesignSessionRisk" (id, "sessionId", text, category, severity, "relatedFeature", mitigation, "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(risk->>'text', ''),
  COALESCE(risk->>'category', 'business'),
  COALESCE(risk->>'severity', 'medium'),
  risk->>'relatedFeature',
  risk->>'mitigation',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'risks') WITH ORDINALITY AS arr(risk, ord)
WHERE sd."stepKey" = 'risks_gaps';

INSERT INTO "DesignSessionGap" (id, "sessionId", text, category, severity, "relatedFeature", mitigation, "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(gap->>'text', ''),
  gap->>'category',
  gap->>'severity',
  gap->>'relatedFeature',
  gap->>'mitigation',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'gaps') WITH ORDINALITY AS arr(gap, ord)
WHERE sd."stepKey" = 'risks_gaps';

-- 3.7 prioritization → explode data->'items'
INSERT INTO "DesignSessionPriorityItem" (id, "sessionId", title, "howItSolves", "targetPersona", bucket, "keyScreens", "userFlows", "painPointRef", "technicalNotes", "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(item->>'title', ''),
  COALESCE(item->>'howItSolves', ''),
  COALESCE(item->>'targetPersona', ''),
  COALESCE(item->>'bucket', 'next'),
  item->>'keyScreens',
  item->>'userFlows',
  item->>'painPointRef',
  item->>'technicalNotes',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'items') WITH ORDINALITY AS arr(item, ord)
WHERE sd."stepKey" = 'prioritization';

-- 3.8 technical_specs
INSERT INTO "DesignSessionTechnicalSpecs" ("sessionId", stack, performance, integrations, rules, "updatedAt")
SELECT
  "sessionId"::uuid,
  COALESCE(data->>'stack', ''),
  COALESCE(data->>'performance', ''),
  COALESCE(data->'integrations', '[]'::jsonb),
  COALESCE(data->'rules', '[]'::jsonb),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'technical_specs'
ON CONFLICT ("sessionId") DO NOTHING;

-- 3.9 hypotheses → explode data->'hypotheses'
INSERT INTO "DesignSessionHypothesis" (id, "sessionId", hypothesis, indicator, target, "expectedResult", evidence, "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(item->>'hypothesis', ''),
  COALESCE(item->>'indicator', ''),
  COALESCE(item->>'target', ''),
  COALESCE(item->>'expectedResult', ''),
  item->>'evidence',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'hypotheses') WITH ORDINALITY AS arr(item, ord)
WHERE sd."stepKey" = 'hypotheses';

-- ============================================================
-- 4. ASSERTIONS
-- ============================================================

DO $$
DECLARE
  v_actual int;
  v_expected int;
BEGIN
  -- step notes
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionStepNote";
  SELECT COALESCE(SUM(jsonb_array_length(data->'_notes')), 0) INTO v_expected
    FROM "DesignSessionStepData"
    WHERE jsonb_typeof(data->'_notes') = 'array'
      AND jsonb_array_length(data->'_notes') > 0;
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'step notes: % vs %', v_actual, v_expected;
  END IF;

  -- product_vision
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionProductVision";
  SELECT COUNT(*) INTO v_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'product_vision';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'product_vision: % vs %', v_actual, v_expected;
  END IF;

  -- scope
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionScope";
  SELECT COUNT(*) INTO v_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'scope_definition';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'scope: % vs %', v_actual, v_expected;
  END IF;

  -- personas
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionPersona";
  SELECT COALESCE(SUM(jsonb_array_length(data->'personas')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'personas_journeys';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'personas: % vs %', v_actual, v_expected;
  END IF;

  -- risks
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionRisk";
  SELECT COALESCE(SUM(jsonb_array_length(data->'risks')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'risks_gaps';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'risks: % vs %', v_actual, v_expected;
  END IF;

  -- gaps
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionGap";
  SELECT COALESCE(SUM(jsonb_array_length(data->'gaps')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'risks_gaps';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'gaps: % vs %', v_actual, v_expected;
  END IF;

  -- priority items
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionPriorityItem";
  SELECT COALESCE(SUM(jsonb_array_length(data->'items')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'prioritization';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'priority: % vs %', v_actual, v_expected;
  END IF;

  -- hypotheses
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionHypothesis";
  SELECT COALESCE(SUM(jsonb_array_length(data->'hypotheses')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'hypotheses';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'hypotheses: % vs %', v_actual, v_expected;
  END IF;

  -- technical_specs
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionTechnicalSpecs";
  SELECT COUNT(*) INTO v_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'technical_specs';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'tech specs: % vs %', v_actual, v_expected;
  END IF;

  -- brainstorm (sanity — bf rows = json solutions)
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionBrainstormFeature";
  SELECT COALESCE(SUM(jsonb_array_length(data->'solutions')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'brainstorm';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'brainstorm features: % vs %', v_actual, v_expected;
  END IF;

  RAISE NOTICE 'All backfill assertions passed.';
END $$;

COMMIT;
