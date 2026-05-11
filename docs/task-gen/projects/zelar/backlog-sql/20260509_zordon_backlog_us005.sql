-- Zelar v2 — Backlog SQL: ZLAR-V2-US-005 (PRESTADOR executa serviço)
-- Modulo: EXECUCAO | Persona: PRESTADOR | AC: 13
-- Apenas insere metadata em tabelas internas do Zordon. NAO executa DDL de produto.

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-271 DATA service_check_in_codes
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-271', 'Criar tabela service_check_in_codes (6 dígitos, 15min, 5 tentativas, invalidate)',
 $desc$## Objetivo
Persistir códigos de confirmação de início de serviço (CC) gerados pelo PRESTADOR ao tocar "Cheguei". Códigos têm 6 dígitos, validade de 15 min, contador de tentativas erradas e invalidação ao uso/expiração. Cobre AC #4, #5.

## Contexto
Módulo EXECUCAO. Consumido pelas RPCs de issue/verify (T-275). FSM da SR (T-227) bloqueia transição pra `in_progress` enquanto não há código verificado. Constraint única `(service_request_id) WHERE used_at IS NULL` previne 2 códigos ativos no mesmo serviço (race rare).

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_check_in_codes.sql`
```sql
BEGIN;

CREATE TABLE service_check_in_codes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id         uuid NOT NULL REFERENCES auth.users(id),
  code_hash           text NOT NULL,    -- bcrypt/scrypt do código (não armazena plaintext)
  attempts            int  NOT NULL DEFAULT 0,
  issued_at           timestamptz NOT NULL DEFAULT NOW(),
  expires_at          timestamptz NOT NULL,
  used_at             timestamptz,      -- preenche quando verificado com sucesso
  invalidated_at      timestamptz,      -- preenche quando expira/excede tentativas
  invalidated_reason  text CHECK (invalidated_reason IN ('expired','max_attempts','reissued','used')),
  "createdAt"         timestamptz NOT NULL DEFAULT NOW()
);

-- 1 código ativo por SR (used_at IS NULL AND invalidated_at IS NULL)
CREATE UNIQUE INDEX uniq_active_check_in
  ON service_check_in_codes(service_request_id)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX idx_check_in_provider ON service_check_in_codes(provider_id, "createdAt" DESC);

ALTER TABLE service_check_in_codes ENABLE ROW LEVEL SECURITY;

-- PRESTADOR vê apenas codes do proprio servico
CREATE POLICY "provider_own_codes" ON service_check_in_codes
  FOR SELECT USING (auth.uid() = provider_id);

-- INSERT/UPDATE somente via RPC (SECURITY DEFINER); RLS bloqueia direto
CREATE POLICY "no_direct_writes" ON service_check_in_codes
  FOR ALL USING (false) WITH CHECK (false);

-- ADMIN read-all (claim)
CREATE POLICY "admin_all_codes" ON service_check_in_codes
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Armazenar o código em plaintext — só hash (impede leak via SELECT do prestador)
- ❌ Permitir múltiplos códigos ativos simultâneos no mesmo SR (constraint única)
- ❌ INSERT/UPDATE via RLS de owner (todas mutações via RPC SECURITY DEFINER, T-275)

## Convenções
- `code_hash` via `crypt(code, gen_salt('bf'))` no PostgreSQL (extensão `pgcrypto`)
- 15min validade, 5 tentativas: parâmetros viven em `app_config` (`execution.check_in_ttl_minutes=15`, `execution.check_in_max_attempts=5`) — reuso de T-249/T-237
- `service_check_in_codes` é INSERT-only via RPC; UPDATE só pra preencher `used_at`/`invalidated_at`/`attempts` via RPC
- ADMIN read pra suporte (sem ver hash; fim de tabela é audit)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','RACE_CONDITION','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-272 DATA service_photos
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-272', 'Criar service_photos (3 momentos: before/during/after, mínimo 1 cada) + RLS',
 $desc$## Objetivo
Persistir fotos do protocolo fotográfico obrigatório do serviço (3 momentos: antes/durante/depois) com referência ao path no Supabase Storage. Constraint a nível de aplicação (via RPC ou trigger) garante mínimo de 1 foto por momento antes do PRESTADOR poder solicitar assinatura. Cobre AC #6, #13.

## Contexto
Módulo EXECUCAO. Photos vivem em bucket Supabase Storage `service-photos/`, esta tabela tem só metadata + pointer. RPC `request_signature` (em T-278) lê esta tabela e bloqueia se algum dos 3 momentos tem 0 fotos. Imutabilidade pós-conclusão via constraint.

## Estado atual / O que substitui
Não existe. T-074 (POST /api/services com upload) é pra fotos da solicitação inicial — não confundir com fotos de execução.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_photos.sql`
```sql
BEGIN;

CREATE TYPE service_photo_moment AS ENUM ('before','during','after');

CREATE TABLE service_photos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id         uuid NOT NULL REFERENCES auth.users(id),
  moment              service_photo_moment NOT NULL,
  storage_path        text NOT NULL,                    -- service-photos/{sr_id}/{moment}/{uuid}.jpg
  width               int,
  height              int,
  size_bytes          bigint,
  taken_at            timestamptz,                       -- EXIF (opcional)
  uploaded_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_photos_sr_moment ON service_photos(service_request_id, moment);

ALTER TABLE service_photos ENABLE ROW LEVEL SECURITY;

-- PRESTADOR vê e insere fotos do próprio servico
CREATE POLICY "provider_own_photos_select" ON service_photos
  FOR SELECT USING (auth.uid() = provider_id);
CREATE POLICY "provider_own_photos_insert" ON service_photos
  FOR INSERT WITH CHECK (
    auth.uid() = provider_id
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = service_request_id
        AND sr.provider_id = auth.uid()
        AND sr.status IN ('en_route','arrived','in_progress')
    )
  );

-- CLIENTE vê fotos depois de in_progress
CREATE POLICY "client_view_photos" ON service_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = service_request_id
        AND sr.client_id = auth.uid()
        AND sr.status IN ('in_progress','completed','disputed')
    )
  );

-- ADMIN lê tudo
CREATE POLICY "admin_all_photos" ON service_photos
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Imutabilidade: sem DELETE/UPDATE para PRESTADOR/CLIENTE (audit imutável)
-- (admin pode via service_role)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE de `storage_path`, `moment`, `service_request_id` (audit imutável)
- ❌ Permitir DELETE pelo PRESTADOR (audit imutável; ADMIN só via service_role pra GDPR)
- ❌ Validar contagem mínima por momento na constraint do DB (custo de check em INSERT alto) — fica no RPC de `request_signature` (T-278) que aborta se algum momento tem 0
- ❌ Buckets públicos — `service-photos/` é privado, acesso via signed URLs (Storage SDK respeita RLS)

## Convenções
- `storage_path` segue convenção `service-photos/{sr_id}/{moment}/{uuid}.jpg`
- Bucket criado via migration separada de OPS (ou via Supabase Dashboard antes do go-live)
- EXIF (`taken_at`, `width`, `height`) opcional — `uploaded_at` é mandatório
- RLS multi-actor: PRESTADOR (own), CLIENTE (after in_progress), ADMIN (all)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-273 DATA service_signatures
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-273', 'Criar service_signatures (uma por SR, imutável, base64 PNG) + RLS',
 $desc$## Objetivo
Persistir a assinatura digital do CLIENTE que finaliza o serviço. Uma única assinatura por SR (constraint UNIQUE), imutável após escrita, dispara transição para `completed` e início do escrow countdown. Cobre AC #7, #13.

