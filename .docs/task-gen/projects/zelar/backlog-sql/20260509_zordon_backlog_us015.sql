-- Zelar v2 — Backlog SQL: ZLAR-V2-US-015 (CLIENTE cancela e lida com divergencias durante execucao)
-- Modulo: EXECUCAO | Persona: CLIENTE | AC: 12
-- Apenas insere metadata em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). NAO executa DDL de produto.
--
-- Story id:   965dd1f2-9c20-4eb6-88e9-fa50e10e1977
-- Project id: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
-- DS id:      264e6d07-d365-43ba-8029-d539ce6f7c6b
-- Persona id (CLIENTE):   4ff1ab67-9c32-4024-80e7-d22bcdac063f
-- Persona id (PRESTADOR): fa9b4900-290e-4c82-b72e-d2ced409f289
-- Persona id (ADMIN):     bf056ca2-211d-4e2e-adfe-32de0c5af2b8
-- Persona id (SISTEMA):   085f0246-a5d1-4b23-9f09-025b5e37177b

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-332 (DATA: service_cancellations + enum cancellation_reason_kind + RLS)
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-332', 'Criar enum cancellation_reason_kind + tabela service_cancellations (audit + snapshot financeiro)',
 $desc$## Objetivo
Persistir o registro auditavel de cada cancelamento (snapshot do motivo, da politica aplicada e dos splits financeiros) para alimentar AC #1 (motivo obrigatorio + detalhes opcional), AC #5 (forca maior/emergencia com evidencia para validacao Zelar), AC #10 (snapshot do percentual executado em cancelamento mid-execution) e AC #12 (estado-base de "cancelamento contestado" quando disputa for promovida).

## Contexto
Modulo EXECUCAO. Tabela append-only consumida por:
- T-335 (`apply_cancellation_policy` grava 1 linha por cancelamento)
- T-330 (`ServiceCancelledDetail`) renderiza motivo, politica e refund
- T-340 (open-dispute-from-cancel) referencia o `service_cancellation_id` ao promover a disputa
- T-322 (Edge Function `generate-service-receipt` kind=cancelled) consome breakdown jsonb

NAO substitui `service_atypical_events` (T-285): cancelamento e evento canonico do FSM (estados `cancelled_by_*`), nao e atypical. Mas o trigger FSM (T-227) **tambem** insere em `service_atypical_events` com kind='cancelled' (audit redundante append-only e padrao do modulo).

## Estado atual / O que substitui
Nao existe. T-070 (`service_requests`) tem colunas `cancelled_at`, `cancel_reason`, `cancel_actor` mas sao truncadas (sem snapshot financeiro nem evidencias). Esta tabela e o registro rico de "como o cancelamento aconteceu".

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_cancellations.sql`
```sql
BEGIN;

CREATE TYPE cancellation_reason_kind AS ENUM (
  'changed_mind',          -- AC #1: troquei de ideia
  'service_mismatch',      -- AC #1: nao e o que eu precisava
  'wrong_provider',        -- AC #1: prestador errado
  'rescheduling_needed',   -- AC #1: preciso remarcar
  'force_majeure',         -- AC #5: clima severo / emergencia coletiva
  'personal_emergency',    -- AC #5: emergencia pessoal comprovada
  'rejected_adjustment',   -- AC #7: cliente recusou reajuste
  'mid_execution_change',  -- AC #10: cliente decide parar durante execucao
  'other'                  -- AC #1: campo livre obrigatorio
);

CREATE TYPE cancellation_window_kind AS ENUM (
  'within_1h_post_payment', -- AC #2: 100% reembolso
  'more_than_24h',          -- AC #3: 90% cliente / 10% Zelar
  'between_2h_and_24h',     -- AC #3: 60/30/10
  'less_than_2h',           -- AC #3: sem reembolso, prestador compensa
  'pre_match',              -- antes de aceite (T-307 cancel-search)
  'mid_execution',          -- AC #10: piso 50%, proporcional
  'force_majeure_override', -- AC #5: validacao admin libera reembolso integral / credito
  'system_timeout'          -- AC #8: timeout 15min reajuste -> reembolso integral
);

CREATE TABLE service_cancellations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id       uuid NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  cancelled_by             text NOT NULL CHECK (cancelled_by IN ('client','provider','system','admin')),
  actor_user_id            uuid REFERENCES auth.users(id),
  reason_kind              cancellation_reason_kind NOT NULL,
  reason_details           text CHECK (char_length(coalesce(reason_details,'')) <= 1000),
  window_kind              cancellation_window_kind NOT NULL,
  -- snapshot financeiro
  policy_snapshot          jsonb NOT NULL, -- { percentages: {client, provider, platform}, source_key, source_value }
  refund_to_client_cents   int NOT NULL CHECK (refund_to_client_cents >= 0),
  payout_to_provider_cents int NOT NULL CHECK (payout_to_provider_cents >= 0),
  platform_fee_cents       int NOT NULL CHECK (platform_fee_cents >= 0),
  total_amount_cents       int NOT NULL CHECK (total_amount_cents >= 0),
  -- mid-execution: percentual snapshotado (AC #10)
  execution_progress_pct   numeric(5,2) CHECK (execution_progress_pct IS NULL OR (execution_progress_pct >= 0 AND execution_progress_pct <= 100)),
  -- evidencia force_majeure / personal_emergency (AC #5)
  evidence_paths           text[] DEFAULT ARRAY[]::text[],
  evidence_review_status   text CHECK (evidence_review_status IN ('not_required','pending','approved','rejected')) DEFAULT 'not_required',
  evidence_reviewed_by     uuid REFERENCES auth.users(id),
  evidence_reviewed_at     timestamptz,
  -- promocao a disputa (AC #12)
  disputed_ticket_id       uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
  -- imutavel
  "createdAt"              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX service_cancellations_actor_idx       ON service_cancellations(actor_user_id, "createdAt" DESC);
CREATE INDEX service_cancellations_reason_idx      ON service_cancellations(reason_kind);
CREATE INDEX service_cancellations_evidence_idx    ON service_cancellations(evidence_review_status)
  WHERE evidence_review_status IN ('pending','rejected');

ALTER TABLE service_cancellations ENABLE ROW LEVEL SECURITY;

-- CLIENTE: SELECT do proprio (via service_request)
CREATE POLICY "cancel_client_select" ON service_cancellations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM service_requests sr
    WHERE sr.id = service_cancellations.service_request_id
      AND sr.client_id = auth.uid()
  ));

-- PRESTADOR: SELECT do proprio (precisa ver compensacao recebida)
CREATE POLICY "cancel_provider_select" ON service_cancellations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM service_requests sr
    WHERE sr.id = service_cancellations.service_request_id
      AND sr.provider_id = auth.uid()
  ));

-- ADMIN: tudo
CREATE POLICY "cancel_admin_all" ON service_cancellations FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Append-only para nao-admin
CREATE POLICY "cancel_no_update" ON service_cancellations FOR UPDATE
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "cancel_no_delete" ON service_cancellations FOR DELETE
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- INSERT bloqueado (apenas RPC SECURITY DEFINER de T-335 escreve)
CREATE POLICY "cancel_no_direct_insert" ON service_cancellations FOR INSERT
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;
```

## Constraints / NAO fazer
- NAO permitir 2o cancelamento no mesmo SR (`UNIQUE(service_request_id)` total)
- NAO incluir colunas mutaveis (refund_status, etc) — disparos financeiros vivem em `payments`/`payment_attempts` (T-071), audit do retorno via `service_events`
- NAO armazenar CPF/dados bancarios em `policy_snapshot` jsonb (apenas percentuais e centavos)
- NAO usar `evidence_paths` como fonte canonica do storage — sao paths relativos ao bucket `service-force-majeure-evidence` (T-346)
- NAO permitir UPDATE direto por nao-admin (apenas validacao de evidencia em T-339/admin task futura)

## Convencoes
- `"createdAt"` com aspas duplas (convencao do projeto)
- Migration via psql; `database.types.ts` regenerado
- Snapshot financeiro derivado de `app_config.cancellation_policy` (T-346) no momento da gravacao — preservado ainda que policy mude depois
- Pattern append-only consistente com `service_atypical_events` (T-285) e `service_ratings` (T-318)
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-333 (DATA: client_absence_counters + trigger admin_review)
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-333', 'Criar client_absence_counters + trigger admin_review aos 3 ocorr/6m (espelha T-291)',
 $desc$## Objetivo
Espelhar a logica de T-291 (`provider_noshow_counters`) do lado do CLIENTE: contar ocorrencias de ausencia (NaoShow do cliente, registradas via T-296 `service_client_absences`) numa janela movel de 6 meses e disparar revisao automatica do admin a partir de 3 ocorrencias. Cobre AC #11 (3 ou mais em 6 meses → revisao Zelar com possiveis advertencia/pre-pagamento/bloqueio).

## Contexto
Modulo EXECUCAO. Reuso forte do pattern de T-291: o trigger e instalado em `service_client_absences` (criada em T-290 da US-006). Quando `count(absence_at >= NOW() - interval '6 months') >= 3`, insere ticket `kind='client_absence_review'` em `support_tickets` (T-147 schema) com `pending_admin_review`. UI da admin (US-017) prove a tela de revisao com acoes (advertencia, pre-pagamento, bloqueio temporario).

## Estado atual / O que substitui
Nao existe. T-291 ja tem o pattern espelhado para PRESTADOR (suspende automaticamente apos 3 no-shows consecutivos). Aqui reutilizamos a mesma logica mas para CLIENTE (ausencias na janela), sem suspensao automatica — apenas revisao admin com decisao humana.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_absence_counters.sql`
```sql
BEGIN;

CREATE TABLE client_absence_counters (
  client_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- janela movel 6 meses (recalculada por trigger)
  absences_last_6_months int  NOT NULL DEFAULT 0,
  last_absence_at        timestamptz,
  review_ticket_id       uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
  review_opened_at       timestamptz,
  "createdAt"            timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"            timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE client_absence_counters ENABLE ROW LEVEL SECURITY;

-- ADMIN: tudo
CREATE POLICY "client_absence_admin_all" ON client_absence_counters FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- CLIENTE: SELECT do proprio (transparencia + UI Banner)
CREATE POLICY "client_absence_self" ON client_absence_counters FOR SELECT
  USING (auth.uid() = client_id);

CREATE OR REPLACE FUNCTION refresh_client_absence_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_threshold int;
  v_count int;
  v_ticket_id uuid;
BEGIN
  -- threshold parametrizado em app_config (T-346 seedea 3)
  SELECT (value)::int INTO v_threshold
  FROM app_config WHERE key = 'client_absence_review_threshold';
  v_threshold := COALESCE(v_threshold, 3);

  SELECT COUNT(*) INTO v_count
  FROM service_client_absences
  WHERE client_id = NEW.client_id
    AND absence_at >= NOW() - interval '6 months';

  INSERT INTO client_absence_counters (client_id, absences_last_6_months, last_absence_at, "updatedAt")
  VALUES (NEW.client_id, v_count, NEW.absence_at, NOW())
  ON CONFLICT (client_id) DO UPDATE SET
    absences_last_6_months = EXCLUDED.absences_last_6_months,
    last_absence_at = EXCLUDED.last_absence_at,
    "updatedAt" = NOW();

  -- abre review uma unica vez por janela (idempotente)
  IF v_count >= v_threshold THEN
    SELECT review_ticket_id INTO v_ticket_id FROM client_absence_counters WHERE client_id = NEW.client_id;
    IF v_ticket_id IS NULL THEN
      INSERT INTO support_tickets (kind, status, opened_by, subject_user_id, payload)
      VALUES (
        'client_absence_review',
        'pending_admin_review',
        NEW.client_id,
        NEW.client_id,
        jsonb_build_object(
          'absences_count', v_count,
          'window', '6_months',
          'last_absence_at', NEW.absence_at
        )
      ) RETURNING id INTO v_ticket_id;

      UPDATE client_absence_counters
        SET review_ticket_id = v_ticket_id, review_opened_at = NOW()
       WHERE client_id = NEW.client_id;
    END IF;
  END IF;

  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_refresh_client_absence_counter
  AFTER INSERT ON service_client_absences
  FOR EACH ROW EXECUTE FUNCTION refresh_client_absence_counter();

COMMIT;
```

## Constraints / NAO fazer
- NAO suspender cliente automaticamente (decisao e humana — diferenca chave vs T-291 PRESTADOR)
- NAO contar ausencias > 6 meses (janela movel — janela de "boa-fe" parametrizada)
- NAO criar 2o ticket com mesma janela aberta (idempotencia via `review_ticket_id IS NULL`)
- NAO esquecer de seedar `client_absence_review_threshold` em T-346 (default 3)
- NAO chamar este trigger em INSERT de `service_atypical_events` (kind sao independentes — apenas `service_client_absences` e fonte canonica)

