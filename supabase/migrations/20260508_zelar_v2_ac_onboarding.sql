-- =============================================================================
-- AC produto — Modulo ONBOARDING (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-001  Cadastrar-se e ser aprovado como prestador          (PRESTADOR)
--   ZLAR-V2-US-002  Login prestador roteado conforme situacao da conta  (PRESTADOR)
--   ZLAR-V2-US-003  Pre-requisitos para entrar no pool de matching      (PRESTADOR)
--   ZLAR-V2-US-008  Suspensao + caminho de reativacao/contestacao       (PRESTADOR)
--   ZLAR-V2-US-009  Cadastro/perfil/login do cliente                    (CLIENTE)
--   ZLAR-V2-US-022  Sistema multicanal de notificacoes                  (SISTEMA)
--
-- Princípios:
--   - AC descreve comportamento observavel pela persona; sem tabela/coluna/endpoint.
--   - Sem detalhe de stack (KYC, WhatsApp, e-mail descritos em alto nivel).
--   - Cobre golden path + bordas criticas + estados de erro relevantes.
--   - Idempotente por (userStoryId, order).
-- =============================================================================

BEGIN;

DO $ac$
DECLARE
  v_session_id uuid := '264e6d07-d365-43ba-8029-d539ce6f7c6b';
  v_story_id   uuid;
  v_count      int;
BEGIN

-- Helper: limpa AC existentes da story antes de inserir os novos (idempotencia simples)
-- e re-insere. Garantimos que reference do criterio nao colide com tasks (refs separadas).
CREATE TEMP TABLE IF NOT EXISTS _ac_buf (
  story_ref text,
  ord       int,
  text      text
) ON COMMIT DROP;

-- =============================================================================
-- US-001: Cadastrar-se e ser aprovado como prestador
-- Brainstorm: cy0v5ix (dados pessoais), iy2o0hb (KYC Unico), 4pnydyy (aguardando)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-001', 1,  'PRESTADOR escolhe "Sou prestador" na tela de splash inicial e e levado ao formulario de cadastro.'),
('ZLAR-V2-US-001', 2,  'PRESTADOR cria conta informando e-mail e senha, ou usa entrada via Google, e recebe confirmacao de e-mail antes de prosseguir.'),
('ZLAR-V2-US-001', 3,  'PRESTADOR preenche dados pessoais em etapas guiadas (nome completo, CPF, telefone, e-mail) com validacao por campo e mensagem clara em caso de formato invalido.'),
('ZLAR-V2-US-001', 4,  'PRESTADOR seleciona uma ou mais categorias de servico em que atua a partir do catalogo apresentado pela plataforma.'),
('ZLAR-V2-US-001', 5,  'PRESTADOR vê o progresso preservado se sair e voltar — cada etapa ja preenchida nao precisa ser refeita; pode retomar do ponto onde parou.'),
('ZLAR-V2-US-001', 6,  'PRESTADOR e direcionado para a etapa de verificacao de identidade (envio de documento frente/verso e selfie) em fluxo guiado dentro do app.'),
('ZLAR-V2-US-001', 7,  'PRESTADOR vê o resultado da verificacao em segundos no caso automatico; em caso de revisao manual, cai em tela de "em analise" sem bloqueio.'),
('ZLAR-V2-US-001', 8,  'PRESTADOR pode reenviar a verificacao de identidade ate 2 vezes em caso de falha; na terceira falha, conta e bloqueada definitivamente com mensagem clara do motivo.'),
('ZLAR-V2-US-001', 9,  'PRESTADOR aprovado recebe notificacao no canal de mensagens e e direcionado ao app para iniciar os primeiros passos pos-aprovacao.'),
('ZLAR-V2-US-001', 10, 'PRESTADOR reprovado recebe motivo em linguagem clara e orientacao sobre proximo caminho (reenviar, contestar ou aguardar prazo).'),
('ZLAR-V2-US-001', 11, 'PRESTADOR aceita os termos de uso e politica de privacidade antes de finalizar o cadastro, com registro do consentimento.');

-- =============================================================================
-- US-002: Login prestador roteado conforme situacao da conta
-- Brainstorm: 0ca5caf9 (login prestador) — checa KYC e roteia
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-002', 1, 'PRESTADOR acessa a tela de login e autentica via e-mail/senha ou via Google; recuperacao de senha disponivel.'),
('ZLAR-V2-US-002', 2, 'PRESTADOR com cadastro incompleto (sem KYC enviado) cai na continuacao do cadastro, na etapa onde parou.'),
('ZLAR-V2-US-002', 3, 'PRESTADOR com verificacao de identidade em analise cai na tela de "em analise" e nao acessa a home operacional.'),
('ZLAR-V2-US-002', 4, 'PRESTADOR com verificacao reprovada vê tela explicativa com motivo e opcao de reenvio (se ainda houver tentativas) ou bloqueio definitivo.'),
('ZLAR-V2-US-002', 5, 'PRESTADOR aprovado mas com pre-requisitos pendentes (disponibilidade ou conta bancaria) cai no checklist de primeiros passos.'),
('ZLAR-V2-US-002', 6, 'PRESTADOR aprovado e com pre-requisitos completos cai diretamente na home operacional do prestador.'),
('ZLAR-V2-US-002', 7, 'PRESTADOR suspenso e direcionado a tela de suspensao com motivo e caminho de contestacao/reativacao, mesmo que tente acessar outras rotas.'),
('ZLAR-V2-US-002', 8, 'PRESTADOR vê mensagem clara de credenciais invalidas em caso de e-mail/senha errados, sem expor se o e-mail existe ou nao.'),
('ZLAR-V2-US-002', 9, 'PRESTADOR mantem sessao ativa entre acessos no mesmo dispositivo, e pode encerrar sessao manualmente pelo perfil.');

-- =============================================================================
-- US-003: Pre-requisitos para entrar no pool de matching
-- Brainstorm: 79f24380 (primeiros passos), 5852c16e (conta bancaria)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-003', 1, 'PRESTADOR vê checklist de "primeiros passos" exibido uma unica vez na primeira visita a home pos-aprovacao, com 2 itens obrigatorios: disponibilidade e conta bancaria.'),
('ZLAR-V2-US-003', 2, 'PRESTADOR pode minimizar o checklist mas vê banner persistente na home enquanto algum item estiver pendente.'),
('ZLAR-V2-US-003', 3, 'PRESTADOR configura disponibilidade semanal indicando dias da semana e janelas de horario em que aceita servicos.'),
('ZLAR-V2-US-003', 4, 'PRESTADOR pode editar disponibilidade a qualquer momento; alteracoes passam a valer imediatamente para novas propostas.'),
('ZLAR-V2-US-003', 5, 'PRESTADOR cadastra conta bancaria informando banco, agencia, conta e titularidade (proprio ou terceiros com CPF do titular).'),
('ZLAR-V2-US-003', 6, 'PRESTADOR vê a conta marcada como "verificada" automaticamente quando a validacao via parceiro de pagamentos confirma os dados.'),
('ZLAR-V2-US-003', 7, 'PRESTADOR com falha de validacao bancaria vê motivo (dados nao conferem, conta inativa, etc) e pode corrigir e reenviar.'),
('ZLAR-V2-US-003', 8, 'SISTEMA so inclui o PRESTADOR no pool de matching quando ambos pre-requisitos estao completos (disponibilidade configurada E conta bancaria verificada).'),
('ZLAR-V2-US-003', 9, 'PRESTADOR vê confirmacao explicita "voce ja pode receber servicos" ao concluir os pre-requisitos.');

-- =============================================================================
-- US-008: Suspensao + caminho de reativacao/contestacao
-- Brainstorm: 6db0ebaf (Reativacao) — 5 origens com caminhos diferentes
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-008', 1, 'PRESTADOR suspenso vê tela dedicada ao acessar o app, identificando claramente o motivo entre as 5 categorias possiveis (no-show, manual, geolocalizacao, KYC, penalidade).'),
('ZLAR-V2-US-008', 2, 'PRESTADOR suspenso por 3 no-shows consecutivos vê o registro dos eventos e instrucao para abrir contestacao (cobranca pode ter sido injusta) ou aguardar prazo de reativacao.'),
('ZLAR-V2-US-008', 3, 'PRESTADOR suspenso manualmente por administrador vê motivo escrito pelo admin e canal de contato com suporte.'),
('ZLAR-V2-US-008', 4, 'PRESTADOR suspenso por revogacao de consentimento de geolocalizacao vê instrucao para reativar a permissao no dispositivo; ao reativar, a suspensao e removida automaticamente.'),
('ZLAR-V2-US-008', 5, 'PRESTADOR com bloqueio definitivo por 2 reprovacoes de KYC vê tela final sem opcao de reenvio, com explicacao do motivo e canal de suporte para casos excepcionais.'),
('ZLAR-V2-US-008', 6, 'PRESTADOR suspenso por penalidade gradativa (cancelamentos/no-shows acumulados) vê o saldo de penalidades e a previsao de reabilitacao automatica apos prazo determinado.'),
('ZLAR-V2-US-008', 7, 'PRESTADOR pode submeter contestacao com texto livre e anexos; recebe protocolo e prazo de resposta da operacao.'),
('ZLAR-V2-US-008', 8, 'PRESTADOR e notificado por canal externo (mensagens) quando a contestacao e respondida ou a reativacao e concluida.'),
('ZLAR-V2-US-008', 9, 'PRESTADOR suspenso nao consegue acessar nenhuma rota operacional (propostas, agenda, perfil edicao) — todas as tentativas redirecionam para a tela de suspensao.');

-- =============================================================================
-- US-009: Cadastro/perfil/login do cliente
-- Brainstorm: 4fe1fa4d (signup), fb8a94a7 (perfil+endereco+LGPD), 9lscori (login), ba5ba311 (1a experiencia)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-009', 1,  'CLIENTE escolhe "Sou cliente" no splash inicial e e levado a tela de cadastro.'),
('ZLAR-V2-US-009', 2,  'CLIENTE cria conta via e-mail e senha, magic link, ou Google; cada caminho exige confirmacao adequada (e-mail confirmado, link clicado ou OAuth concluido).'),
('ZLAR-V2-US-009', 3,  'CLIENTE preenche perfil basico (nome, telefone) e endereco principal usando autocomplete; o endereco fica salvo para preenchimento automatico em solicitacoes futuras.'),
('ZLAR-V2-US-009', 4,  'CLIENTE concede consentimentos LGPD granulares (uso de dados, comunicacao, geolocalizacao) com registro de versao dos termos e momento do aceite.'),
('ZLAR-V2-US-009', 5,  'CLIENTE acessa a tela de login pelo mesmo splash e autentica via e-mail/senha, magic link ou Google; recuperacao de senha e reenvio de magic link disponiveis.'),
('ZLAR-V2-US-009', 6,  'CLIENTE com cadastro incompleto (perfil ou endereco) cai na continuacao do cadastro apos login.'),
('ZLAR-V2-US-009', 7,  'CLIENTE com cadastro completo cai na home do cliente apos login.'),
('ZLAR-V2-US-009', 8,  'CLIENTE em primeira visita a home vê tour guiado nao bloqueante apresentando o catalogo e o fluxo de pedido; pode pular a qualquer momento e retomar pelo perfil.'),
('ZLAR-V2-US-009', 9,  'CLIENTE vê mensagem clara em caso de credenciais invalidas, sem expor existencia da conta, e pode bloquear apos varias tentativas com captcha.'),
('ZLAR-V2-US-009', 10, 'CLIENTE pode encerrar sessao manualmente pelo menu do perfil.');

-- =============================================================================
-- US-022: Sistema multicanal de notificacoes
-- Brainstorm: uso32zp (e-mails Resend), c63xmyk (template servico agendado),
--             62cd8d91 (status servico WA), f7baeb66 (catalogo templates),
--             hwd91de (mensageria prestador), jha59vh (mensageria cliente)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-022', 1,  'SISTEMA dispara mensagens em momentos criticos da jornada (cadastro, KYC, agendamento, lembretes, conclusao, financeiro, suspensao) via canais apropriados (mensagens externas, e-mail e push).'),
('ZLAR-V2-US-022', 2,  'SISTEMA usa apenas templates pre-aprovados pela plataforma de mensageria externa, com placeholders preenchidos a partir do contexto do evento.'),
('ZLAR-V2-US-022', 3,  'SISTEMA garante que cada evento dispara uma unica notificacao por canal (idempotencia), mesmo em caso de retry interno.'),
('ZLAR-V2-US-022', 4,  'SISTEMA aplica fallback automatico de canal: se canal primario falha (numero invalido, opt-out, falha de entrega), tenta canal secundario apropriado para o evento.'),
('ZLAR-V2-US-022', 5,  'SISTEMA registra resultado de entrega de cada notificacao (entregue, lida, falhou) para auditoria e investigacao de incidentes.'),
('ZLAR-V2-US-022', 6,  'SISTEMA respeita opt-out do usuario: comunicacao transacional critica (verificacao, recibo, suspensao) sempre passa; comunicacao operacional respeita a preferencia.'),
('ZLAR-V2-US-022', 7,  'SISTEMA garante entregabilidade de e-mail desde o dia 1 (configuracao de autenticacao de dominio) — dominio novo nao cai em spam na primeira transacao.'),
('ZLAR-V2-US-022', 8,  'SISTEMA libera o chat interno entre cliente e prestador apenas apos confirmacao do pagamento, evitando combinacoes fora da plataforma antes do escrow.'),
('ZLAR-V2-US-022', 9,  'SISTEMA notifica o destinatario via canal externo quando ha nova mensagem e ele esta com app fechado.'),
('ZLAR-V2-US-022', 10, 'SISTEMA aplica moderacao de conteudo automatizada na fase pre-pagamento (quando ainda permitida) e desativa-a apos a captura do pagamento.');

-- =============================================================================
-- Aplicar AC do buffer no banco
-- =============================================================================

-- Limpa AC existentes das stories alvo (idempotencia)
DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference IN ('ZLAR-V2-US-001','ZLAR-V2-US-002','ZLAR-V2-US-003','ZLAR-V2-US-008','ZLAR-V2-US-009','ZLAR-V2-US-022')
);

-- Insere AC do buffer
INSERT INTO "AcceptanceCriterion" (id, "userStoryId", "order", text, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  s.id,
  b.ord,
  b.text,
  NOW(),
  NOW()
FROM _ac_buf b
JOIN "UserStory" s
  ON s."designSessionId" = v_session_id
 AND s.reference = b.story_ref;

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'AC inseridos: % rows (modulo ONBOARDING)', v_count;

-- Marca refinementStatus das 6 stories como 'refined' (AC produto definidos)
UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN ('ZLAR-V2-US-001','ZLAR-V2-US-002','ZLAR-V2-US-003','ZLAR-V2-US-008','ZLAR-V2-US-009','ZLAR-V2-US-022');

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas ready: % rows', v_count;

END $ac$;

COMMIT;