## Contexto
Módulo EXECUCAO. Assinatura é gatilho único de finalização (AC #7) — não pode ser substituída ou removida (audit). Dispara cadeia: T-278 RPC `record_signature` → transition_service_status (T-235) → enqueue notificação (T-164) → cron release-escrow-payouts (T-126/T-127) começa contagem T+72h.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_signatures.sql`
```sql
BEGIN;

CREATE TABLE service_signatures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  signer_user_id      uuid REFERENCES auth.users(id),       -- pode ser NULL (cliente assina no device do prestador, sem login do cliente)
  client_name_typed   text NOT NULL,                         -- nome do cliente digitado pelo prestador antes da assinatura
  storage_path        text NOT NULL,                         -- signatures/{sr_id}.png (Storage privado)
  signed_at           timestamptz NOT NULL DEFAULT NOW(),
  device_fingerprint  text,                                  -- agente/IP do device do prestador
  ip                  inet
);

ALTER TABLE service_signatures ENABLE ROW LEVEL SECURITY;

-- PRESTADOR vê a propria
CREATE POLICY "provider_own_signature_select" ON service_signatures
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = service_request_id AND sr.provider_id = auth.uid()
    )
  );

-- CLIENTE vê a propria
CREATE POLICY "client_own_signature_select" ON service_signatures
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = service_request_id AND sr.client_id = auth.uid()
    )
  );

-- ADMIN lê tudo
CREATE POLICY "admin_all_signatures" ON service_signatures
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Bloqueia escritas direto via RLS — mutação só via RPC record_signature (T-278)
CREATE POLICY "no_direct_writes" ON service_signatures
  FOR ALL USING (false) WITH CHECK (false);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE/DELETE em qualquer cenário (imutabilidade total — disputa muda o resultado em outras tabelas, não na signature)
- ❌ Permitir INSERT direto via RLS (deve ir por T-278 RPC com checks de fotos + status FSM)
- ❌ Armazenar PNG inline em coluna bytea (custo alto; usar Storage)
- ❌ UNIQUE em `signer_user_id` (cliente pode não ter conta — assina presencialmente no device do prestador)

## Convenções
- `storage_path` em bucket privado `signatures/`
- 1:1 com service_requests via UNIQUE no FK
- Reuso: bucket Storage criado em OPS task de bucket setup (ver T-272)$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-274 DATA service_provider_locations
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-274', 'Criar service_provider_locations (stream de localização durante trajeto)',
 $desc$## Objetivo
Persistir pontos de localização do PRESTADOR durante o trajeto (entre `en_route` e `arrived`), permitindo que CLIENTE acompanhe via Realtime (US-012). Compartilhamento encerra ao tocar "Cheguei" — não persistimos posição depois. TTL automático: linhas mais antigas que 24h apagadas via cron. Cobre AC #3 (parte servidor; UI em US-012).

## Contexto
Módulo EXECUCAO. PWA prestador captura geolocalização (`navigator.geolocation.watchPosition`) e PATCHa via T-279. Esta tabela acumula a stream; canal Realtime `service:{id}` (T-081) já existente entrega via `postgres_changes` na tabela. CLIENTE (US-012) subscreve.

Privacidade: dados são apagados após 24h ou no `arrived` (cleanup imediato), o que vier antes. Sem armazenar histórico — não é audit.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_provider_locations.sql`
```sql
BEGIN;

CREATE TABLE service_provider_locations (
  id                  bigserial PRIMARY KEY,
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id         uuid NOT NULL REFERENCES auth.users(id),
  lat                 double precision NOT NULL,
  lng                 double precision NOT NULL,
  accuracy_m          real,
  recorded_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_loc_sr_recorded ON service_provider_locations(service_request_id, recorded_at DESC);

ALTER TABLE service_provider_locations ENABLE ROW LEVEL SECURITY;

-- PRESTADOR insere/lê own
CREATE POLICY "provider_own_loc_insert" ON service_provider_locations
  FOR INSERT WITH CHECK (auth.uid() = provider_id);
CREATE POLICY "provider_own_loc_select" ON service_provider_locations
  FOR SELECT USING (auth.uid() = provider_id);

-- CLIENTE lê só durante en_route do proprio servico
CREATE POLICY "client_view_loc" ON service_provider_locations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.id = service_request_id
        AND sr.client_id = auth.uid()
        AND sr.status = 'en_route'
    )
  );

-- Cleanup automatico: trigger ou cron job
-- Cron T-275-cleanup: DELETE FROM service_provider_locations WHERE recorded_at < NOW() - INTERVAL '24 hours';

ALTER PUBLICATION supabase_realtime ADD TABLE service_provider_locations;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Manter localização após `arrived` — RPC transition_service_status (T-235) deve disparar DELETE FROM service_provider_locations WHERE service_request_id = X
- ❌ Persistir histórico além de 24h (LGPD: dado de localização é sensível)
- ❌ Adicionar índice geoespacial — não fazemos query "perto de mim"; uso é stream tail por SR
- ❌ Permitir INSERT depois do `arrived` (RLS via subquery em service_requests não cobre — adicionar trigger BEFORE INSERT que bloqueia se sr.status != 'en_route')

## Convenções
- Acumula como append-only durante trajeto, deleta no `arrived`
- Realtime publication adicionado para CLIENTE acompanhar via T-081 canal
- pg_cron cleanup às 03:00 BR diário (job em T-237 / OPS extension)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-275 API check-in RPCs
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-275', 'Implementar RPC issue_check_in_code + verify_check_in_code',
 $desc$## Objetivo
Duas RPCs SECURITY DEFINER que orquestram o ciclo do código de início de 6 dígitos:
- `issue_check_in_code(service_request_id)` — emite código novo (gera plaintext, hash via pgcrypto, persiste em `service_check_in_codes` T-271, retorna o plaintext APENAS para quem chamou — o PRESTADOR via app)
- `verify_check_in_code(service_request_id, code_plaintext)` — verifica hash, incrementa `attempts`, ao 5º falho marca código `invalidated_reason='max_attempts'` e emite código novo automaticamente; ao sucesso, marca `used_at`, retorna ok e dispara transição FSM para `in_progress` (via T-235).
Cobre AC #4 (geração 6 dígitos, 15min, visível só no device), #5 (uso bem-sucedido invalida; 5 erros gera novo).

## Contexto
Módulo EXECUCAO. Chamado pelas APIs HTTP (route handlers) — issue invocado quando PRESTADOR toca "Cheguei" (transition `arrived`); verify invocado quando CLIENTE digita o código no app do PRESTADOR. Constraint UNIQUE em codes (T-271) garante 1 ativo por SR.

Hash via `pgcrypto`: `crypt(code, gen_salt('bf', 8))`. Plaintext nunca persiste — só retornado uma vez no `issue` (resposta da RPC) e exibido na tela do prestador (T-282).

Rate limit: invalidate ao 5º erro + reissue automatico (mesmo round) — sem precisar bloqueio externo.

## Estado atual / O que substitui
Não existe. T-275 é o coração do check-in.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_check_in_rpcs.sql`
```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION issue_check_in_code(p_service_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_provider uuid;
  v_status text;
  v_code text;
  v_ttl int := COALESCE((SELECT (value->>0)::int FROM app_config WHERE key='execution.check_in_ttl_minutes'), 15);
BEGIN
  SELECT provider_id, status INTO v_provider, v_status
  FROM service_requests WHERE id = p_service_request_id;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'sr_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_provider != auth.uid() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_status NOT IN ('arrived') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023', DETAIL = v_status; END IF;

  -- Invalida código ativo anterior (rar pra reissue)
  UPDATE service_check_in_codes
  SET invalidated_at = NOW(), invalidated_reason = 'reissued'
  WHERE service_request_id = p_service_request_id AND used_at IS NULL AND invalidated_at IS NULL;

  -- Gera 6 dígitos pseudo-random
  v_code := lpad((floor(random() * 1000000))::text, 6, '0');

  INSERT INTO service_check_in_codes (
    service_request_id, provider_id, code_hash, expires_at
  ) VALUES (
    p_service_request_id, auth.uid(),
    crypt(v_code, gen_salt('bf', 8)),
    NOW() + (v_ttl || ' minutes')::interval
  );

  RETURN jsonb_build_object(
    'code', v_code,
    'expires_at', NOW() + (v_ttl || ' minutes')::interval
  );
END $$;

CREATE OR REPLACE FUNCTION verify_check_in_code(
  p_service_request_id uuid,
  p_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row service_check_in_codes%ROWTYPE;
  v_max_attempts int := COALESCE((SELECT (value->>0)::int FROM app_config WHERE key='execution.check_in_max_attempts'), 5);
BEGIN
  SELECT * INTO v_row
  FROM service_check_in_codes
  WHERE service_request_id = p_service_request_id
    AND used_at IS NULL AND invalidated_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_code' USING ERRCODE = 'P0002'; END IF;
  IF v_row.expires_at < NOW() THEN
    UPDATE service_check_in_codes SET invalidated_at=NOW(), invalidated_reason='expired' WHERE id = v_row.id;
    RAISE EXCEPTION 'expired' USING ERRCODE = '22023';
  END IF;

  IF crypt(p_code, v_row.code_hash) = v_row.code_hash THEN
    UPDATE service_check_in_codes SET used_at = NOW() WHERE id = v_row.id;
    -- Dispara transição FSM in_progress via T-235
    PERFORM transition_service_status(p_service_request_id, 'in_progress', auth.uid(), 'check_in_verified');
    RETURN jsonb_build_object('ok', true, 'transitioned_to', 'in_progress');
  ELSE
    UPDATE service_check_in_codes SET attempts = attempts + 1 WHERE id = v_row.id;
    IF v_row.attempts + 1 >= v_max_attempts THEN
      UPDATE service_check_in_codes SET invalidated_at=NOW(), invalidated_reason='max_attempts' WHERE id = v_row.id;
      -- Auto-reissue novo código (mesma RPC issue)
      RETURN jsonb_build_object('ok', false, 'reissued', true, 'attempts', v_row.attempts + 1);
    END IF;
    RETURN jsonb_build_object('ok', false, 'attempts', v_row.attempts + 1);
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION issue_check_in_code, verify_check_in_code FROM public, anon;
GRANT EXECUTE ON FUNCTION issue_check_in_code, verify_check_in_code TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Retornar plaintext do código depois do `issue` (PRESTADOR tem que registrar; após o app fechar, código já está hashed — pode reissue)
- ❌ Verificar via `=` em texto (sempre `crypt(p_code, v_row.code_hash)`)
- ❌ Permitir verify sem `FOR UPDATE` (race nos attempts)
- ❌ Auto-reissue invocando `issue_check_in_code` recursivamente (evita loop) — RPC retorna sinal e UI dispara new issue se quiser

## Convenções
- pgcrypto bcrypt cost 8 (default) — verify ~10ms
- Transition acoplada a verify success (uma operação atômica)
- Parâmetros via `app_config.execution.*` (reuso de T-249 OPS pattern)
- Códigos plaintext NUNCA aparecem em logs (sem RAISE NOTICE com `v_code`)$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RATE_LIMIT','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-276 API transition wrapper
('c356a302-31ea-4026-a913-d527fb71ceda', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-276', 'Implementar POST /api/services/[id]/transition (wrapper sobre transition_service_status)',
 $desc$## Objetivo
Endpoint HTTP que o PWA do prestador chama em cada toque do stepper ("Estou a caminho", "Cheguei", "Concluir"). Wrapper sobre `transition_service_status` (T-235 RPC). Mapeia erros do FSM (estado terminal, transição inválida, falta de fotos, falta de assinatura) pra HTTP 400/409/422. Cobre AC #1, #2, #11, #12.

## Contexto
Módulo EXECUCAO. T-235 (RPC) já encapsula validação de transição (FSM trigger T-227), audit log (T-227 emit service_event), bloqueio se há `service_pending_states` (T-231) ativo. Esta API HTTP só:
1. Valida JWT
2. Idempotency-Key obrigatória
3. Chama RPC com (sr_id, target_status, actor=auth.uid(), reason)
4. Mapeia erros

Transições válidas de PRESTADOR (FSM, conforme T-227):
- `pending_provider_pickup` → `en_route` (toque "Estou a caminho")
- `en_route` → `arrived` (toque "Cheguei")
- `arrived` → `in_progress` (apenas via verify_check_in_code, T-275 — bloqueado aqui)
- `in_progress` → `completed` (apenas via record_signature, T-278 — bloqueado aqui)

Outras transições retornam 422 transition_not_allowed_for_actor.

## Estado atual / O que substitui
Existe T-235 (RPC). Sem este wrapper HTTP, PWA precisaria chamar supabase-js direto (sem idempotency, sem mapping de erros).

## O que criar

### `src/app/api/services/[id]/transition/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  to: z.enum(['en_route','arrived']),       // PRESTADOR só pode requestar essas duas via HTTP
  reason: z.string().max(200).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.rpc('transition_service_status', {
    p_service_request_id: id, p_target_status: body.to,
    p_actor: user.id, p_reason: body.reason ?? null,
    p_idempotency_key: idemKey,
  });

  if (error) {
    if (error.code === 'P0002') return Response.json({ error:'not_found' }, { status: 404 });
    if (error.message.includes('transition_not_allowed')) return Response.json({ error:'transition_invalid' }, { status: 409 });
    if (error.message.includes('forbidden')) return Response.json({ error:'forbidden' }, { status: 403 });
    if (error.message.includes('pending_state')) return Response.json({ error:'pending_state', detail: error.message }, { status: 409 });
    console.error('[transition]', error);
    return Response.json({ error:'internal' }, { status: 500 });
  }
  return Response.json(data, { status: 200 });
}
```

## Constraints / NÃO fazer
- ❌ Aceitar `to: in_progress` ou `to: completed` aqui — viam check_in (T-275) e signature (T-278) respectivamente. Zod enum bloqueia.
- ❌ Confiar no client pra `actor` — sempre `auth.uid()`
- ❌ Aceitar request sem `idempotency-key` (AC #11/#12 retry seguro)
- ❌ Implementar offline queue aqui — UI (T-280) cuida via Service Worker / IndexedDB

## Convenções
- Idempotency-key estável por device+SR+status (ex.: `${device_id}:${sr_id}:${target}`)
- Mapping de errcodes: P0002→404, transition_not_allowed→409, forbidden→403, pending_state→409, demais→500
- AC #11 (retry sem avançar pela metade) garantido pela RPC T-235 — atomicidade no DB$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-277 API photos upload
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-277', 'Implementar POST /api/services/[id]/photos (upload Storage + insert metadata)',
 $desc$## Objetivo
Endpoint que recebe foto (multipart/form-data) do prestador, faz upload ao bucket Supabase Storage `service-photos/`, insere metadata em `service_photos` (T-272). Valida que `moment` (`before|during|after`) é compatível com `sr.status` atual. Cobre AC #6.

## Contexto
Módulo EXECUCAO. PWA prestador captura foto via `<input type="file" capture="environment">` ou camera API; envia direto pro endpoint. Endpoint upload via supabase admin client (server-side) — não expõe service_role.

Validação de momento:
- `before`: SR.status `arrived` ou `in_progress`
- `during`: SR.status `in_progress`
- `after`: SR.status `in_progress` (antes de signature)

## Estado atual / O que substitui
Não existe. T-074 (POST /api/services com upload) é pra fotos da solicitação inicial — distinta da fotos de execução.

## O que criar

### `src/app/api/services/[id]/photos/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData();
  const moment = form.get('moment')?.toString();
  const file = form.get('photo') as File | null;

  if (!file) return Response.json({ error:'missing_photo' }, { status: 400 });
  if (!['before','during','after'].includes(moment ?? '')) return Response.json({ error:'invalid_moment' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error:'too_large' }, { status: 413 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error:'unauthorized' }, { status: 401 });

  // Valida ownership e status FSM
  const { data: sr } = await supabase.from('service_requests')
    .select('provider_id, status').eq('id', id).single();
  if (!sr || sr.provider_id !== user.id) return Response.json({ error:'forbidden' }, { status: 403 });

  const allowedByMoment: Record<string, string[]> = {
    before:['arrived','in_progress'], during:['in_progress'], after:['in_progress'],
  };
  if (!allowedByMoment[moment!].includes(sr.status)) {
    return Response.json({ error:'wrong_status', current: sr.status, expected: allowedByMoment[moment!] }, { status: 409 });
  }

  // Upload via admin (bypassa RLS de Storage com servico)
  const admin = createAdminClient();
  const fileId = crypto.randomUUID();
  const path = `service-photos/${id}/${moment}/${fileId}.jpg`;
  const arr = await file.arrayBuffer();
  const { error: upErr } = await admin.storage.from('service-photos').upload(path, arr, {
    contentType: file.type || 'image/jpeg', upsert: false,
  });
  if (upErr) { console.error('[storage_upload]', upErr); return Response.json({ error:'upload_failed' }, { status: 500 }); }

  // Insere metadata via cliente normal (RLS aplicado)
  const { data: row, error: insErr } = await supabase.from('service_photos').insert({
    service_request_id: id, provider_id: user.id, moment, storage_path: path,
    size_bytes: file.size,
  }).select().single();
  if (insErr) {
    // rollback storage
    await admin.storage.from('service-photos').remove([path]);
    return Response.json({ error:'insert_failed' }, { status: 500 });
  }
  return Response.json({ id: row.id, storage_path: path, moment }, { status: 201 });
}
```

## Constraints / NÃO fazer
- ❌ Permitir upload em status `pending_provider_pickup`/`en_route` (fotos antes do "Cheguei" não fazem sentido)
- ❌ Aceitar arquivo sem validar `Content-Type` ou `size` (DoS)
- ❌ Persistir foto inline no DB (custo)
- ❌ Bucket público — `service-photos/` é privado, acesso via signed URLs no leitor

## Convenções
- Storage bucket: `service-photos/` (privado, criado em OPS task antes do go-live)
- Limite 10MB por foto
- Path: `service-photos/{sr_id}/{moment}/{uuid}.jpg`
- Sem rate limit dedicado: 3-5 fotos por execução, baixo volume$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-278 API signature record
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-278', 'Implementar POST /api/services/[id]/signature + RPC record_signature (gatilho de finalização)',
 $desc$## Objetivo
Endpoint + RPC que registram a assinatura digital do CLIENTE (PNG base64) na tabela `service_signatures` (T-273). RPC valida que: (a) status é `in_progress`, (b) há ≥1 foto em cada momento (`before`, `during`, `after` em `service_photos` T-272), (c) prestador é dono. Após persistir, dispara `transition_service_status` (T-235) → `completed`, que por sua vez emite `service_completed` no audit, enfileira notificação (T-164) e inicia o ciclo de escrow (T-126/T-127). Cobre AC #7, #8.

## Contexto
Módulo EXECUCAO. Tela T-284 captura assinatura via `<canvas>` HTML5 + library nativa (sem dep extra), exporta como base64 PNG, envia ao endpoint. Endpoint salva PNG no bucket privado `signatures/`, RPC insere row, transition. Único gatilho de finalização — **não há outro caminho** pra `completed`.

## Estado atual / O que substitui
Não existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_record_signature_rpc.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION record_signature(
  p_service_request_id uuid,
  p_storage_path text,
  p_client_name_typed text,
  p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_provider uuid; v_status text;
  v_before_count int; v_during_count int; v_after_count int;
BEGIN
  SELECT provider_id, status INTO v_provider, v_status
  FROM service_requests WHERE id = p_service_request_id;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'sr_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_provider != auth.uid() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_status != 'in_progress' THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023', DETAIL = v_status; END IF;

  -- Idempotência: se ja existe signature, retorna sem reprocessar
  IF EXISTS (SELECT 1 FROM service_signatures WHERE service_request_id = p_service_request_id) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  -- Valida fotos em cada momento
  SELECT COUNT(*) FILTER (WHERE moment='before'),
         COUNT(*) FILTER (WHERE moment='during'),
         COUNT(*) FILTER (WHERE moment='after')
    INTO v_before_count, v_during_count, v_after_count
  FROM service_photos WHERE service_request_id = p_service_request_id;

  IF v_before_count = 0 OR v_during_count = 0 OR v_after_count = 0 THEN
    RAISE EXCEPTION 'photos_incomplete' USING ERRCODE='22023',
      DETAIL = jsonb_build_object('before', v_before_count, 'during', v_during_count, 'after', v_after_count)::text;
  END IF;

  INSERT INTO service_signatures (
    service_request_id, signer_user_id, client_name_typed, storage_path
  ) VALUES (
    p_service_request_id,
    (SELECT client_id FROM service_requests WHERE id = p_service_request_id),
    p_client_name_typed, p_storage_path
  );

  PERFORM transition_service_status(p_service_request_id, 'completed', auth.uid(), 'signature_recorded', p_idempotency_key);
  RETURN jsonb_build_object('ok', true, 'transitioned_to', 'completed');
END $$;

REVOKE EXECUTE ON FUNCTION record_signature FROM public, anon;
GRANT EXECUTE ON FUNCTION record_signature TO authenticated;

COMMIT;
```

