-- =============================================================================
-- Duplica DS Inception Zelar v1 -> v2 com briefing zerado
-- =============================================================================
-- Origem: e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f (Inception Zelar)
-- Destino: novo UUID, titulo "Inception Zelar v2"
--
-- Replica:
-- - DesignSession metadata (novo id, novo title, mesma config)
-- - DesignSessionStepData steps 0-8 IDENTICOS (incluindo brainstorm)
--   Trigger sync_brainstorm_features dispara e popula DesignSessionBrainstormFeature
--   automaticamente com novo sessionId.
-- - DesignSessionItem (priorizacao) com novos ids
-- - DesignDecision com novos ids
--
-- NAO replica:
-- - DesignSessionStepData step 9 (briefing) — zerado (sem row).
-- - UserStory, AcceptanceCriterion, Task, runbook.task_anchor — produtos do briefing.
-- - DesignSessionParticipant, DesignOpenQuestion, DesignSessionResearch (zero rows na v1).
-- =============================================================================

BEGIN;

DO $dup$
DECLARE
  v_src_id  uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_dst_id  uuid := gen_random_uuid();
  v_count   int;
BEGIN
  -- 1. DesignSession metadata
  INSERT INTO "DesignSession" (
    id, "projectId", type, status, title, description,
    "currentStep", "totalSteps", "scheduledAt", "completedAt",
    "actualDurationMin", "createdBy", "createdAt", "updatedAt",
    "memoryMd", "memoryAbstract", "memoryUpdatedAt", "memoryVersion",
    "selectedSteps"
  )
  SELECT
    v_dst_id, "projectId", type, 'in_progress', 'Inception Zelar v2', description,
    9, "totalSteps", "scheduledAt", NULL,  -- completedAt zerado
    NULL, "createdBy", NOW(), NOW(),       -- timestamps novos, actualDuration zerado
    "memoryMd", "memoryAbstract", "memoryUpdatedAt", "memoryVersion",
    "selectedSteps"
  FROM "DesignSession" WHERE id = v_src_id;

  RAISE NOTICE 'DS v2 criada com id %', v_dst_id;

  -- 2. DesignSessionStepData (steps 0-8, exclui step 9 briefing)
  -- Trigger sync_brainstorm_features dispara automaticamente quando
  -- inserirmos a row do step brainstorm com novo sessionId.
  INSERT INTO "DesignSessionStepData" (id, "sessionId", "stepIndex", "stepKey", data, "updatedAt")
  SELECT gen_random_uuid(), v_dst_id, "stepIndex", "stepKey", data, NOW()
  FROM "DesignSessionStepData"
  WHERE "sessionId" = v_src_id
    AND "stepKey" != 'briefing';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'DesignSessionStepData replicado: % rows (step briefing excluido)', v_count;

  -- 3. DesignSessionItem (priorizacao)
  INSERT INTO "DesignSessionItem" (id, "sessionId", title, description, type, priority, "sourceStep", "aiGenerated", "orderIndex")
  SELECT gen_random_uuid(), v_dst_id, title, description, type, priority, "sourceStep", "aiGenerated", "orderIndex"
  FROM "DesignSessionItem"
  WHERE "sessionId" = v_src_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'DesignSessionItem replicado: % rows', v_count;

  -- 4. DesignDecision
  INSERT INTO "DesignDecision" (id, "sessionId", "projectId", statement, rationale, confidence, status, "supersededBy", tags, "createdAt", "createdBy", "updatedAt")
  SELECT gen_random_uuid(), v_dst_id, "projectId", statement, rationale, confidence, status, NULL, tags, NOW(), "createdBy", NOW()
  FROM "DesignDecision"
  WHERE "sessionId" = v_src_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'DesignDecision replicado: % rows', v_count;

  -- Validacao: confirmar que brainstorm features foram sincronizadas pela trigger
  SELECT count(*) INTO v_count FROM "DesignSessionBrainstormFeature" WHERE "sessionId" = v_dst_id;
  RAISE NOTICE 'DesignSessionBrainstormFeature na v2 (via trigger): % rows', v_count;

  RAISE NOTICE '====================================================';
  RAISE NOTICE 'DS v2 ID: %', v_dst_id;
  RAISE NOTICE 'Atualize zelar.md / runbooks com este novo id.';
  RAISE NOTICE '====================================================';
END $dup$;

COMMIT;
