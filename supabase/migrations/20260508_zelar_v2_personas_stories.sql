-- =============================================================================
-- Zelar v2 — Personas + 23 Stories
-- DS: 264e6d07-d365-43ba-8029-d539ce6f7c6b (Inception Zelar v2)
-- =============================================================================
-- Princípio: cada story = uma capacidade da persona. Capacidade = ponta a ponta.
-- 4 personas: PRESTADOR, CLIENTE, ADMIN, SISTEMA (transversais).
-- proposedModuleName usa nomenclatura v2 conceitual; moduleId aponta pro
-- módulo v1 mais próximo (12 módulos do projeto não são alterados).
--
-- 23 stories: 8 PRESTADOR + 7 CLIENTE + 5 ADMIN + 4 SISTEMA (incluindo NOTIF).
-- Todas com refinementStatus='draft'. AC produto vem na próxima migration.
-- Reference scheme: ZLAR-V2-US-NNN (não colide com ZLAR-US-NNN da v1).
-- =============================================================================

BEGIN;

-- ─── Personas v2 ─────────────────────────────────────────────────────────────
DO $personas$
DECLARE
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_persona_prestador uuid;
  v_persona_cliente   uuid;
  v_persona_admin     uuid;
  v_persona_sistema   uuid;
BEGIN
  INSERT INTO "ProjectPersona" (id, "projectId", name, description, "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid(), v_project_id, 'PRESTADOR',
     'Profissional que oferece serviços via plataforma. Cadastra-se, passa por KYC, recebe propostas, executa serviços e gerencia carteira.',
     NOW(), NOW()),
    (gen_random_uuid(), v_project_id, 'CLIENTE',
     'Usuário que solicita serviços. Cadastra-se, navega catálogo, paga up-front, acompanha execução e avalia.',
     NOW(), NOW()),
    (gen_random_uuid(), v_project_id, 'ADMIN',
     'Equipe Zelar. Modera prestadores, opera dashboards, gerencia disputas e configura parâmetros operacionais.',
     NOW(), NOW()),
    (gen_random_uuid(), v_project_id, 'SISTEMA',
     'Capacidades transversais sem ator humano direto: matching, anti-bypass, notificações, RLS, ciclo de vida.',
     NOW(), NOW())
  ON CONFLICT ("projectId", name) DO UPDATE SET description = EXCLUDED.description, "updatedAt" = NOW();

  RAISE NOTICE 'Personas v2 criadas/atualizadas: PRESTADOR, CLIENTE, ADMIN, SISTEMA';
END $personas$;

