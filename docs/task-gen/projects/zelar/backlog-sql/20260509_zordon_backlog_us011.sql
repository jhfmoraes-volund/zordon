-- ZLAR-V2-US-011 — Solicitar serviço com pagamento up-front e ver confirmação (CLIENTE / SOLICITACAO)
-- Backlog cards (planning metadata only). Snippets nas descriptions são SPEC, não rodam aqui.

BEGIN;

-- =============================================================================
-- 1. Tasks
-- =============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ───────── DATA ─────────

(
  '0db58807-4ce6-4253-b2a9-e24e4575f096',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-070',
  'Criar tabela service_requests com FSM inicial e RLS por client_id',
  $desc$## Objetivo
Tabela central do produto Zelar: representa o serviço solicitado pelo cliente do draft até a finalização. Schema mínimo para suportar US-011 (criação + pagamento) e US-020+ (matching, execução). Cobre AC #1, #2, #15 da US-011.

## Contexto
Módulo SOLICITACAO. Tabela é o "elo" do produto — referenciada pela máquina de estados (US-023), broadcast do pool (US-004), execução (US-005), avaliação (US-013), histórico, dashboard admin (US-016). Relação 1:N com `payments`, `service_events`, `virtual_consultations`. RLS por `client_id` para CLIENTE; PRESTADOR só lê quando alocado (`provider_id`); ADMIN tudo via claim.

## Estado atual / O que substitui
Não existe — primeira tabela de serviço.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_requests.sql`
```sql
BEGIN;

CREATE TYPE service_status AS ENUM (
  'draft',                  -- form salvo, sem pagamento
  'awaiting_payment',       -- aguardando captura
  'queued',                 -- pago, em busca por prestador
  'matched',                -- prestador aceito
  'in_progress',            -- prestador em deslocamento/execução
  'awaiting_signature',     -- finalizado pelo prestador, cliente ainda não assinou
  'completed',              -- assinatura cliente, escrow liberado
  'cancelled',              -- cancelado em estado pré-execução
  'disputed',               -- em disputa
  'reopened_after_vt'       -- reabrir após visita técnica recusada/expirada (US-011 AC#15)
);

CREATE TYPE payment_method AS ENUM ('credit_card','pix');

CREATE TABLE service_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES auth.users(id),
  provider_id       uuid REFERENCES auth.users(id),                 -- NULL até match
  category_id       uuid NOT NULL REFERENCES service_categories(id),
  subcategory_id    uuid NOT NULL REFERENCES service_subcategories(id),
  is_virtual_consultation boolean NOT NULL DEFAULT false,           -- copiado da subcat para imutabilidade
  description       text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 4000),
  photos            jsonb NOT NULL DEFAULT '[]'::jsonb,             -- array de paths em storage; check >=1
  complexity        text CHECK (complexity IN ('low','medium','high','unknown')),
  address_id        uuid NOT NULL REFERENCES client_addresses(id),
  scheduled_for     timestamptz,                                    -- data/hora desejada
  status            service_status NOT NULL DEFAULT 'draft',
  payment_method    payment_method,                                 -- definido ao iniciar pagamento
  total_cents       int CHECK (total_cents IS NULL OR total_cents >= 0),
  service_cents     int CHECK (service_cents IS NULL OR service_cents >= 0),
  travel_fee_cents  int CHECK (travel_fee_cents IS NULL OR travel_fee_cents >= 0),
  platform_fee_cents int CHECK (platform_fee_cents IS NULL OR platform_fee_cents >= 0),
  reopened_from     uuid REFERENCES service_requests(id),           -- AC#15
  vt_policy_version text,                                           -- versão da regra VT registrada (US-010 T-064)
  "createdAt"       timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"       timestamptz NOT NULL DEFAULT NOW(),
  CHECK (jsonb_array_length(photos) >= 1 OR status = 'draft')        -- foto obrigatória pra avançar
);

CREATE INDEX idx_sr_client ON service_requests(client_id);
CREATE INDEX idx_sr_provider ON service_requests(provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX idx_sr_status_created ON service_requests(status, "createdAt" DESC);
CREATE INDEX idx_sr_subcat_active ON service_requests(subcategory_id) WHERE status NOT IN ('completed','cancelled');

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_own_select" ON service_requests FOR SELECT
  USING (auth.uid() = client_id);
CREATE POLICY "client_own_insert" ON service_requests FOR INSERT
  WITH CHECK (auth.uid() = client_id);
CREATE POLICY "client_own_update" ON service_requests FOR UPDATE
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id AND status IN ('draft','awaiting_payment','queued','cancelled','reopened_after_vt'));

CREATE POLICY "provider_assigned_select" ON service_requests FOR SELECT
  USING (auth.uid() = provider_id);
CREATE POLICY "provider_assigned_update" ON service_requests FOR UPDATE
  USING (auth.uid() = provider_id)
  WITH CHECK (auth.uid() = provider_id AND status IN ('matched','in_progress','awaiting_signature'));

CREATE POLICY "admin_all" ON service_requests FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER service_requests_updated
  BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

### Notas de FSM
- Transições válidas viverão em **US-023** (`validate_status_transition`). Esta task só cria o enum e RLS pré-execução; transições para `matched`/`in_progress`/`completed` são responsabilidade da máquina de estados central, não desta task.
- `reopened_from` permite trace para AC #15 (reabertura após VT recusada).

## Constraints / NÃO fazer
- ❌ Permitir UPDATE de `total_cents` / `service_cents` por CLIENTE após `queued` (RLS WITH CHECK não inclui)
- ❌ Permitir DELETE — auditoria precisa do registro (cancellation = status, não delete)
- ❌ Vincular FK em `service_categories.id`/`service_subcategories.id` sem `ON DELETE` — usar default (RESTRICT) para impedir remoção de categoria que tenha histórico
- ❌ Permitir prestador ler service_request alheio (RLS já garante)
- ❌ Implementar transições FSM aqui — isso vive em US-023

## Convenções
- Migration aplicada via `psql "$DIRECT_URL" -f <file>`; `database.types.ts` regenerado
- Valores em centavos (int) — sem decimais
- `is_virtual_consultation` copiado da subcat na criação (snapshot) — preserva mesmo se subcat virar normal depois
- `vt_policy_version` registra versão da policy de visita técnica para auditoria (T-064 produz `version: "v1"`)
- Status default `draft` para suportar form parcial (autosave futuro)$desc$,
  'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '82182a9d-e5ae-46b2-aad4-e37dc5d759a5',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-071',
  'Criar payments + pix_codes + payment_attempts (escrow up-front, retry e Pix)',
  $desc$## Objetivo
Esquema de pagamento up-front com captura integral em escrow: tabela `payments` (1 ou mais por service_request — múltiplas tentativas de cartão), `pix_codes` (QR + copia-e-cola + expiry), `payment_attempts` (log imutável de cada cobrança recusada/aprovada). Cobre AC #5, #6, #7, #8, #14 da US-011.

