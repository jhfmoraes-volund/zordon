-- ZLAR-V2 — Tasks de implementação da US-009
-- "Cadastrar-se, completar perfil e fazer login como cliente"
-- Persona: CLIENTE | Módulo: ONBOARDING | AC: 9 | Tasks: 14
--
-- Estratégia: espelha PRESTADOR (US-001/002) onde o schema diverge,
-- generaliza onde faz sentido (splash, magic link, captcha).

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
-- T-045 [DATA] tabela client_profiles
-- ----------------------------------------------------------------------------
('91d639dc-2242-49de-b489-3b38ac381b89',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-045',
 'Criar tabela client_profiles com RLS por user_id e signup_step',
 $desc$## Objetivo
Armazenar dados básicos do cliente (Lucas) — nome, telefone, email confirmado, signup_step (progresso do wizard) — separado de `provider_profiles`. CLIENTE não tem KYC nem categorias; tem `address_id` (FK pra endereço principal). Cobre AC #2, #3, #6, #7.

## Contexto
Módulo ONBOARDING — espelha `provider_profiles` (T-002) mas com schema **mais simples**. Consumida por T-049 (signup), T-050 (step), T-054 (route-state) e T-056 (wizard). Não compartilha tabela com PRESTADOR porque atributos divergem (KYC, categorias, contas bancárias só fazem sentido para PRESTADOR).

## Estado atual / O que substitui
Não existe. PRESTADOR tem `provider_profiles` (T-002 da US-001 ainda em draft).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_profiles.sql`
```sql
BEGIN;

CREATE TABLE client_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       text,
  phone           text,
  signup_step     smallint NOT NULL DEFAULT 0 CHECK (signup_step BETWEEN 0 AND 4),
  -- 0=criou conta, 1=email confirmado, 2=perfil preenchido, 3=endereço cadastrado, 4=consents OK (completo)
  primary_address_id uuid,  -- FK adicionada após T-046 criar client_addresses
  last_sign_in_at timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX ON client_profiles(signup_step) WHERE signup_step < 4;

ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;

-- Cliente lê o próprio
CREATE POLICY "client_read_own_profile" ON client_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Cliente atualiza o próprio (campos de domínio; signup_step só pode aumentar — trigger reforça)
CREATE POLICY "client_update_own_profile" ON client_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- INSERT só por service_role (signup endpoint usa service_role após criar auth.users)
-- (sem policy de INSERT pra anon/authenticated ⇒ negado)

-- Admin tudo
CREATE POLICY "admin_all_clients" ON client_profiles
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger: signup_step só aumenta
CREATE OR REPLACE FUNCTION client_profiles_step_only_increases()
RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.signup_step < OLD.signup_step THEN
    RAISE EXCEPTION 'signup_step_cannot_decrease' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER client_profiles_step_only_increases
  BEFORE UPDATE ON client_profiles
  FOR EACH ROW EXECUTE FUNCTION client_profiles_step_only_increases();

-- Updated_at trigger
CREATE TRIGGER client_profiles_updated_at
  BEFORE UPDATE ON client_profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não criar tabela única `user_profiles` com discriminator — confunde RLS, infla policies; tabelas separadas por persona é mais simples e seguro
- ❌ Não permitir UPDATE de `user_id` (FK pra auth.users) — esse vínculo é imutável após criação
- ❌ Não armazenar email aqui — vem de `auth.users.email`, single source of truth
- ❌ Não criar `address_id` como NOT NULL aqui — FK é adicionada depois que T-046 cria `client_addresses` (avoid circular dep)

## Convenções
- Tabela em snake_case; `"createdAt"`/`"updatedAt"` em camelCase com aspas (convenção projeto)
- `signup_step=4` significa wizard completo → route_target='home' na view
- INSERT só por service_role no endpoint de signup (T-049)
- Trigger SECURITY DEFINER pra acessar `auth.role()`/`auth.jwt()`
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-046 [DATA] tabela client_addresses
-- ----------------------------------------------------------------------------
('c63111bd-2964-4b5d-ad61-3d33778c65df',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-046',
 'Criar tabela client_addresses com endereço principal e RLS por cliente',
 $desc$## Objetivo
Armazenar 1+ endereços por cliente, com flag de principal. AC#3 exige autocomplete + salvamento pra preenchimento automático em solicitações futuras (US-011). Tabela pré-criada agora pra encerrar US-009; será reusada por toda US de solicitação. Cobre AC #3.

## Contexto
Módulo ONBOARDING — depende de T-045 (client_profiles). Será consumida por T-050 (PATCH endpoint), T-056 (UI), e mais tarde por US-011 (solicitação de serviço). Após criação, ALTER TABLE em `client_profiles` adiciona FK em `primary_address_id`.

## Estado atual / O que substitui
Não existe. PRESTADOR tem `provider_addresses`? — Não; PRESTADOR tem áreas de atendimento (US-007/US-027), conceito diferente.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_addresses.sql`
```sql
BEGIN;

CREATE TABLE client_addresses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  label           text,                  -- "casa", "trabalho", livre
  street          text NOT NULL,
  number          text,
  complement      text,
  neighborhood    text NOT NULL,
  city            text NOT NULL,
  state           char(2) NOT NULL,
  postal_code     text NOT NULL,
  -- Geolocalização (necessária pra matching futuro — US-021)
  latitude        numeric(10,7),
  longitude       numeric(10,7),
  -- Source tracking pra autocomplete
  source          text NOT NULL DEFAULT 'manual', -- 'manual' | 'autocomplete_google' | 'autocomplete_brasilapi'
  is_primary      boolean NOT NULL DEFAULT false,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

-- Garante 1 endereço principal por cliente
CREATE UNIQUE INDEX client_addresses_one_primary
  ON client_addresses(client_id) WHERE is_primary;

CREATE INDEX ON client_addresses(client_id);

-- FK do client_profiles.primary_address_id (após criar tabela)
ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_primary_address_fk
  FOREIGN KEY (primary_address_id) REFERENCES client_addresses(id)
  ON DELETE SET NULL;

ALTER TABLE client_addresses ENABLE ROW LEVEL SECURITY;

-- Cliente CRUD próprio
CREATE POLICY "client_addresses_own_select" ON client_addresses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM client_profiles cp WHERE cp.id = client_addresses.client_id AND cp.user_id = auth.uid())
  );

CREATE POLICY "client_addresses_own_insert" ON client_addresses
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM client_profiles cp WHERE cp.id = client_addresses.client_id AND cp.user_id = auth.uid())
  );

CREATE POLICY "client_addresses_own_update" ON client_addresses
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM client_profiles cp WHERE cp.id = client_addresses.client_id AND cp.user_id = auth.uid())
  );

CREATE POLICY "client_addresses_own_delete" ON client_addresses
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM client_profiles cp WHERE cp.id = client_addresses.client_id AND cp.user_id = auth.uid())
  );

CREATE POLICY "admin_all_addresses" ON client_addresses
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER client_addresses_updated_at
  BEFORE UPDATE ON client_addresses
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não armazenar geolocation hardcoded sem source — cada autocomplete provider devolve precisão diferente (BrasilAPI gratuito, Google Places pago); `source` documenta
- ❌ Não permitir mais de 1 endereço com `is_primary=true` — UNIQUE INDEX parcial garante
- ❌ Não usar `address_id` como FK em `client_profiles` antes desta tabela existir (ordem das migrations importa)
- ❌ Não armazenar PII como CEP em colunas indexáveis sem mascaramento se for sensitive — neste caso não é (CEP é dado público de geolocalização)

## Convenções
- `state` em CHAR(2) maiúscula (SP, RJ, MG)
- `postal_code` com hífen ou sem (frontend normaliza pra "01310-100" antes de salvar)
- Autocomplete pode usar BrasilAPI (free) como provider primário; Google Places como fallback
- Endereço deletável (não soft-delete) — solicitações antigas ficam com snapshot do endereço (em US-011)
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-047 [DATA] auth_failed_attempts (genérico ANY persona)
-- ----------------------------------------------------------------------------
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-047',
 'Criar tabela auth_failed_attempts e função should_require_captcha (genérico)',
 $desc$## Objetivo
