-- Zordon backlog cards: ZLAR-V2-US-016 (ADMIN — Dashboard + relatórios)
-- Persona: ADMIN | Module: ADMIN | 11 AC | 14 tasks (T-190..T-203)
-- Persisted into: Task / TaskAcceptanceCriterion / AcceptanceCriterion(taskId) / TaskDependency
-- NÃO contém DDL de produto. Os snippets dentro de description são spec pra
-- implementação futura no banco/repo do produto Zelar.

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-190 DATA admin_alerts
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-190', 'Criar admin_alerts + admin_alert_dismissals com priorização',
 $desc$## Objetivo
Centralizar todos os alertas operacionais que aparecem na fila do dashboard ADMIN (alocação manual pendente, supply zerado, disputa SLA próxima, fila prioritária com cliente esperando), com prioridade calculada e RLS para ADMIN. Cobre AC #4 e suporta AC #1, #5, #6.

## Contexto
Módulo ADMIN — fundação da fila de alertas do dashboard (US-016). Disputas (US-026) já têm sua própria view `dispute_queue_v` (T-146); aqui agregamos referências de TODOS os tipos. Tickets de suporte (US-018) também viram alerta quando SLA estoura. Alertas são criados por triggers/jobs sistêmicos e despachados via `notification_events` (T-159) quando severidade=critical.

## Estado atual / O que substitui
Não existe tabela de alertas operacionais. Hoje admin teria que olhar várias telas separadas.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_admin_alerts.sql`
```sql
BEGIN;

CREATE TYPE admin_alert_kind AS ENUM (
  'manual_allocation_pending',  -- service_request sem prestador no pool
  'supply_zero_peak',            -- categoria com supply=0 em horário de pico
  'supply_below_min',            -- categoria abaixo do mínimo configurado
  'dispute_sla_breach',          -- disputa próxima do SLA
  'support_sla_breach',          -- ticket suporte próximo do SLA
  'priority_queue_waiting'       -- cliente na fila prioritária aguardando
);

CREATE TYPE admin_alert_severity AS ENUM ('info', 'warning', 'critical');

CREATE TABLE admin_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            admin_alert_kind NOT NULL,
  severity        admin_alert_severity NOT NULL,
  entity_type     text,                     -- 'service_request' | 'category' | 'dispute' | 'ticket'
  entity_id       uuid,
  category_id     uuid REFERENCES service_categories(id),
  title           text NOT NULL,
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { client_name, address, eligible_count, ... }
  priority_score  integer NOT NULL,         -- calculado: SLA + idade + severity
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id),
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_alerts_unresolved_idx
  ON admin_alerts(priority_score DESC, "createdAt")
  WHERE resolved_at IS NULL;

CREATE INDEX admin_alerts_kind_idx ON admin_alerts(kind, "createdAt" DESC);
CREATE INDEX admin_alerts_entity_idx ON admin_alerts(entity_type, entity_id);

ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_alerts_admin_all" ON admin_alerts
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Função: priority_score (SISTEMA)
-- Maior = mais urgente. Combina severity (50/100/150) + idade em min + SLA factor.
CREATE OR REPLACE FUNCTION compute_admin_alert_priority(
  p_severity admin_alert_severity,
  p_kind admin_alert_kind,
  p_created_at timestamptz
) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  base int;
  age_factor int;
BEGIN
  base := CASE p_severity WHEN 'critical' THEN 150 WHEN 'warning' THEN 100 ELSE 50 END;
  -- manual_allocation_pending sempre vem antes (cliente esperando)
  IF p_kind = 'manual_allocation_pending' THEN base := base + 100; END IF;
  age_factor := LEAST(EXTRACT(EPOCH FROM (NOW() - p_created_at))/60, 480)::int;
  RETURN base + age_factor;
END $$;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE de `kind`/`entity_id` após criar (alertas são imutáveis exceto resolved_at)
- ❌ Mover dispute_queue_v / dispute_decisions pra cá — já têm tabelas próprias
- ❌ Calcular priority_score no client (sempre pelo banco/Edge Function)
- ❌ Esquecer ENABLE RLS

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Padrão de log imutável (severidade, kind via enum)
- Quando outro módulo emite alerta, INSERT em `admin_alerts` via SECURITY DEFINER function (não direto)$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-191 DATA dashboard_kpis_v + priority_queue
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-191', 'Criar dashboard_kpis_v + admin_supply_status_v + matching_priority_queue',
 $desc$## Objetivo
Prover views agregadoras consultadas pelo dashboard ADMIN em real-time (serviços ativos, supply por categoria, saúde financeira) e tabela `matching_priority_queue` que materializa a fila prioritária de clientes esperando supply. Cobre AC #1, #2, #6 e #11.

## Contexto
Módulo ADMIN. Lê `service_requests` (US-011 T-070), `provider_profiles` (US-001 T-002), `provider_availability_windows` (US-003 T-025), `payments` (T-071), `service_categories` (US-001 T-001). Views são leves o bastante pra rodar em request-time pra alertas/serviços ativos; financeiro entra em mat view (T-193) e revalida 5min.

## Estado atual / O que substitui
Não existe agregação. Hoje admin teria que rodar SQL ad-hoc.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_admin_dashboard_views.sql`
```sql
BEGIN;

-- View 1: KPIs leves (servicos ativos, alertas pendentes count, alocações pendentes)
CREATE OR REPLACE VIEW dashboard_kpis_v AS
SELECT
  (SELECT COUNT(*) FROM service_requests
    WHERE status IN ('matching','accepted','on_the_way','in_progress')) AS active_services,
  (SELECT COUNT(*) FROM service_requests
    WHERE status = 'matching_failed') AS pending_manual_allocation,
  (SELECT COUNT(*) FROM admin_alerts WHERE resolved_at IS NULL) AS unresolved_alerts,
  (SELECT COUNT(*) FROM matching_priority_queue
    WHERE resolved_at IS NULL) AS waiting_in_priority_queue;

-- View 2: Supply por categoria com badge de min operacional
CREATE OR REPLACE VIEW admin_supply_status_v AS
SELECT
  c.id AS category_id,
  c.slug,
  c.name,
  c.icon,
  COUNT(DISTINCT pp.user_id) FILTER (
    WHERE pp.account_status = 'active'
      AND is_provider_available_now(pp.user_id, NOW())   -- US-027 T-114
  ) AS available_now,
  -- min operacional vem de app_config.supply_min_operacional[category_slug]
  COALESCE(
    (current_setting('app.config_supply_min', true)::jsonb ->> c.slug)::int,
    0
  ) AS min_operational
FROM service_categories c
LEFT JOIN provider_categories pc ON pc.category_id = c.id
LEFT JOIN provider_profiles pp ON pp.user_id = pc.provider_id
WHERE c.active = true
GROUP BY c.id, c.slug, c.name, c.icon;