## Contexto
Módulo SOLICITACAO. Captura é via Mercado Pago. Estado de pagamento dirige transição `awaiting_payment → queued`. Escrow só é liberado pelo job de US-005/US-023 ao concluir serviço. Tentativas de cartão recusadas viram registros em `payment_attempts` para AC #7 (cliente pode retentar sem refazer form). Pix expirado (T+30min) gera novo `pix_codes` mantendo `payments.id` (AC #8).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_payments.sql`
```sql
BEGIN;

CREATE TYPE payment_status AS ENUM (
  'pending',         -- aguardando ação do cliente
  'authorized',      -- cartão pré-autorizado mas não capturado (não usado em escrow up-front; reservado)
  'captured',        -- valor já em escrow
  'refunded',        -- estornado total
  'partially_refunded',
  'failed',          -- recusa final (cliente desistiu ou esgotou tentativas)
  'expired'          -- Pix não pago no prazo
);

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  client_id           uuid NOT NULL REFERENCES auth.users(id),
  method              payment_method NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  amount_cents        int NOT NULL CHECK (amount_cents > 0),
  is_visita_tecnica   boolean NOT NULL DEFAULT false,                 -- AC #12
  is_difference       boolean NOT NULL DEFAULT false,                 -- AC #14: pagamento da diferença pós-VT
  parent_payment_id   uuid REFERENCES payments(id),                   -- liga difference → vt original
  mp_payment_id       text,                                           -- ID externo Mercado Pago
  mp_preference_id    text,
  idempotency_key     text NOT NULL UNIQUE,
  captured_at         timestamptz,
  failed_reason       text,                                           -- "INSUFFICIENT_FUNDS", "CARD_EXPIRED", etc.
  failed_message      text,                                           -- mensagem amigável já mapeada
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pay_sr ON payments(service_request_id);
CREATE INDEX idx_pay_status ON payments(status);
CREATE INDEX idx_pay_mp ON payments(mp_payment_id) WHERE mp_payment_id IS NOT NULL;

CREATE TABLE pix_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  qr_code_b64       text NOT NULL,                          -- base64 do QR
  copy_paste        text NOT NULL,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  invalidated_at    timestamptz,                            -- quando regen criar novo, invalida o anterior
  "createdAt"       timestamptz NOT NULL DEFAULT NOW(),
  CHECK (used_at IS NULL OR invalidated_at IS NULL)
);
CREATE UNIQUE INDEX uq_pix_active_per_payment
  ON pix_codes(payment_id) WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE payment_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  attempted_at        timestamptz NOT NULL DEFAULT NOW(),
  outcome             text NOT NULL,                                  -- 'declined','approved','failed'
  failure_code        text,                                           -- 'CC_REJECTED_INSUFFICIENT_AMOUNT', 'CC_REJECTED_BAD_FILLED_DATE' etc
  failure_message     text,                                           -- amigável
  card_last4          text,                                           -- mascarado (último 4 dígitos)
  raw                 jsonb                                           -- payload bruto MP (auditoria)
);
CREATE INDEX idx_pa_payment ON payment_attempts(payment_id, attempted_at DESC);

-- RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pix_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

-- CLIENTE lê seus próprios; UPDATE somente via service role (webhook MP)
CREATE POLICY "client_select_own_payments" ON payments FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "client_select_own_pix" ON pix_codes FOR SELECT
  USING (payment_id IN (SELECT id FROM payments WHERE client_id = auth.uid()));

-- payment_attempts: apenas admin lê (auditoria); service role escreve
CREATE POLICY "admin_select_attempts" ON payment_attempts FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ADMIN lê tudo
CREATE POLICY "admin_all_payments" ON payments FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "admin_all_pix" ON pix_codes FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Service role bypass por padrão (escrita pelo webhook em T-078)

CREATE TRIGGER payments_updated
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE direto de `payments.status` por CLIENTE — apenas service role
- ❌ Persistir número completo do cartão / CVV (apenas `card_last4`)
- ❌ DELETE em payment_attempts — log é imutável; histórico de recusa é evidência
- ❌ Múltiplos pix ativos no mesmo payment (índice único parcial garante)
- ❌ Liberação de escrow aqui — vive em US-005/US-023 (job pós-finalização)

## Convenções
- `idempotency_key` UNIQUE — gerado em T-076/T-077, validado server-side
- `is_visita_tecnica` + `is_difference` + `parent_payment_id` permitem rastrear cadeia VT → diferença
- Pix expira em 30min (constante em `app_config` em US-019; mock 30min agora)
- `failed_reason` mapeado para mensagem amigável em `failed_message` no momento da gravação (não no display)
- Service role (webhook MP) é o único que faz UPDATE em `payments.status`$desc$,
  'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '38dd2639-832a-49a9-973d-52a708ff597f',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-072',
  'Criar virtual_consultations + proposals (visita técnica com expiry 48h)',
  $desc$## Objetivo
Esquema para visita técnica: registra quando uma `service_request` é VT, recebe a proposta do prestador após o diagnóstico, controla janela de 48h para cliente decidir (aceitar/recusar/revisar). Cobre AC #12, #13, #14 da US-011.

## Contexto
Módulo SOLICITACAO. Subcategoria com `is_virtual_consultation=true` (US-010 T-059) origina pagamento de taxa fixa (T-071 com `is_visita_tecnica=true`). Após diagnóstico, prestador submete `proposal` com escopo + valor; cliente tem 48h. Aceite cobra diferença (T-071 com `is_difference=true`); recusa/silêncio expira a proposta e não abre serviço novo automaticamente. Ciclo de expiração via `pg_cron` em T-080.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_virtual_consultations.sql`
```sql
BEGIN;

CREATE TYPE proposal_status AS ENUM (
  'awaiting_diagnosis',    -- prestador ainda não submeteu proposta
  'awaiting_decision',     -- cliente recebeu, tem 48h
  'accepted',              -- cliente aceitou; cobrança da diferença em andamento
  'declined',              -- cliente recusou
  'revision_requested',    -- cliente pediu revisão (volta para prestador)
  'expired'                -- cliente não decidiu em 48h
);

CREATE TABLE virtual_consultations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE RESTRICT,
  client_id           uuid NOT NULL REFERENCES auth.users(id),
  provider_id         uuid REFERENCES auth.users(id),
  status              proposal_status NOT NULL DEFAULT 'awaiting_diagnosis',
  proposed_at         timestamptz,
  decision_deadline   timestamptz,                                  -- proposed_at + 48h
  proposed_amount_cents int CHECK (proposed_amount_cents IS NULL OR proposed_amount_cents > 0),
  proposed_scope      text,                                          -- descrição do escopo proposto pelo prestador
  decided_at          timestamptz,
  decision            text CHECK (decision IS NULL OR decision IN ('accepted','declined','revision','expired')),
  difference_payment_id uuid REFERENCES payments(id),                -- pagamento da diferença (T-071)
  vt_payment_id       uuid NOT NULL REFERENCES payments(id),         -- pagamento da taxa fixa
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vc_status_deadline
  ON virtual_consultations(status, decision_deadline)
  WHERE status = 'awaiting_decision';

CREATE INDEX idx_vc_client ON virtual_consultations(client_id);
CREATE INDEX idx_vc_provider ON virtual_consultations(provider_id);

CREATE TABLE proposal_revisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  virtual_consultation_id uuid NOT NULL REFERENCES virtual_consultations(id) ON DELETE CASCADE,
  reason              text NOT NULL,
  requested_by        uuid NOT NULL REFERENCES auth.users(id),
  "createdAt"         timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pr_vc ON proposal_revisions(virtual_consultation_id, "createdAt" DESC);

ALTER TABLE virtual_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_select_own_vc" ON virtual_consultations FOR SELECT
  USING (auth.uid() = client_id);
CREATE POLICY "provider_assigned_vc_select" ON virtual_consultations FOR SELECT
  USING (auth.uid() = provider_id);
CREATE POLICY "admin_all_vc" ON virtual_consultations FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "client_or_provider_select_revs" ON proposal_revisions FOR SELECT
  USING (virtual_consultation_id IN (
    SELECT id FROM virtual_consultations
    WHERE client_id = auth.uid() OR provider_id = auth.uid()
  ));
CREATE POLICY "admin_all_revs" ON proposal_revisions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER vc_updated
  BEFORE UPDATE ON virtual_consultations
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE de `decision` por CLIENTE direto (mutação vai via RPC/endpoint em T-079, não via PATCH RLS)
- ❌ DELETE em proposal_revisions (histórico imutável)
- ❌ Mais de uma virtual_consultation ativa por service_request (UNIQUE garante)
- ❌ Calcular `decision_deadline` no client (sempre server-side, momento do submit)

## Convenções
- `decision_deadline = proposed_at + INTERVAL '48 hours'` — cravado server-side
- Job em T-080 (pg_cron) atualiza `awaiting_decision` → `expired` via UPDATE quando `NOW() > decision_deadline`
- `vt_payment_id` é o pagamento de taxa fixa (T-064 `fixed_fee_cents`); `difference_payment_id` só populado em accept
- Cliente que pede revisão (AC #13) cria linha em `proposal_revisions` e volta status para `awaiting_diagnosis`$desc$,
  'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'ac7a472b-23e3-46ff-b278-6f09c4fdbf09',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-073',
  'Criar service_request_estimates (cache de preço) + matching_eta_estimates (tempo médio de match)',
  $desc$## Objetivo
Cache server-side do preço estimado calculado para a `service_request` (subcategoria + complexidade + endereço → range de valores) e do tempo médio estimado de matching (categoria/horário → ETA mostrado na confirmação). Cobre AC #3, #4, #10 da US-011.

## Contexto
Módulo SOLICITACAO. Pricing engine (T-075) calcula breakdown e persiste neste cache para mostrar ao cliente sem recalcular a cada render. ETA de matching (AC #10) lê de uma view materializada simples populada por job (a ser detalhado em US-016 dashboard admin) — aqui criamos a tabela base + view.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_estimates.sql`
```sql
BEGIN;

CREATE TABLE service_request_estimates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  service_min_cents   int NOT NULL CHECK (service_min_cents >= 0),
  service_max_cents   int NOT NULL CHECK (service_max_cents >= service_min_cents),
  travel_fee_cents    int NOT NULL CHECK (travel_fee_cents >= 0),
  platform_fee_cents  int NOT NULL CHECK (platform_fee_cents >= 0),
  total_min_cents     int GENERATED ALWAYS AS (service_min_cents + travel_fee_cents + platform_fee_cents) STORED,
  total_max_cents     int GENERATED ALWAYS AS (service_max_cents + travel_fee_cents + platform_fee_cents) STORED,
  pricing_basis       text,                                  -- "per_visit", "from", etc — copiado da subcat
  computed_at         timestamptz NOT NULL DEFAULT NOW(),
  inputs_hash         text NOT NULL,                         -- hash de subcat+complexity+address+scheduled_for; permite invalidar cache se inputs mudarem
  UNIQUE (service_request_id, inputs_hash)
);
CREATE INDEX idx_sre_sr ON service_request_estimates(service_request_id, computed_at DESC);

CREATE TABLE matching_eta_samples (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id         uuid NOT NULL REFERENCES service_categories(id),
  hour_of_day         smallint NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  matched_at_seconds  int NOT NULL,                          -- tempo até match em segundos
  "createdAt"         timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mes_cat_hour ON matching_eta_samples(category_id, hour_of_day);

-- View para ETA: média móvel últimos 30 dias por (categoria, faixa horária)
CREATE OR REPLACE VIEW matching_eta_estimates_v AS
  SELECT category_id,
         hour_of_day,
         ROUND(AVG(matched_at_seconds))::int AS avg_seconds,
         COUNT(*) AS sample_size
  FROM matching_eta_samples
  WHERE "createdAt" > NOW() - INTERVAL '30 days'
  GROUP BY category_id, hour_of_day;

ALTER TABLE service_request_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_select_own_estimates" ON service_request_estimates FOR SELECT
  USING (service_request_id IN (SELECT id FROM service_requests WHERE client_id = auth.uid()));
CREATE POLICY "admin_all_estimates" ON service_request_estimates FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

ALTER TABLE matching_eta_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_aggregated_only" ON matching_eta_samples FOR SELECT USING (false);  -- linha bruta nunca exposta
CREATE POLICY "admin_all_samples" ON matching_eta_samples FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- View readável por authenticated (lida pelo Server Component que mostra ETA na confirmação)
GRANT SELECT ON matching_eta_estimates_v TO authenticated, anon;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Recalcular preço na UI — sempre server-side via T-075
- ❌ Expor `matching_eta_samples` linha-a-linha (só agregado)
- ❌ Atrelar `service_min_cents` direto à subcat sem aplicar complexidade (preço varia por complexity flag)
- ❌ Fallback estático — se sample_size é baixo, retornar `NULL` e UI mostra mensagem genérica

## Convenções
- `inputs_hash = sha256(subcat || complexity || address_id || scheduled_for_date)` — calculado em T-075
- Cache invalida ao recalcular (UPDATE com novo `inputs_hash` cria nova linha; query lê a mais recente)
- ETA exibido em "Tempo médio: ~5 min" — UI formata `avg_seconds` em texto humano
- View materializada NÃO usada nesta task (volume é baixo no MVP); se virar gargalo, US-016 promove para `MATERIALIZED VIEW`$desc$,
  'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── API ─────────

(
  '2bfe95ca-70fb-4a78-b769-58c9fbbae451',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-074',
  'Implementar POST /api/services (criar draft + upload de fotos + reabrir VT)',
  $desc$## Objetivo
Endpoint que cria uma `service_request` em status `draft` a partir do form do cliente (subcat selecionada + descrição + fotos + complexidade + endereço + data/hora). Suporta também `reopen_from` para AC #15 (reabrir após VT recusada/expirada). Cobre AC #1, #2, #11, #15.

## Contexto
Módulo SOLICITACAO. Chamado pelo wizard `/(client)/services/new` (T-082) ao final do step de problema/endereço. Resposta inclui `service_request_id` que cliente usa para chamar T-075 (quote) e T-076/T-077 (payment). Fotos vão para Supabase Storage bucket `service-photos/{client_id}/{service_request_id}/`. Endereço é validado FK em `client_addresses` (já existe via T-046).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/services/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  subcategory_id: z.string().uuid(),
  description: z.string().min(10).max(4000),
  photos: z.array(z.string().min(1)).min(1).max(8),       // paths já uploadados
  complexity: z.enum(['low','medium','high','unknown']),
  address_id: z.string().uuid(),
  scheduled_for: z.string().datetime().optional(),
  reopen_from: z.string().uuid().optional(),
  vt_policy_version: z.string().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'invalid_body', details: e }, { status: 400 }); }

  // Pega flag is_virtual_consultation da subcat (snapshot)
  const { data: subcat } = await supabase
    .from('service_subcategories')
    .select('id, category_id, is_virtual_consultation')
    .eq('id', body.subcategory_id).single();
  if (!subcat) return NextResponse.json({ error: 'invalid_subcategory' }, { status: 400 });

  const { data: created, error } = await supabase
    .from('service_requests')
    .insert({
      client_id: user.id,
      category_id: subcat.category_id,
      subcategory_id: subcat.id,
      is_virtual_consultation: subcat.is_virtual_consultation,
      description: body.description,
      photos: body.photos,
      complexity: body.complexity,
      address_id: body.address_id,
      scheduled_for: body.scheduled_for,
      status: body.reopen_from ? 'reopened_after_vt' : 'draft',
      reopened_from: body.reopen_from,
      vt_policy_version: body.vt_policy_version,
    })
    .select('id, status, is_virtual_consultation')
    .single();
  if (error) return NextResponse.json({ error: 'create_failed' }, { status: 500 });

  return NextResponse.json(created, { status: 201 });
}
```

### Upload pré-form
- Cliente faz upload direto pro Storage usando signed URLs (bucket `service-photos`, RLS por `auth.uid() = (storage.foldername(name))[1]::uuid`).
- Endpoint **não recebe blobs** — só os paths retornados pelo signed URL. UI gerencia upload e passa array de paths.

### Storage policy (criada nesta task)
```sql
-- supabase/migrations/<YYYYMMDD>_zelar_v2_storage_service_photos.sql
INSERT INTO storage.buckets (id, name, public) VALUES ('service-photos','service-photos', false)
  ON CONFLICT (id) DO NOTHING;
CREATE POLICY "client_upload_own_folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'service-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "client_read_own_folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'service-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "provider_read_assigned" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'service-photos' AND EXISTS (
    SELECT 1 FROM service_requests sr
    WHERE sr.provider_id = auth.uid()
      AND (storage.foldername(name))[1] = sr.client_id::text
      AND name LIKE sr.client_id::text || '/' || sr.id::text || '/%'
  ));
```

## Constraints / NÃO fazer
- ❌ Receber blobs no endpoint (sempre signed URL → path)
- ❌ Validar formato de imagem aqui (Storage faz com bucket policy de mime)
- ❌ Calcular preço dentro deste endpoint — separação de concerns; usar T-075
- ❌ Não-CLIENTE consegue criar (RLS de service_requests bloqueia, mas validar 401 antes)