Bloquear força bruta exigindo captcha após N tentativas falhas em janela curta. Endpoint de login (T-053 CLIENTE; T-015 PRESTADOR pode usar no futuro) consulta esta tabela antes de aceitar credenciais. Cobre AC #8.

## Contexto
Módulo ONBOARDING (mas reusável em qualquer endpoint de auth) — `personaScope='ANY'` porque a mesma lógica serve PRESTADOR e CLIENTE. Esta task é **generalização**: mais barato criar genérica agora do que duplicar.

## Estado atual / O que substitui
Não existe. T-015 (login PRESTADOR) tem "erro genérico" mas sem captcha.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_auth_failed_attempts.sql`
```sql
BEGIN;

CREATE TABLE auth_failed_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier      text NOT NULL,    -- email lowercase OU IP — depende do escopo
  identifier_kind text NOT NULL CHECK (identifier_kind IN ('email','ip')),
  ip              inet,
  user_agent      text,
  attempted_at    timestamptz NOT NULL DEFAULT NOW(),
  -- Mantemos só 24h de histórico (limpeza via pg_cron)
  expires_at      timestamptz NOT NULL DEFAULT (NOW() + interval '24 hours')
);

CREATE INDEX ON auth_failed_attempts(identifier, identifier_kind, attempted_at DESC);
CREATE INDEX ON auth_failed_attempts(expires_at) WHERE expires_at > NOW();

ALTER TABLE auth_failed_attempts ENABLE ROW LEVEL SECURITY;

-- Ninguém lê direto (só service_role via API)
-- Sem policy ⇒ RLS bloqueia anon/authenticated; service_role bypassa.

CREATE POLICY "admin_read_attempts" ON auth_failed_attempts
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Função pública: retorna se identificador deve exigir captcha
CREATE OR REPLACE FUNCTION should_require_captcha(
  p_identifier text,
  p_identifier_kind text,
  p_threshold smallint DEFAULT 5,
  p_window_minutes smallint DEFAULT 15
) RETURNS boolean AS $$
  SELECT COUNT(*) >= p_threshold
  FROM auth_failed_attempts
  WHERE identifier = lower(p_identifier)
    AND identifier_kind = p_identifier_kind
    AND attempted_at > NOW() - make_interval(mins => p_window_minutes);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Job de limpeza (idempotent)
-- Schedule via pg_cron: rodar toda hora
-- SELECT cron.schedule('cleanup-failed-attempts', '0 * * * *',
--   $$DELETE FROM auth_failed_attempts WHERE expires_at < NOW()$$);

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não armazenar a senha tentada — log de tentativa, não de credencial
- ❌ Não bloquear conta no DB — UI mostra captcha; bloquear no DB causaria DoS dirigido (atacante invalida login do alvo)
- ❌ Não usar SERIAL/identity — UUID é consistente com resto do schema
- ❌ Não conferir captcha no SQL (validar no endpoint contra Cloudflare Turnstile / hCaptcha)