### `src/app/api/services/[id]/signature/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.object({
  png_base64: z.string().min(100).max(2_000_000), // ~1.5MB max
  client_name_typed: z.string().min(2).max(120),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error:'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error:'unauthorized' }, { status: 401 });

  // Upload PNG ao Storage
  const admin = createAdminClient();
  const path = `signatures/${id}.png`;
  const buf = Buffer.from(body.png_base64.replace(/^data:image\/png;base64,/, ''), 'base64');
  const { error: upErr } = await admin.storage.from('signatures').upload(path, buf, {
    contentType: 'image/png', upsert: false,
  });
  if (upErr && !upErr.message.includes('already exists')) {
    return Response.json({ error:'upload_failed' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('record_signature', {
    p_service_request_id: id,
    p_storage_path: path,
    p_client_name_typed: body.client_name_typed,
    p_idempotency_key: idemKey,
  });
  if (error) {
    if (error.message.includes('photos_incomplete')) return Response.json({ error:'photos_incomplete', detail: error.details }, { status: 409 });
    if (error.message.includes('forbidden')) return Response.json({ error:'forbidden' }, { status: 403 });
    if (error.code === 'P0002') return Response.json({ error:'not_found' }, { status: 404 });
    return Response.json({ error:'internal' }, { status: 500 });
  }
  return Response.json(data, { status: 201 });
}
```

## Constraints / NÃO fazer
- ❌ Permitir signature sem fotos completas (RPC bloqueia, mas API deve retornar 409 com detail)
- ❌ Persistir PNG inline (Storage)
- ❌ Permitir 2ª assinatura (UNIQUE em T-273 + idempotência aqui)
- ❌ Retornar a URL pública da signature (sempre signed URL com TTL curto no leitor)

## Convenções
- Reuso: `transition_service_status` T-235, `service_signatures` T-273, `service_photos` T-272
- Idempotency-key estável: `signature-${sr_id}` (PRESTADOR só assina 1× — retry seguro)
- Bucket `signatures/` privado$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','SECRET_HANDLING','AUDIT_LOG','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-279 API location stream
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-279', 'Implementar PATCH /api/services/[id]/location (stream rate-limited)',
 $desc$## Objetivo
Endpoint que recebe pontos de localização do PRESTADOR durante trajeto (`en_route`) e grava em `service_provider_locations` (T-274). Rate-limited (max 1 ponto/5s) pra evitar flood. Cobre AC #3 (parte do servidor; UI de captura está em T-281).

## Contexto
Módulo EXECUCAO. PWA prestador roda `navigator.geolocation.watchPosition` ao tocar "Estou a caminho"; cada update PATCHa o endpoint. Stop ao tocar "Cheguei" (transition `arrived` → trigger backend deleta linhas via T-235 RPC ou cron 24h). Realtime publication em T-274 já entrega ao CLIENTE (US-012 subscriber).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/services/[id]/location/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(10000).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Body.parse(await req.json());

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error:'unauthorized' }, { status: 401 });

  // Rate limit naive: rejeita se ultima inserção <5s
  const { data: last } = await supabase.from('service_provider_locations')
    .select('recorded_at').eq('service_request_id', id).eq('provider_id', user.id)
    .order('recorded_at', { ascending: false }).limit(1).maybeSingle();
  if (last && (Date.now() - new Date(last.recorded_at).getTime() < 5000)) {
    return Response.json({ error:'rate_limited' }, { status: 429 });
  }

  // RLS valida ownership e status (T-274 INSERT policy + trigger sugerido)
  const { error } = await supabase.from('service_provider_locations').insert({
    service_request_id: id, provider_id: user.id,
    lat: body.lat, lng: body.lng, accuracy_m: body.accuracy_m ?? null,
  });
  if (error) {
    if (error.code === '42501') return Response.json({ error:'forbidden' }, { status: 403 });
    if (error.message.includes('not_en_route')) return Response.json({ error:'wrong_status' }, { status: 409 });
    return Response.json({ error:'internal' }, { status: 500 });
  }
  return Response.json({ ok: true }, { status: 201 });
}
```

## Constraints / NÃO fazer
- ❌ Aceitar PATCH com SR.status != `en_route` (RLS de INSERT em T-274 + trigger devem bloquear; aqui retornamos 409)
- ❌ Logar lat/lng nos logs (privacidade)
- ❌ Fazer rate limit por chave de Redis externo (custo MVP) — query last row é suficiente

## Convenções
- Throttle 5s no client + servidor (defesa em camadas)
- Rate-limited via 429 se cliente furar throttle
- Sem batching: cada update é 1 INSERT (volume baixo: 1 ponto/5s × 30 min trajeto = 360 rows max)$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','RATE_LIMIT','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-280 UI hook use-service-execution
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-280', 'Implementar hook use-service-execution (FSM local + Realtime + offline queue)',
 $desc$## Objetivo
Hook React que mantém estado local do serviço em execução para o PRESTADOR: SR atual, estado FSM, tentativas de transição enfileiradas, fotos em upload, signature em upload. Resiliente a perda de conexão: ações são serializadas em IndexedDB e processadas quando reconnect. Cobre AC #1 (sempre indica etapa atual), #2 (avança só após confirmação no servidor), #11 (retry sem avançar pela metade), #12 (offline queue).

## Contexto
Módulo EXECUCAO. Foundational hook usado por T-281 (stepper), T-282 (check-in), T-283 (photos), T-284 (signature). Subscribe ao canal `service:{id}` (T-081 já existente) pra receber updates em tempo real (incl. quando admin força transição via /admin).

Offline queue: usa `idb-keyval` (já está no projeto?) ou simples `localStorage` JSON queue. Cada ação tem `idempotency-key` derivada (transition: device-sr-target; photo: device-sr-moment-uuid; signature: sr-id). Retry exponencial com backoff.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/hooks/use-service-execution.ts`
```typescript
'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import { fetchOrThrow, HttpError } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';

type ServiceState = 'pending_provider_pickup'|'en_route'|'arrived'|'in_progress'|'completed'|'cancelled'|'disputed';

type Action =
  | { type: 'transition'; to: ServiceState }
  | { type: 'photo'; moment: 'before'|'during'|'after'; file: File; localId: string }
  | { type: 'signature'; png_base64: string; client_name: string };

export function useServiceExecution(serviceId: string, initial: { status: ServiceState; provider_id: string }) {
  const [status, setStatus] = useState<ServiceState>(initial.status);
  const [busy, setBusy] = useState(false);
  const [queue, dispatch] = useReducer(queueReducer, []); // ações offline pendentes

  // Subscribe Realtime
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase.channel(`service:${serviceId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'service_requests', filter: `id=eq.${serviceId}`,
      }, (payload) => setStatus((payload.new as any).status))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [serviceId]);

  // Process queue ao reconnect
  useEffect(() => {
    const onOnline = () => processQueue(queue, dispatch, serviceId);
    window.addEventListener('online', onOnline);
    if (navigator.onLine) processQueue(queue, dispatch, serviceId);
    return () => window.removeEventListener('online', onOnline);
  }, [queue, serviceId]);

  const transition = useCallback(async (to: ServiceState) => {
    if (busy) return;
    setBusy(true);
    const idemKey = `transition-${serviceId}-${to}`;
    try {
      await fetchOrThrow(`/api/services/${serviceId}/transition`, {
        method: 'POST',
        headers: { 'content-type':'application/json', 'idempotency-key': idemKey },
        body: JSON.stringify({ to }),
      });
      // Realtime atualiza status; sem setState aqui pra evitar duplicação
    } catch (err: any) {
      if (err instanceof HttpError && err.status === 0) {
        dispatch({ type: 'enqueue', action: { type:'transition', to }, idemKey });
      } else {
        showErrorToast({ type: 'transition' }, err);
      }
    } finally { setBusy(false); }
  }, [busy, serviceId]);

  // Similar pra uploadPhoto, signSignature (omitido por brevidade)
  return { status, busy, queue, transition /* uploadPhoto, signSignature */ };
}
```

## Constraints / NÃO fazer
- ❌ `setState(status)` direto após transition — espera Realtime confirmar (AC #2 avança só após servidor)
- ❌ Reprocessar queue sem checar `idempotency-key` (pode duplicar)
- ❌ Persistir PNG da signature em localStorage (cap 5MB) — usa IndexedDB
- ❌ Subscribe sem unsubscribe no unmount

## Convenções
- Reuso: `useOptimisticCollection` (não diretamente — aqui é estado escalar; mas pra fotos sim), `fetchOrThrow`, `showErrorToast`, canal `service:{id}` (T-081)
- IDs idempotentes derivados de identidade da entidade (mesma estratégia de T-268 ProposalCard)
- AC #2 (avança só com confirmação): único setState de status vem do Realtime, não da resposta do POST$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_HOOK','REALTIME_CHANNEL','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-281 UI stepper /(provider)/services/[id]/in-progress
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-281', 'Renderizar stepper /(provider)/services/[id]/in-progress (steps + transition button + erros)',
 $desc$## Objetivo
Tela principal de execução: stepper visual (a caminho → cheguei → código de início → em execução → concluir/assinar), botão CTA da etapa atual, erros via Sonner, indicador de offline. Cobre AC #1, #2, #11.

## Contexto
Módulo EXECUCAO. Tela hub — o usuário fica aqui durante todo o serviço. Steps mostrados: 5 (en_route, arrived, in_progress, photo_protocol_check, signature). CTA muda dinamicamente. Geolocalização requested ao tocar "Estou a caminho" (PWA pede permissão nesse momento).

## Estado atual / O que substitui
Não existe. T-270 (tela accepted) faz redirect pra cá após "Estou a caminho".

## O que criar

### `src/app/(provider)/services/[id]/in-progress/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { ExecutionStepper } from './ExecutionStepper';

export default async function ServiceInProgressPage({ params }: { params: Promise<{ id:string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: sr } = await supabase.from('service_requests')
    .select('id, status, provider_id, client:client_profiles(name)')
    .eq('id', id).single();
  if (!sr || sr.provider_id !== user.id) notFound();
  return <ExecutionStepper serviceId={id} initialStatus={sr.status} clientName={sr.client?.name ?? ''} />;
}
```

### `src/app/(provider)/services/[id]/in-progress/ExecutionStepper.tsx`
```tsx
'use client';
import { useServiceExecution } from '@/hooks/use-service-execution';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

const STEPS = [
  { key: 'en_route',     label: 'A caminho',          cta: 'Cheguei',                next: 'arrived' },
  { key: 'arrived',      label: 'No local',           cta: 'Gerar código de início', next: 'in_progress', /* via T-275 */ specialKind: 'check_in' },
  { key: 'in_progress',  label: 'Em execução',        cta: 'Concluir e assinar',     next: 'completed', specialKind: 'signature' },
] as const;

export function ExecutionStepper({ serviceId, initialStatus, clientName }: { serviceId:string; initialStatus:any; clientName:string }) {
  const { status, busy, transition } = useServiceExecution(serviceId, { status: initialStatus, provider_id: '' });
  const current = STEPS.find(s => s.key === status);
  const router = useRouter();
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header><h1 className="text-xl font-semibold">Execução do serviço</h1>
        <p className="text-sm text-muted-foreground">Cliente: {clientName}</p>
        {isOffline && <Badge variant="destructive">Offline — ações enfileiradas</Badge>}
      </header>

      <ol className="mt-4 space-y-2">
        {STEPS.map((s, i) => {
          const reached = STEPS.findIndex(x => x.key === status) >= i;
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span className={reached ? 'text-emerald-600' : 'text-muted-foreground'}>{i+1}.</span>
              <span className={reached ? 'font-medium' : ''}>{s.label}</span>
              {s.key === status && <Badge>atual</Badge>}
            </li>
          );
        })}
      </ol>

      {current && (
        <div className="mt-6 sticky bottom-4">
          <Button className="w-full" size="lg" disabled={busy} onClick={() => {
            if (current.specialKind === 'check_in') router.push(`/(provider)/services/${serviceId}/check-in`);
            else if (current.specialKind === 'signature') router.push(`/(provider)/services/${serviceId}/finish`);
            else transition(current.next as any);
          }}>
            {busy ? 'Atualizando…' : current.cta}
          </Button>
        </div>
      )}
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Avançar visualmente sem Realtime confirmar (AC #2 — UI nunca antecipa)
- ❌ Esconder badge "atual" — UX explícita do step ativo
- ❌ Botão sem `disabled` durante `busy` (evita double-click → 2 ações)
- ❌ Solicitar permissão de geolocalização no mount — só ao tocar "Estou a caminho" (AC #3 explicita timing)

## Convenções
- Reuso: `Card`, `Button`, `Badge`, `useServiceExecution` (T-280)
- Mobile-first sticky CTA bottom-4
- Geolocalização capturada em wrapper de página (não aqui — vive em T-281 sub-component dedicado a `en_route`)$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-282 UI check-in code screen
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-282', 'Renderizar tela código de início (gera + exibe + verify)',
 $desc$## Objetivo
Tela onde o PRESTADOR (a) gera código (chama T-275 issue), (b) lê o código gerado em destaque (6 dígitos visualmente grandes), (c) entrega o device pro CLIENTE digitar o código no input (chama T-275 verify), (d) ao acerto, navega pra in-progress; ao 5º erro, code reissue automático e mostra novo. Cobre AC #4, #5.

## Contexto
Módulo EXECUCAO. Estado atual `arrived`; sem código vigente, vê botão "Gerar código"; com código vigente, vê o código + countdown 15min + input pra cliente digitar.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(provider)/services/[id]/check-in/page.tsx` + Client Component
```tsx
'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast, Sonner } from '@/lib/optimistic/toast';
import { useRouter } from 'next/navigation';

export default function CheckInPage({ params }: { params: { id: string } }) {
  const [code, setCode] = useState<string|null>(null);
  const [expiresAt, setExpiresAt] = useState<string|null>(null);
  const [input, setInput] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const issue = async () => {
    setBusy(true);
    try {
      const res = await fetchOrThrow<{ code:string; expires_at:string }>(`/api/services/${params.id}/check-in/issue`, { method: 'POST' });
      setCode(res.code); setExpiresAt(res.expires_at); setAttempts(0);
    } catch (e) { showErrorToast({ type:'issue_check_in' }, e); }
    setBusy(false);
  };

  const verify = async () => {
    if (input.length !== 6) return;
    setBusy(true);
    try {
      const res = await fetchOrThrow<{ ok:boolean; reissued?:boolean; transitioned_to?:string; attempts?:number }>(
        `/api/services/${params.id}/check-in/verify`,
        { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ code: input }) }
      );
      if (res.ok) { Sonner.toast.success('Código confirmado'); router.push(`/(provider)/services/${params.id}/in-progress`); return; }
      if (res.reissued) { setCode(null); setInput(''); setAttempts(0); Sonner.toast.warning('Código novo gerado após 5 tentativas'); await issue(); return; }
      setAttempts(res.attempts ?? attempts+1); setInput(''); Sonner.toast.error(`Código incorreto (${res.attempts}/5)`);
    } catch (e) { showErrorToast({ type:'verify_check_in' }, e); }
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-semibold">Código de início</h1>
      {!code ? (
        <Button className="w-full mt-4" onClick={issue} disabled={busy}>Gerar código</Button>
      ) : (
        <Card className="mt-4 p-6 text-center">
          <p className="text-sm text-muted-foreground">Mostre este código ao cliente:</p>
          <p className="text-5xl font-mono tracking-widest mt-2">{code}</p>
          <Countdown until={expiresAt!} />
          <FormBody className="mt-6">
            <Field name="code"><Field.Label>Cliente digita aqui</Field.Label>
              <Field.Control>
                <Input inputMode="numeric" maxLength={6} value={input} onChange={e => setInput(e.target.value.replace(/\D/g,''))} autoFocus />
              </Field.Control>
            </Field>
          </FormBody>
          <Button className="w-full mt-4" onClick={verify} disabled={busy || input.length !== 6}>
            {busy ? 'Verificando…' : 'Confirmar'}
          </Button>
          {attempts > 0 && <p className="text-xs text-amber-600 mt-2">{attempts}/5 tentativas erradas</p>}
        </Card>
      )}
    </main>
  );
}

function Countdown({ until }: { until: string }) {
  const [r, setR] = useState(() => Math.max(0, Math.floor((new Date(until).getTime() - Date.now())/1000)));
  useEffect(() => { const t = setInterval(() => setR(x => Math.max(0, x-1)), 1000); return () => clearInterval(t); }, []);
  const m = Math.floor(r/60); const s = (r%60).toString().padStart(2,'0');
  return <p className="text-sm text-muted-foreground mt-2">Expira em {m}:{s}</p>;
}
```

## Constraints / NÃO fazer
- ❌ Mostrar o código antes de chamar `issue` (UI vazia até o servidor responder)
- ❌ Persistir o código em localStorage (proteção contra captura — vive em memória apenas)
- ❌ ConfirmDialog na geração do código (operação reversível — sempre pode reissue)
- ❌ Pre-fill do input (cliente digita)

## Convenções
- Reuso: `Card`, `Button`, `Field`/`FormBody`, `Input`, `Sonner` toast
- Endpoints `/check-in/issue` e `/check-in/verify` (criação dos route handlers fica neste task — wrappers triviais sobre T-275 RPCs)
- Input numérico mobile-friendly (`inputMode="numeric"`)$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','FIELD_COMPOUND_API','MOBILE_FIRST','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-283 UI photo protocol
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-283', 'Renderizar tela protocolo fotográfico (3 momentos: antes/durante/depois)',
 $desc$## Objetivo
Tela acessada durante `in_progress` que permite o PRESTADOR registrar fotos em 3 momentos (antes, durante, depois). Picker via `<input type="file" capture="environment">`, mostrando upload bar, contador atual por momento e bloqueando navegação pra "Concluir" enquanto algum momento tem 0 fotos. Cobre AC #6.

## Contexto
Módulo EXECUCAO. PWA usa câmera nativa via input file capture (sem dep extra). Upload via T-277. Lista atualiza otimisticamente após upload bem-sucedido.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(provider)/services/[id]/photos/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { PhotosClient } from './PhotosClient';

export default async function PhotosPage({ params }: { params: Promise<{ id:string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: photos } = await supabase.from('service_photos')
    .select('id, moment, storage_path, uploaded_at').eq('service_request_id', id).order('uploaded_at');
  return <PhotosClient serviceId={id} initial={photos ?? []} />;
}
```

### `src/app/(provider)/services/[id]/photos/PhotosClient.tsx`
```tsx
'use client';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sonner } from '@/lib/optimistic/toast';

const MOMENTS = [
  { key: 'before' as const, label: 'Antes' },
  { key: 'during' as const, label: 'Durante' },
  { key: 'after'  as const, label: 'Depois' },
];

export function PhotosClient({ serviceId, initial }: { serviceId: string; initial: any[] }) {
  const { items, mutate } = useOptimisticCollection<any>(initial);
  const counts = MOMENTS.reduce((acc, m) => ({ ...acc, [m.key]: items.filter(p => p.moment === m.key).length }), {} as Record<string,number>);
  const allSatisfied = MOMENTS.every(m => counts[m.key] >= 1);

  const upload = async (moment: 'before'|'during'|'after', file: File) => {
    const localId = `tmp-${Date.now()}`;
    await mutate(
      { type: 'create', item: { id: localId, moment, storage_path: '...' } },
      async (signal) => {
        const fd = new FormData(); fd.set('moment', moment); fd.set('photo', file);
        const res = await fetch(`/api/services/${serviceId}/photos`, { method:'POST', body: fd, signal });
        if (!res.ok) throw new Error('upload_failed');
        return await res.json();
      },
      { errorLabel: 'Falha no upload da foto' }
    );
  };

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-xl font-semibold">Protocolo fotográfico</h1>
      <p className="text-sm text-muted-foreground">Mínimo 1 foto em cada momento.</p>

      {MOMENTS.map(m => (
        <Card key={m.key} className="mt-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{m.label}</h2>
            <Badge variant={counts[m.key] >= 1 ? 'default' : 'destructive'}>{counts[m.key]} foto(s)</Badge>
          </div>
          <input type="file" accept="image/*" capture="environment" className="mt-2"
            onChange={e => e.target.files?.[0] && upload(m.key, e.target.files[0])} />
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {items.filter(p => p.moment === m.key).map(p => (
              <li key={p.id} className="aspect-square bg-muted rounded" />
            ))}
          </ul>
        </Card>
      ))}

      <div className="mt-6 sticky bottom-4">
        <Button className="w-full" size="lg" disabled={!allSatisfied}>
          {allSatisfied ? 'Voltar à execução' : 'Complete os 3 momentos'}
        </Button>
      </div>
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Avançar pra `signature` sem 3 momentos cobertos (AC #6 — RPC T-278 aborta, mas UI deve evitar friccão)
- ❌ Compressão client-side com lib pesada (deixa servidor cuidar do tamanho via Storage Transform)
- ❌ Permitir DELETE de foto pelo prestador (audit imutável, T-272 RLS)

## Convenções
- Reuso: `useOptimisticCollection`, `Card`, `Button`, `Badge`, `Sonner`
- Native file input com `capture="environment"` (câmera traseira)
- Aspect-square thumbnails$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-284 UI signature + success + receipt
('c1073502-0162-4e21-b586-b9c37f3898bc', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '6a687229-eba6-4269-b66d-98556529e8d9',
 'ZLAR-V2-T-284', 'Renderizar tela assinatura + tela sucesso + acesso recibo no histórico',
 $desc$## Objetivo
Três telas relacionadas: (1) `/finish` — captura signature canvas + nome do cliente + submit; (2) `/finished` — sucesso pós-assinatura, mostra prazo de liberação do pagamento; (3) integração com tela de histórico (T-134/T-135) pra ver recibo + fotos pós-conclusão. Cobre AC #7, #8, #13.

## Contexto
Módulo EXECUCAO. Estado atual `in_progress` + fotos OK; tela `/finish` aparece. Canvas HTML5 captura signature, exporta base64 PNG, envia ao T-278. Após 201, navega pra `/finished`. Tela `/finished` mostra: serviço concluído, prazo de liberação parcial (calculado de `app_config.escrow_70_30`), prazo final.

T-134/T-135 (PERFIL — histórico do prestador) já existem; aqui apenas garantimos que o item em histórico abre detalhe com link pra recibo (signature + photos imutáveis).

## Estado atual / O que substitui
Não existe `/finish` ou `/finished`. T-134 tela histórico já existe.

## O que criar

### `src/app/(provider)/services/[id]/finish/page.tsx` + Client component com canvas
```tsx
'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';
import { useRouter } from 'next/navigation';

export default function FinishPage({ params }: { params: { id:string } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // setup canvas drawing handlers (omitido — referência à lib nativa)
  const submit = async () => {
    if (!canvasRef.current || name.length < 2) return;
    setBusy(true);
    try {
      const png = canvasRef.current.toDataURL('image/png');
      await fetchOrThrow(`/api/services/${params.id}/signature`, {
        method: 'POST',
        headers: { 'content-type':'application/json', 'idempotency-key': `signature-${params.id}` },
        body: JSON.stringify({ png_base64: png, client_name_typed: name }),
      });
      router.replace(`/(provider)/services/${params.id}/finished`);
    } catch (e: any) {
      if (e.status === 409) showErrorToast({ type:'photos_incomplete' }, e);
      else showErrorToast({ type:'signature' }, e);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-semibold">Assinatura do cliente</h1>
      <p className="text-sm text-muted-foreground">Vire o dispositivo para o cliente assinar.</p>
      <Card className="mt-4 p-2">
        <canvas ref={canvasRef} width={400} height={160} className="border rounded w-full touch-none" />
        <Button variant="ghost" className="mt-2" onClick={() => canvasRef.current?.getContext('2d')?.clearRect(0,0,400,160)}>Limpar</Button>
      </Card>
      <FormBody className="mt-4">
        <Field name="name" required><Field.Label>Nome do cliente</Field.Label>
          <Field.Control><Input value={name} onChange={e => setName(e.target.value)} /></Field.Control>
        </Field>
      </FormBody>
      <Button className="w-full mt-4" onClick={submit} disabled={busy || name.length<2}>
        {busy ? 'Registrando…' : 'Confirmar conclusão'}
      </Button>
    </main>
  );
}
```

### `src/app/(provider)/services/[id]/finished/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function FinishedPage({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: sr } = await supabase.from('service_requests')
    .select('total_value_cents, completed_at').eq('id', id).single();
  // Lê app_config.escrow_70_30 pra calcular prazo
  const { data: cfg } = await supabase.from('app_config').select('value').eq('key','escrow_70_30').single();
  // partial_release_at = completed_at + cfg.partial_hours; final_release_at = completed_at + cfg.final_hours
  return (
    <main className="mx-auto max-w-md p-4 text-center">
      <h1 className="text-2xl font-semibold mt-8">Serviço concluído</h1>
      <Card className="mt-6 p-4 text-left space-y-2">
        <p className="text-sm">Liberação parcial em ~3h após a conclusão.</p>
        <p className="text-sm">Liberação total em 72h (após período de garantia).</p>
      </Card>
      <Link href="/(provider)/home"><Button className="mt-6 w-full">Voltar ao início</Button></Link>
      <Link href={`/(provider)/history/${id}`}><Button variant="ghost" className="mt-2 w-full">Ver recibo</Button></Link>
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Submit sem signature (canvas vazio) — Button disable se canvas em branco (verificar pixels)
- ❌ ConfirmDialog na conclusão (AC #7: assinatura É o gatilho — friction extra desencoraja)
- ❌ Mostrar valor exato da liberação parcial sem ler `app_config` (configurável)
- ❌ Recriar tela de histórico — usa T-134/T-135 com link pra recibo

## Convenções
- Canvas HTML5 nativo (sem dep) — `touchstart/touchmove/touchend`
- Idempotency-key estável: `signature-${sr_id}`
- Prazos lidos de `app_config.escrow_70_30` (T-237 seed) — parametrização sem deploy$desc$,
 'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculo task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-271 DATA check_in_codes cobre AC #4, #5
  ('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb'::uuid, 4),
  ('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb'::uuid, 5),
  -- T-272 DATA service_photos cobre AC #6, #13
  ('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705'::uuid, 6),
  ('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705'::uuid, 13),
  -- T-273 DATA service_signatures cobre AC #7, #13
  ('9f47eb85-80f8-46ba-ba31-37c872eec7ef'::uuid, 7),
  ('9f47eb85-80f8-46ba-ba31-37c872eec7ef'::uuid, 13),
  -- T-274 DATA service_provider_locations cobre AC #3
  ('078e9748-1c81-488d-bb06-91930a2c0d1f'::uuid, 3),
  -- T-275 API check-in RPCs cobre AC #4, #5
  ('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5'::uuid, 4),
  ('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5'::uuid, 5),
  -- T-276 API transition wrapper cobre AC #1, #2, #11, #12
  ('c356a302-31ea-4026-a913-d527fb71ceda'::uuid, 1),
  ('c356a302-31ea-4026-a913-d527fb71ceda'::uuid, 2),
  ('c356a302-31ea-4026-a913-d527fb71ceda'::uuid, 11),
  ('c356a302-31ea-4026-a913-d527fb71ceda'::uuid, 12),
  -- T-277 API photos upload cobre AC #6
  ('23b7eb00-6b4d-43d2-a96e-11fe1f614792'::uuid, 6),
  -- T-278 API signature cobre AC #7, #8, #9, #10
  ('6ac51027-8e29-4806-91b5-bc3c741e660c'::uuid, 7),
  ('6ac51027-8e29-4806-91b5-bc3c741e660c'::uuid, 8),
  ('6ac51027-8e29-4806-91b5-bc3c741e660c'::uuid, 9),
  ('6ac51027-8e29-4806-91b5-bc3c741e660c'::uuid, 10),
  -- T-279 API location stream cobre AC #3
  ('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e'::uuid, 3),
  -- T-280 UI hook execution cobre AC #1, #2, #11, #12
  ('6751eae5-2b2e-42c0-9f75-41fa7758d229'::uuid, 1),
  ('6751eae5-2b2e-42c0-9f75-41fa7758d229'::uuid, 2),
  ('6751eae5-2b2e-42c0-9f75-41fa7758d229'::uuid, 11),
  ('6751eae5-2b2e-42c0-9f75-41fa7758d229'::uuid, 12),
  -- T-281 UI stepper cobre AC #1, #2, #3, #11
  ('80976c8a-5ed5-4830-8521-0f93fc3485e9'::uuid, 1),
  ('80976c8a-5ed5-4830-8521-0f93fc3485e9'::uuid, 2),
  ('80976c8a-5ed5-4830-8521-0f93fc3485e9'::uuid, 3),
  ('80976c8a-5ed5-4830-8521-0f93fc3485e9'::uuid, 11),
  -- T-282 UI check-in code screen cobre AC #4, #5
  ('7a717e53-c9cd-4db5-b960-2a8c12230ac2'::uuid, 4),
  ('7a717e53-c9cd-4db5-b960-2a8c12230ac2'::uuid, 5),
  -- T-283 UI photo protocol cobre AC #6
  ('df8baf15-7764-4ce6-bc39-d9b1f77898b3'::uuid, 6),
  -- T-284 UI signature + success + receipt cobre AC #7, #8, #13
  ('c1073502-0162-4e21-b586-b9c37f3898bc'::uuid, 7),
  ('c1073502-0162-4e21-b586-b9c37f3898bc'::uuid, 8),
  ('c1073502-0162-4e21-b586-b9c37f3898bc'::uuid, 13)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;


-- ============================================================================
-- 3. AcceptanceCriterion (taskId) — checklist técnico
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-271 service_check_in_codes
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'Tabela service_check_in_codes criada com colunas e CHECK em invalidated_reason', 1),
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'Constraint UNIQUE parcial (used_at IS NULL AND invalidated_at IS NULL) ativa', 2),
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'RLS: PRESTADOR ve só own codes; INSERT/UPDATE direto bloqueado', 3),
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'ADMIN read-all funciona com claim app_metadata.role=admin', 4),
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'pgcrypto extension habilitada (precondição pra hashing)', 5),
('8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'Smoke: 2 tentativas concorrentes de issue resultam em apenas 1 ativo (constraint UNIQUE)', 6),

-- T-272 service_photos
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'Migration aplicada; database.types.ts regenerado', 0),
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'Enum service_photo_moment com 3 valores (before/during/after) criado', 1),
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'RLS: PRESTADOR insert/select own; CLIENTE select pos in_progress; ADMIN read-all', 2),
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'INSERT bloqueado quando SR.status NOT IN (en_route, arrived, in_progress)', 3),
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'Sem policy de UPDATE/DELETE (audit imutável)', 4),
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'Bucket service-photos/ privado configurado em OPS', 5),
('6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'Smoke: prestador A nao ve fotos do prestador B (RLS)', 6),

-- T-273 service_signatures
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'Migration aplicada; types regenerados', 0),
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'UNIQUE(service_request_id) garante 1 signature por SR', 1),
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'RLS: PRESTADOR/CLIENTE leem own; ADMIN tudo; sem direct writes (RPC only)', 2),
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'Tentativa de UPDATE retorna policy denied (smoke)', 3),
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'Tentativa de DELETE retorna policy denied (smoke)', 4),
('9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'Bucket signatures/ privado configurado em OPS', 5),

-- T-274 service_provider_locations
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'Migration aplicada; types regenerados', 0),
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'RLS: PRESTADOR own (insert+select); CLIENTE só durante en_route da própria SR', 1),
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'Realtime publication adicionado (ALTER PUBLICATION supabase_realtime ADD TABLE)', 2),
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'Index (service_request_id, recorded_at DESC) em uso por queries de stream', 3),
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'Cron 24h cleanup configurado em OPS (T-237 extension)', 4),
('078e9748-1c81-488d-bb06-91930a2c0d1f', 'Trigger BEFORE INSERT bloqueia se SR.status != en_route', 5),