-- Tabela: fila prioritária de clientes (AC #6)
CREATE TABLE matching_priority_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL UNIQUE
                  REFERENCES service_requests(id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES service_categories(id),
  client_id       uuid NOT NULL REFERENCES auth.users(id),
  enqueued_at     timestamptz NOT NULL DEFAULT NOW(),
  resolved_at     timestamptz,
  resolved_provider_id uuid REFERENCES auth.users(id),
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX matching_priority_queue_unresolved_idx
  ON matching_priority_queue(category_id, enqueued_at)
  WHERE resolved_at IS NULL;

ALTER TABLE matching_priority_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "priority_queue_admin_all" ON matching_priority_queue
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "priority_queue_client_own" ON matching_priority_queue
  FOR SELECT USING (auth.uid() = client_id);

GRANT SELECT ON dashboard_kpis_v TO authenticated;
GRANT SELECT ON admin_supply_status_v TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ JOIN custoso de financeiro aqui (vai em T-193 mat view)
- ❌ Permitir cliente ver fila inteira (RLS só sua linha)
- ❌ Index sem WHERE clause (queremos só não-resolvidos quentes)
- ❌ Gravar histórico de KPIs aqui (relatórios usam mat views da T-193)

## Convenções
- View prefixada `dashboard_*` ou `admin_*`
- `is_provider_available_now` reusa T-114 (US-027)
- `service_categories.active` + provider_categories M:N reusam US-001
- Migration via psql; `database.types.ts` regenerado$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-192 DATA report_jobs
('779867f7-51f1-4478-8851-426aa2f461b1', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-192', 'Criar report_jobs (export CSV assíncrono) com RLS por admin',
 $desc$## Objetivo
Persistir requisições de export CSV grandes (relatórios pesados de 6 meses) como jobs assíncronos com status (`queued/processing/done/failed`), URL do arquivo no storage e expiry. Pequenos não usam essa tabela (vão direto streaming). Cobre AC #8.

## Contexto
Módulo ADMIN. Job de geração roda em Edge Function (T-197). Ao concluir, dispara `notification_events` (T-159) pra notificar admin. Arquivos no bucket `admin-reports` (storage Supabase), 7 dias de retenção via lifecycle.

## Estado atual / O que substitui
Não existe. Hoje exports grandes não existem.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_report_jobs.sql`
```sql
BEGIN;

CREATE TYPE report_job_status AS ENUM ('queued','processing','done','failed');

CREATE TABLE report_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by  uuid NOT NULL REFERENCES auth.users(id),
  category      text NOT NULL,    -- 'services' | 'financial' | 'supply_matching' | 'quality' | 'providers'
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        report_job_status NOT NULL DEFAULT 'queued',
  file_path     text,             -- storage path em admin-reports bucket
  row_count     integer,
  error_message text,
  started_at    timestamptz,
  finished_at   timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT (NOW() + interval '7 days'),
  "createdAt"   timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"   timestamptz NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);

CREATE INDEX report_jobs_requester_idx
  ON report_jobs(requested_by, "createdAt" DESC);
CREATE INDEX report_jobs_status_idx
  ON report_jobs(status, "createdAt") WHERE status IN ('queued','processing');

ALTER TABLE report_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_jobs_admin_all" ON report_jobs
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Storage bucket (criado via dashboard ou SQL):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('admin-reports','admin-reports', false);
-- Policy: only admin can read.

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Bucket público (relatórios contém dados financeiros — sempre signed URL)
- ❌ Reter por mais de 7 dias (LGPD: dados pessoais não persistem em export)
- ❌ Permitir admin não-criador deletar jobs alheios
- ❌ Aplicar pg_cron pra limpeza aqui (vive em T-203 OPS)

## Convenções
- Status enum reflete máquina simples; transição feita pela Edge Function (T-197)
- `expires_at` consultado pelo cleanup job
- Bucket `admin-reports` segue padrão `provider-avatars` / `client-avatars`$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-193 DATA mat views relatórios
('a20dddef-3506-4e11-b9a3-62f35b3b6648', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-193', 'Criar materialized views agregadoras dos 5 relatórios consolidados',
 $desc$## Objetivo
Materializar agregações pesadas dos 5 relatórios (services, financeiro, supply/matching, qualidade, prestadores) com refresh agendado (5min p/ financeiro; 15min p/ outros) pra alimentar o dashboard e exports. Cobre AC #7 e #11 (financeiro 5min).

## Contexto
Módulo ADMIN. Lê tabelas de domínio (US-011 service_requests, US-028 provider_payouts, US-013 ratings se existirem, US-001 provider_profiles). Refresh via `pg_cron` (T-203). Edge Function de export (T-197) consome essas mat views ao montar CSV.

## Estado atual / O que substitui
Não existe. Hoje queries de relatório seriam ad-hoc + lentas.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_admin_report_mvs.sql`
```sql
BEGIN;

-- 1. Services daily (taxa conclusão, tempo matching, cancelamentos por motivo)
CREATE MATERIALIZED VIEW report_services_daily_mv AS
SELECT
  date_trunc('day', sr."createdAt")::date AS day,
  c.slug AS category,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE sr.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE sr.status = 'cancelled') AS cancelled,
  AVG(EXTRACT(EPOCH FROM (sr.matched_at - sr.payment_confirmed_at))/60)
    FILTER (WHERE sr.matched_at IS NOT NULL) AS avg_match_min,
  jsonb_object_agg(
    COALESCE(sr.cancellation_reason, 'none'),
    COUNT(*) FILTER (WHERE sr.status = 'cancelled')
  ) FILTER (WHERE sr.status = 'cancelled') AS cancel_reasons
FROM service_requests sr
LEFT JOIN service_categories c ON c.id = sr.category_id
GROUP BY 1, 2;

CREATE UNIQUE INDEX ON report_services_daily_mv(day, category);

-- 2. Financial daily (refresh 5min — AC #11)
CREATE MATERIALIZED VIEW report_financial_daily_mv AS
SELECT
  date_trunc('day', p.captured_at)::date AS day,
  c.slug AS category,
  SUM(p.gross_amount) AS gross,
  SUM(p.platform_commission) AS commission,
  SUM(p.provider_payout_amount) AS payouts,
  AVG(p.gross_amount) AS avg_ticket,
  COUNT(*) AS payment_count
FROM payments p
LEFT JOIN service_requests sr ON sr.id = p.service_request_id
LEFT JOIN service_categories c ON c.id = sr.category_id
WHERE p.status = 'captured'
GROUP BY 1, 2;
CREATE UNIQUE INDEX ON report_financial_daily_mv(day, category);

-- 3. Supply / matching daily
CREATE MATERIALIZED VIEW report_supply_matching_daily_mv AS
SELECT
  date_trunc('day', NOW())::date AS day,  -- snapshot at refresh
  c.slug AS category,
  COUNT(DISTINCT pp.user_id) FILTER (WHERE pp.account_status='active') AS active_providers,
  -- broadcast acceptance: lê service_request_offers se existir; placeholder
  NULL::numeric AS broadcast_accept_rate,
  -- distribuição de jobs (gini coefficient) — placeholder
  NULL::numeric AS jobs_gini
FROM service_categories c
LEFT JOIN provider_categories pc ON pc.category_id = c.id
LEFT JOIN provider_profiles pp ON pp.user_id = pc.provider_id
GROUP BY 1, 2;
CREATE UNIQUE INDEX ON report_supply_matching_daily_mv(day, category);

-- 4. Quality daily (NPS, rating, retrabalho)
CREATE MATERIALIZED VIEW report_quality_daily_mv AS
SELECT
  date_trunc('day', sr.completed_at)::date AS day,
  c.slug AS category,
  AVG(sr.client_rating) FILTER (WHERE sr.client_rating IS NOT NULL) AS avg_rating,
  COUNT(*) FILTER (WHERE sr.has_rework = true) AS rework_count,
  COUNT(*) AS total_completed
FROM service_requests sr
LEFT JOIN service_categories c ON c.id = sr.category_id
WHERE sr.status = 'completed'
GROUP BY 1, 2;
CREATE UNIQUE INDEX ON report_quality_daily_mv(day, category);

-- 5. Providers (cadastros, KYC, distribuição por nível)
CREATE MATERIALIZED VIEW report_providers_daily_mv AS
SELECT
  date_trunc('day', pp."createdAt")::date AS day,
  c.slug AS category,
  COUNT(*) AS new_signups,
  COUNT(*) FILTER (WHERE pp.kyc_status = 'approved') AS kyc_approved,
  COUNT(*) FILTER (WHERE pp.kyc_status = 'rejected') AS kyc_rejected,
  jsonb_object_agg(
    COALESCE(pp.level, 'unranked'),
    COUNT(*)
  ) AS by_level
FROM provider_profiles pp
LEFT JOIN provider_categories pc ON pc.provider_id = pp.user_id
LEFT JOIN service_categories c ON c.id = pc.category_id
GROUP BY 1, 2;
CREATE UNIQUE INDEX ON report_providers_daily_mv(day, category);

GRANT SELECT ON report_services_daily_mv,
                report_financial_daily_mv,
                report_supply_matching_daily_mv,
                report_quality_daily_mv,
                report_providers_daily_mv
  TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Refresh CONCURRENTLY sem unique index (vai falhar)
- ❌ Calcular relatório direto em request (sempre via mat view + filter por período)
- ❌ Expor mat view pra cliente/prestador (só admin via API)
- ❌ Confiar em `client_rating` / `has_rework` se colunas ainda não existirem na story de avaliação (US-013) — implementador pode placeholder NULL

## Convenções
- Refresh agendado em T-203 (`pg_cron`)
- Granularidade: dia por categoria; UI agrega no período
- Padrão financeiro: 5min refresh (AC #11); demais 15min$desc$,
 'DATA', 'ADMIN', ARRAY['NO_RLS_NEEDED','MATERIALIZED_VIEW','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-194 API GET dashboard + alerts
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-194', 'Implementar GET /api/admin/dashboard e GET /api/admin/alerts (fila priorizada)',
 $desc$## Objetivo
Endpoints admin que devolvem (a) snapshot do dashboard (KPIs leves + supply por categoria + financeiro 5min) e (b) fila priorizada de alertas operacionais com paginação. Cobre AC #1, #2, #4, #11.

## Contexto
Módulo ADMIN. Lê `dashboard_kpis_v`, `admin_supply_status_v`, `report_financial_daily_mv` (T-191/193) e `admin_alerts` (T-190). Acessado pela página `/admin` (T-199) e fila lateral (T-199). RLS já filtra (admin via claim); endpoint só rejeita não-admin com 403.

## Estado atual / O que substitui
Não existem endpoints admin de dashboard.

## O que criar

### `src/app/api/admin/dashboard/route.ts`
```ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getClaims();
  // Helper assertAdmin lança 403 se claim app_metadata.role != 'admin'
  await assertAdmin(user);

  const [{ data: kpis }, { data: supply }, { data: fin }] = await Promise.all([
    supabase.from('dashboard_kpis_v').select('*').single(),
    supabase.from('admin_supply_status_v').select('*'),
    // Soma últimos 7 dias do financeiro (mat view 5min)
    supabase.from('report_financial_daily_mv')
      .select('*').gte('day', sevenDaysAgo()),
  ]);
  return NextResponse.json({ kpis, supply, financial7d: aggregate(fin) });
}
```

### `src/app/api/admin/alerts/route.ts`
```ts
const Query = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  kinds: z.array(z.enum(['manual_allocation_pending','supply_zero_peak',...])).optional(),
});

export async function GET(req: Request) {
  await assertAdmin(...);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const supabase = await createClient();
  let query = supabase.from('admin_alerts')
    .select('id, kind, severity, entity_type, entity_id, title, context, priority_score, "createdAt"')
    .is('resolved_at', null)
    .order('priority_score', { ascending: false })
    .order('"createdAt"', { ascending: true })
    .limit(q.limit);
  if (q.kinds?.length) query = query.in('kind', q.kinds);
  if (q.cursor) query = query.lt('priority_score', decodeCursor(q.cursor));
  const { data, error } = await query;
  if (error) return mapPgError(error);
  return NextResponse.json({ items: data, nextCursor: makeCursor(data) });
}
```

### `src/lib/admin/assert.ts`
- Helper `assertAdmin(claims)` lança HttpError(403) se `app_metadata.role != 'admin'`
- Reusa pattern de `lib/roles.ts` (memory `feedback_role_helpers_postgres`)

## Constraints / NÃO fazer
- ❌ Não rodar agregação no client (vem pronto do server)
- ❌ Não permitir filtro de admin não-admin (403 antes de tocar no DB)
- ❌ Não retornar `resolved` na lista padrão (só unresolved)
- ❌ Não usar `LIMIT 1000` cego — sempre cursor

## Convenções
- Reusa `getClaims()` do projeto (memory auth)
- Cursor opaco (base64 do priority_score+id)
- Erros padronizados: 403 (não-admin), 400 (validação Zod)$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-195 API POST manual-allocate
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-195', 'Implementar POST /api/admin/services/[id]/manual-allocate + GET elegíveis',
 $desc$## Objetivo
Permitir que ADMIN aloque manualmente um prestador a um service_request que falhou pool (status=`matching_failed`), notificando cliente e prestador, com auditoria. Endpoint auxiliar lista prestadores elegíveis filtráveis. Cobre AC #5.

## Contexto
Módulo ADMIN. Reusa `apply_status_transition` (US-023 — disponível no schema), enfileira notificações via `enqueue_notification_event` (US-022 T-162). Marca `admin_alerts` como resolved se kind=`manual_allocation_pending`. Exige Idempotency-Key (admin pode duplicar tap).

## Estado atual / O que substitui
Não existe alocação manual. Hoje admin teria que rodar SQL ad-hoc.

## O que criar

### `src/app/api/admin/services/[id]/eligible-providers/route.ts`
```ts
// Lista prestadores que satisfazem categoria + disponibilidade + sem job ativo
const Query = z.object({
  category_id: z.string().uuid(),
  scheduled_at: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await assertAdmin(...);
  // RPC list_eligible_providers(p_service_id, p_limit) que aplica:
  //  - categoria match
  //  - account_status='active'
  //  - is_provider_available_now (T-114 reuso)
  //  - sem service ativo
  //  - ordem: rating desc, distancia asc
  const { data } = await supabase.rpc('list_eligible_providers', {
    p_service_id: params.id, p_limit: 20
  });
  return NextResponse.json({ items: data });
}
```

### `src/app/api/admin/services/[id]/manual-allocate/route.ts`
```ts
const Body = z.object({
  provider_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await assertAdmin(...);
  const idem = req.headers.get('idempotency-key');
  if (!idem) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());

  // RPC allocate_manual(p_service_id, p_provider_id, p_admin_id, p_reason)
  // - valida que service está em 'matching_failed'
  // - cria service_request_offer com status='accepted' (race-safe)
  // - transiciona service_requests.status = 'accepted'
  // - INSERT em service_events (kind='manual_allocated', actor_id=admin)
  // - resolve admin_alerts where entity_id=service_id and kind='manual_allocation_pending'
  // - emit notifications: client (provedor escolhido), provider (novo serviço)
  const { data, error } = await supabase.rpc('allocate_manual', {
    p_service_id: params.id,
    p_provider_id: body.provider_id,
    p_admin_id: ..., p_reason: body.reason,
    p_idempotency_key: idem,
  });
  if (error) return mapRpcError(error);
  return NextResponse.json(data);
}
```

## Constraints / NÃO fazer
- ❌ Permitir alocação se service não estiver em `matching_failed` (409)
- ❌ Permitir prestador não-elegível (RPC valida via mesmo critério da lista)
- ❌ Esquecer de resolver admin_alerts associados (deixa fila inconsistente)
- ❌ Notificar de forma síncrona (sempre via enqueue, US-022)

## Convenções
- Idempotency-Key obrigatório (admin pode tap-double)
- RPC SECURITY DEFINER (admin via claim)
- Audit log em `service_events` (já existe — reusa máquina de estados US-023)
- Notifications via `enqueue_notification_event` (T-162 reuso)$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-196 API GET reports + POST export
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-196', 'Implementar GET /api/admin/reports/[category] + POST /export (sync ou async)',
 $desc$## Objetivo
Endpoint que devolve dados consolidados de relatório por categoria/período (lê mat views da T-193) com gating sync vs async no export CSV: pequeno (≤30 dias ou ≤10k linhas) baixa direto streaming; grande cria `report_jobs` (T-192) e dispara Edge Function (T-197). Cobre AC #7 e #8.

## Contexto
Módulo ADMIN. Lê 5 mat views (T-193), escreve em `report_jobs` (T-192) ao decidir async, dispara Edge Function `generate-report-csv` (T-197). Notifica admin via `enqueue_notification_event` (T-162) ao concluir async.

## Estado atual / O que substitui
Não existe. Hoje admin não tem export.

## O que criar

### `src/app/api/admin/reports/[category]/route.ts`
```ts
const Categories = z.enum(['services','financial','supply_matching','quality','providers']);
const Query = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  category_id: z.string().uuid().optional(),  // filtro adicional
});

export async function GET(req: Request, { params }: { params: { category: string } }) {
  await assertAdmin(...);
  const cat = Categories.parse(params.category);
  const q = Query.parse(...);
  const mv = mvNameFor(cat); // map category → 'report_services_daily_mv' etc
  const { data, error } = await supabase
    .from(mv).select('*')
    .gte('day', q.period_start).lte('day', q.period_end)
    .maybeSingle?.(); // ou .select sem single
  if (error) return mapPgError(error);
  return NextResponse.json({ category: cat, period: q, rows: data });
}
```

### `src/app/api/admin/reports/export/route.ts`
```ts
const Body = z.object({
  category: Categories,
  period_start: z.string().date(),
  period_end: z.string().date(),
  filters: z.record(z.unknown()).default({}),
});

export async function POST(req: Request) {
  await assertAdmin(...);
  const body = Body.parse(await req.json());
  const days = differenceInDays(body.period_end, body.period_start);
  const sync = days <= 30;

  if (sync) {
    // Streamed CSV direto
    const stream = await buildCsvStream(supabase, body);
    return new Response(stream, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': \`attachment; filename="\${body.category}-\${body.period_start}-\${body.period_end}.csv"\`,
      },
    });
  }

  // Async: cria report_job + invoca Edge Function
  const { data: job } = await supabase.from('report_jobs').insert({
    requested_by: user.id, category: body.category,
    period_start: body.period_start, period_end: body.period_end,
    filters: body.filters,
  }).select().single();

  await supabase.functions.invoke('generate-report-csv', { body: { job_id: job.id } });
  return NextResponse.json({ job_id: job.id, status: 'queued' }, { status: 202 });
}
```

### `src/app/api/admin/reports/jobs/route.ts`
- GET lista jobs do admin atual (status, file_path, expires_at)

## Constraints / NÃO fazer
- ❌ Streaming síncrono pra >30 dias (timeout do Vercel/edge)
- ❌ Permitir admin baixar job de outro admin direto via URL pública (sempre signed URL via storage RLS)
- ❌ Esquecer Content-Disposition (browser não baixa)
- ❌ Parâmetros de período sem validação (Zod date faz)

## Convenções
- Headers `Cache-Control: no-store` (relatórios fresh)
- Erros: 403 (não-admin), 400 (período inválido), 422 (categoria desconhecida)
- Async retorna 202 + job_id; UI consulta GET /jobs ou recebe push notif$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-197 API Edge Function generate-report-csv + supply-zero alert
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-197', 'Implementar Edge Functions generate-report-csv + emit-supply-zero-alert',
 $desc$## Objetivo
Duas Edge Functions sistêmicas: (a) `generate-report-csv` consome `report_jobs` (T-192), gera CSV das mat views (T-193), salva em storage `admin-reports`, marca job done e notifica admin; (b) `emit-supply-zero-alert` roda a cada 5min, detecta categorias com supply=0 em horário de pico, cria/atualiza `admin_alerts` e dispara push admin. Cobre AC #3, #8.

## Contexto
Módulo ADMIN. Edge Function consome service_role (sistemas). Push admin via `enqueue_notification_event` com kind=`admin_supply_zero` (US-022 T-162) → dispatcher (T-163) escolhe canal push web. `app_config.peak_hours` (T-203) define horário de pico.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/functions/generate-report-csv/index.ts`
```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { stringify } from 'jsr:@std/csv';

Deno.serve(async (req) => {
  const { job_id } = await req.json();
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  await sb.from('report_jobs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', job_id);
  const { data: job } = await sb.from('report_jobs').select('*').eq('id', job_id).single();
  try {
    const mv = mvFor(job.category);
    const { data: rows, error } = await sb.from(mv)
      .select('*').gte('day', job.period_start).lte('day', job.period_end);
    if (error) throw error;
    const csv = stringify(rows ?? [], { columns: Object.keys(rows?.[0] ?? {}) });
    const path = \`\${job.requested_by}/\${job_id}.csv\`;
    const { error: upErr } = await sb.storage.from('admin-reports').upload(path, csv, { contentType: 'text/csv' });
    if (upErr) throw upErr;
    await sb.from('report_jobs').update({
      status: 'done', file_path: path, row_count: rows?.length ?? 0, finished_at: new Date().toISOString(),
    }).eq('id', job_id);
    await sb.rpc('enqueue_notification_event', {
      p_kind: 'admin_report_ready',
      p_recipient_id: job.requested_by,
      p_payload: { job_id, category: job.category, row_count: rows?.length },
    });
  } catch (e) {
    await sb.from('report_jobs').update({ status: 'failed', error_message: String(e), finished_at: new Date().toISOString() }).eq('id', job_id);
  }
  return new Response('ok');
});
```

### `supabase/functions/emit-supply-zero-alert/index.ts`
```ts
// pg_cron a cada 5min (T-203 OPS)
Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // 1. Carrega peak_hours de app_config
  const { data: cfg } = await sb.from('app_config').select('value').eq('key', 'peak_hours').single();
  if (!isInPeak(cfg?.value)) return new Response('not_peak');
  // 2. Para cada categoria zerada: upsert admin_alerts (1 por categoria/dia)
  const { data: zero } = await sb.from('admin_supply_status_v').select('*').eq('available_now', 0);
  for (const cat of zero ?? []) {
    await sb.from('admin_alerts').upsert({
      kind: 'supply_zero_peak',
      severity: 'critical',
      entity_type: 'category',
      entity_id: cat.category_id,
      category_id: cat.category_id,
      title: \`Supply zerado em \${cat.name} no pico\`,
      context: { category_slug: cat.slug, available_now: 0 },
      priority_score: 250,
    }, { onConflict: 'kind,entity_id', ignoreDuplicates: true });
    // Push pra todos admins via notification_events
    await sb.rpc('enqueue_notification_event', {
      p_kind: 'admin_supply_zero',
      p_recipient_role: 'admin',
      p_payload: { category: cat.slug, name: cat.name },
    });
  }
  return new Response('ok');
});
```

## Constraints / NÃO fazer
- ❌ Logar dados sensíveis no console da Edge (LGPD)
- ❌ Reprocessar job já em status `done`
- ❌ Disparar push individual em vez de bulk role=admin (cara)
- ❌ Hardcode peak_hours no código (vem de app_config T-203)

## Convenções
- Service role só na Edge (NUNCA frontend)
- `enqueue_notification_event` reusa T-162 (US-022)
- CSV UTF-8 com BOM se Excel-friendly necessário (TBD)
- Storage signed URL via `sb.storage.from(...).createSignedUrl(path, 3600*24*7)`$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG','RATE_LIMIT'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-198 REALTIME admin:dashboard
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-198', 'Configurar canal Realtime admin:dashboard com fallback de polling',
 $desc$## Objetivo
Manter dashboard ADMIN atualizado em tempo real (alertas críticos, alocações pendentes, supply zerado). UI subscreve canal `admin:dashboard` e revalida métricas críticas via push; financeiras revalidam via polling 5min (não tempo real). Cobre AC #1, #11.

## Contexto
Módulo ADMIN. Subscriber: PWA admin (`/admin`, T-199). Eventos: INSERT em `admin_alerts`, UPDATE de `service_requests.status` (matching_failed → accepted), changes em `matching_priority_queue`. RLS de admin já filtra (admin claim recebe tudo).

## Estado atual / O que substitui
Não há canal admin.

## O que criar

### `src/hooks/use-admin-dashboard-realtime.ts`
```ts
'use client';
import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

export function useAdminDashboardRealtime(opts: {
  onAlertChange: () => void;
  onAllocationChange: () => void;
  onPriorityQueueChange: () => void;
}) {
  const supabase = createBrowserClient();
  const fallbackRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const channel = supabase
      .channel('admin:dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_alerts' }, opts.onAlertChange)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'service_requests',
        filter: 'status=in.(matching_failed,accepted)',
      }, opts.onAllocationChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matching_priority_queue' }, opts.onPriorityQueueChange)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Fallback: polling 15s
          fallbackRef.current = setInterval(() => {
            opts.onAlertChange(); opts.onAllocationChange(); opts.onPriorityQueueChange();
          }, 15_000);
        } else if (fallbackRef.current) {
          clearInterval(fallbackRef.current);
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (fallbackRef.current) clearInterval(fallbackRef.current);
    };
  }, [opts.onAlertChange, opts.onAllocationChange, opts.onPriorityQueueChange]);
}
```

## Constraints / NÃO fazer
- ❌ Sem unsubscribe no unmount (memory leak no SPA)
- ❌ Subscrever sem RLS (admin não-claim recebe nada — esperado)
- ❌ Confiar 100% em Realtime (cair pra polling em CHANNEL_ERROR)
- ❌ Polling agressivo (<10s) mata o backend

## Convenções
- Nome do canal: `admin:dashboard` (singular global pra todos admins)
- Eventos identificados via callbacks separados (não 1 grandão)
- Fallback de 15s após CHANNEL_ERROR$desc$,
 'REALTIME', 'ADMIN', ARRAY['REALTIME_CHANNEL'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-199 UI /admin dashboard
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-199', 'Renderizar /admin dashboard com KPIs, supply, fila de alertas',
 $desc$## Objetivo
Tela ADMIN inicial pós-login: cards de KPI (serviços ativos, alertas pendentes, alocações manuais, fila prioritária), grid de supply por categoria (com badge de min operacional vermelho/amarelo/verde), bloco de saúde financeira (últimos 7 dias), e lateral com fila priorizada de alertas (ações inline). Cobre AC #1, #2, #4, #11. Botão de alocação manual abre sheet (T-200).

## Contexto
Módulo ADMIN. Reusa `Card`, `Skeleton`, `StatusChip`, `Badge` do design system. Consome `/api/admin/dashboard` (T-194) e `/api/admin/alerts` (T-194). Subscreve realtime via `useAdminDashboardRealtime` (T-198). Texto admin em pt-BR.

## Estado atual / O que substitui
Não existe `/admin` page funcional. Será a primeira tela após login admin.

## O que criar

### `src/app/admin/page.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAdminDashboardRealtime } from '@/hooks/use-admin-dashboard-realtime';
import { useState, useCallback } from 'react';
import { ManualAllocationSheet } from '@/components/admin/manual-allocation-sheet';
import { AlertQueueList } from '@/components/admin/alert-queue-list';

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<AdminAlert[] | null>(null);
  const [allocSheet, setAllocSheet] = useState<{ serviceId: string } | null>(null);

  const refetchDashboard = useCallback(async () => {
    setData(await fetch('/api/admin/dashboard').then(r => r.json()));
  }, []);
  const refetchAlerts = useCallback(async () => {
    setAlerts((await fetch('/api/admin/alerts').then(r => r.json())).items);
  }, []);

  useAdminDashboardRealtime({
    onAlertChange: refetchAlerts,
    onAllocationChange: refetchDashboard,
    onPriorityQueueChange: refetchDashboard,
  });

  return (
    <main className="grid gap-4 p-4 md:grid-cols-[1fr_360px]">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Ativos" value={data?.kpis.active_services} />
        <KpiCard label="Alocação manual" value={data?.kpis.pending_manual_allocation} variant="warning" />
        <KpiCard label="Alertas" value={data?.kpis.unresolved_alerts} variant="critical" />
        <KpiCard label="Fila prioritária" value={data?.kpis.waiting_in_priority_queue} />

        <Card className="col-span-full">
          <h2 className="text-sm font-medium mb-2">Supply por categoria</h2>
          <SupplyGrid items={data?.supply} />
        </Card>

        <Card className="col-span-full">
          <h2 className="text-sm font-medium mb-2">Financeiro (últimos 7 dias)</h2>
          <p className="text-xs text-muted-foreground">Atualiza a cada 5min</p>
          <FinancialSummary data={data?.financial7d} />
        </Card>
      </section>

      <aside className="md:sticky md:top-4 md:self-start">
        <AlertQueueList
          items={alerts}
          onManualAllocate={(serviceId) => setAllocSheet({ serviceId })}
        />
      </aside>

      {allocSheet && (
        <ManualAllocationSheet
          serviceId={allocSheet.serviceId}
          open onOpenChange={() => setAllocSheet(null)}
        />
      )}
    </main>
  );
}
```

### `src/components/admin/kpi-card.tsx`
- Card simples valor + label, variant `warning|critical|default`

### `src/components/admin/supply-grid.tsx`
- Grid de categorias; cada uma mostra `available_now / min_operational`
- Badge verde se `available_now >= min`, amarelo se >0 mas <min, vermelho se 0

### `src/components/admin/alert-queue-list.tsx`
- Lista priorizada vinda de /api/admin/alerts
- Cada item: severidade + título + contexto + ação contextual
  - kind=manual_allocation_pending → botão "Alocar manualmente" (chama onManualAllocate)
  - kind=dispute_sla_breach → link pra /admin/disputes/[id] (US-026 reuse)
  - kind=support_sla_breach → link pra /admin/support/tickets/[id] (US-018 reuse)
  - kind=supply_zero_peak → texto + link "Ver detalhes" pro relatório de supply
- StatusChip / Badge / Skeleton

## Constraints / NÃO fazer
- ❌ Marcar arquivo como server component (precisa client por realtime)
- ❌ Componente novo de modal (usar ResponsiveSheet via T-200)
- ❌ Polling local sobreposto ao realtime (T-198 já trata fallback)
- ❌ Inputs/forms aqui (sheet de alocação cuida)

## Convenções
- Reuso: `Card`, `Badge`, `StatusChip`, `Skeleton`, `Sonner` (erros)
- Layout mobile-first; aside vira drawer top em <md
- pt-BR direto (sem i18n)$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-200 UI ManualAllocationSheet
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-200', 'Renderizar ManualAllocationSheet com lista elegíveis e ação alocar',
 $desc$## Objetivo
Sheet (mobile-first) que ADMIN abre a partir do dashboard ou da fila de alertas para alocar prestador a service em `matching_failed`. Mostra dados do serviço, lista de elegíveis filtrável (categoria + ordenação por rating), botão "Alocar" com confirmação, feedback de sucesso/erro. Cobre AC #5.

## Contexto
Módulo ADMIN. Reusa `ResponsiveSheet`, `Field`/`FormBody`, `Button`, `ConfirmDialog`, `Sonner`. Consome `/api/admin/services/[id]/eligible-providers` e `/api/admin/services/[id]/manual-allocate` (T-195). Idempotency-Key gerado uma vez por mount do sheet.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/admin/manual-allocation-sheet.tsx`
```tsx
'use client';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';
import { useEffect, useMemo, useState } from 'react';

export function ManualAllocationSheet({ serviceId, open, onOpenChange }: Props) {
  const idemKey = useMemo(() => crypto.randomUUID(), [serviceId]);
  const [eligible, setEligible] = useState<Provider[] | null>(null);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{ provider: Provider } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(\`/api/admin/services/\${serviceId}/eligible-providers\`)
      .then(r => r.json()).then(d => setEligible(d.items));
  }, [open, serviceId]);

  const filtered = (eligible ?? []).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleAllocate = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch(\`/api/admin/services/\${serviceId}/manual-allocate\`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idemKey },
        body: JSON.stringify({ provider_id: confirm.provider.id }),
      });
      if (!res.ok) throw await res.json();
      toast.success('Prestador alocado. Cliente notificado.');
      onOpenChange(false);
    } catch (e: any) {
      showErrorToast({ type: 'patch', id: serviceId } as any, e);
    } finally { setBusy(false); setConfirm(null); }
  };

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
        <ResponsiveSheet.Header>Alocar prestador manualmente</ResponsiveSheet.Header>
        <ResponsiveSheet.Body>
          <FormBody density="compact">
            <Field name="search">
              <Field.Label>Buscar prestador</Field.Label>
              <Field.Control>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome..." />
              </Field.Control>
            </Field>
          </FormBody>
          <ul className="mt-3 divide-y">
            {filtered.map(p => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">⭐ {p.rating?.toFixed(1)} · {p.distance_km} km</p>
                </div>
                <Button size="sm" onClick={() => setConfirm({ provider: p })}>Alocar</Button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && eligible !== null && (
            <p className="text-center text-sm text-muted-foreground py-6">
              Nenhum prestador elegível encontrado.
            </p>
          )}
        </ResponsiveSheet.Body>
      </ResponsiveSheet>

      <ConfirmDialog
        state={confirm && {
          title: \`Alocar \${confirm.provider.name}?\`,
          description: 'O cliente será notificado imediatamente.',
          confirmLabel: busy ? 'Alocando...' : 'Alocar',
          onConfirm: handleAllocate,
        }}
        onClose={() => !busy && setConfirm(null)}
      />
    </>
  );
}
```

## Constraints / NÃO fazer
- ❌ `<Sheet>` ou `<Dialog>` cru (usar Responsive*)
- ❌ `window.confirm()` (usar ConfirmDialog)
- ❌ Refazer Idempotency-Key a cada click (race-conditions: mesma chave por sheet)
- ❌ Validação Zod no client (servidor valida)
- ❌ Esconder erros de 409 (mostrar toast com "outro admin já alocou")

## Convenções
- ResponsiveSheet size="md" (480-640px desktop)
- Field compound API (memory `project_ui_patterns`)
- Toasts via Sonner (`showErrorToast` para 4xx/5xx)
- Mobile-first; lista vira bottom-sheet 90dvh em <768px$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-201 UI /admin/reports
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-201', 'Renderizar /admin/reports com 5 abas, filtro de período e nota de conciliação',
 $desc$## Objetivo
Tela de relatórios consolidados: tabs (Serviços, Financeiro, Supply/Matching, Qualidade, Prestadores), filtro de período (dia/semana/mês/customizado), tabela ou gráfico simples por categoria, estado vazio consistente, skeleton em carga. Aba Financeiro mostra nota fixa sobre conciliação. Cobre AC #7, #9, #10.

## Contexto
Módulo ADMIN. Reusa `Tabs` (existente?) ou estrutura simples com `Card` + `Button` segmented. Consome `/api/admin/reports/[category]` (T-196). Botão Exportar dispara fluxo da T-202.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/admin/reports/page.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { ExportCsvButton } from '@/components/admin/export-csv-button';

const TABS = [
  { key: 'services', label: 'Serviços' },
  { key: 'financial', label: 'Financeiro' },
  { key: 'supply_matching', label: 'Supply & Matching' },
  { key: 'quality', label: 'Qualidade' },
  { key: 'providers', label: 'Prestadores' },
] as const;

export default function AdminReportsPage() {
  const [tab, setTab] = useState<typeof TABS[number]['key']>('services');
  const [start, setStart] = useState(defaultStart()); // últimos 7 dias
  const [end, setEnd] = useState(today());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(\`/api/admin/reports/\${tab}?period_start=\${start}&period_end=\${end}\`);
      const json = await res.json();
      setData(json);
    } finally { setLoading(false); }
  }

  return (
    <main className="p-4 max-w-6xl mx-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Relatórios</h1>
        <ExportCsvButton category={tab} period={{ start, end }} />
      </header>

      <nav className="mt-4 flex flex-wrap gap-2 overflow-x-auto" role="tablist">
        {TABS.map(t => (
          <Button key={t.key} size="sm"
            variant={tab === t.key ? 'default' : 'outline'}
            onClick={() => setTab(t.key)}>{t.label}</Button>
        ))}
      </nav>

      <Card className="mt-4">
        <FormBody density="compact">
          <Field.Row cols={2}>
            <Field name="start"><Field.Label>De</Field.Label>
              <Field.Control><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field.Control>
            </Field>
            <Field name="end"><Field.Label>Até</Field.Label>
              <Field.Control><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field.Control>
            </Field>
          </Field.Row>
          <Button onClick={load} disabled={loading}>{loading ? 'Carregando...' : 'Aplicar'}</Button>
        </FormBody>
      </Card>

      {tab === 'financial' && (
        <p className="mt-3 text-xs text-muted-foreground">
          ℹ️ Valores baseados em registros internos. A conciliação definitiva deve ser feita no painel do gateway de pagamento.
        </p>
      )}

      <section className="mt-4">
        {loading && <Skeleton className="h-64 w-full" />}
        {!loading && data?.rows?.length === 0 && (
          <Card>
            <p className="text-center text-sm text-muted-foreground py-12">
              Sem dados no período selecionado. Tente um intervalo maior.
            </p>
          </Card>
        )}
        {!loading && data?.rows && data.rows.length > 0 && (
          <ReportTable category={tab} rows={data.rows} />
        )}
      </section>
    </main>
  );
}
```

### `src/components/admin/report-table.tsx`
- Renderiza tabela simples (Card-based em mobile, table em desktop)
- Por categoria, escolhe colunas certas (services: total/completed/cancelled/avg_match_min...)

### `src/components/admin/export-csv-button.tsx`
- Wrapper Button que dispara fluxo da T-202

## Constraints / NÃO fazer
- ❌ Esconder a nota de conciliação ao trocar período (sempre visível em financial)
- ❌ Permitir período inválido (`start > end`) — disable Aplicar
- ❌ Componente novo de gráfico se não existir lib (TBD: usar tabela; gráfico opcional)
- ❌ react-hook-form (memory `project_ui_patterns`)

## Convenções
- pt-BR direto
- Empty state com mensagem orientativa (sem erro vermelho)
- Skeleton durante load (memory `project_ui_patterns`)
- Mobile-first: tabs viram scroll horizontal em <md$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-202 UI export CSV flow
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-202', 'Renderizar fluxo de export CSV (sync download + async progress + jobs list)',
 $desc$## Objetivo
Componente `ExportCsvButton` que (a) baixa direto se backend retornar CSV streaming, (b) mostra toast "preparando relatório" + adiciona à lista de jobs se backend retornar 202 + job_id, e (c) renderiza um drawer/sheet com lista dos jobs do admin (status + link de download quando done). Cobre AC #8.

## Contexto
Módulo ADMIN. Consome POST /api/admin/reports/export (T-196) e GET /api/admin/reports/jobs (T-196). Notificação de "relatório pronto" vem via push (US-022) — o sheet de jobs apenas mostra estado atual.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/admin/export-csv-button.tsx`
```tsx
'use client';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Badge } from '@/components/ui/badge';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';
import { useState } from 'react';

export function ExportCsvButton({ category, period }: Props) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/reports/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, period_start: period.start, period_end: period.end }),
      });
      if (res.status === 202) {
        const { job_id } = await res.json();
        toast.info('Relatório grande. Geração em background — vamos te avisar.');
        await refreshJobs();
        setOpen(true);
      } else if (res.ok) {
        // streamed CSV — força download via blob
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = \`\${category}-\${period.start}-\${period.end}.csv\`;
        a.click(); URL.revokeObjectURL(url);
      } else {
        throw await res.json();
      }
    } catch (e: any) {
      showErrorToast({ type: 'create', id: 'export' } as any, e);
    } finally { setBusy(false); }
  }

  async function refreshJobs() {
    const res = await fetch('/api/admin/reports/jobs');
    setJobs((await res.json()).items ?? []);
  }

  async function downloadJob(job: ReportJob) {
    // backend retorna signed URL temporária
    const res = await fetch(\`/api/admin/reports/jobs/\${job.id}/download\`);
    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <>
      <div className="flex gap-2">
        <Button onClick={handleExport} disabled={busy}>Exportar CSV</Button>
        <Button variant="outline" onClick={() => { refreshJobs(); setOpen(true); }}>Meus exports</Button>
      </div>
      <ResponsiveSheet open={open} onOpenChange={setOpen} size="md">
        <ResponsiveSheet.Header>Meus exports</ResponsiveSheet.Header>
        <ResponsiveSheet.Body>
          {jobs.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Você não tem exports recentes.
            </p>
          )}
          <ul className="divide-y">
            {jobs.map(j => (
              <li key={j.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{j.category} — {j.period_start} a {j.period_end}</p>
                  <p className="text-xs text-muted-foreground">
                    Criado em {formatDate(j.createdAt)} · {j.row_count ?? '—'} linhas
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={j.status === 'done' ? 'default' : j.status === 'failed' ? 'destructive' : 'secondary'}>
                    {j.status}
                  </Badge>
                  {j.status === 'done' && <Button size="sm" onClick={() => downloadJob(j)}>Baixar</Button>}
                </div>
              </li>
            ))}
          </ul>
        </ResponsiveSheet.Body>
      </ResponsiveSheet>
    </>
  );
}
```

## Constraints / NÃO fazer
- ❌ Permitir clique repetido com mesmo período sem feedback (disable durante busy)
- ❌ Forçar download via `<a target="_blank">` da URL signed (algumas browsers bloqueiam) — usar `window.location.href`
- ❌ Polling agressivo de jobs (refresh sob demanda + push do US-022 já notifica)
- ❌ Esquecer revoke de Object URL (memory leak)

## Convenções
- ResponsiveSheet size="md"
- Status mapeado pra Badge variant (done/failed/queued/processing)
- Reuso `Sonner` toast para feedback
- pt-BR direto$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-203 OPS app_config admin + pg_cron
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '36fa3044-cb7c-4644-89c3-35e8817c6e2f',
 'ZLAR-V2-T-203', 'Seedar app_config (supply_min, peak_hours) + pg_cron jobs admin',
 $desc$## Objetivo
Configurar parâmetros operacionais editáveis pelo admin e jobs `pg_cron` que sustentam o dashboard: refresh de mat views (5min financeiro, 15min outros), execução de `emit-supply-zero-alert`, processamento da `matching_priority_queue` (re-aloca quando supply chega), cleanup de `report_jobs` expirados. Cobre AC #2 (min operacional), #3 (peak hours), #6 (priority queue), #7 (refresh), #11 (5min financial).

## Contexto
Módulo ADMIN. Reusa `app_config` (US-010 T-064 — já criada). Edge Functions invocadas: `emit-supply-zero-alert` e `generate-report-csv` (T-197). RPC interno `process_matching_priority_queue` lê fila, tenta alocar via `list_eligible_providers` (T-195) e dispara notif.

## Estado atual / O que substitui
`app_config` existe (US-010). Aqui só adicionamos chaves novas. Nenhum `pg_cron` admin existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_admin_ops.sql`
```sql
BEGIN;

-- 1. Seed de chaves no app_config existente
INSERT INTO app_config (key, value, description) VALUES
  ('supply_min_operacional',
   '{"reformas":3,"limpeza":5,"eletricista":2,"encanador":2,"diarista":4,"jardinagem":2,"tecnologia":2}'::jsonb,
   'Mínimo de prestadores ativos por categoria'),
  ('peak_hours',
   '{"start":"08:00","end":"20:00","timezone":"America/Sao_Paulo"}'::jsonb,
   'Janela de horário de pico'),
  ('admin_alert_sla_minutes',
   '{"manual_allocation":15,"dispute":120,"support":240}'::jsonb,
   'SLA por tipo de alerta admin (em minutos)'),
  ('report_async_threshold_days', '30'::jsonb, 'Período acima do qual export vira async')
ON CONFLICT (key) DO NOTHING;

-- 2. Função RPC: process_matching_priority_queue (chamada por pg_cron a cada 1min)
CREATE OR REPLACE FUNCTION process_matching_priority_queue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  q record;
  candidate uuid;
  resolved_count int := 0;
BEGIN
  FOR q IN
    SELECT * FROM matching_priority_queue
    WHERE resolved_at IS NULL
    ORDER BY enqueued_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Pega 1 elegível (rating desc)
    SELECT user_id INTO candidate
    FROM provider_profiles pp
    JOIN provider_categories pc ON pc.provider_id = pp.user_id
    WHERE pc.category_id = q.category_id
      AND pp.account_status = 'active'
      AND is_provider_available_now(pp.user_id, NOW())
    ORDER BY COALESCE(pp.rating_avg, 0) DESC
    LIMIT 1;
    IF candidate IS NOT NULL THEN
      -- Aloca: aciona allocate_manual com actor=system
      PERFORM allocate_manual(q.service_request_id, candidate, NULL, 'priority_queue_release');
      UPDATE matching_priority_queue
        SET resolved_at = NOW(), resolved_provider_id = candidate
        WHERE id = q.id;
      resolved_count := resolved_count + 1;
    END IF;
  END LOOP;
  RETURN resolved_count;
END $$;

-- 3. pg_cron jobs (extensão pg_cron já habilitada)
SELECT cron.schedule('refresh_report_financial', '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY report_financial_daily_mv;$$);

SELECT cron.schedule('refresh_report_others', '*/15 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY report_services_daily_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY report_supply_matching_daily_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY report_quality_daily_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY report_providers_daily_mv;$$);

SELECT cron.schedule('emit_supply_zero_alert', '*/5 * * * *',
  $$SELECT net.http_post('https://<ref>.functions.supabase.co/emit-supply-zero-alert',
    headers := jsonb_build_object('Authorization','Bearer ' || current_setting('app.fn_invoke_token')));$$);

SELECT cron.schedule('process_priority_queue', '*/1 * * * *',
  $$SELECT process_matching_priority_queue();$$);

SELECT cron.schedule('cleanup_report_jobs', '0 3 * * *',
  $$DELETE FROM report_jobs WHERE expires_at < NOW();
    -- também limpar arquivos no storage via Edge Function separada$$);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Hardcode tokens no SQL (usar `current_setting('app.fn_invoke_token')` configurado no instance)
- ❌ Permitir non-admin escrever em app_config (RLS de US-010 T-064 já trata; aqui só seed)
- ❌ Job de refresh sem `CONCURRENTLY` (lock em mat view degrada UI)
- ❌ Esquecer ON CONFLICT no seed (rerun safe)

## Convenções
- Chaves snake_case (consistente com US-010)
- pg_cron job names prefixados (`refresh_*`, `emit_*`, `process_*`, `cleanup_*`)
- Timezone fixo America/Sao_Paulo
- Edge Function invocation via `net.http_post` (extension pg_net habilitada)$desc$,
 'OPS', 'SISTEMA', ARRAY['NO_RLS_NEEDED','AUDIT_LOG'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculo task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-190 admin_alerts: AC #4 (fila priorizada)
  ('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0'::uuid, 4),

  -- T-191 dashboard_kpis_v + supply + priority queue: AC #1, #2, #6, #11
  ('425feb93-51ca-4bde-9d84-a0308775a9a4'::uuid, 1),
  ('425feb93-51ca-4bde-9d84-a0308775a9a4'::uuid, 2),
  ('425feb93-51ca-4bde-9d84-a0308775a9a4'::uuid, 6),
  ('425feb93-51ca-4bde-9d84-a0308775a9a4'::uuid, 11),

  -- T-192 report_jobs: AC #8
  ('779867f7-51f1-4478-8851-426aa2f461b1'::uuid, 8),

  -- T-193 mat views: AC #7, #11
  ('a20dddef-3506-4e11-b9a3-62f35b3b6648'::uuid, 7),
  ('a20dddef-3506-4e11-b9a3-62f35b3b6648'::uuid, 11),

  -- T-194 GET dashboard + alerts: AC #1, #2, #4, #11
  ('21ffd791-ccbe-4b58-b076-68053e32f7d8'::uuid, 1),
  ('21ffd791-ccbe-4b58-b076-68053e32f7d8'::uuid, 2),
  ('21ffd791-ccbe-4b58-b076-68053e32f7d8'::uuid, 4),
  ('21ffd791-ccbe-4b58-b076-68053e32f7d8'::uuid, 11),

  -- T-195 manual-allocate: AC #5
  ('88af77fa-2079-44c3-a5bf-1a3500a82b3c'::uuid, 5),

  -- T-196 reports + export API: AC #7, #8
  ('dd89c834-6fb0-49b1-a60d-51a50d0a8e31'::uuid, 7),
  ('dd89c834-6fb0-49b1-a60d-51a50d0a8e31'::uuid, 8),

  -- T-197 Edge Functions CSV + supply alert: AC #3, #8
  ('7c3de682-c191-487d-a4c9-b1365f5f894d'::uuid, 3),
  ('7c3de682-c191-487d-a4c9-b1365f5f894d'::uuid, 8),

  -- T-198 Realtime admin:dashboard: AC #1, #11
  ('2fd87337-f882-42fa-b6c2-b1115c4d89e9'::uuid, 1),
  ('2fd87337-f882-42fa-b6c2-b1115c4d89e9'::uuid, 11),

  -- T-199 UI /admin dashboard: AC #1, #2, #4, #11
  ('c1091b3f-7703-4f65-a857-fb9133aa2d7a'::uuid, 1),
  ('c1091b3f-7703-4f65-a857-fb9133aa2d7a'::uuid, 2),
  ('c1091b3f-7703-4f65-a857-fb9133aa2d7a'::uuid, 4),
  ('c1091b3f-7703-4f65-a857-fb9133aa2d7a'::uuid, 11),

  -- T-200 ManualAllocationSheet: AC #5
  ('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac'::uuid, 5),

  -- T-201 /admin/reports: AC #7, #9, #10
  ('f5905cca-16a5-42af-9007-cfd4f4f5cf24'::uuid, 7),
  ('f5905cca-16a5-42af-9007-cfd4f4f5cf24'::uuid, 9),
  ('f5905cca-16a5-42af-9007-cfd4f4f5cf24'::uuid, 10),

  -- T-202 export CSV flow: AC #8
  ('ea62429e-2a23-415d-a2d5-1ffeedabe73c'::uuid, 8),

  -- T-203 OPS seed + pg_cron: AC #2, #3, #6, #7, #11
  ('bfc20471-88f9-4260-ae8d-9d539cb14387'::uuid, 2),
  ('bfc20471-88f9-4260-ae8d-9d539cb14387'::uuid, 3),
  ('bfc20471-88f9-4260-ae8d-9d539cb14387'::uuid, 6),
  ('bfc20471-88f9-4260-ae8d-9d539cb14387'::uuid, 7),
  ('bfc20471-88f9-4260-ae8d-9d539cb14387'::uuid, 11)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order
  AND ac."taskId" IS NULL;

-- ============================================================================
-- 3. AcceptanceCriterion(taskId) — checklist técnico
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
-- T-190 admin_alerts
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'Tabela admin_alerts criada com enums admin_alert_kind/admin_alert_severity', 1),
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'Tabela admin_alert_dismissals criada (1:N por admin)', 2),
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'Função compute_admin_alert_priority retorna inteiro coerente (smoke: critical > warning > info)', 3),
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'RLS: smoke ADMIN lê tudo; cliente/prestador autenticado retorna 0 linhas', 4),
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'Index admin_alerts_unresolved_idx ativo (EXPLAIN mostra index scan ao filtrar resolved_at IS NULL)', 5),
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'Trigger updatedAt funciona em UPDATE (resolved_at)', 6),

-- T-191 dashboard_kpis_v + supply + priority queue
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'View dashboard_kpis_v retorna 1 linha com 4 contadores (active_services, pending_manual_allocation, unresolved_alerts, waiting_in_priority_queue)', 1),
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'View admin_supply_status_v retorna 1 linha por categoria active com available_now e min_operational', 2),
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'Tabela matching_priority_queue criada com UNIQUE(service_request_id) e RLS admin/cliente', 3),
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'Index matching_priority_queue_unresolved_idx por (category_id, enqueued_at) cobre query do job process', 4),
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'GRANT SELECT em ambas views para authenticated funciona (admin/cliente respeitam RLS de origem)', 5),
('425feb93-51ca-4bde-9d84-a0308775a9a4', 'is_provider_available_now (US-027 T-114) reutilizada sem duplicar', 6),