-- ─── Helper de criação de story (escopo da sessão) ──────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.create_story(
  p_session_id uuid,
  p_project_id uuid,
  p_reference text,
  p_title text,
  p_persona_name text,
  p_module_v1_name text,
  p_module_v2_name text,
  p_want text,
  p_so_that text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_story_id uuid;
  v_persona_id uuid;
  v_module_id uuid;
BEGIN
  SELECT id INTO v_persona_id
  FROM "ProjectPersona"
  WHERE "projectId" = p_project_id AND name = p_persona_name;

  SELECT id INTO v_module_id
  FROM "Module"
  WHERE "projectId" = p_project_id AND name = p_module_v1_name;

  -- Idempotente por reference
  SELECT id INTO v_story_id FROM "UserStory" WHERE reference = p_reference;
  IF v_story_id IS NULL THEN
    v_story_id := gen_random_uuid();
    INSERT INTO "UserStory" (
      id, "projectId", "moduleId", "proposedModuleName", reference, title,
      "personaId", want, "soThat", "refinementStatus",
      "designSessionId", "createdByAgent", "createdAt", "updatedAt"
    ) VALUES (
      v_story_id, p_project_id, v_module_id, p_module_v2_name, p_reference, p_title,
      v_persona_id, p_want, p_so_that, 'draft',
      p_session_id, true, NOW(), NOW()
    );
  ELSE
    UPDATE "UserStory" SET
      title = p_title,
      "personaId" = v_persona_id,
      "moduleId" = v_module_id,
      "proposedModuleName" = p_module_v2_name,
      want = p_want,
      "soThat" = p_so_that,
      "designSessionId" = p_session_id,
      "updatedAt" = NOW()
    WHERE id = v_story_id;
  END IF;
  RETURN v_story_id;
END;
$$;

-- =============================================================================
-- 23 STORIES
-- =============================================================================
DO $stories$
DECLARE
  v_session_id uuid := '264e6d07-d365-43ba-8029-d539ce6f7c6b';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story_id uuid;
BEGIN

-- ─── PRESTADOR (8) ──────────────────────────────────────────────────────────

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-001',
  'Cadastrar-se e ser aprovado como prestador',
  'PRESTADOR', 'AUTENTICACAO_ONBOARDING', 'ONBOARDING',
  'preencher meus dados, enviar documentos via KYC e acompanhar a aprovação até estar habilitado',
  'eu possa começar a receber propostas de serviço com identidade verificada');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-002',
  'Fazer login como prestador e ser roteado conforme situação da conta',
  'PRESTADOR', 'LOGIN', 'ONBOARDING',
  'entrar no app e cair na tela certa conforme meu KYC esteja aprovado, pendente, reprovado ou bloqueado',
  'eu nunca veja telas que não correspondem ao meu estado real');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-003',
  'Completar pré-requisitos para entrar no pool de matching',
  'PRESTADOR', 'ONBOARDING_DO_PRESTADOR', 'ONBOARDING',
  'configurar minha disponibilidade semanal e cadastrar uma conta bancária verificada',
  'eu apareça nas propostas e possa receber repasses');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-004',
  'Receber e aceitar propostas de serviço',
  'PRESTADOR', 'EXECUCAO_DO_SERVICO', 'EXECUCAO',
  'ver propostas compatíveis com meu perfil em tempo real e aceitar antes de outros prestadores',
  'eu garanta meu fluxo de trabalho aproveitando a janela de aceite');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-005',
  'Executar serviço com check-in, fluxo guiado e conclusão assinada',
  'PRESTADOR', 'EXECUCAO_DO_SERVICO', 'EXECUCAO',
  'iniciar o serviço com código de confirmação, seguir steps de execução e finalizar com assinatura do cliente',
  'eu prove a entrega e libere o pagamento dentro das regras');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-006',
  'Lidar com situações atípicas durante execução do serviço',
  'PRESTADOR', 'EXECUCAO_DO_SERVICO', 'EXECUCAO',
  'reportar diagnóstico diferente, material adicional, retorno em outro dia, no-show do cliente ou abandono próprio com fluxo claro',
  'eventos não-felizes virem registros formais sem prejudicar nenhuma das partes');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-007',
  'Gerenciar carteira, agenda, histórico e perfil profissional',
  'PRESTADOR', 'PERFIL_CONFIGURACOES', 'PERFIL',
  'visualizar saldo e repasses, ver agenda da semana, consultar serviços passados e ajustar dados do meu perfil',
  'eu tenha controle financeiro e operacional do meu trabalho na plataforma');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-008',
  'Entender motivo de suspensão e ter caminho de reativação ou contestação',
  'PRESTADOR', 'ONBOARDING_DO_PRESTADOR', 'ONBOARDING',
  'ver na tela suspensa o motivo específico (no-show, manual, geolocalização, KYC, penalidade) e o que posso fazer',
  'eu não fique preso em limbo e saiba como retomar atividades quando possível');