-- T-275 check-in RPCs
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'RPC issue_check_in_code criada com SECURITY DEFINER + REVOKE/GRANT explícitos', 0),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'RPC verify_check_in_code criada com mesmas garantias', 1),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'Hash via pgcrypto crypt + gen_salt(bf,8); plaintext nunca persistido', 2),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'TTL e max_attempts lidos de app_config.execution.* (configurável)', 3),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', '5º erro invalida code com reason=max_attempts e retorna reissued=true', 4),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'Verify success transiciona FSM in_progress via transition_service_status (T-235)', 5),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'Smoke: code expirado retorna error code 22023 detail=expired', 6),
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'Smoke: prestador B chamando issue em SR de A retorna 42501 forbidden', 7),

-- T-276 transition wrapper
('c356a302-31ea-4026-a913-d527fb71ceda', 'Endpoint POST /api/services/[id]/transition criado', 0),
('c356a302-31ea-4026-a913-d527fb71ceda', 'Idempotency-key header obrigatório (400 se ausente)', 1),
('c356a302-31ea-4026-a913-d527fb71ceda', 'Zod restringe to a en_route|arrived (in_progress/completed via outras rotas)', 2),
('c356a302-31ea-4026-a913-d527fb71ceda', 'JWT obrigatório (401)', 3),
('c356a302-31ea-4026-a913-d527fb71ceda', 'Mapping P0002→404, transition_not_allowed→409, forbidden→403, pending_state→409', 4),
('c356a302-31ea-4026-a913-d527fb71ceda', 'Mesma idempotency-key 2x retorna mesmo resultado', 5),
('c356a302-31ea-4026-a913-d527fb71ceda', 'Smoke: chamar com to=in_progress retorna 400 Zod', 6),

