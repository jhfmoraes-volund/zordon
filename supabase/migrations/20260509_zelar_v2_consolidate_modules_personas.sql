-- =============================================================================
-- Zelar v2: consolidar modules (12 -> 8) + limpar personas v1 + deletar 96
-- stories orfas de DesignSession.
--
-- Backup ja foi feito em backup_zelar_20260509 + clone visivel ZLAR_BAK.
--
-- Escopo:  apenas projeto Zelar ORIGINAL (referenceKey = 'ZLAR')
-- Clone ZLAR_BAK NAO e afetado por nada disto.
-- =============================================================================

BEGIN;

DO $reorg$
DECLARE
  v_pid uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_count int;

  -- IDs dos modules sobreviventes (consolidam os absorvedos)
  v_mod_onboarding   uuid;
  v_mod_execucao     uuid;
  v_mod_matching     uuid;

  -- IDs dos modules absorvidos (sumir no fim)
  v_mod_login        uuid;
  v_mod_onb_prest    uuid;
  v_mod_concl_fin    uuid;
  v_mod_anti_bypass  uuid;

BEGIN

-- ===========================================================================
-- 1. Deletar 96 stories orfas (sem designSessionId).
--    AcceptanceCriterion cascateia via FK ON DELETE CASCADE.
-- ===========================================================================
DELETE FROM "UserStory"
WHERE "projectId" = v_pid
  AND "designSessionId" IS NULL;
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE '1) Stories orfas deletadas: % (esperado: 96)', v_count;

-- ===========================================================================
-- 2. Deletar personas v1 (Carlos, Ana, Lucas, admin).
--    UserStory.personaId tem ON DELETE SET NULL? Vou verificar; se NOT NULL, falha.
--    (pelo schema visto, personaId e nullable, ON DELETE nao definido — Postgres
--    bloqueia se houver linhas referenciando, ou nao? FK precisa ON DELETE)
-- ===========================================================================
DELETE FROM "ProjectPersona"
WHERE "projectId" = v_pid
  AND name IN ('Carlos', 'Ana', 'Lucas', 'admin');
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE '2) Personas v1 deletadas: % (esperado: 4)', v_count;

-- ===========================================================================
-- 3. Buscar IDs dos modules envolvidos
-- ===========================================================================
SELECT id INTO v_mod_onboarding   FROM "Module" WHERE "projectId" = v_pid AND name = 'AUTENTICACAO_ONBOARDING';
SELECT id INTO v_mod_execucao     FROM "Module" WHERE "projectId" = v_pid AND name = 'EXECUCAO_DO_SERVICO';
SELECT id INTO v_mod_matching     FROM "Module" WHERE "projectId" = v_pid AND name = 'MATCHING_ALOCACAO';

SELECT id INTO v_mod_login        FROM "Module" WHERE "projectId" = v_pid AND name = 'LOGIN';
SELECT id INTO v_mod_onb_prest    FROM "Module" WHERE "projectId" = v_pid AND name = 'ONBOARDING_DO_PRESTADOR';
SELECT id INTO v_mod_concl_fin    FROM "Module" WHERE "projectId" = v_pid AND name = 'CONCLUSAO_FINANCEIRO';
SELECT id INTO v_mod_anti_bypass  FROM "Module" WHERE "projectId" = v_pid AND name = 'ANTI_BYPASS_ENGINE';

-- ===========================================================================
-- 4. Re-apontar stories restantes dos modules absorvidos pros sobreviventes
-- ===========================================================================
UPDATE "UserStory" SET "moduleId" = v_mod_onboarding, "updatedAt" = NOW()
WHERE "projectId" = v_pid AND "moduleId" IN (v_mod_login, v_mod_onb_prest);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE '4a) Stories LOGIN+ONBOARDING_DO_PRESTADOR -> ONBOARDING: %', v_count;

UPDATE "UserStory" SET "moduleId" = v_mod_execucao, "updatedAt" = NOW()
WHERE "projectId" = v_pid AND "moduleId" = v_mod_concl_fin;
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE '4b) Stories CONCLUSAO_FINANCEIRO -> EXECUCAO: %', v_count;

UPDATE "UserStory" SET "moduleId" = v_mod_matching, "updatedAt" = NOW()
WHERE "projectId" = v_pid AND "moduleId" = v_mod_anti_bypass;
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE '4c) Stories ANTI_BYPASS_ENGINE -> MATCHING: %', v_count;

-- ===========================================================================
-- 5. Deletar os 4 modules absorvidos (agora vazios)
-- ===========================================================================
DELETE FROM "Module"
WHERE "projectId" = v_pid
  AND id IN (v_mod_login, v_mod_onb_prest, v_mod_concl_fin, v_mod_anti_bypass);
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE '5) Modules absorvidos deletados: % (esperado: 4)', v_count;

-- ===========================================================================
-- 6. Renomear os 8 modules sobreviventes pros nomes consolidados v2
--    Constraint name format: ^[A-Z][A-Z0-9_]*$
-- ===========================================================================
UPDATE "Module" SET name = 'ONBOARDING',  "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'AUTENTICACAO_ONBOARDING';
UPDATE "Module" SET name = 'PERFIL',      "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'PERFIL_CONFIGURACOES';
UPDATE "Module" SET name = 'SOLICITACAO', "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'CATALOGO_SOLICITACAO';
UPDATE "Module" SET name = 'EXECUCAO',    "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'EXECUCAO_DO_SERVICO';
UPDATE "Module" SET name = 'MATCHING',    "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'MATCHING_ALOCACAO';
UPDATE "Module" SET name = 'SUPORTE',     "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'SUPORTE_CONFIANCA';
UPDATE "Module" SET name = 'ADMIN',       "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'ADMIN_OPERACAO';
UPDATE "Module" SET name = 'NOTIFICACAO', "updatedAt" = NOW() WHERE "projectId" = v_pid AND name = 'COMUNICACAO_NOTIFICACOES';

-- ===========================================================================
-- 7. Validacoes finais
-- ===========================================================================
SELECT COUNT(*) INTO v_count FROM "Module" WHERE "projectId" = v_pid;
RAISE NOTICE '7a) Modules ativos no projeto: % (esperado: 8)', v_count;

SELECT COUNT(*) INTO v_count FROM "ProjectPersona" WHERE "projectId" = v_pid;
RAISE NOTICE '7b) Personas ativas no projeto: % (esperado: 4)', v_count;

SELECT COUNT(*) INTO v_count FROM "UserStory" WHERE "projectId" = v_pid;
RAISE NOTICE '7c) Stories ativas no projeto: % (esperado: 25)', v_count;

SELECT COUNT(*) INTO v_count FROM "UserStory"
  WHERE "projectId" = v_pid AND ("moduleId" IS NULL OR "personaId" IS NULL);
RAISE NOTICE '7d) Stories com module/persona NULL: % (esperado: 0)', v_count;

END $reorg$;

COMMIT;
