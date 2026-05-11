-- =============================================================================
-- AC produto — Modulo MATCHING (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-020  Engine de matching com pool broadcast e fairness          (SISTEMA)
--   ZLAR-V2-US-021  Engine anti-bypass: deteccao, score R(o,c) e penalidades  (SISTEMA)
--
-- Brainstorm SSOT:
--   US-020: a8677e90 (Motor Matching Pool Broadcast — score S* multivariado, hard filters,
--           top N broadcast, race no banco, timer 15min, search timeout 10min)
--   US-021: fa216993 (Anti-Bypass Deteccao — sinais S1/S4/S5/S6, score R(o,c), 4 modalidades) +
--           d098e09b (Anti-Bypass Escalonamento — niveis N1-N4, penalidades por ocorrencia)
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
-- US-020 — Engine de matching com pool broadcast e fairness (SISTEMA)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-020',  1, 'SISTEMA ao receber uma solicitacao calcula em tempo real os prestadores elegiveis aplicando filtros obrigatorios: status ativo (sem suspensao), disponibilidade ativada no momento, dia/horario dentro da janela configurada, categoria do servico certificada e distancia do endereco dentro do raio maximo.'),
('ZLAR-V2-US-020',  2, 'SISTEMA elimina do pool prestadores que ja tem servico ativo em status de "a caminho", "chegou" ou "em execucao", garantindo que ninguem receba duas alocacoes simultaneas.'),
('ZLAR-V2-US-020',  3, 'SISTEMA ranqueia os elegiveis por score multivariado composto por qualidade (avaliacoes com peso maior para reviews recentes), confianca (pontualidade, cancelamento, no-show e disputas perdidas nos ultimos 12 meses), disponibilidade (proporcao de tempo ativo nos ultimos 7 dias), frequencia (volume concluido com floor minimo para iniciantes) e cobertura (distancia/categoria).'),
('ZLAR-V2-US-020',  4, 'SISTEMA mantem os pesos do score configuraveis pela operacao sem necessidade de deploy, permitindo calibracao continua conforme dados reais.'),
('ZLAR-V2-US-020',  5, 'SISTEMA seleciona o top N (referencia inicial 5, configuravel) e transmite a proposta simultaneamente para todos os selecionados via canal em tempo real, sem priorizar quem aceita primeiro durante o broadcast.'),
('ZLAR-V2-US-020',  6, 'SISTEMA quando o pool elegivel tem menos prestadores que o N alvo envia a proposta a todos os elegiveis disponiveis sem aguardar para completar o N.'),
('ZLAR-V2-US-020',  7, 'SISTEMA quando nao ha nenhum prestador elegivel marca a solicitacao como "alocacao manual" imediatamente, alerta a equipe de operacao e notifica o cliente que a alocacao sera feita pela equipe.'),
('ZLAR-V2-US-020',  8, 'SISTEMA controla um prazo de aceite de 15 minutos para os prestadores do pool; passado o prazo sem aceite, todos os cards sao removidos e a solicitacao vai para alocacao manual.'),
('ZLAR-V2-US-020',  9, 'SISTEMA controla em paralelo um prazo maximo de busca visivel para o cliente (10 minutos) que, ao expirar sem aceite, encerra a busca naturalmente, devolve o controle ao cliente para tentar novamente quando quiser e nao gera alerta para a equipe (distinto da alocacao manual).'),
('ZLAR-V2-US-020', 10, 'SISTEMA resolve corrida pelo aceite no banco de dados de forma atomica, garantindo que apenas o primeiro aceite seja persistido e os demais recebam resposta imediata de servico ja alocado, mesmo se chegarem em milissegundos um do outro.'),
('ZLAR-V2-US-020', 11, 'SISTEMA emite evento de fechamento da proposta para os prestadores nao escolhidos assim que o aceite e confirmado, removendo o card de suas telas em tempo real.'),
('ZLAR-V2-US-020', 12, 'SISTEMA aplica nivel do prestador (Iniciante/Intermediario/Premium) apenas como modulador da comissao da plataforma, sem usa-lo como fator direto do ranqueamento, evitando barreira de entrada para novos prestadores.'),
('ZLAR-V2-US-020', 13, 'SISTEMA respeita imediatamente alteracoes na janela de disponibilidade ou no toggle "indisponivel hoje" do prestador, incluindo solicitacoes que ja estavam em fila quando a disponibilidade foi atualizada.'),
('ZLAR-V2-US-020', 14, 'SISTEMA registra cada ciclo de matching (pool elegivel, top N selecionado, aceite, recusas, timeouts) em log auditavel para a equipe de operacao revisar viesses, gargalos e ajustar pesos.');

-- =============================================================================
-- US-021 — Engine anti-bypass: deteccao, score de risco e escalonamento (SISTEMA)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-021',  1, 'SISTEMA monitora continuamente cada par cliente-prestador para detectar tentativas de transacao fora da plataforma, sem expor o monitoramento aos usuarios e sem afetar a experiencia normal de quem nao apresenta sinais.'),
('ZLAR-V2-US-021',  2, 'SISTEMA detecta o sinal de cancelamento recorrente: cliente cancelou apos aceite do mesmo prestador 2 ou mais vezes em 60 dias sem justificativa de reajuste ou escopo (padrao "selecionar e cancelar mesmo prestador" — sinal de maior peso isolado).'),
('ZLAR-V2-US-021',  3, 'SISTEMA detecta termos de contato externo em avaliacoes e mensagens de chat (palavras como "WhatsApp", "telefone", "direto", "numero", "instagram" e variacoes) via processamento de linguagem natural, bloqueando-os no chat em tempo real e sinalizando ocorrencias em avaliacoes.'),
('ZLAR-V2-US-021',  4, 'SISTEMA oferece botao "Reportar bypass" no detalhe do servico para qualquer parte denunciar proposta de servico fora da plataforma; denuncia confirmada e o sinal de maior peso e dispara revisao imediata pela equipe.'),
('ZLAR-V2-US-021',  5, 'SISTEMA detecta recontratacao do mesmo par no mesmo endereco em 30 dias como sinal neutro isolado (peso baixo); peso aumenta apenas quando combinado com cancelamento recorrente ou denuncia.'),
('ZLAR-V2-US-021',  6, 'SISTEMA calcula score de risco R(o,c) por par como soma ponderada dos sinais detectados na janela temporal de cada um; score expira naturalmente apos as janelas dos sinais (60 dias para cancelamento, 30 dias para fidelizacao) sem novos sinais.'),
('ZLAR-V2-US-021',  7, 'SISTEMA escalona em 4 niveis conforme o score: Nivel 1 (educacao preventiva — mensagens in-app separadas para cliente e prestador, sem revelar monitoramento, sem impacto em matching ou score), Nivel 2 (aviso formal + separacao do par no matching por 30 dias, comunicado como "diversidade de atendimento"), Nivel 3 (suspensao investigativa global do prestador por ate 72h com direito a defesa formal), Nivel 4 (penalidades definitivas apos investigacao).'),
('ZLAR-V2-US-021',  8, 'SISTEMA aplica Nivel 4 imediatamente sem esperar o score atingir o limiar quando ha denuncia direta confirmada pela equipe, dado o peso da evidencia.'),
('ZLAR-V2-US-021',  9, 'SISTEMA aplica penalidades graduais ao prestador por ocorrencia: 1a ocorrencia (advertencia formal + comissao da plataforma elevada por 90 dias + reducao temporaria de frequencia no score), 2a ocorrencia (suspensao 30 dias + comissao elevada por 6 meses), 3a ocorrencia (desativacao permanente + bloqueio do CPF para recadastro).'),
('ZLAR-V2-US-021', 10, 'SISTEMA aplica penalidades graduais ao cliente por ocorrencia: 1a (notificacao educativa + monitoramento intensificado por 60 dias), 2a (suspensao 15 dias + taxa de conveniencia adicional por 6 meses), 3a (desativacao permanente + bloqueio do CPF).'),
('ZLAR-V2-US-021', 11, 'SISTEMA durante suspensao investigativa permite ao prestador concluir servico ja em andamento, aplicando o bloqueio apenas a novos aceites; servicos agendados para o periodo da investigacao sao decididos manualmente pela equipe (realocacao ou manutencao com monitoramento).'),
('ZLAR-V2-US-021', 12, 'SISTEMA oferece ao prestador suspenso canal de contestacao formal para apresentar defesa em 72h; ausencia de defesa no prazo aplica Nivel 4 automaticamente com base nos sinais disponiveis, com direito a recurso via suporte apos o fato.'),
('ZLAR-V2-US-021', 13, 'SISTEMA permite a equipe de operacao revisar cada sinal individualmente e marcar como falso positivo (ex: "numero do protocolo" detectado por NLP), o que remove o impacto no score sem prejudicar o par.'),
('ZLAR-V2-US-021', 14, 'SISTEMA bloqueia recadastro de CPF desativado permanentemente checando contra lista de bloqueio durante o KYC, mesmo que o usuario crie nova conta com e-mail diferente.'),
('ZLAR-V2-US-021', 15, 'SISTEMA disponibiliza painel para equipe de operacao listando pares com score elevado, historico completo de sinais por par, contexto da defesa do prestador e botao de iniciar investigacao manual ou marcar denuncia como nao corroborada.');

-- =============================================================================
-- Aplica AC do buffer
-- =============================================================================

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference IN ('ZLAR-V2-US-020','ZLAR-V2-US-021')
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
RAISE NOTICE 'AC inseridos: % rows (modulo MATCHING)', v_count;

UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN ('ZLAR-V2-US-020','ZLAR-V2-US-021');

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $ac$;

COMMIT;
