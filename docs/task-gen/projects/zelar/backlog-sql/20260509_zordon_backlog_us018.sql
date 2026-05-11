-- Backlog cards no Zordon — ZLAR-V2-US-018 (SUPORTE / ADMIN)
-- Atender tickets de suporte geral
--
-- Este arquivo INSERT em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). Snippets DDL em descriptions são
-- spec pra implementação futura no banco do produto Zelar — não são executados aqui.
--
-- Story: e440d22e-bc36-425f-acef-94f72ddb5f5e
-- Persona: ADMIN (mas também SISTEMA para notificação)
-- AC count: 5
-- Tasks: 10 (DATA:3 API:4 UI:2 OPS:1)
-- Reuse base: support_tickets (T-125 / US-028 — schema mínimo já criado para early_payout)

BEGIN;

-- ============================================================
-- 1. Tasks
-- ============================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ============================================================
-- T-136 [DATA] — Estender support_tickets como tabela genérica multi-tipo
-- ============================================================
('981174d0-ebca-4e91-b85b-eb020f032984',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-136',
 'Estender support_tickets com tipo, status admin, descricao e índices de listagem',
$desc$## Objetivo
Estender a tabela `support_tickets` (criada em ZLAR-V2-T-125 com `kind=early_payout`
para US-028) para suportar tickets de suporte geral abertos por CLIENTE/PRESTADOR
sobre serviço/pagamento/erro técnico/feedback/outros, com status operacional
(`open` / `in_review` / `resolved` / `closed`), descrição livre, FK opcional pra
`service_requests`, e índices que sustentem listagem ordenada por data/SLA com
filtro de tipo. Cobre AC #1 (listagem com filtros e busca) e AC #2 (detalhe com
tipo, descrição, serviço relacionado, dados solicitante).

## Contexto
Módulo SUPORTE — fundação de dados. Hoje `support_tickets` existe mas só com
`kind` e poucos campos (criada para US-028 cobrir saque antecipado). US-018 e
US-026 (disputas) vão consumir/expandir essa tabela. Mantém uma tabela única
multi-kind (early_payout, general_support, dispute) com colunas opcionais por
kind — alternativa de tabelas separadas inflaria policies e telas.

Dados sensíveis: descrição pode conter PII (nome, CPF, endereço); tratar como
input de usuário (sanitizar ao renderizar mas armazenar verbatim para auditoria).

## Estado atual / O que substitui
`support_tickets` existe (T-125) com colunas mínimas: `id, kind, requester_id,
service_request_id, payload jsonb, status, "createdAt", "updatedAt"`. RLS atual
permite que requester veja o próprio ticket; ADMIN bypass via claim.

Esta task **expande** o schema. Não é tabela nova. Migrations futuras (disputas
US-026) vão expandir mais (decision_outcome, resolution_amount, etc.) — isolar
em sua própria task.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_support_tickets_general.sql`
```sql
BEGIN;

-- Enum de tipo do ticket de suporte geral (subkind quando kind='general_support')
CREATE TYPE support_ticket_problem_type AS ENUM (
  'service',         -- problema com serviço executado
  'payment',         -- problema com pagamento/escrow
  'technical_error', -- bug/erro técnico no app
  'feedback',        -- sugestão/elogio/crítica
  'other'            -- não se encaixa
);

-- Enum de status admin (separado de payload.status que era específico de early_payout)
CREATE TYPE support_ticket_admin_status AS ENUM (
  'open',       -- aguardando atendimento
  'in_review',  -- algum admin marcou como em análise
  'resolved',   -- admin resolveu
  'closed'      -- arquivado sem ação (spam, duplicado)
);

ALTER TABLE support_tickets
  ADD COLUMN problem_type support_ticket_problem_type NULL,
  ADD COLUMN description text NULL,
  ADD COLUMN admin_status support_ticket_admin_status NOT NULL DEFAULT 'open',
  ADD COLUMN assigned_admin_id uuid NULL REFERENCES auth.users(id),
  ADD COLUMN assigned_at timestamptz NULL,
  ADD COLUMN resolved_at timestamptz NULL,
  ADD COLUMN resolution_note text NULL;

-- problem_type obrigatório quando kind='general_support'
ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_problem_type_required
  CHECK (
    (kind = 'general_support' AND problem_type IS NOT NULL AND description IS NOT NULL)
    OR
    kind != 'general_support'
  );

-- Índices para listagem admin
CREATE INDEX idx_support_tickets_admin_listing
  ON support_tickets (admin_status, "createdAt" DESC)
  WHERE admin_status IN ('open', 'in_review');

CREATE INDEX idx_support_tickets_problem_type
  ON support_tickets (problem_type)
  WHERE problem_type IS NOT NULL;

CREATE INDEX idx_support_tickets_service_request
  ON support_tickets (service_request_id)
  WHERE service_request_id IS NOT NULL;

-- Index full-text simples para busca textual (description + payload)
CREATE INDEX idx_support_tickets_description_trgm
  ON support_tickets USING gin (description gin_trgm_ops);
-- pg_trgm já habilitada (verificar; se não, CREATE EXTENSION IF NOT EXISTS pg_trgm)

-- RLS: requester continua vendo o próprio; ADMIN tudo via claim
-- Policies já existem de T-125; verificar se cobrem novas colunas (sim, são granuladas por linha)