-- T-192 report_jobs
('779867f7-51f1-4478-8851-426aa2f461b1', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('779867f7-51f1-4478-8851-426aa2f461b1', 'Tabela report_jobs criada com enum report_job_status', 1),
('779867f7-51f1-4478-8851-426aa2f461b1', 'CHECK (period_end >= period_start) impede período inválido', 2),
('779867f7-51f1-4478-8851-426aa2f461b1', 'Index report_jobs_status_idx parcial (queued|processing) ativo', 3),
('779867f7-51f1-4478-8851-426aa2f461b1', 'RLS: ADMIN ALL; cliente/prestador retorna 0 linhas', 4),
('779867f7-51f1-4478-8851-426aa2f461b1', 'Bucket admin-reports criado (não-público) com policy admin-only', 5),

-- T-193 mat views
('a20dddef-3506-4e11-b9a3-62f35b3b6648', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('a20dddef-3506-4e11-b9a3-62f35b3b6648', '5 mat views criadas: services/financial/supply_matching/quality/providers (granularidade dia × categoria)', 1),
('a20dddef-3506-4e11-b9a3-62f35b3b6648', 'Cada mat view tem UNIQUE INDEX (day, category) — habilita REFRESH CONCURRENTLY', 2),
('a20dddef-3506-4e11-b9a3-62f35b3b6648', 'GRANT SELECT to authenticated; ADMIN consome via API', 3),
('a20dddef-3506-4e11-b9a3-62f35b3b6648', 'REFRESH MATERIALIZED VIEW CONCURRENTLY funciona em todas as 5', 4),
('a20dddef-3506-4e11-b9a3-62f35b3b6648', 'Smoke: rodar refresh + SELECT retorna linhas coerentes com domínio', 5),

-- T-194 GET dashboard + alerts API
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'GET /api/admin/dashboard retorna 200 com kpis, supply[], financial7d', 0),
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'GET /api/admin/alerts retorna lista priorizada com cursor', 1),
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'Endpoint valida query params com Zod (400 em formato inválido)', 2),
('21ffd791-ccbe-4b58-b076-68053e32f7d8', '403 quando claim app_metadata.role != admin (assertAdmin)', 3),
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'Cursor opaco (base64) consistente entre requests', 4),
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'Filter by kinds[] funciona (smoke: passa kinds=[manual_allocation_pending])', 5),
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'Logs estruturados (admin_id, action, latency)', 6),

