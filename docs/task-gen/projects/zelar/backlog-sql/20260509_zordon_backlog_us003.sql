-- ZLAR-V2-US-003 — Completar pré-requisitos para entrar no pool de matching
-- Persona: PRESTADOR  |  Módulo: ONBOARDING  |  9 AC
-- 9 tasks: 3 DATA + 3 API + 3 UI
-- Geração via skill /task-gen-story

BEGIN;

-- ============================================================================
-- 1. TASKS
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ----------------------------------------------------------------------------
-- T-025 [DATA] provider_availability_windows com seed default 8h-18h
-- ----------------------------------------------------------------------------
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-025',
 'Criar provider_availability_windows com seed default 8h-18h',
 $desc$## Objetivo
Persistir janelas de disponibilidade semanal do prestador. Modelo definitivo (não placeholder): uma linha por dia da semana com `start_time/end_time`. No primeiro acesso à configuração, seed automático cria 7 linhas com 08:00–18:00 (default que satisfaz US-027 AC #2). US-027 expande UI rica de edição em grade. Cobre AC #3, #4 (parte DATA) e AC #8 (sinal pra view).

## Contexto
Módulo ONBOARDING — fundação de disponibilidade. Modelo definitivo: US-027 não substitui esta tabela, só edita linhas. Engine de matching (US-020) lê desta tabela pra decidir se prestador entra no pool dado dia/hora atual. Toggle "indisponível hoje" da US-027 é tabela separada (`provider_unavailability_overrides`, fora deste escopo).

## Estado atual / O que substitui
Não existe. T-014 (US-002) marca `has_availability` como placeholder `false` — T-027 desta US substitui a coluna pelo `EXISTS` real nesta tabela.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_availability.sql`
```sql
BEGIN;

CREATE TABLE provider_availability_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  -- Postgres dow: 0=domingo .. 6=sábado
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT availability_window_valid CHECK (end_time > start_time),
  CONSTRAINT availability_unique_day UNIQUE (provider_id, day_of_week)
);

CREATE INDEX ON provider_availability_windows(provider_id);

ALTER TABLE provider_availability_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_select_own" ON provider_availability_windows FOR SELECT
  USING (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));
CREATE POLICY "provider_modify_own" ON provider_availability_windows FOR ALL
  USING (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()))
  WITH CHECK (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));
CREATE POLICY "admin_all" ON provider_availability_windows FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER provider_availability_windows_updated_at
  BEFORE UPDATE ON provider_availability_windows
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

-- Função de seed default (chamada pela API T-028 no primeiro acesso)
CREATE OR REPLACE FUNCTION seed_default_availability(p_provider_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO provider_availability_windows (provider_id, day_of_week, start_time, end_time)
  SELECT p_provider_id, dow, time '08:00', time '18:00'
  FROM generate_series(0, 6) AS dow
  ON CONFLICT (provider_id, day_of_week) DO NOTHING;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não armazenar dia da semana como string ("monday") — `smallint` é mais barato e respeita locale
- ❌ Não permitir múltiplas janelas por dia (só 1 par start/end) — US-027 expande pra múltiplas se decidirem; aqui MVP é 1
- ❌ Não modelar exceções (feriados, indisponibilidade pontual) — vivem em US-027 com tabela própria
- ❌ Não bloquear `enabled=false` em prestador suspended — engine de matching já filtra por `account_status` antes

## Convenções
- Day-of-week 0=dom..6=sáb (Postgres `EXTRACT(dow ...)` consistente)
- Time sem timezone (regra de negócio é por horário local do prestador; timezone vive em provider_profiles futuramente)
- Função de seed isolada (chamada idempotente: `ON CONFLICT DO NOTHING`)
- Migration via psql; `database.types.ts` regenerado
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-026 [DATA] provider_bank_accounts com status enum + RLS
-- ----------------------------------------------------------------------------
('31317d25-fae0-4da9-847e-90b3b2cfce98',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-026',
 'Criar provider_bank_accounts com status enum e auditoria',
 $desc$## Objetivo
Persistir conta bancária do prestador com status do ciclo de validação (pending/verified/failed) e motivo da falha. Cobre AC #5 (cadastro), AC #6 (verificada) e AC #7 (falha + reenvio). Esta tabela é fonte de verdade do sinal `has_bank_account` pra view T-014/T-027.

## Contexto
Módulo ONBOARDING — fundação financeira do prestador. Lida pelo engine de pagamentos (US futura) e pelo job de release de escrow (US-023). Suporta titularidade própria ou de terceiros (CPF do titular pode diferir de `provider_profiles.cpf`). 1 prestador → no máximo 1 conta ativa (substituível com histórico).

## Estado atual / O que substitui
Não existe. T-014 da US-002 marca `has_bank_account` como placeholder `false` — T-027 desta US substitui pelo `EXISTS verified`.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_bank_accounts.sql`
```sql
BEGIN;

CREATE TYPE bank_account_status AS ENUM ('pending', 'verified', 'failed');
CREATE TYPE bank_account_holder AS ENUM ('self', 'third_party');

CREATE TABLE provider_bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  bank_code       text NOT NULL,        -- código FEBRABAN, ex: '341'
  branch          text NOT NULL,        -- agência sem dígito
  account_number  text NOT NULL,        -- conta sem dígito
  account_digit   text NOT NULL,        -- dígito verificador
  holder_name     text NOT NULL,
  holder_cpf      text NOT NULL,        -- 11 dígitos sem máscara
  holder_type     bank_account_holder NOT NULL DEFAULT 'self',
  status          bank_account_status NOT NULL DEFAULT 'pending',
  failure_reason  text,
  external_ref    text,                  -- id retornado pelo gateway de validação
  verified_at     timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_cpf_format CHECK (holder_cpf ~ '^[0-9]{11}$'),
  CONSTRAINT bank_branch_format CHECK (branch ~ '^[0-9]{1,6}$'),
  CONSTRAINT bank_failure_when_failed CHECK (
    (status = 'failed' AND failure_reason IS NOT NULL) OR status <> 'failed'
  )
);

-- Apenas 1 conta ativa por prestador
CREATE UNIQUE INDEX provider_one_active_bank ON provider_bank_accounts(provider_id) WHERE is_active = true;
CREATE INDEX ON provider_bank_accounts(provider_id, status);

ALTER TABLE provider_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Prestador lê só sua linha; insere e atualiza dados pessoais (campos de status são protegidos via trigger)
CREATE POLICY "provider_select_own" ON provider_bank_accounts FOR SELECT
  USING (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));
