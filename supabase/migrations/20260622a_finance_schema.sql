-- Finance schema — isola dado financeiro sensível do public (decisão D1).
-- NÃO aplicada ainda; ver docs/features/finance/finance-app-plan.md §7.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260622a_finance_schema.sql
--
-- IMPORTANTE — expor o schema ao PostgREST NÃO é feito aqui (um ALTER ROLE
-- cego em pgrst.db_schemas pode clobberar a lista atual). Após aplicar todas
-- as migrations finance, adicionar `finance` em:
--   Supabase Dashboard → Project Settings → API → Exposed schemas
-- (ou ao valor existente de pgrst.db_schemas, preservando os schemas já lá).
-- A RLS (is_admin) continua sendo a barreira real mesmo com o schema exposto.

create schema if not exists finance;

grant usage on schema finance to authenticated;
-- grants por tabela ficam em cada migration de tabela; RLS (is_admin) gateia tudo.