-- T-195 manual-allocate
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'POST /api/admin/services/[id]/manual-allocate exige Idempotency-Key (400 sem header)', 0),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'GET eligible-providers retorna lista filtrada por categoria + disponibilidade', 1),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', '403 quando admin não-claim; 409 quando service não está em matching_failed', 2),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'RPC allocate_manual SECURITY DEFINER, transação atômica (race-safe via FOR UPDATE)', 3),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'Mesma idempotency_key 2x não duplica alocação (smoke)', 4),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'Cliente recebe notificação via enqueue_notification_event (T-162); prestador idem', 5),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'admin_alerts where kind=manual_allocation_pending e entity_id=service_id ficam resolved', 6),
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'service_events registra (kind=manual_allocated, actor_id=admin)', 7),

-- T-196 reports + export API
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'GET /api/admin/reports/[category]?period_start&period_end retorna 200 com rows', 0),
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'Categoria fora do enum retorna 422', 1),
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'POST /api/admin/reports/export sync (≤30 dias) retorna CSV streaming com Content-Disposition', 2),
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'POST /api/admin/reports/export async (>30 dias) retorna 202 + job_id', 3),
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'GET /api/admin/reports/jobs lista report_jobs do admin atual', 4),
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', '403 em qualquer endpoint sem claim admin', 5),