CREATE POLICY "provider_insert_own" ON provider_bank_accounts FOR INSERT
  WITH CHECK (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));
CREATE POLICY "provider_update_own" ON provider_bank_accounts FOR UPDATE
  USING (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()))
  WITH CHECK (provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid()));
CREATE POLICY "admin_all" ON provider_bank_accounts FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Status, verified_at, external_ref e failure_reason só mudam por service_role
CREATE OR REPLACE FUNCTION protect_bank_status_cols() RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
     OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN
    RAISE EXCEPTION 'forbidden_column_update' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER provider_bank_accounts_protect_status
  BEFORE UPDATE ON provider_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION protect_bank_status_cols();

CREATE TRIGGER provider_bank_accounts_updated_at
  BEFORE UPDATE ON provider_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não permitir prestador editar `status`/`verified_at`/`failure_reason`/`external_ref` (trigger bloqueia)
- ❌ Não armazenar conta bancária com máscara/separador — sempre dígitos puros
- ❌ Não fazer hash de CPF do titular (precisa ser legível pra gateway). Encriptar repouso é tema de US-014/LGPD, não desta task
- ❌ Não permitir múltiplas contas ativas (constraint UNIQUE parcial)
- ❌ Não cascatear DELETE pra service_requests futuros — `ON DELETE RESTRICT` em referências futuras (escopo de US-028 quando criar tabela de pagamentos)

