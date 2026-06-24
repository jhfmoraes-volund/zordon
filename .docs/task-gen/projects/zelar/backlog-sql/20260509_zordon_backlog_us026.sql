-- Backlog cards no Zordon — ZLAR-V2-US-026 (SUPORTE / ADMIN)
-- Resolver disputas com decisao financeira e auditoria
--
-- INSERT em tabelas internas do Zordon. Snippets DDL nas descriptions são spec
-- pra implementação futura no banco do produto Zelar.
--
-- Story: 234d937a-7fbe-49b3-a482-310223efc904
-- Persona principal: ADMIN (também SISTEMA para escalation/notif/financeiro)
-- AC count: 11
-- Tasks: 13 (DATA:3 API:7 UI:2 OPS:1)
-- Reuse base: support_tickets (T-125 estendida em T-136 com kind genérico),
--             support_ticket_messages (T-137), support_ticket_events (T-138),
--             provider_payouts (T-124, US-028 — débito por estorno),
--             payments (T-071, US-011 — gateway de estorno),
--             service_requests (T-070, US-011 — flags retrabalho/disputa)

BEGIN;

-- ============================================================
-- T-146 [DATA] — view dispute_queue_v com flag de padrão recorrente
-- ============================================================
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES
('64303dcf-c386-4f13-8c8e-34b4b6c44a3b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-146',
 'Criar view dispute_queue_v com priorização por status, idade e flag recorrência',
$desc$## Objetivo
View de leitura `dispute_queue_v` que projeta disputas (`support_tickets` com
`kind='dispute'`) ordenadas para a fila admin: pendentes primeiro (open,
awaiting_provider, awaiting_response, in_review), por idade, com flag booleano
`recurring_pattern` (true se requester abriu 3+ disputas nos últimos 30d). Cobre
AC #1 (fila priorizada por status e tempo desde abertura) e AC #7 (flag
"padrão recorrente" para 3+ disputas em 30 dias).

## Contexto
Módulo SUPORTE — consumido por T-148 (GET list) e indiretamente por T-156 (UI
lista). Padrão `<entidade>_queue_v` similar ao `provider_onboarding_state` view
(T-014, US-002) ou `provider_wallet_summary_v` (T-124, US-028) — view materializada
não é necessária pelo volume MVP esperado; view comum basta.

## Estado atual / O que substitui
Não existe. `support_tickets` já tem `kind` e `admin_status` (de T-125 e T-136).
Disputas serão escritas com `kind='dispute'` e usarão colunas adicionais de T-147.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_dispute_queue_view.sql`
```sql
BEGIN;

CREATE OR REPLACE VIEW dispute_queue_v AS
WITH requester_disputes_30d AS (
  SELECT requester_id, COUNT(*) AS disputes_30d
  FROM support_tickets
  WHERE kind = 'dispute'
    AND "createdAt" > NOW() - INTERVAL '30 days'
  GROUP BY requester_id
)
SELECT
  st.id,
  st.requester_id,
  st.service_request_id,
  st.admin_status,
  st."createdAt",
  st.assigned_admin_id,
  -- Subkind disputa: dispute_status (definido em T-147)
  (st.payload->>'dispute_status')::text AS dispute_status,
  (st.payload->>'reason_code')::text AS reason_code,
  (st.payload->>'requested_outcome')::text AS requested_outcome,
  COALESCE(rd.disputes_30d, 0) AS disputes_30d,
  COALESCE(rd.disputes_30d, 0) >= 3 AS recurring_pattern,
  -- Prioridade ordenável: status pendente primeiro, depois idade
  CASE
    WHEN st.admin_status = 'open' THEN 0
    WHEN (st.payload->>'dispute_status') = 'awaiting_provider' THEN 1
    WHEN (st.payload->>'dispute_status') = 'awaiting_response' THEN 2
    WHEN st.admin_status = 'in_review' THEN 3
    WHEN st.admin_status = 'resolved' THEN 4
    ELSE 5
  END AS priority_bucket,
  EXTRACT(EPOCH FROM (NOW() - st."createdAt")) / 3600 AS age_hours
FROM support_tickets st
LEFT JOIN requester_disputes_30d rd ON rd.requester_id = st.requester_id
WHERE st.kind = 'dispute';

-- View herda RLS da tabela base (support_tickets) por padrão em Postgres 16
-- Verificar com SET ROLE; admins via claim veem tudo.

COMMIT;
```

## Constraints / NÃO fazer
- ❌ NÃO criar materialized view (volume MVP baixo; refresh complica)
- ❌ NÃO embutir filtros de tipo do reclamante na view (UI/API filtram)
- ❌ NÃO depender de `service_requests` aqui (JOIN fica em T-149 detail; queue só ordena)
- ❌ NÃO calcular SLA aqui (helper client-side T-145 reusado)

## Convenções
- `recurring_pattern` lookback fixo de 30 dias (configurável depois via app_config se necessário; default fixo no MVP)
- `priority_bucket` numérico facilita ORDER BY composto na API
- View comum (não materialized) — refresh seria ainda mais complexo que recomputar
$desc$,
 'DATA', 'ANY',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-147 [DATA] — Estender support_tickets para disputa + tabelas auxiliares
-- ============================================================
('a65eee93-852d-4954-9fa2-3c14c4437986',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-147',
 'Estender support_tickets para disputa + criar dispute_evidences + dispute_appeals + bad_faith counter',
$desc$## Objetivo
Adicionar suporte a `kind='dispute'` em `support_tickets` (CHECK condicional
para campos obrigatórios da disputa) e criar tabelas auxiliares específicas:
`dispute_evidences` (anexos de ambas partes), `dispute_appeals` (recursos pós-
decisão), e contador `bad_faith_count` no perfil do requester. Cobre AC #2
(evidências), AC #5 (má-fé com contador na ficha), AC #8 (recursos), AC #9
(dívida residual de estorno parcial).

## Contexto
Módulo SUPORTE — fundação de dados das disputas. Depende de T-136 (support_tickets
genérico) e T-070 (service_requests). Consumido por T-148, T-149, T-150, T-152,
T-154. Mantém estratégia multi-kind: campos extras de disputa em colunas
nullable + CHECK condicional + payload jsonb pra metadata leve (status,
reason_code, requested_outcome).

## Estado atual / O que substitui
`support_tickets` existe mas só com `kind` + colunas genéricas (T-136). Falta
suporte específico de disputa. `client_profiles`/`provider_profiles` existem
sem contador `bad_faith_count`.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_disputes_schema.sql`
```sql
BEGIN;

-- Adicionar 'dispute' ao kind permitido (constraint atualizada)
-- Atualizar CHECK existente em support_tickets.kind:
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_kind_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_kind_check
  CHECK (kind IN ('early_payout', 'general_support', 'dispute'));

-- Enum de outcome de disputa
CREATE TYPE dispute_outcome AS ENUM (
  'favor_client',          -- estorno integral ao cliente
  'favor_provider',        -- mantém repasse ao prestador
  'partial_split',         -- divisão parcial
  'rework_mediated',       -- retrabalho mediado
  'bad_faith'              -- requester de má-fé
);

CREATE TYPE dispute_status AS ENUM (
  'open',
  'awaiting_provider',     -- aguardando resposta do outro lado
  'awaiting_response',     -- aguardando evidência adicional do solicitante
  'in_review',             -- admin analisando
  'decided',               -- decisão tomada
  'rework_pending',        -- retrabalho aceito, aguarda execução
  'rework_escalated',      -- prestador não respondeu em 24h, realocação
  'closed'                 -- finalizada (após decisão + execução financeira)
);

-- Colunas de disputa em support_tickets (todas nullable, CHECK condicional)
ALTER TABLE support_tickets
  ADD COLUMN dispute_status dispute_status NULL,
  ADD COLUMN dispute_outcome dispute_outcome NULL,
  ADD COLUMN dispute_decided_at timestamptz NULL,
  ADD COLUMN dispute_decided_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN dispute_other_party_id uuid NULL REFERENCES auth.users(id),
  ADD COLUMN dispute_refund_amount_cents integer NULL,
  ADD COLUMN dispute_refund_debt_cents integer NULL DEFAULT 0;

ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_dispute_required
  CHECK (
    (kind = 'dispute' AND dispute_status IS NOT NULL AND service_request_id IS NOT NULL AND dispute_other_party_id IS NOT NULL)
    OR
    kind != 'dispute'
  );

-- Index para queue
CREATE INDEX idx_support_tickets_dispute_queue
  ON support_tickets (dispute_status, "createdAt" DESC)
  WHERE kind = 'dispute' AND dispute_status NOT IN ('closed','decided');

-- Tabela de evidências (fotos/texto de ambas partes + admin requests)
CREATE TYPE dispute_evidence_role AS ENUM (
  'requester_initial',     -- evidência que abriu a disputa
  'other_party_response',  -- resposta do outro lado
  'requester_followup',    -- evidência adicional solicitada
  'admin_note'             -- nota interna do admin
);

CREATE TABLE dispute_evidences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  uploader_id     uuid NOT NULL REFERENCES auth.users(id),
  role            dispute_evidence_role NOT NULL,
  body            text NULL,
  attachments     jsonb NULL, -- [{ url, filename, mime, size }]
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispute_evidences_dispute_created
  ON dispute_evidences (dispute_id, "createdAt");

ALTER TABLE dispute_evidences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "involved_parties_read" ON dispute_evidences FOR SELECT
  USING (
    dispute_id IN (
      SELECT id FROM support_tickets
      WHERE requester_id = auth.uid() OR dispute_other_party_id = auth.uid()
    )
    AND role != 'admin_note'
  );

CREATE POLICY "involved_parties_insert" ON dispute_evidences FOR INSERT
  WITH CHECK (
    uploader_id = auth.uid()
    AND role IN ('requester_initial','other_party_response','requester_followup')
    AND dispute_id IN (
      SELECT id FROM support_tickets
      WHERE requester_id = auth.uid() OR dispute_other_party_id = auth.uid()
    )
  );

CREATE POLICY "admin_all" ON dispute_evidences FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Tabela de recursos (appeals) pós-decisão
CREATE TYPE dispute_appeal_status AS ENUM ('submitted','under_review','rejected','accepted_reopened');

CREATE TABLE dispute_appeals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  appellant_id    uuid NOT NULL REFERENCES auth.users(id),
  justification   text NOT NULL CHECK (length(justification) BETWEEN 30 AND 3000),
  new_evidence    jsonb NULL, -- [{ url, filename, mime, size }]
  status          dispute_appeal_status NOT NULL DEFAULT 'submitted',
  reviewed_by     uuid NULL REFERENCES auth.users(id),
  reviewed_at     timestamptz NULL,
  review_note     text NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispute_appeals_dispute ON dispute_appeals (dispute_id, "createdAt" DESC);

ALTER TABLE dispute_appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appellant_read_own" ON dispute_appeals FOR SELECT
  USING (appellant_id = auth.uid());

CREATE POLICY "appellant_insert_own" ON dispute_appeals FOR INSERT
  WITH CHECK (
    appellant_id = auth.uid()
    AND dispute_id IN (
      SELECT id FROM support_tickets
      WHERE (requester_id = auth.uid() OR dispute_other_party_id = auth.uid())
        AND dispute_status = 'decided'
    )
  );

CREATE POLICY "admin_all_appeals" ON dispute_appeals FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Contador de má-fé em ambos os perfis
ALTER TABLE client_profiles ADD COLUMN bad_faith_count integer NOT NULL DEFAULT 0;
ALTER TABLE provider_profiles ADD COLUMN bad_faith_count integer NOT NULL DEFAULT 0;

-- Estender service_requests com flags retrabalho/disputa (ou confirmar se já existe; T-130 menciona)
-- Se ainda não há colunas:
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS has_active_dispute boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_rework boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_service_requests_active_dispute
  ON service_requests (has_active_dispute) WHERE has_active_dispute = true;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ NÃO criar tabela `disputes` separada (multi-kind em support_tickets é a estratégia)
- ❌ NÃO armazenar valores monetários em real (use cents integer; padrão Zelar)
- ❌ NÃO permitir UPDATE/DELETE direto em dispute_evidences (imutável; sem policy de update)
- ❌ NÃO fazer DROP CASCADE em colunas existentes; só ADD COLUMN
- ❌ NÃO permitir bad_faith_count negativo (CHECK implícito por NOT NULL DEFAULT 0; reforçar com CHECK >= 0 se necessário)

## Convenções
- Aspas duplas em "createdAt"/"updatedAt"
- Enums em snake_case
- Money em cents integer
- Migration via psql; database.types.ts regenerado
- bad_faith_count incrementado **apenas** via RPC decide_dispute (T-150) com outcome='bad_faith'
$desc$,
 'DATA', 'ANY',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-148 [API] — GET /api/admin/disputes (lista priorizada)
-- ============================================================
('5a3d724e-d12b-418f-8212-3bcb2e65ac73',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-148',
 'Implementar GET /api/admin/disputes (lista priorizada com flag recorrente e cursor)',
$desc$## Objetivo
Endpoint admin que lista disputas via `dispute_queue_v` (T-146), com filtros
por `dispute_status`, `recurring_pattern`, busca por requester/protocolo,
ordenação composta (priority_bucket ASC, age_hours DESC) e cursor pagination.
Cobre AC #1 (fila separada de suporte geral, priorizada) e AC #7 (flag
"padrão recorrente" 3+ em 30d) e AC #11 (paginação).

## Contexto
Módulo SUPORTE — consumido por T-156 (UI lista). Endpoint **separado** de
`/api/admin/support/tickets` (T-139) para refletir AC #1 (fila distinta).
Compartilha helper `requireAdmin`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/disputes/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';

const Query = z.object({
  dispute_status: z.enum(['open','awaiting_provider','awaiting_response','in_review','decided','rework_pending','rework_escalated','closed']).optional(),
  recurring_only: z.coerce.boolean().optional(),
  q: z.string().max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const params = Query.parse(Object.fromEntries(url.searchParams));
  const supabase = await createClient();

  let query = supabase
    .from('dispute_queue_v')
    .select('*', { count: 'exact' })
    .order('priority_bucket', { ascending: true })
    .order('createdAt', { ascending: false })
    .limit(params.limit + 1);

  if (params.dispute_status) query = query.eq('dispute_status', params.dispute_status);
  if (params.recurring_only) query = query.eq('recurring_pattern', true);

  if (params.cursor) {
    // cursor codifica (priority_bucket, createdAt)
    const [bucket, ts] = Buffer.from(params.cursor, 'base64').toString('utf8').split('|');
    // cursor pagination composto: WHERE (priority_bucket, createdAt) > (...)
    // Implementar via RPC ou multi-condição; abaixo simplificado:
    query = query.or(`priority_bucket.gt.${bucket},and(priority_bucket.eq.${bucket},createdAt.lt.${ts})`);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).slice(0, params.limit);
  const nextCursor = (data?.length ?? 0) > params.limit
    ? Buffer.from(`${items.at(-1).priority_bucket}|${items.at(-1).createdAt}`).toString('base64')
    : null;

  return Response.json({ items, nextCursor });
}
```