-- T-197 Edge Functions
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Edge Function generate-report-csv lê job, gera CSV das mat views, salva no bucket admin-reports', 0),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Em sucesso: report_jobs.status=done com file_path e row_count', 1),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Em falha: report_jobs.status=failed com error_message', 2),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Notifica admin requester via enqueue_notification_event (T-162) ao concluir', 3),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Edge Function emit-supply-zero-alert detecta categorias com supply=0 em peak', 4),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Cria/atualiza admin_alerts (kind=supply_zero_peak, severity=critical) idempotente', 5),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Dispara push para role=admin via enqueue_notification_event (kind=admin_supply_zero)', 6),
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'Service role usado apenas server-side; nenhum log de PII', 7),

-- T-198 Realtime admin:dashboard
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'Hook use-admin-dashboard-realtime subscreve canal admin:dashboard no mount', 0),
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'Unsubscribe + clearInterval no unmount (sem leak)', 1),
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'INSERT/UPDATE em admin_alerts dispara onAlertChange em <500ms', 2),
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'CHANNEL_ERROR/TIMED_OUT ativa fallback de polling 15s', 3),
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'RLS impede usuário não-admin de ouvir o canal (smoke)', 4),
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'Reconnect automático após perda de rede testado', 5),

-- T-199 UI /admin dashboard
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'Página /admin renderiza KpiCard × 4 com valores de /api/admin/dashboard', 0),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'SupplyGrid mostra cada categoria com badge verde/amarelo/vermelho conforme available_now vs min', 1),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'Card financeiro 7 dias com nota "atualiza a cada 5min"', 2),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'AlertQueueList lateral consome /api/admin/alerts e mostra ações contextuais', 3),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'Realtime atualiza KPIs/supply/alertas via useAdminDashboardRealtime sem refetch full', 4),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'Skeleton durante carregamento; estado vazio coerente', 5),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'Mobile <md: aside vira top, layout em coluna única', 6),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'Reusa Card/Badge/StatusChip/Skeleton (sem componentes novos)', 7),
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', 'KPI cards ligados a 4 contadores reais (active, manual_alloc, alerts, priority_queue)', 8),