## Convenções
- Enum em snake_case (consistente com `provider_kyc_status`, `provider_account_status`)
- `failure_reason` é texto curado pela API T-030 (nunca payload bruto do gateway)
- Reenvio = UPDATE (não delete+insert): preserva `id` para correlação com pagamentos
- Migration via psql; `database.types.ts` regenerado
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-027 [DATA] Atualizar view provider_onboarding_state com sinais reais
-- ----------------------------------------------------------------------------
('577eaf09-23eb-4299-a215-c5ea9a04545b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-027',
 'Atualizar view provider_onboarding_state com sinais reais de availability e bank_account',
 $desc$## Objetivo
Substituir os placeholders `false` em `has_availability` e `has_bank_account` na view T-014 (US-002) pelos sinais reais derivados de `provider_availability_windows` (T-025) e `provider_bank_accounts` (T-026 com `status='verified'`). A regra de roteamento `route_target='first_steps'` passa a refletir corretamente AC #1, #2 e #8.

## Contexto
Módulo ONBOARDING — task pequena mas crítica: fecha o ciclo iniciado em T-014 da US-002. Sem isso, T-031 (banner) e T-023 (US-002, checklist) sempre acham que faltam pré-requisitos, mesmo após o prestador completar.

## Estado atual / O que substitui
View `provider_onboarding_state` existe (T-014/US-002) com 2 placeholders. Esta task **substitui** a view via `CREATE OR REPLACE VIEW`.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_onboarding_state_real_signals.sql`
```sql
BEGIN;

CREATE OR REPLACE VIEW provider_onboarding_state AS
SELECT
  pp.user_id,
  pp.signup_step,
  pp.kyc_status,
  pp.kyc_attempts,
  pp.kyc_blocked_reason,
  pp.account_status,
  pp.suspended_at,
  pp.suspension_reason,
  COALESCE(
    (SELECT COUNT(*) > 0 FROM provider_categories pc WHERE pc.provider_id = pp.id),
    false
  ) AS has_categories,
  COALESCE(
    (SELECT COUNT(*) > 0 FROM provider_availability_windows w WHERE w.provider_id = pp.id),
    false
  ) AS has_availability,
  COALESCE(
    (SELECT COUNT(*) > 0 FROM provider_bank_accounts b
     WHERE b.provider_id = pp.id AND b.status = 'verified' AND b.is_active = true),
    false
  ) AS has_bank_account,
  CASE
    WHEN pp.account_status = 'suspended' THEN 'suspended'
    WHEN pp.account_status = 'blocked'   THEN 'blocked'
    WHEN pp.kyc_status = 'pending' AND pp.signup_step < 5 THEN 'continue_signup'
    WHEN pp.kyc_status = 'in_review'                       THEN 'kyc_in_review'
    WHEN pp.kyc_status = 'rejected'                        THEN 'kyc_rejected'
    WHEN pp.kyc_status = 'blocked'                         THEN 'kyc_blocked'
    WHEN pp.kyc_status = 'approved' AND NOT (
         COALESCE((SELECT COUNT(*) > 0 FROM provider_categories pc WHERE pc.provider_id = pp.id), false)
         AND COALESCE((SELECT COUNT(*) > 0 FROM provider_availability_windows w WHERE w.provider_id = pp.id), false)
         AND COALESCE((SELECT COUNT(*) > 0 FROM provider_bank_accounts b
                       WHERE b.provider_id = pp.id AND b.status = 'verified' AND b.is_active = true), false)
       )                                                    THEN 'first_steps'
    WHEN pp.kyc_status = 'approved'                         THEN 'home'
    ELSE 'continue_signup'
  END AS route_target
FROM provider_profiles pp;

GRANT SELECT ON provider_onboarding_state TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não mudar contrato (lista de campos, valores de `route_target`) — UI T-018/T-031 depende
- ❌ Não inverter lógica do `is_active` — apenas conta ativa+verificada conta como sinal
- ❌ Não materializar — view simples com EXISTS é leve (cada subquery é index-scan)
- ❌ Não usar `JOIN` lateral — subqueries `EXISTS` correlacionadas são mais legíveis aqui

## Convenções
- `CREATE OR REPLACE VIEW` (não `DROP+CREATE`) para preservar grants e dependências
- Lista de campos idêntica à T-014 (substituição binária)
- Pré-requisitos hoje são 3 (categorias + disponibilidade + banco); se mudar, atualizar este SQL **e** T-018 payload + T-023 UI
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-028 [API] /api/profile/availability (GET + PUT default seed)
-- ----------------------------------------------------------------------------
('2abdc4f0-b5bb-474e-b622-e633c3663f50',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-028',
 'Implementar GET/PUT /api/profile/availability com seed default no primeiro acesso',
 $desc$## Objetivo
Endpoint que lê janelas de disponibilidade do prestador autenticado. Se não houver nenhuma linha, chama RPC `seed_default_availability` (T-025) e retorna as 7 janelas default 8h-18h. PUT recebe array de janelas e faz upsert em transação. Cobre AC #3 (sinal de "configurada" via seed) e AC #4 (edição vale imediatamente).

## Contexto
Módulo ONBOARDING — endpoint que UI rica de US-027 também consumirá. Aqui, o uso primário é: ao ler `provider_onboarding_state` no checklist (T-023/US-002), prestador clica em "Configurar disponibilidade" → frontend chama GET → seed acontece → `has_availability=true` na próxima leitura. UI rica de edição em grade vive em US-027.

## Estado atual / O que substitui
Não há endpoint. Frontend hoje só leria via PostgREST direto (não recomendado).

## O que criar

### `src/app/api/profile/availability/route.ts`
```ts
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Window = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time:  z.string().regex(/^\d{2}:\d{2}$/),
  end_time:    z.string().regex(/^\d{2}:\d{2}$/),
  enabled:     z.boolean().default(true),
});
const PutBody = z.object({ windows: z.array(Window).max(7) });

async function getProviderId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data: profile } = await supabase
    .from('provider_profiles')
    .select('id')
    .eq('user_id', user.user.id)
    .single();
  return profile?.id ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: existing } = await supabase
    .from('provider_availability_windows')
    .select('*')
    .eq('provider_id', providerId)
    .order('day_of_week');

  if (!existing || existing.length === 0) {
    // Seed default e retorna
    await supabase.rpc('seed_default_availability', { p_provider_id: providerId });
    const { data: seeded } = await supabase
      .from('provider_availability_windows')
      .select('*')
      .eq('provider_id', providerId)
      .order('day_of_week');
    return Response.json({ windows: seeded ?? [], seeded: true });
  }
  return Response.json({ windows: existing, seeded: false });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = PutBody.parse(await req.json());

  // Upsert: replace-all em transação via RPC seria ideal,
  // mas para MVP com no máximo 7 linhas, delete+insert é aceitável.
  // RLS garante que delete só toca linhas do próprio prestador.
  const { error: delErr } = await supabase
    .from('provider_availability_windows')
    .delete()
    .eq('provider_id', providerId);
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 });

  const rows = body.windows.map(w => ({ ...w, provider_id: providerId }));
  const { error: insErr } = await supabase
    .from('provider_availability_windows')
    .insert(rows);
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

  return Response.json({ ok: true, count: rows.length });
}
```

## Constraints / NÃO fazer
- ❌ Não chamar `seed_default_availability` em PUT — só em GET quando lista vazia (idempotência)
- ❌ Não permitir mais de 7 janelas (constraint UNIQUE no DB já bloqueia, Zod max=7 dá erro amigável)
- ❌ Não validar overlap de janelas (1 janela por dia = sem overlap possível); US-027 que adiciona múltiplas janelas/dia trata
- ❌ Não confiar que `auth.uid()` existe sem checar — sempre `getUser()` antes

## Convenções
- Idempotente: GET sem registros faz seed e retorna; chamar 2x não duplica (`ON CONFLICT DO NOTHING`)
- Replace-all em PUT é simples e correto pra ≤7 linhas; transação implícita do PostgREST aplica
- Latência target: GET <100ms; PUT <200ms (n=7 rows)
- Quando US-027 entrar: pode adicionar PATCH parcial pra editar 1 dia sem replace; por ora replace-all é suficiente
$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-029 [API] /api/profile/bank-account (POST cadastro + PATCH reenvio)
-- ----------------------------------------------------------------------------
('05c93219-134d-42b6-a420-770b5c80793d',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-029',
 'Implementar POST/PATCH/GET /api/profile/bank-account (cadastro + reenvio + leitura)',
 $desc$## Objetivo
Endpoints de CRUD para conta bancária do prestador. POST cria primeira conta (status=pending) e dispara validação (T-030). PATCH atualiza dados e reseta status pra pending (caso de reenvio após failure, AC #7). GET retorna conta ativa atual (com `status` e `failure_reason`). Cobre AC #5 (cadastro) e AC #7 (reenvio).

## Contexto
Módulo ONBOARDING — porta de cadastro/edição da conta. UI consome em T-032. Após persistir, **dispara T-030 sincronamente** (validação mock no MVP) ou enfileira pra Edge Function (futuro real). Idempotency-Key obrigatório no POST/PATCH para prevenir duplicação se UI reenviar.

## Estado atual / O que substitui
Não existe endpoint. Tabela criada em T-026.

## O que criar

### `src/app/api/profile/bank-account/route.ts`
```ts
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { validateBankAccount } from '@/lib/banking/validate'; // T-030

const Body = z.object({
  bank_code:       z.string().regex(/^\d{3}$/),
  branch:          z.string().regex(/^\d{1,6}$/),
  account_number:  z.string().regex(/^\d{1,20}$/),
  account_digit:   z.string().regex(/^\d{1,2}$/),
  holder_name:     z.string().min(3).max(120),
  holder_cpf:      z.string().regex(/^\d{11}$/),
  holder_type:     z.enum(['self', 'third_party']).default('self'),
});

async function getProviderId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data: profile } = await supabase
    .from('provider_profiles').select('id').eq('user_id', user.user.id).single();
  return profile?.id ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const { data } = await supabase
    .from('provider_bank_accounts')
    .select('id, bank_code, branch, account_number, account_digit, holder_name, holder_cpf, holder_type, status, failure_reason, verified_at')
    .eq('provider_id', providerId)
    .eq('is_active', true)
    .maybeSingle();

  return Response.json({ account: data });
}

export async function POST(req: Request) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = Body.parse(await req.json());

  // Insere com status=pending; trigger bloqueia mexer em status pelo prestador,
  // mas INSERT é permitido (pending é default).
  const { data: created, error } = await supabase
    .from('provider_bank_accounts')
    .insert({ ...body, provider_id: providerId })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return Response.json({ error: 'already_has_active_account' }, { status: 409 });
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Dispara validação síncrona (T-030 — mock no MVP)
  await validateBankAccount(created.id);

  return Response.json({ id: created.id, status: 'pending' });
}

// PATCH /api/profile/bank-account — reenvio após failure
export async function PATCH(req: Request) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const providerId = await getProviderId(supabase);
  if (!providerId) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = Body.parse(await req.json());

  // Pega conta ativa atual
  const { data: existing } = await supabase
    .from('provider_bank_accounts')
    .select('id, status').eq('provider_id', providerId).eq('is_active', true).single();
  if (!existing) return Response.json({ error: 'no_account' }, { status: 404 });
  if (existing.status === 'verified') {
    return Response.json({ error: 'verified_account_immutable' }, { status: 409 });
  }

  // Atualiza dados; reset de status é via service role na T-030 (re-validação)
  const { error } = await supabase
    .from('provider_bank_accounts')
    .update(body)
    .eq('id', existing.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Reset + revalidação (T-030 invoca service role)
  await validateBankAccount(existing.id, { reset: true });

  return Response.json({ id: existing.id, status: 'pending' });
}
```

## Constraints / NÃO fazer
- ❌ Não permitir múltiplas contas ativas (constraint UNIQUE retorna 23505 → mapear pra 409)
- ❌ Não permitir editar conta `verified` (AC #6 implícito: depois de verificada, mudança é via fluxo de suporte/admin — fora de US-003)
- ❌ Não disparar validação em background sem aguardar (UI precisa do status na resposta no MVP); quando integração real entrar, mudar pra fila + webhook
- ❌ Não logar dados completos de conta em logs (PII — só logar `id` + `status`)

## Convenções
- Idempotency-Key obrigatório (financeiro)
- Status retornado é sempre o pós-validação (mock síncrono, AC #6 imediato no MVP)
- Reenvio = PATCH (não DELETE+POST); preserva `id` para correlação futura com pagamentos
- Errors: 400 (validação Zod / missing idem-key), 401 (sem sessão), 404 (sem conta para PATCH), 409 (conflito de estado), 500 (downstream)
$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','RLS_REQUIRED','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-030 [API] Validação de conta bancária (mock síncrono MVP, hook pra real)
-- ----------------------------------------------------------------------------
('a9934833-03d0-4067-ab52-d8039605cc83',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-030',
 'Implementar validação de conta bancária com mock síncrono e hook para gateway real',
 $desc$## Objetivo
Função `validateBankAccount(accountId, opts?)` que: (a) valida CPF do titular (checksum), (b) valida formato bancário (banco existe na lista FEBRABAN, agência/conta em dígitos), (c) marca status como `verified` (mock OK) ou `failed` com `failure_reason` (mock falha controlada). Cobre AC #6 (auto-verificada) e AC #7 (motivo de falha legível).

## Contexto
Módulo ONBOARDING — atua como camada de validação. MVP é **mock determinístico** (sem chamar gateway real) para destravar US-003 sem dependência externa. Quando US-024 (NOTIFICACAO/integrações) ou setup de gateway entrar, esta task é a porta para plugar webhook real do parceiro de pagamentos. Persona SISTEMA — usa service role para escrever em colunas protegidas pela trigger da T-026.

## Estado atual / O que substitui
Não existe. T-029 chama esta função após INSERT/PATCH.

## O que criar

### `src/lib/banking/validate.ts`
```ts
import { createAdminClient } from '@/lib/supabase/admin';

const FEBRABAN_BANKS = new Set([
  '001', '033', '104', '237', '341', '356', '389', '422', '745',
  '077', '212', '260', '290', '336', '380', '623', '637', '655',
  // …expandir conforme necessário; lista canônica em /lib/banking/banks.ts
]);

function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split('').map(Number);
  for (const offset of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < offset; i++) sum += digits[i] * (offset + 1 - i);
    const expected = ((sum * 10) % 11) % 10;
    if (digits[offset] !== expected) return false;
  }
  return true;
}

type ValidateOpts = { reset?: boolean };

export async function validateBankAccount(accountId: string, opts: ValidateOpts = {}) {
  const admin = createAdminClient();

  // Em reset, primeiro volta status para pending limpando reason
  if (opts.reset) {
    await admin.from('provider_bank_accounts')
      .update({ status: 'pending', failure_reason: null, verified_at: null })
      .eq('id', accountId);
  }

  const { data: account } = await admin
    .from('provider_bank_accounts')
    .select('bank_code, holder_cpf, branch, account_number')
    .eq('id', accountId)
    .single();
  if (!account) return;

  const checks: Array<{ ok: boolean; reason: string }> = [
    { ok: FEBRABAN_BANKS.has(account.bank_code), reason: 'Banco não reconhecido. Verifique o código FEBRABAN.' },
    { ok: isValidCpf(account.holder_cpf), reason: 'CPF do titular inválido.' },
    { ok: account.branch.length >= 1 && account.branch.length <= 6, reason: 'Agência inválida.' },
    { ok: account.account_number.length >= 1, reason: 'Conta inválida.' },
  ];
  const failed = checks.find(c => !c.ok);

  if (failed) {
    await admin.from('provider_bank_accounts')
      .update({ status: 'failed', failure_reason: failed.reason })
      .eq('id', accountId);
    return { status: 'failed', reason: failed.reason };
  }

  await admin.from('provider_bank_accounts')
    .update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      external_ref: `mock:${accountId}`,
    })
    .eq('id', accountId);
  return { status: 'verified' };
}
```

### `src/lib/banking/banks.ts`
Lista canônica completa de códigos FEBRABAN (≈250 entradas). Pode vir de seed estático JSON.

## Constraints / NÃO fazer
- ❌ Não chamar gateway real ainda (sem credencial configurada; bloqueia desenvolvimento)
- ❌ Não logar dados completos da conta (PII — só `accountId` e `status` resultante)
- ❌ Não confiar no client pra dizer se é "verified" (sempre service role atualiza)
- ❌ Não retornar `failure_reason` raw vinda de gateway no futuro — sempre curar mensagens (lista finita, traduzida)

## Convenções
- Função idempotente — chamar 2x para mesma conta produz mesmo resultado (não duplica `external_ref`)
- Lista FEBRABAN em arquivo separado (`banks.ts`) pra fácil expansão
- Quando integração real entrar: trocar implementação interna mantendo assinatura `validateBankAccount(accountId, opts?)`
- Persona SISTEMA — usa `createAdminClient()` (service role); nunca expor pra client
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-031 [UI] Banner persistente "Complete seu cadastro"
-- ----------------------------------------------------------------------------
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-031',
 'Renderizar banner persistente "Complete seu cadastro" enquanto pré-requisitos pendentes',
 $desc$## Objetivo
Componente Server-Side `<OnboardingPendingBanner />` que aparece no topo da home operacional do prestador enquanto `route_target='first_steps'` na view T-027. Mostra contagem ("1 de 3 itens pendentes") e CTA "Ver checklist" → `/onboarding/first-steps`. Cobre AC #2.

## Contexto
Módulo ONBOARDING — UI complementar a T-023 (US-002, tela de checklist dedicada). T-023 é o destino do roteamento; este banner aparece **dentro** da home (que vive em US futura) sinalizando que ainda há pendências. AC #1 ("exibido uma única vez") é satisfeito porque a tela cheia (T-023) só é destino quando aprovado-com-pendência; depois da primeira interação o prestador pode navegar pra home e ver o banner.

## Estado atual / O que substitui
Não existe. Home operacional ainda não foi criada (vive em US futura — provavelmente US-027 com agenda); este componente é importável de qualquer página de prestador.

## O que criar

### `src/components/onboarding/OnboardingPendingBanner.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircleIcon } from 'lucide-react';
import Link from 'next/link';

export async function OnboardingPendingBanner() {
  const supabase = await createClient();
  const { data: state } = await supabase
    .from('provider_onboarding_state')
    .select('route_target, has_categories, has_availability, has_bank_account')
    .maybeSingle();

  if (!state || state.route_target !== 'first_steps') return null;

  const items = [state.has_categories, state.has_availability, state.has_bank_account];
  const done = items.filter(Boolean).length;
  const total = items.length;

  return (
    <Card className="flex items-center gap-3 border-amber-300 bg-amber-50/50 p-4 dark:bg-amber-950/20">
      <AlertCircleIcon className="size-5 shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="text-sm font-medium">Complete seu cadastro</p>
        <p className="text-xs text-muted-foreground">
          {done} de {total} {total === 1 ? 'item concluído' : 'itens concluídos'} — termine para começar a receber serviços
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href="/onboarding/first-steps">Ver checklist</Link>
      </Button>
    </Card>
  );
}
```

### Uso esperado
```tsx
// na home operacional (US futura — US-027 agenda ou similar)
<main>
  <OnboardingPendingBanner />
  {/* resto da home */}
</main>
```

## Constraints / NÃO fazer
- ❌ Componente Client (`'use client'`) — banner é Server Component; lê estado fresh no render
- ❌ Botão "fechar" / persistir dismiss — banner é **persistente** (AC #2: "vê banner persistente")
- ❌ Mostrar nomes técnicos dos itens — só contagem; detalhes vivem em `/onboarding/first-steps`
- ❌ Bloquear navegação ou modal — banner é informativo, não modal

## Convenções
- Reuso: `Card`, `Button`, `lucide-react`, `Link` (Next)
- Server Component (consume diretamente a view; não precisa client)
- Estilo "warning" amarelo (não vermelho — não é erro, é call-to-action)
- Mobile-first: largura total, ícone + texto + botão em row, wrap se necessário
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-032 [UI] Tela de cadastro de conta bancária
-- ----------------------------------------------------------------------------
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-032',
 'Renderizar tela de cadastro/edição de conta bancária com status e reenvio',
 $desc$## Objetivo
Tela `/profile/bank` que renderiza form de banco (banco/agência/conta/dígito + titularidade) e mostra `StatusChip` com status (pending/verified/failed) + `failure_reason` quando aplicável. POST inicial em criação; PATCH em reenvio após failure. Cobre AC #5 (cadastro), #6 (verificada visível), #7 (motivo + reenvio).

## Contexto
Módulo ONBOARDING — destino do CTA "Cadastrar conta bancária" do checklist (T-023). Mobile-first PWA. Form usa **Field compound API** com `Field.Row cols={2}` para agrupar agência/conta. Estado via `useState`. Erros via Sonner toast. Status pós-submit aparece inline (síncrono no MVP T-030).

## Estado atual / O que substitui
`src/app/(provider)/profile/bank/page.tsx` ainda não existe.

## O que criar

### `src/app/(provider)/profile/bank/page.tsx`
```tsx
import { BankAccountClient } from '@/components/onboarding/BankAccountClient';
import { createClient } from '@/lib/supabase/server';

export default async function BankAccountPage() {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from('provider_bank_accounts')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  return <BankAccountClient initial={account} />;
}
```

### `src/components/onboarding/BankAccountClient.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
import { toast } from 'sonner';
import { v4 as uuid } from 'uuid';

type Account = {
  id: string;
  bank_code: string; branch: string; account_number: string; account_digit: string;
  holder_name: string; holder_cpf: string; holder_type: 'self' | 'third_party';
  status: 'pending' | 'verified' | 'failed'; failure_reason: string | null;
};

export function BankAccountClient({ initial }: { initial: Account | null }) {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(initial);
  const [bankCode, setBankCode] = useState(initial?.bank_code ?? '');
  const [branch, setBranch] = useState(initial?.branch ?? '');
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? '');
  const [accountDigit, setAccountDigit] = useState(initial?.account_digit ?? '');
  const [holderName, setHolderName] = useState(initial?.holder_name ?? '');
  const [holderCpf, setHolderCpf] = useState(initial?.holder_cpf ?? '');
  const [holderType, setHolderType] = useState<'self'|'third_party'>(initial?.holder_type ?? 'self');
  const [busy, setBusy] = useState(false);

  const isVerified = account?.status === 'verified';
  const canEdit = !isVerified;

  async function submit() {
    setBusy(true);
    try {
      const method = account ? 'PATCH' : 'POST';
      const res = await fetch('/api/profile/bank-account', {
        method,
        headers: { 'content-type': 'application/json', 'idempotency-key': uuid() },
        body: JSON.stringify({
          bank_code: bankCode, branch, account_number: accountNumber, account_digit: accountDigit,
          holder_name: holderName, holder_cpf: holderCpf.replace(/\D/g, ''), holder_type: holderType,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error === 'verified_account_immutable'
          ? 'Conta já está verificada e não pode ser editada'
          : 'Não foi possível salvar. Verifique os dados.');
        return;
      }
      // Refetch para pegar status pós-validação síncrona
      const fresh = await fetch('/api/profile/bank-account').then(r => r.json());
      setAccount(fresh.account);
      if (fresh.account?.status === 'verified') {
        toast.success('Conta verificada!');
        router.refresh();
      } else if (fresh.account?.status === 'failed') {
        toast.error(fresh.account.failure_reason || 'Validação falhou. Corrija os dados e envie novamente.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Conta bancária</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Para receber pelos serviços executados.
        </p>
      </header>

      {account && (
        <Card className="flex items-center justify-between p-4">
          <span className="text-sm">Status</span>
          <StatusChip
            tone={account.status === 'verified' ? 'success' : account.status === 'failed' ? 'destructive' : 'warning'}
          >
            {account.status === 'verified' ? 'Verificada' :
             account.status === 'failed'   ? 'Falha'      : 'Em análise'}
          </StatusChip>
        </Card>
      )}

      {account?.status === 'failed' && account.failure_reason && (
        <Card className="border-destructive/50 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Motivo da falha</p>
          <p className="mt-1 text-sm">{account.failure_reason}</p>
        </Card>
      )}

      <FormBody density="comfortable">
        <Field name="bank_code" required>
          <Field.Label>Banco</Field.Label>
          <Field.Control>
            <Input inputMode="numeric" maxLength={3} value={bankCode}
              onChange={e => setBankCode(e.target.value.replace(/\D/g,''))}
              disabled={!canEdit} />
          </Field.Control>
          <Field.Hint>Código FEBRABAN (3 dígitos, ex: 341)</Field.Hint>
        </Field>

        <Field.Row cols={2}>
          <Field name="branch" required>
            <Field.Label>Agência</Field.Label>
            <Field.Control>
              <Input inputMode="numeric" value={branch}
                onChange={e => setBranch(e.target.value.replace(/\D/g,''))}
                disabled={!canEdit} />
            </Field.Control>
          </Field>
          <Field name="account_digit">
            <Field.Label>Dígito</Field.Label>
            <Field.Control>
              <Input inputMode="numeric" maxLength={2} value={accountDigit}
                onChange={e => setAccountDigit(e.target.value.replace(/\D/g,''))}
                disabled={!canEdit} />
            </Field.Control>
          </Field>
        </Field.Row>

        <Field name="account_number" required>
          <Field.Label>Conta</Field.Label>
          <Field.Control>
            <Input inputMode="numeric" value={accountNumber}
              onChange={e => setAccountNumber(e.target.value.replace(/\D/g,''))}
              disabled={!canEdit} />
          </Field.Control>
        </Field>

        <Field name="holder_type" required>
          <Field.Label>Titularidade</Field.Label>
          <Field.Control>
            <Select value={holderType} onChange={e => setHolderType(e.target.value as any)} disabled={!canEdit}>
              <option value="self">Própria</option>
              <option value="third_party">Terceiros</option>
            </Select>
          </Field.Control>
        </Field>

        <Field name="holder_name" required>
          <Field.Label>Nome do titular</Field.Label>
          <Field.Control>
            <Input value={holderName} onChange={e => setHolderName(e.target.value)} disabled={!canEdit} />
          </Field.Control>
        </Field>

        <Field name="holder_cpf" required>
          <Field.Label>CPF do titular</Field.Label>
          <Field.Control>
            <Input inputMode="numeric" maxLength={11} value={holderCpf}
              onChange={e => setHolderCpf(e.target.value.replace(/\D/g,''))}
              disabled={!canEdit} />
          </Field.Control>
        </Field>

        <Button onClick={submit} disabled={busy || !canEdit} className="w-full">
          {account?.status === 'failed' ? 'Reenviar' : isVerified ? 'Conta verificada' : 'Salvar e validar'}
        </Button>
      </FormBody>
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ `<input>` cru sem `Field` wrapper (regra)
- ❌ `react-hook-form` (regra); validação Zod no client (regra)
- ❌ Masked-input lib — usar `replace(/\D/g,'')` no onChange direto
- ❌ Permitir editar quando `status='verified'` (UX: campos disabled + botão disabled)
- ❌ `window.confirm` / `alert` — Sonner toast pra erro/sucesso

## Convenções
- Reuso: `Field/FormBody`, `Input`, `Select`, `Button`, `Card`, `StatusChip`, `Sonner`, `lucide-react`
- `idempotency-key` UUID v4 por submit (financeiro — regra)
- Server Component fetcher inicial + Client Component pra form (padrão Next 16)
- Mobile-first: layout single column, campos em `Field.Row` quando lógico (agência+dígito)
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-033 [UI] Confirmação "você já pode receber serviços"
-- ----------------------------------------------------------------------------
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '5cc5d89a-45d1-4800-81dc-6d4463801f6d',
 'ZLAR-V2-T-033',
 'Renderizar confirmação "você já pode receber serviços" ao completar pré-requisitos',
 $desc$## Objetivo
Mostrar confirmação visual explícita quando prestador completa o último item do checklist (transição `first_steps` → `home`). MVP: ResponsiveDialog que abre automaticamente quando T-018 retorna `route_target='home'` E flag de "primeira vez" (sem `welcomed_at` em provider_profiles, ou via cookie/localStorage). Cobre AC #9.

## Contexto
Módulo ONBOARDING — UI de celebração + onboarding to home. Disparado uma vez. Estratégia escolhida: **Server Component da home** detecta transição lendo `route_target='home'` + ausência de cookie `welcomed`. Após exibir, seta cookie. Sem coluna em DB (transição é cross-cutting; cookie é o lugar certo pra "vi o welcome").

## Estado atual / O que substitui
Não existe. T-012 da US-001 fez "tela de boas-vindas pós-aprovação de KYC", mas aquela é antes dos pré-requisitos. Esta é depois.

## O que criar

### `src/components/onboarding/ReadyToReceiveDialog.tsx`
```tsx
'use client';
import { useState, useEffect } from 'react';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2Icon } from 'lucide-react';

const COOKIE_KEY = 'zelar_provider_welcomed';

export function ReadyToReceiveDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (document.cookie.includes(`${COOKIE_KEY}=1`)) return;
    setOpen(true);
  }, []);

  function dismiss() {
    document.cookie = `${COOKIE_KEY}=1; path=/; max-age=31536000; SameSite=Lax`;
    setOpen(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }} size="md">
      <ResponsiveDialog.Header>
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2Icon className="size-12 text-emerald-600" />
          <h2 className="text-xl font-semibold">Você já pode receber serviços</h2>
        </div>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <p className="text-center text-sm text-muted-foreground">
          Seu cadastro está completo. A partir de agora você aparece nas propostas
          enviadas a prestadores da sua categoria.
        </p>
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button onClick={dismiss} className="w-full">Vamos lá</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
```

### Uso esperado
- A home operacional do prestador (US futura) inclui `<ReadyToReceiveDialog />` no topo do tree client
- Componente se mostra sozinho em primeira renderização sem cookie

## Constraints / NÃO fazer
- ❌ Não armazenar `welcomed_at` em DB — UX local; cookie é suficiente
- ❌ Não bloquear UI atrás do dialog (modal não-fullscreen)
- ❌ Mostrar duas vezes (cookie de 1 ano basta; reset manual via devtools se precisar testar)
- ❌ `window.alert` — `ResponsiveDialog` (regra do projeto)

## Convenções
- Reuso: `ResponsiveDialog`, `Button`, `lucide-react`
- Cookie httpOnly não é necessário (não-sensível); SameSite=Lax basta
- Mobile-first: ResponsiveDialog vira bottom-sheet em <768px (default)
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculos task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT v.task_id::uuid, ac.id
FROM (VALUES
  -- T-025 [DATA disponibilidade]: AC #3, #4, #8
  ('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 3),
  ('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 4),
  ('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 8),
  -- T-026 [DATA bank_accounts]: AC #5, #6, #7, #8
  ('31317d25-fae0-4da9-847e-90b3b2cfce98', 5),
  ('31317d25-fae0-4da9-847e-90b3b2cfce98', 6),
  ('31317d25-fae0-4da9-847e-90b3b2cfce98', 7),
  ('31317d25-fae0-4da9-847e-90b3b2cfce98', 8),
  -- T-027 [DATA view real signals]: AC #1, #2, #8 (sinal pra UI banner e regra de pool)
  ('577eaf09-23eb-4299-a215-c5ea9a04545b', 1),
  ('577eaf09-23eb-4299-a215-c5ea9a04545b', 2),
  ('577eaf09-23eb-4299-a215-c5ea9a04545b', 8),
  -- T-028 [API availability]: AC #3, #4
  ('2abdc4f0-b5bb-474e-b622-e633c3663f50', 3),
  ('2abdc4f0-b5bb-474e-b622-e633c3663f50', 4),
  -- T-029 [API bank crud]: AC #5, #7
  ('05c93219-134d-42b6-a420-770b5c80793d', 5),
  ('05c93219-134d-42b6-a420-770b5c80793d', 7),
  -- T-030 [API bank validate]: AC #6, #7
  ('a9934833-03d0-4067-ab52-d8039605cc83', 6),
  ('a9934833-03d0-4067-ab52-d8039605cc83', 7),
  -- T-031 [UI banner]: AC #2
  ('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 2),
  -- T-032 [UI bank form]: AC #5, #6, #7
  ('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 5),
  ('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 6),
  ('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 7),
  -- T-033 [UI ready dialog]: AC #9
  ('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 9)
) v(task_id, ac_order)
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = '5cc5d89a-45d1-4800-81dc-6d4463801f6d'
 AND ac."order" = v.ac_order;

-- AC #1 da US-003 (checklist exibido) é coberto pela UI T-023 da US-002 (cross-US)
INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT '1e26cc23-c12b-4b1d-a74b-afd52c1ac03f'::uuid, ac.id
FROM "AcceptanceCriterion" ac
WHERE ac."userStoryId" = '5cc5d89a-45d1-4800-81dc-6d4463801f6d'
  AND ac."order" = 1;

-- ============================================================================
-- 3. AcceptanceCriterion(taskId) — checklist técnico (AC-da-Task)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-025 [DATA provider_availability_windows]
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'Tabela provider_availability_windows criada com FK ON DELETE CASCADE para provider_profiles', 1),
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'CHECK end_time > start_time bloqueia janela inválida', 2),
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'UNIQUE (provider_id, day_of_week) impede 2 janelas no mesmo dia', 3),
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'RLS: prestador A não lê linhas de prestador B (smoke com 2 JWTs)', 4),
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'Função seed_default_availability cria 7 linhas 8h-18h idempotentemente', 5),
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'Trigger updatedAt funciona em UPDATE', 6),

-- T-026 [DATA provider_bank_accounts]
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'Enums bank_account_status (3 valores) e bank_account_holder (2 valores) criados', 1),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'CHECK holder_cpf formato 11 dígitos + branch dígitos rejeitam input inválido', 2),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'CHECK status=failed exige failure_reason NOT NULL', 3),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'UNIQUE INDEX parcial WHERE is_active garante 1 conta ativa por prestador', 4),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'RLS: prestador insere/edita só sua linha; UPDATE de status/verified_at/external_ref/failure_reason por prestador retorna ERRCODE 42501', 5),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'Service role consegue UPDATE em colunas protegidas sem erro', 6),
('31317d25-fae0-4da9-847e-90b3b2cfce98', 'Admin (claim app_metadata.role=admin) tem acesso total via policy admin_all', 7),

-- T-027 [DATA view real signals]
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'Migration CREATE OR REPLACE VIEW aplicada via psql; types regenerados', 0),
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'has_availability reflete EXISTS em provider_availability_windows do prestador', 1),
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'has_bank_account exige status=verified AND is_active=true', 2),
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'route_target=first_steps somente quando ao menos 1 dos 3 sinais é false', 3),
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'route_target=home quando os 3 sinais são true E kyc_status=approved E account_status=active', 4),
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'View herda RLS da tabela base (SECURITY INVOKER); prestador A não vê prestador B', 5),
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'Smoke: criar 1 prestador aprovado, configurar disponibilidade, conta verificada e categorias → route_target=home', 6),

-- T-028 [API /api/profile/availability]
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'GET sem janelas dispara seed_default_availability e retorna 7 linhas + seeded:true', 0),
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'GET com janelas existentes retorna lista atual + seeded:false', 1),
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'PUT valida body com Zod (windows[].day_of_week 0-6, time HH:MM)', 2),
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'PUT com >7 janelas retorna 400 (Zod max=7)', 3),
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'PUT em janela inválida (end<=start) retorna 500 ou 400 com mensagem da CHECK', 4),
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'PUT replace-all funciona dentro de RLS (DELETE + INSERT só toca linhas do próprio)', 5),
('2abdc4f0-b5bb-474e-b622-e633c3663f50', 'Sem sessão retorna 401 (em GET e PUT)', 6),

