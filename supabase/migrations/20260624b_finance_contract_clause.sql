-- RB1 Fase 1.2 — finance.contract_clause (cláusulas 1-N por contrato; Slice 1).
-- agent-fill + manual. RLS admin-only (espelha o padrão finance).

create table if not exists finance.contract_clause (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references finance.contract(id) on delete cascade,
  kind        text not null default 'other'
                check (kind in ('sla','penalty','ip','confidentiality','readjust','warranty','other')),
  text        text not null,
  sort        int  not null default 0,
  source      text not null default 'manual' check (source in ('manual','agent','integration')),
  created_at  timestamptz not null default now()
);
create index if not exists contract_clause_idx on finance.contract_clause (contract_id, sort);

alter table finance.contract_clause enable row level security;
drop policy if exists admin_all on finance.contract_clause;
create policy admin_all on finance.contract_clause
  as permissive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on finance.contract_clause to authenticated;

-- down: drop table if exists finance.contract_clause;