## Convenções
- Idempotency-Key opcional (pelo menos pra reopen, pra evitar dupla reabertura) — TODO: tornar obrigatório se T-076 obrigar; nesta task aceita ambos
- Resposta inclui `is_virtual_consultation` para UI decidir próxima rota (VT vs normal)
- `reopen_from` (AC #15) cria linha NOVA com status `reopened_after_vt`; cliente passa pela tela de aviso (T-082) antes de chegar aqui
- Endpoint sempre `RESPONSE 201` no sucesso (REST estrito)$desc$,
  'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '107f0539-de57-4a7a-b609-bcc0d9e360b1',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-075',
  'Implementar POST /api/services/[id]/quote (calcular breakdown + travel_fee por distância)',
  $desc$## Objetivo
Pricing engine MVP: a partir da subcategoria + complexidade + endereço + data/hora, calcula `service_min/max`, `travel_fee` (distância CEP → endereço com fallback flat) e `platform_fee` (% configurável). Persiste em `service_request_estimates` para reuso pelas telas. Cobre AC #3, #4 da US-011.

## Contexto
Módulo SOLICITACAO. Chamado por T-082 imediatamente após salvar draft em T-074. Lê faixas de preço de `service_subcategories` (US-010 T-059) e parâmetros (`platform_fee_pct`, `travel_fee_per_km_cents`, `travel_fee_min_cents`) de `app_config`. Distância = haversine entre o `client_addresses.geo` e um centro estimado da cidade (mock no MVP — refinado em US-020 quando engine de matching tiver real distância).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/services/[id]/quote/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createHash } from 'crypto';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Lê SR + subcat + endereço (RLS already restricts to owner)
  const { data: sr, error: srErr } = await supabase
    .from('service_requests')
    .select(`
      id, client_id, complexity, scheduled_for, address_id,
      subcategory:service_subcategories (
        id, price_min_cents, price_max_cents, pricing_basis, is_virtual_consultation
      ),
      address:client_addresses ( id, cep, geo )
    `)
    .eq('id', id).single();
  if (srErr || !sr) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const config = await loadPricingConfig(supabase); // { platform_fee_pct, travel_fee_per_km_cents, travel_fee_min_cents, vt_fixed_fee_cents }

  let serviceMin = sr.subcategory.price_min_cents ?? 0;
  let serviceMax = sr.subcategory.price_max_cents ?? 0;

  // Aplicar coeficiente por complexidade
  const factor = { low: 0.85, medium: 1.0, high: 1.3, unknown: 1.0 }[sr.complexity ?? 'unknown'];
  serviceMin = Math.round(serviceMin * factor);
  serviceMax = Math.round(serviceMax * factor);

  // Visita técnica: serviço fixo igual ao fixed_fee
  if (sr.subcategory.is_virtual_consultation) {
    serviceMin = config.vt_fixed_fee_cents;
    serviceMax = config.vt_fixed_fee_cents;
  }

  // travel_fee: mock baseado em CEP (km estimado por prefixo); refinar em US-020
  const km = estimateKmFromCep(sr.address?.cep);
  const travelFee = Math.max(config.travel_fee_min_cents, km * config.travel_fee_per_km_cents);

  const platformFee = Math.round((serviceMax + travelFee) * config.platform_fee_pct);

  const inputs = JSON.stringify({ subId: sr.subcategory.id, complexity: sr.complexity, addr: sr.address_id, sched: sr.scheduled_for });
  const inputs_hash = createHash('sha256').update(inputs).digest('hex');

  const { data: estimate, error } = await supabase
    .from('service_request_estimates')
    .upsert({
      service_request_id: sr.id,
      service_min_cents: serviceMin,
      service_max_cents: serviceMax,
      travel_fee_cents: travelFee,
      platform_fee_cents: platformFee,
      pricing_basis: sr.subcategory.pricing_basis,
      inputs_hash,
    }, { onConflict: 'service_request_id,inputs_hash' })
    .select('*').single();
  if (error) return NextResponse.json({ error: 'estimate_failed' }, { status: 500 });

  // Cache totals na própria SR (denormaliza pra UI ler 1 query)
  await supabase.from('service_requests').update({
    service_cents: serviceMax,
    travel_fee_cents: travelFee,
    platform_fee_cents: platformFee,
    total_cents: serviceMax + travelFee + platformFee,
  }).eq('id', sr.id);

  return NextResponse.json(estimate);
}
```

### Helper `loadPricingConfig`
- Lê chaves de `app_config`: `platform_fee_pct`, `travel_fee_per_km_cents`, `travel_fee_min_cents`, `public:visita_tecnica.fixed_fee_cents`
- Cache em memória do route handler (revalidate por request — leve)

### `estimateKmFromCep`
- MVP: lookup table prefixo CEP → km estimado (10 entradas para SP); fallback 5km. Refinado em US-020.

## Constraints / NÃO fazer
- ❌ Calcular preço com geocoding pago no MVP (Google/Mapbox) — mock CEP basta
- ❌ Persistir `total_cents` direto sem passar por estimate (audit trail importante)
- ❌ Aplicar fee de plataforma sobre o `travel_fee` em VT — em VT, plataforma é zero (custo do operacional)
- ❌ Expor `inputs_hash` para o cliente

## Convenções
- Coeficientes de complexidade hardcoded (factor 0.85/1.0/1.3) — refinar em US-019 admin
- Visita técnica usa `vt_fixed_fee_cents` direto (T-064 valor inicial 12000)
- `service_cents`, `travel_fee_cents`, `platform_fee_cents`, `total_cents` em `service_requests` ficam denormalizados para a UI ler 1 row e renderizar o breakdown sem JOIN
- Idempotency via `inputs_hash` — chamar 2× com mesmo input retorna o mesmo cache$desc$,
  'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'e03bfd36-d7b6-410d-ae08-eb07f2681fff',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-076',
  'Implementar POST /api/services/[id]/payment (cartão crédito via Mercado Pago + retry sem refazer form)',
  $desc$## Objetivo
Iniciar pagamento por cartão de crédito (captura imediata em escrow): cria registro em `payments`, chama Mercado Pago Payments API com Idempotency-Key, mapeia recusas em mensagens amigáveis, registra cada tentativa em `payment_attempts`. Retorno informa `success` ou `declined` com `failure_message` para retry sem refazer form. Cobre AC #5, #7, #12 (taxa fixa VT), #14 (diferença pós-VT) da US-011.

## Contexto
Módulo SOLICITACAO. Chamado pela tela de pagamento (T-083) com `cardToken` gerado pelo SDK MP no cliente (PCI). Server-side, monta payload Mercado Pago e captura. Sucesso → atualiza `payments.status=captured` e dispara transição `service_requests.status='draft'→'queued'` (via service role). Recusa → atualiza `payments.status='failed'` ou mantém `pending` para retry; sempre log em `payment_attempts`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/services/[id]/payment/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mpCreatePayment } from '@/lib/payments/mercadopago';
import { mapMpFailure } from '@/lib/payments/failure-map';

const Body = z.object({
  card_token: z.string().min(1),
  installments: z.number().int().min(1).max(12),
  payer: z.object({
    email: z.string().email(),
    identification: z.object({ type: z.enum(['CPF']), number: z.string().min(11).max(14) }),
  }),
  is_difference: z.boolean().optional(),
  is_visita_tecnica: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: srId } = await params;
  const supabase = await createClient();
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }

  // Busca SR e amount via RLS (cliente é dono)
  const { data: sr, error: srErr } = await supabase
    .from('service_requests')
    .select('id, total_cents, is_virtual_consultation, vt_policy_version')
    .eq('id', srId).single();
  if (srErr || !sr) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Determina amount
  let amount = sr.total_cents ?? 0;
  if (body.is_visita_tecnica) {
    // VT só cobra fixed_fee
    amount = await getVtFixedFee(supabase);
  }
  if (body.is_difference) {
    // Diferença = total proposta - vt fixed already paid
    amount = await getDifferenceAmount(supabase, srId);
  }
  if (amount <= 0) return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });

  const admin = createAdminClient(); // bypass RLS para payments + attempts

  // Cria payment row (status pending)
  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      service_request_id: srId,
      client_id: user.id,
      method: 'credit_card',
      status: 'pending',
      amount_cents: amount,
      idempotency_key: idemKey,
      is_visita_tecnica: !!body.is_visita_tecnica,
      is_difference: !!body.is_difference,
    })
    .select('id').single();
  if (payErr) {
    if (payErr.code === '23505') {
      // duplicate idempotency_key — retorna existing
      const { data: existing } = await admin.from('payments').select('*').eq('idempotency_key', idemKey).single();
      return NextResponse.json({ payment_id: existing?.id, replayed: true });
    }
    return NextResponse.json({ error: 'create_payment_failed' }, { status: 500 });
  }

  // Chama Mercado Pago
  const mp = await mpCreatePayment({
    transaction_amount: amount / 100,
    token: body.card_token,
    installments: body.installments,
    payment_method_id: 'credit_card',
    payer: body.payer,
    external_reference: payment.id,
    capture: true,
  });

  // Log da tentativa
  await admin.from('payment_attempts').insert({
    payment_id: payment.id,
    outcome: mp.status === 'approved' ? 'approved' : 'declined',
    failure_code: mp.status_detail,
    failure_message: mapMpFailure(mp.status_detail),
    card_last4: mp.card?.last_four_digits,
    raw: mp,
  });

  if (mp.status === 'approved') {
    await admin.from('payments').update({
      status: 'captured',
      mp_payment_id: String(mp.id),
      captured_at: new Date().toISOString(),
    }).eq('id', payment.id);

    // Transição service_request para queued (apenas se não for diferença/VT preliminar)
    if (!body.is_visita_tecnica && !body.is_difference) {
      await admin.from('service_requests').update({
        status: 'queued',
        payment_method: 'credit_card',
      }).eq('id', srId);
    }
    return NextResponse.json({ payment_id: payment.id, status: 'captured' });
  }

  // Recusa: payment fica como `pending` (cliente pode retentar). Após N tentativas, marcar como failed
  const { count: attempts } = await admin
    .from('payment_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('payment_id', payment.id);

  if ((attempts ?? 0) >= 4) {
    await admin.from('payments').update({
      status: 'failed',
      failed_reason: mp.status_detail,
      failed_message: mapMpFailure(mp.status_detail),
    }).eq('id', payment.id);
    return NextResponse.json({ payment_id: payment.id, status: 'failed', message: mapMpFailure(mp.status_detail) }, { status: 402 });
  }

  return NextResponse.json({
    payment_id: payment.id,
    status: 'declined',
    can_retry: true,
    message: mapMpFailure(mp.status_detail),
  }, { status: 402 });
}
```

### `src/lib/payments/mercadopago.ts`
- Wrapper `mpCreatePayment(payload)` usando `MERCADOPAGO_ACCESS_TOKEN`
- Inclui `X-Idempotency-Key` header para a MP API
- Retorna shape parseado

### `src/lib/payments/failure-map.ts`
- Map status_detail MP → mensagem pt-BR amigável: `cc_rejected_insufficient_amount` → "Saldo insuficiente. Tente outro cartão.", `cc_rejected_bad_filled_card_number` → "Número do cartão incorreto", etc.

## Constraints / NÃO fazer
- ❌ Receber número completo do cartão (sempre via `card_token` MP — PCI scope)
- ❌ Reusar idempotency_key entre tentativas (cada tentativa tem key nova; retry com mesma key retorna replay)
- ❌ Esperar webhook MP para considerar pago (capture síncrono → status já vem no response)
- ❌ Transicionar SR para `queued` em pagamento `is_visita_tecnica` ou `is_difference` (esses fluxos têm transições próprias em US-005/T-079)