-- T-200 ManualAllocationSheet
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Sheet abre com lista de elegíveis (rating + distância)', 0),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Busca filtra lista por nome com debounce', 1),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Click em "Alocar" abre ConfirmDialog antes de POST', 2),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Idempotency-Key fixo por mount (não muda entre clicks)', 3),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Sucesso: toast verde "Prestador alocado. Cliente notificado." e fecha sheet', 4),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', '409 trata via showErrorToast com "outro admin já alocou"', 5),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Mobile <md: sheet vira bottom-sheet 90dvh', 6),
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', 'Reuso: ResponsiveSheet, ConfirmDialog, Field, Input, Button, Sonner', 7),

-- T-201 /admin/reports
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', '5 abas (Serviços/Financeiro/Supply/Qualidade/Prestadores) com layout segmented', 0),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'Filtro de período (date inputs nativos) + botão Aplicar', 1),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'Aba Financeiro mostra nota fixa de conciliação (visível sempre)', 2),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'Estado vazio com mensagem orientativa; sem mensagem de erro vermelho', 3),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'Skeleton durante load (relatório lento)', 4),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'ReportTable renderiza colunas certas por categoria', 5),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'Field compound API + Input type=date (sem masked-input lib)', 6),
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'Mobile-first: tabs em scroll horizontal em <md', 7),

