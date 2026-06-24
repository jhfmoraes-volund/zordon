-- Backlog Zordon — ZLAR-V2-US-021 (Engine anti-bypass: detecção, score R(o,c), escalonamento N1→N4)
-- Persona: SISTEMA | Módulo: MATCHING | AC: 15
-- Gerado em 2026-05-09 via /task-gen-story (modo orquestrado v3)
--
-- Apenas insere metadata em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). NÃO executa o DDL/CRUD descrito nas
-- descriptions — esses snippets são especificação pra implementação futura no
-- banco do produto Zelar.

BEGIN;

-- =============================================================================
-- 1. TASKS
-- =============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-250 (DATA) — bypass_signal_events
('667907cf-b08f-47b8-b9a2-817bf91368b2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-250',
 'Criar enum bypass_signal_kind + tabela bypass_signal_events (sinais detectados)',
 $desc$## Objetivo
Persistir cada sinal anti-bypass detectado para um par cliente-prestador, incluindo o tipo (cancelamento recorrente, NLP em chat/avaliação, denúncia direta, recontratação no mesmo endereço), peso configurável, snapshot de evidência (jsonb), janela de validade (calculada via `valid_until` para suportar expiração natural do AC#6), e flag `marked_false_positive` para revisão manual da equipe (AC#13). Cobre AC #2, #3, #4, #5, #6, #13.

## Contexto
Módulo MATCHING — fundação da engine anti-bypass. Escrita por: Edge Function `detect-bypass-signals` (T-256) e `moderate-message` estendida (T-257), endpoint de denúncia (T-260). Lida pela view `bypass_pair_risk_v` (T-251) que soma pesos por par. Marcação de falso-positivo via PATCH admin (T-260) zera contribuição sem deletar (preserva audit). Mantém princípio do AC#1 — monitoramento silencioso, sem expor flag ao usuário.

## Estado atual / O que substitui
Não existe. Sinais hoje não têm armazenamento. Tabelas adjacentes: `message_moderation_logs` (T-178) já loga moderação de mensagens — esta tabela é dimensão diferente (par, não mensagem) e não duplica.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_bypass_signal_events.sql`
```sql
BEGIN;

CREATE TYPE bypass_signal_kind AS ENUM (
  'cancel_recurrent',          -- AC#2: cliente cancelou 2+ vezes mesmo prestador em 60d
  'nlp_chat',                  -- AC#3: NLP detectou termo em mensagem
  'nlp_review',                -- AC#3: NLP detectou termo em avaliação
  'manual_report',             -- AC#4: denúncia humana confirmada
  'rehire_same_address'        -- AC#5: par recontratou mesmo endereço em 30d
);

CREATE TABLE bypass_signal_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id              uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  kind                     bypass_signal_kind NOT NULL,
  weight                   numeric(6,3) NOT NULL,        -- snapshot do peso lido de app_config
  evidence                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- evidence shape varia por kind; exemplos:
  -- cancel_recurrent: {service_request_ids: [...], cancel_count: N}
  -- nlp_chat: {message_id: ..., terms_matched: ["whatsapp"], confidence: 0.92}
  -- manual_report: {report_id: ..., reporter_id: ..., service_request_id: ...}
  -- rehire_same_address: {address_hash: ..., rehire_count: 2, prior_sr_id: ...}
  detected_at              timestamptz NOT NULL DEFAULT NOW(),
  valid_until              timestamptz NOT NULL,         -- janela do sinal (60d ou 30d)
  marked_false_positive    boolean NOT NULL DEFAULT false,
  marked_false_positive_by uuid REFERENCES auth.users(id),
  marked_false_positive_at timestamptz,
  marked_false_positive_reason text,
  source_service_request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  "createdAt"              timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"              timestamptz NOT NULL DEFAULT NOW(),
  CHECK (valid_until > detected_at),
  CHECK (
    (marked_false_positive = false AND marked_false_positive_by IS NULL AND marked_false_positive_at IS NULL)
    OR
    (marked_false_positive = true  AND marked_false_positive_by IS NOT NULL AND marked_false_positive_at IS NOT NULL)
  )
);

CREATE INDEX idx_bypass_signals_pair_active
  ON bypass_signal_events(client_id, provider_id, valid_until)
  WHERE marked_false_positive = false;

CREATE INDEX idx_bypass_signals_kind_detected
  ON bypass_signal_events(kind, detected_at);

-- Idempotência: evita 2x a mesma evidência (chat/review/report já registrados)
CREATE UNIQUE INDEX idx_bypass_signals_msg_unique
  ON bypass_signal_events((evidence->>'message_id'))
  WHERE evidence ? 'message_id';

ALTER TABLE bypass_signal_events ENABLE ROW LEVEL SECURITY;

-- ADMIN lê tudo. Sem RLS pra outros papéis (engine roda em service_role).
CREATE POLICY "bypass_signals_admin_all" ON bypass_signal_events
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER bypass_signals_updated_at
  BEFORE UPDATE ON bypass_signal_events
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Expor sinais detectados ao usuário (cliente/prestador) — AC#1: monitoramento silencioso. Apenas ADMIN lê.
- ❌ Deletar sinal marcado como falso positivo — flag preserva audit (T-204 family pattern); zerar contribuição via WHERE na view T-251.
- ❌ Permitir `marked_false_positive=true` sem `marked_false_positive_by` (CHECK constraint).
- ❌ Inserir 2 sinais pra mesma message_id (UNIQUE INDEX idempotência).
- ❌ Calcular `valid_until` no SQL com NOW() + interval hardcoded — vem de `app_config.anti_bypass.window_*` snapshot na inserção (Edge Function lê config).

## Convenções
- `weight` é snapshot na hora da inserção; mudança em config futura não retroage
- `evidence jsonb` opaco com schema por kind (documentado no description)
- Família audit: mesma forma de `provider_moderation_log` (T-204), `dispute_decisions` (T-155)
- Reuso: `provider_profiles` (T-002), `service_requests` (T-070)$desc$,
 'DATA', 'ADMIN',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-251 (DATA) — bypass_pair_risk_state + view R(o,c)
('29499d84-aef8-467a-95f5-0af8d6db650d',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-251',
 'Criar tabela bypass_pair_risk_state + view bypass_pair_risk_v com R(o,c)',
 $desc$## Objetivo
Materializar score R(o,c) por par como soma ponderada dos sinais ativos (não-expirados, não-falso-positivo) lendo de `bypass_signal_events` (T-250). Tabela `bypass_pair_risk_state` cacheia o score atual para queries rápidas no painel admin (AC#15) e para a engine de evaluator (T-258); view `bypass_pair_risk_v` deriva valor live para auditoria. Score expira naturalmente quando todos os sinais expiram (AC#6). Cobre AC #6, #15.

## Contexto
Módulo MATCHING. Atualizada por trigger em `bypass_signal_events` (INSERT/UPDATE/DELETE invalida cache do par afetado) ou recalculada por job pg_cron (T-262, a cada 1min) — abordagem dupla pra robustez. View consultada por ADMIN UI; tabela consultada por engine na quente.

## Estado atual / O que substitui
Não existe. Não há cache de score hoje.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_bypass_pair_risk.sql`
```sql
BEGIN;

CREATE TABLE bypass_pair_risk_state (
  client_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id    uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  current_score  numeric(8,3) NOT NULL DEFAULT 0,
  active_signals_count int NOT NULL DEFAULT 0,
  highest_signal_kind  bypass_signal_kind,
  computed_at    timestamptz NOT NULL DEFAULT NOW(),
  next_signal_expires_at timestamptz, -- pra job pg_cron saber quando recomputar
  PRIMARY KEY (client_id, provider_id)
);

CREATE INDEX idx_bypass_pair_risk_score
  ON bypass_pair_risk_state(current_score DESC)
  WHERE current_score > 0;
CREATE INDEX idx_bypass_pair_risk_next_expire
  ON bypass_pair_risk_state(next_signal_expires_at)
  WHERE next_signal_expires_at IS NOT NULL;

ALTER TABLE bypass_pair_risk_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bypass_pair_risk_admin_all" ON bypass_pair_risk_state
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- View live (deriva da fonte; cache pode estar stale por <1min)
CREATE OR REPLACE VIEW bypass_pair_risk_v
WITH (security_invoker = true) AS
SELECT
  s.client_id,
  s.provider_id,
  COALESCE(SUM(s.weight) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()), 0) AS live_score,
  COUNT(*) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()) AS active_count,
  MAX(s.detected_at) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()) AS last_signal_at,
  MIN(s.valid_until) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()) AS first_to_expire,
  jsonb_object_agg(
    s.kind::text,
    jsonb_build_object(
      'count', COUNT(*) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()),
      'sum_weight', COALESCE(SUM(s.weight) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()), 0)
    )
  ) FILTER (WHERE s.marked_false_positive = false AND s.valid_until > NOW()) AS breakdown_by_kind
FROM bypass_signal_events s
GROUP BY s.client_id, s.provider_id;

