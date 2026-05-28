-- One-shot: trunca a ChatMessage gigante (~60k chars) que travava o navegador.
-- Conteudo completo preservado em .local-backups/zelar-turn-12-full.md.
-- Apos isso, o chat carrega leve. Vitor recupera o conteudo dos cards via
-- review_draft (Fase 2 — drafts).

\set ON_ERROR_STOP on

BEGIN;

-- Confirma que a mensagem existe e e do role assistant
DO $check$
DECLARE
  msg_role text;
  msg_len  int;
BEGIN
  SELECT role, length(content) INTO msg_role, msg_len
  FROM "ChatMessage"
  WHERE id = 'fa72dffc-63b2-4760-8243-f31ded12c278';

  IF msg_role IS NULL THEN
    RAISE EXCEPTION 'ChatMessage fa72dffc-63b2-4760-8243-f31ded12c278 not found';
  END IF;
  IF msg_role <> 'assistant' THEN
    RAISE EXCEPTION 'ChatMessage role=% expected assistant', msg_role;
  END IF;
  RAISE NOTICE 'Original content length: % chars', msg_len;
END
$check$;

UPDATE "ChatMessage"
SET
  content = $body$Apliquei os 7 cards de Profissional Oxigênio (P1–P7) e desenvolvi mais 36 cards densos nos blocos restantes. O conteúdo completo (60k chars) foi arquivado em backup local para migração via tool de drafts.

## Cards desenvolvidos (sumário)

### Cliente Oxigênio (12 cards)
- C1 — Cadastro e Login do Cliente
- C2 — Home com Catálogo de Serviços e Atalhos Rápidos
- C3 — Formulário de Solicitação com Complexidade
- C4 — Visita Técnica ("Não Sei Especificar")
- C5 — Exibição de Preço com Breakdown
- C6 — Gestão de Endereços
- C7 — Meios de Pagamento e Custódia
- C8 — Rastreamento em Tempo Real do Profissional
- C9 — Chat In-App com o Profissional
- C10 — Confirmação de Conclusão e Aceite Tácito
- C11 — Avaliação Pós-Serviço
- C12 — Cancelamento pelo Cliente

### Backoffice Admin Oxigênio (10 cards)
- B1 — Fila de Verificação de Profissionais (Camada 2)
- B2 — Gestão de Recursos e Apelações de Verificação
- B3 — Painel de Disputas e Mediação
- B4 — Central de Monitoramento SOS
- B5 — Log de Auditoria LGPD
- B6 — Painel Anti-Bypass
- B7 — Gestão de Penalidades e Contestações de Bypass
- B8 — Suspensão e Reativação de Contas
- B9 — Editor de Tabela de Preços Base
- B10 — Painel de Métricas Operacionais

### Conforto (14 cards)
- CF1 — Preferência de Gênero do Profissional (Opt-in)
- CF2 — Acionamento de Retrabalho
- CF3 — Abertura de Disputa pelo Cliente
- CF4 — Histórico de Serviços do Cliente
- CF5 — Aprovação de Revisão de Escopo pelo Cliente
- CF6 — Notificações Push, In-App e E-mail
- CF7 — Gestão de Perfil do Profissional (Especialidades e Agenda)
- CF8 — Botão SOS do Cliente
- CF9 — Histórico de Avaliações e Resposta do Profissional
- CF10 — Registro de Cliente Ausente pelo Profissional
- CF11 — Framework Mínimo de Pontuação por Serviço
- CF12 — Painel de Parâmetros Ajustáveis (Matching e Anti-Bypass)
- CF13 — Gestão do Catálogo de Serviços
- CF14 — Gestão de Cobertura Geográfica

---

**Total**: 7 aplicados (Profissional Oxigênio) + 36 em fila de aplicação (Cliente, Backoffice, Conforto) = 43 cards.

> Nota técnica: o conteúdo completo dos 36 cards foi arquivado em `.local-backups/zelar-turn-12-full.md`. Migração para o pattern `brainstorm._drafts[]` em curso. Após a migração, basta chamar `apply_drafts` num próximo turno para aplicá-los todos via `solutions[]`.$body$,
  parts = NULL
WHERE id = 'fa72dffc-63b2-4760-8243-f31ded12c278';

COMMIT;

\echo 'OK — ChatMessage truncated. Backup at .local-backups/zelar-turn-12-full.md'
