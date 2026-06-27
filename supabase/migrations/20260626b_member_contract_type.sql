-- Member.contractType — regime de contratação (PJ/CLT). Atributo do membro
-- (não só de férias): governa o allowance de férias (PJ 10 úteis · CLT 30
-- corridos). Fica no public.Member porque é fato de RH reusável. null =
-- indefinido (admin define no app Férias & Folgas).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260626b_member_contract_type.sql

alter table public."Member"
  add column if not exists "contractType" text
  check ("contractType" in ('pj', 'clt'));
