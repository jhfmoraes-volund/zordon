-- Backlog Zordon — ZLAR-V2-US-020 (Engine de matching com pool broadcast e fairness)
-- Persona: SISTEMA | Módulo: MATCHING | AC: 14
-- Gerado em 2026-05-09 via /task-gen-story (modo orquestrado v3)
--
-- Este arquivo só insere metadata em tabelas internas do Zordon (Task,
-- AcceptanceCriterion, TaskAcceptanceCriterion, TaskDependency). NÃO executa
-- nenhum DDL/CRUD descrito dentro das descriptions — esses snippets são
-- especificação pra implementação futura no banco do produto Zelar.

BEGIN;

-- =============================================================================
-- 1. TASKS
-- =============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-238 (DATA) — matching_rounds + matching_round_candidates
('19d0b0ba-9504-4523-9efc-e51d14b8062c',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-238',
 'Criar enum matching_round_status + tabelas matching_rounds e matching_round_candidates',
 $desc$## Objetivo
Persistir cada ciclo de matching iniciado para uma `service_request`: o round em si (status, timing, outcome), os candidatos selecionados pro broadcast, suas decisões (offered/accepted/declined/expired) e o resultado final. Cobre AC #5/#6/#7/#11/#14 — base para auditoria, expiração programada, evento de fechamento e log auditável.

## Contexto
Módulo MATCHING. Consumido por: Edge Function `start-matching` (T-243) que insere o round, RPC `accept_proposal` (T-244) que persiste vencedor, jobs de expiração (T-245/T-246/T-248), Realtime channel matching_round (T-247). Depende de `service_requests` (T-070) e `provider_profiles` (T-002). Substitui qualquer lógica ad-hoc de "broadcast ativo" — é a fonte da verdade para "qual proposta está aberta agora pra qual prestador".

## Estado atual / O que substitui
Não existe. `service_requests` (T-070) tem FSM mas não modela tentativas/ciclos de matching paralelos.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_matching_rounds.sql`
```sql
BEGIN;

CREATE TYPE matching_round_status AS ENUM (
  'computing',     -- elegíveis sendo computados
  'broadcasting',  -- pool aberto, aguardando aceite
  'accepted',      -- alguém aceitou (provider_id em accepted_provider_id)
  'expired',       -- prazo de aceite esgotou sem aceite (vai pra alocação manual)
  'manual',        -- pool vazio na origem; ops vai alocar
  'cancelled_by_client'  -- cliente cancelou busca antes do prazo
);

CREATE TYPE matching_candidate_status AS ENUM (
  'offered',       -- recebeu o card
  'accepted',      -- foi o vencedor (única linha por round)
  'rejected',      -- declinou explicitamente
  'closed',        -- outro aceitou (fechamento por evento)
  'expired'        -- prazo do round esgotou sem ação
);

CREATE TABLE matching_rounds (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id       uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  attempt_number           int  NOT NULL DEFAULT 1,  -- N-ésimo round desta SR (cliente reabriu busca)
  status                   matching_round_status NOT NULL DEFAULT 'computing',
  eligible_count           int,                      -- |elegíveis filtrados| (pode ser 0 → manual)
  pool_size_target         int  NOT NULL,            -- top_n_default snapshot lido de app_config
  pool_size_actual         int,                      -- min(eligible, target)
  weights_snapshot         jsonb NOT NULL,           -- snapshot dos pesos Q/T/D/F/C usados
  accept_window_seconds    int  NOT NULL,            -- snapshot de matching.accept_window_minutes*60
  client_search_seconds    int  NOT NULL,            -- snapshot de matching.client_search_minutes*60
  accepted_candidate_id    uuid,                     -- FK preenchida no aceite
  broadcast_started_at     timestamptz,
  expires_at               timestamptz,              -- broadcast_started_at + accept_window
  client_search_expires_at timestamptz,              -- created + client_search
  ended_at                 timestamptz,
  ended_reason             text,                     -- 'accepted'|'expired'|'manual_no_pool'|'cancelled_by_client'
  "createdAt"              timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"              timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT one_open_round_per_request EXCLUDE USING gist (
    service_request_id WITH =
  ) WHERE (status IN ('computing','broadcasting'))
);

-- Index para jobs de expiração varrerem rounds abertos
CREATE INDEX idx_matching_rounds_expires_at ON matching_rounds(expires_at)
  WHERE status = 'broadcasting';
CREATE INDEX idx_matching_rounds_client_expires_at ON matching_rounds(client_search_expires_at)
  WHERE status IN ('computing','broadcasting');
CREATE INDEX idx_matching_rounds_service_request ON matching_rounds(service_request_id, attempt_number);

CREATE TABLE matching_round_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        uuid NOT NULL REFERENCES matching_rounds(id) ON DELETE CASCADE,
  provider_id     uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  rank_position   int  NOT NULL,            -- 1..N na ordem do score (top do top)
  score           numeric(8,4) NOT NULL,    -- score final usado pra ranquear
  score_breakdown jsonb NOT NULL,           -- {q: ..., t: ..., d: ..., f: ..., c: ..., raw: {...}}
  status          matching_candidate_status NOT NULL DEFAULT 'offered',
  offered_at      timestamptz NOT NULL DEFAULT NOW(),
  decided_at      timestamptz,              -- accepted_at / rejected_at / closed_at / expired_at
  decision_reason text,                     -- 'race_lost'|'manual_decline'|'window_expired'|null
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW(),
  -- Apenas 1 vencedor por round
  CONSTRAINT only_one_acceptance_per_round EXCLUDE (
    round_id WITH =
  ) WHERE (status = 'accepted'),
  -- Provider não aparece 2x no mesmo round
  UNIQUE (round_id, provider_id)
);

CREATE INDEX idx_matching_round_candidates_round ON matching_round_candidates(round_id);
CREATE INDEX idx_matching_round_candidates_provider_open
  ON matching_round_candidates(provider_id)
  WHERE status = 'offered';

-- FK reverso pro vencedor (set após aceite)
ALTER TABLE matching_rounds
  ADD CONSTRAINT fk_accepted_candidate
  FOREIGN KEY (accepted_candidate_id) REFERENCES matching_round_candidates(id);

ALTER TABLE matching_rounds              ENABLE ROW LEVEL SECURITY;
ALTER TABLE matching_round_candidates    ENABLE ROW LEVEL SECURITY;

-- RLS:
-- ADMIN: tudo. Outros usuários: nenhum acesso direto (engine roda em service_role).
-- Prestador NÃO consulta matching_rounds direto — recebe oferta via Realtime
-- (T-247) e ouve canal próprio. Cliente vê estado da busca via service_requests.
CREATE POLICY "matching_rounds_admin" ON matching_rounds
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "matching_candidates_admin" ON matching_round_candidates
  FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger updatedAt
CREATE TRIGGER matching_rounds_updated_at
  BEFORE UPDATE ON matching_rounds
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