-- T-277 photos upload
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Endpoint POST /api/services/[id]/photos criado (multipart/form-data)', 0),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Validação de moment={before,during,after}', 1),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Validação de tamanho ≤10MB (413 senão)', 2),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Upload via admin client (service_role) ao bucket privado service-photos/', 3),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Path service-photos/{sr_id}/{moment}/{uuid}.jpg consistente', 4),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Insert metadata em service_photos via RLS (provider_id = auth.uid)', 5),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Rollback storage se insert falhar', 6),
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'Status FSM diferente do esperado retorna 409 wrong_status com detail', 7),

-- T-278 signature record
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'RPC record_signature criada com SECURITY DEFINER + grants', 0),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Endpoint POST /api/services/[id]/signature criado com idempotency-key', 1),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'PNG salvo no bucket privado signatures/{sr_id}.png via admin client', 2),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Validação fotos: 0 em qualquer momento retorna 409 photos_incomplete', 3),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Status diferente de in_progress retorna 22023 invalid_status (mapeado pra 409)', 4),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Idempotência: 2ª chamada retorna idempotent=true sem duplicar', 5),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Após sucesso, transition_service_status (T-235) levou SR para completed', 6),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Notification escrow notice enfileirada via T-164 hook (smoke logs)', 7),
('6ac51027-8e29-4806-91b5-bc3c741e660c', 'Cron T-126 inicia contagem T+72h pra release-escrow-payouts (T-127)', 8),