## Convencoes
- Pattern espelha T-291 exatamente: contador agregado + ticket admin uma vez por janela
- Reuso `support_tickets` (T-147) com novo `kind='client_absence_review'` — admin US-017 trata decisao
- Migration via psql; `database.types.ts` regenerado
- Smoke: 3o INSERT em `service_client_absences` para mesmo client em 6 meses gera 1 ticket; 4o nao gera novo
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-334 (DATA: compute_cancellation_breakdown + transitions catalog)
('17db05a5-eb41-4921-9947-8461ce9edff9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-334', 'Criar funcao compute_cancellation_breakdown + estender catalogo transitions com cancel_*',
 $desc$## Objetivo
Centralizar o calculo declarativo do split financeiro de cancelamento numa funcao SQL pura, alimentada por `app_config.cancellation_policy` (T-346). Cobre AC #2 (<1h pos-pagamento → 100% cliente), AC #3 (>24h: 90/10; 2-24h: 60/30/10; <2h: 0/90/10), AC #10 (mid-execution: piso 50% prestador, restante reembolsa).

Tambem estende o catalogo `service_status_transitions` (T-225) com transicoes formais que ainda nao existem para `cancelled_by_client_pre_match` (referenciado em T-307) e novas a partir de `pending_adjustment` / `in_progress`.

## Contexto
Modulo EXECUCAO. Funcao consumida por:
- T-335 (`apply_cancellation_policy` chama para gravar snapshot)
- T-336 (GET preview retorna o resultado direto sem mutar estado)
- T-338 (cancel-mid-execution passa `execution_progress_pct`)
- T-339 (watchdog timeout aciona com `window_kind='system_timeout'`)

Funcao retorna sempre os 3 montantes em centavos + window_kind aplicado + ref para policy_key/value usado (snapshot).

## Estado atual / O que substitui
Nao existe. T-225 catalogou transitions mas falta `cancelled_by_client_pre_match`, `cancelled_by_system_timeout`, e `cancelled_by_client_mid_execution` como sub-buckets. Esta task formaliza o split como funcao reusavel.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_cancellation_breakdown.sql`
```sql
BEGIN;

-- 1) Estender catalogo com sub-buckets de cancelamento (audit trail mais granular)
INSERT INTO service_status_transitions (from_status, to_status, actor, reason) VALUES
  ('searching','cancelled_by_client_pre_match','client','Cancela durante busca, sem prestador alocado'),
  ('pending_adjustment','cancelled_by_system','system','Timeout 15min sem decisao do cliente'),
  ('in_progress','cancelled_by_client','client','Cliente decide parar durante execucao')
ON CONFLICT DO NOTHING;

-- (cancelled_by_client_pre_match e estado novo — adicionar ao enum service_status caso ainda nao exista)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'service_status' AND e.enumlabel = 'cancelled_by_client_pre_match') THEN
    ALTER TYPE service_status ADD VALUE 'cancelled_by_client_pre_match';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'service_status' AND e.enumlabel = 'cancelled_by_system') THEN
    ALTER TYPE service_status ADD VALUE 'cancelled_by_system';
  END IF;
END $$;

