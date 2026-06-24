-- ═══════════════════════════════════════════════════════════════════════════
-- Excluir voids (voided_at IS NOT NULL) das views de billing e roster.
--
-- M2 do PRD member-allocation-history. CREATE OR REPLACE das 4 views afetadas,
-- adicionando filtro `la.voided_at IS NULL` onde se lê `finance.labor_allocation`:
--   1. v_allocation_labor_month (base de billing)
--   2. v_project_member_labor_month (deriva da anterior, não precisa de AND extra)
--   3. v_contract_roster (roster legível)
--   4. v_project_team (roster canônico da app)
--
-- Decisão D4: "Remover = void (soft), não delete. voided_at/reason/by; sai do
-- billing; some dos rosters; visível com toggle 'Mostrar removidos'."
--
-- Cadeia de dependência: v_allocation_labor_month → v_project_member_labor_month
-- → v_project_labor_month → v_project_month. Também: v_allocation_labor_month
-- → v_contract_month. Todas devem ser dropadas antes de recriar v_allocation_labor_month.
--
-- Depende de: 20260624_labor_allocation_void_columns.sql (MAH-001).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624u_exclude_voids_from_views.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop cascade: dependentes de v_allocation_labor_month + views a modificar
DROP VIEW IF EXISTS finance.v_project_month CASCADE;
DROP VIEW IF EXISTS finance.v_project_labor_month CASCADE;
DROP VIEW IF EXISTS finance.v_contract_month CASCADE;
DROP VIEW IF EXISTS finance.v_project_member_labor_month CASCADE;
DROP VIEW IF EXISTS finance.v_allocation_labor_month CASCADE;
DROP VIEW IF EXISTS finance.v_contract_roster CASCADE;
DROP VIEW IF EXISTS finance.v_project_team CASCADE;

-- 1. Base PRO-RATA de billing — adiciona AND la.voided_at IS NULL
CREATE OR REPLACE VIEW finance.v_allocation_labor_month WITH (security_invoker = true) AS
WITH j AS (
  SELECT
    la.id          AS allocation_id,
    la.contract_id,
    la.project_id,
    la.member_id,
    la.percent,
    cm.month,
    cm.comp_cents,
    (cm.month + INTERVAL '1 month' - INTERVAL '1 day')::date AS month_end,
    GREATEST(la.effective_from, cm.month)                                                AS ov_start,
    LEAST(COALESCE(la.effective_to, (cm.month + INTERVAL '1 month' - INTERVAL '1 day')::date),
          (cm.month + INTERVAL '1 month' - INTERVAL '1 day')::date)                      AS ov_end
  FROM finance.labor_allocation la
  JOIN finance.v_member_comp_month cm
    ON cm.member_id = la.member_id
   AND cm.month >= date_trunc('month', la.effective_from)::date
   AND (la.effective_to IS NULL OR cm.month <= la.effective_to)
  WHERE la.voided_at IS NULL  -- nova linha (MAH-002)
)
SELECT
  allocation_id,
  contract_id,
  project_id,
  member_id,
  month,
  ROUND(
    comp_cents
    * (percent / 100.0)
    * ((ov_end - ov_start + 1)::numeric / EXTRACT(day FROM month_end)::numeric)
  )::bigint AS labor_cents
FROM j
WHERE ov_end >= ov_start;

GRANT SELECT ON finance.v_allocation_labor_month TO authenticated;

-- 2. v_project_member_labor_month deriva da base (herda o filtro de void)
CREATE OR REPLACE VIEW finance.v_project_member_labor_month WITH (security_invoker = true) AS
SELECT project_id, member_id, month, SUM(labor_cents)::bigint AS labor_cents
FROM finance.v_allocation_labor_month
GROUP BY project_id, member_id, month;

-- 3. v_contract_roster — roster legível SEM valores (adiciona AND la.voided_at IS NULL)
CREATE OR REPLACE VIEW finance.v_contract_roster AS
SELECT
  la.id            AS allocation_id,
  la.contract_id,
  la.project_id,
  la.member_id,
  m.name           AS member_name,
  m.position       AS member_position,
  la.percent,
  la.effective_from,
  la.effective_to
FROM finance.labor_allocation la
JOIN public."Member" m ON m.id = la.member_id
WHERE la.contract_id IS NOT NULL
  AND la.voided_at IS NULL  -- nova linha (MAH-002)
  AND (public.can_view_project(la.project_id) OR public.is_admin());

GRANT SELECT ON finance.v_contract_roster TO authenticated;

-- 4. v_project_team — roster canônico (adiciona AND la.voided_at IS NULL no CTE allocated)
DROP VIEW IF EXISTS finance.v_project_team;