## Convenções
- `identifier` em lowercase pra evitar bypass (email "ABC@x.com" vs "abc@x.com")
- 5 tentativas em 15min = threshold default; configurável por chamada
- `expires_at` permite cleanup automatic via pg_cron (não cresce sem limite)
- Provider de captcha: Cloudflare Turnstile (free, sem cookies)
$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','RATE_LIMIT'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-048 [DATA] view client_onboarding_state
-- ----------------------------------------------------------------------------
('86da9a44-1f14-4b15-b3e3-4ef21af98edb',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-048',
 'Criar view client_onboarding_state (resolução de roteamento pós-login)',
 $desc$## Objetivo
Concentrar em uma view a decisão de roteamento pós-login do CLIENTE: `signup_step`, `has_primary_address`, `consents_complete`. T-054 (route-state CLIENTE) lê uma única linha e decide. Cobre AC #6, #7.

## Contexto
Módulo ONBOARDING — **espelho de `provider_onboarding_state`** (T-014/T-037). Diferenças: CLIENTE não tem KYC, não tem account_status (até US-026 dispute → suspension cliente, não previsto MVP). Lógica mais simples.

## Estado atual / O que substitui
Não existe. PRESTADOR tem `provider_onboarding_state` (T-014).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_onboarding_state_view.sql`
```sql
BEGIN;

CREATE OR REPLACE VIEW client_onboarding_state AS
SELECT
  cp.user_id,
  cp.id AS client_id,
  cp.signup_step,
  cp.full_name,
  cp.phone,
  cp.primary_address_id,
  -- Pré-requisitos
  (cp.full_name IS NOT NULL AND cp.phone IS NOT NULL) AS profile_complete,
  (cp.primary_address_id IS NOT NULL) AS has_primary_address,
  -- Consents granulares (lgpd_consents é genérico — T-004)
  EXISTS (
    SELECT 1 FROM lgpd_consents lc
    WHERE lc.user_id = cp.user_id AND lc.kind = 'data_use' AND lc.granted = true
  ) AS consent_data_use,
  EXISTS (
    SELECT 1 FROM lgpd_consents lc
    WHERE lc.user_id = cp.user_id AND lc.kind = 'communication' AND lc.granted = true
  ) AS consent_communication,
  EXISTS (
    SELECT 1 FROM lgpd_consents lc
    WHERE lc.user_id = cp.user_id AND lc.kind = 'geolocation' AND lc.granted = true
  ) AS consent_geolocation,
  -- Decisão derivada
  CASE
    WHEN cp.signup_step < 2 THEN 'continue_signup_profile'
    WHEN cp.primary_address_id IS NULL THEN 'continue_signup_address'
    WHEN NOT EXISTS (
      SELECT 1 FROM lgpd_consents lc
      WHERE lc.user_id = cp.user_id AND lc.kind = 'data_use' AND lc.granted = true
    ) THEN 'continue_signup_consents'
    ELSE 'home'
  END AS route_target
FROM client_profiles cp;

GRANT SELECT ON client_onboarding_state TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não materializar (estado muda em cada login)
- ❌ Não duplicar lógica de consent — view consulta `lgpd_consents` (T-004), única fonte de verdade
- ❌ Não usar `SECURITY DEFINER` — view default `SECURITY INVOKER` herda RLS de `client_profiles` e `lgpd_consents` (cliente vê só os próprios)
- ❌ Não retornar `consent_data_use=NULL` quando não há registro — `EXISTS` retorna `false` corretamente

## Convenções
- View `OR REPLACE` permite evolução sem `DROP VIEW`
- Para consent obrigatório (`data_use`), `route_target` força fluxo de continuar; `geolocation` é opcional (cliente pode não dar)
- `database.types.ts` regenerado após
$desc$,
 'DATA', 'CLIENTE', ARRAY['NO_RLS_NEEDED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-049 [API] POST /api/onboarding/client/signup
-- ----------------------------------------------------------------------------
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-049',
 'Implementar POST /api/onboarding/client/signup (email/senha, Google, magic link, consent)',
 $desc$## Objetivo
Endpoint de cadastro do CLIENTE: cria `auth.users` (via Supabase Auth), `client_profiles` (signup_step=0), grava consents iniciais e dispara confirmação adequada por método (email/senha → email confirmation; magic link → email com link; Google → callback OAuth). Cobre AC #1, #2.

## Contexto
Módulo ONBOARDING — **espelha T-006 (PRESTADOR signup)** com 2 diferenças: (a) target é `client_profiles` em vez de `provider_profiles`; (b) suporta **magic link** explicitamente (AC#2 menciona). Magic link compartilha endpoint genérico T-051 — esta task **chama** T-051 internamente; não duplica.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/onboarding/client/signup/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.object({
  method: z.enum(['email_password','magic_link','google']),
  email: z.string().email(),
  password: z.string().min(10).optional(),  // só pra method='email_password'
  consents: z.object({
    data_use: z.literal(true),     // obrigatório aceitar pra criar conta
    communication: z.boolean(),
    geolocation: z.boolean(),
  }),
  terms_version: z.string(),       // ex: "v2026-05-09"
});

export async function POST(req: Request) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return NextResponse.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  if (body.method === 'email_password' && !body.password) {
    return NextResponse.json({ error: 'password_required' }, { status: 400 });
  }

  const admin = createAdminClient();
  // 1. Cria auth.users com app_metadata.role='client' (FK pra app_metadata em proxy.ts)
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.method === 'email_password' ? body.password : undefined,
    email_confirm: false,  // exige confirmação
    app_metadata: { role: 'client', access_level: 'authenticated' },
  });
  if (authErr) {
    if (authErr.message.includes('already registered')) {
      return NextResponse.json({ error: 'email_already_registered' }, { status: 409 });
    }
    return NextResponse.json({ error: 'auth_create_failed' }, { status: 500 });
  }

  const userId = authData.user!.id;

  // 2. Cria client_profile (signup_step=0)
  await admin.from('client_profiles').insert({ user_id: userId, signup_step: 0 });

  // 3. Grava consents (chamando lgpd_consents — T-004)
  const consentRows = [
    { user_id: userId, kind: 'data_use', granted: true, version: body.terms_version },
    { user_id: userId, kind: 'communication', granted: body.consents.communication, version: body.terms_version },
    { user_id: userId, kind: 'geolocation', granted: body.consents.geolocation, version: body.terms_version },
  ];
  await admin.from('lgpd_consents').insert(consentRows);

  // 4. Dispara confirmação por método
  if (body.method === 'magic_link') {
    // Chama internamente endpoint T-051 (ou função compartilhada)
    await admin.auth.admin.generateLink({ type: 'magiclink', email: body.email });
  } else if (body.method === 'email_password') {
    await admin.auth.admin.generateLink({ type: 'signup', email: body.email });
  }
  // method='google' → frontend redireciona pra OAuth flow após esta resposta

  return NextResponse.json({
    user_id: userId,
    next_action: body.method === 'google' ? 'oauth_redirect' : 'check_email',
  }, { status: 201 });
}
```

## Constraints / NÃO fazer
- ❌ Não armazenar a senha em coluna do `client_profiles` (Supabase Auth gerencia)
- ❌ Não setar `email_confirm: true` — precisa fluxo de confirmação real
- ❌ Não criar `client_profiles` se `auth.admin.createUser` falhar — não há `auth.users` órfão a vincular
- ❌ Não retornar 200 em `email_already_registered` (vaza existência) — 409 é OK aqui porque user TENTOU criar; em login (T-053) sim, erro genérico

## Convenções
- `Idempotency-Key` previne double-create (clique duplo)
- Consent `data_use` é obrigatoriamente `true` (z.literal) — sem aceitar não cria conta (LGPD)
- `app_metadata.role='client'` → JWT carrega; proxy lê e roteia
- `terms_version` em string semver/data permite re-pedir consent quando termos mudarem
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-050 [API] PATCH /api/onboarding/client/step
-- ----------------------------------------------------------------------------
('fd83e774-91b1-4493-8d95-dc8efd570ff5',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-050',
 'Implementar PATCH /api/onboarding/client/step (perfil + endereço + consents granulares)',
 $desc$## Objetivo
Endpoint que avança signup_step do cliente: salva perfil (full_name, phone), cria endereço primário (chama validação de CEP/autocomplete), atualiza consents granulares. Idempotente: re-chamar com mesmo step não regride. Cobre AC #3, #4.

## Contexto
Módulo ONBOARDING — **espelha T-007 (PRESTADOR step)**. Diferenças: salva em `client_addresses` (não em `provider_categories`), atualiza `lgpd_consents` granulares (3 kinds em vez de 1 LGPD agregado). Chamado pelo wizard T-056.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/onboarding/client/step/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const ProfileStep = z.object({
  step: z.literal('profile'),
  full_name: z.string().min(2).max(120),
  phone: z.string().regex(/^\+?\d{10,14}$/),
});

const AddressStep = z.object({
  step: z.literal('address'),
  address: z.object({
    label: z.string().optional(),
    street: z.string(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string(),
    city: z.string(),
    state: z.string().length(2),
    postal_code: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    source: z.enum(['manual','autocomplete_google','autocomplete_brasilapi']).default('manual'),
  }),
});

const ConsentStep = z.object({
  step: z.literal('consents'),
  consents: z.object({
    communication: z.boolean(),
    geolocation: z.boolean(),
  }),
  terms_version: z.string(),
});

const Body = z.discriminatedUnion('step', [ProfileStep, AddressStep, ConsentStep]);

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = Body.parse(await req.json());

  const { data: profile } = await supabase.from('client_profiles')
    .select('id, signup_step').eq('user_id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

  if (body.step === 'profile') {
    await supabase.from('client_profiles').update({
      full_name: body.full_name,
      phone: body.phone,
      signup_step: Math.max(profile.signup_step, 2),
    }).eq('id', profile.id);
  } else if (body.step === 'address') {
    // Cria endereço; marca como primary se for o primeiro
    const { data: existing } = await supabase.from('client_addresses')
      .select('id').eq('client_id', profile.id).limit(1);
    const { data: addr } = await supabase.from('client_addresses').insert({
      client_id: profile.id,
      ...body.address,
      is_primary: !existing || existing.length === 0,
    }).select('id').single();
    await supabase.from('client_profiles').update({
      primary_address_id: addr!.id,
      signup_step: Math.max(profile.signup_step, 3),
    }).eq('id', profile.id);
  } else if (body.step === 'consents') {
    // Atualiza consents granulares — lgpd_consents é insert-only (T-004), então insere novos rows
    await supabase.from('lgpd_consents').insert([
      { user_id: user.id, kind: 'communication', granted: body.consents.communication, version: body.terms_version },
      { user_id: user.id, kind: 'geolocation', granted: body.consents.geolocation, version: body.terms_version },
    ]);
    await supabase.from('client_profiles').update({
      signup_step: Math.max(profile.signup_step, 4),
    }).eq('id', profile.id);
  }

  return NextResponse.json({ ok: true });
}
```

## Constraints / NÃO fazer
- ❌ Não permitir `signup_step` regredir — `Math.max(current, target)` no UPDATE
- ❌ Não atualizar `lgpd_consents` existentes — tabela é insert-only (T-004); novo row representa novo consent
- ❌ Não validar CEP/endereço aqui via API externa síncrono — chamar BrasilAPI é OK mas deve ter timeout 2s e fallback (deixa frontend fazer autocomplete pré-submit)
- ❌ Não permitir múltiplos endereços primários (UNIQUE INDEX da T-046 garante)

## Convenções
- `discriminatedUnion` torna o endpoint extensível (próximas etapas adicionam novos schemas)
- RLS bloqueia atualização cross-user (cliente só atualiza próprio profile)
- `signup_step=4` = wizard completo → home no roteamento
$desc$,
 'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-051 [API] POST /api/auth/magic-link (genérico)