-- T-202 export CSV flow
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Click em Exportar dispara POST /api/admin/reports/export', 0),
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Resposta CSV streaming força download via blob + Content-Disposition', 1),
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Resposta 202 mostra toast "Geração em background" e atualiza Meus exports', 2),
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Sheet "Meus exports" lista jobs com Badge de status', 3),
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Botão Baixar em jobs done abre signed URL temporária', 4),
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Object URL revogado após download (sem leak)', 5),
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'Disable do botão durante busy + retorno de erro via showErrorToast', 6),

-- T-203 OPS app_config + pg_cron
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'Migration aplicada via psql; chaves novas em app_config (supply_min, peak_hours, sla, threshold)', 0),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'ON CONFLICT (key) DO NOTHING torna seed idempotente', 1),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'Função process_matching_priority_queue com FOR UPDATE SKIP LOCKED criada', 2),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'pg_cron job refresh_report_financial agendado a cada 5min', 3),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'pg_cron job refresh_report_others agendado a cada 15min (4 mat views)', 4),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'pg_cron job emit_supply_zero_alert a cada 5min via net.http_post', 5),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'pg_cron job process_priority_queue a cada 1min', 6),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'pg_cron job cleanup_report_jobs diário às 03:00', 7),
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'Smoke: SELECT * FROM cron.job mostra 5 jobs ativos', 8);