COMMIT;
```

### Atualização de tipos
- Regenerar `src/lib/supabase/database.types.ts` após migration

## Constraints / NÃO fazer
- ❌ NÃO mover colunas específicas de `early_payout` (essas continuam em `payload jsonb`)
- ❌ NÃO criar tabela separada `general_support_tickets` (multiplica RLS sem ganho)
- ❌ NÃO permitir UPDATE de `assigned_admin_id` por requester (RLS já bloqueia: só ADMIN escreve)
- ❌ NÃO indexar `description` com btree (não escala em texto livre)

## Convenções
- Aspas duplas em `"createdAt"`/`"updatedAt"` (convenção do projeto)
- Enum em snake_case
- Migration via psql; database.types.ts regenerado
- Reuse de pg_trgm (já usado em busca de catálogo, T-062 — confirmar)
$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-137 [DATA] — Tabela support_ticket_messages
-- ============================================================
('7672945f-d686-489b-a2a7-0326272745dd',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-137',
 'Criar support_ticket_messages com histórico bidirecional ADMIN ↔ solicitante',
$desc$## Objetivo
Armazenar histórico de mensagens entre ADMIN e solicitante (CLIENTE ou PRESTADOR)
dentro de um ticket de suporte. Permite que o detalhe do ticket (AC #2) renderize
a conversa cronologicamente. Mensagens iniciais (descrição submetida pelo
solicitante) também entram aqui — não duplicar com `support_tickets.description`
(esse fica como snapshot do que abriu o ticket).

## Contexto
Módulo SUPORTE — depende de T-136 (support_tickets estendido). Consumido por
T-140 (GET detalhe), T-144 (UI sheet detalhe). Não é canal de chat realtime
(MVP só admin vê via reload no detalhe ou ao mudar status). Realtime fica como
incremento futuro fora desta US.

## Estado atual / O que substitui
Não existe. Primeira ferramenta de troca multi-mensagem dentro de ticket.
Não confundir com `messages` do chat cliente↔prestador (US-025 conversation),
que é outro contexto (intra-serviço, não suporte).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_support_ticket_messages.sql`
```sql
BEGIN;

CREATE TABLE support_ticket_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES auth.users(id),
  author_role     text NOT NULL CHECK (author_role IN ('admin', 'requester')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  internal_note   boolean NOT NULL DEFAULT false, -- true = só admins veem (notas internas)
  attachments     jsonb NULL, -- [{ url, filename, mime, size }]
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_ticket_messages_ticket_created
  ON support_ticket_messages (ticket_id, "createdAt");

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Requester vê mensagens públicas do próprio ticket
CREATE POLICY "requester_read_public" ON support_ticket_messages
  FOR SELECT
  USING (
    internal_note = false
    AND ticket_id IN (
      SELECT id FROM support_tickets WHERE requester_id = auth.uid()
    )
  );

-- Requester pode INSERIR mensagem em ticket próprio (não pode pôr internal_note=true)
CREATE POLICY "requester_insert_own" ON support_ticket_messages
  FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND author_role = 'requester'
    AND internal_note = false
    AND ticket_id IN (
      SELECT id FROM support_tickets WHERE requester_id = auth.uid()
    )
  );

-- ADMIN vê tudo
CREATE POLICY "admin_all" ON support_ticket_messages
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;
```

## Constraints / NÃO fazer
- ❌ NÃO permitir UPDATE/DELETE (mensagens são imutáveis — auditoria); sem policy de update
- ❌ NÃO usar `messages` (US-025) — escopo diferente, RLS diferente
- ❌ NÃO permitir requester ver `internal_note=true`
- ❌ NÃO permitir requester escrever `internal_note=true` (já tratado em CHECK + WITH CHECK)

## Convenções
- `attachments jsonb` (URLs de Storage; bucket existe em outro contexto — provisionamento fica em task de ops futuro se ainda não há bucket de support)
- `body` limitado a 5000 chars (texto longo deve virar anexo)
- Sem trigger de updatedAt (linha imutável)
$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-138 [DATA] — Tabela support_ticket_events (auditoria de transições)
-- ============================================================
('d643fc63-a65e-42d7-a379-93356216279b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-138',
 'Criar support_ticket_events (log imutável de transições de status)',
$desc$## Objetivo
Manter log auditável de transições de status (`open → in_review → resolved/closed`)
e atribuições de ADMIN, com `actor_id`, `at`, payload de contexto. Sustenta AC #3
(quando ADMIN marca "em análise", outros admins vêem que já está em atendimento)
e AC #4 (cronologia para SLA).

## Contexto
Módulo SUPORTE — depende de T-136. Consumido por T-141 (PATCH status grava evento)
e T-140 (detalhe lê eventos). Padrão de log imutável já usado em
`provider_suspension_events` (T-035, US-008) e `service_events` (vai ser criado
no módulo EXECUCAO).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_support_ticket_events.sql`
```sql
BEGIN;

CREATE TYPE support_ticket_event_kind AS ENUM (
  'opened',
  'assigned',          -- algum admin pegou pra si (admin_status -> in_review)
  'unassigned',
  'status_changed',    -- transição genérica (in_review → resolved, etc)
  'message_sent',      -- (opcional, log de mensagens — pode ficar derivado)
  'reopened'
);

CREATE TABLE support_ticket_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  kind          support_ticket_event_kind NOT NULL,
  actor_id      uuid NULL REFERENCES auth.users(id), -- NULL = sistema
  actor_role    text NOT NULL CHECK (actor_role IN ('admin','requester','system')),
  from_status   support_ticket_admin_status NULL,
  to_status     support_ticket_admin_status NULL,
  payload       jsonb NULL, -- contexto extra (motivo, mensagem associada, etc)
  "createdAt"   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_ticket_events_ticket_created
  ON support_ticket_events (ticket_id, "createdAt" DESC);

ALTER TABLE support_ticket_events ENABLE ROW LEVEL SECURITY;

-- Requester vê eventos do próprio ticket
CREATE POLICY "requester_read_own_ticket_events" ON support_ticket_events
  FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets WHERE requester_id = auth.uid()
    )
  );

-- ADMIN vê tudo
CREATE POLICY "admin_all" ON support_ticket_events
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- INSERT só via service_role (RPC do PATCH status); negar INSERT direto

COMMIT;
```

## Constraints / NÃO fazer
- ❌ NÃO permitir UPDATE/DELETE (linha imutável; auditoria)
- ❌ NÃO permitir INSERT por requester (só RPC `assign_support_ticket` / `set_support_ticket_status`)
- ❌ NÃO derivar SLA daqui — SLA é `support_tickets."createdAt"` + threshold. Eventos só registram transições.

## Convenções
- Padrão consistente com `provider_suspension_events` (T-035)
- Sem trigger updatedAt (imutável)
$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-139 [API] — GET /api/admin/support/tickets (lista paginada admin)
-- ============================================================
('a6083b90-a41a-4557-8b92-631bcf817be1',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-139',
 'Implementar GET /api/admin/support/tickets (lista admin com filtros, busca, paginação)',
$desc$## Objetivo
Endpoint admin que lista tickets de suporte geral (kind='general_support') com
filtros por `problem_type`, `admin_status`, busca textual em `description`,
ordenação por `createdAt` ou proximidade de SLA, e paginação por cursor (limit
20). Cobre AC #1 (painel centralizado com listagem ordenável + filtros + busca)
e suporta AC #5 (UI usa esse endpoint para skeleton/empty/infinite scroll).

## Contexto
Módulo SUPORTE — consumido por T-143 (UI lista). Pattern de cursor pagination
já estabelecido em T-129 (wallet/extract) e T-130 (history). Endpoint protegido
por verificação de role admin via `auth.jwt().app_metadata.role` (consistente
com `lib/roles.ts`).

## Estado atual / O que substitui
Não existe. Novo endpoint admin.

## O que criar

### `src/app/api/admin/support/tickets/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';