-- ----------------------------------------------------------------------------
('bb98242e-c431-46b9-af10-af9a75dff4fa',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-051',
 'Implementar POST /api/auth/magic-link genérico (envio + reenvio com rate limit)',
 $desc$## Objetivo
Endpoint genérico (não persona-specific) que dispara magic link via Supabase Auth pra qualquer usuário. Suporta primeiro envio, reenvio (rate-limited) e shouldRequireCaptcha (T-047). CLIENTE usa em signup (AC#2) e login (AC#5); PRESTADOR usa quando US-001/002 incorporar magic link futuramente. Cobre AC #2 e #5 desta US, e generaliza pra outras personas.

## Contexto
Módulo ONBOARDING — **task de generalização**: marcada como `relates_to T-015` (PRESTADOR login) pra que esta primitiva fique disponível pra qualquer persona. Não bloqueia US-001/002 retroativamente — o endpoint serve a quem chamar.

## Estado atual / O que substitui
Não existe. T-015 (PRESTADOR login) só faz email/senha; magic link nunca foi tratado.

## O que criar

### `src/app/api/auth/magic-link/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.object({
  email: z.string().email(),
  captcha_token: z.string().optional(),  // exigido se should_require_captcha
  redirect_to: z.string().url().optional(),  // ex: https://app/auth/callback
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown';
  const admin = createAdminClient();

  // 1. Verifica se precisa captcha (RPC do T-047)
  const { data: needCaptcha } = await admin.rpc('should_require_captcha', {
    p_identifier: body.email,
    p_identifier_kind: 'email',
  });
  if (needCaptcha) {
    if (!body.captcha_token) {
      return NextResponse.json({ error: 'captcha_required' }, { status: 428 });
    }
    // Valida captcha contra Cloudflare Turnstile
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY!,
        response: body.captcha_token,
      }),
    });
    const verify = await verifyRes.json();
    if (!verify.success) {
      return NextResponse.json({ error: 'captcha_invalid' }, { status: 403 });
    }
  }

  // 2. Dispara magic link via Supabase Auth
  const { error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: body.email,
    options: { redirectTo: body.redirect_to ?? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });

  // 3. Sempre retorna 200 (não vaza existência) — registra tentativa pra rate limit
  if (error) {
    await admin.from('auth_failed_attempts').insert({
      identifier: body.email.toLowerCase(),
      identifier_kind: 'email',
      ip,
    });
    // mas ainda retorna 200 pra não vazar
  }

  return NextResponse.json({ ok: true, message: 'check_email' });
}
```

## Constraints / NÃO fazer
- ❌ Não retornar erro distinto se email não existe (vaza existência) — sempre 200 + "check_email"
- ❌ Não usar `createClient()` (anon) — precisa service_role pra `auth.admin.generateLink`
- ❌ Não cachear este endpoint (ele tem efeito colateral: envia email)
- ❌ Não usar email pra rate limit sozinho — também trackear IP (DDoS targeting alvos)

## Convenções
- 428 (Precondition Required) é a HTTP code adequada pra "captcha needed"
- Provider de captcha: Cloudflare Turnstile (free, sem cookies, GDPR-friendly)
- `redirect_to` permite o frontend customizar pra onde Supabase redireciona após click no link
- Audit_log: gravar evento de envio pra investigação posterior
$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RATE_LIMIT','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-052 [API] OAuth Google CLIENTE
-- ----------------------------------------------------------------------------
('ec3b0c4a-83f7-4357-bae9-246196ee6310',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-052',
 'Implementar callback OAuth Google para login do cliente',
 $desc$## Objetivo
Callback de OAuth Google específico do CLIENTE. Recebe code do Google, troca por tokens via Supabase Auth, garante que `app_metadata.role='client'` (não 'provider'), cria `client_profiles` se for primeiro login OAuth. Cobre AC #2 (signup via Google) e #5 (login via Google).

## Contexto
Módulo ONBOARDING — **espelha T-016 (PRESTADOR Google callback)**. Diferenças: persona-tag em app_metadata, target é `client_profiles`. NÃO generaliza com T-016 porque o role inferred precisa vir da rota (provider/google vs client/google), e a UX do PRESTADOR exige KYC pós-OAuth — fluxo divergente.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/auth/client/google/callback/route.ts`
```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login?error=no_code', req.url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL('/login?error=oauth_failed', req.url));
  }

  const userId = data.user.id;
  const admin = createAdminClient();

  // Garante app_metadata.role='client' (cliente que logou pelo botão Google na splash CLIENTE)
  await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role: 'client', access_level: 'authenticated' },
  });

  // Cria client_profiles se não existe
  const { data: existing } = await admin.from('client_profiles')
    .select('id').eq('user_id', userId).maybeSingle();
  if (!existing) {
    await admin.from('client_profiles').insert({
      user_id: userId,
      full_name: data.user.user_metadata?.full_name,
      signup_step: 1,  // OAuth confirma email automaticamente
    });
  }

  return NextResponse.redirect(new URL('/onboarding/client/wizard', req.url));
}
```

## Constraints / NÃO fazer
- ❌ Não permitir conflito de role: se user já é PRESTADOR (Google login feito pelo splash provider antes), retornar erro claro — `app_metadata.role` único; tentar mudar quebra UX. Detalhe: validar antes do updateUserById se role já definido como diferente
- ❌ Não criar `client_profiles` se já existe — usa `maybeSingle()` + check, não duplica
- ❌ Não logar PII do user_metadata Google (nome ok; email já está em auth.users)
- ❌ Não compartilhar callback com PRESTADOR — rotas distintas garantem decisão de role

## Convenções
- Path: `/api/auth/client/google/callback` (espelha provider em `/api/auth/provider/google/callback`)
- Após sucesso: redirect pra `/onboarding/client/wizard` se signup_step<4, ou `/` (home) se completo (T-054 decide)
- Secrets: provedor Google OAuth client_id/secret configurados no Supabase Auth dashboard, não em env var nossa
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-053 [API] POST /api/auth/client/login (com captcha)
-- ----------------------------------------------------------------------------
('60eea5b9-170c-4d21-b9ea-34bc9193f68b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-053',
 'Implementar POST /api/auth/client/login (email/senha, erro genérico, captcha após N falhas)',
 $desc$## Objetivo
Endpoint de login email/senha do CLIENTE. Mensagem genérica em falha (não vaza existência). Após 5 falhas em 15min (T-047), exige captcha. Cobre AC #5, #8.

## Contexto
Módulo ONBOARDING — **espelha T-015 (PRESTADOR login)** com extensão de captcha. T-015 não bloqueia (era a v1 do AC#8 do PRESTADOR). Esta task **introduz padrão de captcha** que T-015 pode adotar via `relates_to`.

## Estado atual / O que substitui
Não existe. T-015 pra PRESTADOR tem mensagem genérica mas sem captcha.

## O que criar

### `src/app/api/auth/client/login/route.ts`
```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  captcha_token: z.string().optional(),
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';

  const admin = createAdminClient();

  // 1. Captcha?
  const { data: needCaptcha } = await admin.rpc('should_require_captcha', {
    p_identifier: body.email,
    p_identifier_kind: 'email',
  });
  if (needCaptcha) {
    if (!body.captcha_token) {
      return NextResponse.json({ error: 'captcha_required' }, { status: 428 });
    }
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY!,
        response: body.captcha_token,
      }),
    });
    const verify = await verifyRes.json();
    if (!verify.success) {
      return NextResponse.json({ error: 'captcha_invalid' }, { status: 403 });
    }
  }

  // 2. Tenta login
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error) {
    // Registra falha
    await admin.from('auth_failed_attempts').insert({
      identifier: body.email.toLowerCase(),
      identifier_kind: 'email',
      ip,
    });
    // Mensagem genérica (não vaza existência)
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // 3. Sucesso: limpa tentativas (cleanup oportunístico)
  await admin.from('auth_failed_attempts').delete()
    .eq('identifier', body.email.toLowerCase())
    .eq('identifier_kind', 'email');

  return NextResponse.json({ ok: true });
}
```

## Constraints / NÃO fazer
- ❌ Não retornar mensagem distinta entre "email não existe" e "senha errada" — sempre `invalid_credentials`
- ❌ Não bloquear conta no DB (denial of service dirigido); só captcha
- ❌ Não logar a senha tentada nem em log de erro
- ❌ Não reusar este endpoint pra PRESTADOR — rotas distintas. Generalização de captcha vive em T-047 (DATA + RPC)

## Convenções
- HTTP 401 pra credenciais inválidas; 428 (Precondition Required) pra captcha obrigatório
- Rate-limit middleware (US-022 não existe ainda) — flag RATE_LIMIT marca pra futuro
- Cleanup de tentativas é "best effort" (não bloqueia resposta)
- Pareia com T-051 (magic link) pra mesma proteção via captcha
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RATE_LIMIT'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-054 [API] GET /api/onboarding/client/route-state
-- ----------------------------------------------------------------------------
('767a37e2-ddba-4d90-9564-40416704b61a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-054',
 'Implementar GET /api/onboarding/client/route-state (resolver pós-login)',
 $desc$## Objetivo
Endpoint que resolve para onde mandar o cliente após login: continua signup (perfil, endereço ou consents) ou home. Lê `client_onboarding_state` (T-048) e retorna o `route_target`. Cobre AC #6, #7.

## Contexto
Módulo ONBOARDING — **espelha T-018 (PRESTADOR route-state)**. Mesmo contrato de retorno (`{route_target, ...}`); o proxy.ts usa o `app_metadata.role` pra decidir qual endpoint chamar.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/onboarding/client/route-state/route.ts`
```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Confere persona via JWT
  if (user.app_metadata?.role !== 'client') {
    return NextResponse.json({ error: 'wrong_persona' }, { status: 403 });
  }

  const { data: state, error } = await supabase
    .from('client_onboarding_state')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error) {
    return NextResponse.json({ error: 'state_not_found' }, { status: 404 });
  }

  return NextResponse.json(state);
}
```

## Constraints / NÃO fazer
- ❌ Não cachear (resposta varia por sessão, sem benefício)
- ❌ Não retornar 200 com state vazio — 404 deixa frontend mostrar erro útil
- ❌ Não confiar em `pathname` pra inferir persona — `app_metadata.role` é a fonte
- ❌ Não bypassar RLS (sem `createAdminClient`); cliente vê só o próprio state

## Convenções
- Mesmo formato de resposta de T-018 (PRESTADOR) — frontend genérico pode tratar ambos
- Sem POST/PATCH (idempotente)
- Proxy.ts (T-019) usa este endpoint indireto via header injetado
$desc$,
 'API', 'CLIENTE', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-055 [UI] Extrair splash CLIENTE/PRESTADOR pra rota pública
-- ----------------------------------------------------------------------------
('885f8907-36ab-4f0a-8686-24684a49f295',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-055',
 'Extrair splash de seleção CLIENTE/PRESTADOR pra rota pública /(public)/splash',
 $desc$## Objetivo
A splash de seleção (AC#1: cliente clica "Sou cliente"; equivalente PRESTADOR) hoje vive **dentro** do wizard PRESTADOR (T-010). Generalizar: extrair pra rota pública `/(public)/splash`, com 2 botões (Sou cliente → /onboarding/client/signup; Sou prestador → /onboarding/provider/signup). Cobre AC #1.

## Contexto
Módulo ONBOARDING — **task de generalização**: oportunidade detectada ao gerar US-009. Hoje T-010 inclui splash dentro do bundle do wizard PRESTADOR; isso force a navegação (cliente nunca vai pra `/onboarding/provider`). Marca T-010 como `relates_to` (refactor). Necessário antes do wizard CLIENTE (T-056) entrar.

## Estado atual / O que substitui
T-010 (PRESTADOR wizard) inclui a splash. Esta task **extrai** o componente da splash pra rota separada e simplifica T-010 (que vira só o wizard).

## O que criar

### `src/app/(public)/splash/page.tsx`
```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SplashSelector } from '@/components/onboarding/splash-selector';

