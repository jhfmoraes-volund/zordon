-- =============================================================================
-- DS Inception Zelar v2 — Modulo NOTIFICACAO
-- =============================================================================
-- Refatora US-022 + cria US-024 (setup plataforma) + US-025 (chat interno).
--
-- Antes: US-022 misturava setup + disparo + chat. Sem dono claro pra:
--   - dominio + DKIM/DMARC dia 1 (sem isso, e-mail cai em spam)
--   - submissao templates Meta (5-10 dias uteis bloqueante por template)
--   - notification_log e pg_cron jobs (transversais)
--   - chat cliente<->prestador (canal bidirecional, nao "notificacao")
--
-- Depois:
--   ZLAR-V2-US-022 (refatorada) — disparo de eventos consumindo o setup.
--   ZLAR-V2-US-024 (nova)      — setup de plataforma de comunicacao.
--   ZLAR-V2-US-025 (nova)      — chat interno cliente<->prestador.
--
-- Brainstorm SSOT:
--   uso32zp     — E-mails Resend (setup SPF/DKIM/DMARC + eventos)
--   f7baeb66    — Catalogo templates WA (submissao Meta + notification_log)
--   62cd8d91    — Status servico WA (pg_cron lembretes + cancel jobs)
--   c63xmyk     — Template novo servico agendado (fire-and-forget)
--   hwd91de     — Mensageria prestador (Realtime, moderacao, push)
--   jha59vh     — Mensageria cliente (chat unlocked apos pagamento)
-- =============================================================================

BEGIN;

DO $notif$
DECLARE
  v_session_id   uuid := '264e6d07-d365-43ba-8029-d539ce6f7c6b';
  v_project_id   uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_persona_sis  uuid := '085f0246-a5d1-4b23-9f09-025b5e37177b'; -- SISTEMA
  v_persona_cli  uuid := '4ff1ab67-9c32-4024-80e7-d22bcdac063f'; -- CLIENTE
  v_module_comu  uuid := '0800c55a-b699-43eb-98bf-d71d93ddcded'; -- COMUNICACAO_NOTIFICACOES
  v_module_exec  uuid := 'f5f3fd70-0ff2-4039-a11e-8302a10c7766'; -- EXECUCAO_DO_SERVICO
  v_count        int;
  v_us022_id     uuid;
  v_us024_id     uuid;
  v_us025_id     uuid;
BEGIN

-- =============================================================================
-- 1. Atualiza US-022: refatora titulo/want/soThat + reseta refinementStatus
-- =============================================================================
UPDATE "UserStory"
SET
  title              = 'Disparar notificações nos momentos certos da jornada',
  want               = 'enviar mensagens automaticas (e-mail, mensageria externa, push) consumindo a plataforma de comunicacao quando eventos do sistema acontecem',
  "soThat"           = 'usuarios sejam alcancados de forma confiavel sem fricção e a operacao nao dependa de envio manual',
  "proposedModuleName" = 'NOTIFICACAO',
  "moduleId"         = v_module_comu,
  "refinementStatus" = 'draft',
  "updatedAt"        = NOW()
WHERE "designSessionId" = v_session_id
  AND reference = 'ZLAR-V2-US-022'
RETURNING id INTO v_us022_id;

RAISE NOTICE 'US-022 refatorada: %', v_us022_id;

-- Limpa AC antigos da US-022 (vamos regerar com escopo correto)
DELETE FROM "AcceptanceCriterion" WHERE "userStoryId" = v_us022_id;
GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'AC antigos da US-022 removidos: % rows', v_count;

-- =============================================================================
-- 2. Cria US-024: Setup de plataforma de comunicacao
-- =============================================================================
INSERT INTO "UserStory" (
  id, "projectId", "moduleId", "proposedModuleName", reference, title,
  "personaId", want, "soThat", "refinementStatus", "designSessionId",
  "designSessionItemId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(), v_project_id, v_module_comu, 'NOTIFICACAO',
  'ZLAR-V2-US-024',
  'Configurar plataforma de comunicacao (e-mail, mensageria externa, jobs)',
  v_persona_sis,
  'preparar dominio, templates pre-aprovados, registro de envios e jobs agendados antes do go-live',
  'qualquer evento do sistema possa disparar comunicacao com confiabilidade desde o dia 1',
  'draft', v_session_id, NULL, true, NOW(), NOW()
)
ON CONFLICT DO NOTHING
RETURNING id INTO v_us024_id;

IF v_us024_id IS NULL THEN
  SELECT id INTO v_us024_id FROM "UserStory"
  WHERE "designSessionId" = v_session_id AND reference = 'ZLAR-V2-US-024';
END IF;

RAISE NOTICE 'US-024 criada: %', v_us024_id;

