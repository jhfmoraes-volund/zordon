-- finance: trava anti-overlap de contrato no DB (SSOT — evita vigências
-- duplicadas/sobrepostas no mesmo projeto independente da via de entrada;
-- a validação app-level em validateContract continua, com mensagem melhor).
-- 1 contrato governa um período → contractForDate / receita não ficam ambíguos.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623g_finance_contract_no_overlap.sql

begin;

create extension if not exists btree_gist;

alter table finance.contract
  add constraint contract_no_overlap
  exclude using gist (
    project_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  );

commit;
