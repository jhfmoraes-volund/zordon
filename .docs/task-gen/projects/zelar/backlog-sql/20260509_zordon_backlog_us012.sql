-- Zelar v2 — Backlog SQL: ZLAR-V2-US-012 (CLIENTE acompanha execucao em tempo real)
-- Modulo: EXECUCAO | Persona: CLIENTE | AC: 11
-- Apenas insere metadata em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). NAO executa DDL de produto.
--
-- Story id:   0e37537a-e32a-4ddc-a3b5-c60906bd778f
-- Project id: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
-- DS id:      264e6d07-d365-43ba-8029-d539ce6f7c6b
-- Persona id (CLIENTE):  4ff1ab67-9c32-4024-80e7-d22bcdac063f
-- Persona id (SISTEMA):  085f0246-a5d1-4b23-9f09-025b5e37177b
-- Persona id (ANY/ambos): NULL (RLS-side cobre ambas pernas)

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-305 (DATA: VIEW client_active_matching_v)
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-305', 'Criar VIEW client_active_matching_v (estado da busca pro CLIENTE)',
 $desc$## Objetivo
Expor pro CLIENTE, via uma VIEW `security_invoker=true`, o estado consolidado da busca em tempo real (round em curso, candidatos ofertados sem identidade, ETA estimado, pre-aceite consolidado). Cobre AC #1 e #4 (transicao automatica busca -> card prestador).

## Contexto
Modulo EXECUCAO. CLIENTE assina `service:{id}` (T-081) e tambem precisa ver, durante o broadcast, sinais minimos da busca: "esta procurando", "X prestadores receberam a oferta" (sem expor quem), "primeiro prestador aceitou" (e ai retorna provider snapshot publico). Hoje as tabelas `matching_rounds` (T-238), `matching_round_candidates`, `matching_round_events` (T-239) existem mas nao tem leitura direta pro CLIENTE — RLS dessas tabelas e fechada (PRESTADOR + ADMIN). VIEW apresenta dados agregados / safe-for-CLIENT.

## Estado atual / O que substitui
Nao existe. Hoje so PRESTADOR ve `matching_round_candidates` (via T-247 e T-263).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_active_matching_view.sql`
```sql
BEGIN;

CREATE VIEW client_active_matching_v
WITH (security_invoker = true) AS
SELECT
  sr.id                          AS service_request_id,
  sr.client_id                   AS client_id,
  sr.status                      AS service_status,
  mr.id                          AS round_id,
  mr.status                      AS round_status,        -- broadcasting | closed | expired
  mr.opened_at                   AS round_opened_at,
  mr.closes_at                   AS round_closes_at,
  COUNT(*) FILTER (
    WHERE mrc.decision = 'offered'
  )                              AS providers_in_pool,    -- visivel; nunca quem
  pp.id                          AS accepted_provider_id, -- NULL ate aceite
  pp.display_name                AS accepted_provider_name,
  pp.avatar_url                  AS accepted_provider_avatar,
  pp.trust_badge                 AS accepted_provider_badge,
  pp.rating_average              AS accepted_provider_rating,
  mr.eta_seconds                 AS eta_seconds_estimate
FROM service_requests sr
LEFT JOIN matching_rounds mr
  ON mr.service_request_id = sr.id
 AND mr.status IN ('broadcasting','closed','expired')
LEFT JOIN matching_round_candidates mrc
  ON mrc.round_id = mr.id
LEFT JOIN provider_profiles pp
  ON pp.id = mr.accepted_provider_id
WHERE sr.client_id = auth.uid()    -- security_invoker => RLS de service_requests vale
GROUP BY sr.id, mr.id, pp.id;

COMMENT ON VIEW client_active_matching_v IS
  'CLIENTE-only: sumario do round corrente (sem identidade dos candidatos).';

REVOKE ALL ON client_active_matching_v FROM public, anon;
GRANT SELECT ON client_active_matching_v TO authenticated;

COMMIT;
```

## Constraints / NAO fazer
- NAO expor `mrc.provider_id` ou `provider_profiles` dos candidatos *antes* do aceite (vaza pool — viola D do matching)
- NAO expor `score`/`rank` (uso interno SISTEMA)
- NAO permitir UPDATE/INSERT sobre a VIEW
- NAO criar tabela nova: e VIEW agregada sobre `service_requests`+`matching_rounds`+`matching_round_candidates`

## Convencoes
- `security_invoker = true` (RLS de service_requests filtra por client_id — padrao US-004 T-266)
- `REVOKE` de public/anon, `GRANT SELECT` so pra `authenticated`
- Coluna `accepted_provider_*` ficam NULL ate o aceite (UI usa pra detectar transicao)
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','NO_RLS_NEEDED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-306 (DATA: tabela client_inactivity_alerts pro AC#9)
('78ed929b-fcee-45db-8c47-a6186d209eda', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-306', 'Criar tabela client_inactivity_alerts (alerta CLIENTE de prestador parado)',
 $desc$## Objetivo
Persistir, por servico, alertas que o CLIENTE recebe quando o prestador nao atualiza status por longo periodo (`AC #9`). Cada alerta exige decisao do CLIENTE ("Aguardar" ou "Cancelar sem cobranca") e e usado como rodada limitada — apos N alertas ignorados, o sistema autorefaz o despacho.

## Contexto
Modulo EXECUCAO. Existe ja a Edge Function `emit-stale-execution-alert` (T-236) que detecta `in_progress > 24h`, mas ela alerta OPS — aqui precisamos de alertas *centrados no CLIENTE* com decisao explicita. Tabela serve como fila FIFO + audit. T-310 estende a Edge Function pra inserir aqui. T-309 e o endpoint que decide. T-316 e o sheet UI.

## Estado atual / O que substitui
Nao existe. T-236 hoje so emite log pra OPS, sem persistir alerta acionavel pelo CLIENTE.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_inactivity_alerts.sql`
```sql
BEGIN;

CREATE TYPE client_inactivity_alert_decision AS ENUM ('pending','wait','cancel');

CREATE TABLE client_inactivity_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES auth.users(id),
  raised_reason      text NOT NULL,        -- 'no_status_update_30min' | 'no_location_update_15min' | ...
  raised_at          timestamptz NOT NULL DEFAULT NOW(),
  decision           client_inactivity_alert_decision NOT NULL DEFAULT 'pending',
  decided_at         timestamptz,
  round_index        smallint NOT NULL DEFAULT 1,  -- quantos alertas ja foram emitidos pra esse SR (limita a N)
  "createdAt"        timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"        timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT one_pending_per_sr UNIQUE (service_request_id, decision)
    DEFERRABLE INITIALLY IMMEDIATE
);

-- Apenas 1 alerta pendente por SR (parcial)
CREATE UNIQUE INDEX one_pending_alert_per_sr
  ON client_inactivity_alerts (service_request_id)
  WHERE decision = 'pending';

CREATE INDEX cia_client_pending_idx
  ON client_inactivity_alerts (client_id, raised_at DESC)
  WHERE decision = 'pending';

ALTER TABLE client_inactivity_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_select_own" ON client_inactivity_alerts
  FOR SELECT USING (auth.uid() = client_id);

CREATE POLICY "client_update_own" ON client_inactivity_alerts
  FOR UPDATE USING (auth.uid() = client_id)
  WITH CHECK (
    auth.uid() = client_id
    AND decision IN ('wait','cancel')
  );

CREATE POLICY "admin_all" ON client_inactivity_alerts
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER cia_updated_at
  BEFORE UPDATE ON client_inactivity_alerts
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NAO fazer
- NAO permitir INSERT pelo CLIENTE (alerta e levantado pelo SISTEMA via Edge Function T-310)
- NAO permitir UPDATE de `raised_reason`/`round_index`/`raised_at` (campos de origem SISTEMA)
- NAO permitir DELETE — historico imutavel (auditoria)
- Drop constraint `one_pending_per_sr` em favor da partial unique index (UNIQUE total dispara em historico)

## Convencoes
- `partial unique index` em `pending` — mesmo padrao de `service_pending_states` (T-231)
- `moddatetime` ja existe no schema (US-005 ja usa)
- Decisao via UPDATE (CLIENTE so muda `decision` + `decided_at`)
- RLS espelha CLIENTE-side de `service_requests` (T-229)
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-307 (API: POST /api/services/[id]/cancel-search)
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-307', 'Implementar POST /api/services/[id]/cancel-search (CLIENTE cancela busca)',
 $desc$## Objetivo
Endpoint que CLIENTE chama durante a tela de busca pra cancelar a `service_request` *antes* de algum prestador aceitar — reembolso integral, sem penalidade. Cobre AC #2 e parte do AC #3 (opcao "Tentar mais tarde" reusa este path).