export default async function SplashPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Se autenticado, redireciona pelo role
  if (user) {
    const role = user.app_metadata?.role;
    if (role === 'client') redirect('/');
    if (role === 'provider') redirect('/');
    redirect('/login');  // sem role definido
  }
  return <SplashSelector />;
}
```

### `src/components/onboarding/splash-selector.tsx`
```tsx
'use client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from 'next/link';

export function SplashSelector() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
      <h1 className="text-3xl font-semibold text-center">Bem-vindo ao Zelar</h1>
      <p className="text-center text-muted-foreground mt-2">Como você quer entrar?</p>
      <div className="grid gap-4 mt-8">
        <Card className="p-6">
          <h2 className="text-xl font-semibold">Sou cliente</h2>
          <p className="text-sm text-muted-foreground mt-1">Quero contratar serviços</p>
          <Button asChild className="w-full mt-4"><Link href="/onboarding/client/signup">Continuar</Link></Button>
        </Card>
        <Card className="p-6">
          <h2 className="text-xl font-semibold">Sou prestador</h2>
          <p className="text-sm text-muted-foreground mt-1">Quero oferecer serviços</p>
          <Button asChild variant="secondary" className="w-full mt-4"><Link href="/onboarding/provider/signup">Continuar</Link></Button>
        </Card>
        <p className="text-center text-sm mt-4">
          Já tem conta? <Link href="/login" className="font-medium underline">Entrar</Link>
        </p>
      </div>
    </main>
  );
}
```

### Refactor de T-010
- Remover splash do wizard PRESTADOR
- Wizard PRESTADOR começa direto em `/onboarding/provider/signup`
- T-010 vira só "Renderizar wizard multi-step de cadastro do prestador" (não mais "splash + wizard")

## Reuso
- `Button`, `Card` (design system)
- `Link` do Next

## Constraints / NÃO fazer
- ❌ Não permitir splash a usuário autenticado (redirect)
- ❌ Não duplicar splash dentro de cada wizard — DRY e UX consistente
- ❌ Não usar `Dialog`/`Sheet` aqui — tela inteira, estática
- ❌ Não fazer fetch no cliente — checagem de session é server-side

## Convenções
- Rota agrupada `(public)` indica acessível sem auth (proxy.ts já permite path inicial)
- Responsivo mobile-first (PWA), tap targets ≥44px
- Ao final, atualizar T-010 description pra remover menção a splash
$desc$,
 'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'refactor',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-056 [UI] Wizard de cadastro CLIENTE
-- ----------------------------------------------------------------------------
('71513037-5460-4d15-989c-3f057a5c3fca',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-056',
 'Renderizar wizard de cadastro CLIENTE (signup, perfil, endereço, consents)',
 $desc$## Objetivo
Wizard multi-step do CLIENTE: tela 1 (signup com email/senha, magic link, Google), tela 2 (perfil: nome + telefone), tela 3 (endereço com autocomplete), tela 4 (consents granulares). Cada step chama T-049/T-050. Cobre AC #2, #3, #4.

## Contexto
Módulo ONBOARDING — **espelha T-010 (PRESTADOR wizard)** mas com 4 steps (em vez de 5+ KYC). Reusa pattern `Field` compound + `useOptimisticCollection` quando aplicável. Step de endereço usa autocomplete via BrasilAPI (chamada client-side com debounce).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(public)/onboarding/client/signup/page.tsx`
- Server Component inicial; troca pra Client Component após hidrate
- 4 steps: { signup → confirm-email → profile → address → consents → done }

### `src/app/(client)/onboarding/wizard/page.tsx`
- Acessada após confirmação de email (step 1.5+)
- Resume signup_step da T-054 (route-state) e mostra a tela certa

### `src/components/onboarding/client/wizard-stepper.tsx`
- `'use client'`
- Header: progresso (1/4, 2/4, …)
- Body: renderiza step atual via switch(state.step)
- Footer: botão "Próximo" desabilitado se invalid

### `src/components/onboarding/client/signup-step.tsx`
- 3 caminhos: tabs (email/senha) | (magic link) | (Google)
- Email/senha: `<Field name="email" required>` + `<Field name="password" required>` + `<Field name="consents.data_use" required>`
- Magic link: só email + checkbox consents.data_use
- Google: botão "Continuar com Google" → redirect pra `/api/auth/client/google/initiate`

### `src/components/onboarding/client/profile-step.tsx`
- `<Field name="full_name">` + `<Field name="phone">` (input type="tel")
- Submit chama PATCH T-050

### `src/components/onboarding/client/address-step.tsx`
- `<Field name="postal_code">` com debounce 500ms → fetch BrasilAPI `/cep/v2/{cep}` → preenche os outros campos automaticamente
- `<Field name="street">`, `<Field name="number">`, `<Field name="complement">`, `<Field name="neighborhood">`, `<Field name="city">`, `<Field name="state">`
- Submit chama PATCH T-050 com source='autocomplete_brasilapi' se autocomplete fez fill

### `src/components/onboarding/client/consents-step.tsx`
- 3 checkboxes:
  - "Aceito o uso dos meus dados conforme política" (obrigatório, pre-checked se já aceitou na criação)
  - "Quero receber comunicações" (opcional)
  - "Permito uso da geolocalização" (opcional)
- Submit chama PATCH T-050

## Reuso
- `Field` + `Input` + `Button` + `Card` + `Skeleton` (design system)
- `useOptimisticCollection` (não estritamente necessário aqui — wizard é stateful)
- `Sonner` (`showErrorToast`) — feedback
- Hook custom `useFieldDebounce` (existe em `src/hooks/`) pra autocomplete
- `useIsMobile` — variantes de layout

## Constraints / NÃO fazer
- ❌ Não usar `react-hook-form` — Field compound + useState
- ❌ Não validar Zod no client — só HTML5 attrs (required, minlength) + checagem leve antes de submit
- ❌ Não persistir state do wizard em localStorage — server (signup_step) é fonte de verdade
- ❌ Não chamar BrasilAPI sem debounce — proteja a API de terceiros (e o user de spam)

