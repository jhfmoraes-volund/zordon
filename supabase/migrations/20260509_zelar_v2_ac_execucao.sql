-- =============================================================================
-- AC produto — Modulo EXECUCAO (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-004  Receber e aceitar propostas de servico                       (PRESTADOR)
--   ZLAR-V2-US-005  Executar servico com check-in, fluxo guiado e assinatura     (PRESTADOR)
--   ZLAR-V2-US-006  Lidar com situacoes atipicas durante execucao                (PRESTADOR)
--   ZLAR-V2-US-012  Acompanhar servico em andamento com stepper e comunicacao    (CLIENTE)
--   ZLAR-V2-US-013  Avaliar, assinar conclusao e ver historico                   (CLIENTE)
--   ZLAR-V2-US-015  Cancelar servico e lidar com divergencias durante execucao   (CLIENTE)
--
-- Brainstorm SSOT (cards de DesignSessionBrainstormFeature):
--   US-004: f27efaa1 (Tela Recebimento Propostas pool)
--   US-005: 7791c2c2 (Stepper Execucao) + 062f7a10 (Concluir + Assinatura) +
--           gw7yygi (Codigo Confirmacao) + 9r8tohj (Escrow 48h) +
--           249b85e2 (Ciclo Vida Servico) + 48b5caf4 (Garantia/Retrabalho/70-30)
--   US-006: f6a17ae2 (Diagnostico Diferente) + f8d33934 (Material Adicional) +
--           bd970dfb (Retorno Outro Dia) + 02395434 (Servico Adicional) +
--           mx10h94 (Cliente Ausente) + l2ipkig (Abandono Silencioso) +
--           11a0984c (No-Show Prestador)
--   US-012: mrn624i (Stepper Cliente) + 6bf9027e (Tela Busca/Confirmacao)
--   US-013: yjtckql (Gate Avaliacao) + ec2279a6 (Assinatura cliente) +
--           y8cm1x0 + mmawwcf (Historico) + 572677n (Registro Avaliacoes)
--   US-015: 57495b2d (Politica Cancelamento) + dpsldrv (Reajuste Local) +
--           mx10h94 (Cliente Ausente compartilhado) + 02395434 (Servico Adicional compartilhado)
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
-- US-004 — Receber e aceitar propostas de servico (PRESTADOR)
-- Brainstorm: f27efaa1 (Tela Recebimento Propostas — pool broadcast com race resolvida no banco)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-004',  1, 'PRESTADOR disponivel ve propostas compativeis com seu perfil chegarem em tempo real, sem precisar atualizar manualmente, com identificacao clara de categoria, endereco aproximado, valor estimado e tempo restante para aceite.'),
('ZLAR-V2-US-004',  2, 'PRESTADOR vê proposta entregue simultaneamente a todos os profissionais elegiveis do pool; o primeiro a aceitar leva o servico e os demais recebem feedback imediato de que ja foi alocado.'),
('ZLAR-V2-US-004',  3, 'PRESTADOR que toca em RECUSAR ve o card sumir da sua tela imediatamente, sem penalidade no score, enquanto a proposta continua ativa para os demais ate aceite ou expiracao.'),
('ZLAR-V2-US-004',  4, 'PRESTADOR tem ate 15 minutos para aceitar; passado o prazo sem nenhum aceite no pool, o card some para todos e o servico vai para alocacao manual pela equipe Zelar.'),
('ZLAR-V2-US-004',  5, 'PRESTADOR que perde conexao enquanto o card esta ativo retoma a proposta ao reconectar se ainda houver tempo restante e o servico ainda estiver disponivel; caso contrario volta ao estado de espera.'),
('ZLAR-V2-US-004',  6, 'PRESTADOR em modo "indisponivel" nao recebe novas propostas mesmo durante delays de sincronizacao; quando recebe por race rara, o card simplesmente nao e exibido sem penalidade.'),
('ZLAR-V2-US-004',  7, 'PRESTADOR que toca ACEITAR e nao consegue confirmar (perda de conexao) ve estado de carregamento e pode tentar novamente sem risco de aceite duplicado, enquanto o prazo estiver vigente.'),
('ZLAR-V2-US-004',  8, 'PRESTADOR que perde a corrida pelo aceite por milissegundos ve mensagem clara "Este servico ja foi aceito" e retorna ao estado de espera sem nenhuma penalidade.'),
('ZLAR-V2-US-004',  9, 'PRESTADOR que aceita ve detalhe completo do servico (descricao, fotos, endereco completo, dados de contato do cliente) e o botao "Estou a caminho" para iniciar o trajeto.'),
('ZLAR-V2-US-004', 10, 'PRESTADOR que aceita uma proposta tem aquela proposta retirada do pool dos demais via atualizacao em tempo real, sem precisar de acao manual de ninguem.');

-- =============================================================================
-- US-005 — Executar servico com check-in, fluxo guiado e conclusao assinada (PRESTADOR)
-- Brainstorm: 7791c2c2 (Stepper) + 062f7a10 (Concluir+Assinatura) + gw7yygi (Codigo) +
--             9r8tohj (Escrow 48h) + 249b85e2 (Ciclo de Vida) + 48b5caf4 (Garantia/Protocolo)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-005',  1, 'PRESTADOR alocado abre o app e vê stepper visual com as etapas do servico (a caminho, cheguei, codigo de inicio, em execucao, concluir/assinar), sempre indicando claramente a etapa atual e proximas.'),
('ZLAR-V2-US-005',  2, 'PRESTADOR so consegue avancar para a proxima etapa apos a etapa atual estar confirmada no servidor; tentativas de pular etapa via manipulacao retornam erro e o estado nao avanca.'),
('ZLAR-V2-US-005',  3, 'PRESTADOR ao tocar "Estou a caminho" tem a localizacao compartilhada com o cliente em tempo real durante o trajeto, com permissao de localizacao solicitada nesse momento; ao tocar "Cheguei", o compartilhamento e encerrado.'),
('ZLAR-V2-US-005',  4, 'PRESTADOR ao tocar "Cheguei" recebe um codigo de confirmacao de inicio de 6 digitos, exibido apenas no proprio dispositivo, valido por 15 minutos, que precisa ser informado pelo cliente para iniciar o servico.'),
('ZLAR-V2-US-005',  5, 'PRESTADOR vê o codigo invalidado apos uso bem-sucedido ou expiracao; codigos errados sao contados e ao atingir 5 tentativas erradas um novo codigo e gerado automaticamente.'),
('ZLAR-V2-US-005',  6, 'PRESTADOR durante a execucao precisa registrar protocolo fotografico obrigatorio em 3 momentos (antes, durante e depois) com pelo menos 1 foto em cada bloco antes de poder solicitar a assinatura de conclusao.'),
('ZLAR-V2-US-005',  7, 'PRESTADOR ao concluir o servico vira o dispositivo para o cliente, que assina digitalmente na tela, e confirma o registro; a assinatura e o unico gatilho de finalizacao.'),
('ZLAR-V2-US-005',  8, 'PRESTADOR vê tela de sucesso apos a assinatura informando que o servico foi finalizado e o prazo previsto para liberacao do pagamento (apos o prazo de garantia/aceite tacito).'),
('ZLAR-V2-US-005',  9, 'PRESTADOR recebe notificacao quando o pagamento e liberado para sua carteira no prazo definido pela politica de escrow (parcial logo apos a finalizacao, restante apos a janela de garantia).'),
('ZLAR-V2-US-005', 10, 'PRESTADOR que tem disputa ou retrabalho aberto sobre o servico antes do prazo de liberacao tem o pagamento daquela parcela retido ate resolucao do caso, sem ser prejudicado por falhas operacionais.'),
('ZLAR-V2-US-005', 11, 'PRESTADOR que sofre falha temporaria ao tentar avancar uma etapa (rede, upload de foto, captura de assinatura) ve botao reativado com opcao de tentar novamente, sem que a etapa avance pela metade.'),
('ZLAR-V2-US-005', 12, 'PRESTADOR que perde conexao durante a execucao tem suas acoes enfileiradas localmente e processadas em ordem ao reconectar, refletindo no acompanhamento do cliente assim que voltar online.'),
('ZLAR-V2-US-005', 13, 'PRESTADOR vê seu servico como "Concluido" no historico apos a assinatura, com acesso ao recibo e ao registro fotografico do protocolo, ambos preservados de forma imutavel.');

-- =============================================================================
-- US-006 — Lidar com situacoes atipicas durante execucao (PRESTADOR)
-- Brainstorm: f6a17ae2 (Diagnostico Diferente) + f8d33934 (Material Adicional) +
--             bd970dfb (Retorno Outro Dia) + 02395434 (Servico Adicional) +
--             mx10h94 (Cliente Ausente) + l2ipkig (Abandono Silencioso) +
--             11a0984c (No-Show Prestador)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-006',  1, 'PRESTADOR ao chegar e identificar que o problema real e diferente do descrito pode pausar antes de iniciar e abrir um fluxo guiado de "diagnostico diferente" com descricao, foto obrigatoria e novo escopo/valor sugerido dentro da faixa da categoria.'),
('ZLAR-V2-US-006',  2, 'PRESTADOR submete o novo diagnostico para o cliente, que tem 15 minutos para aprovar; se aprovado, escopo e valor sao atualizados e o servico segue; se recusado e o escopo original ainda faz sentido, executa o original.'),
('ZLAR-V2-US-006',  3, 'PRESTADOR que precisa de material nao previsto pode abrir uma solicitacao com item, fornecedor, valor estimado e foto; o cliente aprova ou recusa em 15 minutos antes da compra ser efetuada.'),
('ZLAR-V2-US-006',  4, 'PRESTADOR que tem material aprovado anexa nota fiscal apos a compra; sem nota fiscal nao consegue retomar a execucao no app e o valor nao e adicionado ao fechamento do servico.'),
('ZLAR-V2-US-006',  5, 'PRESTADOR que precisa retornar em outro dia por razao tecnica (ex: massa secar, peca chegar) registra o motivo tecnico e a data proposta sem cobrar deslocamento adicional; o cliente confirma ou propoe nova data dentro do app.'),
('ZLAR-V2-US-006',  6, 'PRESTADOR que precisa retornar por causa atribuivel ao cliente (cliente ausente em parte do servico, faltou material que cliente forneceria) registra motivo e taxa de deslocamento adicional; cliente aprova antes do retorno.'),
('ZLAR-V2-US-006',  7, 'PRESTADOR que recebe pedido de servico adicional do cliente durante a execucao registra no app antes de executar; se for da mesma especialidade, entra na mesma OS apos aprovacao do cliente; se for de especialidade diferente, sistema orienta a abrir nova solicitacao.'),
('ZLAR-V2-US-006',  8, 'PRESTADOR que executa qualquer adicional sem registrar no app fica sem reconhecimento da plataforma para aquele adicional, com o cliente nao sendo cobrado e o ato sendo registrado como ocorrencia que afeta o score do prestador.'),
('ZLAR-V2-US-006',  9, 'PRESTADOR que chega ao endereco e nao encontra o cliente aguarda 15 minutos com tentativa de contato pelo chat; ao final, pode registrar "cliente ausente" com geolocalizacao e timestamp e recebe taxa de visita de compensacao paga pelo cliente ausente.'),
('ZLAR-V2-US-006', 10, 'PRESTADOR que esquece de atualizar o status por 30 minutos apos chegar recebe alerta automatico; se nao responder, o cliente decide entre aguardar ou cancelar sem cobranca, e a equipe Zelar e acionada se a inacao persistir.'),
('ZLAR-V2-US-006', 11, 'PRESTADOR que nao realiza check-in ate o horario combinado configura no-show: cliente e protegido com realocacao automatica para outro profissional do pool, e o prestador original recebe penalidade no score de confianca.'),
('ZLAR-V2-US-006', 12, 'PRESTADOR com 3 no-shows consecutivos e suspenso automaticamente do pool, recebe notificacao com o motivo e e orientado a contatar a equipe Zelar para revisao da conta.'),
('ZLAR-V2-US-006', 13, 'PRESTADOR que tenta abrir uma segunda situacao atipica (ex: novo reajuste, novo material) sobre o mesmo servico antes de resolver a anterior recebe bloqueio com mensagem clara sobre a pendencia ativa.');

-- =============================================================================
-- US-012 — Acompanhar servico em andamento com stepper e comunicacao (CLIENTE)
-- Brainstorm: 6bf9027e (Tela Busca/Confirmacao) + mrn624i (Stepper Cliente)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-012',  1, 'CLIENTE apos pagar a solicitacao vai direto para tela de busca em tempo real, com indicacao clara de que o sistema esta procurando um prestador; nao precisa atualizar manualmente.'),
('ZLAR-V2-US-012',  2, 'CLIENTE durante a busca pode cancelar sem custo a qualquer momento antes de algum prestador aceitar (reembolso integral, sem penalidade), com confirmacao simples e clara da politica.'),
('ZLAR-V2-US-012',  3, 'CLIENTE que aguarda ate 10 minutos sem nenhum aceite recebe mensagem empatica explicando que ninguem esta disponivel agora, com opcoes "Tentar novamente" (reativa o broadcast) ou "Tentar mais tarde" (reembolso integral + solicitacao salva como rascunho).'),
('ZLAR-V2-US-012',  4, 'CLIENTE assim que um prestador aceita ve card do prestador (foto, nome, badge de confianca, avaliacoes) substituindo a busca, com transicao automatica via tempo real.'),
('ZLAR-V2-US-012',  5, 'CLIENTE acompanha o servico atraves de stepper visual com etapas claras (a caminho, chegou, em execucao, concluido); cada atualizacao do prestador reflete na sua tela em tempo real, sem refresh.'),
('ZLAR-V2-US-012',  6, 'CLIENTE durante o trajeto do prestador ve mapa inline com a localizacao atualizada e tempo estimado de chegada; ao chegar, o mapa e ocultado e a etapa "cheguei" e destacada.'),
('ZLAR-V2-US-012',  7, 'CLIENTE consegue se comunicar com o prestador via chat interno do app durante toda a execucao, sem precisar trocar telefone ou WhatsApp pessoal.'),
('ZLAR-V2-US-012',  8, 'CLIENTE que fecha o app e reabre ve o estado atual correto do servico imediatamente; nao precisa reiniciar o fluxo nem tem gap de informacao alem do delay de reconexao.'),
('ZLAR-V2-US-012',  9, 'CLIENTE quando o prestador nao atualiza status por longo tempo recebe alerta com opcoes "Aguardar" ou "Cancelar sem cobranca", em uma rodada limitada para nao gerar loop infinito.'),
('ZLAR-V2-US-012', 10, 'CLIENTE recebe notificacao push quando o prestador toca "Estou a caminho" e quando ele toca "Cheguei", mesmo com o app fechado.'),
('ZLAR-V2-US-012', 11, 'CLIENTE caso o mapa nao carregue por falha de API ou permissao continua tendo o stepper funcional com mensagem clara "Localizacao temporariamente indisponivel"; as atualizacoes de etapa nao sao afetadas.');

-- =============================================================================
-- US-013 — Avaliar, assinar conclusao e ver historico de servicos e pagamentos (CLIENTE)
-- Brainstorm: ec2279a6 (Assinatura) + yjtckql (Gate Avaliacao) + 572677n (Registro Avaliacoes) +
--             y8cm1x0 + mmawwcf (Historico)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-013',  1, 'CLIENTE no momento da conclusao assina digitalmente na tela do prestador para confirmar que o servico foi entregue; a assinatura e o unico gatilho de finalizacao formal e da inicio aos prazos de liberacao.'),
('ZLAR-V2-US-013',  2, 'CLIENTE apos assinar recebe confirmacao por canais externos (mensagem e e-mail) com o recibo do servico contendo a propria assinatura, sem precisar abrir o app para finalizar nada.'),
('ZLAR-V2-US-013',  3, 'CLIENTE pode avaliar o servico (1-5 estrelas + comentario opcional) opcionalmente apos a assinatura; a avaliacao nao e obrigatoria para liberar o pagamento, e a obrigatoriedade existe apenas na assinatura.'),
('ZLAR-V2-US-013',  4, 'CLIENTE que nao avalia no momento da conclusao ve a avaliacao pendente em destaque ao retomar o app, com a mais recente recebendo prioridade visual.'),
('ZLAR-V2-US-013',  5, 'CLIENTE submete a avaliacao e ela e registrada diretamente no perfil do prestador, sem moderacao intermediaria; o prestador recebe notificacao da nova avaliacao recebida.'),
('ZLAR-V2-US-013',  6, 'CLIENTE nao consegue avaliar o mesmo servico mais de uma vez; tentativa duplicada exibe mensagem informativa sem erro generico.'),
('ZLAR-V2-US-013',  7, 'CLIENTE pode acessar avaliacao de servicos antigos pelo historico mesmo nao tendo avaliado no momento, ate o prazo definido para avaliacao expirar.'),
('ZLAR-V2-US-013',  8, 'CLIENTE acessa o historico de servicos no perfil e ve lista cronologica completa com status de cada um (concluido, cancelado, em disputa, em retrabalho), com filtros por periodo e categoria.'),
('ZLAR-V2-US-013',  9, 'CLIENTE no detalhe de um servico concluido ve breakdown financeiro completo (valor do servico, taxa de deslocamento, taxa da plataforma, materiais se houver) e pode baixar o comprovante em PDF a qualquer momento.'),
('ZLAR-V2-US-013', 10, 'CLIENTE no detalhe de um servico dentro do prazo de garantia/disputa (30 dias) ve botoes "Solicitar retrabalho" ou "Abrir disputa" em destaque; passados 30 dias, esses botoes desaparecem com tooltip explicativo.'),
('ZLAR-V2-US-013', 11, 'CLIENTE em servico com disputa ativa ve badge "Em disputa", botao de comprovante bloqueado ate resolucao, e botao de retrabalho indisponivel enquanto a disputa estiver aberta.'),
('ZLAR-V2-US-013', 12, 'CLIENTE em servico cancelado ve no detalhe o motivo do cancelamento, a politica de reembolso aplicada, o valor reembolsado e o prazo, com comprovante de cancelamento separado disponivel quando ha pagamento processado.');

-- =============================================================================
-- US-015 — Cancelar servico e lidar com divergencias durante execucao (CLIENTE)
-- Brainstorm: 57495b2d (Politica Cancelamento) + dpsldrv (Reajuste Local) +
--             02395434 (Servico Adicional) + mx10h94 (Cliente Ausente — vista do cliente)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-015',  1, 'CLIENTE consegue cancelar o servico em qualquer momento antes do prestador chegar, sempre selecionando um motivo (obrigatorio para auditoria) e com campo livre opcional para detalhes.'),
('ZLAR-V2-US-015',  2, 'CLIENTE que cancela em ate 1 hora apos pagar tem reembolso integral processado automaticamente, sem cobrança nem penalidade; o prestador alocado e notificado.'),
('ZLAR-V2-US-015',  3, 'CLIENTE que cancela com mais de 24h de antecedencia tem reembolso de 90% (10% retido pela Zelar); entre 2h e 24h antes, divisao 60% cliente / 30% prestador / 10% Zelar; com menos de 2h, sem reembolso e prestador recebe compensacao.'),
('ZLAR-V2-US-015',  4, 'CLIENTE ve o breakdown da politica de cancelamento aplicavel antes de confirmar o cancelamento (quanto sera reembolsado, quanto sera retido e por que), de forma clara antes da decisao final.'),
('ZLAR-V2-US-015',  5, 'CLIENTE que cancela por forca maior (clima severo, emergencia coletiva) ou emergencia pessoal comprovada seleciona o motivo correspondente e tem condicoes especiais (reembolso integral ou credito na plataforma valido por 90 dias) sujeitas a validacao da equipe Zelar.'),
('ZLAR-V2-US-015',  6, 'CLIENTE que recebe solicitacao de reajuste de valor durante a chegada do prestador tem 15 minutos para aprovar ou recusar, com a divergencia, foto e novo valor sugerido visiveis antes da decisao.'),
('ZLAR-V2-US-015',  7, 'CLIENTE que aprova o reajuste tem o pagamento original cancelado e novo pagamento gerado com o valor revisado, ja autorizado, sem precisar refazer o fluxo de pagamento; ao recusar, e reembolsado integralmente e o prestador recebe compensacao de deslocamento.'),
('ZLAR-V2-US-015',  8, 'CLIENTE que nao responde a uma solicitacao de reajuste no prazo de 15 minutos tem o servico cancelado automaticamente com reembolso integral, e o prestador recebe compensacao de deslocamento.'),
('ZLAR-V2-US-015',  9, 'CLIENTE que recebe solicitacao de material adicional ou servico adicional durante a execucao aprova ou recusa no app antes do prestador prosseguir, com descricao e valor visiveis.'),
('ZLAR-V2-US-015', 10, 'CLIENTE que cancela durante a execucao do servico ve calculo automatico do percentual ja executado (com piso de 50%), com pagamento proporcional ao prestador e reembolso do restante.'),
('ZLAR-V2-US-015', 11, 'CLIENTE que registra ausencia recorrente (3 ou mais ocorrencias em 6 meses) tem conta passada por revisao da equipe Zelar, com possiveis consequencias (advertencia, exigencia de pre-pagamento integral ou bloqueio temporario).'),
('ZLAR-V2-US-015', 12, 'CLIENTE durante uma divergencia (cancelamento contestado, ausencia contestada, valor de execucao em disputa) consegue abrir disputa explicitamente; cancelamento e disputa sao fluxos separados e o status nao muda automaticamente entre eles.');

-- =============================================================================
-- Aplica AC do buffer
-- =============================================================================

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference IN (
      'ZLAR-V2-US-004','ZLAR-V2-US-005','ZLAR-V2-US-006',
      'ZLAR-V2-US-012','ZLAR-V2-US-013','ZLAR-V2-US-015'
    )
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
RAISE NOTICE 'AC inseridos: % rows (modulo EXECUCAO)', v_count;

UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN (
    'ZLAR-V2-US-004','ZLAR-V2-US-005','ZLAR-V2-US-006',
    'ZLAR-V2-US-012','ZLAR-V2-US-013','ZLAR-V2-US-015'
  );

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $ac$;

COMMIT;