-- T-029 [API /api/profile/bank-account]
('05c93219-134d-42b6-a420-770b5c80793d', 'POST sem idempotency-key retorna 400', 0),
('05c93219-134d-42b6-a420-770b5c80793d', 'POST cria conta com status=pending e dispara validateBankAccount sincronamente', 1),
('05c93219-134d-42b6-a420-770b5c80793d', 'POST quando já existe conta ativa retorna 409 (constraint UNIQUE)', 2),
('05c93219-134d-42b6-a420-770b5c80793d', 'PATCH atualiza dados de conta failed e dispara revalidação (reset:true)', 3),
('05c93219-134d-42b6-a420-770b5c80793d', 'PATCH em conta verified retorna 409 verified_account_immutable', 4),
('05c93219-134d-42b6-a420-770b5c80793d', 'GET retorna conta ativa com status e failure_reason; null se nenhuma', 5),
('05c93219-134d-42b6-a420-770b5c80793d', 'Body validado com Zod (CPF 11 dígitos, banco 3 dígitos, etc)', 6),
('05c93219-134d-42b6-a420-770b5c80793d', 'Logs não vazam dados completos da conta (só id+status)', 7),

-- T-030 [API validateBankAccount]
('a9934833-03d0-4067-ab52-d8039605cc83', 'Função validateBankAccount(accountId, opts?) exportada de @/lib/banking/validate', 0),
('a9934833-03d0-4067-ab52-d8039605cc83', 'opts.reset=true zera status para pending e limpa failure_reason/verified_at antes de revalidar', 1),
('a9934833-03d0-4067-ab52-d8039605cc83', 'Banco fora da lista FEBRABAN retorna failed com reason "Banco não reconhecido"', 2),
('a9934833-03d0-4067-ab52-d8039605cc83', 'CPF inválido (checksum) retorna failed com reason "CPF do titular inválido"', 3),
('a9934833-03d0-4067-ab52-d8039605cc83', 'Dados válidos retornam status=verified com verified_at=NOW e external_ref=mock:<id>', 4),
('a9934833-03d0-4067-ab52-d8039605cc83', 'Função usa createAdminClient (service role) — atualiza colunas protegidas', 5),
('a9934833-03d0-4067-ab52-d8039605cc83', 'Lista FEBRABAN canônica em src/lib/banking/banks.ts (≥20 bancos comuns)', 6),
('a9934833-03d0-4067-ab52-d8039605cc83', 'Idempotente: chamar 2x para mesma conta produz mesmo resultado', 7),

