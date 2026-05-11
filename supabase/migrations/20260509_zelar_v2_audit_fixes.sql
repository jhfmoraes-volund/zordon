-- =============================================================================
-- Auditoria pre-tasks — Zelar v2 DS Inception
-- =============================================================================
-- Aplica correcoes da auditoria de AC executada em 2026-05-09:
--
--   PARTE 1 — Quebra de stories grandes/multi-capacidade:
--     US-007 (14 AC, hub PRESTADOR misturando 4 capacidades)
--       -> US-007 vira "Editar perfil, dados pessoais/bancarios e logout" (5 AC)
--       -> nova US-027 "Configurar disponibilidade semanal e ver agenda" (5 AC)
--       -> nova US-028 "Operar carteira, ganhos e historico de servicos" (4 AC)
--     US-018 (15 AC, ADMIN misturando suporte geral + disputas)
--       -> US-018 vira "Atender tickets de suporte geral" (5 AC)
--       -> nova US-026 "Resolver disputas com decisao financeira e auditoria" (11 AC)
--
--   PARTE 2 — Remocao de duplicacoes literais (severidade ALTO):
--     US-016 #6 (gate supply minimo) — remover (configuracao pertence a US-019)
--     US-009 #8 (tour guiado) — remover (tour pertence a US-010)
--
--   PARTE 3 — Reescritas para clarear limite (severidade MEDIO):
--     US-002 #7 — reduzir a "redirect", detalhe vive em US-008
--     US-003 #3 — focar "configuracao inicial obrigatoria", edicao continua em nova US-027
--     US-006 #13 — focar UX, regra de bloqueio fica em US-023 #12
--     US-019 #8 — explicitar "ciclo de vida pos go-live"
--     US-024 #2 — explicitar "estado inicial pre go-live"
--
-- Resultado: 25 stories -> 28 stories. AC redistribuidos sem perda de cobertura.
-- =============================================================================

BEGIN;

DO $audit$
DECLARE
  v_session_id uuid := '264e6d07-d365-43ba-8029-d539ce6f7c6b';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';

  -- IDs das stories existentes que vamos manipular
  v_us007_id uuid;
  v_us018_id uuid;

  -- Module + persona reuse
  v_module_perfil_id  uuid;
  v_persona_prestador uuid;
  v_module_suporte_id uuid;
  v_persona_admin     uuid;

  -- IDs das novas stories (gerados na hora)
  v_us026_id uuid := gen_random_uuid();
  v_us027_id uuid := gen_random_uuid();
  v_us028_id uuid := gen_random_uuid();

  v_count int;
BEGIN

-- =============================================================================
-- Pre-flight: pegar IDs das stories e dos module/persona
-- =============================================================================
SELECT id, "moduleId", "personaId"
  INTO v_us007_id, v_module_perfil_id, v_persona_prestador
FROM "UserStory"
WHERE "designSessionId" = v_session_id AND reference = 'ZLAR-V2-US-007';

SELECT id, "moduleId", "personaId"
  INTO v_us018_id, v_module_suporte_id, v_persona_admin
FROM "UserStory"
WHERE "designSessionId" = v_session_id AND reference = 'ZLAR-V2-US-018';

IF v_us007_id IS NULL OR v_us018_id IS NULL THEN
  RAISE EXCEPTION 'Stories US-007 ou US-018 nao encontradas. Abortando.';
END IF;

-- =============================================================================
-- PARTE 1 — Quebrar US-018 em 2 stories (suporte geral vs disputas)
-- =============================================================================

-- 1a) Renomear US-018 e atualizar want/soThat para refletir escopo reduzido
UPDATE "UserStory"
SET title    = 'Atender tickets de suporte geral',
    want     = 'ver e processar chamados de suporte de clientes e prestadores (servico, pagamento, erro tecnico, feedback, outros)',
    "soThat" = 'eu resolva duvidas e problemas operacionais com SLA controlado',
    "updatedAt" = NOW()
WHERE id = v_us018_id;

