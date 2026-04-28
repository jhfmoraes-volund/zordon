-- One-shot: compacta a thread Zelar (228k chars / 31 msgs) em 1 mensagem-marco.
-- Backup completo em .local-backups/zelar-thread-full.json (export json_agg).
-- Apos isso, Vitor reconstroi contexto via tools (step data, memoria, _drafts[]).

\set ON_ERROR_STOP on

BEGIN;

-- Verifica thread alvo
DO $check$
DECLARE
  msg_count int;
  total_chars int;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(length(content)), 0)
    INTO msg_count, total_chars
  FROM "ChatMessage"
  WHERE "threadId" = '2ff209a5-959a-41c6-b4a4-ef29acd68c73';

  IF msg_count = 0 THEN
    RAISE EXCEPTION 'thread 2ff209a5-... has no messages — nothing to compact';
  END IF;
  RAISE NOTICE 'Compacting % messages, % chars total -> 1 marker', msg_count, total_chars;
END
$check$;

-- Apaga as 31 mensagens
DELETE FROM "ChatMessage"
WHERE "threadId" = '2ff209a5-959a-41c6-b4a4-ef29acd68c73';

-- Insere 1 mensagem-marco
INSERT INTO "ChatMessage" (id, "threadId", role, content, parts, "createdAt")
VALUES (
  gen_random_uuid(),
  '2ff209a5-959a-41c6-b4a4-ef29acd68c73',
  'assistant',
  $body$## Sessão Zelar — Checkpoint

Estado do trabalho:
- **Pré-trabalho**: 5 docs persistidos em files[] (regras de negócio, anti-bypass, precificação, segurança, visão stakeholders).
- **Personas/jornadas**: aplicadas.
- **Brainstorm**:
  - 7 cards de Profissional Oxigênio aplicados em `solutions[]`.
  - 36 cards staged em `_drafts[]` (12 Cliente + 10 Backoffice + 14 Conforto).
- **Risks/Gaps**: 11 gaps + 10 riscos aplicados.

> Histórico conversacional foi compactado pra liberar o chat. Contexto mora nos artefatos: step data, memória estruturada (decisões + perguntas abertas), e `_drafts[]`.

Próximo passo: rodar `review_draft({})` pra inspecionar os 36 drafts, depois `apply_drafts({})` pra commitar em `solutions[]`.$body$,
  NULL,
  now()
);

COMMIT;

\echo 'OK — thread compacted to 1 marker message. Backup at .local-backups/zelar-thread-full.json'
