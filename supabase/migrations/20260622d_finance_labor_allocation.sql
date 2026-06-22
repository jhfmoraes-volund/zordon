-- finance.labor_allocation — alocação financeira manual de membro→projeto (D12).
-- percent × vigência; independe do PFV. Σpercent/membro/período ≤ 100 (API);
-- o resto é overhead da operação.
-- NÃO aplicada ainda; ver docs/features/finance/finance-app-plan.md §7.4.

create table finance.labor_allocation (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public."Member"(id) on delete cascade,
  project_id     uuid not null references public."Project"(id) on delete cascade,
  percent        numeric(5,2) not null check (percent > 0 and percent <= 100),
  effective_from date not null,
  effective_to   date,                                  -- null = vigente
  note           text,
  created_by     uuid references public."Member"(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint alloc_period_valid check (effective_to is null or effective_to >= effective_from)
);
create index labor_alloc_member_idx  on finance.labor_allocation (member_id, effective_from);
create index labor_alloc_project_idx on finance.labor_allocation (project_id, effective_from);

alter table finance.labor_allocation enable row level security;
create policy admin_all on finance.labor_allocation
  as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on finance.labor_allocation to authenticated;
