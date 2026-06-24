-- Zelar v2 — Backlog SQL: ZLAR-V2-US-006 (PRESTADOR lida com situacoes atipicas durante execucao)
-- Modulo: EXECUCAO | Persona: PRESTADOR | AC: 13
-- Apenas insere metadata em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). NAO executa DDL de produto.

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ============================================================================
-- DATA layer
-- ============================================================================

-- T-285 DATA: tabela base service_atypical_events (audit log + indice)
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-285', 'Criar enum atypical_event_kind + tabela service_atypical_events (audit append-only)',
 $desc$## Objetivo
Tabela `service_atypical_events` centraliza qualquer evento atipico durante execucao (diagnostico diferente, material, retorno, adicional, ausencia, inatividade, no-show). Audit append-only com FK para a entidade especializada (scope_change/material/revisit/additional/absence). Cobre transversalmente AC #1, #3, #5, #7, #9, #10, #11.

## Contexto
Modulo EXECUCAO. Padrao similar ao `service_events` (T-226) mas dedicado aos eventos atipicos do AC, com payload tipado por `kind` e FK opcional para a tabela filha. Permite UI listar timeline de pendencias do servico ("Voce tem 1 reajuste pendente, 1 retorno proposto") e cron varrer eventos sem closure (T-298 para no-show; T-297 para inatividade).

## Estado atual / O que substitui
Nao existe. Substitui campos ad-hoc que poderiam ser adicionados em service_events; manter separado deixa service_events focado em transicoes FSM puras (T-226/T-227).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_atypical_events.sql`
```sql
BEGIN;

CREATE TYPE atypical_event_kind AS ENUM (
  'scope_change_proposed', 'scope_change_approved', 'scope_change_rejected', 'scope_change_expired',
  'material_proposed', 'material_approved', 'material_rejected', 'material_invoiced',
  'revisit_proposed', 'revisit_approved', 'revisit_rejected',
  'additional_registered', 'additional_redirected_new_request',
  'client_absent_started', 'client_absent_confirmed',
  'provider_inactivity_alert', 'provider_inactivity_client_decided',
  'provider_noshow_detected', 'provider_noshow_realloc'
);

CREATE TABLE service_atypical_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id   uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  kind                 atypical_event_kind NOT NULL,
  actor_id             uuid REFERENCES auth.users(id),  -- NULL para SISTEMA
  related_entity_table text,                            -- 'service_scope_changes' | 'service_material_requests' | ...
  related_entity_id    uuid,                            -- FK logica para a tabela filha
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_atypical_events_service ON service_atypical_events(service_request_id, "createdAt" DESC);
CREATE INDEX idx_atypical_events_kind ON service_atypical_events(kind, "createdAt" DESC);

ALTER TABLE service_atypical_events ENABLE ROW LEVEL SECURITY;

-- CLIENTE/PRESTADOR alocados leem; ADMIN tudo. SOMENTE service_role escreve.
CREATE POLICY "atypical_events_select_parties" ON service_atypical_events FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM service_requests
      WHERE client_id = auth.uid() OR provider_id = auth.uid()
    )
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- INSERT/UPDATE/DELETE: nenhum role do client. Append-only via service_role (RPCs SECURITY DEFINER).
COMMIT;
```

## Constraints / NAO fazer
- Permitir UPDATE/DELETE via RLS — append-only sempre
- Mover transicao FSM padrao para esta tabela (continuam em service_events T-226)
- Bloquear leitura para ADMIN (precisa pra dashboard)

## Convencoes
- `kind` em snake_case com prefixo da entidade (`scope_change_*`, `material_*`)
- `payload` jsonb sem schema fixo (cada kind documenta seu shape em T-285 description)
- Indices por (service_request_id, createdAt DESC) para timeline e por kind para varreduras de cron$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','AUDIT_LOG','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-286 DATA: service_scope_changes (diagnostico diferente)
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-286', 'Criar service_scope_changes (diagnostico diferente: foto + valor sugerido + 15min decisao)',
 $desc$## Objetivo
Tabela que armazena propostas de "diagnostico diferente" do PRESTADOR ao chegar e identificar problema real distinto do descrito. Inclui descricao, foto obrigatoria, novo escopo, novo valor (validado contra faixa da categoria) e prazo de 15 minutos para decisao do CLIENTE. Cobre AC #1, #2.

## Contexto
Modulo EXECUCAO. PRESTADOR cria a proposta (status=`pending_client_review`); aciona um `service_pending_states` (T-231) para travar transicao para `in_progress` ate decisao. Cliente aprova/rejeita via UI cliente (T-303). Se aprovada, escopo e valor sao atualizados no `service_requests` (campos snapshot na propria scope_change, nao mexe no SR ate decisao). Se expirada (>15min sem decisao), policy de fallback: prestador executa o original (AC #2).

## Estado atual / O que substitui
Nao existe. Hoje nao ha mecanismo formal de reajuste de escopo durante execucao.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_scope_changes.sql`
```sql
BEGIN;

CREATE TYPE scope_change_status AS ENUM ('pending_client_review','approved','rejected','expired');

CREATE TABLE service_scope_changes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  proposed_by        uuid NOT NULL REFERENCES auth.users(id),  -- provider_id
  description        text NOT NULL CHECK (length(description) BETWEEN 10 AND 1000),
  photo_path         text NOT NULL,                            -- Storage bucket service-photos/scope-changes/{sr_id}/{uuid}.jpg
  new_scope          text NOT NULL,
  new_value_cents    integer NOT NULL CHECK (new_value_cents > 0),
  category_min_cents integer NOT NULL,                         -- snapshot da faixa da categoria no momento
  category_max_cents integer NOT NULL,
  status             scope_change_status NOT NULL DEFAULT 'pending_client_review',
  decided_at         timestamptz,
  decided_by         uuid REFERENCES auth.users(id),
  expires_at         timestamptz NOT NULL,                     -- created_at + 15min via trigger
  "createdAt"        timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"        timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT scope_value_within_category CHECK (
    new_value_cents BETWEEN category_min_cents AND category_max_cents
  )
);

-- Apenas 1 scope_change pendente por SR (pending_state path)
CREATE UNIQUE INDEX uniq_scope_change_pending ON service_scope_changes(service_request_id)
  WHERE status = 'pending_client_review';

CREATE INDEX idx_scope_change_expires ON service_scope_changes(expires_at)
  WHERE status = 'pending_client_review';

ALTER TABLE service_scope_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scope_change_select_parties" ON service_scope_changes FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM service_requests
      WHERE client_id = auth.uid() OR provider_id = auth.uid()
    )
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
-- INSERT/UPDATE somente via RPC SECURITY DEFINER (T-292)

CREATE TRIGGER scope_change_set_expires
  BEFORE INSERT ON service_scope_changes
  FOR EACH ROW EXECUTE FUNCTION set_expires_at_15min();  -- helper criado em T-285 ou shared

COMMIT;
```

## Constraints / NAO fazer
- Permitir UPDATE direto pelo cliente — decisao via RPC com transicao do status
- Atualizar `service_requests` antes da aprovacao (mantem snapshot na propria tabela)
- Permitir multiplas propostas pendentes simultaneas no mesmo SR (unique index)
- Aceitar `new_value_cents` fora da faixa da categoria (CHECK constraint)

## Convencoes
- 15 minutos hardcoded ate config OPS (T-304 vai parametrizar)
- Foto vai pro bucket privado `service-photos/scope-changes/{sr_id}/{uuid}.jpg` (bucket ja em US-005)
- Trigger `set_expires_at_15min` existe? — confirmar; se nao, criar inline$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-287 DATA: service_material_requests + nota fiscal
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-287', 'Criar service_material_requests + bucket service-materials (foto orcamento + NF obrigatoria)',
 $desc$## Objetivo
Tabela para solicitacao de material adicional pelo PRESTADOR durante execucao: item, fornecedor, valor estimado, foto do orcamento. Apos aprovacao do CLIENTE em 15 minutos, PRESTADOR compra e anexa NF; sem NF nao consegue retomar a execucao no app. Cobre AC #3, #4.

## Contexto
Modulo EXECUCAO. Cliente decide via UI (T-303). NF (PDF/imagem) sobe para Storage privado e a `invoice_path` so pode ser preenchida quando `status='approved'`. Tela de "Anexar NF" (T-300) bloqueia botao Retomar execucao ate `invoice_path IS NOT NULL`. Valor da NF passa pra ser somado ao `final_amount_cents` do SR no fechamento (US-005 finaliza com signature).

## Estado atual / O que substitui
Nao existe. Hoje nao ha registro formal de material adicional.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_material_requests.sql`
```sql
BEGIN;

CREATE TYPE material_request_status AS ENUM (
  'pending_client_review','approved','rejected','expired','invoiced'
);

CREATE TABLE service_material_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  proposed_by         uuid NOT NULL REFERENCES auth.users(id),
  item_name           text NOT NULL CHECK (length(item_name) BETWEEN 2 AND 200),
  supplier            text NOT NULL,
  estimated_cents     integer NOT NULL CHECK (estimated_cents > 0),
  quote_photo_path    text NOT NULL,             -- service-materials/quotes/{sr_id}/{uuid}.jpg
  invoice_path        text,                      -- service-materials/invoices/{sr_id}/{uuid}.{pdf|jpg}; preenchida apos compra
  invoice_cents       integer,                   -- valor real cobrado (snapshot da NF)
  status              material_request_status NOT NULL DEFAULT 'pending_client_review',
  decided_at          timestamptz,
  decided_by          uuid REFERENCES auth.users(id),
  invoiced_at         timestamptz,
  expires_at          timestamptz NOT NULL,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_after_approval CHECK (
    invoice_path IS NULL OR status IN ('approved','invoiced')
  )
);

CREATE INDEX idx_material_pending ON service_material_requests(service_request_id, status)
  WHERE status IN ('pending_client_review','approved');

ALTER TABLE service_material_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "material_select_parties" ON service_material_requests FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM service_requests
      WHERE client_id = auth.uid() OR provider_id = auth.uid()
    )
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