-- 2) Funcao pura
CREATE OR REPLACE FUNCTION compute_cancellation_breakdown(
  p_total_cents     int,
  p_paid_at         timestamptz,
  p_now             timestamptz,
  p_scheduled_for   timestamptz,
  p_in_execution    boolean,
  p_progress_pct    numeric DEFAULT NULL,
  p_force_majeure   boolean DEFAULT false,
  p_system_timeout  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_policy jsonb;
  v_window cancellation_window_kind;
  v_pct_client int;
  v_pct_provider int;
  v_pct_platform int;
  v_refund int;
  v_payout int;
  v_platform int;
  v_progress numeric;
  v_progress_floor numeric;
BEGIN
  SELECT value INTO v_policy FROM app_config WHERE key = 'cancellation_policy';
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'cancellation_policy not configured' USING ERRCODE = 'P0001';
  END IF;

  -- AC #5: forca maior aprovada -> reembolso integral
  IF p_force_majeure THEN
    v_window := 'force_majeure_override';
    v_pct_client := 100; v_pct_provider := 0; v_pct_platform := 0;
  -- AC #8: timeout sistemico -> reembolso integral + compensacao prestador (paga pela Zelar = platform_fee absorve)
  ELSIF p_system_timeout THEN
    v_window := 'system_timeout';
    v_pct_client := 100; v_pct_provider := 0; v_pct_platform := 0;
  -- AC #10: mid-execution
  ELSIF p_in_execution THEN
    v_window := 'mid_execution';
    v_progress_floor := COALESCE((v_policy -> 'mid_execution' ->> 'min_provider_pct')::numeric, 50);
    v_progress := GREATEST(COALESCE(p_progress_pct, 0), v_progress_floor);
    v_pct_provider := round(v_progress)::int;
    v_pct_platform := COALESCE((v_policy -> 'mid_execution' ->> 'platform_pct')::int, 10);
    v_pct_client := 100 - v_pct_provider - v_pct_platform;
    IF v_pct_client < 0 THEN
      v_pct_client := 0;
      v_pct_provider := 100 - v_pct_platform;
    END IF;
  -- AC #2: <1h pos-pagamento
  ELSIF p_paid_at IS NOT NULL AND p_now <= p_paid_at + interval '1 hour' THEN
    v_window := 'within_1h_post_payment';
    v_pct_client := 100; v_pct_provider := 0; v_pct_platform := 0;
  -- AC #3: janelas baseadas em scheduled_for
  ELSIF p_scheduled_for - p_now > interval '24 hours' THEN
    v_window := 'more_than_24h';
    v_pct_client   := COALESCE((v_policy -> 'more_than_24h' ->> 'client_pct')::int, 90);
    v_pct_provider := COALESCE((v_policy -> 'more_than_24h' ->> 'provider_pct')::int, 0);
    v_pct_platform := COALESCE((v_policy -> 'more_than_24h' ->> 'platform_pct')::int, 10);
  ELSIF p_scheduled_for - p_now > interval '2 hours' THEN
    v_window := 'between_2h_and_24h';
    v_pct_client   := COALESCE((v_policy -> 'between_2h_and_24h' ->> 'client_pct')::int, 60);
    v_pct_provider := COALESCE((v_policy -> 'between_2h_and_24h' ->> 'provider_pct')::int, 30);
    v_pct_platform := COALESCE((v_policy -> 'between_2h_and_24h' ->> 'platform_pct')::int, 10);
  ELSE
    v_window := 'less_than_2h';
    v_pct_client   := COALESCE((v_policy -> 'less_than_2h' ->> 'client_pct')::int, 0);
    v_pct_provider := COALESCE((v_policy -> 'less_than_2h' ->> 'provider_pct')::int, 90);
    v_pct_platform := COALESCE((v_policy -> 'less_than_2h' ->> 'platform_pct')::int, 10);
  END IF;

  v_refund   := round(p_total_cents * v_pct_client::numeric / 100)::int;
  v_payout   := round(p_total_cents * v_pct_provider::numeric / 100)::int;
  v_platform := p_total_cents - v_refund - v_payout; -- garante soma exata

  RETURN jsonb_build_object(
    'window_kind', v_window::text,
    'percentages', jsonb_build_object(
      'client', v_pct_client,
      'provider', v_pct_provider,
      'platform', v_pct_platform
    ),
    'amounts_cents', jsonb_build_object(
      'refund_to_client', v_refund,
      'payout_to_provider', v_payout,
      'platform_fee', v_platform,
      'total', p_total_cents
    ),
    'execution_progress_pct', v_progress,
    'policy_source', jsonb_build_object('key','cancellation_policy','value', v_policy)
  );
END $fn$;

GRANT EXECUTE ON FUNCTION compute_cancellation_breakdown(int, timestamptz, timestamptz, timestamptz, boolean, numeric, boolean, boolean) TO authenticated;

COMMIT;
```

## Constraints / NAO fazer
- NAO hardcoded percentages: tudo vem de `app_config.cancellation_policy` (T-346 seedea defaults)
- NAO usar `now()` dentro da funcao — caller passa `p_now` (testabilidade + idempotencia em retry)
- NAO permitir resultado com soma != p_total_cents (ajuste explicito em `v_platform`)
- NAO fazer side-effect (sem INSERT/UPDATE) — funcao pura para reuso em preview e mutacao
- NAO sobrescrever transitions existentes — usar ON CONFLICT DO NOTHING

## Convencoes
- Funcao `STABLE` (apenas le `app_config`)
- `cancellation_window_kind` enum vive em T-332
- Migration via psql; `database.types.ts` regenerado
- Pattern reusavel: T-150 `decide_dispute` segue ideia similar (split em jsonb)
$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-335 (API: RPC apply_cancellation_policy)
('211f0ba5-907f-4751-b330-a8519af3a210', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-335', 'Implementar RPC apply_cancellation_policy (atomico: snapshot + transition + audit)',
 $desc$## Objetivo
RPC SECURITY DEFINER atomica que orquestra o cancelamento: chama `compute_cancellation_breakdown` (T-334), insere `service_cancellations` (T-332), transita `service_requests` via `transition_service_status` (T-235), insere `service_atypical_events` (T-285) com kind='cancelled' e enfileira notificacoes (T-162). Cobre AC #1, #2, #3, #5, #7 (caso `rejected_adjustment`), #8, #10. Idempotencia por chave `cancel-{sr_id}-{actor}`.

## Contexto
Modulo EXECUCAO. Wrapper transacional usado por:
- T-337 POST /api/services/[id]/cancel (CLIENTE pre-arrival)
- T-338 POST /api/services/[id]/cancel-mid-execution (CLIENTE durante execucao)
- T-339 watchdog scope-change-deadline (passa `system_timeout=true`)
- T-292 (extensao) ao processar `decision='reject'` no scope-change reusa este RPC com reason=rejected_adjustment

A RPC nao chama o gateway (estorno e disparado pelo trigger FSM via service_events → webhook em T-078). Apenas grava snapshot + transita + audit.

## Estado atual / O que substitui
Nao existe. Hoje o cancelamento acontece via `transition_service_status` direto sem snapshot financeiro nem evidencia.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_apply_cancellation_policy.sql`
```sql
CREATE OR REPLACE FUNCTION apply_cancellation_policy(
  p_sr_id            uuid,
  p_actor_user_id    uuid,
  p_actor_kind       text,         -- 'client' | 'provider' | 'system' | 'admin'
  p_reason_kind      cancellation_reason_kind,
  p_reason_details   text,
  p_evidence_paths   text[] DEFAULT ARRAY[]::text[],
  p_progress_pct     numeric DEFAULT NULL,
  p_idempotency_key  text DEFAULT NULL,
  p_force_majeure_pre_approved boolean DEFAULT false,
  p_system_timeout   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_sr             record;
  v_in_execution   boolean;
  v_breakdown      jsonb;
  v_target_status  service_status;
  v_cancellation   uuid;
  v_existing       uuid;
BEGIN
  -- idempotencia
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM service_cancellations
    WHERE service_request_id = p_sr_id;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', true, 'cancellation_id', v_existing);
    END IF;
  END IF;

  SELECT * INTO v_sr FROM service_requests WHERE id = p_sr_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_request not found' USING ERRCODE = 'P0002';
  END IF;

  v_in_execution := v_sr.status IN ('in_progress','awaiting_client_present','pending_adjustment','pending_materials');

  -- breakdown via T-334
  v_breakdown := compute_cancellation_breakdown(
    v_sr.total_amount_cents,
    v_sr.paid_at,
    NOW(),
    v_sr.scheduled_for,
    v_in_execution,
    p_progress_pct,
    p_force_majeure_pre_approved,
    p_system_timeout
  );

  -- target_status por actor + estado
  v_target_status := CASE
    WHEN p_actor_kind = 'system'  THEN 'cancelled_by_system'::service_status
    WHEN p_actor_kind = 'admin'   THEN 'cancelled_by_admin'::service_status
    WHEN p_actor_kind = 'provider'THEN 'cancelled_by_provider'::service_status
    WHEN v_sr.status = 'searching' THEN 'cancelled_by_client_pre_match'::service_status
    ELSE 'cancelled_by_client'::service_status
  END;

  -- snapshot append-only
  INSERT INTO service_cancellations (
    service_request_id, cancelled_by, actor_user_id, reason_kind, reason_details,
    window_kind, policy_snapshot,
    refund_to_client_cents, payout_to_provider_cents, platform_fee_cents, total_amount_cents,
    execution_progress_pct, evidence_paths,
    evidence_review_status
  ) VALUES (
    p_sr_id, p_actor_kind, p_actor_user_id, p_reason_kind, p_reason_details,
    (v_breakdown ->> 'window_kind')::cancellation_window_kind,
    v_breakdown,
    (v_breakdown -> 'amounts_cents' ->> 'refund_to_client')::int,
    (v_breakdown -> 'amounts_cents' ->> 'payout_to_provider')::int,
    (v_breakdown -> 'amounts_cents' ->> 'platform_fee')::int,
    v_sr.total_amount_cents,
    p_progress_pct, p_evidence_paths,
    CASE WHEN p_reason_kind IN ('force_majeure','personal_emergency') AND NOT p_force_majeure_pre_approved
         THEN 'pending'::text ELSE 'not_required'::text END
  ) RETURNING id INTO v_cancellation;

  -- transicao FSM via T-235 (audit + side-effects via trigger T-227)
  PERFORM transition_service_status(
    p_sr_id, v_target_status::text, p_actor_user_id,
    COALESCE(p_idempotency_key, 'cancel-' || p_sr_id::text || '-' || p_actor_kind),
    jsonb_build_object('cancellation_id', v_cancellation, 'reason_kind', p_reason_kind)
  );

  -- audit em service_atypical_events (T-285)
  INSERT INTO service_atypical_events (service_request_id, kind, actor_user_id, payload)
  VALUES (p_sr_id, 'cancelled', p_actor_user_id, v_breakdown);

  -- enfileira notificacoes (T-162) — fire-and-forget
  PERFORM enqueue_notification_event('service.cancelled', p_sr_id, jsonb_build_object(
    'actor', p_actor_kind, 'reason', p_reason_kind, 'breakdown', v_breakdown
  ));

  RETURN jsonb_build_object(
    'idempotent', false,
    'cancellation_id', v_cancellation,
    'target_status', v_target_status::text,
    'breakdown', v_breakdown
  );
END $fn$;

GRANT EXECUTE ON FUNCTION apply_cancellation_policy(uuid,uuid,text,cancellation_reason_kind,text,text[],numeric,text,boolean,boolean) TO authenticated;
```

## Constraints / NAO fazer
- NAO chamar gateway de pagamento aqui — trigger FSM de T-227 emite service_event que dispatcha refund (T-078)
- NAO permitir actor='client' transicionar para `cancelled_by_admin` (matriz target_status filtra)
- NAO regravar service_cancellations: `UNIQUE(service_request_id)` + early return idempotente
- NAO chamar este RPC sem FOR UPDATE no SR (race com matching_rounds / scope-change)
- NAO escrever em service_atypical_events fora do RPC (apenas wrapper centraliza)

## Convencoes
- `SECURITY DEFINER` + `GRANT authenticated`
- Idempotency-key padrao `cancel-{sr_id}-{actor}` (ou `system-timeout-{sr_id}` para watchdog)
- Reuso T-334 (compute), T-235 (transition), T-285 (audit), T-162 (notify)
- Smoke: 2 chamadas com mesma key → segunda retorna `{idempotent:true}` sem 2o INSERT
$desc$,
 'API', 'SISTEMA', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RACE_CONDITION','AUDIT_LOG','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-336 (API: GET preview)
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-336', 'Implementar GET /api/services/[id]/cancellation-preview (breakdown sem mutar)',
 $desc$## Objetivo
Endpoint somente-leitura que retorna o breakdown que seria aplicado se o cliente cancelasse agora — alimenta a tela de confirmacao para mostrar quanto sera reembolsado, retido e por que. Cobre AC #4 (CLIENTE ve breakdown da politica antes de confirmar).

## Contexto
Modulo EXECUCAO. Chamado pelo `CancellationBreakdownCard` (T-342) dentro do `CancelServiceSheet` (T-341). Reusa `compute_cancellation_breakdown` (T-334) sem efeito colateral. Aceita `?progress_pct=NN` opcional para preview de mid-execution. RLS via SELECT em `service_requests` (cliente so ve seu).

## Estado atual / O que substitui
Nao existe. Hoje a UI nao consegue mostrar breakdown antes do confirm.

## O que criar

### `src/app/api/services/[id]/cancellation-preview/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Query = z.object({
  progress_pct: z.coerce.number().min(0).max(100).optional(),
  reason_kind: z.enum([
    'changed_mind','service_mismatch','wrong_provider','rescheduling_needed',
    'force_majeure','personal_emergency','rejected_adjustment','mid_execution_change','other'
  ]).optional(),
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const q = Query.parse(Object.fromEntries(url.searchParams));
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: sr, error } = await supabase
    .from('service_requests')
    .select('id, client_id, status, total_amount_cents, paid_at, scheduled_for')
    .eq('id', params.id)
    .single();
  if (error || !sr) return Response.json({ error: 'not_found' }, { status: 404 });

  const { data: breakdown, error: rpcErr } = await supabase.rpc('compute_cancellation_breakdown', {
    p_total_cents: sr.total_amount_cents,
    p_paid_at: sr.paid_at,
    p_now: new Date().toISOString(),
    p_scheduled_for: sr.scheduled_for,
    p_in_execution: ['in_progress','awaiting_client_present','pending_adjustment','pending_materials'].includes(sr.status),
    p_progress_pct: q.progress_pct ?? null,
    p_force_majeure: q.reason_kind === 'force_majeure' || q.reason_kind === 'personal_emergency',
    p_system_timeout: false,
  });
  if (rpcErr) return Response.json({ error: rpcErr.message }, { status: 400 });

  return Response.json({ service_status: sr.status, breakdown }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

## Constraints / NAO fazer
- NAO mutar nada (somente leitura — funcao STABLE de T-334)
- NAO retornar PII do prestador (so service status + breakdown)
- NAO cachear (Cache-Control no-store) — o breakdown muda no segundo seguinte (faixa <2h)
- NAO permitir GET em SR ja cancelado/concluido — retornar 409 com flag (UI esconde acao)
- NAO confiar no reason_kind do client para liberar force_majeure_override real (UI mostra o numero "se aprovado pela Zelar"; aprovacao final fica em workflow admin)

## Convencoes
- Validacao Zod no servidor
- Erros padronizados: 400 (validacao), 401 (no auth), 404 (RLS oculta), 409 (estado terminal)
- Reuso T-334 RPC; nenhum RPC novo
- AC #4 garante "clareza antes da decisao" — UI deve mostrar percentages + amounts em BRL
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-337 (API: POST cancel)
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-337', 'Implementar POST /api/services/[id]/cancel (CLIENTE pre-execucao + evidencia force majeure)',
 $desc$## Objetivo
Endpoint CLIENTE-side que cancela servico enquanto status NAO e in_progress (pre-arrival, post-aceite mas antes de execucao). Cobre AC #1 (motivo obrigatorio + detalhes opcional), AC #2 (reembolso integral <1h), AC #3 (politica em janelas), AC #5 (force majeure com upload de evidencia → revisao Zelar). Idempotencia por header `Idempotency-Key`. Para `cancel-search` (status='searching') ja existe T-307; este endpoint cobre os demais estados ate `in_progress`.

## Contexto
Modulo EXECUCAO. Wrapper HTTP fino sobre `apply_cancellation_policy` (T-335). Aceita multipart se reason_kind in (force_majeure, personal_emergency) com upload no bucket `service-force-majeure-evidence` (T-346 provisiona). Para casos simples, JSON puro.

Para `in_progress`, usar T-338 (cancel-mid-execution) — endpoint distinto pra exigir `progress_pct`.

## Estado atual / O que substitui
Nao existe endpoint generico de cancelamento. T-307 cobre apenas cancelamento durante busca (`cancel-search`).

## O que criar

### `src/app/api/services/[id]/cancel/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapRpcError } from '@/lib/api/rpc-errors';

const Body = z.object({
  reason_kind: z.enum([
    'changed_mind','service_mismatch','wrong_provider','rescheduling_needed',
    'force_majeure','personal_emergency','other'
  ]),
  reason_details: z.string().max(1000).optional(),
  evidence_paths: z.array(z.string()).max(5).default([]),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  if (body.reason_kind === 'other' && !body.reason_details) {
    return Response.json({ error: 'reason_details_required_for_other' }, { status: 400 });
  }
  if (['force_majeure','personal_emergency'].includes(body.reason_kind) && body.evidence_paths.length === 0) {
    return Response.json({ error: 'evidence_required_for_force_majeure' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // bloqueio: in_progress → usar /cancel-mid-execution
  const { data: sr } = await supabase
    .from('service_requests')
    .select('id, client_id, status')
    .eq('id', params.id)
    .single();
  if (!sr) return Response.json({ error: 'not_found' }, { status: 404 });
  if (sr.client_id !== user.id) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (sr.status === 'in_progress') {
    return Response.json({ error: 'use_mid_execution_endpoint' }, { status: 409 });
  }
  if (String(sr.status).startsWith('cancelled') || sr.status === 'completed') {
    return Response.json({ error: 'terminal_state' }, { status: 409 });
  }

  const { data, error } = await supabase.rpc('apply_cancellation_policy', {
    p_sr_id: params.id,
    p_actor_user_id: user.id,
    p_actor_kind: 'client',
    p_reason_kind: body.reason_kind,
    p_reason_details: body.reason_details ?? null,
    p_evidence_paths: body.evidence_paths,
    p_progress_pct: null,
    p_idempotency_key: idemKey,
    p_force_majeure_pre_approved: false,
    p_system_timeout: false,
  });
  if (error) return mapRpcError(error);
  return Response.json(data, { status: 200 });
}
```

## Constraints / NAO fazer
- NAO permitir cancel em `in_progress` — UI deve usar T-338 (endpoint distinto + UX distinto com piso 50%)
- NAO permitir cancel sem reason_kind (Zod enforces)
- NAO confiar no client para flagar `force_majeure_pre_approved=true` — flag e SEMPRE false aqui; aprovacao final acontece em workflow admin (futuro)
- NAO retornar refund_amount diretamente sem tambem retornar `idempotent` — UI distingue Sonner.success (novo) vs Sonner.info (idempotent)
- NAO esquecer de validar `evidence_paths` (paths relativos ao bucket service-force-majeure-evidence; max 5; tipo PDF/JPG/PNG via storage policy)

## Convencoes
- `Idempotency-Key` header obrigatorio (chave estavel `cancel-{sr_id}` no client)
- Erros: 400 validacao, 401 no auth, 403 RLS/owner, 404, 409 estado terminal
- Sonner.info quando `idempotent:true` (memory generalizations: nao tratar duplicata como erro)
- Reuso `mapRpcError` (existing pattern de T-235)
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RATE_LIMIT','RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-338 (API: POST cancel-mid-execution)
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-338', 'Implementar POST /api/services/[id]/cancel-mid-execution (piso 50% prestador)',
 $desc$## Objetivo
Endpoint exclusivo para cancelamento durante `in_progress` — calcula percentual ja executado (com piso 50%), aplica split proporcional ao prestador e reembolsa o restante ao cliente. Cobre AC #10.

## Contexto
Modulo EXECUCAO. Endpoint distinto de T-337 porque a UX e diferente (cliente ja viu o servico comecar; piso 50% para evitar abuso) e o body exige `progress_pct` calculado pelo backend a partir de checkpoints da execucao (T-228 service_events kind='step_*') — UI nao deve confiar em valor enviado pelo CLIENTE; backend recalcula.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/services/[id]/cancel-mid-execution/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapRpcError } from '@/lib/api/rpc-errors';

const Body = z.object({
  reason_kind: z.enum([
    'mid_execution_change','service_mismatch','force_majeure','personal_emergency','other'
  ]).default('mid_execution_change'),
  reason_details: z.string().max(1000).optional(),
  evidence_paths: z.array(z.string()).max(5).default([]),
});

async function computeProgressPct(supabase: any, srId: string): Promise<number> {
  // Le service_events emitidos pelo PRESTADOR (T-228) e deduce % executado.
  // checkpoints: started=10, midpoint=50, finishing=80; sem checkpoint -> 50 (piso)
  const { data } = await supabase
    .from('service_events')
    .select('event_kind, created_at')
    .eq('service_request_id', srId)
    .in('event_kind', ['step_started','step_midpoint','step_finishing','step_completed'])
    .order('created_at', { ascending: false })
    .limit(1);
  switch (data?.[0]?.event_kind) {
    case 'step_completed': return 100;
    case 'step_finishing': return 80;
    case 'step_midpoint':  return 50;
    case 'step_started':   return 25;
    default: return 50; // piso AC #10
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: sr } = await supabase
    .from('service_requests')
    .select('id, client_id, status')
    .eq('id', params.id)
    .single();
  if (!sr) return Response.json({ error: 'not_found' }, { status: 404 });
  if (sr.client_id !== user.id) return Response.json({ error: 'forbidden' }, { status: 403 });
  if (sr.status !== 'in_progress') return Response.json({ error: 'not_in_execution' }, { status: 409 });

  const progress = await computeProgressPct(supabase, params.id);

  const { data, error } = await supabase.rpc('apply_cancellation_policy', {
    p_sr_id: params.id,
    p_actor_user_id: user.id,
    p_actor_kind: 'client',
    p_reason_kind: body.reason_kind,
    p_reason_details: body.reason_details ?? null,
    p_evidence_paths: body.evidence_paths,
    p_progress_pct: progress,
    p_idempotency_key: idemKey,
    p_force_majeure_pre_approved: false,
    p_system_timeout: false,
  });
  if (error) return mapRpcError(error);
  return Response.json({ ...data, computed_progress_pct: progress }, { status: 200 });
}
```

## Constraints / NAO fazer
- NAO confiar no `progress_pct` enviado pelo CLIENTE — backend recalcula a partir de service_events (anti-abuso)
- NAO permitir status != in_progress (UI usa T-337)
- NAO usar piso < 50% em hipotese alguma — AC #10 e explicito
- NAO retornar payment_url novo — refund e disparado pelo trigger FSM via service_events (T-078)

## Convencoes
- Reuso `apply_cancellation_policy` com `p_progress_pct` derivado (separar contrato externo do calculo)
- Retorna `computed_progress_pct` para UI mostrar feedback
- Smoke: cliente que cancela com 0 step events recebe split 50/40/10 (piso)
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RATE_LIMIT','RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-339 (API: Edge Function watchdog)
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-339', 'Implementar Edge Function scope-change-deadline-watchdog (timeout 15min)',
 $desc$## Objetivo
Edge Function periodica (pg_cron a cada 1min via T-346) que detecta SRs em `pending_adjustment` ha >15min sem decisao do cliente e cancela automaticamente com `system_timeout=true` (reembolso integral + compensacao prestador deslocamento via politica). Cobre AC #8 (CLIENTE nao responde reajuste em 15min → cancelamento automatico).

## Contexto
Modulo EXECUCAO. Reusa o pattern de watchdog de T-297 (`provider-inactivity-watchdog`) e T-298. Le `service_pending_states` (T-231) com kind=`scope_change_decision` e expirados. Para cada um, chama `apply_cancellation_policy` com `p_actor_kind='system', p_system_timeout=true, p_idempotency_key='system-timeout-{sr_id}'`.

Tambem cobre o caso de proposta de material/revisita timeout — `service_pending_states.kind` pode ser `scope_change_decision` ou `material_decision` ou `revisit_decision`. Se T-292/T-293/T-294 inserem pending_state com deadline 15min, este watchdog cobre todos uniformemente.

## Estado atual / O que substitui
Nao existe. T-292 (`scope-change/decide`) e RPC mas nao tem watchdog. Hoje SR fica em `pending_adjustment` indefinidamente.

## O que criar

### `supabase/functions/scope-change-deadline-watchdog/index.ts`
```typescript
// Deno Edge Function — invocada a cada minuto via pg_cron net.http_post (T-346)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

export default async function (req: Request): Promise<Response> {
  // expirados: deadline_at <= now() AND state = 'pending'
  const { data: expired, error } = await supabase
    .from('service_pending_states')
    .select('service_request_id, kind, deadline_at')
    .lte('deadline_at', new Date().toISOString())
    .eq('state', 'pending')
    .in('kind', ['scope_change_decision','material_decision','revisit_decision','additional_item_decision'])
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });

  const results: any[] = [];
  for (const p of expired ?? []) {
    const { data, error: rpcErr } = await supabase.rpc('apply_cancellation_policy', {
      p_sr_id: p.service_request_id,
      p_actor_user_id: null,
      p_actor_kind: 'system',
      p_reason_kind: 'rejected_adjustment', // AC #8: timeout = recusa implicita
      p_reason_details: `Timeout 15min em ${p.kind}`,
      p_evidence_paths: [],
      p_progress_pct: null,
      p_idempotency_key: `system-timeout-${p.service_request_id}-${p.kind}`,
      p_force_majeure_pre_approved: false,
      p_system_timeout: true,
    });
    results.push({ sr: p.service_request_id, ok: !rpcErr, error: rpcErr?.message });
  }
  return Response.json({ processed: results.length, results });
}
```

## Constraints / NAO fazer
- NAO chamar este watchdog inline da UI — somente via pg_cron (T-346)
- NAO usar service_role no client (Edge Function so)
- NAO repetir cancelamento: idempotency_key estavel `system-timeout-{sr_id}-{kind}` deduplica
- NAO permitir batch >100 (DoS guard) — proxima execucao processa restante
- NAO disparar `compensation_to_provider` aqui — a flag `system_timeout=true` em T-334 ja calcula 100% reembolso ao cliente; compensacao do prestador (deslocamento) e absorvida pela Zelar via `platform_fee=0`. Pattern: forca maior + sistema absorvem custo.

## Convencoes
- Pattern espelha T-297 (provider-inactivity-watchdog) e T-298 (provider-noshow-realloc)
- Logging estruturado por SR (lifecycle dispatcher pattern de T-234)
- Idempotency-Key garante reentrancia segura
- Smoke local: insere pending_state com deadline_at = now() - 1min, executa funcao, SR transita para `cancelled_by_system`
$desc$,
 'API', 'SISTEMA', ARRAY['IDEMPOTENCY_KEY','SECRET_HANDLING','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-340 (API: POST open-dispute-from-cancel)
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-340', 'Implementar POST /api/services/[id]/open-dispute-from-cancel (promove cancel a disputa)',
 $desc$## Objetivo
Permitir que CLIENTE promova um cancelamento existente (proprio ou do PRESTADOR/SISTEMA) a disputa explicita — cancelamento contestado, ausencia contestada ou valor de execucao em disputa. Cobre AC #12 (cancelamento e disputa sao fluxos separados; status nao muda automaticamente entre eles).

## Contexto
Modulo EXECUCAO. Reuso de `open_service_ticket` (T-325 RPC base) com `kind='dispute_cancel'` + linka `service_cancellations.disputed_ticket_id`. Mantem o status do SR (cancelled_by_*) — apenas `support_tickets` ganha entrada `pending_admin_review`. Diferencia-se de T-325 (open-dispute pos-completed) porque o gate temporal aqui e diferente: pode ser aberta ate 7d apos cancelamento (parametro `dispute_cancel_window_days` em app_config) ao inves de 30d apos completed.

## Estado atual / O que substitui
Nao existe. T-325 cobre "abrir disputa pos-completed"; aqui cobrimos "abrir disputa pos-cancelled".

## O que criar

### `src/app/api/services/[id]/open-dispute-from-cancel/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapRpcError } from '@/lib/api/rpc-errors';

const Body = z.object({
  dispute_kind: z.enum([
    'contested_cancellation', // cliente discorda do split aplicado
    'contested_absence',      // cliente nega ausencia registrada pelo prestador
    'contested_execution_value', // cliente discorda do percentual mid-execution
  ]),
  description: z.string().min(20).max(2000),
  evidence_paths: z.array(z.string()).max(10).default([]),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // RPC SECURITY DEFINER que valida estado-cancelado, gate 7d e cria ticket
  const { data, error } = await supabase.rpc('open_dispute_from_cancellation', {
    p_sr_id: params.id,
    p_actor_user_id: user.id,
    p_dispute_kind: body.dispute_kind,
    p_description: body.description,
    p_evidence_paths: body.evidence_paths,
    p_idempotency_key: idemKey,
  });
  if (error) return mapRpcError(error);
  return Response.json(data, { status: 200 });
}
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_open_dispute_from_cancel_rpc.sql`
```sql
CREATE OR REPLACE FUNCTION open_dispute_from_cancellation(
  p_sr_id          uuid,
  p_actor_user_id  uuid,
  p_dispute_kind   text,
  p_description    text,
  p_evidence_paths text[],
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_cancel record;
  v_window_days int;
  v_ticket_id uuid;
BEGIN
  SELECT (value)::int INTO v_window_days FROM app_config WHERE key = 'dispute_cancel_window_days';
  v_window_days := COALESCE(v_window_days, 7);

  SELECT * INTO v_cancel FROM service_cancellations WHERE service_request_id = p_sr_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_cancellation_to_dispute' USING ERRCODE = 'P0002';
  END IF;
  IF v_cancel."createdAt" + (v_window_days || ' days')::interval < NOW() THEN
    RAISE EXCEPTION 'dispute_window_expired' USING ERRCODE = 'P0003';
  END IF;
  IF v_cancel.disputed_ticket_id IS NOT NULL THEN
    RETURN jsonb_build_object('idempotent', true, 'ticket_id', v_cancel.disputed_ticket_id);
  END IF;

  INSERT INTO support_tickets (kind, status, opened_by, subject_user_id, payload, related_service_request_id)
  VALUES (
    'dispute_cancel',
    'pending_admin_review',
    p_actor_user_id,
    p_actor_user_id,
    jsonb_build_object(
      'dispute_kind', p_dispute_kind,
      'description', p_description,
      'evidence_paths', p_evidence_paths,
      'cancellation_id', v_cancel.id,
      'idempotency_key', p_idempotency_key
    ),
    p_sr_id
  ) RETURNING id INTO v_ticket_id;

  UPDATE service_cancellations SET disputed_ticket_id = v_ticket_id WHERE id = v_cancel.id;

  RETURN jsonb_build_object('idempotent', false, 'ticket_id', v_ticket_id);
END $fn$;

GRANT EXECUTE ON FUNCTION open_dispute_from_cancellation(uuid,uuid,text,text,text[],text) TO authenticated;
```

## Constraints / NAO fazer
- NAO mudar `service_requests.status` (AC #12 explicita: status nao muda automaticamente entre cancel/dispute)
- NAO permitir 2a disputa do mesmo cancelamento (`disputed_ticket_id` UNIQUE pela coluna)
- NAO confundir com T-325 (open-dispute pos-completed) — gate temporal diferente, kind diferente
- NAO permitir abertura sem cancelamento previo (RAISE P0002)
- NAO permitir disputa apos `dispute_cancel_window_days` (default 7d, parametrizado em T-346)

## Convencoes
- Reuso `support_tickets` schema de T-147
- Idempotency-Key obrigatorio (header)
- 410 Gone quando window expirado
- Pattern espelha T-325 (open-dispute) com gate diferente
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RATE_LIMIT','AUDIT_LOG','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-341 (UI: CancelServiceSheet)
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-341', 'Renderizar CancelServiceSheet (motivo + breakdown + evidencia force majeure)',
 $desc$## Objetivo
ResponsiveSheet acionado pelo botao "Cancelar servico" no detalhe do servico (T-328) e na tela /services/[id]/tracking (US-012). Permite o CLIENTE selecionar motivo (radio), descrever detalhes (textarea), anexar evidencia (force majeure/personal emergency) e confirmar com o `CancellationBreakdownCard` (T-342) inline mostrando reembolso. Cobre AC #1 (motivo obrigatorio + detalhes opcional), AC #4 (breakdown antes do confirm), AC #5 (UI de evidencia para force majeure).

## Contexto
Modulo EXECUCAO. Reuso forte:
- `ResponsiveSheet` size="md" (sem Dialog cru)
- `Field` compound API com Radio + Textarea + Input file
- `useOptimisticCollection`? Nao — cancel e mutation pontual; usa `useState` + ConfirmDialog antes do fetch
- `ConfirmDialog` (proibido window.confirm) com `destructive=true`
- `CancellationBreakdownCard` (T-342) inline
- `Sonner` para erros + sucesso
- Upload via `supabase.storage.from('service-force-majeure-evidence').upload(...)` (bucket de T-346)
- POST /api/services/[id]/cancel (T-337) com `Idempotency-Key: cancel-{sr_id}`

Para `in_progress`, este sheet redireciona para T-343 `MidExecutionCancelSheet` (variante).

## Estado atual / O que substitui
Nao existe. UI de cancel e ausente — botao no detalhe (T-328) so existe placeholder.

## O que criar

### `src/components/(client)/services/CancelServiceSheet.tsx`
```tsx
'use client';

import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CancellationBreakdownCard } from './CancellationBreakdownCard';
import { showErrorToast } from '@/lib/optimistic/toast';
import { fetchOrThrow } from '@/lib/fetch-or-throw';
import { toast } from 'sonner';
import { useState } from 'react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  serviceStatus: string; // se 'in_progress', UI redireciona para MidExecutionCancelSheet
  onCancelled?: () => void;
};

const REASONS = [
  { v: 'changed_mind', label: 'Troquei de ideia' },
  { v: 'service_mismatch', label: 'Nao e o servico que precisava' },
  { v: 'wrong_provider', label: 'Prestador errado / nao serve' },
  { v: 'rescheduling_needed', label: 'Preciso remarcar' },
  { v: 'force_majeure', label: 'Forca maior (clima/emergencia coletiva)' },
  { v: 'personal_emergency', label: 'Emergencia pessoal' },
  { v: 'other', label: 'Outro (descreva)' },
] as const;

export function CancelServiceSheet({ open, onOpenChange, serviceId, serviceStatus, onCancelled }: Props) {
  const [reason, setReason] = useState<string>('changed_mind');
  const [details, setDetails] = useState('');
  const [evidencePaths, setEvidencePaths] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | { onConfirm: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

  const requiresEvidence = reason === 'force_majeure' || reason === 'personal_emergency';
  const requiresDetails = reason === 'other';

  async function handleSubmit() {
    if (requiresDetails && !details.trim()) {
      toast.error('Descreva o motivo no campo de detalhes');
      return;
    }
    if (requiresEvidence && evidencePaths.length === 0) {
      toast.error('Anexe ao menos uma evidencia para forca maior');
      return;
    }
    setConfirm({
      onConfirm: async () => {
        setBusy(true);
        try {
          const data = await fetchOrThrow(`/api/services/${serviceId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `cancel-${serviceId}` },
            body: JSON.stringify({ reason_kind: reason, reason_details: details || undefined, evidence_paths: evidencePaths }),
          });
          if (data?.idempotent) toast.info('Cancelamento ja registrado');
          else toast.success('Servico cancelado');
          onCancelled?.();
          onOpenChange(false);
        } catch (e) { showErrorToast({ type: 'cancel', id: serviceId } as any, e); }
        finally { setBusy(false); }
      },
    });
  }

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
        <ResponsiveSheet.Header>Cancelar servico</ResponsiveSheet.Header>
        <ResponsiveSheet.Body>
          <FormBody density="comfortable">
            <Field name="reason" required>
              <Field.Label>Motivo do cancelamento</Field.Label>
              <Field.Control>
                <RadioGroup value={reason} onChange={setReason} options={REASONS} />
              </Field.Control>
            </Field>
            <Field name="details" required={requiresDetails}>
              <Field.Label>Detalhes {requiresDetails ? '(obrigatorio)' : '(opcional)'}</Field.Label>
              <Field.Control>
                <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
              </Field.Control>
            </Field>
            {requiresEvidence && (
              <Field name="evidence" required>
                <Field.Label>Evidencia (foto/PDF)</Field.Label>
                <Field.Control>
                  <EvidenceUploader bucket="service-force-majeure-evidence" onChange={setEvidencePaths} />
                </Field.Control>
                <Field.Hint>Sera revisada pela equipe Zelar.</Field.Hint>
              </Field>
            )}
            <CancellationBreakdownCard serviceId={serviceId} reasonKind={reason} />
          </FormBody>
        </ResponsiveSheet.Body>
        <ResponsiveSheet.Footer>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={busy}>Confirmar cancelamento</Button>
        </ResponsiveSheet.Footer>
      </ResponsiveSheet>
      <ConfirmDialog
        state={confirm ? {
          title: 'Confirmar cancelamento',
          description: 'Esta acao aplica a politica de cancelamento mostrada acima. Continuar?',
          destructive: true,
          confirmLabel: 'Cancelar servico',
          cancelLabel: 'Voltar',
          onConfirm: confirm.onConfirm,
        } : null}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
```

## Constraints / NAO fazer
- NAO usar `<Dialog>` ou `<Sheet>` cru — sempre `ResponsiveSheet`
- NAO usar `window.confirm` — sempre `ConfirmDialog`
- NAO validar Zod no client — backend valida
- NAO subir evidencia direto pro endpoint de cancel — upload primeiro pro bucket, manda paths
- NAO mostrar breakdown estatico — o card chama `/api/services/[id]/cancellation-preview` (T-336) e atualiza ao mudar reason

## Convencoes
- Reuso `ResponsiveSheet`, `ConfirmDialog`, `Field`/`FormBody`, `Sonner`, `Button`
- Mobile-first; tap target >=44px
- Idempotency-Key estavel `cancel-{sr_id}`
- Sem react-hook-form

## qualityFlags
REUSE_EXISTING_COMPONENT, RESPONSIVE_SHEET_REQUIRED, CONFIRM_DIALOG_REQUIRED, FIELD_COMPOUND_API
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-342 (UI: CancellationBreakdownCard)
('790efa6b-4058-4494-ae71-200acd7afe36', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-342', 'Renderizar CancellationBreakdownCard (componente compartilhado entre Sheet e Detail)',
 $desc$## Objetivo
Componente reutilizavel que renderiza o breakdown de cancelamento (percentages + amounts em BRL + window_kind humanizado) consumindo `/api/services/[id]/cancellation-preview` (T-336). Cobre AC #4 (breakdown claro antes da decisao). Usado em:
- `CancelServiceSheet` (T-341) — preview pre-confirm
- `MidExecutionCancelSheet` (T-343) — preview com piso 50%
- `ServiceCancelledDetail` (T-330) — leitura do snapshot pos-cancelamento

## Contexto
Modulo EXECUCAO. Componente client-only que aceita `serviceId`, `reasonKind` (opcional, muda o resultado em force_majeure), `progressPct` (opcional para mid-execution) e retorna o breakdown formatado. Mostra:
- Janela aplicada (humanizada: "Mais de 24h antes", "Entre 2h e 24h", "Menos de 2h", "Forca maior", "Durante execucao")
- Total cobrado em BRL
- Reembolso ao cliente (destaque)
- Retido pelo prestador (subtitle: deslocamento/execucao parcial)
- Taxa Zelar
- Disclaimer sobre force majeure ("Sera revisado pela equipe — reembolso integral se aprovado")

## Estado atual / O que substitui
Nao existe. T-330 (`ServiceCancelledDetail`) renderiza inline; aqui extraimos como componente compartilhado.

## O que criar

### `src/components/(client)/services/CancellationBreakdownCard.tsx`
```tsx
'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';

type Breakdown = {
  window_kind: string;
  percentages: { client: number; provider: number; platform: number };
  amounts_cents: { refund_to_client: number; payout_to_provider: number; platform_fee: number; total: number };
  execution_progress_pct?: number;
};

const WINDOW_LABELS: Record<string, string> = {
  within_1h_post_payment: 'Cancelamento em ate 1h apos pagamento',
  more_than_24h: 'Mais de 24h antes do servico',
  between_2h_and_24h: 'Entre 2h e 24h antes do servico',
  less_than_2h: 'Menos de 2h antes do servico',
  pre_match: 'Antes da alocacao do prestador',
  mid_execution: 'Durante a execucao do servico',
  force_majeure_override: 'Forca maior (sujeito a aprovacao)',
  system_timeout: 'Tempo expirado para resposta',
};

const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export function CancellationBreakdownCard({
  serviceId, reasonKind, progressPct, snapshot,
}: { serviceId: string; reasonKind?: string; progressPct?: number; snapshot?: Breakdown }) {
  const [data, setData] = useState<Breakdown | null>(snapshot ?? null);
  const [loading, setLoading] = useState(!snapshot);

  useEffect(() => {
    if (snapshot) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (reasonKind) params.set('reason_kind', reasonKind);
    if (progressPct != null) params.set('progress_pct', String(progressPct));
    fetch(`/api/services/${serviceId}/cancellation-preview?${params}`, { cache: 'no-store' })
      .then((r) => r.json()).then((j) => setData(j.breakdown)).finally(() => setLoading(false));
  }, [serviceId, reasonKind, progressPct, snapshot]);

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!data) return null;

  return (
    <Card className="p-4">
      <div className="text-sm font-medium">{WINDOW_LABELS[data.window_kind] ?? data.window_kind}</div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt>Total do servico</dt><dd className="text-right">{brl(data.amounts_cents.total)}</dd>
        <dt className="font-medium text-green-700">Reembolso ao voce</dt>
        <dd className="text-right font-medium text-green-700">{brl(data.amounts_cents.refund_to_client)} ({data.percentages.client}%)</dd>
        <dt>Compensacao ao prestador</dt>
        <dd className="text-right">{brl(data.amounts_cents.payout_to_provider)} ({data.percentages.provider}%)</dd>
        <dt>Taxa Zelar</dt>
        <dd className="text-right">{brl(data.amounts_cents.platform_fee)} ({data.percentages.platform}%)</dd>
      </dl>
      {data.window_kind === 'force_majeure_override' && (
        <p className="mt-3 text-xs text-amber-700">
          Reembolso integral sujeito a validacao da equipe Zelar. Caso nao aprovada, a politica de janela sera aplicada.
        </p>
      )}
      {data.window_kind === 'mid_execution' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Percentual minimo do prestador: 50% (regra de execucao parcial).
        </p>
      )}
    </Card>
  );
}
```

## Constraints / NAO fazer
- NAO duplicar logica de calculo no client — sempre via T-336 (ou snapshot pos-fato em T-330)
- NAO cachear resposta — `cache: 'no-store'`
- NAO inventar valores em fallback (loading exibe Skeleton, nao 0)
- NAO usar `setState` direto sem fetch — caller controla loading via prop opcional `snapshot`

## Convencoes
- Reuso: `Card`, `Skeleton` do design system
- Formatacao BRL via `Intl.NumberFormat`
- Mobile-first
- Sem optimistic update (read-only)

## qualityFlags
REUSE_EXISTING_COMPONENT, MOBILE_FIRST
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-343 (UI: MidExecutionCancelSheet)
('5382d2e0-43ed-4313-8118-28232d490808', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-343', 'Renderizar MidExecutionCancelSheet (variante com piso 50% + percentual ao vivo)',
 $desc$## Objetivo
Variante do `CancelServiceSheet` (T-341) acionada quando `service.status === 'in_progress'`. Mostra explicitamente o percentual ja executado (calculado pelo backend a partir de service_events), aplica piso 50% e exige confirmacao destrutiva. Cobre AC #10 (calculo automatico do percentual + piso 50%).

## Contexto
Modulo EXECUCAO. Aciona POST /api/services/[id]/cancel-mid-execution (T-338) — endpoint distinto que recalcula `progress_pct` server-side (anti-abuso). Reusa `CancellationBreakdownCard` (T-342) com `progressPct` derivado do response (preview). Sem upload de evidencia (mid-execution nao usa force_majeure path; pra forca maior + mid-execution, abrir disputa via T-345 depois).

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/components/(client)/services/MidExecutionCancelSheet.tsx`
```tsx
'use client';

import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormBody } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CancellationBreakdownCard } from './CancellationBreakdownCard';
import { showErrorToast } from '@/lib/optimistic/toast';
import { fetchOrThrow } from '@/lib/fetch-or-throw';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';

export function MidExecutionCancelSheet({
  open, onOpenChange, serviceId, onCancelled,
}: { open: boolean; onOpenChange: (o: boolean) => void; serviceId: string; onCancelled?: () => void }) {
  const [details, setDetails] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<null | { onConfirm: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/services/${serviceId}/cancellation-preview`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setProgress(j.breakdown?.execution_progress_pct ?? 50));
  }, [open, serviceId]);

  async function submit() {
    setConfirm({
      onConfirm: async () => {
        setBusy(true);
        try {
          const data = await fetchOrThrow(`/api/services/${serviceId}/cancel-mid-execution`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `cancel-mid-${serviceId}` },
            body: JSON.stringify({ reason_kind: 'mid_execution_change', reason_details: details || undefined }),
          });
          if (data?.idempotent) toast.info('Cancelamento ja registrado');
          else toast.success(`Servico interrompido (${data.computed_progress_pct}% executado)`);
          onCancelled?.();
          onOpenChange(false);
        } catch (e) { showErrorToast({ type: 'cancel-mid', id: serviceId } as any, e); }
        finally { setBusy(false); }
      },
    });
  }

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
        <ResponsiveSheet.Header>Interromper servico em andamento</ResponsiveSheet.Header>
        <ResponsiveSheet.Body>
          <FormBody density="comfortable">
            <p className="text-sm text-muted-foreground">
              Voce esta cancelando um servico ja iniciado. O prestador recebera valor proporcional ao executado, com minimo de 50% (regra fixa).
            </p>
            <Field name="details">
              <Field.Label>Por que voce quer interromper?</Field.Label>
              <Field.Control>
                <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
              </Field.Control>
              <Field.Hint>Para contestar o percentual, abra disputa apos o cancelamento (botao no detalhe).</Field.Hint>
            </Field>
            <CancellationBreakdownCard serviceId={serviceId} progressPct={progress ?? undefined} />
          </FormBody>
        </ResponsiveSheet.Body>
        <ResponsiveSheet.Footer>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>Interromper servico</Button>
        </ResponsiveSheet.Footer>
      </ResponsiveSheet>
      <ConfirmDialog
        state={confirm ? {
          title: 'Interromper servico em andamento?',
          description: 'A regra de execucao parcial sera aplicada. Voce podera abrir disputa apos a interrupcao.',
          destructive: true,
          confirmLabel: 'Interromper',
          cancelLabel: 'Voltar',
          onConfirm: confirm.onConfirm,
        } : null}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
```

## Constraints / NAO fazer
- NAO permitir o usuario editar `progress_pct` no UI — backend calcula e retorna
- NAO mostrar < 50% nunca (piso AC #10)
- NAO redirecionar para CancelServiceSheet quando status='in_progress' — UX confusa (forka quem chama o botao)

## Convencoes
- Reuso `ResponsiveSheet`, `ConfirmDialog`, `Field`/`FormBody`, `CancellationBreakdownCard` (T-342)
- Mobile-first
- Idempotency-Key estavel `cancel-mid-{sr_id}`

## qualityFlags
REUSE_EXISTING_COMPONENT, RESPONSIVE_SHEET_REQUIRED, CONFIRM_DIALOG_REQUIRED, FIELD_COMPOUND_API
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-344 (UI: ClientDecisionDialog timeout countdown)
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-344', 'Estender ClientDecisionDialog (T-303) com countdown 15min + auto-cancel feedback',
 $desc$## Objetivo
Adicionar UX explicito de countdown 15min + tratamento UI quando o tempo expira (toast + fechamento + refresh do detalhe). Cobre AC #6 (CLIENTE ve "15min" para reajuste com divergencia + foto + valor sugerido — extensao visual ao polimorfico T-303), AC #7 (UI feedback do reembolso ao recusar), AC #8 (auto-cancel ao timeout — UI mostra Sonner.warning quando watchdog T-339 atinge).

## Contexto
Modulo EXECUCAO. T-303 ja renderiza ResponsiveDialog polimorfico para scope/material/revisit/additional. Aqui adicionamos:
1. Countdown visivel (mm:ss) sincronizado com `service_pending_states.deadline_at`
2. Toast de aviso aos 5min restantes (`Sonner.warning('Voce tem 5min para decidir')`)
3. Quando `deadline_at <= now()`: mostra estado "Tempo expirado" + Sonner.error + chama `onClose` apos 3s + dispara refresh do detalhe (T-339 watchdog ja cancelou server-side; UI apenas reflete)
4. Apos `decision='reject'` em scope_change: mostra Sonner.success com `refund_amount` retornado pelo POST /scope-change/decide (AC #7)

## Estado atual / O que substitui
T-303 ja existe. Esta task estende sem duplicar (extensao visual). NAO cria novo componente.

## O que criar

### Modificar `src/components/(client)/services/ClientDecisionDialog.tsx`
```tsx
// Adicionar:

import { useDeadlineCountdown } from '@/hooks/use-deadline-countdown';
import { toast } from 'sonner';

export function ClientDecisionDialog({ proposal, onClose }: Props) {
  const { mmss, expired, secondsLeft } = useDeadlineCountdown(proposal.deadline_at);

  useEffect(() => {
    if (secondsLeft === 5 * 60) toast.warning('Voce tem 5min para decidir');
  }, [secondsLeft]);

  useEffect(() => {
    if (expired) {
      toast.error('Tempo expirado. O servico sera cancelado automaticamente.');
      const t = setTimeout(() => onClose(), 3000);
      return () => clearTimeout(t);
    }
  }, [expired, onClose]);

  // ... existing render with new countdown chip:
  return (
    <ResponsiveDialog open onOpenChange={onClose}>
      <ResponsiveDialog.Header>
        Proposta {proposal.kind} - <span data-countdown className={expired ? 'text-destructive' : ''}>{mmss}</span>
      </ResponsiveDialog.Header>
      {/* ... */}
    </ResponsiveDialog>
  );
}
```

### Criar hook `src/hooks/use-deadline-countdown.ts`
```ts
import { useEffect, useState } from 'react';

export function useDeadlineCountdown(deadlineIso: string) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(deadlineIso).getTime() - Date.now()) / 1000))
  );
  useEffect(() => {
    const t = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((new Date(deadlineIso).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [deadlineIso]);
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  return { mmss: `${mm}:${ss}`, expired: secondsLeft <= 0, secondsLeft };
}
```

## Constraints / NAO fazer
- NAO duplicar T-303 — esta task SO estende
- NAO cancelar server-side a partir do client (apenas UI feedback; watchdog T-339 cancela)
- NAO mostrar countdown se `deadline_at` ja passou (componente parent deve esconder dialog inteiro nesse caso)
- NAO depender de Realtime para o countdown (intervalo local de 1s ja basta)

## Convencoes
- Reuso `ResponsiveDialog`, `Sonner`
- Hook simples (sem libs); cleanup correto
- Tap target mantem >=44px

## qualityFlags
REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK, RESPONSIVE_SHEET_REQUIRED, MOBILE_FIRST
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-345 (UI: OpenDisputeFromCancelSheet)
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-345', 'Renderizar OpenDisputeFromCancelSheet (botao no ServiceCancelledDetail)',
 $desc$## Objetivo
ResponsiveSheet acionado pelo botao "Abrir disputa" no `ServiceCancelledDetail` (T-330). Permite o CLIENTE descrever a divergencia (cancelamento contestado, ausencia contestada, valor de execucao em disputa), anexar evidencias e abrir ticket via T-340. Cobre AC #12 (CLIENTE consegue abrir disputa explicitamente; cancelamento e disputa sao fluxos separados).

## Contexto
Modulo EXECUCAO. Reusa `ResponsiveSheet`, `Field`, `Textarea`, `EvidenceUploader` (criado em T-341). Estende `ServiceCancelledDetail` (T-330) adicionando botao quando `dispute_cancel_window_days` (default 7d) ainda esta aberto e `disputed_ticket_id IS NULL`.

POST /api/services/[id]/open-dispute-from-cancel (T-340) com `Idempotency-Key: dispute-cancel-{sr_id}`.

## Estado atual / O que substitui
Nao existe. T-330 atualmente nao tem o botao.

## O que criar

### `src/components/(client)/services/OpenDisputeFromCancelSheet.tsx`
```tsx
'use client';

import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormBody } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { showErrorToast } from '@/lib/optimistic/toast';
import { fetchOrThrow } from '@/lib/fetch-or-throw';
import { toast } from 'sonner';
import { useState } from 'react';

const KINDS = [
  { v: 'contested_cancellation', label: 'Discordo do split aplicado' },
  { v: 'contested_absence', label: 'Nao houve ausencia / nao fui notificado' },
  { v: 'contested_execution_value', label: 'Discordo do percentual executado' },
] as const;

export function OpenDisputeFromCancelSheet({
  open, onOpenChange, serviceId, onOpened,
}: { open: boolean; onOpenChange: (o: boolean) => void; serviceId: string; onOpened?: (ticketId: string) => void }) {
  const [kind, setKind] = useState<string>('contested_cancellation');
  const [description, setDescription] = useState('');
  const [evidencePaths, setEvidencePaths] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | { onConfirm: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (description.trim().length < 20) { toast.error('Descreva a divergencia (min 20 caracteres)'); return; }
    setConfirm({ onConfirm: async () => {
      setBusy(true);
      try {
        const data = await fetchOrThrow(`/api/services/${serviceId}/open-dispute-from-cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `dispute-cancel-${serviceId}` },
          body: JSON.stringify({ dispute_kind: kind, description, evidence_paths: evidencePaths }),
        });
        if (data?.idempotent) toast.info('Disputa ja aberta. Equipe Zelar respondera em ate 24h.');
        else toast.success('Disputa aberta. Equipe Zelar respondera em ate 24h.');
        onOpened?.(data.ticket_id);
        onOpenChange(false);
      } catch (e) { showErrorToast({ type: 'dispute-cancel', id: serviceId } as any, e); }
      finally { setBusy(false); }
    }});
  }

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
        <ResponsiveSheet.Header>Abrir disputa do cancelamento</ResponsiveSheet.Header>
        <ResponsiveSheet.Body>
          <FormBody density="comfortable">
            <Field name="kind" required>
              <Field.Label>Tipo de divergencia</Field.Label>
              <Field.Control>
                <RadioGroup value={kind} onChange={setKind} options={KINDS} />
              </Field.Control>
            </Field>
            <Field name="description" required>
              <Field.Label>Descreva a divergencia</Field.Label>
              <Field.Control>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} minLength={20} maxLength={2000} />
              </Field.Control>
              <Field.Hint>Min 20, max 2000 caracteres</Field.Hint>
            </Field>
            <Field name="evidence">
              <Field.Label>Evidencias (opcional, ate 10)</Field.Label>
              <Field.Control>
                <EvidenceUploader bucket="dispute-evidence" multiple onChange={setEvidencePaths} max={10} />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveSheet.Body>
        <ResponsiveSheet.Footer>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button onClick={submit} disabled={busy}>Abrir disputa</Button>
        </ResponsiveSheet.Footer>
      </ResponsiveSheet>
      <ConfirmDialog
        state={confirm ? {
          title: 'Confirmar abertura de disputa?',
          description: 'Esta acao nao altera o status do servico (continua cancelado), mas abre processo de revisao com a equipe Zelar.',
          confirmLabel: 'Abrir disputa',
          cancelLabel: 'Voltar',
          onConfirm: confirm.onConfirm,
        } : null}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
```

### Estender `ServiceCancelledDetail` (T-330)
- Adicionar botao "Abrir disputa" quando `dispute_window_open=true` (flag do GET /api/client/services/[id] T-324) e `disputed_ticket_id IS NULL`
- Fora da janela: tooltip explicativo "Janela de 7d para abrir disputa expirou"

## Constraints / NAO fazer
- NAO mudar status do SR (AC #12: cancelamento e disputa sao fluxos separados)
- NAO permitir 2a disputa do mesmo cancelamento (UI esconde botao se `disputed_ticket_id IS NOT NULL`)
- NAO usar `<Dialog>` cru — sempre `ResponsiveSheet`
- NAO confiar na flag client-side `dispute_window_open` para gating real — backend (T-340) tambem valida

## Convencoes
- Reuso `ResponsiveSheet`, `ConfirmDialog`, `Field`/`FormBody`, `Sonner`, `EvidenceUploader` (compartilhado com T-341)
- Mobile-first
- Idempotency-Key estavel `dispute-cancel-{sr_id}`

## qualityFlags
REUSE_EXISTING_COMPONENT, RESPONSIVE_SHEET_REQUIRED, CONFIRM_DIALOG_REQUIRED, FIELD_COMPOUND_API
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-346 (OPS: seed cancellation_policy + cron + bucket)
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '965dd1f2-9c20-4eb6-88e9-fa50e10e1977',
 'ZLAR-V2-T-346', 'Seedar app_config cancellation_policy + bucket service-force-majeure-evidence + pg_cron watchdog',
 $desc$## Objetivo
Configuracao operacional para o ciclo completo de cancelamento: seed `app_config.cancellation_policy` (split por janela), `dispute_cancel_window_days`, `client_absence_review_threshold`, bucket privado `service-force-majeure-evidence`, e pg_cron schedule do `scope-change-deadline-watchdog` (T-339) a cada 1min. Cobre AC #2/#3 (politica configuravel sem deploy), AC #5 (bucket evidencia), AC #8 (cron watchdog), AC #11 (threshold ausencias).

## Contexto
Modulo OPS. Reuso de `app_config` (T-216) com pattern de seed cross-US (T-237/T-331/T-304). pg_cron schedule espelha pattern de T-233 (lifecycle jobs) e T-304 (atypical watchdog).

## Estado atual / O que substitui
- `app_config.cancellation_policy` mencionado em T-225/T-237 mas nao seedado ainda
- Bucket `service-force-majeure-evidence` nao existe
- pg_cron schedule do watchdog nao existe

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_cancellation_policy_ops.sql`
```sql
BEGIN;

-- 1) Seed app_config.cancellation_policy (split por janela)
INSERT INTO app_config (key, value, description, section, critical, value_schema, unit) VALUES
  ('cancellation_policy', $$
    {
      "more_than_24h":      {"client_pct": 90, "provider_pct":  0, "platform_pct": 10},
      "between_2h_and_24h": {"client_pct": 60, "provider_pct": 30, "platform_pct": 10},
      "less_than_2h":       {"client_pct":  0, "provider_pct": 90, "platform_pct": 10},
      "mid_execution":      {"min_provider_pct": 50, "platform_pct": 10}
    }
  $$::jsonb,
   'Split de cancelamento por janela (% cliente / prestador / plataforma)',
   'cancellation', true,
   '{"type":"object"}'::jsonb, 'json'),
  ('dispute_cancel_window_days', '7'::jsonb,
   'Dias apos cancelamento para abrir disputa contestando split/ausencia/percentual',
   'cancellation', false,
   '{"type":"integer","minimum":1,"maximum":30}'::jsonb, 'days'),
  ('client_absence_review_threshold', '3'::jsonb,
   'Numero de ausencias em 6 meses para acionar revisao admin',
   'cancellation', false,
   '{"type":"integer","minimum":2,"maximum":10}'::jsonb, 'occurrences')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description,
      section     = EXCLUDED.section,
      critical    = EXCLUDED.critical,
      value_schema= EXCLUDED.value_schema,
      unit        = EXCLUDED.unit;
-- value preservado em conflito (nao sobrescrever ajustes do admin)

-- 2) pg_cron schedule do watchdog (a cada 1min)
SELECT cron.schedule(
  'scope-change-deadline-watchdog',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/scope-change-deadline-watchdog',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
  )
  $cmd$
);

COMMIT;
```

### Bucket `service-force-majeure-evidence`
- Criar via Supabase Dashboard: Storage > New bucket > `service-force-majeure-evidence` > Private
- Storage policies:
  - INSERT: `auth.uid() = owner` (cliente sobe arquivo seu)
  - SELECT: owner OU admin (cliente le proprio; admin revisa)
  - Object owner derivado de `service_cancellations.actor_user_id` via convencao de path: `users/{client_id}/cancellations/{ts}-{file}`
- Documentar no runbook OPS (memory `feedback_zordon_vs_zelar_scope`)

### `notification_templates` (cancel/dispute)
```sql
INSERT INTO notification_templates (key, channel, subject, body, status, version, audience) VALUES
  ('service_cancelled_client', 'push', 'Servico cancelado',
   'Cancelamento aplicado. Reembolso em ate 5 dias uteis.', 'active', 1, 'client'),
  ('service_cancelled_client', 'email',
   'Cancelamento do servico {{service_title}}',
   'Detalhes do cancelamento: reembolso de {{refund_amount}}, motivo {{reason}}. Veja no app: {{detail_link}}',
   'active', 1, 'client'),
  ('service_cancelled_provider', 'push', 'Servico cancelado',
   'Cliente cancelou o servico {{service_title}}. Compensacao: {{payout_amount}}.', 'active', 1, 'provider'),
  ('cancel_timeout_provider', 'push', 'Tempo expirado',
   'Cliente nao decidiu o reajuste. Servico cancelado; compensacao de deslocamento autorizada.', 'active', 1, 'provider')
ON CONFLICT (key, channel) DO NOTHING;
```

## Constraints / NAO fazer
- NAO sobrescrever `value` em ON CONFLICT (memory generalization)
- NAO marcar bucket como public (LGPD: evidencia contem dados pessoais)
- NAO seedar `cancellation_policy.less_than_2h.client_pct > 0` sem aprovacao operacional (regra de negocio AC #3)
- NAO esquecer de validar `cron.schedule` ja registrado (psql nao falha se chamar 2x — atualiza)

## Convencoes
- Pattern seed cross-US identico a T-237/T-331/T-304
- Bucket pattern identico a service-photos / service-materials (memory)
- Migration via psql; `database.types.ts` regenerado
- Smoke: SELECT * FROM app_config WHERE section='cancellation' retorna 3 chaves; pg_cron tem 1 job ativo
$desc$,
 'OPS', NULL, ARRAY['NO_RLS_NEEDED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. TaskAcceptanceCriterion (vinculo task -> AC-da-Story desta US)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-332 service_cancellations cobre AC #1 (motivo+detalhes), #5 (evidencia force majeure), #10 (snapshot mid-exec), #12 (estado-base disputa)
  ('d19cdd9f-3376-4661-88ed-dedf086ce8f9'::uuid, 1),
  ('d19cdd9f-3376-4661-88ed-dedf086ce8f9'::uuid, 5),
  ('d19cdd9f-3376-4661-88ed-dedf086ce8f9'::uuid, 10),
  ('d19cdd9f-3376-4661-88ed-dedf086ce8f9'::uuid, 12),

  -- T-333 client_absence_counters cobre AC #11
  ('f90f4f90-4998-4c4e-a018-db9ea58efd23'::uuid, 11),

  -- T-334 compute_cancellation_breakdown cobre AC #2, #3, #10
  ('17db05a5-eb41-4921-9947-8461ce9edff9'::uuid, 2),
  ('17db05a5-eb41-4921-9947-8461ce9edff9'::uuid, 3),
  ('17db05a5-eb41-4921-9947-8461ce9edff9'::uuid, 10),

  -- T-335 RPC apply_cancellation_policy cobre AC #1, #2, #3, #5, #7 (rejected_adjustment), #8, #10
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 1),
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 2),
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 3),
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 5),
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 7),
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 8),
  ('211f0ba5-907f-4751-b330-a8519af3a210'::uuid, 10),

  -- T-336 GET preview cobre AC #4
  ('a23119b9-0f97-4a72-bdd7-7dee591e4cf6'::uuid, 4),

  -- T-337 POST cancel cobre AC #1, #2, #3, #5
  ('e36166d7-f0d3-4660-baa8-8fa41082d225'::uuid, 1),
  ('e36166d7-f0d3-4660-baa8-8fa41082d225'::uuid, 2),
  ('e36166d7-f0d3-4660-baa8-8fa41082d225'::uuid, 3),
  ('e36166d7-f0d3-4660-baa8-8fa41082d225'::uuid, 5),

  -- T-338 POST cancel-mid-execution cobre AC #10
  ('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e'::uuid, 10),

  -- T-339 watchdog scope-change cobre AC #8 (timeout 15min auto-cancel)
  ('653b6fe0-509b-4505-babf-8eecadc4ad5c'::uuid, 8),

  -- T-340 POST open-dispute-from-cancel cobre AC #12
  ('6af7fc8a-27f4-440c-aa43-740ae9f67cc5'::uuid, 12),

  -- T-341 CancelServiceSheet cobre AC #1 (motivo), #4 (breakdown inline), #5 (evidencia)
  ('fa10828f-f56c-4aa2-996c-d40d350221e1'::uuid, 1),
  ('fa10828f-f56c-4aa2-996c-d40d350221e1'::uuid, 4),
  ('fa10828f-f56c-4aa2-996c-d40d350221e1'::uuid, 5),

  -- T-342 CancellationBreakdownCard cobre AC #4
  ('790efa6b-4058-4494-ae71-200acd7afe36'::uuid, 4),

  -- T-343 MidExecutionCancelSheet cobre AC #10
  ('5382d2e0-43ed-4313-8118-28232d490808'::uuid, 10),

  -- T-344 ClientDecisionDialog extension cobre AC #6 (UI countdown), #7 (UI feedback recusa), #8 (UI auto-cancel toast)
  ('ee123ef8-2c51-4a96-afee-c127e0ab4578'::uuid, 6),
  ('ee123ef8-2c51-4a96-afee-c127e0ab4578'::uuid, 7),
  ('ee123ef8-2c51-4a96-afee-c127e0ab4578'::uuid, 8),

  -- T-345 OpenDisputeFromCancelSheet cobre AC #12
  ('08977a90-6e1b-4fff-93e9-7f4de2525bda'::uuid, 12),

  -- T-346 OPS seeds cobre AC #2, #3 (config), #5 (bucket), #8 (cron), #11 (threshold)
  ('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f'::uuid, 2),
  ('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f'::uuid, 3),
  ('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f'::uuid, 5),
  ('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f'::uuid, 8),
  ('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f'::uuid, 11)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
 AND ac."order" = v.ac_order;


-- ============================================================================
-- 2.5 TaskAcceptanceCriterion (CROSS-US: liga tasks reusadas a AC desta US)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- AC #6 (15min reajuste decision UI): scope-change endpoint + decision dialog ja existem
  ('ZLAR-V2-T-292', 6),  -- POST /scope-change/decide (CLIENTE aprova/recusa)
  ('ZLAR-V2-T-303', 6),  -- ResponsiveDialog polimorfico CLIENTE decide

  -- AC #7 (aprovar reajuste regenera pagamento; recusar reembolsa+compensa): T-292 + T-071/T-078
  ('ZLAR-V2-T-292', 7),
  ('ZLAR-V2-T-071', 7),  -- payments/payment_attempts (regerar pagamento)
  ('ZLAR-V2-T-078', 7),  -- webhook MP (estorno em recusa)

  -- AC #9 (material/additional service approval CLIENTE-side): ja coberto em US-006
  ('ZLAR-V2-T-293', 9),  -- POST /material/decide (CLIENTE aprova/recusa)
  ('ZLAR-V2-T-295', 9),  -- POST /additional-item (CLIENTE aprova)
  ('ZLAR-V2-T-303', 9),  -- ResponsiveDialog polimorfico

  -- AC #11 (3 ausencias -> revisao admin): T-290 fonte de absence_at, T-302 banner CLIENTE
  ('ZLAR-V2-T-290', 11), -- service_client_absences (fonte do trigger T-333)
  ('ZLAR-V2-T-302', 11), -- PendingActionBanner reusavel

  -- AC #12 (open-dispute geral): support_tickets schema base + UI cancelado
  ('ZLAR-V2-T-147', 12), -- support_tickets schema (kind=dispute_cancel)
  ('ZLAR-V2-T-330', 12), -- ServiceCancelledDetail (botao "Abrir disputa" estendido em T-345)

  -- AC #1 (cancela em qualquer momento pre-arrival): cancel-search ja existe para fase 'searching'
  ('ZLAR-V2-T-307', 1),  -- POST /cancel-search (cobre estado searching)

  -- AC #8 (timeout 15min auto-cancel + provider compensation): T-292 (scope-change/decide) + T-303 (UI countdown ja base)
  ('ZLAR-V2-T-292', 8),

  -- AC #10 (mid-execution): service_events fonte de progress_pct
  ('ZLAR-V2-T-227', 10)  -- trigger FSM emite events que T-338 le pra calcular progress
) v(task_ref, ac_order)
JOIN "Task" t ON t.reference = v.task_ref
JOIN "UserStory" us ON us.reference = 'ZLAR-V2-US-015'
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = us.id
 AND ac."order" = v.ac_order
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 3. AcceptanceCriterion (taskId) — checklist tecnico (checkbox no TaskSheet)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-332 service_cancellations DATA
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'Enums cancellation_reason_kind e cancellation_window_kind criados', 1),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'Tabela service_cancellations criada com UNIQUE(service_request_id) total', 2),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'CHECK constraints em centavos (>=0) e progress_pct (0..100) ativos', 3),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'RLS: CLIENTE/PRESTADOR le seus via JOIN service_requests; ADMIN le tudo', 4),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'Append-only: UPDATE/DELETE/INSERT direto bloqueados pra nao-admin (apenas RPC T-335 escreve)', 5),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'Indices service_cancellations_actor_idx, reason_idx, evidence_idx criados', 6),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9', 'Smoke: 2o INSERT mesmo service_request_id retorna 23505', 7),

