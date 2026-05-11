-- =============================================================================
-- Zelar v2 — Backlog Zordon — US-028 (PRESTADOR · PERFIL)
-- Operar carteira, ganhos e historico de servicos
-- =============================================================================
-- Persona: PRESTADOR
-- AC: 5 (#1..#5)
-- Tasks geradas: T-124..T-135 (12 tasks)
-- Cobertura por camada: DATA=3 / API=5 / UI=4 / OPS=0 / REALTIME=0
-- AC#2 (liberação automática + notificação) = exceção SISTEMA (sem UI)
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- US + persona
  v_us_id        uuid := 'f4c2c41f-aeca-4867-a2f9-c1e354f84784';   -- ZLAR-V2-US-028
  v_project_id   uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_ds_id        uuid := '264e6d07-d365-43ba-8029-d539ce6f7c6b';
  v_persona_prest uuid := 'fa9b4900-290e-4c82-b72e-d2ced409f289'; -- PRESTADOR
  v_persona_sist  uuid := '085f0246-a5d1-4b23-9f09-025b5e37177b'; -- SISTEMA
  v_persona_any   text := 'ANY';

  -- AC-da-Story (UUIDs reais)
  v_ac1 uuid := '5e4948f9-0eed-4991-8ea4-217517c01608'; -- AC#1 carteira
  v_ac2 uuid := '1862dfc9-8dff-4749-92cc-a9f15f656a01'; -- AC#2 liberação automática
  v_ac3 uuid := '599d3978-83d2-4f79-bed2-c09da3ae144d'; -- AC#3 saque antecipado via ticket
  v_ac4 uuid := '3c47d885-d8d2-4382-b4ae-cc5aa3af3330'; -- AC#4 histórico operacional
  v_ac5 uuid := '80cfccd8-d840-4f91-ae6c-2e83b97df4da'; -- AC#5 paginação/skeleton/empty

  -- Cross-US dependency UUIDs (relates_to)
  v_t071 uuid := '82182a9d-e5ae-46b2-aad4-e37dc5d759a5'; -- payments + pix_codes (US-011)
  v_t104 uuid := 'd6da0be1-1e6d-4de1-b33f-f1411a0e4319'; -- POST data-deletion-request (US-014) — pattern de support endpoint
  v_t118 uuid := 'd92f90db-8d90-4fa5-ab1c-4a08436814c5'; -- Edge Function agenda-reminders + pg_cron template (US-027)
  v_t117 uuid := 'c2423c2e-190a-461e-b1bf-a2a141d99762'; -- GET /api/agenda — pagination/listagem template (US-027)
  v_t122 uuid := 'bf100c11-ea73-4f67-a94c-f7e0ae59d13a'; -- (provider) tela agenda — list+empty pattern (US-027)
  v_t070 uuid := '0db58807-4ce6-4253-b2a9-e24e4575f096'; -- service_requests FSM (US-011)

  -- Task UUIDs (geradas via gen_random_uuid())
  v_t124 uuid := gen_random_uuid(); -- DATA: provider_payouts + view summary
  v_t125 uuid := gen_random_uuid(); -- DATA: support_tickets minimal + RLS
  v_t126 uuid := gen_random_uuid(); -- DATA: pg_cron release-provider-payouts + log idempotente
  v_t127 uuid := gen_random_uuid(); -- API: Edge Function release-escrow-payouts
  v_t128 uuid := gen_random_uuid(); -- API: GET /api/provider/wallet/summary
  v_t129 uuid := gen_random_uuid(); -- API: GET /api/provider/wallet/extract (cursor)
  v_t130 uuid := gen_random_uuid(); -- API: GET /api/provider/services/history (cursor)
  v_t131 uuid := gen_random_uuid(); -- API: POST /api/support/early-payout-request
  v_t132 uuid := gen_random_uuid(); -- UI: /(provider)/wallet
  v_t133 uuid := gen_random_uuid(); -- UI: /(provider)/wallet/payment/[id]
  v_t134 uuid := gen_random_uuid(); -- UI: /(provider)/history
  v_t135 uuid := gen_random_uuid(); -- UI: /(provider)/history/[serviceId]
BEGIN

-- =============================================================================
-- T-124 [DATA] provider_payouts + provider_wallet_summary_v
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t124,
  'ZLAR-V2-T-124',
  'Criar provider_payouts + view provider_wallet_summary_v com RLS por provider_id',
  '## Objetivo
Esquema da carteira do prestador: tabela `provider_payouts` (1 linha por pagamento liberado/programado/em análise por serviço executado) + view materializada-light `provider_wallet_summary_v` com totais (montante total ganho, saldo em hold, total do mês corrente). Cobre AC #1 da US-028 — fonte canônica que a UI lê.

## Contexto
Módulo PERFIL (PRESTADOR). Depende de `payments` (T-071) e `service_requests` (T-070). Cada `service_requests` concluído gera 1 `provider_payouts` no momento em que o pagamento entra em escrow `captured` (criado por trigger ou serviço de matching/execução de US futura). A liberação efetiva ocorre via job de T-126/T-127 ao fim da janela de garantia/aceite tácito (T+72h pós conclusão).

## Estado atual / O que substitui
Não existe. Hoje não há tabela de payout do prestador; o ledger fica implícito em `payments`. Esta task introduz a fonte oficial.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_payouts.sql`
```sql
BEGIN;

CREATE TYPE provider_payout_status AS ENUM (
  ''scheduled'',     -- em hold, prazo de liberação ainda não atingido
  ''under_review'',  -- pagamento sob análise (disputa, anti-bypass, KYC pendente)
  ''released'',      -- liberado para a conta bancária do prestador
  ''cancelled''      -- cancelado por reembolso ao cliente (disputa procedente)
);

CREATE TABLE provider_payouts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payment_id          uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  amount_cents        int  NOT NULL CHECK (amount_cents > 0),
  status              provider_payout_status NOT NULL DEFAULT ''scheduled'',
  scheduled_release_at timestamptz NOT NULL,                        -- T+72h pós aceite tácito
  released_at         timestamptz,
  review_reason       text,                                         -- preenchido quando status=under_review
  cancelled_reason    text,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payouts_provider_status ON provider_payouts(provider_id, status, scheduled_release_at);
CREATE INDEX idx_payouts_release_pending  ON provider_payouts(scheduled_release_at)
  WHERE status = ''scheduled'';

ALTER TABLE provider_payouts ENABLE ROW LEVEL SECURITY;

-- PRESTADOR lê apenas os próprios
CREATE POLICY "provider_select_own_payouts" ON provider_payouts FOR SELECT
  USING (auth.uid() = provider_id);

-- ADMIN lê tudo
CREATE POLICY "admin_all_payouts" ON provider_payouts FOR ALL
  USING ((auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'');

-- Service role escreve (job/Edge Function); RLS bypass nativo

CREATE TRIGGER payouts_updated
  BEFORE UPDATE ON provider_payouts
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

-- View de resumo da carteira (lido pelo summary endpoint)
CREATE OR REPLACE VIEW provider_wallet_summary_v AS
SELECT
  p.provider_id,
  COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = ''released''), 0)
    AS total_earned_cents,
  COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status IN (''scheduled'',''under_review'')), 0)
    AS hold_cents,
  COALESCE(SUM(p.amount_cents) FILTER (
    WHERE p.status = ''released''
      AND p.released_at >= date_trunc(''month'', NOW())
  ), 0) AS month_released_cents,
  COUNT(*) FILTER (WHERE p.status = ''under_review'') AS under_review_count
FROM provider_payouts p
GROUP BY p.provider_id;

-- View herda RLS da tabela base (provider só vê próprias)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE de `status` por PRESTADOR (apenas service role efetiva liberação)
- ❌ DELETE em provider_payouts — log financeiro é imutável; cancelamento usa `status=cancelled`
- ❌ Materialized view aqui — view simples basta no MVP (refresh on-the-fly por `provider_id`); promover para MV em US-016 caso vire gargalo
- ❌ Calcular saldo somando `payments` direto na UI (sempre via view)