COMMIT;
```

### Bucket Storage `service-materials`
- Privado, RLS por path prefix `{sr_id}/` (cliente e prestador alocados leem; outros 403)
- Subpastas `quotes/` e `invoices/`
- Setup OPS em T-304

## Constraints / NAO fazer
- Permitir `invoice_path` antes de `approved` (CHECK constraint)
- Permitir multiplas materials `pending_client_review` simultaneamente do mesmo item (sem dedup; cada item separado)
- Cobrar do cliente sem NF aprovada (regra negocial — agregacao no fechamento US-005)
- Permitir UPDATE direto pelo cliente — decisao via RPC

## Convencoes
- Bucket privado, paths por SR (T-304 OPS configura)
- Status `invoiced` so apos `invoice_path` setada via PATCH dedicado (T-293)
- 15min default ate T-304 parametrizar$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-288 DATA: service_revisits (retorno em outro dia)
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-288', 'Criar service_revisits (retorno tecnico sem custo OU atribuivel ao cliente com taxa)',
 $desc$## Objetivo
Tabela registra retorno em outro dia, com dois sabores: motivo tecnico (massa secar, peca chegar — sem custo adicional) ou atribuivel ao cliente (cliente ausente em parte da execucao, faltou material que cliente forneceria — com taxa de deslocamento). Cobre AC #5, #6.

## Contexto
Modulo EXECUCAO. Cada revisit precisa de aprovacao do CLIENTE (cliente confirma a data ou propoe nova) — workflow similar a scope/material. Diferenca: retorno tecnico nao gera cobranca; atribuivel ao cliente cobra `deslocamento_cents` com aprovacao previa. Quando aprovado, cria evento `revisit_approved` e cliente recebe lembrete via T-161 schedule_notification 24h/2h antes da nova data.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_revisits.sql`
```sql
BEGIN;

CREATE TYPE revisit_attribution AS ENUM ('technical','client_attributable');
CREATE TYPE revisit_status AS ENUM ('pending_client_review','approved','rejected','rescheduled_by_client');

CREATE TABLE service_revisits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  proposed_by         uuid NOT NULL REFERENCES auth.users(id),
  attribution         revisit_attribution NOT NULL,
  reason              text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  proposed_date       date NOT NULL,
  proposed_time_slot  text,                      -- 'manha' | 'tarde' | 'noite' (livre)
  travel_fee_cents    integer NOT NULL DEFAULT 0,-- > 0 obrigatorio se attribution='client_attributable'
  status              revisit_status NOT NULL DEFAULT 'pending_client_review',
  client_proposed_date date,                     -- quando rescheduled_by_client
  decided_at          timestamptz,
  decided_by          uuid REFERENCES auth.users(id),
  expires_at          timestamptz NOT NULL,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT travel_fee_consistency CHECK (
    (attribution = 'technical' AND travel_fee_cents = 0)
    OR (attribution = 'client_attributable' AND travel_fee_cents > 0)
  )
);

CREATE UNIQUE INDEX uniq_revisit_pending ON service_revisits(service_request_id)
  WHERE status = 'pending_client_review';

ALTER TABLE service_revisits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revisit_select_parties" ON service_revisits FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM service_requests
      WHERE client_id = auth.uid() OR provider_id = auth.uid()
    )
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

COMMIT;
```

## Constraints / NAO fazer
- Cobrar deslocamento em `attribution='technical'` (CHECK)
- Permitir 2 revisits pendentes simultaneos no mesmo SR (unique index)
- Iniciar nova execucao na data sem aprovacao do cliente
- Permitir `proposed_date` no passado (CHECK na RPC T-294, nao no schema — mais facil)

## Convencoes
- `travel_fee_cents` snapshot do `app_config.taxa_deslocamento_cents` (T-304) no momento da criacao
- Lembrete 24h/2h via schedule_notification (T-161) no aprovado$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-289 DATA: service_additional_items (servico adicional durante execucao)
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-289', 'Criar service_additional_items + flag para deteccao de especialidade',
 $desc$## Objetivo
Tabela registra servicos adicionais pedidos pelo cliente durante execucao. Se mesma especialidade do prestador alocado (`provider_specialties`), entra na mesma OS apos aprovacao do cliente; se especialidade diferente, sistema redireciona para abrir nova solicitacao. Cobre AC #7, #8.

## Contexto
Modulo EXECUCAO. Linkado com cadastro de especialidades do prestador (provavelmente em `provider_profiles.specialties` ou tabela `provider_specialties` — usar oque existe). Categoria detectada ao registrar via cross-check; campo `same_specialty` boolean armazena resultado. Se `same_specialty=false`, status vai direto para `redirected_new_request` e UI orienta abrir nova SR.

Adicional registrado **apos** execucao (sem fluxo no app) → AC #8: ocorrencia que afeta score. Tratamento via cron (T-298 detecta SR `completed` com queixa do cliente registrando adicional sem entry aqui — alternativa: cliente reporta via UI no historico US-013/T-130). Para esta US, gerar **apenas a tabela** + flag `unregistered_complaint` para alimentar score depois.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_additional_items.sql`
```sql
BEGIN;

CREATE TYPE additional_item_status AS ENUM (
  'pending_client_approval','approved','rejected','redirected_new_request'
);

CREATE TABLE service_additional_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  proposed_by         uuid NOT NULL REFERENCES auth.users(id),  -- prestador (registra pedido do cliente)
  description         text NOT NULL CHECK (length(description) BETWEEN 5 AND 500),
  estimated_cents     integer NOT NULL CHECK (estimated_cents > 0),
  detected_category_slug text NOT NULL,                          -- categoria/subcategoria detectada
  same_specialty      boolean NOT NULL,                          -- true: provider atende; false: redirect
  status              additional_item_status NOT NULL DEFAULT 'pending_client_approval',
  redirect_target_request_id uuid REFERENCES service_requests(id),-- nova SR criada quando especialidade diferente
  decided_at          timestamptz,
  decided_by          uuid REFERENCES auth.users(id),
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_additional_pending ON service_additional_items(service_request_id, status)
  WHERE status = 'pending_client_approval';

ALTER TABLE service_additional_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "additional_select_parties" ON service_additional_items FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM service_requests
      WHERE client_id = auth.uid() OR provider_id = auth.uid()
    )
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

COMMIT;
```

## Constraints / NAO fazer
- Permitir adicional sem aprovacao do cliente alterar `final_amount_cents` da SR
- Auto-aprovar same_specialty (sempre passa por cliente — AC #7)
- Criar nova SR aqui (so guarda `redirect_target_request_id`; criacao via UI cliente em US-002 de SOLICITACAO)

## Convencoes
- `detected_category_slug` snapshot via match com `provider_specialties` (cross-check no RPC T-295)
- Sem expires_at — se cliente nao decide na hora, fica pendente ate fim do servico (timeout no cron diferente do scope/material/revisit)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-290 DATA: service_client_absences (cliente ausente)
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-290', 'Criar service_client_absences (geoloc + timestamp + tentativa contato + taxa visita)',
 $desc$## Objetivo
Tabela registra evento de "cliente ausente": prestador chega ao endereco, espera 15 minutos com tentativa de contato pelo chat, e ao fim aciona registro com geolocalizacao + timestamp. Resultado: cobranca de taxa de visita ao cliente. Cobre AC #9.

## Contexto
Modulo EXECUCAO. Geolocalizacao do prestador colhida no momento do registro (lat/lng + accuracy_m). Tentativas de contato sao `messages` (T-178/T-180 chat ja existe) — campo `chat_attempts_count` snapshot ate o momento da criacao. Taxa de visita vem de `app_config.taxa_visita_cents` (T-304). Se taxa for cobrada, gera linha em `provider_payouts` (T-124) ou ajuste no `service_requests.final_amount_cents`.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_absences.sql`
```sql
BEGIN;

CREATE TABLE service_client_absences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  registered_by       uuid NOT NULL REFERENCES auth.users(id),  -- provider_id
  arrived_at          timestamptz NOT NULL,
  registered_at       timestamptz NOT NULL DEFAULT NOW(),
  geoloc              geography(POINT, 4326) NOT NULL,
  geoloc_accuracy_m   integer NOT NULL CHECK (geoloc_accuracy_m BETWEEN 0 AND 5000),
  chat_attempts_count integer NOT NULL CHECK (chat_attempts_count >= 1),  -- pelo menos 1 mensagem enviada
  visit_fee_cents     integer NOT NULL CHECK (visit_fee_cents >= 0),
  fee_charged         boolean NOT NULL DEFAULT false,            -- liquidado em payouts/SR
  "createdAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_absence_provider ON service_client_absences(registered_by);

ALTER TABLE service_client_absences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "absence_select_parties" ON service_client_absences FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM service_requests
      WHERE client_id = auth.uid() OR provider_id = auth.uid()
    )
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

COMMIT;
```

## Constraints / NAO fazer
- Permitir registro sem `chat_attempts_count >= 1` (CHECK garante)
- Permitir 2 absences no mesmo SR (UNIQUE em service_request_id)
- Aceitar registro antes de `arrived_at + 15min` (validacao na RPC T-296, nao no schema — para flexibilidade futura)
- Salvar geoloc precisa (lat/lng cleartext) — usar postgis geography para indexacao espacial e auditoria

## Convencoes
- PostGIS ja habilitado (US-005 service_provider_locations)
- `visit_fee_cents` snapshot do app_config no momento da criacao (T-304)
- `fee_charged=false` inicialmente; cron ou RPC de fechamento liquida$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-291 DATA: provider_noshow_counters + trigger auto-suspend
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-291', 'Criar provider_noshow_counters + trigger auto-suspend ao atingir 3 consecutivos',
 $desc$## Objetivo
Contador de no-shows consecutivos do PRESTADOR (incrementa por evento `provider_noshow_detected`, reset a cada `service_completed`). Ao atingir 3, dispara suspensao automatica via T-035 `provider_suspension_events` com `category='auto_three_noshows'` e notifica via T-164. Cobre AC #11, #12.

## Contexto
Modulo EXECUCAO + ADMIN. Edge Function T-298 detecta no-show e chama RPC `record_noshow(provider_id, service_request_id)` que faz UPDATE no contador; trigger AFTER UPDATE checa se `consecutive_count >= 3` e cria evento de suspensao + atualiza `provider_profiles.status='suspended'`, `suspension_category='auto_three_noshows'` (enum estendido em T-034). Cliente protegido pela realocacao automatica em T-298 (que tambem usa T-153 dispute_rework_escalation para nova matching).

## Estado atual / O que substitui
Nao existe; T-035 ja criou tabela de eventos de suspensao mas sem contador automatico.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_noshow_counter.sql`
```sql
BEGIN;

-- Adiciona valor de enum se nao existir (T-034 ja criou suspension_category)
ALTER TYPE suspension_category ADD VALUE IF NOT EXISTS 'auto_three_noshows';

CREATE TABLE provider_noshow_counters (
  provider_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  consecutive_count  integer NOT NULL DEFAULT 0,
  last_noshow_at     timestamptz,
  last_completed_at  timestamptz,
  "updatedAt"        timestamptz NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trigger_auto_suspend_after_three_noshows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_threshold integer;
BEGIN
  SELECT (value::text)::integer INTO v_threshold
  FROM app_config WHERE key = 'no_show_threshold' LIMIT 1;
  v_threshold := COALESCE(v_threshold, 3);

  IF NEW.consecutive_count >= v_threshold AND OLD.consecutive_count < v_threshold THEN
    -- Suspende e registra evento
    UPDATE provider_profiles
       SET status = 'suspended',
           suspension_category = 'auto_three_noshows',
           suspended_at = NOW()
     WHERE provider_id = NEW.provider_id;

    INSERT INTO provider_suspension_events (provider_id, kind, category, payload)
    VALUES (NEW.provider_id, 'auto_suspended', 'auto_three_noshows',
            jsonb_build_object('threshold', v_threshold, 'consecutive_count', NEW.consecutive_count));

    -- Notificacao via T-164 / enqueue_notification_event
    PERFORM enqueue_notification_event(
      NEW.provider_id, 'provider_suspended_auto_three_noshows',
      jsonb_build_object('provider_id', NEW.provider_id)
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER provider_noshow_auto_suspend
  AFTER UPDATE OF consecutive_count ON provider_noshow_counters
  FOR EACH ROW EXECUTE FUNCTION trigger_auto_suspend_after_three_noshows();

ALTER TABLE provider_noshow_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "noshow_counter_admin_all" ON provider_noshow_counters FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "noshow_counter_provider_own" ON provider_noshow_counters FOR SELECT
  USING (provider_id = auth.uid());

COMMIT;
```

## Constraints / NAO fazer
- Reset por hora — reset somente apos `service_completed` (RPC dedicada)
- Suspender admin (RLS impede)
- Ignorar `app_config.no_show_threshold` (deve consultar dinamicamente)