## Contexto
Modulo EXECUCAO. Wrapper HTTP fino sobre `transition_service_status` (T-235) com transicao alvo `searching -> cancelled_by_client_pre_match` (constraint validada por T-227). A SR ja deve estar em status `searching` (antes do aceite); apos aceite vira `cancel` propriamente dito (US-016, fora deste escopo). Reembolso e despachado via webhook de pagamento (T-078) ao detectar transicao para `cancelled_by_client_pre_match`. O endpoint:
1. Valida JWT + extrai `client_id`
2. Le `idempotency-key` header (obrigatorio — AC #2 garante "confirmacao simples e clara")
3. Chama RPC `transition_service_status(sr_id, 'cancelled_by_client_pre_match', client_id, idempotency_key)`
4. Mapeia errcodes (P0002 nao encontrado, 22023 transicao invalida, 23505 idempotency hit, 42501 RLS) -> HTTP

## Estado atual / O que substitui
Nao existe. POST /api/services/cancel generico ainda nao foi escrito (US-016).

## O que criar

### `src/app/api/services/[id]/cancel-search/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapRpcError } from '@/lib/api/rpc-errors';

const Body = z.object({
  reason: z.enum(['changed_mind','no_match_in_time','other']).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json().catch(() => ({})));
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.rpc('transition_service_status', {
    p_sr_id: params.id,
    p_target: 'cancelled_by_client_pre_match',
    p_actor_id: user.id,
    p_idempotency_key: idemKey,
    p_payload: { reason: body.reason ?? 'changed_mind' },
  });
  if (error) return mapRpcError(error);
  return Response.json(data, { status: 200 });
}
```

## Constraints / NAO fazer
- NAO chamar webhook de reembolso aqui — quem dispara e o trigger FSM em T-227 (audit_event -> dispatcher)
- NAO permitir cancelamento apos aceite — RPC retorna 22023 (transition_invalid) por estado, mapeada pra 409
- NAO mexer em `matching_rounds` diretamente — encerramento e via Edge Function T-245 (expire-matching-broadcast) ao detectar SR cancelada
- NAO criar nova RPC: reuso integral de `transition_service_status` (T-235)

## Convencoes
- `Idempotency-Key` header obrigatorio — chave estavel `cancel-search-{sr_id}` no client (AC #2 garante "confirmacao simples")
- Erros padronizados: 400 (validacao), 401 (no auth), 403 (RLS), 409 (estado terminal/transicao invalida), 404 (sr nao encontrada)
- Smoke test: client_a cancela SR de client_b -> 404 (RLS oculta)
- Reuso: `mapRpcError` (utilidade existente em `src/lib/api/rpc-errors.ts` — se nao existe, T-235 instalou padrao similar)
$desc$,
 'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-308 (API: POST /api/services/[id]/retry-matching)
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-308', 'Implementar POST /api/services/[id]/retry-matching (CLIENTE tenta novamente)',
 $desc$## Objetivo
Endpoint que CLIENTE chama na tela de "ninguem disponivel agora" pra reativar o broadcast — reabre a SR (status `searching`) e dispara novo round de matching. Cobre AC #3 (opcao "Tentar novamente").

## Contexto
Modulo EXECUCAO. Apos 10min sem aceite a Edge Function T-246 `expire-client-search` ja transicionou a SR pra `no_match` (status terminal-deg). O retry:
1. Valida JWT + ownership da SR
2. Chama `transition_service_status(sr_id, 'searching', client_id, key)` — T-227 valida `no_match -> searching` permitido (catalogo) somente se `retry_count < 2` (limite memo de produto, evita loop)
3. Chama Edge Function `start-matching` (T-243) pro novo round (mesmo entrypoint pos-confirmacao)
4. Retorna 200 com novo round_id

Cliente *nao* paga novamente: pagamento ja esta capturado em escrow (US-011 / T-076). Apenas o ciclo de matching e refeito.

## Estado atual / O que substitui
Nao existe. Hoje retry e manual (cliente tem que recriar SR).

## O que criar

### `src/app/api/services/[id]/retry-matching/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';
import { mapRpcError } from '@/lib/api/rpc-errors';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // 1. Reabre SR (RPC valida transicao no_match -> searching e retry_count < 2)
  const { data: tx, error: txErr } = await supabase.rpc('transition_service_status', {
    p_sr_id: params.id,
    p_target: 'searching',
    p_actor_id: user.id,
    p_idempotency_key: idemKey,
    p_payload: { kind: 'client_retry' },
  });
  if (txErr) return mapRpcError(txErr);

  // 2. Dispara novo round (idempotente via idempotency_key — start-matching ja deduplica)
  const { data: round, error: rdErr } = await supabase.functions.invoke(
    'start-matching',
    { body: { service_request_id: params.id, idempotency_key: idemKey } }
  );
  if (rdErr) return Response.json({ error: 'matching_start_failed' }, { status: 502 });

  return Response.json({ ok: true, round_id: round.round_id, transition: tx });
}
```

### Estender catalogo de transicoes (T-225)
- Adicionar linha `('no_match','searching','client_retry')` em `service_status_transitions` com `max_count = 2` (CHECK no trigger T-227 via campo `retry_count` em `service_requests`)
- Esta migration vai junto com a tabela do retry counter (ou coluna nova `client_retry_count smallint NOT NULL DEFAULT 0` em `service_requests`).

## Constraints / NAO fazer
- NAO permitir retry > 2 vezes (loop infinito) — RPC RAISE 22023 mapeada pra 409
- NAO recobrar do cliente (escrow ja capturado)
- NAO reaproveitar mesmo `round_id` — sempre novo round pra audit limpo (T-238)
- NAO confiar em `req.body.client_id` — usar `auth.uid()`

## Convencoes
- `Idempotency-Key` header obrigatorio — chave estavel `retry-{sr_id}-{round_count}`
- Erros: 400 (no key), 401, 403 (RLS), 404 (sr nao encontrada), 409 (retry esgotado / estado invalido), 502 (matching start falhou)
- Reuso de Edge Function `start-matching` (T-243) e RPC `transition_service_status` (T-235)
- Coluna `client_retry_count` deve refletir no checklist tecnico (incrementada pelo trigger FSM)
$desc$,
 'API', 'CLIENTE', ARRAY['RLS_REQUIRED','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-309 (API: POST /api/client-inactivity-alerts/[id]/decide)
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-309', 'Implementar POST /api/client-inactivity-alerts/[id]/decide (Aguardar/Cancelar)',
 $desc$## Objetivo
Endpoint que CLIENTE chama via UI para decidir um alerta de inatividade do prestador — `wait` (mantem servico, fecha alerta) ou `cancel` (cancela sem cobranca, transitiona SR pra `cancelled_by_client_inactivity`). Cobre AC #9.

## Contexto
Modulo EXECUCAO. Tabela `client_inactivity_alerts` (T-306) tem 1 alerta pendente por SR (partial unique). Ao decidir:
- `wait`: marca `decision='wait'`, `decided_at=NOW()`. Watchdog T-310 pode levantar novo alerta se prestador continuar parado, ate `round_index >= 2` quando o sistema aborta automaticamente.
- `cancel`: marca alerta + chama `transition_service_status` para `cancelled_by_client_inactivity` (transicao nova no catalogo T-225, mapeada para reembolso integral via webhook).

Sem `cancel`, sem cobranca; sem `wait`, sem progresso. Watchdog T-310 escala se nada acontece.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/client-inactivity-alerts/[id]/decide/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapRpcError } from '@/lib/api/rpc-errors';

const Body = z.object({
  decision: z.enum(['wait','cancel']),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // RPC SECURITY DEFINER que (1) confirma alerta pendente, (2) atualiza decision + decided_at,
  // (3) se cancel, chama transition_service_status interno
  const { data, error } = await supabase.rpc('decide_client_inactivity_alert', {
    p_alert_id: params.id,
    p_actor_id: user.id,
    p_decision: body.decision,
    p_idempotency_key: idemKey,
  });
  if (error) return mapRpcError(error);
  return Response.json(data);
}
```

### RPC `decide_client_inactivity_alert`
- `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`
- Le alerta + lock; se `decision != 'pending'`, retorna estado atual (idempotente)
- Se `cancel`, chama `transition_service_status(sr_id, 'cancelled_by_client_inactivity', actor, key)` interno
- Se transicao falha (estado nao permite), reverte e retorna 409
- Audit em `service_atypical_events` (T-285) com `kind='client_inactivity_decision'`

## Constraints / NAO fazer
- NAO permitir decisao por outro CLIENTE (RLS de UPDATE da tabela cobre, mas RPC reforca por seguranca)
- NAO duplicar transicao FSM se mesmo `idempotency_key` foi usado antes (T-235 ja deduplica)
- NAO permitir `decision != 'wait'|'cancel'` — Zod limita

