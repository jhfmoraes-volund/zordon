-- =============================================================================
-- AC produto — Modulo ADMIN (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-016  Operar dashboard com KPIs e relatorios da plataforma            (ADMIN)
--   ZLAR-V2-US-017  Gerenciar prestadores: aprovar KYC manual, moderar e suspender  (ADMIN)
--   ZLAR-V2-US-019  Configurar feature flags, templates e parametros operacionais   (ADMIN)
--   ZLAR-V2-US-023  Matriz de permissoes (RLS) e ciclo de vida do servico           (SISTEMA)
--
-- Brainstorm SSOT:
--   US-016: 8295c317 (Dashboard Operacional) + bf6f2753 (Demanda vs Supply) +
--           2152d237 (Relatorios e Exportacao)
--   US-017: da89a058 (Gestao de Prestadores) + iy2o0hb (KYC via Unico)
--   US-019: parametros referenciados ao longo dos cards (matching_weights, broadcast_pool_size,
--           pricing_categories, supply gate minimo, kyc thresholds, anti-bypass weights,
--           templates WA pre-aprovados Meta vindos da US-024 NOTIFICACAO)
--   US-023: 900260ce (Matriz Permissoes RLS) + 249b85e2 (Ciclo de Vida do Servico)
-- =============================================================================

BEGIN;

DO $ac$
DECLARE
  v_session_id uuid := '264e6d07-d365-43ba-8029-d539ce6f7c6b';
  v_count      int;
BEGIN

CREATE TEMP TABLE _ac_buf (
  story_ref text,
  ord       int,
  text      text
) ON COMMIT DROP;

-- =============================================================================
-- US-016 — Operar dashboard com KPIs e relatorios da plataforma (ADMIN)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-016',  1, 'ADMIN ao abrir o painel ve dashboard centralizado em tempo real com servicos ativos, supply por categoria, alertas operacionais pendentes e saude financeira da plataforma; e a primeira tela apos o login.'),
('ZLAR-V2-US-016',  2, 'ADMIN ve no bloco de supply cada categoria com numero de prestadores disponiveis no momento, com badge de alerta visual quando alguma categoria fica abaixo do minimo operacional configurado.'),
('ZLAR-V2-US-016',  3, 'ADMIN recebe alerta push (mesmo com app fechado) quando uma categoria fica com supply zerado em horario de pico, com contexto suficiente para decisao rapida.'),
('ZLAR-V2-US-016',  4, 'ADMIN ve fila de alertas pendentes priorizada automaticamente: servicos em alocacao manual com cliente aguardando primeiro, depois disputas com SLA proximo do vencimento, depois demais; sem necessidade de triagem manual.'),
('ZLAR-V2-US-016',  5, 'ADMIN aciona alocacao manual diretamente do dashboard quando um servico nao encontrou prestador no pool, com lista de elegiveis filtrada e botao de alocar; o cliente recebe notificacao do prestador escolhido.'),
('ZLAR-V2-US-016',  6, 'ADMIN gerencia gate de abertura de cada categoria para clientes finais (referencia: minimo de 5 prestadores aprovados); categoria abaixo do minimo aparece como "Em breve" no app do cliente sem fluxo de solicitacao.'),
('ZLAR-V2-US-016',  7, 'ADMIN ve fila prioritaria quando ha demanda mas sem supply imediato; clientes na fila sao alocados por ordem de entrada assim que prestador disponivel entra no pool, com notificacao automatica.'),
('ZLAR-V2-US-016',  8, 'ADMIN acessa relatorios consolidados por periodo (dia/semana/mes/intervalo customizado) em 5 categorias: servicos (taxa de conclusao, tempo medio de matching, cancelamentos por motivo), financeiro (valor bruto, comissao retida, repasses, ticket medio), supply e matching (disponibilidade, taxa de aceite, distribuicao de jobs), qualidade (NPS, rating, taxa de retrabalho), prestadores (cadastros, KYC, distribuicao por nivel).'),
('ZLAR-V2-US-016',  9, 'ADMIN exporta qualquer relatorio em CSV; relatorios pequenos baixam direto, e relatorios grandes (ex: 6 meses) sao gerados de forma assincrona com notificacao quando prontos, sem travar a UI.'),
('ZLAR-V2-US-016', 10, 'ADMIN ve relatorio financeiro com nota explicita informando que valores sao baseados em registros internos e que conciliacao definitiva deve ser feita no painel do gateway de pagamento.'),
('ZLAR-V2-US-016', 11, 'ADMIN ve em qualquer relatorio estado vazio tratado quando nao ha dados no periodo, com formatacao consistente e sem mensagem de erro; relatorios lentos exibem skeleton e mensagem orientando a tentar periodo menor.'),
('ZLAR-V2-US-016', 12, 'ADMIN com dashboard aberto por longo periodo continua vendo metricas criticas (alertas, alocacoes manuais) atualizadas em tempo real; metricas financeiras revalidam a cada 5 minutos.');

-- =============================================================================
-- US-017 — Gerenciar prestadores: aprovar KYC manual, moderar e suspender (ADMIN)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-017',  1, 'ADMIN acessa listagem de prestadores com filtros por status (em analise, ativo, suspenso, bloqueado), nivel, categoria e periodo de cadastro; busca por nome ou CPF disponivel.'),
('ZLAR-V2-US-017',  2, 'ADMIN ve perfil completo do prestador em abas: identidade (KYC + documentos), dados pessoais e bancarios, categorias certificadas, historico de servicos, ocorrencias, score, avaliacoes recebidas e ferramentas de moderacao.'),
('ZLAR-V2-US-017',  3, 'ADMIN visualiza fila de KYC com revisao manual apenas para casos com score intermediario do parceiro de verificacao (auto-aprovacao acima do threshold alto, auto-reprovacao abaixo do threshold baixo, manual entre os dois); thresholds sao configuraveis pela operacao.'),
('ZLAR-V2-US-017',  4, 'ADMIN aprova KYC manual com motivo opcional; o prestador e ativado, recebe notificacao externa e o evento e logado para auditoria.'),
('ZLAR-V2-US-017',  5, 'ADMIN reprova KYC manual com motivo obrigatorio (lista pre-definida + texto livre); o contador de tentativas e incrementado e o prestador e notificado; ao atingir 2 reprovacoes, a conta e bloqueada definitivamente sem opcao de reenvio no app.'),
('ZLAR-V2-US-017',  6, 'ADMIN suspende prestador com motivo obrigatorio (ex: "3 cancelamentos em 7 dias"); o prestador e removido do pool imediatamente e recebe notificacao com motivo e orientacao de contato.'),
('ZLAR-V2-US-017',  7, 'ADMIN ao tentar suspender prestador com servico em andamento ve aviso explicito da consequencia para o cliente; pode confirmar mesmo assim (urgencia) com criacao de alerta para acompanhamento manual do servico ativo, ou aguardar conclusao.'),
('ZLAR-V2-US-017',  8, 'ADMIN reativa prestador suspenso com motivo obrigatorio apos revisao de ocorrencias e justificativas; o prestador volta ao pool e e notificado da reativacao.'),
('ZLAR-V2-US-017',  9, 'ADMIN ao reativar prestador com disputa em aberto ve aviso explicito de que a reativacao nao encerra a disputa em curso; pode prosseguir sem interferir no fluxo da disputa.'),
('ZLAR-V2-US-017', 10, 'ADMIN com documentos KYC sinalizados como possivelmente expirados pelo parceiro de verificacao precisa fornecer justificativa explicita para aprovar; cada decisao e registrada com timestamp e identificador do admin.'),
('ZLAR-V2-US-017', 11, 'ADMIN ve trilha de auditoria completa por prestador com cada acao de moderacao (admin que executou, acao, motivo, timestamp), de forma imutavel; reativacoes sao individuais e intencionais, sem operacao em lote.');

-- =============================================================================
-- US-019 — Configurar feature flags, templates e parametros operacionais (ADMIN)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-019',  1, 'ADMIN acessa secao de configuracao operacional pelo painel admin com agrupamento logico (matching, pagamento, KYC, anti-bypass, supply, comunicacao); cada parametro tem nome, valor atual, descricao e historico de alteracoes.'),
('ZLAR-V2-US-019',  2, 'ADMIN ajusta os pesos do score de matching (qualidade, confianca, disponibilidade, frequencia, cobertura) sem necessidade de deploy; a alteracao passa a valer nas proximas alocacoes.'),
('ZLAR-V2-US-019',  3, 'ADMIN configura tamanho do top N do broadcast (referencia 5), prazo de aceite (referencia 15min), prazo de busca visivel ao cliente (referencia 10min) e raio maximo por categoria, com alteracoes auditadas.'),
('ZLAR-V2-US-019',  4, 'ADMIN configura faixas de preco por categoria (valor minimo, maximo, multiplicadores por complexidade) com cap teto que impede multiplicadores levarem o valor acima do limite documentado, mantendo previsibilidade.'),
('ZLAR-V2-US-019',  5, 'ADMIN ajusta threshold de auto-aprovacao e auto-reprovacao do KYC e o limite maximo de tentativas (referencia 2) sem deploy.'),
('ZLAR-V2-US-019',  6, 'ADMIN configura supply minimo por categoria (referencia 5 prestadores aprovados) que controla o gate de abertura para clientes; categoria abaixo do minimo aparece como "Em breve".'),
('ZLAR-V2-US-019',  7, 'ADMIN ajusta pesos dos sinais anti-bypass e os limiares dos 4 niveis de escalonamento (N1-N4) sem deploy, calibrando o sistema conforme dados reais do piloto.'),
('ZLAR-V2-US-019',  8, 'ADMIN gerencia templates de comunicacao externa (mensagens transacionais e e-mail) com identificacao de qual exige pre-aprovacao da plataforma de mensageria; consegue cadastrar novos templates pendentes de aprovacao e marcar como ativos apos validacao externa.'),
('ZLAR-V2-US-019',  9, 'ADMIN ativa/desativa feature flags individualmente (ex: pagamento Pix, fila prioritaria, retrabalho mediado, exportacao CSV pesada); flag desligada esconde o caminho da feature do app sem quebrar nada.'),
('ZLAR-V2-US-019', 10, 'ADMIN configura politica de cancelamento (janelas e percentuais 90/60/30/10/0 e taxa de visita por ausencia) sem deploy; mudancas valem para cancelamentos futuros e nao afetam casos ja resolvidos.'),
('ZLAR-V2-US-019', 11, 'ADMIN ve historico imutavel de cada alteracao de parametro (admin que fez, valor anterior, valor novo, timestamp, justificativa) e pode reverter para um valor anterior em um clique, gerando uma nova entrada no historico.'),
('ZLAR-V2-US-019', 12, 'ADMIN com alteracao de parametro critico (matching, pricing, KYC) ve confirmacao explicita com resumo do impacto antes de salvar, evitando mudancas acidentais em producao.');

-- =============================================================================
-- US-023 — Matriz de permissoes (RLS) e ciclo de vida do servico (SISTEMA)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-023',  1, 'SISTEMA aplica controle de acesso direto na camada de dados (sem depender do frontend), de modo que CLIENTE acessa apenas seus proprios servicos, perfil e historico; PRESTADOR acessa servicos em que e parte (passados e atuais) e propostas elegiveis pelo matching; ADMIN acessa todos os recursos da plataforma.'),
('ZLAR-V2-US-023',  2, 'SISTEMA permite que somente CLIENTE crie solicitacoes de servico; PRESTADOR e ADMIN nao podem criar solicitacoes em nome do cliente.'),
('ZLAR-V2-US-023',  3, 'SISTEMA permite que somente PRESTADOR ativo (KYC aprovado, sem suspensao) aceite uma proposta; CLIENTE e ADMIN nao podem aceitar pedidos.'),
('ZLAR-V2-US-023',  4, 'SISTEMA permite que PRESTADOR veja apenas as propostas elegiveis pela engine de matching para seu perfil (regiao + categorias + disponibilidade); nao consegue listar pedidos de outros pares cliente-prestador.'),
('ZLAR-V2-US-023',  5, 'SISTEMA permite que CLIENTE avalie apenas servicos concluidos em que e parte; PRESTADOR nao avalia outros prestadores; ADMIN nao avalia, apenas modera quando necessario.'),
('ZLAR-V2-US-023',  6, 'SISTEMA permite que cada usuario edite apenas o proprio perfil (cliente, prestador ou admin); ninguem edita perfil alheio exceto admin agindo via fluxo de moderacao explicita.'),
('ZLAR-V2-US-023',  7, 'SISTEMA permite que PRESTADOR veja apenas a propria carteira e historico de ganhos; CLIENTE nao tem acesso a carteiras; ADMIN ve todas as carteiras e dados financeiros agregados.'),
('ZLAR-V2-US-023',  8, 'SISTEMA permite que apenas ADMIN suspenda prestador, medeie disputas e aplique estornos; cliente e prestador participam apenas como partes interessadas.'),
('ZLAR-V2-US-023',  9, 'SISTEMA define a maquina de estados do servico com transicoes validas explicitas (ex: aceito → a-caminho → chegou → em-execucao → concluido) e bloqueia transicoes invalidas mesmo via manipulacao direta, retornando erro e registrando a tentativa em log de auditoria.'),
('ZLAR-V2-US-023', 10, 'SISTEMA mantem trilha imutavel de eventos (audit trail) de todo o ciclo de vida do servico (quem disparou, quando, payload do evento), preservada para conformidade e analise de disputas.'),
('ZLAR-V2-US-023', 11, 'SISTEMA agenda jobs automaticos vinculados ao ciclo de vida (aceite tacito, liberacao parcial 70% do escrow, liberacao final 30% apos garantia, expiracao da janela de garantia em 30 dias); cada job verifica o estado atual antes de executar e ignora silenciosamente se o servico esta cancelado ou em disputa.'),
('ZLAR-V2-US-023', 12, 'SISTEMA bloqueia abertura simultanea de dois estados paralelos sobre o mesmo servico (ex: reajuste pendente + material pendente), forcando resolucao sequencial e mensagem clara sobre a pendencia ativa.'),
('ZLAR-V2-US-023', 13, 'SISTEMA detecta servicos em "em-execucao" parados ha mais de 24h sem atualizacao e gera alerta para a equipe de operacao, sem aplicar transicao automatica; a operacao decide a intervencao caso a caso.'),
('ZLAR-V2-US-023', 14, 'SISTEMA garante que falhas operacionais (escrow nao agendado, notificacao nao entregue) nao prejudicam o usuario: registra a falha, faz retry com backoff, alerta a equipe se persistir e mantem o estado consistente para reagendamento manual.');

-- =============================================================================
-- Aplica AC do buffer
-- =============================================================================

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference IN ('ZLAR-V2-US-016','ZLAR-V2-US-017','ZLAR-V2-US-019','ZLAR-V2-US-023')
);

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
RAISE NOTICE 'AC inseridos: % rows (modulo ADMIN)', v_count;

UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN ('ZLAR-V2-US-016','ZLAR-V2-US-017','ZLAR-V2-US-019','ZLAR-V2-US-023');

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $ac$;

COMMIT;