-- ─── CLIENTE (7) ────────────────────────────────────────────────────────────

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-009',
  'Cadastrar-se, completar perfil e fazer login como cliente',
  'CLIENTE', 'AUTENTICACAO_ONBOARDING', 'ONBOARDING',
  'criar conta, preencher endereço e consentimentos, e entrar no app no fluxo certo',
  'eu esteja pronto para solicitar serviços');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-010',
  'Conhecer e navegar o catálogo de serviços',
  'CLIENTE', 'CATALOGO_SOLICITACAO', 'SOLICITACAO',
  'ver categorias e subserviços disponíveis com preços indicativos e onboarding inicial pelo app',
  'eu entenda o que a Zelar oferece e escolha o serviço certo');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-011',
  'Solicitar serviço com pagamento up-front e ver confirmação',
  'CLIENTE', 'CATALOGO_SOLICITACAO', 'SOLICITACAO',
  'preencher detalhes, escolher data, pagar via Mercado Pago e ver tela de confirmação com status',
  'eu tenha garantia de execução com pagamento custodiado em escrow');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-012',
  'Acompanhar serviço em andamento com stepper e comunicação',
  'CLIENTE', 'EXECUCAO_DO_SERVICO', 'EXECUCAO',
  'ver o estado do serviço (prestador a caminho, em execução, concluído) e me comunicar via WhatsApp templates',
  'eu saiba sempre o que está acontecendo sem precisar ligar');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-013',
  'Avaliar, assinar conclusão e ver histórico de serviços e pagamentos',
  'CLIENTE', 'CONCLUSAO_FINANCEIRO', 'EXECUCAO',
  'avaliar o prestador depois do serviço, assinar a conclusão e consultar histórico de transações',
  'a transação fique registrada formalmente e eu tenha trilha financeira completa');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-014',
  'Gerenciar perfil, endereços e consentimentos LGPD',
  'CLIENTE', 'PERFIL_CONFIGURACOES', 'PERFIL',
  'editar dados pessoais, endereços salvos e revogar/reativar consentimentos granulares',
  'eu tenha controle sobre meus dados e privacidade conforme LGPD');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-015',
  'Cancelar serviço e lidar com divergências durante execução',
  'CLIENTE', 'EXECUCAO_DO_SERVICO', 'EXECUCAO',
  'cancelar dentro da política, aceitar reajuste no local, autorizar serviço/material adicional e reportar problemas',
  'eu tenha caminho claro pra cada situação não-feliz');

-- ─── ADMIN (5) ──────────────────────────────────────────────────────────────

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-016',
  'Operar dashboard com KPIs e relatórios da plataforma',
  'ADMIN', 'ADMIN_OPERACAO', 'ADMIN',
  'ver KPIs operacionais, alertas de demanda vs supply e exportar relatórios',
  'eu tome decisões diárias com dados consolidados');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-017',
  'Gerenciar prestadores: aprovar KYC manual, moderar e suspender',
  'ADMIN', 'ADMIN_OPERACAO', 'ADMIN',
  'analisar fila de KYC manual, ver perfil completo, suspender com motivo e auditar histórico',
  'eu mantenha qualidade e conformidade da base de prestadores');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-018',
  'Atender suporte, gerenciar disputas e contestações',
  'ADMIN', 'SUPORTE_CONFIANCA', 'SUPORTE',
  'ver tickets de suporte, processar disputas com evidências e decidir contestações de suspensão',
  'eu resolva conflitos com trilha de auditoria e SLA controlado');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-019',
  'Configurar feature flags, templates e parâmetros operacionais',
  'ADMIN', 'ADMIN_OPERACAO', 'ADMIN',
  'editar templates WhatsApp/email, ajustar thresholds (KYC, fairness, escrow) e ativar feature flags sem deploy',
  'a operação seja calibrável sem depender do time de eng pra cada ajuste');

-- ─── SISTEMA (4) ────────────────────────────────────────────────────────────

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-020',
  'Engine de matching com pool broadcast e fairness',
  'SISTEMA', 'MATCHING_ALOCACAO', 'MATCHING',
  'distribuir solicitações compatíveis pra pool de prestadores elegíveis com fairness e janela de aceite',
  'cliente seja atendido rapidamente e prestadores tenham chances proporcionais');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-021',
  'Engine anti-bypass: detecção, score de risco e escalonamento de penalidades',
  'SISTEMA', 'ANTI_BYPASS_ENGINE', 'MATCHING',
  'detectar tentativas de transação fora da plataforma, calcular score R(o,c) e aplicar escalonamento N1→N4',
  'a Zelar mantenha take-rate e reduza vazamento de transações');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-022',
  'Sistema multicanal de notificações (WhatsApp, e-mail, push)',
  'SISTEMA', 'COMUNICACAO_NOTIFICACOES', 'ONBOARDING',
  'disparar mensagens nos canais corretos com templates aprovados e fallback automático',
  'usuários sejam alcançados com confiabilidade independente do canal');

PERFORM pg_temp.create_story(v_session_id, v_project_id, 'ZLAR-V2-US-023',
  'Matriz de permissões (RLS) e ciclo de vida do serviço',
  'SISTEMA', 'ADMIN_OPERACAO', 'ADMIN',
  'aplicar RLS por ator (cliente, prestador, admin) e governar transições de estado do serviço',
  'cada ator vê apenas o que pode e o estado do serviço seja sempre consistente');

RAISE NOTICE '23 stories v2 criadas/atualizadas em ZLAR-V2-US-001..023';
END $stories$;

COMMIT;