## Convenções
- Idempotency-Key OBRIGATÓRIO (header) — gerado pelo client a cada nova tentativa
- Secrets: `MERCADOPAGO_ACCESS_TOKEN` (server-only)
- Limite 4 tentativas — após esgotar, `payments.status='failed'` (cliente pode trocar para Pix em T-077)
- Mensagens de recusa em pt-BR via `mapMpFailure` (mantém payload `failed_reason` cru pra debug)$desc$,
  'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION','SECRET_HANDLING','IDEMPOTENCY_KEY','RATE_LIMIT'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '7c448703-b7b7-4f27-bdb8-4f1118c53793',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-077',
  'Implementar POST /api/services/[id]/pix (gerar QR + copia-cola + regenerar expirado)',
  $desc$## Objetivo
Gerar Pix via Mercado Pago para pagamento up-front: registra `payments` com `method=pix`, chama MP para criar QR + copia-cola, persiste em `pix_codes` com expiry 30min. Permite regenerar (AC #8) sem refazer form: invalida o anterior e cria novo. Cobre AC #5, #6, #8.

## Contexto
Módulo SOLICITACAO. Chamado pela tela T-083 quando cliente escolhe Pix. Status do pagamento Pix vem via webhook MP (T-078) — UI escuta via Realtime canal `service:{id}` (T-081). Regen invalida o `pix_codes` anterior (constraint UNIQUE garante 1 ativo por payment).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/services/[id]/pix/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mpCreatePix } from '@/lib/payments/mercadopago';

const Body = z.object({
  is_difference: z.boolean().optional(),
  is_visita_tecnica: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: srId } = await params;
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = Body.parse(await req.json().catch(() => ({})));
  const admin = createAdminClient();

  // Reuse payment row (idempotency) ou cria
  const { data: existing } = await admin
    .from('payments').select('*').eq('idempotency_key', idemKey).maybeSingle();

  let payment = existing;
  if (!payment) {
    const amount = await computeAmount(admin, srId, body);
    const { data: created } = await admin.from('payments').insert({
      service_request_id: srId,
      client_id: user.id,
      method: 'pix',
      amount_cents: amount,
      idempotency_key: idemKey,
      is_visita_tecnica: !!body.is_visita_tecnica,
      is_difference: !!body.is_difference,
    }).select('*').single();
    payment = created;
  }

  // Invalida pix anterior
  await admin.from('pix_codes')
    .update({ invalidated_at: new Date().toISOString() })
    .eq('payment_id', payment!.id)
    .is('used_at', null)
    .is('invalidated_at', null);

  // Gera novo via MP
  const mp = await mpCreatePix({
    amount: payment!.amount_cents / 100,
    external_reference: payment!.id,
    expires_in_seconds: 30 * 60,
  });

  const { data: pix } = await admin.from('pix_codes').insert({
    payment_id: payment!.id,
    qr_code_b64: mp.qr_code_b64,
    copy_paste: mp.qr_code_text,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }).select('*').single();

  await admin.from('payments').update({ mp_payment_id: String(mp.id) }).eq('id', payment!.id);

  return NextResponse.json({
    payment_id: payment!.id,
    pix_id: pix!.id,
    qr_code_b64: pix!.qr_code_b64,
    copy_paste: pix!.copy_paste,
    expires_at: pix!.expires_at,
  });
}
```

### `src/lib/payments/mercadopago.ts` (extensão)
- `mpCreatePix(payload)` chama `POST /v1/payments` com `payment_method_id: 'pix'`
- Retorna `qr_code_b64`, `qr_code_text`, `id` (mp payment id)

## Constraints / NÃO fazer
- ❌ Persistir QR sem expires_at (expira sozinho via job)
- ❌ Permitir 2 pix ativos no mesmo payment (índice único parcial)
- ❌ Marcar `payments.status='captured'` aqui — só webhook MP (T-078) confirma
- ❌ Aceitar `expires_in` do client (cravado server-side em 30min)

## Convenções
- 30min expiry hardcoded; depois configurável em US-019 (`pix_expiry_seconds`)
- Regen idempotente — chamar 2× com mesma key reusa payment, gera pix novo (anterior invalidado)
- UI consome via Realtime; Pix pago dispara webhook → `payments.status='captured'` → realtime UPDATE em `service_requests.status='queued'`$desc$,
  'API', 'CLIENTE', ARRAY['RLS_REQUIRED','SECRET_HANDLING','IDEMPOTENCY_KEY','INPUT_VALIDATION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '14fc6ec7-71c6-443f-aa5e-7c8175c394c0',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-078',
  'Implementar webhook /api/webhooks/mercadopago (atualizar payment + transicionar service_request)',
  $desc$## Objetivo
Receber webhooks do Mercado Pago (Pix pago, cartão capturado, estornos), validar assinatura, atualizar `payments.status`, registrar log em `payment_attempts` quando aplicável, transicionar `service_requests.status` quando o pagamento principal confirma. Cobre AC #5, #6 da US-011.

## Contexto
Módulo SOLICITACAO. MP envia POST com `{ type, action, data: { id } }`; rota busca o payment via `mp_payment_id` ou `external_reference`, pega detalhes via API MP, atualiza estado. Service role bypass RLS (assinado pelo segredo do webhook). Idempotente — receber mesma notificação 2× não duplica efeito.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/webhooks/mercadopago/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mpGetPayment } from '@/lib/payments/mercadopago';
import { verifyMpSignature } from '@/lib/payments/webhook-sig';

export async function POST(req: Request) {
  const sig = req.headers.get('x-signature');
  const reqId = req.headers.get('x-request-id');
  const body = await req.text();
  if (!verifyMpSignature(sig, reqId, body, process.env.MERCADOPAGO_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.type !== 'payment') return NextResponse.json({ ignored: true });

  const mp = await mpGetPayment(event.data.id);
  const admin = createAdminClient();

  // Localiza payment via external_reference (id interno) OU mp_payment_id
  const { data: payment } = await admin
    .from('payments')
    .select('*')
    .or(`mp_payment_id.eq.${mp.id},id.eq.${mp.external_reference}`)
    .maybeSingle();
  if (!payment) {
    return NextResponse.json({ ignored: true, reason: 'payment_not_found' });
  }

  // Idempotência: se já está captured/refunded, não reprocessa
  if (['captured','refunded','partially_refunded','expired'].includes(payment.status)
      && mp.status === 'approved' && payment.status === 'captured') {
    return NextResponse.json({ ok: true, replayed: true });
  }

  let newStatus = payment.status;
  if (mp.status === 'approved') newStatus = 'captured';
  else if (mp.status === 'refunded') newStatus = 'refunded';
  else if (mp.status === 'rejected') newStatus = 'failed';
  else if (mp.status === 'cancelled') newStatus = 'expired';

  await admin.from('payments').update({
    status: newStatus,
    mp_payment_id: String(mp.id),
    captured_at: newStatus === 'captured' ? (mp.date_approved ?? new Date().toISOString()) : null,
  }).eq('id', payment.id);

  // Log em attempts pra auditoria
  await admin.from('payment_attempts').insert({
    payment_id: payment.id,
    outcome: mp.status === 'approved' ? 'approved' : 'declined',
    failure_code: mp.status_detail,
    raw: mp,
  });

  // Se foi pagamento principal capturado → SR para queued
  if (newStatus === 'captured' && !payment.is_visita_tecnica && !payment.is_difference) {
    await admin.from('service_requests').update({
      status: 'queued',
      payment_method: payment.method,
    }).eq('id', payment.service_request_id);
  }
  // Se foi VT capturada → SR fica em estado especial (matched_for_diagnostic ou similar — definido em US-005)
  // Se foi diferença → SR avança para próximo estado (definido em US-005/US-023)

  return NextResponse.json({ ok: true });
}
```

### `src/lib/payments/webhook-sig.ts`
- HMAC-SHA256 do `id;request-id;ts` com `MERCADOPAGO_WEBHOOK_SECRET` (esquema MP atual)
- Compare timing-safe via `crypto.timingSafeEqual`

## Constraints / NÃO fazer
- ❌ Aceitar webhook sem validação de assinatura (rejeitar 401)
- ❌ Logar payload bruto sem mascarar PII (mascarar email/CPF antes de logar)
- ❌ Reprocessar quando estado já é terminal (idempotência defensiva)
- ❌ Disparar transição SR para `queued` em pagamento de VT/diferença (cada um tem fluxo próprio)

## Convenções
- Endpoint público mas autenticado por assinatura HMAC
- Service role via `createAdminClient` (RLS bypass) — única forma de UPDATE em payments fora do owner
- Resposta sempre 200 mesmo se ignorado (MP retenta apenas em 5xx)
- `payment_attempts` registra cada notificação para audit trail$desc$,
  'API', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG','IDEMPOTENCY_KEY'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'b18bbdca-57f4-4eff-b5bf-ef80e3f2e830',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-079',
  'Implementar endpoints de proposta VT (submit prestador, accept/decline/revise cliente)',
  $desc$## Objetivo
APIs do ciclo de visita técnica: PRESTADOR submete proposta após diagnóstico; CLIENTE aceita (cobra diferença), recusa ou pede revisão (volta para prestador). Todas via mutações idempotentes com transição atômica em `virtual_consultations`. Cobre AC #13, #14 da US-011.

