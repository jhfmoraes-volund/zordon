-- Backlog SQL — ZLAR-V2-US-022 (NOTIFICACAO / SISTEMA)
-- "Disparar notificações nos momentos certos da jornada"
-- 8 tasks (3 DATA, 4 API, 1 OPS) — sem UI (persona SISTEMA, exceção válida)

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ---------------------------------------------------------------------------
-- T-159 DATA: notification_events + deliveries + idempotência
-- ---------------------------------------------------------------------------
('4e3b21ff-4655-4998-ae41-d6a96ccceb5e',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-159',
 'Criar notification_events + notification_deliveries com idempotência',
 $desc$## Objetivo
Criar a fila de eventos de notificação e o log imutável de entregas que serve como single source of truth do que foi disparado pra cada usuário em cada canal. A constraint de idempotência (`UNIQUE(event_key)`) garante AC #11 (mesmo evento não duplica em retries internos).

## Contexto
Módulo NOTIFICACAO. Esta tabela é a fundação: todos os pontos da plataforma que precisam notificar (KYC aprovado, FSM transitions, captura de pagamento, liberação T+72h, suspensão de prestador, decisão de disputa) chamam o RPC `enqueue_notification_event` (T-162), que insere uma linha aqui. Edge Function `dispatch-notifications` (T-163) consome esta fila e registra em `notification_deliveries`.

US-024 (plataforma de comunicação) traz **templates** (e-mail Resend, WA Meta) e **registro técnico bruto** dos provedores. Esta US traz a **camada de eventos de domínio** que mapeia eventos→categorias→destinatários→templates de US-024. Não duplicar funções com US-024.

## Estado atual / O que substitui
Não existe sistema de notificação. Tasks existentes em US-001/US-008/US-018/US-026/US-028 já dizem "notificar via canal externo" mas sem implementação — todas vão consumir `enqueue_notification_event` quando US-022 sair.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_events.sql`
```sql
BEGIN;

-- Categoria do evento — define se é "operacional" (passível de opt-out) ou
-- "obrigatório" (KYC, recibo, alerta de disputa, liberação de pagamento,
-- suspensão — sempre enviado por exigência regulatória/financeira).
CREATE TYPE notification_category AS ENUM (
  -- Operacionais (opt-out aplicável)
  'service_accepted',
  'service_step_change',     -- a caminho/chegou/iniciado/concluído
  'service_reminder_24h',
  'service_reminder_2h',
  'service_cancelled',
  'message_new',
  -- Obrigatórias (sempre enviadas)
  'auth_signup_confirmed',
  'kyc_result',
  'payment_receipt',
  'payment_release',
  'service_completed_invoice',
  'dispute_alert',
  'dispute_decision',
  'provider_suspended',
  'provider_appeal_decision',
  'provider_reactivated'
);

CREATE TYPE notification_channel AS ENUM ('email', 'whatsapp', 'web_push');
CREATE TYPE notification_status  AS ENUM ('queued', 'dispatching', 'sent', 'failed', 'skipped_optout');

-- Fila de eventos do domínio. Cada linha = 1 intenção de notificar 1 user
-- por 1 evento de negócio. Channel resolution acontece no dispatcher (T-163)
-- usando notification_preferences (T-160) e fallback chain.
CREATE TABLE notification_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- event_key = chave de idempotência. Convenção:
  --   "<category>:<entity_id>:<actor_id>"
  -- Ex: "kyc_result:<provider_user_id>:<verification_id>"
  --     "service_step_change:<service_id>:on_the_way"
  --     "service_reminder_24h:<service_id>"  (NÃO inclui occurrence — reschedule
  --     deve cancelar o anterior em notification_schedules; reuso de chave
  --     dispara conflito 23505 que o RPC trata como "já enfileirado, ignora")
  event_key       text NOT NULL UNIQUE,
  category        notification_category NOT NULL,
  -- Quem deve receber. Pode ser cliente OU prestador. Nunca admin (admin
  -- só é destinatário de comunicação interna, não desta fila).
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Payload livre — fica disponível pro template renderer no dispatcher.
  -- Ex: { "service_id": "...", "category_name": "...", "scheduled_at": "..." }
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Origem (debug/auditoria) — quem chamou o enqueue.
  source_entity   text,                            -- 'service_request', 'payment', 'kyc_verification', etc.
  source_entity_id uuid,
  -- Status agregado da intenção. Cada tentativa por canal vive em
  -- notification_deliveries. Aqui é só "ainda pendente / já resolvido".
  status          notification_status NOT NULL DEFAULT 'queued',
  -- Canais permitidos pra este evento (controla fallback chain).
  -- Ex: KYC pode tentar [whatsapp, email]; recibo só [email].
  allowed_channels notification_channel[] NOT NULL,
  -- Quando expira (após isso o dispatcher dropa). Importante p/ lembrete 2h
  -- não disparar 30min depois do serviço.
  expires_at      timestamptz,
  enqueued_at     timestamptz NOT NULL DEFAULT NOW(),
  resolved_at     timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX notification_events_status_enq_idx
  ON notification_events(status, enqueued_at)
  WHERE status = 'queued';

CREATE INDEX notification_events_recipient_idx
  ON notification_events(recipient_user_id, enqueued_at DESC);

CREATE INDEX notification_events_source_idx
  ON notification_events(source_entity, source_entity_id);

-- Log de tentativas por canal (1 evento → N deliveries: tentativa primária +
-- fallbacks). Imutável (sem UPDATE permitido após gravação).
CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  channel         notification_channel NOT NULL,
  -- Provider response — id externo (Resend message_id, WA wamid, push id)
  provider_id     text,
  status          notification_status NOT NULL,         -- sent | failed | skipped_optout
  -- Razão técnica do fail (texto curto p/ debug). Não usar pra lógica.
  failure_reason  text,
  template_key    text,                                  -- ref a US-024 (templates)
  attempted_at    timestamptz NOT NULL DEFAULT NOW(),
  -- Anti-tamper.
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX notification_deliveries_event_idx
  ON notification_deliveries(event_id, attempted_at);

CREATE INDEX notification_deliveries_provider_idx
  ON notification_deliveries(provider_id)
  WHERE provider_id IS NOT NULL;

-- Trigger updatedAt em notification_events (deliveries é imutável, sem trigger).
CREATE TRIGGER notification_events_updated_at
  BEFORE UPDATE ON notification_events
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

-- RLS — eventos e deliveries são internos do SISTEMA. Service role escreve
-- e lê; usuários não acessam direto (consultam histórico via RPC se preciso).
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

-- ADMIN lê tudo (dashboard de operação / debug).
CREATE POLICY "notification_events_admin_select" ON notification_events
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "notification_deliveries_admin_select" ON notification_deliveries
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Sem policy pra authenticated genérico — escrita é só via RPC SECURITY
-- DEFINER (T-162) ou service role (Edge Function dispatcher).

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE em `notification_deliveries` (imutável; única exceção é o trigger updatedAt do events)
- ❌ Adicionar policy de SELECT pra authenticated comum aqui (privacidade — não vazar histórico)
- ❌ Reutilizar `event_key` em retentativas — retry é via `notification_deliveries` (mesmo event_id, novo channel/attempt). Reschedule de lembrete cancela e cria novo schedule (T-161), não reusa key
- ❌ Misturar com tabelas de US-024 (`message_templates`, `email_send_log` etc) — esta tabela é eventos de **domínio**, US-024 é envio técnico

## Convenções
- Migration via psql; `database.types.ts` regenerado no repo do produto Zelar
- Aspas em `"createdAt"`, `"updatedAt"` (convenção do projeto)
- ENUM em snake_case
- Índice parcial `WHERE status = 'queued'` minimiza custo da varredura do dispatcher (só ativos)$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-160 DATA: notification_preferences (opt-out)
-- ---------------------------------------------------------------------------
('e6d9d223-3b40-49ba-88fa-b47d8e817ee7',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-160',
 'Criar notification_preferences (opt-out por categoria operacional)',
 $desc$## Objetivo
Permitir que usuário (CLIENTE ou PRESTADOR) opte por não receber notificações operacionais por categoria/canal. Cobre AC #10. Notificações **obrigatórias** (kyc_result, payment_receipt, payment_release, dispute_*, provider_suspended) ignoram preferência por exigência regulatória/financeira — controlado pelo dispatcher (T-163), não no banco.

## Contexto
Módulo NOTIFICACAO. Lida pelo RPC `enqueue_notification_event` (T-162) **antes** de inserir em `notification_events`: se categoria é operacional E user optou-out pra todos os canais permitidos, enfileira com status `skipped_optout` (não dispara, mas registra a decisão). UI de gestão dessas preferências será criada em US futura de "Preferências do usuário" — esta task só cria o dado.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_preferences.sql`
```sql
BEGIN;

-- Por padrão TODAS as categorias operacionais estão ON. Linha aqui = override
-- (opt-out). Categorias obrigatórias não aparecem aqui.
CREATE TABLE notification_preferences (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    notification_category NOT NULL,
  channel     notification_channel  NOT NULL,
  -- false = opt-out neste canal pra esta categoria.
  enabled     boolean NOT NULL DEFAULT false,
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category, channel)
);

CREATE INDEX notification_preferences_user_idx
  ON notification_preferences(user_id);

-- Função helper: dado um user + category + channel, retorna se é "permitido enviar"
-- (true = pode enviar). Categorias obrigatórias bypassam preferência aqui.
CREATE OR REPLACE FUNCTION notification_is_allowed(
  p_user_id uuid,
  p_category notification_category,
  p_channel notification_channel
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pref boolean;
BEGIN
  -- Categorias obrigatórias: sempre permite (regulatório/financeiro).
  IF p_category IN (
    'auth_signup_confirmed',
    'kyc_result',
    'payment_receipt',
    'payment_release',
    'service_completed_invoice',
    'dispute_alert',
    'dispute_decision',
    'provider_suspended',
    'provider_appeal_decision',
    'provider_reactivated'
  ) THEN
    RETURN true;
  END IF;

  -- Operacionais: default ON, override = linha em notification_preferences
  -- com enabled=false.
  SELECT enabled INTO v_pref
  FROM notification_preferences
  WHERE user_id = p_user_id
    AND category = p_category
    AND channel = p_channel;

  -- Sem linha → default ON.
  RETURN COALESCE(v_pref, true);
END;
$$;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Owner gerencia suas próprias prefs.
CREATE POLICY "notification_preferences_owner_all" ON notification_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin lê tudo (debug).
CREATE POLICY "notification_preferences_admin_select" ON notification_preferences
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Listar categorias obrigatórias hardcoded em UI futura — derivar da função `notification_is_allowed` (única source of truth)
- ❌ Default `enabled=true` na coluna implicaria preencher linha pra cada user × category × channel no signup. Padrão é "ausência de linha = ON"
- ❌ Permitir admin escrever preferências de outro user (gates de privacidade — admin só lê)
- ❌ Adicionar coluna `quiet_hours` aqui (escopo de US futura, não no MVP)

## Convenções
- Função `SECURITY DEFINER` com `search_path = public, pg_temp` (anti-injection conforme Supabase best practices)
- PK composta evita duplicidade
- Trigger `updatedAt` reusa `moddatetime` (já existente no projeto)$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-161 DATA: notification_schedules (lembretes)
-- ---------------------------------------------------------------------------
('f83559dd-afa2-4d16-b010-8e7cd82878ca',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-161',
 'Criar notification_schedules (lembretes 24h/2h com cancelamento)',
 $desc$## Objetivo
Tabela de lembretes futuros que serão materializados em `notification_events` no momento certo. Cobre AC #3 (lembretes 24h e 2h antes da data agendada, sem duplicar em remarcação) e AC #8 (cancelar lembretes pendentes quando serviço é cancelado).

## Contexto
Módulo NOTIFICACAO. Quando um `service_request` entra em status agendado (`scheduled`), o trigger ou API insere 2 linhas aqui (24h e 2h antes do `scheduled_at`). pg_cron job `schedule-service-reminders` (T-165) varre `notification_schedules` a cada minuto, materializa em `notification_events` quando `fire_at <= now()` e marca `fired_at = NOW()`.

Reschedule (admin remarca, cliente reaceita visita técnica em outro horário) deve **cancelar schedules existentes** do `service_id` e inserir novos. Cancelamento de serviço → Edge Function `cleanup-cancelled-reminders` (T-166) marca `cancelled_at = NOW()`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_schedules.sql`
```sql
BEGIN;

CREATE TABLE notification_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Categoria com lembretes válidos hoje: service_reminder_24h | service_reminder_2h.
  -- Pode crescer (ex: payment_release_warning_t72h_minus_24).
  category        notification_category NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Entidade-fonte (geralmente service_request).
  source_entity   text NOT NULL,
  source_entity_id uuid NOT NULL,
  -- Quando deve materializar.
  fire_at         timestamptz NOT NULL,
  -- Payload base (será passado pro evento materializado).
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_channels notification_channel[] NOT NULL,
  -- Estado.
  fired_at        timestamptz,                       -- quando virou notification_event
  cancelled_at    timestamptz,                       -- cancelado (serviço cancelado, reschedule)
  cancelled_reason text,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

-- Índice para o cron job picar só pendentes prontos pra disparar.
CREATE INDEX notification_schedules_fire_pending_idx
  ON notification_schedules(fire_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- Índice para cleanup (T-166): achar todos pending de um service.
CREATE INDEX notification_schedules_source_pending_idx
  ON notification_schedules(source_entity, source_entity_id)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- Constraint anti-duplicação: 1 schedule pendente por (source, category, recipient).
-- Um reschedule precisa cancelar o anterior antes; sem isso, conflito 23505.
-- Constraint parcial UNIQUE não funciona em todas as versões do Postgres usado;
-- emular com índice único parcial.
CREATE UNIQUE INDEX notification_schedules_unique_pending_idx
  ON notification_schedules(source_entity, source_entity_id, category, recipient_user_id)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE notification_schedules ENABLE ROW LEVEL SECURITY;

-- Sem acesso direto pra users (privado SISTEMA).
CREATE POLICY "notification_schedules_admin_select" ON notification_schedules
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- RPC pra inserir (chamada pela API quando service vai pra scheduled).
-- Body do RPC vai em T-162; aqui só a tabela e o trigger updatedAt.

CREATE TRIGGER notification_schedules_updated_at
  BEFORE UPDATE ON notification_schedules
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Apagar linhas ao cancelar — marcar `cancelled_at` (audit trail)
- ❌ `fire_at` no passado — RPC de criação rejeita (4xx no API caller)
- ❌ Esquecer cleanup ao cancelar serviço — sem isso, lembrete vai ser disparado em serviço inexistente (cobre AC #8)
- ❌ Reusar a mesma linha em reschedule — sempre cancela + insere

## Convenções
- Constraint UNIQUE parcial (não em colunas) força "1 schedule pendente por slot"
- Cron varredura por índice parcial sobre `fire_at` é O(log N) mesmo com tabela grande$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-162 API: RPC enqueue_notification_event + opt-out + idempotency
-- ---------------------------------------------------------------------------
('42af5179-9d07-4566-8fbe-eec1a72d7ee8',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-162',
 'Implementar RPC enqueue_notification_event + schedule_notification',
 $desc$## Objetivo
Ponto de entrada único do sistema de notificação: 2 RPCs Postgres (`enqueue_notification_event` para evento imediato, `schedule_notification` para lembrete futuro). Resolvem opt-out (T-160), aplicam idempotência (UNIQUE event_key de T-159) e retornam `{event_id, status}` pro caller — non-blocking. Cobre AC #1, #2, #4, #5, #6, #7, #10, #11.

## Contexto
Módulo NOTIFICACAO. Esses RPCs são chamados pelo backend do produto Zelar em qualquer ponto que precise notificar:
- Trigger pós-update em `kyc_verifications` (US-001) → enqueue `kyc_result`
- Server action de aceite (US-004) → enqueue `service_accepted` (após COMMIT, **fora** da transação principal — caller decide)
- Trigger em `service_events` quando status muda (US-023 FSM) → enqueue `service_step_change`
- Webhook `/api/webhooks/mercadopago` → enqueue `payment_receipt`
- Job `release-escrow-payouts` (US-028) → enqueue `payment_release`
- API `/api/admin/disputes/[id]/decide` (US-026) → enqueue `dispute_decision`
- API `/api/provider/suspend` (US-017) → enqueue `provider_suspended`
- Server action de criar service `scheduled` → schedule_notification 24h/2h

Caller passa `event_key` único; conflict 23505 é tratado como "já enfileirado" (idempotente). Tasks T-164 traz os helpers TS que chamam estes RPCs nos hotspots.

## Estado atual / O que substitui
Não existem. Hoje notificações são TODOs em outras tasks.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_rpcs.sql`
```sql
BEGIN;

-- Inserir evento de notificação na fila. Idempotente via UNIQUE(event_key).
-- Resolve opt-out: se categoria operacional + todos os canais bloqueados,
-- registra com status='skipped_optout' (não dispara, mas log existe).
CREATE OR REPLACE FUNCTION enqueue_notification_event(
  p_event_key       text,
  p_category        notification_category,
  p_recipient_user  uuid,
  p_payload         jsonb DEFAULT '{}'::jsonb,
  p_source_entity   text DEFAULT NULL,
  p_source_entity_id uuid DEFAULT NULL,
  p_allowed_channels notification_channel[] DEFAULT ARRAY['email','whatsapp']::notification_channel[],
  p_expires_at      timestamptz DEFAULT NULL
) RETURNS TABLE (event_id uuid, status notification_status)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_filtered_channels notification_channel[];
  v_chan notification_channel;
  v_event_id uuid;
  v_status notification_status;
BEGIN
  -- Resolução de opt-out por canal.
  v_filtered_channels := ARRAY[]::notification_channel[];
  FOREACH v_chan IN ARRAY p_allowed_channels LOOP
    IF notification_is_allowed(p_recipient_user, p_category, v_chan) THEN
      v_filtered_channels := array_append(v_filtered_channels, v_chan);
    END IF;
  END LOOP;

  IF cardinality(v_filtered_channels) = 0 THEN
    v_status := 'skipped_optout';
  ELSE
    v_status := 'queued';
  END IF;

  -- INSERT idempotente (UNIQUE event_key).
  INSERT INTO notification_events (
    event_key, category, recipient_user_id, payload,
    source_entity, source_entity_id,
    allowed_channels, status, expires_at
  )
  VALUES (
    p_event_key, p_category, p_recipient_user, p_payload,
    p_source_entity, p_source_entity_id,
    v_filtered_channels, v_status, p_expires_at
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id, status INTO v_event_id, v_status;

  -- Conflito (já existe) → retornar o id existente.
  IF v_event_id IS NULL THEN
    SELECT e.id, e.status INTO v_event_id, v_status
    FROM notification_events e
    WHERE e.event_key = p_event_key;
  END IF;

  RETURN QUERY SELECT v_event_id, v_status;
END;
$$;

-- Agendar lembrete futuro. Idempotente via UNIQUE parcial em
-- (source_entity, source_entity_id, category, recipient).
-- Pra reschedule, caller chama cancel_notification_schedule primeiro.
CREATE OR REPLACE FUNCTION schedule_notification(
  p_category        notification_category,
  p_recipient_user  uuid,
  p_source_entity   text,
  p_source_entity_id uuid,
  p_fire_at         timestamptz,
  p_payload         jsonb DEFAULT '{}'::jsonb,
  p_allowed_channels notification_channel[] DEFAULT ARRAY['email','whatsapp']::notification_channel[]
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_fire_at <= NOW() THEN
    RAISE EXCEPTION 'fire_at must be in the future' USING ERRCODE = '22023';
  END IF;

  INSERT INTO notification_schedules (
    category, recipient_user_id,
    source_entity, source_entity_id,
    fire_at, payload, allowed_channels
  )
  VALUES (
    p_category, p_recipient_user,
    p_source_entity, p_source_entity_id,
    p_fire_at, p_payload, p_allowed_channels
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Cancelar todos os schedules pendentes de uma fonte (chamado em
-- cancelamento de serviço pelo Edge Function T-166 ou trigger).
CREATE OR REPLACE FUNCTION cancel_notification_schedules(
  p_source_entity   text,
  p_source_entity_id uuid,
  p_reason          text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE notification_schedules
     SET cancelled_at = NOW(),
         cancelled_reason = p_reason
   WHERE source_entity = p_source_entity
     AND source_entity_id = p_source_entity_id
     AND fired_at IS NULL
     AND cancelled_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Permissões: apenas authenticated + service_role chamam (não anon).
REVOKE ALL ON FUNCTION enqueue_notification_event FROM PUBLIC;
REVOKE ALL ON FUNCTION schedule_notification FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_notification_schedules FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_notification_event TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION schedule_notification TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_notification_schedules TO authenticated, service_role;

COMMIT;
```

### `src/lib/notifications/enqueue.ts` (lib helper TS — server-only)
```typescript
import { createAdminClient } from '@/lib/supabase/admin';

export type NotificationCategory =
  | 'service_accepted' | 'service_step_change'
  | 'service_reminder_24h' | 'service_reminder_2h'
  | 'service_cancelled' | 'message_new'
  | 'auth_signup_confirmed' | 'kyc_result'
  | 'payment_receipt' | 'payment_release'
  | 'service_completed_invoice'
  | 'dispute_alert' | 'dispute_decision'
  | 'provider_suspended' | 'provider_appeal_decision' | 'provider_reactivated';

export type NotificationChannel = 'email' | 'whatsapp' | 'web_push';

export async function enqueueNotificationEvent(input: {
  eventKey: string;                   // idempotency
  category: NotificationCategory;
  recipientUserId: string;
  payload?: Record<string, unknown>;
  sourceEntity?: string;
  sourceEntityId?: string;
  allowedChannels?: NotificationChannel[];
  expiresAt?: string;                 // ISO
}): Promise<{ eventId: string; status: string }> {
  const sb = createAdminClient();
  const { data, error } = await sb.rpc('enqueue_notification_event', {
    p_event_key: input.eventKey,
    p_category: input.category,
    p_recipient_user: input.recipientUserId,
    p_payload: input.payload ?? {},
    p_source_entity: input.sourceEntity ?? null,
    p_source_entity_id: input.sourceEntityId ?? null,
    p_allowed_channels: input.allowedChannels ?? ['email', 'whatsapp'],
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw new Error(`enqueue_notification_event: ${error.message}`);
  return { eventId: data[0].event_id, status: data[0].status };
}
```

## Constraints / NÃO fazer
- ❌ Chamar `enqueueNotificationEvent` dentro de transação de aceite (US-004) — caller deve `await` **fora** do txn principal pra não bloquear o fluxo (AC #2)
- ❌ Inventar `event_key` por timestamp (não é determinístico — duas chamadas paralelas no mesmo evento gerariam keys diferentes). Convenção: `<category>:<entity_id>:<discriminator>`
- ❌ Permitir RPC sem `SECURITY DEFINER` — caller authenticated não tem acesso direto às tabelas internas
- ❌ Sem `search_path = public, pg_temp` em funções DEFINER (vulnerabilidade de schema-shadow)

## Convenções
- Idempotency via UNIQUE event_key + ON CONFLICT DO NOTHING (padrão do projeto)
- RPC retorna o id mesmo em conflito (caller pode logar)
- Helper TS em `src/lib/notifications/` (paralelo a `src/lib/optimistic/`)$desc$,
 'API', 'SISTEMA', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-163 API: Edge Function dispatch-notifications + fallback chain
-- ---------------------------------------------------------------------------
('132ce5eb-e45b-4d9f-99ae-6c1543ad6192',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-163',
 'Implementar Edge Function dispatch-notifications (consumer + fallback)',
 $desc$## Objetivo
Consumer da fila `notification_events`. Pra cada evento `queued`, tenta canais na ordem `allowed_channels` (whatsapp primeiro quando disponível, email fallback). Cobre AC #9 (fallback automático: WA inválido → push, push indisponível → email) e fecha AC #1, #2, #4, #5, #6, #7 (entrega efetiva). Idempotente por execução (linhas em `notification_deliveries` registram cada tentativa).

## Contexto
Módulo NOTIFICACAO. Edge Function chamada por pg_cron a cada minuto (T-165 também agenda esta) ou via webhook do RPC (não no MVP — pull-based simplifica).

Templates e contas de provedor (Resend domain, WhatsApp Business Account, FCM key) vêm de US-024. Esta task **só** consome:
- `getEmailTemplate(categoryKey, payload)` → US-024
- `sendEmail(to, subject, html)` → US-024 (Resend)
- `sendWhatsAppTemplate(to, templateName, params)` → US-024 (WA Cloud API)
- `sendWebPush(subscription, payload)` → US-024 (Web Push API + FCM fallback)

Quando US-024 ainda não existir: usar mocks que apenas escrevem em `notification_deliveries` com status `sent` e `failure_reason='mock_no_provider'` (permite desenvolver/testar dispatcher independente).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/functions/dispatch-notifications/index.ts`
```typescript
// Deno Edge Function. Roda a cada minuto via pg_cron (T-165) ou
// invocada manualmente em retry de evento failed.

import { createClient } from '@supabase/supabase-js';
import { sendEmail, sendWhatsApp, sendWebPush } from '../_shared/comms.ts'; // US-024
import { renderTemplate } from '../_shared/templates.ts';                    // US-024

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const BATCH_SIZE = 50;

Deno.serve(async (_req) => {
  // 1. Pegar lote de eventos queued (FOR UPDATE SKIP LOCKED para não duplicar
  //    se 2 instâncias rodarem ao mesmo tempo).
  const { data: events, error } = await sb.rpc('claim_notification_batch', { p_limit: BATCH_SIZE });
  if (error) return new Response(`claim error: ${error.message}`, { status: 500 });

  let processed = 0;
  for (const ev of events ?? []) {
    if (ev.expires_at && new Date(ev.expires_at) < new Date()) {
      await markEventFailed(ev.id, 'expired');
      continue;
    }

    let delivered = false;
    let lastFailure = '';
    for (const channel of ev.allowed_channels as NotificationChannel[]) {
      try {
        const result = await dispatch(channel, ev);
        await sb.from('notification_deliveries').insert({
          event_id: ev.id,
          channel,
          provider_id: result.providerId,
          status: 'sent',
          template_key: result.templateKey,
        });
        delivered = true;
        break; // Sucesso — não tenta próximos canais (AC #9 fallback é em FALHA, não em "todos os canais")
      } catch (e) {
        lastFailure = (e as Error).message;
        await sb.from('notification_deliveries').insert({
          event_id: ev.id,
          channel,
          status: 'failed',
          failure_reason: lastFailure.slice(0, 500),
        });
        // Continua pro próximo canal da chain.
      }
    }

    await sb.from('notification_events').update({
      status: delivered ? 'sent' : 'failed',
      resolved_at: new Date().toISOString(),
    }).eq('id', ev.id);

    processed++;
  }

  return Response.json({ processed });
});

async function dispatch(channel: NotificationChannel, ev: NotificationEvent) {
  const tpl = await renderTemplate(channel, ev.category, ev.payload);
  switch (channel) {
    case 'email':
      return sendEmail({ to: ev.recipient_email, subject: tpl.subject, html: tpl.html, templateKey: tpl.key });
    case 'whatsapp':
      return sendWhatsApp({ to: ev.recipient_phone, templateName: tpl.key, params: tpl.params });
    case 'web_push':
      return sendWebPush({ userId: ev.recipient_user_id, title: tpl.title, body: tpl.body, templateKey: tpl.key });
  }
}
```

### RPC `claim_notification_batch` — atomicamente "pega e marca dispatching"
```sql
CREATE OR REPLACE FUNCTION claim_notification_batch(p_limit integer)
RETURNS SETOF notification_events
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM notification_events
    WHERE status = 'queued'
    ORDER BY enqueued_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE notification_events e
     SET status = 'dispatching'
   WHERE e.id IN (SELECT id FROM picked)
   RETURNING e.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_notification_batch FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_notification_batch TO service_role;
```

### Mocks dev (`supabase/functions/_shared/comms.mock.ts`)
- Implementam `sendEmail/sendWhatsApp/sendWebPush` retornando `{providerId: 'mock_<rand>'}` quando `Deno.env.get('NOTIFY_USE_MOCK') === '1'`. Permite dev sem credentials de US-024.

## Constraints / NÃO fazer
- ❌ Tentar todos os canais em sucesso (chain só roda em falha — AC #9)
- ❌ Inserir delivery sem registrar o channel (debug fica impossível)
- ❌ Loop infinito de retry — eventos `failed` ficam parados; retry manual ou cron de re-enfileiramento (escopo de US futura, fora do MVP)
- ❌ Misturar logging com tabelas de US-024 (`email_send_log` técnico bruto vai lá; aqui é log do nosso domínio de evento)
- ❌ Confiar em `recipient_email`/`recipient_phone` na mesma tabela (resolver de auth.users + user metadata, ou JOIN com perfis — definir no claim RPC)

## Convenções
- `FOR UPDATE SKIP LOCKED` previne dupla entrega quando 2 instâncias rodam paralelas
- Batch grande (50) com timeout do Edge < 60s (limite Supabase)
- Sem retry-loop interno — failures ficam logados e aguardam re-enfileiramento$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','RATE_LIMIT','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-164 API: emit_event helpers nos hotspots (KYC/FSM/payment/etc)
-- ---------------------------------------------------------------------------
('a2d4e09c-a902-4c19-9a37-09a38779267c',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-164',
 'Wirar enqueueNotificationEvent nos hotspots de eventos do domínio',
 $desc$## Objetivo
Conectar todos os pontos críticos da plataforma ao sistema de notificação criado em T-159..T-163. Cada hotspot chama `enqueueNotificationEvent` com `event_key` determinístico, garantindo cobertura ponta-a-ponta dos AC #1, #2, #4, #5, #6, #7. AC #2 explicitamente requer envio non-blocking (não pode falhar o aceite por falha do enqueue) — implementação em "fire-and-forget" do lado do caller.

## Contexto
Módulo NOTIFICACAO. Esta é a task de **integração** — todos os caminhos abaixo já têm tasks separadas (US-001, US-008, US-011, US-026, US-028 etc) que **vão usar** estes helpers quando esta US-022 estiver em código. Mapa de hotspots:

| Hotspot | Categoria | Quem chama |
|---|---|---|
| KYC webhook resolve (US-001 T-7156f5db) | `kyc_result` | Webhook handler `/api/webhooks/unico` |
| Signup confirmado (US-001/US-009) | `auth_signup_confirmed` | Trigger pós-confirmação Supabase Auth |
| Aceite de proposta (US-004) | `service_accepted` | Server action `acceptProposal()` |
| FSM transitions (US-005/US-023) | `service_step_change` | Trigger `service_events` (after insert) |
| Captura pagamento (US-011) | `payment_receipt` | Webhook `/api/webhooks/mercadopago` |
| Liberação T+72h (US-028) | `payment_release` | Edge Function `release-escrow-payouts` |
| Decisão disputa (US-026) | `dispute_decision` | RPC `decide_dispute()` |
| Suspensão (US-008/US-017) | `provider_suspended` | API `/api/admin/providers/[id]/suspend` |

## Estado atual / O que substitui
Hoje cada US tem TODO "notificar via canal externo" sem implementação. Esta task entrega o conector real.

## O que criar

### `src/lib/notifications/emit.ts` (helpers de alto nível)
```typescript
import { enqueueNotificationEvent } from './enqueue';

export const emit = {
  kycResult: (verificationId: string, providerUserId: string, outcome: 'approved' | 'rejected') =>
    enqueueNotificationEvent({
      eventKey: `kyc_result:${providerUserId}:${verificationId}`,
      category: 'kyc_result',
      recipientUserId: providerUserId,
      payload: { outcome },
      sourceEntity: 'kyc_verification',
      sourceEntityId: verificationId,
      allowedChannels: ['whatsapp', 'email'],
    }),

  serviceAccepted: (serviceId: string, providerUserId: string) =>
    enqueueNotificationEvent({
      eventKey: `service_accepted:${serviceId}`,
      category: 'service_accepted',
      recipientUserId: providerUserId,
      sourceEntity: 'service_request',
      sourceEntityId: serviceId,
      allowedChannels: ['whatsapp'],
    }),

  serviceStepChange: (serviceId: string, recipientUserId: string, step: string) =>
    enqueueNotificationEvent({
      eventKey: `service_step_change:${serviceId}:${step}:${recipientUserId}`,
      category: 'service_step_change',
      recipientUserId,
      payload: { step },
      sourceEntity: 'service_request',
      sourceEntityId: serviceId,
      allowedChannels: ['whatsapp', 'web_push'],
    }),

  paymentReceipt: (paymentId: string, clientUserId: string) =>
    enqueueNotificationEvent({
      eventKey: `payment_receipt:${paymentId}`,
      category: 'payment_receipt',
      recipientUserId: clientUserId,
      sourceEntity: 'payment',
      sourceEntityId: paymentId,
      allowedChannels: ['email'],
    }),

  paymentRelease: (payoutId: string, providerUserId: string) =>
    enqueueNotificationEvent({
      eventKey: `payment_release:${payoutId}`,
      category: 'payment_release',
      recipientUserId: providerUserId,
      sourceEntity: 'provider_payout',
      sourceEntityId: payoutId,
      allowedChannels: ['whatsapp', 'email'],
    }),

  disputeDecision: (disputeId: string, recipientUserId: string, outcome: string) =>
    enqueueNotificationEvent({
      eventKey: `dispute_decision:${disputeId}:${recipientUserId}`,
      category: 'dispute_decision',
      recipientUserId,
      payload: { outcome },
      sourceEntity: 'dispute',
      sourceEntityId: disputeId,
      allowedChannels: ['whatsapp', 'email'],
    }),

  providerSuspended: (providerUserId: string, reason: string) =>
    enqueueNotificationEvent({
      eventKey: `provider_suspended:${providerUserId}:${Date.now() /* allow re-suspend */}`,
      category: 'provider_suspended',
      recipientUserId: providerUserId,
      payload: { reason },
      sourceEntity: 'provider_profile',
      sourceEntityId: providerUserId,
      allowedChannels: ['whatsapp', 'email'],
    }),

  // ... outros conforme tabela acima
};
```

### Padrão de uso non-blocking (AC #2)
```typescript
// src/app/api/services/[id]/accept/route.ts (US-004)
const { error } = await sb.rpc('accept_service', { ... });
if (error) return mapRpcError(error);

// Fire-and-forget — sucesso de aceite não depende de notificação.
emit.serviceAccepted(serviceId, providerUserId).catch((e) => {
  console.error('[notify] enqueue failed', e);
  // Sem throw — aceite já foi committed.
});

return Response.json({ ok: true });
```

### Trigger Postgres pra FSM (`service_events` insert)
```sql
CREATE OR REPLACE FUNCTION trg_emit_service_step_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client uuid; v_provider uuid;
BEGIN
  SELECT client_id, provider_id INTO v_client, v_provider
  FROM service_requests WHERE id = NEW.service_request_id;

  -- Cliente
  IF v_client IS NOT NULL THEN
    PERFORM enqueue_notification_event(
      'service_step_change:'||NEW.service_request_id||':'||NEW.to_status||':'||v_client,
      'service_step_change'::notification_category,
      v_client,
      jsonb_build_object('step', NEW.to_status),
      'service_request', NEW.service_request_id,
      ARRAY['whatsapp','web_push']::notification_channel[],
      NULL
    );
  END IF;
  -- Prestador
  IF v_provider IS NOT NULL THEN
    PERFORM enqueue_notification_event(
      'service_step_change:'||NEW.service_request_id||':'||NEW.to_status||':'||v_provider,
      'service_step_change'::notification_category,
      v_provider,
      jsonb_build_object('step', NEW.to_status),
      'service_request', NEW.service_request_id,
      ARRAY['whatsapp','web_push']::notification_channel[],
      NULL
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER service_events_emit_notification
  AFTER INSERT ON service_events
  FOR EACH ROW EXECUTE FUNCTION trg_emit_service_step_change();
```

## Constraints / NÃO fazer
- ❌ `await emit.X()` dentro de transação principal (bloqueia o fluxo se o RPC falhar) — caller faz fire-and-forget após COMMIT
- ❌ Construir `event_key` por `Date.now()` em lugar onde reentrada é possível — perde idempotência. Usar SEMPRE entity_id + actor_id + discriminador estável
- ❌ Duplicar lógica de mapeamento (categoria → channels) em cada caller — ficar no helper `emit.X`
- ❌ Tocar em código de US-001/004/008/011/026/028 já feitas além dos pontos identificados (PR de adoção é separado, por US — esta task entrega só o conector)

## Convenções
- `src/lib/notifications/emit.ts` é o único lugar que define `event_key` patterns
- Triggers Postgres usam mesmo padrão de chave (string concat) que matches o TS — fonte única de verdade está documentada aqui
- Caller faz `.catch(console.error)` em fire-and-forget (não escala — em produção, capturar em Sentry/observability)$desc$,
 'API', 'SISTEMA', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-165 OPS: pg_cron schedule-service-reminders 24h/2h
-- ---------------------------------------------------------------------------
('3036fc2d-f83c-4f59-84a9-04223852e062',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-165',
 'Configurar pg_cron jobs schedule-reminders + dispatch-notifications',
 $desc$## Objetivo
Operacionalizar 2 ciclos automáticos:
1. **`materialize-due-schedules`**: pega `notification_schedules` com `fire_at <= NOW()`, materializa em `notification_events` via `enqueue_notification_event`. Fecha AC #3 (lembretes 24h/2h disparam no momento certo).
2. **`dispatch-notifications-tick`**: invoca a Edge Function `dispatch-notifications` (T-163) a cada minuto pra drenar a fila.

## Contexto
Módulo NOTIFICACAO. Foi separada do RPC `schedule_notification` (T-162) porque é responsabilidade operacional (cron config + monitoramento) — facilita reverter/desligar sem touchear código de domínio.

US-027 (Agenda do Prestador) também usa pg_cron pra lembretes de prestador (2h/30min). Aquela task já é separada e usa esta mesma fundação (chamando `schedule_notification` no momento certo). Não conflita.

## Estado atual / O que substitui
Não existe. Tasks de US-027 (T-3d696e30) já documentam pg_cron pra lembretes do prestador — aqui é o "pai" do sistema (T-027 vai REUSAR esta infra via TaskDependency relates_to).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_cron.sql`
```sql
BEGIN;

-- Função que materializa schedules vencidos.
CREATE OR REPLACE FUNCTION materialize_due_notification_schedules()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
  v_event_id uuid;
  v_status notification_status;
BEGIN
  FOR r IN
    SELECT id, category, recipient_user_id, source_entity, source_entity_id,
           fire_at, payload, allowed_channels
    FROM notification_schedules
    WHERE fired_at IS NULL
      AND cancelled_at IS NULL
      AND fire_at <= NOW()
    ORDER BY fire_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_event_id, v_status FROM enqueue_notification_event(
      'schedule:'||r.id::text,
      r.category,
      r.recipient_user_id,
      r.payload,
      r.source_entity,
      r.source_entity_id,
      r.allowed_channels,
      -- Lembrete 2h expira no início do serviço; dispatcher dropa se chegar atrasado.
      CASE
        WHEN r.category = 'service_reminder_2h'  THEN r.fire_at + interval '2 hours'
        WHEN r.category = 'service_reminder_24h' THEN r.fire_at + interval '12 hours'
        ELSE NULL
      END
    );

    UPDATE notification_schedules
       SET fired_at = NOW()
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION materialize_due_notification_schedules FROM PUBLIC;
GRANT EXECUTE ON FUNCTION materialize_due_notification_schedules TO service_role;

-- pg_cron: materializar a cada minuto.
SELECT cron.schedule(
  'materialize-due-notification-schedules',
  '* * * * *',
  $$ SELECT materialize_due_notification_schedules(); $$
);

-- pg_cron: invocar Edge Function dispatcher a cada minuto via HTTP
-- (extensão pg_net já habilitada no projeto; secret no Vault).
SELECT cron.schedule(
  'dispatch-notifications-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.dispatch_notifications_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $$
);

-- Helper de adoção em servico_request scheduled.
-- Trigger pós-INSERT em service_requests com scheduled_at: agenda 2 lembretes.
CREATE OR REPLACE FUNCTION trg_schedule_service_reminders() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client uuid; v_provider uuid;
BEGIN
  IF NEW.scheduled_at IS NULL THEN RETURN NEW; END IF;

  v_client := NEW.client_id;
  v_provider := NEW.provider_id;

  -- 24h antes
  IF NEW.scheduled_at - interval '24 hours' > NOW() THEN
    IF v_client   IS NOT NULL THEN PERFORM schedule_notification('service_reminder_24h', v_client,   'service_request', NEW.id, NEW.scheduled_at - interval '24 hours', '{}'::jsonb, ARRAY['whatsapp','email']::notification_channel[]); END IF;
    IF v_provider IS NOT NULL THEN PERFORM schedule_notification('service_reminder_24h', v_provider, 'service_request', NEW.id, NEW.scheduled_at - interval '24 hours', '{}'::jsonb, ARRAY['whatsapp','email']::notification_channel[]); END IF;
  END IF;

  -- 2h antes
  IF NEW.scheduled_at - interval '2 hours' > NOW() THEN
    IF v_client   IS NOT NULL THEN PERFORM schedule_notification('service_reminder_2h', v_client,   'service_request', NEW.id, NEW.scheduled_at - interval '2 hours',  '{}'::jsonb, ARRAY['whatsapp','web_push']::notification_channel[]); END IF;
    IF v_provider IS NOT NULL THEN PERFORM schedule_notification('service_reminder_2h', v_provider, 'service_request', NEW.id, NEW.scheduled_at - interval '2 hours',  '{}'::jsonb, ARRAY['whatsapp','web_push']::notification_channel[]); END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Reschedule: trigger pós-UPDATE em scheduled_at cancela e recria.
CREATE OR REPLACE FUNCTION trg_reschedule_service_reminders() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    PERFORM cancel_notification_schedules('service_request', NEW.id, 'rescheduled');
    PERFORM trg_schedule_service_reminders();  -- reuse logic
  END IF;
  RETURN NEW;
END;
$$;

-- Os triggers em service_requests serão criados em US-011 (DATA T-0db58807) ou
-- aqui mesmo se a tabela já existir; documentar dependência.
COMMIT;
```

### Setup Vault / GUC pro pg_cron HTTP call
- `ALTER DATABASE postgres SET app.dispatch_notifications_url = 'https://<project>.functions.supabase.co/dispatch-notifications';`
- Service role key vem do Vault Supabase, não hardcoded.

## Constraints / NÃO fazer
- ❌ Cron com frequência <1min (pg_cron não suporta nativo; usar pg_partman ou Edge Function self-trigger se precisar)
- ❌ `materialize_due_notification_schedules` sem `FOR UPDATE SKIP LOCKED` — se 2 instâncias rodarem (raro mas possível em pg_cron com replicas), duplicariam events
- ❌ Esquecer de criar trigger de reschedule — sem ele, AC #3 ("evitar duplicação em servicos com remarcacao") falha
- ❌ Hardcodar URL/service_role_key na função — sempre via `current_setting()` lendo Vault

## Convenções
- pg_cron jobs sempre nomeados com prefix do domínio (`materialize-`, `dispatch-`, `release-`)
- Documentar setup do Vault no runbook (referência: docs/task-gen/04 §C)
- `app.dispatch_notifications_url` segue padrão de naming `app.<feature>_<setting>`$desc$,
 'OPS', 'SISTEMA', ARRAY['SECRET_HANDLING','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-166 API: cleanup-cancelled-reminders (chamada por trigger)
-- ---------------------------------------------------------------------------
('db973bd7-34fb-474f-903c-b51c083e2fe7',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '67eed8e5-a440-439a-9ce3-bcf1797cebeb',
 'ZLAR-V2-T-166',
 'Cancelar schedules pendentes ao cancelar serviço (trigger + emit cancelled)',
 $desc$## Objetivo
Quando um `service_request` transita para `cancelled` (qualquer motivo: cliente cancela, prestador cancela, no-show, disputa cancelando), cancelar **todos** os `notification_schedules` pendentes do serviço **e** disparar 1 evento `service_cancelled` pra cada parte. Cobre AC #8 (lembretes de serviço cancelado não chegam).

## Contexto
Módulo NOTIFICACAO. Implementação via trigger Postgres em `service_requests` (FSM da US-023 já existe; aqui adicionamos o handler no momento da transição). Reuso do RPC `cancel_notification_schedules` (T-162). Operação síncrona com a transição (caso o cancel_schedules falhe, transição inteira reverte — preferível duplicação esporádica vs. envio em vão pra serviço já cancelado).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_cancel_handler.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION trg_handle_service_cancelled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS NULL OR OLD.status <> 'cancelled') THEN
    -- Cancela schedules pendentes deste service_request.
    PERFORM cancel_notification_schedules('service_request', NEW.id, 'service_cancelled');

    -- Emite evento operacional service_cancelled pras 2 partes.
    IF NEW.client_id IS NOT NULL THEN
      PERFORM enqueue_notification_event(
        'service_cancelled:'||NEW.id::text||':'||NEW.client_id::text,
        'service_cancelled'::notification_category,
        NEW.client_id,
        jsonb_build_object('cancelled_at', NOW(), 'service_id', NEW.id),
        'service_request', NEW.id,
        ARRAY['whatsapp','email']::notification_channel[],
        NULL
      );
    END IF;
    IF NEW.provider_id IS NOT NULL THEN
      PERFORM enqueue_notification_event(
        'service_cancelled:'||NEW.id::text||':'||NEW.provider_id::text,
        'service_cancelled'::notification_category,
        NEW.provider_id,
        jsonb_build_object('cancelled_at', NOW(), 'service_id', NEW.id),
        'service_request', NEW.id,
        ARRAY['whatsapp','email']::notification_channel[],
        NULL
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER service_requests_handle_cancelled
  AFTER UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION trg_handle_service_cancelled();

COMMIT;
```

### Test plan (smoke)
1. Inserir `service_request` com `scheduled_at = NOW() + 25h`. Verificar 4 linhas em `notification_schedules` (24h+2h × cliente+prestador).
2. UPDATE `status='cancelled'`. Verificar:
   - 4 linhas em `notification_schedules` com `cancelled_at IS NOT NULL`
   - 2 novas linhas em `notification_events` (categoria `service_cancelled`)
3. Avançar relógio (ou esperar): cron `materialize_due_notification_schedules` não materializa nada (todos cancelled).

## Constraints / NÃO fazer
- ❌ Cancelar schedules em transições não-terminais (ex: `paused`) — só em `cancelled`
- ❌ Reusar `service_cancelled` event_key em cancelamento múltiplo: o discriminador `:client_id` / `:provider_id` garante 1 por parte
- ❌ Disparar notificação se `client_id`/`provider_id` for NULL (ex: cancelamento antes do match)
- ❌ Mover lógica pra Edge Function — ter direto no trigger garante atomicidade com a transição

## Convenções
- Trigger AFTER UPDATE com `OLD.status <> 'cancelled'` para prevenir re-disparo se UPDATE volta a tocar `cancelled` por algum motivo
- Events de cancelamento são operacionais (opt-out aplicável) — usuário pode silenciar via T-160
- Reusa RPC `cancel_notification_schedules` (T-162) e `enqueue_notification_event` (T-162) — não duplicar lógica$desc$,
 'API', 'SISTEMA', ARRAY['IDEMPOTENCY_KEY','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- ============================================================================
-- 2. Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-159 DATA: cobre #11 (idempotência via UNIQUE event_key)
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e'::uuid, 11),

  -- T-160 DATA: cobre #10 (opt-out)
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7'::uuid, 10),

  -- T-161 DATA: cobre #3 (lembretes 24h/2h, evitar duplicação) e #8 (cancelamento)
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca'::uuid, 3),
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca'::uuid, 8),

  -- T-162 API RPC enqueue: cobre #1, #2, #4, #5, #6, #7, #10, #11
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 1),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 2),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 4),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 5),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 6),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 7),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 10),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 11),

  -- T-163 API dispatcher: cobre #1, #2, #4, #5, #6, #7, #9 (fallback)
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 1),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 2),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 4),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 5),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 6),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 7),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 9),

  -- T-164 API emit helpers: cobre #1, #2, #4, #5, #6, #7
  ('a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 1),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 2),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 4),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 5),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 6),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 7),

  -- T-165 OPS pg_cron: cobre #3 (lembretes disparam no momento certo)
  ('3036fc2d-f83c-4f59-84a9-04223852e062'::uuid, 3),

  -- T-166 API cleanup: cobre #8 (cancelamento de lembretes)
  ('db973bd7-34fb-474f-903c-b51c083e2fe7'::uuid, 8)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
 AND ac."order" = v.ac_order;

-- ============================================================================
-- 3. AC-da-Task (checklist técnico — vira checkboxes no TaskSheet)
-- ============================================================================

-- T-159 — DATA: notification_events + deliveries
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'ENUMs notification_category/channel/status criados com todos os valores listados', 1),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'notification_events.event_key UNIQUE: smoke 23505 em 2º insert com mesma key', 2),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'notification_deliveries imutável: smoke UPDATE retorna policy denied', 3),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'Índice parcial events_status_enq_idx confirmado via EXPLAIN ANALYZE em status=queued', 4),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'RLS: authenticated não-admin não acessa notification_events (smoke 0 rows)', 5),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'RLS: admin (via app_metadata.role=admin) lê tudo', 6),
  ('4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'Trigger updatedAt em events funciona; deliveries não tem trigger', 7);

-- T-160 — DATA: notification_preferences
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'PK composta (user_id, category, channel) impede duplicidade', 1),
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'Função notification_is_allowed retorna true pra categorias obrigatórias mesmo sem linha', 2),
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'Função retorna true (default ON) pra categoria operacional sem linha', 3),
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'Função retorna false quando há linha enabled=false pra (user, cat, channel) operacional', 4),
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'RLS: user gerencia só suas prefs (smoke owner+stranger)', 5),
  ('e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'Função SECURITY DEFINER tem search_path = public, pg_temp', 6);

-- T-161 — DATA: notification_schedules
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca', 'Índice único parcial impede 2 schedules pendentes pra mesma (source, category, recipient)', 1),
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca', 'Cancelar via UPDATE de cancelled_at libera novo INSERT pra mesmo slot', 2),
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca', 'Índice schedules_fire_pending_idx usado por cron (EXPLAIN mostra Index Scan)', 3),
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca', 'RLS: user comum não acessa; admin lê tudo', 4),
  ('f83559dd-afa2-4d16-b010-8e7cd82878ca', 'Trigger updatedAt funciona', 5);

-- T-162 — API: RPCs enqueue/schedule/cancel
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'RPC enqueue_notification_event criado, SECURITY DEFINER, search_path seguro', 0),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', '2ª chamada com mesmo event_key retorna o mesmo event_id e não cria linha duplicada', 1),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'Categoria operacional + todos canais opt-out resulta em status=skipped_optout', 2),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'Categoria obrigatória ignora opt-out: sempre status=queued', 3),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'RPC schedule_notification rejeita fire_at <= NOW() (22023)', 4),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'cancel_notification_schedules retorna count e marca cancelled_at', 5),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'GRANT EXECUTE pra authenticated + service_role; REVOKE FROM PUBLIC', 6),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'Helper TS src/lib/notifications/enqueue.ts chama RPC e tipa retorno', 7);