## Convencoes
- `Idempotency-Key` header — chave estavel `alert-decide-{alert_id}`
- Erros: 400 (validation/no key), 401, 403 (alerta de outro CLIENTE), 404 (alerta nao encontrado), 409 (transicao FSM invalida), 410 (alerta ja decidido — porem retorna 200 com `idempotent:true`)
- Reuso: `service_atypical_events.kind='client_inactivity_decision'` (estender enum em migration de T-285 OU adicionar agora)
$desc$,
 'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-310 (API: estender Edge Function emit-stale-execution-alert)
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-310', 'Estender emit-stale-execution-alert: criar client_inactivity_alerts',
 $desc$## Objetivo
Estender Edge Function `emit-stale-execution-alert` (T-236) — alem do log OPS atual, cria um registro em `client_inactivity_alerts` (T-306) e enfileira `enqueue_notification_event` (T-162) para empurrar push pro CLIENTE com texto empatico. Cobre AC #9.

## Contexto
Modulo EXECUCAO. T-236 hoje detecta `service_requests.status='in_progress'` sem `service_provider_locations` ou `service_events` por > 24h e loga pro OPS. Esta extensao reduz o threshold pra 30min (parametro em `app_config.client_inactivity_alert_threshold_min`) e adiciona acao ao CLIENTE. Watchdog roda a cada 5min via pg_cron (T-165 ja agenda, so amplia escopo).

Comportamento:
1. Para cada SR em `in_progress|en_route` com `last_status_update_at` (deriva de `service_events.created_at`) > threshold:
   - Verifica se ha alerta pendente — se sim, pula (idempotencia natural via partial unique de T-306)
   - Verifica `round_index` — se ja teve >= 2 alertas neste SR sem decisao, escala automaticamente: chama `transition_service_status(sr, 'cancelled_by_system_inactivity', system, key)` + reembolso
   - Cria `client_inactivity_alerts` com `decision='pending'` e `round_index = COALESCE(MAX, 0) + 1`
   - Enfileira `enqueue_notification_event(client_id, 'client_inactivity_alert', { sr_id, alert_id, round_index })` -> push web (T-171)

## Estado atual / O que substitui
Estende T-236 (Edge Function existente). Adiciona insert em tabela nova T-306, integra T-162, T-171.

## O que criar

### `supabase/functions/emit-stale-execution-alert/index.ts` (estender)
```typescript
const THRESHOLD_MIN = await getConfig('client_inactivity_alert_threshold_min', 30);
const MAX_ROUNDS = await getConfig('client_inactivity_max_rounds', 2);

for (const sr of staleServiceRequests) {
  // (codigo existente que loga OPS aqui)

  const { data: existing } = await admin.from('client_inactivity_alerts')
    .select('id,round_index')
    .eq('service_request_id', sr.id)
    .eq('decision', 'pending')
    .maybeSingle();
  if (existing) continue; // idempotente

  const { data: lastRound } = await admin.from('client_inactivity_alerts')
    .select('round_index')
    .eq('service_request_id', sr.id)
    .order('round_index', { ascending: false })
    .limit(1).maybeSingle();
  const nextRound = (lastRound?.round_index ?? 0) + 1;

  if (nextRound > MAX_ROUNDS) {
    await admin.rpc('transition_service_status', {
      p_sr_id: sr.id,
      p_target: 'cancelled_by_system_inactivity',
      p_actor_id: SYSTEM_USER_ID,
      p_idempotency_key: `auto-cancel-inactivity-${sr.id}`,
      p_payload: { reason: 'inactivity_max_rounds' },
    });
    continue;
  }

  const { data: alert } = await admin.from('client_inactivity_alerts').insert({
    service_request_id: sr.id,
    client_id: sr.client_id,
    raised_reason: 'no_status_update_30min',
    round_index: nextRound,
  }).select().single();

  await admin.rpc('enqueue_notification_event', {
    p_user_id: sr.client_id,
    p_event_kind: 'client_inactivity_alert',
    p_payload: { service_request_id: sr.id, alert_id: alert.id, round_index: nextRound },
    p_idempotency_key: `inactivity-${alert.id}`,
  });
}
```

## Constraints / NAO fazer
- NAO duplicar alerta pendente — partial unique em T-306 ja cobre, mas a Edge funcao tambem checa
- NAO escalar antes de `MAX_ROUNDS` rodadas (UX: cliente decide, nao sistema; respeita AC #9 "rodada limitada")
- NAO usar `service_role` no client (Edge Function so)
- Threshold via `app_config` (T-203 ja existe esquema) — sem hardcode

## Convencoes
- pg_cron: T-165 estende agenda atual (a cada 5min) — sem pg_cron novo
- Idempotency key estavel: `inactivity-{alert_id}` (notification queue) e `auto-cancel-inactivity-{sr_id}` (FSM)
- Logging: cada acao com `entity=service_request, entity_id, action`, sem PII
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-311 (REALTIME: hook useClientServiceStream)
('d256b241-1770-48af-ac51-175efd5aea93', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-311', 'Implementar hook useClientServiceStream (Realtime + bootstrap + resync)',
 $desc$## Objetivo
Hook unico que orquestra a UI do CLIENTE durante todo o ciclo de execucao: subscreve `service:{id}`, `service:{id}:locations`, faz bootstrap inicial das tabelas relevantes e resync no reconnect. Cobre AC #4, #5, #6, #8, #11 (sem mapa).

## Contexto
Modulo EXECUCAO. Espelha o `use-service-execution` (T-280) do PRESTADOR mas do lado CLIENTE — sem FSM local (CLIENTE nao transita), apenas observador. Reusa canal Realtime `service:{id}` (T-081 / US-011). Adiciona subscribe a `service_provider_locations` (T-274) durante `en_route`. Realiza bootstrap via `client_active_matching_v` (T-305) + `service_requests` + `service_photos` (T-272) + `service_signatures` (T-273) conforme estado.

Comportamento:
1. Mount: SELECT inicial (`service_requests` + `client_active_matching_v` + `service_photos` + `service_signatures`)
2. Subscribe `service:{id}` — postgres_changes em `service_requests` + `service_atypical_events` + `service_events`
3. Subscribe `service:{id}:locations` durante status `en_route` — postgres_changes INSERT em `service_provider_locations`
4. Subscribe `client:{user_id}:alerts` — postgres_changes INSERT/UPDATE em `client_inactivity_alerts WHERE client_id = me`
5. Reconnect (CHANNEL_ERROR/TIMED_OUT) — refaz bootstrap via `useEffect` sentinel
6. Fallback de polling a cada 10s se canal nao subscrito
7. Cleanup: removeChannel em todos no unmount

## Estado atual / O que substitui
Nao existe lado CLIENTE. T-280 tem padrao analogo no lado PRESTADOR (reusar shape, nao codigo).

## O que criar

### `src/hooks/use-client-service-stream.ts`
```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

type ServiceRow = Database['public']['Tables']['service_requests']['Row'];
type LocationRow = Database['public']['Tables']['service_provider_locations']['Row'];
type MatchingRow = Database['public']['Views']['client_active_matching_v']['Row'];
type AlertRow = Database['public']['Tables']['client_inactivity_alerts']['Row'];

export interface ClientServiceStreamState {
  service: ServiceRow | null;
  matching: MatchingRow | null;
  lastLocation: LocationRow | null;
  pendingAlert: AlertRow | null;
  isReconnecting: boolean;
}

export function useClientServiceStream(serviceId: string): ClientServiceStreamState {
  const supabase = createBrowserClient();
  const [state, setState] = useState<ClientServiceStreamState>(/* initial */);
  const reconnectRef = useRef(0);

  const bootstrap = useCallback(async () => {
    const [sr, mv, alert] = await Promise.all([
      supabase.from('service_requests').select('*').eq('id', serviceId).single(),
      supabase.from('client_active_matching_v').select('*').eq('service_request_id', serviceId).maybeSingle(),
      supabase.from('client_inactivity_alerts').select('*')
        .eq('service_request_id', serviceId).eq('decision', 'pending').maybeSingle(),
    ]);
    setState(s => ({ ...s, service: sr.data, matching: mv.data, pendingAlert: alert.data }));
  }, [serviceId, supabase]);

  useEffect(() => {
    bootstrap();
    const ch1 = supabase.channel(`service:${serviceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'service_requests',
        filter: `id=eq.${serviceId}`,
      }, payload => setState(s => ({ ...s, service: payload.new as ServiceRow })))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'service_provider_locations',
        filter: `service_request_id=eq.${serviceId}`,
      }, payload => setState(s => ({ ...s, lastLocation: payload.new as LocationRow })))
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reconnectRef.current++;
          setState(s => ({ ...s, isReconnecting: true }));
          setTimeout(bootstrap, 10000); // fallback poll
        } else if (status === 'SUBSCRIBED') {
          setState(s => ({ ...s, isReconnecting: false }));
        }
      });

    return () => { supabase.removeChannel(ch1); };
  }, [serviceId, bootstrap, supabase]);

  return state;
}
```

## Constraints / NAO fazer
- NAO fazer optimistic update aqui — CLIENTE so observa, nao muta SR (mutacoes em T-307/T-308/T-309)
- NAO usar `setState` apos `fetch` na lista de locations — usar reducer compacto (so guarda last)
- NAO subscribe `service_provider_locations` em status diferente de `en_route` (cleanup/desinscreve)
- NAO confiar 100% em Realtime — fallback polling 10s ao perceber `CHANNEL_ERROR`
- NAO incluir CPF/telefone no shape do hook — UI pega de `accepted_provider_*` da view (publicos)

## Convencoes
- Canal `service:{id}` ja existe (T-081) — adiciona subscribers, nao cria novo
- Hook unico expoe: `service`, `matching`, `lastLocation`, `pendingAlert`, `isReconnecting`
- Reuso: `createBrowserClient` (`src/lib/supabase/client`), `Database` types (regenerar pos T-305/T-306)
- Mobile-first: hook nao depende de viewport
$desc$,
 'REALTIME', 'CLIENTE', ARRAY['REALTIME_CHANNEL','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-312 (UI: tela /(client)/services/[id]/searching)
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-312', 'Renderizar /(client)/services/[id]/searching (busca em tempo real + cancelar)',
 $desc$## Objetivo
Tela em que o CLIENTE pousa imediatamente apos pagar; mostra animacao de busca, contador de prestadores no pool (sem identidade) e botao Cancelar com ConfirmDialog. Quando algum prestador aceita, hook redireciona automaticamente pra /tracking. Cobre AC #1, #2, #4 (transicao automatica).

## Contexto
Modulo EXECUCAO. Entry point pos-`POST /api/services/[id]/payment` (T-076) que confirma e dispara `start-matching` (T-243). Lazy redirect: se SR estiver em status terminal (`accepted` -> tracking, `cancelled_by_*`/`no_match` -> outras telas), `redirect()` server-side antes de renderizar. UI durante `searching` consome `useClientServiceStream` (T-311) — quando `service.status` muda para `accepted` (e portanto `matching.accepted_provider_id` populado), `router.push('/services/[id]/tracking')`.

## Estado atual / O que substitui
Nao existe. Hoje T-084 mostra confirmacao apos pagar mas nao acompanha matching.

## O que criar

### `src/app/(client)/services/[id]/searching/page.tsx`
```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SearchingClient } from './SearchingClient';

