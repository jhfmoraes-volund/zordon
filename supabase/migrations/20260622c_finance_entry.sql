-- finance.entry — transação unificada (decisões D16/D17/D5/D14).
-- BRL em centavos; categoria + flags definem a forma; salário = entry da
-- categoria Salários (member_id, recorrente, vigência).
-- NÃO aplicada ainda; ver docs/features/finance/finance-app-plan.md §7.3.

create table finance.entry (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references finance.category(id),
  project_id     uuid references public."Project"(id) on delete cascade,  -- null = overhead org
  member_id      uuid references public."Member"(id) on delete restrict,  -- preenchido p/ Salários
  amount_cents   bigint not null check (amount_cents > 0),                 -- BRL; recorrente = valor mensal
  recurrence     text not null default 'once'
                   check (recurrence in ('once', 'monthly', 'annual')),
  occurred_on    date,                                  -- p/ recurrence='once'
  effective_from date,                                  -- p/ recorrente
  effective_to   date,                                  -- null = vigente
  vendor         text,                                  -- Figma, Vercel…
  description    text,
  created_by     uuid references public."Member"(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint entry_once_has_date check (recurrence <> 'once' or occurred_on is not null),
  constraint entry_recurring_has_from check (recurrence = 'once' or effective_from is not null),
  constraint entry_period_valid
    check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index entry_category_idx on finance.entry (category_id);
create index entry_project_idx  on finance.entry (project_id);
create index entry_member_idx   on finance.entry (member_id);

alter table finance.entry enable row level security;
create policy admin_all on finance.entry
  as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on finance.entry to authenticated;
-- member_id obrigatório p/ categoria requires_member: validado na API (cross-table).