-- T-333 client_absence_counters DATA
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'Tabela client_absence_counters criada com PK(client_id)', 1),
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'Funcao refresh_client_absence_counter SECURITY DEFINER instalada', 2),
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'Trigger trg_refresh_client_absence_counter ativo em service_client_absences AFTER INSERT', 3),
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'RLS: CLIENTE le proprio; ADMIN le tudo', 4),
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'Smoke: 3o INSERT em service_client_absences gera ticket; 4o nao gera novo (idempotencia)', 5),
('f90f4f90-4998-4c4e-a018-db9ea58efd23', 'review_ticket_id linkado a support_ticket criado com kind=client_absence_review', 6),

-- T-334 compute_cancellation_breakdown DATA
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Catalogo service_status_transitions estendido (ON CONFLICT DO NOTHING)', 1),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Enum service_status estendido com cancelled_by_client_pre_match e cancelled_by_system', 2),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Funcao compute_cancellation_breakdown criada como STABLE', 3),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'GRANT EXECUTE para authenticated', 4),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Funcao falha com P0001 quando app_config.cancellation_policy ausente', 5),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Smoke: paid_at = now() retorna window_kind=within_1h_post_payment, client_pct=100', 6),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Smoke: scheduled_for - now > 24h retorna more_than_24h, client_pct=90', 7),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Smoke: in_execution=true com progress=30 -> provider_pct=50 (piso aplicado)', 8),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'Soma refund + payout + platform_fee = total_cents (ajuste explicito em platform)', 9),

