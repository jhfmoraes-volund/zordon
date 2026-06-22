-- finance.category — taxonomia editável de categorias (decisão D13).
-- NÃO aplicada ainda; ver docs/features/finance/finance-app-plan.md §7.2.

create table finance.category (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,             -- ref estável p/ código
  kind              text not null check (kind in ('revenue', 'expense')),
  name              text not null,
  recurring_default boolean not null default false,   -- form abre como recorrente
  requires_member   boolean not null default false,   -- entry precisa de member_id
  feeds_labor       boolean not null default false,   -- entries são comp p/ rateio
  sort              int not null default 0,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table finance.category enable row level security;
create policy admin_all on finance.category
  as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on finance.category to authenticated;

insert into finance.category
  (slug, kind, name, recurring_default, requires_member, feeds_labor, sort) values
  ('faturamento',   'revenue', 'Faturamento',   false, false, false, 0),
  ('ferramentas',   'expense', 'Ferramentas',   true,  false, false, 1),
  ('salarios',      'expense', 'Salários',      true,  true,  true,  2),
  ('gastos_extras', 'expense', 'Gastos extras', false, false, false, 3);