CREATE TRIGGER matching_round_candidates_updated_at
  BEFORE UPDATE ON matching_round_candidates
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir SELECT direto de prestador em matching_round_candidates — exposição revela ranking interno (LGPD/competitivo). Acesso só via service_role na Edge Function `start-matching`.
- ❌ Persistir snapshot de pesos como FK pra app_config — pesos podem mudar, snapshot é por valor pra reproduzir cálculo histórico.
- ❌ Reusar matching_round pra "tentativas" do mesmo cliente sem incrementar `attempt_number` (atrapalha auditoria do AC#9 quando cliente reabre busca).
- ❌ Fundir matching_round_events (T-239) aqui — log de evento é tabela separada (append-only, RLS diferente).

## Convenções
- Migration via psql, `database.types.ts` regenerado
- `"createdAt"`/`"updatedAt"` com aspas duplas (convenção do projeto)
- Snapshots em jsonb pra reproduzibilidade do cálculo
- `EXCLUDE` constraints (não `UNIQUE`) pra travar "1 round aberto por request" e "1 aceite por round" — gist permite predicado parcial
- Reuso: `service_requests` (T-070), `provider_profiles` (T-002)$desc$,
 'DATA', 'SISTEMA',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-239 (DATA) — matching_round_events (audit imutável)
('c3267113-c593-4059-a3de-389b2e600d46',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-239',
 'Criar tabela matching_round_events (audit imutável de cada decisão do ciclo)',
 $desc$## Objetivo
Persistir cada evento relevante de um round de matching (computado, broadcastado, aceito, expirado, fechamento por evento, recusa, alocação manual) em audit log imutável que ops consulta pra revisar vieses, gargalos e calibrar pesos. Cobre AC #14.

## Contexto
Módulo MATCHING. Tabela append-only — mesma família de `service_events` (T-226), `provider_moderation_log` (T-204), `dispute_decisions` (T-155). Lida apenas por ADMIN. Escrita pela Edge Function `start-matching` (T-243), pela RPC `accept_proposal` (T-244), pelas Edge Functions de expiração (T-245, T-246).

## Estado atual / O que substitui
Não existe. T-238 cria a tabela "estado vivo" do round; T-239 cria a tabela de "trajetória".

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_matching_round_events.sql`
```sql
BEGIN;

CREATE TYPE matching_round_event_kind AS ENUM (
  'round_created',
  'eligibility_computed',
  'top_n_selected',
  'broadcast_sent',
  'pool_empty_manual',
  'candidate_offered',
  'candidate_accepted',
  'candidate_rejected',
  'candidate_closed',         -- fechamento por outro ter aceitado
  'candidate_expired',
  'round_expired',            -- prazo de aceite venceu sem aceite → manual
  'round_client_search_ended',-- prazo cliente venceu (devolve controle, sem alerta)
  'round_cancelled_by_client'
);

CREATE TABLE matching_round_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    uuid NOT NULL REFERENCES matching_rounds(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES matching_round_candidates(id) ON DELETE SET NULL,
  kind        matching_round_event_kind NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Pra eventos de pool/eligibility:
  --   {"eligible_count": N, "filters_applied": {...}}
  -- Pra eventos de candidate:
  --   {"provider_id": "...", "score": ..., "rank": ..., "reason": "..."}
  occurred_at timestamptz NOT NULL DEFAULT NOW(),
  "createdAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_matching_round_events_round ON matching_round_events(round_id, occurred_at);
CREATE INDEX idx_matching_round_events_kind ON matching_round_events(kind, occurred_at);

ALTER TABLE matching_round_events ENABLE ROW LEVEL SECURITY;

-- ADMIN lê; ninguém faz INSERT direto via cliente (sempre via service_role).
CREATE POLICY "matching_round_events_admin_read" ON matching_round_events
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Bloqueia UPDATE/DELETE mesmo via admin (audit imutável)
CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'matching_round_events is append-only';
END $$;

CREATE TRIGGER matching_round_events_no_update
  BEFORE UPDATE OR DELETE ON matching_round_events
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE/DELETE mesmo de admin (trigger bloqueia — auditoria precisa ser imutável)
- ❌ Inserir evento sem `round_id` (audit precisa amarrar trajetória)
- ❌ Tornar `payload` colunas tipadas — flexibilidade do jsonb permite adicionar tipos de evento sem migration

## Convenções
- Append-only com trigger de bloqueio (mesmo padrão de `service_events` T-226 e `provider_moderation_log` T-204)
- `payload jsonb` opaco com schema documentado por kind (no description)
- Reuso: padrão de audit log de `provider_moderation_log` (T-204)$desc$,
 'DATA', 'ADMIN',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-240 (DATA) — RPC compute_eligible_providers
('37df3158-2e84-4a1e-bb78-a92459fbebb7',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-240',
 'Criar RPC compute_eligible_providers(service_request_id) com filtros obrigatórios',
 $desc$## Objetivo
Função SQL `SECURITY DEFINER` que retorna o conjunto de prestadores elegíveis pra uma `service_request` aplicando os 5 filtros obrigatórios do AC #1: status ativo, disponibilidade ativada agora, dia/horário dentro da janela, categoria certificada e raio máximo. Adicionalmente exclui prestadores com serviço ativo nos estados terminais de presença ("a caminho", "chegou", "em execução") por AC #2. Cobre AC #1, #2, #13.

## Contexto
Módulo MATCHING. Consumida por `start-matching` (T-243) e por `expire-matching-broadcast` (T-245) ao recomputar antes de marcar manual. Lê: `provider_profiles` (T-002), `provider_categories` (T-003), `service_requests` (T-070). Reutiliza `is_provider_available_now(provider_id, ts)` (T-114, US-027). Lê config de `matching.eligibility_radius_km` em `app_config` (T-215).

## Estado atual / O que substitui
T-114 (`is_provider_available_now`) já existe e cobre o predicado de disponibilidade individual. Esta task agrega os 5 filtros num único SET.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_compute_eligible_providers.sql`
```sql
BEGIN;

-- Helper: distância haversine em km
CREATE OR REPLACE FUNCTION haversine_km(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) RETURNS numeric
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  r numeric := 6371;
  dlat numeric := radians(lat2 - lat1);
  dlng numeric := radians(lng2 - lng1);
  a numeric;
BEGIN
  a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)^2;
  RETURN r * 2 * asin(sqrt(a));
END $$;

CREATE OR REPLACE FUNCTION compute_eligible_providers(
  p_service_request_id uuid
)
RETURNS TABLE (
  provider_id   uuid,
  distance_km   numeric,
  filters_passed jsonb -- snapshot pro audit
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sr               service_requests%ROWTYPE;
  v_now              timestamptz := NOW();
  v_radius_km        numeric;
  v_excluded_states  text[] := ARRAY['en_route','arrived','in_progress'];
  -- Estados de presença que tornam prestador "ocupado". Devem casar com FSM
  -- canônica (T-227). Lista exata fica como constraint do produto.
BEGIN
  SELECT * INTO v_sr FROM service_requests WHERE id = p_service_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_request_not_found';
  END IF;

  v_radius_km := COALESCE(
    (SELECT (value)::numeric FROM app_config WHERE key = 'matching.eligibility_radius_km'),
    30  -- fallback hard
  );

  RETURN QUERY
  WITH base AS (
    SELECT
      pp.id AS provider_id,
      haversine_km(pp.base_lat, pp.base_lng, v_sr.address_lat, v_sr.address_lng) AS distance_km
    FROM provider_profiles pp
    -- Filtro 1: status ativo (sem suspensão)
    WHERE pp.account_status = 'active'
      -- Filtro 2: KYC aprovado
      AND pp.kyc_status = 'approved'
      -- Filtro 3: certificado pra categoria do request
      AND EXISTS (
        SELECT 1 FROM provider_categories pc
        WHERE pc.provider_id = pp.id
          AND pc.category_id = v_sr.category_id
          AND pc.certified_at IS NOT NULL
      )
      -- Filtro 4: disponibilidade ativada agora (reusa RPC T-114)
      AND is_provider_available_now(pp.id, v_now)
      -- Filtro 5: não tem serviço ativo em estado de presença (AC #2)
      AND NOT EXISTS (
        SELECT 1 FROM service_requests sr2
        WHERE sr2.provider_id = pp.id
          AND sr2.status = ANY (v_excluded_states)
      )
  )
  SELECT
    b.provider_id,
    b.distance_km,
    jsonb_build_object(
      'status_active', true,
      'kyc_approved', true,
      'category_certified', true,
      'available_now', true,
      'no_active_presence', true,
      'within_radius', b.distance_km <= v_radius_km
    )
  FROM base b
  -- Filtro 5: dentro do raio
  WHERE b.distance_km <= v_radius_km
  ORDER BY b.distance_km ASC;
END $$;

REVOKE ALL ON FUNCTION compute_eligible_providers(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION compute_eligible_providers(uuid) TO service_role;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir EXECUTE por authenticated direto — função expõe internals do matching e contorna RLS via SECURITY DEFINER. Apenas service_role chama (Edge Functions).
- ❌ Hardcodar raio (deve vir de `app_config.matching.eligibility_radius_km`) — AC#4 exige config sem deploy.
- ❌ Computar score aqui — função separada (T-241) por princípio de responsabilidade única; aqui só elegibilidade boolean.
- ❌ Filtrar por nível do prestador (Iniciante/Intermediário/Premium) — AC#12 explícito: nível só modula comissão, não elegibilidade nem rank.

## Convenções
- `SECURITY DEFINER` + `REVOKE FROM authenticated` (acesso só service_role)
- Estados de presença em variável local (refletem FSM da T-227); ajustar quando FSM canônica pousar
- Reuso: `is_provider_available_now` (T-114), `provider_profiles` (T-002), `provider_categories` (T-003), `app_config` (T-215)
- `haversine_km` como helper local; se PostGIS estiver instalado posteriormente, substituir por `ST_Distance` (não tarefa desta US)$desc$,
 'DATA', 'SISTEMA',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-241 (DATA) — RPC compute_provider_score
('57d9f39a-af3d-4b07-9132-3f98351ea385',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-241',
 'Criar RPC compute_provider_score(provider_id, service_request_id) com fatores Q/T/D/F/C',
 $desc$## Objetivo
Função SQL `SECURITY DEFINER` que calcula o score multivariado para um prestador elegível para uma `service_request`. Compõe 5 fatores normalizados em [0,1]: **Q**ualidade (avaliações ponderadas por recência), **T**rust/confiança (pontualidade, cancelamento, no-show, disputas perdidas em 12 meses), **D**isponibilidade (proporção ativo nos últimos 7 dias), **F**requência (volume concluído com floor para iniciantes, AC#12 — sem barreira de entrada), **C**obertura (distância + categoria). Pesos lidos de `app_config.matching.weights` (AC#4 — calibração sem deploy). Cobre AC #3, #4, #12.

## Contexto
Módulo MATCHING. Chamada por `select_top_n_for_broadcast` (T-242) para ranquear o conjunto vindo de `compute_eligible_providers` (T-240). Retorna score + breakdown JSON para auditoria (T-239). Lê: `service_request_reviews` (futuro), `service_events` (T-226), `provider_profiles` (T-002).

## Estado atual / O que substitui
Não existe. Pesos seedados via T-249.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_compute_provider_score.sql`
```sql
BEGIN;

-- Helpers de fator (cada um retorna numeric em [0,1])

CREATE OR REPLACE FUNCTION mscore_quality(p_provider_id uuid) RETURNS numeric
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  -- Avaliações ponderadas por recência (decay exponencial 90 dias)
  -- Sem reviews suficientes (<3): retorna 0.6 como neutro pra não punir iniciantes (AC#12)
  SELECT COALESCE(
    SUM(rating::numeric * EXP(-EXTRACT(EPOCH FROM (NOW() - "createdAt")) / (90*86400.0)))
      / NULLIF(SUM(EXP(-EXTRACT(EPOCH FROM (NOW() - "createdAt")) / (90*86400.0))), 0)
      / 5.0,
    0.6
  ) INTO v
  FROM service_request_reviews
  WHERE provider_id = p_provider_id;
  RETURN GREATEST(0, LEAST(1, v));
END $$;

CREATE OR REPLACE FUNCTION mscore_trust(p_provider_id uuid) RETURNS numeric
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int;
  v_problems int;
BEGIN
  -- Janela: últimos 12 meses. Pune: cancelamento_pelo_prestador + no_show + disputas_perdidas.
  -- Premia: pontualidade (chegou no horário sem atraso > X min — campo derivado).
  SELECT COUNT(*) INTO v_total
  FROM service_requests
  WHERE provider_id = p_provider_id
    AND "createdAt" > NOW() - INTERVAL '12 months';

  IF v_total = 0 THEN RETURN 0.6; END IF;  -- floor pra novato (AC#12)

  SELECT COUNT(*) INTO v_problems
  FROM service_requests
  WHERE provider_id = p_provider_id
    AND "createdAt" > NOW() - INTERVAL '12 months'
    AND (
      status = 'cancelled_by_provider' OR
      status = 'no_show' OR
      EXISTS (SELECT 1 FROM dispute_decisions dd
              WHERE dd.service_request_id = service_requests.id
                AND dd.outcome = 'against_provider')
    );

  RETURN GREATEST(0, 1 - (v_problems::numeric / v_total));
END $$;

CREATE OR REPLACE FUNCTION mscore_availability(p_provider_id uuid) RETURNS numeric
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  -- Proporção (segundos com disponibilidade ON) / (7 dias em segundos).
  -- Lê de provider_availability_log (registrada em T-115 PUT availability)
  -- Pra US-020 inicial, retorna 0.7 como neutro até log estar populado.
  SELECT COALESCE(
    EXTRACT(EPOCH FROM SUM(LEAST(ended_at, NOW()) - GREATEST(started_at, NOW() - INTERVAL '7 days')))
      / (7 * 86400),
    0.7
  ) INTO v
  FROM provider_availability_log
  WHERE provider_id = p_provider_id
    AND ended_at > NOW() - INTERVAL '7 days';
  RETURN GREATEST(0, LEAST(1, v));
END $$;

CREATE OR REPLACE FUNCTION mscore_frequency(p_provider_id uuid) RETURNS numeric
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_floor numeric;
BEGIN
  v_floor := COALESCE(
    (SELECT (value)::numeric FROM app_config WHERE key = 'matching.freq_floor_min'),
    0.5
  );
  SELECT COUNT(*) INTO v_count
  FROM service_requests
  WHERE provider_id = p_provider_id
    AND status = 'completed'
    AND "createdAt" > NOW() - INTERVAL '90 days';

  -- Saturação log: 0..30 mapeia ~0.5..1.0; floor pra novato AC#12
  RETURN GREATEST(v_floor, LEAST(1, 0.4 + 0.2 * ln(GREATEST(1, v_count + 1))));
END $$;

CREATE OR REPLACE FUNCTION mscore_coverage(p_distance_km numeric) RETURNS numeric
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  -- Decay linear: 0km → 1.0; raio max → 0.0 (raio max = config)
  RETURN GREATEST(0, LEAST(1, 1.0 - (p_distance_km / 30.0)));
END $$;

CREATE OR REPLACE FUNCTION compute_provider_score(
  p_provider_id        uuid,
  p_service_request_id uuid,
  p_distance_km        numeric
)
RETURNS TABLE (score numeric, breakdown jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w jsonb;
  q numeric; t numeric; d numeric; f numeric; c numeric;
  s numeric;
BEGIN
  w := COALESCE(
    (SELECT value FROM app_config WHERE key = 'matching.weights'),
    '{"q":0.30,"t":0.25,"d":0.15,"f":0.10,"c":0.20}'::jsonb
  );

  q := mscore_quality(p_provider_id);
  t := mscore_trust(p_provider_id);
  d := mscore_availability(p_provider_id);
  f := mscore_frequency(p_provider_id);
  c := mscore_coverage(p_distance_km);

  s := q * (w->>'q')::numeric
     + t * (w->>'t')::numeric
     + d * (w->>'d')::numeric
     + f * (w->>'f')::numeric
     + c * (w->>'c')::numeric;

  RETURN QUERY SELECT
    s,
    jsonb_build_object(
      'q', q, 't', t, 'd', d, 'f', f, 'c', c,
      'weights', w,
      'distance_km', p_distance_km
    );
END $$;

REVOKE ALL ON FUNCTION compute_provider_score(uuid,uuid,numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION compute_provider_score(uuid,uuid,numeric) TO service_role;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Usar `provider_profiles.tier` (Iniciante/Intermediário/Premium) como input do score — AC#12 é explícito: nível só modula comissão.
- ❌ Hardcodar pesos — todos vêm de `app_config.matching.weights` (T-249); fallback no SQL é defensa, não fonte da verdade.
- ❌ Punir prestador novato (sem reviews / sem histórico) com 0 — usar floor 0.6 (Q/T) e `freq_floor_min` (F) pra dar chance (AC#12).
- ❌ Permitir EXECUTE por authenticated — função SECURITY DEFINER com acesso a dados sensíveis cross-prestador. Só service_role.

## Convenções
- Cada fator helper retorna [0,1] e é STABLE (cacheable na query)
- Saturação log para frequência evita que prestadores com 1000+ jobs dominem ranking
- Decay 90d em qualidade (não 365d) prioriza performance recente
- Reuso: `app_config` (T-215), `provider_profiles` (T-002), `service_requests` (T-070), `dispute_decisions` (T-155)
- Tabelas referenciadas que não existem ainda no MVP (`service_request_reviews`, `provider_availability_log`): helpers retornam neutro até populadas — não bloqueia engine pra MVP$desc$,
 'DATA', 'SISTEMA',
 ARRAY['RLS_REQUIRED','NO_RLS_NEEDED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-242 (DATA) — RPC select_top_n_for_broadcast
('9c01345f-9ce3-48b4-8531-80318aa20a75',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-242',
 'Criar RPC select_top_n_for_broadcast(round_id, n) atomicamente',
 $desc$## Objetivo
Dado um round (já existe na T-238) com elegíveis computados, persistir as N melhores candidaturas em `matching_round_candidates` (uma linha por candidato com score + breakdown + rank), atualizar o round para `broadcasting`, gravar `broadcast_started_at` e `expires_at`, e emitir evento `top_n_selected` em `matching_round_events` (T-239). Quando elegíveis < N, broadcastia todos (AC#6). Cobre AC #5, #6.

## Contexto
Módulo MATCHING. Chamada por `start-matching` (T-243) imediatamente após `compute_eligible_providers` (T-240) + `compute_provider_score` (T-241). Mantém atomicidade do conjunto top-N: ou todos os candidates entram + round muda pra broadcasting, ou nada (BEGIN/COMMIT).

## Estado atual / O que substitui
Não existe. T-243 chama esta RPC.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_select_top_n_for_broadcast.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION select_top_n_for_broadcast(
  p_round_id uuid,
  p_eligibles jsonb  -- [{"provider_id":"...","distance_km":12.3}, ...]
)
RETURNS TABLE (
  candidate_id uuid,
  provider_id  uuid,
  rank         int,
  score        numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round           matching_rounds%ROWTYPE;
  v_n               int;
  v_eligible_count  int;
  v_pool_actual     int;
  v_accept_window_s int;
BEGIN
  SELECT * INTO v_round FROM matching_rounds
    WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round_not_found'; END IF;
  IF v_round.status NOT IN ('computing') THEN
    RAISE EXCEPTION 'round_not_in_computing_state' USING ERRCODE = '22023';
  END IF;

  v_n := v_round.pool_size_target;
  v_eligible_count := jsonb_array_length(p_eligibles);
  v_pool_actual := LEAST(v_n, v_eligible_count);
  v_accept_window_s := v_round.accept_window_seconds;

  IF v_eligible_count = 0 THEN
    -- AC #7: pool vazio → manual
    UPDATE matching_rounds
       SET status='manual', eligible_count=0, pool_size_actual=0,
           ended_at=NOW(), ended_reason='manual_no_pool'
     WHERE id = p_round_id;

    INSERT INTO matching_round_events (round_id, kind, payload)
    VALUES (p_round_id, 'pool_empty_manual', '{"eligible_count":0}'::jsonb);

    RETURN; -- 0 rows
  END IF;

  -- Computa score por candidato e ranqueia
  WITH scored AS (
    SELECT
      (e->>'provider_id')::uuid AS provider_id,
      (e->>'distance_km')::numeric AS distance_km,
      cps.score,
      cps.breakdown
    FROM jsonb_array_elements(p_eligibles) AS e,
         LATERAL compute_provider_score(
           (e->>'provider_id')::uuid,
           v_round.service_request_id,
           (e->>'distance_km')::numeric
         ) AS cps
  ),
  ranked AS (
    SELECT
      provider_id, distance_km, score, breakdown,
      ROW_NUMBER() OVER (ORDER BY score DESC, distance_km ASC) AS rk
    FROM scored
  ),
  inserted AS (
    INSERT INTO matching_round_candidates
      (round_id, provider_id, rank_position, score, score_breakdown, status, offered_at)
    SELECT p_round_id, provider_id, rk::int, score, breakdown, 'offered', NOW()
    FROM ranked
    WHERE rk <= v_pool_actual
    RETURNING id AS candidate_id, provider_id, rank_position AS rank, score
  )
  SELECT candidate_id, provider_id, rank, score FROM inserted;

  -- Atualiza round e registra evento
  UPDATE matching_rounds
     SET status='broadcasting',
         eligible_count = v_eligible_count,
         pool_size_actual = v_pool_actual,
         broadcast_started_at = NOW(),
         expires_at = NOW() + make_interval(secs => v_accept_window_s)
   WHERE id = p_round_id;

  INSERT INTO matching_round_events (round_id, kind, payload) VALUES
    (p_round_id, 'top_n_selected',
     jsonb_build_object('eligible_count', v_eligible_count,
                        'pool_size_actual', v_pool_actual,
                        'pool_size_target', v_n)),
    (p_round_id, 'broadcast_sent',
     jsonb_build_object('expires_at', NOW() + make_interval(secs => v_accept_window_s)));

  RETURN QUERY
  SELECT id, provider_id, rank_position, score
  FROM matching_round_candidates
  WHERE round_id = p_round_id
  ORDER BY rank_position;
END $$;

REVOKE ALL ON FUNCTION select_top_n_for_broadcast(uuid,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION select_top_n_for_broadcast(uuid,jsonb) TO service_role;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Quebrar atomicidade entre INSERT em candidates e UPDATE de status (precisa estar tudo em uma transação — função PL/pgSQL é atômica).
- ❌ Permitir N maior que tamanho do pool elegível sem comportamento explícito do AC#6 — sempre `LEAST(target, eligible)`.
- ❌ Priorizar quem aceitou primeiro durante broadcast (AC#5) — todos recebem ao mesmo tempo. Ordem de apresentação na UI do prestador é apenas visual; aceite final é por race no DB (T-244).
- ❌ Reusar mesmo round se status != 'computing' (`one_open_round_per_request` já trava na T-238).

## Convenções
- `FOR UPDATE` no round pra evitar 2 broadcasts simultâneos pra mesma SR
- `compute_provider_score` chamada via LATERAL (cada provider chama 1x)
- 2 eventos no `matching_round_events`: `top_n_selected` + `broadcast_sent` separados pra timing exato
- Reuso: `compute_provider_score` (T-241), `matching_rounds` (T-238), `matching_round_candidates` (T-238), `matching_round_events` (T-239)$desc$,
 'DATA', 'SISTEMA',
 ARRAY['RLS_REQUIRED','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-243 (API) — Edge Function start-matching
('597cd399-00b2-4b74-b345-4d7956be3903',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-243',
 'Implementar Edge Function start-matching (entrypoint pós-confirmação da SR)',
 $desc$## Objetivo
Edge Function chamada pelo lifecycle (T-234 dispatcher) ou diretamente após confirmação de pagamento da `service_request` (T-078 webhook MP) que orquestra um round de matching: cria `matching_rounds` snapshot dos pesos/janelas vindos de `app_config`, chama `compute_eligible_providers` (T-240), passa o conjunto pra `select_top_n_for_broadcast` (T-242), e quando o pool é vazio dispara notificação pra ops + cliente via `enqueue_notification_event` (T-162). Cobre AC #1, #2, #3, #5, #6, #7, #13.

## Contexto
Módulo MATCHING. Despacha o round inteiro como uma unidade idempotente — usa `idempotency_key = service_request_id + attempt_number` pra suportar retry. Cliente reabrir busca incrementa `attempt_number` (próxima Edge invocation cria round novo, não reusa).

## Estado atual / O que substitui
Não existe. Hoje pagamento confirmado em T-078 transiciona pro estado `awaiting_provider`; sem ninguém disparar o broadcast.

## O que criar

### `supabase/functions/start-matching/index.ts`
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface Body {
  service_request_id: string;
  triggered_by: 'payment_confirmed' | 'client_retry' | 'lifecycle_tick';
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = (await req.json()) as Body;
  if (!body.service_request_id) return Response.json({ error: 'missing_sr_id' }, { status: 400 });

  // 1. Snapshot de config
  const { data: cfg } = await supabase
    .from('app_config')
    .select('key,value')
    .in('key', [
      'matching.top_n_default',
      'matching.accept_window_minutes',
      'matching.client_search_minutes',
      'matching.weights',
    ]);
  const cfgMap = Object.fromEntries((cfg ?? []).map(c => [c.key, c.value]));

  // 2. Próximo attempt_number pra esta SR
  const { data: prev } = await supabase
    .from('matching_rounds')
    .select('attempt_number')
    .eq('service_request_id', body.service_request_id)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextAttempt = (prev?.attempt_number ?? 0) + 1;

  // 3. Cria round (status=computing)
  const { data: round, error: roundErr } = await supabase
    .from('matching_rounds')
    .insert({
      service_request_id: body.service_request_id,
      attempt_number: nextAttempt,
      status: 'computing',
      pool_size_target: cfgMap['matching.top_n_default'] ?? 5,
      weights_snapshot: cfgMap['matching.weights'],
      accept_window_seconds: (cfgMap['matching.accept_window_minutes'] ?? 15) * 60,
      client_search_seconds: (cfgMap['matching.client_search_minutes'] ?? 10) * 60,
      client_search_expires_at: new Date(
        Date.now() + (cfgMap['matching.client_search_minutes'] ?? 10) * 60_000,
      ).toISOString(),
    })
    .select('id, pool_size_target, accept_window_seconds')
    .single();

  if (roundErr) {
    // Conflito de exclusion constraint = round aberto já existe (idempotência)
    if (roundErr.code === '23P01') {
      return Response.json({ status: 'already_running' }, { status: 200 });
    }
    return Response.json({ error: roundErr.message }, { status: 500 });
  }

  await supabase.from('matching_round_events').insert({
    round_id: round.id,
    kind: 'round_created',
    payload: { triggered_by: body.triggered_by, attempt: nextAttempt },
  });

  // 4. Computa elegíveis
  const { data: eligibles, error: elErr } = await supabase
    .rpc('compute_eligible_providers', { p_service_request_id: body.service_request_id });

  if (elErr) {
    await supabase.from('matching_round_events').insert({
      round_id: round.id, kind: 'round_expired',
      payload: { error: elErr.message },
    });
    return Response.json({ error: 'eligibility_failed' }, { status: 500 });
  }

  await supabase.from('matching_round_events').insert({
    round_id: round.id, kind: 'eligibility_computed',
    payload: { count: eligibles?.length ?? 0 },
  });

  // 5. Top N + broadcast (RPC atômica)
  const { data: candidates, error: selErr } = await supabase
    .rpc('select_top_n_for_broadcast', {
      p_round_id: round.id,
      p_eligibles: eligibles,
    });

  if (selErr) return Response.json({ error: selErr.message }, { status: 500 });

  // 6. AC #7: pool vazio → notifica ops + cliente
  if (!candidates || candidates.length === 0) {
    await supabase.rpc('enqueue_notification_event', {
      p_kind: 'matching.manual_allocation_required',
      p_audience: 'ops',
      p_payload: { service_request_id: body.service_request_id, round_id: round.id },
    });
    await supabase.rpc('enqueue_notification_event', {
      p_kind: 'matching.manual_allocation_pending',
      p_audience: 'client',
      p_payload: { service_request_id: body.service_request_id },
    });
  } else {
    // Cada candidato → emit candidate_offered + push web (T-247 escuta o canal)
    for (const c of candidates) {
      await supabase.from('matching_round_events').insert({
        round_id: round.id, candidate_id: c.candidate_id, kind: 'candidate_offered',
        payload: { provider_id: c.provider_id, rank: c.rank, score: c.score },
      });
    }
  }

  return Response.json({
    round_id: round.id,
    status: candidates?.length ? 'broadcasting' : 'manual',
    pool_size: candidates?.length ?? 0,
  });
});
```

## Constraints / NÃO fazer
- ❌ Bloquear na resposta esperando aceite (Edge Function tem timeout; o aceite vem por outro endpoint T-244).
- ❌ Usar service_role pra UPDATE em SR direto sem passar por `transition_service_status` (T-235) — mantém audit/idempotência centralizados.
- ❌ Esquecer de set `client_search_expires_at` no round (job T-246 depende disso pra encerrar busca naturalmente).
- ❌ Permitir 2 rounds abertos pra mesma SR — exclusion constraint na T-238 evita isso (`one_open_round_per_request`).

## Convenções
- `Idempotency-Key` obrigatório (200 mesmo em retry conflict)
- Service role key apenas no env da Edge Function (memory `feedback_role_helpers_postgres`)
- `enqueue_notification_event` (T-162) pra todas as notificações — não chamar canal externo direto
- Reuso: `compute_eligible_providers` (T-240), `select_top_n_for_broadcast` (T-242), `app_config` (T-215), `enqueue_notification_event` (T-162)$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','INPUT_VALIDATION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-244 (API) — RPC accept_proposal (race-resistant)
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-244',
 'Implementar RPC accept_proposal(round_id, provider_id) com lock atômico + idempotência',
 $desc$## Objetivo
Endpoint da decisão atômica de aceite. Quando vários prestadores do pool tocam "Aceitar" em milissegundos, somente o primeiro persiste; demais recebem 409 (já alocado) imediatamente. Ao aceitar com sucesso: marca candidate aceito, marca outros candidates do mesmo round como `closed`, atualiza round para `accepted`, transita SR via `transition_service_status` (T-235) e emite `candidate_accepted` em `matching_round_events` (T-239). Cobre AC #10, #11.

## Contexto
Módulo MATCHING. Chamada pela UI do prestador (T-247 escuta o canal Realtime e mostra card; ao tocar "Aceitar" a UI chama esta RPC via route handler `/api/matching/accept`). A "fechamento dos cards" para os perdedores é via Realtime (T-247) — esta RPC só dispara o evento; o cliente Realtime do prestador remove o card visual.

## Estado atual / O que substitui
Não existe. Sem isso, prestadores podem aceitar simultaneamente e gerar duplo-vínculo na SR.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_accept_proposal_rpc.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION accept_proposal(
  p_round_id    uuid,
  p_provider_id uuid,
  p_idem_key    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round       matching_rounds%ROWTYPE;
  v_candidate   matching_round_candidates%ROWTYPE;
  v_already     matching_round_candidates%ROWTYPE;
  v_other_count int;
BEGIN
  -- Idempotência: se já houver registro com este idem_key, retorna idempotente
  IF EXISTS (
    SELECT 1 FROM matching_round_events
    WHERE round_id = p_round_id
      AND kind = 'candidate_accepted'
      AND payload->>'idem_key' = p_idem_key
  ) THEN
    RETURN jsonb_build_object('status','idempotent_replay','round_id',p_round_id);
  END IF;

  -- 1. Lock pessimista no round + checa estado
  SELECT * INTO v_round FROM matching_rounds
    WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round_not_found'; END IF;

  IF v_round.status = 'accepted' THEN
    -- Race perdida: alguém aceitou nos últimos ms
    RAISE EXCEPTION 'already_accepted' USING ERRCODE='23505';
  END IF;
  IF v_round.status NOT IN ('broadcasting') THEN
    RAISE EXCEPTION 'round_not_broadcasting' USING ERRCODE='22023';
  END IF;
  IF v_round.expires_at < NOW() THEN
    RAISE EXCEPTION 'round_expired' USING ERRCODE='22023';
  END IF;

  -- 2. Acha candidate desse provider neste round
  SELECT * INTO v_candidate FROM matching_round_candidates
    WHERE round_id = p_round_id
      AND provider_id = p_provider_id
      AND status = 'offered'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_in_pool' USING ERRCODE='42501'; END IF;

  -- 3. Marca este candidate como aceito
  UPDATE matching_round_candidates
     SET status = 'accepted', decided_at = NOW()
   WHERE id = v_candidate.id;

  -- 4. Marca outros candidates do round como closed
  UPDATE matching_round_candidates
     SET status = 'closed', decided_at = NOW(), decision_reason = 'race_lost'
   WHERE round_id = p_round_id
     AND id != v_candidate.id
     AND status = 'offered';

  -- 5. Marca round aceito
  UPDATE matching_rounds
     SET status = 'accepted',
         accepted_candidate_id = v_candidate.id,
         ended_at = NOW(),
         ended_reason = 'accepted'
   WHERE id = p_round_id;

  -- 6. Transita SR via FSM canônica (T-235)
  PERFORM transition_service_status(
    v_round.service_request_id,
    'matched',  -- estado canônico após aceite (consultar FSM T-227)
    p_provider_id,
    p_idem_key,
    jsonb_build_object('round_id', p_round_id, 'candidate_id', v_candidate.id)
  );

  -- 7. Emit eventos pro audit
  INSERT INTO matching_round_events (round_id, candidate_id, kind, payload) VALUES
    (p_round_id, v_candidate.id, 'candidate_accepted',
     jsonb_build_object('provider_id', p_provider_id, 'idem_key', p_idem_key));

  -- 8. Conta perdedores pra response
  SELECT COUNT(*) INTO v_other_count FROM matching_round_candidates
    WHERE round_id = p_round_id AND status = 'closed';

  -- 9. Insere candidate_closed pra cada perdedor (Realtime T-247 escuta)
  INSERT INTO matching_round_events (round_id, candidate_id, kind, payload)
  SELECT p_round_id, id, 'candidate_closed',
         jsonb_build_object('provider_id', provider_id, 'reason', 'race_lost')
  FROM matching_round_candidates
  WHERE round_id = p_round_id AND status = 'closed';

  RETURN jsonb_build_object(
    'status', 'accepted',
    'round_id', p_round_id,
    'candidate_id', v_candidate.id,
    'service_request_id', v_round.service_request_id,
    'closed_count', v_other_count
  );
END $$;

REVOKE ALL ON FUNCTION accept_proposal(uuid,uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_proposal(uuid,uuid,text) TO service_role;

COMMIT;
```

### `src/app/api/matching/accept/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.object({
  round_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  // Provider id = user.id (uuid igual em provider_profiles)
  const body = Body.parse(await req.json());

  // Service-role chama a RPC SECURITY DEFINER
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('accept_proposal', {
    p_round_id: body.round_id,
    p_provider_id: user.id,
    p_idem_key: idemKey,
  });

  if (error) {
    if (error.code === '23505') return Response.json({ error: 'already_accepted' }, { status: 409 });
    if (error.code === '22023') return Response.json({ error: 'round_not_acceptable' }, { status: 409 });
    if (error.code === '42501') return Response.json({ error: 'not_in_pool' }, { status: 403 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}
```

## Constraints / NÃO fazer
- ❌ Aceitar `provider_id` no body (vem do JWT) — bloqueia aceite por proxy.
- ❌ Atualizar SR direto sem `transition_service_status` (T-235) — quebra audit + race-protection do FSM.
- ❌ Bloquear espera por Realtime no perdedor — cliente Supabase Realtime entrega o `candidate_closed` event de forma assíncrona; UI reage.
- ❌ Permitir aceite após `expires_at` (job T-245 já vai marcar `expired`, mas guard duplo no SQL trava race com job).

## Convenções
- `idempotency-key` obrigatório (header), guarda contra duplo-tap mobile
- 409 pra race perdida e estado terminal (não 5xx)
- 403 pra "não está no pool deste round" (não revelar que round existe)
- Reuso: `transition_service_status` (T-235), `matching_rounds` (T-238), `matching_round_candidates` (T-238), `matching_round_events` (T-239)$desc$,
 'API', 'SISTEMA',
 ARRAY['IDEMPOTENCY_KEY','RACE_CONDITION','INPUT_VALIDATION','RATE_LIMIT','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-245 (API) — Edge Function expire-matching-broadcast
('bf5c9510-0822-47c9-9cd7-0824dbfd5611',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-245',
 'Implementar Edge Function expire-matching-broadcast (encerra rounds com prazo vencido)',
 $desc$## Objetivo
Edge Function chamada por pg_cron a cada 30s (T-248) que varre `matching_rounds` em status `broadcasting` com `expires_at < NOW()`, marca round + candidates como `expired`, dispara notificação pra ops (alocação manual) + cliente, e registra `round_expired` em `matching_round_events`. Cobre AC #8.

## Contexto
Módulo MATCHING. Distinto de T-246 (que encerra busca pro cliente naturalmente sem alertar ops). Aqui o prazo dos prestadores estourou, então a alocação não foi possível pelo broadcast — equipe entra. Idempotente: round já `expired/manual` é skipado.

## Estado atual / O que substitui
Não existe. Sem isso, rounds ficam abertos indefinidamente.

## O que criar

### `supabase/functions/expire-matching-broadcast/index.ts`
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Acha rounds com prazo de aceite vencido
  const { data: expired } = await supabase
    .from('matching_rounds')
    .select('id, service_request_id')
    .eq('status', 'broadcasting')
    .lt('expires_at', new Date().toISOString())
    .limit(50);

  if (!expired?.length) return Response.json({ processed: 0 });

  let processed = 0;
  for (const r of expired) {
    // Atomic: marca round + candidates expired
    const { error } = await supabase.rpc('expire_matching_round', {
      p_round_id: r.id,
      p_reason: 'broadcast_window_expired',
    });
    if (error) {
      console.error('expire_round_failed', r.id, error);
      continue;
    }

    // Notifica ops (alocação manual) + cliente
    await supabase.rpc('enqueue_notification_event', {
      p_kind: 'matching.manual_allocation_required',
      p_audience: 'ops',
      p_payload: { service_request_id: r.service_request_id, round_id: r.id },
    });
    await supabase.rpc('enqueue_notification_event', {
      p_kind: 'matching.manual_allocation_pending',
      p_audience: 'client',
      p_payload: { service_request_id: r.service_request_id },
    });

    processed++;
  }

  return Response.json({ processed });
});
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_expire_matching_round_rpc.sql`
```sql
CREATE OR REPLACE FUNCTION expire_matching_round(
  p_round_id uuid,
  p_reason   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v matching_rounds%ROWTYPE;
BEGIN
  SELECT * INTO v FROM matching_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v.status != 'broadcasting' THEN RETURN; END IF;

  UPDATE matching_round_candidates
     SET status='expired', decided_at=NOW(), decision_reason=p_reason
   WHERE round_id = p_round_id AND status = 'offered';

  UPDATE matching_rounds
     SET status='expired', ended_at=NOW(), ended_reason=p_reason
   WHERE id = p_round_id;

  INSERT INTO matching_round_events (round_id, kind, payload)
  VALUES (p_round_id, 'round_expired', jsonb_build_object('reason', p_reason));

  -- Emit candidate_expired pra cada (UI do prestador remove card via Realtime T-247)
  INSERT INTO matching_round_events (round_id, candidate_id, kind, payload)
  SELECT p_round_id, id, 'candidate_expired',
         jsonb_build_object('provider_id', provider_id)
  FROM matching_round_candidates
  WHERE round_id = p_round_id AND status = 'expired';
END $$;

REVOKE ALL ON FUNCTION expire_matching_round(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_matching_round(uuid,text) TO service_role;
```

## Constraints / NÃO fazer
- ❌ Encerrar mais de 50 rounds por execução — limite explícito pra não sobrecarregar single-tick.
- ❌ Encerrar round com status != broadcasting (RPC já guarda).
- ❌ Esquecer de emitir `candidate_expired` por candidato (Realtime do prestador depende disso pra fechar cards — AC#11).

## Convenções
- Job de 30s pra latência baixa entre prazo vencer e ops ser notificada
- Reuso: `enqueue_notification_event` (T-162), `matching_rounds` (T-238)
- Notificação distinta por audience (ops vs client) — templates em T-216$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-246 (API) — Edge Function expire-client-search
('90d40059-1122-40ce-aec0-4ff449ce8f7c',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-246',
 'Implementar Edge Function expire-client-search (encerra busca pro cliente sem alertar ops)',
 $desc$## Objetivo
Edge Function disparada por pg_cron a cada 30s (T-248) que varre `matching_rounds` em status `computing` ou `broadcasting` com `client_search_expires_at < NOW()` E sem aceite. Encerra a busca pro cliente naturalmente: marca round como `cancelled_by_client` (sem notificar ops, sem alocação manual), notifica cliente "tente novamente quando quiser", devolve a SR para estado pré-matching. Cobre AC #9.

## Contexto
Módulo MATCHING. Distinção crítica vs T-245: aqui o prazo do **cliente** (10 min default, vs 15 min do prestador) venceu sem aceite. Comportamento explícito do AC#9: encerra naturalmente, devolve controle ao cliente, **não gera alerta para a equipe** (distinto da alocação manual). Se prazo do prestador vencer **antes** do cliente, T-245 trata; se prazo do cliente vencer antes/junto, T-246 trata. Como prestador (15) > cliente (10), normalmente T-246 dispara antes — exceto se cliente reabriu busca (`attempt_number > 1` e `client_search_expires_at` foi reset).

## Estado atual / O que substitui
Não existe. Sem isso, cliente fica preso na tela de "buscando" até T-245 disparar (uma alocação manual indesejada).

## O que criar

### `supabase/functions/expire-client-search/index.ts`
```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: expired } = await supabase
    .from('matching_rounds')
    .select('id, service_request_id')
    .in('status', ['computing', 'broadcasting'])
    .lt('client_search_expires_at', new Date().toISOString())
    .limit(50);

  if (!expired?.length) return Response.json({ processed: 0 });

  let processed = 0;
  for (const r of expired) {
    const { error } = await supabase.rpc('cancel_round_for_client', {
      p_round_id: r.id,
    });
    if (error) {
      console.error('cancel_round_failed', r.id, error);
      continue;
    }

    // Notifica cliente (sem ops! distinto de T-245)
    await supabase.rpc('enqueue_notification_event', {
      p_kind: 'matching.client_search_ended_natural',
      p_audience: 'client',
      p_payload: { service_request_id: r.service_request_id },
    });
    processed++;
  }

  return Response.json({ processed });
});
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_cancel_round_for_client_rpc.sql`
```sql
CREATE OR REPLACE FUNCTION cancel_round_for_client(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v matching_rounds%ROWTYPE;
BEGIN
  SELECT * INTO v FROM matching_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND OR v.status NOT IN ('computing','broadcasting') THEN RETURN; END IF;

  UPDATE matching_round_candidates
     SET status='closed', decided_at=NOW(), decision_reason='client_search_ended'
   WHERE round_id = p_round_id AND status = 'offered';

  UPDATE matching_rounds
     SET status='cancelled_by_client', ended_at=NOW(),
         ended_reason='client_search_window_expired'
   WHERE id = p_round_id;

  INSERT INTO matching_round_events (round_id, kind, payload)
  VALUES (p_round_id, 'round_client_search_ended', '{}'::jsonb);

  INSERT INTO matching_round_events (round_id, candidate_id, kind, payload)
  SELECT p_round_id, id, 'candidate_closed',
         jsonb_build_object('provider_id', provider_id, 'reason', 'client_search_ended')
  FROM matching_round_candidates
  WHERE round_id = p_round_id AND status = 'closed';

  -- Devolve SR pro estado pré-matching (cliente pode tentar de novo)
  -- Estado canônico = 'awaiting_provider' (consultar FSM T-227)
  -- via transition_service_status pra preservar audit
  PERFORM transition_service_status(
    v.service_request_id,
    'search_paused',  -- ajustar quando FSM canônica pousar
    NULL, -- ator = sistema
    'expire-client-search-' || p_round_id::text,
    jsonb_build_object('round_id', p_round_id, 'reason', 'client_search_window_expired')
  );
END $$;

REVOKE ALL ON FUNCTION cancel_round_for_client(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_round_for_client(uuid) TO service_role;
```

## Constraints / NÃO fazer
- ❌ Notificar ops aqui — AC#9 explícito: distinto da alocação manual, sem alerta pra equipe.
- ❌ Marcar candidates como `expired` (semântica de prazo do prestador). Aqui é `closed` com reason `client_search_ended`.
- ❌ Bloquear caso T-245 já tenha marcado round como `expired` (RPC guarda — só processa se ainda em estado aberto).

## Convenções
- Mesmo job pg_cron de 30s (T-248) que T-245
- Notificação `matching.client_search_ended_natural` é template separado (T-216) — wording amigável "tente quando quiser"
- Reuso: `enqueue_notification_event` (T-162), `transition_service_status` (T-235)$desc$,
 'API', 'SISTEMA',
 ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-247 (REALTIME) — Canal matching_round
('c293594a-5222-4bda-9afd-6850845b5766',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-247',
 'Configurar canal Realtime matching:provider:{provider_id} para ofertas e fechamento',
 $desc$## Objetivo
Canal Realtime que entrega ao prestador, em tempo real, novas propostas de matching (`candidate_offered`) e fechamento (`candidate_closed`/`candidate_expired`). PWA do prestador subscreve no app boot; ao receber `offered` mostra card; ao receber `closed/expired` remove card — viabilizando AC #5 (broadcast simultâneo) e AC #11 (fechamento em tempo real para perdedores).

## Contexto
Módulo MATCHING. Subscriber: PWA prestador (renderização do card é tarefa de US futura — esta task entrega o canal + hook). Source: `matching_round_events` INSERT filtrado por `payload->>'provider_id' = current_provider_id`. RLS já bloqueia leitura cross-prestador (T-238), mas Realtime precisa de policy explícita pra `postgres_changes` na tabela ser entregue.

## Estado atual / O que substitui
Não existe. Sem isso, prestador não vê card em tempo real (teria que poll-far).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_matching_realtime_policies.sql`
```sql
BEGIN;

-- Adiciona tabela ao publication realtime
ALTER PUBLICATION supabase_realtime ADD TABLE matching_round_events;

-- Policy de SELECT por authenticated pra ler EVENTS dele
-- (events não tem provider_id direto — vem do payload jsonb)
-- Pra Realtime, precisa que RLS deixe SELECT passar.
-- Melhor: criar VIEW dedicada provider_matching_events com filter aplicado.

CREATE OR REPLACE VIEW provider_matching_events
WITH (security_invoker = true) AS
SELECT
  e.id, e.round_id, e.candidate_id, e.kind, e.payload, e.occurred_at,
  (e.payload->>'provider_id')::uuid AS provider_id
FROM matching_round_events e
WHERE e.kind IN ('candidate_offered','candidate_closed','candidate_expired','candidate_accepted');

-- Policy: prestador só lê eventos com provider_id = auth.uid()
ALTER TABLE matching_round_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matching_events_provider_self" ON matching_round_events
  FOR SELECT TO authenticated
  USING (
    kind IN ('candidate_offered','candidate_closed','candidate_expired')
    AND (payload->>'provider_id')::uuid = auth.uid()
  );

COMMIT;
```

### `src/hooks/use-matching-proposals.ts`
```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

export interface PendingProposal {
  round_id: string;
  candidate_id: string;
  service_request_id: string;
  rank: number;
  score: number;
  expires_at: string; // computed client-side from offered_at + accept_window_seconds
}

export function useMatchingProposals(providerId: string) {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);

  const removeProposal = useCallback((roundId: string) => {
    setProposals(p => p.filter(x => x.round_id !== roundId));
  }, []);

  const addProposal = useCallback(async (roundId: string, candidateId: string) => {
    const supabase = createBrowserClient();
    const { data: round } = await supabase
      .from('matching_rounds')
      .select('id, service_request_id, expires_at, accept_window_seconds')
      .eq('id', roundId).maybeSingle();
    if (!round) return; // RLS bloqueou ou desapareceu

    const { data: cand } = await supabase
      .from('matching_round_candidates')
      .select('id, rank_position, score')
      .eq('id', candidateId).maybeSingle();
    if (!cand) return;

    setProposals(p => [...p.filter(x => x.round_id !== roundId), {
      round_id: roundId,
      candidate_id: cand.id,
      service_request_id: round.service_request_id,
      rank: cand.rank_position,
      score: cand.score,
      expires_at: round.expires_at,
    }]);
  }, []);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`matching:provider:${providerId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'matching_round_events',
      }, (payload) => {
        const evt = payload.new as {
          kind: string;
          round_id: string;
          candidate_id: string | null;
          payload: { provider_id?: string };
        };
        if (evt.payload?.provider_id !== providerId) return; // safety net
        if (evt.kind === 'candidate_offered' && evt.candidate_id) {
          addProposal(evt.round_id, evt.candidate_id);
        } else if (evt.kind === 'candidate_closed' || evt.kind === 'candidate_expired') {
          removeProposal(evt.round_id);
        }
      })
      .subscribe();

    // Fallback: poll a cada 10s pra rounds abertos pra esse provider
    const pollId = setInterval(async () => {
      // (queries em sync — implementação em task UI futura)
    }, 10_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollId);
    };
  }, [providerId, addProposal, removeProposal]);

  return { proposals, removeProposal };
}
```

## Constraints / NÃO fazer
- ❌ Subscribe direto sem RLS na publication — outros prestadores receberiam ofertas alheias.
- ❌ Confiar 100% em Realtime sem fallback (rede móvel cai). Polling 10s como rede de segurança.
- ❌ Esquecer `removeChannel` no unmount (memory leak / canal duplicado).
- ❌ Filtrar no cliente sem RLS server-side — proteção em camadas (RLS + filtro JS).

## Convenções
- Nome do canal: `matching:provider:{id}` (consistente com `service:{id}` da T-081)
- RLS via `payload->>'provider_id'` — alternativa seria coluna dedicada, mas overhead pra MVP
- Reuso: padrão de `useServiceRealtime` (T-081/use-service-realtime.ts), `createBrowserClient` (lib/supabase/client.ts)$desc$,
 'REALTIME', 'PRESTADOR',
 ARRAY['REALTIME_CHANNEL','RLS_REQUIRED','REUSE_EXISTING_HOOK'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-248 (OPS) — pg_cron jobs de expiração
('7935fbfc-a49e-4629-9cc1-7181f145ef52',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-248',
 'Configurar pg_cron jobs expire-matching-broadcast e expire-client-search (cada 30s)',
 $desc$## Objetivo
Agendar 2 jobs `pg_cron` que invocam as Edge Functions T-245 (`expire-matching-broadcast`) e T-246 (`expire-client-search`) a cada 30 segundos. Sem isso, expiração depende de chamada manual e os AC #8 e #9 não acontecem em produção. Cobre AC #8, #9.

## Contexto
Módulo MATCHING. Mesma família de jobs de T-080 (expirar VT 48h), T-113 (lembrete 2h), T-126 (escrow T+72h), T-233 (jobs ciclo de vida). Idempotente — Edge Functions são thread-safe via `FOR UPDATE` na T-245/T-246.

## Estado atual / O que substitui
Não existe. Jobs `pg_cron` já existem em outras funcionalidades (mesmo padrão).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_matching_cron_jobs.sql`
```sql
BEGIN;

-- Pré-requisito: extensão pg_cron habilitada (já está em outras tasks DATA)
-- Se não estiver: CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'matching-expire-broadcast',
  '*/30 * * * * *',  -- a cada 30s (sintaxe extended)
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/expire-matching-broadcast',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'matching-expire-client-search',
  '*/30 * * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/expire-client-search',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Job intervalo > 60s — degradaria UX (cliente fica até 1+ minuto vendo "buscando" após prazo).
- ❌ Job intervalo < 10s — sobrecarga sem ganho mensurável (granularidade do AC é minutos).
- ❌ Usar `cron.schedule` com fórmula sem `current_setting` pra service_role — secret hardcoded vaza no SQL log.
- ❌ Esquecer GUC `app.supabase_url` / `app.supabase_service_role_key` (config separada, ver runbook ops).

## Convenções
- Sintaxe `*/30 * * * * *` = 6 campos extended pra granularidade segundos (pg_cron 1.4+)
- `current_setting('app.supabase_url')` lê GUC seteado no runbook (não env do Postgres)
- Reuso: padrão dos jobs T-080 (US-011), T-113 (US-027), T-126 (US-028), T-233 (US-023)
- Para staging/dev: rodar via `cron.unschedule('matching-expire-broadcast')` antes de re-schedular$desc$,
 'OPS', 'SISTEMA',
 ARRAY['SECRET_HANDLING'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-249 (OPS) — Seed app_config matching.*
('10884ed2-628a-48a6-9767-ecdd7cd1a98b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'aec7bce2-edf9-4f8d-869d-9d7c18c53138',
 'ZLAR-V2-T-249',
 'Seedar app_config com keys matching.* (weights, top_n, janelas, raio, freq_floor)',
 $desc$## Objetivo
Inserir/upsert no `app_config` (T-215) os parâmetros operacionais do matching engine que precisam ser configuráveis sem deploy: pesos do score Q/T/D/F/C, tamanho default do pool (top N), janelas de aceite (prestador 15min, cliente 10min), raio máximo de elegibilidade, floor de frequência pra novato. Cobre AC #4 (calibração contínua sem deploy).

## Contexto
Módulo MATCHING. Lido por: T-240 (eligibility raio), T-241 (weights, freq_floor), T-243 (top_n_default, accept_window_minutes, client_search_minutes). Faz parte da mesma família de seeds que T-203 (supply_min/peak_hours), T-214 (kyc_score_thresholds), T-224 (default por seção), T-237 (prazos do ciclo), T-145 (support_sla_hours), T-158 (dispute_*), T-064 (visita técnica). Editável pelo admin via UI (T-220 — `/admin/config`).

## Estado atual / O que substitui
T-215 cria a tabela `app_config`. T-224 seedou keys default por seção. Esta task adiciona/sobrescreve a seção `matching.*` com os defaults do engine.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_seed_app_config_matching.sql`
```sql
BEGIN;

-- Pesos do score multivariado (AC#3, AC#4)
-- Soma = 1.0; sintonia inicial baseada em produto
INSERT INTO app_config (key, value, section, value_schema, description) VALUES
  ('matching.weights',
   '{"q":0.30,"t":0.25,"d":0.15,"f":0.10,"c":0.20}'::jsonb,
   'matching',
   '{"type":"object","required":["q","t","d","f","c"],"properties":{"q":{"type":"number","min":0,"max":1},"t":{"type":"number","min":0,"max":1},"d":{"type":"number","min":0,"max":1},"f":{"type":"number","min":0,"max":1},"c":{"type":"number","min":0,"max":1}}}'::jsonb,
   'Pesos do score multivariado: Quality(reviews), Trust(comportamento), Disponibilidade(7d), Frequencia(volume), Cobertura(distancia). Soma deve ser 1.0.'),

  ('matching.top_n_default',
   '5'::jsonb,
   'matching',
   '{"type":"integer","min":1,"max":20}'::jsonb,
   'Tamanho default do pool de prestadores que recebem o broadcast simultaneo (AC#5).'),

  ('matching.accept_window_minutes',
   '15'::jsonb,
   'matching',
   '{"type":"integer","min":1,"max":60}'::jsonb,
   'Prazo em minutos pra prestadores do pool aceitarem antes do round expirar e ir pra alocacao manual (AC#8).'),

  ('matching.client_search_minutes',
   '10'::jsonb,
   'matching',
   '{"type":"integer","min":1,"max":60}'::jsonb,
   'Prazo em minutos pra busca visivel do cliente; ao expirar, busca encerra naturalmente sem alertar ops (AC#9).'),

  ('matching.eligibility_radius_km',
   '30'::jsonb,
   'matching',
   '{"type":"number","min":1,"max":200}'::jsonb,
   'Raio maximo em km para um prestador ser considerado elegivel para uma solicitacao (AC#1).'),

  ('matching.freq_floor_min',
   '0.5'::jsonb,
   'matching',
   '{"type":"number","min":0,"max":1}'::jsonb,
   'Floor minimo do fator F (frequencia) para nao penalizar iniciantes; mantem barreira de entrada baixa (AC#12).')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      section = EXCLUDED.section,
      value_schema = EXCLUDED.value_schema,
      description = EXCLUDED.description;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Hardcodar esses valores em código (constantes TS) — AC#4 explícito: calibração sem deploy.
- ❌ Permitir soma dos pesos != 1 sem validação na UI admin (T-220 deve checar).
- ❌ Reduzir `freq_floor_min` abaixo de 0.4 sem revisão de produto (AC#12 anti-barreira-entrada).
- ❌ Esquecer `value_schema` — UI admin de T-220 usa pra renderizar inputs corretos.

## Convenções
- Mesma estrutura de seed das outras tasks OPS (T-203, T-214, T-224, T-237)
- `ON CONFLICT DO UPDATE` pra suportar re-aplicação em ambiente já configurado
- `section='matching'` pra agrupamento na UI admin (T-220 colapsável)
- Reuso: schema da T-215 (`app_config` com section/value_schema)$desc$,
 'OPS', 'ADMIN',
 ARRAY['NO_RLS_NEEDED'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- =============================================================================
-- 2. TASK ↔ AC-DA-STORY (TaskAcceptanceCriterion)
-- =============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-238 (matching_rounds + matching_round_candidates) → AC#5,#6,#7,#11,#14
  ('19d0b0ba-9504-4523-9efc-e51d14b8062c'::uuid, 5),
  ('19d0b0ba-9504-4523-9efc-e51d14b8062c'::uuid, 6),
  ('19d0b0ba-9504-4523-9efc-e51d14b8062c'::uuid, 7),
  ('19d0b0ba-9504-4523-9efc-e51d14b8062c'::uuid, 11),
  ('19d0b0ba-9504-4523-9efc-e51d14b8062c'::uuid, 14),
  -- T-239 (matching_round_events) → AC#14
  ('c3267113-c593-4059-a3de-389b2e600d46'::uuid, 14),
  -- T-240 (compute_eligible_providers) → AC#1,#2,#13
  ('37df3158-2e84-4a1e-bb78-a92459fbebb7'::uuid, 1),
  ('37df3158-2e84-4a1e-bb78-a92459fbebb7'::uuid, 2),
  ('37df3158-2e84-4a1e-bb78-a92459fbebb7'::uuid, 13),
  -- T-241 (compute_provider_score) → AC#3,#4,#12
  ('57d9f39a-af3d-4b07-9132-3f98351ea385'::uuid, 3),
  ('57d9f39a-af3d-4b07-9132-3f98351ea385'::uuid, 4),
  ('57d9f39a-af3d-4b07-9132-3f98351ea385'::uuid, 12),
  -- T-242 (select_top_n_for_broadcast) → AC#5,#6
  ('9c01345f-9ce3-48b4-8531-80318aa20a75'::uuid, 5),
  ('9c01345f-9ce3-48b4-8531-80318aa20a75'::uuid, 6),
  -- T-243 (start-matching Edge Fn) → AC#1,#2,#3,#5,#6,#7,#13
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 1),
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 2),
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 3),
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 5),
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 6),
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 7),
  ('597cd399-00b2-4b74-b345-4d7956be3903'::uuid, 13),
  -- T-244 (accept_proposal RPC) → AC#10,#11
  ('ccbc986b-cfdd-42d3-8eac-a96860c07dc4'::uuid, 10),
  ('ccbc986b-cfdd-42d3-8eac-a96860c07dc4'::uuid, 11),
  -- T-245 (expire-matching-broadcast) → AC#8
  ('bf5c9510-0822-47c9-9cd7-0824dbfd5611'::uuid, 8),
  -- T-246 (expire-client-search) → AC#9
  ('90d40059-1122-40ce-aec0-4ff449ce8f7c'::uuid, 9),
  -- T-247 (Realtime channel) → AC#5,#11
  ('c293594a-5222-4bda-9afd-6850845b5766'::uuid, 5),
  ('c293594a-5222-4bda-9afd-6850845b5766'::uuid, 11),
  -- T-248 (pg_cron jobs) → AC#8,#9
  ('7935fbfc-a49e-4629-9cc1-7181f145ef52'::uuid, 8),
  ('7935fbfc-a49e-4629-9cc1-7181f145ef52'::uuid, 9),
  -- T-249 (seed app_config matching.*) → AC#4
  ('10884ed2-628a-48a6-9767-ecdd7cd1a98b'::uuid, 4)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =============================================================================
-- 3. AC-DA-TASK (AcceptanceCriterion com taskId — checklist técnico)
-- =============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
-- T-238
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'Enums matching_round_status e matching_candidate_status criados', 1),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'Tabelas matching_rounds e matching_round_candidates criadas com colunas, FKs, índices e EXCLUDE constraints', 2),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'EXCLUDE constraint one_open_round_per_request impede 2 rounds abertos pra mesma SR (smoke: 2º insert retorna 23P01)', 3),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'EXCLUDE constraint only_one_acceptance_per_round impede 2 candidates aceitos no mesmo round (smoke)', 4),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'RLS: prestador autenticado não consegue SELECT direto em matching_rounds nem candidates (smoke via JWT prestador retorna 0 linhas)', 5),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'Admin via app_metadata.role=admin consegue SELECT em ambas tabelas', 6),
('19d0b0ba-9504-4523-9efc-e51d14b8062c', 'Triggers updatedAt funcionam em UPDATE', 7),

-- T-239
('c3267113-c593-4059-a3de-389b2e600d46', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('c3267113-c593-4059-a3de-389b2e600d46', 'Enum matching_round_event_kind criado com 13 valores', 1),
('c3267113-c593-4059-a3de-389b2e600d46', 'Tabela matching_round_events criada com FK pra rounds e candidates', 2),
('c3267113-c593-4059-a3de-389b2e600d46', 'Trigger block_audit_mutation impede UPDATE/DELETE mesmo por admin (smoke)', 3),
('c3267113-c593-4059-a3de-389b2e600d46', 'RLS: ADMIN lê; outros roles não conseguem SELECT direto (smoke via JWT prestador)', 4),
('c3267113-c593-4059-a3de-389b2e600d46', 'Índices em (round_id, occurred_at) e (kind, occurred_at) presentes', 5),

-- T-240
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'Função haversine_km criada (IMMUTABLE PARALLEL SAFE)', 1),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'RPC compute_eligible_providers retorna prestadores filtrados pelos 5 critérios obrigatórios + exclui ocupados (AC#2)', 2),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'EXECUTE revogado de authenticated/anon; só service_role pode chamar (smoke: anon GRANT denied)', 3),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'Smoke: SR com cliente em endereço X retorna apenas prestadores ativos+disponíveis+certificados+raio<=30km', 4),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'Smoke: prestador com serviço em status en_route não aparece (AC#2)', 5),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', 'Smoke: RPC reusa is_provider_available_now (T-114) e respeita janela de disponibilidade (AC#13)', 6),

-- T-241
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'Helpers mscore_quality/trust/availability/frequency/coverage criados, retornando [0,1]', 1),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'RPC compute_provider_score retorna score numérico + breakdown JSON com fatores e pesos snapshotados', 2),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'Pesos lidos de app_config.matching.weights; fallback hardcoded só se key ausente', 3),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'Smoke: prestador novato sem reviews recebe Q=0.6 (floor) e F>=freq_floor_min (AC#12)', 4),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'Smoke: alteração em app_config.matching.weights muda score sem precisar redeploy (AC#4)', 5),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'Função NÃO usa provider_profiles.tier como input (AC#12 — só comissão)', 6),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'EXECUTE revogado de authenticated/anon', 7),

-- T-242
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'RPC select_top_n_for_broadcast atomica: ou todos candidates entram + round muda pra broadcasting, ou nada (smoke transação rollback)', 1),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'Smoke: elegíveis < N → broadcastia todos (pool_size_actual = eligible_count, AC#6)', 2),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'Smoke: elegíveis = 0 → round vai pra status manual + evento pool_empty_manual (AC#7)', 3),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'Smoke: round em status != computing → RPC raise (não duplica broadcast)', 4),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'expires_at = broadcast_started_at + accept_window_seconds (AC#8 setup)', 5),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'Eventos top_n_selected + broadcast_sent emitidos em matching_round_events', 6),

-- T-243
('597cd399-00b2-4b74-b345-4d7956be3903', 'Edge Function deployada (supabase functions deploy start-matching)', 0),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Idempotency-Key obrigatório (400 sem header)', 1),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Conflict 23P01 (one_open_round_per_request) retorna 200 com status:already_running (idempotência)', 2),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Snapshot de pesos/janelas vindos de app_config persistido em matching_rounds', 3),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Pool vazio dispara enqueue_notification_event pra ops + cliente (AC#7)', 4),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Pool não-vazio: 1 evento candidate_offered emitido por candidato (Realtime T-247 entrega)', 5),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Service role key apenas no env da Edge Function (não exposto)', 6),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Cliente reabrindo busca incrementa attempt_number (próxima invocação cria round novo)', 7),
('597cd399-00b2-4b74-b345-4d7956be3903', 'Logs estruturados de cada step (round_created/eligibility_computed/top_n_selected)', 8),

-- T-244
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'RPC accept_proposal usa FOR UPDATE no round + candidate (race-resistant)', 1),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'Smoke race: 2 prestadores chamam simultaneamente; somente 1 retorna status:accepted, outro recebe 23505 (AC#10)', 2),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'Idempotência: mesmo idem_key 2x retorna idempotent_replay (não duplica)', 3),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'Endpoint /api/matching/accept retorna 409 em race perdida, 403 em not_in_pool, 400 sem idem-key', 4),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'provider_id vem do JWT do caller (não do body)', 5),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'Após aceite, candidates perdedores ficam em status closed com decision_reason=race_lost (AC#11)', 6),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'Eventos candidate_closed emitidos em matching_round_events pra cada perdedor (Realtime T-247 fecha cards)', 7),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'transition_service_status (T-235) chamado com idem_key pra propagar pro FSM da SR', 8),