-- RPC pra recomputar 1 par (chamada pelo trigger e pelo job)
CREATE OR REPLACE FUNCTION recompute_pair_risk(p_client uuid, p_provider uuid)
RETURNS bypass_pair_risk_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v bypass_pair_risk_state%ROWTYPE;
BEGIN
  SELECT
    p_client, p_provider,
    COALESCE(SUM(weight) FILTER (WHERE marked_false_positive = false AND valid_until > NOW()), 0),
    COUNT(*) FILTER (WHERE marked_false_positive = false AND valid_until > NOW()),
    (SELECT kind FROM bypass_signal_events
       WHERE client_id = p_client AND provider_id = p_provider
         AND marked_false_positive = false AND valid_until > NOW()
       ORDER BY weight DESC, detected_at DESC LIMIT 1),
    NOW(),
    (SELECT MIN(valid_until) FROM bypass_signal_events
       WHERE client_id = p_client AND provider_id = p_provider
         AND marked_false_positive = false AND valid_until > NOW())
  INTO v.client_id, v.provider_id, v.current_score, v.active_signals_count,
       v.highest_signal_kind, v.computed_at, v.next_signal_expires_at
  FROM bypass_signal_events
  WHERE client_id = p_client AND provider_id = p_provider;

  INSERT INTO bypass_pair_risk_state AS bp VALUES
    (v.client_id, v.provider_id, v.current_score, v.active_signals_count,
     v.highest_signal_kind, v.computed_at, v.next_signal_expires_at)
  ON CONFLICT (client_id, provider_id) DO UPDATE
    SET current_score=EXCLUDED.current_score,
        active_signals_count=EXCLUDED.active_signals_count,
        highest_signal_kind=EXCLUDED.highest_signal_kind,
        computed_at=EXCLUDED.computed_at,
        next_signal_expires_at=EXCLUDED.next_signal_expires_at
  RETURNING * INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION recompute_pair_risk(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_pair_risk(uuid,uuid) TO service_role;

-- Trigger: invalida cache no par afetado quando signal muda
CREATE OR REPLACE FUNCTION trg_bypass_signal_recompute_pair()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recompute_pair_risk(
    COALESCE(NEW.client_id, OLD.client_id),
    COALESCE(NEW.provider_id, OLD.provider_id)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER bypass_signal_recompute_after_change
  AFTER INSERT OR UPDATE OR DELETE ON bypass_signal_events
  FOR EACH ROW EXECUTE FUNCTION trg_bypass_signal_recompute_pair();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Pular cache (sempre derivar da view) — UI admin com 100k+ pares precisa de read rápido.
- ❌ Recalcular sem trigger E sem job — uma das duas falha (job pode atrasar; trigger pode skipar em INSERT batch). Belt + suspenders.
- ❌ Filtrar `marked_false_positive=false` na PRIMARY KEY — flag muda durante vida do sinal; PK estável é (client, provider).
- ❌ Permitir SELECT por authenticated não-admin — score expõe identidade do par com risco (LGPD).

## Convenções
- View `security_invoker` respeita RLS do caller; cache table tem RLS própria
- `next_signal_expires_at` permite job dormir até o próximo evento de expiração (eficiência)
- Reuso: padrão de cache+view+trigger; `bypass_signal_events` (T-250)$desc$,
 'DATA', 'ADMIN',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','MATERIALIZED_VIEW'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-252 (DATA) — bypass_pair_levels (escalonamento N1-N4)
('81cd1975-f330-4718-8ba0-9822408918ec',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-252',
 'Criar enum bypass_level + tabela bypass_pair_levels (histórico de escalações)',
 $desc$## Objetivo
Persistir o histórico de escalonamento de nível de risco N1→N4 por par cliente-prestador, capturando trigger (score atingido vs denúncia direta), snapshot do score que originou, ações aplicadas (notificação educativa, separação no matching, suspensão investigativa, desativação), e estado atual ativo. Cobre AC #7, #8.

## Contexto
Módulo MATCHING. Escrita por RPC `apply_pair_level` (T-259). Consultada por: engine de matching (T-243) — `start-matching` filtra pool excluindo pares com level=N2 ativo; UI admin (T-261); endpoint defesa (relates_to T-039 estendida).

## Estado atual / O que substitui
Não existe. T-204 (`provider_moderation_log`) é log de ações por prestador único; aqui é por **par** (cliente, prestador).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_bypass_pair_levels.sql`
```sql
BEGIN;

CREATE TYPE bypass_level AS ENUM ('N0','N1','N2','N3','N4');
-- N0 = baseline (sem level ativo)
-- N1 = educação preventiva (notificação separada, sem impacto)
-- N2 = aviso formal + separação do par no matching por 30d
-- N3 = suspensão investigativa global do prestador (até 72h, defesa)
-- N4 = penalidade definitiva pós-investigação (ou imediato em denúncia)

CREATE TYPE bypass_level_trigger AS ENUM (
  'score_threshold',     -- AC#7: score atingiu limiar do nível
  'manual_report_confirmed', -- AC#8: denúncia direta → N4 imediato
  'admin_manual',        -- ADMIN forçou nível
  'no_appeal_in_window'  -- AC#12: prestador não defendeu em 72h → N4 auto
);

CREATE TABLE bypass_pair_levels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id     uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  level           bypass_level NOT NULL,
  prior_level     bypass_level,
  trigger_kind    bypass_level_trigger NOT NULL,
  score_snapshot  numeric(8,3),
  signals_snapshot jsonb,                  -- [{id, kind, weight, detected_at}, ...]
  separation_until timestamptz,            -- N2: ate quando o par fica separado no matching
  effective_at    timestamptz NOT NULL DEFAULT NOW(),
  superseded_at   timestamptz,             -- preenchida quando outra escalação ocorre
  ack_required    boolean NOT NULL DEFAULT false,
  ack_at          timestamptz,
  notes           text,                    -- nota do admin (em admin_manual)
  applied_by      uuid REFERENCES auth.users(id), -- NULL se sistema
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

-- Apenas 1 nível ativo por par (superseded_at IS NULL)
CREATE UNIQUE INDEX idx_bypass_pair_levels_active_unique
  ON bypass_pair_levels(client_id, provider_id)
  WHERE superseded_at IS NULL;

CREATE INDEX idx_bypass_pair_levels_active
  ON bypass_pair_levels(level)
  WHERE superseded_at IS NULL;

-- Index pra engine de matching consultar separação ativa rapido
CREATE INDEX idx_bypass_pair_levels_separation
  ON bypass_pair_levels(client_id, provider_id, separation_until)
  WHERE level = 'N2' AND separation_until > NOW();

ALTER TABLE bypass_pair_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bypass_pair_levels_admin_all" ON bypass_pair_levels
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER bypass_pair_levels_updated_at
  BEFORE UPDATE ON bypass_pair_levels
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir 2 níveis ativos pra mesmo par (UNIQUE INDEX trava).
- ❌ Modelar como tabela "current_level" (sobrescrita) — perde histórico de escalações que ops pode auditar.
- ❌ Excluir cliente/prestador → CASCADE perde histórico (decisão: cascade pra MVP — em produção considerar SET NULL e manter row pra LGPD/audit).
- ❌ Permitir `superseded_at` no passado sem nova linha de nível atual — invariante: ou tem 1 ativo, ou par está em N0 implícito.

## Convenções
- N0 implícito (não persiste linha N0; ausência de row ativo == N0)
- `signals_snapshot` é foto do estado no momento da escalação pra auditoria
- Reuso: padrão de log com `superseded_at` similar a `notification_templates` versioning (T-216)$desc$,
 'DATA', 'ADMIN',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-253 (DATA) — bypass_penalty_events
('359d7f63-1c1a-4e79-b278-986527f0d8a9',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-253',
 'Criar enum bypass_penalty_kind + tabela bypass_penalty_events com escalonamento por ocorrência',
 $desc$## Objetivo
Persistir cada penalidade aplicada a um actor (cliente OU prestador) com tipo (advertência, suspensão, comissão elevada, taxa adicional, desativação permanente), duração quando aplicável, e contador de ocorrência. Permite materializar AC#9 (1ª/2ª/3ª prestador) e AC#10 (1ª/2ª/3ª cliente) e calcular qual penalidade aplicar na próxima ocorrência. Cobre AC #9, #10.

## Contexto
Módulo MATCHING. Escrita por RPC `apply_penalty` (T-259). Lida por: engine de matching (consulta comissão elevada ativa), `compute_provider_score` (T-241) extendida pra ler `temporary_freq_reduction`, billing (consulta `commission_override_until` e `convenience_fee_override_until`).

## Estado atual / O que substitui
Não existe. `provider_moderation_log` (T-204) é log de ações ADMIN; aqui é log de penalidade automática derivada de bypass.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_bypass_penalty_events.sql`
```sql
BEGIN;

CREATE TYPE bypass_actor_role AS ENUM ('client','provider');

CREATE TYPE bypass_penalty_kind AS ENUM (
  'formal_warning',                -- AC#9.1, AC#10.1: advertencia
  'commission_elevated',           -- AC#9: comissão da plataforma elevada
  'frequency_reduction_temp',      -- AC#9: reducao temporária de F no score
  'monitoring_intensified',        -- AC#10.1: monitoramento extra
  'suspension_temporary',          -- AC#9.2 (30d), AC#10.2 (15d)
  'convenience_fee_added',         -- AC#10.2: taxa convenience adicional
  'permanent_deactivation',        -- AC#9.3, AC#10.3
  'cpf_blocklist'                  -- AC#9.3, AC#10.3, AC#14
);

CREATE TABLE bypass_penalty_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_role          bypass_actor_role NOT NULL,
  actor_id            uuid NOT NULL,                     -- auth.users(id) sempre
  related_pair_level_id uuid REFERENCES bypass_pair_levels(id) ON DELETE SET NULL,
  occurrence_index    int NOT NULL,                      -- 1, 2, 3 (snapshot na hora)
  penalty_kind        bypass_penalty_kind NOT NULL,
  parameters          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- shape varia por kind:
  -- commission_elevated: {"original_pct": 0.15, "new_pct": 0.25, "duration_days": 90}
  -- suspension_temporary: {"duration_days": 30}
  -- frequency_reduction_temp: {"factor": 0.5, "duration_days": 90}
  -- convenience_fee_added: {"fee_pct": 0.05, "duration_days": 180}
  effective_from      timestamptz NOT NULL DEFAULT NOW(),
  effective_until     timestamptz,                       -- NULL pra penalidades permanentes
  applied_by          uuid REFERENCES auth.users(id),    -- NULL se automático
  reason              text,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW(),
  CHECK (occurrence_index BETWEEN 1 AND 3),
  CHECK (
    -- permanent kinds não têm effective_until
    (penalty_kind IN ('permanent_deactivation','cpf_blocklist','formal_warning','monitoring_intensified')
      AND effective_until IS NULL)
    OR
    (penalty_kind NOT IN ('permanent_deactivation','cpf_blocklist','formal_warning','monitoring_intensified')
      AND effective_until > effective_from)
  )
);

CREATE INDEX idx_bypass_penalty_actor
  ON bypass_penalty_events(actor_role, actor_id, effective_from DESC);

CREATE INDEX idx_bypass_penalty_active
  ON bypass_penalty_events(actor_role, actor_id, penalty_kind)
  WHERE effective_until IS NULL OR effective_until > NOW();

ALTER TABLE bypass_penalty_events ENABLE ROW LEVEL SECURITY;

-- ADMIN tudo. Actor lê suas próprias (transparência: prestador suspenso vê motivo).
CREATE POLICY "bypass_penalty_admin_all" ON bypass_penalty_events
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "bypass_penalty_actor_self" ON bypass_penalty_events
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

CREATE TRIGGER bypass_penalty_updated_at
  BEFORE UPDATE ON bypass_penalty_events
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

-- Helper: próxima ocorrência (lê do contador)
CREATE OR REPLACE FUNCTION next_bypass_occurrence(
  p_actor_role bypass_actor_role,
  p_actor_id   uuid
) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE(MAX(occurrence_index), 0) + 1
  FROM bypass_penalty_events
  WHERE actor_role = p_actor_role AND actor_id = p_actor_id
    AND penalty_kind IN ('formal_warning','suspension_temporary','permanent_deactivation');
  -- conta apenas eventos "principais" por ocorrência, não modificadores (commission_elevated)
$$;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir `occurrence_index` > 3 (CHECK constraint) — após 3, sempre permanent_deactivation.
- ❌ Esquecer policy `actor_self` — prestador suspenso precisa ver motivo (transparência LGPD/CDC).
- ❌ Aplicar `cpf_blocklist` sem chamar T-254 (cpf_blocklist tabela; aqui só registramos o evento).
- ❌ Misturar com `provider_moderation_log` (T-204 é ações ADMIN explícitas; T-253 é automatizadas pelo sistema).

## Convenções
- `actor_id` referencia `auth.users(id)` pra ambos client e provider (eles compartilham PK)
- `parameters jsonb` documentado por kind no description
- Reuso: padrão de event log com effective window (similar a T-204)$desc$,
 'DATA', 'ADMIN',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-254 (DATA) — cpf_blocklist
('31ee7c1c-03d7-48d2-8dd1-317a8e947297',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-254',
 'Criar tabela cpf_blocklist (insert-only) e gancho no fluxo de KYC',
 $desc$## Objetivo
Lista de bloqueio de CPFs desativados permanentemente (AC#9.3, AC#10.3, AC#14). Insertion-only (audit imutável); leitura no fluxo de KYC pra rejeitar cadastros mesmo quando usuário cria conta com email diferente. Cobre AC #14.

## Contexto
Módulo MATCHING (escopo cross-cutting). Escrita por RPC `apply_penalty` (T-259) ao executar `cpf_blocklist` ou `permanent_deactivation`. Lida por: hook na T-208 (`/api/admin/kyc/[id]/approve` que checa lista antes de aprovar) e idealmente por T-006 (`POST /api/onboarding/provider/signup`) pra recusar antes do KYC. CPF armazenado HASHED (sha256 + pepper) — LGPD; lookup é por hash.

## Estado atual / O que substitui
Não existe. KYC hoje (T-208) só verifica score Unico, não checa blocklist.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_cpf_blocklist.sql`
```sql
BEGIN;

CREATE TABLE cpf_blocklist (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf_hash          bytea NOT NULL UNIQUE,            -- sha256(cpf || pepper)
  reason            text NOT NULL,                    -- ex: "bypass_3rd_occurrence"
  related_actor_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  related_actor_role bypass_actor_role NOT NULL,
  related_penalty_id uuid REFERENCES bypass_penalty_events(id) ON DELETE SET NULL,
  applied_by        uuid REFERENCES auth.users(id),   -- NULL se automático
  blocked_at        timestamptz NOT NULL DEFAULT NOW(),
  notes             text,
  "createdAt"       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cpf_blocklist_actor ON cpf_blocklist(related_actor_id);

ALTER TABLE cpf_blocklist ENABLE ROW LEVEL SECURITY;

-- ADMIN lê tudo. Insert via service_role apenas (engine).
CREATE POLICY "cpf_blocklist_admin_read" ON cpf_blocklist
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Bloqueia UPDATE/DELETE mesmo de admin (audit imutável)
CREATE OR REPLACE FUNCTION block_cpf_blocklist_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cpf_blocklist is append-only';
END $$;

CREATE TRIGGER cpf_blocklist_no_update
  BEFORE UPDATE OR DELETE ON cpf_blocklist
  FOR EACH ROW EXECUTE FUNCTION block_cpf_blocklist_mutation();

-- Helper: verificar se cpf está bloqueado (chamada pelo KYC)
CREATE OR REPLACE FUNCTION is_cpf_blocked(p_cpf text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pepper text;
  v_hash bytea;
BEGIN
  v_pepper := current_setting('app.cpf_blocklist_pepper', true);
  IF v_pepper IS NULL THEN RAISE EXCEPTION 'cpf_pepper_not_configured'; END IF;
  v_hash := digest(p_cpf || v_pepper, 'sha256');
  RETURN EXISTS (SELECT 1 FROM cpf_blocklist WHERE cpf_hash = v_hash);
END $$;

REVOKE ALL ON FUNCTION is_cpf_blocked(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION is_cpf_blocked(text) TO service_role;

-- Helper: adicionar à blocklist (pgcrypto digest)
CREATE OR REPLACE FUNCTION add_to_cpf_blocklist(
  p_cpf            text,
  p_reason         text,
  p_actor_id       uuid,
  p_actor_role     bypass_actor_role,
  p_penalty_id     uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pepper text;
  v_hash bytea;
  v_id uuid;
BEGIN
  v_pepper := current_setting('app.cpf_blocklist_pepper', true);
  IF v_pepper IS NULL THEN RAISE EXCEPTION 'cpf_pepper_not_configured'; END IF;
  v_hash := digest(p_cpf || v_pepper, 'sha256');

  INSERT INTO cpf_blocklist (cpf_hash, reason, related_actor_id, related_actor_role, related_penalty_id)
  VALUES (v_hash, p_reason, p_actor_id, p_actor_role, p_penalty_id)
  ON CONFLICT (cpf_hash) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION add_to_cpf_blocklist(text,text,uuid,bypass_actor_role,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_to_cpf_blocklist(text,text,uuid,bypass_actor_role,uuid) TO service_role;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Armazenar CPF em plaintext — LGPD; usar hash sha256 com pepper (GUC `app.cpf_blocklist_pepper`).
- ❌ Permitir DELETE — audit imutável (trigger). Se necessário desbloquear, criar tabela `cpf_blocklist_overrides` em US futura.
- ❌ Permitir SELECT por authenticated não-admin — vazaria identidade de banidos.
- ❌ Esquecer de rodar `add_to_cpf_blocklist` ao aplicar `permanent_deactivation` (responsabilidade do RPC T-259).

## Convenções
- `pgcrypto` extension obrigatória (já presente no projeto via Supabase default)
- Pepper em GUC pra ficar fora do schema (rotacionável em mig futuro com strategy)
- Reuso: padrão append-only com trigger (T-204, T-239)$desc$,
 'DATA', 'ADMIN',
 ARRAY['RLS_REQUIRED','SECRET_HANDLING','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-255 (DATA) — bypass_reports (denúncias humanas)
('738832e5-dc67-4b33-b2aa-2a2de17138f4',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-255',
 'Criar tabela bypass_reports (denúncias manuais) com RLS por reportante + ADMIN',
 $desc$## Objetivo
Persistir denúncias manuais de tentativa de bypass feitas por cliente ou prestador via botão "Reportar bypass" no detalhe do serviço (AC#4). Quando ADMIN confirma, vira `bypass_signal_event` com peso máximo (AC#4) e dispara N4 imediato (AC#8). Cobre AC #4, #8.

## Contexto
Módulo MATCHING. Escrita por endpoint `POST /api/services/[id]/report-bypass` (T-260). Lida por painel admin (T-261). Confirmação dispara `apply_pair_level` com `trigger_kind='manual_report_confirmed'` → N4 imediato.

## Estado atual / O que substitui
Não existe. `support_tickets` (T-136) é generic; bypass_reports é vertical específica.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_bypass_reports.sql`
```sql
BEGIN;

CREATE TYPE bypass_report_status AS ENUM (
  'pending_review',
  'confirmed',          -- ADMIN confirmou → vira signal + N4 imediato
  'rejected',           -- denuncia infundada
  'duplicate'
);

CREATE TABLE bypass_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id    uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id           uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  reporter_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_role         bypass_actor_role NOT NULL,    -- quem reportou
  description           text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 2000),
  evidence_attachments  jsonb DEFAULT '[]'::jsonb,     -- [{name, url, size}, ...]
  status                bypass_report_status NOT NULL DEFAULT 'pending_review',
  reviewed_by           uuid REFERENCES auth.users(id),
  reviewed_at           timestamptz,
  review_notes          text,
  resulting_signal_id   uuid REFERENCES bypass_signal_events(id) ON DELETE SET NULL,
  resulting_level_id    uuid REFERENCES bypass_pair_levels(id) ON DELETE SET NULL,
  "createdAt"           timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"           timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bypass_reports_status_created
  ON bypass_reports(status, "createdAt" DESC);
CREATE INDEX idx_bypass_reports_pair
  ON bypass_reports(client_id, provider_id);
CREATE INDEX idx_bypass_reports_service_request
  ON bypass_reports(service_request_id);

-- Idempotência: 1 reporter não denuncia o mesmo SR 2x em pending_review
CREATE UNIQUE INDEX idx_bypass_reports_one_pending_per_reporter_sr
  ON bypass_reports(reporter_id, service_request_id)
  WHERE status = 'pending_review';

ALTER TABLE bypass_reports ENABLE ROW LEVEL SECURITY;

-- Reporter lê suas próprias denúncias
CREATE POLICY "bypass_reports_reporter_self" ON bypass_reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- Reporter pode INSERT (id = auth.uid)
CREATE POLICY "bypass_reports_reporter_insert" ON bypass_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- ADMIN tudo
CREATE POLICY "bypass_reports_admin_all" ON bypass_reports
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER bypass_reports_updated_at
  BEFORE UPDATE ON bypass_reports
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir reporter ler denúncias de outros — RLS isola por `reporter_id`.
- ❌ Confirmar denúncia sem chamar T-259 (apply_pair_level) — confirmação SEM consequência quebra AC#8.
- ❌ Permitir reporter UPDATE após criar — denúncia é imutável do lado do reporter; ADMIN edita status.
- ❌ Texto de denúncia < 20 chars — ruído (CHECK constraint).

## Convenções
- `evidence_attachments` opaco; UI usa storage bucket `bypass-evidences` (idêntico a T-036)
- Reuso: padrão de RLS isolado por reporter de `support_tickets` (T-136)$desc$,
 'DATA', 'ANY',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-256 (API) — Edge Function detect-bypass-signals
('38db0d90-433e-444f-a174-95340e5742ba',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-256',
 'Implementar Edge Function detect-bypass-signals (cancel recorrente + recontratação 30d)',
 $desc$## Objetivo
Edge Function chamada por pg_cron (T-262) periodicamente que varre `service_requests` recentes pra detectar dois sinais sem trigger natural: (a) cancelamento recorrente do cliente após aceite do mesmo prestador 2+ vezes em 60 dias (AC#2), peso alto isolado; (b) recontratação do mesmo par no mesmo endereço em 30 dias (AC#5), peso baixo isolado. Sinais NLP de chat são por T-257 (extensão de T-181). Cobre AC #2, #5.

## Contexto
Módulo MATCHING. Idempotente — UNIQUE INDEX em `bypass_signal_events` por `evidence->>'message_id'` previne dupla inserção (mas pra estes sinais usamos hash `service_request_ids[]`). Lê pesos de `app_config.anti_bypass.weight_*`.

## Estado atual / O que substitui
Não existe. Sinais não são detectados hoje.

## O que criar

### `supabase/functions/detect-bypass-signals/index.ts`
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createHash } from 'node:crypto';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Carrega pesos e janelas
  const { data: cfg } = await supabase.from('app_config').select('key,value').in('key', [
    'anti_bypass.weight_cancel_recurrent',
    'anti_bypass.weight_rehire_same_address',
    'anti_bypass.window_cancel_days',
    'anti_bypass.window_rehire_days',
    'anti_bypass.cancel_recurrent_threshold',
  ]);
  const m = Object.fromEntries((cfg ?? []).map(c => [c.key, c.value]));
  const wCancel = Number(m['anti_bypass.weight_cancel_recurrent'] ?? 5);
  const wRehire = Number(m['anti_bypass.weight_rehire_same_address'] ?? 0.5);
  const winCancel = Number(m['anti_bypass.window_cancel_days'] ?? 60);
  const winRehire = Number(m['anti_bypass.window_rehire_days'] ?? 30);
  const cancelThreshold = Number(m['anti_bypass.cancel_recurrent_threshold'] ?? 2);

  // === SINAL 1: cancelamento recorrente cliente→provider em janela ===
  // Detecta via SQL agregada
  const { data: cancelGroups } = await supabase.rpc('detect_cancel_recurrent_pairs', {
    p_window_days: winCancel,
    p_threshold: cancelThreshold,
  });

  let cancelInserted = 0;
  for (const g of cancelGroups ?? []) {
    const evidenceHash = createHash('sha256')
      .update(`cancel:${g.client_id}:${g.provider_id}:${g.last_cancel_at}`)
      .digest('hex');

    const { error } = await supabase.from('bypass_signal_events').insert({
      client_id: g.client_id,
      provider_id: g.provider_id,
      kind: 'cancel_recurrent',
      weight: wCancel,
      evidence: {
        evidence_hash: evidenceHash,
        service_request_ids: g.service_request_ids,
        cancel_count: g.cancel_count,
      },
      valid_until: new Date(Date.now() + winCancel * 86400_000).toISOString(),
    });
    if (!error) cancelInserted++;
    // Conflict (UNIQUE em evidence_hash via partial index ou check) é OK
  }

  // === SINAL 2: recontratação mesmo par mesmo endereço em 30d ===
  const { data: rehireGroups } = await supabase.rpc('detect_rehire_same_address_pairs', {
    p_window_days: winRehire,
  });

  let rehireInserted = 0;
  for (const g of rehireGroups ?? []) {
    const { error } = await supabase.from('bypass_signal_events').insert({
      client_id: g.client_id,
      provider_id: g.provider_id,
      kind: 'rehire_same_address',
      weight: wRehire,
      evidence: {
        address_hash: g.address_hash,
        rehire_count: g.rehire_count,
        service_request_ids: g.service_request_ids,
      },
      valid_until: new Date(Date.now() + winRehire * 86400_000).toISOString(),
    });
    if (!error) rehireInserted++;
  }

  return Response.json({
    cancel_signals_inserted: cancelInserted,
    rehire_signals_inserted: rehireInserted,
  });
});
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_detect_bypass_helpers.sql`
```sql
CREATE OR REPLACE FUNCTION detect_cancel_recurrent_pairs(
  p_window_days int,
  p_threshold   int
)
RETURNS TABLE (
  client_id uuid,
  provider_id uuid,
  cancel_count bigint,
  last_cancel_at timestamptz,
  service_request_ids uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sr.client_id,
    sr.provider_id,
    COUNT(*) AS cancel_count,
    MAX(sr."updatedAt") AS last_cancel_at,
    ARRAY_AGG(sr.id) AS service_request_ids
  FROM service_requests sr
  WHERE sr.status = 'cancelled_by_client'
    AND sr."updatedAt" > NOW() - (p_window_days || ' days')::interval
    AND sr.provider_id IS NOT NULL
    -- AC#2 exceção: cancelamento por reajuste/escopo NÃO conta
    AND NOT EXISTS (
      SELECT 1 FROM service_events se
      WHERE se.service_request_id = sr.id
        AND se.kind IN ('client_rejected_revision','client_rejected_scope_change')
    )
  GROUP BY sr.client_id, sr.provider_id
  HAVING COUNT(*) >= p_threshold;
$$;

CREATE OR REPLACE FUNCTION detect_rehire_same_address_pairs(
  p_window_days int
)
RETURNS TABLE (
  client_id uuid,
  provider_id uuid,
  address_hash text,
  rehire_count bigint,
  service_request_ids uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sr.client_id,
    sr.provider_id,
    encode(digest(sr.address_full, 'sha256'), 'hex') AS address_hash,
    COUNT(*) AS rehire_count,
    ARRAY_AGG(sr.id ORDER BY sr."createdAt") AS service_request_ids
  FROM service_requests sr
  WHERE sr.status = 'completed'
    AND sr."createdAt" > NOW() - (p_window_days || ' days')::interval
    AND sr.provider_id IS NOT NULL
  GROUP BY sr.client_id, sr.provider_id, address_hash
  HAVING COUNT(*) >= 2;
$$;

REVOKE ALL ON FUNCTION detect_cancel_recurrent_pairs(int,int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION detect_rehire_same_address_pairs(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION detect_cancel_recurrent_pairs(int,int) TO service_role;
GRANT EXECUTE ON FUNCTION detect_rehire_same_address_pairs(int) TO service_role;
```

## Constraints / NÃO fazer
- ❌ Re-inserir signal pra mesmo par+evidência — usar evidence_hash + ON CONFLICT pra idempotência.
- ❌ Contar cancelamento por reajuste como bypass — AC#2 exceção explícita.
- ❌ Inserir signal sem `valid_until` (CHECK na T-250 trava).
- ❌ Computar address_hash sem pepper — hash global facilita rainbow attack se vazar.

## Convenções
- Idempotência: `service_request_ids[]` é determinístico → mesmo conjunto = mesmo signal
- Janelas configuráveis via `app_config.anti_bypass.window_*`
- Reuso: `service_requests` (T-070), `service_events` (T-226), padrão Edge Function de T-127/T-153/T-163$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-257 (API) — Estender moderate-message (T-181) para registrar bypass_signal_event
('b885704f-75e6-41ee-b0bd-e7f08ce6432d',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-257',
 'Estender Edge Function moderate-message (T-181) para registrar bypass_signal_event',
 $desc$## Objetivo
Estender a Edge Function `moderate-message` já criada em T-181 (US-025) pra: (a) ao detectar termos de contato externo via NLP/LLM, registrar `bypass_signal_event` (kind=`nlp_chat` para chat, `nlp_review` para avaliação) com peso de `app_config.anti_bypass.weight_nlp_chat|review`; (b) bloquear envio de mensagem em tempo real (já no T-181 — preservar comportamento); (c) aplicar idempotência por `message_id` via UNIQUE INDEX em `bypass_signal_events` (T-250). Cobre AC #3.

## Contexto
Módulo MATCHING/COMUNICACAO. Esta task é uma **extensão** de T-181 — não cria função paralela. Depende de: T-181 (existente), T-250 (signals), `app_config` (T-215). Para AC#3 em **avaliações** (não chat), criar handler análogo que dispara no INSERT de `service_request_reviews` (futura US — gancho via trigger).

## Estado atual / O que substitui
T-181 já modera mensagem (LLM anti-bypass) e bloqueia envio. Esta task adiciona o registro do signal_event.

## O que criar

### Patch em `supabase/functions/moderate-message/index.ts` (T-181)
```typescript
// Adicionar após detecção positiva de bypass (logo antes de retornar bloqueio):

if (moderationResult.bypass_detected) {
  const { data: cfg } = await supabase
    .from('app_config').select('value').eq('key', 'anti_bypass.weight_nlp_chat').maybeSingle();
  const wNlp = Number(cfg?.value ?? 3);

  const validUntilDays = Number(
    (await supabase.from('app_config').select('value').eq('key', 'anti_bypass.window_nlp_days').maybeSingle())
      .data?.value ?? 60
  );

  // Idempotência via UNIQUE INDEX em (evidence->>'message_id') — ON CONFLICT silencia
  await supabase.from('bypass_signal_events').insert({
    client_id: conversation.client_id,
    provider_id: conversation.provider_id,
    kind: 'nlp_chat',
    weight: wNlp,
    evidence: {
      message_id: messageId,                    // chave de idempotência
      conversation_id: conversation.id,
      terms_matched: moderationResult.terms,
      llm_confidence: moderationResult.confidence,
    },
    valid_until: new Date(Date.now() + validUntilDays * 86400_000).toISOString(),
    source_service_request_id: conversation.service_request_id,
  });
}
```

### Análogo para reviews (gancho em US futura ou inline no api/services/[id]/review):
```typescript
// Em post-handler de review:
if (containsExternalContactTerms(review.text)) {
  await supabase.from('bypass_signal_events').insert({
    client_id: review.client_id,
    provider_id: review.provider_id,
    kind: 'nlp_review',
    weight: wNlpReview,
    evidence: { review_id: review.id, terms_matched: [...], ... },
    valid_until: ...,
  });
}
```

## Constraints / NÃO fazer
- ❌ Criar Edge Function paralela — extender T-181, não duplicar.
- ❌ Logar texto da mensagem em `evidence` — apenas IDs e termos detectados (LGPD: minimizar exposição).
- ❌ Inserir signal sem ON CONFLICT — UNIQUE INDEX em `(evidence->>'message_id')` pode dar erro 23505 que crasha a Edge Function. Usar `.insert(...)` ignorando 23505 ou `.upsert({...}, {onConflict: ...})`.
- ❌ Bloquear envio de mensagem por causa do INSERT do signal falhar — moderation prevalence. Catch + log e siga.

## Convenções
- Reuso da estrutura LLM existente em T-181 (não duplicar prompt)
- `evidence.message_id` é a chave de idempotência (UNIQUE INDEX em T-250)
- Reuso: T-181 (moderate-message), T-250 (signals), T-178 (conversations/messages)$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-258 (API) — Edge Function bypass-evaluator
('b372bf7b-2fd8-4738-bfa3-ea354625b27f',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-258',
 'Implementar RPC evaluate_pair_risk + Edge Function bypass-evaluator',
 $desc$## Objetivo
Edge Function chamada por pg_cron (T-262) que varre pares com score atualizado recentemente em `bypass_pair_risk_state` (T-251), avalia se o score atinge limiar de N1/N2/N3 conforme `app_config.anti_bypass.thresholds`, e dispara escalonamento via `apply_pair_level` (T-259). Também processa pares com denúncia recém-confirmada (status=`confirmed` em `bypass_reports`) → N4 imediato (AC#8). Cobre AC #6, #7, #8.

## Contexto
Módulo MATCHING. Idempotente — `apply_pair_level` (T-259) é responsável por não escalonar pra mesmo nível 2x consecutivos.

## Estado atual / O que substitui
Não existe. Score sem evaluator é dado morto.

## O que criar

### `supabase/functions/bypass-evaluator/index.ts`
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Pares com score > threshold N1 que ainda não estão em N1+
  const { data: cfg } = await supabase
    .from('app_config').select('value').eq('key', 'anti_bypass.thresholds').maybeSingle();
  const thresholds = (cfg?.value as { n1: number; n2: number; n3: number }) ?? {
    n1: 3, n2: 6, n3: 10,
  };

  const { data: hotPairs } = await supabase
    .from('bypass_pair_risk_state')
    .select('client_id, provider_id, current_score, highest_signal_kind')
    .gte('current_score', thresholds.n1)
    .order('current_score', { ascending: false })
    .limit(200);

  let escalated = 0;
  for (const p of hotPairs ?? []) {
    let targetLevel: 'N1' | 'N2' | 'N3' = 'N1';
    if (p.current_score >= thresholds.n3) targetLevel = 'N3';
    else if (p.current_score >= thresholds.n2) targetLevel = 'N2';

    const { data: result, error } = await supabase.rpc('apply_pair_level', {
      p_client_id: p.client_id,
      p_provider_id: p.provider_id,
      p_target_level: targetLevel,
      p_trigger: 'score_threshold',
      p_score_snapshot: p.current_score,
    });

    if (!error && result?.applied === true) escalated++;
  }

  // 2. Denúncias recém-confirmadas → N4 imediato
  const { data: confirmedReports } = await supabase
    .from('bypass_reports')
    .select('id, client_id, provider_id')
    .eq('status', 'confirmed')
    .is('resulting_level_id', null)
    .limit(50);

  let n4Applied = 0;
  for (const r of confirmedReports ?? []) {
    const { data, error } = await supabase.rpc('apply_pair_level', {
      p_client_id: r.client_id,
      p_provider_id: r.provider_id,
      p_target_level: 'N4',
      p_trigger: 'manual_report_confirmed',
    });
    if (!error && data?.applied === true) {
      await supabase.from('bypass_reports')
        .update({ resulting_level_id: data.level_id })
        .eq('id', r.id);
      n4Applied++;
    }
  }

  return Response.json({ escalated_n1_n3: escalated, n4_applied: n4Applied });
});
```

## Constraints / NÃO fazer
- ❌ Esquecer rate-limit (200 hot pairs por execução) — ops vai querer ver picos sem timeout da Edge.
- ❌ Aplicar N4 em score_threshold (AC#7: N4 só em manual_report_confirmed ou no_appeal_in_window).
- ❌ Re-aplicar N3 em par já em N3 — `apply_pair_level` deve no-op idempotente.
- ❌ Atualizar `bypass_reports.resulting_level_id` antes de confirmar sucesso da RPC — race com retry pode pular escalação.

## Convenções
- Rodado a cada 30s via pg_cron (T-262)
- `thresholds` config em jsonb único (não 3 keys separadas) pra atomicidade
- Reuso: `bypass_pair_risk_state` (T-251), `apply_pair_level` (T-259), `bypass_reports` (T-255)$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-259 (API) — RPC apply_pair_level + apply_penalty
('37c8d031-f23d-46c4-84f6-56a5e251c734',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-259',
 'Implementar RPC apply_pair_level + apply_penalty (N1→N4 + escalonamento por ocorrência)',
 $desc$## Objetivo
Duas RPCs orquestradoras que aplicam consequências da escalação. **`apply_pair_level`** muda o nível ativo do par (N1/N2/N3/N4), supersedendo a linha anterior, e dispara: N1 → notificações educativas (T-162), N2 → registra `separation_until` (matching consulta), N3 → suspende prestador investigativamente (T-209 estendida) + abre canal defesa, N4 → desativa permanentemente + chama `apply_penalty`. **`apply_penalty`** registra `bypass_penalty_event` com `occurrence_index` calculado, aplica efeito (commission elevada, suspensão temporária, taxa convenience, desativação, CPF blocklist via T-254). Cobre AC #7, #9, #10, #11, #12, #14.

## Contexto
Módulo MATCHING. Chamado por: `bypass-evaluator` (T-258), `appeal-deadline-check` job (T-262). Reusa: `transition_service_status` (T-235) pra suspender; `enqueue_notification_event` (T-162) pra notificar; `add_to_cpf_blocklist` (T-254) pra bloquear; T-209 (`/api/admin/providers/[id]/suspend`) — chama internamente via mesma RPC.

## Estado atual / O que substitui
Não existe. Sem essas RPCs, a engine só registra signals/scores mas nunca age.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_apply_pair_level_rpc.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION apply_pair_level(
  p_client_id      uuid,
  p_provider_id    uuid,
  p_target_level   bypass_level,
  p_trigger        bypass_level_trigger,
  p_score_snapshot numeric DEFAULT NULL,
  p_applied_by     uuid DEFAULT NULL,
  p_notes          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current bypass_pair_levels%ROWTYPE;
  v_new_id  uuid;
  v_separation_days int;
  v_signals jsonb;
BEGIN
  -- 1. Lê nível ativo
  SELECT * INTO v_current FROM bypass_pair_levels
   WHERE client_id = p_client_id AND provider_id = p_provider_id
     AND superseded_at IS NULL FOR UPDATE;

  -- 2. Idempotência: nivel-alvo == atual e não force, retorna no-op
  IF FOUND AND v_current.level = p_target_level THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already_at_level', 'level_id', v_current.id);
  END IF;

  -- 3. Snapshot de signals ativos
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind::text, 'weight', weight, 'detected_at', detected_at
  )), '[]'::jsonb) INTO v_signals
  FROM bypass_signal_events
  WHERE client_id = p_client_id AND provider_id = p_provider_id
    AND marked_false_positive = false AND valid_until > NOW();

  -- 4. Supersede nível anterior
  IF FOUND THEN
    UPDATE bypass_pair_levels SET superseded_at = NOW() WHERE id = v_current.id;
  END IF;

  -- 5. Insere novo nível
  IF p_target_level = 'N2' THEN
    SELECT (value)::int INTO v_separation_days
    FROM app_config WHERE key = 'anti_bypass.n2_separation_days';
    v_separation_days := COALESCE(v_separation_days, 30);
  END IF;

  INSERT INTO bypass_pair_levels
    (client_id, provider_id, level, prior_level, trigger_kind, score_snapshot,
     signals_snapshot, separation_until, applied_by, notes, ack_required)
  VALUES
    (p_client_id, p_provider_id, p_target_level, COALESCE(v_current.level, 'N0'),
     p_trigger, p_score_snapshot, v_signals,
     CASE WHEN p_target_level = 'N2' THEN NOW() + (v_separation_days || ' days')::interval ELSE NULL END,
     p_applied_by, p_notes,
     p_target_level IN ('N3','N4'))
  RETURNING id INTO v_new_id;

  -- 6. Disparo de efeitos colaterais por nível
  IF p_target_level = 'N1' THEN
    -- AC#7: educação preventiva (notificações separadas, sem revelar)
    PERFORM enqueue_notification_event(
      'bypass.educational_client',
      'client',
      jsonb_build_object('client_id', p_client_id, 'provider_id', p_provider_id, 'level_id', v_new_id)
    );
    PERFORM enqueue_notification_event(
      'bypass.educational_provider',
      'provider',
      jsonb_build_object('provider_id', p_provider_id, 'client_id', p_client_id, 'level_id', v_new_id)
    );
  ELSIF p_target_level = 'N2' THEN
    -- AC#7: separação no matching já é via `separation_until` consultada por T-243
    -- + aviso formal (notificação)
    PERFORM enqueue_notification_event(
      'bypass.formal_warning_client', 'client',
      jsonb_build_object('client_id', p_client_id, 'level_id', v_new_id)
    );
    PERFORM enqueue_notification_event(
      'bypass.formal_warning_provider', 'provider',
      jsonb_build_object('provider_id', p_provider_id, 'level_id', v_new_id)
    );
  ELSIF p_target_level = 'N3' THEN
    -- AC#11: suspende investigativamente (delegado a T-209 estendida)
    PERFORM admin_suspend_provider_investigative(p_provider_id, v_new_id);
    -- AC#12: abre canal de defesa em provider_appeals (T-036) com prazo 72h
    INSERT INTO provider_appeals (provider_id, kind, status, deadline_at, related_pair_level_id)
    VALUES (p_provider_id, 'bypass_investigative', 'open',
            NOW() + INTERVAL '72 hours', v_new_id);
  ELSIF p_target_level = 'N4' THEN
    -- Penalty escalation por ocorrência:
    PERFORM apply_penalty('provider', p_provider_id::uuid, v_new_id, p_trigger, p_applied_by);
    PERFORM apply_penalty('client', p_client_id::uuid, v_new_id, p_trigger, p_applied_by);
  END IF;

  RETURN jsonb_build_object('applied', true, 'level_id', v_new_id, 'level', p_target_level::text);
END $$;

REVOKE ALL ON FUNCTION apply_pair_level(uuid,uuid,bypass_level,bypass_level_trigger,numeric,uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_pair_level(uuid,uuid,bypass_level,bypass_level_trigger,numeric,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION apply_penalty(
  p_actor_role     bypass_actor_role,
  p_actor_id       uuid,
  p_pair_level_id  uuid DEFAULT NULL,
  p_trigger        bypass_level_trigger DEFAULT 'score_threshold',
  p_applied_by     uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_occ int;
  v_cpf text;
  v_penalty_id uuid;
BEGIN
  v_occ := next_bypass_occurrence(p_actor_role, p_actor_id);

  IF v_occ = 1 THEN
    -- 1ª ocorrência
    INSERT INTO bypass_penalty_events
      (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind,
       parameters, applied_by, reason)
    VALUES
      (p_actor_role, p_actor_id, p_pair_level_id, 1, 'formal_warning',
       '{}'::jsonb, p_applied_by, 'first_occurrence');

    IF p_actor_role = 'provider' THEN
      INSERT INTO bypass_penalty_events
        (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind,
         parameters, effective_until)
      VALUES
        ('provider', p_actor_id, p_pair_level_id, 1, 'commission_elevated',
         '{"original_pct":0.15,"new_pct":0.25,"duration_days":90}'::jsonb,
         NOW() + INTERVAL '90 days'),
        ('provider', p_actor_id, p_pair_level_id, 1, 'frequency_reduction_temp',
         '{"factor":0.5,"duration_days":90}'::jsonb,
         NOW() + INTERVAL '90 days');
    ELSE
      INSERT INTO bypass_penalty_events
        (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind, parameters)
      VALUES
        ('client', p_actor_id, p_pair_level_id, 1, 'monitoring_intensified', '{"duration_days":60}'::jsonb);
    END IF;

  ELSIF v_occ = 2 THEN
    -- 2ª ocorrência
    DECLARE v_susp_days int := CASE p_actor_role WHEN 'provider' THEN 30 ELSE 15 END;
    BEGIN
      INSERT INTO bypass_penalty_events
        (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind,
         parameters, effective_until)
      VALUES
        (p_actor_role, p_actor_id, p_pair_level_id, 2, 'suspension_temporary',
         jsonb_build_object('duration_days', v_susp_days),
         NOW() + (v_susp_days || ' days')::interval);
      IF p_actor_role = 'provider' THEN
        INSERT INTO bypass_penalty_events
          (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind,
           parameters, effective_until)
        VALUES
          ('provider', p_actor_id, p_pair_level_id, 2, 'commission_elevated',
           '{"original_pct":0.15,"new_pct":0.30,"duration_days":180}'::jsonb,
           NOW() + INTERVAL '180 days');
      ELSE
        INSERT INTO bypass_penalty_events
          (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind,
           parameters, effective_until)
        VALUES
          ('client', p_actor_id, p_pair_level_id, 2, 'convenience_fee_added',
           '{"fee_pct":0.05,"duration_days":180}'::jsonb,
           NOW() + INTERVAL '180 days');
      END IF;
    END;

  ELSE
    -- 3ª ocorrência: desativação permanente + CPF blocklist
    INSERT INTO bypass_penalty_events
      (actor_role, actor_id, related_pair_level_id, occurrence_index, penalty_kind, parameters)
    VALUES
      (p_actor_role, p_actor_id, p_pair_level_id, 3, 'permanent_deactivation', '{}'::jsonb)
    RETURNING id INTO v_penalty_id;

    -- AC#14: bloqueia CPF
    -- CPF lido de provider_profiles (provider) ou clients_profiles (client) — buscar:
    IF p_actor_role = 'provider' THEN
      SELECT cpf INTO v_cpf FROM provider_profiles WHERE id = p_actor_id;
    ELSE
      SELECT cpf INTO v_cpf FROM clients_profiles WHERE user_id = p_actor_id;
    END IF;
    IF v_cpf IS NOT NULL THEN
      PERFORM add_to_cpf_blocklist(
        v_cpf,
        'bypass_3rd_occurrence',
        p_actor_id,
        p_actor_role,
        v_penalty_id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('occurrence', v_occ);
END $$;

REVOKE ALL ON FUNCTION apply_penalty(bypass_actor_role,uuid,uuid,bypass_level_trigger,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_penalty(bypass_actor_role,uuid,uuid,bypass_level_trigger,uuid) TO service_role;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Re-aplicar mesmo nível (idempotência).
- ❌ Aplicar penalidade em prestador sem ler `provider_profiles.cpf` real (LGPD: não inventar/mockar; se faltar CPF no perfil, log warning e siga sem CPF blocklist).
- ❌ Bloquear concluir serviço já em andamento ao suspender N3 (AC#11 explicit: termina serviços ativos, novos aceites bloqueados).
- ❌ Esquecer de criar `provider_appeals` em N3 (AC#12 — sem isso prestador não tem canal).

## Convenções
- Penalidades por kind separadas pra permitir queries finas (ex: "todos os prestadores com commission_elevated ativa")
- `next_bypass_occurrence` (T-253) conta penalidades "principais" (warning/suspension/deactivation), não modificadores
- Reuso: `enqueue_notification_event` (T-162), `add_to_cpf_blocklist` (T-254), `provider_appeals` (T-036), `transition_service_status` (T-235) via T-209$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-260 (API) — POST /api/services/[id]/report-bypass + admin endpoints
('30239be5-c4f7-4d8b-a47f-f24852801790',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-260',
 'Implementar POST report-bypass + endpoints admin (mark-false-positive, list pairs, confirm-report)',
 $desc$## Objetivo
Endpoints HTTP da engine: (a) `POST /api/services/[id]/report-bypass` — cliente/prestador denuncia (AC#4); (b) `PATCH /api/admin/bypass/reports/[id]` — admin confirma/rejeita denúncia (AC#4 + AC#8); (c) `PATCH /api/admin/bypass/signals/[id]/mark-false-positive` (AC#13); (d) `GET /api/admin/bypass/pairs` — lista pares com score elevado (AC#15); (e) `GET /api/admin/bypass/pairs/[client]/[provider]` — detalhe completo do par (sinais + nível + penalidades + defesa). Cobre AC #4, #13, #15.

## Contexto
Módulo MATCHING. Acesso: report-bypass por authenticated; demais por admin. Validação Zod + idempotência via `Idempotency-Key`.

## Estado atual / O que substitui
Não existe. Painel admin de bypass nasce aqui.

## O que criar

### `src/app/api/services/[id]/report-bypass/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  description: z.string().min(20).max(2000),
  reporter_role: z.enum(['client','provider']),
  evidence_attachments: z.array(z.object({
    name: z.string(), url: z.string().url(), size: z.number(),
  })).max(5).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = Body.parse(await req.json());

  // Carrega SR pra extrair client/provider
  const { data: sr } = await supabase
    .from('service_requests')
    .select('id, client_id, provider_id')
    .eq('id', params.id)
    .single();
  if (!sr || !sr.provider_id) return Response.json({ error: 'sr_not_found_or_no_provider' }, { status: 404 });

  // Valida que reporter é parte (RLS já filtra mas damos erro claro)
  if (body.reporter_role === 'client' && sr.client_id !== user.id) {
    return Response.json({ error: 'not_a_party' }, { status: 403 });
  }
  if (body.reporter_role === 'provider' && sr.provider_id !== user.id) {
    return Response.json({ error: 'not_a_party' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('bypass_reports')
    .insert({
      service_request_id: params.id,
      client_id: sr.client_id,
      provider_id: sr.provider_id,
      reporter_id: user.id,
      reporter_role: body.reporter_role,
      description: body.description,
      evidence_attachments: body.evidence_attachments ?? [],
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return Response.json({ status: 'already_reported' }, { status: 200 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ report_id: data.id });
}
```

### `src/app/api/admin/bypass/reports/[id]/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.object({
  decision: z.enum(['confirmed','rejected','duplicate']),
  notes: z.string().max(1000).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // (auth/admin guard)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  // role check via app_metadata.role === 'admin' (RLS já bloqueia mas damos erro claro)

  const body = Body.parse(await req.json());

  const admin = createAdminClient();
  const { data: report, error: fetchErr } = await admin
    .from('bypass_reports').select('*').eq('id', params.id).single();
  if (fetchErr || !report) return Response.json({ error: 'not_found' }, { status: 404 });

  if (report.status !== 'pending_review') {
    return Response.json({ error: 'already_reviewed' }, { status: 409 });
  }

  // 1. Atualiza status
  await admin.from('bypass_reports').update({
    status: body.decision,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    review_notes: body.notes,
  }).eq('id', params.id);

  // 2. Se confirmada, registra signal e dispara N4 imediato (delegado a T-258 picking up)
  if (body.decision === 'confirmed') {
    const { data: cfg } = await admin.from('app_config').select('value')
      .eq('key', 'anti_bypass.weight_manual_report').maybeSingle();
    const weight = Number(cfg?.value ?? 10);

    const { data: sig } = await admin.from('bypass_signal_events').insert({
      client_id: report.client_id,
      provider_id: report.provider_id,
      kind: 'manual_report',
      weight,
      evidence: { report_id: report.id, reporter_id: report.reporter_id },
      valid_until: new Date(Date.now() + 365 * 86400_000).toISOString(),
      source_service_request_id: report.service_request_id,
    }).select('id').single();

    await admin.from('bypass_reports').update({ resulting_signal_id: sig?.id }).eq('id', params.id);

    // T-258 (bypass-evaluator) vai pickar e aplicar N4. Alternativamente
    // poderia chamar apply_pair_level inline pra reduzir latência. Decisão:
    // chamar inline pra UX imediata.
    await admin.rpc('apply_pair_level', {
      p_client_id: report.client_id,
      p_provider_id: report.provider_id,
      p_target_level: 'N4',
      p_trigger: 'manual_report_confirmed',
      p_applied_by: user.id,
    });
  }

  return Response.json({ ok: true });
}
```

### `src/app/api/admin/bypass/signals/[id]/route.ts` (mark-false-positive)
```typescript
const Body = z.object({
  reason: z.string().min(5).max(500),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // (admin auth)
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const { error } = await supabase
    .from('bypass_signal_events')
    .update({
      marked_false_positive: true,
      marked_false_positive_by: user.id,
      marked_false_positive_at: new Date().toISOString(),
      marked_false_positive_reason: body.reason,
    })
    .eq('id', params.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  // trigger T-251 vai recomputar pair_risk_state automaticamente
  return Response.json({ ok: true });
}
```

### `src/app/api/admin/bypass/pairs/route.ts` (lista)
```typescript
export async function GET(req: Request) {
  const url = new URL(req.url);
  const minScore = Number(url.searchParams.get('min_score') ?? 1);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bypass_pair_risk_state')
    .select(`
      client_id, provider_id, current_score, active_signals_count, highest_signal_kind, computed_at,
      bypass_pair_levels(id, level, effective_at, separation_until)
    `)
    .gte('current_score', minScore)
    .order('current_score', { ascending: false })
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ pairs: data });
}
```

## Constraints / NÃO fazer
- ❌ Permitir denúncia por usuário não-parte do SR (403).
- ❌ Confirmação chamando apply_pair_level sem idempotency-key — duplo-tap admin escala 2x.
- ❌ Permitir mark-false-positive em signal de outra autoria sem audit (RLS já filtra; logar `marked_false_positive_by`).
- ❌ Listar pairs sem RLS admin — vazaria identidade de pares monitorados.

## Convenções
- Idempotency-Key obrigatório em report-bypass (mobile + duplo-tap)
- Endpoints admin via app_metadata.role check + RLS
- Reuso: padrão de `/api/admin/disputes/[id]/decide` (T-150), `/api/admin/providers/[id]/suspend` (T-209)$desc$,
 'API', 'ADMIN',
 ARRAY['INPUT_VALIDATION','RLS_REQUIRED','IDEMPOTENCY_KEY','RATE_LIMIT','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-261 (UI) — Botão Reportar bypass + painel /admin/bypass
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-261',
 'Renderizar botão Reportar bypass + painel /admin/bypass (lista pares + ações)',
 $desc$## Objetivo
Duas superfícies de UI: (a) botão "Reportar bypass" no detalhe do serviço (`/(client)/services/[id]` e `/(provider)/services/[id]`) abrindo `ResponsiveDialog` com form de denúncia (descrição + opcional anexos) — AC#4; (b) painel admin `/admin/bypass` com tabela de pares com score elevado, drill-down em `BypassPairSheet` mostrando timeline de sinais, defesa do prestador, ações (marcar falso positivo, confirmar denúncia, escalar manualmente) — AC#15. Cobre AC #4, #15.

## Contexto
Módulo MATCHING. Reuso UI: `ResponsiveDialog` (denúncia), `ResponsiveSheet` size="lg" (detalhe par), `Field`/`FormBody` (form denúncia), `useOptimisticCollection` (lista pares na admin), `ConfirmDialog` (ações destrutivas), `Sonner` (errors), `StatusChip` (nível N1-N4).

## Estado atual / O que substitui
Não existe. Detalhes do serviço já existem (T-084, T-085) — adicionar botão. `/admin` dashboard já existe (T-199) — link "Bypass" no menu.

## O que criar

### `src/components/services/ReportBypassButton.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';

interface Props {
  serviceRequestId: string;
  reporterRole: 'client' | 'provider';
}

export function ReportBypassButton({ serviceRequestId, reporterRole }: Props) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (description.length < 20) return;
    setBusy(true);
    try {
      const idem = crypto.randomUUID();
      const res = await fetch(`/api/services/${serviceRequestId}/report-bypass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'idempotency-key': idem },
        body: JSON.stringify({ description, reporter_role: reporterRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Denúncia recebida. Equipe analisará em até 24h.');
      setOpen(false);
      setDescription('');
    } catch (e) {
      showErrorToast({ type: 'create', label: 'denuncia' }, e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Reportar bypass
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialog.Header>Reportar tentativa de bypass</ResponsiveDialog.Header>
        <ResponsiveDialog.Body>
          <FormBody density="comfortable">
            <Field name="description" required error={description.length > 0 && description.length < 20 ? 'Mínimo 20 caracteres' : undefined}>
              <Field.Label>O que aconteceu?</Field.Label>
              <Field.Control>
                <Textarea
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva a tentativa: o que foi proposto, quando, como (chat/áudio/encontro)…"
                />
              </Field.Control>
              <Field.Hint>
                Sua identidade fica protegida. A outra parte não saberá que você reportou.
              </Field.Hint>
            </Field>
          </FormBody>
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || description.length < 20}>
            {busy ? 'Enviando…' : 'Enviar denúncia'}
          </Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>
    </>
  );
}
```

### `src/app/admin/bypass/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { BypassPairsTable } from '@/components/admin/BypassPairsTable';

export default async function AdminBypassPage() {
  const supabase = await createClient();
  const { data: pairs } = await supabase
    .from('bypass_pair_risk_state')
    .select(`
      client_id, provider_id, current_score, active_signals_count, highest_signal_kind, computed_at,
      bypass_pair_levels!inner(id, level, effective_at, separation_until)
    `)
    .gte('current_score', 1)
    .order('current_score', { ascending: false })
    .limit(100);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">Anti-bypass — pares monitorados</h1>
      <BypassPairsTable initialPairs={pairs ?? []} />
    </main>
  );
}
```

### `src/components/admin/BypassPairSheet.tsx`
- `ResponsiveSheet` size="lg"
- Tabs: Sinais / Nível / Penalidades / Defesa
- Ações: "Marcar falso positivo" (em sinal), "Confirmar denúncia" (em report), "Escalar manualmente" (admin override)
- Reuso `useOptimisticCollection` pra ações sobre signals

## Constraints / NÃO fazer
- ❌ Mostrar score do par pro cliente/prestador (AC#1: monitoramento silencioso).
- ❌ Usar `<Dialog>` cru (sempre `ResponsiveDialog`).
- ❌ Usar `window.confirm()` para "Tem certeza?" (sempre `ConfirmDialog`).
- ❌ Usar `react-hook-form` (memory `project_ui_patterns`).
- ❌ Mostrar denúncias de outros usuários a não-admin.

## Convenções
- Reuso UI: `ResponsiveDialog`, `ResponsiveSheet`, `Field`/`FormBody`, `Button`, `Textarea`, `StatusChip`, `Sonner`/`showErrorToast`, `useOptimisticCollection`, `ConfirmDialog`
- Mobile-first; tap targets ≥ 44px
- Reuso: padrão de `DisputeDetailSheet` (T-157), `ProviderDetailSheet` (T-212)$desc$,
 'UI', 'ANY',
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-262 (OPS) — pg_cron jobs + seed app_config anti-bypass
('0d493e3e-d532-45b5-b6e0-e0a429461be1',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '16f196f4-0ed4-4067-8db4-2003b25971dc',
 'ZLAR-V2-T-262',
 'Configurar pg_cron jobs anti-bypass + seedar app_config seção anti_bypass',
 $desc$## Objetivo
Agendar 3 jobs `pg_cron` que orquestram a engine: `detect-bypass-signals` (a cada 5min), `bypass-evaluator` (a cada 30s pra denúncias confirmadas serem aplicadas rápido), `appeal-deadline-check` (a cada 1h pra checar prazo de defesa de 72h vencido — AC#12 → N4 automático). Adicionalmente, seedar/upsert as keys `anti_bypass.*` em `app_config` (T-215): pesos por kind, janelas, thresholds N1/N2/N3, separação N2, prazo defesa. Cobre AC #1, #2, #5, #6, #12.

## Contexto
Módulo MATCHING. Mesmo padrão de jobs T-080, T-113, T-126, T-233, T-248. Estende seção `anti_bypass` que T-224 já criou com defaults — esta task substitui pelos valores específicos.

## Estado atual / O que substitui
Não existe. T-224 seedou keys default em `anti_bypass` mas sem os valores específicos da engine.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_anti_bypass_jobs_and_seed.sql`
```sql
BEGIN;

-- === SEED app_config.anti_bypass.* ===

INSERT INTO app_config (key, value, section, value_schema, description) VALUES
  ('anti_bypass.weight_cancel_recurrent', '5'::jsonb, 'anti_bypass',
   '{"type":"number","min":1,"max":50}'::jsonb,
   'Peso isolado do sinal cancelamento recorrente (AC#2 — alto isolado).'),

  ('anti_bypass.weight_nlp_chat', '3'::jsonb, 'anti_bypass',
   '{"type":"number","min":0.5,"max":20}'::jsonb,
   'Peso por sinal NLP detectado em chat (AC#3).'),

  ('anti_bypass.weight_nlp_review', '3'::jsonb, 'anti_bypass',
   '{"type":"number","min":0.5,"max":20}'::jsonb,
   'Peso por sinal NLP detectado em avaliação (AC#3).'),

  ('anti_bypass.weight_manual_report', '10'::jsonb, 'anti_bypass',
   '{"type":"number","min":1,"max":100}'::jsonb,
   'Peso da denúncia confirmada (AC#4 — peso máximo, dispara N4 imediato via trigger separado).'),

  ('anti_bypass.weight_rehire_same_address', '0.5'::jsonb, 'anti_bypass',
   '{"type":"number","min":0,"max":5}'::jsonb,
   'Peso baixo isolado da recontratação no mesmo endereço (AC#5 — neutro isolado).'),

  ('anti_bypass.window_cancel_days', '60'::jsonb, 'anti_bypass',
   '{"type":"integer","min":1,"max":365}'::jsonb,
   'Janela em dias para detectar cancelamento recorrente (AC#2).'),

  ('anti_bypass.window_nlp_days', '60'::jsonb, 'anti_bypass',
   '{"type":"integer","min":1,"max":365}'::jsonb,
   'Janela em dias de validade do sinal NLP de chat/review.'),

  ('anti_bypass.window_rehire_days', '30'::jsonb, 'anti_bypass',
   '{"type":"integer","min":1,"max":365}'::jsonb,
   'Janela em dias para detectar recontratação no mesmo endereço (AC#5).'),

  ('anti_bypass.cancel_recurrent_threshold', '2'::jsonb, 'anti_bypass',
   '{"type":"integer","min":2,"max":10}'::jsonb,
   'Cancelamentos do mesmo par para disparar sinal cancel_recurrent (AC#2: 2+).'),

  ('anti_bypass.thresholds', '{"n1":3,"n2":6,"n3":10}'::jsonb, 'anti_bypass',
   '{"type":"object","required":["n1","n2","n3"],"properties":{"n1":{"type":"number"},"n2":{"type":"number"},"n3":{"type":"number"}}}'::jsonb,
   'Score thresholds para escalonamento N1/N2/N3 (AC#7). N4 só via denúncia ou no_appeal.'),

  ('anti_bypass.n2_separation_days', '30'::jsonb, 'anti_bypass',
   '{"type":"integer","min":1,"max":365}'::jsonb,
   'Dias de separação do par no matching ao aplicar N2 (AC#7).'),

  ('anti_bypass.appeal_deadline_hours', '72'::jsonb, 'anti_bypass',
   '{"type":"integer","min":1,"max":336}'::jsonb,
   'Horas para prestador apresentar defesa em N3 antes de aplicar N4 automático (AC#12).')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      section = EXCLUDED.section,
      value_schema = EXCLUDED.value_schema,
      description = EXCLUDED.description;

-- GUC pepper para CPF blocklist (T-254). Configurar em runbook ops; aqui só set fallback de dev.
-- ALTER DATABASE postgres SET app.cpf_blocklist_pepper = 'dev_pepper_change_in_prod';
-- (rodar manualmente; psql migration não pode SET DATABASE)

-- === pg_cron JOBS ===

SELECT cron.schedule(
  'anti-bypass-detect',
  '*/5 * * * *',  -- cada 5min
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/detect-bypass-signals',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'anti-bypass-evaluator',
  '*/30 * * * * *',  -- cada 30s
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/bypass-evaluator',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'anti-bypass-appeal-deadline',
  '0 * * * *',  -- top of every hour
  $$
    -- AC#12: prestador sem defesa em prazo → N4 automático
    WITH overdue_appeals AS (
      UPDATE provider_appeals
         SET status = 'no_response_in_window'
       WHERE kind = 'bypass_investigative'
         AND status = 'open'
         AND deadline_at < NOW()
       RETURNING id, provider_id, related_pair_level_id
    )
    SELECT apply_pair_level(
      bpl.client_id, bpl.provider_id, 'N4'::bypass_level, 'no_appeal_in_window'::bypass_level_trigger
    )
    FROM overdue_appeals oa
    JOIN bypass_pair_levels bpl ON bpl.id = oa.related_pair_level_id;
  $$
);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Job `bypass-evaluator` com intervalo > 1min — denúncia confirmada por admin precisa ter efeito visível em segundos (UX admin).
- ❌ Job `appeal-deadline` mais frequente que 1h — granularidade do AC é horas; não vale custo.
- ❌ Hardcodar thresholds em código TS — AC#7 + AC#4 produto-dependente; sempre lê de app_config.
- ❌ Aplicar N4 em massa sem rate-limit (no job appeal-deadline pode haver acumulo; OK pra MVP).

## Convenções
- Mesma estrutura GUC + net.http_post de T-248
- Reuso: T-215 (app_config), T-224 (seed default), T-036 (provider_appeals — extender com kind='bypass_investigative')$desc$,
 'OPS', 'SISTEMA',
 ARRAY['SECRET_HANDLING','NO_RLS_NEEDED'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- =============================================================================
-- 2. TASK ↔ AC-DA-STORY (TaskAcceptanceCriterion)
-- =============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-250 (signal_events) → AC#2,3,4,5,6,13
  ('667907cf-b08f-47b8-b9a2-817bf91368b2'::uuid, 2),
  ('667907cf-b08f-47b8-b9a2-817bf91368b2'::uuid, 3),
  ('667907cf-b08f-47b8-b9a2-817bf91368b2'::uuid, 4),
  ('667907cf-b08f-47b8-b9a2-817bf91368b2'::uuid, 5),
  ('667907cf-b08f-47b8-b9a2-817bf91368b2'::uuid, 6),
  ('667907cf-b08f-47b8-b9a2-817bf91368b2'::uuid, 13),
  -- T-251 (pair_risk_state + view) → AC#6,15
  ('29499d84-aef8-467a-95f5-0af8d6db650d'::uuid, 6),
  ('29499d84-aef8-467a-95f5-0af8d6db650d'::uuid, 15),
  -- T-252 (pair_levels N1-N4) → AC#7,8
  ('81cd1975-f330-4718-8ba0-9822408918ec'::uuid, 7),
  ('81cd1975-f330-4718-8ba0-9822408918ec'::uuid, 8),
  -- T-253 (penalty_events) → AC#9,10
  ('359d7f63-1c1a-4e79-b278-986527f0d8a9'::uuid, 9),
  ('359d7f63-1c1a-4e79-b278-986527f0d8a9'::uuid, 10),
  -- T-254 (cpf_blocklist) → AC#14
  ('31ee7c1c-03d7-48d2-8dd1-317a8e947297'::uuid, 14),
  -- T-255 (bypass_reports) → AC#4,8
  ('738832e5-dc67-4b33-b2aa-2a2de17138f4'::uuid, 4),
  ('738832e5-dc67-4b33-b2aa-2a2de17138f4'::uuid, 8),
  -- T-256 (detect-bypass-signals Edge) → AC#2,5
  ('38db0d90-433e-444f-a174-95340e5742ba'::uuid, 2),
  ('38db0d90-433e-444f-a174-95340e5742ba'::uuid, 5),
  -- T-257 (extender moderate-message) → AC#3
  ('b885704f-75e6-41ee-b0bd-e7f08ce6432d'::uuid, 3),
  -- T-258 (bypass-evaluator) → AC#6,7,8
  ('b372bf7b-2fd8-4738-bfa3-ea354625b27f'::uuid, 6),
  ('b372bf7b-2fd8-4738-bfa3-ea354625b27f'::uuid, 7),
  ('b372bf7b-2fd8-4738-bfa3-ea354625b27f'::uuid, 8),
  -- T-259 (apply_pair_level + apply_penalty) → AC#7,9,10,11,12,14
  ('37c8d031-f23d-46c4-84f6-56a5e251c734'::uuid, 7),
  ('37c8d031-f23d-46c4-84f6-56a5e251c734'::uuid, 9),
  ('37c8d031-f23d-46c4-84f6-56a5e251c734'::uuid, 10),
  ('37c8d031-f23d-46c4-84f6-56a5e251c734'::uuid, 11),
  ('37c8d031-f23d-46c4-84f6-56a5e251c734'::uuid, 12),
  ('37c8d031-f23d-46c4-84f6-56a5e251c734'::uuid, 14),
  -- T-260 (endpoints HTTP) → AC#4,13,15
  ('30239be5-c4f7-4d8b-a47f-f24852801790'::uuid, 4),
  ('30239be5-c4f7-4d8b-a47f-f24852801790'::uuid, 13),
  ('30239be5-c4f7-4d8b-a47f-f24852801790'::uuid, 15),
  -- T-261 (UI botão + admin painel) → AC#4,15
  ('cf7134c9-769d-44dc-a53a-dbd51ed96d1d'::uuid, 4),
  ('cf7134c9-769d-44dc-a53a-dbd51ed96d1d'::uuid, 15),
  -- T-262 (jobs + seed) → AC#1,2,5,6,12
  ('0d493e3e-d532-45b5-b6e0-e0a429461be1'::uuid, 1),
  ('0d493e3e-d532-45b5-b6e0-e0a429461be1'::uuid, 2),
  ('0d493e3e-d532-45b5-b6e0-e0a429461be1'::uuid, 5),
  ('0d493e3e-d532-45b5-b6e0-e0a429461be1'::uuid, 6),
  ('0d493e3e-d532-45b5-b6e0-e0a429461be1'::uuid, 12)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =============================================================================
-- 3. AC-DA-TASK (AcceptanceCriterion com taskId — checklist técnico)
-- =============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
-- T-250
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'Enum bypass_signal_kind criado (5 valores)', 1),
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'Tabela bypass_signal_events criada com FKs, CHECK valid_until > detected_at e CHECK consistência false_positive', 2),
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'Indexes idx_bypass_signals_pair_active (parcial) e idx_bypass_signals_kind_detected presentes', 3),
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'UNIQUE INDEX em (evidence->>message_id) impede duplicação de signal por message', 4),
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'RLS: somente ADMIN faz SELECT/INSERT/UPDATE; smoke via JWT prestador retorna 0', 5),
('667907cf-b08f-47b8-b9a2-817bf91368b2', 'Trigger updatedAt funciona', 6),

-- T-251
('29499d84-aef8-467a-95f5-0af8d6db650d', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'Tabela bypass_pair_risk_state criada com PK (client_id, provider_id) + indexes em current_score DESC e next_signal_expires_at', 1),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'View bypass_pair_risk_v com security_invoker computa live_score, breakdown_by_kind via FILTER', 2),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'RPC recompute_pair_risk faz UPSERT idempotente do cache', 3),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'Trigger trg_bypass_signal_recompute_pair recomputa cache em INSERT/UPDATE/DELETE de signals', 4),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'Smoke: novo signal incrementa current_score em real-time; mark_false_positive zera contribuição', 5),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'RLS: ADMIN tudo; outros papéis sem acesso (smoke)', 6),
('29499d84-aef8-467a-95f5-0af8d6db650d', 'EXECUTE de recompute_pair_risk revogado de authenticated', 7),

-- T-252
('81cd1975-f330-4718-8ba0-9822408918ec', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('81cd1975-f330-4718-8ba0-9822408918ec', 'Enums bypass_level e bypass_level_trigger criados', 1),
('81cd1975-f330-4718-8ba0-9822408918ec', 'Tabela bypass_pair_levels criada com FKs e UNIQUE INDEX parcial em (client, provider) WHERE superseded_at IS NULL', 2),
('81cd1975-f330-4718-8ba0-9822408918ec', 'Smoke: tentativa de criar 2 níveis ativos pra mesmo par retorna erro 23505', 3),
('81cd1975-f330-4718-8ba0-9822408918ec', 'Index idx_bypass_pair_levels_separation pra engine matching consultar separação ativa', 4),
('81cd1975-f330-4718-8ba0-9822408918ec', 'RLS ADMIN-all; smoke via JWT prestador retorna 0', 5),
('81cd1975-f330-4718-8ba0-9822408918ec', 'Trigger updatedAt funciona', 6),

-- T-253
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'Enums bypass_actor_role e bypass_penalty_kind criados', 1),
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'Tabela bypass_penalty_events criada com CHECK occurrence 1-3 e CHECK effective_until consistente por kind', 2),
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'Index idx_bypass_penalty_active (parcial onde effective_until > NOW) pra queries de penalidades vigentes', 3),
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'RLS: ADMIN tudo; actor lê suas próprias (smoke: prestador suspenso vê motivo)', 4),
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'Helper next_bypass_occurrence retorna ocorrência correta (conta principais, ignora modificadores)', 5),
('359d7f63-1c1a-4e79-b278-986527f0d8a9', 'Trigger updatedAt funciona', 6),

-- T-254
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'Migration aplicada via psql; pgcrypto extension habilitada', 0),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'Tabela cpf_blocklist criada com cpf_hash bytea UNIQUE', 1),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'Trigger block_cpf_blocklist_mutation impede UPDATE/DELETE mesmo de admin (smoke retorna erro)', 2),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'GUC app.cpf_blocklist_pepper configurado em runbook (não no schema)', 3),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'is_cpf_blocked retorna boolean, EXECUTE só service_role', 4),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'add_to_cpf_blocklist é idempotente via ON CONFLICT (cpf_hash)', 5),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'Hook em T-208 (KYC approve) chama is_cpf_blocked antes de aprovar; CPF bloqueado retorna 409', 6),
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'RLS: SELECT só ADMIN; INSERT só service_role', 7),

-- T-255
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'Enum bypass_report_status criado (4 valores)', 1),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'Tabela bypass_reports criada com CHECK description 20-2000 chars', 2),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'UNIQUE INDEX impede mesmo reporter duplicar pending no mesmo SR', 3),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'RLS: reporter lê próprias; reporter pode INSERT com reporter_id=auth.uid; ADMIN tudo', 4),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'Indexes idx_bypass_reports_status_created e _pair presentes', 5),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', 'Trigger updatedAt funciona', 6),

-- T-256
('38db0d90-433e-444f-a174-95340e5742ba', 'Edge Function deployada (supabase functions deploy detect-bypass-signals)', 0),
('38db0d90-433e-444f-a174-95340e5742ba', 'Helpers RPCs detect_cancel_recurrent_pairs + detect_rehire_same_address_pairs criadas', 1),
('38db0d90-433e-444f-a174-95340e5742ba', 'Smoke: cliente que cancelou mesmo prestador 2x em 60d gera signal cancel_recurrent', 2),
('38db0d90-433e-444f-a174-95340e5742ba', 'Smoke: cancelamento por client_rejected_revision NÃO conta (AC#2 exceção)', 3),
('38db0d90-433e-444f-a174-95340e5742ba', 'Smoke: par com 2x serviço completed mesmo address em 30d gera rehire_same_address', 4),
('38db0d90-433e-444f-a174-95340e5742ba', 'Idempotência: re-execução não duplica signals (UNIQUE INDEX em evidence_hash)', 5),
('38db0d90-433e-444f-a174-95340e5742ba', 'Pesos e janelas lidos de app_config.anti_bypass.* (AC#4 — sem deploy)', 6),
('38db0d90-433e-444f-a174-95340e5742ba', 'Service role key apenas no env da Edge Function', 7),

-- T-257
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Patch aplicado em supabase/functions/moderate-message/index.ts', 0),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Detecção positiva de bypass cria bypass_signal_event com kind=nlp_chat', 1),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Mesma message_id 2x não cria 2 signals (UNIQUE INDEX em evidence->>message_id silenciado via ON CONFLICT)', 2),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Pesos e janela lidos de app_config.anti_bypass.weight_nlp_* / window_nlp_days', 3),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Falha de INSERT em bypass_signal_events não impede bloqueio da mensagem (catch + log)', 4),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Texto da mensagem NÃO é persistido em evidence (LGPD: só IDs e termos detectados)', 5),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'Handler análogo para reviews (avaliações) registrado como follow-up em US futura', 6),

-- T-258
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Edge Function deployada (supabase functions deploy bypass-evaluator)', 0),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Smoke: par com score >= thresholds.n1 que está em N0 escala pra N1', 1),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Smoke: par com score >= thresholds.n3 escala diretamente pra N3', 2),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Denúncia confirmada (status=confirmed, resulting_level_id IS NULL) dispara N4 imediato', 3),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Após N4 aplicar, bypass_reports.resulting_level_id preenchido (não re-processado)', 4),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Idempotência: re-execução em par já em N3 não escala 2x (apply_pair_level no-op)', 5),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'Limite 200 hot_pairs + 50 confirmed_reports por execução (rate limit explícito)', 6),

-- T-259
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'Migrations aplicadas via psql; database.types.ts regenerado', 0),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'RPC apply_pair_level usa FOR UPDATE no nível atual (race-resistant)', 1),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'apply_pair_level idempotente: nível-alvo == atual retorna applied:false', 2),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'N1 dispara enqueue_notification_event educacional (separadas client/provider, sem revelar AC#1)', 3),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'N2 calcula separation_until baseado em app_config.anti_bypass.n2_separation_days', 4),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'N3 chama admin_suspend_provider_investigative + cria provider_appeals com deadline_at = NOW + 72h (AC#11/AC#12)', 5),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'N4 chama apply_penalty pra prestador E cliente', 6),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'apply_penalty 1ª ocorrência prestador: formal_warning + commission_elevated 90d + freq_reduction_temp 90d', 7),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'apply_penalty 2ª ocorrência: suspension_temporary 30d (provider) ou 15d (client) + modifier (AC#9.2/AC#10.2)', 8),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'apply_penalty 3ª ocorrência: permanent_deactivation + add_to_cpf_blocklist (AC#9.3/AC#10.3/AC#14)', 9),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'EXECUTE revogado de authenticated/anon; só service_role', 10),
('37c8d031-f23d-46c4-84f6-56a5e251c734', 'AC#11: serviço em andamento NÃO é interrompido na suspensão N3 (admin_suspend_provider_investigative respeita)', 11),

-- T-260
('30239be5-c4f7-4d8b-a47f-f24852801790', 'POST /api/services/[id]/report-bypass implementado com Zod validation', 0),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'Endpoint valida que reporter é parte do SR (403 se não)', 1),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'Idempotency-Key obrigatório (400); duplo-tap retorna 200 already_reported', 2),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'PATCH /api/admin/bypass/reports/[id] implementado com decision enum', 3),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'Confirmação cria bypass_signal_event (kind=manual_report) e dispara apply_pair_level N4 inline', 4),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'PATCH /api/admin/bypass/signals/[id] mark-false-positive registra marked_false_positive_by/at/reason', 5),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'Trigger T-251 recomputa pair_risk_state automaticamente após mark-false-positive', 6),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'GET /api/admin/bypass/pairs lista pares ordenados por score com limite 200', 7),
('30239be5-c4f7-4d8b-a47f-f24852801790', 'Logs estruturados de cada decisão admin (audit em provider_moderation_log se aplicável)', 8),

-- T-261
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Componente ReportBypassButton renderiza botão "Reportar bypass" no detalhe do serviço (cliente E prestador)', 0),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Botão abre ResponsiveDialog com Field+Textarea; valida 20-2000 chars antes de habilitar submit', 1),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Submit envia POST com Idempotency-Key gerado via crypto.randomUUID()', 2),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Erros via showErrorToast (não alert/dialog)', 3),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Hint UI explícito: "Sua identidade fica protegida; outra parte não saberá" (AC#1)', 4),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Página /admin/bypass renderiza tabela de pares com score elevado, ordenada por current_score DESC', 5),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'BypassPairSheet (ResponsiveSheet size=lg) com 4 tabs (Sinais/Nível/Penalidades/Defesa)', 6),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Ações admin (mark false positive, confirmar denúncia, escalar manualmente) usam ConfirmDialog', 7),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Lista usa useOptimisticCollection para refletir mudanças sem refetch', 8),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Score do par nunca é exibido pra cliente/prestador na UI (AC#1)', 9),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'Mobile-first verificado <768px; tap targets ≥44px', 10),

-- T-262
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'Migration aplicada via psql; pg_cron extension habilitada', 0),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', '12 keys app_config anti_bypass.* presentes (5 weights, 3 windows, threshold count, thresholds, n2_sep, appeal_deadline)', 1),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'Cada key tem section=anti_bypass e value_schema válido', 2),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'ON CONFLICT DO UPDATE permite re-aplicar seed', 3),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'Job anti-bypass-detect agendado a cada 5min (cron.job)', 4),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'Job anti-bypass-evaluator agendado a cada 30s', 5),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'Job anti-bypass-appeal-deadline agendado top-of-hour, varre provider_appeals expirados (kind=bypass_investigative, status=open, deadline_at < NOW)', 6),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'Appeal expirado dispara apply_pair_level N4 com trigger=no_appeal_in_window (AC#12)', 7),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'GUC app.cpf_blocklist_pepper documentado em runbook ops (separado do schema)', 8),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'cron.job_run_details mostra execuções OK (sem failed_count > 0 após 1h em produção)', 9),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'UI /admin/config (T-220) mostra seção anti_bypass com 12 keys editáveis', 10);

-- =============================================================================
-- 4. DEPENDÊNCIAS (TaskDependency — kind lowercase)
-- =============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- T-251 depende de T-250
('29499d84-aef8-467a-95f5-0af8d6db650d', '667907cf-b08f-47b8-b9a2-817bf91368b2', 'blocks'),

-- T-252 depende de T-250 (signals_snapshot referencia)
('81cd1975-f330-4718-8ba0-9822408918ec', '667907cf-b08f-47b8-b9a2-817bf91368b2', 'blocks'),

-- T-253 depende de T-252 (related_pair_level_id FK)
('359d7f63-1c1a-4e79-b278-986527f0d8a9', '81cd1975-f330-4718-8ba0-9822408918ec', 'blocks'),

-- T-254 depende de T-253 (enum bypass_actor_role + FK)
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', '359d7f63-1c1a-4e79-b278-986527f0d8a9', 'blocks'),
-- T-254 relates_to T-208 (KYC approve consome is_cpf_blocked)
('31ee7c1c-03d7-48d2-8dd1-317a8e947297', '3efbe413-c3e9-4bbf-ab01-db6ff2d11409', 'relates_to'),

-- T-255 depende de T-253 (enum bypass_actor_role) e T-250 (FK signals)
('738832e5-dc67-4b33-b2aa-2a2de17138f4', '359d7f63-1c1a-4e79-b278-986527f0d8a9', 'blocks'),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', '667907cf-b08f-47b8-b9a2-817bf91368b2', 'blocks'),
('738832e5-dc67-4b33-b2aa-2a2de17138f4', '81cd1975-f330-4718-8ba0-9822408918ec', 'blocks'),

-- T-256 depende de T-250; relates_to T-262 (config consumida em runtime), T-070 + T-226
('38db0d90-433e-444f-a174-95340e5742ba', '667907cf-b08f-47b8-b9a2-817bf91368b2', 'blocks'),
('38db0d90-433e-444f-a174-95340e5742ba', '0d493e3e-d532-45b5-b6e0-e0a429461be1', 'relates_to'),
('38db0d90-433e-444f-a174-95340e5742ba', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'relates_to'),
('38db0d90-433e-444f-a174-95340e5742ba', '01d74a0e-e2e8-41e7-865b-24cd88afe842', 'relates_to'),

-- T-257 depende de T-250; relates_to T-262, T-181, T-178
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', '667907cf-b08f-47b8-b9a2-817bf91368b2', 'blocks'),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', '0d493e3e-d532-45b5-b6e0-e0a429461be1', 'relates_to'),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', 'fab28a67-0149-42a9-b49f-fbc11d5eaaa6', 'relates_to'),
('b885704f-75e6-41ee-b0bd-e7f08ce6432d', '753ab520-0e03-421f-bdf5-d36ff0aaba66', 'relates_to'),

-- T-258 depende de T-251, T-255, T-259; relates_to T-262
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', '29499d84-aef8-467a-95f5-0af8d6db650d', 'blocks'),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', '738832e5-dc67-4b33-b2aa-2a2de17138f4', 'blocks'),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', '37c8d031-f23d-46c4-84f6-56a5e251c734', 'blocks'),
('b372bf7b-2fd8-4738-bfa3-ea354625b27f', '0d493e3e-d532-45b5-b6e0-e0a429461be1', 'relates_to'),

-- T-259 depende de T-252, T-253, T-254; relates_to T-162, T-209, T-036
('37c8d031-f23d-46c4-84f6-56a5e251c734', '81cd1975-f330-4718-8ba0-9822408918ec', 'blocks'),
('37c8d031-f23d-46c4-84f6-56a5e251c734', '359d7f63-1c1a-4e79-b278-986527f0d8a9', 'blocks'),
('37c8d031-f23d-46c4-84f6-56a5e251c734', '31ee7c1c-03d7-48d2-8dd1-317a8e947297', 'blocks'),
('37c8d031-f23d-46c4-84f6-56a5e251c734', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'relates_to'),
('37c8d031-f23d-46c4-84f6-56a5e251c734', '6e57972f-f8a9-41a3-aa2b-53c0d00ef3cb', 'relates_to'),
('37c8d031-f23d-46c4-84f6-56a5e251c734', '5853e430-3899-4d02-887d-d113181dc03c', 'relates_to'),
-- relates_to T-241 (compute_provider_score consome bypass_penalty_events frequency_reduction_temp)
('37c8d031-f23d-46c4-84f6-56a5e251c734', '57d9f39a-af3d-4b07-9132-3f98351ea385', 'relates_to'),
-- relates_to T-243 (start-matching consulta separation_until da N2 + comissão elevada de penalidades)
('37c8d031-f23d-46c4-84f6-56a5e251c734', '597cd399-00b2-4b74-b345-4d7956be3903', 'relates_to'),

-- T-260 depende de T-250, T-251, T-252, T-255, T-259
('30239be5-c4f7-4d8b-a47f-f24852801790', '667907cf-b08f-47b8-b9a2-817bf91368b2', 'blocks'),
('30239be5-c4f7-4d8b-a47f-f24852801790', '29499d84-aef8-467a-95f5-0af8d6db650d', 'blocks'),
('30239be5-c4f7-4d8b-a47f-f24852801790', '81cd1975-f330-4718-8ba0-9822408918ec', 'blocks'),
('30239be5-c4f7-4d8b-a47f-f24852801790', '738832e5-dc67-4b33-b2aa-2a2de17138f4', 'blocks'),
('30239be5-c4f7-4d8b-a47f-f24852801790', '37c8d031-f23d-46c4-84f6-56a5e251c734', 'blocks'),

-- T-261 depende de T-260; relates_to T-220 (admin config), T-084 (service detail client), T-085 (provider detail)
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', '30239be5-c4f7-4d8b-a47f-f24852801790', 'blocks'),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', '62485f81-556c-4777-9fa3-ed2dcb6ab47c', 'relates_to'),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', '682f02e9-4249-4279-9223-48993b5a4747', 'relates_to'),
('cf7134c9-769d-44dc-a53a-dbd51ed96d1d', 'ebdbb87e-e54b-404b-9ca9-0f524978b6c1', 'relates_to'),

-- T-262 depende de T-256, T-258 (jobs); relates_to T-215 (app_config base), T-224 (default seed)
('0d493e3e-d532-45b5-b6e0-e0a429461be1', '38db0d90-433e-444f-a174-95340e5742ba', 'blocks'),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'b372bf7b-2fd8-4738-bfa3-ea354625b27f', 'blocks'),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', '315c57de-7769-4f90-b45c-2447edd086a2', 'relates_to'),
('0d493e3e-d532-45b5-b6e0-e0a429461be1', 'ae31a446-0593-4bc9-b208-810edf3d6cab', 'relates_to');

COMMIT;