## Contexto
Módulo SOLICITACAO. Chamado pela tela T-085 (cliente). Endpoint do prestador chamado durante execução da VT (US-005). Decisão de aceite cria pagamento de diferença via T-076; decisão de recusa/expiry deixa o pagamento de VT capturado (cliente perde a taxa por design — AC #14). RPC SECURITY DEFINER faz a transição atômica para evitar race entre múltiplos clicks.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_vt_rpc.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION decide_proposal(
  p_vc_id uuid,
  p_decision text,
  p_revision_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_vc record;
BEGIN
  SELECT * INTO v_vc FROM virtual_consultations WHERE id = p_vc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '42704'; END IF;

  IF v_vc.client_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_vc.status <> 'awaiting_decision' THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;
  IF NOW() > v_vc.decision_deadline THEN
    UPDATE virtual_consultations SET status = 'expired', decision = 'expired', decided_at = NOW() WHERE id = p_vc_id;
    RAISE EXCEPTION 'expired' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'accepted' THEN
    UPDATE virtual_consultations SET status='accepted', decision='accepted', decided_at=NOW() WHERE id = p_vc_id;
  ELSIF p_decision = 'declined' THEN
    UPDATE virtual_consultations SET status='declined', decision='declined', decided_at=NOW() WHERE id = p_vc_id;
  ELSIF p_decision = 'revision' THEN
    INSERT INTO proposal_revisions (virtual_consultation_id, reason, requested_by) VALUES (p_vc_id, p_revision_reason, auth.uid());
    UPDATE virtual_consultations SET status='revision_requested' WHERE id = p_vc_id;
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', (SELECT status FROM virtual_consultations WHERE id = p_vc_id));
END $$;

CREATE OR REPLACE FUNCTION submit_proposal(
  p_sr_id uuid,
  p_amount_cents int,
  p_scope text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_vc_id uuid;
BEGIN
  -- valida prestador alocado
  IF NOT EXISTS (SELECT 1 FROM service_requests WHERE id = p_sr_id AND provider_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_cents <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  -- localiza VT existente OU cria
  SELECT id INTO v_vc_id FROM virtual_consultations WHERE service_request_id = p_sr_id;
  IF v_vc_id IS NULL THEN
    RAISE EXCEPTION 'vt_not_initialized'; -- VT é criada pelo fluxo de pagamento de taxa fixa, não aqui
  END IF;

  UPDATE virtual_consultations
    SET status = 'awaiting_decision',
        proposed_at = NOW(),
        decision_deadline = NOW() + INTERVAL '48 hours',
        proposed_amount_cents = p_amount_cents,
        proposed_scope = p_scope,
        provider_id = auth.uid()
  WHERE id = v_vc_id;

  RETURN jsonb_build_object('ok', true, 'vc_id', v_vc_id, 'deadline', (SELECT decision_deadline FROM virtual_consultations WHERE id = v_vc_id));
END $$;

COMMIT;
```

### `src/app/api/services/[id]/proposal/route.ts` (PRESTADOR submete)
```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({ amount_cents: z.number().int().positive(), scope: z.string().min(20).max(2000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const body = Body.parse(await req.json());
  const { data, error } = await supabase.rpc('submit_proposal', { p_sr_id: id, p_amount_cents: body.amount_cents, p_scope: body.scope });
  if (error) return mapPgError(error);
  return NextResponse.json(data);
}
```

### `src/app/api/virtual-consultations/[id]/decide/route.ts` (CLIENTE)
```typescript
const Body = z.object({ decision: z.enum(['accepted','declined','revision']), reason: z.string().max(1000).optional() });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const body = Body.parse(await req.json());
  const { data, error } = await supabase.rpc('decide_proposal', { p_vc_id: id, p_decision: body.decision, p_revision_reason: body.reason });
  if (error) return mapPgError(error);
  return NextResponse.json(data);
}
```

## Constraints / NÃO fazer
- ❌ Atualizar `virtual_consultations` direto via UPDATE — sempre via RPC para transição atômica
- ❌ Permitir prestador decidir (RPC valida `auth.uid() = client_id`)
- ❌ Permitir cliente submeter proposta
- ❌ Aceitar `decision_deadline` do client — sempre cravado server-side
- ❌ Cobrar diferença direto neste endpoint — UI redireciona para T-076 (`is_difference: true`)

## Convenções
- RPC SECURITY DEFINER com check explícito de `auth.uid()` (defense-in-depth)
- Aceite **NÃO** dispara cobrança automaticamente; UI faz POST `/payment` com `is_difference: true` na sequência (UX explícita)
- Códigos de erro Postgres mapeados em `mapPgError` (42501 → 403, 42704 → 404, 22023 → 409)$desc$,
  'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION','RACE_CONDITION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── OPS ─────────

(
  'd5282a58-8f65-4f7b-b63b-39f449417fb4',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-080',
  'Configurar pg_cron job para expirar virtual_consultations não-decididas em 48h',
  $desc$## Objetivo
Job pg_cron que roda a cada 15min, identifica `virtual_consultations` com `status='awaiting_decision'` e `decision_deadline < NOW()`, atualiza para `expired` e dispara notificação. Cobre AC #13, #14 (perde taxa em silêncio).

## Contexto
Módulo SOLICITACAO. pg_cron já existe no Supabase (extensão habilitada). Job não pode chamar Edge Function direto — atualiza tabela e a Edge Function de notificação (US-022/US-024) consome via trigger ou pull.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_vt_expiry_job.sql`
```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION expire_virtual_consultations()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  WITH expired AS (
    UPDATE virtual_consultations
    SET status = 'expired', decision = 'expired', decided_at = NOW()
    WHERE status = 'awaiting_decision' AND decision_deadline < NOW()
    RETURNING id, service_request_id, client_id, provider_id
  )
  SELECT COUNT(*) INTO v_count FROM expired;
  RETURN v_count;
END $$;

-- Schedule a cada 15 min
SELECT cron.schedule(
  'expire_virtual_consultations',
  '*/15 * * * *',
  $$ SELECT expire_virtual_consultations(); $$
);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Disparar HTTP/Edge Function direto do cron (latência + ponto de falha) — usar trigger AFTER UPDATE em US-022/T-024
- ❌ Schedule mais agressivo que 1min (overhead pra MVP)
- ❌ Reprocessar linhas já em estado terminal

## Convenções
- Schedule cron via `cron.schedule(job_name, schedule, command)` — idempotente (DROP-CREATE no `--regen`)
- Função SECURITY DEFINER para garantir bypass RLS
- Notificação ao cliente sobre expiry vai via US-024 (mensageria) — não acoplar nesta task$desc$,
  'OPS', 'SISTEMA', ARRAY['NO_RLS_NEEDED'],
  'draft', 'chore',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── REALTIME ─────────

(
  '89eb970e-9e9f-421f-a50f-b972a15e48c8',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-081',
  'Configurar canal Realtime service:{id} para mudanças de pagamento e estado',
  $desc$## Objetivo
Canal Supabase Realtime que entrega ao cliente UPDATE em `service_requests` e `payments` do seu `service_request_id`. UI usa para: (1) detectar Pix pago e avançar para confirmação (AC #6), (2) escutar transições subsequentes (matching iniciado em AC #10). Cobre AC #6, parcial AC #10.

## Contexto
Módulo SOLICITACAO. Latência alvo <500ms entre UPDATE no banco e UI atualizar. RLS filtra automaticamente — cliente só recebe eventos da sua própria SR. Hook reusável `useServiceRealtime(serviceId)` consumido por T-083 (payment screen) e T-084 (confirmation screen).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/hooks/use-service-realtime.ts`
```typescript
'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

export function useServiceRealtime(serviceId: string) {
  const [serviceRequest, setServiceRequest] = useState<ServiceRequest | null>(null);
  const [latestPayment, setLatestPayment] = useState<Payment | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    const srChannel = supabase
      .channel(`service:${serviceId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests',
        filter: `id=eq.${serviceId}`,
      }, (payload) => setServiceRequest(payload.new as ServiceRequest))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'payments',
        filter: `service_request_id=eq.${serviceId}`,
      }, (payload) => setLatestPayment(payload.new as Payment))
      .subscribe();

    return () => { supabase.removeChannel(srChannel); };
  }, [serviceId]);

  return { serviceRequest, latestPayment };
}
```

### Habilitar Realtime nas tabelas
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE service_requests, payments;
```

### Fallback de polling
- Hook auxiliar `useServiceRealtimePolling(serviceId, 10000)` ativa quando `subscribe()` retorna `CHANNEL_ERROR` ou `TIMED_OUT`.

## Constraints / NÃO fazer
- ❌ Subscribe sem unsubscribe no unmount (memory leak)
- ❌ Listen a `payment_attempts` aqui (mais ruído que sinal — UI lê via fetch quando precisa)
- ❌ Confiar 100% em Realtime sem fallback (rede móvel)
- ❌ Mostrar payload bruto na UI sem checar tipos (assumir shape do `database.types.ts`)