## Convenções
- `payment_id UNIQUE` garante 1 payout por pagamento (idempotência da criação upstream)
- `scheduled_release_at` derivado de `service_request.completed_at + 72h` (constante do MVP; futuro vira `app_config.release_window_hours` em US-019)
- View usa filtros funcionais — depende dos índices acima para custo aceitável (<50ms p99 com 10k linhas/provider)
- Migration via psql; `database.types.ts` regenerado',
  'DATA',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t124, NULL, 'Migration aplicada via psql; database.types.ts regenerado', 0),
(gen_random_uuid(), v_t124, NULL, 'Tabela provider_payouts criada com enum provider_payout_status e índices funcionais', 1),
(gen_random_uuid(), v_t124, NULL, 'View provider_wallet_summary_v retorna total_earned_cents, hold_cents, month_released_cents, under_review_count', 2),
(gen_random_uuid(), v_t124, NULL, 'RLS: PRESTADOR A não lê payouts de PRESTADOR B (smoke test via JWT)', 3),
(gen_random_uuid(), v_t124, NULL, 'Constraint UNIQUE(payment_id) impede payouts duplicados (smoke: 2x mesmo payment_id retorna erro)', 4),
(gen_random_uuid(), v_t124, NULL, 'Admin lê tudo (verificado com claim app_metadata.role=admin)', 5),
(gen_random_uuid(), v_t124, NULL, 'Trigger updatedAt funciona em UPDATE', 6);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t124, v_ac1);

-- =============================================================================
-- T-125 [DATA] support_tickets minimal schema (foundation US-018)
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t125,
  'ZLAR-V2-T-125',
  'Criar support_tickets schema mínimo (kind=early_payout) com RLS multi-persona',
  '## Objetivo
Schema mínimo de tickets de suporte para suportar AC #3 da US-028 (saque antecipado). Cria a tabela `support_tickets` com `kind` enum (inclui `early_payout` + stubs para futuras categorias de US-018) + RLS PRESTADOR/CLIENTE/ADMIN. **Foundation** que US-018 estenderá com fluxo completo de atendimento.

## Contexto
Módulo SUPORTE (cross-cut). Próxima US a precisar é US-028 (early_payout). US-018 (Atender tickets de suporte geral) ainda não gerou tasks; ela vai expandir essa tabela com colunas de SLA/atribuição/respostas. Aqui estabelecemos o esqueleto. Padrão similar a `account_deletion_requests` (T-098 da US-014): tabela criada por uma US consumidora, refinada pela US dona do módulo SUPORTE.

## Estado atual / O que substitui
Não existe `support_tickets`. Já existe `account_deletion_requests` (T-098) que é um ticket especializado de Art. 18 — esta tabela é a genérica que passará a coexistir.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_support_tickets.sql`
```sql
BEGIN;

CREATE TYPE support_ticket_kind AS ENUM (
  ''early_payout'',          -- US-028 AC#3
  ''payment_dispute'',       -- US-026 (futuro)
  ''account_issue'',         -- US-018 (futuro)
  ''service_complaint'',     -- US-018 (futuro)
  ''other''                  -- catch-all atual
);

CREATE TYPE support_ticket_status AS ENUM (
  ''open'',
  ''in_progress'',
  ''awaiting_user'',
  ''resolved'',
  ''rejected'',
  ''cancelled''
);

CREATE TABLE support_tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  user_role           text NOT NULL CHECK (user_role IN (''CLIENTE'',''PRESTADOR'')),
  kind                support_ticket_kind NOT NULL,
  status              support_ticket_status NOT NULL DEFAULT ''open'',
  subject             text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 200),
  body                text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 4000),
  context             jsonb NOT NULL DEFAULT ''{}''::jsonb,           -- ex: { payment_id, service_request_id }
  resolution_note     text,                                        -- preenchido pelo admin ao resolver
  resolved_by         uuid REFERENCES auth.users(id),
  resolved_at         timestamptz,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_user_status ON support_tickets(user_id, status, "createdAt" DESC);
CREATE INDEX idx_support_status_kind ON support_tickets(status, kind, "createdAt" DESC);

-- Idempotência por escopo (evitar 10 tickets idênticos do mesmo user p/ mesmo payment)
CREATE UNIQUE INDEX uq_support_open_per_user_kind_context
  ON support_tickets (user_id, kind, (context->>''payment_id''))
  WHERE status IN (''open'',''in_progress'',''awaiting_user'')
    AND context->>''payment_id'' IS NOT NULL;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Owner lê os próprios
CREATE POLICY "owner_select_own_tickets" ON support_tickets FOR SELECT
  USING (auth.uid() = user_id);

-- Owner cria os próprios
CREATE POLICY "owner_insert_own_tickets" ON support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Owner pode cancelar (UPDATE) os próprios enquanto status=''open''
CREATE POLICY "owner_cancel_own_tickets" ON support_tickets FOR UPDATE
  USING (auth.uid() = user_id AND status = ''open'')
  WITH CHECK (status IN (''open'',''cancelled''));

-- ADMIN lê e edita tudo
CREATE POLICY "admin_all_tickets" ON support_tickets FOR ALL
  USING ((auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'');

CREATE TRIGGER support_tickets_updated
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE de `kind`/`subject`/`body` pelo owner após criação (somente admin)
- ❌ Resolver tickets sem `resolution_note` (regra reforçada por trigger em US-018; aqui só esqueleto)
- ❌ Notificações in-app aqui — emissão vive em US-022 (NOTIFICACAO) consumindo o INSERT
- ❌ Anexos/respostas — escopo de US-018; sair fora aqui

## Convenções
- `context jsonb` é o ponto de extensão por `kind` (ex: `early_payout` → `{ payment_id, service_request_id }`)
- Index único parcial em `(user_id, kind, payment_id) WHERE status=open|in_progress|awaiting_user` evita ticket duplicado por pagamento
- US-018 vai ADICIONAR colunas (priority, sla_due, assigned_admin_id, ticket_messages table) — não recriar tabela',
  'DATA',
  'draft',
  'feature',
  4,
  'ANY',
  ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t125, NULL, 'Migration aplicada via psql; database.types.ts regenerado', 0),
(gen_random_uuid(), v_t125, NULL, 'Tabela support_tickets criada com enums kind/status e índices', 1),
(gen_random_uuid(), v_t125, NULL, 'Index único parcial impede 2 tickets early_payout abertos para mesmo payment_id (smoke)', 2),
(gen_random_uuid(), v_t125, NULL, 'RLS: owner lê/cria os próprios; UPDATE só com status=open; admin tudo (smoke por persona)', 3),
(gen_random_uuid(), v_t125, NULL, 'CHECK constraints em subject(3..200) e body(10..4000) violam quando fora do range', 4),
(gen_random_uuid(), v_t125, NULL, 'Trigger updatedAt funciona em UPDATE', 5);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t125, v_ac3);

-- =============================================================================
-- T-126 [DATA] pg_cron release-provider-payouts + log idempotente
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t126,
  'ZLAR-V2-T-126',
  'Configurar pg_cron release-provider-payouts (T+72h) + provider_payout_release_log idempotente',
  '## Objetivo
Job recorrente que detecta `provider_payouts.status=scheduled` com `scheduled_release_at <= NOW()` e dispara a Edge Function `release-escrow-payouts` (T-127) para cada um. Garante idempotência via tabela de log com UNIQUE(payout_id, kind=''cron_release''). Cobre AC #2 da US-028 (liberação automática pós janela de garantia).

## Contexto
Módulo PERFIL/SUPORTE (SISTEMA). Depende de `provider_payouts` (T-124) e da Edge Function (T-127). Reusa o padrão canônico estabelecido em T-118 (US-027 — `agenda-reminders` cron + Edge Function + UNIQUE log) — combo `pg_cron + Edge Function + service_<entity>_log UNIQUE(entity_id, kind)`.

## Estado atual / O que substitui
Não existe. Hoje sem schema de payout, sem job.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_payout_release_cron.sql`
```sql
BEGIN;

CREATE TABLE provider_payout_release_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id    uuid NOT NULL REFERENCES provider_payouts(id) ON DELETE CASCADE,
  kind         text NOT NULL,                      -- ''cron_release'' | ''retry'' | ''manual''
  attempted_at timestamptz NOT NULL DEFAULT NOW(),
  outcome      text NOT NULL,                      -- ''ok'' | ''failed'' | ''skipped''
  error        text,
  raw          jsonb
);