-- T-279 location stream
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'Endpoint PATCH /api/services/[id]/location criado', 0),
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'Zod valida lat/lng/accuracy_m', 1),
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'Rate-limit naive: 429 se ultima inserção <5s', 2),
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'JWT obrigatório (401)', 3),
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'INSERT bloqueado quando status != en_route (trigger T-274 ou error mapping)', 4),
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'Logs sem lat/lng (privacidade)', 5),

-- T-280 hook execution
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'Hook subscribe ao canal service:{id} no mount + unsubscribe no unmount', 0),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'Status local atualizado SOMENTE via Realtime (não via response do POST)', 1),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'transition() captura HttpError status=0 e enfileira em IndexedDB', 2),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'Listener window.online dispara processQueue(queue)', 3),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'Cada ação tem idempotency-key estável (transition-{id}-{to}, photo-..., signature-{id})', 4),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'busy=true durante request bloqueia double-click', 5),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'Smoke: offline → 3 transitions enfileiradas → online → todas processadas em ordem', 6),

-- T-281 stepper
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'Página /(provider)/services/[id]/in-progress criada (Server + Client component)', 0),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', '5 steps mostrados: pending_provider_pickup, en_route, arrived, in_progress, completed', 1),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'Step atual destacado com Badge "atual"', 2),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'CTA muda dinamicamente conforme status (Cheguei / Gerar código / Concluir)', 3),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'Banner "Offline — ações enfileiradas" quando navigator.onLine=false', 4),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'Permissão de geolocalização solicitada APENAS ao tocar "Estou a caminho"', 5),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'CTA disabled durante busy (sem double-click)', 6),
('80976c8a-5ed5-4830-8521-0f93fc3485e9', 'Mobile-first verificado em viewport <768px com sticky CTA bottom-4', 7),