-- T-245
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'Edge Function deployada (supabase functions deploy expire-matching-broadcast)', 0),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'RPC expire_matching_round criada com FOR UPDATE + guard de status', 1),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'Função processa no máximo 50 rounds por execução (limite explícito)', 2),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'Smoke: round com expires_at no passado e status=broadcasting vira expired após execução', 3),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'Round expirado dispara enqueue_notification_event pra ops + cliente', 4),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'candidate_expired emitido por candidato pra Realtime fechar cards', 5),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'Idempotência: re-execução não re-notifica (RPC guarda status)', 6),

-- T-246
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'Edge Function deployada (supabase functions deploy expire-client-search)', 0),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'RPC cancel_round_for_client criada com FOR UPDATE + guard de status (computing/broadcasting)', 1),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'Smoke: round com client_search_expires_at no passado vira cancelled_by_client', 2),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'Notificação enviada APENAS pra cliente (sem ops, distinto de T-245 — AC#9)', 3),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'Candidates ficam em status closed com decision_reason=client_search_ended', 4),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'transition_service_status devolve SR pra estado pré-matching (cliente pode tentar de novo)', 5),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'Idempotência: re-execução não re-notifica (RPC guarda status)', 6),

-- T-247
('c293594a-5222-4bda-9afd-6850845b5766', 'Migration aplicada (matching_round_events em supabase_realtime publication)', 0),
('c293594a-5222-4bda-9afd-6850845b5766', 'RLS policy matching_events_provider_self filtra por (payload->>provider_id)::uuid = auth.uid()', 1),
('c293594a-5222-4bda-9afd-6850845b5766', 'Smoke: prestador A subscrito no canal matching:provider:A não recebe eventos de prestador B', 2),
('c293594a-5222-4bda-9afd-6850845b5766', 'Hook useMatchingProposals criado em src/hooks/use-matching-proposals.ts', 3),
('c293594a-5222-4bda-9afd-6850845b5766', 'Hook subscribe no mount, unsubscribe no unmount (sem leak)', 4),
('c293594a-5222-4bda-9afd-6850845b5766', 'Hook adiciona proposta em candidate_offered e remove em candidate_closed/expired', 5),
('c293594a-5222-4bda-9afd-6850845b5766', 'Latência <500ms entre INSERT em matching_round_events e re-render no PWA prestador (medido)', 6),
('c293594a-5222-4bda-9afd-6850845b5766', 'Fallback de polling 10s para reconexão após CHANNEL_ERROR/TIMED_OUT', 7),