export default async function SearchingPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: sr } = await supabase
    .from('service_requests')
    .select('id, status, client_id')
    .eq('id', params.id).single();
  if (!sr) return null;
  // Garde de estado: so renderiza durante busca
  if (sr.status === 'accepted')   redirect(`/services/${sr.id}/tracking`);
  if (sr.status === 'no_match')   redirect(`/services/${sr.id}/no-matches`);
  if (sr.status?.startsWith('cancelled')) redirect(`/services/${sr.id}/cancelled`);
  return <SearchingClient serviceId={sr.id} />;
}
```

### `src/app/(client)/services/[id]/searching/SearchingClient.tsx`
```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClientServiceStream } from '@/hooks/use-client-service-stream';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';

export function SearchingClient({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const { service, matching } = useClientServiceStream(serviceId);
  const [confirm, setConfirm] = useState<null | { onConfirm: () => Promise<void> }>(null);

  useEffect(() => {
    if (service?.status === 'accepted') router.push(`/services/${serviceId}/tracking`);
    if (service?.status === 'no_match') router.push(`/services/${serviceId}/no-matches`);
  }, [service?.status, router, serviceId]);

  const cancel = () => setConfirm({
    onConfirm: async () => {
      try {
        await fetchOrThrow(`/api/services/${serviceId}/cancel-search`, {
          method: 'POST',
          headers: { 'idempotency-key': `cancel-search-${serviceId}` },
          body: '{}',
        });
        router.push(`/services/${serviceId}/cancelled`);
      } catch (e) { showErrorToast({ type: 'patch', id: serviceId }, e); }
    },
  });

  return (
    <main className="flex flex-col items-center gap-6 p-6">
      <PixelBar /* animacao de busca */ />
      <h1>Procurando o melhor prestador para voce</h1>
      <p>{matching?.providers_in_pool ?? 0} prestadores receberam sua oferta</p>
      <Button variant="ghost" onClick={cancel}>Cancelar busca (sem custo)</Button>
      <ConfirmDialog state={confirm && {
        title: 'Cancelar busca?',
        description: 'Voce recebe reembolso integral, sem penalidade.',
        confirmLabel: 'Sim, cancelar',
        cancelLabel: 'Continuar buscando',
        destructive: true,
        onConfirm: confirm.onConfirm,
      }} onClose={() => setConfirm(null)} />
    </main>
  );
}
```

## Constraints / NAO fazer
- NAO usar `window.confirm()` — `ConfirmDialog` (proibicao do projeto)
- NAO mostrar nome/foto de candidatos no pool (vaza identidade pre-aceite)
- NAO fazer polling manual quando `useClientServiceStream` ja faz fallback
- NAO marcar pagina `'use client'` no nivel page.tsx (server-component hidrata SR pra redirect)

## Convencoes
- Reuso: `useClientServiceStream` (T-311), `Button`, `ConfirmDialog`, `PixelBar`, `Sonner`/`showErrorToast`, `fetchOrThrow`
- Idempotency-key estavel: `cancel-search-{sr_id}` (matchea AC #2 "confirmacao simples")
- Mobile-first: layout single column, tap target >= 44px no botao Cancelar
- `redirect()` server-side antes de hidratar — evita flash de busca apos aceite
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-313 (UI: tela /(client)/services/[id]/no-matches)
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-313', 'Renderizar /(client)/services/[id]/no-matches (10min sem aceite)',
 $desc$## Objetivo
Tela "ninguem disponivel agora" exibida quando T-246 transiciona SR pra `no_match` apos 10min — texto empatico, dois CTAs ("Tentar novamente" reativa via T-308; "Tentar mais tarde" cancela com reembolso integral via T-307 e salva como rascunho). Cobre AC #3.

## Contexto
Modulo EXECUCAO. Server Component checa `sr.status === 'no_match'` e renderiza estado terminal-deg. Caso o cliente abra a URL fora desse status, redirect ao estado correto.

## Estado atual / O que substitui
Nao existe. Hoje rascunho de fallback nao existe.

## O que criar

### `src/app/(client)/services/[id]/no-matches/page.tsx`
- Server Component que valida status; renderiza componente cliente
- 2 botoes em layout vertical mobile-first

### `src/app/(client)/services/[id]/no-matches/NoMatchesClient.tsx`
```tsx
'use client';
import { Button } from '@/components/ui/button';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NoMatchesClient({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await fetchOrThrow(`/api/services/${serviceId}/retry-matching`, {
        method: 'POST',
        headers: { 'idempotency-key': `retry-${serviceId}-${Date.now()}` },
      });
      router.push(`/services/${serviceId}/searching`);
    } catch (e) { showErrorToast({ type: 'patch', id: serviceId }, e); setBusy(false); }
  };

  const tryLater = async () => {
    setBusy(true);
    try {
      await fetchOrThrow(`/api/services/${serviceId}/cancel-search`, {
        method: 'POST',
        headers: { 'idempotency-key': `cancel-search-${serviceId}` },
        body: JSON.stringify({ reason: 'no_match_in_time' }),
      });
      router.push(`/services?draft=${serviceId}`);
    } catch (e) { showErrorToast({ type: 'patch', id: serviceId }, e); setBusy(false); }
  };

  return (
    <main className="flex flex-col gap-6 p-6 text-center">
      <h1>Ninguem disponivel agora</h1>
      <p>Sentimos muito. Sua solicitacao nao recebeu aceite em 10 minutos.</p>
      <Button onClick={retry} disabled={busy}>Tentar novamente</Button>
      <Button variant="secondary" onClick={tryLater} disabled={busy}>Tentar mais tarde</Button>
    </main>
  );
}
```

## Constraints / NAO fazer
- NAO permitir 3a tentativa nesta tela — apos retry esgotado (HTTP 409 do T-308), so "Tentar mais tarde"
- NAO iniciar matching sem confirmar (botao 1-tap; UX espelhada ao "Voltar a buscar")
- NAO enviar `idempotency-key` constante no retry — chave inclui timestamp pra forcar nova rodada distinguivel

## Convencoes
- Reuso: `Button` (variant primary/secondary), `Sonner`/`showErrorToast`
- Mobile-first; copy empatica conforme AC #3
- Server Component faz `redirect` se status != `no_match`
- "Tentar mais tarde" leva pra `/services?draft={id}` (rascunho continua acessivel via lista — escopo de US-016 ja salva como rascunho ao cancelar)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-314 (UI: tela /(client)/services/[id]/tracking)
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-314', 'Renderizar /(client)/services/[id]/tracking (stepper + provider card + chat)',
 $desc$## Objetivo
Tela principal de acompanhamento — mostra card do prestador (foto, nome, badge, rating), stepper visual com etapas (en_route -> arrived -> in_progress -> finished) atualizado em tempo real, link/atalho pro chat (T-185), trecho com mapa (T-315) durante en_route, e exibe alertas pendentes (T-316). Cobre AC #4, #5, #7, #8, #11.

## Contexto
Modulo EXECUCAO. Pousa apos `service.status='accepted'`. Consome `useClientServiceStream` (T-311). Reusa componentes de chat (T-185 ChatThread em rota irma `/services/[id]/chat`). Stepper baseado em `service_status` enum (T-225) — lib reusavel `src/components/services/ServiceStepper.tsx` (criar como componente compartido com versao PRESTADOR T-281).

## Estado atual / O que substitui
Nao existe. T-281 tem stepper PRESTADOR (in_progress); aqui faz versao read-only pro CLIENTE.

## O que criar

### `src/app/(client)/services/[id]/tracking/page.tsx`
- Server Component bootstrap; redirect se status != accepted/en_route/in_progress/finished
- Hidrata `service`, `provider_snapshot` (de `client_active_matching_v`), `chat` cta

### `src/app/(client)/services/[id]/tracking/TrackingClient.tsx`
```tsx
'use client';
import { useClientServiceStream } from '@/hooks/use-client-service-stream';
import { ServiceStepper } from '@/components/services/ServiceStepper';
import { ProviderSnapshotCard } from '@/components/services/ProviderSnapshotCard';
import { TripMapInline } from '@/components/services/TripMapInline'; // T-315
import { ClientInactivityAlertSheet } from '@/components/services/ClientInactivityAlertSheet'; // T-316
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function TrackingClient({ serviceId }: { serviceId: string }) {
  const { service, matching, lastLocation, pendingAlert } = useClientServiceStream(serviceId);
  if (!service || !matching) return <Skeleton />;

  return (
    <main className="flex flex-col gap-4 p-4">
      <ProviderSnapshotCard
        name={matching.accepted_provider_name}
        avatar={matching.accepted_provider_avatar}
        badge={matching.accepted_provider_badge}
        rating={matching.accepted_provider_rating}
      />
      <ServiceStepper status={service.status} variant="client" />
      {service.status === 'en_route' && (
        <TripMapInline lastLocation={lastLocation} eta={matching.eta_seconds_estimate} />
      )}
      <Button asChild variant="secondary">
        <Link href={`/services/${serviceId}/chat`}>Conversar com o prestador</Link>
      </Button>
      {pendingAlert && <ClientInactivityAlertSheet alert={pendingAlert} />}
    </main>
  );
}
```

### `src/components/services/ProviderSnapshotCard.tsx`
- Reusa `Card`, `Badge`, `StatusChip`
- Acessibilidade: `<img alt={`Foto de ${name}`} />`, fallback initial avatar

### `src/components/services/ServiceStepper.tsx` (compartilhado com T-281)
- Recebe `status` + `variant: 'client' | 'provider'`
- 4 steps fixos: en_route, arrived, in_progress, finished
- Step ativo destacado; previous tem checkmark
- `aria-current="step"` no ativo

## Constraints / NAO fazer
- NAO mostrar telefone/CPF do prestador (snapshot ja e public-safe)
- NAO criar variante PRESTADOR aqui — extrair stepper compartilhado, reusando T-281 se houver
- NAO substituir botao chat por composer inline (chat e tela completa T-185)
- NAO esconder stepper se mapa falha (AC #11) — TripMapInline encapsula o fallback

## Convencoes
- Reuso: `useClientServiceStream` (T-311), `Card`, `Badge`, `StatusChip`, `Button`, `Skeleton`, `Link` (Next), `ChatThread` (T-185)
- Server Component faz hidratacao inicial; client nao bloqueia em fetch sequencial
- Reabertura do app: bootstrap em useEffect cobre estado correto (AC #8) — sem cookies/localStorage
- Mobile-first: layout vertical com prioridade visual no card -> stepper -> mapa -> chat
- AC #11: se TripMapInline `error` -> ele mostra placeholder, mas stepper continua funcional acima
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-315 (UI: TripMapInline)
('671df666-5a10-45e8-abfd-d94356c4314e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-315', 'Renderizar componente TripMapInline (mapa + ETA + fallback)',
 $desc$## Objetivo
Componente que recebe `lastLocation` (do stream T-311) e renderiza mapa inline com posicao do prestador + ETA estimado; ao chegar (`arrived`), o mapa some e o stepper destaca. Em caso de falha de carregamento (API key invalida, permissao negada, viewport offline) renderiza placeholder textual amigavel sem afetar o stepper. Cobre AC #6 e AC #11.

## Contexto
Modulo EXECUCAO. Componente client-only, montado dentro de T-314 quando `status='en_route'`. Lib: `mapbox-gl` (verificar se ja existe no package.json — caso contrario, justificar adicao na descricao). Endereco-destino sai de `service_requests.address_geo`. Trajeto NAO e roteado (sem rota OSRM): apenas marker do prestador + marker do destino + linha curta. ETA recebido via prop (calculado em `client_active_matching_v.eta_seconds_estimate`).

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/components/services/TripMapInline.tsx`
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { Database } from '@/lib/supabase/database.types';

