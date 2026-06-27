-- Férias & Folgas — schema próprio (isola dado de RH do public, padrão finance).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260626a_ferias_schema.sql
--
-- IMPORTANTE — expor o schema ao PostgREST NÃO é feito aqui (um ALTER ROLE cego
-- em pgrst.db_schemas pode clobberar a lista atual). Após aplicar todas as
-- migrations ferias, adicionar `ferias` em:
--   Supabase Dashboard → Project Settings → API → Exposed schemas
-- (ou ao valor existente de pgrst.db_schemas, preservando os schemas já lá).
-- A RLS continua sendo a barreira real mesmo com o schema exposto.

create schema if not exists ferias;

grant usage on schema ferias to authenticated, service_role;
-- grants por tabela ficam em cada migration de tabela; RLS gateia tudo.

-- ─── Helpers de autorização por squad (reusáveis, no public junto de is_admin) ──
-- "Ator e alvo compartilham squad" — o PM é SquadMember do próprio squad.
create or replace function public.shares_squad_with_me(p_member uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
    from public."SquadMember" a
    join public."SquadMember" b on b."squadId" = a."squadId"
    where a."memberId" = public.get_my_member_id()
      and b."memberId" = p_member
  )
$$;

-- "Posso gerir este membro": admin (todos) OU manager/PM no mesmo squad.
create or replace function public.can_manage_member_in_squad(p_member uuid)
returns boolean language sql stable security definer as $$
  select public.is_admin()
      or (public.is_manager() and public.shares_squad_with_me(p_member))
$$;
