-- Finance: projeção de custo de mão-de-obra pro contrato inteiro + custo de spot.
--
-- Problema (HITz Global): receita já é projetada pro contrato inteiro
-- (v_contract_revenue_month faz generate_series sobre monthly_fee_cents até o fim
-- do contrato), mas o CUSTO de mão-de-obra morria no mês corrente porque
-- v_allocation_labor_month dependia de v_member_comp_month, que vem de lançamentos
-- REAIS (entry.feeds_labor). Ninguém lança folha futura → custo zerava no futuro.
-- Resultado: membros com alocação futura (Victor, começa 01/07) não apareciam, e
-- alocações spot (Davi, days/horas, percent=NULL) saíam com labor_cents=NULL porque
-- a view só multiplicava `percent`.
--
-- Esta migration reescreve v_allocation_labor_month para:
--   1. PROJETAR custo pro contrato inteiro — gera os meses de cada alocação de
--      effective_from até COALESCE(alocação.effective_to, contrato.effective_to),
--      carregando o último salário conhecido pra frente (LOCF). Alocação sem fim
--      definido (effective_to e contrato.effective_to ambos NULL) NÃO é projetada
--      (comportamento atual preservado, sem série infinita).
--   2. CUSTEAR spot — o número em `labor_allocation.days` é tratado como HORAS;
--      custo = salário_mês ÷ 160h × horas (160h = 8h × 20 dias úteis).
--
-- E adiciona kind/days a v_contract_roster (o DAL já lê essas colunas; a view não
-- as expunha, então spot caía pro default 'standing' com percent=null → "null%").
--
-- Ambas são CREATE OR REPLACE (preservam GRANT); re-grant explícito por segurança.

CREATE OR REPLACE VIEW finance.v_allocation_labor_month AS
WITH alloc AS (
  SELECT
    la.id            AS allocation_id,
    la.contract_id,
    la.project_id,
    la.member_id,
    la.percent,
    la.days,
    la.kind,
    la.effective_from,
    la.effective_to,
    -- horizonte de projeção: fim da alocação, senão fim do contrato.
    -- NULL = sem fim definido → não projeta (só meses com lançamento real).
    COALESCE(la.effective_to, ct.effective_to) AS horizon_end
  FROM finance.labor_allocation la
  LEFT JOIN finance.contract ct ON ct.id = la.contract_id
  WHERE la.voided_at IS NULL
),
-- último salário conhecido por membro (carry-forward p/ meses futuros sem lançamento)
comp_latest AS (
  SELECT DISTINCT ON (member_id)
    member_id,
    month       AS last_month,
    comp_cents  AS last_comp
  FROM finance.v_member_comp_month
  ORDER BY member_id, month DESC
),
-- meses ativos de cada alocação: REAIS (com lançamento) ∪ PROJETADOS (LOCF até horizon_end)
months AS (
  -- meses com lançamento real de comp dentro da vigência
  SELECT a.allocation_id, cm.month, cm.comp_cents
  FROM alloc a
  JOIN finance.v_member_comp_month cm
    ON cm.member_id = a.member_id
   AND cm.month >= date_trunc('month', a.effective_from)::date
   AND cm.month <= COALESCE(a.horizon_end, cm.month)
  UNION
  -- meses projetados: do mês seguinte ao último comp conhecido até horizon_end
  SELECT a.allocation_id, gs::date AS month, cl.last_comp AS comp_cents
  FROM alloc a
  JOIN comp_latest cl ON cl.member_id = a.member_id
  CROSS JOIN LATERAL generate_series(
    GREATEST(
      date_trunc('month', a.effective_from)::date,
      (date_trunc('month', cl.last_month) + interval '1 month')::date
    ),
    date_trunc('month', a.horizon_end)::date,
    interval '1 month'
  ) gs
  WHERE a.horizon_end IS NOT NULL
)
SELECT
  a.allocation_id,
  a.contract_id,
  a.project_id,
  a.member_id,
  m.month,
  CASE
    WHEN a.kind = 'spot' THEN
      -- spot: `days` é tratado como HORAS; rateio sobre 160h/mês
      round(m.comp_cents * (COALESCE(a.days, 0)::numeric / 160.0))::bigint
    ELSE
      -- standing: rateio pelos dias de sobreposição no mês
      round(
        m.comp_cents
        * (a.percent / 100.0)
        * (
            (
              LEAST(
                COALESCE(a.effective_to, (m.month + interval '1 month' - interval '1 day')::date),
                (m.month + interval '1 month' - interval '1 day')::date
              )
              - GREATEST(a.effective_from, m.month)
              + 1
            )::numeric
            / EXTRACT(day FROM (m.month + interval '1 month' - interval '1 day')::date)
          )
      )::bigint
  END AS labor_cents
FROM alloc a
JOIN months m ON m.allocation_id = a.allocation_id
WHERE
  -- spot: emite só no mês do effective_from (evita duplicar se a janela cruzar meses)
  CASE
    WHEN a.kind = 'spot'
      THEN m.month = date_trunc('month', a.effective_from)::date
    -- standing: exige sobreposição efetiva no mês (ov_end >= ov_start)
    ELSE LEAST(
           COALESCE(a.effective_to, (m.month + interval '1 month' - interval '1 day')::date),
           (m.month + interval '1 month' - interval '1 day')::date
         ) >= GREATEST(a.effective_from, m.month)
  END;

GRANT SELECT ON finance.v_allocation_labor_month TO authenticated;

-- ── Roster: expõe kind/days (DAL já consome; view não os tinha) ──────────────
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
JOIN "Member" m ON m.id = la.member_id
WHERE la.contract_id IS NOT NULL
  AND la.voided_at IS NULL
  AND (can_view_project(la.project_id) OR is_admin());

GRANT SELECT ON finance.v_contract_roster TO authenticated;
