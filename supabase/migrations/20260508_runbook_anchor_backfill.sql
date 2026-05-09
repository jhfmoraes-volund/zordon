-- =============================================================================
-- Backfill retroativo: anchor das 47 tasks já criadas (T-001..T-047)
-- =============================================================================
-- Cada task ganha 1 anchor classificado em:
--   - from_brainstorm: deriva de uma feature do solution card
--   - infra_setup: setup técnico compartilhado (RLS, triggers, schema)
--   - gap_fill: lacuna estrutural não declarada no brainstorm (middleware, helper)
--
-- Mapeamento brainstorm session = DS Zelar (e4c2b0e5...).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_session uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_dummy uuid;
BEGIN
  -- ── ADMIN_OPERACAO ──────────────────────────────────────────────────────
  -- US-051 (Dashboard) → feature `8295c317...` [ADMIN] Dashboard Operacional
  v_dummy := runbook.attach_task_anchor('ZLAR-T-001', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[0,1,4,5], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-002', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[]::int[], 'infra_setup', 'RLS pra restringir admin dashboard — implícito no card mas não AC');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-003', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[0,1], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-004', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[0], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-005', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[1], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-006', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[2], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-007', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[3], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-008', '8295c317-57de-4364-8a27-91dcad4415e8', v_session, ARRAY[4], 'from_brainstorm');

  -- US-052 (Gestão Prestadores) → feature `da89a058...` [ADMIN] Gestão de Prestadores
  v_dummy := runbook.attach_task_anchor('ZLAR-T-009', 'da89a058-ec0a-48ab-a705-e3c8c41b9c19', v_session, ARRAY[]::int[], 'infra_setup', 'audit log de moderação — implícito');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-010', 'da89a058-ec0a-48ab-a705-e3c8c41b9c19', v_session, ARRAY[2,3], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-011', 'da89a058-ec0a-48ab-a705-e3c8c41b9c19', v_session, ARRAY[]::int[], 'gap_fill', 'notificação WA/email pós-moderação não está em AC, mas é decorrência');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-012', 'da89a058-ec0a-48ab-a705-e3c8c41b9c19', v_session, ARRAY[0], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-013', 'da89a058-ec0a-48ab-a705-e3c8c41b9c19', v_session, ARRAY[1], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-014', 'da89a058-ec0a-48ab-a705-e3c8c41b9c19', v_session, ARRAY[2,3], 'from_brainstorm');

  -- US-053 (Tickets de suporte) → feature `s4dxp7z` [SUPORTE][ADMIN] Painel Admin - Suporte
  v_dummy := runbook.attach_task_anchor('ZLAR-T-015', 's4dxp7z', v_session, ARRAY[]::int[], 'infra_setup', 'tabela support_tickets pra cobrir AC 0/1');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-016', 's4dxp7z', v_session, ARRAY[2], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-017', 's4dxp7z', v_session, ARRAY[0], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-018', 's4dxp7z', v_session, ARRAY[1], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-019', 's4dxp7z', v_session, ARRAY[2,3], 'from_brainstorm');

  -- US-054 (Disputas) → feature `3b3ddfb3...` [SUPORTE] Abertura e Gestão de Disputas
  v_dummy := runbook.attach_task_anchor('ZLAR-T-020', '3b3ddfb3-319a-476e-a61e-4272c697c9bc', v_session, ARRAY[]::int[], 'infra_setup', 'tabela dispute_decisions pra audit trail');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-021', '3b3ddfb3-319a-476e-a61e-4272c697c9bc', v_session, ARRAY[3], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-022', '3b3ddfb3-319a-476e-a61e-4272c697c9bc', v_session, ARRAY[]::int[], 'gap_fill', 'notificações pós-decisão de disputa decorrência do AC 3');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-023', '3b3ddfb3-319a-476e-a61e-4272c697c9bc', v_session, ARRAY[0], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-024', '3b3ddfb3-319a-476e-a61e-4272c697c9bc', v_session, ARRAY[1], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-025', '3b3ddfb3-319a-476e-a61e-4272c697c9bc', v_session, ARRAY[2,3], 'from_brainstorm');

  -- US-055 (Agenda semanal) → feature `tnrlj00` [SERVIÇO][PRESTADOR] Agenda do Prestador
  v_dummy := runbook.attach_task_anchor('ZLAR-T-026', 'tnrlj00', v_session, ARRAY[]::int[], 'infra_setup', 'query/RLS base');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-027', 'tnrlj00', v_session, ARRAY[0], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-028', 'tnrlj00', v_session, ARRAY[0,1], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-029', 'tnrlj00', v_session, ARRAY[]::int[], 'gap_fill', 'realtime na agenda não está em AC mas é mencionado em pattern do projeto');

  -- ── AUTENTICACAO_ONBOARDING ─────────────────────────────────────────────
  -- US-002 (Splash) → feature `ehden11` [ONBOARDING] Splash
  v_dummy := runbook.attach_task_anchor('ZLAR-T-030', 'ehden11', v_session, ARRAY[0,1,2,3,4], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-031', 'ehden11', v_session, ARRAY[5], 'from_brainstorm');

  -- US-003 (Signup cliente) → feature `4fe1fa4d...` [CADASTRO][CLIENTE] Tela de Signup do Cliente
  v_dummy := runbook.attach_task_anchor('ZLAR-T-032', '4fe1fa4d-a719-451d-8b10-0f8ca2ff90ca', v_session, ARRAY[]::int[], 'infra_setup', 'config Supabase Auth — pré-condição pros 3 caminhos do AC');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-033', '4fe1fa4d-a719-451d-8b10-0f8ca2ff90ca', v_session, ARRAY[0,1,2,3,4,5], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-034', '4fe1fa4d-a719-451d-8b10-0f8ca2ff90ca', v_session, ARRAY[]::int[], 'gap_fill', 'app_metadata.role via trigger Postgres — necessário pra RLS futura, não está em AC produto');

  -- US-004 (Perfil + LGPD) → feature `fb8a94a7...` [CADASTRO][CLIENTE] Perfil Básico + LGPD
  v_dummy := runbook.attach_task_anchor('ZLAR-T-035', 'fb8a94a7-43b9-4550-af2a-178a6ba64467', v_session, ARRAY[]::int[], 'infra_setup', 'tabelas client_profile + lgpd_consent — pré-condição');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-036', 'fb8a94a7-43b9-4550-af2a-178a6ba64467', v_session, ARRAY[0,1,2,3,4,5], 'from_brainstorm');

  -- US-005 (Tour) → feature `ba5ba311...` [ONBOARDING][CLIENTE] Primeira Experiência
  v_dummy := runbook.attach_task_anchor('ZLAR-T-037', 'ba5ba311-e5db-4500-b231-310b024f3419', v_session, ARRAY[]::int[], 'infra_setup', 'coluna onboarding_completed_at — flag de estado do tour');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-038', 'ba5ba311-e5db-4500-b231-310b024f3419', v_session, ARRAY[0,1,2,3,4,5], 'from_brainstorm');

  -- US-006 (Login cliente) → feature `9lscori` [LOGIN][CLIENTE] Tela de Login do Cliente
  v_dummy := runbook.attach_task_anchor('ZLAR-T-039', '9lscori', v_session, ARRAY[0,1,2,3,4,5], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-040', '9lscori', v_session, ARRAY[2], 'from_brainstorm');

  -- ── LOGIN ──────────────────────────────────────────────────────────────
  -- US-081 (Login prestador KYC) → feature `0ca5caf9...` [LOGIN][PRESTADOR]
  v_dummy := runbook.attach_task_anchor('ZLAR-T-041', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[]::int[], 'infra_setup', 'provider_profiles + RLS + trigger — pré-condição');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-042', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[0,6], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-043', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[1,2,3,4,5], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-044', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[3], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-045', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[4], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-046', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[5], 'from_brainstorm');
  v_dummy := runbook.attach_task_anchor('ZLAR-T-047', '0ca5caf9-b7d2-4792-b233-3d67fc858e31', v_session, ARRAY[1], 'gap_fill', 'middleware /provider/** mencionado no edge case do brainstorm, não em AC');

END $$;

-- ── Stories cobertas por outras (módulo LOGIN) ─────────────────────────────
SELECT runbook.mark_story_covered_by(
  'ZLAR-US-007',
  ARRAY['ZLAR-T-041','ZLAR-T-042','ZLAR-T-043','ZLAR-T-044','ZLAR-T-045','ZLAR-T-046','ZLAR-T-047'],
  'Duplicata exata da US-081 (mesmo título, persona Carlos, AC subset). US-081 é a versão mais completa.'
);

SELECT runbook.mark_story_covered_by(
  'ZLAR-US-057',
  ARRAY['ZLAR-T-031','ZLAR-T-032','ZLAR-T-039','ZLAR-T-040'],
  'Login cliente coberto: T-039 (form + 3 caminhos), T-031 (next-redirect param ?redirect=), T-040 (recuperação senha), T-032 (providers configurados).'
);

SELECT runbook.mark_story_covered_by(
  'ZLAR-US-058',
  ARRAY['ZLAR-T-040'],
  'Recuperação de senha completa coberta por T-040 (form + Resend template + redirect pós-reset).'
);

SELECT runbook.mark_story_covered_by(
  'ZLAR-US-071',
  ARRAY['ZLAR-T-030','ZLAR-T-031','ZLAR-T-039'],
  'Sessão ativa redireciona automaticamente: T-030 (splash com guard server-side), T-031 (next-redirect cookie), T-039 (login redireciona se já autenticado).'
);

COMMIT;