CREATE VIEW finance.v_project_team AS
WITH allocated AS (
  SELECT DISTINCT ON (la.project_id, la.member_id)
    la.project_id,
    la.member_id,
    la.contract_id,
    la.kind,
    la.percent,
    la.days
  FROM finance.labor_allocation la
  WHERE (la.effective_to IS NULL OR la.effective_to >= current_date)
    AND la.voided_at IS NULL  -- nova linha (MAH-002)
  ORDER BY la.project_id, la.member_id, (la.kind = 'standing') DESC, la.effective_from DESC
),
member_ids AS (
  -- PM (gestor): sempre membro, derivado do projeto
  SELECT id AS project_id, "pmId" AS member_id FROM "Project" WHERE "pmId" IS NOT NULL
  UNION
  -- Builders (executores): membros por estarem alocados
  SELECT project_id, member_id FROM allocated
),
team AS (
  SELECT
    mi.project_id,
    mi.member_id,
    m."userId"            AS user_id,
    m.name,
    m.role,
    m."position",
    m."fpCapacity"        AS fp_capacity,
    m."dedicationPercent" AS dedication_percent,
    m."isExternal"        AS is_external,
    (mi.member_id = p."pmId") AS is_pm,
    pm."fpAllocation"     AS fp_allocation,
    a.kind,
    a.percent,
    a.days,
    a.contract_id
  FROM member_ids mi
    JOIN "Member" m  ON m.id = mi.member_id
    JOIN "Project" p ON p.id = mi.project_id
    LEFT JOIN allocated a       ON a.project_id = mi.project_id AND a.member_id = mi.member_id
    LEFT JOIN "ProjectMember" pm ON pm."projectId" = mi.project_id AND pm."memberId" = mi.member_id
  WHERE m."deactivatedAt" IS NULL   -- membro desativado sai do roster
)
SELECT * FROM team
WHERE auth.uid() IS NULL OR is_admin() OR can_view_project(project_id);

GRANT SELECT ON finance.v_project_team TO authenticated, service_role;

-- 5. Recriar v_project_labor_month (depende de v_project_member_labor_month)
CREATE VIEW finance.v_project_labor_month WITH (security_invoker = true) AS
SELECT project_id, month, SUM(labor_cents)::bigint AS labor_cents
FROM finance.v_project_member_labor_month
GROUP BY project_id, month;

GRANT SELECT ON finance.v_project_labor_month TO authenticated;

-- 6. Recriar v_contract_month (depende de v_allocation_labor_month)
CREATE VIEW finance.v_contract_month WITH (security_invoker = true) AS
WITH squad AS (
  SELECT id, project_id, monthly_fee_cents, effective_from,
         COALESCE(
           billing_count,
           (EXTRACT(year  FROM age(date_trunc('month', COALESCE(effective_to, now()::date)),
                                    date_trunc('month', effective_from))) * 12
          + EXTRACT(month FROM age(date_trunc('month', COALESCE(effective_to, now()::date)),
                                    date_trunc('month', effective_from))))::int + 1
         ) AS n_months
  FROM finance.contract
  WHERE billing_type = 'squad'
),
squad_rev AS (
  SELECT s.id AS contract_id, s.project_id,
         date_trunc('month', gs.gs)::date AS month,
         COALESCE(o.amount_cents, s.monthly_fee_cents)::bigint AS revenue_cents
  FROM squad s
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', s.effective_from),
    date_trunc('month', s.effective_from) + ((s.n_months - 1) || ' month')::interval,
    '1 month'::interval
  ) gs(gs)
  LEFT JOIN finance.contract_month_override o ON o.contract_id = s.id AND o.month = date_trunc('month', gs.gs)::date
  WHERE COALESCE(o.amount_cents, s.monthly_fee_cents) IS NOT NULL
),
fp_rev AS (
  SELECT c.id AS contract_id, c.project_id, d.month,
         SUM(d.fp_delivered * COALESCE(c.price_per_fp_cents, 0))::bigint AS revenue_cents
  FROM finance.fp_delivery d
  JOIN finance.contract c
    ON c.project_id = d.project_id
   AND c.billing_type = 'fixed_scope'
   AND date_trunc('month', c.effective_from::timestamptz) <= d.month
   AND (c.effective_to IS NULL OR d.month <= date_trunc('month', c.effective_to::timestamptz))
  GROUP BY c.id, c.project_id, d.month
),
rev AS (
  SELECT contract_id, project_id, month, revenue_cents FROM squad_rev
  UNION ALL
  SELECT contract_id, project_id, month, revenue_cents FROM fp_rev
),
lab AS (
  SELECT contract_id, project_id, month, SUM(labor_cents)::bigint AS labor_cents
  FROM finance.v_allocation_labor_month
  WHERE contract_id IS NOT NULL
  GROUP BY contract_id, project_id, month
),
exp AS (
  SELECT c.contract_id, em.project_id, em.month,
         SUM(em.amount_cents)::bigint AS expense_cents
  FROM finance.v_entry_month em
  JOIN finance.category cat ON cat.id = em.category_id AND cat.kind = 'expense'
  JOIN LATERAL (
    SELECT cc.id AS contract_id
    FROM finance.contract cc
    WHERE cc.project_id = em.project_id
      AND date_trunc('month', cc.effective_from::timestamptz) <= em.month
      AND (cc.effective_to IS NULL OR em.month <= date_trunc('month', cc.effective_to::timestamptz))
    ORDER BY cc.effective_from DESC
    LIMIT 1
  ) c ON true
  WHERE em.project_id IS NOT NULL
  GROUP BY c.contract_id, em.project_id, em.month
),
spine AS (
  SELECT contract_id, project_id, month FROM rev
  UNION SELECT contract_id, project_id, month FROM lab
  UNION SELECT contract_id, project_id, month FROM exp
)
SELECT s.contract_id,
       s.project_id,
       s.month,
       COALESCE(rev.revenue_cents, 0)  AS revenue_cents,
       COALESCE(exp.expense_cents, 0)  AS expense_cents,
       COALESCE(lab.labor_cents, 0)    AS labor_cents
