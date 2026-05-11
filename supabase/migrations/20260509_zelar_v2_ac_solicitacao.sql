-- =============================================================================
-- AC produto — Modulo SOLICITACAO (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-010  Conhecer e navegar o catalogo de servicos                (CLIENTE)
--   ZLAR-V2-US-011  Solicitar servico com pagamento up-front e confirmacao  (CLIENTE)
--
-- Brainstorm SSOT:
--   ddeu79g  — HOME catalogo (7 categorias + visita tecnica)
--   cldwzgl  — solicitacao up-front (form, breakdown, MP cartao+Pix)
--   rrz2xhy  — confirmacao pos-pagamento (matching rodando)
--   z88jgzq  — visita tecnica (R$ 50, 48h, abatimento)
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
-- US-010 — Conhecer e navegar o catalogo de servicos
-- Brainstorm: ddeu79g (HOME catalogo + visita tecnica)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-010', 1, 'CLIENTE vê na home uma grade visual com as 7 categorias do catalogo (eletrica, encanamento, limpeza, montagem, pintura, climatizacao, pequenos reparos), com identidade visual clara por categoria.'),
('ZLAR-V2-US-010', 2, 'CLIENTE acessa qualquer categoria com um toque e vê a lista das subcategorias daquela categoria (ex: em "Eletrica" vê tomadas, chuveiro, disjuntores, luminarias, etc).'),
('ZLAR-V2-US-010', 3, 'CLIENTE vê em toda categoria a opcao "Nao sei especificar — solicitar visita tecnica" como subcategoria sempre disponivel.'),
('ZLAR-V2-US-010', 4, 'CLIENTE vê preco indicativo (faixa minima e maxima) por subcategoria antes de iniciar a solicitacao, calculado com base na complexidade tipica.'),
('ZLAR-V2-US-010', 5, 'CLIENTE vê regra clara da visita tecnica antes de seleciona-la: taxa fixa de deslocamento, abatimento integral se contratar a execucao, retencao se recusar.'),
('ZLAR-V2-US-010', 6, 'CLIENTE acessa a home sem precisar estar autenticado para navegar o catalogo; e direcionado a login/cadastro apenas no momento de iniciar a solicitacao.'),
('ZLAR-V2-US-010', 7, 'CLIENTE em primeira visita vê tour guiado nao bloqueante apresentando o catalogo e o fluxo basico de pedido; pode pular ou retomar pelo perfil.'),
('ZLAR-V2-US-010', 8, 'CLIENTE pode buscar uma palavra-chave (ex: "torneira", "fechadura") e vê as subcategorias correspondentes destacadas independente da categoria pai.'),
('ZLAR-V2-US-010', 9, 'CLIENTE seleciona uma subcategoria e e levado para a tela de solicitacao ja com a categoria e subcategoria pre-selecionadas.');

-- =============================================================================
-- US-011 — Solicitar servico com pagamento up-front e confirmacao
-- Brainstorm: cldwzgl (form+pagamento), rrz2xhy (confirmacao), z88jgzq (visita tecnica)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-011',  1, 'CLIENTE preenche formulario unico e guiado com descricao do problema, fotos do problema (obrigatorias, ao menos 1), nivel de complexidade aparente, endereco e data/hora desejada.'),
('ZLAR-V2-US-011',  2, 'CLIENTE vê o endereco principal pre-preenchido a partir do perfil; pode escolher endereco salvo alternativo ou cadastrar um novo no momento.'),
('ZLAR-V2-US-011',  3, 'CLIENTE vê preco estimado da execucao logo apos descrever o problema, calculado a partir da subcategoria e da complexidade aparente, antes de confirmar.'),
('ZLAR-V2-US-011',  4, 'CLIENTE vê breakdown explicito do valor total (servico + taxa de deslocamento baseada em distancia + taxa da plataforma) antes de pagar.'),
('ZLAR-V2-US-011',  5, 'CLIENTE escolhe forma de pagamento entre cartao de credito e Pix; em ambos, o valor e capturado integralmente up-front (escrow).'),
('ZLAR-V2-US-011',  6, 'CLIENTE pagando por Pix recebe QR Code e codigo copia-e-cola, com indicacao clara de tempo restante para pagamento e estado (pendente, pago, expirado).'),
('ZLAR-V2-US-011',  7, 'CLIENTE com cartao recusado vê mensagem clara do motivo e pode tentar outro cartao ou outra forma de pagamento sem refazer o formulario.'),
('ZLAR-V2-US-011',  8, 'CLIENTE com codigo Pix expirado pode gerar novo codigo sem refazer a solicitacao; valor e parametros mantidos.'),
('ZLAR-V2-US-011',  9, 'CLIENTE entende que o prestador so recebe o pagamento apos a finalizacao do servico e a sua confirmacao via assinatura digital, mensagem visivel antes da confirmacao do pagamento.'),
('ZLAR-V2-US-011', 10, 'CLIENTE apos pagar e levado a tela de confirmacao mostrando que a busca por prestador disponivel comecou, com tempo medio estimado de aguarde para esta categoria/horario.'),
('ZLAR-V2-US-011', 11, 'CLIENTE na tela de confirmacao vê os proximos passos da jornada (matching, aceite do prestador, deslocamento, execucao) e e direcionado a tela de acompanhamento do servico.'),
('ZLAR-V2-US-011', 12, 'CLIENTE solicitando "visita tecnica" paga taxa fixa de deslocamento up-front; vê na tela aviso explicito de que esse valor sera abatido integralmente se contratar a execucao apos o diagnostico.'),
('ZLAR-V2-US-011', 13, 'CLIENTE recebe proposta do prestador apos visita tecnica com escopo e valor; tem 48 horas para aceitar, recusar ou pedir revisao da proposta.'),
('ZLAR-V2-US-011', 14, 'CLIENTE que aceita a proposta apos visita tecnica paga a diferenca (valor proposto menos taxa de visita ja paga); que recusa ou nao responde no prazo perde a taxa, sem novo servico aberto automaticamente.'),
('ZLAR-V2-US-011', 15, 'CLIENTE pode reabrir nova solicitacao apos visita recusada ou expirada; vê aviso explicito de que valor e disponibilidade nao sao garantidos.');

-- =============================================================================
-- Aplica AC do buffer
-- =============================================================================

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference IN ('ZLAR-V2-US-010','ZLAR-V2-US-011')
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
RAISE NOTICE 'AC inseridos: % rows (modulo SOLICITACAO)', v_count;

UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN ('ZLAR-V2-US-010','ZLAR-V2-US-011');

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $ac$;

COMMIT;