-- 1b) Criar US-026 (disputas)
INSERT INTO "UserStory" (
  id, "projectId", "moduleId", reference, title, "personaId", want, "soThat",
  "refinementStatus", "designSessionId", "createdByAgent",
  "createdAt", "updatedAt"
) VALUES (
  v_us026_id, v_project_id, v_module_suporte_id, 'ZLAR-V2-US-026',
  'Resolver disputas com decisao financeira e auditoria',
  v_persona_admin,
  'analisar disputas com evidencias, decidir outcome (estorno, repasse parcial, retrabalho, ma-fe), aplicar execucao financeira automatica e avaliar recursos',
  'eu resolva conflitos formalmente com trilha de auditoria imutavel e impacto financeiro correto',
  'refined', v_session_id, true, NOW(), NOW()
);

-- 1c) US-018 fica com AC 1-4 + AC15 (estado vazio/skeleton/paginacao — vale para ambas as filas)
--     US-026 absorve AC 5-14. Vamos:
--       (a) deletar AC atuais que nao sao 1-4 e 15 da US-018
--       (b) reordenar e reescrever AC 5 (era AC 15 da US-018, vira AC 5 final)
--       (c) inserir 11 AC novos em US-026 (AC 5-15 originais, recodificados)

-- (a) Deletar AC 5 a 14 da US-018 antiga
DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" = v_us018_id
  AND "order" BETWEEN 5 AND 14;

-- (b) Renumerar AC 15 -> AC 5 e reescrever para focar em "tickets de suporte"
UPDATE "AcceptanceCriterion"
SET "order" = 5,
    text = 'ADMIN ve a fila de tickets com tela tratada para estado vazio, skeleton durante carregamento e paginacao ou scroll infinito para alto volume, sem layout quebrado em nenhum cenario.',
    "updatedAt" = NOW()
WHERE "userStoryId" = v_us018_id
  AND "order" = 15;

-- (c) Criar AC para US-026 (Resolver disputas) — 11 AC
INSERT INTO "AcceptanceCriterion" (id, "userStoryId", "order", text, "createdAt", "updatedAt") VALUES
(gen_random_uuid(), v_us026_id,  1, 'ADMIN acessa fila de disputas separada da fila de suporte geral, com listagem priorizada por status (aberta aguardando prestador, aguardando resposta, em analise) e tempo desde abertura.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  2, 'ADMIN no detalhe de uma disputa ve descricao do solicitante, evidencias anexadas (fotos/texto), resposta do outro lado, protocolo fotografico do servico, historico do chat e timeline de eventos.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  3, 'ADMIN registra decisao formal selecionando outcome (favoravel ao cliente, favoravel ao prestador, parcial, retrabalho mediado) com justificativa obrigatoria; a decisao dispara execucao financeira automatica (estorno, repasse parcial ou manutencao) e notifica ambas as partes.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  4, 'ADMIN aciona retrabalho mediado e o prestador tem 24h para aceitar e agendar; sem resposta do prestador, a Zelar realoca com outro profissional e desconta a comissao do repasse original.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  5, 'ADMIN pode marcar uma disputa como "ma-fe" do solicitante apos analise; o sistema aplica penalidade gradativa ao denunciante e incrementa contador de disputas de ma-fe na sua ficha.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  6, 'ADMIN solicita evidencias adicionais quando faltam dados; o solicitante recebe notificacao com prazo de 48h para complementar antes da decisao com o que ha disponivel.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  7, 'ADMIN ve disputas abertas por usuarios com 3 ou mais ocorrencias em 30 dias destacadas com flag de "padrao recorrente", para avaliar se ha abuso antes de processar.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  8, 'ADMIN avalia recursos solicitados apos decisao; o solicitante anexa novos elementos e justificativa, e o admin decide com base em historico e relevancia da nova evidencia, sem garantia de reabertura.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id,  9, 'ADMIN ao aplicar estorno e a carteira do prestador nao tem saldo suficiente, executa estorno parcial com o disponivel e o saldo devedor e descontado automaticamente dos proximos repasses, mantendo o cliente informado do prazo.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id, 10, 'ADMIN ve trilha de auditoria completa em cada decisao tomada (quem decidiu, quando, justificativa, outcome financeiro), preservada de forma imutavel para conformidade.', NOW(), NOW()),
(gen_random_uuid(), v_us026_id, 11, 'ADMIN ve a fila de disputas com tela tratada para estado vazio, skeleton durante carregamento e paginacao ou scroll infinito para alto volume, sem layout quebrado em nenhum cenario.', NOW(), NOW());

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'US-026 criada com % AC', v_count;

-- =============================================================================
-- PARTE 1b — Quebrar US-007 em 3 stories
-- =============================================================================

-- US-007 fica com AC 1-4 (perfil/categorias/banco) + AC 14 (logout/exclusao)
-- US-027 absorve AC 5-9 (disponibilidade + agenda)
-- US-028 absorve AC 10-13 (carteira + ganhos + historico)

-- 2a) Renomear US-007
UPDATE "UserStory"
SET title    = 'Editar perfil, dados pessoais, bancarios e logout',
    want     = 'editar dados pessoais, foto, categorias certificadas e conta bancaria, ver meu perfil publico e gerenciar acoes de conta (logout, exclusao)',
    "soThat" = 'eu mantenha minhas informacoes operacionais sempre corretas e tenha controle sobre minha conta',
    "updatedAt" = NOW()
