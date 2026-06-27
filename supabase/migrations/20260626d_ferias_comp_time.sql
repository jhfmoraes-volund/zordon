-- ferias.comp_time_entry — banco de horas (folga). Crédito de hora extra:
-- credit_hours = hours_worked * rate (default 1.5). Saldo de folga (horas) =
-- Σ credit_hours (não cancelados) − Σ ferias.time_off.hours de folga (idem).
-- Mesma RLS por squad das time_off. Cancelamento soft (canceled_at).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260626d_ferias_comp_time.sql

create table if not exists ferias.comp_time_entry (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public."Member"(id) on delete cascade,
  date          date not null,
  hours_worked  numeric not null check (hours_worked > 0),
  rate          numeric not null default 1.5,
  credit_hours  numeric generated always as (hours_worked * rate) stored,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public."Member"(id) on delete set null,
  canceled_at   timestamptz,
  canceled_by   uuid references public."Member"(id) on delete set null
);

create index if not exists comp_time_member_idx
  on ferias.comp_time_entry (member_id) where canceled_at is null;

alter table ferias.comp_time_entry enable row level security;

create policy comp_time_select on ferias.comp_time_entry
  as permissive for select to authenticated
  using (
    public.can_manage_member_in_squad(member_id)
    or member_id = public.get_my_member_id()
  );

create policy comp_time_insert on ferias.comp_time_entry
  as permissive for insert to authenticated
  with check (public.can_manage_member_in_squad(member_id));

create policy comp_time_update on ferias.comp_time_entry
  as permissive for update to authenticated
  using (public.can_manage_member_in_squad(member_id))
  with check (public.can_manage_member_in_squad(member_id));

create policy comp_time_delete on ferias.comp_time_entry
  as permissive for delete to authenticated
  using (public.can_manage_member_in_squad(member_id));

grant select, insert, update, delete on ferias.comp_time_entry to authenticated;
