-- Zordon backlog cards: ZLAR-V2-US-017 (ADMIN — Gerenciar prestadores: KYC manual, moderação, suspensão)
-- Persona: ADMIN | Module: ADMIN | 11 AC | 11 tasks (T-204..T-214)
-- Persisted into: Task / TaskAcceptanceCriterion / AcceptanceCriterion(taskId) / TaskDependency
-- Reusa: US-001 (provider_profiles, kyc_verifications), US-008 (suspension_events, appeals),
--        US-016 (admin_alerts, assertAdmin), US-022 (notification_events), US-026 (disputes)

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-204 DATA provider_moderation_log
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-204', 'Criar provider_moderation_log (audit imutável) + enum provider_moderation_action',
 $desc$## Objetivo
Centralizar trilha de auditoria de TODAS as ações de moderação de admin sobre prestadores (aprovar/reprovar KYC manual, suspender, reativar, override de docs expirados). Tabela imutável, append-only, com FK pra `auth.users` (admin) e `provider_profiles`. Cobre AC #4, #5, #6, #8, #10, #11.

## Contexto
Módulo ADMIN. Distinto de `provider_suspension_events` (US-008 T-035), que é log específico de suspensão. Aqui é log genérico de TODA decisão admin sobre prestador. Consumido pela aba "Histórico/Ocorrências" do perfil (T-212) e pelo endpoint audit-log (T-210).

## Estado atual / O que substitui
US-008 T-035 (`provider_suspension_events`) cobre só suspensão. Aqui criamos o log mestre que abarca todas as ações de moderação.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_moderation_log.sql`
```sql
BEGIN;

CREATE TYPE provider_moderation_action AS ENUM (
  'kyc_approved_manual',
  'kyc_rejected_manual',
  'kyc_expired_docs_override',
  'suspended',
  'reactivated',
  'blocked_definitive'
);

