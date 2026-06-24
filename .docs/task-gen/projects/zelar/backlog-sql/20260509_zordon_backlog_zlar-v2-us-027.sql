-- Backlog cards (Zordon) para ZLAR-V2-US-027
-- "PRESTADOR configura disponibilidade semanal e acompanha agenda" (módulo PERFIL)
-- 13 tasks: 3 DATA + 5 API + 1 REALTIME + 4 UI
-- Refs: ZLAR-V2-T-111..123
-- Reuso: provider_availability_windows (US-003 T-025), GET/PUT availability (T-028),
--   provider_onboarding_state view (T-027), AccountActions/banner provider (T-091/T-031).

BEGIN;

-- =====================================================================
-- 1) Tasks
-- =====================================================================
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-111 DATA: provider_unavailability_overrides + indices em provider_availability_windows
('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-111',
 'Criar provider_unavailability_overrides + indices em availability_windows',
 $desc$## Objetivo
Persistir overrides pontuais (toggle "Indisponível hoje", AC #3) que
prevalecem sobre a grade semanal sem editá-la, e garantir índice de
lookup performático que o engine de matching usa para descobrir se um
prestador está no pool agora (suporta AC #1 + #3). Cobre AC #3.

## Contexto
Módulo PERFIL — schema novo. `provider_availability_windows` (T-025/US-003)
é a janela "default" semanal; este novo `provider_unavailability_overrides`
permite sobreposição de exclusão por dia inteiro (24h). O engine de
matching (US-020, sem tasks ainda) consulta `is_provider_available_now`
(T-114) que faz join nas duas tabelas.

## Estado atual / O que substitui
`provider_availability_windows` existe (US-003 T-025) com 7 linhas seed
8h-18h por prestador. Não há tabela de overrides. A coluna
`provider_profiles.unavailable_until` (se já existir como placeholder
de US-002) deve ser mantida fora — overrides têm motivo, expiram por
data, e podem ter mais de uma janela por prestador no futuro.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_unavailability.sql`
```sql
BEGIN;

CREATE TABLE provider_unavailability_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  -- Janela ABSOLUTA (timestamp); para "hoje" o app envia date+00:00 e date+23:59
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text NOT NULL DEFAULT 'today_off'
              CHECK (reason IN ('today_off','sick','vacation','other')),
  source      text NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','admin','system')),
  created_by  uuid REFERENCES auth.users(id),
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX provider_unavail_provider_active_idx
  ON provider_unavailability_overrides(provider_id, starts_at, ends_at)
  WHERE ends_at > NOW();

-- Index novo na tabela existente: lookup por (provider_id, day_of_week, enabled)
CREATE INDEX IF NOT EXISTS provider_avail_lookup_idx
  ON provider_availability_windows(provider_id, day_of_week)
  WHERE enabled = true;

ALTER TABLE provider_unavailability_overrides ENABLE ROW LEVEL SECURITY;

-- PRESTADOR: vê e gerencia só os próprios
CREATE POLICY "provider_select_own_overrides" ON provider_unavailability_overrides
  FOR SELECT TO authenticated
  USING (provider_id = (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));

CREATE POLICY "provider_insert_own_overrides" ON provider_unavailability_overrides
  FOR INSERT TO authenticated
  WITH CHECK (provider_id = (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));

CREATE POLICY "provider_delete_own_overrides" ON provider_unavailability_overrides
  FOR DELETE TO authenticated
  USING (provider_id = (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));

-- ADMIN: tudo
CREATE POLICY "admin_all_overrides" ON provider_unavailability_overrides
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger updatedAt
CREATE TRIGGER provider_unavail_set_updated_at
  BEFORE UPDATE ON provider_unavailability_overrides
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ UPDATE de override (use DELETE + INSERT — auditoria via `service_events`)
- ❌ Confiar em `unavailable_until` legado se ele existir (criamos modelo novo)
- ❌ Permitir override > 30 dias via API (UI valida; constraint hard fica em outra US)

## Convenções
- Janelas absolutas (timestamptz), não date — facilita futuro "indisponível das 14h às 18h"
- `source='today_off'` é o caminho padrão da UI (T-121); deixa porta aberta pra admin/system
- `enabled` em `provider_availability_windows` continua sendo o switch da grade semanal$desc$,
 'DATA', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-112 DATA: índice cronológico em service_requests para "Minha Agenda"
('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-112',
 'Adicionar índice (provider_id, scheduled_at) em service_requests + RLS de leitura',
 $desc$## Objetivo
Servir a query "próximos serviços agendados do prestador X" em <50ms,
com ordenação cronológica e filtro por status. Cobre AC #4 (lista
cronológica) e AC #6 (filtros de cancelamento).

## Contexto
Módulo PERFIL × EXECUCAO — `service_requests` é a tabela canônica do
ciclo de vida (US-023, sem schema ainda materializado). Esta task
**NÃO cria** a tabela; cria índice e policy de leitura assumindo o
shape mínimo {id, provider_id, client_id, scheduled_at, status,
category, address (snapshot), price_total, cancelled_at, cancel_reason}.
Se a tabela ainda não existir quando esta task for implementada, ela
precisa esperar US-011 (criação) — registrar como bloqueio na época.

## Estado atual / O que substitui
Não há índice nem RLS dedicada para o cenário "agenda do prestador".
A US-004 cria policy de pool (broadcast); aqui adicionamos a policy
de leitura "alocados".

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_requests_agenda_index.sql`
```sql
BEGIN;

-- Índice serve o GET /api/agenda (T-117) e o realtime filter (T-119)
CREATE INDEX IF NOT EXISTS service_requests_provider_scheduled_idx
  ON service_requests(provider_id, scheduled_at)
  WHERE status IN ('scheduled','in_progress','cancelled');

-- Index parcial para "cancelados nas últimas 24h" (AC #6)
CREATE INDEX IF NOT EXISTS service_requests_recent_cancellations_idx
  ON service_requests(provider_id, cancelled_at)
  WHERE status = 'cancelled' AND cancelled_at IS NOT NULL;

-- Policy: PRESTADOR alocado lê seus serviços
CREATE POLICY "provider_select_assigned_services" ON service_requests
  FOR SELECT TO authenticated
  USING (provider_id = (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Index full em `service_requests(scheduled_at)` sem partial — a maioria
  das linhas é histórico longo
- ❌ Mexer em colunas de `service_requests` aqui (vive em US-011/US-023)
- ❌ Policy ALL — só SELECT (UPDATE de status vive na máquina de estados)

## Convenções
- Index parcial pra evitar bloat (status terminal não interessa pra agenda)
- RLS leitura só por `provider_id` — broadcast/pool é outra policy (US-004)$desc$,
 'DATA', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-113 DATA: pg_cron job de lembretes de agenda
('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-113',
 'Agendar pg_cron para lembrete 2h/30min antes do serviço (chama Edge Function)',
 $desc$## Objetivo
Disparar verificação a cada 5 minutos para identificar serviços que
estão com 2h ou 30min de antecedência e ainda não tiveram check-in
("Estou a caminho"), enviando notificação de lembrete. Cobre AC #5.

## Contexto
Módulo PERFIL × NOTIFICACAO — pg_cron agenda; trabalho real (decidir
quem notificar, montar payload, idempotência) vive na Edge Function
`agenda-reminders` (T-118). Resolução 5min é um trade-off: lembrete 2h
pode chegar entre 2h00 e 1h55 antes; lembrete 30min entre 30min e 25min
antes — aceitável pra produto e barato pra job.

## Estado atual / O que substitui
Não há pg_cron job de agenda. US-022 (notificações) ainda não tem tasks.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_agenda_reminders_cron.sql`
```sql
BEGIN;

-- Schedule: a cada 5 minutos, chama Edge Function via pg_net
SELECT cron.schedule(
  'agenda-reminders',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/agenda-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := jsonb_build_object('triggered_at', NOW())
  );
  $cron$
);

-- Tabela de idempotência (impede notificar mesma combinação 2x)
CREATE TABLE IF NOT EXISTS service_reminder_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('t_minus_2h','t_minus_30m')),
  notified_at         timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (service_request_id, kind)
);

ALTER TABLE service_reminder_log ENABLE ROW LEVEL SECURITY;
-- Sem policies para authenticated (só service_role lê/escreve via Edge Function)
CREATE POLICY "admin_read_reminder_log" ON service_reminder_log
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Enviar notificação direto do pg_cron (mistura DDL com I/O externo)
- ❌ Job de 1min (caro e desnecessário pra resolução 5min combinada)
- ❌ Schedule sem idempotência (re-execuções duplicariam notificações)

## Convenções
- `app.supabase_url` e `app.service_role_key` configurados via `ALTER DATABASE` no setup do projeto
- Idempotência via UNIQUE (service_request_id, kind) — Edge Function INSERT ON CONFLICT DO NOTHING
- Cron name `agenda-reminders` (kebab-case) — convenção do projeto para jobs Zelar$desc$,
 'DATA', 'SISTEMA',
 ARRAY['RLS_REQUIRED','IDEMPOTENCY_KEY'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-114 API: helper RPC is_provider_available_now
('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-114',
 'Implementar RPC is_provider_available_now(provider_id, ts) consumido por matching',
 $desc$## Objetivo
Centralizar a regra "prestador está aceitando serviços agora?" em uma
função única reutilizável pelo engine de matching (US-020) e pelo
endpoint de status do hub (T-115). Considera grade semanal + overrides
ativos. Cobre AC #1 (matching respeita janela) e AC #3 (override 24h
prevalece).

## Contexto
Módulo PERFIL × MATCHING — função imutável pra ser cacheável dentro
de uma transação de matching. RPC chamada por: pool query do matching
(US-020), endpoint /api/profile/availability/status (extensão do
T-028), painel admin de prestadores (US-017).

## Estado atual / O que substitui
Hoje não existe centralização. T-028 só lê janelas e devolve cru. Sem
essa função, US-020 vai re-implementar a lógica e divergir.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_is_provider_available.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION is_provider_available_now(
  p_provider_id uuid,
  p_at          timestamptz DEFAULT NOW()
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dow      smallint;
  v_local_t  time;
  v_in_grade boolean;
  v_blocked  boolean;
BEGIN
  -- 1. Override ativo bloqueia
  SELECT EXISTS (
    SELECT 1 FROM provider_unavailability_overrides
    WHERE provider_id = p_provider_id
      AND p_at BETWEEN starts_at AND ends_at
  ) INTO v_blocked;
  IF v_blocked THEN RETURN false; END IF;

  -- 2. Grade semanal habilitada cobre o horário
  v_dow     := EXTRACT(DOW FROM p_at AT TIME ZONE 'America/Sao_Paulo')::smallint;
  v_local_t := (p_at AT TIME ZONE 'America/Sao_Paulo')::time;

  SELECT EXISTS (
    SELECT 1 FROM provider_availability_windows
    WHERE provider_id = p_provider_id
      AND day_of_week = v_dow
      AND enabled = true
      AND v_local_t BETWEEN start_time AND end_time
  ) INTO v_in_grade;

  RETURN v_in_grade;
END;
$$;

GRANT EXECUTE ON FUNCTION is_provider_available_now(uuid, timestamptz)
  TO authenticated, service_role;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Marcar como IMMUTABLE (depende de NOW() default e de tabelas mutáveis — STABLE)
- ❌ Hard-code de timezone em outro ponto (centralizar em America/Sao_Paulo aqui)
- ❌ Permitir EXEC para `anon` (vaza grade)

## Convenções
- SECURITY DEFINER pra atravessar RLS quando matching roda como user
- Timezone único: America/Sao_Paulo (alinha com regra de horário comercial brasileiro)
- DOW Postgres: 0=domingo .. 6=sábado (mesma convenção da T-025)$desc$,
 'API', 'SISTEMA',
 ARRAY['RLS_REQUIRED','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-115 API: estender PUT /api/profile/availability com confirmação de janela vazia
('8797cc0d-2550-404d-b941-03cc54f7478f',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-115',
 'Estender PUT /api/profile/availability com gate confirm_empty (sai do pool)',
 $desc$## Objetivo
Bloquear save de janela 100% vazia (todos os dias `enabled=false` ou
windows array sem nenhuma com enabled=true) sem flag explícita
`confirm_pool_exit`. Resposta 409 carrega `code: 'pool_exit_requires_confirmation'`
para a UI mostrar dialog. Cobre AC #2.

## Contexto
Módulo PERFIL — extensão direta do endpoint criado em T-028 (US-003).
A regra de "default 8h-18h no primeiro acesso" continua viva
(seed automático); aqui adicionamos a regra de "ao salvar todos vazios
o prestador sai do pool, exige confirmação".

## Estado atual / O que substitui
PUT /api/profile/availability hoje aceita qualquer payload válido por
Zod e faz upsert. Não há gate de "tudo vazio".

## O que criar

### Patch em `src/app/api/profile/availability/route.ts`
```ts
const PutBody = z.object({
  windows: z.array(Window).max(7),
  confirm_pool_exit: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const body = PutBody.parse(await req.json());

  const allDisabled = body.windows.length === 0
    || body.windows.every(w => !w.enabled);

  if (allDisabled && !body.confirm_pool_exit) {
    return Response.json(
      {
        error: 'pool_exit_requires_confirmation',
        message: 'Salvar com nenhuma janela ativa removerá você do pool de matching.'
      },
      { status: 409 },
    );
  }
  // ... upsert existente
}
```

## Constraints / NÃO fazer
- ❌ Aceitar `confirm_pool_exit=true` quando há ao menos uma janela ativa (incoerente — devolver 422)
- ❌ Marcar `provider_profiles.account_status` aqui (não é suspensão; é só fora do pool por configuração)
- ❌ Gravar log de pool exit aqui (audit é trigger no DB, US separada)

## Convenções
- Mesma idempotência do PUT atual (sem Idempotency-Key — operação naturalmente idempotente)
- Erro com `code` machine-readable + `message` em pt-BR pra UI mostrar direto
- Response.json sempre tipado (ver lib/supabase/types.ts)$desc$,
 'API', 'PRESTADOR',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-116 API: POST/DELETE /api/profile/availability/today-off
('baa99eb7-fac2-4488-a9fc-4076e4167008',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-116',
 'Implementar POST/DELETE /api/profile/availability/today-off (toggle 24h)',
 $desc$## Objetivo
Endpoints que ativam/desativam o override "Indisponível hoje". POST
cria override de NOW() até final do dia local (23:59:59 America/Sao_Paulo).
DELETE remove o override ativo do dia. Cobre AC #3.

## Contexto
Módulo PERFIL — consumido pelo toggle no home do prestador (T-121).
Idempotência natural: POST quando já existe override do dia retorna o
existente (200, não 409 — comportamento amigável de toggle UI).

## Estado atual / O que substitui
Não existe endpoint. UI do home (T-121) é a única superfície que
chama; o toggle não vive na tela de grade (T-120).

## O que criar

### `src/app/api/profile/availability/today-off/route.ts`
```ts
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

async function getProviderId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('provider_profiles').select('id').eq('user_id', user.id).single();
  return profile?.id ?? null;
}

function dayBoundsBR() {
  const now = new Date();
  // YYYY-MM-DD em America/Sao_Paulo
  const localISO = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const startsAt = `${localISO}T00:00:00-03:00`;
  const endsAt   = `${localISO}T23:59:59-03:00`;
  return { startsAt, endsAt };
}

export async function POST() {
  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { startsAt, endsAt } = dayBoundsBR();
  // Idempotência: se já existe override cobrindo agora, retorna ele
  const { data: existing } = await supabase
    .from('provider_unavailability_overrides')
    .select('id, starts_at, ends_at')
    .eq('provider_id', providerId)
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at',   new Date().toISOString())
    .maybeSingle();
  if (existing) return Response.json(existing);

  const { data, error } = await supabase
    .from('provider_unavailability_overrides')
    .insert({
      provider_id: providerId,
      starts_at:  startsAt,
      ends_at:    endsAt,
      reason:     'today_off',
      source:     'manual',
    })
    .select('id, starts_at, ends_at')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE() {
  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const nowIso = new Date().toISOString();
  await supabase
    .from('provider_unavailability_overrides')
    .delete()
    .eq('provider_id', providerId)
    .lte('starts_at', nowIso)
    .gte('ends_at',   nowIso);
  return new Response(null, { status: 204 });
}
```

## Constraints / NÃO fazer
- ❌ Aceitar duração customizada (POST aqui é só "hoje")
- ❌ Permitir múltiplos overrides simultâneos cobrindo agora (regra de produto: 1 ativo por vez do mesmo source)
- ❌ Confiar em `Date()` do servidor pra timezone (sempre formatar via Intl)

## Convenções
- Timezone fixo America/Sao_Paulo (mesmo da T-114)
- 204 em DELETE quando não há nada (UI não precisa diferenciar)
- POST idempotente sem Idempotency-Key (toggle UI dispara por engano sem dor)$desc$,
 'API', 'PRESTADOR',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','IDEMPOTENCY_KEY'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-117 API: GET /api/agenda
('c2423c2e-190a-461e-b1bf-a2a141d99762',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-117',
 'Implementar GET /api/agenda (próximos 14 dias + cancelados últimas 24h)',
 $desc$## Objetivo
Retornar lista cronológica dos serviços agendados do prestador para os
próximos 14 dias e os cancelados nas últimas 24h, com payload pronto
para a tela "Minha Agenda" (T-122). Cobre AC #4 e AC #6.

## Contexto
Módulo PERFIL — endpoint que sustenta a tela. Janela de 14 dias é
default (URL ?days=14); cancelados aparecem inline na seção
correspondente (24h fixos por AC #6, não parametrizado).

## Estado atual / O que substitui
Não existe endpoint dedicado. Sem ele a UI faria query direta no
PostgREST e perderia a regra de cancelados.

## O que criar

### `src/app/api/agenda/route.ts`
```ts
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).default(14),
});

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('provider_profiles').select('id').eq('user_id', user.id).single();
  if (!profile) return Response.json({ error: 'not_provider' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const { days } = QuerySchema.parse(Object.fromEntries(searchParams));

  const horizonEnd  = new Date(Date.now() + days * 24 * 3600_000).toISOString();
  const recentStart = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Próximos: scheduled OU in_progress dentro do horizonte
  const { data: upcoming } = await supabase
    .from('service_requests')
    .select('id, scheduled_at, status, category, address_snapshot, price_total, client_name')
    .eq('provider_id', profile.id)
    .in('status', ['scheduled','in_progress'])
    .lte('scheduled_at', horizonEnd)
    .order('scheduled_at', { ascending: true });

  // Cancelados últimas 24h
  const { data: recentCancellations } = await supabase
    .from('service_requests')
    .select('id, scheduled_at, cancelled_at, cancel_reason, category, address_snapshot, price_total, client_name')
    .eq('provider_id', profile.id)
    .eq('status', 'cancelled')
    .gte('cancelled_at', recentStart)
    .order('cancelled_at', { ascending: false });

  return Response.json({
    upcoming: upcoming ?? [],
    recentCancellations: recentCancellations ?? [],
    horizon_days: days,
  });
}
```

## Constraints / NÃO fazer
- ❌ Retornar histórico completo (US-028 cobre carteira/histórico)
- ❌ Expor PII do cliente além do nome (telefone vai via outra API quando aceita)
- ❌ Paginar (14 dias × N serviços não justifica — limit natural)

## Convenções
- `address_snapshot` é o endereço congelado no aceite (não join com `client_addresses` mutável)
- `category` é slug — UI usa `lib/status-chips.ts` pra label
- Erros 401/403 sem expor detalhes do request$desc$,
 'API', 'PRESTADOR',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-118 API: Edge Function agenda-reminders
('d92f90db-8d90-4fa5-ab1c-4a08436814c5',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-118',
 'Implementar Edge Function agenda-reminders (lembrete 2h e 30min sem on-the-way)',
 $desc$## Objetivo
Edge Function chamada pelo pg_cron (T-113) a cada 5min que identifica
serviços "scheduled" com 2h ou 30min de antecedência e dispara
notificação. Lembrete 30min só dispara se prestador ainda não acionou
"Estou a caminho" (`on_the_way_at IS NULL`). Idempotência via
`service_reminder_log` UNIQUE (service_request_id, kind). Cobre AC #5.

## Contexto
Módulo PERFIL × NOTIFICACAO — função stateless que faz query, escreve
log e enfileira notificação na infraestrutura compartilhada (US-022,
sem tasks ainda — implementação assume tabela `notifications` existe e
trigger de envio dispara via outro canal). Aqui escrevemos só a fila.

## Estado atual / O que substitui
Não existe Edge Function de lembretes. Hoje no-show por esquecimento
acontece sem aviso nenhum.

## O que criar

### `supabase/functions/agenda-reminders/index.ts`
```ts
import { serve } from 'https://deno.land/std/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const WINDOWS = [
  { kind: 't_minus_2h',  msAhead: 2  * 60 * 60 * 1000, slack: 5 * 60 * 1000, requireNoOnTheWay: false },
  { kind: 't_minus_30m', msAhead: 30 * 60 * 1000,      slack: 5 * 60 * 1000, requireNoOnTheWay: true  },
];

serve(async () => {
  const now = Date.now();
  const created: { service_id: string; kind: string }[] = [];

  for (const w of WINDOWS) {
    const lo = new Date(now + w.msAhead - w.slack).toISOString();
    const hi = new Date(now + w.msAhead + w.slack).toISOString();

    let q = supabase.from('service_requests')
      .select('id, provider_id, client_id, scheduled_at, on_the_way_at, category')
      .eq('status', 'scheduled')
      .gte('scheduled_at', lo)
      .lte('scheduled_at', hi);
    if (w.requireNoOnTheWay) q = q.is('on_the_way_at', null);

    const { data: services, error } = await q;
    if (error) continue;

    for (const s of services ?? []) {
      const { error: logErr } = await supabase
        .from('service_reminder_log')
        .insert({ service_request_id: s.id, kind: w.kind });
      if (logErr) continue; // UNIQUE conflict = já notificado

      await supabase.from('notifications').insert({
        user_id:  s.provider_id,
        kind:     w.kind === 't_minus_2h' ? 'agenda_reminder_2h' : 'agenda_reminder_30m',
        payload:  { service_request_id: s.id, scheduled_at: s.scheduled_at, category: s.category },
      });
      created.push({ service_id: s.id, kind: w.kind });
    }
  }

  return new Response(JSON.stringify({ created: created.length, items: created }), {
    headers: { 'content-type': 'application/json' },
  });
});
```

## Constraints / NÃO fazer
- ❌ Enviar push direto daqui (Edge Function de envio é outra task em US-022)
- ❌ Iterar sem ordering — janela de 5min mantém volume baixo, ok manter naive
- ❌ Confiar em "tentar de novo se UNIQUE falhar" — UNIQUE é a guarda da idempotência

## Convenções
- Deno + jsr:@supabase/supabase-js (mesma stack das outras Edge Functions Zelar)
- Service role key só via env (nunca commit, nunca client)
- Slack window 5min (margem de erro do cron */5)$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','RATE_LIMIT'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-119 REALTIME: canal agenda:provider_id
('54342bd2-3ed9-4492-a2cc-04f7fe4d6441',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-119',
 'Configurar canal Realtime agenda:<provider_id> para INSERT/UPDATE em service_requests',
 $desc$## Objetivo
PRESTADOR vê novos serviços aceitos aparecer na tela "Minha Agenda"
sem refresh, com latência <1s; cancelamentos atualizam a card
correspondente in-place. Cobre AC #4 (tempo real) e parte de AC #6
(card cancelado aparece sem refresh).

## Contexto
Módulo PERFIL — hook compartilhado consumido pela tela de agenda
(T-122). Filter por `provider_id=eq.{id}` no canal Postgres Changes;
RLS de SELECT (T-112) garante que só o próprio prestador escuta.
Fallback de polling 15s ativo em CHANNEL_ERROR/TIMED_OUT.

## Estado atual / O que substitui
Não há canal de agenda. Sem isso, prestador precisaria recarregar
manualmente — UX inaceitável quando matching aceita serviço enquanto
ele está olhando a tela.

## O que criar

### `src/hooks/use-provider-agenda-realtime.ts`
```ts
import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

type Status = 'idle' | 'subscribed' | 'fallback_polling' | 'error';

export function useProviderAgendaRealtime(
  providerId: string | null,
  onChange: () => void, // re-fetch full list
) {
  const [status, setStatus] = useState<Status>('idle');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!providerId) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`agenda:${providerId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table:  'service_requests',
        filter: `provider_id=eq.${providerId}`,
      }, () => onChange())
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setStatus('subscribed');
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('fallback_polling');
          pollingRef.current = setInterval(onChange, 15_000);
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [providerId, onChange]);

  return { status };
}
```

## Constraints / NÃO fazer
- ❌ Subscribe sem unsubscribe no unmount (memory leak / canal duplicado)
- ❌ Filter por status na subscription (RLS já filtra; cancelamento precisa chegar)
- ❌ Re-fetch dentro do callback se já chegou em <500ms (debounce simples na UI)

## Convenções
- Nome de canal: `agenda:<providerId>` (consistência com `service:<id>` da US-005)
- Fallback 15s (mais espaçado que padrão de 10s pois tela é informacional, não crítica)
- onChange = re-fetch completo (mais simples que reconciliar payload diff)$desc$,
 'REALTIME', 'PRESTADOR',
 ARRAY['REALTIME_CHANNEL','REUSE_EXISTING_HOOK'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-120 UI: tela de configuração de disponibilidade (grade semanal)
('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-120',
 'Renderizar tela "Minha Disponibilidade" com grade semanal interativa',
 $desc$## Objetivo
Tela acessível pelo hub do prestador (T-091) que mostra grade dos 7
dias com toggle por dia + dois inputs de horário (start/end). Salvar
chama PUT /api/profile/availability (T-115); resposta 409
`pool_exit_requires_confirmation` abre `ResponsiveDialog` destrutivo
explicando consequência e re-submetendo com `confirm_pool_exit=true`.
Cobre AC #1 e AC #2.

## Contexto
Módulo PERFIL — entrada via hub `/(provider)/profile` (T-091, card
"Disponibilidade"). Page client component que faz GET inicial via
fetch (não server fetch — precisa interatividade imediata pós-toggle
de janela vazia).

## Estado atual / O que substitui
T-031 (US-003) renderiza banner "Complete seu cadastro" enquanto
disponibilidade não configurada, mas não há tela de edição rica.
Esta task **cria** a tela e **substitui** a entrada via banner por
um link direto pra ela (banner permanece em onboarding até primeiro
salvamento; após, hub é o único entry).

## O que criar

### `src/app/(provider)/profile/availability/page.tsx`
```tsx
'use client';
import { useEffect, useState } from 'react';
import { Field, FormBody, Field as F } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';

const DAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

type Window = { day_of_week: number; start_time: string; end_time: string; enabled: boolean };

export default function AvailabilityPage() {
  const [windows, setWindows] = useState<Window[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/profile/availability').then(r => r.json()).then(d => {
      setWindows(d.windows ?? []);
      setLoading(false);
    });
  }, []);

  async function save(force = false) {
    setSaving(true);
    const res = await fetch('/api/profile/availability', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ windows, confirm_pool_exit: force }),
    });
    setSaving(false);
    if (res.status === 409) {
      const j = await res.json();
      if (j.error === 'pool_exit_requires_confirmation') { setConfirmEmpty(true); return; }
    }
    if (!res.ok) { toast.error('Falha ao salvar'); return; }
    toast.success('Disponibilidade atualizada');
  }

  // ... renderização da grade com Field por linha (toggle + 2 inputs type="time")
}
```

## Reuso
- `Field` + `FormBody` + `Input` (type="time") — formulário
- `Button` — primário e ghost
- `ResponsiveDialog` — confirmação de saída do pool
- `Sonner` (toast) — feedback

## Constraints / NÃO fazer
- ❌ react-hook-form ou masked-input
- ❌ Persistir no localStorage (server é a verdade)
- ❌ `<Dialog>` ou `<Sheet>` cru — usar ResponsiveDialog

## Convenções
- Mobile-first: grade vira lista vertical em <768px (uma linha por dia)
- Inputs `type="time"` nativos (sem lib)
- Estado `useState` direto, sem react-hook-form$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-121 UI: toggle "Indisponível hoje" no home do prestador
('116048b0-b304-4939-852c-7035a9bc05a4',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-121',
 'Renderizar toggle "Indisponível hoje" no home do prestador (24h)',
 $desc$## Objetivo
Componente client mountado no home do prestador (`/(provider)`) que
mostra um switch + label "Indisponível hoje". Ativar dispara POST
/api/profile/availability/today-off (T-116); desativar DELETE.
Estado inicial vem de query inline (override ativo cobrindo NOW()).
Visual reflete estado em tempo real e mostra tempo restante até
00:00. Cobre AC #3.

## Contexto
Módulo PERFIL — fica no home (não na tela de disponibilidade), pois é
ação rápida diária. O toggle não edita a grade — apenas insere/remove
override 24h. Reseta automaticamente à meia-noite (não precisa job:
override naturalmente expira).

## Estado atual / O que substitui
Home do prestador existe (US-002 T-3eb1) com cards de KPI e CTA. Não
há toggle de disponibilidade.

## O que criar

### `src/components/provider/TodayOffToggle.tsx`
```tsx
'use client';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch'; // ou Button
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';

export function TodayOffToggle() {
  const [active, setActive] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    fetch('/api/profile/availability/today-off-status')
      .then(r => r.json()).then(d => setActive(!!d.active));
  }, []);

  async function turnOn() {
    const res = await fetch('/api/profile/availability/today-off', { method: 'POST' });
    if (!res.ok) { toast.error('Falha ao ativar'); return; }
    setActive(true);
    toast.success('Indisponível até o fim do dia');
  }

  async function turnOff() {
    const res = await fetch('/api/profile/availability/today-off', { method: 'DELETE' });
    if (!res.ok) { toast.error('Falha ao desativar'); return; }
    setActive(false);
    toast.success('Disponível novamente');
  }

  if (active === null) return null; // skeleton no parent
  return (
    <>
      <button
        onClick={() => active ? turnOff() : setConfirm(true)}
        className={...}
      >
        {active ? 'Voltar a aceitar serviços' : 'Indisponível hoje'}
      </button>
      <ConfirmDialog
        state={confirm ? {
          title: 'Sair do pool até o fim do dia?',
          description: 'Você não receberá novos serviços até as 00:00.',
          destructive: true,
          confirmLabel: 'Sim, indisponível hoje',
          onConfirm: async () => { await turnOn(); setConfirm(false); },
        } : null}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}
```

> Observação: o endpoint `today-off-status` é uma simplificação; pode
> ser substituído por um GET no próprio `today-off` retornando 200/204.
> Decisão de implementação: manter coerente com convenção do projeto.

## Reuso
- `ConfirmDialog` — confirmação de ativar
- `Sonner` (toast) — feedback

## Constraints / NÃO fazer
- ❌ `window.confirm()` (proibido — usar ConfirmDialog)
- ❌ Atualizar UI sem aguardar resposta (toggle deve refletir verdade)
- ❌ Setar timer de 24h no client — override expira naturalmente

## Convenções
- Mobile-first (botão ocupa largura full em <480px)
- Tap target ≥ 44px$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-122 UI: tela "Minha Agenda"
('bf100c11-ea73-4f67-a94c-f7e0ae59d13a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-122',
 'Renderizar tela "Minha Agenda" com lista cronológica + realtime + estado vazio',
 $desc$## Objetivo
Tela `/(provider)/agenda` que mostra serviços agendados do prestador
nos próximos 14 dias (data, horário, endereço, categoria, valor) +
seção de cancelados últimas 24h. Subscribe canal realtime (T-119) e
re-fetch on-change. Estado vazio orienta a configurar disponibilidade
quando não há agendamentos. Cobre AC #4 e parte de AC #6 (estado
vazio).

## Contexto
Módulo PERFIL — segunda tela principal do prestador, junto com home.
Acessada pela navegação principal e pelo hub. Server fetch inicial
via fetch (precisa subscribe client). Lista virtual desnecessária pra
14 dias — simples Card por item.

## Estado atual / O que substitui
Não existe tela de agenda. Hoje prestador só vê notificações pontuais
quando aceita serviço. Sem visão consolidada.

## O que criar

### `src/app/(provider)/agenda/page.tsx`
```tsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useProviderAgendaRealtime } from '@/hooks/use-provider-agenda-realtime';
import { CancelledServiceCard } from '@/components/provider/CancelledServiceCard';

type Service = { id: string; scheduled_at: string; category: string;
  address_snapshot: { line1: string; city: string }; price_total: number;
  client_name: string; status: string; cancelled_at?: string; cancel_reason?: string };

export default function AgendaPage() {
  const [data, setData] = useState<{ upcoming: Service[]; recentCancellations: Service[] } | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);

  const fetchAgenda = useCallback(async () => {
    const res = await fetch('/api/agenda?days=14');
    setData(await res.json());
  }, []);

  useEffect(() => { fetchAgenda(); }, [fetchAgenda]);
  useEffect(() => {
    fetch('/api/profile/personal').then(r => r.json()).then(p => setProviderId(p.id));
  }, []);

  useProviderAgendaRealtime(providerId, fetchAgenda);

  if (!data) return <Skeleton className="h-40 w-full" />;

  const { upcoming, recentCancellations } = data;
  const empty = upcoming.length === 0 && recentCancellations.length === 0;

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Minha Agenda</h1>

      {empty ? (
        <EmptyState />
      ) : (
        <>
          {recentCancellations.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground">Cancelados (últimas 24h)</h2>
              {recentCancellations.map(s => <CancelledServiceCard key={s.id} service={s} />)}
            </section>
          )}
          <section>
            <h2 className="text-sm font-medium text-muted-foreground">Próximos serviços</h2>
            {upcoming.map(s => <ServiceCard key={s.id} service={s} />)}
          </section>
        </>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <Card className="p-6 text-center">
      <p className="font-medium">Você não tem serviços agendados nos próximos 14 dias.</p>
      <p className="text-sm text-muted-foreground mt-2">
        Configure sua disponibilidade pra entrar no pool de matching.
      </p>
      <a href="/profile/availability" className="text-primary mt-4 inline-block">
        Configurar disponibilidade →
      </a>
    </Card>
  );
}
```

## Reuso
- `Card`, `Skeleton`, `Badge` (componentes UI)
- `useProviderAgendaRealtime` (T-119)
- Sem `ResponsiveSheet` (navegação direta para detalhe é outra US)

## Constraints / NÃO fazer
- ❌ Buscar `service_requests` direto via createBrowserClient (passar por API)
- ❌ `setState` direto sem hook quando RT chega (re-fetch é a verdade)
- ❌ Estado vazio sem CTA pra disponibilidade (regra explícita do AC #6)

## Convenções
- Mobile-first (cards full-width em <768px)
- `address_snapshot` mostra só linha 1 + cidade (privacy)
- Valor formatado em BRL via Intl.NumberFormat$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-123 UI: card de serviço cancelado
('8b76a3ad-b65b-4982-a516-0d524df00802',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '647f77d6-1119-49d0-8a12-e130fc3b0fc8',
 'ZLAR-V2-T-123',
 'Renderizar CancelledServiceCard com badge de motivo (auto-some após 24h)',
 $desc$## Objetivo
Componente reutilizável usado pela agenda (T-122) pra mostrar serviço
cancelado com `Badge` destacando motivo + horário original + dismiss
implícito após 24h (filtro do GET já remove). Cobre AC #6 (parte do
card específico).

## Contexto
Módulo PERFIL — componente puro, sem estado próprio. Visualmente
distinto da `ServiceCard` upcoming (cor amortecida, `Badge`
destructive com motivo legível). O auto-dismiss em 24h é
**responsabilidade do GET** (T-117 filtra `cancelled_at >= NOW()-24h`)
— este componente só renderiza o que recebe.

## Estado atual / O que substitui
Não existe componente. Sem ele, `AgendaPage` (T-122) ficaria com lógica
duplicada para cancelados.

## O que criar

### `src/components/provider/CancelledServiceCard.tsx`
```tsx
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const REASON_LABELS: Record<string, string> = {
  client_change_mind: 'Cliente desistiu',
  force_majeure:      'Força maior',
  service_mismatch:   'Serviço incompatível',
  client_no_show:     'Cliente ausente',
  provider_no_show:   'Prestador ausente',
  other:              'Outro motivo',
};

type Service = {
  id: string;
  scheduled_at: string;
  category: string;
  client_name: string;
  cancel_reason?: string;
  cancelled_at?: string;
};

export function CancelledServiceCard({ service }: { service: Service }) {
  const reasonLabel = REASON_LABELS[service.cancel_reason ?? 'other'] ?? 'Outro motivo';
  return (
    <Card className="p-3 mb-2 opacity-80 border-destructive/30">
      <div className="flex items-center gap-2">
        <Badge variant="destructive">Cancelado</Badge>
        <Badge variant="outline">{reasonLabel}</Badge>
      </div>
      <p className="mt-2 text-sm">
        <span className="font-medium">{service.category}</span>
        {' · '}
        <span className="text-muted-foreground">{service.client_name}</span>
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Agendado para {new Date(service.scheduled_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
      </p>
    </Card>
  );
}
```

## Reuso
- `Card`, `Badge` (componentes UI)

## Constraints / NÃO fazer
- ❌ Estado próprio (componente puro)
- ❌ Botão "fechar" — auto-dismiss é por tempo (regra do AC)
- ❌ Mostrar valor cancelado/refund (vive em US-026 disputa, não na agenda)

## Convenções
- Cores destructive amortecidas (não chamar atenção como toast)
- Locale pt-BR com Intl
- `mb-2` pra spacing vertical entre cards (consistente com `ServiceCard`)$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- =====================================================================
-- 2) TaskAcceptanceCriterion (vínculo task ↔ AC-da-Story)
-- =====================================================================
INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT v.task_id, ac.id
FROM (VALUES
  -- T-111 DATA overrides → AC#3 (toggle 24h)
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1'::uuid, 3),
  -- T-111 também ajuda a sustentar AC#1 (matching respeita janela)
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1'::uuid, 1),
  -- T-112 DATA agenda index → AC#4
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658'::uuid, 4),
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658'::uuid, 6),
  -- T-113 DATA cron → AC#5
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7'::uuid, 5),
  -- T-114 API helper → AC#1, #3
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa'::uuid, 1),
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa'::uuid, 3),
  -- T-115 API put extension → AC#2
  ('8797cc0d-2550-404d-b941-03cc54f7478f'::uuid, 2),
  -- T-115 também sustenta AC#1 (grade é a fonte do matching)
  ('8797cc0d-2550-404d-b941-03cc54f7478f'::uuid, 1),
  -- T-116 API today-off → AC#3
  ('baa99eb7-fac2-4488-a9fc-4076e4167008'::uuid, 3),
  -- T-117 API agenda → AC#4, #6
  ('c2423c2e-190a-461e-b1bf-a2a141d99762'::uuid, 4),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762'::uuid, 6),
  -- T-118 API edge function → AC#5
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5'::uuid, 5),
  -- T-119 REALTIME → AC#4
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441'::uuid, 4),
  -- T-120 UI grade → AC#1, #2
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe'::uuid, 1),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe'::uuid, 2),
  -- T-121 UI toggle → AC#3
  ('116048b0-b304-4939-852c-7035a9bc05a4'::uuid, 3),
  -- T-122 UI agenda → AC#4, #6 (também AC#5 como visão de notificação visual?)
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a'::uuid, 4),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a'::uuid, 6),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a'::uuid, 5),
  -- T-123 UI cancelled card → AC#6
  ('8b76a3ad-b65b-4982-a516-0d524df00802'::uuid, 6)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =====================================================================
-- 3) AC-da-Task (checklist técnico)
-- =====================================================================
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  -- T-111 DATA overrides
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'Tabela provider_unavailability_overrides com CHECK em reason e source', 1),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'CHECK ends_at > starts_at impede janela invertida', 2),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'Index parcial provider_unavail_provider_active_idx (where ends_at > NOW())', 3),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'Index provider_avail_lookup_idx adicionado em provider_availability_windows', 4),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'RLS: PRESTADOR A não vê overrides de B (smoke via JWT)', 5),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'ADMIN via claim app_metadata.role lê todos os overrides', 6),
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'Trigger updatedAt funciona em UPDATE (smoke)', 7),

  -- T-112 DATA agenda index/RLS
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'Migration aplicada; database.types.ts regenerado', 0),
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'service_requests_provider_scheduled_idx (parcial em status ativos)', 1),
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'service_requests_recent_cancellations_idx (parcial em status=cancelled)', 2),
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'Policy provider_select_assigned_services criada (SELECT por provider_id)', 3),
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'EXPLAIN do GET /api/agenda confirma uso do índice (Index Scan)', 4),
  ('0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'Smoke RLS: PRESTADOR A não lê service_requests do PRESTADOR B', 5),

  -- T-113 DATA cron
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'Migration aplicada; cron.schedule registrado em pg_cron.job', 0),
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'Cron com schedule */5 * * * * dispara HTTP POST para Edge Function', 1),
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'Tabela service_reminder_log com UNIQUE (service_request_id, kind)', 2),
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'CHECK kind em (t_minus_2h, t_minus_30m)', 3),
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'app.supabase_url e app.service_role_key configurados via ALTER DATABASE', 4),
  ('3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'Smoke: chamada manual de cron.schedule executa Edge Function (200)', 5),

  -- T-114 API helper
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'Função is_provider_available_now criada SECURITY DEFINER STABLE', 0),
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'GRANT EXECUTE para authenticated e service_role', 1),
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'Override ativo retorna false mesmo dentro da janela semanal (smoke)', 2),
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'Sem grade habilitada para o dow retorna false', 3),
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'Timezone fixo America/Sao_Paulo (smoke com TS UTC fora do horário BR)', 4),
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'GRANT EXECUTE NÃO concedido para anon (smoke: anon recebe permission denied)', 5),

  -- T-115 API put extension
  ('8797cc0d-2550-404d-b941-03cc54f7478f', 'Body Zod estendido com confirm_pool_exit:boolean optional', 0),
  ('8797cc0d-2550-404d-b941-03cc54f7478f', 'PUT com windows todas enabled=false sem flag retorna 409 com code pool_exit_requires_confirmation', 1),
  ('8797cc0d-2550-404d-b941-03cc54f7478f', 'PUT com flag=true e mesma situação faz upsert e retorna 200', 2),
  ('8797cc0d-2550-404d-b941-03cc54f7478f', 'PUT com pelo menos uma window enabled ignora flag', 3),
  ('8797cc0d-2550-404d-b941-03cc54f7478f', 'Mensagem do erro 409 em pt-BR (UI mostra direto)', 4),
  ('8797cc0d-2550-404d-b941-03cc54f7478f', 'Demais comportamentos do PUT (T-028) preservados (smoke regressivo)', 5),

  -- T-116 API today-off
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', 'POST cria override com starts_at hoje 00:00 e ends_at hoje 23:59 (BR)', 0),
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', 'POST quando já existe override ativo retorna o mesmo (idempotência)', 1),
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', 'DELETE remove apenas overrides cobrindo NOW() (não toca futuros)', 2),
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', 'DELETE retorna 204 mesmo sem override ativo (toggle amigável)', 3),
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', '401 quando sem auth; 403 quando user não tem provider_profile', 4),
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', 'Timezone usa Intl.DateTimeFormat (não Date.toISOString cru)', 5),

  -- T-117 API agenda
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', 'GET retorna {upcoming, recentCancellations, horizon_days}', 0),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', 'Query param days valida via Zod (default 14, max 60)', 1),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', 'Upcoming inclui status scheduled e in_progress dentro do horizonte', 2),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', 'recentCancellations só status=cancelled com cancelled_at >= NOW()-24h', 3),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', 'Ordenação: upcoming asc por scheduled_at; cancellations desc por cancelled_at', 4),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', 'RLS bloqueia leitura cross-provider (smoke)', 5),
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', '401 sem auth; 403 quando user não é provider', 6),

  -- T-118 API edge function
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'Edge Function deployed e respondendo a POST', 0),
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'Lembrete t_minus_2h dispara mesmo com on_the_way_at preenchido', 1),
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'Lembrete t_minus_30m só dispara quando on_the_way_at IS NULL', 2),
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'Re-execução não duplica notificação (UNIQUE em service_reminder_log impede)', 3),
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'INSERT em notifications com kind agenda_reminder_2h ou agenda_reminder_30m', 4),
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'Service role usado apenas via env (sem secret no código)', 5),
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', 'Janela slack ±5min cobre jitter do cron */5', 6),

  -- T-119 REALTIME
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'Hook useProviderAgendaRealtime cria canal agenda:<providerId>', 0),
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'Filter postgres_changes por provider_id=eq.<id> (RLS já filtra também)', 1),
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'INSERT/UPDATE no DB chega na UI em <1s (medido com timestamp)', 2),
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'CHANNEL_ERROR/TIMED_OUT ativa polling fallback a cada 15s', 3),
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'Unsubscribe + clearInterval no unmount (sem leak)', 4),
  ('54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'Smoke: PRESTADOR A não recebe eventos do canal de B (RLS)', 5),

  -- T-120 UI grade
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'Rota /(provider)/profile/availability renderiza grade dos 7 dias', 0),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'Cada linha tem toggle (enabled) + 2 inputs type="time"', 1),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'GET inicial popula form; PUT salva com toast de sucesso', 2),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', '409 pool_exit_requires_confirmation abre ResponsiveDialog destrutivo', 3),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'Confirmar no dialog re-submete com confirm_pool_exit=true', 4),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'Form usa Field compound API (sem react-hook-form)', 5),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'Mobile-first: lista vertical em <768px', 6),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'Sem masked-input, sem Dialog/Sheet cru', 7),

  -- T-121 UI toggle
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'TodayOffToggle renderizado no home do prestador (/(provider))', 0),
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'Estado inicial vem de query (override ativo cobrindo NOW())', 1),
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'Ativar abre ConfirmDialog destrutivo antes de POST', 2),
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'POST 200 atualiza estado e mostra toast', 3),
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'Desativar dispara DELETE direto (sem confirm — UX rápida)', 4),
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'Sem window.confirm() em nenhum ponto', 5),
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'Tap target do botão ≥ 44px (mobile)', 6),

  -- T-122 UI agenda
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Rota /(provider)/agenda renderiza tela protegida (redirect /login se sem auth)', 0),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Lista upcoming ordenada cronologicamente com data, hora, endereço, categoria, valor', 1),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Seção "Cancelados últimas 24h" renderiza com CancelledServiceCard (T-123)', 2),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Hook useProviderAgendaRealtime montado; mudança no DB re-fetch sem refresh', 3),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Estado vazio mostra CTA "Configurar disponibilidade" → /profile/availability', 4),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Skeleton durante carregamento inicial', 5),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Mobile-first: cards full-width em <768px', 6),
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'Valor formatado em BRL via Intl.NumberFormat', 7),

  -- T-123 UI cancelled card
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Componente puro sem estado próprio', 0),
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Badge destructive "Cancelado" + Badge outline com motivo legível', 1),
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Mapa REASON_LABELS cobre todos motivos do enum', 2),
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Visual amortecido (opacity-80) pra não competir com upcoming', 3),
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Auto-dismiss em 24h é responsabilidade do GET (T-117) — comp não tem timer', 4),
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Sem botão de fechar (regra do AC #6)', 5),
  ('8b76a3ad-b65b-4982-a516-0d524df00802', 'Locale pt-BR via Intl no horário agendado', 6)
;

-- =====================================================================
-- 4) Dependências (kind lowercase: blocks | relates_to)
-- =====================================================================
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- Intra-US blocks
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'blocks'),  -- T-114 helper precisa overrides
  ('baa99eb7-fac2-4488-a9fc-4076e4167008', 'e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', 'blocks'),  -- T-116 today-off precisa overrides
  ('c2423c2e-190a-461e-b1bf-a2a141d99762', '0dfa3e6d-d5ab-49ac-b5a9-e8053d534658', 'blocks'),  -- T-117 GET agenda precisa index/RLS
  ('d92f90db-8d90-4fa5-ab1c-4a08436814c5', '3d696e30-9f5d-4abd-8ef1-ed5d221e63f7', 'blocks'),  -- T-118 edge func precisa cron+log table
  -- UI blocks suas APIs
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', '8797cc0d-2550-404d-b941-03cc54f7478f', 'blocks'),  -- T-120 grade precisa PUT estendido
  ('116048b0-b304-4939-852c-7035a9bc05a4', 'baa99eb7-fac2-4488-a9fc-4076e4167008', 'blocks'),  -- T-121 toggle precisa today-off API
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', 'c2423c2e-190a-461e-b1bf-a2a141d99762', 'blocks'),  -- T-122 agenda precisa GET
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', '54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'blocks'),  -- T-122 agenda precisa hook RT
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', '8b76a3ad-b65b-4982-a516-0d524df00802', 'blocks'),  -- T-122 agenda usa CancelledServiceCard
  -- relates_to intra-US
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', '9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'relates_to'),  -- T-120 grade alimenta helper
  -- Cross-US (reuso documentado)
  -- T-111 estende provider_availability_windows (T-025) com index novo
  ('e3ec4851-3ec2-4d96-99dd-d2bdcc0eeed1', '5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'relates_to'),
  -- T-115 estende endpoint criado em T-028
  ('8797cc0d-2550-404d-b941-03cc54f7478f', '2abdc4f0-b5bb-474e-b622-e633c3663f50', 'relates_to'),
  -- T-114 helper alimenta a view de onboarding (T-027) — sinal "tem disponibilidade ativa"
  ('9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', '577eaf09-23eb-4299-a215-c5ea9a04545b', 'relates_to'),
  -- T-120 substitui a entrada via banner T-031 (US-003) por hub do perfil T-091
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', 'ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'relates_to'),
  ('8a1fdc19-3d2c-494e-ad49-d7e21feb2efe', '78a48bee-4c69-489f-8321-b6bc6a1efe34', 'relates_to'),
  -- T-122 agenda é nova entrada do hub (T-091)
  ('bf100c11-ea73-4f67-a94c-f7e0ae59d13a', '78a48bee-4c69-489f-8321-b6bc6a1efe34', 'relates_to'),
  -- T-121 toggle home complementa AccountActions (T-094) sem reusar diretamente
  ('116048b0-b304-4939-852c-7035a9bc05a4', '84ea4c23-9f4c-4623-9971-68c7986eaa38', 'relates_to')
;

COMMIT;