-- T-248
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'Migration aplicada via psql; pg_cron extension habilitada', 0),
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'Job matching-expire-broadcast agendado a cada 30s (cron.job)', 1),
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'Job matching-expire-client-search agendado a cada 30s (cron.job)', 2),
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'GUCs app.supabase_url e app.supabase_service_role_key configurados (runbook)', 3),
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'Smoke: round expirado é processado em <60s após o prazo', 4),
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'cron.job_run_details mostra execuções OK (sem failed_count > 0)', 5),

-- T-249
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', 'Migration aplicada via psql', 0),
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', '6 keys matching.* presentes em app_config (weights, top_n_default, accept_window_minutes, client_search_minutes, eligibility_radius_km, freq_floor_min)', 1),
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', 'Cada key tem section=matching e value_schema JSON Schema válido', 2),
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', 'Pesos default somam 1.0 (q+t+d+f+c=1.0)', 3),
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', 'ON CONFLICT DO UPDATE permite re-aplicar seed sem erro', 4),
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', 'Admin via UI T-220 vê seção "matching" colapsável com 6 keys + descriptions (AC#4)', 5);

-- =============================================================================
-- 4. DEPENDÊNCIAS (TaskDependency — kind lowercase)
-- =============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- T-239 depende de T-238 (events fk -> rounds)
('c3267113-c593-4059-a3de-389b2e600d46', '19d0b0ba-9504-4523-9efc-e51d14b8062c', 'blocks'),

-- T-240 relates_to T-114 (is_provider_available_now), T-002, T-003, T-070, T-215
('37df3158-2e84-4a1e-bb78-a92459fbebb7', '9b81eb44-eb35-4bab-a2fc-4f2a8b87aeaa', 'relates_to'),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'relates_to'),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', '8f552252-9053-45fe-8ffb-a35be93627b8', 'relates_to'),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'relates_to'),
('37df3158-2e84-4a1e-bb78-a92459fbebb7', '315c57de-7769-4f90-b45c-2447edd086a2', 'relates_to'),