type LocationRow = Database['public']['Tables']['service_provider_locations']['Row'];

type Props = {
  lastLocation: LocationRow | null;
  destination: { lat: number; lng: number } | null;
  eta: number | null;
};

export function TripMapInline({ lastLocation, destination, eta }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<'permission'|'load'|'no_token'|null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (!token) { setError('no_token'); return; }
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !ref.current) return;
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: ref.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: lastLocation ? [lastLocation.lng, lastLocation.lat] : [-46.63, -23.55],
          zoom: 13,
        });
        // ... markers, fly-to em update
      } catch (e) { setError('load'); }
    })();
    return () => { cancelled = true; };
  }, [lastLocation, destination]);

  if (error) {
    return (
      <div role="status" className="rounded-md border border-dashed p-3 text-sm">
        Localizacao temporariamente indisponivel. Etapas continuam atualizando.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={ref} className="h-48 w-full rounded-md" aria-label="Mapa do trajeto" />
      {eta != null && (
        <p className="text-xs text-muted-foreground">
          Chegada estimada em {Math.round(eta / 60)} min
        </p>
      )}
    </div>
  );
}
```

## Constraints / NAO fazer
- NAO usar Google Maps (custo; padrao do projeto e mapbox)
- NAO renderizar mapa em status `arrived/in_progress/finished` — parent T-314 ja condiciona em `en_route`
- NAO bloquear UI inteira em error — placeholder local mantem stepper funcional (AC #11)
- NAO chamar API externa de routing — apenas exibe marker

## Convencoes
- `NEXT_PUBLIC_MAPBOX_TOKEN` e a unica env publica desta task
- Cleanup do mapa no unmount (memory leak)
- A11y: `aria-label` no container do mapa, role="status" no fallback
- Reusa `Database` types regenerados pos T-274
- Lazy import (`await import('mapbox-gl')`) pra nao bloquear bundle inicial
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST','A11Y_REVIEW'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-316 (UI: ClientInactivityAlertSheet)
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-316', 'Renderizar ClientInactivityAlertSheet (Aguardar/Cancelar)',
 $desc$## Objetivo
ResponsiveDialog que aparece automaticamente ao detectar `pendingAlert` no `useClientServiceStream` — explica que o prestador nao atualiza ha N minutos e oferece dois botoes (Aguardar / Cancelar sem cobranca). Cobre AC #9.

## Contexto
Modulo EXECUCAO. Consome o alerta vindo via Realtime (`client_inactivity_alerts` insert). Renderizado dentro de T-314 (TrackingClient) quando `pendingAlert != null`. Decisao chama `POST /api/client-inactivity-alerts/[id]/decide` (T-309). UI bloqueante (modal) — sem decisao, alerta continua.

## Estado atual / O que substitui
Nao existe. Padrao analogo: T-303 (CLIENTE decide proposta de scope/material/revisit/additional) — mesma forma de decisao timeboxed do CLIENTE em ResponsiveDialog.

## O que criar

### `src/components/services/ClientInactivityAlertSheet.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';
import type { Database } from '@/lib/supabase/database.types';

type AlertRow = Database['public']['Tables']['client_inactivity_alerts']['Row'];

