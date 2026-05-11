-- Zordon backlog cards: ZLAR-V2-US-023 (SISTEMA — Matriz de permissões (RLS) e ciclo de vida do serviço)
-- Persona: SISTEMA | Module: ADMIN | 14 AC | 13 tasks (T-225..T-237)
-- Persisted into: Task / TaskAcceptanceCriterion / AcceptanceCriterion(taskId) / TaskDependency
-- Reusa: US-011 (service_requests T-070), US-016 (admin_alerts T-190, app_config T-203, assertAdmin T-194),
--        US-017 (provider_moderation_log T-204), US-019 (apply_config_change T-217, preview T-219),
--        US-022 (enqueue_notification_event T-162, dispatch jobs T-165), US-026 (dispute_decisions T-155),
--        US-028 (release-escrow-payouts T-126/T-127), US-010 (visita técnica seeds T-064)
--
-- US-023 é a US "fundação" SISTEMA — define máquina de estados central, RLS canônica
-- por persona, audit trail imutável de eventos e jobs do ciclo de vida (escrow, garantia,
-- aceite tácito, stale execution). Outras US (005, 011, 012, 013, 016 etc.) referenciam.
-- EXCEÇÃO SISTEMA: AC sem cobertura UI — comportamento é puramente backend.

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
-- T-225 DATA — enum service_status + validate_status_transition + catálogo
-- ----------------------------------------------------------------------------
('49111483-efe7-47c1-8971-a878476a6869', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-225',
 'Criar enum service_status + função validate_status_transition + tabela catálogo de transições',
 $desc$## Objetivo
Centralizar a máquina de estados do serviço: enum `service_status` com todos os estados do ciclo de vida e função `validate_status_transition(old, new) RETURNS boolean` consultando catálogo declarativo `service_status_transitions`. Toda transição passa por aqui — bloqueia inválidas. Cobre AC #9.

## Contexto
Módulo ADMIN/EXECUCAO, mas a entrega é SISTEMA. US-011 (T-070) já criou `service_requests` com FSM inicial; aqui consolidamos a máquina completa em catálogo declarativo (não hardcoded em CHECK constraint), permitindo evolução sem migration de coluna. Consumido pelo trigger de T-227 e RPC de T-235. Estados levantados pelo refinamento: `draft`, `awaiting_payment`, `queued`, `broadcasting`, `accepted`, `on_the_way`, `arrived`, `in_progress`, `awaiting_client_present`, `pending_adjustment`, `pending_materials`, `completed_by_provider`, `awaiting_client_review`, `completed`, `in_dispute`, `cancelled_by_client`, `cancelled_by_provider`, `cancelled_by_admin`, `expired`.

## Estado atual / O que substitui
Hoje `service_requests.status` é text livre com CHECK ad-hoc (T-070). Substitui esse CHECK pela validação por enum + catálogo. ALTER TYPE preserva dados existentes (nenhum em prod ainda).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_fsm_enum.sql`
```sql
BEGIN;

CREATE TYPE service_status AS ENUM (
  'draft', 'awaiting_payment', 'queued', 'broadcasting',
  'accepted', 'on_the_way', 'arrived', 'in_progress',
  'awaiting_client_present', 'pending_adjustment', 'pending_materials',
  'completed_by_provider', 'awaiting_client_review', 'completed',
  'in_dispute',
  'cancelled_by_client', 'cancelled_by_provider', 'cancelled_by_admin',
  'expired'
);

-- Catálogo declarativo (linha por transição válida)
CREATE TABLE service_status_transitions (
  from_status   service_status NOT NULL,
  to_status     service_status NOT NULL,
  allowed_actor text NOT NULL CHECK (allowed_actor IN ('client','provider','admin','system')),
  description   text NOT NULL,
  PRIMARY KEY (from_status, to_status, allowed_actor)
);

INSERT INTO service_status_transitions (from_status, to_status, allowed_actor, description) VALUES
  ('draft','awaiting_payment','client','Cliente envia solicitação e parte para pagamento'),
  ('awaiting_payment','queued','system','Pagamento confirmado, entra na fila de matching'),
  ('queued','broadcasting','system','Engine de matching dispara broadcast'),
  ('broadcasting','accepted','provider','Prestador aceita proposta'),
  ('broadcasting','expired','system','Pool expirou sem aceite'),
  ('accepted','on_the_way','provider','Prestador inicia deslocamento'),
  ('on_the_way','arrived','provider','Prestador chegou ao endereço'),
  ('arrived','in_progress','provider','Início da execução com cliente presente'),
  ('arrived','awaiting_client_present','provider','Cliente não presente, aguarda contato'),
  ('awaiting_client_present','in_progress','provider','Cliente apareceu, retoma execução'),
  ('awaiting_client_present','cancelled_by_provider','provider','Cliente ausente, cancela'),
  ('in_progress','pending_adjustment','provider','Reajuste de preço pendente'),
  ('in_progress','pending_materials','provider','Aguardando materiais do cliente'),
  ('pending_adjustment','in_progress','client','Cliente aceitou reajuste'),
  ('pending_adjustment','cancelled_by_client','client','Cliente recusou reajuste'),
  ('pending_materials','in_progress','client','Cliente confirma materiais'),
  ('in_progress','completed_by_provider','provider','Prestador finaliza execução'),
  ('completed_by_provider','awaiting_client_review','system','Trigger envia para review'),
  ('awaiting_client_review','completed','client','Cliente avalia/aceita'),
  ('awaiting_client_review','completed','system','Aceite tácito após 48h (US-005/T-080 pattern)'),
  ('awaiting_client_review','in_dispute','client','Cliente abre disputa'),
  ('completed','in_dispute','client','Disputa pós-conclusão dentro da janela de garantia'),
  ('queued','cancelled_by_client','client','Cancelamento cedo'),
  ('broadcasting','cancelled_by_client','client','Cancelamento durante broadcast'),
  ('accepted','cancelled_by_client','client','Cancelamento pré-execução'),
  ('accepted','cancelled_by_provider','provider','Provider desiste antes de iniciar'),
  ('queued','cancelled_by_admin','admin','Intervenção operacional'),
  ('broadcasting','cancelled_by_admin','admin','Intervenção operacional'),
  ('accepted','cancelled_by_admin','admin','Intervenção operacional'),
  ('in_progress','cancelled_by_admin','admin','Intervenção operacional'),
  ('in_dispute','completed','admin','Disputa resolvida favorável ao prestador'),
  ('in_dispute','cancelled_by_admin','admin','Disputa resolvida com estorno');

CREATE INDEX service_status_transitions_from_idx
  ON service_status_transitions(from_status);

CREATE OR REPLACE FUNCTION validate_status_transition(
  p_from service_status,
  p_to   service_status,
  p_actor text
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_from = p_to THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM service_status_transitions
     WHERE from_status = p_from
       AND to_status   = p_to
       AND allowed_actor = p_actor
  );
END $$;

-- ALTER TYPE para coluna existente
ALTER TABLE service_requests
  ALTER COLUMN status TYPE service_status USING status::service_status;

ALTER TABLE service_status_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transitions_read_authenticated" ON service_status_transitions
  FOR SELECT TO authenticated USING (true);
-- Sem INSERT/UPDATE/DELETE — catálogo só evolui por migration

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Hardcodar transições em CHECK constraint na coluna status (perdemos evolução)
- ❌ Permitir transição auto (status = status) — função explicitamente recusa
- ❌ Função sem `STABLE` (impacta planner)
- ❌ Inserir transição de retrocesso (ex `completed` → `in_progress`) sem revisão de produto
- ❌ Esquecer transições do `in_dispute` (US-026 depende delas)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Snippet vive aqui como referência — implementador real ajusta nome do arquivo
- Padrão consultivo: catálogo declarativo > código embutido (memory generalization)
- Atores: `client | provider | admin | system` — `system` cobre transições por job (aceite tácito, expiração)
$desc$,
 'DATA', 'SISTEMA', ARRAY['NO_RLS_NEEDED','INDEX_REQUIRED','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-226 DATA — service_events (audit trail imutável append-only)
-- ----------------------------------------------------------------------------
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-226',
 'Criar service_events (audit trail imutável) com RLS multi-persona e triggers append-only',
 $desc$## Objetivo
Trilha imutável de TODOS os eventos do ciclo de vida do serviço (transições, tentativas inválidas, decisões automáticas/manuais). Append-only com triggers que bloqueiam UPDATE/DELETE — preserva evidência para conformidade e disputas. Cobre AC #10 e dá suporte a #9 (registra tentativas inválidas).

## Contexto
Módulo ADMIN/EXECUCAO. Distinto de `provider_moderation_log` (US-017 T-204, ações sobre prestador) e `dispute_decisions` (US-026 T-155, decisões de disputa). Aqui é audit log do **serviço**: cada transição válida ou tentativa inválida vira linha. Consumido por: aba "Histórico" no detalhe do serviço (UI exposta via outras US), painel admin (US-016), gerador de timeline em disputa (US-026).

## Estado atual / O que substitui
Não existe tabela de eventos do serviço. US-011 T-070 só tem `service_requests.status`.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_events.sql`
```sql
BEGIN;

CREATE TYPE service_event_kind AS ENUM (
  'status_transition',
  'invalid_transition_attempt',
  'pending_state_opened',
  'pending_state_resolved',
  'job_executed',
  'job_failed',
  'admin_intervention'
);

CREATE TABLE service_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  kind            service_event_kind NOT NULL,
  from_status     service_status,                          -- NULL para non-transition events
  to_status       service_status,                          -- NULL para invalid attempt
  actor           text NOT NULL CHECK (actor IN ('client','provider','admin','system')),
  actor_user_id   uuid REFERENCES auth.users(id),          -- NULL quando system/job
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,      -- contexto: erro, motivo, idempotency_key
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX service_events_service_idx
  ON service_events(service_id, "createdAt" DESC);
CREATE INDEX service_events_kind_idx
  ON service_events(kind, "createdAt" DESC);
CREATE INDEX service_events_actor_user_idx
  ON service_events(actor_user_id) WHERE actor_user_id IS NOT NULL;

ALTER TABLE service_events ENABLE ROW LEVEL SECURITY;

-- ADMIN: lê tudo
CREATE POLICY "service_events_admin_all" ON service_events FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- CLIENTE: lê eventos de serviços onde é parte
CREATE POLICY "service_events_client_own" ON service_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM service_requests sr
     WHERE sr.id = service_events.service_id
       AND sr.client_id = auth.uid()
  ));