-- =============================================================================
-- 3. Cria US-025: Chat interno cliente<->prestador
-- =============================================================================
INSERT INTO "UserStory" (
  id, "projectId", "moduleId", "proposedModuleName", reference, title,
  "personaId", want, "soThat", "refinementStatus", "designSessionId",
  "designSessionItemId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(), v_project_id, v_module_exec, 'NOTIFICACAO',
  'ZLAR-V2-US-025',
  'Trocar mensagens com a outra parte via chat interno durante o servico',
  v_persona_cli,
  'enviar e receber mensagens em tempo real com a outra parte do servico, com moderação pre-pagamento e historico preservado',
  'a comunicacao logistica fique dentro da plataforma sem combinacoes fora do escrow',
  'draft', v_session_id, NULL, true, NOW(), NOW()
)
ON CONFLICT DO NOTHING
RETURNING id INTO v_us025_id;

IF v_us025_id IS NULL THEN
  SELECT id INTO v_us025_id FROM "UserStory"
  WHERE "designSessionId" = v_session_id AND reference = 'ZLAR-V2-US-025';
END IF;

RAISE NOTICE 'US-025 criada: %', v_us025_id;

-- =============================================================================
-- 4. Buffer de AC + insert
-- =============================================================================
CREATE TEMP TABLE _ac_buf (
  story_ref text,
  ord       int,
  text      text
) ON COMMIT DROP;

-- ----------------------------------------------------------------------------
-- US-022 (refatorada) — Disparar notificacoes consumindo plataforma
-- Brainstorm: c63xmyk (servico agendado), 62cd8d91 (status servico),
--             uso32zp (eventos transacionais e-mail)
-- ----------------------------------------------------------------------------
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-022', 1,  'SISTEMA dispara notificacao de cadastro confirmado (e-mail) e resultado de KYC (mensagem externa + e-mail) automaticamente quando os eventos acontecem.'),
('ZLAR-V2-US-022', 2,  'SISTEMA dispara notificacao para o PRESTADOR confirmando o servico aceito (mensagem externa) com resumo de data, categoria e bairro, sem que o aceite dependa do sucesso da notificacao.'),
('ZLAR-V2-US-022', 3,  'SISTEMA dispara lembrete de servico 24h antes da data agendada e novamente cerca de 2 horas antes, evitando duplicacao em servicos com remarcacao.'),
('ZLAR-V2-US-022', 4,  'SISTEMA dispara notificacao de mudanca de etapa do servico (a caminho, chegou, iniciado, concluido) para CLIENTE e PRESTADOR no momento em que o evento ocorre.'),
('ZLAR-V2-US-022', 5,  'SISTEMA dispara recibo de pagamento por e-mail apos a captura, e confirmacao de conclusao com nota fiscal apos o servico ser finalizado.'),
('ZLAR-V2-US-022', 6,  'SISTEMA dispara notificacao de liberacao de pagamento ao PRESTADOR e alerta de disputa quando aplicavel, em canal apropriado a urgencia do evento.'),
('ZLAR-V2-US-022', 7,  'SISTEMA dispara notificacao de suspensao de conta e respostas de contestacao de suspensao para o PRESTADOR.'),
('ZLAR-V2-US-022', 8,  'SISTEMA cancela lembretes pendentes automaticamente quando um servico e cancelado, evitando envio de lembrete de servico que nao acontecera mais.'),
('ZLAR-V2-US-022', 9,  'SISTEMA tenta canal alternativo automaticamente quando o canal primario falha (ex: numero invalido cai pra push, push indisponivel cai pra e-mail) sem impacto no fluxo do servico.'),
('ZLAR-V2-US-022', 10, 'SISTEMA respeita preferencia de opt-out do usuario para notificacoes operacionais; notificacoes obrigatorias (resultado KYC, recibo, alerta de disputa, liberacao de pagamento, suspensao) sempre sao enviadas.'),
('ZLAR-V2-US-022', 11, 'SISTEMA garante idempotencia: o mesmo evento nao gera disparos duplicados em retries internos.');