-- T-335 apply_cancellation_policy API
('211f0ba5-907f-4751-b330-a8519af3a210', 'RPC criada com SECURITY DEFINER + GRANT authenticated', 0),
('211f0ba5-907f-4751-b330-a8519af3a210', 'FOR UPDATE em service_requests previne race com matching_rounds/scope-change', 1),
('211f0ba5-907f-4751-b330-a8519af3a210', 'Idempotency: 2a chamada com mesma key retorna {idempotent:true} sem 2o INSERT', 2),
('211f0ba5-907f-4751-b330-a8519af3a210', 'Insere 1 service_cancellation + transita FSM via T-235 + insere service_atypical_event kind=cancelled', 3),
('211f0ba5-907f-4751-b330-a8519af3a210', 'target_status correto por actor_kind: client/provider/system/admin', 4),
('211f0ba5-907f-4751-b330-a8519af3a210', 'evidence_review_status=pending quando reason_kind in (force_majeure, personal_emergency) e nao pre-aprovado', 5),
('211f0ba5-907f-4751-b330-a8519af3a210', 'enqueue_notification_event service.cancelled chamado fire-and-forget', 6),
('211f0ba5-907f-4751-b330-a8519af3a210', 'P0002 quando service_request nao encontrado', 7),
('211f0ba5-907f-4751-b330-a8519af3a210', 'Logs estruturados (entity=service, action=cancelled)', 8),