## Constraints / NÃO fazer
- ❌ NÃO duplicar `/api/admin/support/tickets` filtrando por kind=dispute (UX requer rota separada por AC #1)
- ❌ NÃO retornar evidências/appeals na list (vai em detail T-149)
- ❌ NÃO usar OFFSET pagination
- ❌ NÃO confiar em filtro client para auth — endpoint admin-only
- ❌ NÃO retornar disputes com kind != 'dispute' (view já filtra)

## Convenções
- Cursor pagination composto (priority_bucket, createdAt)
- Filtros `recurring_only` e `dispute_status` no query string
- Ordenação default: priority ASC + idade DESC (mais antigas primeiro dentro do mesmo bucket)
$desc$,
 'API', 'ADMIN',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-149 [API] — GET /api/admin/disputes/[id] (detalhe completo)
-- ============================================================
('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-149',
 'Implementar GET /api/admin/disputes/[id] (detalhe + evidências + chat + timeline + service)',
$desc$## Objetivo
Endpoint admin que retorna detalhe completo de uma disputa: ticket + serviço
relacionado + ambas as partes (cliente e prestador) + evidências (T-147) +
mensagens internas (T-137 reusando) + eventos (T-138 reusando) + protocolo
fotográfico do serviço + histórico do chat cliente↔prestador (mensagens da
US-025 conversation, ler quando existir) + appeals existentes (T-147) +
contador bad_faith de cada parte. Cobre AC #2 (detalhe rico).

## Contexto
Módulo SUPORTE — consumido por T-157 (UI sheet). Reuso pesado: aproveita
`support_ticket_messages` (T-137) e `support_ticket_events` (T-138) — não
cria tabelas novas pra timeline. Chat cliente↔prestador vive em `messages`
(US-025) — endpoint só inclui se a tabela existir; senão retorna empty array
(MVP graceful degradation).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/disputes/[id]/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await requireAdmin();
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', params.id)
    .eq('kind', 'dispute')
    .single();
  if (error || !ticket) return Response.json({ error: 'not_found' }, { status: 404 });

  // Serviço relacionado (incluindo fotos do protocolo)
  const { data: serviceRequest } = await supabase
    .from('service_requests')
    .select('id, status, scheduled_at, problem_summary, problem_photos, '
          + 'completion_photos, client_id, provider_id, total_cents, has_rework')
    .eq('id', ticket.service_request_id)
    .single();

  // Cliente e prestador (perfis curtos)
  const [{ data: client }, { data: provider }] = await Promise.all([
    supabase.from('client_profiles')
      .select('user_id, display_name, phone, avatar_url, bad_faith_count')
      .eq('user_id', serviceRequest?.client_id).maybeSingle(),
    supabase.from('provider_profiles')
      .select('user_id, display_name, phone, avatar_url, bad_faith_count')
      .eq('user_id', serviceRequest?.provider_id).maybeSingle(),
  ]);

  // Evidências
  const { data: evidences } = await supabase
    .from('dispute_evidences')
    .select('*')
    .eq('dispute_id', params.id)
    .order('createdAt', { ascending: true });

  // Mensagens (admin notes)
  const { data: messages } = await supabase
    .from('support_ticket_messages')
    .select('*')
    .eq('ticket_id', params.id)
    .order('createdAt', { ascending: true });

  // Eventos (timeline)
  const { data: events } = await supabase
    .from('support_ticket_events')
    .select('*')
    .eq('ticket_id', params.id)
    .order('createdAt', { ascending: false });

  // Chat cliente↔prestador (se messages tabela existe)
  let chatHistory = [];
  if (serviceRequest?.id) {
    const { data: chat } = await supabase
      .from('messages')
      .select('id, sender_id, body, "createdAt"')
      .eq('service_request_id', serviceRequest.id)
      .order('createdAt', { ascending: true })
      .limit(200);
    chatHistory = chat ?? [];
  }

  // Appeals
  const { data: appeals } = await supabase
    .from('dispute_appeals')
    .select('*')
    .eq('dispute_id', params.id)
    .order('createdAt', { ascending: false });

  return Response.json({
    ticket, serviceRequest, client, provider,
    evidences, messages, events, chatHistory, appeals,
  });
}
```

## Constraints / NÃO fazer
- ❌ NÃO retornar mensagens de chat se o admin não tem permissão (RLS já filtra; mas explicitar via service role caso necessário pra audit)
- ❌ NÃO truncar evidências (admin precisa do conteúdo completo)
- ❌ NÃO incluir payouts/payments aqui (vai em T-150 quando decisão calcular)
- ❌ NÃO usar single() onde maybeSingle() é apropriado (evita 500 se profile não existe)
- ❌ NÃO assumir que `messages` (US-025) já existe — graceful degradation

## Convenções
- Endpoint admin-only
- 404 quando ticket não é disputa
- Ordem das mensagens/evidências cronológica ASC; eventos DESC
- Inclui bad_faith_count de ambas partes (suporta exibição na UI conforme AC #5/#7)
$desc$,
 'API', 'ADMIN',
 ARRAY['RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-150 [API] — POST decide RPC (decisão + execução financeira)
-- ============================================================
('f3ce7a49-de44-47da-bc91-bfd4f51d532d',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-150',
 'Implementar RPC decide_dispute + POST /api/admin/disputes/[id]/decide (execução financeira)',
$desc$## Objetivo
RPC e endpoint que registram decisão formal da disputa com outcome, justificativa
obrigatória, valor de estorno (quando aplicável) e disparam execução financeira
**atomicamente**: estorno integral / parcial / manutenção / retrabalho mediado /
má-fé. Inclui lógica de **estorno parcial automático com saldo devedor** (AC #9):
se carteira do prestador (T-124 provider_payouts) não tem saldo suficiente,
debita o disponível e grava `dispute_refund_debt_cents` que será descontado
de payouts futuros. Cobre AC #3 (decisão + outcome + execução automática + notif),
AC #4 (retrabalho mediado disparado), AC #5 (má-fé incrementa contador),
AC #9 (estorno parcial com dívida residual), AC #10 (registro auditável via T-155).

## Contexto
Módulo SUPORTE — depende de T-147 (schema), T-155 (audit log), T-124
(provider_payouts), T-071 (payments para chamar gateway de estorno),
T-151 (notif), T-153 (escalation rework). Consumido por T-157 (UI sheet ação).

Padrão: endpoint chama RPC SECURITY DEFINER que faz tudo em transação;
chamadas externas (gateway de estorno via Mercado Pago, T-071) são enfileiradas
**após** RPC sucesso (não bloqueia, gateway retry idempotente).

## Estado atual / O que substitui
Não existe.

## O que criar

### RPC `decide_dispute`
```sql
-- supabase/migrations/<YYYYMMDD>_zelar_v2_decide_dispute_rpc.sql
CREATE OR REPLACE FUNCTION decide_dispute(
  p_dispute_id uuid,
  p_outcome dispute_outcome,
  p_justification text,
  p_admin_id uuid,
  p_refund_amount_cents integer DEFAULT 0,  -- usado em favor_client e partial_split
  p_idempotency_key text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket support_tickets%ROWTYPE;
  v_service service_requests%ROWTYPE;
  v_provider_balance integer;
  v_actual_refund integer;
  v_refund_debt integer := 0;
BEGIN
  IF length(coalesce(p_justification,'')) < 30 THEN
    RAISE EXCEPTION 'justification_too_short' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: se idempotency_key já decidiu, retorna mesmo resultado
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM 1 FROM dispute_decisions
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT json_build_object('status','already_decided','dispute_id',p_dispute_id) INTO v_actual_refund;
      RETURN v_actual_refund::json;
    END IF;
  END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_dispute_id AND kind = 'dispute' FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'dispute_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_ticket.dispute_status IN ('decided','closed','rework_pending') THEN
    RAISE EXCEPTION 'already_decided' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_service FROM service_requests WHERE id = v_ticket.service_request_id;

  -- Lógica financeira por outcome
  CASE p_outcome
    WHEN 'favor_client' THEN
      v_actual_refund := v_service.total_cents;
    WHEN 'partial_split' THEN
      v_actual_refund := p_refund_amount_cents;
    WHEN 'rework_mediated' THEN
      v_actual_refund := 0;  -- sem estorno; provider tem 24h pra aceitar
    WHEN 'favor_provider' THEN
      v_actual_refund := 0;
    WHEN 'bad_faith' THEN
      v_actual_refund := 0;
      -- Incrementar contador no perfil do requester
      IF v_ticket.requester_id = v_service.client_id THEN
        UPDATE client_profiles SET bad_faith_count = bad_faith_count + 1
          WHERE user_id = v_ticket.requester_id;
      ELSE
        UPDATE provider_profiles SET bad_faith_count = bad_faith_count + 1
          WHERE user_id = v_ticket.requester_id;
      END IF;
  END CASE;

  -- Se há estorno: verificar saldo do prestador (T-124 provider_payouts)
  IF v_actual_refund > 0 THEN
    SELECT COALESCE(SUM(amount_cents),0) INTO v_provider_balance
      FROM provider_payouts
      WHERE provider_id = v_service.provider_id AND status = 'available';

    IF v_provider_balance < v_actual_refund THEN
      v_refund_debt := v_actual_refund - v_provider_balance;
      v_actual_refund := v_provider_balance;
    END IF;

    -- Debita do payout (lança refund -negativo)
    INSERT INTO provider_payouts (provider_id, service_request_id, amount_cents, status, kind)
    VALUES (v_service.provider_id, v_service.id, -v_actual_refund, 'released', 'dispute_refund');
  END IF;

  -- Atualiza disputa
  UPDATE support_tickets SET
    dispute_outcome = p_outcome,
    dispute_status = CASE p_outcome
                       WHEN 'rework_mediated' THEN 'rework_pending'::dispute_status
                       ELSE 'decided'::dispute_status
                     END,
    dispute_decided_at = NOW(),
    dispute_decided_by = p_admin_id,
    dispute_refund_amount_cents = v_actual_refund,
    dispute_refund_debt_cents = v_refund_debt,
    admin_status = 'resolved',
    "updatedAt" = NOW()
  WHERE id = p_dispute_id;

  -- Atualizar flags em service_requests
  UPDATE service_requests SET
    has_active_dispute = false,
    has_rework = (p_outcome = 'rework_mediated'),
    "updatedAt" = NOW()
  WHERE id = v_service.id;

  -- Audit log imutável
  INSERT INTO dispute_decisions
    (dispute_id, decided_by, outcome, justification, refund_amount_cents,
     refund_debt_cents, idempotency_key, snapshot)
  VALUES
    (p_dispute_id, p_admin_id, p_outcome, p_justification, v_actual_refund,
     v_refund_debt, p_idempotency_key, row_to_json(v_ticket)::jsonb);

  -- Eventos
  INSERT INTO support_ticket_events (ticket_id, kind, actor_id, actor_role, payload)
  VALUES (p_dispute_id, 'status_changed', p_admin_id, 'admin',
          jsonb_build_object('outcome', p_outcome, 'refund_cents', v_actual_refund, 'debt_cents', v_refund_debt));

  RETURN json_build_object(
    'dispute_id', p_dispute_id,
    'outcome', p_outcome,
    'refund_amount_cents', v_actual_refund,
    'refund_debt_cents', v_refund_debt
  );
END $$;
```

### `src/app/api/admin/disputes/[id]/decide/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { enqueueGatewayRefund } from '@/lib/payments/queue';
import { enqueueNotification } from '@/lib/notifications/queue';

const Body = z.object({
  outcome: z.enum(['favor_client','favor_provider','partial_split','rework_mediated','bad_faith']),
  justification: z.string().min(30).max(3000),
  refund_amount_cents: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const adminUser = await requireAdmin();
  const idempotencyKey = req.headers.get('idempotency-key');
  if (!idempotencyKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());

  if (body.outcome === 'partial_split' && !body.refund_amount_cents) {
    return Response.json({ error: 'refund_amount_required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decide_dispute', {
    p_dispute_id: params.id,
    p_outcome: body.outcome,
    p_justification: body.justification,
    p_admin_id: adminUser.id,
    p_refund_amount_cents: body.refund_amount_cents ?? 0,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    if (error.code === 'P0001') return Response.json({ error: 'invalid_input' }, { status: 400 });
    if (error.code === 'P0002') return Response.json({ error: 'not_found' }, { status: 404 });
    if (error.code === 'P0003') return Response.json({ error: 'already_decided' }, { status: 409 });
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Enfileira chamada ao gateway (Mercado Pago refund) — não bloqueia
  if (data.refund_amount_cents > 0) {
    await enqueueGatewayRefund({ dispute_id: params.id, amount_cents: data.refund_amount_cents });
  }
  // Notifica ambas partes
  await enqueueNotification({ kind: 'dispute_decided', dispute_id: params.id, outcome: body.outcome });

  return Response.json(data);
}
```

## Constraints / NÃO fazer
- ❌ NÃO chamar gateway dentro da RPC (sync, lento, falha cascateia)
- ❌ NÃO permitir decisão sem justificativa de 30 chars (validação Zod + RPC)
- ❌ NÃO permitir partial_split sem refund_amount_cents
- ❌ NÃO atualizar bad_faith_count fora da RPC (atomicidade)
- ❌ NÃO criar payment refund row direto — sempre via gateway queue (T-071 owner)
- ❌ NÃO permitir decidir disputa já decidida (409)
- ❌ NÃO registrar audit log fora da transação (atomicidade)

## Convenções
- Idempotency-Key obrigatório
- Money em cents integer
- RPC SECURITY DEFINER + FOR UPDATE
- Erros HTTP: 400 (validação/refund_amount), 404 (not_found), 409 (already_decided)
- Notificação enfileirada (NOTIFICACAO module via T-151)
$desc$,
 'API', 'ADMIN',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION','IDEMPOTENCY_KEY','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-151 [API] — Notificar partes em decisão de disputa
-- ============================================================
('2fcec385-daab-42cc-b78f-c4e582ac2512',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-151',
 'Notificar ambas partes (canal externo) na decisão da disputa',
$desc$## Objetivo
Disparar notificações ao cliente e ao prestador quando uma disputa é decidida,
com mensagens diferenciadas conforme outcome (favorável a você / contrário /
parcial / retrabalho mediado / má-fé). Cobre parte de AC #3 (notifica ambas
partes ao registrar decisão).

## Contexto
Módulo SUPORTE consumindo NOTIFICACAO. Padrão idêntico a T-142 (notif support
ticket) e T-042 (notif suspension). Templates novos: `dispute_decided` com
variantes por outcome.

## Estado atual / O que substitui
Não existe template `dispute_decided`. Helper `enqueueNotification` já estendido
em T-142 com kind support_ticket_status_changed; aqui adiciona kind
`dispute_decided`.

## O que criar

### Estender `src/lib/notifications/queue.ts`
```typescript
type Payload =
  | { kind: 'dispute_decided'; dispute_id: string; outcome: string }
  | { kind: 'dispute_evidence_requested'; dispute_id: string; deadline_at: string }
  | { kind: 'dispute_rework_assigned'; dispute_id: string; provider_id: string; deadline_at: string }
  | { kind: 'dispute_appeal_resolved'; dispute_id: string; appeal_status: string }
  | ...; // outros já existentes
```

### Templates no worker NOTIFICACAO
- `dispute_decided` com 5 variantes:
  - cliente lado:
    - favor_client: "Disputa resolvida a seu favor. Estorno de R$X processado."
    - favor_provider: "Disputa decidida. Repasse mantido ao prestador. Veja detalhes em <link>."
    - partial_split: "Disputa resolvida com divisão parcial. Estorno parcial de R$X processado."
    - rework_mediated: "Disputa resultou em retrabalho mediado. O prestador tem 24h pra confirmar."
    - bad_faith: (somente para o requester se for cliente) "Disputa marcada como improcedente. Ver fundamento em <link>."
  - prestador lado: variantes simétricas
- Idempotência: dedup por (dispute_id, outcome, recipient_id)

## Constraints / NÃO fazer
- ❌ NÃO incluir valores em centavos no push (use formatBRL)
- ❌ NÃO enviar push pra usuário má-fé acusando — neutro ("disputa resolvida")
- ❌ NÃO bloquear o decide endpoint se enqueue falhar (try/catch + log)
- ❌ NÃO duplicar push se decide é re-chamado com mesma idempotency_key

## Convenções
- Reuso da fila `notification_queue`
- 2 destinatários por evento (cliente + prestador)
- Push respeita preferência de canal (web push / email / WhatsApp)
$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-152 [API] — POST request-evidence (48h prazo)
-- ============================================================
('eb02dcf0-f32b-40cf-8074-ce1427feeb8e',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-152',
 'Implementar POST /api/admin/disputes/[id]/request-evidence (48h prazo)',
$desc$## Objetivo
Endpoint admin que solicita evidências adicionais ao requester com prazo de 48h
(configurável via app_config T-158), transita disputa para
`awaiting_response`, registra evento em `support_ticket_events` e dispara
notificação. Cobre AC #6 (admin solicita evidências adicionais quando faltam
dados; solicitante recebe notificação com prazo de 48h).

## Contexto
Módulo SUPORTE — depende de T-147 (schema disputa), T-138 (events), T-151
(notif). Consumido por T-157 (UI sheet ação). Após 48h sem resposta, admin
pode decidir com o que tem (não há job auto que decide; só registra que prazo
expirou — admin decide manualmente).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/disputes/[id]/request-evidence/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { enqueueNotification } from '@/lib/notifications/queue';

const Body = z.object({
  ask_message: z.string().min(10).max(2000),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const adminUser = await requireAdmin();
  const body = Body.parse(await req.json());
  const supabase = await createClient();

  // Lê config de prazo (default 48h)
  const { data: cfg } = await supabase.from('app_config')
    .select('value').eq('key','dispute_evidence_deadline_hours').maybeSingle();
  const deadlineHours = cfg ? Number(cfg.value) : 48;
  const deadlineAt = new Date(Date.now() + deadlineHours * 36e5).toISOString();

  // Atualiza disputa + registra evento (atomicidade via RPC simples)
  const { error: updErr } = await supabase
    .from('support_tickets')
    .update({
      dispute_status: 'awaiting_response',
      payload: supabase.raw(`payload || jsonb_build_object('evidence_request', jsonb_build_object('asked_by', '${adminUser.id}', 'asked_at', NOW(), 'deadline_at', '${deadlineAt}', 'message', '${body.ask_message.replace(/'/g, "''")}'))`),
      "updatedAt": new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('kind', 'dispute');
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

  await supabase.from('support_ticket_events').insert({
    ticket_id: params.id,
    kind: 'status_changed',
    actor_id: adminUser.id,
    actor_role: 'admin',
    payload: { evidence_requested: true, deadline_at: deadlineAt, message: body.ask_message },
  });

  await enqueueNotification({
    kind: 'dispute_evidence_requested',
    dispute_id: params.id,
    deadline_at: deadlineAt,
  });

  return Response.json({ deadline_at: deadlineAt });
}
```

## Constraints / NÃO fazer
- ❌ NÃO usar string concat pra payload jsonb — preferir RPC dedicado se houver complexidade (mas aqui é simples; `supabase.raw` ok com sanitização)
- ❌ NÃO bloquear pedido se já há outro evidence_request pendente (admin pode reiterar)
- ❌ NÃO permitir requester abrir essa rota (admin only)
- ❌ NÃO enviar prazo no passado (validar)
- ❌ NÃO transicionar pra awaiting_response se já em decided/closed

## Convenções
- Prazo via app_config (T-158)
- Notif ao requester com link curto
- Evento registrado em support_ticket_events
$desc$,
 'API', 'ADMIN',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-153 [API] — Edge Function rework_escalation (24h sem aceite)
-- ============================================================
('69c28bee-9742-4c73-b825-7fd92dd0bbdd',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-153',
 'Implementar Edge Function dispute_rework_escalation (realocação após 24h sem aceite)',
$desc$## Objetivo
Edge Function disparada por pg_cron (T-158) que varre disputas em
`dispute_status=rework_pending` há mais de 24h, transita para
`rework_escalated`, **realoca** o serviço para outro prestador via dispatch
para módulo MATCHING e **desconta a comissão do repasse original** do prestador
faltoso (registra ajuste em provider_payouts T-124). Cobre AC #4 (sem resposta
do prestador em 24h, Zelar realoca e desconta a comissão do repasse original).

## Contexto
Módulo SUPORTE — depende de T-147 (dispute_status), T-124 (provider_payouts),
módulo MATCHING (broadcast/realocação — assumido em outra US). Padrão idêntico
ao Edge Function `release-escrow-payouts` (T-127, US-028) e jobs de
`agenda-reminders` (T-118, US-027).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/functions/dispute-rework-escalation/index.ts`
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Busca disputas em rework_pending há mais de 24h sem confirmação
  const { data: stale } = await supabase
    .from('support_tickets')
    .select('id, service_request_id, payload')
    .eq('kind', 'dispute')
    .eq('dispute_status', 'rework_pending')
    .lt('updatedAt', new Date(Date.now() - 24 * 36e5).toISOString());

  for (const dispute of stale ?? []) {
    // Chama RPC pra atomic escalate
    const { error } = await supabase.rpc('escalate_dispute_rework', { p_dispute_id: dispute.id });
    if (error) {
      console.error('Failed to escalate', dispute.id, error);
      continue;
    }
    // Dispatch para MATCHING (realocação)
    await fetch(`${Deno.env.get('NEXT_PUBLIC_SITE_URL')}/api/matching/realocate`, {
      method: 'POST',
      body: JSON.stringify({ service_request_id: dispute.service_request_id, reason: 'rework_no_response' }),
    });
  }

  return new Response(JSON.stringify({ processed: stale?.length ?? 0 }));
});
```

### RPC `escalate_dispute_rework`
```sql
CREATE OR REPLACE FUNCTION escalate_dispute_rework(p_dispute_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dispute support_tickets%ROWTYPE;
  v_service service_requests%ROWTYPE;
  v_commission_cents integer;
BEGIN
  SELECT * INTO v_dispute FROM support_tickets WHERE id = p_dispute_id FOR UPDATE;
  IF v_dispute.dispute_status != 'rework_pending' THEN
    RETURN; -- idempotente
  END IF;

  SELECT * INTO v_service FROM service_requests WHERE id = v_dispute.service_request_id;

  -- Calcula comissão (lê de payments ou app_config commission_pct)
  -- Aqui placeholder; lib de cálculo deve estar em src/lib/payments/commission.ts
  v_commission_cents := round(v_service.total_cents * 0.15);

  -- Debita comissão do prestador (registro negativo em provider_payouts)
  INSERT INTO provider_payouts
    (provider_id, service_request_id, amount_cents, status, kind)
  VALUES
    (v_service.provider_id, v_service.id, -v_commission_cents, 'released', 'rework_no_response_penalty');

  UPDATE support_tickets SET
    dispute_status = 'rework_escalated',
    "updatedAt" = NOW()
  WHERE id = p_dispute_id;

  INSERT INTO support_ticket_events
    (ticket_id, kind, actor_id, actor_role, payload)
  VALUES
    (p_dispute_id, 'status_changed', NULL, 'system',
     jsonb_build_object('escalated', true, 'commission_debited_cents', v_commission_cents));

  -- Marca service_request pra realocação (flag); MATCHING vai consumir
  UPDATE service_requests SET status = 'pending_realocation', "updatedAt" = NOW()
    WHERE id = v_service.id;
END $$;
```

## Constraints / NÃO fazer
- ❌ NÃO escalar mais de 1x (idempotência: RPC checa estado atual)
- ❌ NÃO deletar payout original (registra ajuste negativo, mantém auditoria)
- ❌ NÃO realocar de forma síncrona dentro da RPC (envia evento; MATCHING decide)
- ❌ NÃO usar fetch HTTP da RPC (Edge Function chama API depois do COMMIT)
- ❌ NÃO assumir 15% de comissão hardcoded — ler de app_config quando integração madura

## Convenções
- Edge Function chamada por pg_cron (T-158)
- service_role no Deno.env
- Padrão consistente com release-escrow-payouts (T-127)
- Error handling: log + continue (1 falha não bloqueia outras)
$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-154 [API] — POST /api/disputes/[id]/appeal + admin review
-- ============================================================
('969bb1ad-aa33-4907-9973-ffb4fc81aca2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-154',
 'Implementar POST /api/disputes/[id]/appeal (recurso) + PATCH admin review',
$desc$## Objetivo
Permitir que o solicitante (cliente ou prestador) submeta recurso pós-decisão
com nova justificativa e novas evidências; e que o ADMIN avalie o recurso
(aceitar reabrindo a disputa, ou rejeitar mantendo decisão). Cobre AC #8 (ADMIN
avalia recursos solicitados após decisão; solicitante anexa novos elementos
e justificativa; admin decide com base em histórico e relevância da nova
evidência, sem garantia de reabertura).

## Contexto
Módulo SUPORTE — depende de T-147 (dispute_appeals tabela), T-138 (events),
T-151 (notif). Consumido por UI lado solicitante (rota dispute history não
faz parte desta US — só endpoint) e por T-157 (UI admin review).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/disputes/[id]/appeal/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  justification: z.string().min(30).max(3000),
  new_evidence: z.array(z.object({
    url: z.string().url(), filename: z.string(), mime: z.string(), size: z.number().int().nonnegative(),
  })).max(10).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = Body.parse(await req.json());

  // Verifica disputa decidida e usuário envolvido (RLS já restringe; redundância)
  const { data: dispute } = await supabase
    .from('support_tickets')
    .select('id, dispute_status, requester_id, dispute_other_party_id')
    .eq('id', params.id)
    .eq('kind', 'dispute')
    .single();

  if (!dispute) return Response.json({ error: 'not_found' }, { status: 404 });
  if (dispute.dispute_status !== 'decided') {
    return Response.json({ error: 'not_decided_yet' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('dispute_appeals')
    .insert({
      dispute_id: params.id,
      appellant_id: user.id,
      justification: body.justification,
      new_evidence: body.new_evidence ?? null,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}
```

### `src/app/api/admin/disputes/[id]/appeals/[appealId]/route.ts` (PATCH)
```typescript
const PatchBody = z.object({
  status: z.enum(['rejected','accepted_reopened']),
  review_note: z.string().min(20).max(3000),
});

export async function PATCH(req, { params: { id, appealId } }) {
  const adminUser = await requireAdmin();
  const body = PatchBody.parse(await req.json());
  const supabase = await createClient();

  // Atualiza appeal + se 'accepted_reopened', reabre a disputa (UPDATE dispute_status='in_review')
  const { error } = await supabase.rpc('review_dispute_appeal', {
    p_appeal_id: appealId, p_status: body.status,
    p_review_note: body.review_note, p_admin_id: adminUser.id,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await enqueueNotification({ kind: 'dispute_appeal_resolved', dispute_id: id, appeal_status: body.status });
  return Response.json({ ok: true });
}
```

### RPC `review_dispute_appeal`
```sql
CREATE OR REPLACE FUNCTION review_dispute_appeal(
  p_appeal_id uuid, p_status dispute_appeal_status,
  p_review_note text, p_admin_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_dispute_id uuid;
BEGIN
  UPDATE dispute_appeals SET
    status = p_status, reviewed_by = p_admin_id,
    reviewed_at = NOW(), review_note = p_review_note,
    "updatedAt" = NOW()
  WHERE id = p_appeal_id
  RETURNING dispute_id INTO v_dispute_id;

  IF p_status = 'accepted_reopened' THEN
    UPDATE support_tickets SET
      dispute_status = 'in_review',
      admin_status = 'in_review',
      "updatedAt" = NOW()
    WHERE id = v_dispute_id;
  END IF;

  INSERT INTO support_ticket_events (ticket_id, kind, actor_id, actor_role, payload)
  VALUES (v_dispute_id, 'reopened', p_admin_id, 'admin',
          jsonb_build_object('appeal_id', p_appeal_id, 'status', p_status));
END $$;
```

## Constraints / NÃO fazer
- ❌ NÃO permitir múltiplos appeals abertos simultaneamente (CHECK ou validação)
- ❌ NÃO reverter execução financeira ao reabrir (estorno/payout permanece; nova decisão pode gerar ajuste)
- ❌ NÃO permitir admin como appellant (RLS já bloqueia: appeals só de partes envolvidas)
- ❌ NÃO permitir new_evidence > 10 (limite de upload)
- ❌ NÃO usar `messages` (US-025) — appeal é entidade própria

## Convenções
- 2 endpoints (POST appeal user-facing, PATCH appeal admin)
- RPC pra atomicidade
- Notif resultado
$desc$,
 'API', 'ANY',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-155 [DATA] — dispute_decisions (audit log imutável)
-- ============================================================
('df62ba3b-de05-4588-a2f1-eb1527c39d92',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-155',
 'Criar dispute_decisions (audit log imutável de decisões com snapshot)',
$desc$## Objetivo
Tabela de log imutável de decisões de disputa: quem decidiu, quando,
justificativa, outcome, valores financeiros e snapshot do estado da disputa
no momento da decisão. Utilizada por T-150 (decide_dispute RPC). Cobre AC #10
(trilha de auditoria completa em cada decisão tomada — imutável para
conformidade).

## Contexto
Módulo SUPORTE — fundação de auditoria. Padrão de log imutável já consagrado
em `provider_suspension_events` (T-035), `service_events` (US-023),
`support_ticket_events` (T-138). Aqui é log **específico de decisão** (não
substitui events, complementa: events lista todas mudanças; decisions é a
fonte legal pra "porque essa disputa foi decidida assim").

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_dispute_decisions.sql`
```sql
BEGIN;

CREATE TABLE dispute_decisions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id              uuid NOT NULL REFERENCES support_tickets(id) ON DELETE RESTRICT,
  decided_by              uuid NOT NULL REFERENCES auth.users(id),
  outcome                 dispute_outcome NOT NULL,
  justification           text NOT NULL CHECK (length(justification) BETWEEN 30 AND 3000),
  refund_amount_cents     integer NOT NULL DEFAULT 0,
  refund_debt_cents       integer NOT NULL DEFAULT 0,
  idempotency_key         text NULL,
  snapshot                jsonb NOT NULL,  -- snapshot de support_tickets row
  "createdAt"             timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispute_decisions_dispute ON dispute_decisions (dispute_id, "createdAt" DESC);
CREATE UNIQUE INDEX idx_dispute_decisions_idempotency
  ON dispute_decisions (idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE dispute_decisions ENABLE ROW LEVEL SECURITY;

-- Partes envolvidas leem decisão da própria disputa
CREATE POLICY "involved_parties_read" ON dispute_decisions FOR SELECT
  USING (
    dispute_id IN (
      SELECT id FROM support_tickets
      WHERE requester_id = auth.uid() OR dispute_other_party_id = auth.uid()
    )
  );

-- ADMIN tudo
CREATE POLICY "admin_all" ON dispute_decisions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Sem policies de UPDATE/DELETE — linha imutável

COMMIT;
```

## Constraints / NÃO fazer
- ❌ NÃO permitir UPDATE/DELETE (sem policy = denied)
- ❌ NÃO usar ON DELETE CASCADE (RESTRICT preserva log mesmo se ticket é arquivado)
- ❌ NÃO logar PII desnecessária — snapshot já cobre o necessário
- ❌ NÃO usar `delete_log` ou flag soft-delete — log é histórico, não estado
- ❌ NÃO criar trigger inserting aqui — INSERT vem **explicitamente** da RPC decide_dispute (atomicidade na transação)

## Convenções
- Padrão `<entity>_decisions`
- snapshot jsonb captura estado da row no momento da decisão
- Money em cents integer
- Imutabilidade reforçada por ausência de policy UPDATE/DELETE
$desc$,
 'DATA', 'ANY',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-156 [UI] — /admin/disputes (lista priorizada)
-- ============================================================
('27983085-899d-4cd4-b48f-b0233719b2d3',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-156',
 'Renderizar /admin/disputes com fila priorizada, flag recorrência e infinite scroll',
$desc$## Objetivo
Tela admin que lista disputas via T-148, com priorização visual (status +
idade), badge de "padrão recorrente" (3+ em 30d), filtros por dispute_status
e recurring_only, skeleton, empty, infinite scroll. Tap em disputa abre
DisputeDetailSheet (T-157). Cobre AC #1 (fila separada priorizada) +
AC #7 (flag recorrente destacada) + AC #11 (estados completos).

## Contexto
Módulo SUPORTE — consome T-148 (GET list). Reutiliza padrões da T-143
(/admin/support/tickets): mesma estrutura de filtros + cards + infinite scroll,
diferindo no shape do item (badges específicas: dispute_status, recurring_pattern,
outcome quando decided).

## Estado atual / O que substitui
Não existe rota `/admin/disputes`. Sidebar admin precisa ganhar item.

## O que criar

### `src/app/admin/disputes/page.tsx`
```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { Field, FormBody } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useSlaStatus } from '@/lib/support/sla'; // T-145 reuse
import { DisputeDetailSheet } from '@/components/support/DisputeDetailSheet'; // T-157

export default function DisputesPage() {
  const [filters, setFilters] = useState({ dispute_status: '', recurring_only: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { items, loading, hasMore, loadMore, empty } = useDisputeList(filters);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-semibold">Fila de disputas</h1>

      <FormBody density="compact" className="mt-4">
        <Field.Row cols={2}>
          <Field name="status"><Field.Label>Status</Field.Label>
            <Field.Control><Select value={filters.dispute_status} onChange={e => setFilters(f => ({...f, dispute_status: e.target.value}))}>
              <option value="">Todos</option>
              <option value="open">Aberta</option>
              <option value="awaiting_provider">Aguardando prestador</option>
              <option value="awaiting_response">Aguardando resposta</option>
              <option value="in_review">Em análise</option>
              <option value="rework_pending">Retrabalho pendente</option>
              <option value="rework_escalated">Retrabalho escalado</option>
              <option value="decided">Decidida</option>
              <option value="closed">Fechada</option>
            </Select></Field.Control>
          </Field>
          <Field name="recurring"><Field.Label>Apenas reincidentes (3+ em 30d)</Field.Label>
            <Field.Control>
              <input type="checkbox" checked={filters.recurring_only} onChange={e => setFilters(f => ({...f, recurring_only: e.target.checked}))} />
            </Field.Control>
          </Field>
        </Field.Row>
      </FormBody>

      <div className="mt-6 flex flex-col gap-3">
        {loading && items.length === 0 && Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-28" />)}
        {empty && <EmptyState message="Nenhuma disputa nos filtros atuais" />}
        {items.map(d => <DisputeRow key={d.id} dispute={d} onClick={() => setSelectedId(d.id)} />)}
        {hasMore && <InfiniteScrollSentinel onIntersect={loadMore} />}
      </div>

      {selectedId && <DisputeDetailSheet disputeId={selectedId} onClose={() => setSelectedId(null)} />}
    </main>
  );
}

function DisputeRow({ dispute, onClick }) {
  return (
    <Card onClick={onClick} className="cursor-pointer p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip status={dispute.dispute_status}>{labelDisputeStatus(dispute.dispute_status)}</StatusChip>
          {dispute.recurring_pattern && (
            <Badge className="bg-amber-100 text-amber-800">Padrão recorrente ({dispute.disputes_30d}/30d)</Badge>
          )}
          {dispute.dispute_status === 'rework_pending' && <Badge className="bg-blue-100 text-blue-800">24h retrabalho</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">{formatRelativeTime(dispute.createdAt)}</span>
      </div>
      <p className="mt-2 text-sm">{dispute.requested_outcome ?? 'Sem outcome solicitado'}</p>
    </Card>
  );
}
```

### `useDisputeList` hook
- Cursor pagination via `/api/admin/disputes`
- Refetch ao mudar filtros

## Reuso
- `Card`, `Skeleton`, `Badge`, `StatusChip`, `Field`/`FormBody`/`Select`
- Padrão de cursor pagination de T-143
- `useSlaStatus` (T-145) — opcional pra warning de "decisão atrasada"

## Constraints / NÃO fazer
- ❌ NÃO duplicar UI da T-143 — extrair shared `AdminListPage` se houver tempo (não obrigatório)
- ❌ NÃO renderizar evidências na lista (vai em sheet detail)
- ❌ NÃO usar window.confirm
- ❌ NÃO usar OFFSET pagination

## Convenções
- Mobile-first
- Sonner em erro de fetch
- `qualityFlags`: REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK, FIELD_COMPOUND_API, INFINITE_SCROLL, MOBILE_FIRST
$desc$,
 'UI', NULL,
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','INFINITE_SCROLL','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-157 [UI] — DisputeDetailSheet
-- ============================================================
('956a033d-d025-4f4b-80ca-5b9b7be41e8b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-157',
 'Renderizar DisputeDetailSheet com evidências, decisão, retrabalho, evidence-request, appeals',
$desc$## Objetivo
ResponsiveSheet (size lg) que carrega detalhe de disputa via T-149 e expõe
todas as ações do ADMIN: registrar decisão (form com outcome + justificativa
+ refund_amount_cents condicional), solicitar evidências adicionais (textarea
+ prazo), revisar appeals existentes, ver bad_faith counters, ver protocolo
fotográfico do serviço, timeline de eventos. Cobre AC #2 (detalhe rico),
AC #3 (registrar decisão com UI guiada), AC #5 (UI mostra contador má-fé),
AC #6 (botão solicitar evidência), AC #8 (review de appeal).

## Contexto
Módulo SUPORTE — consome T-149 (GET detail), T-150 (POST decide), T-152
(POST request-evidence), T-154 (PATCH appeal review). Reutiliza padrão da
T-144 (TicketDetailSheet), com seções específicas de disputa.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/support/DisputeDetailSheet.tsx`
```tsx
'use client';

import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { fetchOrThrow } from '@/lib/fetch-or-throw';
import { showErrorToast } from '@/lib/optimistic/toast';

export function DisputeDetailSheet({ disputeId, onClose }) {
  const { data, refresh, loading } = useDisputeDetail(disputeId);
  const [tab, setTab] = useState<'overview'|'decide'|'evidence'|'appeals'>('overview');
  const [confirm, setConfirm] = useState(null);

  return (
    <ResponsiveSheet open={!!disputeId} onOpenChange={(o) => !o && onClose()} size="lg">
      <ResponsiveSheet.Header>
        <div className="flex items-center justify-between">
          <span>Disputa #{shortId(disputeId)}</span>
          {data?.ticket?.dispute_status && <Badge>{labelDisputeStatus(data.ticket.dispute_status)}</Badge>}
        </div>
      </ResponsiveSheet.Header>

      <ResponsiveSheet.Body>
        {loading && <DetailSkeleton />}
        {data && (
          <>
            <Tabs value={tab} onValueChange={setTab}>
              <Tab value="overview">Visão geral</Tab>
              <Tab value="evidence">Evidências ({data.evidences.length})</Tab>
              <Tab value="appeals">Recursos ({data.appeals.length})</Tab>
              <Tab value="decide" disabled={data.ticket.dispute_status === 'decided' || data.ticket.dispute_status === 'closed'}>Decidir</Tab>
            </Tabs>

            {tab === 'overview' && <OverviewTab data={data} />}
            {tab === 'evidence' && (
              <EvidenceTab
                evidences={data.evidences}
                onRequest={async (msg) => {
                  await fetchOrThrow(`/api/admin/disputes/${disputeId}/request-evidence`, {
                    method: 'POST', body: JSON.stringify({ ask_message: msg }),
                  });
                  refresh();
                }}
              />
            )}
            {tab === 'appeals' && (
              <AppealsTab
                appeals={data.appeals}
                onReview={async (appealId, status, note) => {
                  await fetchOrThrow(`/api/admin/disputes/${disputeId}/appeals/${appealId}`, {
                    method: 'PATCH', body: JSON.stringify({ status, review_note: note }),
                  });
                  refresh();
                }}
              />
            )}
            {tab === 'decide' && (
              <DecideForm
                serviceTotalCents={data.serviceRequest?.total_cents}
                onSubmit={async ({ outcome, justification, refund_amount_cents }) => {
                  setConfirm({
                    title: outcome === 'bad_faith' ? 'Marcar como má-fé?' : 'Confirmar decisão?',
                    description: outcome === 'bad_faith'
                      ? 'O contador de má-fé do solicitante será incrementado e ele será penalizado.'
                      : `Outcome: ${outcome}. Estorno: ${formatBRL(refund_amount_cents)}.`,
                    destructive: outcome === 'favor_client' || outcome === 'bad_faith',
                    confirmLabel: 'Decidir',
                    onConfirm: async () => {
                      try {
                        await fetchOrThrow(`/api/admin/disputes/${disputeId}/decide`, {
                          method: 'POST',
                          headers: { 'idempotency-key': crypto.randomUUID() },
                          body: JSON.stringify({ outcome, justification, refund_amount_cents }),
                        });
                        refresh();
                      } catch (err) {
                        showErrorToast({ type: 'patch', id: disputeId }, err);
                      }
                    },
                  });
                }}
              />
            )}
          </>
        )}
      </ResponsiveSheet.Body>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </ResponsiveSheet>
  );
}

function DecideForm({ serviceTotalCents, onSubmit }) {
  const [outcome, setOutcome] = useState<DisputeOutcome>('favor_client');
  const [justification, setJustification] = useState('');
  const [refundCents, setRefundCents] = useState(serviceTotalCents);

  const showRefundField = outcome === 'partial_split';

  return (
    <FormBody density="comfortable">
      <Field name="outcome" required>
        <Field.Label>Outcome</Field.Label>
        <Field.Control>
          <Select value={outcome} onChange={e => setOutcome(e.target.value as DisputeOutcome)}>
            <option value="favor_client">Favorável ao cliente (estorno integral)</option>
            <option value="favor_provider">Favorável ao prestador (manter)</option>
            <option value="partial_split">Parcial (definir valor)</option>
            <option value="rework_mediated">Retrabalho mediado</option>
            <option value="bad_faith">Má-fé do solicitante</option>
          </Select>
        </Field.Control>
      </Field>
      <Field name="justification" required error={justification.length < 30 ? 'Mínimo 30 caracteres' : undefined}>
        <Field.Label>Justificativa</Field.Label>
        <Field.Control>
          <Textarea value={justification} onChange={e => setJustification(e.target.value)} rows={5} />
        </Field.Control>
        <Field.Hint>{justification.length}/3000</Field.Hint>
      </Field>
      {showRefundField && (
        <Field name="refund" required>
          <Field.Label>Valor de estorno (R$)</Field.Label>
          <Field.Control>
            <Input type="number" min="0" max={serviceTotalCents/100}
                   value={refundCents/100}
                   onChange={e => setRefundCents(Math.round(Number(e.target.value)*100))} />
          </Field.Control>
          <Field.Hint>Total do serviço: {formatBRL(serviceTotalCents)}</Field.Hint>
        </Field>
      )}
      <Button onClick={() => onSubmit({ outcome, justification, refund_amount_cents: refundCents })}
              disabled={justification.length < 30}>
        Decidir
      </Button>
    </FormBody>
  );
}
```

## Reuso
- `ResponsiveSheet` (size=lg)
- `ConfirmDialog` — confirmação de decisão (especialmente bad_faith e favor_client)
- `Field`/`FormBody`/`Select`/`Textarea`/`Input` — formulário decisão
- `Button`, `Badge`, `StatusChip`
- `fetchOrThrow`, `showErrorToast`
- Padrão de Tabs de outros sheets do projeto (existente?)

## Constraints / NÃO fazer
- ❌ NÃO usar window.confirm/alert
- ❌ NÃO permitir submit sem justificativa válida (≥30 chars)
- ❌ NÃO permitir partial_split sem refund > 0 e ≤ total
- ❌ NÃO renderizar campos de refund quando outcome != partial_split
- ❌ NÃO chamar gateway direto da UI — sempre via decide endpoint (T-150)
- ❌ NÃO mostrar appeals tab vazia se não houver appeals (oculta tab)

## Convenções
- Mobile-first (90dvh)
- ConfirmDialog para todas decisões (são irreversíveis sem appeal)
- Sonner em erro
- `qualityFlags`: REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK, RESPONSIVE_SHEET_REQUIRED, CONFIRM_DIALOG_REQUIRED, FIELD_COMPOUND_API, MOBILE_FIRST
$desc$,
 'UI', NULL,
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-158 [OPS] — Seedar app_config dispute_* + pg_cron escalation
-- ============================================================
('b85d860a-6629-4c3a-9927-fe22d5bc40eb',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '234d937a-7fbe-49b3-a482-310223efc904',
 'ZLAR-V2-T-158',
 'Seedar app_config dispute_* (prazos + thresholds) + pg_cron job dispute_rework_escalation',
$desc$## Objetivo
Seedar parâmetros operacionais em `app_config` para a feature de disputas
(prazos, thresholds e percentuais de comissão) e agendar `pg_cron` que dispara
a Edge Function `dispute-rework-escalation` (T-153) a cada 15 minutos.
Cobre AC #4 (24h sem aceite escalada) + AC #6 (48h evidência) + AC #7 (3+
em 30d) — todos parâmetros configuráveis via app_config sem deploy.

## Contexto
Módulo SUPORTE / OPS — `app_config` existente. Padrão de pg_cron + Edge Function
já estabelecido em T-080 (expirar VTs), T-126 (release-payouts), T-113
(agenda-reminders).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_dispute_config_and_cron.sql`
```sql
BEGIN;

INSERT INTO app_config (key, value, description) VALUES
  ('dispute_evidence_deadline_hours', '48'::jsonb, 'Prazo padrão para solicitante complementar evidências (US-026 AC #6)'),
  ('dispute_rework_acceptance_hours', '24'::jsonb, 'Prazo do prestador aceitar retrabalho mediado (US-026 AC #4)'),
  ('dispute_recurring_pattern_lookback_days', '30'::jsonb, 'Janela para flag "padrão recorrente" (US-026 AC #7)'),
  ('dispute_recurring_pattern_threshold', '3'::jsonb, 'Quantidade mínima para flag (US-026 AC #7)'),
  ('dispute_provider_commission_pct', '15'::jsonb, 'Comissão Zelar (% do total) usada no desconto por escalation rework')
ON CONFLICT (key) DO NOTHING;

-- pg_cron pra disparar Edge Function a cada 15min
SELECT cron.schedule(
  'dispute_rework_escalation',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := current_setting('app.supabase_functions_url') || '/dispute-rework-escalation',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
    );
  $cron$
);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ NÃO hardcodar prazos em código (sempre via app_config)
- ❌ NÃO rodar mais frequente que 15min (overhead desnecessário no MVP)
- ❌ NÃO usar pg_cron pra notif (notificação é módulo separado)
- ❌ NÃO esquecer de extensão pg_net (criada em outra US; verificar)

## Convenções
- Padrão consistente com T-080/T-126/T-113
- Configurações em app_config para ajuste sem deploy
- Cron expression `*/15 * * * *` (a cada 15min)
- service_role bypass implícito do cron
$desc$,
 'OPS', 'SISTEMA',
 ARRAY['SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- ============================================================
-- 2. Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- ============================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id
FROM (VALUES
  -- AC1: fila separada priorizada por status e idade
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b'::uuid, 1), -- T-146 view
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73'::uuid, 1), -- T-148 GET list
  ('27983085-899d-4cd4-b48f-b0233719b2d3'::uuid, 1), -- T-156 UI lista

  -- AC2: detalhe rico (descrição, evidências, resposta, fotos, chat, timeline)
  ('a65eee93-852d-4954-9fa2-3c14c4437986'::uuid, 2), -- T-147 schema (evidences)
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e'::uuid, 2), -- T-149 GET detail
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b'::uuid, 2), -- T-157 UI sheet

  -- AC3: registrar decisão + outcome + execução financeira automática + notif
  ('a65eee93-852d-4954-9fa2-3c14c4437986'::uuid, 3), -- T-147 schema (outcome enum, refund cols)
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d'::uuid, 3), -- T-150 RPC decide
  ('2fcec385-daab-42cc-b78f-c4e582ac2512'::uuid, 3), -- T-151 notif
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92'::uuid, 3), -- T-155 audit log
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b'::uuid, 3), -- T-157 UI form

  -- AC4: retrabalho mediado 24h → realocar e descontar comissão
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d'::uuid, 4), -- T-150 (outcome rework_mediated)
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd'::uuid, 4), -- T-153 Edge Function escalation
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb'::uuid, 4), -- T-158 cron + config 24h
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b'::uuid, 4), -- T-157 UI ação

  -- AC5: má-fé incrementa contador na ficha
  ('a65eee93-852d-4954-9fa2-3c14c4437986'::uuid, 5), -- T-147 (bad_faith_count cols)
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d'::uuid, 5), -- T-150 RPC incrementa
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b'::uuid, 5), -- T-157 UI mostra contador

  -- AC6: solicitar evidências adicionais (48h)
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e'::uuid, 6), -- T-152 endpoint
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb'::uuid, 6), -- T-158 config prazo
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b'::uuid, 6), -- T-157 UI ação

  -- AC7: flag "padrão recorrente" (3+ em 30d)
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b'::uuid, 7), -- T-146 view com flag
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73'::uuid, 7), -- T-148 retorna na list
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb'::uuid, 7), -- T-158 config threshold
  ('27983085-899d-4cd4-b48f-b0233719b2d3'::uuid, 7), -- T-156 UI badge

  -- AC8: recursos pós-decisão
  ('a65eee93-852d-4954-9fa2-3c14c4437986'::uuid, 8), -- T-147 dispute_appeals
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2'::uuid, 8), -- T-154 endpoints
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b'::uuid, 8), -- T-157 UI review

  -- AC9: estorno parcial automático com saldo devedor
  ('a65eee93-852d-4954-9fa2-3c14c4437986'::uuid, 9), -- T-147 refund_debt_cents
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d'::uuid, 9), -- T-150 lógica de débito

  -- AC10: trilha de auditoria imutável
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92'::uuid, 10), -- T-155 dispute_decisions
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d'::uuid, 10), -- T-150 grava na transação

  -- AC11: empty/skeleton/scroll/paginação
  ('27983085-899d-4cd4-b48f-b0233719b2d3'::uuid, 11)  -- T-156 UI cobre estados
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- ============================================================
-- 3. AC-da-Task (checklist técnico)
-- ============================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  -- T-146 [DATA]
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'View dispute_queue_v criada projetando ticket + recurring_pattern (>=3 disputas em 30d)', 1),
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'Coluna priority_bucket retorna 0..5 conforme dispute_status (open primeiro, closed por último)', 2),
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'Coluna age_hours calculada via EXTRACT EPOCH /3600', 3),
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'View herda RLS de support_tickets (smoke test: persona não-envolvida não vê)', 4),

  -- T-147 [DATA]
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'CHECK constraint kind permite open=early_payout, general_support, dispute', 1),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'Enums dispute_outcome (5 valores) e dispute_status (8 valores) criados', 2),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'Colunas dispute_* em support_tickets adicionadas com CHECK requerendo not null quando kind=dispute', 3),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'Tabela dispute_evidences criada com role enum, RLS por partes envolvidas, sem UPDATE/DELETE', 4),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'Tabela dispute_appeals criada com appellant=partes envolvidas, RLS apropriado', 5),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'client_profiles e provider_profiles ganham bad_faith_count integer NOT NULL DEFAULT 0', 6),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'service_requests ganha has_active_dispute e has_rework com índice parcial', 7),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', 'RLS smoke: cliente vê própria evidência mas não admin_note; admin tudo via claim', 8),

  -- T-148 [API]
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'Endpoint GET /api/admin/disputes criado e protegido por requireAdmin (403 se não-admin)', 0),
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'Zod valida query params (dispute_status, recurring_only, q, cursor, limit)', 1),
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'Cursor pagination composto (priority_bucket, createdAt) funciona avançando entre páginas', 2),
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'Filtro recurring_only=true retorna apenas com flag true', 3),
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'Resposta inclui priority_bucket e recurring_pattern em cada item', 4),
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'Smoke: admin vê fila completa; não-admin recebe 403', 5),

  -- T-149 [API]
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'Endpoint GET /api/admin/disputes/[id] criado e protegido', 0),
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', '404 quando ticket não existe ou kind != dispute', 1),
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'Resposta inclui ticket, serviceRequest com fotos, client+provider profiles com bad_faith_count', 2),
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'Resposta inclui evidences ASC, messages ASC, events DESC', 3),
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'Resposta inclui chatHistory de US-025 messages quando tabela existe; empty array senão', 4),
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'Resposta inclui appeals em ordem DESC', 5),

  -- T-150 [API]
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'RPC decide_dispute criada com SECURITY DEFINER + FOR UPDATE', 0),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Endpoint POST /api/admin/disputes/[id]/decide valida body Zod e idempotency-key obrigatório', 1),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Justificativa < 30 chars retorna 400; partial_split sem refund_amount retorna 400', 2),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Disputa já decidida retorna 409 (idempotência via idempotency_key também funciona)', 3),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'outcome=favor_client estorna total do serviço; partial_split estorna refund_amount_cents', 4),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Estorno parcial automático: se balance < requested, debita o disponível e grava refund_debt_cents (AC #9)', 5),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'outcome=bad_faith incrementa bad_faith_count no perfil correto (cliente vs prestador)', 6),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'outcome=rework_mediated transita para rework_pending (AC #4 setup)', 7),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Audit log dispute_decisions inserido na mesma transação', 8),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'service_requests.has_active_dispute=false e has_rework atualizados', 9),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Gateway refund enfileirado APÓS commit (não bloqueia resposta)', 10),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'Notificação enfileirada APÓS commit (não bloqueia)', 11),

  -- T-151 [API]
  ('2fcec385-daab-42cc-b78f-c4e582ac2512', 'Helper enqueueNotification estendido com 4 novos kinds dispute_*', 0),
  ('2fcec385-daab-42cc-b78f-c4e582ac2512', 'dispute_decided gera 2 mensagens (cliente + prestador) com variantes por outcome', 1),
  ('2fcec385-daab-42cc-b78f-c4e582ac2512', 'Mensagens não vazam dados sensíveis (não inclui valor explícito no push, link para detalhe)', 2),
  ('2fcec385-daab-42cc-b78f-c4e582ac2512', 'Dedup key (dispute_id, outcome, recipient_id) impede duplicação em retry', 3),
  ('2fcec385-daab-42cc-b78f-c4e582ac2512', 'Falha de enqueue não bloqueia decide endpoint (try/catch + log)', 4),

  -- T-152 [API]
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'Endpoint POST /api/admin/disputes/[id]/request-evidence criado e protegido por requireAdmin', 0),
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'Zod valida ask_message (10-2000 chars)', 1),
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'Lê dispute_evidence_deadline_hours de app_config (fallback 48)', 2),
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'Atualiza dispute_status=awaiting_response e payload com evidence_request', 3),
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'Registra evento status_changed com payload do request', 4),
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'Notif enfileirada com deadline_at calculado', 5),

  -- T-153 [API]
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'Edge Function dispute-rework-escalation deployada', 0),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'Varredura encontra disputas em rework_pending há mais de 24h (filter via createdAt+config)', 1),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'RPC escalate_dispute_rework é idempotente (re-executar não causa double-debit)', 2),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'Comissão (15% default ou config) debitada via provider_payouts negativo com kind=rework_no_response_penalty', 3),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'service_requests.status atualizado para pending_realocation', 4),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'Evento system registrado com commission_debited_cents', 5),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'Falha em 1 disputa não impede processamento das demais (try/catch por iter)', 6),

  -- T-154 [API]
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'Endpoint POST /api/disputes/[id]/appeal criado para autenticated', 0),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'Zod valida justification (30-3000) e new_evidence (max 10 itens)', 1),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'Apenas partes envolvidas conseguem submeter (RLS valida appellant_id em ticket próprio)', 2),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', '409 quando dispute_status != decided (não pode recorrer antes da decisão)', 3),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'Endpoint PATCH /api/admin/disputes/[id]/appeals/[appealId] criado para admin review', 4),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'RPC review_dispute_appeal: status=accepted_reopened reabre disputa (in_review)', 5),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'Notificação enfileirada para o appellant com resultado', 6),

  -- T-155 [DATA]
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92', 'Tabela dispute_decisions criada com FK dispute_id ON DELETE RESTRICT', 1),
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92', 'snapshot jsonb persiste row de support_tickets no momento da decisão', 2),
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92', 'UNIQUE INDEX em idempotency_key (parcial WHERE NOT NULL) impede duplicata', 3),
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92', 'CHECK justification entre 30 e 3000 chars', 4),
  ('df62ba3b-de05-4588-a2f1-eb1527c39d92', 'RLS: partes envolvidas leem própria decisão; admin tudo; sem UPDATE/DELETE policies (imutável)', 5),

  -- T-156 [UI]
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Rota /admin/disputes renderiza fila com infinite scroll', 0),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Filtros (dispute_status, recurring_only) usam Field compound API', 1),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Skeleton no loading inicial (5 cards)', 2),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Empty state com mensagem clara para filtros vazios', 3),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Cards mostram StatusChip de dispute_status, badge "Padrão recorrente" quando flag true, badge "24h retrabalho" se rework_pending', 4),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Tap em card abre DisputeDetailSheet (T-157)', 5),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Layout não quebra em viewport <768px (mobile-first)', 6),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', 'Erros de fetch viram Sonner toast', 7),

  -- T-157 [UI]
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'DisputeDetailSheet usa ResponsiveSheet size=lg', 0),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Tabs Overview/Evidences/Appeals/Decide implementadas', 1),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Tab Decide bloqueada quando dispute_status decided/closed', 2),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Form de decisão: outcome (Select), justification (Textarea ≥30), refund_amount condicional em partial_split', 3),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'ConfirmDialog antes de decidir (especialmente bad_faith e favor_client) — sem window.confirm', 4),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Ação solicitar evidência usa Textarea + dispara T-152', 5),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Tab Appeals mostra lista; ação review usa form com status + review_note', 6),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Overview mostra requester, other party, bad_faith_count de cada lado, fotos do serviço', 7),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Idempotency-Key gerado via crypto.randomUUID a cada submit', 8),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'Erros de PATCH/POST viram Sonner toast', 9),

  -- T-158 [OPS]
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'Migration aplicada via psql', 0),
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'app_config seedada com 5 chaves dispute_* (todos com ON CONFLICT DO NOTHING)', 1),
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'cron.schedule criado com nome dispute_rework_escalation a cada 15min', 2),
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'Smoke: SELECT FROM cron.job WHERE jobname=dispute_rework_escalation retorna ativo', 3),
  ('b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'pg_net + http_post extensão disponíveis (verificadas em US prévia)', 4);

-- ============================================================
-- 4. TaskDependency (kind LOWERCASE)
-- ============================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-146 view depende de T-147 (precisa das colunas dispute_*)
  ('64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'a65eee93-852d-4954-9fa2-3c14c4437986', 'blocks'),
  -- T-148 GET list depende de T-146
  ('5a3d724e-d12b-418f-8212-3bcb2e65ac73', '64303dcf-c386-4f13-8c8e-34b4b6c44a3b', 'blocks'),
  -- T-149 GET detail depende de T-147
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'a65eee93-852d-4954-9fa2-3c14c4437986', 'blocks'),
  -- T-150 RPC decide depende de T-147 + T-155 (audit log)
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'a65eee93-852d-4954-9fa2-3c14c4437986', 'blocks'),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'df62ba3b-de05-4588-a2f1-eb1527c39d92', 'blocks'),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', '2fcec385-daab-42cc-b78f-c4e582ac2512', 'blocks'),
  -- T-151 notif (independente; só helper)
  -- T-152 request-evidence depende de T-147
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'a65eee93-852d-4954-9fa2-3c14c4437986', 'blocks'),
  ('eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'blocks'),
  -- T-153 escalation depende de T-147 + T-158 (cron + config)
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'a65eee93-852d-4954-9fa2-3c14c4437986', 'blocks'),
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', 'b85d860a-6629-4c3a-9927-fe22d5bc40eb', 'blocks'),
  -- T-154 appeals depende de T-147 + T-150 (decided antes de appeal)
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'a65eee93-852d-4954-9fa2-3c14c4437986', 'blocks'),
  ('969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'blocks'),
  -- T-155 audit log (independente; só DDL)
  -- T-156 UI lista depende de T-148
  ('27983085-899d-4cd4-b48f-b0233719b2d3', '5a3d724e-d12b-418f-8212-3bcb2e65ac73', 'blocks'),
  ('27983085-899d-4cd4-b48f-b0233719b2d3', '956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'relates_to'),
  -- T-157 UI sheet depende de T-149 + T-150 + T-152 + T-154
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'blocks'),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'f3ce7a49-de44-47da-bc91-bfd4f51d532d', 'blocks'),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', 'eb02dcf0-f32b-40cf-8074-ce1427feeb8e', 'blocks'),
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', '969bb1ad-aa33-4907-9973-ffb4fc81aca2', 'blocks'),

  -- relates_to cross-US:
  -- T-147 estende support_tickets (T-125 US-028) e consome T-136 (US-018)
  ('a65eee93-852d-4954-9fa2-3c14c4437986', '499568da-6762-4a51-8d0b-61fd4fe58f3e', 'relates_to'),
  ('a65eee93-852d-4954-9fa2-3c14c4437986', '981174d0-ebca-4e91-b85b-eb020f032984', 'relates_to'),
  -- T-149 reusa support_ticket_messages (T-137) e events (T-138)
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', '7672945f-d686-489b-a2a7-0326272745dd', 'relates_to'),
  ('bb2b1ba6-8df7-4f16-ad9b-4f0cd4d7f97e', 'd643fc63-a65e-42d7-a379-93356216279b', 'relates_to'),
  -- T-150 estorno mexe em provider_payouts (T-124) e payments (T-071)
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', '9cbd907f-3f00-4690-abb9-6fca176d1edf', 'relates_to'),
  ('f3ce7a49-de44-47da-bc91-bfd4f51d532d', '82182a9d-e5ae-46b2-aad4-e37dc5d759a5', 'relates_to'),
  -- T-153 também debita provider_payouts (T-124)
  ('69c28bee-9742-4c73-b825-7fd92dd0bbdd', '9cbd907f-3f00-4690-abb9-6fca176d1edf', 'relates_to'),
  -- T-156 reusa padrões da T-143 (US-018)
  ('27983085-899d-4cd4-b48f-b0233719b2d3', '8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'relates_to'),
  -- T-157 reusa padrões da T-144 (US-018)
  ('956a033d-d025-4f4b-80ca-5b9b7be41e8b', '083f5b67-0c41-40f8-b540-72b3d9b81b79', 'relates_to'),
  -- T-145 SlaBadge / useSlaStatus (US-018) reusados em T-156
  ('27983085-899d-4cd4-b48f-b0233719b2d3', '5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'relates_to');

COMMIT;
