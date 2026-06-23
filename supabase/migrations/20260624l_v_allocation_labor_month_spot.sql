-- v_allocation_labor_month: custo do spot (dias × custo-dia) no cálculo (D11).
--
-- standing = lógica ATUAL, intacta — só restrinjo o CTE alloc_months a
-- kind='standing' (spot não pode espalhar por vigência via generate_series).
-- spot = 1 linha no mês de effective_from: comp_mês × (days / 22), onde 22 =
-- dias úteis/mês padrão (1 dia = 8h). UNION ALL preserva as colunas da view
-- (allocation_id, contract_id, project_id, member_id, month, labor_cents), então
-- v_project_member_labor_month / v_project_labor_month herdam sem mudança.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624l_v_allocation_labor_month_spot.sql

CREATE OR REPLACE VIEW finance.v_allocation_labor_month AS
WITH alloc_months AS (
  SELECT la.id AS allocation_id,
    la.contract_id,
    la.project_id,
    la.member_id,
    la.percent,
    la.effective_from,
    la.effective_to,
    gs.gs::date AS month,
    (gs.gs + '1 mon'::interval - '1 day'::interval)::date AS month_end
  FROM finance.labor_allocation la
    CROSS JOIN LATERAL generate_series(
      date_trunc('month'::text, la.effective_from::timestamp with time zone),
      date_trunc('month'::text, COALESCE(la.effective_to, now()::date)::timestamp with time zone),
      '1 mon'::interval
    ) gs(gs)
  WHERE la.kind = 'standing'          -- <<< spot sai do spread por vigência
), rate AS (
  SELECT am_1.allocation_id,
    am_1.month,
    sum(
      CASE
        WHEN e.recurrence = 'annual'::text THEN e.amount_cents / 12
        ELSE e.amount_cents
      END)::bigint AS comp_cents
  FROM alloc_months am_1
    JOIN finance.entry e ON e.member_id = am_1.member_id
    JOIN finance.category cat ON cat.id = e.category_id AND cat.feeds_labor
  WHERE e.recurrence <> 'once'::text AND e.effective_from <= am_1.month_end AND (e.effective_to IS NULL OR e.effective_to >= am_1.month) OR e.recurrence = 'once'::text AND e.occurred_on >= am_1.month AND e.occurred_on <= am_1.month_end
  GROUP BY am_1.allocation_id, am_1.month
), standing AS (
  SELECT am.allocation_id,
    am.contract_id,
    am.project_id,
    am.member_id,
    am.month,
    round(COALESCE(r.comp_cents, 0::bigint)::numeric * (am.percent / 100.0) * ((LEAST(COALESCE(am.effective_to, am.month_end), am.month_end) - GREATEST(am.effective_from, am.month) + 1)::numeric / EXTRACT(day FROM am.month_end)))::bigint AS labor_cents
  FROM alloc_months am
    LEFT JOIN rate r ON r.allocation_id = am.allocation_id AND r.month = am.month
  WHERE COALESCE(r.comp_cents, 0::bigint) > 0
), spot AS (
  SELECT la.id AS allocation_id,
    la.contract_id,
    la.project_id,
    la.member_id,
    date_trunc('month'::text, la.effective_from::timestamp with time zone)::date AS month,
    round(cm.comp_cents::numeric * (la.days / 22.0))::bigint AS labor_cents
  FROM finance.labor_allocation la
    JOIN finance.v_member_comp_month cm
      ON cm.member_id = la.member_id
     AND cm.month = date_trunc('month'::text, la.effective_from::timestamp with time zone)::date
  WHERE la.kind = 'spot' AND la.days IS NOT NULL AND cm.comp_cents > 0
)
SELECT allocation_id, contract_id, project_id, member_id, month, labor_cents FROM standing
UNION ALL
SELECT allocation_id, contract_id, project_id, member_id, month, labor_cents FROM spot;
