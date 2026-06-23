-- App Contratos (PM+) — roster legível SEM valores. Projeta a EQUIPE alocada por
-- contrato (nome, cargo, % contratual, vigência) — NUNCA custo/salário (labor_cents,
-- comp ficam só nas views admin de finance). Mesma fronteira PM-safe das outras
-- projeções (can_view_project OR is_admin); a view roda SECURITY DEFINER (default),
-- contornando a RLS admin_all de finance.labor_allocation — o WHERE é a barreira.
-- Só linhas vinculadas a contrato (contract_id not null): roster é per-contrato (SSOT
-- da alocação é o contrato). Edição segue admin-only no app Finanças.

create or replace view finance.v_contract_roster as
select
  la.id            as allocation_id,
  la.contract_id,
  la.project_id,
  la.member_id,
  m.name           as member_name,
  m.position       as member_position,
  la.percent,
  la.effective_from,
  la.effective_to
from finance.labor_allocation la
join public."Member" m on m.id = la.member_id
where la.contract_id is not null
  and (public.can_view_project(la.project_id) or public.is_admin());

grant select on finance.v_contract_roster to authenticated;

-- down: drop view if exists finance.v_contract_roster;