-- T-336 GET cancellation-preview API
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'Endpoint valida query com Zod (progress_pct 0-100, reason_kind enum)', 0),
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'Cliente A nao ve preview de SR do cliente B (RLS via service_requests SELECT)', 1),
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', '404 quando SR nao existe ou nao e do cliente', 2),
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'Cache-Control: no-store (breakdown muda no segundo seguinte)', 3),
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'Retorna {service_status, breakdown} no shape esperado pela UI', 4),
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'Smoke: GET com reason_kind=force_majeure retorna window_kind=force_majeure_override', 5),

-- T-337 POST cancel API
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'Endpoint valida body com Zod (reason_kind enum + max length)', 0),
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'Idempotency-Key header obrigatorio (400 sem)', 1),
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'reason_kind=other exige reason_details; force_majeure/personal_emergency exige evidence_paths', 2),
('e36166d7-f0d3-4660-baa8-8fa41082d225', '409 quando status=in_progress (use endpoint mid-execution)', 3),
('e36166d7-f0d3-4660-baa8-8fa41082d225', '409 quando status terminal (cancelled/completed)', 4),
('e36166d7-f0d3-4660-baa8-8fa41082d225', '403 quando auth.uid() != client_id', 5),
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'Mesma idempotency_key 2x retorna {idempotent:true} (200, sem 409)', 6),
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'force_majeure/personal_emergency NAO marca pre-aprovado (workflow admin futuro)', 7),
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'Logs estruturados (entity=service, action=cancel_request)', 8),