-- T-163 — API: Edge Function dispatcher
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'Edge Function dispatch-notifications deployed e respondendo', 0),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'RPC claim_notification_batch criado com FOR UPDATE SKIP LOCKED', 1),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', '2 instâncias paralelas processam batches disjuntos (smoke com 100 events)', 2),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'Sucesso no 1º canal não tenta os próximos (delivery sent + status sent)', 3),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'Falha no 1º canal tenta 2º; ambos falhando, event status=failed', 4),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'Cada tentativa registra 1 linha em notification_deliveries (channel + status + provider_id ou failure_reason)', 5),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'expires_at < NOW marca event como failed sem tentar canais', 6),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'Modo mock (NOTIFY_USE_MOCK=1) registra delivery sem chamar provider externo', 7);

-- T-164 — API: emit helpers
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'src/lib/notifications/emit.ts exporta helpers para todos os hotspots da tabela', 0),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'Cada helper define event_key determinístico (entity_id + actor_id + discriminador estável)', 1),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'Trigger trg_emit_service_step_change criado em service_events e dispara enqueue para cliente+prestador', 2),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'Padrão fire-and-forget documentado em pelo menos 1 caller (US-004 accept)', 3),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'Smoke: emit.kycResult duas vezes pra mesma verification cria 1 evento (idempotência)', 4),
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'Smoke: emit.serviceAccepted falhar não derruba o aceite (caller usa .catch)', 5);