## Convenções
- Mobile-first; tap targets ≥44px
- Strings pt-BR direto, sem i18n
- Erros do backend (T-049/T-050) viram toasts via `showErrorToast`
- Após signup_step=4, redirect pra `/` (home cliente — T-058)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-057 [UI] Tela de login CLIENTE
-- ----------------------------------------------------------------------------
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-057',
 'Renderizar tela de login do cliente (email/senha, Google, magic link, esqueci senha, captcha)',
 $desc$## Objetivo
Tela de login do CLIENTE com 3 caminhos (email/senha, magic link, Google), recuperação de senha (reusa T-017 forgot-password), captcha condicional após N tentativas (T-053 retorna 428). Cobre AC #5, #8, #9.

## Contexto
Módulo ONBOARDING — **espelha T-020 (login PRESTADOR)** com extensão de magic link (T-051) e captcha. Reusa LogoutButton (T-024) presente no menu, mas o foco aqui é a tela de login. AC#9 (logout pelo menu) já está coberto por T-024 — esta task **garante** que o LogoutButton aparece no menu CLIENTE pós-login (configura no layout cliente).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(public)/login/page.tsx`
- Reaproveita a rota existente (T-020 PRESTADOR) e detecta intent via query string ou tabs
- OU separa em `/login/client` se for limpar — decisão: mantém `/login` único, com 2 tabs (Cliente / Prestador) — alinha com splash

### `src/components/auth/client-login.tsx`
- 3 tabs:
  - **Email/senha**: `<Field name="email">` + `<Field name="password">` + Captcha (renderizado se erro 428)
  - **Magic link**: `<Field name="email">` → POST T-051
  - **Google**: botão → redirect pra `/api/auth/client/google/initiate`
- Footer: "Esqueci minha senha" → POST T-017 (já genérico ANY)
- Erro 401 (`invalid_credentials`) → toast genérico "Email ou senha incorretos"
- Erro 428 (`captcha_required`) → renderiza Cloudflare Turnstile widget e re-submit

