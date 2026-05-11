-- =============================================================================
-- AC produto — Modulo PERFIL (DS Inception Zelar v2)
-- =============================================================================
-- Stories:
--   ZLAR-V2-US-007  Gerenciar carteira, agenda, historico e perfil profissional   (PRESTADOR)
--   ZLAR-V2-US-014  Gerenciar perfil, enderecos e consentimentos LGPD             (CLIENTE)
--
-- Brainstorm SSOT:
--   US-007: 37fecd17 (Tela Perfil Prestador) + s6m6tg0 (Carteira) +
--           tnrlj00 (Agenda) + 6qiftzu (Janela Disponib) + f1280694 (Historico)
--   US-014: 0bd6e8c6 (Tela Perfil Cliente) + fb8a94a7 (Cadastro+LGPD) +
--           2eacb40d (Consentimentos Granulares)
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
-- US-007 — Gerenciar carteira, agenda, historico e perfil profissional (PRESTADOR)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-007',  1, 'PRESTADOR acessa o hub de perfil pela navegacao principal a qualquer momento e ve seus dados pessoais, categorias de atuacao, conta bancaria, foto, badge de nivel, avaliacoes recebidas e link para o proprio perfil publico.'),
('ZLAR-V2-US-007',  2, 'PRESTADOR edita campo a campo (nome, telefone, foto) com validacao inline e toast de confirmacao; tentativa de salvar com dado invalido exibe mensagem especifica sem perder o resto do formulario.'),
('ZLAR-V2-US-007',  3, 'PRESTADOR atualiza categorias de atuacao com pelo menos uma categoria selecionada (sem zero categorias permitidas); novas categorias passam a valer apenas para alocacoes futuras, sem afetar servicos em andamento.'),
('ZLAR-V2-US-007',  4, 'PRESTADOR atualiza dados bancarios com validacao do gateway; conta entra em "Em verificacao" ate confirmacao; pagamentos ja agendados mantem a conta original e novos pagamentos passam a usar a nova conta apos validacao.'),
('ZLAR-V2-US-007',  5, 'PRESTADOR configura janela de disponibilidade semanal por dia/horario em grade interativa; o sistema de matching respeita a janela e nao notifica/inclui o prestador no pool fora dela.'),
('ZLAR-V2-US-007',  6, 'PRESTADOR sem janela configurada herda disponibilidade padrao (todos os dias 8h-18h); ao tentar salvar com janela vazia recebe alerta confirmando que sairia do pool, exigindo confirmacao explicita.'),
('ZLAR-V2-US-007',  7, 'PRESTADOR usa toggle rapido "Indisponivel hoje" na home para sair do pool por 24h sem editar a grade semanal; o toggle prevalece sobre a grade naquele dia.'),
('ZLAR-V2-US-007',  8, 'PRESTADOR acessa "Minha Agenda" e ve lista cronologica dos servicos agendados nos proximos dias com data, horario, endereco, categoria e valor; novos servicos aceitos aparecem em tempo real sem recarregar a tela.'),
('ZLAR-V2-US-007',  9, 'PRESTADOR recebe notificacao 2h antes do horario agendado e novamente 30min antes se ainda nao tiver tocado "Estou a caminho", evitando no-show por esquecimento.'),
('ZLAR-V2-US-007', 10, 'PRESTADOR acessa "Carteira" e ve montante total ganho, saldo em hold, total do mes e extrato cronologico por servico, com status de cada pagamento (programado, liberado, em analise).'),
('ZLAR-V2-US-007', 11, 'PRESTADOR ve cada pagamento liberado automaticamente apos a janela de garantia/aceite tacito do servico, sem precisar acionar saque; recebe notificacao externa quando o valor cai na conta.'),
('ZLAR-V2-US-007', 12, 'PRESTADOR pode abrir ticket de suporte para solicitar saque antecipado direto do detalhe de um pagamento programado; pagamentos em disputa nao expoem o CTA de saque antecipado.'),
('ZLAR-V2-US-007', 13, 'PRESTADOR acessa "Meu historico" e ve servicos executados com protocolo fotografico, avaliacao recebida, timeline de eventos e link para o pagamento na carteira; servicos com retrabalho ou disputa exibem badge e CTA contextual de resposta.'),
('ZLAR-V2-US-007', 14, 'PRESTADOR aciona logout com confirmacao simples; tentativa de excluir conta com servicos ativos e bloqueada com mensagem clara orientando a concluir ou cancelar antes.');

