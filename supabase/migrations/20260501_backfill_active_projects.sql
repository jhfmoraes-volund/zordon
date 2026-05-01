-- Backfill story-hierarchy: 8 projetos ativos restantes (excluindo Zordon, já feito).
--
-- Decisões (validadas com PM 2026-05-01):
--   - referenceKey 4 chars, ALL CAPS, único.
--   - DoD = [] (default, PM preenche conforme refinar — mesmo padrão do Zordon).
--   - Modules = 0 (sem contexto pra inventar; PM cria conforme stories aparecem).
--   - Personas: NENHUMA pra 7 projetos. Só Zelar tem 3 (cliente, fornecedor, admin).
--   - Tasks órfãs (FORGE 1, Zelar 1): wrap em story "Bootstrap do projeto", refinement=draft.
--   - Zelar [Deprecated] (archived) NÃO entra no backfill.
--
-- Resultado esperado: 0 tasks órfãs em projetos não-archived → libera Wave 10 cleanup.

BEGIN;

-- 1) referenceKeys
UPDATE "Project" SET "referenceKey" = 'EDOW' WHERE id = '9de997fb-603d-495a-b2ef-8d3ebda588e0';
UPDATE "Project" SET "referenceKey" = 'ESCM' WHERE id = '77b9569c-0552-43af-ba15-cf027cf07bbd';
UPDATE "Project" SET "referenceKey" = 'FRGE' WHERE id = '8e4a16a3-70bf-4992-bf94-816233c96baf';
UPDATE "Project" SET "referenceKey" = 'PGFP' WHERE id = '04ab7f36-f076-4d5f-9a03-6e3f1dcd9067';
UPDATE "Project" SET "referenceKey" = 'RIPL' WHERE id = '2bba2f4b-fae3-4465-b03f-0c3842ef47ec';
UPDATE "Project" SET "referenceKey" = 'RIP2' WHERE id = '60043424-515a-4684-809e-174d185eef25';
UPDATE "Project" SET "referenceKey" = 'SSPR' WHERE id = 'f94bcad0-267f-4888-ab98-6b6002c99736';
UPDATE "Project" SET "referenceKey" = 'ZLAR' WHERE id = 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';

-- 2) Personas — apenas Zelar
INSERT INTO "ProjectPersona" ("projectId", name, description) VALUES
  ('e41c492e-7a14-44b2-83b9-b8e0f2b38e4c', 'cliente',    'Cliente final da AURORA — consome o serviço Zelar'),
  ('e41c492e-7a14-44b2-83b9-b8e0f2b38e4c', 'fornecedor', 'Fornecedor parceiro — entrega o serviço pro cliente'),
  ('e41c492e-7a14-44b2-83b9-b8e0f2b38e4c', 'admin',      'Admin AURORA — gestão da plataforma e operação')
ON CONFLICT ("projectId", name) DO NOTHING;

-- 3) Bootstrap stories pros 2 projetos com tasks órfãs (FORGE, Zelar)
DO $$
DECLARE
  v_forge_id    uuid := '8e4a16a3-70bf-4992-bf94-816233c96baf';
  v_zelar_id    uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_zelar_admin uuid;
  v_forge_ref   text;
  v_zelar_ref   text;
  v_forge_story uuid;
  v_zelar_story uuid;
  v_forge_orphans int;
  v_zelar_orphans int;
BEGIN
  SELECT id INTO v_zelar_admin
  FROM "ProjectPersona"
  WHERE "projectId" = v_zelar_id AND name = 'admin';

  IF v_zelar_admin IS NULL THEN
    RAISE EXCEPTION 'Zelar admin persona missing — INSERT da step 2 falhou';
  END IF;

  v_forge_ref := next_user_story_reference(v_forge_id);
  v_zelar_ref := next_user_story_reference(v_zelar_id);

  INSERT INTO "UserStory" (
    "projectId", reference, title, want, "soThat", "personaId", "refinementStatus"
  ) VALUES (
    v_forge_id, v_forge_ref,
    'Bootstrap do projeto FORGE',
    'estabelecer a estrutura inicial do projeto pra começar a planejar entregas',
    'o time tenha um ponto de partida claro pra refinar escopo e criar histórias futuras',
    NULL,
    'draft'
  )
  RETURNING id INTO v_forge_story;

  INSERT INTO "UserStory" (
    "projectId", reference, title, want, "soThat", "personaId", "refinementStatus"
  ) VALUES (
    v_zelar_id, v_zelar_ref,
    'Bootstrap do projeto Zelar',
    'estabelecer a estrutura inicial do projeto pra começar a planejar entregas',
    'o time tenha um ponto de partida claro pra refinar escopo e criar histórias futuras',
    v_zelar_admin,
    'draft'
  )
  RETURNING id INTO v_zelar_story;

  UPDATE "Task" SET "userStoryId" = v_forge_story
   WHERE "projectId" = v_forge_id AND "userStoryId" IS NULL;
  GET DIAGNOSTICS v_forge_orphans = ROW_COUNT;

  UPDATE "Task" SET "userStoryId" = v_zelar_story
   WHERE "projectId" = v_zelar_id AND "userStoryId" IS NULL;
  GET DIAGNOSTICS v_zelar_orphans = ROW_COUNT;

  RAISE NOTICE 'Bootstrap FORGE ref=%, story=%, tasks linked=%',  v_forge_ref, v_forge_story, v_forge_orphans;
  RAISE NOTICE 'Bootstrap Zelar ref=%, story=%, tasks linked=%', v_zelar_ref, v_zelar_story, v_zelar_orphans;
END $$;

-- 4) Sanity check antes de COMMIT — falha se algum ativo (não-archived) ainda tem órfã
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT COUNT(*) INTO v_orphans
  FROM "Task" t
  JOIN "Project" p ON p.id = t."projectId"
  WHERE p.status != 'archived'
    AND t."userStoryId" IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'Ainda há % tasks órfãs em projetos não-archived', v_orphans;
  END IF;
END $$;

COMMIT;
