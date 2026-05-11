-- ZLAR-V2 — Tasks de implementação da US-008
-- "Entender motivo de suspensão e ter caminho de reativação ou contestação"
-- Persona: PRESTADOR | Módulo: ONBOARDING | AC: 9 | Tasks: 11
--
-- Estrutura:
--   1. Task (11 linhas, status='draft', reference T-034..T-044)
--   2. TaskAcceptanceCriterion (vínculo task → AC-da-Story, ponte N:N)
--   3. AcceptanceCriterion(taskId) (checklist técnico, vira checkbox no TaskSheet)
--   4. TaskDependency (kind lowercase 'blocks' / 'relates_to')

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ----------------------------------------------------------------------------
-- T-034 [DATA] enum suspension_category + colunas estruturadas em provider_profiles
-- ----------------------------------------------------------------------------
('5d2abc4d-9aba-41d8-aeda-39bd113130e2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-034',
 'Criar enum suspension_category e estender provider_profiles com motivo estruturado',
 $desc$## Objetivo
Estruturar a categoria do motivo de suspensão (hoje há só `suspension_reason text` livre em T-013) para que a tela `/suspended` possa renderizar 5 variantes distintas (no_show / manual / geo_consent / kyc / penalty). Adicionar `reactivation_eligible_at` (previsão de reabilitação automática para AC #6) e manter `suspension_reason` como **detalhe livre** complementar à categoria. Cobre AC #1, #2, #3, #4, #6.

## Contexto
Módulo ONBOARDING — depende de T-013 ter aplicado as colunas básicas (`account_status`, `suspended_at`, `suspension_reason`). Esta task **estende** sem recriar. Consumida por T-037 (view), T-038 (endpoint de status), T-040 (reativação geo), T-043 (tela de suspensão). US-017 (moderação por admin) também grava aqui ao suspender manualmente.

## Estado atual / O que substitui
T-013 já adicionou `account_status`, `suspended_at`, `suspension_reason` (text livre) e o trigger `provider_profiles_protect_admin_cols` que bloqueia UPDATE dessas colunas exceto via service_role / admin. Esta task adiciona **categoria estruturada** (enum) e **previsão de reabilitação**, e estende o trigger para proteger as novas colunas.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_suspension_category.sql`
```sql
BEGIN;

CREATE TYPE suspension_category AS ENUM (
  'no_show',       -- 3 no-shows consecutivos (US-008 AC#2)
  'manual',        -- decisão manual de admin (US-008 AC#3 / US-017)
  'geo_consent',   -- consentimento de geolocalização revogado (US-008 AC#4)
  'kyc',           -- bloqueio por 2 reprovações de KYC (US-008 AC#5 → vai pra account_status='blocked')
  'penalty'        -- penalidade gradativa por cancelamentos/no-shows (US-008 AC#6)
);

ALTER TABLE provider_profiles
  ADD COLUMN suspension_category    suspension_category,
  ADD COLUMN reactivation_eligible_at timestamptz,  -- NULL = sem previsão / depende de ação manual
  ADD COLUMN penalty_balance         smallint NOT NULL DEFAULT 0;  -- AC#6: saldo acumulado

CREATE INDEX ON provider_profiles(suspension_category) WHERE suspension_category IS NOT NULL;

-- Estender o trigger de T-013 para também proteger as novas colunas
CREATE OR REPLACE FUNCTION provider_profiles_protect_admin_cols()
RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' OR
     (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
     OR NEW.suspension_category IS DISTINCT FROM OLD.suspension_category
     OR NEW.reactivation_eligible_at IS DISTINCT FROM OLD.reactivation_eligible_at
     OR NEW.penalty_balance IS DISTINCT FROM OLD.penalty_balance THEN
    RAISE EXCEPTION 'forbidden_column_update' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não substituir `suspension_reason` (text livre) — ela complementa a categoria com detalhe humano (ex: "admin Ana suspendeu por padrão de cancelamento"). Categoria é semântica fixa pra UI; reason é texto pro prestador ler
- ❌ Não permitir UPDATE de `suspension_category` / `reactivation_eligible_at` / `penalty_balance` por user normal — só service_role (jobs de penalidade) e admin (US-017)
- ❌ Não criar tabela separada de "tipos de suspensão" — enum é mais barato, semântica fechada, e migrations futuras adicionam valores (`ALTER TYPE ... ADD VALUE`)
- ❌ Não default `penalty_balance=0` em backfill se houver prestadores existentes — confirmar regra com produto

## Convenções
- Migration via psql; regenerar `database.types.ts` após
- Enum em snake_case (consistente com `provider_kyc_status`, `provider_account_status`)
- Trigger SECURITY DEFINER para acessar `auth.role()`/`auth.jwt()`
- `WHERE suspension_category IS NOT NULL` no índice mantém ele enxuto (maioria dos prestadores está `active`)
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-035 [DATA] tabela provider_suspension_events (log imutável)
-- ----------------------------------------------------------------------------
('9be6c33a-676f-46e8-a636-293a2bdcd875',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-035',
 'Criar tabela provider_suspension_events (log imutável de eventos de suspensão)',
 $desc$## Objetivo
Registrar **cada evento** que contribui ou causa suspensão (no-show #1, no-show #2, no-show #3, cancelamento contado para penalidade, revogação de geo, decisão de admin). A tela de suspensão por no-show (AC#2) e por penalidade (AC#6) precisa **listar os eventos** com data e referência (qual serviço gerou). Auditoria também depende disso. Cobre AC #2, #3, #6.

## Contexto
Módulo ONBOARDING — depende de T-034 (categoria) para tipar o evento. Será gravada por: jobs `pg_cron` (no-show automático após T+confirm_window — provável US-005/US-023), Edge Functions (penalidade gradativa — US-021/US-026), e admin via UI (US-017). Lida pela T-038 (endpoint que monta payload da tela).

## Estado atual / O que substitui
Não existe. Hoje, se um prestador for suspenso por 3 no-shows, perde a rastreabilidade — só fica o `suspension_reason` text livre. Esta tabela resolve.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_suspension_events.sql`
```sql
BEGIN;

CREATE TABLE provider_suspension_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  category          suspension_category NOT NULL,
  event_type        text NOT NULL,         -- 'no_show', 'cancellation', 'geo_revoked', 'admin_decision', 'kyc_rejection'
  service_id        uuid,                  -- ref ao serviço (FK em US-023+ quando service_requests existir)
  actor_id          uuid REFERENCES auth.users(id),  -- admin se aplicável; NULL se sistema
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot do penalty_balance no momento (auditoria, AC#6 mostra histórico)
  balance_after     smallint,
  "createdAt"       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX ON provider_suspension_events(provider_id, "createdAt" DESC);
CREATE INDEX ON provider_suspension_events(category);

ALTER TABLE provider_suspension_events ENABLE ROW LEVEL SECURITY;

-- Prestador lê só seus eventos
CREATE POLICY "provider_read_own_events" ON provider_suspension_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM provider_profiles pp
      WHERE pp.id = provider_suspension_events.provider_id
        AND pp.user_id = auth.uid()
    )
  );

-- Admin lê tudo
CREATE POLICY "admin_read_all_events" ON provider_suspension_events
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- INSERT só por service_role / admin (jobs e Edge Functions usam service_role)
CREATE POLICY "admin_insert_events" ON provider_suspension_events
  FOR INSERT WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
-- service_role bypassa RLS por default

-- UPDATE/DELETE: ninguém. Log imutável.
-- (sem policy ⇒ acesso negado por default)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não permitir UPDATE/DELETE de eventos — log imutável (auditoria). Correção via novo evento ('admin_correction')
- ❌ Não exigir FK em `service_id` ainda (tabela `service_requests` ainda não existe; FK opcional virará obrigatória em US-023)
- ❌ Não duplicar `category` em cada evento de penalidade — semântica é "evento contribui pra essa categoria de suspensão"
- ❌ Não usar coluna `details` como vazadouro de PII; campos comuns vão em colunas estruturadas

## Convenções
- Tabela em snake_case; `"createdAt"` em camelCase com aspas (convenção do projeto)
- `event_type` é text (não enum) porque é mais granular que `category` e cresce com o produto
- `details jsonb` documenta no PR: {`no_show`: `{service_id, scheduled_at, was_excused}`}, {`admin_decision`: `{reason, ticket_id}`}, etc.
- INSERT só por service_role/admin garante que o prestador não pode fabricar eventos
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-036 [DATA] tabela provider_appeals (contestações + anexos)
-- ----------------------------------------------------------------------------
('5853e430-3899-4d02-887d-d113181dc03c',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-036',
 'Criar tabela provider_appeals com texto livre, anexos e protocolo',
 $desc$## Objetivo
Permitir que prestador suspenso (por no-show, manual ou penalidade) submeta uma contestação com texto livre + anexos (até 5 arquivos) e receba **número de protocolo** com prazo de resposta. Operação de suporte (US-016/US-026 fora deste fluxo) responde gravando `decision` + `decided_at`. Cobre AC #7 e parcialmente #8 (notificação ao decidir).

## Contexto
Módulo ONBOARDING — depende de T-034 (provider tem categoria) e T-035 (eventos auditáveis). Anexos vão em Storage Supabase em bucket privado `provider-appeals/{appeal_id}/{filename}`. Notificação ao prestador quando decisão sai vive em T-042 (camada API).

## Estado atual / O que substitui
Não existe. Hoje a contestação é "abrir ticket de suporte" genérico (sem flow estruturado).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_appeals.sql`
```sql
BEGIN;

CREATE TYPE appeal_status AS ENUM ('open', 'under_review', 'accepted', 'rejected', 'withdrawn');

CREATE TABLE provider_appeals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  protocol        text NOT NULL UNIQUE,    -- ex: "APP-2026-05-0001" (gerado por trigger)
  category        suspension_category NOT NULL,  -- a categoria de suspensão sendo contestada
  message         text NOT NULL CHECK (length(message) BETWEEN 30 AND 4000),
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{path, size, mime}]
  status          appeal_status NOT NULL DEFAULT 'open',
  decision_note   text,                    -- preenchido por admin ao responder
  decided_by      uuid REFERENCES auth.users(id),
  decided_at      timestamptz,
  expected_response_by  timestamptz NOT NULL,  -- prazo SLA (ex: T+72h)
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX ON provider_appeals(provider_id, "createdAt" DESC);
CREATE INDEX ON provider_appeals(status) WHERE status IN ('open','under_review');

-- Trigger geração de protocolo
CREATE OR REPLACE FUNCTION generate_appeal_protocol() RETURNS trigger AS $$
DECLARE seq_n integer;
BEGIN
  IF NEW.protocol IS NULL OR NEW.protocol = '' THEN
    seq_n := nextval('provider_appeals_protocol_seq');
    NEW.protocol := 'APP-' || to_char(NOW(), 'YYYY-MM') || '-' || lpad(seq_n::text, 4, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE SEQUENCE provider_appeals_protocol_seq;
CREATE TRIGGER provider_appeals_set_protocol
  BEFORE INSERT ON provider_appeals
  FOR EACH ROW EXECUTE FUNCTION generate_appeal_protocol();

ALTER TABLE provider_appeals ENABLE ROW LEVEL SECURITY;

-- Prestador lê e cria suas próprias
CREATE POLICY "provider_own_appeals_select" ON provider_appeals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM provider_profiles pp
      WHERE pp.id = provider_appeals.provider_id AND pp.user_id = auth.uid()
    )
  );

CREATE POLICY "provider_create_own_appeal" ON provider_appeals
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider_profiles pp
      WHERE pp.id = provider_appeals.provider_id AND pp.user_id = auth.uid()
    )
    AND status = 'open'  -- só pode criar 'open'; mudanças via API com auth admin
    AND decided_at IS NULL
  );

-- Prestador pode cancelar (UPDATE para 'withdrawn') — sem mexer em outras colunas
CREATE POLICY "provider_withdraw_own_appeal" ON provider_appeals
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM provider_profiles pp
      WHERE pp.id = provider_appeals.provider_id AND pp.user_id = auth.uid()
    )
  ) WITH CHECK (
    status = 'withdrawn'  -- só transição permitida via RLS
  );

-- Admin tudo
CREATE POLICY "admin_appeals_all" ON provider_appeals
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER provider_appeals_updated_at
  BEFORE UPDATE ON provider_appeals
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não armazenar arquivos no DB — `attachments` referencia paths em Storage (bucket privado)
- ❌ Não permitir múltiplas contestações abertas simultâneas pra mesma `category` (validar na API T-039 — UNIQUE não cabe porque permite repetir após decisão)
- ❌ Não expor `decision_note` antes de `decided_at IS NOT NULL` — admin pode estar redigindo. Filtra na view/API
- ❌ Não permitir UPDATE de `message`/`attachments` após criação — contestação é imutável, pode só ser withdrawn

## Convenções
- Anexos: bucket Storage `provider-appeals` (privado), path `{appeal_id}/{filename}`, max 5 arquivos × 5MB = 25MB
- `expected_response_by` calculado pela API: T+72h (SLA padrão); admin estende se justificado
- `protocol` legível pra suporte humano: `APP-YYYY-MM-NNNN` global (sequence única)
- `appeal_status='withdrawn'` é o caminho do prestador desistir da contestação (não delete)
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-037 [DATA] view provider_onboarding_state estendida com sinais de suspensão
-- ----------------------------------------------------------------------------
('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-037',
 'Atualizar view provider_onboarding_state com categoria, eventos e previsão de reabilitação',
 $desc$## Objetivo
Estender a view `provider_onboarding_state` (criada em T-014) para incluir os sinais necessários ao roteamento e à tela de suspensão: `suspension_category`, `reactivation_eligible_at`, `penalty_balance`, `last_suspension_event_at`, `pending_appeal_id`. Permite que o resolver de rota (T-018/T-041) e a tela `/suspended` (T-043) consumam **uma única view**. Cobre AC #1, #2, #3, #4, #6.

## Contexto
Módulo ONBOARDING — depende de T-034 (colunas estruturadas), T-035 (eventos), T-036 (appeals). View é `SECURITY INVOKER` (default), então herda RLS de cada base — prestador vê só seus dados. T-014 já existe; esta task é `CREATE OR REPLACE VIEW`.

## Estado atual / O que substitui
T-014 já criou a view com `account_status`, `suspended_at`, `suspension_reason` e `route_target` (suspended/blocked/...). Esta task **substitui** a view com versão estendida — `route_target` ganha lógica de `category`, e novas colunas aparecem.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_onboarding_state_v2.sql`
```sql
BEGIN;

CREATE OR REPLACE VIEW provider_onboarding_state AS
SELECT
  pp.user_id,
  pp.id AS provider_id,
  pp.signup_step,
  pp.kyc_status,
  pp.kyc_attempts,
  pp.kyc_blocked_reason,
  pp.account_status,
  pp.suspended_at,
  pp.suspension_reason,
  pp.suspension_category,           -- novo (T-034)
  pp.reactivation_eligible_at,      -- novo (T-034)
  pp.penalty_balance,               -- novo (T-034)
  -- Último evento de suspensão (drives "última atualização" na tela)
  (SELECT MAX("createdAt")
     FROM provider_suspension_events e
     WHERE e.provider_id = pp.id) AS last_suspension_event_at,
  -- Contestação aberta (drives botão "Ver contestação" vs "Contestar")
  (SELECT id FROM provider_appeals a
     WHERE a.provider_id = pp.id
       AND a.status IN ('open','under_review')
     ORDER BY a."createdAt" DESC LIMIT 1) AS pending_appeal_id,
  -- Pré-requisitos (T-014 mantidos)
  COALESCE(
    (SELECT COUNT(*) > 0 FROM provider_categories pc WHERE pc.provider_id = pp.id),
    false
  ) AS has_categories,
  false AS has_availability,    -- placeholder US-027
  false AS has_bank_account,    -- placeholder US-028
  -- Decisão de roteamento estendida
  CASE
    WHEN pp.account_status = 'suspended' THEN 'suspended'
    WHEN pp.account_status = 'blocked'   THEN 'blocked'
    WHEN pp.kyc_status = 'pending' AND pp.signup_step < 5 THEN 'continue_signup'
    WHEN pp.kyc_status = 'in_review'                       THEN 'kyc_in_review'
    WHEN pp.kyc_status = 'rejected'                        THEN 'kyc_rejected'
    WHEN pp.kyc_status = 'blocked'                         THEN 'kyc_blocked'
    WHEN pp.kyc_status = 'approved' AND NOT (
         COALESCE((SELECT COUNT(*) > 0 FROM provider_categories pc WHERE pc.provider_id = pp.id), false)
       )                                                    THEN 'first_steps'
    WHEN pp.kyc_status = 'approved'                         THEN 'home'
    ELSE 'continue_signup'
  END AS route_target
FROM provider_profiles pp;

GRANT SELECT ON provider_onboarding_state TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não materializar (mesma razão de T-014 — estado muda em cada login)
- ❌ Não vazar `decision_note` da contestação (a view só expõe `pending_appeal_id`; detalhe vai pelo endpoint)
- ❌ Não inverter ordem do CASE — `account_status='blocked'` deve ter precedência sobre `kyc_status='approved'` (prestador aprovado pode ser bloqueado depois)
- ❌ Não filtrar `provider_suspension_events` pela `category` ativa — quando muda categoria, eventos antigos continuam relevantes pra histórico

## Convenções
- View `OR REPLACE` — substitui T-014 sem migration "drop". `database.types.ts` regenerado pega novas colunas
- Subquery escalar com `LIMIT 1` é OK aqui (poucos appeals por provider); se virar gargalo, vira lateral join
- `SECURITY INVOKER` (default) garante RLS herdada — não usar `SECURITY DEFINER`
$desc$,
 'DATA', 'PRESTADOR', ARRAY['NO_RLS_NEEDED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-038 [API] GET /api/provider/suspension-status
-- ----------------------------------------------------------------------------
('84a9836a-d50d-4e62-96d4-83e301d9f5cb',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-038',
 'Implementar GET /api/provider/suspension-status (motivo + eventos + previsão + canal)',
 $desc$## Objetivo
Endpoint que a tela `/suspended` (T-043) consome para montar o conteúdo: categoria, motivo, lista de eventos contribuintes, previsão de reabilitação automática, contestação aberta (se houver) e canal de suporte. Cobre AC #1, #2, #3, #4, #5, #6.

## Contexto
Módulo ONBOARDING — depende de T-037 (view com sinais), T-035 (eventos) e T-036 (appeals). Chamado pela tela `/suspended` no mount; também pela tela `/blocked` (T-044) no caso de bloqueio definitivo. Idempotente, GET, sem efeito colateral.

## Estado atual / O que substitui
Não existe. T-018 (route-state) decide pra **onde redirecionar**, mas não retorna o **payload** da tela suspensa.

## O que criar

### `src/app/api/provider/suspension-status/route.ts`
```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Lê via view (RLS já filtra por user_id)
  const { data: state, error: e1 } = await supabase
    .from('provider_onboarding_state')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (e1) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

  // Não suspenso → 409 (cliente não deveria estar chamando isso)
  if (state.account_status !== 'suspended' && state.account_status !== 'blocked') {
    return NextResponse.json({ error: 'not_suspended' }, { status: 409 });
  }

  // Eventos contribuintes (RLS filtra)
  const { data: events } = await supabase
    .from('provider_suspension_events')
    .select('id, category, event_type, service_id, details, balance_after, "createdAt"')
    .eq('provider_id', state.provider_id)
    .order('createdAt', { ascending: false })
    .limit(20);

  // Contestação aberta (se houver)
  let pendingAppeal = null;
  if (state.pending_appeal_id) {
    const { data: appeal } = await supabase
      .from('provider_appeals')
      .select('id, protocol, status, "createdAt", expected_response_by')
      .eq('id', state.pending_appeal_id)
      .single();
    pendingAppeal = appeal;
  }

  return NextResponse.json({
    state: {
      account_status: state.account_status,
      suspension_category: state.suspension_category,
      suspension_reason: state.suspension_reason,
      suspended_at: state.suspended_at,
      reactivation_eligible_at: state.reactivation_eligible_at,
      penalty_balance: state.penalty_balance,
      last_suspension_event_at: state.last_suspension_event_at,
    },
    events,
    pending_appeal: pendingAppeal,
    support_channel: { type: 'whatsapp', target: process.env.SUPPORT_WHATSAPP_LINK },
  });
}
```

## Constraints / NÃO fazer
- ❌ Não retornar 200 com body vazio se prestador não está suspenso — 409 deixa o frontend reagir certo (provavelmente bug no roteamento)
- ❌ Não bypassar RLS aqui (sem `createAdminClient`) — o prestador só lê o próprio
- ❌ Não incluir `decision_note` da contestação aqui (vaza decisão de admin antes da hora — endpoint de detalhe da contestação cuida disso)
- ❌ Não retornar mais que 20 eventos — se precisar, paginar em endpoint separado

## Convenções
- Route handler Next 16 (App Router) em `src/app/api/.../route.ts`
- Sem POST/PATCH/PUT (GET puro). Sem Idempotency-Key.
- `createClient()` server-side de `@/lib/supabase/server` (cookies + JWT do caller)
- `support_channel` lê `SUPPORT_WHATSAPP_LINK` de env var (já configurado pra US-016)
- Integra com T-043 que faz `useSWR('/api/provider/suspension-status')`
$desc$,
 'API', 'PRESTADOR', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-039 [API] POST /api/provider/appeals
-- ----------------------------------------------------------------------------
('c3de137e-f7e3-4117-b216-0762dfc0c1a4',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-039',
 'Implementar POST /api/provider/appeals (contestação com upload de anexos)',
 $desc$## Objetivo
Permitir que prestador suspenso submeta contestação com texto + até 5 anexos. Endpoint valida regras de negócio (não permite múltiplas contestações abertas pra mesma categoria), faz upload pra Storage Supabase em bucket privado e gera protocolo. Cobre AC #7.

## Contexto
Módulo ONBOARDING — depende de T-036 (tabela com trigger de protocolo). Chamado pela tela `/suspended` (T-043) ao prestador clicar "Contestar". Notificação ao admin de nova contestação fica em T-042 (Edge Function). Idempotência por `idempotency-key` previne double-submit no clique repetido.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/provider/appeals/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  category: z.enum(['no_show','manual','geo_consent','kyc','penalty']),
  message: z.string().min(30).max(4000),
  attachments: z.array(z.object({
    path: z.string(),  // path em provider-appeals/temp/{uuid} (upload prévio via signed URL)
    size: z.number().int().positive().max(5 * 1024 * 1024),
    mime: z.string(),
  })).max(5).default([]),
});

export async function POST(req: Request) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = Body.parse(await req.json());

  // Idempotência: chave guardada em tabela auxiliar idempotency_keys (US-022)
  // Por agora, validar via UNIQUE (provider_id, category, status='open')
  // já bloqueia duplicatas; idempotency-key é "future-proof".

  // RPC pra encapsular: validação de account_status='suspended', mover anexos de temp/ pra appeal_id/, INSERT
  const { data, error } = await supabase.rpc('create_provider_appeal', {
    p_idempotency_key: idemKey,
    p_category: body.category,
    p_message: body.message,
    p_attachments: body.attachments,
  });

  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (error.message.includes('not_suspended')) return NextResponse.json({ error: 'not_suspended' }, { status: 409 });
    if (error.message.includes('appeal_already_open')) return NextResponse.json({ error: 'appeal_already_open' }, { status: 409 });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
```

### RPC `create_provider_appeal` (Postgres `LANGUAGE plpgsql SECURITY DEFINER`)
- Lê `provider_profiles` por `auth.uid()` → 403 se não for o owner
- Verifica `account_status='suspended'` → 409 `not_suspended` se não
- Verifica que não há outra appeal `open|under_review` na mesma `category` → 409 `appeal_already_open`
- Move anexos de `provider-appeals/temp/...` pra `provider-appeals/{appeal_id}/...` via Storage API (chamada externa pela Edge Function ou skip se for batch)
- INSERT em `provider_appeals` com `expected_response_by = NOW() + interval '72 hours'`
- Retorna `{id, protocol, expected_response_by}`

### Upload de anexos (frontend → Storage)
- Antes do POST, frontend pede signed URL via `supabase.storage.from('provider-appeals').createSignedUploadUrl('temp/{uuid}/{filename}')`
- Faz upload direto pro Storage (não passa pela API)
- Envia paths no body do POST
- API valida MIME (jpeg/png/pdf), tamanho

## Constraints / NÃO fazer
- ❌ Não receber arquivo binário no body da API — sempre via Storage signed URL (escala, não consome lambda)
- ❌ Não criar appeal sem `idempotency-key` — clique duplo gera duplicata + duplo email pro admin
- ❌ Não permitir contestar `category='kyc'` com `account_status='blocked'` — KYC bloqueado é definitivo (AC#5); valida na RPC
- ❌ Não retornar 500 em validação de regra — sempre 4xx claro

## Convenções
- Bucket Storage `provider-appeals` é privado (sem `public=true`); leitura via signed URL com TTL curto (5min)
- MIME aceitos: `image/jpeg`, `image/png`, `application/pdf`
- Rate limit: 3 POSTs por hora por user (middleware de rate limit, US-022 ainda não tem; flag `RATE_LIMIT` documenta)
- Endpoint cria `audit_log` row (entity='provider_appeal', action='created') — flag AUDIT_LOG
$desc$,
 'API', 'PRESTADOR', ARRAY['RLS_REQUIRED','INPUT_VALIDATION','RATE_LIMIT','AUDIT_LOG','IDEMPOTENCY_KEY'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-040 [API] POST /api/provider/reactivate-geo-consent
-- ----------------------------------------------------------------------------
('ce20befd-c972-4e15-acab-2b1b901cd9a7',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-040',
 'Implementar POST /api/provider/reactivate-geo-consent (reativar e remover suspensão automática)',
 $desc$## Objetivo
Quando prestador reativa permissão de geolocalização no dispositivo (toggle do navegador) e clica "Reativar minha conta" na tela `/suspended` (variante geo), endpoint registra novo consent em `lgpd_consents` e — se a única razão da suspensão era `category='geo_consent'` — remove automaticamente a suspensão (`account_status='active'`, `suspension_category=NULL`, etc.). Cobre AC #4.

## Contexto
Módulo ONBOARDING — depende de T-034 (categoria). Endpoint usa **service_role internamente** (via SECURITY DEFINER) pra bypassar o trigger `provider_profiles_protect_admin_cols` que bloqueia UPDATE de `account_status` por user normal. Se houver outra categoria ativa também (ex: penalidade), só registra o consent **sem** reativar — e retorna `partial: true` pra UI explicar.

## Estado atual / O que substitui
Não existe. Hoje, prestador suspenso por geo_consent precisaria abrir ticket pra suporte, mesmo após reativar permissão.

## O que criar

### `src/app/api/provider/reactivate-geo-consent/route.ts`
```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RPC encapsula: registra consent, decide se reativa, retorna estado novo
  const { data, error } = await supabase.rpc('reactivate_geo_consent_and_maybe_unsuspend');
  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
  // data = { consent_recorded: true, reactivated: true|false, account_status, remaining_categories: [...] }
  return NextResponse.json(data);
}
```

### RPC `reactivate_geo_consent_and_maybe_unsuspend` (LANGUAGE plpgsql SECURITY DEFINER)
- Lê `provider_profiles` por `auth.uid()`
- INSERT em `lgpd_consents` (kind='geolocation', granted=true, granted_at=NOW())
- Se `suspension_category='geo_consent'` E `penalty_balance=0` E sem appeal pendente que dependa de geo:
  - UPDATE `provider_profiles` SET account_status='active', suspended_at=NULL, suspension_category=NULL, suspension_reason=NULL, reactivation_eligible_at=NULL
  - INSERT em `provider_suspension_events` (event_type='auto_reactivation', category='geo_consent', actor_id=NULL)
  - Retorna `{consent_recorded: true, reactivated: true, account_status: 'active'}`
- Caso contrário:
  - Retorna `{consent_recorded: true, reactivated: false, account_status: 'suspended', remaining_categories: [...]}`

## Constraints / NÃO fazer
- ❌ Não usar service_role do client (Edge Function ou route handler) — o trigger de proteção bloqueia user normal mesmo via service_role mal-configurado; a RPC `SECURITY DEFINER` é o caminho
- ❌ Não considerar idempotência via `idempotency-key` — operação é *naturalmente idempotente* (registrar consent 2x não muda estado; reativar já-ativa é no-op)
- ❌ Não suprimir `provider_suspension_events` — o evento de auto_reactivation é necessário pra auditoria (admin precisa ver que sistema reativou)
- ❌ Não compor com US-021 (recálculo de score) aqui — score é outra task (relates_to)

## Convenções
- RPC SECURITY DEFINER tem que validar `auth.uid()` explicitamente (não confia em RLS, pois bypassa)
- Race condition: se admin estiver reativando manualmente ao mesmo tempo, a UPDATE faz CAS por `account_status='suspended' AND suspension_category='geo_consent'` (RACE_CONDITION flag)
- Audit row entry: AUDIT_LOG flag
$desc$,
 'API', 'PRESTADOR', ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-041 [API] Estender guard do proxy.ts para diferenciar suspended vs blocked
-- ----------------------------------------------------------------------------
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-041',
 'Estender guard do proxy.ts para rotear suspended → /suspended e blocked → /blocked',
 $desc$## Objetivo
A T-019 já bloqueia rotas operacionais quando o prestador não está em estado normal. Esta task **estende** o guard pra distinguir `account_status='suspended'` (redireciona pra `/suspended`) vs `account_status='blocked'` (redireciona pra `/blocked`), em vez do destino genérico atual. Cobre AC #1, #5, #9.

## Contexto
Módulo ONBOARDING — depende de T-019 (guard base). `proxy.ts` lê `provider_onboarding_state.route_target` (T-014/T-037) e já tem 'suspended'/'blocked' como targets. Esta task ajusta o **mapeamento route_target → URL de redirect** e garante que rotas `/suspended` e `/blocked` (T-043, T-044) existam como destinos.

## Estado atual / O que substitui
T-019 redireciona suspendos pra `/login` ou pra um destino genérico. Esta task **refatora** a função `decideRedirectByOnboardingState` (helper criado em T-019) pra diferenciar 2 destinos.

## O que criar

### `src/proxy.ts` (alteração)
Hoje (excerto T-019):
```ts
// pseudo
if (state.route_target === 'suspended' || state.route_target === 'blocked') {
  return NextResponse.redirect(new URL('/account-on-hold', req.url));
}
```

Substituir por:
```ts
const ONBOARDING_TARGETS_TO_PATH: Record<string, string> = {
  suspended: '/suspended',
  blocked: '/blocked',
  kyc_in_review: '/kyc/in-review',
  kyc_rejected: '/kyc/rejected',
  kyc_blocked: '/kyc/blocked',
  first_steps: '/onboarding/first-steps',
  continue_signup: '/onboarding/provider/wizard',
};

const targetPath = ONBOARDING_TARGETS_TO_PATH[state.route_target];
if (targetPath && pathname !== targetPath && !pathname.startsWith('/api/')) {
  // Permite GET de /api/provider/suspension-status etc. mesmo suspenso
  return NextResponse.redirect(new URL(targetPath, req.url));
}
```

### Whitelist de rotas permitidas mesmo suspenso
- `/suspended`, `/blocked` (telas-alvo)
- `/api/provider/suspension-status` (T-038)
- `/api/provider/appeals` (T-039 — POST)
- `/api/provider/reactivate-geo-consent` (T-040)
- `/auth/*` (logout funciona)
- `/profile/edit` ❌ — bloqueado (rotas operacionais inacessíveis, AC#9)

## Constraints / NÃO fazer
- ❌ Não loop infinito de redirect — se já está em `/suspended` e `route_target='suspended'`, não redirecionar (verificar `pathname !== targetPath`)
- ❌ Não permitir tela `/blocked` redirecionar pra `/suspended` (e vice-versa) — guard tem que respeitar o destino exato
- ❌ Não chamar `provider_onboarding_state` em **toda** request — cachear via header injetado por T-019 (`x-onboarding-target`) ou cookie de curta duração
- ❌ Não bloquear `/api/auth/*` — logout precisa funcionar mesmo suspenso

## Convenções
- Manter a função pura e testável (input: route_target + pathname → output: redirect URL ou null)
- `proxy.ts` é Next 16 — confirmar API atual via `node_modules/next/dist/docs/` (memory: "This is NOT the Next.js you know")
- Sem RLS aqui (proxy não acessa DB direto além do `getUser()` da T-019)
$desc$,
 'API', 'PRESTADOR', ARRAY['NO_RLS_NEEDED'],
 'draft', 'refactor',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-042 [API] Notificar prestador ao decidir contestação ou concluir reativação
-- ----------------------------------------------------------------------------
('efea1257-5a09-4aef-a037-595e9174ce74',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-042',
 'Notificar prestador (canal externo) ao decidir contestação ou concluir reativação',
 $desc$## Objetivo
Quando admin decide uma contestação (`provider_appeals.status` muda pra `accepted`/`rejected`) ou sistema/admin reativa conta suspensa, disparar notificação externa (WhatsApp + email) pro prestador via plataforma de comunicação (US-024). Persona: SISTEMA (sem UI). Cobre AC #8.

## Contexto
Módulo ONBOARDING — depende de T-036 (provider_appeals) e T-034 (account_status). Implementa via **trigger de DB** + **Edge Function**. Trigger em `provider_appeals` AFTER UPDATE detecta mudança de status terminal e enfileira evento; trigger em `provider_profiles` AFTER UPDATE detecta `account_status` voltando pra `active` (vindo de `suspended`). Edge Function consumer lê fila e envia.

## Estado atual / O que substitui
Não existe. Plataforma de comunicação (US-024) ainda em draft — esta task **prepara** o ponto de integração mas usa stub de envio enquanto US-024 não chega.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_appeal_decision_notifier.sql`
```sql
BEGIN;

-- Tabela de fila simples (substituída por pgmq quando US-024 implementar)
CREATE TABLE IF NOT EXISTS notification_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    uuid NOT NULL,
  template        text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending | sent | failed
  attempts        smallint NOT NULL DEFAULT 0,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  sent_at         timestamptz
);

CREATE INDEX ON notification_queue(status, "createdAt") WHERE status = 'pending';

-- Trigger: appeal status muda pra terminal
CREATE OR REPLACE FUNCTION notify_appeal_decision() RETURNS trigger AS $$
DECLARE owner_user_id uuid;
BEGIN
  IF NEW.status IN ('accepted','rejected') AND OLD.status NOT IN ('accepted','rejected') THEN
    SELECT pp.user_id INTO owner_user_id FROM provider_profiles pp WHERE pp.id = NEW.provider_id;
    INSERT INTO notification_queue (recipient_id, template, payload)
    VALUES (owner_user_id, 'appeal_' || NEW.status, jsonb_build_object(
      'protocol', NEW.protocol,
      'category', NEW.category,
      'decision_note', NEW.decision_note
    ));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER provider_appeals_notify
  AFTER UPDATE ON provider_appeals
  FOR EACH ROW EXECUTE FUNCTION notify_appeal_decision();

-- Trigger: account_status volta pra active (reativação concluída)
CREATE OR REPLACE FUNCTION notify_reactivation() RETURNS trigger AS $$
BEGIN
  IF OLD.account_status = 'suspended' AND NEW.account_status = 'active' THEN
    INSERT INTO notification_queue (recipient_id, template, payload)
    VALUES (NEW.user_id, 'account_reactivated', jsonb_build_object(
      'previous_category', OLD.suspension_category
    ));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER provider_profiles_notify_reactivation
  AFTER UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION notify_reactivation();

COMMIT;
```

### `supabase/functions/dispatch-notifications/index.ts` (Edge Function)
- Roda a cada 1min via pg_cron (provisório até US-024)
- `SELECT * FROM notification_queue WHERE status='pending' ORDER BY "createdAt" LIMIT 50 FOR UPDATE SKIP LOCKED`
- Pra cada: chama integração (WhatsApp via Meta API + email via Resend) com template
- UPDATE `status='sent'` ou `attempts++, status='failed'` se 5+ tentativas

## Constraints / NÃO fazer
- ❌ Não enviar **dentro** do trigger — síncrono = bloqueia commit, deadlock se API externa pendurar. Sempre enfileirar
- ❌ Não vazar `decision_note` completa via WhatsApp se houver PII — template trunca + remete pra deeplink no PWA
- ❌ Não duplicar notificação em retry — `attempts++` deve usar lock + idempotency dentro da Edge Function
- ❌ Não criar tabela final aqui se US-024 vai unificar — `IF NOT EXISTS` permite que US-024 use a mesma tabela ou substitua por pgmq

## Convenções
- `template` é uma string que mapeia em código pro conteúdo (i18n_deferred — pt-BR direto)
- Secret `META_WHATSAPP_TOKEN`, `RESEND_API_KEY` — flag SECRET_HANDLING
- Audit: cada envio bem-sucedido entra em audit_log (entity='notification', action='sent')
- Quando US-024 (plataforma de comunicação) implementar, esta task **migra** a tabela e a Edge Function pra contrato unificado
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-043 [UI] Renderizar /suspended com 5 variantes
-- ----------------------------------------------------------------------------
('694f45dd-9bde-42aa-b36d-f337c60bf3cd',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-043',
 'Renderizar /suspended com variantes por categoria e ações contextuais',
 $desc$## Objetivo
Tela `/suspended` (PWA prestador) mostra ao prestador, conforme `suspension_category`, uma das 5 variantes — no_show, manual, geo_consent, kyc, penalty — com motivo, eventos contribuintes (no_show e penalty), previsão de reabilitação (penalty) e ações contextuais (Contestar / Reativar geo / Aguardar / Falar com suporte). Reusa pattern visual de `/kyc/in-review` (T-021) e `/kyc/rejected` (T-022). Cobre AC #1, #2, #3, #4, #6, #7.

## Contexto
Módulo ONBOARDING — depende de T-038 (endpoint que retorna o payload), T-039 (POST contestação), T-040 (POST reativar geo). Tela é Server Component que faz fetch inicial + Client Component pra ações. Todo o conteúdo varia por categoria, mas estrutura é compartilhada.

## Estado atual / O que substitui
Não existe `/suspended`. Hoje proxy redireciona pra rota inexistente (404).

## O que criar

### `src/app/(provider)/suspended/page.tsx`
```tsx
// Server component — fetch inicial direto do server
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SuspensionView } from '@/components/provider/suspension/suspension-view';

export default async function SuspendedPage() {
  const supabase = await createClient();
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/provider/suspension-status`, {
    headers: { cookie: (await import('next/headers')).cookies().toString() },
    cache: 'no-store',
  });
  if (res.status === 409) redirect('/'); // não está suspenso
  if (!res.ok) throw new Error('failed_to_load');
  const data = await res.json();
  return <SuspensionView initial={data} />;
}
```

### `src/components/provider/suspension/suspension-view.tsx` ('use client')
- Recebe payload, decide variante por `state.suspension_category`
- Header: ícone + título por categoria + `suspension_reason`
- Body por variante:
  - `no_show`: lista de até N eventos de no-show (data + ref ao serviço)
  - `manual`: motivo do admin (text livre) + botão "Falar com suporte"
  - `geo_consent`: instrução pra reativar permissão + botão "Reativar minha conta"
  - `kyc`: redireciona pra `/blocked` (não deveria chegar aqui se T-041 funcionar; defesa)
  - `penalty`: gauge de `penalty_balance` + previsão `reactivation_eligible_at` + lista de eventos
- Footer com 1-2 botões contextuais:
  - Contestar (abre `ResponsiveSheet` com Field/Textarea + upload de anexos via signed URL)
  - Falar com suporte (deeplink WhatsApp do payload)
  - Sair (LogoutButton da T-024 — reuso)

### `src/components/provider/suspension/appeal-sheet.tsx`
- `ResponsiveSheet size="lg"` — Header + Body + Footer
- `<FormBody density="comfortable">`:
  - `<Field name="message" required>` com `<Textarea>` (30..4000)
  - `<Field name="attachments">` com upload (lê signed URL do `useUploadAppealAttachments` hook)
- Submit: chama `mutate` (useOptimisticCollection) com POST `/api/provider/appeals` (idempotency-key gerado client-side)
- Sucesso: toast "Contestação registrada — protocolo APP-..." + fecha sheet + atualiza UI

## Reuso
- `ResponsiveSheet` (size="lg") — appeal sheet
- `Field` + `Textarea` + `Input` (file) — formulário
- `Button` (variants: primary, destructive, ghost)
- `Card`, `Badge`, `Skeleton`, `Tooltip`
- `LogoutButton` (de T-024) — reuso direto
- `Sonner` (`showErrorToast`) — feedback de erro
- `useOptimisticCollection` — lista de eventos (se prestador adicionar contestação, atualiza UI sem refetch)
- `useIsMobile` — variantes de layout

## Constraints / NÃO fazer
- ❌ Não usar `<Dialog>` cru — `ResponsiveSheet` para edição rica (memory `project_ui_patterns`)
- ❌ Não usar `window.confirm()` — `ConfirmDialog` se aparecer confirmação destrutiva (provável: "Cancelar contestação?")
- ❌ Não usar `react-hook-form` — Field compound API com `useState` direto (memory)
- ❌ Não validar Zod no client — só no servidor (T-039 valida); aqui só checa min/max via HTML5 attrs e desabilita botão
- ❌ Não cachear endpoint de status — `cache: 'no-store'` (estado muda em segundos quando admin decide)

## Convenções
- Mobile-first (PWA prestador roda em campo)
- Strings em pt-BR direto, sem i18n
- Tap targets ≥44px nos botões de ação
- Acessibilidade: cor + ícone (não cor sozinha) pra distinguir variantes
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-044 [UI] Renderizar /blocked (bloqueio definitivo)
-- ----------------------------------------------------------------------------
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '10ad9e98-4c13-436a-932c-ca38b1a5745b',
 'ZLAR-V2-T-044',
 'Renderizar /blocked (bloqueio definitivo, sem reenvio, contato suporte)',
 $desc$## Objetivo
Tela `/blocked` (PWA prestador) é o **destino terminal** quando `account_status='blocked'` — hoje o gatilho previsto é 2 reprovações de KYC (T-008 da US-001). Mostra explicação clara, **sem botões de ação operacional** (não há reenvio, não há contestação rápida) e canal de suporte para casos excepcionais. Cobre AC #5.

## Contexto
Módulo ONBOARDING — depende de T-038 (endpoint que retorna `account_status='blocked'` e detalhe). Pattern visual reusa T-022 (`/kyc/rejected`) mas sem o botão de "Reenviar documentos".

## Estado atual / O que substitui
Não existe `/blocked`. T-022 já cobre KYC reprovado **com tentativas restantes**; T-044 é o caso terminal sem tentativas.

## O que criar

### `src/app/(provider)/blocked/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { BlockedView } from '@/components/provider/suspension/blocked-view';

export default async function BlockedPage() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/provider/suspension-status`, {
    headers: { cookie: (await import('next/headers')).cookies().toString() },
    cache: 'no-store',
  });
  if (res.status === 409) redirect('/');
  if (!res.ok) throw new Error('failed_to_load');
  const data = await res.json();
  if (data.state.account_status !== 'blocked') redirect('/suspended');
  return <BlockedView state={data.state} support={data.support_channel} />;
}
```

### `src/components/provider/suspension/blocked-view.tsx`
- Header: ícone vermelho + "Conta bloqueada"
- Body: "Sua conta foi bloqueada após {state.suspension_reason}. Esta decisão é final."
- Único botão: "Falar com suporte" (deeplink WhatsApp)
- Discrete `LogoutButton` de T-024 no rodapé

## Reuso
- `Card`, `Button`, `Badge`
- `LogoutButton` (T-024)
- `Sonner` (irrelevante aqui — sem ações)

## Constraints / NÃO fazer
- ❌ Não permitir caminho de volta — sem botão "Reenviar", "Contestar", "Refazer KYC"
- ❌ Não mostrar timer / previsão — bloqueio é definitivo
- ❌ Não permitir esta tela aparecer com `account_status != 'blocked'` (defesa: redirect)
- ❌ Não fazer animação que sugira "carregando" — finalidade da tela é encerrar

## Convenções
- Mobile-first
- Cor + ícone pra reforçar finalidade
- Sem fetch repetido — esta página não vai mudar (estado terminal)
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculo task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-034 cobre AC 1, 2, 3, 4, 6
  ('5d2abc4d-9aba-41d8-aeda-39bd113130e2'::uuid, 1),
  ('5d2abc4d-9aba-41d8-aeda-39bd113130e2'::uuid, 2),
  ('5d2abc4d-9aba-41d8-aeda-39bd113130e2'::uuid, 3),
  ('5d2abc4d-9aba-41d8-aeda-39bd113130e2'::uuid, 4),
  ('5d2abc4d-9aba-41d8-aeda-39bd113130e2'::uuid, 6),
  -- T-035 cobre AC 2, 3, 6
  ('9be6c33a-676f-46e8-a636-293a2bdcd875'::uuid, 2),
  ('9be6c33a-676f-46e8-a636-293a2bdcd875'::uuid, 3),
  ('9be6c33a-676f-46e8-a636-293a2bdcd875'::uuid, 6),
  -- T-036 cobre AC 7, 8
  ('5853e430-3899-4d02-887d-d113181dc03c'::uuid, 7),
  ('5853e430-3899-4d02-887d-d113181dc03c'::uuid, 8),
  -- T-037 cobre AC 1, 2, 3, 4, 6
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a'::uuid, 1),
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a'::uuid, 2),
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a'::uuid, 3),
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a'::uuid, 4),
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a'::uuid, 6),
  -- T-038 cobre AC 1, 2, 3, 4, 5, 6
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb'::uuid, 1),
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb'::uuid, 2),
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb'::uuid, 3),
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb'::uuid, 4),
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb'::uuid, 5),
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb'::uuid, 6),
  -- T-039 cobre AC 7
  ('c3de137e-f7e3-4117-b216-0762dfc0c1a4'::uuid, 7),
  -- T-040 cobre AC 4
  ('ce20befd-c972-4e15-acab-2b1b901cd9a7'::uuid, 4),
  -- T-041 cobre AC 1, 5, 9
  ('c48bf57a-d271-4bc1-b3ea-09f2473ebc72'::uuid, 1),
  ('c48bf57a-d271-4bc1-b3ea-09f2473ebc72'::uuid, 5),
  ('c48bf57a-d271-4bc1-b3ea-09f2473ebc72'::uuid, 9),
  -- T-042 cobre AC 8
  ('efea1257-5a09-4aef-a037-595e9174ce74'::uuid, 8),
  -- T-043 cobre AC 1, 2, 3, 4, 6, 7
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd'::uuid, 1),
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd'::uuid, 2),
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd'::uuid, 3),
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd'::uuid, 4),
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd'::uuid, 6),
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd'::uuid, 7),
  -- T-044 cobre AC 5
  ('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45'::uuid, 5)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- ============================================================================
-- 3. AC-da-Task (checklist técnico — vira checkbox no TaskSheet)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-034
('5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'Enum suspension_category criado com 5 valores (no_show, manual, geo_consent, kyc, penalty)', 1),
('5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'Colunas suspension_category, reactivation_eligible_at, penalty_balance adicionadas em provider_profiles', 2),
('5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'Trigger provider_profiles_protect_admin_cols estendido para bloquear UPDATE das novas colunas por user normal (smoke: tentativa retorna error 42501)', 3),
('5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'Index parcial em suspension_category (WHERE NOT NULL) criado', 4),

-- T-035
('9be6c33a-676f-46e8-a636-293a2bdcd875', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('9be6c33a-676f-46e8-a636-293a2bdcd875', 'Tabela provider_suspension_events criada com colunas (id, provider_id, category, event_type, service_id, actor_id, details, balance_after, createdAt)', 1),
('9be6c33a-676f-46e8-a636-293a2bdcd875', 'RLS: prestador lê só eventos onde provider.user_id = auth.uid() (smoke test com 2 prestadores)', 2),
('9be6c33a-676f-46e8-a636-293a2bdcd875', 'RLS: admin lê tudo via app_metadata.role=admin', 3),
('9be6c33a-676f-46e8-a636-293a2bdcd875', 'UPDATE/DELETE bloqueados por ausência de policy (smoke: erro)', 4),
('9be6c33a-676f-46e8-a636-293a2bdcd875', 'Indexes em (provider_id, createdAt DESC) e em category criados', 5),

-- T-036
('5853e430-3899-4d02-887d-d113181dc03c', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('5853e430-3899-4d02-887d-d113181dc03c', 'Enum appeal_status criado com 5 valores (open, under_review, accepted, rejected, withdrawn)', 1),
('5853e430-3899-4d02-887d-d113181dc03c', 'Tabela provider_appeals criada com check de length(message) BETWEEN 30 AND 4000', 2),
('5853e430-3899-4d02-887d-d113181dc03c', 'Sequence + trigger generate_appeal_protocol gera protocolo APP-YYYY-MM-NNNN no INSERT (smoke test)', 3),
('5853e430-3899-4d02-887d-d113181dc03c', 'RLS: prestador lê e cria appeals próprias; pode UPDATE só pra status=withdrawn', 4),
('5853e430-3899-4d02-887d-d113181dc03c', 'Bucket Storage provider-appeals criado como privado', 5),
('5853e430-3899-4d02-887d-d113181dc03c', 'Indexes em (provider_id, createdAt DESC) e em status parcial criados', 6),

-- T-037
('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'View provider_onboarding_state recriada com colunas adicionais (suspension_category, reactivation_eligible_at, penalty_balance, last_suspension_event_at, pending_appeal_id, provider_id)', 1),
('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'CASE de route_target preserva precedência: account_status suspended/blocked vence kyc_status', 2),
('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'View é SECURITY INVOKER (default); RLS herdada das tabelas base testada com 2 prestadores', 3),
('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'GRANT SELECT TO authenticated mantido', 4),

-- T-038
('84a9836a-d50d-4e62-96d4-83e301d9f5cb', 'Endpoint GET /api/provider/suspension-status criado em src/app/api/provider/suspension-status/route.ts', 0),
('84a9836a-d50d-4e62-96d4-83e301d9f5cb', '401 quando sem auth; 404 quando profile não existe; 409 quando account_status não é suspended/blocked', 1),
('84a9836a-d50d-4e62-96d4-83e301d9f5cb', 'Retorna { state, events, pending_appeal, support_channel } com tipos corretos', 2),
('84a9836a-d50d-4e62-96d4-83e301d9f5cb', 'RLS bloqueia leitura de eventos/appeals de outros prestadores (smoke com 2 sessions)', 3),
('84a9836a-d50d-4e62-96d4-83e301d9f5cb', 'Limita events em 20 (mais antigos paginados em endpoint separado se necessário)', 4),
('84a9836a-d50d-4e62-96d4-83e301d9f5cb', 'support_channel lido de SUPPORT_WHATSAPP_LINK env var', 5),

-- T-039
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'Endpoint POST /api/provider/appeals criado com Zod validando category, message, attachments', 0),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', '400 sem header Idempotency-Key; 400 em payload inválido', 1),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'RPC create_provider_appeal valida account_status=suspended e bloqueia duplicata da mesma category (409 appeal_already_open)', 2),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', '403 quando user tenta criar appeal pra outro provider', 3),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'Anexos movidos de provider-appeals/temp/ pra provider-appeals/{appeal_id}/ via Storage API', 4),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'expected_response_by setado em NOW() + 72h', 5),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'Audit_log row criado com entity=provider_appeal, action=created', 6),
('c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'Resposta 201 com {id, protocol, expected_response_by}', 7),

-- T-040
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'Endpoint POST /api/provider/reactivate-geo-consent criado', 0),
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'RPC reactivate_geo_consent_and_maybe_unsuspend (SECURITY DEFINER) valida auth.uid() explicitamente', 1),
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'INSERT em lgpd_consents (kind=geolocation, granted=true) sempre que chamado', 2),
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'Reativa account_status=active SOMENTE quando suspension_category=geo_consent E penalty_balance=0 E sem appeal pendente', 3),
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'Insere provider_suspension_events com event_type=auto_reactivation quando reativa', 4),
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'Retorna { consent_recorded, reactivated, account_status, remaining_categories } — UI distingue parcial vs total', 5),
('ce20befd-c972-4e15-acab-2b1b901cd9a7', 'CAS UPDATE com WHERE account_status=suspended AND suspension_category=geo_consent (RACE_CONDITION)', 6),

-- T-041
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'src/proxy.ts atualizado com mapa ONBOARDING_TARGETS_TO_PATH', 0),
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'route_target=suspended redireciona pra /suspended (não /account-on-hold genérico)', 1),
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'route_target=blocked redireciona pra /blocked', 2),
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'Não há loop infinito quando pathname já é targetPath (smoke: acessar /suspended estando suspenso não redireciona)', 3),
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'Whitelist /api/provider/suspension-status, /api/provider/appeals, /api/provider/reactivate-geo-consent, /auth/* funciona suspenso', 4),
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', '/profile/edit e outras rotas operacionais redirecionam pra /suspended (AC#9 smoke test)', 5),
('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', 'Header x-onboarding-target injetado pra evitar refetch downstream', 6),

-- T-042
('efea1257-5a09-4aef-a037-595e9174ce74', 'Tabela notification_queue criada (provisória até US-024) com index parcial em (status, createdAt) WHERE status=pending', 0),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Trigger notify_appeal_decision dispara INSERT na queue ao mudar appeal_status pra accepted/rejected', 1),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Trigger notify_reactivation dispara INSERT ao mudar account_status de suspended pra active', 2),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Edge Function dispatch-notifications consome queue com SELECT FOR UPDATE SKIP LOCKED', 3),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Templates appeal_accepted, appeal_rejected, account_reactivated implementados (pt-BR direto)', 4),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Secrets META_WHATSAPP_TOKEN e RESEND_API_KEY usados só em server (Edge Function)', 5),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Retry com max attempts=5; após isso status=failed e admin notificado', 6),
('efea1257-5a09-4aef-a037-595e9174ce74', 'Audit_log row pra cada envio bem-sucedido', 7),

-- T-043
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Rota /suspended criada em src/app/(provider)/suspended/page.tsx (Server Component)', 0),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Componente SuspensionView renderiza variantes corretas por suspension_category (no_show, manual, geo_consent, penalty)', 1),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Variant geo_consent mostra botão "Reativar minha conta" que chama T-040 e atualiza UI conforme retorno', 2),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Variant no_show e penalty mostram lista de eventos (até 20) com data e tipo', 3),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Variant penalty mostra penalty_balance e reactivation_eligible_at em formato humano', 4),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Botão Contestar abre ResponsiveSheet com FormBody (Field+Textarea+upload)', 5),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Submit da contestação chama T-039 com idempotency-key gerado client-side; sucesso fecha sheet + toast', 6),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'LogoutButton (T-024) presente no rodapé', 7),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Falha da API mostra toast via showErrorToast (sem alert nativo)', 8),
('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'Layout mobile-first verificado em <768px com tap targets ≥44px', 9),

-- T-044
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', 'Rota /blocked criada em src/app/(provider)/blocked/page.tsx', 0),
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', 'Defesa: redirect pra /suspended se account_status != blocked; redirect pra / se 409', 1),
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', 'Único botão de ação é "Falar com suporte" (deeplink WhatsApp)', 2),
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', 'LogoutButton (T-024) discreto no rodapé', 3),
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', 'Sem reenvio de KYC; sem contestação rápida (decisão final)', 4),
('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', 'Layout mobile-first', 5)
;

-- ============================================================================
-- 4. TaskDependency (kind LOWERCASE)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- Intra-US (US-008)
  ('9be6c33a-676f-46e8-a636-293a2bdcd875', '5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'blocks'),  -- T-035 ← T-034
  ('5853e430-3899-4d02-887d-d113181dc03c', '5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'blocks'),  -- T-036 ← T-034
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', '5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'blocks'),  -- T-037 ← T-034
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', '9be6c33a-676f-46e8-a636-293a2bdcd875', 'blocks'),  -- T-037 ← T-035
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb', '64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'blocks'),  -- T-038 ← T-037
  ('84a9836a-d50d-4e62-96d4-83e301d9f5cb', '9be6c33a-676f-46e8-a636-293a2bdcd875', 'blocks'),  -- T-038 ← T-035
  ('c3de137e-f7e3-4117-b216-0762dfc0c1a4', '5853e430-3899-4d02-887d-d113181dc03c', 'blocks'),  -- T-039 ← T-036
  ('ce20befd-c972-4e15-acab-2b1b901cd9a7', '5d2abc4d-9aba-41d8-aeda-39bd113130e2', 'blocks'),  -- T-040 ← T-034
  ('efea1257-5a09-4aef-a037-595e9174ce74', '5853e430-3899-4d02-887d-d113181dc03c', 'blocks'),  -- T-042 ← T-036
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd', '84a9836a-d50d-4e62-96d4-83e301d9f5cb', 'blocks'),  -- T-043 ← T-038
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'c3de137e-f7e3-4117-b216-0762dfc0c1a4', 'blocks'),  -- T-043 ← T-039
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd', 'ce20befd-c972-4e15-acab-2b1b901cd9a7', 'blocks'),  -- T-043 ← T-040
  -- Cross-US (US-002)
  ('c48bf57a-d271-4bc1-b3ea-09f2473ebc72', '058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'relates_to'),  -- T-041 (estende guard) → T-019
  ('64eb89b3-d8ec-4d8a-9ece-008a9c6aaf8a', 'cdbd64ee-917f-46f3-9bab-98082c313c69', 'relates_to'),  -- T-037 (substitui view) → T-014
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd', '5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'relates_to'),  -- T-043 reusa LogoutButton → T-024
  ('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', '5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'relates_to'),  -- T-044 reusa LogoutButton → T-024
  ('694f45dd-9bde-42aa-b36d-f337c60bf3cd', '08b784b8-cc67-43a8-a3a7-f052a39b5422', 'relates_to'),  -- T-043 pattern visual → T-022
  ('f9a6dfc7-a2f9-4da0-93fd-0b4af49c6e45', '08b784b8-cc67-43a8-a3a7-f052a39b5422', 'relates_to')   -- T-044 pattern visual → T-022
;

COMMIT;