const Query = z.object({
  problem_type: z.enum(['service','payment','technical_error','feedback','other']).optional(),
  admin_status: z.enum(['open','in_review','resolved','closed']).optional(),
  q: z.string().max(120).optional(),
  order_by: z.enum(['created_desc','sla_proximity']).default('created_desc'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const params = Query.parse(Object.fromEntries(url.searchParams));
  const supabase = await createClient();

  let query = supabase
    .from('support_tickets')
    .select('id, problem_type, admin_status, description, "createdAt", '
          + 'service_request_id, requester_id, assigned_admin_id, '
          + 'requester:auth.users!requester_id(email)', { count: 'exact' })
    .eq('kind', 'general_support')
    .limit(params.limit + 1); // +1 para detectar próxima página

  if (params.problem_type) query = query.eq('problem_type', params.problem_type);
  if (params.admin_status) query = query.eq('admin_status', params.admin_status);
  if (params.q) query = query.ilike('description', `%${params.q}%`);

  // Ordenação: SLA proximity = (NOW() - createdAt) próximo de threshold; mais simples = createdAt ASC quando filtra status=open
  if (params.order_by === 'sla_proximity') {
    query = query.order('createdAt', { ascending: true });
  } else {
    query = query.order('createdAt', { ascending: false });
  }

  if (params.cursor) {
    // cursor = base64(createdAt iso)
    const cursorTs = Buffer.from(params.cursor, 'base64').toString('utf8');
    query = params.order_by === 'sla_proximity'
      ? query.gt('createdAt', cursorTs)
      : query.lt('createdAt', cursorTs);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).slice(0, params.limit);
  const nextCursor = (data?.length ?? 0) > params.limit
    ? Buffer.from(items[items.length - 1].createdAt).toString('base64')
    : null;

  return Response.json({ items, nextCursor });
}
```

### Helper `requireAdmin`
- Verifica claim `app_metadata.role === 'admin'`; throw 403 caso contrário
- Provavelmente já existe em `lib/auth/`; se não, criar como parte desta task (1 linha)

## Constraints / NÃO fazer
- ❌ NÃO confiar em filtro do cliente para autenticação — RLS bloqueia mas o endpoint é admin-only por contrato
- ❌ NÃO retornar `description` truncada no list (front decide o trimming visual)
- ❌ NÃO usar OFFSET pagination (problema de drift quando há inserts; cursor é o padrão Zelar)
- ❌ NÃO incluir mensagens no list (vai em T-140 detail)

## Convenções
- Cursor pagination padronizado com T-129/T-130
- Zod no servidor (`INPUT_VALIDATION` flag)
- Ordem default: `created_desc` (tickets novos primeiro)
- `order_by=sla_proximity` retorna mais antigos primeiro (mais próximos de violar SLA)
$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','RLS_REQUIRED','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-140 [API] — GET /api/admin/support/tickets/[id] (detalhe)
-- ============================================================
('11808cd3-76ed-4e3c-8491-e9fba71f4089',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-140',
 'Implementar GET /api/admin/support/tickets/[id] (detalhe + solicitante + mensagens + eventos)',
$desc$## Objetivo
Retornar detalhe completo de um ticket: dados do ticket + perfil do solicitante
(nome, telefone, persona, e-mail) + serviço relacionado quando informado +
histórico de mensagens (T-137) + eventos (T-138). Cobre AC #2 (ADMIN vê no
detalhe tipo, descrição, serviço relacionado, histórico, dados solicitante).

## Contexto
Módulo SUPORTE — consumido por T-144 (UI sheet detalhe). Faz JOIN com
`client_profiles` ou `provider_profiles` conforme a persona do `requester_id`
(detectar via lookup em ambas; ou via `auth.users.raw_app_meta_data->'role'`).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/support/tickets/[id]/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await requireAdmin();
  const supabase = await createClient();

  // Ticket
  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', params.id)
    .single();
  if (error || !ticket) return Response.json({ error: 'not_found' }, { status: 404 });

  // Mensagens
  const { data: messages } = await supabase
    .from('support_ticket_messages')
    .select('*')
    .eq('ticket_id', params.id)
    .order('createdAt', { ascending: true });

  // Eventos
  const { data: events } = await supabase
    .from('support_ticket_events')
    .select('*')
    .eq('ticket_id', params.id)
    .order('createdAt', { ascending: false });

  // Solicitante: tentar provider_profiles depois client_profiles
  const requester = await fetchRequesterProfile(supabase, ticket.requester_id);

  // Serviço relacionado (opcional)
  let serviceRequest = null;
  if (ticket.service_request_id) {
    const { data } = await supabase
      .from('service_requests')
      .select('id, status, scheduled_at, problem_summary, client_id, provider_id')
      .eq('id', ticket.service_request_id)
      .single();
    serviceRequest = data;
  }

  return Response.json({ ticket, requester, serviceRequest, messages, events });
}

async function fetchRequesterProfile(supabase, userId: string) {
  // Busca em provider_profiles primeiro
  const { data: provider } = await supabase
    .from('provider_profiles')
    .select('user_id, display_name, phone, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();
  if (provider) return { ...provider, persona: 'PRESTADOR' };
  // Senão client_profiles
  const { data: client } = await supabase
    .from('client_profiles')
    .select('user_id, display_name, phone, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();
  if (client) return { ...client, persona: 'CLIENTE' };
  return null;
}
```

## Constraints / NÃO fazer
- ❌ NÃO retornar `auth.users` direto (use perfis)
- ❌ NÃO incluir mensagens com `internal_note=true` em respostas que o requester pudesse acessar — esse endpoint é admin-only (RLS já bloqueia, mas reforçar via filtro client-side da UI requester)
- ❌ NÃO fazer JOIN agressivo em SQL (preferir múltiplas queries por clareza; perf não é gargalo neste volume)
- ❌ NÃO retornar `payload` raw de service_request (só campos necessários para o detalhe do ticket)

## Convenções
- Endpoint admin-only
- 404 quando ticket não existe
- Sem cache (admin precisa de dados frescos)
$desc$,
 'API', 'ADMIN', ARRAY['RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-141 [API] — PATCH /api/admin/support/tickets/[id]/status
-- ============================================================
('cf90e0c6-bada-4d01-8b8f-eef433de000a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-141',
 'Implementar PATCH /api/admin/support/tickets/[id]/status (atribuir + transitar)',
$desc$## Objetivo
Permitir que ADMIN marque ticket como `in_review` (atribuindo a si próprio),
`resolved` (com nota de resolução) ou `closed`, com validação de transição,
registro em `support_ticket_events` (T-138) e disparo da notificação ao
solicitante (via T-142). Cobre AC #3 (ADMIN marca "em análise" → solicitante
recebe notificação externa, ticket fica visível como em atendimento).

## Contexto
Módulo SUPORTE — consumido por T-144 (UI sheet detalhe ações). Usa RPC para
garantir atomicidade UPDATE + INSERT em events (transação). Notificação é
**enfileirada**, não síncrona (módulo NOTIFICACAO já existente — T-042 usou
mesmo padrão).

## Estado atual / O que substitui
Não existe.

## O que criar

### RPC `set_support_ticket_admin_status`
```sql
-- supabase/migrations/<YYYYMMDD>_zelar_v2_support_ticket_status_rpc.sql
CREATE OR REPLACE FUNCTION set_support_ticket_admin_status(
  p_ticket_id uuid,
  p_new_status support_ticket_admin_status,
  p_actor_id uuid,
  p_resolution_note text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current support_ticket_admin_status;
  v_assigned uuid;
BEGIN
  SELECT admin_status, assigned_admin_id INTO v_current, v_assigned
  FROM support_tickets WHERE id = p_ticket_id FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Validar transição
  IF NOT (
    (v_current = 'open'      AND p_new_status IN ('in_review','closed'))
    OR (v_current = 'in_review' AND p_new_status IN ('resolved','closed','open'))
    OR (v_current = 'resolved'  AND p_new_status = 'open') -- reabertura
  ) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = 'P0001';
  END IF;

  -- Atribuir ao admin que pegou (in_review) ou desatribuir
  UPDATE support_tickets SET
    admin_status = p_new_status,
    assigned_admin_id = CASE
      WHEN p_new_status = 'in_review' THEN p_actor_id
      WHEN p_new_status = 'open' THEN NULL
      ELSE assigned_admin_id
    END,
    assigned_at = CASE WHEN p_new_status = 'in_review' THEN NOW() ELSE assigned_at END,
    resolved_at = CASE WHEN p_new_status = 'resolved' THEN NOW() ELSE NULL END,
    resolution_note = CASE WHEN p_new_status = 'resolved' THEN p_resolution_note ELSE resolution_note END,
    "updatedAt" = NOW()
  WHERE id = p_ticket_id;

  -- Registrar evento
  INSERT INTO support_ticket_events
    (ticket_id, kind, actor_id, actor_role, from_status, to_status, payload)
  VALUES
    (p_ticket_id,
     CASE WHEN p_new_status = 'in_review' THEN 'assigned'::support_ticket_event_kind
          WHEN p_new_status = 'open' AND v_current = 'in_review' THEN 'unassigned'::support_ticket_event_kind
          ELSE 'status_changed'::support_ticket_event_kind
     END,
     p_actor_id, 'admin', v_current, p_new_status,
     CASE WHEN p_resolution_note IS NOT NULL THEN jsonb_build_object('resolution_note', p_resolution_note) ELSE NULL END);

  RETURN json_build_object('ticket_id', p_ticket_id, 'admin_status', p_new_status);
END $$;
```

### `src/app/api/admin/support/tickets/[id]/status/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { enqueueNotification } from '@/lib/notifications/queue'; // ver T-142

const Body = z.object({
  status: z.enum(['in_review','resolved','closed','open']),
  resolution_note: z.string().max(2000).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const adminUser = await requireAdmin();
  const body = Body.parse(await req.json());
  if (body.status === 'resolved' && !body.resolution_note) {
    return Response.json({ error: 'resolution_note_required' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_support_ticket_admin_status', {
    p_ticket_id: params.id,
    p_new_status: body.status,
    p_actor_id: adminUser.id,
    p_resolution_note: body.resolution_note ?? null,
  });
  if (error) {
    if (error.code === 'P0001') return Response.json({ error: 'invalid_transition' }, { status: 409 });
    if (error.code === 'P0002') return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  // Enfileira notificação para o solicitante (não bloqueia resposta)
  await enqueueNotification({
    kind: 'support_ticket_status_changed',
    ticket_id: params.id,
    new_status: body.status,
  });
  return Response.json(data);
}
```

## Constraints / NÃO fazer
- ❌ NÃO permitir transição livre (FSM curta acima é a única válida)
- ❌ NÃO enviar notificação inline (bloqueia, atrasa, falha cascata) — sempre enfileira
- ❌ NÃO permitir `resolved` sem `resolution_note` (validação Zod no servidor + check no client)
- ❌ NÃO atualizar `support_tickets` direto via supabase.from().update() — usar RPC para atomicidade

## Convenções
- RPC SECURITY DEFINER (já admin pelo endpoint, RPC só garante atomicidade)
- Erros HTTP padronizados: 400/404/409/500
- Notificação via fila (NOTIFICACAO module)
$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-142 [API] — Notificar solicitante ao mudar status
-- ============================================================
('945acbaa-ba26-4a6d-8492-aebd55b0569f',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-142',
 'Notificar solicitante (canal externo) ao mudar status do ticket de suporte',
$desc$## Objetivo
Disparar notificação externa (push web / email / WhatsApp conforme preferência)
ao solicitante quando ADMIN transita ticket para `in_review` ou `resolved`,
contendo número do protocolo, status e link curto. Cobre parte de AC #3
(solicitante recebe notificação externa de confirmação ao admin marcar como
"em análise").

## Contexto
Módulo SUPORTE consumindo módulo NOTIFICACAO. Padrão idêntico a T-042 (US-008,
notificar prestador em decisão de contestação) e T-009 (notificar PRESTADOR ao
aprovar KYC). Plataforma de notificação genérica: enfileira evento, worker do
módulo NOTIFICACAO (a ser detalhado em sua US própria) entrega.

## Estado atual / O que substitui
Não existe template para `support_ticket_status_changed`. Plataforma de
notificação assumida pronta (ou stub que registra em audit log se ainda não
implementada — mesma assumption das outras tasks de notificação).

## O que criar

### Helper `enqueueNotification` (provavelmente já existe — verificar)
Em `src/lib/notifications/queue.ts`:
```typescript
import { createAdminClient } from '@/lib/supabase/admin';

type Payload =
  | { kind: 'support_ticket_status_changed'; ticket_id: string; new_status: string }
  | { kind: 'kyc_approved'; provider_id: string }
  | ...; // outros já existentes

export async function enqueueNotification(payload: Payload) {
  const supabase = createAdminClient();
  await supabase.from('notification_queue').insert({
    kind: payload.kind,
    payload,
    status: 'pending',
  });
}
```

### Template do evento `support_ticket_status_changed`
- Worker de NOTIFICACAO lê `notification_queue`, detecta kind, monta mensagem:
  - `in_review`: "Olá! Seu ticket #{protocol} agora está em análise. Vamos te atualizar em breve."
  - `resolved`: "Seu ticket #{protocol} foi resolvido. Veja os detalhes em <link>."
  - `closed`: (opcional, talvez só email)
- Canal: respeitar preferência do solicitante (push web / email)
- Idempotência: usar `(ticket_id, new_status)` como dedup key

## Constraints / NÃO fazer
- ❌ NÃO chamar Resend / WhatsApp diretamente daqui (responsabilidade do worker NOTIFICACAO)
- ❌ NÃO bloquear endpoint PATCH se enqueue falha (logar e seguir; worker tem retry)
- ❌ NÃO incluir descrição do ticket no payload do push (privacy)
- ❌ NÃO enviar duplicado se status oscila (in_review → open → in_review): worker deve dedupe ou enviar com cooldown

## Convenções
- Reuse de `notification_queue` (assumido criado em outra US do módulo NOTIFICACAO)
- Padrão `kind: snake_case` consistente
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-143 [UI] — Tela /admin/support/tickets (lista admin)
-- ============================================================
('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-143',
 'Renderizar /admin/support/tickets com filtros, busca, infinite scroll e badge SLA',
$desc$## Objetivo
Tela admin que lista tickets de suporte geral com filtros (tipo, status), busca
textual, infinite scroll, skeleton de carregamento, estado vazio, e badge visual
de SLA (verde/amarelo/vermelho conforme proximidade do prazo). Tap em ticket
abre `ResponsiveSheet` de detalhe (T-144). Cobre AC #1 (painel + filtros + busca),
AC #4 (indicador SLA na listagem) e AC #5 (estados empty/skeleton/scroll sem
layout quebrado).

## Contexto
Módulo SUPORTE — consome T-139 (GET list) e T-145 (helper SLA). Fica em
`src/app/admin/support/tickets/page.tsx`. Reutiliza padrão de admin já
estabelecido (sidebar admin existente). Mobile: admin painel também é
responsivo (admins podem operar do celular).

## Estado atual / O que substitui
Não existe rota `/admin/support/*`.

## O que criar

### `src/app/admin/support/tickets/page.tsx`
```tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useFieldDebounce } from '@/hooks/use-field-debounce';
import { useSlaStatus } from '@/lib/support/sla'; // T-145
import { TicketDetailSheet } from '@/components/support/TicketDetailSheet'; // T-144

type Filters = { problem_type?: string; admin_status?: string; q?: string; order_by: 'created_desc'|'sla_proximity' };

export default function SupportTicketsPage() {
  const [filters, setFilters] = useState<Filters>({ order_by: 'created_desc' });
  const debouncedQ = useFieldDebounce(filters.q ?? '', 300);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { items, loading, hasMore, loadMore, empty } = useTicketList({ ...filters, q: debouncedQ });

  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-semibold">Tickets de suporte</h1>

      <FormBody density="compact" className="mt-4">
        <Field.Row cols={3}>
          <Field name="q"><Field.Label>Buscar</Field.Label>
            <Field.Control><Input placeholder="texto na descrição..." value={filters.q ?? ''} onChange={e => setFilters(f => ({...f, q: e.target.value}))} /></Field.Control>
          </Field>
          <Field name="type"><Field.Label>Tipo</Field.Label>
            <Field.Control><Select value={filters.problem_type ?? ''} onChange={e => setFilters(f => ({...f, problem_type: e.target.value || undefined}))}>
              <option value="">Todos</option>
              <option value="service">Serviço</option>
              <option value="payment">Pagamento</option>
              <option value="technical_error">Erro técnico</option>
              <option value="feedback">Feedback</option>
              <option value="other">Outros</option>
            </Select></Field.Control>
          </Field>
          <Field name="status"><Field.Label>Status</Field.Label>
            <Field.Control><Select value={filters.admin_status ?? ''} onChange={e => setFilters(f => ({...f, admin_status: e.target.value || undefined}))}>
              <option value="">Todos</option>
              <option value="open">Aberto</option>
              <option value="in_review">Em análise</option>
              <option value="resolved">Resolvido</option>
              <option value="closed">Fechado</option>
            </Select></Field.Control>
          </Field>
        </Field.Row>
      </FormBody>

      <div className="mt-6 flex flex-col gap-3">
        {loading && items.length === 0 && Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-24" />)}
        {empty && <EmptyState />}
        {items.map(t => (
          <TicketRow key={t.id} ticket={t} onClick={() => setSelectedId(t.id)} />
        ))}
        {hasMore && <InfiniteScrollSentinel onIntersect={loadMore} />}
      </div>

      {selectedId && <TicketDetailSheet ticketId={selectedId} onClose={() => setSelectedId(null)} />}
    </main>
  );
}

function TicketRow({ ticket, onClick }) {
  const sla = useSlaStatus(ticket.createdAt); // 'ok' | 'warning' | 'breached'
  return (
    <Card onClick={onClick} className="cursor-pointer p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge>{labelType(ticket.problem_type)}</Badge>
          <StatusChip status={ticket.admin_status}>{labelStatus(ticket.admin_status)}</StatusChip>
          <SlaBadge level={sla} />
        </div>
        <span className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm">{ticket.description}</p>
      {ticket.assigned_admin_id && <p className="mt-1 text-xs text-muted-foreground">Em atendimento por {ticket.assigned_admin?.email}</p>}
    </Card>
  );
}
```

### `useTicketList` hook
- Cursor pagination via `/api/admin/support/tickets`
- Acumula items, expõe `loadMore`, `loading`, `hasMore`, `empty`

### `SlaBadge` component
- 3 níveis: verde (>50% do SLA restante), amarelo (<50%), vermelho (vencido)
- Usa `useSlaStatus` (T-145)

## Reuso
- `Card`, `Skeleton`, `Badge`, `StatusChip`, `Field`/`FormBody`/`Input`/`Select` (UI)
- `useFieldDebounce` (hooks)
- Padrão de cursor pagination de T-132/T-134 (provider wallet/history)
- Sidebar admin existente (layout pai)

## Constraints / NÃO fazer
- ❌ NÃO usar `<Dialog>` ou `<Sheet>` cru — `ResponsiveSheet` em T-144
- ❌ NÃO buscar dados do solicitante na listagem (vai em detalhe; lista mostra só email)
- ❌ NÃO usar OFFSET pagination (cursor é o padrão)
- ❌ NÃO renderizar mais de `description` `line-clamp-2` (texto longo abre no sheet)
- ❌ NÃO usar window.confirm para nenhuma ação (todas via sheet/dialog)

## Convenções
- Mobile-first (admin pode usar mobile)
- Sonner toast para erros de fetch
- `qualityFlags`: REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK, FIELD_COMPOUND_API, INFINITE_SCROLL, MOBILE_FIRST
$desc$,
 'UI', NULL,
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','INFINITE_SCROLL','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-144 [UI] — TicketDetailSheet (ResponsiveSheet)
-- ============================================================
('083f5b67-0c41-40f8-b540-72b3d9b81b79',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-144',
 'Renderizar ResponsiveSheet de detalhe do ticket com histórico, ações e composer admin',
$desc$## Objetivo
Sheet (desktop side / mobile bottom 90dvh) que exibe detalhe completo do ticket:
informações do solicitante (nome, foto, persona, telefone, email), tipo,
descrição inicial, serviço relacionado quando informado, histórico de mensagens
em ordem cronológica, eventos de auditoria, e ações de ADMIN: marcar "Em análise",
"Resolver" (com nota), "Reabrir", "Fechar". Cobre AC #2 (detalhe completo)
e fecha AC #3 (ação de marcar em análise) e AC #4 (visualização do SLA no header).

## Contexto
Módulo SUPORTE — consome T-140 (GET detail), T-141 (PATCH status), T-145 (helper SLA).
Aciona ConfirmDialog (T-145 ConfirmDialog reuso) para "Resolver" e "Fechar"
(ações com efeito visível ao solicitante).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/support/TicketDetailSheet.tsx`
```tsx
'use client';

import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { useSlaStatus } from '@/lib/support/sla';
import { showErrorToast } from '@/lib/optimistic/toast';
import { fetchOrThrow } from '@/lib/fetch-or-throw';

export function TicketDetailSheet({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { data, mutate, loading } = useTicketDetail(ticketId);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const sla = useSlaStatus(data?.ticket?.createdAt);

  const handleStatus = async (status: 'in_review'|'resolved'|'closed'|'open', note?: string) => {
    try {
      await fetchOrThrow(`/api/admin/support/tickets/${ticketId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolution_note: note }),
      });
      await mutate.refresh();
    } catch (err) {
      showErrorToast({ type: 'patch', id: ticketId }, err);
    }
  };

  return (
    <ResponsiveSheet open={!!ticketId} onOpenChange={(o) => !o && onClose()} size="lg">
      <ResponsiveSheet.Header>
        <div className="flex items-center justify-between">
          <span>Ticket #{shortId(ticketId)}</span>
          <SlaBadge level={sla} />
        </div>
      </ResponsiveSheet.Header>
      <ResponsiveSheet.Body>
        {loading && <DetailSkeleton />}
        {data && (
          <>
            <RequesterCard requester={data.requester} />
            <ProblemBlock ticket={data.ticket} serviceRequest={data.serviceRequest} />
            <MessagesTimeline messages={data.messages} events={data.events} />
            <AdminComposer ticketId={ticketId} onSent={mutate.refresh} />
          </>
        )}
      </ResponsiveSheet.Body>
      <ResponsiveSheet.Footer>
        {data?.ticket?.admin_status === 'open' && (
          <Button onClick={() => handleStatus('in_review')}>Marcar em análise</Button>
        )}
        {data?.ticket?.admin_status === 'in_review' && (
          <>
            <Button variant="default" onClick={() => setConfirm({
              title: 'Resolver ticket?',
              description: 'Solicitante será notificado.',
              confirmLabel: 'Resolver',
              onConfirm: async () => {
                const note = await promptNote(); // sub-sheet ou inline form
                await handleStatus('resolved', note);
              },
            })}>Resolver</Button>
            <Button variant="ghost" onClick={() => handleStatus('open')}>Devolver pra fila</Button>
          </>
        )}
        {data?.ticket?.admin_status === 'resolved' && (
          <Button variant="ghost" onClick={() => handleStatus('open')}>Reabrir</Button>
        )}
      </ResponsiveSheet.Footer>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </ResponsiveSheet>
  );
}
```

### `useTicketDetail`
- GET `/api/admin/support/tickets/[id]`
- `mutate.refresh()` re-fetch
- `mutate.sendMessage(body, internal_note)` POST em endpoint de mensagens (se MVP cobrir; senão, deferred)

## Reuso
- `ResponsiveSheet` (size="lg") — edição rica
- `ConfirmDialog` — ação destrutiva (resolver é semi-destrutiva; reabrir não)
- `Field`/`FormBody`/`Textarea` — composer
- `Button` — ações
- `useSlaStatus` (T-145)
- `showErrorToast`, `fetchOrThrow` — error handling padronizado

## Constraints / NÃO fazer
- ❌ NÃO `window.confirm` para resolver/fechar (use `ConfirmDialog`)
- ❌ NÃO permitir resolver sem nota de resolução (form inline com Textarea required)
- ❌ NÃO renderizar `internal_note=true` lado solicitante (admin sheet é admin-only por rota)
- ❌ NÃO chamar PATCH/GET com setState direto após — use refresh do hook
- ❌ NÃO criar dialog cru shadcn (sempre via ResponsiveSheet/ResponsiveDialog)

## Convenções
- Mobile-first (90dvh em mobile)
- Sonner em erro
- Empty/skeleton states em loading
- `qualityFlags`: REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK, RESPONSIVE_SHEET_REQUIRED, CONFIRM_DIALOG_REQUIRED, FIELD_COMPOUND_API, MOBILE_FIRST
$desc$,
 'UI', NULL,
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================
-- T-145 [OPS] — Seed app_config.support_sla_hours + helper useSlaStatus
-- ============================================================
('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e440d22e-bc36-425f-acef-94f72ddb5f5e',
 'ZLAR-V2-T-145',
 'Seedar app_config.support_sla_hours + helper useSlaStatus (ok/warning/breached)',
$desc$## Objetivo
Adicionar parâmetro configurável `support_sla_hours` (default 48h conforme AC #4)
em `app_config` (já existente) e helper TS `useSlaStatus(opened_at)` que retorna
`'ok' | 'warning' | 'breached'` consumido por T-143 (badge na lista) e T-144
(badge no header do sheet). Cobre AC #4 (SLA 48h com indicador visual de
proximidade — destaque na listagem).

## Contexto
Módulo SUPORTE / OPS — `app_config` foi seedada em outras US. Esta task só
adiciona uma chave + helper. Mantém SLA configurável sem deploy (admin pode
ajustar via futura UI de US-019).

## Estado atual / O que substitui
`app_config` existe (criada em US prévia, possivelmente T-064 ou similar).
`support_sla_hours` não existe. Helper `useSlaStatus` não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_support_sla_config.sql`
```sql
INSERT INTO app_config (key, value, description) VALUES
  ('support_sla_hours', '48'::jsonb, 'SLA padrão em horas para resposta de ticket de suporte geral (AC US-018)')
ON CONFLICT (key) DO NOTHING;
```

### `src/lib/support/sla.ts`
```typescript
'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

export type SlaLevel = 'ok' | 'warning' | 'breached';

export function useSlaStatus(openedAt: string | undefined): SlaLevel {
  const [slaHours, setSlaHours] = useState<number>(48);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase
      .from('app_config')
      .select('value')
      .eq('key', 'support_sla_hours')
      .single()
      .then(({ data }) => {
        if (data?.value) setSlaHours(Number(data.value));
      });
  }, []);

  if (!openedAt) return 'ok';
  const ageHours = (Date.now() - new Date(openedAt).getTime()) / 36e5;
  if (ageHours > slaHours) return 'breached';
  if (ageHours > slaHours * 0.5) return 'warning';
  return 'ok';
}
```

### `src/components/support/SlaBadge.tsx`
```tsx
import { Badge } from '@/components/ui/badge';

export function SlaBadge({ level }: { level: 'ok'|'warning'|'breached' }) {
  const map = {
    ok:       { label: 'No prazo',      className: 'bg-emerald-100 text-emerald-700' },
    warning:  { label: 'Próximo SLA',   className: 'bg-amber-100 text-amber-800' },
    breached: { label: 'SLA vencido',   className: 'bg-rose-100 text-rose-700' },
  };
  const cfg = map[level];
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}
```

## Constraints / NÃO fazer
- ❌ NÃO hardcode 48h em código (sempre ler de app_config)
- ❌ NÃO calcular SLA no servidor para listagem (passa `createdAt` cru, client calcula com slaHours cacheado)
- ❌ NÃO criar tabela nova (`support_sla_config`) — `app_config` é o lugar
- ❌ NÃO bloquear render do badge esperando fetch (default 48h até carregar)

## Convenções
- Reuso de `app_config` pattern
- Helper client-side (admin painel é authenticated, leitura permitida pela RLS de app_config)
- `qualityFlags`: REUSE_EXISTING_HOOK (não cria hook genérico novo)
$desc$,
 'OPS', 'ANY',
 ARRAY['REUSE_EXISTING_HOOK'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- ============================================================
-- 2. Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- ============================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id
FROM (VALUES
  -- AC1: painel listagem com filtros e busca
  ('981174d0-ebca-4e91-b85b-eb020f032984'::uuid, 1), -- T-136 schema/índices
  ('a6083b90-a41a-4557-8b92-631bcf817be1'::uuid, 1), -- T-139 GET list
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6'::uuid, 1), -- T-143 UI lista

  -- AC2: detalhe com tipo, descrição, serviço, histórico, dados solicitante
  ('981174d0-ebca-4e91-b85b-eb020f032984'::uuid, 2), -- T-136 (tipo, descrição)
  ('7672945f-d686-489b-a2a7-0326272745dd'::uuid, 2), -- T-137 mensagens
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089'::uuid, 2), -- T-140 GET detail
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79'::uuid, 2), -- T-144 UI sheet detail

  -- AC3: marcar em análise + notif + visível como em atendimento
  ('d643fc63-a65e-42d7-a379-93356216279b'::uuid, 3), -- T-138 events (auditoria)
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a'::uuid, 3), -- T-141 PATCH status
  ('945acbaa-ba26-4a6d-8492-aebd55b0569f'::uuid, 3), -- T-142 notify
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79'::uuid, 3), -- T-144 UI ação
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6'::uuid, 3), -- T-143 lista mostra "em atendimento por X"

  -- AC4: SLA 48h com indicador visual de proximidade + destaque
  ('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2'::uuid, 4), -- T-145 helper sla
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6'::uuid, 4), -- T-143 badge na lista
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79'::uuid, 4), -- T-144 badge no sheet

  -- AC5: empty/skeleton/paginação/scroll infinito sem layout quebrado
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6'::uuid, 5)  -- T-143 cobre estados
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- ============================================================
-- 3. AC-da-Task (checklist técnico) — AcceptanceCriterion(taskId)
-- ============================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  -- T-136 [DATA]
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'Enums support_ticket_problem_type e support_ticket_admin_status criados', 1),
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'Colunas problem_type, description, admin_status, assigned_admin_id, assigned_at, resolved_at, resolution_note adicionadas a support_tickets', 2),
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'CHECK constraint exige problem_type + description NOT NULL quando kind=general_support', 3),
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'Índice parcial (admin_status, createdAt DESC) WHERE admin_status IN (open,in_review)', 4),
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'Índice GIN trigram em description para busca textual', 5),
  ('981174d0-ebca-4e91-b85b-eb020f032984', 'RLS pré-existente cobre novas colunas (smoke: requester vê próprio ticket; admin vê tudo)', 6),

  -- T-137 [DATA]
  ('7672945f-d686-489b-a2a7-0326272745dd', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('7672945f-d686-489b-a2a7-0326272745dd', 'Tabela support_ticket_messages criada com FK ticket_id ON DELETE CASCADE', 1),
  ('7672945f-d686-489b-a2a7-0326272745dd', 'CHECK constraint em author_role IN (admin, requester) e body length 1..5000', 2),
  ('7672945f-d686-489b-a2a7-0326272745dd', 'RLS: requester lê só mensagens não-internal_note do próprio ticket', 3),
  ('7672945f-d686-489b-a2a7-0326272745dd', 'RLS: requester insere apenas com author_role=requester e internal_note=false em ticket próprio (smoke)', 4),
  ('7672945f-d686-489b-a2a7-0326272745dd', 'RLS: admin lê e escreve tudo (claim app_metadata.role=admin)', 5),
  ('7672945f-d686-489b-a2a7-0326272745dd', 'Sem policy de UPDATE/DELETE (mensagens imutáveis)', 6),

  -- T-138 [DATA]
  ('d643fc63-a65e-42d7-a379-93356216279b', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('d643fc63-a65e-42d7-a379-93356216279b', 'Enum support_ticket_event_kind criado com 6 valores (opened, assigned, unassigned, status_changed, message_sent, reopened)', 1),
  ('d643fc63-a65e-42d7-a379-93356216279b', 'Tabela support_ticket_events criada com FK ON DELETE CASCADE e índice (ticket_id, createdAt DESC)', 2),
  ('d643fc63-a65e-42d7-a379-93356216279b', 'RLS: requester vê eventos do próprio ticket; admin tudo', 3),
  ('d643fc63-a65e-42d7-a379-93356216279b', 'Sem policy de UPDATE/DELETE (linha imutável; auditoria)', 4),
  ('d643fc63-a65e-42d7-a379-93356216279b', 'INSERT só via RPC de status (smoke: cliente direto sem RPC retorna policy denied)', 5),

  -- T-139 [API]
  ('a6083b90-a41a-4557-8b92-631bcf817be1', 'Endpoint GET /api/admin/support/tickets criado e protegido por requireAdmin (403 se não-admin)', 0),
  ('a6083b90-a41a-4557-8b92-631bcf817be1', 'Zod valida query params (problem_type, admin_status, q, order_by, cursor, limit) — 400 em formato inválido', 1),
  ('a6083b90-a41a-4557-8b92-631bcf817be1', 'Cursor pagination retorna nextCursor quando há mais; null no fim', 2),
  ('a6083b90-a41a-4557-8b92-631bcf817be1', 'Filtros tipo + status + busca textual funcionam isolados e combinados (smoke)', 3),
  ('a6083b90-a41a-4557-8b92-631bcf817be1', 'order_by=sla_proximity ordena ASC por createdAt (mais antigos primeiro)', 4),
  ('a6083b90-a41a-4557-8b92-631bcf817be1', 'Filtra apenas kind=general_support (não retorna early_payout, dispute)', 5),

  -- T-140 [API]
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', 'Endpoint GET /api/admin/support/tickets/[id] criado e protegido por requireAdmin', 0),
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', 'Retorna 404 quando ticket não existe', 1),
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', 'Resposta inclui ticket, requester (com persona), serviceRequest opcional, messages, events', 2),
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', 'fetchRequesterProfile resolve corretamente provider vs cliente', 3),
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', 'Mensagens vêm em ordem cronológica ASC; eventos em DESC (mais recente no topo)', 4),

  -- T-141 [API]
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'RPC set_support_ticket_admin_status criada com SECURITY DEFINER', 0),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'Endpoint PATCH /api/admin/support/tickets/[id]/status valida body com Zod', 1),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'Transição inválida retorna 409 (ex: closed → resolved)', 2),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'Transição válida atualiza admin_status, assigned_admin_id, assigned_at e/ou resolved_at em mesma transação', 3),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'Evento correspondente é registrado em support_ticket_events na mesma transação (smoke: rollback testa atomicidade)', 4),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'status=resolved sem resolution_note retorna 400', 5),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'Notificação enfileirada após sucesso (não bloqueia resposta)', 6),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'SELECT FOR UPDATE evita corrida quando 2 admins clicam em "em análise" simultaneamente', 7),

  -- T-142 [API]
  ('945acbaa-ba26-4a6d-8492-aebd55b0569f', 'Helper enqueueNotification aceita kind=support_ticket_status_changed', 0),
  ('945acbaa-ba26-4a6d-8492-aebd55b0569f', 'Payload inclui ticket_id e new_status; sem PII no push (privacy)', 1),
  ('945acbaa-ba26-4a6d-8492-aebd55b0569f', 'Falha do enqueue não bloqueia o PATCH de status (try/catch + log)', 2),
  ('945acbaa-ba26-4a6d-8492-aebd55b0569f', 'Dedup key = (ticket_id, new_status) — oscilação rápida não duplica push', 3),
  ('945acbaa-ba26-4a6d-8492-aebd55b0569f', 'Worker NOTIFICACAO consome e respeita preferência do usuário (canal externo)', 4),

  -- T-143 [UI]
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Rota /admin/support/tickets renderiza lista paginada com infinite scroll', 0),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Filtros (tipo, status) e busca textual usam Field compound API + debounce 300ms', 1),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Skeleton aparece durante carregamento inicial (5 cards)', 2),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Estado vazio renderiza mensagem clara quando filtros não retornam resultados', 3),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Cada card mostra tipo (Badge), status (StatusChip), SLA (SlaBadge), data, snippet de descrição (line-clamp-2) e admin atribuído quando houver', 4),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Tap em card abre TicketDetailSheet (T-144)', 5),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Layout não quebra em viewport <768px (mobile-first verificado)', 6),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'Erros de fetch viram Sonner toast com showErrorToast', 7),

  -- T-144 [UI]
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Componente TicketDetailSheet usa ResponsiveSheet size=lg (90dvh em mobile)', 0),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Header mostra protocolo curto + SlaBadge', 1),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Body renderiza requester (nome, persona, telefone, email), tipo, descrição, serviço relacionado, mensagens em ordem cronológica e eventos', 2),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Footer mostra ações conforme admin_status atual (Marcar em análise / Resolver / Reabrir / Devolver pra fila)', 3),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Resolver pede nota de resolução obrigatória via Textarea (Field compound API)', 4),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Resolver e Fechar passam por ConfirmDialog (sem window.confirm)', 5),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Erro de PATCH dispara showErrorToast e mantém estado anterior', 6),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'Refresh após mutation atualiza eventos e admin_status visíveis', 7),

  -- T-145 [OPS]
  ('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'Migration adiciona app_config (key=support_sla_hours, value=48) com ON CONFLICT DO NOTHING', 0),
  ('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'Helper useSlaStatus retorna ok/warning/breached conforme idade do ticket vs slaHours', 1),
  ('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'Threshold de warning = 50% do SLA; breached = idade > slaHours', 2),
  ('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'SlaBadge renderiza com cores distintas (verde/amarelo/vermelho) e label legível', 3),
  ('5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'Helper lê slaHours de app_config no mount (sem hardcode 48)', 4);

-- ============================================================
-- 4. TaskDependency (kind LOWERCASE)
-- ============================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-137 mensagens depende de T-136 schema base
  ('7672945f-d686-489b-a2a7-0326272745dd', '981174d0-ebca-4e91-b85b-eb020f032984', 'blocks'),
  -- T-138 events depende de T-136
  ('d643fc63-a65e-42d7-a379-93356216279b', '981174d0-ebca-4e91-b85b-eb020f032984', 'blocks'),
  -- T-139 GET list depende de T-136
  ('a6083b90-a41a-4557-8b92-631bcf817be1', '981174d0-ebca-4e91-b85b-eb020f032984', 'blocks'),
  -- T-140 GET detail depende de T-136 + T-137 + T-138
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', '981174d0-ebca-4e91-b85b-eb020f032984', 'blocks'),
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', '7672945f-d686-489b-a2a7-0326272745dd', 'blocks'),
  ('11808cd3-76ed-4e3c-8491-e9fba71f4089', 'd643fc63-a65e-42d7-a379-93356216279b', 'blocks'),
  -- T-141 PATCH status depende de T-136 + T-138 (events) + T-142 (notif handler)
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', '981174d0-ebca-4e91-b85b-eb020f032984', 'blocks'),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', 'd643fc63-a65e-42d7-a379-93356216279b', 'blocks'),
  ('cf90e0c6-bada-4d01-8b8f-eef433de000a', '945acbaa-ba26-4a6d-8492-aebd55b0569f', 'blocks'),
  -- T-143 lista depende de T-139 + T-145
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', 'a6083b90-a41a-4557-8b92-631bcf817be1', 'blocks'),
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', '5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'blocks'),
  -- T-143 lista relates_to detail sheet T-144 (lista abre o sheet)
  ('8de3bfc2-034c-44fd-90fd-02bb2a6fc5c6', '083f5b67-0c41-40f8-b540-72b3d9b81b79', 'relates_to'),
  -- T-144 detail depende de T-140 + T-141 + T-145
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', '11808cd3-76ed-4e3c-8491-e9fba71f4089', 'blocks'),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', 'cf90e0c6-bada-4d01-8b8f-eef433de000a', 'blocks'),
  ('083f5b67-0c41-40f8-b540-72b3d9b81b79', '5d3cd629-f1dc-4fd8-b32f-e8c191342cc2', 'blocks'),

  -- relates_to cross-US: support_tickets foi criada em T-125 (US-028)
  ('981174d0-ebca-4e91-b85b-eb020f032984', '499568da-6762-4a51-8d0b-61fd4fe58f3e', 'relates_to');

COMMIT;
