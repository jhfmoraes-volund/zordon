-- finance: billing por encomenda (FP de faturamento, ≠ PFV Volund).
-- Contrato por projeto (preço/FP próprio) + entregas de FP → receita.
-- billing_type vem de Project.engagementType (continuous=squad, fixed_scope=encomenda).
-- Ver docs/features/finance/pricing-pnl-model.md.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623c_finance_fp_billing.sql

-- ── Contrato por projeto ─────────────────────────────────────────────────────
create table finance.contract (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null unique references public."Project"(id) on delete cascade,
  price_per_fp_cents bigint check (price_per_fp_cents is null or price_per_fp_cents >= 0),  -- R$/FP (encomenda) — por projeto
  contracted_fp      numeric(12,2) check (contracted_fp is null or contracted_fp >= 0),     -- escopo total (encomenda)
  contracted_sprints int check (contracted_sprints is null or contracted_sprints >= 0),     -- contrato (squad)
  note               text,
  created_by         uuid references public."Member"(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table finance.contract enable row level security;
create policy admin_all on finance.contract as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on finance.contract to authenticated;

-- ── Entregas de FP (faturável) ───────────────────────────────────────────────
create table finance.fp_delivery (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public."Project"(id) on delete cascade,
  month        date not null,
  fp_delivered numeric(12,2) not null check (fp_delivered > 0),
  note         text,
  created_by   uuid references public."Member"(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fp_delivery_month_is_first_day check (date_trunc('month', month) = month)
);
create index fp_delivery_project_month_idx on finance.fp_delivery (project_id, month);
alter table finance.fp_delivery enable row level security;
create policy admin_all on finance.fp_delivery as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on finance.fp_delivery to authenticated;

-- ── Receita de FP por projeto/mês = FP entregue × preço/FP do contrato ───────
create view finance.v_fp_delivery_month with (security_invoker = true) as
select d.project_id,
       d.month,
       sum(d.fp_delivered)                                  as fp_delivered,
       sum(d.fp_delivered * coalesce(c.price_per_fp_cents, 0))::bigint as revenue_cents
from finance.fp_delivery d
left join finance.contract c on c.project_id = d.project_id
group by d.project_id, d.month;

grant select on finance.v_fp_delivery_month to authenticated;

-- ── v_project_month: receita = entries (faturamento) + FP entregue ───────────
create or replace view finance.v_project_month with (security_invoker = true) as
with rev as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'revenue' and em.project_id is not null group by 1, 2),
exp as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'expense' and em.project_id is not null group by 1, 2),
lab as (select project_id, month, labor_cents from finance.v_project_labor_month),
fpr as (select project_id, month, revenue_cents from finance.v_fp_delivery_month),
spine as (
  select project_id, month from rev
  union select project_id, month from exp
  union select project_id, month from lab
  union select project_id, month from fpr
)
select
  s.project_id,
  s.month,
  coalesce(rev.c, 0) + coalesce(fpr.revenue_cents, 0) as revenue_cents,
  coalesce(exp.c, 0)           as expense_cents,
  coalesce(lab.labor_cents, 0) as labor_cents,
  (coalesce(rev.c, 0) + coalesce(fpr.revenue_cents, 0)) - coalesce(exp.c, 0) as margin_direct_cents,
  (coalesce(rev.c, 0) + coalesce(fpr.revenue_cents, 0)) - coalesce(exp.c, 0) - coalesce(lab.labor_cents, 0) as margin_team_cents
from spine s
left join rev on rev.project_id = s.project_id and rev.month = s.month
left join exp on exp.project_id = s.project_id and exp.month = s.month
left join lab on lab.project_id = s.project_id and lab.month = s.month
left join fpr on fpr.project_id = s.project_id and fpr.month = s.month;

-- ── v_org_month: receita inclui FP entregue ──────────────────────────────────
create or replace view finance.v_org_month with (security_invoker = true) as
with rev as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind = 'revenue' group by 1),
exp as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind = 'expense' group by 1),
fpr as (select month, sum(revenue_cents) c from finance.v_fp_delivery_month group by 1)
select
  m.month,
  coalesce(rev.c, 0) + coalesce(fpr.c, 0) as revenue_cents,
  coalesce(exp.c, 0)                      as expense_cents,
  (coalesce(rev.c, 0) + coalesce(fpr.c, 0)) - coalesce(exp.c, 0) as net_cents
from (select month from rev union select month from exp union select month from fpr) m
left join rev on rev.month = m.month
left join exp on exp.month = m.month
left join fpr on fpr.month = m.month;