-- PRESTADOR: lê eventos de serviços onde é parte
CREATE POLICY "service_events_provider_own" ON service_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM service_requests sr
     WHERE sr.id = service_events.service_id
       AND sr.provider_id = auth.uid()
  ));

-- INSERT só via SECURITY DEFINER function (RPC transition_service_status, T-235)
REVOKE INSERT ON service_events FROM authenticated;

-- Trigger imutabilidade
CREATE OR REPLACE FUNCTION service_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'service_events is append-only';
END $$;
CREATE TRIGGER service_events_no_update BEFORE UPDATE ON service_events
  FOR EACH ROW EXECUTE FUNCTION service_events_immutable();
CREATE TRIGGER service_events_no_delete BEFORE DELETE ON service_events
  FOR EACH ROW EXECUTE FUNCTION service_events_immutable();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE/DELETE (trigger garante)
- ❌ INSERT direto via authenticated (REVOKE + SECURITY DEFINER em T-235)
- ❌ FK ON DELETE CASCADE (auditoria preservada mesmo se serviço some — usar RESTRICT)
- ❌ Esquecer policy ADMIN (impedirá US-016 dashboard)
- ❌ Permitir actor `system` com `actor_user_id` populado (CHECK opcional)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Padrão append-only idêntico a `provider_moderation_log` (T-204) e `dispute_decisions` (T-155)
- Payload jsonb sempre — mesmo `{}` — para consistência
$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','AUDIT_LOG','INDEX_REQUIRED'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-227 DATA — trigger em service_requests valida transição + emite event
-- ----------------------------------------------------------------------------
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-227',
 'Aplicar trigger FSM em service_requests (validate transition + audit event + bloqueio direto)',
 $desc$## Objetivo
Garantir que TODA mutação de `service_requests.status` (mesmo direta via SQL) passa por validação da máquina de estados e gera linha em `service_events`. Bloqueia transição inválida com EXCEPTION e registra como `invalid_transition_attempt`. Reforça AC #9 (FSM mesmo via manipulação direta) e #10 (trail imutável).

## Contexto
Módulo ADMIN/EXECUCAO. Trigger BEFORE UPDATE em service_requests; chama `validate_status_transition()` (T-225) e, se válido, insere `service_events` (T-226). O actor vem de `current_setting('app.fsm_actor')` setado pela RPC (T-235). Se ausente, assume `system` (jobs).

## Estado atual / O que substitui
Não existe trigger. RPC de transição (T-235) também valida, mas trigger é defesa em profundidade contra UPDATE direto via SQL/admin.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_fsm_trigger.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION enforce_service_status_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor       text := COALESCE(current_setting('app.fsm_actor', true), 'system');
  v_actor_uid   uuid := NULLIF(current_setting('app.fsm_actor_user', true), '')::uuid;
  v_idem        text := NULLIF(current_setting('app.fsm_idem', true), '');
BEGIN
  -- Sem mudança de status, segue
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Valida transição
  IF NOT validate_status_transition(OLD.status, NEW.status, v_actor) THEN
    -- Registra tentativa inválida
    INSERT INTO service_events (service_id, kind, from_status, to_status, actor, actor_user_id, payload)
    VALUES (NEW.id, 'invalid_transition_attempt', OLD.status, NEW.status, v_actor, v_actor_uid,
            jsonb_build_object('idempotency_key', v_idem, 'reason','transition_not_allowed'));
    RAISE EXCEPTION 'invalid_status_transition: % -> % by % is not allowed',
      OLD.status, NEW.status, v_actor
      USING ERRCODE = 'check_violation';
  END IF;

  -- Registra transição válida
  INSERT INTO service_events (service_id, kind, from_status, to_status, actor, actor_user_id, payload)
  VALUES (NEW.id, 'status_transition', OLD.status, NEW.status, v_actor, v_actor_uid,
          jsonb_build_object('idempotency_key', v_idem));

  RETURN NEW;
END $$;

CREATE TRIGGER service_requests_enforce_fsm
  BEFORE UPDATE OF status ON service_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_service_status_transition();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Trigger AFTER (precisamos bloquear ANTES do COMMIT)
- ❌ Trigger sem SECURITY DEFINER (RLS de service_events bloqueia INSERT do caller comum)
- ❌ Confiar em coluna application-set para actor (usar GUC `app.fsm_actor` setado pela RPC)
- ❌ Permitir UPDATE de outras colunas no mesmo statement quando status muda sem registrar (atual snippet só dispara em coluna status — ok)
- ❌ Esquecer COALESCE pra `system` (jobs sem GUC explícito)