## Convenções
- Canal nomeado `service:{id}` (consistência com US-005, US-012, US-013)
- RLS já filtra (canal sempre seguro mesmo se outro cliente tentar subscribe)
- Reconnect automático via cliente Supabase
- Polling fallback 10s$desc$,
  'REALTIME', 'CLIENTE', ARRAY['REALTIME_CHANNEL'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

-- ───────── UI ─────────

(
  '6325f1ba-b661-4b1a-ad10-8658f1336c9b',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-082',
  'Renderizar wizard /(client)/services/new (problema → endereço → data → resumo)',
  $desc$## Objetivo
Wizard multi-step para o cliente criar a solicitação: (1) descrição + fotos + complexidade, (2) escolher endereço (principal/alternativo/novo), (3) data/hora desejada, (4) resumo + breakdown de preço + aviso "prestador só recebe após assinatura digital" + botão para tela de pagamento. Cobre AC #1, #2, #3, #4, #9, #11, #12 (entrada VT), #15 da US-011.

## Contexto
Módulo SOLICITACAO. Entrypoint via `/(client)/services/new?subcat=<id>` (vindo de T-066/T-069). Step 1 valida fotos obrigatórias (≥1 via Storage upload signed URL). Step 4 chama T-074 (criar) → T-075 (quote) → exibe breakdown e CTA "Continuar para pagamento" → navega para T-083. Para subcat com `is_virtual_consultation=true`, o aviso de taxa fixa é destacado e o pagamento é da taxa fixa apenas.

## Estado atual / O que substitui
Não existe. Reusa `client_addresses` (US-009 T-046) e abre sheet de cadastro de endereço novo (a ser detalhado em US-014; aqui usa um sheet inline mínimo).

## O que criar

### `src/app/(client)/services/new/page.tsx` (Server Component shell)
```tsx
import { redirect } from 'next/navigation';
import { ServiceRequestWizard } from '@/components/services/ServiceRequestWizard';
import { getClientAddresses } from '@/lib/dal/addresses';
import { getCatalogSubcategory } from '@/lib/dal/catalog';

export default async function NewServicePage({ searchParams }: { searchParams: Promise<{ subcat?: string; reopen?: string; vt_policy?: string }> }) {
  const { subcat, reopen, vt_policy } = await searchParams;
  if (!subcat) redirect('/(public)/home');
  const subcategory = await getCatalogSubcategory(subcat);
  const addresses = await getClientAddresses();
  return <ServiceRequestWizard subcategory={subcategory} addresses={addresses} reopenFrom={reopen} vtPolicy={vt_policy} />;
}
```

### `src/components/services/ServiceRequestWizard.tsx`
```tsx
'use client';
import { useState } from 'react';
import { Field, FormBody } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Step } from './Step';
import { PhotoUploader } from './PhotoUploader';
import { AddressPicker } from './AddressPicker';
import { ScheduleStep } from './ScheduleStep';
import { ReviewStep } from './ReviewStep';
import { useRouter } from 'next/navigation';
import { fetchOrThrow } from '@/lib/utils/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';

const STEPS = ['problem','address','schedule','review'] as const;

export function ServiceRequestWizard({ subcategory, addresses, reopenFrom, vtPolicy }: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    description: '',
    photos: [] as string[],
    complexity: 'unknown' as 'low'|'medium'|'high'|'unknown',
    address_id: addresses.find(a => a.is_primary)?.id ?? addresses[0]?.id,
    scheduled_for: undefined as string | undefined,
  });
  const router = useRouter();

  const handleSubmit = async () => {
    try {
      const res = await fetchOrThrow('/api/services', {
        method: 'POST',
        body: JSON.stringify({
          subcategory_id: subcategory.id,
          ...data,
          reopen_from: reopenFrom,
          vt_policy_version: vtPolicy,
        }),
      });
      const sr = await res.json();
      // Quote (T-075) — gera estimate antes de mandar pra payment
      await fetchOrThrow(`/api/services/${sr.id}/quote`, { method: 'POST' });
      router.push(`/(client)/services/${sr.id}/payment`);
    } catch (e) {
      showErrorToast({ type: 'create_service' }, e);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <Stepper current={step} total={4} />
      {step === 0 && <Step.Problem data={data} onChange={setData} subcategory={subcategory} />}
      {step === 1 && <Step.Address data={data} onChange={setData} addresses={addresses} />}
      {step === 2 && <Step.Schedule data={data} onChange={setData} />}
      {step === 3 && <Step.Review data={data} subcategory={subcategory} onSubmit={handleSubmit} />}
      <Stepper.Nav step={step} total={4} onPrev={() => setStep(step - 1)} onNext={() => setStep(step + 1)} canNext={validateStep(step, data, subcategory)} />
    </main>
  );
}
```

### Step 4 — Review (highlight: aviso AC #9)
```tsx
<Card className="mt-4 border-amber-300 bg-amber-50 p-4">
  <p className="text-sm">
    <strong>Importante:</strong> o prestador só recebe o pagamento após você confirmar a finalização do serviço com sua assinatura digital.
  </p>
</Card>
```

### Aviso para visita técnica (AC #12)
```tsx
{subcategory.is_virtual_consultation && (
  <Card className="mt-4 border-blue-300 bg-blue-50 p-4">
    <p className="text-sm">
      Você está solicitando uma <strong>visita técnica</strong>. A taxa de R$ {(vtPolicy.fixed_fee_cents/100).toFixed(2)} será cobrada agora e abatida integralmente do valor total se você contratar a execução após o diagnóstico.
    </p>
  </Card>
)}
```

### `src/components/services/PhotoUploader.tsx`
- Usa Storage signed URLs; mostra preview, permite excluir, aceita até 8 fotos
- Mínimo 1 foto (validação client + server)

## Constraints / NÃO fazer
- ❌ `<input>` cru — usar `Field` compound API
- ❌ react-hook-form — `useState` direto (memory `project_ui_patterns`)
- ❌ Validação Zod no client — só servidor (T-074)
- ❌ Persistir draft local (localStorage) — chamada de criação cria server-side a partir do step 4
- ❌ `<Dialog>` cru para "endereço novo" — usar `ResponsiveSheet`
- ❌ Pular step de fotos — fotos são obrigatórias (mín. 1)
- ❌ Mostrar preço no step 1/2/3 — só no review (após quote)

## Convenções
- Reuso: `Field`, `FormBody`, `Button`, `Card`, `ResponsiveSheet` (endereço novo), `Sonner` (erro)
- Mobile-first: full-width, stepper no topo, CTA fixo no rodapé
- Photos enviadas para `service-photos/<user_id>/temp/<uuid>/` antes do criar; após criar SR, mover para `service-photos/<user_id>/<sr_id>/` (Storage move via API)$desc$,
  'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST','A11Y_REVIEW'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '21542a3d-ff1a-4230-8b7e-b72065072b03',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-083',
  'Renderizar tela /(client)/services/[id]/payment (cartão + Pix com QR/copia-cola/expiry/retry)',
  $desc$## Objetivo
Tela de pagamento: tabs Cartão/Pix, breakdown do valor (lê de `service_request_estimates`), botão "Pagar". Cartão: form com Mercado Pago SDK gerando token, mostra mensagem de recusa amigável, permite retentar. Pix: gera QR, copia-cola, contador regressivo; permite gerar novo se expirar. Realtime escuta `payments` para detectar pago. Cobre AC #4, #5, #6, #7, #8, #9 (reforço), #12 da US-011.

## Contexto
Módulo SOLICITACAO. Vinda de T-082 com `service_request.id` na URL. Lê SR + estimate via Server Component, hidrata client component. Para VT, cobra apenas fixed_fee. Para diferença (vindo de T-085 aceite proposta), é redirecionada com `?diff=true`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(client)/services/[id]/payment/page.tsx`
```tsx
import { getServiceRequest, getEstimate } from '@/lib/dal/services';
import { PaymentScreen } from '@/components/services/PaymentScreen';

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ diff?: string }> }) {
  const { id } = await params;
  const { diff } = await searchParams;
  const [sr, estimate] = await Promise.all([getServiceRequest(id), getEstimate(id)]);
  return <PaymentScreen sr={sr} estimate={estimate} mode={diff ? 'difference' : (sr.is_virtual_consultation ? 'visita_tecnica' : 'full')} />;
}
```

### `src/components/services/PaymentScreen.tsx`
```tsx
'use client';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CardForm } from './CardForm';
import { PixPanel } from './PixPanel';
import { PriceBreakdown } from './PriceBreakdown';
import { useServiceRealtime } from '@/hooks/use-service-realtime';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function PaymentScreen({ sr, estimate, mode }: Props) {
  const [method, setMethod] = useState<'credit_card'|'pix'>('credit_card');
  const { latestPayment, serviceRequest } = useServiceRealtime(sr.id);
  const router = useRouter();

  useEffect(() => {
    if (latestPayment?.status === 'captured') {
      router.push(`/(client)/services/${sr.id}/confirmation`);
    }
  }, [latestPayment]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold">Pagamento</h1>
      <PriceBreakdown estimate={estimate} mode={mode} className="mt-4" />
      <Card className="mt-4 border-amber-300 bg-amber-50 p-3 text-sm">
        O prestador só recebe após sua confirmação com assinatura digital.
      </Card>
      <Tabs value={method} onValueChange={v => setMethod(v as any)} className="mt-6">
        <TabsList>
          <TabsTrigger value="credit_card">Cartão de crédito</TabsTrigger>
          <TabsTrigger value="pix">Pix</TabsTrigger>
        </TabsList>
        <TabsContent value="credit_card">
          <CardForm srId={sr.id} mode={mode} />
        </TabsContent>
        <TabsContent value="pix">
          <PixPanel srId={sr.id} mode={mode} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
```

### `src/components/services/CardForm.tsx`
- Usa Mercado Pago JS SDK (cardForm constructor) gerando `cardToken`
- Submit chama `POST /api/services/[id]/payment` com Idempotency-Key gerado a cada tentativa
- Em recusa: mostra mensagem em alert inline (`<Card>` warning) com CTA "Tentar com outro cartão" — limpa form preservando os outros dados do step (state separado)
- Após 4 recusas: mostra "Tente Pix" e troca tab automaticamente

### `src/components/services/PixPanel.tsx`
- Botão "Gerar Pix" → `POST /api/services/[id]/pix`
- Mostra QR (img base64), copia-cola com botão de copiar
- Contador regressivo (exp_at - NOW)
- Botão "Gerar novo Pix" quando contador zera (chama T-077 com nova Idempotency-Key)
- Listen via Realtime → status `captured` redireciona para confirmação

## Constraints / NÃO fazer
- ❌ Submeter número/CVV pro próprio backend (sempre via cardForm MP gerando token)
- ❌ Persistir Idempotency-Key entre tentativas (gerar nova a cada submit)
- ❌ Chamar mp.js a partir de `'use server'` (browser-only)
- ❌ Mostrar mensagem MP cru — usar `mapMpFailure` (T-076 retorna `message`)
- ❌ Bloquear UI durante fetch — manter Pix QR clicável

## Convenções
- Reuso: `Tabs` (precisa adicionar ao design system se não existir; senão usar segmented buttons), `Card`, `Button`, `Input`, `Sonner`, `useServiceRealtime` (T-081)
- Mobile-first: tabs ocupam topo; QR ocupa centro
- Idempotency-Key gerado via `crypto.randomUUID()` no client
- Aviso de assinatura digital sempre visível (AC #9 reforço)
- VT mode: somente fixed_fee no breakdown; banner explicando abatimento$desc$,
  'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  '682f02e9-4249-4279-9223-48993b5a4747',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-084',
  'Renderizar /(client)/services/[id]/confirmation (matching iniciado + ETA + próximos passos)',
  $desc$## Objetivo
Tela pós-pagamento: confirma que a busca por prestador iniciou, mostra ETA estimado para esta categoria/horário (lido de `matching_eta_estimates_v` em T-073), lista os próximos passos da jornada (matching → aceite → deslocamento → execução → assinatura) e oferece botão "Acompanhar serviço" que leva à tela de tracking (US-012). Cobre AC #10, #11.

## Contexto
Módulo SOLICITACAO. Vinda de T-083 após Realtime detectar pagamento `captured` e SR transicionar para `queued`. Server Component faz fetch único de SR + ETA + próximos passos.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(client)/services/[id]/confirmation/page.tsx`
```tsx
import { getServiceRequest } from '@/lib/dal/services';
import { getMatchingEta } from '@/lib/dal/matching';
import { ConfirmationScreen } from '@/components/services/ConfirmationScreen';

export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sr = await getServiceRequest(id);
  const eta = await getMatchingEta(sr.category_id, new Date(sr.scheduled_for ?? Date.now()).getHours());
  return <ConfirmationScreen sr={sr} eta={eta} />;
}
```

### `src/components/services/ConfirmationScreen.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Search, UserCheck, Truck, Wrench, FileSignature } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useServiceRealtime } from '@/hooks/use-service-realtime';
import { formatEta } from '@/lib/format';

const STEPS = [
  { icon: Search,        label: 'Buscando prestador disponível' },
  { icon: UserCheck,     label: 'Aguardando aceite' },
  { icon: Truck,         label: 'Em deslocamento' },
  { icon: Wrench,        label: 'Em execução' },
  { icon: FileSignature, label: 'Sua assinatura digital' },
];

export function ConfirmationScreen({ sr, eta }: Props) {
  const router = useRouter();
  const { serviceRequest } = useServiceRealtime(sr.id);
  const status = serviceRequest?.status ?? sr.status;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <Card className="border-emerald-300 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
        <h1 className="mt-3 text-xl font-semibold">Pagamento confirmado</h1>
        <p className="mt-1 text-sm">
          Já estamos buscando um prestador disponível.
          {eta?.avg_seconds && ` Tempo médio para esta categoria: ~${formatEta(eta.avg_seconds)}.`}
        </p>
      </Card>

      <h2 className="mt-6 text-base font-medium">Próximos passos</h2>
      <ul className="mt-3 space-y-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={i} className="flex items-center gap-3">
              <Icon className="size-5 text-muted-foreground" />
              <span className="text-sm">{s.label}</span>
            </li>
          );
        })}
      </ul>

      <Button className="mt-8 w-full" onClick={() => router.push(`/(client)/services/${sr.id}`)}>
        Acompanhar serviço
      </Button>
    </main>
  );
}
```

### `src/lib/format.ts` (extensão `formatEta`)
- "<60s → menos de 1 min", "<3600s → ~X min", ">3600s → ~X h"

## Constraints / NÃO fazer
- ❌ Mostrar dados do prestador aqui (ainda não tem prestador alocado)
- ❌ Mostrar "Em execução" como ativo aqui — todos os steps são "futuros"
- ❌ Polling em loop (basta o Realtime via useServiceRealtime detectar transição `queued → matched`)
- ❌ Iframe de mapa (US-012 cuida da tela de tracking)

## Convenções
- Reuso: `Card`, `Button`, `useServiceRealtime` (T-081), `lucide-react` icons
- ETA pode ser `null` — UI mostra mensagem genérica
- Step ativo (sublinhado) reflete o `status` atual via Realtime
- Mobile-first; CTA fixo no fundo se vp baixo$desc$,
  'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
),

(
  'ebdbb87e-e54b-404b-9ca9-0f524978b6c1',
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
  '3a6c27ae-b5a1-48c6-8a21-53b564f97e68',
  'ZLAR-V2-T-085',
  'Renderizar tela /(client)/services/[id]/proposal (aceitar/recusar/revisar VT)',
  $desc$## Objetivo
Tela exibida quando `virtual_consultations.status='awaiting_decision'`: cliente vê escopo proposto + valor + tempo restante (decision_deadline) e tem 3 ações: aceitar (leva pra pagar diferença), recusar (perde taxa, pode reabrir nova solicitação), pedir revisão (volta para o prestador com motivo). Cobre AC #13, #14, #15.

## Contexto
Módulo SOLICITACAO. Vinda de notificação push (US-024) ou via tracking. Mostra contador regressivo. Aceitar redireciona para `/(client)/services/[id]/payment?diff=true`. Recusar abre `ConfirmDialog` com aviso. Após decisão final, mostra estado "decidido" + CTA "Reabrir solicitação" (AC #15) se status `expired` ou `declined`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(client)/services/[id]/proposal/page.tsx`
```tsx
import { getServiceRequest, getVirtualConsultation } from '@/lib/dal/services';
import { ProposalScreen } from '@/components/services/ProposalScreen';

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sr, vc] = await Promise.all([getServiceRequest(id), getVirtualConsultation(id)]);
  return <ProposalScreen sr={sr} vc={vc} />;
}
```

### `src/components/services/ProposalScreen.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCountdown } from '@/hooks/use-countdown';
import { fetchOrThrow } from '@/lib/utils/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';