-- T-338 POST cancel-mid-execution API
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'Endpoint valida body com Zod', 0),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'Idempotency-Key obrigatoria; mesma key 2x nao duplica', 1),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'progress_pct calculado server-side a partir de service_events (nao confia no client)', 2),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', '409 quando status != in_progress', 3),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', '403 quando auth.uid() != client_id', 4),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'Resposta inclui computed_progress_pct para feedback UI', 5),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'Smoke: cliente sem step_events recebe 50% (piso)', 6),

-- T-339 Edge Function watchdog API
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Edge Function deployed via supabase functions deploy', 0),
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Le ate 100 service_pending_states expirados por execucao (DoS guard)', 1),
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Idempotency-Key estavel system-timeout-{sr_id}-{kind} previne duplicidade', 2),
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Chama apply_cancellation_policy com p_system_timeout=true', 3),
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Cobre kinds scope_change/material/revisit/additional_item', 4),
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Smoke local: pending_state com deadline_at = now()-1min processa SR para cancelled_by_system', 5),
('653b6fe0-509b-4505-babf-8eecadc4ad5c', 'Logs estruturados por SR processada (lifecycle dispatcher pattern)', 6),

-- T-340 POST open-dispute-from-cancel API
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'Endpoint valida body Zod (description min20-max2000, evidence max10)', 0),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'RPC open_dispute_from_cancellation criada com SECURITY DEFINER + GRANT authenticated', 1),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'Idempotency-Key obrigatoria; mesma key 2x retorna {idempotent:true}', 2),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'P0002 quando nao ha service_cancellation associada', 3),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', '410 Gone quando dispute_cancel_window_days expirado (default 7d)', 4),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'Insere support_ticket kind=dispute_cancel + linka service_cancellations.disputed_ticket_id', 5),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'NAO altera service_requests.status (AC #12: fluxos separados)', 6),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'Smoke: 2a abertura mesmo cancelamento retorna idempotent com mesmo ticket_id', 7),

-- T-341 CancelServiceSheet UI
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'Sheet usa ResponsiveSheet size=md (sem Dialog cru)', 0),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'Radio de motivos com 7 opcoes incluindo force_majeure e personal_emergency', 1),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'Field compound API + Sonner para erros (sem alert)', 2),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'reason=other exige textarea preenchido (validacao client-side feedback)', 3),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'force_majeure/personal_emergency mostra EvidenceUploader; submit bloqueado sem evidencia', 4),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'CancellationBreakdownCard inline atualiza ao trocar reason_kind', 5),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'ConfirmDialog destrutivo antes do POST', 6),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'Idempotency-Key: cancel-{sr_id}', 7),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'Sucesso: Sonner.success "Servico cancelado"; idempotent: Sonner.info', 8),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'Mobile-first verificado em viewport <768px; tap target >=44px', 9),