## Convencoes
- Enum `suspension_category` extendido (T-034 origem)
- Notificacao via `enqueue_notification_event` (T-162 / T-164)
- `consecutive_count` reset feito por RPC chamada em transition para `completed` (alteracao em T-235 ou job no cron)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================================
-- API layer
-- ============================================================================

-- T-292 API: scope-change endpoints
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-292', 'Implementar POST /api/services/[id]/scope-change + decide (RPC propose + decide_scope)',
 $desc$## Objetivo
Endpoints HTTP para PRESTADOR propor diagnostico diferente e CLIENTE aprovar/rejeitar. Wrappers finos sobre RPCs `propose_scope_change` e `decide_scope_change` (criadas aqui mesmo). Cobre AC #1, #2.

## Contexto
Modulo EXECUCAO. Pre-condicoes: SR em status `provider_en_route` ou `arrived` (antes de `in_progress`). RPC `propose_scope_change` aciona `service_pending_states` (T-231) com `kind='scope_change_pending'` para travar transicao para `in_progress` ate decisao. RPC `decide_scope_change` libera o pending_state e, se aprovada, atualiza `service_requests.scope`/`final_amount_cents`. Idempotency-key obrigatoria nos 2 endpoints.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/services/[id]/scope-change/route.ts` (POST = propose)
```typescript
import { z } from 'zod';
const Body = z.object({
  description: z.string().min(10).max(1000),
  photo_path: z.string().min(1),
  new_scope: z.string().min(5),
  new_value_cents: z.number().int().positive(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const { id } = await params;
  const body = Body.parse(await req.json());

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('propose_scope_change', {
    p_service_request_id: id,
    p_description: body.description,
    p_photo_path: body.photo_path,
    p_new_scope: body.new_scope,
    p_new_value_cents: body.new_value_cents,
    p_idempotency_key: idemKey,
  });
  return mapRpcError(error) ?? Response.json(data, { status: 201 });
}
```

### `src/app/api/services/[id]/scope-change/[changeId]/decide/route.ts` (POST)
```typescript
const Body = z.object({ approve: z.boolean() });
// Cliente decide. RPC valida client_id=auth.uid(), libera pending_state, atualiza SR.
```

### RPCs `propose_scope_change` e `decide_scope_change` (LANGUAGE plpgsql SECURITY DEFINER)
- propose: valida `provider_id=auth.uid()`, status SR in (`arrived`,`provider_en_route`); valida value dentro da faixa (busca de `service_categories.min/max_cents`); cria scope_change row + pending_state + atypical_event `scope_change_proposed`
- decide: valida `client_id=auth.uid()`, scope_change.status='pending_client_review' AND NOT expired; UPDATE status; libera pending_state; se approved: UPDATE service_requests SET scope, final_amount_cents; emite atypical_event approved/rejected

## Constraints / NAO fazer
- Permitir prestador aprovar a propria proposta (RLS via auth.uid())
- Aceitar `new_value_cents` fora da faixa (RPC raise 22023)
- Decidir scope_change ja terminal (RPC raise 'already_decided' → 409)
- Permitir transition para `in_progress` enquanto pending_state ativo (T-231 ja bloqueia)

## Convencoes
- Idempotency-key obrigatoria (mesmo padrao US-005 transition)
- Erros mapeados: 400 (Zod), 401 (no auth), 403 (auth.uid mismatch), 404 (SR/change nao existe), 409 (status ja terminal), 410 (expired), 422 (value fora da faixa)
- Audit em service_atypical_events (kind=scope_change_proposed/approved/rejected)$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-293 API: material endpoints (propose / decide / invoice)
('835b8733-1920-4467-b322-89c66faf69c8', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-293', 'Implementar POST /api/services/[id]/material + decide + PATCH invoice (multipart upload NF)',
 $desc$## Objetivo
3 endpoints: PRESTADOR propoe material (com foto orcamento), CLIENTE aprova/rejeita, PRESTADOR anexa NF apos compra. Sem NF anexada PRESTADOR nao consegue retomar a execucao. Cobre AC #3, #4.

## Contexto
Modulo EXECUCAO. Foto do orcamento via Storage bucket `service-materials/quotes/{sr_id}/`. NF via `service-materials/invoices/{sr_id}/`. Buckets configurados em T-304 (OPS). Pre-condicao: SR em `in_progress`. RPC `propose_material` cria pending_state `material_pending` (bloqueia retomada). RPC `decide_material` libera. RPC `attach_invoice` valida invoice_path setada e libera retomada (status `invoiced`).

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/services/[id]/material/route.ts` POST (propose)
- multipart/form-data: file (foto orcamento) + JSON body
- upload pra `service-materials/quotes/{sr_id}/{uuid}.jpg`
- chama `propose_material(p_service_id, p_item, p_supplier, p_estimated_cents, p_quote_path, p_idempotency_key)`

### `src/app/api/services/[id]/material/[mid]/decide/route.ts` POST
- Body: { approve: boolean }
- RPC `decide_material(p_material_id, p_approve)`

### `src/app/api/services/[id]/material/[mid]/invoice/route.ts` PATCH
- multipart: file (PDF ou JPG da NF) + invoice_cents
- upload pra `service-materials/invoices/{sr_id}/{uuid}.{ext}`
- RPC `attach_invoice(p_material_id, p_invoice_path, p_invoice_cents)`
- Pos-attach: libera pending_state e PRESTADOR pode retomar (status=invoiced)

### RPCs SECURITY DEFINER
```sql
-- propose_material: cria service_material_requests + pending_state + atypical_event
-- decide_material: cliente aprova/rejeita; se rejeita libera pending_state imediato
-- attach_invoice: requires status='approved' AND invoice_path IS NULL; UPDATE invoiced
```

## Constraints / NAO fazer
- Aceitar invoice antes de approved (CHECK no banco + RPC valida)
- Permitir cliente aprovar com prestador errado (RLS via auth.uid)
- Liberar retomada sem NF (pending_state so libera quando status='invoiced' OR 'rejected')
- Cobrar do cliente sem aprovacao (regra de negocio na liquidacao US-005)

## Convencoes
- Multipart obrigatorio nos 2 uploads (foto+NF). Validar mime/types: image/jpeg, image/png para foto; image/* + application/pdf para NF
- Idempotency-key nos 3 endpoints
- Bucket `service-materials` private; signed URL para leitura na UI$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','SECRET_HANDLING','AUDIT_LOG','RATE_LIMIT'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-294 API: revisit endpoints
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-294', 'Implementar POST /api/services/[id]/revisit + decide (com schedule lembrete 24h/2h)',
 $desc$## Objetivo
PRESTADOR propoe retorno em outro dia (motivo tecnico ou atribuivel ao cliente); CLIENTE aprova, rejeita ou propoe nova data. Quando aprovado, agenda lembretes via T-161 schedule_notification para 24h e 2h antes. Cobre AC #5, #6.

## Contexto
Modulo EXECUCAO. RPC `propose_revisit` valida `provider_id=auth.uid()`, status SR in (`in_progress`,`paused`), atribuicao consistente com `travel_fee_cents` (CHECK no banco + validacao no RPC). RPC `decide_revisit` valida `client_id=auth.uid()`, suporta tres outcomes: `approve`, `reject`, `reschedule` (cliente propoe nova data). Lembrete agendado via T-161 com canal external (push+email).

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/services/[id]/revisit/route.ts` POST
```typescript
const Body = z.object({
  attribution: z.enum(['technical','client_attributable']),
  reason: z.string().min(10).max(500),
  proposed_date: z.string().date(),  // YYYY-MM-DD futura
  proposed_time_slot: z.enum(['manha','tarde','noite']).optional(),
});
```

### `src/app/api/services/[id]/revisit/[rid]/decide/route.ts` POST
```typescript
const Body = z.object({
  outcome: z.enum(['approve','reject','reschedule']),
  client_proposed_date: z.string().date().optional(),  // obrigatorio se reschedule
});
```

### RPC `propose_revisit` SECURITY DEFINER
- Valida auth.uid() = provider_id; status SR ok; date > today
- Calcula travel_fee_cents do app_config se atribuivel ao cliente
- INSERT service_revisits + service_atypical_events('revisit_proposed')

### RPC `decide_revisit` SECURITY DEFINER
- Valida auth.uid() = client_id
- approve: UPDATE status='approved'; chama schedule_notification(provider_id+client_id, 24h_before+2h_before, 'revisit_reminder')
- reject: UPDATE status='rejected'
- reschedule: UPDATE status='rescheduled_by_client', client_proposed_date=...; cria novo service_atypical_event para prestador re-decidir

## Constraints / NAO fazer
- Aceitar `proposed_date` no passado
- Travel_fee != 0 em attribution=technical (RPC valida; CHECK no banco)
- Permitir prestador aprovar a propria proposta
- Agendar lembrete sem servico realmente em status que sustenta retorno (RPC valida `paused`)

## Convencoes
- Lembretes via `schedule_notification` (T-162) com `cancellation_key=revisit:{id}` para cancelar se SR for `cancelled`
- Idempotency-key obrigatoria
- Erros: 400 (Zod), 403 (RLS), 409 (revisit ja decidido / data conflitante), 422 (data invalida)$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-295 API: additional-item endpoint
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-295', 'Implementar POST /api/services/[id]/additional-item (deteccao de especialidade + redirect)',
 $desc$## Objetivo
PRESTADOR registra servico adicional pedido pelo cliente durante execucao. RPC detecta se a categoria do adicional bate com `provider_specialties` (mesmo prestador) — se mesma, fluxo igual scope/material (cliente aprova, prestador executa); se diferente, marca `redirected_new_request` e UI orienta cliente abrir nova SR. Cobre AC #7, #8.

## Contexto
Modulo EXECUCAO. Cross-check com tabela de especialidades (verificar nome real — ex.: `provider_profiles.specialties` array OR `provider_specialties` separada). RPC `register_additional_item` consulta especialidades; se diferente, retorna sugestao de slug pra abrir nova solicitacao na home do cliente. AC #8 (sem registro) trata-se de queixa do cliente posterior — fora deste endpoint; alimentado por reporte no historico (US-013) ou inspecao admin. Aqui apenas garantir que `INSERT em service_additional_items` registra o ato.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/services/[id]/additional-item/route.ts` POST
```typescript
const Body = z.object({
  description: z.string().min(5).max(500),
  estimated_cents: z.number().int().positive(),
  detected_category_slug: z.string().min(1),  // UI sugere via heuristica/select
});
```

### RPC `register_additional_item` SECURITY DEFINER
```sql
DECLARE
  v_provider_specialties text[];
  v_same_specialty boolean;
BEGIN
  -- Le especialidades do prestador alocado
  SELECT specialties INTO v_provider_specialties
  FROM provider_profiles
  WHERE provider_id = (SELECT provider_id FROM service_requests WHERE id = p_service_id);

  v_same_specialty := p_detected_category_slug = ANY(v_provider_specialties);

  INSERT INTO service_additional_items (...)
  RETURNING id INTO v_id;

  INSERT INTO service_atypical_events (kind, related_entity_table, related_entity_id, ...)
  VALUES (
    CASE WHEN v_same_specialty THEN 'additional_registered'
         ELSE 'additional_redirected_new_request' END,
    ...
  );
  -- Se same_specialty=true: status pending_client_approval (cliente aprova depois via T-303)
  -- Se false: UPDATE status='redirected_new_request'
END;
```

### `src/app/api/services/[id]/additional-item/[aid]/decide/route.ts` POST (cliente)
- Body: { approve: boolean } — apenas para `same_specialty=true`

## Constraints / NAO fazer
- Auto-aprovar mesmo same_specialty (sempre passa por cliente — AC #7)
- Cobrar valor sem aprovacao (regra negocial)
- Criar a nova SR aqui — apenas guarda `redirect_target_request_id` quando cliente aceita criar (UI orienta)
- Permitir registro com SR fora de `in_progress` (RPC valida)

## Convencoes
- Idempotency-key obrigatoria
- `detected_category_slug` validado contra `service_categories.slug` (RPC raise se invalido)
- Audit em service_atypical_events com payload `{same_specialty, detected_category_slug}`$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-296 API: client-absent endpoint
('b6e052e8-87c0-4990-b789-1e98e061934e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-296', 'Implementar POST /api/services/[id]/client-absent (geoloc + 15min wait + taxa visita)',
 $desc$## Objetivo
PRESTADOR registra que cliente nao apareceu no horario combinado, apos esperar 15 minutos e tentar contato pelo chat. Endpoint valida geolocalizacao + `arrived_at + 15min <= NOW()` + chat_attempts >= 1, cria registro e cobra taxa de visita. Cobre AC #9.

## Contexto
Modulo EXECUCAO. Pre-condicao: SR em status `arrived`. PRESTADOR ja transicionou pra `arrived` ao chegar (T-235 transition). Validacao do contador de mensagens via SELECT em `messages` por `conversation_id` do SR (T-178). Geoloc capturada pelo browser (PWA), enviada como lat/lng + accuracy. Taxa snapshot de `app_config.taxa_visita_cents`.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/services/[id]/client-absent/route.ts` POST
```typescript
const Body = z.object({
  arrived_at: z.string().datetime(),       // ISO timestamp da chegada
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().int().min(0).max(5000),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const idemKey = req.headers.get('idempotency-key');
  // ...validacoes Zod + auth
  const { data, error } = await supabase.rpc('register_client_absent', {
    p_service_id: id,
    p_arrived_at: body.arrived_at,
    p_lat: body.lat,
    p_lng: body.lng,
    p_accuracy_m: body.accuracy_m,
    p_idempotency_key: idemKey,
  });
  // Mapeamento: 22023 (ainda nao passaram 15min) → 422; 23505 (ja registrado) → 409
}
```

### RPC `register_client_absent` SECURITY DEFINER
- Valida auth.uid() = provider_id; status SR='arrived'
- Valida `arrived_at + 15min <= NOW()` (raise 22023 se cedo demais)
- Conta `messages WHERE conversation_id=... AND sender_id=auth.uid()` >= 1 (raise se nao tentou contato)
- Le `app_config.taxa_visita_cents`; INSERT service_client_absences com geoloc geography + visit_fee
- Transition SR via transition_service_status para 'cancelled_by_client_absent' (status novo? ou usa cancelled?) — AGENDAR pra confirmar com US-023 FSM
- Audit service_atypical_events('client_absent_confirmed')

## Constraints / NAO fazer
- Aceitar registro antes de 15min (RPC valida)
- Sem geoloc valida (Zod garante)
- Sem chat_attempts (RPC valida via count das messages)
- Cobrar sem aprovacao do app_config taxa (snapshot dela na criacao)

## Convencoes
- Idempotency-key obrigatoria
- Geoloc serializada em lat/lng e convertida para `geography(POINT)` na RPC
- 15min hardcoded ate T-304 parametrizar `client_absent_wait_minutes`$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RATE_LIMIT','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-297 API: Edge Function provider-inactivity-watchdog
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-297', 'Implementar Edge Function provider-inactivity-watchdog (alerta apos 30min sem update)',
 $desc$## Objetivo
Cron job + Edge Function varre SRs em `in_progress`/`arrived` que estao ha >= 30min sem qualquer update (sem photo, sem chat message do prestador, sem transition). Para cada SR: emite alerta push para o prestador; aciona UI do cliente para decidir entre aguardar ou cancelar sem cobranca; e se >= 60min sem reacao, escalona para equipe Zelar (notification + ticket support automatico). Cobre AC #10.

## Contexto
Modulo EXECUCAO + SISTEMA. Pg_cron job (em T-304) chama a edge function a cada 5 minutos. Edge function consulta SRs com criterio:
```sql
status IN ('arrived','in_progress')
  AND (updated_at < NOW() - INTERVAL '30 minutes')  -- ou last_provider_action_at
  AND id NOT IN (SELECT service_request_id FROM service_atypical_events WHERE kind='provider_inactivity_alert' AND createdAt > NOW() - INTERVAL '1 hour')
```
Para cada match: chama `enqueue_notification_event` (T-162) para o prestador (push) e cliente (notify "Seu prestador esta inativo. Aguardar ou cancelar?"). Inserir `service_atypical_events('provider_inactivity_alert')`. Se ja houver alert recente sem reacao, escalonar.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `supabase/functions/provider-inactivity-watchdog/index.ts`
```typescript
import { createAdminClient } from '@/lib/supabase/admin';

Deno.serve(async () => {
  const supa = createAdminClient();
  // 1. Lista SRs candidatas
  const { data: stale } = await supa.from('service_requests')
    .select('id, provider_id, client_id, updated_at')
    .in('status', ['arrived','in_progress'])
    .lt('updated_at', new Date(Date.now() - 30*60*1000).toISOString());

  for (const sr of stale ?? []) {
    // Skip se ja alertou nessa janela
    const { count } = await supa.from('service_atypical_events').select('*', { count: 'exact', head: true })
      .eq('service_request_id', sr.id).eq('kind','provider_inactivity_alert')
      .gte('createdAt', new Date(Date.now() - 60*60*1000).toISOString());
    if (count && count > 0) {
      // Escalonar: criar support_ticket automatico (kind='inactivity_escalated')
      await supa.rpc('escalate_inactivity', { p_service_id: sr.id });
      continue;
    }
    // Primeiro alerta
    await supa.from('service_atypical_events').insert({
      service_request_id: sr.id,
      kind: 'provider_inactivity_alert',
      payload: { detected_at: new Date().toISOString() },
    });
    await supa.rpc('enqueue_notification_event', {
      p_user_id: sr.provider_id,
      p_event: 'provider_inactivity_alert_provider',
      p_payload: { service_id: sr.id }
    });
    await supa.rpc('enqueue_notification_event', {
      p_user_id: sr.client_id,
      p_event: 'provider_inactivity_alert_client',
      p_payload: { service_id: sr.id }
    });
  }
  return new Response('ok');
});
```

### RPC `escalate_inactivity(p_service_id)` SECURITY DEFINER
- Cria `support_tickets` (T-147) com kind='inactivity_escalated', priority='high'
- Audit `service_atypical_events('provider_inactivity_alert', payload.escalated=true)`

## Constraints / NAO fazer
- Cancelar SR automatico aqui (cliente decide na UI; este job so notifica)
- Spam de alertas (skip via janela de 1h)
- Subir alerta sem `enqueue_notification_event` (canal central de comunicacao US-022)
- Rodar fora do cron (so Edge Function via cron, nunca exposto a usuario)

## Convencoes
- Schedule via pg_cron 5min (T-304)
- Service role via createAdminClient
- Idempotencia via janela de detecao (1h sem realertar)$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG','IDEMPOTENCY_KEY'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-298 API: Edge Function provider-noshow-realloc + penalty
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-298', 'Implementar Edge Function provider-noshow-realloc (deteccao + penalidade + realocacao)',
 $desc$## Objetivo
Cron varre SRs com `scheduled_for <= NOW()` e status=`provider_en_route` ou `accepted` ainda sem check-in. Para cada match: marca prestador como no-show, incrementa `provider_noshow_counters` (que dispara auto-suspend em 3 — T-291), aplica penalidade no score do prestador, libera o cliente via realocacao automatica (re-broadcast pool de matching, US-004). Cobre AC #11, #12.

## Contexto
Modulo EXECUCAO. Cron a cada 5 minutos. Janela de tolerancia: NOW() >= scheduled_for + tolerancia (`app_config.noshow_tolerance_minutes`, default 15min). Detecta `service_check_in_codes.used_at IS NULL AND service_requests.status NOT IN ('in_progress','completed')`. Reusa T-153 dispute_rework_escalation? Nao — aqui a logica e diferente (sem disputa, so realocacao automatica). Pode chamar `start_matching_round` (US-004) para tentar nova alocacao com pool restante.

## Estado atual / O que substitui
Nao existe; T-291 cria contador, T-298 e quem chama.

## O que criar

### `supabase/functions/provider-noshow-realloc/index.ts`
```typescript
Deno.serve(async () => {
  const supa = createAdminClient();
  const { data: tolerance } = await supa.rpc('app_config_get', { p_key: 'noshow_tolerance_minutes' });
  const cutoff = new Date(Date.now() - (tolerance ?? 15)*60*1000).toISOString();

  const { data: noshows } = await supa.from('service_requests')
    .select('id, provider_id, client_id, scheduled_for')
    .in('status', ['accepted','provider_en_route'])
    .lt('scheduled_for', cutoff);

  for (const sr of noshows ?? []) {
    await supa.rpc('record_provider_noshow', {
      p_service_id: sr.id,
      p_provider_id: sr.provider_id,
    });
    // RPC encapsula:
    //   1. service_atypical_events('provider_noshow_detected')
    //   2. UPDATE provider_noshow_counters consecutive_count+1 (trigger T-291 auto-suspende em 3)
    //   3. apply_score_penalty(provider_id, 'noshow', delta)
    //   4. transition_service_status(sr_id, 'queued') — devolve para pool
    //   5. start_matching_round(sr_id, exclude_provider_ids=[provider_id]) — re-broadcast US-004
    //   6. service_atypical_events('provider_noshow_realloc')
    //   7. enqueue_notification_event para cliente "Estamos buscando outro profissional"
    //   8. enqueue_notification_event para prestador "Penalidade aplicada por no-show"
  }
  return new Response('ok');
});
```

### RPC `record_provider_noshow(p_service_id, p_provider_id)` SECURITY DEFINER
- Idempotencia: skip se ja existe `service_atypical_events('provider_noshow_detected')` para este SR
- Penaliza score via `apply_score_penalty` (helper de T-241; criar se nao existe)
- Realocacao via `start_matching_round` (US-004 T-238/T-244)

## Constraints / NAO fazer
- Suspender direto aqui (T-291 trigger faz quando counter=3)
- Realocar sem excluir o provider que falhou (excluir do pool)
- Disparar notificacao em texto livre — usar templates via T-216
- Rodar fora do cron

## Convencoes
- Schedule via pg_cron 5min (T-304)
- Idempotencia por SR (1 detection por SR no max)
- Service role via createAdminClient$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG','IDEMPOTENCY_KEY','RACE_CONDITION'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================================
-- UI layer
-- ============================================================================

-- T-299 UI: ScopeChangeSheet (PRESTADOR)
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-299', 'Renderizar ResponsiveSheet "Diagnostico diferente" (PRESTADOR pausa + foto + valor)',
 $desc$## Objetivo
ResponsiveSheet acionado pelo botao "Pausar" no `ExecutionStepper` (T-274 US-005) quando PRESTADOR esta em `arrived` ou `in_progress`. Form com descricao do problema, foto obrigatoria (camera nativa), novo escopo e novo valor (validado client-side contra faixa da categoria mostrada inline). Submit chama T-292 com idempotency-key estavel `scope-change-{sr_id}-{timestamp}`. Cobre AC #1.

## Contexto
Modulo EXECUCAO. Reusa `ResponsiveSheet`, `Field`/`FormBody`, `Input` (number+camera), `Button`, `Sonner`. Camera nativa via `<input type="file" accept="image/*" capture="environment">` (mesmo padrao US-005 PhotosClient). Valor exibe inline a faixa ("entre R$ 80,00 e R$ 250,00 conforme categoria"). Apos submit 201, sheet fecha e stepper mostra "Aguardando aprovacao do cliente — 14:23 restantes" (countdown alimentado por T-302 hook).

## Estado atual / O que substitui
Nao existe — ExecutionStepper de US-005 nao tem CTA "Pausar" ainda.

## O que criar

### `src/components/provider-execution/ScopeChangeSheet.tsx`
```tsx
'use client';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Field, FormBody } from '@/components/ui/field';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  categoryMinCents: number;
  categoryMaxCents: number;
  onSuccess: () => void;
}

export function ScopeChangeSheet({ ... }: Props) {
  const [description, setDescription] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [newScope, setNewScope] = useState('');
  const [newValueCents, setNewValueCents] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const inRange = newValueCents >= categoryMinCents && newValueCents <= categoryMaxCents;

  const submit = async () => {
    setBusy(true);
    try {
      // 1. upload foto pra service-photos/scope-changes/{sr_id}/...
      const photoPath = await uploadPhoto(photoFile!, serviceId, 'scope-changes');
      // 2. POST scope-change
      const idem = `scope-change-${serviceId}-${Date.now()}`;
      await fetchOrThrow(`/api/services/${serviceId}/scope-change`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idem },
        body: JSON.stringify({ description, photo_path: photoPath, new_scope: newScope, new_value_cents: newValueCents }),
      });
      onSuccess();
    } catch (err) { showErrorToast({ type: 'create' }, err); }
    finally { setBusy(false); }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
      <ResponsiveSheet.Header>Diagnostico diferente</ResponsiveSheet.Header>
      <ResponsiveSheet.Body>
        <FormBody density="comfortable">
          <Field name="description" required>
            <Field.Label>O que voce encontrou?</Field.Label>
            <Field.Control><Textarea value={description} onChange={...} /></Field.Control>
          </Field>
          <Field name="photo" required>
            <Field.Label>Foto do problema</Field.Label>
            <Field.Control><Input type="file" accept="image/*" capture="environment" onChange={...} /></Field.Control>
          </Field>
          <Field name="new_scope" required>
            <Field.Label>Novo escopo proposto</Field.Label>
            <Field.Control><Textarea value={newScope} onChange={...} /></Field.Control>
          </Field>
          <Field name="new_value" required error={!inRange ? `Fora da faixa permitida` : undefined}>
            <Field.Label>Novo valor (R$)</Field.Label>
            <Field.Control><Input type="number" step="0.01" value={newValueCents/100} onChange={e=>setNewValueCents(Math.round(+e.target.value*100))} /></Field.Control>
            <Field.Hint>Faixa permitida: R$ {(categoryMinCents/100).toFixed(2)} - R$ {(categoryMaxCents/100).toFixed(2)}</Field.Hint>
          </Field>
        </FormBody>
      </ResponsiveSheet.Body>
      <ResponsiveSheet.Footer>
        <Button onClick={submit} disabled={busy || !inRange || !photoFile}>
          {busy ? 'Enviando…' : 'Enviar para aprovacao'}
        </Button>
      </ResponsiveSheet.Footer>
    </ResponsiveSheet>
  );
}
```

### Hook em `ExecutionStepper`
- Quando ha scope_change `pending_client_review`, renderiza badge "Aguardando aprovacao" + countdown
- Botao "Pausar > Diagnostico diferente" abre o sheet

## Constraints / NAO fazer
- Validar Zod no client (so checagem visual de faixa; servidor valida real)
- Permitir submit sem foto (Required + validacao no botao)
- Usar Dialog cru / window.confirm
- Salvar foto sem upload pro Storage (sempre via signed POST)

## Convencoes
- ResponsiveSheet size="md"
- Reuso: Field/FormBody/Input/Textarea/Button/Sonner (showErrorToast)
- camera capture="environment" (camera traseira)
- Mobile-first; CTA bottom em sticky no Footer$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-300 UI: MaterialRequestSheet + InvoiceUploadPage
('e43b1102-197b-460f-b33c-3c07be51f010', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-300', 'Renderizar MaterialRequestSheet + tela /materials/[mid]/invoice (anexar NF)',
 $desc$## Objetivo
2 superficies UI para PRESTADOR: ResponsiveSheet para solicitar material (item/fornecedor/valor/foto orcamento) e tela dedicada para anexar NF apos compra. Sem NF anexada, botao "Retomar execucao" no ExecutionStepper fica disabled. Cobre AC #3, #4.

## Contexto
Modulo EXECUCAO. Sheet aciona T-293 POST com multipart (foto orcamento). Tela /materials/[mid]/invoice e roteada via link no estado "Material aprovado" do stepper, com PATCH multipart (NF + valor real). Pos-attach, stepper desbloqueia "Retomar".

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/components/provider-execution/MaterialRequestSheet.tsx`
```tsx
// Form: item_name, supplier, estimated_cents, foto orcamento (camera)
// Submit -> POST multipart /api/services/[id]/material
```

### `src/app/(provider)/services/[id]/materials/[mid]/invoice/page.tsx`
```tsx
'use client';
// Upload de NF (PDF ou imagem) + invoice_cents real
// PATCH /api/services/[id]/material/[mid]/invoice
// Apos sucesso, redirect para /(provider)/services/[id]/in-progress
// (stepper reativa botao "Retomar execucao")
```

### Integracao com `ExecutionStepper`
- `material_pending` (status=approved E invoice null): mostra link "Anexar nota fiscal"
- `material_invoiced`: stepper exibe linha "Material X anexado: R$ Y" + botao Retomar habilitado

## Constraints / NAO fazer
- Permitir submit sem foto (botao disabled ate ter file)
- Aceitar NF antes de approved (UI nao exibe rota se nao approved)
- Subir invoice_cents > estimated_cents * tolerancia sem aviso (mostrar warning UI quando >150% do estimado)
- Usar lib externa pra mascara (input type=number nativo)

## Convencoes
- ResponsiveSheet size="md" para o form
- Tela invoice usa layout mobile-first com input file capture e numerico
- Reuso: Field/FormBody, Input, Button, Sonner
- Idempotency-key estavel material-{sr_id}-{Date.now()} para POST; invoice-{material_id}-{ts} para PATCH$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-301 UI: RevisitSheet + AdditionalItemSheet (PRESTADOR — ambos pequenos)
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-301', 'Renderizar RevisitSheet + AdditionalItemSheet (PRESTADOR registra retorno + adicional)',
 $desc$## Objetivo
2 ResponsiveSheets pequenos: RevisitSheet (motivo + tipo tecnico/cliente_atribuivel + data proposta) e AdditionalItemSheet (descricao + valor + categoria detectada com aviso de redirect quando especialidade diferente). Acionados via menu "+" no ExecutionStepper. Cobre AC #5, #6, #7, #8.

## Contexto
Modulo EXECUCAO. RevisitSheet alimenta T-294 POST. AdditionalItemSheet alimenta T-295 POST e, na resposta, se `same_specialty=false`, mostra Sonner com link "Abrir nova solicitacao" para o cliente. AC #8: nao acionar via UI direta; alimentado por reportagem do cliente em US-013 (historico) — UI aqui so cobre o caminho FELIZ (registrar). Aviso no rodape do AdditionalItemSheet: "Adicionais nao registrados podem afetar seu score".

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/components/provider-execution/RevisitSheet.tsx`
```tsx
// Form: attribution radio (technical/client_attributable), reason textarea,
// proposed_date input type=date, proposed_time_slot select (manha/tarde/noite),
// se attribution=client_attributable mostra "Taxa de deslocamento: R$ Y" snapshot do app_config
// Submit -> POST /api/services/[id]/revisit
```

### `src/components/provider-execution/AdditionalItemSheet.tsx`
```tsx
// Form: description textarea, estimated_cents number,
// detected_category_slug select (alimentado por GET /api/categories ou helper)
// Submit -> POST /api/services/[id]/additional-item
// Se response.same_specialty=false: Sonner com toast "Cliente sera orientado a abrir nova solicitacao"
// Se true: Sonner "Aguardando aprovacao do cliente"
// Footer hint: "Adicionais nao registrados aqui podem afetar seu score"
```

### Integracao no `ExecutionStepper`
- Menu "+" (DropdownMenu reuso) com 4 opcoes: "Diagnostico diferente" (T-299), "Solicitar material" (T-300), "Marcar retorno" (T-301), "Servico adicional" (T-301)

## Constraints / NAO fazer
- Aceitar data no passado no RevisitSheet (Input min=today)
- Esconder a hint de score do AdditionalItemSheet (AC #8 explicito)
- Esquecer da fixacao do travel_fee_cents quando troca radio (re-fetch app_config OU snapshot inline)
- Usar lib mascara

## Convencoes
- ResponsiveSheet size="sm" (forms pequenos)
- Reuso: Field/FormBody, Input(date/number), Select, Textarea, DropdownMenu (no stepper)
- Mobile-first
- Idempotency-key estavel revisit-{sr_id}-{Date.now()} e additional-{sr_id}-{Date.now()}$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-302 UI: ClientAbsentFlow + PendingActionBanner
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-302', 'Renderizar ClientAbsentFlow (countdown 15min) + PendingActionBanner (cobre AC #13)',
 $desc$## Objetivo
2 surfaces UI:
1. **ClientAbsentFlow**: tela acionada quando PRESTADOR transita para `arrived` mas cliente nao aparece. Countdown de 15 minutos com botoes "Tentar contato (chat)" e (apos 15min) "Cliente ausente". Captura geoloc no momento do registro. Cobre AC #9.
2. **PendingActionBanner**: banner persistente no topo do `ExecutionStepper` que lista a pendencia ativa (scope_change/material/revisit/additional) e o caminho para resolve-la, bloqueando criacao de nova pendencia paralela. Cobre AC #13.

## Contexto
Modulo EXECUCAO. ClientAbsentFlow chama T-296 com geoloc (geolocation API do browser); requer pelo menos 1 mensagem enviada via T-186 ChatComposer (validacao cliente: contar via supabase.from messages onde sender=auth.uid() AND conversation.service_id=...). Banner consulta `service_atypical_events` mais recentes nao terminais; quando ha pending, esconde menu "+" do stepper (e renderiza banner explicativo). Governanca da regra de bloqueio (AC #13) e da US-023 (T-231 service_pending_states ja faz a logica no banco; UI apenas reflete).

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/(provider)/services/[id]/client-absent/page.tsx`
```tsx
'use client';
// Countdown 15min desde scheduled_for + arrival_at
// Mostra: "Tente contato pelo chat" -> link para /messages do SR
// Apos 15min sem aparicao: botao "Cliente ausente" habilitado
// Submit: pega geolocation.getCurrentPosition({enableHighAccuracy:true})
// POST /api/services/[id]/client-absent com lat/lng/accuracy/arrived_at
// Sucesso: redirect /(provider)/home com toast "Taxa de visita registrada"
```

### `src/components/provider-execution/PendingActionBanner.tsx`
```tsx
// Server-fetched pending actions agregadas:
// - service_scope_changes WHERE status='pending_client_review'
// - service_material_requests WHERE status IN ('pending_client_review','approved') AND invoice_path IS NULL
// - service_revisits WHERE status='pending_client_review'
// - service_additional_items WHERE status='pending_client_approval'
// Render: badge cor amarela com texto + countdown + CTA "Ver detalhes"
// Quando ha pending: ExecutionStepper esconde menu "+" e mostra so esse banner
```

### Integracao no `ExecutionStepper` (T-274 US-005)
- Hook `useExecutionPending(serviceId)` que consome `useOptimisticCollection` + Realtime via canal service:{id} (T-081)
- Se `pending.length > 0`: esconde menu "+", mostra `PendingActionBanner`
- Se `pending.length === 0`: mostra menu "+" com CTAs (T-299/T-300/T-301)

## Constraints / NAO fazer
- Permitir submit "Cliente ausente" antes de 15min (countdown disabled)
- Permitir submit sem geoloc valida (validar accuracy <5km — campo do banco)
- Mostrar mais de 1 banner simultaneamente (entrada mais antiga vence)
- Usar window.confirm pra "Tem certeza?" (usar ConfirmDialog com state)

## Convencoes
- Reuso: Card, Badge, Button, ConfirmDialog (confirma envio do absent), Sonner
- Reuso hook: useOptimisticCollection (lista pendings)
- Realtime via service:{id} canal ja em T-081 — extender filtro para mudancas em service_atypical_events
- Mobile-first; sticky CTA bottom no client-absent
- Geoloc: capturar ao clicar botao (lazy), nao ao montar (privacidade)$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','CONFIRM_DIALOG_REQUIRED','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-303 UI: ClientDecisionDialog (CLIENTE decide propostas)
('52605714-2ca9-4778-be94-ee1d7a091395', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-303', 'Renderizar ResponsiveDialog CLIENTE decide proposta (scope/material/revisit/additional)',
 $desc$## Objetivo
ResponsiveDialog generico no PWA do cliente que aparece como overlay quando ha proposta pendente do prestador (scope_change, material, revisit, additional). Mostra detalhes (descricao, foto se houver, valor, countdown 15min para scope/material/revisit) com 2 botoes: Aprovar / Rejeitar. Cobre AC #2, #3 (cliente aprova), #5, #6, #7.

## Contexto
Modulo EXECUCAO. CLIENTE acompanha o servico em `/(client)/services/[id]/` (US-012). Quando Realtime entrega novo evento `*_proposed` via canal service:{id} (T-081), abre dialog automaticamente. Dialog faz polimorfico via prop `proposalKind`. Submit chama o endpoint `/decide` correspondente:
- scope_change: POST /api/services/[id]/scope-change/[changeId]/decide
- material: POST /api/services/[id]/material/[mid]/decide
- revisit: POST .../revisit/[rid]/decide (com outcome approve/reject/reschedule)
- additional: POST .../additional-item/[aid]/decide

Para revisit, quando rejeitar, mostra opcao "Propor nova data" (input date + recall RPC).

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/components/client-execution/ClientDecisionDialog.tsx`
```tsx
'use client';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';

type Proposal = {
  kind: 'scope_change' | 'material' | 'revisit' | 'additional';
  id: string;
  service_id: string;
  // shape varia por kind
} & ProposalDetails;

export function ClientDecisionDialog({ proposal, open, onOpenChange, onDecided }: Props) {
  const [busy, setBusy] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');

  const decide = async (outcome: 'approve' | 'reject' | 'reschedule') => {
    setBusy(true);
    const url = endpointFor(proposal);
    const idem = `decide-${proposal.kind}-${proposal.id}-${outcome}`;
    try {
      await fetchOrThrow(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idem },
        body: JSON.stringify(buildBody(proposal, outcome, rescheduleDate)),
      });
      onDecided();
    } catch (err) { showErrorToast({ type: 'patch' }, err); }
    finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialog.Header>{titleFor(proposal)}</ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <PropDetails proposal={proposal} />
        {proposal.expires_at && <Countdown to={proposal.expires_at} />}
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button variant="ghost" onClick={() => decide('reject')} disabled={busy}>Rejeitar</Button>
        {proposal.kind === 'revisit' && (
          <Button variant="outline" onClick={() => decide('reschedule')} disabled={busy || !rescheduleDate}>
            Propor outra data
          </Button>
        )}
        <Button onClick={() => decide('approve')} disabled={busy}>Aprovar</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
```

### Hook `useClientPendingProposals(serviceId)`
- Subscribe canal service:{id} (T-081 Realtime)
- Quando recebe `*_proposed`, refetch lista; abre dialog com a proposta mais recente
- Apos `*_approved/_rejected/_expired`, fecha o dialog

## Constraints / NAO fazer
- Mostrar dialog para PRESTADOR (so cliente)
- Permitir Aprovar sem countdown valido (botao disabled apos expires_at)
- Aprovar via API sem idempotency-key
- Mostrar mais de 1 dialog simultaneo (queue: mostra mais antigo primeiro)
- Usar Dialog cru ou window.confirm

## Convencoes
- ResponsiveDialog (decisao pontual)
- Reuso: Button, Sonner, Field (no caso reschedule), Input type=date
- Idempotency-key estavel decide-{kind}-{id}-{outcome} (deduplicacao em retry)
- Realtime via T-081$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ============================================================================
-- OPS layer
-- ============================================================================

-- T-304 OPS: app_config seeds + storage buckets + pg_cron jobs
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5dc68fd9-d72f-478d-9252-7aca23634802',
 'ZLAR-V2-T-304', 'Seedar app_config atypical_* + bucket service-materials + pg_cron jobs (watchdog/noshow)',
 $desc$## Objetivo
Configuracoes operacionais para US-006: parametros editaveis em `app_config` (prazos, taxa visita, taxa deslocamento, threshold no-show), bucket Storage `service-materials` privado, e dois pg_cron jobs (watchdog 5min, noshow-realloc 5min). Sustenta AC #2, #4, #5, #6, #9, #10, #11, #12.

## Contexto
Modulo OPS. `app_config` ja existe (T-019/US-019). pg_cron extension ja habilitada. Storage buckets sao criados via SQL (storage.buckets) ou via UI Supabase — via SQL e o canonical da skill.

## Estado atual / O que substitui
Nao existe — chaves `atypical_*` adicionadas; bucket novo; jobs novos.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_us006_ops.sql`
```sql
BEGIN;

-- 1. Seeds app_config
INSERT INTO app_config (key, value, description) VALUES
  ('atypical_decision_deadline_minutes', '15'::jsonb, 'Prazo (min) para CLIENTE decidir scope_change/material/revisit'),
  ('client_absent_wait_minutes', '15'::jsonb, 'Tempo de espera (min) antes do prestador registrar cliente ausente'),
  ('provider_inactivity_threshold_minutes', '30'::jsonb, 'Tempo sem update (min) que dispara alerta de inatividade'),
  ('provider_inactivity_escalation_minutes', '60'::jsonb, 'Tempo total (min) que escala para suporte automatico'),
  ('noshow_tolerance_minutes', '15'::jsonb, 'Tolerancia (min) apos scheduled_for antes de considerar no-show'),
  ('no_show_threshold', '3'::jsonb, 'Quantos no-shows consecutivos para auto-suspender prestador'),
  ('taxa_visita_cents', '3000'::jsonb, 'Taxa cobrada do cliente quando ausente (R$ 30,00)'),
  ('taxa_deslocamento_cents', '2500'::jsonb, 'Taxa de deslocamento para retorno atribuivel ao cliente (R$ 25,00)')
ON CONFLICT (key) DO NOTHING;

-- 2. Storage bucket service-materials (privado)
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-materials', 'service-materials', false)
ON CONFLICT (id) DO NOTHING;

-- RLS por path (cliente e prestador alocados leem; outros 403)
CREATE POLICY "service_materials_read_parties" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'service-materials'
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id::text = split_part(name, '/', 2)
        AND (sr.client_id = auth.uid() OR sr.provider_id = auth.uid())
    )
  );
CREATE POLICY "service_materials_write_provider" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'service-materials'
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id::text = split_part(name, '/', 2)
        AND sr.provider_id = auth.uid()
    )
  );

-- 3. pg_cron jobs
SELECT cron.schedule(
  'provider-inactivity-watchdog', '*/5 * * * *',
  $$ SELECT net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/provider-inactivity-watchdog',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('zelar.cron_token'))
  ); $$
);