## Convenções
- Padrão "trigger guard via current_setting" idêntico ao `app_config_block_direct_update` (US-019, generalization)
- Migration via psql; `database.types.ts` regenerado
- Smoke: UPDATE direto sem GUC seta actor=system; transição válida pra system passa
$desc$,
 'DATA', 'SISTEMA', ARRAY['NO_RLS_NEEDED','AUDIT_LOG','RACE_CONDITION'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-228 DATA — helpers SECURITY DEFINER de elegibilidade/estado de prestador
-- ----------------------------------------------------------------------------
('04b40b24-88d5-4175-a623-6a628ad99bca', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-228',
 'Criar helpers SECURITY DEFINER (is_provider_active, provider_can_view_service, has_open_pending_state)',
 $desc$## Objetivo
Encapsular lógicas de autorização que cruzam tabelas (`provider_profiles.account_status`, `service_requests`, `service_pending_states`) em funções `SECURITY DEFINER`. Reusadas em policies RLS (T-229/T-230), gates de RPC (T-235) e trigger guards. Cobre AC #3, #4, #12 (suporta).

## Contexto
Módulo ADMIN/EXECUCAO. Tabelas-base existem: `provider_profiles` (US-001 T-002), `service_requests` (US-011 T-070). Pool de elegibilidade (AC #4) NÃO é via RLS direta — engine de matching (US-004) calcula e expõe via `pool_eligible_providers` (criado lá). Aqui complementamos com helper de "este provider é membro do pool deste serviço?".

## Estado atual / O que substitui
Hoje o check de "provider ativo" está espalhado em código. Centralizamos.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_authz_helpers.sql`
```sql
BEGIN;

-- Provider está ativo (KYC aprovado, sem suspensão)?
CREATE OR REPLACE FUNCTION is_provider_active(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM provider_profiles pp
     WHERE pp.user_id = p_uid
       AND pp.account_status = 'active'
       AND pp.kyc_status = 'approved'
  );
$$;

-- Provider pode ver este serviço (alocado OU presente no pool durante broadcast)?
CREATE OR REPLACE FUNCTION provider_can_view_service(p_uid uuid, p_service_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- alocado direto
    EXISTS (SELECT 1 FROM service_requests sr
              WHERE sr.id = p_service_id AND sr.provider_id = p_uid)
    OR
    -- no pool durante broadcasting (depende de pool_eligible_providers da US-004)
    EXISTS (SELECT 1 FROM service_requests sr
              JOIN pool_eligible_providers pep ON pep.service_id = sr.id
             WHERE sr.id = p_service_id
               AND sr.status = 'broadcasting'
               AND pep.provider_id = p_uid);
$$;

-- Serviço tem estado pendente aberto (reajuste OR materiais)?
CREATE OR REPLACE FUNCTION has_open_pending_state(p_service_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM service_pending_states sps
     WHERE sps.service_id = p_service_id
       AND sps.resolved_at IS NULL
  );
$$;

-- ADMIN claim (já existe via JWT, mas wrapper consistente)
CREATE OR REPLACE FUNCTION is_admin_claim()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
$$;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Funções sem `STABLE` (impacta plan e cache do Postgres)
- ❌ Esquecer `SET search_path = public` em SECURITY DEFINER (CVE pattern)
- ❌ Hardcodar 'active' em código de aplicação (usar helper)
- ❌ `provider_can_view_service` retornar TRUE para serviços terminados (RLS via tabela cobre — não filtrar duplo aqui)
- ❌ Esquecer `pool_eligible_providers` (vem da US-004; tabela esperada — ver flags_or_concerns)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Padrão `SECURITY DEFINER + STABLE + search_path` igual a helpers do Zordon (`is_admin`, `is_manager`)
- Smoke: provider ativo retorna true; suspenso retorna false; outro provider retorna 0 linhas em SELECT do serviço alheio

> **Dependência soft:** `pool_eligible_providers` é da US-004 (não criada ainda). Implementador da US-004 deve criar a tabela; implementador desta task pode adiar o `provider_can_view_service` até essa exist (ou criar com placeholder NULL). Sinalizado em `flags_or_concerns`.
$desc$,
 'DATA', 'SISTEMA', ARRAY['NO_RLS_NEEDED','RLS_REQUIRED'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-229 DATA — RLS canônica em service_requests por persona
-- ----------------------------------------------------------------------------
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-229',
 'Aplicar RLS canônica em service_requests (CLIENTE/PRESTADOR/ADMIN) com WITH CHECK por estado',
 $desc$## Objetivo
Substituir RLS provisória de `service_requests` (US-011 T-070) pela canônica multi-persona com regras WITH CHECK por estado da FSM. Inclui constraint que **só CLIENTE cria** (AC #2) e **só PRESTADOR ativo aceita** (AC #3). Cobre AC #1, #2, #3, #4.

## Contexto
Módulo EXECUCAO/SOLICITACAO. Reusa helpers de T-228. Esta task substitui as policies da T-070 — coordena com a US-011 (rever no momento de implementar pra não conflitar).

## Estado atual / O que substitui
US-011 T-070 criou policies básicas (`client_own`, `provider_assigned`). Substitui por suite completa com regras de transição.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_rls_service_requests.sql`
```sql
BEGIN;

-- Drop policies antigas
DROP POLICY IF EXISTS "client_own_records"   ON service_requests;
DROP POLICY IF EXISTS "client_create_own"    ON service_requests;
DROP POLICY IF EXISTS "client_update_own"    ON service_requests;
DROP POLICY IF EXISTS "provider_assigned"    ON service_requests;
DROP POLICY IF EXISTS "provider_update_own"  ON service_requests;

-- ADMIN: tudo
CREATE POLICY "sr_admin_all" ON service_requests
  FOR ALL USING (is_admin_claim());

-- CLIENTE
CREATE POLICY "sr_client_select_own" ON service_requests
  FOR SELECT USING (auth.uid() = client_id);

CREATE POLICY "sr_client_insert" ON service_requests
  FOR INSERT WITH CHECK (
    auth.uid() = client_id
    AND status = 'draft'                          -- só pode nascer em draft
    AND provider_id IS NULL                       -- não atribui prestador
  );

CREATE POLICY "sr_client_update" ON service_requests
  FOR UPDATE USING (auth.uid() = client_id)
  WITH CHECK (
    auth.uid() = client_id
    AND status IN ('draft','awaiting_payment','queued','broadcasting',
                   'pending_adjustment','pending_materials',
                   'cancelled_by_client')         -- estados que cliente muda
  );

-- PRESTADOR
CREATE POLICY "sr_provider_select_assigned" ON service_requests
  FOR SELECT USING (
    auth.uid() = provider_id
    OR provider_can_view_service(auth.uid(), id)  -- inclui pool durante broadcasting
  );

CREATE POLICY "sr_provider_update_assigned" ON service_requests
  FOR UPDATE USING (auth.uid() = provider_id)
  WITH CHECK (
    auth.uid() = provider_id
    AND status IN ('on_the_way','arrived','in_progress',
                   'awaiting_client_present','pending_adjustment',
                   'pending_materials','completed_by_provider',
                   'cancelled_by_provider')
  );

-- ACEITE (UPDATE provider_id de NULL → uid): controlado por RPC accept_proposal
-- (US-004) que setará session GUCs e usará SECURITY DEFINER. RLS aqui não permite
-- esse UPDATE diretamente — o WITH CHECK do prestador exige auth.uid() = provider_id,
-- bloqueando "self-assign" via SQL direto.

-- INSERT por prestador/admin (NEGADO):
-- AC #2 — somente cliente pode criar.
-- A política "sr_client_insert" exige client_id=auth.uid(), bloqueando outros casos
-- por padrão. Não criamos policy permissiva para outras personas.

-- Constraint de integridade adicional: CLIENTE não muda provider_id manualmente
-- (regra coberta pelo WITH CHECK de update — provider_id não está na lista de
-- colunas que cliente edita ativamente; reforço via trigger opcional).

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir CLIENTE criar com status diferente de `draft`
- ❌ Permitir CLIENTE atualizar `provider_id` ou `final_amount` (cobertos por WITH CHECK que filtra status, mas reforçar via trigger se necessário)
- ❌ Policy permissiva pra prestador/admin INSERT (AC #2 explícito)
- ❌ Esquecer de DROP policies antigas (Postgres não permite duas com mesmo nome)
- ❌ Self-assign via UPDATE (RPC accept_proposal cuida; RLS aqui bloqueia direto)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Reuso de `is_admin_claim()` e `provider_can_view_service()` de T-228
- Smoke obrigatório: cliente A não vê service do cliente B; prestador X não vê service do prestador Y; admin vê tudo
- Pattern de RLS por persona com helpers (memory `feedback_role_helpers_postgres`)
$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-230 DATA — RLS canônica em ratings, payments, wallets, profiles
-- ----------------------------------------------------------------------------
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-230',
 'Aplicar RLS canônica suite (ratings, payments, provider_payouts, profiles, addresses)',
 $desc$## Objetivo
Suite consolidada de RLS por persona em todas as tabelas de domínio sensível além de `service_requests`. Cobre AC #5 (avaliação de serviço concluído), #6 (edita só próprio perfil), #7 (PRESTADOR só própria carteira), #8 (apenas ADMIN suspende/medeia).

## Contexto
Módulo ADMIN — fundação de segurança. Tabelas existentes: `client_profiles` (US-009 T-045), `client_addresses` (US-009 T-046), `provider_profiles` (US-001 T-002), `provider_bank_accounts` (US-003 T-026), `payments` (US-011 T-071), `provider_payouts` (US-028 T-124), `ratings` (US-013 — não criado ainda; sinalizar como soft dep).

## Estado atual / O que substitui
Cada US criou suas policies localmente; aqui consolidamos a CAMADA de garantias que cruza personas (especialmente o WITH CHECK de "rating só serviço completed onde é parte").

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_rls_canonical_suite.sql`
```sql
BEGIN;

-- ============= ratings (US-013 — assume tabela existe) =============
DROP POLICY IF EXISTS "ratings_client_insert" ON ratings;
CREATE POLICY "ratings_client_insert" ON ratings FOR INSERT
  WITH CHECK (
    auth.uid() = client_id
    AND EXISTS (
      SELECT 1 FROM service_requests sr
       WHERE sr.id = ratings.service_id
         AND sr.client_id = auth.uid()
         AND sr.status = 'completed'             -- AC #5: só concluído
    )
  );
DROP POLICY IF EXISTS "ratings_select_parties" ON ratings;
CREATE POLICY "ratings_select_parties" ON ratings FOR SELECT
  USING (
    is_admin_claim()
    OR auth.uid() = client_id
    OR auth.uid() = provider_id                  -- prestador vê avaliação dele
  );
-- prestador NÃO insere/edita ratings (AC #5)

-- ============= provider_profiles (AC #6) =============
DROP POLICY IF EXISTS "pp_self_update" ON provider_profiles;
CREATE POLICY "pp_self_update" ON provider_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- bloqueia escalada de account_status/kyc_status — coluna admin-only
    -- (forçar via trigger ou coluna list em check; aqui assume colunas
    -- protegidas por trigger separado — generalization candidata)
  );
DROP POLICY IF EXISTS "pp_admin_update" ON provider_profiles;
CREATE POLICY "pp_admin_update" ON provider_profiles FOR UPDATE
  USING (is_admin_claim());

-- ============= client_profiles (AC #6) =============
DROP POLICY IF EXISTS "cp_self_update" ON client_profiles;
CREATE POLICY "cp_self_update" ON client_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cp_admin_select" ON client_profiles;
CREATE POLICY "cp_admin_select" ON client_profiles FOR SELECT
  USING (is_admin_claim() OR auth.uid() = user_id);

-- ============= client_addresses (AC #6 — apenas dono e admin) =============
DROP POLICY IF EXISTS "ca_admin_all" ON client_addresses;
CREATE POLICY "ca_admin_all" ON client_addresses FOR SELECT USING (is_admin_claim());

-- ============= provider_payouts (AC #7) =============
DROP POLICY IF EXISTS "pay_provider_own" ON provider_payouts;
CREATE POLICY "pay_provider_own" ON provider_payouts FOR SELECT
  USING (auth.uid() = provider_id);
DROP POLICY IF EXISTS "pay_admin_all" ON provider_payouts;
CREATE POLICY "pay_admin_all" ON provider_payouts FOR ALL
  USING (is_admin_claim());
-- CLIENTE: nada (sem policy permissiva)

-- ============= provider_bank_accounts (AC #7) =============
DROP POLICY IF EXISTS "pba_self" ON provider_bank_accounts;
CREATE POLICY "pba_self" ON provider_bank_accounts FOR ALL
  USING (auth.uid() = provider_id) WITH CHECK (auth.uid() = provider_id);
DROP POLICY IF EXISTS "pba_admin" ON provider_bank_accounts;
CREATE POLICY "pba_admin" ON provider_bank_accounts FOR SELECT
  USING (is_admin_claim());

-- ============= payments (AC #7 + #8) =============
DROP POLICY IF EXISTS "pmt_client_own" ON payments;
CREATE POLICY "pmt_client_own" ON payments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM service_requests sr
             WHERE sr.id = payments.service_id AND sr.client_id = auth.uid())
  );
DROP POLICY IF EXISTS "pmt_provider_own" ON payments;
CREATE POLICY "pmt_provider_own" ON payments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM service_requests sr
             WHERE sr.id = payments.service_id AND sr.provider_id = auth.uid())
  );
DROP POLICY IF EXISTS "pmt_admin_all" ON payments;
CREATE POLICY "pmt_admin_all" ON payments FOR ALL USING (is_admin_claim());

-- ============= disputes / suspensions / refunds (AC #8) =============
-- Criadas pelas US-026/US-008/US-017 com policy admin-only via is_admin_claim().
-- Aqui apenas verificamos consistência e adicionamos faltantes:
-- (smoke check: nenhuma policy permissiva pra cliente/prestador modificar
-- dispute_decisions / provider_suspension_events / refund_orders)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir CLIENTE editar `provider_payouts` ou `payments`
- ❌ Permitir PRESTADOR avaliar (AC #5)
- ❌ Permitir cliente avaliar serviço não-completed (WITH CHECK garante)
- ❌ Esquecer DROP IF EXISTS (idempotência da migration)
- ❌ Não considerar trigger separado para colunas admin-only (`account_status`, `kyc_status` em provider_profiles) — separar em task se necessário

## Convenções
- Reuso de `is_admin_claim()` (T-228)
- Migration via psql; `database.types.ts` regenerado
- Smoke obrigatório: tentar inserir rating em service queued → falha; cliente lê própria payment, não outra; prestador lê própria payout, não de outro provider

> **Dependência soft:** `ratings` (US-013), `provider_payouts` (US-028 — já criado em T-124). Tabelas precisam existir antes do apply.
$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-231 DATA — service_pending_states (lock de estados paralelos AC #12)
-- ----------------------------------------------------------------------------
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-231',
 'Criar service_pending_states com partial unique constraint para travar estados paralelos',
 $desc$## Objetivo
Garantir que apenas UM estado pendente (reajuste, materiais, ausência) esteja ativo em paralelo num mesmo `service_id`. Constraint partial UNIQUE força resolução sequencial. RPC `open_pending_state` falha com 409 se já houver pendência aberta. Cobre AC #12.

## Contexto
Módulo EXECUCAO. Serviços em `in_progress` podem entrar em sub-estados pendentes (`pending_adjustment`, `pending_materials`, `awaiting_client_present`). Cada um vira linha em `service_pending_states` com `resolved_at IS NULL` enquanto aberto. Pattern de UNIQUE partial é a forma mais simples de exclusividade.

## Estado atual / O que substitui
Não existe — service_requests.status como enum permite só um estado linear; sub-estados paralelos exigem tabela.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_pending_states.sql`
```sql
BEGIN;

CREATE TYPE service_pending_kind AS ENUM (
  'price_adjustment',
  'materials_required',
  'client_absent'
);

CREATE TABLE service_pending_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  kind            service_pending_kind NOT NULL,
  opened_by       uuid NOT NULL REFERENCES auth.users(id),
  opened_actor    text NOT NULL CHECK (opened_actor IN ('client','provider','admin')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,        -- valores propostos
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id),
  resolution      text CHECK (resolution IN ('accepted','rejected','expired','admin_override') OR resolution IS NULL),
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

-- Partial UNIQUE: apenas uma pendência aberta por serviço
CREATE UNIQUE INDEX service_pending_states_one_open
  ON service_pending_states(service_id)
  WHERE resolved_at IS NULL;

CREATE INDEX service_pending_states_service_idx
  ON service_pending_states(service_id, "createdAt" DESC);

ALTER TABLE service_pending_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sps_admin_all" ON service_pending_states FOR ALL USING (is_admin_claim());

CREATE POLICY "sps_parties_select" ON service_pending_states FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM service_requests sr
     WHERE sr.id = service_pending_states.service_id
       AND (sr.client_id = auth.uid() OR sr.provider_id = auth.uid())
  ));

-- INSERT/UPDATE só via RPC (REVOKE direto e SECURITY DEFINER em open/resolve)
REVOKE INSERT, UPDATE ON service_pending_states FROM authenticated;

CREATE OR REPLACE FUNCTION open_service_pending_state(
  p_service_id uuid, p_kind service_pending_kind, p_actor text, p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF has_open_pending_state(p_service_id) THEN
    RAISE EXCEPTION 'pending_state_already_open' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO service_pending_states(service_id, kind, opened_by, opened_actor, payload)
  VALUES (p_service_id, p_kind, auth.uid(), p_actor, COALESCE(p_payload,'{}'::jsonb))
  RETURNING id INTO v_id;
  -- emite event
  INSERT INTO service_events(service_id, kind, actor, actor_user_id, payload)
  VALUES (p_service_id, 'pending_state_opened', p_actor, auth.uid(),
          jsonb_build_object('pending_kind', p_kind, 'pending_id', v_id));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION resolve_service_pending_state(
  p_pending_id uuid, p_resolution text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_service_id uuid; v_kind service_pending_kind;
BEGIN
  UPDATE service_pending_states
     SET resolved_at = NOW(), resolved_by = auth.uid(), resolution = p_resolution
   WHERE id = p_pending_id AND resolved_at IS NULL
  RETURNING service_id, kind INTO v_service_id, v_kind;
  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'pending_state_not_found_or_already_resolved'
      USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO service_events(service_id, kind, actor, actor_user_id, payload)
  VALUES (v_service_id, 'pending_state_resolved', 'system', auth.uid(),
          jsonb_build_object('pending_kind', v_kind, 'resolution', p_resolution));
END $$;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ UNIQUE total (precisa ser partial WHERE resolved_at IS NULL — múltiplas resolvidas no histórico)
- ❌ Permitir INSERT direto via authenticated (REVOKE)
- ❌ Esquecer emitir service_events nas transições
- ❌ resolve sem checar resolved_at IS NULL (idempotência: 2x resolve dá NPE)
- ❌ FK CASCADE em service_id (preserva histórico ao cancelar serviço)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Reuso `has_open_pending_state` (T-228), `is_admin_claim` (T-228)
- Padrão "RPC mutation + service_event" igual a `apply_config_change` (US-019 T-217)
- Pattern partial unique constraint (memory generalization candidata)
$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','RACE_CONDITION','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-232 DATA — job_run_log + helper run_job_with_retry
-- ----------------------------------------------------------------------------
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-232',
 'Criar job_run_log + helper try_advance_job (idempotência + retry com backoff)',
 $desc$## Objetivo
Tabela genérica `job_run_log` que registra cada execução de job/Edge Function do ciclo de vida (sucesso, falha, retry). Junto com helper `try_advance_job(job_name, target_id)` que executa, em caso de erro, agenda retry com backoff e emite `admin_alert` se persistir. Cobre AC #14.

## Contexto
Módulo ADMIN/OPS. Generaliza pattern de retry implícito hoje espalhado em jobs específicos (release-escrow, dispatch-notifications). Reusado pelos jobs criados em T-233 e Edge Function de T-234.

## Estado atual / O que substitui
Não existe — jobs falham silenciosamente e exigem detecção manual. Centralizamos.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_job_run_log.sql`
```sql
BEGIN;

CREATE TABLE job_run_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      text NOT NULL,                          -- ex 'release_escrow_70', 'tacit_acceptance'
  target_kind   text,                                   -- ex 'service_request'
  target_id     uuid,                                   -- chave de idempotência opcional
  status        text NOT NULL CHECK (status IN ('running','success','failed','retry_scheduled','aborted')),
  attempt       int  NOT NULL DEFAULT 1,
  next_retry_at timestamptz,
  error_message text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT NOW(),
  finished_at   timestamptz
);

CREATE INDEX job_run_log_job_idx     ON job_run_log(job_name, started_at DESC);
CREATE INDEX job_run_log_status_idx  ON job_run_log(status) WHERE status IN ('failed','retry_scheduled');
CREATE INDEX job_run_log_target_idx  ON job_run_log(target_kind, target_id) WHERE target_id IS NOT NULL;

ALTER TABLE job_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jrl_admin_all" ON job_run_log FOR SELECT USING (is_admin_claim());
-- INSERT/UPDATE: só service_role / SECURITY DEFINER

CREATE OR REPLACE FUNCTION schedule_job_retry(
  p_job_name text, p_target_kind text, p_target_id uuid,
  p_attempt int, p_error text, p_max_attempts int DEFAULT 5
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delay interval;
BEGIN
  -- Backoff exponencial com jitter: 30s, 2m, 8m, 30m, 2h
  v_delay := (POWER(4, LEAST(p_attempt, 5)) * INTERVAL '30 seconds');

  IF p_attempt >= p_max_attempts THEN
    -- emite alerta admin e marca aborted
    INSERT INTO admin_alerts (kind, severity, payload)
    VALUES ('job_retry_exhausted', 'high',
            jsonb_build_object('job_name', p_job_name,
                               'target_kind', p_target_kind,
                               'target_id', p_target_id,
                               'attempts', p_attempt,
                               'last_error', p_error));
    UPDATE job_run_log SET status = 'aborted', finished_at = NOW(), error_message = p_error
     WHERE job_name = p_job_name AND target_id = p_target_id AND status = 'running';
    RETURN;
  END IF;

  INSERT INTO job_run_log (job_name, target_kind, target_id, status, attempt,
                           next_retry_at, error_message)
  VALUES (p_job_name, p_target_kind, p_target_id, 'retry_scheduled', p_attempt+1,
          NOW() + v_delay, p_error);
END $$;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Backoff linear (perde efeito com tempestade)
- ❌ Esquecer emit `admin_alert` ao esgotar (AC #14: alerta a equipe se persistir)
- ❌ Permitir UPDATE direto via authenticated (admin lê, sistema escreve)
- ❌ Acumular linhas indefinidamente — agendar limpeza (>90d) em job separado (referenciado em T-233)
- ❌ Esquecer index parcial em (failed, retry_scheduled) — usado pelo job de retry-failed-jobs

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Reuso `is_admin_claim` (T-228), `admin_alerts` (US-016 T-190)
- Pattern de generalization "append-only audit + alerta crítico" igual a `provider_moderation_log` + `app_config_history`
$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','AUDIT_LOG','INDEX_REQUIRED'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-233 OPS — pg_cron jobs do ciclo de vida (escrow, garantia, aceite tácito)
-- ----------------------------------------------------------------------------
('726747db-a08a-43fb-870c-6501e99426c1', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-233',
 'Configurar pg_cron jobs do ciclo de vida (aceite tácito, escrow 70/30, garantia, retry)',
 $desc$## Objetivo
Agendar via pg_cron os jobs centrais do ciclo de vida do serviço, todos chamando a Edge Function `lifecycle-tick` (T-234) com diferentes targets. Cada execução verifica estado atual antes de aplicar (ignora silenciosamente se cancelado/em disputa). Cobre AC #11.

## Contexto
Módulo ADMIN. pg_cron já habilitado (US-016 T-203 estabelece pattern). Edge Functions existem ou serão criadas (T-127 release-escrow já criada na US-028; aqui consolidamos visão geral). A função invoca via `net.http_post` para o endpoint da Edge Function com header `service_role`.

## Estado atual / O que substitui
US-028 T-126/T-127 já agendam release-escrow. Aqui adicionamos os outros jobs do ciclo (aceite tácito 48h, expiração garantia 30d, stale execution 24h, retry-failed-jobs).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_lifecycle_cron.sql`
```sql
BEGIN;

-- Helper de invocação (ou reusar pattern da US-028 T-127 / US-022 T-165)
-- Aceite tácito: roda a cada 15min, processa awaiting_client_review > 48h
SELECT cron.schedule(
  'lifecycle_tacit_acceptance',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.edge_url') || '/lifecycle-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'),
                                  'Content-Type', 'application/json'),
    body := jsonb_build_object('job', 'tacit_acceptance')
  );
  $cmd$
);

-- Liberação parcial 70% do escrow: roda a cada 30min, services com completed >= 72h
SELECT cron.schedule(
  'lifecycle_escrow_release_70',
  '*/30 * * * *',
  $cmd$ SELECT net.http_post(
    url := current_setting('app.edge_url') || '/lifecycle-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('job', 'escrow_partial_70')
  ); $cmd$
);

-- Liberação final 30% após 30d garantia
SELECT cron.schedule(
  'lifecycle_escrow_release_30_final',
  '0 * * * *',
  $cmd$ SELECT net.http_post(
    url := current_setting('app.edge_url') || '/lifecycle-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('job', 'escrow_final_30')
  ); $cmd$
);

-- Expiração da janela de garantia (30d após completed): apenas marcar
SELECT cron.schedule(
  'lifecycle_warranty_expiration',
  '5 * * * *',
  $cmd$ SELECT net.http_post(
    url := current_setting('app.edge_url') || '/lifecycle-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('job', 'warranty_expiration')
  ); $cmd$
);

-- Detecção de stale execution > 24h (AC #13): job emit-stale-execution-alert (T-236)
SELECT cron.schedule(
  'lifecycle_stale_execution_detect',
  '*/30 * * * *',
  $cmd$ SELECT net.http_post(
    url := current_setting('app.edge_url') || '/emit-stale-execution-alert',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := '{}'::jsonb
  ); $cmd$
);

-- Retry de jobs falhados (AC #14)
SELECT cron.schedule(
  'lifecycle_retry_failed_jobs',
  '*/5 * * * *',
  $cmd$ SELECT net.http_post(
    url := current_setting('app.edge_url') || '/lifecycle-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('job', 'retry_failed')
  ); $cmd$
);

-- Limpeza de job_run_log antigo (>90d)
SELECT cron.schedule(
  'lifecycle_cleanup_job_log',
  '0 3 * * *',
  $cmd$ DELETE FROM job_run_log WHERE started_at < NOW() - INTERVAL '90 days'
        AND status IN ('success','aborted'); $cmd$
);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Job assíncrono que não verifica estado atual (AC #11: ignora silenciosamente se cancelled/in_dispute)
- ❌ Service role key em texto claro no SQL (usar `current_setting('app.service_role_key', true)` setado em init)
- ❌ Frequência muito baixa em jobs com efeito financeiro (>1h não cobre janela curta)
- ❌ Esquecer cleanup de job_run_log (acumula GBs em 1 ano)
- ❌ Duplicar job já schedulado (US-028 T-126 release-escrow): coordenar — esta task **adiciona** os faltantes, não duplica

## Convenções
- Migration via psql
- Pattern pg_cron + net.http_post igual US-016 T-203 (generalization)
- Reuso do canal Edge Function único `lifecycle-tick` (T-234) para múltiplos sub-jobs (despacha por payload.job)
- Job de stale execution alert é separado (chama T-236 — endpoint dedicado)

> **Coordenação:** US-028 T-126/T-127 já scheduling release-escrow-payouts. Implementador desta task **deve verificar** se aquele job é redundante com `escrow_partial_70` aqui e consolidar (a tendência é manter o canônico aqui e remover/substituir T-126).
$desc$,
 'OPS', 'SISTEMA', ARRAY['NO_RLS_NEEDED','SECRET_HANDLING','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-234 API — Edge Function lifecycle-tick (despacha sub-jobs)
-- ----------------------------------------------------------------------------
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-234',
 'Implementar Edge Function lifecycle-tick (despachador idempotente de sub-jobs)',
 $desc$## Objetivo
Edge Function única que recebe `{job: '<nome>'}` no body e despacha pra handler interno: aceite tácito, escrow 70%, escrow 30% final, expiração garantia, retry-failed. Cada handler é idempotente (verifica estado antes; usa `target_id` em job_run_log como chave). Aborta silenciosamente se serviço em estado terminal (cancelado/in_dispute), conforme AC #11. Cobre AC #11 e #14.

## Contexto
Módulo ADMIN/EXECUCAO. Chamada exclusivamente por pg_cron (T-233). Usa `SUPABASE_SERVICE_ROLE_KEY` para bypass de RLS. Reusa `try_advance_job` / `schedule_job_retry` (T-232).

## Estado atual / O que substitui
Não existe Edge Function consolidada. US-028 T-127 (release-escrow-payouts) deve ser absorvida ou referenciada — implementador decide consolidação no momento.

## O que criar

### `supabase/functions/lifecycle-tick/index.ts`
```ts
// Edge Function (Deno)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

type JobName =
  | 'tacit_acceptance'
  | 'escrow_partial_70'
  | 'escrow_final_30'
  | 'warranty_expiration'
  | 'retry_failed';

const HANDLERS: Record<JobName, () => Promise<{processed: number, failed: number}>> = {
  tacit_acceptance: handleTacitAcceptance,
  escrow_partial_70: handleEscrow70,
  escrow_final_30: handleEscrow30Final,
  warranty_expiration: handleWarrantyExpiration,
  retry_failed: handleRetryFailed,
};

Deno.serve(async (req) => {
  const { job } = await req.json() as { job: JobName };
  if (!HANDLERS[job]) return new Response('unknown_job', { status: 400 });

  const result = await HANDLERS[job]();
  return Response.json({ ok: true, job, ...result });
});

async function handleTacitAcceptance() {
  // services em awaiting_client_review há > 48h, transição via RPC transition_service_status
  const { data: services } = await supabase.rpc('list_services_for_tacit_acceptance');
  let processed = 0, failed = 0;
  for (const s of services ?? []) {
    try {
      await supabase.rpc('transition_service_status', {
        p_service_id: s.id,
        p_to_status: 'completed',
        p_actor: 'system',
        p_idempotency_key: `tacit-${s.id}`,
      });
      processed++;
    } catch (e) {
      failed++;
      await supabase.rpc('schedule_job_retry', {
        p_job_name: 'tacit_acceptance',
        p_target_kind: 'service_request',
        p_target_id: s.id,
        p_attempt: 1,
        p_error: String(e),
      });
    }
  }
  return { processed, failed };
}

// Demais handlers seguem o mesmo padrão: lista candidates → tenta avançar/processar
// → registra resultado (sucesso ou agenda retry)
```

## Constraints / NÃO fazer
- ❌ Service role exposto pra browser (Edge Function server-only)
- ❌ Handler que não verifica estado antes (precisa ser idempotente)
- ❌ Bloquear no primeiro erro (continua processando demais; agenda retry individual)
- ❌ Confiar em payload sem validar `job` (whitelist)
- ❌ Esquecer log estruturado por execução

## Convenções
- Reuso `transition_service_status` (T-235), `schedule_job_retry` (T-232)
- Pattern Edge Function despachadora vs uma Function por job: opta-se por uma única para reduzir overhead (memory generalization candidata)
- Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` em `Deno.env`
- Logs estruturados: `{job, processed, failed}` no console
$desc$,
 'API', 'SISTEMA', ARRAY['NO_RLS_NEEDED','SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-235 API — RPC transition_service_status (única porta de transição)
-- ----------------------------------------------------------------------------
('20204d49-33fa-4c8a-9a05-83fa88129012', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-235',
 'Implementar RPC transition_service_status (validação + lock pendência + audit + idempotência)',
 $desc$## Objetivo
RPC SECURITY DEFINER única usada por TODAS as transições de status: valida transição (T-225), checa pendências paralelas (T-228 has_open_pending_state), seta GUCs para o trigger (T-227), atualiza coluna status, retorna 409 quando não-aplicável. Cobre AC #9, #10, #12 (suporte) e dá idempotência via key opcional. Substitui mutações ad-hoc espalhadas em endpoints de US-005, US-011, US-012 etc.

## Contexto
Módulo ADMIN/EXECUCAO. Reusa: `validate_status_transition` (T-225), trigger FSM (T-227), `has_open_pending_state` (T-228), `service_events` (T-226). Idempotência: tabela `service_status_idempotency` ou índice em service_events.payload.idempotency_key.

## Estado atual / O que substitui
Hoje cada endpoint atualiza `service_requests.status` direto. RPC central torna essa ação rastreável e segura.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_transition_service_status.sql`
```sql
BEGIN;

CREATE TABLE service_status_idempotency (
  idempotency_key text PRIMARY KEY,
  service_id      uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  result_status   service_status NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE service_status_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ssi_admin_select" ON service_status_idempotency FOR SELECT USING (is_admin_claim());

CREATE OR REPLACE FUNCTION transition_service_status(
  p_service_id     uuid,
  p_to_status      service_status,
  p_actor          text,
  p_idempotency_key text DEFAULT NULL,
  p_block_if_pending boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old service_status;
  v_existing_result service_status;
BEGIN
  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_status INTO v_existing_result
      FROM service_status_idempotency WHERE idempotency_key = p_idempotency_key;
    IF v_existing_result IS NOT NULL THEN
      RETURN jsonb_build_object('replayed', true, 'status', v_existing_result);
    END IF;
  END IF;

  SELECT status INTO v_old FROM service_requests WHERE id = p_service_id FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'service_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- AC #11: ignora silenciosamente em estado terminal
  IF v_old IN ('cancelled_by_client','cancelled_by_provider','cancelled_by_admin',
               'expired','completed') AND p_actor = 'system' THEN
    RETURN jsonb_build_object('skipped', true, 'reason','terminal_state', 'status', v_old);
  END IF;

  -- AC #12: bloqueia se há pendência aberta paralela (só pra transições incompatíveis)
  IF p_block_if_pending AND has_open_pending_state(p_service_id)
     AND p_to_status NOT IN ('pending_adjustment','pending_materials','awaiting_client_present',
                             'in_progress','cancelled_by_admin','cancelled_by_client','cancelled_by_provider') THEN
    RAISE EXCEPTION 'pending_state_must_resolve_first' USING ERRCODE = 'lock_not_available';
  END IF;

  IF NOT validate_status_transition(v_old, p_to_status, p_actor) THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = 'check_violation';
  END IF;

  -- Set GUCs pra trigger registrar event com actor correto
  PERFORM set_config('app.fsm_actor', p_actor, true);
  PERFORM set_config('app.fsm_actor_user', COALESCE(auth.uid()::text, ''), true);
  PERFORM set_config('app.fsm_idem', COALESCE(p_idempotency_key, ''), true);

  UPDATE service_requests SET status = p_to_status, "updatedAt" = NOW()
   WHERE id = p_service_id;
  -- (trigger T-227 emite service_event automaticamente)

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO service_status_idempotency(idempotency_key, service_id, result_status)
    VALUES (p_idempotency_key, p_service_id, p_to_status);
  END IF;

  RETURN jsonb_build_object('replayed', false, 'status', p_to_status);
END $$;

COMMIT;
```

### Endpoints consumidores (não cria aqui, mas mapeia)
- `POST /api/services/[id]/cancel` (US-011)
- `POST /api/services/[id]/accept` (US-004)
- `POST /api/services/[id]/start` (US-005)
- Edge Function `lifecycle-tick` (T-234)

## Constraints / NÃO fazer
- ❌ Função sem SECURITY DEFINER (pode falhar por RLS)
- ❌ Esquecer FOR UPDATE (race em UPDATE concorrente — AC implícito de #9)
- ❌ Não checar idempotency_key (mesma key 2x deveria retornar replayed=true sem efeito colateral)
- ❌ Idempotency com TTL infinito sem cleanup (job de limpeza recomendado)
- ❌ Não mapear códigos SQLSTATE pra HTTP status nos route handlers consumidores

## Convenções
- Migration via psql
- Reuso `validate_status_transition` (T-225), `has_open_pending_state` (T-228)
- Pattern "RPC + Idempotency-Key + 409 com payload" (memory generalization da US-016/US-017)
- Smoke: replayed=true em chamada repetida; pending bloqueia transição não-relacionada com 409
$desc$,
 'API', 'SISTEMA', ARRAY['NO_RLS_NEEDED','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-236 API — Edge Function emit-stale-execution-alert (AC #13)
-- ----------------------------------------------------------------------------
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-236',
 'Implementar Edge Function emit-stale-execution-alert (detecção de in_progress > 24h)',
 $desc$## Objetivo
Função que detecta serviços em `in_progress` (ou pendência aberta) parados há mais de 24h sem atualização e gera 1 `admin_alert` por serviço (idempotente: não duplica se já houver alerta aberto pra mesmo target_id). Cobre AC #13. NÃO aplica transição automática — apenas alerta.

## Contexto
Módulo ADMIN. Chamada por pg_cron a cada 30min (T-233). Reusa tabela `admin_alerts` (US-016 T-190). Idempotência: query usa `WHERE NOT EXISTS (alert open)`.

## Estado atual / O que substitui
Não existe — operação não tem visibilidade de execuções travadas.

## O que criar

### `supabase/functions/emit-stale-execution-alert/index.ts`
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  // RPC dedicada (evita lógica em TS)
  const { data, error } = await supabase.rpc('emit_stale_execution_alerts');
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true, alerts_emitted: data });
});
```

### RPC (em mesma migration de T-236)
```sql
CREATE OR REPLACE FUNCTION emit_stale_execution_alerts()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0;
BEGIN
  WITH stale AS (
    SELECT sr.id, sr.client_id, sr.provider_id, sr."updatedAt"
      FROM service_requests sr
     WHERE sr.status IN ('in_progress','awaiting_client_present',
                         'pending_adjustment','pending_materials')
       AND sr."updatedAt" < NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM admin_alerts a
          WHERE a.kind = 'service_stale_execution'
            AND (a.payload->>'service_id')::uuid = sr.id
            AND a.dismissed_at IS NULL
       )
  ), inserted AS (
    INSERT INTO admin_alerts (kind, severity, payload)
    SELECT 'service_stale_execution', 'medium',
           jsonb_build_object('service_id', s.id, 'client_id', s.client_id,
                              'provider_id', s.provider_id, 'last_update', s."updatedAt")
      FROM stale s
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END $$;
```

## Constraints / NÃO fazer
- ❌ Aplicar transição automática (AC #13: equipe decide caso a caso)
- ❌ Emitir alerta múltiplo pra mesmo serviço (idempotente via NOT EXISTS)
- ❌ Bloquear chamada concorrente — RPC é stateless, NOT EXISTS é racy mas tolerável (admin_alert tem dedup adicional opcional)
- ❌ Severity "high" (AC #13 implícito: medium — operação decide; reservar high pra falhas críticas)

## Convenções
- Reuso `admin_alerts` (US-016 T-190) — alimenta dashboard admin
- Pattern Edge Function chamada por pg_cron (T-233)
- Endpoint NÃO público — service_role only
$desc$,
 'API', 'SISTEMA', ARRAY['NO_RLS_NEEDED','SECRET_HANDLING','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-237 OPS — seed app_config com prazos do ciclo de vida
-- ----------------------------------------------------------------------------
('da90d674-2c73-4551-b91c-e808b3e732a3', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'd6bb70f1-7472-4765-b9f2-d7c589a7e040',
 'ZLAR-V2-T-237',
 'Seedar app_config com prazos do ciclo (aceite tácito, escrow 70/30, garantia, stale)',
 $desc$## Objetivo
Centralizar prazos do ciclo de vida em `app_config` (US-019) — admin pode ajustar sem deploy. Chaves: `tacit_acceptance_hours`, `escrow_release_partial_hours`, `escrow_release_final_days`, `warranty_window_days`, `stale_execution_alert_hours`, `job_max_retries`, `job_retry_backoff_base_seconds`. Cobre AC #11 e #14 (configuração).

## Contexto
Módulo ADMIN/OPS. `app_config` criada em US-019 (T-216 estendida). Pattern de seed cross-US idêntico ao US-016 T-203 e US-017 T-214.

## Estado atual / O que substitui
Hoje os prazos estão hardcoded no snippet da T-233/T-234. Externalizar permite ajuste rápido sem migration.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_lifecycle_app_config.sql`
```sql
BEGIN;

INSERT INTO app_config (key, value, description, section, critical, value_schema, unit) VALUES
  ('lifecycle_tacit_acceptance_hours', '48'::jsonb,
   'Horas após completed_by_provider para aceite tácito do cliente',
   'lifecycle', true,
   '{"type":"integer","minimum":24,"maximum":168}'::jsonb, 'hours'),
  ('lifecycle_escrow_release_partial_hours', '72'::jsonb,
   'Horas após completed para liberar 70% do escrow ao prestador',
   'lifecycle', true,
   '{"type":"integer","minimum":24,"maximum":336}'::jsonb, 'hours'),
  ('lifecycle_escrow_release_final_days', '30'::jsonb,
   'Dias após completed para liberar 30% restantes (fim da janela de garantia)',
   'lifecycle', true,
   '{"type":"integer","minimum":7,"maximum":90}'::jsonb, 'days'),
  ('lifecycle_warranty_window_days', '30'::jsonb,
   'Dias durante os quais cliente pode abrir disputa por defeito de obra',
   'lifecycle', true,
   '{"type":"integer","minimum":7,"maximum":180}'::jsonb, 'days'),
  ('lifecycle_stale_execution_alert_hours', '24'::jsonb,
   'Horas sem atualização em in_progress para emitir admin_alert',
   'lifecycle', false,
   '{"type":"integer","minimum":6,"maximum":72}'::jsonb, 'hours'),
  ('job_max_retries', '5'::jsonb,
   'Tentativas máximas antes de marcar job como aborted e alertar',
   'jobs', false,
   '{"type":"integer","minimum":1,"maximum":10}'::jsonb, 'attempts'),
  ('job_retry_backoff_base_seconds', '30'::jsonb,
   'Segundos base do backoff exponencial (4^n * base)',
   'jobs', false,
   '{"type":"integer","minimum":10,"maximum":300}'::jsonb, 'seconds')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description,
      section     = EXCLUDED.section,
      critical    = EXCLUDED.critical,
      value_schema= EXCLUDED.value_schema,
      unit        = EXCLUDED.unit;
-- value preservado em conflito (não sobrescrever ajustes do admin)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Sobrescrever `value` em ON CONFLICT (memory generalization: preservar value, atualizar metadata)
- ❌ `critical=false` em prazos financeiros (escrow, garantia) — admin precisa ack via UI da US-019
- ❌ Esquecer `value_schema` (validate_app_config_value valida via essa coluna)
- ❌ Acoplar consumo a literais TS no código (sempre ler de app_config via cache)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Reuso `app_config` (US-019 T-216), `apply_config_change` (US-019 T-217), `preview_config_impact` (T-219)
- Pattern seed cross-US idêntico a T-064/T-203/T-214 (memory generalization)
- Smoke: SELECT * FROM app_config WHERE section='lifecycle' retorna 5 chaves
$desc$,
 'OPS', 'SISTEMA', ARRAY['NO_RLS_NEEDED','AUDIT_LOG'], 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())

;

-- ============================================================================
-- 2. TaskAcceptanceCriterion — vincula tasks aos AC-da-Story que cobrem
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT v.task_id, ac.id
FROM (VALUES
  -- T-225 enum + validate_status_transition: AC #9
  ('49111483-efe7-47c1-8971-a878476a6869'::uuid, 9),

  -- T-226 service_events: AC #10, #9 (registra tentativas inválidas)
  ('01d74a0e-e2e8-41e7-865b-24cd88afe842'::uuid, 9),
  ('01d74a0e-e2e8-41e7-865b-24cd88afe842'::uuid, 10),

  -- T-227 trigger FSM: AC #9 (manipulação direta), #10
  ('bc5da0cf-88a9-4337-a529-fbab6fe2dc20'::uuid, 9),
  ('bc5da0cf-88a9-4337-a529-fbab6fe2dc20'::uuid, 10),

  -- T-228 helpers: AC #3, #4
  ('04b40b24-88d5-4175-a623-6a628ad99bca'::uuid, 3),
  ('04b40b24-88d5-4175-a623-6a628ad99bca'::uuid, 4),

  -- T-229 RLS service_requests: AC #1, #2, #3, #4
  ('a17fe01c-5b93-474a-9cbd-9f9d30263a95'::uuid, 1),
  ('a17fe01c-5b93-474a-9cbd-9f9d30263a95'::uuid, 2),
  ('a17fe01c-5b93-474a-9cbd-9f9d30263a95'::uuid, 3),
  ('a17fe01c-5b93-474a-9cbd-9f9d30263a95'::uuid, 4),

  -- T-230 RLS suite (ratings/payments/wallets/profiles): AC #1, #5, #6, #7, #8
  ('0a269c43-db9d-425b-82c5-e6b77a2a02b3'::uuid, 1),
  ('0a269c43-db9d-425b-82c5-e6b77a2a02b3'::uuid, 5),
  ('0a269c43-db9d-425b-82c5-e6b77a2a02b3'::uuid, 6),
  ('0a269c43-db9d-425b-82c5-e6b77a2a02b3'::uuid, 7),
  ('0a269c43-db9d-425b-82c5-e6b77a2a02b3'::uuid, 8),

  -- T-231 service_pending_states: AC #12
  ('0ba219ca-db6d-445f-90c0-9a2fd8e03adf'::uuid, 12),

  -- T-232 job_run_log + retry: AC #14
  ('b45ce68b-98ff-4b2b-9414-4c012375b928'::uuid, 14),

  -- T-233 pg_cron lifecycle: AC #11, #13, #14
  ('726747db-a08a-43fb-870c-6501e99426c1'::uuid, 11),
  ('726747db-a08a-43fb-870c-6501e99426c1'::uuid, 13),
  ('726747db-a08a-43fb-870c-6501e99426c1'::uuid, 14),

  -- T-234 lifecycle-tick: AC #11, #14
  ('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd'::uuid, 11),
  ('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd'::uuid, 14),

  -- T-235 transition_service_status: AC #9, #10, #12, #11
  ('20204d49-33fa-4c8a-9a05-83fa88129012'::uuid, 9),
  ('20204d49-33fa-4c8a-9a05-83fa88129012'::uuid, 10),
  ('20204d49-33fa-4c8a-9a05-83fa88129012'::uuid, 11),
  ('20204d49-33fa-4c8a-9a05-83fa88129012'::uuid, 12),

  -- T-236 emit-stale-execution-alert: AC #13
  ('eb7914d2-fc26-4dd9-941b-c780f24a5c2a'::uuid, 13),

  -- T-237 seed app_config lifecycle: AC #11, #14
  ('da90d674-2c73-4551-b91c-e808b3e732a3'::uuid, 11),
  ('da90d674-2c73-4551-b91c-e808b3e732a3'::uuid, 14)

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
-- T-225 enum + validate_status_transition + catálogo
('49111483-efe7-47c1-8971-a878476a6869', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('49111483-efe7-47c1-8971-a878476a6869', 'Enum service_status criado com 19 valores e ordem do ciclo de vida', 1),
('49111483-efe7-47c1-8971-a878476a6869', 'Tabela service_status_transitions criada com 32 linhas seedadas (PK composta)', 2),
('49111483-efe7-47c1-8971-a878476a6869', 'Função validate_status_transition é STABLE e SECURITY INVOKER (catálogo já é RLS-public-read)', 3),
('49111483-efe7-47c1-8971-a878476a6869', 'ALTER TYPE em service_requests.status preserva dados existentes (ou tabela vazia em prod)', 4),
('49111483-efe7-47c1-8971-a878476a6869', 'Smoke: validate_status_transition(draft, awaiting_payment, client) → true; (draft, completed, client) → false', 5),
('49111483-efe7-47c1-8971-a878476a6869', 'RLS de leitura authenticated em service_status_transitions; sem INSERT/UPDATE/DELETE permitido', 6),

-- T-226 service_events
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'Tabela service_events criada com FK service_id ON DELETE RESTRICT', 1),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'Triggers bloqueiam UPDATE/DELETE (smoke: tentativa retorna exception)', 2),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'RLS: ADMIN lê tudo; CLIENTE/PRESTADOR leem apenas events de serviços onde são parte', 3),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'INSERT direto via authenticated revogado (REVOKE INSERT vigente)', 4),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'Indexes (service_id, kind, actor_user_id) presentes (EXPLAIN ANALYZE confirma)', 5),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', 'Smoke: INSERT via service_role + SELECT por cliente próprio retorna 1; cliente alheio retorna 0', 6),

-- T-227 trigger FSM
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'Migration aplicada via psql', 0),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'Trigger BEFORE UPDATE OF status em service_requests presente e habilitado', 1),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'Função enforce_service_status_transition é SECURITY DEFINER com search_path=public', 2),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'GUC app.fsm_actor lido via current_setting com fallback "system"', 3),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'Smoke: UPDATE direto sem GUC para transição válida pra system → passa', 4),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'Smoke: UPDATE direto pra transição inválida → exception ERRCODE check_violation', 5),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'Tentativas inválidas geram service_event kind=invalid_transition_attempt antes do RAISE', 6),

-- T-228 helpers
('04b40b24-88d5-4175-a623-6a628ad99bca', 'Migration aplicada via psql', 0),
('04b40b24-88d5-4175-a623-6a628ad99bca', 'is_provider_active retorna true para provider active+kyc_approved; false para suspended', 1),
('04b40b24-88d5-4175-a623-6a628ad99bca', 'provider_can_view_service retorna true para alocado E para pool durante broadcasting', 2),
('04b40b24-88d5-4175-a623-6a628ad99bca', 'has_open_pending_state retorna true se existe linha resolved_at IS NULL para o serviço', 3),
('04b40b24-88d5-4175-a623-6a628ad99bca', 'Funções marcadas STABLE SECURITY DEFINER com search_path=public', 4),
('04b40b24-88d5-4175-a623-6a628ad99bca', 'is_admin_claim retorna true quando jwt app_metadata.role = admin', 5),
('04b40b24-88d5-4175-a623-6a628ad99bca', 'Smoke: provider suspenso vê 0 linhas em service_requests via SELECT como auth', 6),

-- T-229 RLS service_requests
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'Migration aplicada via psql', 0),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'Policies antigas DROP IF EXISTS antes do CREATE (idempotência)', 1),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'CLIENTE INSERT exige status=draft AND provider_id IS NULL (smoke: INSERT awaiting_payment falha)', 2),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'PRESTADOR não consegue INSERT (sem policy permissiva): smoke com JWT prestador retorna 403', 3),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'CLIENTE A não vê serviços do CLIENTE B (smoke: SELECT count = 0)', 4),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'PRESTADOR vê serviços alocados E serviços broadcasting onde está no pool (provider_can_view_service)', 5),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'PRESTADOR não pode self-assign (UPDATE provider_id de NULL → uid bloqueado por WITH CHECK)', 6),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'ADMIN com claim app_metadata.role=admin lê e edita tudo (sr_admin_all)', 7),
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', 'WITH CHECK por estado: cliente NÃO consegue UPDATE de service em status=in_progress', 8),

-- T-230 RLS suite
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'Migration aplicada via psql', 0),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'ratings INSERT exige sr.status=completed AND sr.client_id=auth.uid (smoke: INSERT em queued falha)', 1),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'PRESTADOR não consegue INSERT em ratings (sem policy)', 2),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'provider_profiles UPDATE de account_status por self bloqueado (admin-only via trigger ou policy split)', 3),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'CLIENTE não vê provider_payouts de prestador alheio (smoke: count=0)', 4),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'PRESTADOR não vê provider_payouts de outro prestador (smoke: count=0)', 5),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'ADMIN com claim lê todos pagamentos, payouts, profiles', 6),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'CLIENTE lê apenas próprias payments (via JOIN com service_requests)', 7),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', 'Cobertura: dispute/suspension/refund tabelas ADMIN-only confirmadas (sem policy permissiva)', 8),

-- T-231 service_pending_states
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'Enum service_pending_kind criado com 3 valores', 1),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'Tabela service_pending_states criada com FK e CHECK em resolution', 2),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'Partial UNIQUE INDEX (service_id) WHERE resolved_at IS NULL ativo', 3),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'Smoke: 2 INSERTs com mesmo service_id e resolved_at NULL → segundo falha (unique_violation)', 4),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'open_service_pending_state lança 409 (unique_violation) se já há pendência aberta', 5),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'resolve_service_pending_state lança no_data_found em pendência inexistente ou já resolvida', 6),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'Open/resolve emitem service_event kind=pending_state_opened/resolved', 7),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'RLS: ADMIN tudo; partes leem apenas pendências de serviços onde são parte', 8),

-- T-232 job_run_log + retry
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'Migration aplicada via psql', 0),
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'Tabela job_run_log criada com CHECK status e indexes (job, status partial, target)', 1),
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'schedule_job_retry calcula backoff exponencial 4^n * base_seconds (smoke: 30s, 2m, 8m, 30m, 2h)', 2),
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'Ao atingir max_attempts: status=aborted + admin_alert kind=job_retry_exhausted severity=high', 3),
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'RLS: ADMIN lê; INSERT/UPDATE só via SECURITY DEFINER ou service_role', 4),
('b45ce68b-98ff-4b2b-9414-4c012375b928', 'Smoke: schedule_job_retry com attempt=5 e max=5 emite admin_alert e marca aborted', 5),

-- T-233 pg_cron lifecycle
('726747db-a08a-43fb-870c-6501e99426c1', 'Migration aplicada via psql; cron jobs criados', 0),
('726747db-a08a-43fb-870c-6501e99426c1', '6 jobs criados: tacit_acceptance, escrow_70, escrow_30_final, warranty_expiration, stale_execution_detect, retry_failed_jobs', 1),
('726747db-a08a-43fb-870c-6501e99426c1', 'Job lifecycle_cleanup_job_log diário às 03:00 deleta job_run_log >90d com status success/aborted', 2),
('726747db-a08a-43fb-870c-6501e99426c1', 'app.edge_url e app.service_role_key configurados via ALTER DATABASE SET (não em texto claro no SQL)', 3),
('726747db-a08a-43fb-870c-6501e99426c1', 'Cada cron.schedule retorna jobid > 0; cron.job lista as 7 entradas', 4),
('726747db-a08a-43fb-870c-6501e99426c1', 'Coordenação com US-028 T-126/T-127 documentada — sem duplicação', 5),
('726747db-a08a-43fb-870c-6501e99426c1', 'Smoke: SELECT * FROM cron.job_run_details onde jobname LIKE lifecycle_% mostra start_time recente', 6),

-- T-234 lifecycle-tick
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Edge Function deployada em supabase/functions/lifecycle-tick', 0),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Whitelist de jobs: tacit_acceptance, escrow_partial_70, escrow_final_30, warranty_expiration, retry_failed', 1),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', '400 unknown_job para job fora da whitelist', 2),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Cada handler é idempotente: verifica estado via RPC list_*; falha individual agenda retry sem abortar batch', 3),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Smoke: invocar com {job: tacit_acceptance} retorna {ok:true, processed, failed}', 4),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Service role usado apenas server-side; chave em Deno.env (nunca no body)', 5),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Logs estruturados {job, processed, failed} no console por execução', 6),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'Falhas individuais chamam schedule_job_retry com target_id e error message', 7),

-- T-235 transition_service_status
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Migration aplicada via psql', 0),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Tabela service_status_idempotency criada com PK em idempotency_key', 1),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'RPC SECURITY DEFINER com search_path=public e FOR UPDATE em service_requests', 2),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Idempotência: mesma key 2x retorna {replayed:true, status} sem efeito colateral (smoke)', 3),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Estado terminal (cancelled/completed/expired) com actor=system retorna skipped sem RAISE', 4),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Pendência aberta + transição não-relacionada: RAISE ERRCODE lock_not_available (mapeia 409)', 5),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Transição inválida: RAISE ERRCODE check_violation (mapeia 409)', 6),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'set_config app.fsm_actor / app.fsm_actor_user / app.fsm_idem em transação local (true)', 7),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'Smoke: caller com actor=client e to=on_the_way (apenas provider) → check_violation', 8),

-- T-236 emit-stale-execution-alert
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'Edge Function deployada em supabase/functions/emit-stale-execution-alert', 0),
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'RPC emit_stale_execution_alerts cria 1 alert por serviço stale via NOT EXISTS (idempotente)', 1),
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'Window: 24h (lê de app_config lifecycle_stale_execution_alert_hours)', 2),
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'Não aplica transição automática (apenas alert)', 3),
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'severity=medium em admin_alerts.kind=service_stale_execution', 4),
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'Smoke: serviço com updated_at < NOW()-25h em in_progress gera 1 alert; segunda execução não duplica', 5),
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'Endpoint só por service_role (verificar header Authorization)', 6),

-- T-237 seed app_config lifecycle
('da90d674-2c73-4551-b91c-e808b3e732a3', 'Migration aplicada via psql', 0),
('da90d674-2c73-4551-b91c-e808b3e732a3', '7 chaves seedadas: tacit_acceptance_hours, escrow_release_partial_hours, escrow_release_final_days, warranty_window_days, stale_execution_alert_hours, job_max_retries, job_retry_backoff_base_seconds', 1),
('da90d674-2c73-4551-b91c-e808b3e732a3', 'critical=true em prazos financeiros (escrow, garantia, tacit) — admin precisa ack via UI da US-019', 2),
('da90d674-2c73-4551-b91c-e808b3e732a3', 'value_schema jsonb com type/min/max preenchidos em todas as chaves', 3),
('da90d674-2c73-4551-b91c-e808b3e732a3', 'ON CONFLICT DO UPDATE preserva value, atualiza description/section/critical/value_schema/unit', 4),
('da90d674-2c73-4551-b91c-e808b3e732a3', 'Smoke: SELECT key, value FROM app_config WHERE section=lifecycle retorna 5 linhas', 5),
('da90d674-2c73-4551-b91c-e808b3e732a3', 'Smoke: SELECT * FROM app_config WHERE section=jobs retorna 2 linhas', 6);

-- ============================================================================
-- 4. TaskDependency
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- Intra-US blocks
-- T-226 (service_events) depende de T-225 (enum service_status — usa em colunas)
('01d74a0e-e2e8-41e7-865b-24cd88afe842', '49111483-efe7-47c1-8971-a878476a6869', 'blocks'),

-- T-227 (trigger FSM) depende de T-225 (validate_status_transition) e T-226 (service_events INSERT)
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', '49111483-efe7-47c1-8971-a878476a6869', 'blocks'),
('bc5da0cf-88a9-4337-a529-fbab6fe2dc20', '01d74a0e-e2e8-41e7-865b-24cd88afe842', 'blocks'),

-- T-228 (helpers) depende de T-225 (referencia service_status no helper opcional) — relates_to é o suficiente
('04b40b24-88d5-4175-a623-6a628ad99bca', '49111483-efe7-47c1-8971-a878476a6869', 'relates_to'),

-- T-229 (RLS service_requests) depende de T-228 (helpers usados em policies)
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', '04b40b24-88d5-4175-a623-6a628ad99bca', 'blocks'),

-- T-230 (RLS suite) depende de T-228 (is_admin_claim) e T-225 (referencia service_status em ratings policy)
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', '04b40b24-88d5-4175-a623-6a628ad99bca', 'blocks'),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', '49111483-efe7-47c1-8971-a878476a6869', 'blocks'),

-- T-231 (pending states) depende de T-226 (service_events) e T-228 (has_open_pending_state)
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', '01d74a0e-e2e8-41e7-865b-24cd88afe842', 'blocks'),
('0ba219ca-db6d-445f-90c0-9a2fd8e03adf', '04b40b24-88d5-4175-a623-6a628ad99bca', 'blocks'),

-- T-232 (job_run_log + retry) depende de T-228 (is_admin_claim em RLS)
('b45ce68b-98ff-4b2b-9414-4c012375b928', '04b40b24-88d5-4175-a623-6a628ad99bca', 'blocks'),

-- T-233 (pg_cron) depende de T-234 (Edge Function precisa estar deployada antes do schedule chamá-la)
('726747db-a08a-43fb-870c-6501e99426c1', '9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'blocks'),
('726747db-a08a-43fb-870c-6501e99426c1', 'eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'blocks'),
('726747db-a08a-43fb-870c-6501e99426c1', 'da90d674-2c73-4551-b91c-e808b3e732a3', 'blocks'),

-- T-234 (lifecycle-tick) depende de T-235 (RPC transition_service_status) e T-232 (schedule_job_retry)
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', '20204d49-33fa-4c8a-9a05-83fa88129012', 'blocks'),
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', 'b45ce68b-98ff-4b2b-9414-4c012375b928', 'blocks'),

-- T-235 (RPC transition) depende de T-225 (validate), T-227 (trigger emite events), T-231 (has_open_pending)
('20204d49-33fa-4c8a-9a05-83fa88129012', '49111483-efe7-47c1-8971-a878476a6869', 'blocks'),
('20204d49-33fa-4c8a-9a05-83fa88129012', 'bc5da0cf-88a9-4337-a529-fbab6fe2dc20', 'blocks'),
('20204d49-33fa-4c8a-9a05-83fa88129012', '0ba219ca-db6d-445f-90c0-9a2fd8e03adf', 'blocks'),

-- T-236 (stale alert) depende de T-237 (lê app_config) — relates_to (default fallback existe no snippet)
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', 'da90d674-2c73-4551-b91c-e808b3e732a3', 'relates_to'),

-- Cross-US relates_to (generalizations + reuso)
-- T-225 ↔ service_requests US-011 (ALTER TYPE em coluna existente)
('49111483-efe7-47c1-8971-a878476a6869', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to'),

-- T-226 service_events ↔ provider_moderation_log (US-017) e dispute_decisions (US-026) — pattern audit log imutável
('01d74a0e-e2e8-41e7-865b-24cd88afe842', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-204'), 'relates_to'),
('01d74a0e-e2e8-41e7-865b-24cd88afe842', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-155'), 'relates_to'),

-- T-229 RLS service_requests ↔ T-070 (substitui policies provisórias)
('a17fe01c-5b93-474a-9cbd-9f9d30263a95', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to'),

-- T-230 RLS suite ↔ provider_payouts (T-124), payments (T-071)
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-071'), 'relates_to'),
('0a269c43-db9d-425b-82c5-e6b77a2a02b3', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-124'), 'relates_to'),

-- T-232 ↔ admin_alerts (US-016 T-190) — generalization "alerta admin via INSERT genérico"
('b45ce68b-98ff-4b2b-9414-4c012375b928', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-190'), 'relates_to'),

-- T-233 pg_cron ↔ pattern de pg_cron (US-016 T-203, US-022 T-165, US-028 T-126)
('726747db-a08a-43fb-870c-6501e99426c1', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-203'), 'relates_to'),
('726747db-a08a-43fb-870c-6501e99426c1', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-165'), 'relates_to'),
('726747db-a08a-43fb-870c-6501e99426c1', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-126'), 'relates_to'),
('726747db-a08a-43fb-870c-6501e99426c1', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-127'), 'relates_to'),

-- T-234 lifecycle-tick ↔ enqueue_notification_event (US-022 T-162) — handlers podem enfileirar notificações
('9c75a0d3-22ee-450d-b58b-ee81cd2a04fd', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),

-- T-235 ↔ apply_config_change pattern (US-019 T-217) — pattern RPC mutation com audit
('20204d49-33fa-4c8a-9a05-83fa88129012', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-217'), 'relates_to'),

-- T-236 stale alert ↔ admin_alerts (US-016 T-190)
('eb7914d2-fc26-4dd9-941b-c780f24a5c2a', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-190'), 'relates_to'),

-- T-237 seed app_config ↔ pattern seed cross-US (US-016 T-203, US-017 T-214, US-026 T-158, US-010 T-064)
('da90d674-2c73-4551-b91c-e808b3e732a3', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-203'), 'relates_to'),
('da90d674-2c73-4551-b91c-e808b3e732a3', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-064'), 'relates_to'),
('da90d674-2c73-4551-b91c-e808b3e732a3', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-158'), 'relates_to'),
('da90d674-2c73-4551-b91c-e808b3e732a3', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-216'), 'relates_to');

COMMIT;