-- T-282 check-in screen
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Página /(provider)/services/[id]/check-in criada', 0),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Botão "Gerar código" chama issue_check_in_code via /api/services/[id]/check-in/issue', 1),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Código exibido com font-mono 5xl tracking-widest', 2),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Countdown 15min decrescente em segundos', 3),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Input numérico maxLength=6 com inputMode=numeric', 4),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', '5º erro mostra warning, dispara reissue automático e zera input', 5),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Sucesso navega para /in-progress via router.push', 6),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'Código não persiste em localStorage (apenas memória)', 7),

-- T-283 photo protocol
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'Página /(provider)/services/[id]/photos criada com Server+Client', 0),
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'Cards por momento (Antes/Durante/Depois) com contador de fotos', 1),
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'Input file capture=environment dispara câmera nativa', 2),
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'useOptimisticCollection adiciona thumb otimisticamente após upload', 3),
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'Botão "Voltar à execução" disabled enquanto algum momento tem 0 fotos', 4),
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'Sem botão de DELETE (audit imutável, T-272 RLS)', 5),

-- T-284 signature + success
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Página /finish com canvas HTML5 captura signature touchscreen', 0),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Field nome do cliente (mín 2 chars) bloqueia submit', 1),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Submit chama POST /api/services/[id]/signature com idempotency-key=signature-{id}', 2),
('c1073502-0162-4e21-b586-b9c37f3898bc', '409 photos_incomplete mostra Sonner.error linkando pra /photos', 3),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Sucesso 201 navega via router.replace para /finished', 4),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Página /finished mostra prazos lidos de app_config.escrow_70_30', 5),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Link para histórico (T-134) com acesso ao recibo (signature + photos imutáveis)', 6),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'Sem ConfirmDialog na conclusão (assinatura é o gatilho explícito)', 7);