WHERE id = v_us007_id;

-- 2b) Criar US-027 (Disponibilidade + Agenda)
INSERT INTO "UserStory" (
  id, "projectId", "moduleId", reference, title, "personaId", want, "soThat",
  "refinementStatus", "designSessionId", "createdByAgent",
  "createdAt", "updatedAt"
) VALUES (
  v_us027_id, v_project_id, v_module_perfil_id, 'ZLAR-V2-US-027',
  'Configurar disponibilidade semanal e acompanhar agenda',
  v_persona_prestador,
  'configurar dias e horarios em que aceito servicos, usar toggle rapido de indisponibilidade e ver minha agenda dos proximos dias',
  'eu controle quando trabalho e nao perca servicos por esquecimento',
  'refined', v_session_id, true, NOW(), NOW()
);

-- 2c) Criar US-028 (Carteira + Historico)
INSERT INTO "UserStory" (
  id, "projectId", "moduleId", reference, title, "personaId", want, "soThat",
  "refinementStatus", "designSessionId", "createdByAgent",
  "createdAt", "updatedAt"
) VALUES (
  v_us028_id, v_project_id, v_module_perfil_id, 'ZLAR-V2-US-028',
  'Operar carteira, ganhos e historico de servicos',
  v_persona_prestador,
  'visualizar saldo, status dos pagamentos, extrato cronologico, solicitar saque antecipado quando necessario e consultar meu historico operacional de servicos',
  'eu tenha controle financeiro e operacional completo do meu trabalho na plataforma',
  'refined', v_session_id, true, NOW(), NOW()
);

-- 2d) Limpar AC da US-007 e reescrever 5 AC finais (perfil + logout)
DELETE FROM "AcceptanceCriterion" WHERE "userStoryId" = v_us007_id;

INSERT INTO "AcceptanceCriterion" (id, "userStoryId", "order", text, "createdAt", "updatedAt") VALUES
(gen_random_uuid(), v_us007_id, 1, 'PRESTADOR acessa o hub de perfil pela navegacao principal a qualquer momento e ve seus dados pessoais, categorias de atuacao, conta bancaria, foto, badge de nivel, avaliacoes recebidas e link para o proprio perfil publico.', NOW(), NOW()),
(gen_random_uuid(), v_us007_id, 2, 'PRESTADOR edita campo a campo (nome, telefone, foto) com validacao inline e toast de confirmacao; tentativa de salvar com dado invalido exibe mensagem especifica sem perder o resto do formulario.', NOW(), NOW()),
(gen_random_uuid(), v_us007_id, 3, 'PRESTADOR atualiza categorias de atuacao com pelo menos uma categoria selecionada (sem zero categorias permitidas); novas categorias passam a valer apenas para alocacoes futuras, sem afetar servicos em andamento.', NOW(), NOW()),
(gen_random_uuid(), v_us007_id, 4, 'PRESTADOR atualiza dados bancarios com validacao do gateway; conta entra em "Em verificacao" ate confirmacao; pagamentos ja agendados mantem a conta original e novos pagamentos passam a usar a nova conta apos validacao.', NOW(), NOW()),
(gen_random_uuid(), v_us007_id, 5, 'PRESTADOR aciona logout com confirmacao simples; tentativa de excluir conta com servicos ativos e bloqueada com mensagem clara orientando a concluir ou cancelar antes.', NOW(), NOW());

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'US-007 reescrita com % AC', v_count;