-- =============================================================================
-- US-014 — Gerenciar perfil, enderecos e consentimentos LGPD (CLIENTE)
-- =============================================================================
INSERT INTO _ac_buf VALUES
('ZLAR-V2-US-014',  1, 'CLIENTE acessa o hub de perfil pela navegacao principal a qualquer momento e ve seus dados pessoais (nome, foto, telefone, e-mail), endereco principal e secao de consentimentos.'),
('ZLAR-V2-US-014',  2, 'CLIENTE edita campos pessoais com validacao inline (nome, telefone, foto) e recebe toast de confirmacao; em erro o campo e revertido para o valor anterior sem perda de dados.'),
('ZLAR-V2-US-014',  3, 'CLIENTE atualiza foto de perfil pela galeria ou camera com preview antes da confirmacao; arquivos grandes sao redimensionados automaticamente sem exigir acao do usuario.'),
('ZLAR-V2-US-014',  4, 'CLIENTE com conta vinculada a provedor externo (Google/Apple) ve e-mail como somente-leitura com tooltip explicativo; nao ve campo de senha; opcao de desvincular so e oferecida se houver senha cadastrada como fallback.'),
('ZLAR-V2-US-014',  5, 'CLIENTE gerencia enderecos salvos (cadastrar novo, editar, definir como principal); o endereco principal e pre-preenchido em novas solicitacoes, e novas solicitacoes podem usar qualquer endereco salvo ou cadastrar um endereco temporario.'),
('ZLAR-V2-US-014',  6, 'CLIENTE que edita o endereco principal nao afeta servicos ja em andamento, que mantem o endereco original registrado; a alteracao vale apenas para solicitacoes futuras.'),
('ZLAR-V2-US-014',  7, 'CLIENTE acessa "Meus consentimentos" e ve historico completo (data e versao) de cada consentimento aceito ou revogado, podendo revogar consentimentos nao essenciais (ex: marketing) a qualquer momento sem impacto no acesso a plataforma.'),
('ZLAR-V2-US-014',  8, 'CLIENTE quando os termos sao atualizados ve modal de re-consent na proxima abertura do app, antes de qualquer outra tela; nao consegue prosseguir ate aceitar a nova versao, sem prazo maximo forcado.'),
('ZLAR-V2-US-014',  9, 'CLIENTE com servico em andamento durante uma atualizacao de termos nao tem o re-consent exibido durante a execucao; o modal aguarda ate o servico encerrar.'),
('ZLAR-V2-US-014', 10, 'CLIENTE pode solicitar exclusao da conta com confirmacao explicita (digitar "EXCLUIR"); apos confirmacao a sessao e encerrada, e o sistema executa anonimizacao conforme LGPD respeitando obrigacoes fiscais e de auditoria.'),
('ZLAR-V2-US-014', 11, 'CLIENTE pode solicitar exclusao de dados pessoais (Art. 18 LGPD) via suporte; o sistema anonimiza dados pessoais, mantem registros financeiros pelo prazo legal e remove documentos sensiveis do storage apos prazo legal.'),
('ZLAR-V2-US-014', 12, 'CLIENTE acessa o perfil offline e ve dados em cache local com campos editaveis desabilitados e indicador de modo offline; ao reconectar, a edicao e liberada automaticamente sem perda de dados nao salvos.');

-- =============================================================================
-- Aplica AC do buffer
-- =============================================================================

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT id FROM "UserStory"
  WHERE "designSessionId" = v_session_id
    AND reference IN ('ZLAR-V2-US-007','ZLAR-V2-US-014')
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
RAISE NOTICE 'AC inseridos: % rows (modulo PERFIL)', v_count;

UPDATE "UserStory"
SET "refinementStatus" = 'refined', "updatedAt" = NOW()
WHERE "designSessionId" = v_session_id
  AND reference IN ('ZLAR-V2-US-007','ZLAR-V2-US-014');

GET DIAGNOSTICS v_count = ROW_COUNT;
RAISE NOTICE 'Stories marcadas refined: % rows', v_count;

END $ac$;

COMMIT;