export function ClientInactivityAlertSheet({ alert }: { alert: AlertRow }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<'wait'|'cancel'|null>(null);

  const decide = async (decision: 'wait'|'cancel') => {
    setBusy(decision);
    try {
      await fetchOrThrow(`/api/client-inactivity-alerts/${alert.id}/decide`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `alert-decide-${alert.id}`,
        },
        body: JSON.stringify({ decision }),
      });
      setOpen(false);
    } catch (e) {
      showErrorToast({ type: 'patch', id: alert.id }, e);
    } finally { setBusy(null); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialog.Header>
        Prestador esta sem atualizacao
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        Detectamos que o prestador nao atualizou o status faz mais de 30 minutos.
        Voce quer aguardar mais um pouco ou cancelar o servico sem cobranca?
        {alert.round_index >= 2 && (
          <p className="mt-2 text-xs">Esta e a ultima vez que perguntamos. Apos esta decisao, se nao houver atividade, o sistema cancela automaticamente.</p>
        )}
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button variant="secondary" onClick={() => decide('wait')} disabled={!!busy}>
          Aguardar
        </Button>
        <Button variant="destructive" onClick={() => decide('cancel')} disabled={!!busy}>
          Cancelar sem cobranca
        </Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
```

## Constraints / NAO fazer
- NAO usar `ConfirmDialog` (que exige confirmacao binaria) — aqui tem 2 acoes paralelas, dialog polimorfico
- NAO permitir dismiss sem decisao (close so apos sucesso ou cancel da rede)
- NAO duplicar push (T-310 ja envia uma push) — o sheet apenas reage ao banco
- NAO mostrar telefone/contato do prestador como saida (UX: agir, nao tentar contatar manualmente)

## Convencoes
- Reuso: `ResponsiveDialog`, `Button`, `Sonner`/`showErrorToast`, `fetchOrThrow`
- Idempotency-key estavel: `alert-decide-{alert_id}`
- Mobile-first: bottom-sheet ja e padrao do `ResponsiveDialog`
- A11y: ResponsiveDialog ja gerencia foco e ESC
- Texto adapta-se a `round_index` (rodada limitada AC #9)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-317 (API: emit.providerEnRoute / emit.providerArrived)
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '0e37537a-e32a-4ddc-a3b5-c60906bd778f',
 'ZLAR-V2-T-317', 'Adicionar emit.providerEnRoute/providerArrived em emit.ts (push CLIENTE)',
 $desc$## Objetivo
Estender `src/lib/notifications/emit.ts` com 2 novos emissores que sao chamados pelo trigger FSM (T-227) ao registrar transicoes `accepted -> en_route` e `en_route -> arrived`. Cada emissao enfileira `enqueue_notification_event` (T-162) com template adequado; resultado e push web mesmo com app fechado (T-171). Cobre AC #10.

## Contexto
Modulo EXECUCAO. Wirar dois hotspots — depende de T-164 (wired notification events nos hotspots de dominio). Templates pre-aprovados em `notification_templates` (T-216). T-164 ja cobre transicoes genericas; aqui adicionamos 2 transicoes especificas com `event_kind` proprios:
- `service_provider_en_route` -> push "{nome do prestador} esta a caminho"
- `service_provider_arrived` -> push "{nome do prestador} chegou ao local"

## Estado atual / O que substitui
T-164 cobre eventos do dominio em geral; aqui o gancho fica especifico desses 2 momentos por motivos de UX (texto da notificacao precisa contemplar nome do prestador).

## O que criar

### `src/lib/notifications/emit.ts` (estender)
```typescript
import { getAdminClient } from '@/lib/supabase/admin';

export const emit = {
  // ... existentes (T-164 + T-183 messageNew)

  async providerEnRoute(args: { service_request_id: string; provider_id: string; client_id: string; }) {
    const admin = getAdminClient();
    await admin.rpc('enqueue_notification_event', {
      p_user_id: args.client_id,
      p_event_kind: 'service_provider_en_route',
      p_payload: {
        service_request_id: args.service_request_id,
        provider_id: args.provider_id,
      },
      p_idempotency_key: `enroute-push-${args.service_request_id}`,
    });
  },

  async providerArrived(args: { service_request_id: string; provider_id: string; client_id: string; }) {
    const admin = getAdminClient();
    await admin.rpc('enqueue_notification_event', {
      p_user_id: args.client_id,
      p_event_kind: 'service_provider_arrived',
      p_payload: {
        service_request_id: args.service_request_id,
        provider_id: args.provider_id,
      },
      p_idempotency_key: `arrived-push-${args.service_request_id}`,
    });
  },
};
```

### Hotspots (adicionar chamada a emit em transicoes)
- T-235 RPC `transition_service_status` chama `emit.providerEnRoute` em transicao `accepted -> en_route`
- mesma RPC chama `emit.providerArrived` em `en_route -> arrived`
- Idempotency-key e *por SR* (nao por chamada) — segunda execucao nao duplica push

### Templates em `notification_templates` (seed)
```sql
INSERT INTO notification_templates (event_kind, channel, version, status, body_template) VALUES
('service_provider_en_route','push',1,'active','{provider_name} esta a caminho. Acompanhe pelo app.'),
('service_provider_arrived','push',1,'active','{provider_name} chegou ao local. Confirme com o codigo.');
```

## Constraints / NAO fazer
- NAO chamar push direto (HTTP) — sempre via fila T-162 (consumer T-163)
- NAO disparar 2x o mesmo push em retry — idempotency key estavel `enroute-push-{sr_id}` / `arrived-push-{sr_id}`
- NAO incluir CPF/telefone no payload (templates so consomem `provider_name`)
- NAO usar `service_role` no client (`emit.ts` e server-only)

## Convencoes
- Padrao identico a `emit.messageNew` (T-183)
- Idempotency: 1 push por evento por SR
- Templates pre-aprovados (T-216 ja cobre versionamento e moderacao)
- Reuso: `getAdminClient`, `enqueue_notification_event` (T-162)
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. TaskAcceptanceCriterion (vinculo task -> AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-305 VIEW client_active_matching_v cobre AC #1 (busca em tempo real) e #4 (transicao automatica para card)
  ('ac4e060b-2d33-42f0-98d8-9c8badcda8dc'::uuid, 1),
  ('ac4e060b-2d33-42f0-98d8-9c8badcda8dc'::uuid, 4),

  -- T-306 client_inactivity_alerts cobre AC #9
  ('78ed929b-fcee-45db-8c47-a6186d209eda'::uuid, 9),

  -- T-307 cancel-search cobre AC #2
  ('a9cc9d42-cf78-4554-b01e-a04747152b1a'::uuid, 2),

  -- T-308 retry-matching cobre AC #3 (Tentar novamente)
  ('4cc81280-7cc2-45da-9fa2-66f1d3a448b6'::uuid, 3),

  -- T-309 decide-alert cobre AC #9
  ('0e7a0899-b610-41a0-bac1-de46324d70b9'::uuid, 9),

  -- T-310 watchdog cobre AC #9
  ('790a55f9-c17a-441a-aa9f-4281cd72a2ef'::uuid, 9),

  -- T-311 hook stream cobre AC #4, #5, #6, #8 (reabertura), #11 (resync)
  ('d256b241-1770-48af-ac51-175efd5aea93'::uuid, 4),
  ('d256b241-1770-48af-ac51-175efd5aea93'::uuid, 5),
  ('d256b241-1770-48af-ac51-175efd5aea93'::uuid, 6),
  ('d256b241-1770-48af-ac51-175efd5aea93'::uuid, 8),
  ('d256b241-1770-48af-ac51-175efd5aea93'::uuid, 11),

  -- T-312 searching cobre AC #1, #2, #4 (transicao automatica para tracking)
  ('88e766c1-fe11-48bf-bd3f-793fb5d1836f'::uuid, 1),
  ('88e766c1-fe11-48bf-bd3f-793fb5d1836f'::uuid, 2),
  ('88e766c1-fe11-48bf-bd3f-793fb5d1836f'::uuid, 4),

  -- T-313 no-matches cobre AC #3
  ('fba2f862-05c0-4260-89cb-9b3711b04a3e'::uuid, 3),

  -- T-314 tracking cobre AC #4 (card prestador), #5 (stepper), #7 (chat link), #8 (reabertura), #11 (stepper continua)
  ('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e'::uuid, 4),
  ('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e'::uuid, 5),
  ('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e'::uuid, 7),
  ('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e'::uuid, 8),
  ('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e'::uuid, 11),

  -- T-315 TripMapInline cobre AC #6 (mapa + ETA) e AC #11 (fallback)
  ('671df666-5a10-45e8-abfd-d94356c4314e'::uuid, 6),
  ('671df666-5a10-45e8-abfd-d94356c4314e'::uuid, 11),

  -- T-316 ClientInactivityAlertSheet cobre AC #9
  ('d25ed83c-687d-4c8b-a87f-70800927bc38'::uuid, 9),

  -- T-317 emit push cobre AC #10
  ('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed'::uuid, 10)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
 AND ac."order" = v.ac_order;


-- ============================================================================
-- 2.5 TaskAcceptanceCriterion (CROSS-US: liga tasks reusadas a AC desta US)
-- ============================================================================
-- Reuso forcado: tasks de outras US cobrem AC desta story sem duplicar.

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-081 canal Realtime service:{id} (US-011) -> AC #5 (stepper em tempo real), #8 (resync)
  ('ZLAR-V2-T-081', 5),
  ('ZLAR-V2-T-081', 8),

  -- T-185 ChatThread (US-025) -> AC #7 (chat interno do app)
  ('ZLAR-V2-T-185', 7),

  -- T-274 service_provider_locations (US-005) -> AC #6 (mapa da localizacao do prestador)
  ('ZLAR-V2-T-274', 6),

  -- T-246 expire-client-search (US-020) -> AC #3 (10min sem aceite -> no_match)
  ('ZLAR-V2-T-246', 3),

  -- T-244 accept_proposal (US-020) -> AC #4 (aceite muda estado para client ver card prestador)
  ('ZLAR-V2-T-244', 4),

  -- T-164 enqueue_notification_event hotspots (US-022) -> AC #10 (push notif a caminho/cheguei)
  ('ZLAR-V2-T-164', 10),

  -- T-163 dispatch-notifications (US-022) -> AC #10 (push web fechado)
  ('ZLAR-V2-T-163', 10)
) v(task_ref, ac_order)
JOIN "Task" t ON t.reference = v.task_ref
JOIN "UserStory" us ON us.reference = 'ZLAR-V2-US-012'
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = us.id
 AND ac."order" = v.ac_order
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 3. AcceptanceCriterion (taskId) — checklist tecnico (checkbox no TaskSheet)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-305 VIEW client_active_matching_v
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'VIEW client_active_matching_v criada com security_invoker=true', 1),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'VIEW retorna 0 linhas para client A quando consultando SR de client B (smoke RLS via JWT)', 2),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'Coluna providers_in_pool agrega COUNT FILTER decision=offered (sem expor identidades)', 3),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'accepted_provider_* fica NULL ate transicao para accepted; populado apos', 4),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'REVOKE de public/anon e GRANT SELECT TO authenticated aplicados', 5),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'INSERT/UPDATE/DELETE na VIEW retornam erro (read-only por design)', 6),

-- T-306 client_inactivity_alerts
('78ed929b-fcee-45db-8c47-a6186d209eda', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('78ed929b-fcee-45db-8c47-a6186d209eda', 'Tabela client_inactivity_alerts criada com enum decision e partial unique em decision=pending', 1),
('78ed929b-fcee-45db-8c47-a6186d209eda', 'CLIENTE le apenas seus alertas (smoke: client A nao ve alertas de client B)', 2),
('78ed929b-fcee-45db-8c47-a6186d209eda', 'CLIENTE pode UPDATE so para wait/cancel (CHECK constraint na policy)', 3),
('78ed929b-fcee-45db-8c47-a6186d209eda', 'INSERT pelo CLIENTE bloqueado (apenas SISTEMA via service_role)', 4),
('78ed929b-fcee-45db-8c47-a6186d209eda', 'DELETE bloqueado para todos (auditoria imutavel)', 5),
('78ed929b-fcee-45db-8c47-a6186d209eda', 'Trigger updatedAt funciona em UPDATE', 6),
('78ed929b-fcee-45db-8c47-a6186d209eda', '2o INSERT pendente para mesmo SR retorna violation (partial unique)', 7),

-- T-307 cancel-search
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'Endpoint POST /api/services/[id]/cancel-search criado', 0),
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'Idempotency-Key obrigatorio (400 sem header)', 1),
('a9cc9d42-cf78-4554-b01e-a04747152b1a', '2 calls com mesma key retornam mesmo estado (sem duplicar transicao)', 2),
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'Body validado com Zod (reason opcional, enum)', 3),
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'CLIENTE de outra SR retorna 404 (nao 403, evita enumeration)', 4),
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'Cancel apos aceite retorna 409 (transition_invalid via P22023)', 5),
('a9cc9d42-cf78-4554-b01e-a04747152b1a', 'Reembolso disparado via trigger FSM (smoke: payment.status=refunded apos cancel)', 6),

-- T-308 retry-matching
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Endpoint POST /api/services/[id]/retry-matching criado', 0),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Migration que adiciona transicao no_match->searching (com retry_count) aplicada', 1),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Coluna client_retry_count em service_requests com DEFAULT 0', 2),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Idempotency-Key obrigatorio; 2 calls com mesma key retornam mesmo round_id', 3),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Retry > 2 vezes retorna 409 (transition_invalid)', 4),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Sem nova captura de cartao (escrow ja capturado em US-011)', 5),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'Edge Function start-matching invocada com mesmo idempotency_key', 6),

-- T-309 decide-alert
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'Endpoint POST /api/client-inactivity-alerts/[id]/decide criado', 0),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'Body validado com Zod (decision: wait|cancel)', 1),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'RPC decide_client_inactivity_alert criada SECURITY DEFINER + REVOKE/GRANT', 2),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'Decisao wait so atualiza alerta; cancel transitiona SR (RPC interna)', 3),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'Idempotency-Key obrigatorio; 2 calls retornam mesmo estado', 4),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'CLIENTE de outro alerta retorna 404', 5),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'Audit em service_atypical_events kind=client_inactivity_decision', 6),
('0e7a0899-b610-41a0-bac1-de46324d70b9', 'Alerta ja decidido retorna 200 idempotent:true (sem reaplicar transicao)', 7),

-- T-310 watchdog
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'Edge Function emit-stale-execution-alert estendida com criar alerta', 0),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'Threshold lido de app_config.client_inactivity_alert_threshold_min (default 30)', 1),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'Skip se ja existe alerta pendente para a SR (idempotente)', 2),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'Apos round_index >= MAX_ROUNDS, escala automatico via transition_service_status -> cancelled_by_system_inactivity', 3),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'enqueue_notification_event chamado com kind=client_inactivity_alert', 4),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'Logging estruturado sem PII (entity, action, timestamps)', 5),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', 'pg_cron a cada 5min (T-165 estendido, sem agenda nova)', 6),

-- T-311 hook useClientServiceStream
('d256b241-1770-48af-ac51-175efd5aea93', 'Hook subscribe service:{id} no mount; unsubscribe no unmount (sem leak)', 0),
('d256b241-1770-48af-ac51-175efd5aea93', 'Bootstrap inicial via SELECT em service_requests + client_active_matching_v + client_inactivity_alerts pendente', 1),
('d256b241-1770-48af-ac51-175efd5aea93', 'UPDATE em service_requests reflete em < 500ms na UI (medido)', 2),
('d256b241-1770-48af-ac51-175efd5aea93', 'INSERT em service_provider_locations atualiza lastLocation (tested)', 3),
('d256b241-1770-48af-ac51-175efd5aea93', 'INSERT em client_inactivity_alerts pendente seta pendingAlert', 4),
('d256b241-1770-48af-ac51-175efd5aea93', 'CHANNEL_ERROR/TIMED_OUT seta isReconnecting=true e refaz bootstrap em 10s', 5),
('d256b241-1770-48af-ac51-175efd5aea93', 'Reabertura do app (mount fresh) reproduz estado correto sem gap (AC #8)', 6),
('d256b241-1770-48af-ac51-175efd5aea93', 'Provider de outro SR nao consegue ler stream (RLS via security_invoker da view)', 7),

-- T-312 searching screen
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'Pagina /(client)/services/[id]/searching/page.tsx criada (Server Component)', 0),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'Server-side redirect quando status != searching (accepted -> tracking, no_match -> no-matches)', 1),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'PixelBar/animation visivel; texto empatico segundo AC #1', 2),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'providers_in_pool exibido sem identidade', 3),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'ConfirmDialog com label "Cancelar busca?" + reembolso integral', 4),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'Aceite (status -> accepted) faz router.push automatico para /tracking', 5),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'Cancel chama POST cancel-search com idempotency-key estavel cancel-search-{sr_id}', 6),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'Mobile-first verificado em viewport <768px', 7),

-- T-313 no-matches screen
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Pagina /(client)/services/[id]/no-matches criada (Server Component)', 0),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Redirect server-side quando status != no_match', 1),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Texto empatico (AC #3) e 2 botoes claros', 2),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Tentar novamente chama POST retry-matching com idempotency-key incluindo timestamp', 3),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Tentar mais tarde chama POST cancel-search e leva pra rascunho (lista de servicos)', 4),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Tentar novamente >2x recebe 409 e mostra Sonner.error', 5),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'Mobile-first verificado em viewport <768px', 6),

-- T-314 tracking screen
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'Pagina /(client)/services/[id]/tracking criada (Server Component + client child)', 0),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'Redirect quando status nao em accepted/en_route/in_progress/finished', 1),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'ProviderSnapshotCard mostra foto, nome, badge, rating sem PII (telefone/CPF)', 2),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'ServiceStepper consome service.status e renderiza 4 steps com aria-current', 3),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'TripMapInline renderizado apenas em status=en_route, oculto em arrived+', 4),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'Botao "Conversar com prestador" navega para /services/[id]/chat (T-185)', 5),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'ClientInactivityAlertSheet aparece automaticamente quando pendingAlert nao-null', 6),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'Reabertura do app mostra estado correto (smoke: kill+reopen em 30s)', 7),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'Mobile-first verificado em viewport <768px', 8),

-- T-315 TripMapInline
('671df666-5a10-45e8-abfd-d94356c4314e', 'Componente TripMapInline criado com lazy import de mapbox-gl', 0),
('671df666-5a10-45e8-abfd-d94356c4314e', 'Marker do prestador atualiza com lastLocation; ETA exibido em min', 1),
('671df666-5a10-45e8-abfd-d94356c4314e', 'Falha de token (NEXT_PUBLIC_MAPBOX_TOKEN ausente) -> placeholder textual', 2),
('671df666-5a10-45e8-abfd-d94356c4314e', 'Falha de carregamento mapbox -> placeholder textual sem quebrar parent', 3),
('671df666-5a10-45e8-abfd-d94356c4314e', 'Cleanup do mapa no unmount (sem memory leak — verificar com mount/unmount 2x)', 4),
('671df666-5a10-45e8-abfd-d94356c4314e', 'Texto "Localizacao temporariamente indisponivel" segue copy do AC #11', 5),
('671df666-5a10-45e8-abfd-d94356c4314e', 'aria-label no container do mapa; role="status" no fallback', 6),

-- T-316 ClientInactivityAlertSheet
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'Componente ClientInactivityAlertSheet criado usando ResponsiveDialog', 0),
('d25ed83c-687d-4c8b-a87f-70800927bc38', '2 botoes (Aguardar/Cancelar) com estado busy enquanto fetch', 1),
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'Idempotency-key estavel alert-decide-{alert_id}', 2),
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'Texto reforcado quando round_index >= 2 (ultima rodada)', 3),
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'Modal nao dismissivel sem decisao (sem ESC fora-de-clique)', 4),
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'Sonner.error ao falhar (showErrorToast)', 5),
('d25ed83c-687d-4c8b-a87f-70800927bc38', 'Mobile-first: bottom-sheet automatico em viewport <768px (ResponsiveDialog padrao)', 6),

-- T-317 emit push
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'emit.providerEnRoute e emit.providerArrived adicionados em src/lib/notifications/emit.ts', 0),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'Hooks chamados pelo trigger FSM em transicoes accepted->en_route e en_route->arrived', 1),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'Idempotency-key estavel enroute-push-{sr_id} e arrived-push-{sr_id}', 2),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', '2a transicao com mesmo SR nao duplica push (idempotency)', 3),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'Templates seedados em notification_templates (push, version=1, status=active)', 4),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'Push entregue mesmo com app fechado (smoke teste e2e via Edge Function dispatch-notifications)', 5),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed', 'Sem CPF/telefone no payload do notification_event (so provider_name no template)', 6);


-- ============================================================================
-- 4. TaskDependency (kind lowercase: blocks | relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES

-- T-305 VIEW depende de matching_rounds (T-238) e service_requests RLS (T-229) e provider_profiles
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-238'), 'blocks'),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-229'), 'blocks'),
('ac4e060b-2d33-42f0-98d8-9c8badcda8dc',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to'),

-- T-306 client_inactivity_alerts depende de service_requests (T-070) e moddatetime helper
('78ed929b-fcee-45db-8c47-a6186d209eda',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'blocks'),
('78ed929b-fcee-45db-8c47-a6186d209eda',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-231'), 'relates_to'),

-- T-307 cancel-search depende de transition_service_status RPC (T-235) e catalog FSM (T-225/T-227)
('a9cc9d42-cf78-4554-b01e-a04747152b1a',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),
('a9cc9d42-cf78-4554-b01e-a04747152b1a',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-225'), 'relates_to'),
('a9cc9d42-cf78-4554-b01e-a04747152b1a',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-227'), 'relates_to'),

-- T-308 retry depende de transition_service_status (T-235), start-matching (T-243), catalog (T-225)
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-243'), 'blocks'),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-225'), 'blocks'),
('4cc81280-7cc2-45da-9fa2-66f1d3a448b6',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-246'), 'relates_to'),

-- T-309 decide-alert depende de tabela T-306 e transition_service_status (T-235) e atypical_events (T-285)
('0e7a0899-b610-41a0-bac1-de46324d70b9', '78ed929b-fcee-45db-8c47-a6186d209eda', 'blocks'),
('0e7a0899-b610-41a0-bac1-de46324d70b9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),
('0e7a0899-b610-41a0-bac1-de46324d70b9',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-285'), 'relates_to'),

-- T-310 watchdog depende de tabela T-306, T-236 (Edge Function existente), T-162 (enqueue) e T-165 (cron)
('790a55f9-c17a-441a-aa9f-4281cd72a2ef', '78ed929b-fcee-45db-8c47-a6186d209eda', 'blocks'),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-236'), 'blocks'),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'blocks'),
('790a55f9-c17a-441a-aa9f-4281cd72a2ef',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-165'), 'relates_to'),

-- T-311 hook depende de canal Realtime (T-081), VIEW (T-305), tabelas T-274, T-306
('d256b241-1770-48af-ac51-175efd5aea93',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-081'), 'blocks'),
('d256b241-1770-48af-ac51-175efd5aea93', 'ac4e060b-2d33-42f0-98d8-9c8badcda8dc', 'blocks'),
('d256b241-1770-48af-ac51-175efd5aea93',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-274'), 'blocks'),
('d256b241-1770-48af-ac51-175efd5aea93', '78ed929b-fcee-45db-8c47-a6186d209eda', 'blocks'),

-- T-312 searching depende de hook (T-311) + cancel-search (T-307)
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'd256b241-1770-48af-ac51-175efd5aea93', 'blocks'),
('88e766c1-fe11-48bf-bd3f-793fb5d1836f', 'a9cc9d42-cf78-4554-b01e-a04747152b1a', 'blocks'),

-- T-313 no-matches depende de retry (T-308) + cancel-search (T-307)
('fba2f862-05c0-4260-89cb-9b3711b04a3e', '4cc81280-7cc2-45da-9fa2-66f1d3a448b6', 'blocks'),
('fba2f862-05c0-4260-89cb-9b3711b04a3e', 'a9cc9d42-cf78-4554-b01e-a04747152b1a', 'blocks'),

-- T-314 tracking depende de hook (T-311), TripMapInline (T-315), AlertSheet (T-316), ChatThread (T-185)
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'd256b241-1770-48af-ac51-175efd5aea93', 'blocks'),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', '671df666-5a10-45e8-abfd-d94356c4314e', 'blocks'),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e', 'd25ed83c-687d-4c8b-a87f-70800927bc38', 'blocks'),
('020f4db7-3e0b-4dce-b39d-ef02b14cdb0e',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-185'), 'relates_to'),

-- T-315 TripMapInline depende de service_provider_locations (T-274)
('671df666-5a10-45e8-abfd-d94356c4314e',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-274'), 'blocks'),

-- T-316 AlertSheet depende de tabela T-306 + endpoint T-309
('d25ed83c-687d-4c8b-a87f-70800927bc38', '78ed929b-fcee-45db-8c47-a6186d209eda', 'blocks'),
('d25ed83c-687d-4c8b-a87f-70800927bc38', '0e7a0899-b610-41a0-bac1-de46324d70b9', 'blocks'),

-- T-317 emit push depende de enqueue_notification_event (T-162), comms (T-171), template (T-216), trigger FSM (T-227)
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'blocks'),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-171'), 'blocks'),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-227'), 'blocks'),
('b59f425e-6ec6-420b-98fb-9cfa2f0c4aed',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-216'), 'relates_to');


-- ============================================================================
-- 5. Coverage fix — vincula tasks cross-US a AC desta US para cumprir DATA/API + UI
--    obrigatorio. Idempotente via ON CONFLICT DO NOTHING.
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- AC #5 stepper em tempo real -> DATA (T-227 trigger emite service_event) + API (T-235 RPC)
  ('ZLAR-V2-T-227', 5),
  ('ZLAR-V2-T-235', 5),

  -- AC #7 chat interno -> DATA (T-178 conversations/messages) + API (T-180 send_message)
  ('ZLAR-V2-T-178', 7),
  ('ZLAR-V2-T-180', 7),

  -- AC #10 push notif -> UI (T-281 e onde PRESTADOR aperta os botoes que disparam emit do T-317)
  ('ZLAR-V2-T-281', 10),

  -- AC #8 reabrir app vê estado -> DATA (T-305 VIEW e a fonte do bootstrap)
  ('ZLAR-V2-T-305', 8),

  -- AC #11 falha mapa, stepper segue -> DATA (T-227 trigger FSM emite service_event independente do mapa)
  ('ZLAR-V2-T-227', 11)
) v(task_ref, ac_order)
JOIN "Task" t ON t.reference = v.task_ref
JOIN "UserStory" us ON us.reference = 'ZLAR-V2-US-012'
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = us.id
 AND ac."order" = v.ac_order
ON CONFLICT DO NOTHING;


COMMIT;