-- 2e) AC para US-027 (Disponibilidade + Agenda) — 6 AC
INSERT INTO "AcceptanceCriterion" (id, "userStoryId", "order", text, "createdAt", "updatedAt") VALUES
(gen_random_uuid(), v_us027_id, 1, 'PRESTADOR configura janela de disponibilidade semanal por dia e horario em grade interativa; o sistema de matching respeita a janela e nao notifica/inclui o prestador no pool fora dela.', NOW(), NOW()),
(gen_random_uuid(), v_us027_id, 2, 'PRESTADOR sem janela configurada herda disponibilidade padrao (todos os dias 8h-18h); ao tentar salvar com janela vazia recebe alerta confirmando que sairia do pool, exigindo confirmacao explicita.', NOW(), NOW()),
(gen_random_uuid(), v_us027_id, 3, 'PRESTADOR usa toggle rapido "Indisponivel hoje" na home para sair do pool por 24h sem editar a grade semanal; o toggle prevalece sobre a grade naquele dia.', NOW(), NOW()),
(gen_random_uuid(), v_us027_id, 4, 'PRESTADOR acessa "Minha Agenda" e ve lista cronologica dos servicos agendados nos proximos dias com data, horario, endereco, categoria e valor; novos servicos aceitos aparecem em tempo real sem recarregar a tela.', NOW(), NOW()),
(gen_random_uuid(), v_us027_id, 5, 'PRESTADOR recebe notificacao 2h antes do horario agendado e novamente 30min antes se ainda nao tiver tocado "Estou a caminho", evitando no-show por esquecimento.', NOW(), NOW()),
(gen_random_uuid(), v_us027_id, 6, 'PRESTADOR ve a agenda com estado vazio orientando a configurar disponibilidade quando nao ha servicos agendados, e card especifico quando o servico e cancelado (badge + motivo, mantido por 24h para ciencia e depois removido).', NOW(), NOW());

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'US-027 criada com % AC', v_count;

-- 2f) AC para US-028 (Carteira + Historico) — 5 AC
INSERT INTO "AcceptanceCriterion" (id, "userStoryId", "order", text, "createdAt", "updatedAt") VALUES
(gen_random_uuid(), v_us028_id, 1, 'PRESTADOR acessa "Carteira" e ve montante total ganho, saldo em hold, total do mes e extrato cronologico por servico, com status de cada pagamento (programado, liberado, em analise).', NOW(), NOW()),
(gen_random_uuid(), v_us028_id, 2, 'PRESTADOR ve cada pagamento liberado automaticamente apos a janela de garantia/aceite tacito do servico, sem precisar acionar saque; recebe notificacao externa quando o valor cai na conta.', NOW(), NOW()),
(gen_random_uuid(), v_us028_id, 3, 'PRESTADOR pode abrir ticket de suporte para solicitar saque antecipado direto do detalhe de um pagamento programado; pagamentos em disputa nao expoem o CTA de saque antecipado.', NOW(), NOW()),
(gen_random_uuid(), v_us028_id, 4, 'PRESTADOR acessa "Meu historico" e ve servicos executados com protocolo fotografico, avaliacao recebida, timeline de eventos e link para o pagamento na carteira; servicos com retrabalho ou disputa exibem badge e CTA contextual de resposta.', NOW(), NOW()),
(gen_random_uuid(), v_us028_id, 5, 'PRESTADOR ve a carteira e o historico com paginacao ou scroll infinito para alto volume, skeleton durante carregamento e estado vazio tratado quando nao ha registros, sem layout quebrado.', NOW(), NOW());

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'US-028 criada com % AC', v_count;