CREATE UNIQUE INDEX uq_payout_release_kind
  ON provider_payout_release_log (payout_id, kind);

CREATE INDEX idx_payout_release_attempted
  ON provider_payout_release_log (attempted_at DESC);

ALTER TABLE provider_payout_release_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_release_log" ON provider_payout_release_log
  FOR SELECT USING ((auth.jwt() -> ''app_metadata'' ->> ''role'') = ''admin'');
-- Service role bypass

-- Job: roda a cada 5 minutos
SELECT cron.schedule(
  ''release-provider-payouts'',
  ''*/5 * * * *'',
  $job$
  SELECT net.http_post(
    url     := current_setting(''app.settings.edge_url'') || ''/release-escrow-payouts'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer '' || current_setting(''app.settings.service_role_key'')
    ),
    body    := ''{}''::jsonb
  );
  $job$
);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Disparar HTTP por payout dentro do cron (vai bater limite). Cron chama Edge Function uma vez; ela varre e processa em lote
- ❌ Permitir UPDATE/DELETE em release_log (apenas INSERT pelo job/Edge Function)
- ❌ Frequência sub-minuto — `*/5` cobre SLA de "T+72h ± 5min" sem custo
- ❌ Setar service_role_key inline na schedule SQL (usar `current_setting` que vem de env do Supabase)

## Convenções
- Padrão idêntico ao `agenda-reminders` (T-118): cron→edge→log com UNIQUE(entity_id, kind)
- `kind` permite escalonar tipos no futuro (ex: ''retry'' para backoff)
- Nomenclatura `service_<entity>_log` segue generalização registrada
- Migration aplicada via psql',
  'DATA',
  'draft',
  'feature',
  3,
  'SISTEMA',
  ARRAY['RLS_REQUIRED','AUDIT_LOG','IDEMPOTENCY_KEY','INDEX_REQUIRED'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t126, NULL, 'Migration aplicada via psql; database.types.ts regenerado', 0),
(gen_random_uuid(), v_t126, NULL, 'Tabela provider_payout_release_log criada com UNIQUE(payout_id, kind)', 1),
(gen_random_uuid(), v_t126, NULL, 'pg_cron job release-provider-payouts agendado a cada 5min (SELECT cron.job retorna a row)', 2),
(gen_random_uuid(), v_t126, NULL, 'Job dispara HTTP POST para /release-escrow-payouts via pg_net (smoke verifica 1 invocação em 5min)', 3),
(gen_random_uuid(), v_t126, NULL, 'INSERT 2x mesmo (payout_id, kind=cron_release) viola UNIQUE (idempotência garantida)', 4),
(gen_random_uuid(), v_t126, NULL, 'Apenas admin lê release_log (RLS smoke)', 5);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t126, v_ac2);

-- =============================================================================
-- T-127 [API] Edge Function release-escrow-payouts
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t127,
  'ZLAR-V2-T-127',
  'Implementar Edge Function release-escrow-payouts (varredura + liberação + notificação)',
  '## Objetivo
Edge Function executada pelo cron de T-126: varre `provider_payouts` com `status=scheduled` e `scheduled_release_at<=NOW()`, executa a liberação (status=released, released_at=NOW()), grava log idempotente em `provider_payout_release_log`, e enfileira notificação externa via NOTIFICACAO (US-022) para o prestador. Cobre AC #2 da US-028.

## Contexto
Módulo PERFIL/SUPORTE (SISTEMA). Reusa o padrão de Edge Function idempotente estabelecido em T-118 (`agenda-reminders` US-027). NÃO chama gateway de pagamento aqui — Mercado Pago já capturou em escrow no pagamento (US-011); liberação ao prestador no MVP é interna (refletida no extrato/saldo). Integração com payout real via gateway é US futura.

## Estado atual / O que substitui
Não existe. Hoje não há mecanismo de liberação automática.

## O que criar

### `supabase/functions/release-escrow-payouts/index.ts`
```typescript
// Deno runtime; chamado a cada 5min pelo cron de T-126
import { createClient } from ''https://esm.sh/@supabase/supabase-js@2'';

const SUPABASE_URL = Deno.env.get(''SUPABASE_URL'')!;
const SERVICE_KEY  = Deno.env.get(''SUPABASE_SERVICE_ROLE_KEY'')!;

Deno.serve(async () => {
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Pega lote (LIMIT 200) elegíveis
  const { data: payouts, error } = await supa
    .from(''provider_payouts'')
    .select(''id, provider_id, payment_id, amount_cents, scheduled_release_at'')
    .eq(''status'', ''scheduled'')
    .lte(''scheduled_release_at'', new Date().toISOString())
    .limit(200);
  if (error) return new Response(error.message, { status: 500 });

  let ok = 0, skipped = 0, failed = 0;
  for (const p of payouts ?? []) {
    // 2. Tenta gravar log (UNIQUE bloqueia duplicidade)
    const { error: logErr } = await supa.from(''provider_payout_release_log'').insert({
      payout_id: p.id, kind: ''cron_release'', outcome: ''ok'',
    });
    if (logErr) { skipped++; continue; }   // já liberado num run anterior

    // 3. Atualiza status do payout
    const { error: updErr } = await supa.from(''provider_payouts'').update({
      status: ''released'', released_at: new Date().toISOString(),
    }).eq(''id'', p.id).eq(''status'', ''scheduled''); // CAS otimista
    if (updErr) { failed++; continue; }

    // 4. Enfileira notificação (US-022 — assume tabela notification_outbox)
    await supa.from(''notification_outbox'').insert({
      user_id: p.provider_id,
      kind: ''payout_released'',
      channel: ''external'',                                  // email/push/whatsapp por preferência
      payload: { payout_id: p.id, amount_cents: p.amount_cents },
    });
    ok++;
  }

  return Response.json({ processed: payouts?.length ?? 0, ok, skipped, failed });
});
```

## Constraints / NÃO fazer
- ❌ Chamar gateway externo (Mercado Pago payout API) — escopo de US futura; MVP refletido apenas internamente
- ❌ Notificar in-app aqui — channel=`external`; in-app sai naturalmente quando UI da carteira atualizar
- ❌ Processar mais de 200 payouts por execução (próxima rodada em 5min limpa o resto; backpressure controlado)
- ❌ Atualizar status sem CAS (`.eq(''status'',''scheduled'')`) — risco de race se 2 jobs concorrerem
- ❌ Permitir invocação anônima — endpoint só responde via `Authorization: Bearer <SERVICE_ROLE_KEY>`

## Convenções
- Mesmo padrão de Edge Function idempotente de T-118 (US-027)
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (config Supabase Functions, nunca em código)
- `notification_outbox` é o contrato com US-022 (assume schema básico; US-022 dona do detalhe)
- Logs estruturados: `{ processed, ok, skipped, failed }` na resposta — consumido por monitor admin (US-016)',
  'API',
  'draft',
  'feature',
  3,
  'SISTEMA',
  ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','RACE_CONDITION','AUDIT_LOG','RLS_REQUIRED'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t127, NULL, 'Edge Function deployada e responde 200 com JSON {processed, ok, skipped, failed}', 0),
(gen_random_uuid(), v_t127, NULL, 'Apenas chamada com Authorization: Bearer <service_role> é aceita (401 sem header)', 1),
(gen_random_uuid(), v_t127, NULL, 'Payout elegível (scheduled, scheduled_release_at<=NOW()) muda para released com released_at preenchido', 2),
(gen_random_uuid(), v_t127, NULL, 'Re-execução não duplica (UNIQUE bloqueia; outcome=skipped)', 3),
(gen_random_uuid(), v_t127, NULL, 'CAS UPDATE com .eq(status,scheduled) impede race com outro job concorrente', 4),
(gen_random_uuid(), v_t127, NULL, 'INSERT em notification_outbox com kind=payout_released e channel=external por payout liberado', 5),
(gen_random_uuid(), v_t127, NULL, 'Smoke: payout marcado scheduled com scheduled_release_at=NOW()-1min é processado em <=5min', 6);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t127, v_ac2);