-- T-165 — OPS: pg_cron
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'Migration aplicada via psql', 0),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'Função materialize_due_notification_schedules criada com FOR UPDATE SKIP LOCKED e LIMIT 200', 1),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'cron.schedule registrado: materialize-due-notification-schedules a cada minuto', 2),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'cron.schedule registrado: dispatch-notifications-tick chamando Edge via pg_net a cada minuto', 3),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'GUC app.dispatch_notifications_url e app.service_role_key configurados (Vault)', 4),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'Trigger trg_schedule_service_reminders agenda 24h e 2h ao inserir scheduled_at', 5),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'Trigger trg_reschedule_service_reminders cancela e recria ao mudar scheduled_at (smoke)', 6),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'Lembrete materializado no minuto previsto (smoke com fire_at = NOW + 1min)', 7);

-- T-166 — API: cancel handler
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'Migration aplicada via psql', 0),
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'Trigger trg_handle_service_cancelled criado em service_requests AFTER UPDATE', 1),
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'Smoke: UPDATE status=cancelled marca cancelled_at em todos schedules pending do service', 2),
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'Smoke: UPDATE status=cancelled cria 2 events service_cancelled (cliente + prestador) com event_keys distintos', 3),
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'Re-UPDATE em registro já cancelled não re-emite (OLD.status check)', 4),
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'Cron materialize_due não dispara nada após cancelamento (todos cancelled_at populados)', 5);

