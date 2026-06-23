-- RB1 Fase 1.4 — finance.invoice (NF por mês; Slice 1).
-- Q1 N (sem unique) · Q2 4 estados · Q3 condição por mês · Q4 SÓ operacional
-- (não reconcilia receita — nenhuma view lê esta tabela). Campos fiscais:
-- amount=BRUTO, received_net=líquido (retenção), due_at=aging, cancelled.

create table if not exists finance.invoice (
  id                 uuid primary key default gen_random_uuid(),
  contract_id        uuid not null references finance.contract(id) on delete cascade,
  competence_month   date not null,
  amount_cents       bigint not null check (amount_cents >= 0),       -- valor BRUTO da NF
  received_net_cents bigint check (received_net_cents >= 0),          -- líquido na conta (retenção)
  number             text,
  status             text not null default 'pending'
                       check (status in ('pending','issued','received','cancelled')),
  issued_at          date,
  received_at        date,
  due_at             date,                                            -- habilita aging/vencido
  condition_kind     text check (condition_kind in ('pf_sheet','sow','none')),
  condition_met      boolean not null default false,
  created_by         uuid references public."Member"(id) on delete set null,
  provenance         jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint invoice_competence_first_day check (date_trunc('month', competence_month) = competence_month)
);
create index if not exists invoice_contract_idx on finance.invoice (contract_id, competence_month);
create index if not exists invoice_due_idx on finance.invoice (due_at) where status = 'issued';
-- 1-N por mês (Q1): SEM unique(contract_id, competence_month).

alter table finance.invoice enable row level security;
drop policy if exists admin_all on finance.invoice;
create policy admin_all on finance.invoice
  as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on finance.invoice to authenticated;

-- down: drop table if exists finance.invoice;