-- =============================================================================
-- T-128 [API] GET /api/provider/wallet/summary
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t128,
  'ZLAR-V2-T-128',
  'Implementar GET /api/provider/wallet/summary (totais ganho/hold/mês)',
  '## Objetivo
Endpoint que retorna resumo da carteira do prestador autenticado: `total_earned_cents`, `hold_cents`, `month_released_cents`, `under_review_count`. Lê direto de `provider_wallet_summary_v` (T-124). Cobre AC #1 da US-028.

## Contexto
Módulo PERFIL (PRESTADOR). Consumido pela tela `/(provider)/wallet` (T-132). RLS da view limita a `auth.uid()` automaticamente. GET puro — sem mutação, sem idempotência.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/provider/wallet/summary/route.ts`
```typescript
import { createClient } from ''@/lib/supabase/server'';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: ''unauthorized'' }, { status: 401 });

  const { data, error } = await supabase
    .from(''provider_wallet_summary_v'')
    .select(''*'')
    .eq(''provider_id'', user.id)
    .maybeSingle();

  if (error) return Response.json({ error: error.code }, { status: 500 });

  // Provider sem nenhum payout ainda → view não retorna linha → zera tudo
  return Response.json({
    total_earned_cents:  data?.total_earned_cents  ?? 0,
    hold_cents:          data?.hold_cents          ?? 0,
    month_released_cents:data?.month_released_cents?? 0,
    under_review_count:  data?.under_review_count  ?? 0,
  });
}
```

## Constraints / NÃO fazer
- ❌ Aceitar `provider_id` no query string (sempre `auth.uid()`)
- ❌ Cache server-side (>30s) — view é leve e dados financeiros precisam frescos
- ❌ Retornar campos não-monetários (data de último pagamento etc) — escopo de extract (T-129)

## Convenções
- Endpoint sob `/api/provider/*` (segregação por persona já existe na convenção de paths)
- Sem Zod (não há body)
- Cache: `Cache-Control: private, max-age=10` aceitável; mas omitir é OK no MVP
- Resposta sempre tem todos os campos (zera quando view não retorna)',
  'API',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['RLS_REQUIRED'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t128, NULL, 'GET /api/provider/wallet/summary retorna 401 sem sessão', 0),
(gen_random_uuid(), v_t128, NULL, 'Retorna {total_earned_cents, hold_cents, month_released_cents, under_review_count} sempre presentes', 1),
(gen_random_uuid(), v_t128, NULL, 'Provider sem payouts recebe todos zerados (não 404)', 2),
(gen_random_uuid(), v_t128, NULL, 'RLS garante que valores são apenas do auth.uid() (smoke com 2 providers)', 3),
(gen_random_uuid(), v_t128, NULL, 'Latência p99 < 200ms com 1k payouts/provider', 4);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t128, v_ac1);

-- =============================================================================
-- T-129 [API] GET /api/provider/wallet/extract (cursor)
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t129,
  'ZLAR-V2-T-129',
  'Implementar GET /api/provider/wallet/extract com cursor pagination (limit 20)',
  '## Objetivo
Extrato cronológico do prestador: lista paginada de `provider_payouts` (joined com `service_requests` para título/categoria) ordenada por `createdAt DESC`. Cobre AC #1 (extrato cronológico com status) e parcialmente AC #5 (pagination/scroll infinito).

## Contexto
Módulo PERFIL (PRESTADOR). Consumido pela tela `/(provider)/wallet` (T-132). Reusa padrão de cursor de T-117 (`/api/agenda` US-027). Cursor é `(createdAt, id)` para estabilidade em ties.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/provider/wallet/extract/route.ts`
```typescript
import { z } from ''zod'';
import { createClient } from ''@/lib/supabase/server'';

const Query = z.object({
  cursor: z.string().optional(),                 // base64({ts, id})
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum([''scheduled'',''under_review'',''released'',''cancelled'']).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { cursor, limit, status } = Query.parse(Object.fromEntries(url.searchParams));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: ''unauthorized'' }, { status: 401 });

  let q = supabase
    .from(''provider_payouts'')
    .select(`
      id, status, amount_cents, scheduled_release_at, released_at, "createdAt",
      payment_id,
      service_request:service_requests ( id, category, title, completed_at )
    `)
    .eq(''provider_id'', user.id)
    .order(''createdAt'', { ascending: false })
    .order(''id'',         { ascending: false })
    .limit(limit + 1);

  if (status) q = q.eq(''status'', status);

  if (cursor) {
    const { ts, id } = JSON.parse(Buffer.from(cursor, ''base64'').toString(''utf-8''));
    // keyset: (createdAt, id) < (ts, id) — usar OR composto
    q = q.or(`and(createdAt.lt.${ts}),and(createdAt.eq.${ts},id.lt.${id})`);
  }

  const { data, error } = await q;
  if (error) return Response.json({ error: error.code }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const items   = hasMore ? data!.slice(0, limit) : data ?? [];
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ ts: items.at(-1)!.createdAt, id: items.at(-1)!.id })).toString(''base64'')
    : null;

  return Response.json({ items, nextCursor });
}
```

## Constraints / NÃO fazer
- ❌ Offset pagination (lento e instável com inserts concorrentes)
- ❌ Aceitar `limit > 50` (DDoS surface)
- ❌ Retornar `payment_id` cru sem outras infos do payment (cliente UI pega via detalhe T-133)
- ❌ Validar Zod no client — só aqui (server)

## Convenções
- Cursor pattern reusa T-117 (US-027)
- Resposta: `{ items: [...], nextCursor: string|null }` (formato canônico de pagination da plataforma)
- Filtro `status` é opcional para tabs ("Tudo", "Liberados", "Em hold") na UI',
  'API',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['RLS_REQUIRED','INPUT_VALIDATION','PAGINATION'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t129, NULL, 'Endpoint valida query com Zod (400 em formato inválido)', 0),
(gen_random_uuid(), v_t129, NULL, '401 quando sem sessão', 1),
(gen_random_uuid(), v_t129, NULL, 'Retorna {items, nextCursor} com no máximo limit (default 20, máx 50)', 2),
(gen_random_uuid(), v_t129, NULL, 'Cursor base64 estável em (createdAt, id) — paginação não duplica nem pula com inserts concorrentes', 3),
(gen_random_uuid(), v_t129, NULL, 'Filtro status restringe corretamente (smoke com 4 status presentes)', 4),
(gen_random_uuid(), v_t129, NULL, 'RLS isola por provider_id (smoke 2 providers)', 5),
(gen_random_uuid(), v_t129, NULL, 'Latência p99 < 300ms com 5k payouts/provider e cursor profundo (5ª página)', 6);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t129, v_ac1),
(v_t129, v_ac5);

-- =============================================================================
-- T-130 [API] GET /api/provider/services/history (cursor)
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t130,
  'ZLAR-V2-T-130',
  'Implementar GET /api/provider/services/history com cursor + filtros + flags retrabalho/disputa',
  '## Objetivo
Histórico operacional do prestador: lista paginada de serviços executados (status terminal: completed/cancelled/disputed) com avaliação recebida, flag de retrabalho/disputa e indicação do payout vinculado. Cobre AC #4 e parcialmente AC #5.

## Contexto
Módulo PERFIL (PRESTADOR). Consumido pelo `/(provider)/history` (T-134). Mesmo padrão de cursor de T-129. Joins com `service_requests`, `provider_payouts`, e (futuramente) `service_ratings`/`service_disputes` (US-013/US-026).

## Estado atual / O que substitui
Não existe. Hoje não há tela de histórico do prestador.

## O que criar

### `src/app/api/provider/services/history/route.ts`
```typescript
import { z } from ''zod'';
import { createClient } from ''@/lib/supabase/server'';

const Query = z.object({
  cursor: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum([''all'',''rework'',''disputed'',''completed'']).default(''all''),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { cursor, limit, filter } = Query.parse(Object.fromEntries(url.searchParams));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: ''unauthorized'' }, { status: 401 });

  // Joins; assume colunas service_requests.has_rework, .has_dispute (de US-013/US-026)
  // Caso ainda não existam, considere views auxiliares — implementador alinha.
  let q = supabase
    .from(''service_requests'')
    .select(`
      id, category, title, status, completed_at, has_rework, has_dispute,
      rating:service_ratings ( score, comment ),
      payout:provider_payouts ( id, status, amount_cents )
    `)
    .eq(''provider_id'', user.id)
    .in(''status'', [''completed'',''cancelled'',''disputed''])
    .order(''completed_at'', { ascending: false, nullsFirst: false })
    .order(''id'',           { ascending: false })
    .limit(limit + 1);

  if (filter === ''rework'')    q = q.eq(''has_rework'', true);
  if (filter === ''disputed'')  q = q.eq(''has_dispute'', true);
  if (filter === ''completed'') q = q.eq(''status'', ''completed'');

  if (cursor) {
    const { ts, id } = JSON.parse(Buffer.from(cursor, ''base64'').toString(''utf-8''));
    q = q.or(`and(completed_at.lt.${ts}),and(completed_at.eq.${ts},id.lt.${id})`);
  }

  const { data, error } = await q;
  if (error) return Response.json({ error: error.code }, { status: 500 });

  const hasMore = (data?.length ?? 0) > limit;
  const items   = hasMore ? data!.slice(0, limit) : data ?? [];
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ ts: items.at(-1)!.completed_at, id: items.at(-1)!.id })).toString(''base64'')
    : null;

  return Response.json({ items, nextCursor });
}
```

## Constraints / NÃO fazer
- ❌ Retornar serviços `in_progress`/`queued` (escopo do agenda T-117)
- ❌ Retornar fotos de execução aqui (lista é leve; fotos só no detalhe T-135)
- ❌ Aceitar `provider_id` no query (sempre `auth.uid()`)
- ❌ Filtro by category neste MVP (escopo futuro — manter simples)

## Convenções
- Cursor por `(completed_at, id)` — listas ordenadas por término
- `has_rework`/`has_dispute` são flags denormalizadas no `service_requests` (mantidas por triggers em US-013/US-026); se ausentes na época da implementação, criar como subquery ou view auxiliar
- Resposta `{ items, nextCursor }` consistente com T-129',
  'API',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['RLS_REQUIRED','INPUT_VALIDATION','PAGINATION'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t130, NULL, 'Endpoint valida query com Zod (400 em formato inválido)', 0),
(gen_random_uuid(), v_t130, NULL, '401 quando sem sessão', 1),
(gen_random_uuid(), v_t130, NULL, 'Retorna apenas serviços do auth.uid() em status terminal (completed/cancelled/disputed)', 2),
(gen_random_uuid(), v_t130, NULL, 'Filtros all/rework/disputed/completed restringem corretamente (smoke por filtro)', 3),
(gen_random_uuid(), v_t130, NULL, 'Cada item inclui rating (se houver) e payout vinculado (id, status, amount_cents)', 4),
(gen_random_uuid(), v_t130, NULL, 'Cursor base64 estável em (completed_at, id) — não duplica/pula', 5),
(gen_random_uuid(), v_t130, NULL, 'RLS isola por provider_id (smoke 2 providers)', 6),
(gen_random_uuid(), v_t130, NULL, 'Latência p99 < 400ms com 5k serviços/provider e join de rating+payout', 7);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t130, v_ac4),
(v_t130, v_ac5);

-- =============================================================================
-- T-131 [API] POST /api/support/early-payout-request
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t131,
  'ZLAR-V2-T-131',
  'Implementar POST /api/support/early-payout-request (cria support_ticket; gate dispute/under_review)',
  '## Objetivo
Cria ticket `kind=early_payout` para suporte avaliar liberação antecipada de um pagamento programado. Bloqueia se o payout estiver em disputa/under_review (CTA da UI já filtra, mas server reforça). Cobre AC #3 da US-028.

## Contexto
Módulo PERFIL ↔ SUPORTE. Reusa padrão de endpoint `/api/support/*` estabelecido em T-104 (US-014). Insere em `support_tickets` (T-125) com `context.payment_id` + `context.payout_id`. Idempotência via UNIQUE parcial garante no máximo 1 ticket aberto por (user, kind=early_payout, payment_id).

## Estado atual / O que substitui
Não existe. Hoje não há fluxo de saque antecipado.

## O que criar

### `src/app/api/support/early-payout-request/route.ts`
```typescript
import { z } from ''zod'';
import { createClient } from ''@/lib/supabase/server'';

const Body = z.object({
  payout_id: z.string().uuid(),
  reason:    z.string().min(20).max(2000),
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: ''unauthorized'' }, { status: 401 });

  // Carrega payout (RLS já filtra do owner)
  const { data: payout, error: pErr } = await supabase
    .from(''provider_payouts'')
    .select(''id, status, payment_id, scheduled_release_at, amount_cents'')
    .eq(''id'', body.payout_id)
    .maybeSingle();
  if (pErr || !payout) return Response.json({ error: ''payout_not_found'' }, { status: 404 });

  // Gate: só permite se status=scheduled (não em disputa/under_review/cancelled/released)
  if (payout.status !== ''scheduled'') {
    return Response.json({
      error: ''invalid_payout_status'',
      message: ''Saque antecipado disponível apenas para pagamentos programados.'',
    }, { status: 409 });
  }

  // Insere ticket; UNIQUE parcial bloqueia duplicidade aberta
  const { data: ticket, error: tErr } = await supabase
    .from(''support_tickets'')
    .insert({
      user_id:    user.id,
      user_role:  ''PRESTADOR'',
      kind:       ''early_payout'',
      subject:    `Solicitação de saque antecipado — payout ${payout.id.slice(0,8)}`,
      body:       body.reason,
      context:    { payout_id: payout.id, payment_id: payout.payment_id, amount_cents: payout.amount_cents },
    })
    .select()
    .single();

  if (tErr) {
    if (tErr.code === ''23505'') {
      return Response.json({
        error: ''duplicate_ticket'',
        message: ''Você já tem uma solicitação aberta para este pagamento.'',
      }, { status: 409 });
    }
    return Response.json({ error: tErr.code }, { status: 400 });
  }

  return Response.json({ ticket });
}
```

## Constraints / NÃO fazer
- ❌ Permitir solicitar para payout `under_review`/`released`/`cancelled` (409)
- ❌ Aceitar `reason` curto (mínimo 20 chars — força contexto pro suporte)
- ❌ Notificar admin in-app aqui (US-022 cuida via INSERT trigger no support_tickets)
- ❌ Liberar o payout aqui — apenas abre o ticket; admin decide manualmente

## Convenções
- Endpoint sob `/api/support/*` consistente com T-104
- Zod min(20) reason — análoga a min(10) do Art.18 mas mais restritiva (decisão financeira)
- 409 + `error: invalid_payout_status` quando regra de produto bloqueia
- 409 + `error: duplicate_ticket` quando UNIQUE parcial bate (mapeado de 23505)',
  'API',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['RLS_REQUIRED','INPUT_VALIDATION','RATE_LIMIT','AUDIT_LOG'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t131, NULL, 'Endpoint valida body com Zod (400 em payout_id não-uuid ou reason <20 chars)', 0),
(gen_random_uuid(), v_t131, NULL, '401 quando sem sessão', 1),
(gen_random_uuid(), v_t131, NULL, '404 quando payout_id não pertence ao prestador (RLS)', 2),
(gen_random_uuid(), v_t131, NULL, '409 invalid_payout_status quando status != scheduled (under_review/released/cancelled)', 3),
(gen_random_uuid(), v_t131, NULL, '409 duplicate_ticket quando já existe ticket aberto para mesmo payment_id (UNIQUE parcial)', 4),
(gen_random_uuid(), v_t131, NULL, 'Insert preenche context com payout_id, payment_id, amount_cents', 5),
(gen_random_uuid(), v_t131, NULL, 'Smoke: 2 prestadores não veem tickets uns dos outros (RLS de support_tickets)', 6);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t131, v_ac3);

-- =============================================================================
-- T-132 [UI] /(provider)/wallet
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t132,
  'ZLAR-V2-T-132',
  'Renderizar tela /(provider)/wallet com cards de resumo, extrato infinito e empty state',
  '## Objetivo
Tela "Carteira" do prestador: header com cards (total ganho, saldo em hold, total do mês), tabs de status (Tudo / Liberados / Em hold / Em análise), lista cronológica com scroll infinito, skeleton durante loading, estado vazio tratado. Cobre AC #1 (visualização) e AC #5 (paginação/skeleton/empty).

## Contexto
Módulo PERFIL (PRESTADOR). Consome T-128 (`/api/provider/wallet/summary`) e T-129 (`/api/provider/wallet/extract`). Cada item da lista navega para `/(provider)/wallet/payment/[id]` (T-133). Padrão de listagem reusa T-122 (`agenda` US-027).

## Estado atual / O que substitui
Não existe `/(provider)/wallet`. Sem entry point hoje no menu do prestador (provavelmente adicionado no perfil hub T-091 via card "Carteira").

## O que criar

### `src/app/(provider)/wallet/page.tsx`
```tsx
"use client";

import { useEffect, useState } from "react";
import useSWRInfinite from "swr/infinite"; // ou implementar com fetch+state se SWR não estiver no projeto
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { fmtCents, fmtDate } from "@/lib/format";

type Status = "all"|"released"|"scheduled"|"under_review";

export default function WalletPage() {
  const [tab, setTab] = useState<Status>("all");
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    fetch("/api/provider/wallet/summary").then(r => r.json()).then(setSummary);
  }, []);

  const { data, size, setSize, isLoading } = useSWRInfinite(
    (i, prev) => prev && !prev.nextCursor ? null
      : `/api/provider/wallet/extract?limit=20`
        + (tab !== "all" ? `&status=${tab}` : "")
        + (i > 0 && prev?.nextCursor ? `&cursor=${prev.nextCursor}` : ""),
    (url) => fetch(url).then(r => r.json())
  );

  const items = data?.flatMap(p => p.items) ?? [];
  const hasMore = data && data[data.length - 1]?.nextCursor;
  const empty = !isLoading && items.length === 0;

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Carteira</h1>

      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Total ganho"   value={summary ? fmtCents(summary.total_earned_cents) : null} />
        <SummaryCard label="Em hold"       value={summary ? fmtCents(summary.hold_cents) : null} />
        <SummaryCard label="Mês corrente"  value={summary ? fmtCents(summary.month_released_cents) : null} />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onChange={setTab}>{/* ... */}</Tabs>

      {/* Lista */}
      {isLoading && size === 1 && <ExtractSkeleton />}
      {empty && <EmptyState message="Nenhum pagamento ainda" />}
      <ul className="space-y-2">
        {items.map(p => <ExtractRow key={p.id} payout={p} />)}
      </ul>
      {hasMore && (
        <button onClick={() => setSize(size + 1)} className="w-full p-3 text-sm">
          Carregar mais
        </button>
      )}
    </main>
  );
}
```

### `src/components/wallet/ExtractRow.tsx`
- Mostra `service_request.title` + `category`, `status` via `StatusChip`, `amount_cents` formatado, data
- Tap → navega `/(provider)/wallet/payment/[id]`
- Reusa `Card`, `StatusChip` do design system

### `src/lib/format.ts` (helper se não existir)
- `fmtCents(n: number)` → "R$ 123,45"

## Constraints / NÃO fazer
- ❌ `<Dialog>` ou `<Sheet>` cru (nenhum modal aqui; navegação direta)
- ❌ Optimistic update (lista é read-only)
- ❌ Polling agressivo do summary (só 1 fetch no mount; refresh ao voltar para a tela é OK)
- ❌ Fetch dos extracts no server component (cliente precisa de scroll infinito)

## Convenções
- Reuso obrigatório: `Card`, `Skeleton`, `StatusChip`, helper `fmtCents`
- Mobile-first (cards de summary em grid 3-col funciona <360px)
- Cursor pagination (não offset)
- Empty state com texto + ilustração leve (ou só texto no MVP)',
  'UI',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST','INFINITE_SCROLL'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t132, NULL, 'Cards renderizam total ganho, em hold, mês corrente vindos de /api/provider/wallet/summary', 0),
(gen_random_uuid(), v_t132, NULL, 'Tabs filtram por status (all/released/scheduled/under_review) e refazem fetch', 1),
(gen_random_uuid(), v_t132, NULL, 'Lista usa cursor pagination (botão "Carregar mais" ou IntersectionObserver)', 2),
(gen_random_uuid(), v_t132, NULL, 'Skeleton aparece durante primeiro load', 3),
(gen_random_uuid(), v_t132, NULL, 'Empty state visível quando lista vazia (sem layout quebrado)', 4),
(gen_random_uuid(), v_t132, NULL, 'Tap em item navega para /(provider)/wallet/payment/[id]', 5),
(gen_random_uuid(), v_t132, NULL, 'Reusa Card, Skeleton, StatusChip do design system (sem componente novo cru)', 6),
(gen_random_uuid(), v_t132, NULL, 'Layout mobile-first verificado em viewport <360px (3 cards lado a lado responsivos)', 7);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t132, v_ac1),
(v_t132, v_ac5);

-- =============================================================================
-- T-133 [UI] /(provider)/wallet/payment/[id] — detalhe + CTA condicional
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t133,
  'ZLAR-V2-T-133',
  'Renderizar detalhe de payout com CTA condicional "Solicitar saque antecipado" via ResponsiveDialog',
  '## Objetivo
Tela de detalhe de um pagamento programado: mostra serviço, valor, data prevista de liberação, status. Quando `status=scheduled` (e não em disputa), exibe CTA "Solicitar saque antecipado" que abre `ResponsiveDialog` com textarea para motivo (min 20 chars) e POST em `/api/support/early-payout-request`. Cobre AC #3 da US-028.

## Contexto
Módulo PERFIL (PRESTADOR). Consome T-129 (lista) para navegação; aqui faz fetch direto do payout via SSR ou client. Confirmação via `ConfirmDialog` antes do POST. Toast de feedback via `Sonner`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(provider)/wallet/payment/[id]/page.tsx`
```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Field, FormBody } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/ui/status-chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { showErrorToast } from "@/lib/optimistic/toast";

export default function PayoutDetail({ params }: { params: { id: string } }) {
  const [payout, setPayout] = useState<any>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/provider/wallet/extract?limit=1`).then(r=>r.json()); // placeholder
    // (Implementador: criar GET /api/provider/wallet/payout/[id] específico se preferir;
    //  alternativa: incluir dados do payout via prefetch no /extract.)
  }, []);

  const canRequestEarly = payout?.status === "scheduled" && !payout?.has_dispute;

  const submit = async () => {
    try {
      const res = await fetch("/api/support/early-payout-request", {
        method: "POST",
        body: JSON.stringify({ payout_id: params.id, reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Erro ao abrir solicitação");
      }
      toast.success("Solicitação aberta. Suporte vai responder em até 2 dias úteis.");
      setShowSheet(false);
    } catch (e: any) {
      showErrorToast({ type: "create" } as any, e);
    }
  };

  if (!payout) return null;

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-3">
      <h1 className="text-xl font-semibold">{payout.service_request?.title}</h1>
      <StatusChip status={payout.status}/>
      <p>Valor: {payout.amount_cents}</p>
      <p>Liberação prevista: {payout.scheduled_release_at}</p>

      {canRequestEarly && (
        <Button variant="outline" onClick={() => setShowSheet(true)}>
          Solicitar saque antecipado
        </Button>
      )}

      <ResponsiveDialog open={showSheet} onOpenChange={setShowSheet}>
        <ResponsiveDialog.Header>Solicitar saque antecipado</ResponsiveDialog.Header>
        <ResponsiveDialog.Body>
          <FormBody>
            <Field name="reason" required>
              <Field.Label>Motivo (mínimo 20 caracteres)</Field.Label>
              <Field.Control>
                <Textarea value={reason} onChange={e=>setReason(e.target.value)} rows={4}/>
              </Field.Control>
              <Field.Hint>O suporte avalia caso a caso e pode pedir mais infos.</Field.Hint>
            </Field>
          </FormBody>
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button
            disabled={reason.length < 20}
            onClick={() => setConfirm({
              title: "Confirmar solicitação?",
              description: "Você abrirá um ticket no suporte. Não há garantia de aprovação.",
              confirmLabel: "Abrir ticket",
              onConfirm: submit,
            })}
          >
            Enviar
          </Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Mostrar CTA quando payout está `under_review`/`released`/`cancelled` ou `has_dispute=true`
- ❌ `window.confirm()` (proibido — usar `ConfirmDialog`)
- ❌ Validar reason no client com Zod (validação só no server; aqui só `disabled` por length)
- ❌ Remover entry point automaticamente após sucesso — Sonner avisa, sheet fecha; user re-entra na tela e CTA some (porque RLS já bloqueia 2º pedido via UNIQUE)

## Convenções
- Reuso obrigatório: `ResponsiveDialog` (não `<Dialog>` cru), `ConfirmDialog`, `Field`/`FormBody`/`Textarea`, `Button`, `StatusChip`, `Sonner`/`showErrorToast`
- 409 do server vira toast com `error.message` (já vem amigável)
- Mobile-first (sheet vira bottom-sheet)',
  'UI',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t133, NULL, 'Tela renderiza dados do payout (serviço, valor, status, data prevista)', 0),
(gen_random_uuid(), v_t133, NULL, 'CTA "Solicitar saque antecipado" visível APENAS quando status=scheduled E !has_dispute', 1),
(gen_random_uuid(), v_t133, NULL, 'CTA abre ResponsiveDialog (não Dialog cru) com Textarea para motivo', 2),
(gen_random_uuid(), v_t133, NULL, 'Botão Enviar fica disabled enquanto reason.length<20', 3),
(gen_random_uuid(), v_t133, NULL, 'ConfirmDialog (sem window.confirm) abre antes do POST', 4),
(gen_random_uuid(), v_t133, NULL, 'Toast de sucesso ao 200; toast de erro ao 4xx via showErrorToast', 5),
(gen_random_uuid(), v_t133, NULL, 'Field compound API usado (sem <input>/<textarea> cru fora de Field.Control)', 6);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t133, v_ac3);

-- =============================================================================
-- T-134 [UI] /(provider)/history — lista
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t134,
  'ZLAR-V2-T-134',
  'Renderizar tela /(provider)/history com lista cronológica, badges retrabalho/disputa e empty state',
  '## Objetivo
Tela "Meu histórico" do prestador: lista de serviços executados, com badge de retrabalho/disputa quando aplicável, avaliação resumida (estrelas + score), valor e data. Filtros por chip (Todos / Concluídos / Retrabalho / Disputa). Cursor pagination + skeleton + empty state. Cobre AC #4 (lista) e AC #5 (paginação/skeleton/empty).

## Contexto
Módulo PERFIL (PRESTADOR). Consome T-130 (`/api/provider/services/history`). Cada item navega para `/(provider)/history/[serviceId]` (T-135). Reusa padrão de lista de T-122 (US-027 agenda).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(provider)/history/page.tsx`
```tsx
"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Filter = "all"|"completed"|"rework"|"disputed";

export default function HistoryPage() {
  const [filter, setFilter] = useState<Filter>("all");

  const { data, size, setSize, isLoading } = useSWRInfinite(
    (i, prev) => prev && !prev.nextCursor ? null
      : `/api/provider/services/history?limit=20&filter=${filter}`
        + (i>0 && prev?.nextCursor ? `&cursor=${prev.nextCursor}` : ""),
    url => fetch(url).then(r=>r.json())
  );

  const items = data?.flatMap(p => p.items) ?? [];
  const hasMore = data && data[data.length-1]?.nextCursor;
  const empty = !isLoading && items.length === 0;

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Meu histórico</h1>

      <FilterChips value={filter} onChange={setFilter} options={[
        ["all","Todos"], ["completed","Concluídos"], ["rework","Retrabalho"], ["disputed","Disputa"]
      ]}/>

      {isLoading && size===1 && <HistorySkeleton />}
      {empty && <EmptyState message="Você ainda não concluiu serviços." />}
      <ul className="space-y-2">
        {items.map(s => <HistoryRow key={s.id} item={s} />)}
      </ul>
      {hasMore && (
        <button onClick={() => setSize(size+1)} className="w-full p-3 text-sm">
          Carregar mais
        </button>
      )}
    </main>
  );
}
```

### `src/components/history/HistoryRow.tsx`
- Card com título + categoria + data
- Badges condicionais: `<Badge variant="warning">Retrabalho</Badge>`, `<Badge variant="destructive">Em disputa</Badge>`
- Mostra `rating.score` (estrelas), valor `payout.amount_cents`
- Reusa `Card`, `Badge` do design system

## Constraints / NÃO fazer
- ❌ Carregar fotos de execução na lista (peso desnecessário; só no detalhe)
- ❌ Ordenação alternativa (sempre por completed_at DESC)
- ❌ Optimistic update (lista read-only)

## Convenções
- Reuso: `Card`, `Badge`, `Skeleton`
- Filtro chips podem ser simples buttons custom (não há Tabs no design system; ok botões com variant)
- Cursor pagination
- Empty state texto-only no MVP',
  'UI',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST','INFINITE_SCROLL'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t134, NULL, 'Lista renderiza cards com título, categoria, data, valor, avaliação resumida', 0),
(gen_random_uuid(), v_t134, NULL, 'Badges "Retrabalho" e "Em disputa" visíveis apenas quando flags ativas', 1),
(gen_random_uuid(), v_t134, NULL, 'Filtros all/completed/rework/disputed funcionam (refetch ao trocar)', 2),
(gen_random_uuid(), v_t134, NULL, 'Skeleton durante primeiro load', 3),
(gen_random_uuid(), v_t134, NULL, 'Empty state visível com mensagem amigável quando lista vazia', 4),
(gen_random_uuid(), v_t134, NULL, 'Cursor pagination (botão Carregar mais ou IntersectionObserver)', 5),
(gen_random_uuid(), v_t134, NULL, 'Tap navega para /(provider)/history/[serviceId]', 6),
(gen_random_uuid(), v_t134, NULL, 'Reusa Card, Badge, Skeleton (sem componente novo cru)', 7);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t134, v_ac4),
(v_t134, v_ac5);

-- =============================================================================
-- T-135 [UI] /(provider)/history/[serviceId] — detalhe
-- =============================================================================
INSERT INTO "Task" (
  id, reference, title, description, layer, status, type, priority,
  "personaScope", "qualityFlags",
  "userStoryId", "designSessionId", "projectId", "createdByAgent", "updatedAt"
) VALUES (
  v_t135,
  'ZLAR-V2-T-135',
  'Renderizar detalhe de serviço histórico com fotos, avaliação e timeline + link para wallet',
  '## Objetivo
Tela de detalhe de um serviço executado: dados do serviço (categoria, endereço, descrição), galeria de fotos do protocolo fotográfico, avaliação recebida do cliente (estrelas + comentário), timeline de eventos do ciclo de vida, badges de retrabalho/disputa com CTA contextual de resposta. Link "Ver na carteira" navega para `/(provider)/wallet/payment/[payoutId]` (T-133). Cobre AC #4.

## Contexto
Módulo PERFIL (PRESTADOR). Consome dados que dependem de US-005 (protocolo fotográfico), US-013 (avaliação), US-023 (eventos da timeline). Implementador alinha — se ainda faltam endpoints específicos, fazer um GET único `/api/provider/services/history/[id]` que agrega.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(provider)/history/[serviceId]/page.tsx`
```tsx
"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function HistoryDetail({ params }: { params: { serviceId: string } }) {
  // const { data: service } = useSWR(`/api/provider/services/history/${params.serviceId}`, fetcher);
  // (implementador: criar endpoint específico se necessário)

  return (
    <main className="mx-auto max-w-2xl p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{service?.title}</h1>
        <p className="text-sm text-muted-foreground">{service?.category} · {service?.completed_at}</p>
        {service?.has_rework && <Badge variant="warning">Retrabalho</Badge>}
        {service?.has_dispute && <Badge variant="destructive">Em disputa</Badge>}
      </header>

      <Card>
        <h2 className="font-medium">Avaliação do cliente</h2>
        {service?.rating
          ? <p>{service.rating.score}/5 — {service.rating.comment}</p>
          : <p className="text-sm text-muted-foreground">Sem avaliação</p>}
      </Card>

      <Card>
        <h2 className="font-medium">Protocolo fotográfico</h2>
        <PhotoGallery photos={service?.photos ?? []} />
      </Card>

      <Card>
        <h2 className="font-medium">Linha do tempo</h2>
        <Timeline events={service?.events ?? []} />
      </Card>

      {service?.payout?.id && (
        <Link href={`/(provider)/wallet/payment/${service.payout.id}`}>
          <Card className="cursor-pointer">Ver na carteira →</Card>
        </Link>
      )}

      {service?.has_rework && (
        <Link href={`/(provider)/services/${params.serviceId}/rework`}>
          <Badge>Responder solicitação de retrabalho</Badge>
        </Link>
      )}
      {service?.has_dispute && (
        <Link href={`/(provider)/disputes/${service.dispute_id}`}>
          <Badge variant="destructive">Acompanhar disputa</Badge>
        </Link>
      )}
    </main>
  );
}
```