SELECT cron.schedule(
  'provider-noshow-realloc', '*/5 * * * *',
  $$ SELECT net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/provider-noshow-realloc',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('zelar.cron_token'))
  ); $$
);

COMMIT;
```

## Constraints / NAO fazer
- Bucket publico (privacidade — sempre privado, signed URLs)
- Hardcode de URL da edge function — usar env/postgres setting
- ON CONFLICT REPLACE (mantem valor existente em re-run; usar DO NOTHING)
- Job sem token de autenticacao (Bearer obrigatorio)
- Esquecer `WITH CHECK` na policy de INSERT (escalation possible)

## Convencoes
- Naming: `cron.schedule('<job-name>', '<cron>', '<sql>')` — kebab-case
- Storage bucket privado por padrao
- Postgres setting `zelar.cron_token` armazenado via `ALTER DATABASE postgres SET zelar.cron_token = '...'` (operacao manual de deploy)$desc$,
 'OPS', 'ADMIN', ARRAY['SECRET_HANDLING','RLS_REQUIRED'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. TaskAcceptanceCriterion (vinculo task -> AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-285 service_atypical_events: cobre AC transversais 1, 3, 5, 7, 9, 10, 11
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 1),
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 3),
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 5),
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 7),
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 9),
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 10),
  ('aacb08b8-cf42-4d93-9198-855c5bf8d425'::uuid, 11),

  -- T-286 service_scope_changes: AC #1, #2
  ('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4'::uuid, 1),
  ('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4'::uuid, 2),

  -- T-287 service_material_requests: AC #3, #4
  ('6eecd90e-27de-4e3d-8893-3ca88a1deafd'::uuid, 3),
  ('6eecd90e-27de-4e3d-8893-3ca88a1deafd'::uuid, 4),

  -- T-288 service_revisits: AC #5, #6
  ('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d'::uuid, 5),
  ('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d'::uuid, 6),

  -- T-289 service_additional_items: AC #7, #8
  ('1d164acb-d94d-4a66-9f9b-8908c191e9ae'::uuid, 7),
  ('1d164acb-d94d-4a66-9f9b-8908c191e9ae'::uuid, 8),

  -- T-290 service_client_absences: AC #9
  ('538ce1d7-bdb1-4193-890a-96d4641a54df'::uuid, 9),

  -- T-291 provider_noshow_counters + auto-suspend: AC #11, #12
  ('bc302aa0-a42f-46d4-918c-f3dd5bb19548'::uuid, 11),
  ('bc302aa0-a42f-46d4-918c-f3dd5bb19548'::uuid, 12),

  -- T-292 API scope-change: AC #1, #2
  ('6c44a8e4-f82e-474c-b04d-5578e1bea0e2'::uuid, 1),
  ('6c44a8e4-f82e-474c-b04d-5578e1bea0e2'::uuid, 2),

  -- T-293 API material: AC #3, #4
  ('835b8733-1920-4467-b322-89c66faf69c8'::uuid, 3),
  ('835b8733-1920-4467-b322-89c66faf69c8'::uuid, 4),

  -- T-294 API revisit: AC #5, #6
  ('620f698f-fbc4-45e7-85b0-502582e4ae05'::uuid, 5),
  ('620f698f-fbc4-45e7-85b0-502582e4ae05'::uuid, 6),

  -- T-295 API additional: AC #7, #8
  ('b77889ce-5236-46e7-8101-9ca13f6d3233'::uuid, 7),
  ('b77889ce-5236-46e7-8101-9ca13f6d3233'::uuid, 8),

  -- T-296 API client-absent: AC #9
  ('b6e052e8-87c0-4990-b789-1e98e061934e'::uuid, 9),

  -- T-297 watchdog: AC #10
  ('190a560c-348d-468b-8676-d9a1e4d2c0f4'::uuid, 10),

  -- T-298 noshow-realloc: AC #11, #12
  ('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be'::uuid, 11),
  ('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be'::uuid, 12),

  -- T-299 ScopeChangeSheet UI: AC #1
  ('c15a751f-2460-40d8-99cb-45e13dda6e8e'::uuid, 1),

  -- T-300 MaterialRequestSheet+Invoice UI: AC #3, #4
  ('e43b1102-197b-460f-b33c-3c07be51f010'::uuid, 3),
  ('e43b1102-197b-460f-b33c-3c07be51f010'::uuid, 4),

  -- T-301 RevisitSheet + AdditionalItemSheet UI: AC #5, #6, #7, #8
  ('3c658d5f-d6a5-4250-a6db-956c423a3a24'::uuid, 5),
  ('3c658d5f-d6a5-4250-a6db-956c423a3a24'::uuid, 6),
  ('3c658d5f-d6a5-4250-a6db-956c423a3a24'::uuid, 7),
  ('3c658d5f-d6a5-4250-a6db-956c423a3a24'::uuid, 8),

  -- T-302 ClientAbsentFlow + PendingActionBanner: AC #9, #10, #11, #12, #13
  ('5e8d949c-417b-4351-9dad-4ae80579bda0'::uuid, 9),
  ('5e8d949c-417b-4351-9dad-4ae80579bda0'::uuid, 10),
  ('5e8d949c-417b-4351-9dad-4ae80579bda0'::uuid, 11),
  ('5e8d949c-417b-4351-9dad-4ae80579bda0'::uuid, 12),
  ('5e8d949c-417b-4351-9dad-4ae80579bda0'::uuid, 13),

  -- T-303 ClientDecisionDialog UI: AC #2, #3, #5, #6, #7
  ('52605714-2ca9-4778-be94-ee1d7a091395'::uuid, 2),
  ('52605714-2ca9-4778-be94-ee1d7a091395'::uuid, 3),
  ('52605714-2ca9-4778-be94-ee1d7a091395'::uuid, 5),
  ('52605714-2ca9-4778-be94-ee1d7a091395'::uuid, 6),
  ('52605714-2ca9-4778-be94-ee1d7a091395'::uuid, 7),

  -- T-304 OPS seed + buckets + cron: AC #2, #4, #5, #6, #9, #10, #11, #12
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 2),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 4),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 5),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 6),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 9),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 10),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 11),
  ('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303'::uuid, 12)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;


-- ============================================================================
-- 3. AcceptanceCriterion (taskId) — checklist tecnico (checkbox no TaskSheet)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-285 service_atypical_events
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'Enum atypical_event_kind criado com 18 valores', 1),
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'Tabela service_atypical_events com indices em (service_request_id, createdAt DESC) e (kind, createdAt DESC)', 2),
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'RLS: cliente/prestador alocados leem; admin tudo; sem INSERT/UPDATE/DELETE direto pelo client', 3),
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'Smoke: cliente A nao le eventos do servico do cliente B', 4),
('aacb08b8-cf42-4d93-9198-855c5bf8d425', 'Append-only enforcado (sem trigger AFTER UPDATE/DELETE permite)', 5),

-- T-286 service_scope_changes
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'Enum scope_change_status (4 valores) e tabela criados', 1),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'CHECK scope_value_within_category aplica violation se valor fora da faixa', 2),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'Unique partial index uniq_scope_change_pending impede 2 propostas pendentes simultaneas', 3),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'Trigger preenche expires_at = createdAt + 15min', 4),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'RLS: partes leem; admin tudo; sem INSERT direto pelo client (somente via RPC)', 5),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'Smoke: violation ao tentar criar 2 pendentes para mesma SR', 6),

-- T-287 service_material_requests
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'Enum material_request_status (5 valores) e tabela criados', 1),
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'CHECK invoice_after_approval impede invoice_path setada com status invalido', 2),
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'Indice idx_material_pending sobre (service_request_id, status) parcial', 3),
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'RLS: partes leem; admin tudo; sem INSERT/UPDATE direto pelo client', 4),
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'Smoke: tentativa de UPDATE invoice_path com status pending_client_review levanta CHECK violation', 5),

-- T-288 service_revisits
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'Enums revisit_attribution e revisit_status criados', 1),
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'CHECK travel_fee_consistency: technical=0 / client_attributable>0', 2),
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'Unique partial uniq_revisit_pending impede 2 propostas pendentes simultaneas', 3),
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'RLS: partes leem; admin tudo; sem INSERT direto pelo client', 4),
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'Smoke: violation tentando travel_fee>0 com attribution=technical', 5),

-- T-289 service_additional_items
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'Enum additional_item_status (4 valores) e tabela criados com FK redirect_target_request_id', 1),
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'Coluna same_specialty NOT NULL com indice parcial em pending', 2),
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'RLS: partes leem; admin tudo; sem INSERT direto pelo client', 3),
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'Smoke: cliente B nao le adicional de servico de cliente A', 4),

-- T-290 service_client_absences
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'Coluna geoloc geography(POINT,4326) com PostGIS habilitado', 1),
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'CHECK geoloc_accuracy_m em [0,5000] e chat_attempts_count >= 1', 2),
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'UNIQUE em service_request_id (1 absence por SR)', 3),
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'RLS: partes leem; admin tudo', 4),
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'Smoke: tentativa de inserir 2 absences para mesma SR retorna 23505', 5),

-- T-291 provider_noshow_counters + auto-suspend
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'Enum suspension_category extendido com auto_three_noshows', 1),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'Tabela provider_noshow_counters criada', 2),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'Trigger AFTER UPDATE dispara provider_suspension_events e UPDATE provider_profiles.status=suspended ao atingir threshold', 3),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'Threshold lido dinamicamente de app_config.no_show_threshold (default 3)', 4),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'enqueue_notification_event chamado dentro do trigger', 5),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'RLS: prestador le seu proprio counter; admin tudo', 6),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'Smoke: 3 increments consecutivos disparam suspensao automaticamente em transacao unica', 7),

-- T-292 API scope-change
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Endpoints POST /api/services/[id]/scope-change e .../decide criados', 0),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Header idempotency-key obrigatorio (400 sem header)', 1),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Validacao Zod no body (400 em formato invalido)', 2),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'RPC propose_scope_change cria service_pending_states (T-231) bloqueando transicao', 3),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'RPC decide_scope_change libera pending_state e atualiza service_requests no aprovado', 4),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Cliente decidir scope ja terminal retorna 409', 5),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Decisao apos expires_at retorna 410', 6),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Provider tenta aprovar a propria proposta retorna 403', 7),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'Audit em service_atypical_events com kinds proposed/approved/rejected', 8),

-- T-293 API material
('835b8733-1920-4467-b322-89c66faf69c8', 'Endpoints POST material, POST decide e PATCH invoice criados', 0),
('835b8733-1920-4467-b322-89c66faf69c8', 'Multipart obrigatorio nos uploads (foto orcamento + NF)', 1),
('835b8733-1920-4467-b322-89c66faf69c8', 'Idempotency-key obrigatoria nos 3 endpoints', 2),
('835b8733-1920-4467-b322-89c66faf69c8', 'Validacao mime: image/jpeg|png para foto; image/* + application/pdf para NF', 3),
('835b8733-1920-4467-b322-89c66faf69c8', 'attach_invoice rejeita 409 se status nao for approved', 4),
('835b8733-1920-4467-b322-89c66faf69c8', 'Pos-attach pending_state e liberado e botao Retomar habilita', 5),
('835b8733-1920-4467-b322-89c66faf69c8', 'Foto orcamento e NF salvas em paths corretos do bucket service-materials', 6),
('835b8733-1920-4467-b322-89c66faf69c8', 'Audit em service_atypical_events kinds proposed/approved/rejected/invoiced', 7),

-- T-294 API revisit
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Endpoints POST revisit e POST decide criados', 0),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Idempotency-key obrigatoria', 1),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Zod valida proposed_date (date) no futuro', 2),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'travel_fee_cents preenchido por snapshot do app_config.taxa_deslocamento_cents quando atribuivel', 3),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Approve agenda lembretes 24h e 2h via T-162 schedule_notification', 4),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Reschedule by client cria service_atypical_event para prestador re-decidir', 5),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Provider tentar aprovar propria proposta retorna 403', 6),
('620f698f-fbc4-45e7-85b0-502582e4ae05', 'Audit em service_atypical_events kinds proposed/approved/rejected', 7),

-- T-295 API additional-item
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'Endpoint POST /api/services/[id]/additional-item criado', 0),
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'Endpoint POST decide para same_specialty=true', 1),
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'Idempotency-key obrigatoria', 2),
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'RPC determina same_specialty consultando provider_specialties / provider_profiles.specialties', 3),
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'Slug invalido (nao em service_categories) retorna 422', 4),
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'Status redirected_new_request setado para especialidades diferentes', 5),
('b77889ce-5236-46e7-8101-9ca13f6d3233', 'Audit em service_atypical_events com payload {same_specialty, detected_category_slug}', 6),

-- T-296 API client-absent
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Endpoint POST /api/services/[id]/client-absent criado', 0),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Idempotency-key obrigatoria', 1),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Zod valida lat/lng/accuracy/arrived_at', 2),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Submit antes de arrived_at + 15min retorna 422', 3),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Sem chat_attempts >= 1 (count em messages) retorna 422', 4),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Geoloc convertida para geography(POINT,4326) na RPC', 5),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Retry com mesma idempotency-key nao duplica registro nem cobra 2x', 6),
('b6e052e8-87c0-4990-b789-1e98e061934e', 'Status SR transitado e visit_fee_cents snapshotado do app_config', 7),

-- T-297 watchdog
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Edge Function provider-inactivity-watchdog deployada em supabase/functions', 0),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Detecta SRs em arrived/in_progress sem update por >30min', 1),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Skip se ja alertou em janela de 1h (idempotente)', 2),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Chama enqueue_notification_event para prestador e cliente em provider_inactivity_alert', 3),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Apos >60min escala para support_ticket via escalate_inactivity', 4),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Audit em service_atypical_events kind=provider_inactivity_alert', 5),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'Service role via createAdminClient (server-only)', 6),

-- T-298 noshow-realloc
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'Edge Function provider-noshow-realloc deployada', 0),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'Detecta SRs scheduled_for + tolerancia <= NOW sem check-in', 1),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'Skip se ja existe atypical_event(provider_noshow_detected) para SR (idempotente)', 2),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'RPC record_provider_noshow incrementa counter (T-291 trigger auto-suspende em 3)', 3),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'apply_score_penalty aplica delta de no-show no score do prestador', 4),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'transition_service_status chama queued e start_matching_round exclui o provider que falhou', 5),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'enqueue_notification_event para cliente (busca novo) e prestador (penalidade)', 6),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'Audit em service_atypical_events kinds detected/realloc', 7),

-- T-299 ScopeChangeSheet UI
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'ResponsiveSheet (size=md) renderizado com Field/FormBody/Input/Textarea (sem Dialog cru)', 0),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Foto obrigatoria via input file accept=image/* capture=environment', 1),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Field hint mostra faixa permitida (categoria_min - categoria_max) inline', 2),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Botao Enviar disabled quando valor fora da faixa OU sem foto', 3),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Submit faz upload da foto antes do POST scope-change', 4),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Idempotency-key estavel scope-change-{sr_id}-{ts}', 5),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Erro de API mostra showErrorToast e mantem sheet aberto', 6),
('c15a751f-2460-40d8-99cb-45e13dda6e8e', 'Mobile-first verificado em viewport <768px', 7),

-- T-300 MaterialRequestSheet + InvoicePage UI
('e43b1102-197b-460f-b33c-3c07be51f010', 'ResponsiveSheet MaterialRequestSheet com Field/FormBody/Input', 0),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Foto orcamento via camera capture=environment', 1),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Tela /materials/[mid]/invoice criada com upload de NF (PDF ou imagem)', 2),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Stepper desabilita Retomar enquanto status=approved e invoice_path null', 3),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Pos-attach NF redireciona para /(provider)/services/[id]/in-progress', 4),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Warning UI quando invoice_cents > estimated_cents * 1.5', 5),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Idempotency-key estavel nos 2 fluxos (material-{} e invoice-{})', 6),
('e43b1102-197b-460f-b33c-3c07be51f010', 'Mobile-first', 7),

-- T-301 RevisitSheet + AdditionalItemSheet UI
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'RevisitSheet com radio attribution + Field para reason/date/slot', 0),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'Quando attribution=client_attributable mostra travel_fee_cents inline', 1),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'Input date com min=today (sem datas no passado)', 2),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'AdditionalItemSheet com Field description/estimated_cents/category_slug', 3),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'Apos response same_specialty=false: Sonner com instrucao redirect', 4),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'Footer hint "Adicionais nao registrados podem afetar seu score" sempre visivel', 5),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'DropdownMenu integrado no ExecutionStepper com 4 opcoes (diagnostico/material/retorno/adicional)', 6),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'Idempotency-key estavel nos 2 sheets', 7),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'Mobile-first', 8),

-- T-302 ClientAbsentFlow + PendingActionBanner
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Tela /(provider)/services/[id]/client-absent criada com countdown 15min', 0),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Botao Cliente ausente disabled antes dos 15min', 1),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Geolocation API capturada lazy (apos clicar) com enableHighAccuracy=true', 2),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Validacao client-side: accuracy <5000m antes de submit', 3),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'PendingActionBanner consulta service_atypical_events agregando 4 tipos pendentes', 4),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Quando pending.length > 0, ExecutionStepper esconde menu + e mostra banner', 5),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Banner com countdown e CTA Ver detalhes para resolver pendencia', 6),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'ConfirmDialog usado antes de registrar Cliente ausente (sem window.confirm)', 7),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Realtime via canal service:{id} (T-081) atualiza banner sem refresh', 8),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'Mobile-first; sticky CTA bottom no client-absent', 9),

-- T-303 ClientDecisionDialog UI
('52605714-2ca9-4778-be94-ee1d7a091395', 'ResponsiveDialog generico com prop proposalKind (4 sabores)', 0),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Countdown decrescente quando expires_at presente; muda cor amarelo<60s vermelho<15s', 1),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Hook useClientPendingProposals subscribe canal service:{id} (T-081)', 2),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Botoes Aprovar/Rejeitar com idempotency-key estavel decide-{kind}-{id}-{outcome}', 3),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Para revisit: botao Propor outra data com Input type=date', 4),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Apos expires_at, botoes ficam disabled e dialog mostra "Proposta expirou"', 5),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Queue de mais antigo primeiro quando ha multiplas pendentes', 6),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Erros mapeados via showErrorToast (403/409/410/422)', 7),
('52605714-2ca9-4778-be94-ee1d7a091395', 'Mobile-first verificado', 8),

-- T-304 OPS app_config + bucket + cron
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'Migration aplicada via psql', 0),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', '8 chaves seedadas em app_config (atypical_decision_deadline_minutes, client_absent_wait_minutes, provider_inactivity_threshold_minutes, provider_inactivity_escalation_minutes, noshow_tolerance_minutes, no_show_threshold, taxa_visita_cents, taxa_deslocamento_cents)', 1),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'Bucket service-materials criado privado com RLS por path', 2),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'Policies de SELECT e INSERT no storage.objects (cliente/prestador alocados)', 3),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'pg_cron job provider-inactivity-watchdog agendado a cada 5min', 4),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'pg_cron job provider-noshow-realloc agendado a cada 5min', 5),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'Bearer token via setting zelar.cron_token (sem hardcode em SQL)', 6),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'ON CONFLICT DO NOTHING preserva valores existentes em re-run', 7);


-- ============================================================================
-- 4. TaskDependency (kind lowercase: blocks | relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES

-- T-285 service_atypical_events depende de T-070 (service_requests existir)
('aacb08b8-cf42-4d93-9198-855c5bf8d425',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'blocks'),
('aacb08b8-cf42-4d93-9198-855c5bf8d425',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-226'), 'relates_to'),

-- T-286 scope_changes depende de T-285 (audit) + T-231 (pending_states) + T-070
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('4be3f653-666e-40f9-bbab-c0ae5a8d6fb4',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-231'), 'blocks'),

-- T-287 material_requests depende de T-285 + T-231 (pending_states bloqueia retomada)
('6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('6eecd90e-27de-4e3d-8893-3ca88a1deafd',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-231'), 'blocks'),

-- T-288 revisits depende de T-285 + T-161/T-162 (schedule_notification)
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('3fde0b8f-4f4b-4341-8756-76c7f15a6d8d',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-161'), 'relates_to'),

-- T-289 additional_items depende de T-285 + T-070
('1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),

-- T-290 client_absences depende de T-285 + T-178 (messages para count chat)
('538ce1d7-bdb1-4193-890a-96d4641a54df', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('538ce1d7-bdb1-4193-890a-96d4641a54df',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-178'), 'relates_to'),

-- T-291 noshow_counters depende de T-285 + T-034 + T-035 + T-162
('bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-034'), 'blocks'),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-035'), 'blocks'),
('bc302aa0-a42f-46d4-918c-f3dd5bb19548',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'relates_to'),

-- T-292 API scope-change depende de T-286 + T-231 + T-235 (transition)
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2', '4be3f653-666e-40f9-bbab-c0ae5a8d6fb4', 'blocks'),
('6c44a8e4-f82e-474c-b04d-5578e1bea0e2',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'relates_to'),

-- T-293 API material depende de T-287 + T-231 + bucket OPS T-304
('835b8733-1920-4467-b322-89c66faf69c8', '6eecd90e-27de-4e3d-8893-3ca88a1deafd', 'blocks'),
('835b8733-1920-4467-b322-89c66faf69c8', 'b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'blocks'),

-- T-294 API revisit depende de T-288 + T-162 schedule_notification
('620f698f-fbc4-45e7-85b0-502582e4ae05', '3fde0b8f-4f4b-4341-8756-76c7f15a6d8d', 'blocks'),
('620f698f-fbc4-45e7-85b0-502582e4ae05',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'blocks'),

-- T-295 API additional depende de T-289
('b77889ce-5236-46e7-8101-9ca13f6d3233', '1d164acb-d94d-4a66-9f9b-8908c191e9ae', 'blocks'),

-- T-296 API client-absent depende de T-290 + T-178 (messages count) + T-235
('b6e052e8-87c0-4990-b789-1e98e061934e', '538ce1d7-bdb1-4193-890a-96d4641a54df', 'blocks'),
('b6e052e8-87c0-4990-b789-1e98e061934e',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-178'), 'relates_to'),
('b6e052e8-87c0-4990-b789-1e98e061934e',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),

-- T-297 watchdog depende de T-285 + T-147 (support_tickets) + T-162 + cron (T-304)
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('190a560c-348d-468b-8676-d9a1e4d2c0f4',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'blocks'),
('190a560c-348d-468b-8676-d9a1e4d2c0f4',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'blocks'),
('190a560c-348d-468b-8676-d9a1e4d2c0f4', 'b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'blocks'),

-- T-298 noshow-realloc depende de T-285 + T-291 + T-241 (compute_score) + T-238 (matching_round) + T-244 (start round) + cron (T-304)
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'blocks'),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'bc302aa0-a42f-46d4-918c-f3dd5bb19548', 'blocks'),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-241'), 'relates_to'),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-238'), 'blocks'),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-244'), 'blocks'),
('6c94b6a2-d7b4-49a8-9df6-d2b0c577b9be', 'b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'blocks'),

-- T-299 ScopeChangeSheet UI depende de T-292 API + ExecutionStepper US-005 (T-274 nao listado mas existe)
('c15a751f-2460-40d8-99cb-45e13dda6e8e', '6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'blocks'),

-- T-300 Material UI depende de T-293 + bucket T-304
('e43b1102-197b-460f-b33c-3c07be51f010', '835b8733-1920-4467-b322-89c66faf69c8', 'blocks'),
('e43b1102-197b-460f-b33c-3c07be51f010', 'b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303', 'blocks'),

-- T-301 Revisit + Additional UI depende de T-294 + T-295
('3c658d5f-d6a5-4250-a6db-956c423a3a24', '620f698f-fbc4-45e7-85b0-502582e4ae05', 'blocks'),
('3c658d5f-d6a5-4250-a6db-956c423a3a24', 'b77889ce-5236-46e7-8101-9ca13f6d3233', 'blocks'),

-- T-302 ClientAbsentFlow + PendingActionBanner depende de T-296 + T-285 (banner consulta atypical events) + T-081 (Realtime) + ConfirmDialog
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'b6e052e8-87c0-4990-b789-1e98e061934e', 'blocks'),
('5e8d949c-417b-4351-9dad-4ae80579bda0', 'aacb08b8-cf42-4d93-9198-855c5bf8d425', 'relates_to'),
('5e8d949c-417b-4351-9dad-4ae80579bda0',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-081'), 'blocks'),
('5e8d949c-417b-4351-9dad-4ae80579bda0',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-186'), 'relates_to'),

-- T-303 ClientDecisionDialog UI depende dos 4 endpoints API + T-081 Realtime
('52605714-2ca9-4778-be94-ee1d7a091395', '6c44a8e4-f82e-474c-b04d-5578e1bea0e2', 'blocks'),
('52605714-2ca9-4778-be94-ee1d7a091395', '835b8733-1920-4467-b322-89c66faf69c8', 'blocks'),
('52605714-2ca9-4778-be94-ee1d7a091395', '620f698f-fbc4-45e7-85b0-502582e4ae05', 'blocks'),
('52605714-2ca9-4778-be94-ee1d7a091395', 'b77889ce-5236-46e7-8101-9ca13f6d3233', 'blocks'),
('52605714-2ca9-4778-be94-ee1d7a091395',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-081'), 'blocks'),

-- T-304 OPS depende de T-019 (app_config existir) + T-127/T-153 (relates_to outros crons)
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-126'), 'relates_to'),
('b3c3275d-5d8e-4b84-a3c0-30b7ff5ed303',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-158'), 'relates_to');


COMMIT;