-- T-342 CancellationBreakdownCard UI
('790efa6b-4058-4494-ae71-200acd7afe36', 'Componente client-only com props serviceId/reasonKind/progressPct/snapshot', 0),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Renderiza window_kind humanizado (mapping de 8 valores)', 1),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Valores formatados em BRL via Intl.NumberFormat', 2),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Skeleton durante loading; sem fallback fake (0)', 3),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Disclaimer mostrado quando window_kind=force_majeure_override', 4),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Disclaimer mid-execution explica piso 50%', 5),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Aceita prop snapshot opcional para reuso pos-cancelamento (T-330)', 6),
('790efa6b-4058-4494-ae71-200acd7afe36', 'Cache-Control no-store no fetch interno', 7),

-- T-343 MidExecutionCancelSheet UI
('5382d2e0-43ed-4313-8118-28232d490808', 'Sheet usa ResponsiveSheet size=md (sem Dialog cru)', 0),
('5382d2e0-43ed-4313-8118-28232d490808', 'Mensagem destacada explicando piso 50% antes de submit', 1),
('5382d2e0-43ed-4313-8118-28232d490808', 'CancellationBreakdownCard usado com progressPct derivado', 2),
('5382d2e0-43ed-4313-8118-28232d490808', 'ConfirmDialog destrutivo "Interromper servico em andamento?"', 3),
('5382d2e0-43ed-4313-8118-28232d490808', 'Idempotency-Key: cancel-mid-{sr_id}', 4),
('5382d2e0-43ed-4313-8118-28232d490808', 'Sucesso: Sonner.success com computed_progress_pct ("60% executado")', 5),
('5382d2e0-43ed-4313-8118-28232d490808', 'Hint sugere abrir disputa apos cancelamento (link para T-345)', 6),
('5382d2e0-43ed-4313-8118-28232d490808', 'Mobile-first verificado', 7),

-- T-344 ClientDecisionDialog extension UI
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'Hook use-deadline-countdown criado com cleanup correto (clearInterval)', 0),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'Countdown mm:ss aparece no header do dialog existente (T-303)', 1),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'Sonner.warning aos 5min restantes', 2),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'Sonner.error + onClose apos 3s quando deadline expirou', 3),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'Visual destrutivo (text-destructive) quando expirado', 4),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'NAO duplica T-303 (extensao sem novo componente)', 5),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'NAO chama API de cancel client-side (apenas UI feedback; watchdog T-339 cancela)', 6),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', 'Mobile-first verificado', 7),

-- T-345 OpenDisputeFromCancelSheet UI
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Sheet usa ResponsiveSheet size=md', 0),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Radio de 3 dispute_kind (contested_cancellation/absence/execution_value)', 1),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Description com Field compound API (min 20, max 2000)', 2),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'EvidenceUploader compartilhado (max 10) opcional', 3),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'ConfirmDialog antes do POST com texto explicando que SR continua cancelado', 4),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Idempotency-Key: dispute-cancel-{sr_id}', 5),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Sonner.success "Disputa aberta. Equipe Zelar respondera em ate 24h"', 6),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'ServiceCancelledDetail (T-330) estendido com botao "Abrir disputa" condicional', 7),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Tooltip explicativo quando window expirou (>7d)', 8),
('08977a90-6e1b-4fff-93e9-7f4de2525bda', 'Mobile-first verificado', 9),

-- T-346 OPS seeds
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'Migration aplicada via psql', 0),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'app_config.cancellation_policy seedado com 4 janelas (more_than_24h/between_2h_and_24h/less_than_2h/mid_execution)', 1),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'app_config.dispute_cancel_window_days=7 seedado', 2),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'app_config.client_absence_review_threshold=3 seedado', 3),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'ON CONFLICT preserva value (nao sobrescreve ajustes do admin)', 4),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'pg_cron job scope-change-deadline-watchdog agendado a cada 1min', 5),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'Bucket privado service-force-majeure-evidence provisionado no Dashboard', 6),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'Templates service_cancelled_client (push/email), service_cancelled_provider (push), cancel_timeout_provider (push) seedados active', 7),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'app_config_history registra mudancas (audit T-215)', 8),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'Smoke: SELECT * FROM app_config WHERE section=cancellation retorna 3 chaves; cron tem job ativo', 9);


-- ============================================================================
-- 4. TaskDependency (kind lowercase: blocks | relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES

-- T-332 service_cancellations depende de service_requests (T-070), RLS canonica (T-229), atypical_events (T-285), support_tickets (T-147)
('d19cdd9f-3376-4661-88ed-dedf086ce8f9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'blocks'),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-229'), 'relates_to'),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-285'), 'relates_to'),
('d19cdd9f-3376-4661-88ed-dedf086ce8f9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'relates_to'),

-- T-333 client_absence_counters depende de service_client_absences (T-290), support_tickets (T-147)
('f90f4f90-4998-4c4e-a018-db9ea58efd23',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-290'), 'blocks'),
('f90f4f90-4998-4c4e-a018-db9ea58efd23',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'blocks'),
('f90f4f90-4998-4c4e-a018-db9ea58efd23',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-291'), 'relates_to'),

-- T-334 compute_breakdown depende de T-225 (catalogo transitions), T-332 (enums vivem la), T-346 (config seeded)
('17db05a5-eb41-4921-9947-8461ce9edff9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-225'), 'blocks'),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'd19cdd9f-3376-4661-88ed-dedf086ce8f9', 'blocks'),
('17db05a5-eb41-4921-9947-8461ce9edff9', 'b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'relates_to'),

-- T-335 RPC apply_cancellation_policy depende de T-332 (tabela), T-334 (funcao breakdown), T-235 (transition), T-285 (atypical), T-162 (notify)
('211f0ba5-907f-4751-b330-a8519af3a210', 'd19cdd9f-3376-4661-88ed-dedf086ce8f9', 'blocks'),
('211f0ba5-907f-4751-b330-a8519af3a210', '17db05a5-eb41-4921-9947-8461ce9edff9', 'blocks'),
('211f0ba5-907f-4751-b330-a8519af3a210',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),
('211f0ba5-907f-4751-b330-a8519af3a210',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-285'), 'relates_to'),
('211f0ba5-907f-4751-b330-a8519af3a210',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),

-- T-336 GET preview depende de T-334 (compute), T-070 (service_requests)
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6', '17db05a5-eb41-4921-9947-8461ce9edff9', 'blocks'),
('a23119b9-0f97-4a72-bdd7-7dee591e4cf6',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to'),

-- T-337 POST cancel depende de T-335 (RPC), T-346 (bucket evidencia)
('e36166d7-f0d3-4660-baa8-8fa41082d225', '211f0ba5-907f-4751-b330-a8519af3a210', 'blocks'),
('e36166d7-f0d3-4660-baa8-8fa41082d225', 'b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'relates_to'),

-- T-338 POST cancel-mid-execution depende de T-335 (RPC), T-228 (service_events fonte de progress)
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', '211f0ba5-907f-4751-b330-a8519af3a210', 'blocks'),
('39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-227'), 'relates_to'),

-- T-339 watchdog depende de T-335 (RPC), T-231 (pending_states), T-292/T-293/T-294 (proposers que criam pending_states)
('653b6fe0-509b-4505-babf-8eecadc4ad5c', '211f0ba5-907f-4751-b330-a8519af3a210', 'blocks'),
('653b6fe0-509b-4505-babf-8eecadc4ad5c',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-231'), 'blocks'),
('653b6fe0-509b-4505-babf-8eecadc4ad5c',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-292'), 'relates_to'),
('653b6fe0-509b-4505-babf-8eecadc4ad5c',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-293'), 'relates_to'),
('653b6fe0-509b-4505-babf-8eecadc4ad5c',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-294'), 'relates_to'),

-- T-340 open-dispute-from-cancel depende de T-332 (cancellations) + T-147 (support_tickets)
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'd19cdd9f-3376-4661-88ed-dedf086ce8f9', 'blocks'),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'blocks'),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-150'), 'relates_to'),
('6af7fc8a-27f4-440c-aa43-740ae9f67cc5',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-325'), 'relates_to'),

-- T-341 CancelServiceSheet depende de T-336 (preview), T-337 (cancel), T-342 (breakdown card), T-346 (bucket)
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'blocks'),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'e36166d7-f0d3-4660-baa8-8fa41082d225', 'blocks'),
('fa10828f-f56c-4aa2-996c-d40d350221e1', '790efa6b-4058-4494-ae71-200acd7afe36', 'blocks'),
('fa10828f-f56c-4aa2-996c-d40d350221e1', 'b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', 'relates_to'),

-- T-342 BreakdownCard depende de T-336 (preview)
('790efa6b-4058-4494-ae71-200acd7afe36', 'a23119b9-0f97-4a72-bdd7-7dee591e4cf6', 'blocks'),
('790efa6b-4058-4494-ae71-200acd7afe36',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-330'), 'relates_to'),

-- T-343 MidExecutionCancelSheet depende de T-338 (mid-exec), T-342 (card)
('5382d2e0-43ed-4313-8118-28232d490808', '39ee46ac-b5e3-4fd2-a1be-cfd8e5b87c5e', 'blocks'),
('5382d2e0-43ed-4313-8118-28232d490808', '790efa6b-4058-4494-ae71-200acd7afe36', 'blocks'),
('5382d2e0-43ed-4313-8118-28232d490808', '08977a90-6e1b-4fff-93e9-7f4de2525bda', 'relates_to'),

-- T-344 ClientDecisionDialog extension depende de T-303 (componente base), T-339 (server-side timeout)
('ee123ef8-2c51-4a96-afee-c127e0ab4578',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-303'), 'blocks'),
('ee123ef8-2c51-4a96-afee-c127e0ab4578', '653b6fe0-509b-4505-babf-8eecadc4ad5c', 'relates_to'),
('ee123ef8-2c51-4a96-afee-c127e0ab4578',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-292'), 'relates_to'),

-- T-345 OpenDisputeFromCancelSheet depende de T-340 (endpoint), T-330 (detail variante extendida)
('08977a90-6e1b-4fff-93e9-7f4de2525bda', '6af7fc8a-27f4-440c-aa43-740ae9f67cc5', 'blocks'),
('08977a90-6e1b-4fff-93e9-7f4de2525bda',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-330'), 'blocks'),

-- T-346 OPS seeds depende de T-216 (app_config schema), T-237 (lifecycle base config), T-339 (Edge Function)
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-216'), 'blocks'),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-237'), 'relates_to'),
('b927a0f2-8ba3-4b2c-8edb-0b5cbba8702f', '653b6fe0-509b-4505-babf-8eecadc4ad5c', 'relates_to');


COMMIT;
