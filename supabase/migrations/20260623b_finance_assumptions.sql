-- finance.assumptions — premissas de pricing/DRE (impostos, SG&A, custos por
-- pessoa). Global (project_id null) + override opcional por projeto. Defaults
-- = planilha Hitz. Ver docs/features/finance/pricing-pnl-model.md.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623b_finance_assumptions.sql

create table finance.assumptions (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid references public."Project"(id) on delete cascade,  -- null = global
  iss_pct                 numeric(6,5) not null default 0.02,
  pis_pct                 numeric(6,5) not null default 0.0065,
  cofins_pct              numeric(6,5) not null default 0.03,
  sga_pct                 numeric(6,5) not null default 0.10,
  financial_cost_pct      numeric(6,5) not null default 0.025,
  irpj_csll_pct           numeric(6,5) not null default 0.34,
  target_margin_pct       numeric(6,5) not null default 0.38,  -- futuro: pricing
  hours_per_fte           int not null default 160,
  ai_per_fte_cents        bigint not null default 50000,       -- R$ 500
  software_per_head_cents bigint not null default 90000,       -- R$ 900
  equip_capex_cents       bigint not null default 600000,      -- R$ 6.000
  equip_life_months       int not null default 24,
  created_by              uuid references public."Member"(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- No máximo 1 global e 1 por projeto.
create unique index assumptions_project_uniq on finance.assumptions (project_id)
  where project_id is not null;
create unique index assumptions_global_uniq on finance.assumptions ((project_id is null))
  where project_id is null;

alter table finance.assumptions enable row level security;
create policy admin_all on finance.assumptions
  as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on finance.assumptions to authenticated;

-- Seed da global com os defaults (= planilha).
insert into finance.assumptions (project_id) values (null);
