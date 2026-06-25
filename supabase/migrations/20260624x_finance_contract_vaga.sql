-- ═══════════════════════════════════════════════════════════════════════════
-- Vaga de contrato (staffing por função) — 1ª classe.
--
-- O contrato DEMANDA funções ("1 PM, 2 Builders") = vagas. A vaga é durável;
-- a pessoa é o ocupante rotativo (uma labor_allocation com vaga_id). A vaga
-- existe mesmo VAZIA → buraco de staffing visível (previsto × preenchido).
--
-- `position` espelha o vocabulário de Member.position (src/lib/roles.ts POSITIONS),
-- como text+CHECK (o repo nunca usa enum PG pra cargo). `expected_percent` é
-- PLANEJAMENTO, NÃO entra em custo (igual ProjectMember.fpAllocation, D10).
-- "2 Builders" = 2 linhas (position='product-builder', seq 1 e 2), cada uma
-- preenchível independente.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624x_finance_contract_vaga.sql
-- ═══════════════════════════════════════════════════════════════════════════

create table finance.contract_vaga (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references finance.contract(id) on delete cascade,
  position         text not null,
  label            text,
  seq              int  not null,
  expected_percent numeric(5,2),
  effective_from   date not null,
  effective_to     date,
  created_by       uuid references public."Member"(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contract_vaga_position_chk check (position in
    ('ceo','cro','head-ops','pm','principal-engineer','product-builder')),
  constraint contract_vaga_period_chk check (effective_to is null or effective_to >= effective_from),
  constraint contract_vaga_pct_chk check (expected_percent is null
    or (expected_percent > 0 and expected_percent <= 100)),
  constraint contract_vaga_seq_uniq unique (contract_id, position, seq)
);

create index contract_vaga_contract_idx on finance.contract_vaga (contract_id);
create index contract_vaga_position_idx on finance.contract_vaga (contract_id, position);

alter table finance.contract_vaga enable row level security;
create policy contract_vaga_select_admin on finance.contract_vaga
  for select to authenticated using (public.is_admin());
create policy contract_vaga_insert_admin on finance.contract_vaga
  for insert to authenticated with check (public.is_admin());
create policy contract_vaga_update_admin on finance.contract_vaga
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contract_vaga_delete_admin on finance.contract_vaga
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on finance.contract_vaga to authenticated;