-- =============================================================================
-- PARTE 2 — Remover duplicacoes literais (severidade ALTO)
-- =============================================================================

-- 3a) Remover US-016 #6 (gate de supply minimo) — config pertence a US-019
DELETE FROM "AcceptanceCriterion" ac
USING "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-016'
  AND ac."order" = 6;

-- Renumerar AC 7-12 da US-016 para 6-11 (manter sequencia continua)
UPDATE "AcceptanceCriterion" ac
SET "order" = ac."order" - 1, "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-016'
  AND ac."order" BETWEEN 7 AND 12;

-- 3b) Remover US-009 #8 (tour guiado) — pertence a US-010
DELETE FROM "AcceptanceCriterion" ac
USING "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-009'
  AND ac."order" = 8;

-- Renumerar AC 9-10 da US-009 para 8-9
UPDATE "AcceptanceCriterion" ac
SET "order" = ac."order" - 1, "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-009'
  AND ac."order" BETWEEN 9 AND 10;

RAISE NOTICE 'Duplicacoes ALTO removidas: US-016 #6 e US-009 #8';

-- =============================================================================
-- PARTE 3 — Reescritas para clarear limite (severidade MEDIO)
-- =============================================================================

-- 4a) US-002 #7 — reduzir a redirect, detalhe vive em US-008
UPDATE "AcceptanceCriterion" ac
SET text = 'PRESTADOR autenticado com conta suspensa e redirecionado para o fluxo dedicado de suspensao (ver US-008) ao tentar acessar qualquer rota operacional, sem dependencia de protecao no frontend.',
    "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-002'
  AND ac."order" = 7;

-- 4b) US-003 #3 — focar checklist obrigatorio (configuracao continua agora vive em US-027)
UPDATE "AcceptanceCriterion" ac
SET text = 'PRESTADOR no checklist de pre-requisitos vê a configuracao de disponibilidade semanal como item obrigatorio antes de entrar no pool; o detalhe da grade interativa e do toggle "indisponivel hoje" e gerenciado depois pela US-027.',
    "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-003'
  AND ac."order" = 3;

-- 4c) US-006 #13 — focar UX (regra de bloqueio fica em US-023 #12)
UPDATE "AcceptanceCriterion" ac
SET text = 'PRESTADOR com pendencia ativa de uma situacao atipica (reajuste, material, retorno, adicional) ve mensagem clara identificando qual e a pendencia e o caminho para resolve-la antes de abrir uma nova; a regra de bloqueio de estados paralelos e governada pela US-023.',
    "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-006'
  AND ac."order" = 13;

-- 4d) US-019 #8 — explicitar "ciclo de vida pos go-live"
UPDATE "AcceptanceCriterion" ac
SET text = 'ADMIN gerencia o ciclo de vida pos go-live dos templates de comunicacao externa (mensagens transacionais e e-mail): cadastra novos templates pendentes de pre-aprovacao da plataforma de mensageria, marca como ativos apos validacao externa, desativa e versiona; o conjunto inicial de templates do go-live e responsabilidade da US-024.',
    "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-019'
  AND ac."order" = 8;

-- 4e) US-024 #2 — explicitar "estado inicial pre go-live"
UPDATE "AcceptanceCriterion" ac
SET text = 'SISTEMA tem o conjunto inicial de templates de mensageria externa pre-aprovados pela plataforma de mensageria antes do go-live, com placeholders documentados no formato padrao do provedor; alteracoes e novos templates apos go-live ficam sob a US-019.',
    "updatedAt" = NOW()
FROM "UserStory" s
WHERE ac."userStoryId" = s.id
  AND s."designSessionId" = v_session_id
  AND s.reference = 'ZLAR-V2-US-024'
  AND ac."order" = 2;

RAISE NOTICE 'Reescritas MEDIO aplicadas: US-002 #7, US-003 #3, US-006 #13, US-019 #8, US-024 #2';

END $audit$;

COMMIT;
