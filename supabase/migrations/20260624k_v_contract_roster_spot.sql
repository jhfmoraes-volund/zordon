-- v_contract_roster: expõe kind + days pro roster mostrar participação pontual.
--
-- A view (criada em 20260624i) só trazia percent. Spot é medido em dias, então
-- o app Contratos precisa de kind/days pra renderizar "Xd" em vez de "%". As
-- colunas novas vão no FIM (CREATE OR REPLACE não reordena/remove existentes).
-- Continua sem trafegar valor (custo/salário) — só identidade/cargo/%/dias/vigência.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624k_v_contract_roster_spot.sql

CREATE OR REPLACE VIEW finance.v_contract_roster AS
SELECT
  la.id            AS allocation_id,
  la.contract_id,
  la.project_id,
  la.member_id,
  m.name           AS member_name,
  m."position"     AS member_position,
  la.percent,
  la.effective_from,
  la.effective_to,
  la.kind,
  la.days
FROM finance.labor_allocation la
  JOIN public."Member" m ON m.id = la.member_id
WHERE la.contract_id IS NOT NULL
  AND (can_view_project(la.project_id) OR is_admin());