export function ProposalScreen({ sr, vc }: Props) {
  const router = useRouter();
  const { display: timeLeft, expired } = useCountdown(vc.decision_deadline);
  const [revOpen, setRevOpen] = useState(false);
  const [revReason, setRevReason] = useState('');
  const [confirmDecline, setConfirmDecline] = useState<null | { onConfirm: () => Promise<void> }>(null);

  if (vc.status === 'expired' || vc.status === 'declined') {
    return (
      <NotEffectiveScreen vc={vc} sr={sr} onReopen={() => router.push(`/(public)/catalog/${sr.category.slug}`)} />
    );
  }

  const decide = async (decision: 'accepted'|'declined'|'revision', reason?: string) => {
    try {
      await fetchOrThrow(`/api/virtual-consultations/${vc.id}/decide`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
      if (decision === 'accepted') {
        router.push(`/(client)/services/${sr.id}/payment?diff=true`);
      } else {
        router.refresh();
      }
    } catch (e) {
      showErrorToast({ type: 'decide_proposal' }, e);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold">Proposta do prestador</h1>
      <Card className="mt-4 p-4">
        <p className="text-sm font-medium">Tempo restante: {timeLeft}</p>
        <h2 className="mt-3 text-base font-medium">Escopo proposto</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">{vc.proposed_scope}</p>
        <p className="mt-3 text-base">Valor: <strong>R$ {(vc.proposed_amount_cents/100).toFixed(2)}</strong></p>
        <p className="mt-1 text-xs text-muted-foreground">
          A taxa de visita técnica que você já pagou (R$ {(vc.vt_amount_cents/100).toFixed(2)}) será abatida do valor total.
        </p>
      </Card>

      <div className="mt-6 flex flex-col gap-3">
        <Button onClick={() => decide('accepted')} disabled={expired}>Aceitar e pagar diferença</Button>
        <Button variant="outline" onClick={() => setRevOpen(true)} disabled={expired}>Pedir revisão</Button>
        <Button variant="destructive" onClick={() => setConfirmDecline({ onConfirm: () => decide('declined') })} disabled={expired}>Recusar</Button>
      </div>

      <ResponsiveDialog open={revOpen} onOpenChange={setRevOpen}>
        <ResponsiveDialog.Header>Pedir revisão da proposta</ResponsiveDialog.Header>
        <ResponsiveDialog.Body>
          <FormBody>
            <Field name="reason" required>
              <Field.Label>Motivo</Field.Label>
              <Field.Control>
                <Textarea value={revReason} onChange={e => setRevReason(e.target.value)} placeholder="Explique o que você gostaria de revisar" />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="ghost" onClick={() => setRevOpen(false)}>Cancelar</Button>
          <Button onClick={() => { decide('revision', revReason); setRevOpen(false); }}>Enviar revisão</Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>

      <ConfirmDialog
        state={confirmDecline ? {
          title: 'Recusar proposta?',
          description: 'Ao recusar, a taxa de visita técnica não será reembolsada. Você poderá abrir uma nova solicitação a qualquer momento.',
          confirmLabel: 'Recusar',
          destructive: true,
          onConfirm: async () => { await confirmDecline.onConfirm(); setConfirmDecline(null); },
        } : null}
        onClose={() => setConfirmDecline(null)}
      />
    </main>
  );
}
```

### `src/hooks/use-countdown.ts`
- Atualiza display a cada 1s; emite `expired=true` quando deadline < NOW
- Cleanup interval no unmount

## Constraints / NÃO fazer
- ❌ `window.confirm` — usar `ConfirmDialog` do design system
- ❌ Permitir aceitar/recusar/revisar quando `expired=true` (botões disabled)
- ❌ Mostrar valores totais sem contexto de abatimento (UX confusa)
- ❌ Permitir editar texto da proposta (read-only para cliente)
- ❌ "Reabrir" criar SR novo aqui — apenas redirecionar para `/(public)/catalog/<cat>` (T-082 cuida do reopen via `?reopen=<old_sr_id>`)

## Convenções
- Reuso: `Card`, `Button`, `Field`, `Textarea`, `ResponsiveDialog`, `ConfirmDialog`, `useCountdown` (novo hook), `fetchOrThrow`, `showErrorToast`
- Mobile-first; CTAs verticais
- Aviso de não-reembolso destacado em recusa (AC #14)
- "Reabrir solicitação" leva ao catálogo da categoria com `?reopen=<sr.id>` (AC #15) — tela de aviso de não-garantia em T-082$desc$,
  'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()
);

-- =============================================================================
-- 2. Vínculos task → AC-da-Story
-- =============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-070 service_requests
  ('0db58807-4ce6-4253-b2a9-e24e4575f096'::uuid, 1),
  ('0db58807-4ce6-4253-b2a9-e24e4575f096'::uuid, 2),
  ('0db58807-4ce6-4253-b2a9-e24e4575f096'::uuid, 15),
  -- T-071 payments+pix
  ('82182a9d-e5ae-46b2-aad4-e37dc5d759a5'::uuid, 5),
  ('82182a9d-e5ae-46b2-aad4-e37dc5d759a5'::uuid, 6),
  ('82182a9d-e5ae-46b2-aad4-e37dc5d759a5'::uuid, 7),
  ('82182a9d-e5ae-46b2-aad4-e37dc5d759a5'::uuid, 8),
  ('82182a9d-e5ae-46b2-aad4-e37dc5d759a5'::uuid, 14),
  -- T-072 virtual_consultations
  ('38dd2639-832a-49a9-973d-52a708ff597f'::uuid, 12),
  ('38dd2639-832a-49a9-973d-52a708ff597f'::uuid, 13),
  ('38dd2639-832a-49a9-973d-52a708ff597f'::uuid, 14),
  -- T-073 estimates
  ('ac7a472b-23e3-46ff-b278-6f09c4fdbf09'::uuid, 3),
  ('ac7a472b-23e3-46ff-b278-6f09c4fdbf09'::uuid, 4),
  ('ac7a472b-23e3-46ff-b278-6f09c4fdbf09'::uuid, 10),
  -- T-074 POST /api/services
  ('2bfe95ca-70fb-4a78-b769-58c9fbbae451'::uuid, 1),
  ('2bfe95ca-70fb-4a78-b769-58c9fbbae451'::uuid, 2),
  ('2bfe95ca-70fb-4a78-b769-58c9fbbae451'::uuid, 10),
  ('2bfe95ca-70fb-4a78-b769-58c9fbbae451'::uuid, 11),
  ('2bfe95ca-70fb-4a78-b769-58c9fbbae451'::uuid, 15),
  -- T-075 quote
  ('107f0539-de57-4a7a-b609-bcc0d9e360b1'::uuid, 3),
  ('107f0539-de57-4a7a-b609-bcc0d9e360b1'::uuid, 4),
  -- T-076 cartão
  ('e03bfd36-d7b6-410d-ae08-eb07f2681fff'::uuid, 5),
  ('e03bfd36-d7b6-410d-ae08-eb07f2681fff'::uuid, 7),
  ('e03bfd36-d7b6-410d-ae08-eb07f2681fff'::uuid, 12),
  ('e03bfd36-d7b6-410d-ae08-eb07f2681fff'::uuid, 14),
  -- T-077 pix
  ('7c448703-b7b7-4f27-bdb8-4f1118c53793'::uuid, 5),
  ('7c448703-b7b7-4f27-bdb8-4f1118c53793'::uuid, 6),
  ('7c448703-b7b7-4f27-bdb8-4f1118c53793'::uuid, 8),
  -- T-078 webhook MP
  ('14fc6ec7-71c6-443f-aa5e-7c8175c394c0'::uuid, 5),
  ('14fc6ec7-71c6-443f-aa5e-7c8175c394c0'::uuid, 6),
  -- T-079 proposal endpoints
  ('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830'::uuid, 13),
  ('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830'::uuid, 14),
  -- T-080 cron expirar
  ('d5282a58-8f65-4f7b-b63b-39f449417fb4'::uuid, 13),
  ('d5282a58-8f65-4f7b-b63b-39f449417fb4'::uuid, 14),
  -- T-081 realtime
  ('89eb970e-9e9f-421f-a50f-b972a15e48c8'::uuid, 6),
  ('89eb970e-9e9f-421f-a50f-b972a15e48c8'::uuid, 10),
  -- T-082 wizard
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 1),
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 2),
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 3),
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 4),
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 9),
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 12),
  ('6325f1ba-b661-4b1a-ad10-8658f1336c9b'::uuid, 15),
  -- T-083 payment screen
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 4),
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 5),
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 6),
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 7),
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 8),
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 9),
  ('21542a3d-ff1a-4230-8b7e-b72065072b03'::uuid, 12),
  -- T-084 confirmation screen
  ('682f02e9-4249-4279-9223-48993b5a4747'::uuid, 10),
  ('682f02e9-4249-4279-9223-48993b5a4747'::uuid, 11),
  -- T-085 proposal screen
  ('ebdbb87e-e54b-404b-9ca9-0f524978b6c1'::uuid, 13),
  ('ebdbb87e-e54b-404b-9ca9-0f524978b6c1'::uuid, 14),
  ('ebdbb87e-e54b-404b-9ca9-0f524978b6c1'::uuid, 15)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =============================================================================
-- 3. AC-da-Task (checklist técnico)
-- =============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
-- T-070
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'Enum service_status criado com 10 valores; payment_method com 2', 1),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'Tabela service_requests criada com FKs (auth.users, service_categories, service_subcategories, client_addresses)', 2),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'CHECK photos >=1 falha em INSERT com photos=[] e status<>draft', 3),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'RLS: cliente A não lê SR do cliente B (smoke 2 JWTs)', 4),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'CLIENTE consegue UPDATE somente se status in (draft,awaiting_payment,queued,cancelled,reopened_after_vt)', 5),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'PRESTADOR alocado lê e UPDATE quando status in (matched,in_progress,awaiting_signature)', 6),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'ADMIN via claim app_metadata.role=admin lê tudo', 7),
('0db58807-4ce6-4253-b2a9-e24e4575f096', 'Trigger updatedAt funciona em UPDATE', 8),

-- T-071
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'Migration aplicada; enum payment_status criado', 0),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'Tabelas payments, pix_codes, payment_attempts criadas com FKs corretas', 1),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'idempotency_key UNIQUE garantido (smoke: INSERT duplicado retorna 23505)', 2),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'Índice único parcial impede 2 pix ativos no mesmo payment (smoke)', 3),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'CLIENTE lê apenas seus payments e pix_codes (RLS)', 4),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'CLIENTE NÃO consegue UPDATE em payments (apenas service role)', 5),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'payment_attempts visível apenas para admin (RLS)', 6),
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'CHECK: apenas um de used_at OU invalidated_at em pix_codes', 7),

-- T-072
('38dd2639-832a-49a9-973d-52a708ff597f', 'Migration aplicada; enum proposal_status criado', 0),
('38dd2639-832a-49a9-973d-52a708ff597f', 'Tabela virtual_consultations + proposal_revisions criadas', 1),
('38dd2639-832a-49a9-973d-52a708ff597f', 'UNIQUE(service_request_id) impede 2 VC ativas para mesma SR', 2),
('38dd2639-832a-49a9-973d-52a708ff597f', 'CLIENTE e PRESTADOR alocado leem própria VC; outros não (RLS)', 3),
('38dd2639-832a-49a9-973d-52a708ff597f', 'proposal_revisions imutável (sem UPDATE/DELETE policy)', 4),
('38dd2639-832a-49a9-973d-52a708ff597f', 'Índice (status, decision_deadline) presente para job de expiração eficiente', 5),

-- T-073
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'Migration aplicada; database.types.ts regenerado', 0),
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'service_request_estimates criada com colunas STORED para totais', 1),
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'CHECK service_max >= service_min', 2),
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'matching_eta_samples + view matching_eta_estimates_v criadas', 3),
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'View grant SELECT para anon e authenticated (consumida pela tela de confirmação)', 4),
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'matching_eta_samples NÃO expõe linha bruta (RLS USING false)', 5),
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'CLIENTE lê apenas estimates do próprio service_request (RLS)', 6),

-- T-074
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'POST /api/services valida body com Zod (400 em formato inválido)', 0),
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', '401 quando user não autenticado', 1),
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'is_virtual_consultation copiado da subcat na criação (snapshot)', 2),
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'reopen_from preenchido cria SR com status reopened_after_vt e ref ao SR original', 3),
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'Storage bucket service-photos com policies por folder = user_id (smoke: cliente A não lê pasta cliente B)', 4),
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'Resposta 201 com { id, status, is_virtual_consultation }', 5),
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'Subcategoria inválida retorna 400 invalid_subcategory', 6),

-- T-075
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'POST /api/services/[id]/quote retorna estimate com service_min, service_max, travel_fee, platform_fee, total', 0),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'Aplica coeficiente de complexidade (low 0.85, medium 1.0, high 1.3)', 1),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'Visita técnica retorna fixed_fee de app_config.public:visita_tecnica.fixed_fee_cents', 2),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'Persiste em service_request_estimates (UPSERT por inputs_hash)', 3),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'Denormaliza totais em service_requests (service_cents, travel_fee_cents, platform_fee_cents, total_cents)', 4),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'Chamadas idempotentes: mesmo input → mesmo inputs_hash → mesma estimate', 5),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'inputs_hash NÃO exposto na resposta', 6),

-- T-076
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Idempotency-Key obrigatório (400 sem header)', 0),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Mesmo Idempotency-Key 2x retorna replay (sem duplicar payment)', 1),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', '401 sem auth; valida body Zod (400 em invalid)', 2),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Captura Mercado Pago bem-sucedida → payments.status=captured + service_requests.status=queued', 3),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Recusa retorna 402 com message amigável (mapMpFailure aplicado)', 4),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Cada tentativa registra linha em payment_attempts (auditoria)', 5),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Após 4 tentativas: payments.status=failed; resposta sugere trocar para Pix', 6),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'is_visita_tecnica usa fixed_fee; is_difference calcula diferença com VT já paga', 7),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'Retentar não dispara transição service_requests.status (só captura final)', 8),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'MERCADOPAGO_ACCESS_TOKEN lido server-side (nunca exposto via NEXT_PUBLIC_*)', 9),

-- T-077
('7c448703-b7b7-4f27-bdb8-4f1118c53793', 'POST /api/services/[id]/pix retorna { qr_code_b64, copy_paste, expires_at }', 0),
('7c448703-b7b7-4f27-bdb8-4f1118c53793', 'Idempotency-Key obrigatório', 1),
('7c448703-b7b7-4f27-bdb8-4f1118c53793', 'Regenerar invalida pix anterior (invalidated_at) e cria novo (smoke: 2x cria 2 pix_codes mas só 1 ativo)', 2),
('7c448703-b7b7-4f27-bdb8-4f1118c53793', 'expires_at = NOW + 30min cravado server-side', 3),
('7c448703-b7b7-4f27-bdb8-4f1118c53793', 'Aceita is_visita_tecnica e is_difference para definir amount', 4),
('7c448703-b7b7-4f27-bdb8-4f1118c53793', 'NÃO marca payments.status=captured aqui (só webhook)', 5),

-- T-078
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Webhook valida assinatura HMAC-SHA256 com MERCADOPAGO_WEBHOOK_SECRET (401 em mismatch)', 0),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Localiza payment via mp_payment_id ou external_reference (id interno)', 1),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Mapeia mp.status → payments.status (approved→captured, refunded→refunded, rejected→failed, cancelled→expired)', 2),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Idempotente: receber mesma notificação 2x não duplica efeito', 3),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Pagamento principal capturado dispara service_requests.status=queued', 4),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'is_visita_tecnica/is_difference NÃO disparam transição automática', 5),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Cada notificação registra linha em payment_attempts (audit trail)', 6),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Sempre retorna 200 (MP só retenta em 5xx)', 7),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'Service role bypass RLS via createAdminClient', 8),

-- T-079
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'RPC submit_proposal valida provider_id == auth.uid (forbidden 403)', 0),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'submit_proposal seta proposed_at + decision_deadline = +48h server-side', 1),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'RPC decide_proposal valida client_id == auth.uid (forbidden 403)', 2),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'decide_proposal rejeita decision quando status != awaiting_decision (409)', 3),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'decide_proposal expira automático se NOW > decision_deadline', 4),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'Decision revision cria linha em proposal_revisions e volta status para awaiting_diagnosis', 5),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'Endpoints validam body Zod (400) e mapeiam erros PG para HTTP', 6),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'FOR UPDATE no SELECT inicial impede race em duplo click', 7),

-- T-080
('d5282a58-8f65-4f7b-b63b-39f449417fb4', 'Migration aplicada; pg_cron habilitado; função expire_virtual_consultations criada', 0),
('d5282a58-8f65-4f7b-b63b-39f449417fb4', 'cron.schedule registra job a cada 15min (verificável via SELECT * FROM cron.job)', 1),
('d5282a58-8f65-4f7b-b63b-39f449417fb4', 'Função SECURITY DEFINER bypassa RLS', 2),
('d5282a58-8f65-4f7b-b63b-39f449417fb4', 'Smoke test: VC com decision_deadline no passado vira expired após executar a função manualmente', 3),
('d5282a58-8f65-4f7b-b63b-39f449417fb4', 'Função idempotente: rodar 2x não muda nada se nenhuma VC nova expirou', 4),

-- T-081
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'Tabelas service_requests e payments adicionadas à supabase_realtime publication', 0),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'Hook useServiceRealtime subscreve canal service:{id} no mount', 1),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'Unsubscribe no unmount (sem leak)', 2),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'UPDATE no DB chega na UI em <500ms (medido)', 3),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'RLS impede que outro cliente ouça canal alheio (smoke 2 JWTs)', 4),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'Fallback de polling 10s ativa em CHANNEL_ERROR/TIMED_OUT', 5),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', 'Reconnect automático testado após perda de rede', 6),

-- T-082
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Wizard renderiza 4 steps: problema, endereço, data, review', 0),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Step 1: descrição (10-4000) + fotos (≥1, max 8) + complexidade obrigatórios', 1),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Step 2: endereço principal pré-selecionado; CTA "Cadastrar novo" abre ResponsiveSheet', 2),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Step 3: campo data/hora opcional via Input type="datetime-local"', 3),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Step 4: Review chama POST /api/services + POST /api/services/[id]/quote', 4),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Card amarelo com aviso "prestador só recebe após assinatura digital" (AC #9)', 5),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Para subcat is_virtual_consultation: card azul com aviso de taxa fixa + abatimento (AC #12)', 6),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Reopen_from query param: passa para POST /api/services e exibe aviso "valor e disponibilidade não garantidos"', 7),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Fotos enviadas via Storage signed URL antes de submit; mín 1 enforced no client + server', 8),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Reusa Field/FormBody/Button/Card/ResponsiveSheet/Sonner', 9),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'Após submit bem-sucedido, redireciona para /(client)/services/[id]/payment', 10),

-- T-083
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Tabs Cartão/Pix renderizadas; default cartão', 0),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Breakdown (servico, travel_fee, platform_fee, total) lido de service_request_estimates', 1),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Cartão: form com cardForm MP gera token; submit chama /api/services/[id]/payment com Idempotency-Key novo', 2),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Recusa: mostra mensagem amigável em alert inline; CTA "Tentar com outro cartão" preserva form', 3),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Após 4 recusas: trocar tab para Pix com mensagem', 4),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Pix: botão "Gerar Pix" chama /api/services/[id]/pix', 5),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Pix: mostra QR (img base64), copia-cola com botão de copiar, contador regressivo de tempo', 6),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Pix expirado: CTA "Gerar novo Pix" com nova Idempotency-Key', 7),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Realtime detecta payments.status=captured e redireciona para /confirmation', 8),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Aviso de assinatura digital sempre visível (AC #9)', 9),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Modo VT: breakdown mostra apenas fixed_fee + banner explicando abatimento', 10),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'Modo difference: breakdown mostra valor proposto - vt_paid', 11),

-- T-084
('682f02e9-4249-4279-9223-48993b5a4747', 'Página renderiza ícone de check verde + "Pagamento confirmado"', 0),
('682f02e9-4249-4279-9223-48993b5a4747', 'ETA exibido a partir de matching_eta_estimates_v (formato "~X min")', 1),
('682f02e9-4249-4279-9223-48993b5a4747', 'ETA ausente (sample_size baixo) mostra mensagem genérica sem ETA', 2),
('682f02e9-4249-4279-9223-48993b5a4747', 'Lista 5 próximos passos com ícones lucide-react', 3),
('682f02e9-4249-4279-9223-48993b5a4747', 'Realtime detecta status transitar de queued → matched (ou outros) e atualiza step ativo', 4),
('682f02e9-4249-4279-9223-48993b5a4747', 'CTA "Acompanhar serviço" navega para /(client)/services/[id] (tracking US-012)', 5),

-- T-085
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Tela renderiza escopo + valor + tempo restante (countdown)', 0),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Status awaiting_decision: 3 CTAs (aceitar, pedir revisão, recusar)', 1),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Aceitar redireciona para /(client)/services/[id]/payment?diff=true', 2),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Recusar abre ConfirmDialog destrutivo (não window.confirm)', 3),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Recusar exibe aviso de não-reembolso da taxa de visita técnica (AC #14)', 4),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Pedir revisão abre ResponsiveDialog com Field/Textarea para motivo', 5),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Status declined/expired: tela mostra estado final + CTA "Reabrir solicitação" leva ao catálogo com ?reopen=<sr.id> (AC #15)', 6),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'expired (countdown <= 0): todos os botões disabled', 7),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'Erros via showErrorToast (sem alert nativo)', 8);

-- =============================================================================
-- 4. Dependências
-- =============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- DATA → DATA: payments precisa do enum + service_requests
('82182a9d-e5ae-46b2-aad4-e37dc5d759a5', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
-- VC precisa de SR + payments
('38dd2639-832a-49a9-973d-52a708ff597f', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
('38dd2639-832a-49a9-973d-52a708ff597f', '82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'blocks'),
-- estimates precisa de SR
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
-- API → DATA
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
('107f0539-de57-4a7a-b609-bcc0d9e360b1', 'ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'blocks'),
('e03bfd36-d7b6-410d-ae08-eb07f2681fff', '82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'blocks'),
('7c448703-b7b7-4f27-bdb8-4f1118c53793', '82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'blocks'),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', '82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'blocks'),
('14fc6ec7-71c6-443f-aa5e-7c8175c394c0', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
('b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', '38dd2639-832a-49a9-973d-52a708ff597f', 'blocks'),
-- OPS → DATA
('d5282a58-8f65-4f7b-b63b-39f449417fb4', '38dd2639-832a-49a9-973d-52a708ff597f', 'blocks'),
-- REALTIME → DATA
('89eb970e-9e9f-421f-a50f-b972a15e48c8', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'blocks'),
('89eb970e-9e9f-421f-a50f-b972a15e48c8', '82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'blocks'),
-- UI → API/REALTIME
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', '2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'blocks'),
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', '107f0539-de57-4a7a-b609-bcc0d9e360b1', 'blocks'),
('21542a3d-ff1a-4230-8b7e-b72065072b03', 'e03bfd36-d7b6-410d-ae08-eb07f2681fff', 'blocks'),
('21542a3d-ff1a-4230-8b7e-b72065072b03', '7c448703-b7b7-4f27-bdb8-4f1118c53793', 'blocks'),
('21542a3d-ff1a-4230-8b7e-b72065072b03', '89eb970e-9e9f-421f-a50f-b972a15e48c8', 'blocks'),
('682f02e9-4249-4279-9223-48993b5a4747', 'ac7a472b-23e3-46ff-b278-6f09c4fdbf09', 'blocks'),
('682f02e9-4249-4279-9223-48993b5a4747', '89eb970e-9e9f-421f-a50f-b972a15e48c8', 'blocks'),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'b18bbdca-57f4-4eff-b5bf-ef80e3f2e830', 'blocks'),
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', '38dd2639-832a-49a9-973d-52a708ff597f', 'blocks'),
-- Cross-US: client_addresses (T-046) é dependência
('2bfe95ca-70fb-4a78-b769-58c9fbbae451', 'c63111bd-2964-4b5d-ad61-3d33778c65df', 'relates_to'),  -- T-046
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'c63111bd-2964-4b5d-ad61-3d33778c65df', 'relates_to'),  -- T-046
-- T-082 substitui home placeholder (T-058 reuso) e relaciona com proxy (T-063)
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'cef3e9a3-7124-4a6a-a05a-5d97d3726ec3', 'relates_to'),  -- T-063 (proxy /(public))
-- T-073 (estimates) relates_to T-064 (visita técnica config)
('ac7a472b-23e3-46ff-b278-6f09c4fdbf09', '70c81687-43c2-4d0f-acd7-d66c67dbd5a4', 'relates_to'),  -- T-064
-- T-085 relates_to T-082 (reopen)
('ebdbb87e-e54b-404b-9ca9-0f524978b6c1', '6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'relates_to'),
-- T-082 reabre em catálogo (US-010 T-066)
('6325f1ba-b661-4b1a-ad10-8658f1336c9b', 'b0133286-95f8-4c4d-af3f-841ba70bb95c', 'relates_to');

COMMIT;