FROM spine s
LEFT JOIN rev ON rev.contract_id = s.contract_id AND rev.month = s.month
LEFT JOIN lab ON lab.contract_id = s.contract_id AND lab.month = s.month
LEFT JOIN exp ON exp.contract_id = s.contract_id AND exp.month = s.month;

GRANT SELECT ON finance.v_contract_month TO authenticated;

-- 7. Recriar v_project_month (depende de v_project_labor_month)
CREATE VIEW finance.v_project_month WITH (security_invoker = true) AS
WITH rev AS (
  SELECT em.project_id, em.month, SUM(em.amount_cents) AS c
  FROM finance.v_entry_month em
  JOIN finance.category cat ON cat.id = em.category_id
  WHERE cat.kind = 'revenue' AND em.project_id IS NOT NULL
  GROUP BY em.project_id, em.month
),
exp AS (
  SELECT em.project_id, em.month, SUM(em.amount_cents) AS c
  FROM finance.v_entry_month em
  JOIN finance.category cat ON cat.id = em.category_id
  WHERE cat.kind = 'expense' AND em.project_id IS NOT NULL
  GROUP BY em.project_id, em.month
),
lab AS (
  SELECT project_id, month, labor_cents
  FROM finance.v_project_labor_month
),
fpr AS (
  SELECT project_id, month, revenue_cents
  FROM finance.v_fp_delivery_month
),
crev AS (
  SELECT project_id, month, revenue_cents
  FROM finance.v_contract_revenue_month
),
spine AS (
  SELECT project_id, month FROM rev
  UNION SELECT project_id, month FROM exp
  UNION SELECT project_id, month FROM lab
  UNION SELECT project_id, month FROM fpr
  UNION SELECT project_id, month FROM crev
)
SELECT s.project_id,
       s.month,
       COALESCE(rev.c, 0) + COALESCE(fpr.revenue_cents, 0)::numeric + COALESCE(crev.revenue_cents, 0)::numeric AS revenue_cents,
       COALESCE(exp.c, 0) AS expense_cents,
       COALESCE(lab.labor_cents, 0) AS labor_cents,
       COALESCE(rev.c, 0) + COALESCE(fpr.revenue_cents, 0)::numeric + COALESCE(crev.revenue_cents, 0)::numeric - COALESCE(exp.c, 0) AS margin_direct_cents,
       COALESCE(rev.c, 0) + COALESCE(fpr.revenue_cents, 0)::numeric + COALESCE(crev.revenue_cents, 0)::numeric - COALESCE(exp.c, 0) - COALESCE(lab.labor_cents, 0)::numeric AS margin_team_cents
FROM spine s
LEFT JOIN rev ON rev.project_id = s.project_id AND rev.month = s.month
LEFT JOIN exp ON exp.project_id = s.project_id AND exp.month = s.month
LEFT JOIN lab ON lab.project_id = s.project_id AND lab.month = s.month
LEFT JOIN fpr ON fpr.project_id = s.project_id AND fpr.month = s.month
LEFT JOIN crev ON crev.project_id = s.project_id AND crev.month = s.month;

GRANT SELECT ON finance.v_project_month TO authenticated;

COMMIT;