-- T-241 relates_to T-215 (app_config), T-070, T-155 (dispute_decisions)
('57d9f39a-af3d-4b07-9132-3f98351ea385', '315c57de-7769-4f90-b45c-2447edd086a2', 'relates_to'),
('57d9f39a-af3d-4b07-9132-3f98351ea385', '0db58807-4ce6-4253-b2a9-e24e4575f096', 'relates_to'),
('57d9f39a-af3d-4b07-9132-3f98351ea385', 'df62ba3b-de05-4588-a2f1-eb1527c39d92', 'relates_to'),

-- T-242 depende de T-238, T-239, T-241
('9c01345f-9ce3-48b4-8531-80318aa20a75', '19d0b0ba-9504-4523-9efc-e51d14b8062c', 'blocks'),
('9c01345f-9ce3-48b4-8531-80318aa20a75', 'c3267113-c593-4059-a3de-389b2e600d46', 'blocks'),
('9c01345f-9ce3-48b4-8531-80318aa20a75', '57d9f39a-af3d-4b07-9132-3f98351ea385', 'blocks'),

-- T-243 depende de T-238/T-240/T-242, relates_to T-162 (enqueue_notification_event), T-164 (wirar emit), T-249 (config)
('597cd399-00b2-4b74-b345-4d7956be3903', '19d0b0ba-9504-4523-9efc-e51d14b8062c', 'blocks'),
('597cd399-00b2-4b74-b345-4d7956be3903', '37df3158-2e84-4a1e-bb78-a92459fbebb7', 'blocks'),
('597cd399-00b2-4b74-b345-4d7956be3903', '9c01345f-9ce3-48b4-8531-80318aa20a75', 'blocks'),
('597cd399-00b2-4b74-b345-4d7956be3903', '10884ed2-628a-48a6-9767-ecdd7cd1a98b', 'blocks'),
('597cd399-00b2-4b74-b345-4d7956be3903', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'relates_to'),
('597cd399-00b2-4b74-b345-4d7956be3903', 'a2d4e09c-a902-4c19-9a37-09a38779267c', 'relates_to'),