-- ----------------------------------------------------------------------------
-- US-024 (nova) — Setup de plataforma de comunicacao
-- Brainstorm: uso32zp (SPF/DKIM/DMARC + email_logs + Database Webhooks),
--             f7baeb66 (catalogo templates Meta + notification_log + retry),
--             62cd8d91 (pg_cron infra + cron.unschedule)
-- ----------------------------------------------------------------------------
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-024', 1,  'SISTEMA tem o dominio de envio de e-mails configurado com autenticacao completa (SPF, DKIM e DMARC) antes do dia 1, garantindo que e-mails nao caiam em caixa de spam na primeira transacao.'),
('ZLAR-V2-US-024', 2,  'SISTEMA tem todos os templates de mensageria externa pre-aprovados pela plataforma de mensageria, com placeholders documentados no formato padrao do provedor, antes do go-live.'),
('ZLAR-V2-US-024', 3,  'SISTEMA tem registro de todos os envios (canal, destinatario, template, status, identificador externo, timestamps de envio e entrega, motivo da falha) para investigacao e auditoria.'),
('ZLAR-V2-US-024', 4,  'SISTEMA tem mecanismo de retry com backoff em caso de falha transitoria (2 tentativas com intervalo entre elas), e fallback para canal alternativo apos esgotar tentativas.'),
('ZLAR-V2-US-024', 5,  'SISTEMA tem mecanismo de agendamento de jobs temporais que permite disparar notificacoes em momento futuro (ex: lembrete 24h antes), com janela de tolerancia para evitar disparos duplicados.'),
('ZLAR-V2-US-024', 6,  'SISTEMA permite cancelar jobs pendentes associados a um recurso (ex: ao cancelar um servico, todos os lembretes futuros desse servico sao removidos da fila).'),
('ZLAR-V2-US-024', 7,  'SISTEMA tem componentes reutilizaveis de e-mail (cabecalho, rodape, botao, resumo de servico, breakdown financeiro) com fallback em texto simples para clientes sem suporte a HTML.'),
('ZLAR-V2-US-024', 8,  'SISTEMA inclui link de descadastramento em todos os e-mails operacionais; e-mails transacionais obrigatorios (resultado de KYC, recibo, alerta de disputa, liberacao de pagamento) nao oferecem opt-out.'),
('ZLAR-V2-US-024', 9,  'SISTEMA tem trigger por evento do banco (escrita conclui = notificacao dispara) sem polling, garantindo latencia baixa entre evento e envio.'),
('ZLAR-V2-US-024', 10, 'SISTEMA tem trilha de monitoria que permite ao ADMIN consultar taxa de entrega, falhas e bounces por canal e periodo, identificando incidentes de entregabilidade.');

-- ----------------------------------------------------------------------------
-- US-025 (nova) — Chat interno cliente<->prestador
-- Brainstorm: hwd91de (mensageria prestador), jha59vh (mensageria cliente)
-- ----------------------------------------------------------------------------
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-025', 1,  'CLIENTE e PRESTADOR de um servico vinculado tem acesso a um chat interno proprio do contrato, isolado de qualquer outro contrato ou conversa.'),
('ZLAR-V2-US-025', 2,  'CLIENTE so consegue iniciar mensagens apos a confirmacao do pagamento; antes disso, o input fica desabilitado com mensagem explicando que o canal abre apos pagamento.'),
('ZLAR-V2-US-025', 3,  'SISTEMA aplica moderacao automatica em mensagens trocadas antes da captura do pagamento, bloqueando conteudo que vaza contato direto (telefone, e-mail, CPF, links externos) e registrando o bloqueio.'),
('ZLAR-V2-US-025', 4,  'SISTEMA desativa a moderacao automaticamente apos a captura do pagamento, liberando troca de PII necessaria para execucao do servico (endereco, contato direto).'),
('ZLAR-V2-US-025', 5,  'CLIENTE e PRESTADOR vêm mensagens novas em tempo real enquanto estiverem com o app aberto; quando offline, recebem notificacao por canal externo apos um curto intervalo sem leitura.'),
('ZLAR-V2-US-025', 6,  'CLIENTE e PRESTADOR vêm o estado da mensagem (enviando, entregue, lida, bloqueada) ao lado de cada balao.'),
('ZLAR-V2-US-025', 7,  'CLIENTE e PRESTADOR podem enviar mensagens enquanto offline; ao reconectar, as mensagens pendentes sao enviadas automaticamente sem duplicacao.'),
('ZLAR-V2-US-025', 8,  'CLIENTE e PRESTADOR continuam vendo o historico de mensagens apos a conclusao do servico, mas nao conseguem enviar novas mensagens (chat congela em modo somente leitura).'),
('ZLAR-V2-US-025', 9,  'CLIENTE e PRESTADOR nao acessam conversas de outros contratos, mesmo sabendo o identificador, garantido pela permissao de acesso por ator do contrato.'),
('ZLAR-V2-US-025', 10, 'CLIENTE e PRESTADOR podem reportar mensagem abusiva ao suporte, anexando a mensagem ao ticket.');

-- =============================================================================
-- 5. Aplica AC do buffer
-- =============================================================================
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
RAISE NOTICE 'AC inseridos: % rows (US-022 refatorada + US-024 + US-025)', v_count;

-- =============================================================================
-- 6. Marca as 3 stories como refined
-- =============================================================================
UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN ('ZLAR-V2-US-022','ZLAR-V2-US-024','ZLAR-V2-US-025');

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $notif$;

COMMIT;