CREATE TABLE provider_moderation_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  admin_id        uuid NOT NULL REFERENCES auth.users(id),
  action          provider_moderation_action NOT NULL,
  reason          text NOT NULL,                            -- obrigatório (UI valida; AC #5/6/8/10)
  reason_category text,                                     -- ex 'multi_cancellations', 'kyc_doc_invalid'
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,       -- payload (kyc_verification_id, dispute_open, service_active, expired_docs)
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX provider_moderation_log_provider_idx
  ON provider_moderation_log(provider_id, "createdAt" DESC);
CREATE INDEX provider_moderation_log_admin_idx
  ON provider_moderation_log(admin_id, "createdAt" DESC);
CREATE INDEX provider_moderation_log_action_idx
  ON provider_moderation_log(action, "createdAt" DESC);

ALTER TABLE provider_moderation_log ENABLE ROW LEVEL SECURITY;

-- ADMIN: lê tudo
CREATE POLICY "moderation_log_admin_all" ON provider_moderation_log
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- PRESTADOR: lê apenas o próprio histórico (perfil)
CREATE POLICY "moderation_log_provider_own" ON provider_moderation_log
  FOR SELECT USING (auth.uid() = provider_id);

-- INSERT só via SECURITY DEFINER function (não via RLS direto)
REVOKE INSERT ON provider_moderation_log FROM authenticated;

-- Trigger: bloqueia UPDATE/DELETE (append-only)
CREATE OR REPLACE FUNCTION provider_moderation_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider_moderation_log is append-only';
END $$;
CREATE TRIGGER moderation_log_no_update BEFORE UPDATE ON provider_moderation_log
  FOR EACH ROW EXECUTE FUNCTION provider_moderation_log_immutable();
CREATE TRIGGER moderation_log_no_delete BEFORE DELETE ON provider_moderation_log
  FOR EACH ROW EXECUTE FUNCTION provider_moderation_log_immutable();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE/DELETE (trigger garante)
- ❌ INSERT sem `reason` (AC #4 admite NULL? não — exige texto, motivo "manual_review_passed" mínimo)
- ❌ Operação em lote (AC #11: reativações são individuais e intencionais — aplicação respeita; tabela não restringe)
- ❌ FK ON DELETE CASCADE (auditoria não some)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Padrão de log imutável (mesmo `dispute_decisions` da US-026 T-155)
- Reason livre + reason_category enum-like (string solta com convenção em código)
- INSERT via RPC `record_provider_moderation` (SECURITY DEFINER) que valida claim admin$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-205 DATA kyc_decisions
('40414564-f996-4b12-9438-4f37eff1c77f', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-205', 'Criar kyc_decisions + estender provider_profiles com manual_kyc_attempts',
 $desc$## Objetivo
Tabela específica de decisões manuais de KYC (link para `kyc_verifications` da US-001 T-005), com flag `expired_docs_override_justification` (AC #10). Estender `provider_profiles` com contador `manual_kyc_attempts` que dispara block ao atingir 2 (AC #5). Cobre AC #4, #5, #10.

## Contexto
Módulo ADMIN/ONBOARDING. Reusa `kyc_verifications` (US-001 T-005) como source-of-truth do KYC; aqui registramos a decisão admin sobre cada uma. Quando `manual_kyc_attempts >= 2` e última decisão `rejected`, RPC bloqueia conta (`account_status='blocked'`, US-008 enum).

## Estado atual / O que substitui
US-001 T-005 já tem `kyc_verifications` (histórico de tentativas). Aqui adicionamos camada de decisão manual.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_kyc_decisions.sql`
```sql
BEGIN;

CREATE TYPE kyc_manual_decision AS ENUM ('approved','rejected');

CREATE TABLE kyc_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kyc_verification_id uuid NOT NULL REFERENCES kyc_verifications(id) ON DELETE RESTRICT,
  provider_id       uuid NOT NULL REFERENCES auth.users(id),
  admin_id          uuid NOT NULL REFERENCES auth.users(id),
  decision          kyc_manual_decision NOT NULL,
  reason_code       text,                 -- ex 'doc_invalid', 'identity_mismatch', 'low_quality_photo'; NULL em approved
  reason_text       text,                 -- texto livre (obrigatório em rejected)
  expired_docs_override_justification text, -- preenchido SE houve flag expired (AC #10)
  moderation_log_id uuid REFERENCES provider_moderation_log(id),
  "createdAt"       timestamptz NOT NULL DEFAULT NOW(),
  CHECK (
    (decision = 'approved') OR
    (decision = 'rejected' AND reason_text IS NOT NULL)
  )
);

CREATE INDEX kyc_decisions_provider_idx
  ON kyc_decisions(provider_id, "createdAt" DESC);
CREATE INDEX kyc_decisions_verification_idx
  ON kyc_decisions(kyc_verification_id);

ALTER TABLE kyc_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kyc_decisions_admin_all" ON kyc_decisions
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "kyc_decisions_provider_own" ON kyc_decisions
  FOR SELECT USING (auth.uid() = provider_id);

-- Estender provider_profiles
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS manual_kyc_attempts integer NOT NULL DEFAULT 0
    CHECK (manual_kyc_attempts >= 0 AND manual_kyc_attempts <= 5);

-- Trigger: incrementa manual_kyc_attempts em rejected; bloqueia conta se >=2
CREATE OR REPLACE FUNCTION on_kyc_decision_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.decision = 'rejected' THEN
    UPDATE provider_profiles
      SET manual_kyc_attempts = manual_kyc_attempts + 1
      WHERE user_id = NEW.provider_id
      RETURNING manual_kyc_attempts INTO STRICT NEW.context_attempts; -- ignored variable
    -- Block automático no 2º rejected
    UPDATE provider_profiles
      SET account_status = 'blocked'
      WHERE user_id = NEW.provider_id
        AND manual_kyc_attempts >= 2
        AND account_status != 'blocked';
  ELSIF NEW.decision = 'approved' THEN
    UPDATE provider_profiles
      SET account_status = 'active'
      WHERE user_id = NEW.provider_id
        AND account_status IN ('pending_kyc','kyc_in_review');
  END IF;
  RETURN NEW;
END $$;
-- (Implementador pode optar por gatilhar a partir do RPC em vez de trigger)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir DELETE (decisão é histórica)
- ❌ Decisão rejected sem reason_text (CHECK constraint cobre)
- ❌ Decisão approved com docs flagged sem justification (RPC valida; AC #10)
- ❌ Operação em lote (AC #11)

## Convenções
- Atomicidade: RPC `record_kyc_decision` faz INSERT em moderation_log + kyc_decisions + UPDATE provider_profiles na mesma transação
- Trigger acima é **opcional** (alternativa ao RPC) — recomendar RPC pra controle explícito
- `kyc_attempts` automáticas (Unico) ficam em coluna separada já existente em provider_profiles$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-206 DATA admin_provider_kyc_queue_v + indexes
('e98944b9-e218-4751-9b33-118300b96ce9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-206', 'Criar admin_provider_kyc_queue_v + indexes para listagem admin',
 $desc$## Objetivo
View dedicada à fila de KYC manual: filtra `kyc_verifications` com score entre os thresholds high/low (AC #3), com flag `has_expired_docs` quando aplicável (AC #10). Indexes em `provider_profiles` para suportar listagem filtrada (AC #1). Cobre AC #1, #3, #10.

## Contexto
Módulo ADMIN. Lê `kyc_verifications` (US-001 T-005) + `provider_profiles` (US-001 T-002). Thresholds em `app_config` (T-214). UI consome via `/api/admin/kyc-queue` (T-208).

## Estado atual / O que substitui
Não existe view dedicada. Hoje admin teria que rodar SQL ad-hoc.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_admin_provider_indexes.sql`
```sql
BEGIN;

-- View: fila de KYC manual
CREATE OR REPLACE VIEW admin_provider_kyc_queue_v AS
WITH thresholds AS (
  SELECT
    COALESCE((value->>'high')::numeric, 0.85) AS high,
    COALESCE((value->>'low')::numeric, 0.40) AS low
  FROM app_config WHERE key = 'kyc_score_thresholds'
)
SELECT
  kv.id AS kyc_verification_id,
  kv.provider_id,
  pp."personalData"->>'fullName' AS provider_name,
  pp."personalData"->>'cpf' AS cpf,
  kv.score,
  (kv.flags ? 'expired_docs') AS has_expired_docs,
  kv."createdAt" AS submitted_at,
  EXTRACT(EPOCH FROM (NOW() - kv."createdAt"))/3600 AS hours_pending
FROM kyc_verifications kv
JOIN provider_profiles pp ON pp.user_id = kv.provider_id
CROSS JOIN thresholds t
WHERE kv.status = 'manual_review_pending'
  AND kv.score >= t.low
  AND kv.score < t.high
ORDER BY kv."createdAt" ASC;  -- FIFO

GRANT SELECT ON admin_provider_kyc_queue_v TO authenticated;

-- Indexes para listagem filtrada de prestadores (AC #1)
CREATE INDEX IF NOT EXISTS provider_profiles_status_level_idx
  ON provider_profiles(account_status, level, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS provider_profiles_name_search_idx
  ON provider_profiles USING gin (
    to_tsvector('portuguese', COALESCE("personalData"->>'fullName',''))
  );

-- Index pra busca por CPF (igualdade)
CREATE INDEX IF NOT EXISTS provider_profiles_cpf_idx
  ON provider_profiles((("personalData"->>'cpf')));

-- Index pra filtro por categoria (M:N via provider_categories)
CREATE INDEX IF NOT EXISTS provider_categories_category_idx
  ON provider_categories(category_id, provider_id);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Materialized view aqui (fila é fresh; pequeno volume)
- ❌ Index em coluna que muda toda hora sem WHERE clause (pode degradar)
- ❌ Filtro por `score < high` exclusivo (use `< t.high` — AC #3 explicita "auto-aprovação acima do alto")

## Convenções
- View consultada via REST/Supabase client respeita RLS de origem
- Thresholds default: high=0.85, low=0.40 (operação ajusta via T-214)
- pt-BR text search dictionary
- Migration via psql; `database.types.ts` regenerado$desc$,
 'DATA', 'ADMIN', ARRAY['INDEX_REQUIRED','NO_RLS_NEEDED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-207 API list/detail providers
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-207', 'Implementar GET /api/admin/providers (lista) + /[id] (perfil completo)',
 $desc$## Objetivo
Endpoints admin que listam prestadores com filtros (status, level, categoria, período de cadastro, busca por nome ou CPF) com paginação cursor, e devolvem perfil completo com dados das 7 abas para detail sheet (T-212). Cobre AC #1, #2.

## Contexto
Módulo ADMIN. Lê `provider_profiles` + `provider_categories` + agregações (services count, ratings) — possivelmente via RPC `get_admin_provider_detail` para encapsular joins. RLS já filtra por claim admin (assertAdmin em US-016 T-194 reusa).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/providers/route.ts`
```ts
import { z } from 'zod';
import { assertAdmin } from '@/lib/admin/assert';

const Query = z.object({
  status: z.array(z.enum(['kyc_in_review','active','suspended','blocked','pending_kyc'])).optional(),
  level: z.array(z.string()).optional(),
  category_id: z.string().uuid().optional(),
  registered_from: z.string().date().optional(),
  registered_to: z.string().date().optional(),
  search: z.string().max(120).optional(),  // nome OR CPF
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export async function GET(req: Request) {
  await assertAdmin(...);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const supabase = await createClient();
  // RPC list_admin_providers(filters jsonb, cursor, limit) que aplica:
  //  - status IN (...)
  //  - level IN (...)
  //  - EXISTS provider_categories WHERE category_id=?
  //  - createdAt range
  //  - search via to_tsvector OR equality em CPF
  const { data, error } = await supabase.rpc('list_admin_providers', {
    p_filters: q, p_cursor: q.cursor ?? null, p_limit: q.limit,
  });
  if (error) return mapPgError(error);
  return NextResponse.json({ items: data, nextCursor: makeCursor(data) });
}
```

### `src/app/api/admin/providers/[id]/route.ts`
```ts
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await assertAdmin(...);
  const supabase = await createClient();
  // RPC get_admin_provider_detail(provider_id) retorna jsonb com 7 sub-objetos:
  //  identity: { kyc_verifications[], current_status, attempts }
  //  personal: { fullName, email, phone, address }
  //  banking:  { account_status, last4, bank }
  //  categories: [{ id, name, certified_at }]
  //  history:   { total_services, completed, cancelled, last_active_at }
  //  occurrences: { suspensions[], rejections[], moderation_actions[] }
  //  score:     { current, history[] }
  //  ratings:   { avg, count, recent[] }
  const { data, error } = await supabase.rpc('get_admin_provider_detail', { p_provider_id: params.id });
  if (error) return mapPgError(error);
  if (!data) return new Response(null, { status: 404 });
  return NextResponse.json(data);
}
```

## Constraints / NÃO fazer
- ❌ N+1 queries (joins via RPC SECURITY DEFINER ou views)
- ❌ Retornar dados sensíveis sem necessidade (CPF aparece masked na lista; full apenas no detail)
- ❌ Permitir filtros sem validação Zod
- ❌ Cursor que vaze chave primária (usar opaque base64)

## Convenções
- Reusa `assertAdmin` (US-016 T-194)
- Cursor opaco (base64 do `(createdAt, id)`)
- Pagination padrão: 20 itens
- Erros: 403 (não-admin), 400 (Zod), 404 (provider not found)$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-208 API KYC approve/reject
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-208', 'Implementar POST /api/admin/kyc/[id]/approve + reject (bloqueio em 2 reprovações)',
 $desc$## Objetivo
Endpoints que registram decisão manual de KYC (aprovar com motivo opcional, reprovar com motivo obrigatório), atualizam `provider_profiles.account_status`, incrementam `manual_kyc_attempts`, bloqueiam definitivamente em 2 reprovações (AC #5), exigem justificativa quando docs flagados como expirados (AC #10), notificam prestador. Cobre AC #4, #5, #10.

## Contexto
Módulo ADMIN. Reusa schema da T-204 (moderation_log) e T-205 (kyc_decisions). Notificação via `enqueue_notification_event` (US-022 T-162). Idempotency-Key obrigatório (admin pode duplo-clique). RPC `record_kyc_decision` é a unidade transacional.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/kyc/[id]/approve/route.ts`
```ts
import { z } from 'zod';
const Body = z.object({
  reason: z.string().max(500).optional(),
  expired_docs_override_justification: z.string().min(20).max(1000).optional(),
});
export async function POST(req: Request, { params }: { params: { id: string } }) {
  await assertAdmin(...);
  const idem = req.headers.get('idempotency-key');
  if (!idem) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());
  // RPC valida:
  //  - kyc_verification status = manual_review_pending
  //  - se flags.expired_docs: expired_docs_override_justification obrigatório (AC #10)
  //  - cria kyc_decisions(decision='approved', reason_text=body.reason, expired_docs_override_justification=...)
  //  - cria provider_moderation_log(action='kyc_approved_manual'; ou 'kyc_expired_docs_override')
  //  - UPDATE provider_profiles SET account_status='active'
  //  - emit notification 'kyc_approved'
  const { data, error } = await supabase.rpc('record_kyc_decision', {
    p_kyc_verification_id: params.id,
    p_decision: 'approved',
    p_reason: body.reason ?? 'manual_review_passed',
    p_expired_override: body.expired_docs_override_justification ?? null,
    p_idempotency_key: idem,
  });
  if (error) return mapRpcError(error);
  return NextResponse.json(data);
}
```

### `src/app/api/admin/kyc/[id]/reject/route.ts`
```ts
const Body = z.object({
  reason_code: z.enum([
    'doc_invalid','identity_mismatch','low_quality_photo','suspected_fraud','other'
  ]),
  reason_text: z.string().min(10).max(1000),
});
export async function POST(req: Request, { params }) {
  await assertAdmin(...);
  // mesmo padrão; RPC:
  //  - cria kyc_decisions(decision='rejected', reason_code, reason_text)
  //  - cria provider_moderation_log(action='kyc_rejected_manual')
  //  - INCREMENT manual_kyc_attempts
  //  - SE manual_kyc_attempts >= 2: account_status='blocked' + log action='blocked_definitive'
  //  - emit notification (kyc_rejected ou kyc_blocked_definitive)
}
```

## Constraints / NÃO fazer
- ❌ Aprovar sem checar status (deve estar em manual_review_pending — 409 caso contrário)
- ❌ Aprovar com docs flagados sem justificativa (AC #10 obriga)
- ❌ Reprovar sem reason_text (Zod obriga)
- ❌ Notificar síncrono (sempre via enqueue, US-022)
- ❌ Permitir 3ª reprovação (RPC bloqueia conta antes)

## Convenções
- RPC `record_kyc_decision` SECURITY DEFINER (admin via claim)
- Idempotency-Key obrigatório (admin pode duplo-clique)
- Reuse `enqueue_notification_event` (T-162) com kinds: `kyc_approved`, `kyc_rejected`, `kyc_blocked_definitive`
- Audit log em `provider_moderation_log` linkado via `moderation_log_id`$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-209 API suspend/reactivate
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-209', 'Implementar POST /api/admin/providers/[id]/suspend + /reactivate',
 $desc$## Objetivo
Endpoints para suspender prestador (motivo obrigatório, removido do pool, notificado) e reativar (motivo obrigatório, volta ao pool, notificado). Suspender com serviço ativo cria admin_alert para acompanhamento; reativar com disputa aberta NÃO encerra a disputa. Cobre AC #6, #7, #8, #9.

## Contexto
Módulo ADMIN. Reusa schema US-008 (`provider_suspension_events` T-035, `suspension_category` enum T-034). Cria também `provider_moderation_log` (T-204). Verifica serviço ativo lendo `service_requests` (US-011 T-070). Verifica disputa aberta lendo `support_tickets` com kind=dispute (US-026 T-147). Cria `admin_alerts` (US-016 T-190) quando suspensão com service ativo.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/providers/[id]/suspend/route.ts`
```ts
const Body = z.object({
  category: z.enum(['multi_cancellations','quality_complaint','behavior','identity_doubt','other']),
  reason_text: z.string().min(10).max(1000),
  confirm_active_service: z.boolean().optional(),  // AC #7: admin precisa confirmar
});
export async function POST(req: Request, { params }) {
  await assertAdmin(...);
  const idem = req.headers.get('idempotency-key');
  if (!idem) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());

  // Pré-check: serviço ativo
  const { data: active } = await supabase
    .from('service_requests')
    .select('id, status, scheduled_at, client_id')
    .eq('provider_id', params.id)
    .in('status', ['accepted','on_the_way','in_progress']);
  if (active?.length && !body.confirm_active_service) {
    return NextResponse.json({
      error: 'active_service_pending',
      services: active,
      message: 'Prestador tem serviço(s) em andamento. Confirme com confirm_active_service=true.'
    }, { status: 409 });
  }

  // RPC suspend_provider:
  //  - account_status='suspended', motivo (estendido US-008)
  //  - INSERT provider_suspension_events (US-008 T-035)
  //  - INSERT provider_moderation_log(action='suspended')
  //  - SE active.length: INSERT admin_alerts(kind='manual_allocation_pending'/'service_followup', context={provider_id,service_id})
  //    para acompanhamento manual (T-190)
  //  - Remove do pool de matching (account_status='suspended' já filtra; matching engine respeita)
  //  - emit notification 'provider_suspended' com motivo
  const { data, error } = await supabase.rpc('suspend_provider', {
    p_provider_id: params.id, p_admin_id: ...,
    p_category: body.category, p_reason_text: body.reason_text,
    p_active_services: active?.map(s => s.id) ?? [],
    p_idempotency_key: idem,
  });
  if (error) return mapRpcError(error);
  return NextResponse.json(data);
}
```

### `src/app/api/admin/providers/[id]/reactivate/route.ts`
```ts
const Body = z.object({
  reason_text: z.string().min(10).max(1000),
  acknowledge_open_dispute: z.boolean().optional(),
});
export async function POST(req: Request, { params }) {
  await assertAdmin(...);
  const idem = req.headers.get('idempotency-key');
  if (!idem) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());

  // Pré-check: disputa aberta
  const { data: dispute } = await supabase
    .from('support_tickets')  // US-018 schema
    .select('id, status').eq('kind','dispute')
    .eq('provider_id', params.id)
    .in('status', ['open','under_review']);
  if (dispute?.length && !body.acknowledge_open_dispute) {
    return NextResponse.json({
      error: 'open_dispute_warning',
      disputes: dispute,
      message: 'Há disputa em aberto. Reativação não a encerra. Confirme com acknowledge_open_dispute=true.'
    }, { status: 409 });
  }

  // RPC reactivate_provider:
  //  - account_status='active'
  //  - INSERT provider_suspension_events(kind='reactivated')
  //  - INSERT provider_moderation_log(action='reactivated')
  //  - emit notification 'provider_reactivated'
  //  - NÃO mexe em disputas (AC #9)
  const { data, error } = await supabase.rpc('reactivate_provider', {
    p_provider_id: params.id, p_admin_id: ..., p_reason_text: body.reason_text,
    p_idempotency_key: idem,
  });
  if (error) return mapRpcError(error);
  return NextResponse.json(data);
}
```

## Constraints / NÃO fazer
- ❌ Suspender já-suspenso (409)
- ❌ Reativar não-suspenso (409)
- ❌ Operação em lote (AC #11 — endpoint aceita 1 provider só)
- ❌ Encerrar disputa em reativação (AC #9 — disputa segue seu fluxo)
- ❌ Notificar síncrono

## Convenções
- Idempotency-Key obrigatório
- 409 com payload estruturado quando há condição que precisa confirm explícito
- Reuse: US-008 T-034/T-035 (categoria/eventos), US-016 T-190 (admin_alerts), US-022 T-162 (notify), US-026 T-147 (disputes)
- Audit log via `provider_moderation_log` (T-204)$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-210 API audit-log
('5f03c906-5357-4762-8d44-477f9d9aea90', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-210', 'Implementar GET /api/admin/providers/[id]/audit-log (trilha completa)',
 $desc$## Objetivo
Devolver trilha auditoria completa do prestador (todas as ações em `provider_moderation_log` + decisões KYC + suspension events + appeals) ordenada cronologicamente, paginada. Cobre AC #11.

## Contexto
Módulo ADMIN. Une `provider_moderation_log` (T-204), `kyc_decisions` (T-205), `provider_suspension_events` (US-008 T-035), `provider_appeals` (US-008 T-036) em um stream cronológico unificado para a aba "Ocorrências" do detail sheet (T-212).

## Estado atual / O que substitui
Não existe endpoint unificado.

## O que criar

### `src/app/api/admin/providers/[id]/audit-log/route.ts`
```ts
const Query = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  kinds: z.array(z.enum(['moderation','kyc','suspension','appeal'])).optional(),
});
export async function GET(req: Request, { params }) {
  await assertAdmin(...);
  const q = Query.parse(...);
  // RPC get_provider_audit_log(provider_id, cursor, limit, kinds[]) que faz UNION ALL:
  //  SELECT id, 'moderation' AS kind, action::text, reason, admin_id, "createdAt", context
  //    FROM provider_moderation_log WHERE provider_id=?
  //  UNION ALL
  //  SELECT id, 'kyc' AS kind, decision::text, reason_text, admin_id, "createdAt",
  //         jsonb_build_object('reason_code',reason_code,'expired_override',expired_docs_override_justification)
  //    FROM kyc_decisions WHERE provider_id=?
  //  UNION ALL
  //  SELECT id, 'suspension' AS kind, kind_event::text, reason, admin_id, "createdAt", context
  //    FROM provider_suspension_events WHERE provider_id=?
  //  UNION ALL
  //  SELECT id, 'appeal' AS kind, status::text, message, NULL, "createdAt", attachments
  //    FROM provider_appeals WHERE provider_id=?
  //  ORDER BY "createdAt" DESC LIMIT ?
  const { data, error } = await supabase.rpc('get_provider_audit_log', {
    p_provider_id: params.id,
    p_cursor: q.cursor ?? null,
    p_limit: q.limit,
    p_kinds: q.kinds ?? null,
  });
  if (error) return mapPgError(error);
  return NextResponse.json({ items: data, nextCursor: makeCursor(data) });
}
```

## Constraints / NÃO fazer
- ❌ Permitir prestador ver log de outro prestador (RLS já cobre — endpoint exige admin)
- ❌ Mostrar `reason` truncado por default (UI decide; aqui retorna full)
- ❌ Buscar admin_id sem JOIN com `auth.users`/profile (frontend vai precisar do nome — agregue na RPC)
- ❌ Sem cursor (logs podem ser longos)

## Convenções
- RPC SECURITY DEFINER para encapsular o UNION
- Cursor opaco (base64 de `(createdAt, kind, id)`)
- `kinds` filter permite UI mostrar só uma categoria (ex: só KYC)
- Reusa `assertAdmin`$desc$,
 'API', 'ADMIN', ARRAY['PAGINATION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-211 UI /admin/providers list
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-211', 'Renderizar /admin/providers com filtros, busca e infinite scroll',
 $desc$## Objetivo
Tela ADMIN de listagem de prestadores com filtros (status, level, categoria, período), busca por nome ou CPF, infinite scroll. Cada item mostra dados resumidos (nome, status chip, categorias, score). Tap abre `ProviderDetailSheet` (T-212). Cobre AC #1.

## Contexto
Módulo ADMIN. Consome `/api/admin/providers` (T-207). Reusa `Card`, `Field`/`FormBody`, `Input`, `Select`, `StatusChip`, `Skeleton`, `Badge`. Filter state via `useState`; debounce de busca via `useFieldDebounce` (existente).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/admin/providers/page.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusChip } from '@/components/ui/status-chip';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useFieldDebounce } from '@/hooks/use-field-debounce';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ProviderDetailSheet } from '@/components/admin/provider-detail-sheet';

const STATUSES = ['kyc_in_review','active','suspended','blocked','pending_kyc'] as const;

export default function AdminProvidersPage() {
  const [filters, setFilters] = useState({
    status: [] as string[], level: [] as string[],
    category_id: '', registered_from: '', registered_to: '',
  });
  const [search, setSearch] = useState('');
  const debounced = useFieldDebounce(search, 350);
  const [items, setItems] = useState<Provider[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(async (reset = false) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debounced) params.set('search', debounced);
    filters.status.forEach(s => params.append('status', s));
    if (filters.category_id) params.set('category_id', filters.category_id);
    if (!reset && cursor) params.set('cursor', cursor);
    const res = await fetch(\`/api/admin/providers?\${params}\`);
    const json = await res.json();
    setItems(reset ? json.items : [...items, ...json.items]);
    setCursor(json.nextCursor);
    setHasMore(!!json.nextCursor);
    setLoading(false);
  }, [debounced, filters, cursor, items]);

  useEffect(() => { fetchPage(true); /* eslint-disable-next-line */ }, [debounced, filters]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !loading) fetchPage(false);
    });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loading, fetchPage]);

  return (
    <main className="p-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold">Prestadores</h1>

      <Card className="mt-4">
        <FormBody density="compact">
          <Field name="search">
            <Field.Label>Buscar (nome ou CPF)</Field.Label>
            <Field.Control>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Maria Silva ou 123.456..." />
            </Field.Control>
          </Field>
          <Field.Row cols={2}>
            <Field name="status">
              <Field.Label>Status</Field.Label>
              <Field.Control>
                <Select multiple value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field.Control>
            </Field>
            <Field name="category">
              <Field.Label>Categoria</Field.Label>
              <Field.Control>
                <Select value={filters.category_id} onChange={(v) => setFilters({ ...filters, category_id: v })}>
                  <option value="">Todas</option>
                  {/* lista vinda de /api/catalog */}
                </Select>
              </Field.Control>
            </Field>
          </Field.Row>
        </FormBody>
      </Card>

      <ul className="mt-4 divide-y rounded-lg border bg-card">
        {items.map(p => (
          <li key={p.id} className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30"
              onClick={() => setSelected(p.id)}>
            <div>
              <p className="font-medium">{p.fullName}</p>
              <p className="text-xs text-muted-foreground">
                CPF {p.cpf_masked} · cadastrado em {formatDate(p.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{p.level ?? 'sem nível'}</Badge>
              <StatusChip status={p.account_status} />
            </div>
          </li>
        ))}
        {loading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 m-3" />)}
        {!loading && items.length === 0 && (
          <li className="p-12 text-center text-sm text-muted-foreground">
            Nenhum prestador encontrado com os filtros atuais.
          </li>
        )}
        <div ref={sentinelRef} />
      </ul>

      {selected && (
        <ProviderDetailSheet providerId={selected} open onOpenChange={() => setSelected(null)} />
      )}
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Carregar tudo em uma página (sempre cursor + infinite scroll)
- ❌ Filtros sem debounce (search)
- ❌ Mostrar CPF completo na lista (mascarar; full apenas no sheet)
- ❌ react-hook-form

## Convenções
- Reusa: Card, Field, Input, Select, StatusChip, Badge, Skeleton, useFieldDebounce
- Mobile-first: lista em cards; filtros viram drawer em <md (TBD ResponsiveSheet)
- pt-BR direto$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','INFINITE_SCROLL','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-212 UI ProviderDetailSheet
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-212', 'Renderizar ProviderDetailSheet com 7 abas e ferramentas de moderação',
 $desc$## Objetivo
ResponsiveSheet (mobile-first) que mostra perfil completo do prestador em 7 abas (Identidade KYC, Pessoal+Bancário, Categorias, Histórico, Ocorrências, Score, Avaliações) + ferramentas (suspender, reativar, aprovar/reprovar KYC). Cobre AC #2, #11.

## Contexto
Módulo ADMIN. Consome `/api/admin/providers/[id]` (T-207) e `/audit-log` (T-210). Ações abrem `ConfirmDialog` que trata avisos contextuais (serviço ativo → AC #7, disputa aberta → AC #9, docs expirados → AC #10). Reusa `ResponsiveSheet`, `Tabs`-like (segmented com Button), `ConfirmDialog`, `StatusChip`, `Badge`, `Markdown` (texto livre dos motivos).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/admin/provider-detail-sheet.tsx`
```tsx
'use client';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { SuspendProviderDialog } from './suspend-provider-dialog';
import { ReactivateProviderDialog } from './reactivate-provider-dialog';
import { KycDecisionDialog } from './kyc-decision-dialog';

const TABS = ['identidade','pessoal','categorias','historico','ocorrencias','score','avaliacoes'] as const;

export function ProviderDetailSheet({ providerId, open, onOpenChange }: Props) {
  const [data, setData] = useState<ProviderDetail | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<typeof TABS[number]>('identidade');
  const [action, setAction] = useState<'suspend'|'reactivate'|'kyc_approve'|'kyc_reject'|null>(null);

  async function refresh() {
    const [d, log] = await Promise.all([
      fetch(\`/api/admin/providers/\${providerId}\`).then(r => r.json()),
      fetch(\`/api/admin/providers/\${providerId}/audit-log\`).then(r => r.json()),
    ]);
    setData(d); setAuditLog(log.items);
  }

  useEffect(() => { if (open) refresh(); }, [open, providerId]);

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="lg">
        <ResponsiveSheet.Header>
          {data?.personal.fullName ?? <Skeleton className="h-6 w-40" />}
          <div className="flex gap-2 mt-1">
            {data && <StatusChip status={data.identity.current_status} />}
            {data?.score && <Badge>Score {data.score.current.toFixed(2)}</Badge>}
          </div>
        </ResponsiveSheet.Header>

        <ResponsiveSheet.Body>
          {!data ? <Skeleton className="h-48" /> : (
            <>
              <nav className="flex flex-wrap gap-1 mb-3 overflow-x-auto" role="tablist">
                {TABS.map(t => (
                  <Button key={t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
                    {t}
                  </Button>
                ))}
              </nav>

              {tab === 'identidade' && <IdentityTab data={data.identity} />}
              {tab === 'pessoal' && <PersonalTab data={{ ...data.personal, banking: data.banking }} />}
              {tab === 'categorias' && <CategoriesTab data={data.categories} />}
              {tab === 'historico' && <HistoryTab data={data.history} />}
              {tab === 'ocorrencias' && <OccurrencesTab data={auditLog} />}
              {tab === 'score' && <ScoreTab data={data.score} />}
              {tab === 'avaliacoes' && <RatingsTab data={data.ratings} />}
            </>
          )}
        </ResponsiveSheet.Body>

        <ResponsiveSheet.Footer>
          {data?.identity.current_status === 'kyc_in_review' && (
            <>
              <Button variant="destructive" onClick={() => setAction('kyc_reject')}>Reprovar KYC</Button>
              <Button onClick={() => setAction('kyc_approve')}>Aprovar KYC</Button>
            </>
          )}
          {data?.identity.current_status === 'active' && (
            <Button variant="destructive" onClick={() => setAction('suspend')}>Suspender</Button>
          )}
          {data?.identity.current_status === 'suspended' && (
            <Button onClick={() => setAction('reactivate')}>Reativar</Button>
          )}
        </ResponsiveSheet.Footer>
      </ResponsiveSheet>

      {action === 'suspend' && data && (
        <SuspendProviderDialog providerId={providerId} provider={data} onClose={() => setAction(null)} onDone={refresh} />
      )}
      {action === 'reactivate' && data && (
        <ReactivateProviderDialog providerId={providerId} provider={data} onClose={() => setAction(null)} onDone={refresh} />
      )}
      {(action === 'kyc_approve' || action === 'kyc_reject') && data && (
        <KycDecisionDialog providerId={providerId} provider={data} mode={action} onClose={() => setAction(null)} onDone={refresh} />
      )}
    </>
  );
}
```

### Sub-componentes (cada um lê 1 chunk do detail data)
- `IdentityTab` — KYC verifications (lista cronológica), badge expired_docs, attempts count
- `PersonalTab` — nome, email, telefone, endereço, conta bancária (last4, banco, status)
- `CategoriesTab` — chips de categorias certificadas
- `HistoryTab` — totais (completed/cancelled), último ativo
- `OccurrencesTab` — `auditLog` lista (data + admin + ação + reason; `Markdown` no texto)
- `ScoreTab` — current + sparkline simples (sem lib pesada — div/heights)
- `RatingsTab` — média + count + 5 últimos

## Constraints / NÃO fazer
- ❌ `<Sheet>` cru (usar ResponsiveSheet)
- ❌ Tabs do shadcn se não existir ainda no projeto — usar segmented Buttons (ver T-201)
- ❌ Mostrar dados sensíveis sem necessidade (CPF apenas em PersonalTab; lista usa masked)
- ❌ Componente novo de gráfico (sparkline simples ou só números)

## Convenções
- ResponsiveSheet size="lg" (760px desktop)
- Reuso: `ResponsiveSheet`, `Button`, `Badge`, `StatusChip`, `Skeleton`, `Markdown` (existente)
- Mobile-first: aba fica em scroll horizontal; sheet 90dvh
- pt-BR direto$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-213 UI /admin/kyc-queue + dialogs
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-213', 'Renderizar /admin/kyc-queue + dialogs (KYC, Suspend, Reactivate)',
 $desc$## Objetivo
Tela `/admin/kyc-queue` que lista a fila de KYC manual (consume admin_provider_kyc_queue_v via API), com tap abrindo `ProviderDetailSheet` na aba Identidade. E os 3 dialogs especializados (KycDecisionDialog, SuspendProviderDialog, ReactivateProviderDialog) que tratam avisos contextuais (AC #7, #9, #10) e fazem POST nos endpoints. Cobre AC #3, #4, #5, #6, #7, #8, #9, #10.

## Contexto
Módulo ADMIN. Consome view via `/api/admin/kyc-queue` (parte de T-207 ou endpoint separado em /api/admin/providers?status=kyc_in_review). Dialogs chamam T-208 (KYC) e T-209 (suspend/reactivate). Reusa `ResponsiveDialog`, `Field`/`FormBody`, `Textarea`, `Select`, `ConfirmDialog`. Idempotency-Key gerado uma vez por mount do dialog.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/admin/kyc-queue/page.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { ProviderDetailSheet } from '@/components/admin/provider-detail-sheet';

export default function KycQueuePage() {
  const [items, setItems] = useState<KycQueueItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/providers?status=kyc_in_review&limit=50')
      .then(r => r.json()).then(d => setItems(d.items));
  }, []);

  return (
    <main className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold">Fila de KYC manual</h1>
      <p className="text-xs text-muted-foreground mt-1">
        Casos com score intermediário do parceiro. Auto-aprovação acima do threshold alto, auto-reprovação abaixo do baixo.
      </p>

      <ul className="mt-4 space-y-2">
        {items === null && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        {items?.length === 0 && (
          <Card><p className="text-center text-sm text-muted-foreground py-12">Sem casos para revisar agora.</p></Card>
        )}
        {items?.map(it => (
          <Card key={it.kyc_verification_id}
                className="cursor-pointer hover:border-primary p-3 flex items-center justify-between"
                onClick={() => setSelected(it.provider_id)}>
            <div>
              <p className="font-medium">{it.provider_name}</p>
              <p className="text-xs text-muted-foreground">
                Score {it.score.toFixed(2)} · {Math.round(it.hours_pending)}h aguardando
              </p>
            </div>
            <div className="flex items-center gap-2">
              {it.has_expired_docs && <Badge variant="destructive">docs expirados</Badge>}
              <Badge>Score {it.score.toFixed(2)}</Badge>
            </div>
          </Card>
        ))}
      </ul>

      {selected && <ProviderDetailSheet providerId={selected} open onOpenChange={() => setSelected(null)} />}
    </main>
  );
}
```

### `src/components/admin/kyc-decision-dialog.tsx`
- ResponsiveDialog com 2 modes (approve|reject)
- Approve: textarea opcional para reason; SE provider.identity.has_expired_docs: Field obrigatório `expired_docs_override_justification` (min 20 chars)
- Reject: Select reason_code (5 opções) + Textarea reason_text obrigatório (min 10 chars)
- POST /api/admin/kyc/[id]/{approve|reject} com Idempotency-Key

### `src/components/admin/suspend-provider-dialog.tsx`
- ResponsiveDialog com Select category + Textarea reason_text (min 10 chars)
- Pré-fetch GET /api/admin/providers/[id] para checar serviço ativo
- Se há serviço ativo: aviso explícito + checkbox "Confirmo mesmo assim (urgência)" → confirm_active_service=true
- Sobre 409 active_service_pending vindo do servidor: re-mostrar aviso

### `src/components/admin/reactivate-provider-dialog.tsx`
- ResponsiveDialog com Textarea reason_text (min 10 chars)
- Pré-fetch para checar disputa aberta
- Se disputa aberta: aviso explícito "Reativação não encerra a disputa." + checkbox "Entendi. Prosseguir." → acknowledge_open_dispute=true

## Constraints / NÃO fazer
- ❌ `window.confirm()` para o aviso de service ativo / disputa (usar dialog estruturado)
- ❌ Esconder o aviso depois de marcar checkbox (mantenha visível até POST)
- ❌ Idempotency-Key recriado por click (1 por mount)
- ❌ Permitir submeter form com reason_text < 10 chars (validação client + backend dupla)
- ❌ react-hook-form

## Convenções
- ResponsiveDialog (decisão pontual, 1-3 fields)
- Field compound API; Textarea para reason_text; Select para reason_code/category
- Sonner toast em sucesso ("KYC aprovado", "Prestador suspenso", etc) + showErrorToast em falha
- Feedback de 409 active_service: re-render dialog com checkbox$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-214 OPS app_config seeds
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3170997e-0206-4810-9cad-a9d6505a5147',
 'ZLAR-V2-T-214', 'Seedar app_config kyc_score_thresholds + suspension_categories padrão',
 $desc$## Objetivo
Adicionar parâmetros operacionais editáveis: thresholds de score do parceiro de KYC (high/low), lista padrão de categorias de suspensão para UI dropdown, e flag operacional `kyc_manual_review_enabled`. Cobre AC #3.

## Contexto
Módulo ADMIN. Reusa `app_config` (US-010 T-064 — já criada). View `admin_provider_kyc_queue_v` (T-206) lê thresholds. Frontend dialogs (T-213) leem `suspension_categories` para popular Select.

## Estado atual / O que substitui
US-010 T-064 cria app_config; aqui só seed de chaves novas.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_admin_provider_config.sql`
```sql
BEGIN;

INSERT INTO app_config (key, value, description) VALUES
  ('kyc_score_thresholds',
   '{"high":0.85,"low":0.40}'::jsonb,
   'Threshold high: auto-aprovação. Threshold low: auto-reprovação. Entre: revisão manual'),
  ('kyc_manual_review_enabled', 'true'::jsonb, 'Liga/desliga revisão manual de KYC'),
  ('suspension_categories',
   '[
     {"code":"multi_cancellations","label":"Múltiplos cancelamentos"},
     {"code":"quality_complaint","label":"Reclamações de qualidade"},
     {"code":"behavior","label":"Comportamento inadequado"},
     {"code":"identity_doubt","label":"Dúvida sobre identidade"},
     {"code":"other","label":"Outro"}
   ]'::jsonb,
   'Categorias pré-definidas para suspensão (UI dropdown)'),
  ('kyc_rejection_reasons',
   '[
     {"code":"doc_invalid","label":"Documento inválido"},
     {"code":"identity_mismatch","label":"Divergência de identidade"},
     {"code":"low_quality_photo","label":"Foto de baixa qualidade"},
     {"code":"suspected_fraud","label":"Suspeita de fraude"},
     {"code":"other","label":"Outro"}
   ]'::jsonb,
   'Códigos de motivo para reprovação manual de KYC')
ON CONFLICT (key) DO NOTHING;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Hardcode de thresholds em código (sempre via app_config)
- ❌ Permitir admin não-admin escrever em app_config (RLS de US-010 T-064 já trata)
- ❌ Esquecer ON CONFLICT (rerun safe)
- ❌ Permitir threshold low > high (TBD: trigger CHECK no app_config futuro)

## Convenções
- Chaves snake_case
- `value` sempre jsonb
- Reusa estrutura criada em US-010 T-064$desc$,
 'OPS', 'SISTEMA', ARRAY['NO_RLS_NEEDED'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculo task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-204 moderation_log: AC #4, #5, #6, #8, #10, #11
  ('d9322290-f18b-4cae-bfaa-08ce5f111b19'::uuid, 4),
  ('d9322290-f18b-4cae-bfaa-08ce5f111b19'::uuid, 5),
  ('d9322290-f18b-4cae-bfaa-08ce5f111b19'::uuid, 6),
  ('d9322290-f18b-4cae-bfaa-08ce5f111b19'::uuid, 8),
  ('d9322290-f18b-4cae-bfaa-08ce5f111b19'::uuid, 10),
  ('d9322290-f18b-4cae-bfaa-08ce5f111b19'::uuid, 11),

  -- T-205 kyc_decisions: AC #4, #5, #10
  ('40414564-f996-4b12-9438-4f37eff1c77f'::uuid, 4),
  ('40414564-f996-4b12-9438-4f37eff1c77f'::uuid, 5),
  ('40414564-f996-4b12-9438-4f37eff1c77f'::uuid, 10),

  -- T-206 kyc_queue_v + indexes: AC #1, #3, #10
  ('e98944b9-e218-4751-9b33-118300b96ce9'::uuid, 1),
  ('e98944b9-e218-4751-9b33-118300b96ce9'::uuid, 3),
  ('e98944b9-e218-4751-9b33-118300b96ce9'::uuid, 10),

  -- T-207 GET providers: AC #1, #2
  ('c80661a0-277f-4c1f-997d-de9c5772de9f'::uuid, 1),
  ('c80661a0-277f-4c1f-997d-de9c5772de9f'::uuid, 2),

  -- T-208 KYC approve/reject: AC #4, #5, #10
  ('3efbe413-c3e9-4bbf-ab01-db6ff2d11409'::uuid, 4),
  ('3efbe413-c3e9-4bbf-ab01-db6ff2d11409'::uuid, 5),
  ('3efbe413-c3e9-4bbf-ab01-db6ff2d11409'::uuid, 10),

  -- T-209 suspend/reactivate: AC #6, #7, #8, #9
  ('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb'::uuid, 6),
  ('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb'::uuid, 7),
  ('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb'::uuid, 8),
  ('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb'::uuid, 9),

  -- T-210 audit-log: AC #11
  ('5f03c906-5357-4762-8d44-477f9d9aea90'::uuid, 11),

  -- T-211 /admin/providers list: AC #1
  ('89ed54e0-0b95-4789-a07c-15046b7d3a94'::uuid, 1),

  -- T-212 ProviderDetailSheet: AC #2, #11
  ('d50b93d9-bb80-405c-8993-debd782b7ac8'::uuid, 2),
  ('d50b93d9-bb80-405c-8993-debd782b7ac8'::uuid, 11),

  -- T-213 /admin/kyc-queue + dialogs: AC #3, #4, #5, #6, #7, #8, #9, #10
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 3),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 4),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 5),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 6),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 7),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 8),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 9),
  ('ec60796d-42a9-4571-b7e5-dc37f8876b30'::uuid, 10),

  -- T-214 OPS thresholds: AC #3
  ('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9'::uuid, 3)
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
-- T-204 provider_moderation_log
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'Enum provider_moderation_action criado com 6 valores', 1),
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'Tabela provider_moderation_log criada com FK admin_id, provider_id, reason NOT NULL', 2),
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'Triggers bloqueiam UPDATE/DELETE (smoke: tentativa retorna exception)', 3),
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'RLS: ADMIN lê tudo; PRESTADOR vê apenas próprios; cliente 0 linhas', 4),
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'INSERT direto via authenticated revogado (smoke: REVOKE INSERT vigente)', 5),
('d9322290-f18b-4cae-bfaa-08ce5f111b19', 'Indexes (provider, admin, action) presentes (EXPLAIN mostra index scan)', 6),

-- T-205 kyc_decisions
('40414564-f996-4b12-9438-4f37eff1c77f', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('40414564-f996-4b12-9438-4f37eff1c77f', 'Tabela kyc_decisions criada com enum kyc_manual_decision', 1),
('40414564-f996-4b12-9438-4f37eff1c77f', 'CHECK constraint força reason_text NOT NULL em rejected', 2),
('40414564-f996-4b12-9438-4f37eff1c77f', 'Coluna manual_kyc_attempts adicionada em provider_profiles com CHECK 0..5', 3),
('40414564-f996-4b12-9438-4f37eff1c77f', 'RLS: ADMIN lê tudo; PRESTADOR vê próprios', 4),
('40414564-f996-4b12-9438-4f37eff1c77f', 'Smoke: 2 inserts decision=rejected → manual_kyc_attempts=2 e account_status=blocked', 5),
('40414564-f996-4b12-9438-4f37eff1c77f', 'expired_docs_override_justification opcional; preenchido apenas em decisão approved com flag', 6),

-- T-206 kyc_queue_v + indexes
('e98944b9-e218-4751-9b33-118300b96ce9', 'Migration aplicada via psql', 0),
('e98944b9-e218-4751-9b33-118300b96ce9', 'View admin_provider_kyc_queue_v retorna apenas casos com low ≤ score < high', 1),
('e98944b9-e218-4751-9b33-118300b96ce9', 'View expõe has_expired_docs derivado de kv.flags', 2),
('e98944b9-e218-4751-9b33-118300b96ce9', 'Index provider_profiles_status_level_idx ativo para listagem', 3),
('e98944b9-e218-4751-9b33-118300b96ce9', 'Index GIN to_tsvector(personalData->>fullName) suporta busca por nome', 4),
('e98944b9-e218-4751-9b33-118300b96ce9', 'Index BTree em (personalData->>cpf) suporta busca exata por CPF', 5),
('e98944b9-e218-4751-9b33-118300b96ce9', 'Smoke: filtro por score=0.6 com thresholds 0.4/0.85 retorna case manual', 6),

-- T-207 list/detail providers
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'GET /api/admin/providers retorna 200 com items + nextCursor', 0),
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'Filtros (status, level, category_id, registered_*) validados via Zod', 1),
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'Search por nome usa to_tsvector; CPF usa equality', 2),
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'Cursor opaco (base64) consistente entre páginas', 3),
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'GET /[id] retorna 7 sub-objetos coerentes (identity, personal, banking, categories, history, occurrences, score, ratings)', 4),
('c80661a0-277f-4c1f-997d-de9c5772de9f', '403 sem claim admin; 404 quando provider_id não existe', 5),
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'CPF mascarado na lista; full apenas no detail', 6),

-- T-208 KYC approve/reject
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'POST /approve aceita reason opcional; reason default "manual_review_passed"', 0),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'POST /approve com flag expired_docs sem expired_docs_override_justification retorna 422', 1),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'POST /reject exige reason_code e reason_text (min 10 chars) — 400 caso contrário', 2),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'POST /reject 2x consecutivas: account_status=blocked + log action=blocked_definitive', 3),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', '409 quando kyc_verification não está em manual_review_pending', 4),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'Idempotency-Key obrigatório (400 sem header)', 5),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'Mesma idempotency_key 2x não duplica decisão (smoke)', 6),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'Notificação enfileirada via enqueue_notification_event com kind kyc_approved/rejected/blocked_definitive', 7),
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'Linkagem: kyc_decisions.moderation_log_id referencia o moderation_log criado na mesma transação', 8),

-- T-209 suspend/reactivate
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'POST /suspend exige category enum + reason_text min 10 chars', 0),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'POST /suspend com serviço ativo sem confirm_active_service=true retorna 409 com payload services[]', 1),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'POST /suspend com confirm_active_service=true cria admin_alert para acompanhamento manual', 2),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'POST /reactivate exige reason_text; com disputa aberta sem acknowledge_open_dispute=true retorna 409', 3),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'POST /reactivate NÃO altera status de disputa (AC #9)', 4),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'Suspend remove do pool (account_status=suspended); engine matching respeita', 5),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'Suspend cria provider_suspension_events (US-008) E provider_moderation_log (T-204) na mesma transação', 6),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'Notificações enfileiradas (provider_suspended, provider_reactivated)', 7),
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'Idempotency-Key obrigatório; double-tap não duplica', 8),

-- T-210 audit-log
('5f03c906-5357-4762-8d44-477f9d9aea90', 'GET /audit-log retorna stream cronológico (DESC) com kinds [moderation, kyc, suspension, appeal]', 0),
('5f03c906-5357-4762-8d44-477f9d9aea90', 'Filtro kinds[] funciona (smoke: passa kinds=kyc retorna só decisões KYC)', 1),
('5f03c906-5357-4762-8d44-477f9d9aea90', 'Cursor opaco com (createdAt, kind, id)', 2),
('5f03c906-5357-4762-8d44-477f9d9aea90', 'RPC retorna admin_id + nome do admin (JOIN com auth.users/profile)', 3),
('5f03c906-5357-4762-8d44-477f9d9aea90', '403 sem claim admin', 4),
('5f03c906-5357-4762-8d44-477f9d9aea90', 'Smoke: provider com 1 suspensão + 1 KYC reject + 2 moderações retorna 4 entries em ordem cronológica', 5),

-- T-211 /admin/providers list
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Tela renderiza filtros (status multi, level multi, categoria, período) e busca debounced', 0),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Lista com infinite scroll via IntersectionObserver', 1),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Cada item mostra nome + CPF mascarado + StatusChip + Badge level + categorias resumidas', 2),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Tap em item abre ProviderDetailSheet (T-212)', 3),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Empty state com mensagem orientativa (sem mensagem de erro)', 4),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Skeleton durante carregamento de cada página', 5),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Search com debounce de 350ms (useFieldDebounce reuso)', 6),
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'Mobile-first verificado em <md (filtros podem virar drawer)', 7),

-- T-212 ProviderDetailSheet
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'ResponsiveSheet abre com header (nome + StatusChip + Badge score)', 0),
('d50b93d9-bb80-405c-8993-debd782b7ac8', '7 abas funcionais: identidade/pessoal/categorias/historico/ocorrencias/score/avaliacoes', 1),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Aba Ocorrências consome /audit-log (T-210) com Markdown nos motivos', 2),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Footer com ações condicionais ao status (kyc_in_review → Aprovar/Reprovar; active → Suspender; suspended → Reativar)', 3),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Ações abrem dialogs (KycDecisionDialog/SuspendProviderDialog/ReactivateProviderDialog)', 4),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Após dialog onDone, sheet recarrega data + audit-log', 5),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Skeleton em todas abas durante carga inicial', 6),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Mobile <md: sheet vira bottom 90dvh; abas em scroll horizontal', 7),
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'Reuso: ResponsiveSheet, Button, Badge, StatusChip, Skeleton, Markdown', 8),

-- T-213 /admin/kyc-queue + dialogs
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'Página /admin/kyc-queue lista cases com score + horas pendentes + badge expired_docs', 0),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'Tap em caso abre ProviderDetailSheet na aba identidade', 1),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'KycDecisionDialog approve com docs expirados exige justification min 20 chars', 2),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'KycDecisionDialog reject exige reason_code (Select) + reason_text (Textarea min 10)', 3),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'SuspendProviderDialog mostra aviso explícito + checkbox quando há service ativo', 4),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'ReactivateProviderDialog mostra aviso explícito + checkbox quando há disputa aberta', 5),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'Idempotency-Key gerado uma vez por mount do dialog (não muda entre tries)', 6),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'Sucesso: toast verde + onDone callback fecha dialog e refetch detail', 7),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', '409 active_service / open_dispute re-renderiza dialog com checkbox visível', 8),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'Reuso: ResponsiveDialog, Field, Textarea, Select, Sonner (showErrorToast)', 9),
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'Categorias de suspensão / reasons KYC vêm de app_config (T-214)', 10),

-- T-214 OPS app_config
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'Migration aplicada via psql; chaves novas em app_config', 0),
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'kyc_score_thresholds default {high:0.85, low:0.40}', 1),
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'kyc_manual_review_enabled default true', 2),
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'suspension_categories array com 5 itens (code+label) — popula UI Select', 3),
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'kyc_rejection_reasons array com 5 itens — popula UI Select reject', 4),
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'ON CONFLICT (key) DO NOTHING torna seed idempotente', 5),
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'Smoke: SELECT key, value FROM app_config retorna todas as chaves novas', 6);

-- ============================================================================
-- 4. TaskDependency
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- Intra-US blocks
('40414564-f996-4b12-9438-4f37eff1c77f', 'd9322290-f18b-4cae-bfaa-08ce5f111b19', 'blocks'),  -- T-205 ← T-204 (FK moderation_log_id)
('e98944b9-e218-4751-9b33-118300b96ce9', '20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'blocks'),  -- T-206 ← T-214 (lê thresholds via app_config)
('c80661a0-277f-4c1f-997d-de9c5772de9f', 'e98944b9-e218-4751-9b33-118300b96ce9', 'blocks'),  -- T-207 ← T-206 (indexes)
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', '40414564-f996-4b12-9438-4f37eff1c77f', 'blocks'),  -- T-208 ← T-205
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'd9322290-f18b-4cae-bfaa-08ce5f111b19', 'blocks'),  -- T-208 ← T-204
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'd9322290-f18b-4cae-bfaa-08ce5f111b19', 'blocks'),  -- T-209 ← T-204
('5f03c906-5357-4762-8d44-477f9d9aea90', 'd9322290-f18b-4cae-bfaa-08ce5f111b19', 'blocks'),  -- T-210 ← T-204
('5f03c906-5357-4762-8d44-477f9d9aea90', '40414564-f996-4b12-9438-4f37eff1c77f', 'blocks'),  -- T-210 ← T-205
('89ed54e0-0b95-4789-a07c-15046b7d3a94', 'c80661a0-277f-4c1f-997d-de9c5772de9f', 'blocks'),  -- T-211 ← T-207
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'c80661a0-277f-4c1f-997d-de9c5772de9f', 'blocks'),  -- T-212 ← T-207
('d50b93d9-bb80-405c-8993-debd782b7ac8', '5f03c906-5357-4762-8d44-477f9d9aea90', 'blocks'),  -- T-212 ← T-210
('ec60796d-42a9-4571-b7e5-dc37f8876b30', 'c80661a0-277f-4c1f-997d-de9c5772de9f', 'blocks'),  -- T-213 ← T-207
('ec60796d-42a9-4571-b7e5-dc37f8876b30', '3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'blocks'),  -- T-213 ← T-208
('ec60796d-42a9-4571-b7e5-dc37f8876b30', '6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'blocks'),  -- T-213 ← T-209
('ec60796d-42a9-4571-b7e5-dc37f8876b30', '20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', 'blocks'),  -- T-213 ← T-214 (lê reasons/categories)
('d50b93d9-bb80-405c-8993-debd782b7ac8', 'ec60796d-42a9-4571-b7e5-dc37f8876b30', 'relates_to'),  -- T-212 usa dialogs criados em T-213

-- Cross-US relates_to
('40414564-f996-4b12-9438-4f37eff1c77f', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-005'), 'relates_to'),  -- kyc_decisions ↔ kyc_verifications (US-001)
('40414564-f996-4b12-9438-4f37eff1c77f', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-002'), 'relates_to'),  -- kyc_decisions ↔ provider_profiles (US-001)
('e98944b9-e218-4751-9b33-118300b96ce9', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-002'), 'relates_to'),  -- view ↔ provider_profiles
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-035'), 'relates_to'),  -- suspend ↔ provider_suspension_events (US-008)
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-034'), 'relates_to'),  -- suspend ↔ suspension_category enum (US-008)
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-190'), 'relates_to'),  -- suspend ↔ admin_alerts (US-016)
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to'),  -- suspend ↔ service_requests (US-011)
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'relates_to'),  -- reactivate ↔ disputes/support_tickets (US-026)
('6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),  -- ↔ enqueue_notification_event (US-022)
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-005'), 'relates_to'),  -- KYC decisions ↔ kyc_verifications
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-008'), 'relates_to'),  -- ↔ Unico KYC integration
('3efbe413-c3e9-4bbf-ab01-db6ff2d11409', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),  -- ↔ enqueue_notification_event
('5f03c906-5357-4762-8d44-477f9d9aea90', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-035'), 'relates_to'),  -- audit-log ↔ provider_suspension_events
('5f03c906-5357-4762-8d44-477f9d9aea90', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-036'), 'relates_to'),  -- audit-log ↔ provider_appeals (US-008)
('c80661a0-277f-4c1f-997d-de9c5772de9f', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-194'), 'relates_to'),  -- providers API ↔ assertAdmin pattern (US-016)
('20b3b3ab-2ea9-43d1-aac7-b891683e4bc9', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-064'), 'relates_to');  -- app_config seeds ↔ visita técnica (US-010)

COMMIT;