-- T-244 depende de T-238, T-239, T-235 (transition_service_status)
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', '19d0b0ba-9504-4523-9efc-e51d14b8062c', 'blocks'),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', 'c3267113-c593-4059-a3de-389b2e600d46', 'blocks'),
('ccbc986b-cfdd-42d3-8eac-a96860c07dc4', '20204d49-33fa-4c8a-9a05-83fa88129012', 'blocks'),

-- T-245 depende de T-238, T-239, relates_to T-162
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', '19d0b0ba-9504-4523-9efc-e51d14b8062c', 'blocks'),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'c3267113-c593-4059-a3de-389b2e600d46', 'blocks'),
('bf5c9510-0822-47c9-9cd7-0824dbfd5611', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'relates_to'),

-- T-246 depende de T-238, T-239, T-235, relates_to T-162
('90d40059-1122-40ce-aec0-4ff449ce8f7c', '19d0b0ba-9504-4523-9efc-e51d14b8062c', 'blocks'),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', 'c3267113-c593-4059-a3de-389b2e600d46', 'blocks'),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', '20204d49-33fa-4c8a-9a05-83fa88129012', 'blocks'),
('90d40059-1122-40ce-aec0-4ff449ce8f7c', '42af5179-9d07-4566-8fbe-eec1a72d7ee8', 'relates_to'),

-- T-247 depende de T-239, relates_to T-119 (canal Realtime agenda padrão), T-081 (canal service:{id})
('c293594a-5222-4bda-9afd-6850845b5766', 'c3267113-c593-4059-a3de-389b2e600d46', 'blocks'),
('c293594a-5222-4bda-9afd-6850845b5766', '54342bd2-3ed9-4492-a2cc-04f7fe4d6441', 'relates_to'),
('c293594a-5222-4bda-9afd-6850845b5766', '89eb970e-9e9f-421f-a50f-b972a15e48c8', 'relates_to'),

-- T-248 depende de T-245, T-246
('7935fbfc-a49e-4629-9cc1-7181f145ef52', 'bf5c9510-0822-47c9-9cd7-0824dbfd5611', 'blocks'),
('7935fbfc-a49e-4629-9cc1-7181f145ef52', '90d40059-1122-40ce-aec0-4ff449ce8f7c', 'blocks'),

-- T-249 depende de T-215 (app_config)
('10884ed2-628a-48a6-9767-ecdd7cd1a98b', '315c57de-7769-4f90-b45c-2447edd086a2', 'blocks');

COMMIT;
