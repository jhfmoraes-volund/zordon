-- ═══════════════════════════════════════════════════════════════════════════
-- HOTFIX: re-grant em finance.v_project_member_labor_month.
--
-- A 20260624u (MAH-002, "exclude voids from views") fez DROP ... CASCADE + recriou
-- as views de billing, e re-grantou TODAS menos v_project_member_labor_month —
-- ficou sem GRANT SELECT pra `authenticated`. Resultado: /api/finance/overview e
-- /api/finance/projects retornavam "permission denied for view
-- v_project_member_labor_month" e o Finance App não carregava.
--
-- Aplicado a quente em PROD via psql; este arquivo registra o fix (idempotente).
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624w_regrant_v_project_member_labor_month.sql
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT ON finance.v_project_member_labor_month TO authenticated;