-- ============================================================================
-- 4. TaskDependency
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES

-- T-275 RPCs depende de T-271 tabela
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', '8eec9de3-3f30-4b2f-b5e5-e34dd7e3b4cb', 'blocks'),
-- T-275 também depende de T-235 (transition_service_status)
('dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),

-- T-276 transition wrapper depende de T-235
('c356a302-31ea-4026-a913-d527fb71ceda', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),
-- e relaciona com T-227 (FSM trigger) e T-231 (pending states)
('c356a302-31ea-4026-a913-d527fb71ceda', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-227'), 'relates_to'),
('c356a302-31ea-4026-a913-d527fb71ceda', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-231'), 'relates_to'),

-- T-277 photos upload depende de T-272
('23b7eb00-6b4d-43d2-a96e-11fe1f614792', '6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'blocks'),

-- T-278 signature record depende de T-273, T-272, T-235, T-164
('6ac51027-8e29-4806-91b5-bc3c741e660c', '9f47eb85-80f8-46ba-ba31-37c872eec7ef', 'blocks'),
('6ac51027-8e29-4806-91b5-bc3c741e660c', '6a2b4d34-4fbf-4cd9-8dbd-5333243b4705', 'blocks'),
('6ac51027-8e29-4806-91b5-bc3c741e660c', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'blocks'),
('6ac51027-8e29-4806-91b5-bc3c741e660c', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-164'), 'relates_to'),
('6ac51027-8e29-4806-91b5-bc3c741e660c', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-126'), 'relates_to'),
('6ac51027-8e29-4806-91b5-bc3c741e660c', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-127'), 'relates_to'),
('6ac51027-8e29-4806-91b5-bc3c741e660c', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-153'), 'relates_to'),

-- T-279 location stream depende de T-274
('e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', '078e9748-1c81-488d-bb06-91930a2c0d1f', 'blocks'),

-- T-280 hook execution depende de T-276/T-277/T-278/T-279 + T-081 (canal service:{id})
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'c356a302-31ea-4026-a913-d527fb71ceda', 'blocks'),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', '23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'blocks'),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', '6ac51027-8e29-4806-91b5-bc3c741e660c', 'blocks'),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', 'e8ab9635-ec9e-4bda-8ce8-8ee3d1bffc3e', 'blocks'),
('6751eae5-2b2e-42c0-9f75-41fa7758d229', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-081'), 'blocks'),

-- T-281 stepper depende de T-280
('80976c8a-5ed5-4830-8521-0f93fc3485e9', '6751eae5-2b2e-42c0-9f75-41fa7758d229', 'blocks'),
-- relaciona com T-270 (tela accepted antes de chegar aqui)
('80976c8a-5ed5-4830-8521-0f93fc3485e9', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-270'), 'relates_to'),

-- T-282 check-in depende de T-275 + T-280
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', 'dab0c246-9d6b-4ab3-9d39-559ad58fa3b5', 'blocks'),
('7a717e53-c9cd-4db5-b960-2a8c12230ac2', '6751eae5-2b2e-42c0-9f75-41fa7758d229', 'blocks'),

-- T-283 photo protocol depende de T-277 + T-280
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', '23b7eb00-6b4d-43d2-a96e-11fe1f614792', 'blocks'),
('df8baf15-7764-4ce6-bc39-d9b1f77898b3', '6751eae5-2b2e-42c0-9f75-41fa7758d229', 'blocks'),

-- T-284 signature + success + receipt depende de T-278, T-280, T-283
('c1073502-0162-4e21-b586-b9c37f3898bc', '6ac51027-8e29-4806-91b5-bc3c741e660c', 'blocks'),
('c1073502-0162-4e21-b586-b9c37f3898bc', '6751eae5-2b2e-42c0-9f75-41fa7758d229', 'blocks'),
('c1073502-0162-4e21-b586-b9c37f3898bc', 'df8baf15-7764-4ce6-bc39-d9b1f77898b3', 'blocks'),
-- relates_to histórico (T-134, T-135)
('c1073502-0162-4e21-b586-b9c37f3898bc', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-134'), 'relates_to'),
('c1073502-0162-4e21-b586-b9c37f3898bc', (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-135'), 'relates_to');


COMMIT;
