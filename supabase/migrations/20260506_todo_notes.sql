-- Todo.notes — texto livre para detalhes, snippets, links, contexto.

BEGIN;

ALTER TABLE "Todo"
  ADD COLUMN "notes" text;

COMMIT;
