-- =============================================================================
-- AC produto — Modulo SUPORTE (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-018  Atender suporte, gerenciar disputas e contestacoes  (ADMIN)
--
-- Brainstorm SSOT:
--   s4dxp7z  (Painel Admin Suporte)
--   21caa066 (Form Suporte Geral — visao do usuario, mas inclui SLA)
--   3b3ddfb3 (Abertura e Gestao de Disputas — fluxo completo cliente↔prestador↔admin)
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
-- US-018 — Atender suporte, gerenciar disputas e contestacoes (ADMIN)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-018',  1, 'ADMIN acessa painel centralizado de tickets de suporte com listagem ordenavel por data de abertura e SLA, com filtros por tipo de problema (servico, pagamento, erro tecnico, feedback, outros) e busca textual.'),
('ZLAR-V2-US-018',  2, 'ADMIN ve no detalhe de cada ticket o tipo do problema, descricao do usuario, servico relacionado quando informado, historico de mensagens e dados do solicitante (cliente ou prestador).'),
('ZLAR-V2-US-018',  3, 'ADMIN marca ticket como "em analise" para indicar que esta cuidando dele; o solicitante recebe notificacao externa de confirmacao e o ticket fica visivel para outros admins como ja em atendimento, evitando trabalho duplicado.'),
('ZLAR-V2-US-018',  4, 'ADMIN consegue acompanhar SLA do ticket (referencia 48h para suporte geral) com indicador visual de proximidade do vencimento; tickets com SLA proximo recebem destaque na listagem.'),
('ZLAR-V2-US-018',  5, 'ADMIN acessa fila de disputas separada da fila de suporte geral, com listagem priorizada por status (aberta aguardando prestador, aguardando resposta, em analise) e tempo desde abertura.'),
('ZLAR-V2-US-018',  6, 'ADMIN no detalhe de uma disputa ve descricao do solicitante, evidencias anexadas (fotos/texto), resposta do outro lado, protocolo fotografico do servico, historico do chat e timeline de eventos.'),
('ZLAR-V2-US-018',  7, 'ADMIN registra decisao formal da disputa selecionando outcome (favoravel ao cliente, favoravel ao prestador, parcial, retrabalho mediado) com justificativa obrigatoria; a decisao dispara execucao financeira automatica (estorno, repasse parcial ou manutencao) e notifica ambas as partes.'),
('ZLAR-V2-US-018',  8, 'ADMIN aciona retrabalho mediado e o prestador tem 24h para aceitar e agendar; sem resposta do prestador, a Zelar realoca com outro profissional e desconta a comissao do repasse original.'),
('ZLAR-V2-US-018',  9, 'ADMIN pode marcar uma disputa como "ma-fe" do solicitante apos analise; o sistema aplica penalidade gradativa ao denunciante e incrementa contador de disputas de ma-fe na sua ficha.'),
('ZLAR-V2-US-018', 10, 'ADMIN solicita evidencias adicionais quando faltam dados; o solicitante recebe notificacao com prazo de 48h para complementar antes da decisao com o que ha disponivel.'),
('ZLAR-V2-US-018', 11, 'ADMIN ve disputas abertas por usuarios com 3 ou mais ocorrencias em 30 dias destacadas com flag de "padrao recorrente", para avaliar se ha abuso antes de processar.'),
('ZLAR-V2-US-018', 12, 'ADMIN avalia recursos solicitados apos decisao; o solicitante anexa novos elementos e justificativa, e o admin decide com base em historico e relevancia da nova evidencia, sem garantia de reabertura.'),
('ZLAR-V2-US-018', 13, 'ADMIN ao aplicar estorno e a carteira do prestador nao tem saldo suficiente, executa estorno parcial com o disponivel e o saldo devedor e descontado automaticamente dos proximos repasses, mantendo o cliente informado do prazo.'),
('ZLAR-V2-US-018', 14, 'ADMIN ve trilha de auditoria completa em cada decisao tomada (quem decidiu, quando, justificativa, outcome financeiro), preservada de forma imutavel para conformidade.'),
('ZLAR-V2-US-018', 15, 'ADMIN ve em ambas filas (suporte e disputas) tela tratada com estado vazio, paginacao/scroll infinito para alto volume e skeleton durante carregamento, sem layout quebrado em nenhum cenario.');

-- =============================================================================
-- Aplica AC do buffer
-- =============================================================================

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference = 'ZLAR-V2-US-018'
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
RAISE NOTICE 'AC inseridos: % rows (modulo SUPORTE)', v_count;

UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference = 'ZLAR-V2-US-018';

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $ac$;

COMMIT;