### `src/components/history/PhotoGallery.tsx`
- Grid de thumbs (3-col mobile)
- Tap abre `ResponsiveDialog` com foto fullscreen
- Reusa Storage URLs do bucket `service-photos` (criado em US-005 — checar)

### `src/components/history/Timeline.tsx`
- Lista vertical de eventos (timestamp + descrição)

## Constraints / NÃO fazer
- ❌ Mostrar dados do cliente (nome/foto/contato) — privacidade pós-execução
- ❌ Permitir editar avaliação ou fotos (read-only)
- ❌ Carregar fotos full-res no mount (lazy via thumbs + dialog)
- ❌ Inventar endpoint genérico — alinhar com implementador se criar `/api/provider/services/history/[id]` específico ou reutilizar dado já vindo da lista

## Convenções
- Reuso obrigatório: `Card`, `Badge`, `ResponsiveDialog` (galeria fullscreen)
- Mobile-first (timeline vertical)
- CTAs contextuais com Link para fluxos de US-006 (retrabalho) e US-026 (disputa) — tasks futuras',
  'UI',
  'draft',
  'feature',
  3,
  'PRESTADOR',
  ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST','A11Y_REVIEW'],
  v_us_id, v_ds_id, v_project_id, true, NOW()
);

INSERT INTO "AcceptanceCriterion" (id, "taskId", "userStoryId", text, "order") VALUES
(gen_random_uuid(), v_t135, NULL, 'Tela mostra título, categoria, data de conclusão e badges (rework/dispute condicionais)', 0),
(gen_random_uuid(), v_t135, NULL, 'Card de avaliação mostra score e comentário (ou estado vazio "Sem avaliação")', 1),
(gen_random_uuid(), v_t135, NULL, 'Galeria de fotos renderiza thumbs; tap abre ResponsiveDialog fullscreen', 2),
(gen_random_uuid(), v_t135, NULL, 'Timeline vertical com eventos do ciclo de vida em ordem cronológica', 3),
(gen_random_uuid(), v_t135, NULL, 'Link "Ver na carteira" navega para /(provider)/wallet/payment/[payoutId] quando payout existe', 4),
(gen_random_uuid(), v_t135, NULL, 'CTA contextual "Responder retrabalho" visível APENAS quando has_rework=true', 5),
(gen_random_uuid(), v_t135, NULL, 'CTA contextual "Acompanhar disputa" visível APENAS quando has_dispute=true', 6),
(gen_random_uuid(), v_t135, NULL, 'Reusa Card, Badge, ResponsiveDialog (sem componente novo cru fora de PhotoGallery/Timeline)', 7);

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId") VALUES
(v_t135, v_ac4);