-- ============================================================================
-- 4. Dependências (TaskDependency — kind LOWERCASE)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-162 (RPC enqueue) depende de T-159 (events) e T-160 (preferences)
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', '4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'blocks'),
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'blocks'),
  -- T-162 inclui RPCs schedule/cancel que mexem em T-161
  ('42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'f83559dd-afa2-4d16-b010-8e7cd82878ca', 'blocks'),

  -- T-163 (dispatcher) depende de T-159 (events). E relates_to T-024 (ainda não existe — referenciar como relates ao módulo)
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', '4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'blocks'),
  ('132ce5eb-e45b-4d9f-99ae-6c1543ad6192', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'blocks'),

  -- T-164 (emit helpers) depende de T-162 (RPC)
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'blocks'),

  -- T-165 (pg_cron) depende de T-161 (schedules) + T-162 (RPCs) + T-163 (dispatcher endpoint)
  ('3036fc2d-f83c-4f59-84a9-04223852e062', 'f83559dd-afa2-4d16-b010-8e7cd82878ca', 'blocks'),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'blocks'),
  ('3036fc2d-f83c-4f59-84a9-04223852e062', '132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'blocks'),

  -- T-166 (cancel handler) depende de T-162 (RPCs cancel/enqueue)
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'blocks'),
  ('db973bd7-34fb-474f-903c-b51c083e2fe7', 'f83559dd-afa2-4d16-b010-8e7cd82878ca', 'blocks'),

  -- relates_to: tasks de US-001/US-008/US-011/US-026/US-028 que mencionam "notificar"
  -- vão consumir T-164 quando esta US-022 sair. Marcamos relates_to nos hotspots:
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', '0cd9e20c-ec44-47d6-8451-3610667c5950', 'relates_to'),  -- US-001 KYC notify
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'efea1257-5a09-4aef-a037-595e9174ce74', 'relates_to'),  -- US-008 suspension notify
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', '14fc6ec7-71c6-443f-aa5e-7c8175c394c0', 'relates_to'),  -- US-011 mp webhook
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', '2fcec385-daab-42cc-b78f-c4e582ac2512', 'relates_to'),  -- US-026 dispute notify
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', 'f0cd9a70-c2e3-4118-a4fb-7db5f8939aa9', 'relates_to'),  -- US-028 release-escrow Edge
  ('a2d4e09c-a902-4c19-9a37-09a38779267c', '945acbaa-ba26-4a6d-8492-aebd55b0569f', 'relates_to'),  -- US-018 ticket notify

  -- T-165 relates US-027 (já tem pg_cron de prestador) — reuso de fundação
  ('3036fc2d-f83c-4f59-84a9-04223852e062', '3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'relates_to')   -- US-027 cron prestador
;

COMMIT;