-- T-031 [UI banner]
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'Componente OnboardingPendingBanner é Server Component (sem use client)', 0),
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'Não renderiza quando route_target ≠ first_steps (retorna null)', 1),
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'Mostra contagem "N de 3 itens concluídos" baseada em has_categories/availability/bank_account', 2),
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'Botão "Ver checklist" linka para /onboarding/first-steps', 3),
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'Estilo warning amarelo (não destructive); ícone AlertCircle', 4),
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', 'Reusa Card e Button do design system; mobile-first (largura total)', 5),

-- T-032 [UI bank form]
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Página /(provider)/profile/bank renderiza form em Field compound API', 0),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'StatusChip mostra Verificada/Falha/Em análise conforme status', 1),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Quando status=failed, Card destacado mostra failure_reason', 2),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Quando status=verified, todos os campos disabled e botão "Conta verificada" disabled', 3),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'POST inicial inclui idempotency-key UUID v4; PATCH em reenvio também', 4),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Erro 409 verified_account_immutable mostra toast específico', 5),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Sucesso de validação síncrona dispara router.refresh + toast "Conta verificada!"', 6),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Field.Row cols=2 agrupa agência+dígito; demais campos full width', 7),
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'Inputs numéricos limpam não-dígitos via replace(/\D/g,"") no onChange', 8),