-- =============================================================================
-- TaskDependency — ordens de execução
-- =============================================================================

-- Intra-US: foundations DATA bloqueiam APIs/UI
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- T-126 (cron) bloqueia T-127 (Edge Function) — cron precisa de log table criada por T-126; mas Edge Function precisa do log também
(v_t127, v_t124, 'blocks'),    -- Edge Function lê provider_payouts
(v_t127, v_t126, 'blocks'),    -- Edge Function escreve em release_log
(v_t126, v_t124, 'blocks'),    -- cron precisa de provider_payouts
-- API endpoints bloqueados pelas tabelas
(v_t128, v_t124, 'blocks'),
(v_t129, v_t124, 'blocks'),
(v_t130, v_t124, 'blocks'),
(v_t131, v_t124, 'blocks'),
(v_t131, v_t125, 'blocks'),    -- early-payout-request precisa de support_tickets
-- UI depende dos endpoints
(v_t132, v_t128, 'blocks'),
(v_t132, v_t129, 'blocks'),
(v_t133, v_t129, 'blocks'),
(v_t133, v_t131, 'blocks'),
(v_t134, v_t130, 'blocks'),
(v_t135, v_t130, 'blocks');

-- Cross-US: relates_to (não bloqueante mas referência canônica)
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- T-124 referencia payments (T-071) e service_requests (T-070) via FK
(v_t124, v_t071, 'relates_to'),
(v_t124, v_t070, 'relates_to'),
-- T-125 (support_tickets) reusa padrão de endpoint suporte de T-104
(v_t125, v_t104, 'relates_to'),
-- T-126 reusa padrão pg_cron+Edge Function de T-118
(v_t126, v_t118, 'relates_to'),
(v_t127, v_t118, 'relates_to'),
-- T-129 reusa cursor pattern de T-117
(v_t129, v_t117, 'relates_to'),
(v_t130, v_t117, 'relates_to'),
-- T-132 reusa padrão de listagem de T-122
(v_t132, v_t122, 'relates_to'),
(v_t134, v_t122, 'relates_to'),
-- T-131 reusa padrão de endpoint /api/support/* de T-104
(v_t131, v_t104, 'relates_to');

END $$;

COMMIT;

-- =============================================================================
-- VALIDAÇÕES (executar pós-COMMIT — fora do DO block)
-- =============================================================================

-- 1. Cobertura por AC
\echo '----- VAL 1: Cobertura DATA/API + UI por AC (esperado: 0 linhas exceto SISTEMA AC#2) -----'
SELECT story_ref, ac_order, layers_covered, total_tasks
FROM task_coverage_v
WHERE story_ref = 'ZLAR-V2-US-028'
ORDER BY ac_order;

-- 2. Não-duplicação intra-US
\echo '----- VAL 2: Títulos duplicados (esperado: 0) -----'
SELECT t.title, COUNT(*) FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='ZLAR-V2-US-028'
GROUP BY t.title HAVING COUNT(*) > 1;

-- 3. DATA/API com persona
\echo '----- VAL 3: DATA/API sem RLS_REQUIRED/NO_RLS_NEEDED (esperado: 0) -----'
SELECT t.title, t.layer, t."personaScope", t."qualityFlags"
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='ZLAR-V2-US-028'
  AND t.layer IN ('DATA','API')
  AND t."personaScope" IS NULL
  AND NOT ('RLS_REQUIRED' = ANY(t."qualityFlags") OR 'NO_RLS_NEEDED' = ANY(t."qualityFlags"));

-- 4. Toda task tem checklist técnico
\echo '----- VAL 4: Tasks sem AC-da-Task (esperado: 0) -----'
SELECT t.reference, t.title
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
LEFT JOIN "AcceptanceCriterion" ac ON ac."taskId" = t.id
WHERE s.reference='ZLAR-V2-US-028'
GROUP BY t.reference, t.title
HAVING COUNT(ac.id) = 0;

-- 5. Anti-pattern: "## Critério de pronto" no description
\echo '----- VAL 5: Description com Critério de pronto markdown (esperado: 0) -----'
SELECT t.reference, t.title
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='ZLAR-V2-US-028'
  AND (t.description ILIKE '%## Critério de pronto%' OR t.description ILIKE '%## Definition of done%');

-- 6. Resumo final
\echo '----- VAL 6: Resumo de tasks por camada -----'
SELECT t.layer, COUNT(*) AS n
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='ZLAR-V2-US-028'
GROUP BY t.layer
ORDER BY t.layer;
