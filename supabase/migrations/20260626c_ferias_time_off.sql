-- ferias.time_off — ausências no calendário (férias + folga tirada).
-- Férias consome saldo em dias (PJ úteis / CLT corridos). Folga debita horas do
-- banco (ferias.comp_time_entry). Cancelamento é soft (canceled_at, void-não-
-- delete) — some do saldo/calendário mas fica auditável.
-- RLS: admin (todos) OU manager/PM no mesmo squad; self-read. is_admin/squad
-- helpers gateiam — barreira real mesmo com o schema exposto ao PostgREST.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260626c_ferias_time_off.sql

create table if not exists ferias.time_off (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public."Member"(id) on delete cascade,
  type         text not null check (type in ('ferias', 'folga')),
  start_date   date not null,
  end_date     date not null,
  hours        numeric,                  -- folga: horas debitadas do banco
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public."Member"(id) on delete set null,
  updated_at   timestamptz not null default now(),
  canceled_at  timestamptz,
  canceled_by  uuid references public."Member"(id) on delete set null,
  constraint time_off_dates_chk check (end_date >= start_date)
);

create index if not exists time_off_member_idx
  on ferias.time_off (member_id) where canceled_at is null;
create index if not exists time_off_range_idx
  on ferias.time_off (start_date, end_date) where canceled_at is null;

alter table ferias.time_off enable row level security;

create policy time_off_select on ferias.time_off
  as permissive for select to authenticated
  using (
    public.can_manage_member_in_squad(member_id)
    or member_id = public.get_my_member_id()
  );

create policy time_off_insert on ferias.time_off
  as permissive for insert to authenticated
  with check (public.can_manage_member_in_squad(member_id));

create policy time_off_update on ferias.time_off
  as permissive for update to authenticated
  using (public.can_manage_member_in_squad(member_id))
  with check (public.can_manage_member_in_squad(member_id));

create policy time_off_delete on ferias.time_off
  as permissive for delete to authenticated
  using (public.can_manage_member_in_squad(member_id));

grant select, insert, update, delete on ferias.time_off to authenticated;