### `src/components/auth/turnstile-widget.tsx`
- Componente que renderiza Cloudflare Turnstile (script externo)
- `'use client'`
- Site key em `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- onSuccess(token) callback

### Layout cliente: garantir LogoutButton no menu
- `src/app/(client)/layout.tsx` — header com menu que inclui T-024 LogoutButton

## Reuso
- T-024 (LogoutButton) — direto, no header
- T-017 (forgot-password endpoint) — reuso direto
- T-020 (login PRESTADOR) — pattern visual; possivelmente compartilhar componente comum
- `Field` + `Input` + `Button` + `Card`
- `Sonner` (`showErrorToast`)
- `Tabs` (de `src/components/ui/`?) — verificar; se não existir, usar 2 botões/links pra alternar
- Cloudflare Turnstile (free, sem cookies)

## Constraints / NÃO fazer
- ❌ Não distinguir mensagem de erro entre "email não existe" e "senha errada" (vaza existência)
- ❌ Não submeter form sem captcha quando 428 retornado (espera token)
- ❌ Não cachear sessão em localStorage — cookies (Supabase Auth gerencia)
- ❌ Não permitir caminho de login direto pra rotas protegidas se persona errada (proxy.ts redireciona pra splash via T-041 ou similar)

## Convenções
- Mobile-first; campos com 44px+ height
- Captcha widget só monta após 428 (não polui UI normal)
- Endpoints chamados: POST T-053, POST T-051, GET /api/auth/client/google/initiate, POST T-017
- LogoutButton fica no menu pós-login (no layout cliente, não nesta tela)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-058 [UI] Home placeholder do CLIENTE
-- ----------------------------------------------------------------------------
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '31f0d92b-c9f2-4de8-8e1f-b82130e768dc',
 'ZLAR-V2-T-058',
 'Renderizar home placeholder do cliente após signup completo',
 $desc$## Objetivo
Tela inicial mínima do CLIENTE pós-login (com signup completo). Mostra saudação ("Olá, {nome}"), botão "Solicitar serviço" (placeholder até US-010/US-011), e menu de perfil com LogoutButton. Cobre AC #7.

## Contexto
Módulo ONBOARDING — esta tela **fecha o ciclo da US-009** (cadastro completo cai na home). Vai crescer em US-010 (catálogo), US-011 (solicitação) — aqui é placeholder mínimo pra que `route_target='home'` da T-048 tenha destino válido.

## Estado atual / O que substitui
Não existe `(client)/page.tsx`.

## O que criar

### `src/app/(client)/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('client_profiles').select('full_name').eq('user_id', user.id).single();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Olá, {profile?.full_name?.split(' ')[0] ?? 'cliente'}</h1>
      <p className="text-muted-foreground mt-2">O que você precisa hoje?</p>
      <Card className="p-6 mt-6">
        <h2 className="text-lg font-medium">Solicitar serviço</h2>
        <p className="text-sm text-muted-foreground">Em breve: catálogo de categorias e fluxo guiado.</p>
        <Button disabled className="mt-4">Em breve</Button>
      </Card>
    </main>
  );
}
```

### `src/app/(client)/layout.tsx`
- Header com nome do cliente + menu dropdown
- Menu inclui: "Meu perfil", "Endereços", "Sair" (LogoutButton de T-024)

## Reuso
- T-024 LogoutButton — direto, no menu do layout
- `Card`, `Button`
- `DropdownMenu` (design system)

## Constraints / NÃO fazer
- ❌ Não duplicar lógica de catálogo aqui (US-010 cuida)
- ❌ Não permitir acesso sem auth (redirect pra /login)
- ❌ Não permitir acesso de PRESTADOR (proxy.ts redireciona via app_metadata.role)

## Convenções
- Mobile-first; saudação com primeiro nome só
- Layout `(client)` agrupa toda área autenticada do cliente; PRESTADOR vive em `(provider)`
- Quando US-010 entrar, esta página vira o catálogo; o layout permanece
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- ============================================================================
-- 2. TaskAcceptanceCriterion
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-045 client_profiles cobre AC 2, 3, 6, 7
  ('91d639dc-2242-49de-b489-3b38ac381b89'::uuid, 2),
  ('91d639dc-2242-49de-b489-3b38ac381b89'::uuid, 3),
  ('91d639dc-2242-49de-b489-3b38ac381b89'::uuid, 6),
  ('91d639dc-2242-49de-b489-3b38ac381b89'::uuid, 7),
  -- T-046 client_addresses cobre AC 3
  ('c63111bd-2964-4b5d-ad61-3d33778c65df'::uuid, 3),
  -- T-047 auth_failed_attempts cobre AC 8
  ('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f'::uuid, 8),
  -- T-048 view cobre AC 6, 7
  ('86da9a44-1f14-4b15-b3e3-4ef21af98edb'::uuid, 6),
  ('86da9a44-1f14-4b15-b3e3-4ef21af98edb'::uuid, 7),
  -- T-049 signup cobre AC 1, 2
  ('ef0ef2f2-0823-49f1-80a7-cacd5debde4e'::uuid, 1),
  ('ef0ef2f2-0823-49f1-80a7-cacd5debde4e'::uuid, 2),
  -- T-050 step cobre AC 3, 4
  ('fd83e774-91b1-4493-8d95-dc8efd570ff5'::uuid, 3),
  ('fd83e774-91b1-4493-8d95-dc8efd570ff5'::uuid, 4),
  -- T-051 magic link cobre AC 2, 5
  ('bb98242e-c431-46b9-af10-af9a75dff4fa'::uuid, 2),
  ('bb98242e-c431-46b9-af10-af9a75dff4fa'::uuid, 5),
  -- T-052 OAuth Google cobre AC 2, 5
  ('ec3b0c4a-83f7-4357-bae9-246196ee6310'::uuid, 2),
  ('ec3b0c4a-83f7-4357-bae9-246196ee6310'::uuid, 5),
  -- T-053 login cobre AC 5, 8
  ('60eea5b9-170c-4d21-b9ea-34bc9193f68b'::uuid, 5),
  ('60eea5b9-170c-4d21-b9ea-34bc9193f68b'::uuid, 8),
  -- T-054 route-state cobre AC 6, 7
  ('767a37e2-ddba-4d90-9564-40416704b61a'::uuid, 6),
  ('767a37e2-ddba-4d90-9564-40416704b61a'::uuid, 7),
  -- T-055 splash cobre AC 1
  ('885f8907-36ab-4f0a-8686-24684a49f295'::uuid, 1),
  -- T-056 wizard cobre AC 2, 3, 4
  ('71513037-5460-4d15-989c-3f057a5c3fca'::uuid, 2),
  ('71513037-5460-4d15-989c-3f057a5c3fca'::uuid, 3),
  ('71513037-5460-4d15-989c-3f057a5c3fca'::uuid, 4),
  -- T-057 login UI cobre AC 5, 8, 9
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1'::uuid, 5),
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1'::uuid, 8),
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1'::uuid, 9),
  -- T-058 home cobre AC 7
  ('a3d9b48c-bc44-4df7-9018-0ed01e863c0f'::uuid, 7)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- ============================================================================
-- 3. AC-da-Task (checklist técnico)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-045
('91d639dc-2242-49de-b489-3b38ac381b89', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('91d639dc-2242-49de-b489-3b38ac381b89', 'Tabela client_profiles criada com user_id UNIQUE FK pra auth.users', 1),
('91d639dc-2242-49de-b489-3b38ac381b89', 'CHECK constraint signup_step BETWEEN 0 AND 4 ativo', 2),
('91d639dc-2242-49de-b489-3b38ac381b89', 'RLS: cliente lê e atualiza só o próprio (smoke com 2 sessions)', 3),
('91d639dc-2242-49de-b489-3b38ac381b89', 'Trigger client_profiles_step_only_increases bloqueia regressão de step', 4),
('91d639dc-2242-49de-b489-3b38ac381b89', 'Index parcial em signup_step WHERE <4 criado', 5),
('91d639dc-2242-49de-b489-3b38ac381b89', 'Trigger updatedAt funciona (smoke: UPDATE muda updatedAt)', 6),

-- T-046
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'Tabela client_addresses criada com client_id FK pra client_profiles', 1),
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'UNIQUE INDEX parcial garante 1 endereço primário por cliente', 2),
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'FK client_profiles.primary_address_id adicionada com ON DELETE SET NULL', 3),
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'RLS: CRUD próprio funciona; cliente A não vê endereços de cliente B (smoke)', 4),
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'Coluna source enum [manual, autocomplete_google, autocomplete_brasilapi] funciona', 5),
('c63111bd-2964-4b5d-ad61-3d33778c65df', 'Trigger updatedAt funciona', 6),

-- T-047
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'Tabela auth_failed_attempts criada com expires_at default NOW()+24h', 1),
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'Função should_require_captcha retorna true após 5 falhas em 15min (smoke test)', 2),
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'RPC é STABLE SECURITY DEFINER (chamável por authenticated/anon)', 3),
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'Indexes em (identifier, identifier_kind, attempted_at DESC) e expires_at criados', 4),
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'RLS: ninguém SELECT direto exceto admin; service_role bypassa', 5),
('8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'pg_cron schedule de cleanup criado (limpa expires_at < NOW())', 6),

-- T-048
('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'View client_onboarding_state criada com colunas (signup_step, profile_complete, has_primary_address, consent_*, route_target)', 1),
('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'route_target retorna continue_signup_profile / continue_signup_address / continue_signup_consents / home conforme estado (smoke com 4 cenários)', 2),
('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'View é SECURITY INVOKER; RLS herdada de client_profiles e lgpd_consents (cliente A não vê state de cliente B)', 3),
('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'GRANT SELECT TO authenticated', 4),

-- T-049
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Endpoint POST /api/onboarding/client/signup criado com Zod validando method, email, password (se aplicável), consents.data_use=true, terms_version', 0),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', '400 sem Idempotency-Key; 400 em payload inválido (data_use false → erro)', 1),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', '409 quando email já registrado (na primeira tentativa); 200 idempotente em retry com mesma key', 2),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Cria auth.users com app_metadata.role=client e access_level=authenticated', 3),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Cria client_profiles (signup_step=0) usando service_role', 4),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Insere 3 rows em lgpd_consents (data_use, communication, geolocation) com terms_version', 5),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Para method=email_password: gera link de signup via auth.admin.generateLink', 6),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Para method=magic_link: gera magic link via auth.admin.generateLink', 7),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Para method=google: retorna next_action=oauth_redirect (frontend gerencia)', 8),
('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'Audit_log row registra evento client_signup com method', 9),

-- T-050
('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'Endpoint PATCH /api/onboarding/client/step criado com discriminatedUnion Zod (profile/address/consents)', 0),
('fd83e774-91b1-4493-8d95-dc8efd570ff5', '401 sem auth; 404 se profile não existe', 1),
('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'Step profile valida full_name (2..120) e phone (regex internacional)', 2),
('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'Step address cria client_addresses (is_primary se primeiro) e atualiza primary_address_id', 3),
('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'Step consents adiciona rows novos em lgpd_consents (insert-only); não atualiza existentes', 4),
('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'signup_step usa Math.max para nunca regredir', 5),
('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'RLS bloqueia atualização cross-user (smoke test)', 6),

-- T-051
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Endpoint POST /api/auth/magic-link criado, retorna sempre 200 message=check_email (não vaza existência)', 0),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Após 5 falhas em 15min para o mesmo email, retorna 428 captcha_required', 1),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Verifica captcha_token contra Cloudflare Turnstile siteverify; 403 se inválido', 2),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Usa createAdminClient (service_role) pra chamar auth.admin.generateLink', 3),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Insere row em auth_failed_attempts em caso de erro do Supabase Auth', 4),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'redirect_to opcional usa NEXT_PUBLIC_APP_URL/auth/callback como default', 5),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Secret TURNSTILE_SECRET_KEY usado só server-side', 6),
('bb98242e-c431-46b9-af10-af9a75dff4fa', 'Audit_log row pra cada envio bem-sucedido (entity=auth, action=magic_link_sent)', 7),

-- T-052
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'Callback GET /api/auth/client/google/callback criado', 0),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'Sem code: redirect /login?error=no_code', 1),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'exchangeCodeForSession retorna user; falha redirect /login?error=oauth_failed', 2),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'updateUserById seta app_metadata.role=client e access_level=authenticated', 3),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'Cria client_profiles com full_name de user_metadata.full_name e signup_step=1 se não existe', 4),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'Não duplica client_profiles se já existe (maybeSingle + check)', 5),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'Conflito de role (user já PRESTADOR) retorna erro claro', 6),
('ec3b0c4a-83f7-4357-bae9-246196ee6310', 'Sucesso: redirect pra /onboarding/client/wizard', 7),

-- T-053
('60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'Endpoint POST /api/auth/client/login criado com Zod (email, password, captcha_token opcional)', 0),
('60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'Após 5 falhas em 15min: 428 captcha_required; com captcha válido permite tentar', 1),
('60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'Captcha inválido: 403 captcha_invalid', 2),
('60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'Credenciais erradas: 401 invalid_credentials (mensagem genérica) + insert auth_failed_attempts', 3),
('60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'Sucesso: 200 ok=true + DELETE auth_failed_attempts daquele email (cleanup)', 4),
('60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'Não loga senha em log de erro (smoke: forçar erro e revisar logs)', 5),

-- T-054
('767a37e2-ddba-4d90-9564-40416704b61a', 'Endpoint GET /api/onboarding/client/route-state criado', 0),
('767a37e2-ddba-4d90-9564-40416704b61a', '401 sem auth; 403 se app_metadata.role != client; 404 se state não existe', 1),
('767a37e2-ddba-4d90-9564-40416704b61a', 'Retorna {route_target, signup_step, profile_complete, has_primary_address, consent_*}', 2),
('767a37e2-ddba-4d90-9564-40416704b61a', 'Resposta consistente com T-018 PRESTADOR (frontend genérico funciona)', 3),
('767a37e2-ddba-4d90-9564-40416704b61a', 'RLS impede leitura de outro state via createClient (smoke)', 4),

-- T-055
('885f8907-36ab-4f0a-8686-24684a49f295', 'Rota /(public)/splash criada e renderiza SplashSelector', 0),
('885f8907-36ab-4f0a-8686-24684a49f295', 'Usuário autenticado é redirecionado pra / (não vê splash)', 1),
('885f8907-36ab-4f0a-8686-24684a49f295', 'Componente SplashSelector tem 2 cards (cliente, prestador) + link "Já tem conta? Entrar"', 2),
('885f8907-36ab-4f0a-8686-24684a49f295', 'T-010 (PRESTADOR wizard) refatorada: splash removida; wizard começa em /onboarding/provider/signup', 3),
('885f8907-36ab-4f0a-8686-24684a49f295', 'Reusa Card e Button do design system (sem componente novo)', 4),
('885f8907-36ab-4f0a-8686-24684a49f295', 'Layout mobile-first com tap targets ≥44px', 5),

-- T-056
('71513037-5460-4d15-989c-3f057a5c3fca', 'Rota /(public)/onboarding/client/signup criada (Server Component → Client após hidrate)', 0),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Stepper mostra progresso 1/4..4/4 e renderiza step certo via switch', 1),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Step signup tem 3 caminhos (email/senha, magic link, Google) e checkbox obrigatório data_use', 2),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Step profile valida full_name e phone via Field compound (sem react-hook-form)', 3),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Step address: postal_code dispara debounce 500ms + fetch BrasilAPI; preenche os outros campos', 4),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Step consents: 3 checkboxes (data_use pre-checked obrigatório, communication, geolocation)', 5),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Cada step submit chama T-049 ou T-050 conforme; erro mostra toast via showErrorToast', 6),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Após signup_step=4: redirect pra / (home)', 7),
('71513037-5460-4d15-989c-3f057a5c3fca', 'Mobile-first; tap targets ≥44px', 8),

-- T-057
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'Rota /login com tabs cliente/prestador funciona (ou tela cliente dedicada)', 0),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', '3 caminhos: email/senha, magic link, Google, com tabs alternáveis', 1),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'Erro 401 invalid_credentials → toast genérico "Email ou senha incorretos"', 2),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'Erro 428 captcha_required → renderiza Cloudflare Turnstile widget e re-submit', 3),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'Botão "Esqueci minha senha" chama T-017 (forgot-password)', 4),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'Layout (client) inclui LogoutButton (T-024) no menu de perfil pós-login', 5),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY env var configurada no Vercel/staging', 6),
('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'Mobile-first; tap targets ≥44px', 7),

-- T-058
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'Rota /(client)/page.tsx criada como Server Component', 0),
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'Sem auth: redirect /login; com auth mas role!=client: proxy redireciona', 1),
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'Mostra saudação com primeiro nome do client_profiles.full_name', 2),
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'Card placeholder "Solicitar serviço" com botão disabled', 3),
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'Layout (client) com header + DropdownMenu + LogoutButton (T-024)', 4),
('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', 'Mobile-first; tap targets ≥44px', 5)
;

-- ============================================================================
-- 4. TaskDependency
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- Intra-US (US-009)
  ('c63111bd-2964-4b5d-ad61-3d33778c65df', '91d639dc-2242-49de-b489-3b38ac381b89', 'blocks'),  -- T-046 ← T-045
  ('86da9a44-1f14-4b15-b3e3-4ef21af98edb', '91d639dc-2242-49de-b489-3b38ac381b89', 'blocks'),  -- T-048 ← T-045
  ('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'c63111bd-2964-4b5d-ad61-3d33778c65df', 'blocks'),  -- T-048 ← T-046
  ('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', '91d639dc-2242-49de-b489-3b38ac381b89', 'blocks'),  -- T-049 ← T-045
  ('fd83e774-91b1-4493-8d95-dc8efd570ff5', 'c63111bd-2964-4b5d-ad61-3d33778c65df', 'blocks'),  -- T-050 ← T-046
  ('fd83e774-91b1-4493-8d95-dc8efd570ff5', '91d639dc-2242-49de-b489-3b38ac381b89', 'blocks'),  -- T-050 ← T-045
  ('bb98242e-c431-46b9-af10-af9a75dff4fa', '8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'blocks'),  -- T-051 ← T-047
  ('60eea5b9-170c-4d21-b9ea-34bc9193f68b', '8be8ae95-39d2-42b7-a8ed-cdee5d8c7c8f', 'blocks'),  -- T-053 ← T-047
  ('ec3b0c4a-83f7-4357-bae9-246196ee6310', '91d639dc-2242-49de-b489-3b38ac381b89', 'blocks'),  -- T-052 ← T-045
  ('767a37e2-ddba-4d90-9564-40416704b61a', '86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'blocks'),  -- T-054 ← T-048
  ('71513037-5460-4d15-989c-3f057a5c3fca', 'ef0ef2f2-0823-49f1-80a7-cacd5debde4e', 'blocks'),  -- T-056 ← T-049
  ('71513037-5460-4d15-989c-3f057a5c3fca', 'fd83e774-91b1-4493-8d95-dc8efd570ff5', 'blocks'),  -- T-056 ← T-050
  ('71513037-5460-4d15-989c-3f057a5c3fca', '885f8907-36ab-4f0a-8686-24684a49f295', 'blocks'),  -- T-056 ← T-055 (splash existir)
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', '60eea5b9-170c-4d21-b9ea-34bc9193f68b', 'blocks'),  -- T-057 ← T-053
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'bb98242e-c431-46b9-af10-af9a75dff4fa', 'blocks'),  -- T-057 ← T-051
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', 'ec3b0c4a-83f7-4357-bae9-246196ee6310', 'blocks'),  -- T-057 ← T-052
  ('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', '767a37e2-ddba-4d90-9564-40416704b61a', 'blocks'),  -- T-058 ← T-054
  -- Cross-US (relates_to)
  ('885f8907-36ab-4f0a-8686-24684a49f295', '40739971-9477-4d49-b8e5-abffad23aeab', 'relates_to'),  -- T-055 (splash extract) → T-010 (PRESTADOR wizard)
  ('bb98242e-c431-46b9-af10-af9a75dff4fa', '0f80a696-4b3d-4b0f-ac55-64a664698032', 'relates_to'),  -- T-051 (magic link) → T-015 (PRESTADOR login pode adotar)
  ('60eea5b9-170c-4d21-b9ea-34bc9193f68b', '0f80a696-4b3d-4b0f-ac55-64a664698032', 'relates_to'),  -- T-053 (login client+captcha) → T-015
  ('86da9a44-1f14-4b15-b3e3-4ef21af98edb', 'cdbd64ee-917f-46f3-9bab-98082c313c69', 'relates_to'),  -- T-048 (view CLIENTE) → T-014 (view PRESTADOR — pattern)
  ('767a37e2-ddba-4d90-9564-40416704b61a', '138a5003-7960-4441-9b21-0a622e434486', 'relates_to'),  -- T-054 → T-018
  ('ef0ef2f2-0823-49f1-80a7-cacd5debde4e', '70977758-9edf-441c-ac94-5b0e9546b81a', 'relates_to'),  -- T-049 (signup CLIENT) → T-006 (signup PROVIDER pattern)
  ('ec3b0c4a-83f7-4357-bae9-246196ee6310', '6946625a-e1bb-43e8-81d0-6dd29418f639', 'relates_to'),  -- T-052 (Google CLIENT) → T-016 (Google PROVIDER)
  ('71513037-5460-4d15-989c-3f057a5c3fca', '40739971-9477-4d49-b8e5-abffad23aeab', 'relates_to'),  -- T-056 (wizard CLIENT) → T-010 (wizard PROVIDER pattern)
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', '268cd834-08e5-47c1-a0b2-37b09733e36c', 'relates_to'),  -- T-057 (login CLIENT) → T-020 (login PROVIDER)
  ('0b3b56d5-41be-4799-ad03-5e6d0636d7b1', '5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'relates_to'),  -- T-057 → T-024 (LogoutButton)
  ('a3d9b48c-bc44-4df7-9018-0ed01e863c0f', '5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'relates_to'),  -- T-058 → T-024 (LogoutButton)
  ('fd83e774-91b1-4493-8d95-dc8efd570ff5', '7156f5db-c7e1-402c-8ae7-cf3900154623', 'relates_to')   -- T-050 → T-004 (lgpd_consents)
;

COMMIT;