-- ============================================================================
-- 4. TaskDependency (ordem entre tasks; cross-US como relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- Intra-US blocks
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'blocks'),  -- T-194 ← T-190
('21ffd791-ccbe-4b58-b076-68053e32f7d8', '425feb93-51ca-4bde-9d84-a0308775a9a4', 'blocks'),  -- T-194 ← T-191
('21ffd791-ccbe-4b58-b076-68053e32f7d8', 'a20dddef-3506-4e11-b9a3-62f35b3b6648', 'blocks'),  -- T-194 ← T-193
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', '425feb93-51ca-4bde-9d84-a0308775a9a4', 'blocks'),  -- T-195 ← T-191 (priority queue + RPC)
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'blocks'),  -- T-195 ← T-190 (resolve admin_alert)
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'a20dddef-3506-4e11-b9a3-62f35b3b6648', 'blocks'),  -- T-196 ← T-193
('dd89c834-6fb0-49b1-a60d-51a50d0a8e31', '779867f7-51f1-4478-8851-426aa2f461b1', 'blocks'),  -- T-196 ← T-192
('7c3de682-c191-487d-a4c9-b1365f5f894d', '779867f7-51f1-4478-8851-426aa2f461b1', 'blocks'),  -- T-197 ← T-192
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'a20dddef-3506-4e11-b9a3-62f35b3b6648', 'blocks'),  -- T-197 ← T-193
('7c3de682-c191-487d-a4c9-b1365f5f894d', 'cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'blocks'),  -- T-197 ← T-190 (escreve alerts)
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', 'blocks'),  -- T-198 ← T-190
('2fd87337-f882-42fa-b6c2-b1115c4d89e9', '425feb93-51ca-4bde-9d84-a0308775a9a4', 'blocks'),  -- T-198 ← T-191
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', '21ffd791-ccbe-4b58-b076-68053e32f7d8', 'blocks'),  -- T-199 ← T-194
('c1091b3f-7703-4f65-a857-fb9133aa2d7a', '2fd87337-f882-42fa-b6c2-b1115c4d89e9', 'blocks'),  -- T-199 ← T-198
('0cab322b-9ab6-4ed3-9594-f5b30a7a1eac', '88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'blocks'),  -- T-200 ← T-195
('f5905cca-16a5-42af-9007-cfd4f4f5cf24', 'dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'blocks'),  -- T-201 ← T-196
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', 'dd89c834-6fb0-49b1-a60d-51a50d0a8e31', 'blocks'),  -- T-202 ← T-196
('ea62429e-2a23-415d-a2d5-1ffeedabe73c', '7c3de682-c191-487d-a4c9-b1365f5f894d', 'blocks'),  -- T-202 ← T-197
('bfc20471-88f9-4260-ae8d-9d539cb14387', 'a20dddef-3506-4e11-b9a3-62f35b3b6648', 'blocks'),  -- T-203 ← T-193 (refresh job)
('bfc20471-88f9-4260-ae8d-9d539cb14387', '779867f7-51f1-4478-8851-426aa2f461b1', 'blocks'),  -- T-203 ← T-192 (cleanup job)
('bfc20471-88f9-4260-ae8d-9d539cb14387', '7c3de682-c191-487d-a4c9-b1365f5f894d', 'blocks'),  -- T-203 ← T-197 (cron invoca Edge)
('bfc20471-88f9-4260-ae8d-9d539cb14387', '88af77fa-2079-44c3-a5bf-1a3500a82b3c', 'blocks'),  -- T-203 ← T-195 (RPC reusada)

-- Cross-US relates_to (reuso explícito de tasks de outras US)
('cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-145'), 'relates_to'),  -- admin_alerts ↔ useSlaStatus (US-018)
('425feb93-51ca-4bde-9d84-a0308775a9a4', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-114'), 'relates_to'),  -- supply_status_v ↔ is_provider_available_now (US-027)
('425feb93-51ca-4bde-9d84-a0308775a9a4', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to'),  -- KPIs ↔ service_requests (US-011)
('a20dddef-3506-4e11-b9a3-62f35b3b6648', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-071'), 'relates_to'),  -- mat view financial ↔ payments (US-011)
('88af77fa-2079-44c3-a5bf-1a3500a82b3c', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),  -- manual-allocate ↔ enqueue_notification (US-022)
('7c3de682-c191-487d-a4c9-b1365f5f894d', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),  -- Edge ↔ enqueue_notification (US-022)
('7c3de682-c191-487d-a4c9-b1365f5f894d', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-163'), 'relates_to'),  -- Edge ↔ dispatch-notifications (US-022)
('bfc20471-88f9-4260-ae8d-9d539cb14387', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-064'), 'relates_to'),  -- app_config seeds ↔ visita técnica (US-010 já criou app_config)
('21ffd791-ccbe-4b58-b076-68053e32f7d8', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-148'), 'relates_to'),  -- /admin/alerts ↔ /admin/disputes lista (US-026)
('21ffd791-ccbe-4b58-b076-68053e32f7d8', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-139'), 'relates_to');  -- /admin/alerts ↔ /admin/support/tickets (US-018)

COMMIT;