-- T-033 [UI ready dialog]
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 'Componente ReadyToReceiveDialog é Client Component', 0),
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 'Abre automaticamente em mount quando cookie zelar_provider_welcomed não existe', 1),
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 'Botão "Vamos lá" e fechar dialog setam cookie max-age=1ano SameSite=Lax', 2),
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 'Não exibe novamente após dismiss (verificado refrescando página)', 3),
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 'Usa ResponsiveDialog (vira bottom-sheet em mobile <768px)', 4),
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', 'Texto "Você já pode receber serviços" + ícone CheckCircle verde', 5);

-- ============================================================================
-- 4. TaskDependency
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- Intra-US blocks
-- T-027 (view real) depende de T-025 e T-026 (precisa das tabelas existirem)
('577eaf09-23eb-4299-a215-c5ea9a04545b', '5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'blocks'),
('577eaf09-23eb-4299-a215-c5ea9a04545b', '31317d25-fae0-4da9-847e-90b3b2cfce98', 'blocks'),
-- T-028 (API availability) depende de T-025
('2abdc4f0-b5bb-474e-b622-e633c3663f50', '5b83f488-941f-4b9e-9ae6-54ff3b3abba6', 'blocks'),
-- T-029 (API bank crud) depende de T-026
('05c93219-134d-42b6-a420-770b5c80793d', '31317d25-fae0-4da9-847e-90b3b2cfce98', 'blocks'),
-- T-030 (API validate) depende de T-026
('a9934833-03d0-4067-ab52-d8039605cc83', '31317d25-fae0-4da9-847e-90b3b2cfce98', 'blocks'),
-- T-029 chama T-030 (relates_to: implementação acoplada mas ordens podem ir em paralelo)
('05c93219-134d-42b6-a420-770b5c80793d', 'a9934833-03d0-4067-ab52-d8039605cc83', 'relates_to'),
-- T-031 (banner) depende de T-027 (view real)
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', '577eaf09-23eb-4299-a215-c5ea9a04545b', 'blocks'),
-- T-032 (UI bank) depende de T-029
('2ba1d246-2f6d-46df-b1ca-e41d7c5be841', '05c93219-134d-42b6-a420-770b5c80793d', 'blocks'),
-- T-033 não depende de nada bloqueante; relates_to T-027 (sinal home)
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', '577eaf09-23eb-4299-a215-c5ea9a04545b', 'relates_to'),

-- Cross-US relates_to
-- T-025 (availability) é estendida pela US-027 (UI rica) — relates
('5b83f488-941f-4b9e-9ae6-54ff3b3abba6', '8f552252-9053-45fe-8ffb-a35be93627b8', 'relates_to'),
-- T-026 (bank) será fonte para US-028 (carteira)
-- (sem dep ainda — US-028 não tem tasks)
-- T-027 (view) substitui placeholder de T-014 (US-002)
('577eaf09-23eb-4299-a215-c5ea9a04545b', 'cdbd64ee-917f-46f3-9bab-98082c313c69', 'relates_to'),
-- T-031 (banner) é complementar a T-023 (US-002 first-steps full page)
('ffeb86b1-d77f-40f6-9e6d-2b713d1745d2', '1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'relates_to'),
-- T-033 (welcome dialog) é evolução de T-012 (US-001 boas-vindas pós-KYC)
('8d62fa9e-6beb-4bd3-ba3e-ae8295713041', '9194bc27-323c-431a-be4a-144653ddebef', 'relates_to');

COMMIT;
