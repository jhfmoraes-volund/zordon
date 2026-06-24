-- Tasks geradas para ZLAR-V2-US-001 (Cadastrar-se e ser aprovado como prestador)
-- DS Inception Zelar v2 — 2026-05-09
-- Padrão SDD: descrições com Objetivo/Contexto/Estado atual/O que criar/Constraints/Convenções
-- Checklist técnico de cada task vive como AcceptanceCriterion(taskId=...)
-- Mapeamento Task ↔ AC-da-Story via TaskAcceptanceCriterion
-- 12 tasks: 4 DATA + 4 API + 3 UI + 1 OPS

BEGIN;

-- =============================================================================
-- TASKS
-- =============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-001 [OPS]
('78ced729-7fd7-4c24-a1f5-9445533b8244',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-001',
 'Seedar catálogo de categorias e subcategorias de serviço',
$desc$## Objetivo
Popular o catálogo de categorias/subcategorias do MVP em tabelas dedicadas, lendo público para o cliente (US-010) e privado para vínculo do prestador (T-003) e engine de matching (US-020).

## Contexto
Módulo ONBOARDING — primeira migration que cria estrutura de domínio do Zelar v2. As 7 categorias-âncora vêm da DS Inception. Catálogo é lido por anônimo (cliente exploratório, US-010) e por authenticated (prestador no wizard, T-010). Admin edita em US-019 (fora do escopo aqui).

## Estado atual / O que substitui
Não existem tabelas de catálogo ainda. Criação do zero.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_seed_categories.sql`
```sql
BEGIN;

CREATE TABLE service_categories (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug  text UNIQUE NOT NULL,
  name  text NOT NULL,
  icon  text,
  "order" int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE service_subcategories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name        text NOT NULL,
  "order"     int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (category_id, slug)
);

CREATE INDEX ON service_subcategories(category_id);

ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_categories" ON service_categories FOR SELECT USING (active);
CREATE POLICY "anon_read_subcategories" ON service_subcategories FOR SELECT USING (active);

-- ALL para admin via claim app_metadata.role='admin'
CREATE POLICY "admin_all_categories" ON service_categories FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "admin_all_subcategories" ON service_subcategories FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Seed 7 categorias canônicas
INSERT INTO service_categories (slug, name, "order") VALUES
  ('limpeza',     'Limpeza',     1),
  ('reformas',    'Reformas',    2),
  ('eletrica',    'Elétrica',    3),
  ('hidraulica',  'Hidráulica',  4),
  ('jardinagem',  'Jardinagem',  5),
  ('mudancas',    'Mudanças',    6),
  ('beleza',      'Beleza',      7);

-- Subcategorias mínimas (lista final em produto)
COMMIT;
```

## Constraints / NÃO fazer
- Não criar UI de admin aqui (vive em US-019)
- Não vincular subcategorias a prestadores aqui (vive em T-003)
- Categoria/subcategoria de teste em produção: usar `active=false`

## Convenções
- Migration aplicada via `psql "$DIRECT_URL" -f <file>` (memory `feedback_role_helpers_postgres`)
- `database.types.ts` regenerado após aplicar
- Catálogo público → SELECT USING (active) — sem filtro por usuário$desc$,
 'OPS', 'ANY', ARRAY['NO_RLS_NEEDED','INDEX_REQUIRED'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-002 [DATA]
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-002',
 'Criar tabela provider_profiles com RLS por PRESTADOR e estado de KYC',
$desc$## Objetivo
Persistir o perfil do prestador, estado do funil de onboarding (`signup_step`) e estado do KYC (`kyc_status`, `kyc_attempts`), com RLS que permite ao próprio prestador ler/atualizar suas linhas mas restringe colunas críticas a service role.

## Contexto
Módulo ONBOARDING — tabela raiz do domínio do prestador. Lê de `auth.users`. É consumida por T-003 (categorias), T-005 (KYC histórico), T-006/T-007/T-008 (APIs do wizard), T-009 (trigger de aprovação) e por toda US do prestador (US-002 login, US-003 pré-requisitos, US-007 perfil, US-027 disponibilidade, US-028 carteira). Admin lê em US-017 (moderação).

## Estado atual / O que substitui
Não existe nenhuma tabela de perfil de prestador no schema atual.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_profiles.sql`
```sql
BEGIN;

CREATE TYPE provider_kyc_status AS ENUM (
  'pending', 'in_review', 'approved', 'rejected', 'blocked'
);

CREATE TABLE provider_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name          text,
  cpf                text UNIQUE,
  phone              text,
  signup_step        int NOT NULL DEFAULT 0,
  kyc_status         provider_kyc_status NOT NULL DEFAULT 'pending',
  kyc_attempts       int NOT NULL DEFAULT 0 CHECK (kyc_attempts BETWEEN 0 AND 3),
  kyc_blocked_reason text,
  approved_at        timestamptz,
  "createdAt"        timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX ON provider_profiles(user_id);
CREATE INDEX ON provider_profiles(kyc_status);

ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;

-- Prestador lê e atualiza só sua própria linha
CREATE POLICY "provider_select_own" ON provider_profiles FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "provider_update_own_safe" ON provider_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin tudo
CREATE POLICY "admin_all" ON provider_profiles FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger updated_at
CREATE TRIGGER provider_profiles_updated_at
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

> Mutações sensíveis (`kyc_status`, `kyc_attempts`, `approved_at`) são feitas com **service role** via API/webhook (T-008), nunca pelo cliente direto.

## Constraints / NÃO fazer
- Não permitir UPDATE de `kyc_status`/`kyc_attempts` pelo próprio prestador via RLS (deixar pra service role apenas)
- Não criar relação com endereços ou dados bancários aqui (vive em US-007/US-014)
- CPF guardado sem máscara (11 dígitos), validação de checksum no servidor (T-007)
- Não duplicar `email` aqui — vem de `auth.users`

## Convenções
- Migration via psql, types regenerados (memory `feedback_role_helpers_postgres`)
- Schema usa `"createdAt"`/`"updatedAt"` com aspas duplas (convenção do projeto, ver outras tabelas)
- Trigger `moddatetime` reutiliza extensão já habilitada$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-003 [DATA]
('8f552252-9053-45fe-8ffb-a35be93627b8',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-003',
 'Criar tabela provider_categories (M:N) com RLS por PRESTADOR',
$desc$## Objetivo
Vincular um prestador a uma ou mais categorias de serviço em que atua, em estrutura M:N performática, lastreando o passo "Categorias" do wizard (T-007/T-010) e a engine de matching (US-020).

## Contexto
Módulo ONBOARDING — depende de T-001 (catálogo) e T-002 (perfil do prestador). Será lida em massa por US-020 (matching) com service role; o próprio prestador edita via T-007. Cliente NÃO lê — categorias do prestador específico só aparecem indiretamente (matching já filtrou).

## Estado atual / O que substitui
Não existe tabela de vínculo prestador↔categoria.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_categories.sql`
```sql
BEGIN;

CREATE TABLE provider_categories (
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, category_id)
);

CREATE INDEX ON provider_categories(provider_id);
CREATE INDEX ON provider_categories(category_id);

ALTER TABLE provider_categories ENABLE ROW LEVEL SECURITY;

-- Prestador lê/edita só suas linhas
CREATE POLICY "provider_select_own" ON provider_categories FOR SELECT
  USING (provider_id IN (
    SELECT id FROM provider_profiles WHERE user_id = auth.uid()
  ));
CREATE POLICY "provider_insert_own" ON provider_categories FOR INSERT
  WITH CHECK (provider_id IN (
    SELECT id FROM provider_profiles WHERE user_id = auth.uid()
  ));
CREATE POLICY "provider_delete_own" ON provider_categories FOR DELETE
  USING (provider_id IN (
    SELECT id FROM provider_profiles WHERE user_id = auth.uid()
  ));

-- Admin lê tudo
CREATE POLICY "admin_select" ON provider_categories FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;
```

> Service role (matching, US-020) bypassa RLS automaticamente. Cliente sem policy = negado por default.

## Constraints / NÃO fazer
- Não armazenar peso/score por categoria aqui (matching calcula em US-020)
- Não permitir vínculo a categoria com `active=false` (validar no API T-007)
- Não criar policy de SELECT para CLIENTE — categorias do prestador são privadas

## Convenções
- PK composta `(provider_id, category_id)` evita duplicação
- ON DELETE CASCADE em provider_id (some o prestador, somem os vínculos)
- ON DELETE RESTRICT em category_id (categoria seedada não some sozinha)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-004 [DATA]
('7156f5db-c7e1-402c-8ae7-cf3900154623',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-004',
 'Criar tabela lgpd_consents (insert-only) para registro de aceites',
$desc$## Objetivo
Persistir registro **imutável** e auditável dos consentimentos LGPD (termos de uso, política de privacidade) aceitos por qualquer usuário, atendendo AC #11 desta US e equivalentes em US-009 (cliente) e US-014 (gestão de consentimentos).

## Contexto
Módulo ONBOARDING (mas reutilizada em outras personas) — usuário aceita ao cadastrar (US-001, US-009) ou quando uma nova versão do documento é publicada (US-014). Auditoria legal exige que o registro seja imutável e contenha `version_hash` do documento aceito.

## Estado atual / O que substitui
Não existe tabela de consentimentos.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_lgpd_consents.sql`
```sql
BEGIN;

CREATE TABLE lgpd_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_kind text NOT NULL CHECK (document_kind IN ('terms_of_use','privacy_policy','revocation')),
  version_hash  text NOT NULL,
  accepted_at   timestamptz NOT NULL DEFAULT NOW(),
  ip            text,
  user_agent    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ON lgpd_consents(user_id, document_kind);
CREATE INDEX ON lgpd_consents(version_hash);

ALTER TABLE lgpd_consents ENABLE ROW LEVEL SECURITY;

-- Owner lê e insere; nunca atualiza/deleta
CREATE POLICY "owner_select" ON lgpd_consents FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "owner_insert" ON lgpd_consents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admin lê tudo (auditoria legal); só service role muta para retenção
CREATE POLICY "admin_select" ON lgpd_consents FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Sem policy de UPDATE/DELETE → negados por default

COMMIT;
```

## Constraints / NÃO fazer
- Tabela é **insert-only** para owner — revogar = inserir nova linha com `document_kind='revocation'`
- Não armazenar conteúdo do documento aqui (apenas `version_hash`)
- Não derivar `user_id` do JWT no servidor sem comparar com payload — sempre validar `auth.uid() == body.user_id`

## Convenções
- `version_hash` = sha256(content) — gerado no build/seed dos documentos
- IP capturado server-side via `x-forwarded-for` (memory comum em route handlers Next 16)
- `metadata` jsonb pra extensibilidade sem migration$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-005 [DATA]
('aa13afc9-5e9f-461e-a30d-c7f6ca241316',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-005',
 'Criar tabela kyc_verifications (histórico) com RLS por PRESTADOR',
$desc$## Objetivo
Persistir cada tentativa de verificação de identidade do prestador (até 3), suas decisões (`auto`/`manual`), e o payload bruto do provedor (Unico) para auditoria, sustentando AC #6, #7, #8, #10.

## Contexto
Módulo ONBOARDING — depende de T-002. Mutada exclusivamente por service role: T-008 (POST /kyc inicia tentativa) e webhook Unico (T-008 atualiza decisão). Lida pelo prestador via T-011 (UI de status) e por admin em US-017 (revisão manual).

## Estado atual / O que substitui
Não existe histórico de KYC.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_kyc_verifications.sql`
```sql
BEGIN;

CREATE TYPE kyc_attempt_status AS ENUM ('pending','in_review','approved','rejected');
CREATE TYPE kyc_decision_kind AS ENUM ('auto','manual');

CREATE TABLE kyc_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  attempt_number      int NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  external_session_id text UNIQUE,
  status              kyc_attempt_status NOT NULL DEFAULT 'pending',
  decision_kind       kyc_decision_kind,
  decision_reason     text,
  provider_response   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, attempt_number)
);

CREATE INDEX ON kyc_verifications(provider_id);
CREATE INDEX ON kyc_verifications(provider_id, status);

ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;

-- Prestador lê suas tentativas
CREATE POLICY "provider_select_own" ON kyc_verifications FOR SELECT
  USING (provider_id IN (
    SELECT id FROM provider_profiles WHERE user_id = auth.uid()
  ));

-- Admin lê tudo (US-017)
CREATE POLICY "admin_all" ON kyc_verifications FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- INSERT/UPDATE só via service role (T-008) — sem policy

CREATE TRIGGER kyc_verifications_updated_at
  BEFORE UPDATE ON kyc_verifications
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- Não armazenar URLs de imagens aqui — Unico hospeda, guarde apenas `external_session_id`
- Não permitir INSERT/UPDATE pelo prestador via RLS (apenas service role)
- Não usar para re-verificação pós-aprovação — após `approved`, próxima verificação é em fluxo separado de US-007

## Convenções
- `provider_response` jsonb cru do Unico (PII/sensível — apenas admin)
- Trigger `moddatetime` para `updatedAt`
- `attempt_number` controlado pela API (próximo = `MAX(attempt_number)+1` sob lock)$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-006 [API]
('70977758-9edf-441c-ac94-5b0e9546b81a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-006',
 'Implementar POST /api/onboarding/provider/signup (email/senha, Google, consent)',
$desc$## Objetivo
Criar conta de prestador (email/senha ou OAuth Google) em transação atômica com inserção de `provider_profiles` (signup_step=1, kyc_status=pending) e dois registros em `lgpd_consents` (terms + privacy). Cobre AC #2 e parte de AC #11.

## Contexto
Módulo ONBOARDING — primeira chamada do wizard (T-010). Usa Supabase Auth admin para criar `auth.users`, depois insere as linhas de domínio com service role na **mesma transação**. Para Google: troca `id_token` via Supabase Auth. Confirmação de email é obrigatória para email/senha; Google já vem confirmado.

## Estado atual / O que substitui
Não há endpoint de cadastro de prestador hoje.

## O que criar

### `src/app/api/onboarding/provider/signup/route.ts`
```ts
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

const Body = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('email_password'),
    email: z.string().email(),
    password: z.string().min(8),
    accepted_terms: z.literal(true),
    terms_version_hash: z.string(),
    privacy_version_hash: z.string(),
  }),
  z.object({
    method: z.literal('google'),
    google_id_token: z.string(),
    accepted_terms: z.literal(true),
    terms_version_hash: z.string(),
    privacy_version_hash: z.string(),
  }),
]);

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = createAdminClient();

  // 1. Cria/recupera auth user
  const userId = body.method === 'email_password'
    ? await createOrFetchEmailUser(supabase, body)
    : await exchangeGoogleToken(supabase, body.google_id_token);

  // 2. Transação: provider_profile + 2 consents
  // (usar RPC `create_provider_with_consents(...)` para garantir atomicidade)
  const { data, error } = await supabase.rpc('create_provider_with_consents', {
    p_user_id: userId,
    p_terms_hash: body.terms_version_hash,
    p_privacy_hash: body.privacy_version_hash,
    p_ip: req.headers.get('x-forwarded-for') ?? null,
    p_user_agent: req.headers.get('user-agent') ?? null,
  });
  if (error) {
    if (error.code === 'PROVIDER_EXISTS') return Response.json({ error: 'already_registered' }, { status: 409 });
    throw error;
  }

  return Response.json({
    user_id: userId,
    signup_step: 1,
    requires_email_confirmation: body.method === 'email_password',
  });
}
```

### RPC `create_provider_with_consents`
- `LANGUAGE plpgsql`, `SECURITY DEFINER`, BEGIN/COMMIT
- Insere provider_profiles; se já existe, RAISE com `errcode='P0001'` mapeado para 409
- Insere 2 linhas em lgpd_consents (terms_of_use, privacy_policy)
- Retorna jsonb com `provider_id`

## Constraints / NÃO fazer
- Validação Zod **só no servidor** (regra projeto, ver `project_ui_patterns`)
- Nunca expor `service_role` em código com `'use client'`
- Não disparar email de "boas-vindas" aqui — só confirmação de email do Supabase Auth (notificação de aprovação vive em T-009/US-022)
- Não autorizar criação de provider_profile sem `accepted_terms=true` (literal Zod já bloqueia)

## Convenções
- Idempotente por email (mesma chamada em sequência não duplica)
- Erros padronizados: 400 (validação Zod), 409 (já registrado), 500 (downstream)
- IP via `x-forwarded-for`; user agent via header
- Memória: secrets `MERCADOPAGO`, `UNICO`, `SUPABASE_SERVICE_ROLE_KEY` (ver `02-quality-checklist.md` §B)$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','AUDIT_LOG','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-007 [API]
('80650191-0c7d-4e18-8962-7c8085655377',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-007',
 'Implementar PATCH /api/onboarding/provider/step (dados, categorias, progresso)',
$desc$## Objetivo
Persistir dados do wizard a cada etapa avançada (dados pessoais, categorias) e atualizar `signup_step` para resumir o cadastro de onde parou (AC #3, #4, #5).

## Contexto
Módulo ONBOARDING — chamado pela UI T-010 a cada submit de step. Discriminated union por step. Cada chamada é authenticated e o RLS garante que só edita o próprio profile.

## Estado atual / O que substitui
Não há endpoint de progresso de wizard.

## O que criar

### `src/app/api/onboarding/provider/step/route.ts`
```ts
import { z } from 'zod';

const cpf = z.string().regex(/^\d{11}$/).refine(isValidCpfChecksum);
const phone = z.string().regex(/^\+\d{10,15}$/);

const Body = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('personal_data'),
    full_name: z.string().min(3).max(120),
    cpf,
    phone,
  }),
  z.object({
    step: z.literal('categories'),
    category_ids: z.array(z.string().uuid()).min(1),
  }),
  z.object({ step: z.literal('review') }),
]);

export async function PATCH(req: Request) {
  const supabase = await createClient(); // server-side, herda JWT do caller
  const body = Body.parse(await req.json());

  const { data: profile } = await supabase
    .from('provider_profiles')
    .select('id, kyc_status, signup_step')
    .single();
  if (!profile) return Response.json({ error: 'profile_not_found' }, { status: 403 });
  if (profile.kyc_status === 'approved') return Response.json({ error: 'already_approved' }, { status: 409 });

  if (body.step === 'personal_data') {
    await supabase.from('provider_profiles')
      .update({ full_name: body.full_name, cpf: body.cpf, phone: body.phone, signup_step: Math.max(profile.signup_step, 2) })
      .eq('id', profile.id);
  }
  if (body.step === 'categories') {
    // diff INSERT/DELETE em provider_categories
    const { data: existing } = await supabase.from('provider_categories').select('category_id').eq('provider_id', profile.id);
    const toAdd = body.category_ids.filter(id => !existing?.some(e => e.category_id === id));
    const toRemove = existing?.filter(e => !body.category_ids.includes(e.category_id)).map(e => e.category_id) ?? [];
    if (toAdd.length) await supabase.from('provider_categories').insert(toAdd.map(category_id => ({ provider_id: profile.id, category_id })));
    if (toRemove.length) await supabase.from('provider_categories').delete().eq('provider_id', profile.id).in('category_id', toRemove);
    await supabase.from('provider_profiles').update({ signup_step: Math.max(profile.signup_step, 3) }).eq('id', profile.id);
  }
  if (body.step === 'review') {
    await supabase.from('provider_profiles').update({ signup_step: Math.max(profile.signup_step, 4) }).eq('id', profile.id);
  }

  return Response.json({ ok: true });
}
```

## Constraints / NÃO fazer
- Validação Zod só no servidor
- Não usar service role aqui — RLS do prestador resolve
- `signup_step` nunca regride (`Math.max`)
- Não validar categoria por nome — só por uuid
- Não permitir editar dados se `kyc_status = 'approved'`

## Convenções
- Discriminated union no Zod por `step`
- CPF sem máscara (11 dígitos numéricos), validação de checksum em utility (não criar lib externa, função pequena inline)
- Phone E.164 (`+55…`)
- Diff de categorias evita reinserções desnecessárias$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-008 [API]
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-008',
 'Integrar Unico KYC: iniciar sessão + webhook de resultado',
$desc$## Objetivo
Disparar uma sessão de verificação Unico, receber o resultado via webhook assinado, atualizar `kyc_verifications` + `provider_profiles` em transação, aplicar a regra de **3 tentativas** com bloqueio definitivo na 3ª falha (AC #6, #7, #8, #10).

## Contexto
Módulo ONBOARDING — depende de T-002 e T-005. Único ponto que muta `kyc_status`/`kyc_attempts` em `provider_profiles` (sempre service role). Webhook é chamado por servidor externo (Unico) — exige verificação de assinatura.

## Estado atual / O que substitui
Não há integração com KYC. Lib do Unico ainda não está em `package.json` — adicionar e justificar.

## O que criar

### `src/app/api/onboarding/provider/kyc/route.ts` (POST)
```ts
import { z } from 'zod';

export async function POST(req: Request) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('provider_profiles')
    .select('id, kyc_status, kyc_attempts')
    .single();
  if (!profile) return Response.json({ error: 'no_profile' }, { status: 403 });
  if (['approved','in_review','blocked'].includes(profile.kyc_status))
    return Response.json({ error: 'invalid_state', state: profile.kyc_status }, { status: 409 });
  if (profile.kyc_attempts >= 3)
    return Response.json({ error: 'max_attempts_reached' }, { status: 403 });

  const admin = createAdminClient();
  const session = await unicoCreateSession({ providerId: profile.id });
  const next = profile.kyc_attempts + 1;
  await admin.from('kyc_verifications').insert({
    provider_id: profile.id,
    attempt_number: next,
    external_session_id: session.id,
    status: 'pending',
  });
  await admin.from('provider_profiles')
    .update({ kyc_status: 'in_review' })
    .eq('id', profile.id);

  return Response.json({ session_url: session.url, attempt_number: next });
}
```

### `src/app/api/webhooks/unico/route.ts` (POST)
```ts
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('x-unico-signature');
  if (!verifyUnicoSignature(raw, sig, process.env.UNICO_WEBHOOK_SECRET!))
    return Response.json({ error: 'bad_signature' }, { status: 401 });

  const event = JSON.parse(raw);
  const admin = createAdminClient();

  // Idempotência por external_session_id
  const { data: existing } = await admin.from('kyc_verifications')
    .select('id, provider_id, status')
    .eq('external_session_id', event.session_id)
    .single();
  if (!existing) return Response.json({ error: 'unknown_session' }, { status: 404 });
  if (existing.status !== 'pending') return Response.json({ ok: true, already: existing.status });

  // RPC apply_kyc_decision aplica em transação:
  // - update kyc_verifications: status, decision_kind, decision_reason, provider_response
  // - update provider_profiles: kyc_status + (kyc_attempts++ se rejected) + blocked se attempts==3
  await admin.rpc('apply_kyc_decision', {
    p_session_id: event.session_id,
    p_decision: event.decision,            // 'approved' | 'rejected' | 'in_review'
    p_decision_kind: event.kind,           // 'auto' | 'manual'
    p_reason: event.reason ?? null,
    p_response: event,
  });

  return Response.json({ ok: true });
}
```

### RPC `apply_kyc_decision`
- `SECURITY DEFINER`, `LANGUAGE plpgsql`
- Atualiza row de `kyc_verifications`
- Lê `provider_profiles.kyc_attempts` atual
- Caso `approved`: kyc_status='approved', approved_at=NOW()
- Caso `rejected`: incrementa kyc_attempts; se virou 3 → kyc_status='blocked' + kyc_blocked_reason; senão kyc_status='rejected'
- Caso `in_review`: kyc_status='in_review' (sem incremento)

## Constraints / NÃO fazer
- **NUNCA** processar webhook sem verificar assinatura
- Não confiar em `event.session_id` para autorização (usa só pra match)
- Não chamar service role do client side
- Não duplicar processamento (idempotência por status='pending')
- Rate limit no endpoint webhook por IP (proteção contra flood)

## Convenções
- Idempotency-Key header obrigatório no POST do prestador
- Logs estruturados de cada decisão (entity_type, action, attempt_number, decision)
- Lib Unico: adicionar dependency com justificativa em PR description (memory `feedback_ambitious_features`)
- Secrets: `UNICO_API_KEY`, `UNICO_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RLS_REQUIRED','RATE_LIMIT','AUDIT_LOG','IDEMPOTENCY_KEY'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-009 [API]
('0cd9e20c-ec44-47d6-8451-3610667c5950',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-009',
 'Disparar notificação e marcar pronto-para-pool ao aprovar KYC',
$desc$## Objetivo
Quando `provider_profiles.kyc_status` transiciona para `approved`, enfileirar notificação ao prestador (canal externo via US-022) e registrar audit log da transição (AC #9).

## Contexto
Módulo ONBOARDING (persona SISTEMA) — automação 100% no DB. Não tem UI direta nesta task; T-012 consome o estado pós-aprovação. Depende da fila de notificações (vive em US-024) e templates (vive em US-022); aqui só **enfileiramos** o evento.

## Estado atual / O que substitui
Não há trigger nem event queue. A queue será criada em US-024; este trigger apenas chama uma função pública dela.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_kyc_approved_trigger.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION on_provider_kyc_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.kyc_status = 'approved' AND OLD.kyc_status IS DISTINCT FROM 'approved' THEN
    -- Enfileira notificação (RPC criada em US-024)
    PERFORM enqueue_notification(
      p_user_id        := NEW.user_id,
      p_template_slug  := 'provider_kyc_approved',
      p_channels       := ARRAY['email','whatsapp'],
      p_payload        := jsonb_build_object('provider_id', NEW.id, 'approved_at', NEW.approved_at)
    );
    -- Audit log (US-023 cria a tabela; aqui INSERT)
    INSERT INTO audit_log (entity_type, entity_id, actor_id, action, payload)
    VALUES ('provider_profile', NEW.id, NULL, 'kyc_approved',
            jsonb_build_object('approved_at', NEW.approved_at));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_kyc_approved_trigger
  AFTER UPDATE OF kyc_status ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION on_provider_kyc_approved();

COMMIT;
```

## Constraints / NÃO fazer
- Trigger só dispara em **transição** (`OLD.kyc_status IS DISTINCT FROM 'approved'`) — nunca em re-update idêntico
- Não chamar APIs HTTP externas dentro do trigger (apenas enfileirar)
- Não enviar email/whatsapp diretamente — fila + worker (US-022)

## Convenções
- `enqueue_notification` é a função pública criada em US-024; até ela existir, este trigger fica em status `draft` esperando essa dependência
- `audit_log` é a tabela criada em US-023 (matriz RLS); idem dependência
- Função `SECURITY DEFINER` para bypassar RLS de audit_log e da queue$desc$,
 'API', 'SISTEMA', ARRAY['AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-010 [UI]
('40739971-9477-4d49-b8e5-abffad23aeab',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-010',
 'Renderizar splash e wizard multi-step de cadastro do prestador',
$desc$## Objetivo
Implementar fluxo guiado em 5 etapas (splash → conta → dados → categorias → termos), com persistência de progresso server-side e retomada do step correto ao voltar (AC #1, #2, #3, #4, #5, #11).

## Contexto
Módulo ONBOARDING — primeira UI do prestador no app, via PWA mobile-first. Consome T-006 (POST /signup) e T-007 (PATCH /step). Carrega dinamicamente `signup_step` do `provider_profiles` ao montar para rotear ao step correto. Forms usam o **Field compound API** (regra de projeto).

## Estado atual / O que substitui
Pasta `src/app/(provider)/onboarding/` ainda não existe.

## O que criar

### `src/app/(provider)/onboarding/page.tsx`
```tsx
// Splash "Sou prestador"
export default function ProviderSplashPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold">Trabalhe como prestador no Zelar</h1>
      <Button asChild size="lg" className="mt-8">
        <Link href="/onboarding/account">Sou prestador</Link>
      </Button>
    </main>
  );
}
```

### `src/app/(provider)/onboarding/[step]/page.tsx`
```tsx
// Server Component carrega signup_step e roteia
export default async function StepPage({ params }: { params: { step: string } }) {
  const profile = await getCurrentProviderProfile();
  if (profile && profile.signup_step > stepIndex(params.step)) {
    redirect(`/onboarding/${stepKey(profile.signup_step)}`);
  }
  return <StepRouter step={params.step} initialProfile={profile} />;
}
```

### Steps (Client Components, src/components/onboarding/provider/)
- `AccountStep.tsx` — tabs `email/senha` | `Google`, dispara POST /signup
- `PersonalDataStep.tsx` — Field compound: full_name, cpf, phone
- `CategoriesStep.tsx` — multi-select de categorias (fetch /api/categories)
- `TermsStep.tsx` — modal com texto + 2 checkboxes (terms, privacy) → confirma

### Form pattern (exemplo PersonalDataStep)
```tsx
import { Field, FormBody } from '@/components/ui/field';

const [fullName, setFullName] = useState('');
const [cpf, setCpf] = useState('');
const [phone, setPhone] = useState('');
const [errors, setErrors] = useState<Record<string,string>>({});

async function submit() {
  const res = await fetch('/api/onboarding/provider/step', {
    method: 'PATCH',
    body: JSON.stringify({ step: 'personal_data', full_name: fullName, cpf, phone }),
  });
  if (!res.ok) {
    const data = await res.json();
    if (data.fieldErrors) setErrors(data.fieldErrors);
    showErrorToast({ type: 'patch' }, new HttpError(res.status, await res.text()));
    return;
  }
  router.push('/onboarding/categories');
}

return (
  <FormBody density="comfortable">
    <Field name="full_name" required error={errors.full_name}>
      <Field.Label>Nome completo</Field.Label>
      <Field.Control><Input value={fullName} onChange={e => setFullName(e.target.value)} /></Field.Control>
    </Field>
    <Field name="cpf" required error={errors.cpf}>
      <Field.Label>CPF</Field.Label>
      <Field.Control><Input inputMode="numeric" value={cpf} onChange={e => setCpf(e.target.value.replace(/\D/g,''))} /></Field.Control>
      <Field.Hint>11 dígitos, sem pontuação</Field.Hint>
    </Field>
    <Field name="phone" required error={errors.phone}>
      <Field.Label>Telefone</Field.Label>
      <Field.Control><Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field.Control>
    </Field>
  </FormBody>
);
```

## Constraints / NÃO fazer
- ❌ `<input>` cru sem `Field` wrapper
- ❌ `react-hook-form` (regra projeto, ver `project_ui_patterns`)
- ❌ Validação Zod no client (Zod só no servidor)
- ❌ Masked-input lib (input nativo basta)
- ❌ `window.confirm()`/`alert()` — usar `Sonner` toast e `ResponsiveDialog`
- Não fazer fetch de categorias diretamente do banco no client — usar route handler
- Não autenticar via custom flow — usar Supabase Auth client (`createBrowserClient`)

## Convenções
- Pasta `(provider)` Next 16 route group
- Estado de form: `useState` direto
- Erros vêm em `Sonner` toast via `showErrorToast` (memory `project_ui_patterns`)
- `ResponsiveDialog` (não `Dialog`) para o modal de termos
- Mobile-first (memory: produto é PWA)$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST','RESPONSIVE_SHEET_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-011 [UI]
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-011',
 'Renderizar fluxo de KYC (envio doc/selfie, em análise, resultado, bloqueio)',
$desc$## Objetivo
Conduzir o prestador pela verificação de identidade (Unico), exibir status (segundos no auto, "em análise" no manual), permitir reenvio até 2x e exibir bloqueio definitivo na 3ª falha (AC #6, #7, #8, #10).

## Contexto
Módulo ONBOARDING — depende de T-008 (API + webhook). Acontece após o prestador completar o wizard (T-010). UI roteia entre 4 estados de tela conforme `kyc_status`/`kyc_attempts` lidos de `provider_profiles`.

## Estado atual / O que substitui
Não existe UI de KYC no projeto.

## O que criar

### `src/app/(provider)/onboarding/kyc/start/page.tsx`
```tsx
// Server Component — confirma estado válido para iniciar
export default async function KycStartPage() {
  const profile = await getCurrentProviderProfile();
  if (profile.kyc_status === 'approved') redirect('/onboarding/welcome');
  if (profile.kyc_status === 'blocked') redirect('/onboarding/kyc/blocked');
  if (profile.kyc_status === 'in_review') redirect('/onboarding/kyc/result');
  return <KycStartClient remainingAttempts={3 - profile.kyc_attempts} />;
}
```

### `src/components/onboarding/provider/KycStartClient.tsx`
```tsx
// Explica processo, abre POST /kyc com Idempotency-Key,
// recebe session_url e abre iframe ou redirect Unico.
// Para 3ª tentativa: ConfirmDialog antes de abrir.
```

### `src/app/(provider)/onboarding/kyc/result/page.tsx`
```tsx
// Poll de kyc_status a cada 5s (ou Realtime channel se T-008 emitir)
// status='in_review' → tela "em análise" (sem bloqueio)
// status='rejected' (kyc_attempts<3) → tela "Reprovado: <reason>" + CTA "Reenviar"
// status='approved' → redirect /onboarding/welcome
// status='blocked' → redirect /onboarding/kyc/blocked
```

### `src/app/(provider)/onboarding/kyc/blocked/page.tsx`
```tsx
// Mostra motivo do bloqueio, CTA "Contestar" → US-008 (link)
```

### Componentes auxiliares
- `KycStatusBadge.tsx` reusando `StatusChip` (`src/components/ui/status-chip.tsx`)
- `KycReasonCard.tsx` reusando `Card`

## Constraints / NÃO fazer
- ❌ `window.confirm()` para 3ª tentativa — usar `ConfirmDialog`
- ❌ Atualizar status localmente sem confirmar com servidor (poll é a verdade)
- Não armazenar imagens client-side
- Não chamar webhook Unico do client
- Não permitir CTA "Reenviar" se `kyc_attempts === 3` (mesmo se UI atrasou)

## Convenções
- Reuso: `StatusChip`, `Card`, `Button`, `Skeleton`, `Sonner`, `ConfirmDialog`
- Poll a 5s; se backend ganhar Realtime depois, trocar sem tocar UI
- Toda mensagem de erro via `Sonner`
- Mobile-first; `useIsMobile()` se precisar layout$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST','CONFIRM_DIALOG_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-012 [UI]
('9194bc27-323c-431a-be4a-144653ddebef',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'e7d177b8-0474-4ffb-b297-01afb9466652',
 'ZLAR-V2-T-012',
 'Renderizar tela de boas-vindas pós-aprovação com primeiros passos',
$desc$## Objetivo
Mostrar landing simples pós-KYC aprovado, com mensagem de boas-vindas e CTAs para os pré-requisitos do pool de matching (US-003) e ajustes de perfil (US-007). Cobre AC #9.

## Contexto
Módulo ONBOARDING — última tela do funil de cadastro. Acessada após `kyc_status='approved'`; redireciona pra fora se outro estado. CTAs apontam para US-003 (pré-requisitos) e US-007 (perfil).

## Estado atual / O que substitui
Não existe tela de boas-vindas.

## O que criar

### `src/app/(provider)/onboarding/welcome/page.tsx`
```tsx
export default async function WelcomePage() {
  const profile = await getCurrentProviderProfile();
  if (profile.kyc_status !== 'approved') redirect('/onboarding/kyc/start');

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Você está aprovado!</h1>
      <p className="mt-2 text-muted-foreground">
        Bem-vindo ao Zelar. Para começar a receber propostas, complete os passos abaixo.
      </p>
      <ul className="mt-6 space-y-3">
        <Card><CardLink href="/onboarding/prerequisites">Completar pré-requisitos do pool</CardLink></Card>
        <Card><CardLink href="/profile">Configurar perfil e dados bancários</CardLink></Card>
        <Card><CardLink href="/availability">Configurar disponibilidade semanal</CardLink></Card>
      </ul>
    </main>
  );
}
```

## Constraints / NÃO fazer
- Não duplicar lógica de pré-requisitos aqui (vive em US-003)
- Não disparar nenhuma side-effect (só leitura)
- Não permitir acesso se `kyc_status != 'approved'`

## Convenções
- Reuso: `Card`, `Button`, `Link` do Next
- Mobile-first
- Conteúdo simples, sem dependências de novos componentes$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- =============================================================================
-- TaskAcceptanceCriterion (mapeamento Task → AC-da-Story)
-- =============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT v.task_id, ac.id
FROM (VALUES
  -- T-001 → AC #4
  ('78ced729-7fd7-4c24-a1f5-9445533b8244'::uuid, 4),
  -- T-002 → AC #2, #3, #5, #6, #8, #9, #10
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 2),
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 3),
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 5),
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 6),
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 8),
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 9),
  ('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07'::uuid, 10),
  -- T-003 → AC #4
  ('8f552252-9053-45fe-8ffb-a35be93627b8'::uuid, 4),
  -- T-004 → AC #11
  ('7156f5db-c7e1-402c-8ae7-cf3900154623'::uuid, 11),
  -- T-005 → AC #6, #7, #8, #10
  ('aa13afc9-5e9f-461e-a30d-c7f6ca241316'::uuid, 6),
  ('aa13afc9-5e9f-461e-a30d-c7f6ca241316'::uuid, 7),
  ('aa13afc9-5e9f-461e-a30d-c7f6ca241316'::uuid, 8),
  ('aa13afc9-5e9f-461e-a30d-c7f6ca241316'::uuid, 10),
  -- T-006 → AC #2, #3, #11
  ('70977758-9edf-441c-ac94-5b0e9546b81a'::uuid, 2),
  ('70977758-9edf-441c-ac94-5b0e9546b81a'::uuid, 3),
  ('70977758-9edf-441c-ac94-5b0e9546b81a'::uuid, 11),
  -- T-007 → AC #3, #4, #5
  ('80650191-0c7d-4e18-8962-7c8085655377'::uuid, 3),
  ('80650191-0c7d-4e18-8962-7c8085655377'::uuid, 4),
  ('80650191-0c7d-4e18-8962-7c8085655377'::uuid, 5),
  -- T-008 → AC #6, #7, #8, #10
  ('6826ce1a-5e02-4b74-805f-53e0bce0a2ee'::uuid, 6),
  ('6826ce1a-5e02-4b74-805f-53e0bce0a2ee'::uuid, 7),
  ('6826ce1a-5e02-4b74-805f-53e0bce0a2ee'::uuid, 8),
  ('6826ce1a-5e02-4b74-805f-53e0bce0a2ee'::uuid, 10),
  -- T-009 → AC #9
  ('0cd9e20c-ec44-47d6-8451-3610667c5950'::uuid, 9),
  -- T-010 → AC #1, #2, #3, #4, #5, #11
  ('40739971-9477-4d49-b8e5-abffad23aeab'::uuid, 1),
  ('40739971-9477-4d49-b8e5-abffad23aeab'::uuid, 2),
  ('40739971-9477-4d49-b8e5-abffad23aeab'::uuid, 3),
  ('40739971-9477-4d49-b8e5-abffad23aeab'::uuid, 4),
  ('40739971-9477-4d49-b8e5-abffad23aeab'::uuid, 5),
  ('40739971-9477-4d49-b8e5-abffad23aeab'::uuid, 11),
  -- T-011 → AC #6, #7, #8, #10
  ('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc'::uuid, 6),
  ('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc'::uuid, 7),
  ('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc'::uuid, 8),
  ('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc'::uuid, 10),
  -- T-012 → AC #9
  ('9194bc27-323c-431a-be4a-144653ddebef'::uuid, 9)
) AS v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;


-- =============================================================================
-- AcceptanceCriterion (taskId=...) — checklist técnico exibido no TaskSheet
-- =============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
-- T-001
('78ced729-7fd7-4c24-a1f5-9445533b8244', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('78ced729-7fd7-4c24-a1f5-9445533b8244', 'Tabelas service_categories e service_subcategories criadas com RLS', 1),
('78ced729-7fd7-4c24-a1f5-9445533b8244', '7 categorias seedadas (slug, name, order)', 2),
('78ced729-7fd7-4c24-a1f5-9445533b8244', 'Subcategorias mínimas seedadas para cada categoria', 3),
('78ced729-7fd7-4c24-a1f5-9445533b8244', 'Smoke: SELECT anônimo retorna catálogo; INSERT/UPDATE anônimo nega', 4),

-- T-002
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'Migration aplicada; database.types.ts regenerado', 0),
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'Enum provider_kyc_status criado', 1),
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'Tabela provider_profiles com colunas, índices e CHECK constraints', 2),
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'RLS: prestador A não lê provider_profile do prestador B', 3),
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'UNIQUE(cpf) impede duplicação', 4),
('706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'Trigger updatedAt funciona em UPDATE', 5),

-- T-003
('8f552252-9053-45fe-8ffb-a35be93627b8', 'Migration aplicada; database.types.ts regenerado', 0),
('8f552252-9053-45fe-8ffb-a35be93627b8', 'Tabela provider_categories com PK composta e índices', 1),
('8f552252-9053-45fe-8ffb-a35be93627b8', 'Prestador insere/deleta apenas suas linhas', 2),
('8f552252-9053-45fe-8ffb-a35be93627b8', 'Outro prestador não vê categorias alheias (RLS)', 3),
('8f552252-9053-45fe-8ffb-a35be93627b8', 'Service role lê tudo (verificado via psql sem auth)', 4),

-- T-004
('7156f5db-c7e1-402c-8ae7-cf3900154623', 'Migration aplicada; database.types.ts regenerado', 0),
('7156f5db-c7e1-402c-8ae7-cf3900154623', 'INSERT pelo owner funciona com auth.uid() = user_id', 1),
('7156f5db-c7e1-402c-8ae7-cf3900154623', 'UPDATE/DELETE pelo owner são bloqueados (sem policy)', 2),
('7156f5db-c7e1-402c-8ae7-cf3900154623', 'Admin lê todas as linhas via claim app_metadata.role', 3),
('7156f5db-c7e1-402c-8ae7-cf3900154623', 'Consulta corrente: (user_id, document_kind, MAX(accepted_at))', 4),

-- T-005
('aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'Migration aplicada; enums kyc_attempt_status e kyc_decision_kind criados', 0),
('aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'Constraint UNIQUE(provider_id, attempt_number) e CHECK(1..3) ativos', 1),
('aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'Prestador vê só suas tentativas (RLS)', 2),
('aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'Admin lê tudo (US-017)', 3),
('aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'INSERT/UPDATE pelo prestador é negado (sem policy)', 4),
('aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'Trigger updatedAt funciona', 5),

-- T-006
('70977758-9edf-441c-ac94-5b0e9546b81a', 'Endpoint cria auth.users + provider_profile + 2 consents em transação', 0),
('70977758-9edf-441c-ac94-5b0e9546b81a', 'Email/senha: dispara confirmação Supabase Auth', 1),
('70977758-9edf-441c-ac94-5b0e9546b81a', 'Google: troca id_token via Supabase Auth funciona', 2),
('70977758-9edf-441c-ac94-5b0e9546b81a', 'Re-signup com email já registrado e profile existente retorna 409', 3),
('70977758-9edf-441c-ac94-5b0e9546b81a', 'Sem accepted_terms=true retorna 400', 4),
('70977758-9edf-441c-ac94-5b0e9546b81a', 'IP e user-agent gravados em lgpd_consents', 5),
('70977758-9edf-441c-ac94-5b0e9546b81a', 'RPC create_provider_with_consents é SECURITY DEFINER e atômica', 6),

-- T-007
('80650191-0c7d-4e18-8962-7c8085655377', 'Discriminated union por step valida body corretamente', 0),
('80650191-0c7d-4e18-8962-7c8085655377', 'CPF é validado por checksum server-side (não só formato)', 1),
('80650191-0c7d-4e18-8962-7c8085655377', 'Phone E.164 validado', 2),
('80650191-0c7d-4e18-8962-7c8085655377', 'Diff de categorias: INSERT só novos, DELETE só removidos', 3),
('80650191-0c7d-4e18-8962-7c8085655377', 'signup_step nunca regride (Math.max)', 4),
('80650191-0c7d-4e18-8962-7c8085655377', '409 quando kyc_status=approved', 5),
('80650191-0c7d-4e18-8962-7c8085655377', '403 quando provider_profile não existe', 6),

-- T-008
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'POST /kyc exige Idempotency-Key (400 sem header)', 0),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'POST 409 quando kyc_status ∈ approved/in_review/blocked', 1),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'POST 403 quando kyc_attempts >= 3', 2),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Sessão Unico criada com UNICO_API_KEY do server-only', 3),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Webhook valida assinatura e rejeita 401 sem assinatura válida', 4),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Webhook idempotente por external_session_id (2x não duplica)', 5),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Aprovado: kyc_status=approved + approved_at=NOW()', 6),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Rejeitado attempts<3: kyc_status=rejected, attempts++', 7),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Rejeitado na 3ª: kyc_status=blocked + kyc_blocked_reason', 8),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Rate limit ativo no webhook (proteção contra flood)', 9),
('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'Audit log registra cada decisão', 10),

-- T-009
('0cd9e20c-ec44-47d6-8451-3610667c5950', 'Trigger criada AFTER UPDATE OF kyc_status', 0),
('0cd9e20c-ec44-47d6-8451-3610667c5950', 'Dispara apenas em transição (OLD IS DISTINCT FROM approved)', 1),
('0cd9e20c-ec44-47d6-8451-3610667c5950', 'Chama enqueue_notification com template provider_kyc_approved', 2),
('0cd9e20c-ec44-47d6-8451-3610667c5950', 'INSERT em audit_log (entity_type=provider_profile, action=kyc_approved)', 3),
('0cd9e20c-ec44-47d6-8451-3610667c5950', 'Re-update idempotente (sem reaprovação não dispara)', 4),

-- T-010
('40739971-9477-4d49-b8e5-abffad23aeab', 'Splash renderiza CTA "Sou prestador" e leva para /onboarding/account', 0),
('40739971-9477-4d49-b8e5-abffad23aeab', 'Email/senha cadastra via Supabase Auth + chama POST /signup', 1),
('40739971-9477-4d49-b8e5-abffad23aeab', 'OAuth Google funciona via Supabase Auth client', 2),
('40739971-9477-4d49-b8e5-abffad23aeab', 'PersonalDataStep usa Field compound API (sem react-hook-form)', 3),
('40739971-9477-4d49-b8e5-abffad23aeab', 'Sair e voltar resume no step correto (server-fetch signup_step)', 4),
('40739971-9477-4d49-b8e5-abffad23aeab', 'Multi-select de categorias persiste via PATCH /step', 5),
('40739971-9477-4d49-b8e5-abffad23aeab', 'Modal de termos é ResponsiveDialog (não Dialog cru)', 6),
('40739971-9477-4d49-b8e5-abffad23aeab', 'Erros aparecem em Sonner toast (sem alert/window.confirm)', 7),
('40739971-9477-4d49-b8e5-abffad23aeab', 'Páginas funcionam mobile-first (testado em viewport <768px)', 8),

-- T-011
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'KycStartPage redireciona conforme kyc_status atual', 0),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'POST /kyc abre sessão Unico e exibe iframe/redirect', 1),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', '3ª tentativa pede ConfirmDialog antes de iniciar', 2),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'KycResultPage faz poll a cada 5s (ou Realtime)', 3),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'in_review: tela "em análise, sem bloqueio"', 4),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'rejected (attempts<3): tela com motivo + CTA Reenviar', 5),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'approved: redirect /onboarding/welcome', 6),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'blocked: tela com motivo + CTA Contestar (US-008)', 7),
('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'StatusChip reusado para badge de status', 8),

-- T-012
('9194bc27-323c-431a-be4a-144653ddebef', 'Página renderiza apenas se kyc_status=approved', 0),
('9194bc27-323c-431a-be4a-144653ddebef', 'Redireciona para /onboarding/kyc/start em outros estados', 1),
('9194bc27-323c-431a-be4a-144653ddebef', 'CTAs apontam para US-003 (pré-requisitos), US-007 (perfil), US-027 (disponibilidade)', 2),
('9194bc27-323c-431a-be4a-144653ddebef', 'Layout mobile-first, reusa Card e Button', 3);


-- =============================================================================
-- TaskDependency (kind='blocks')
-- =============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-003 ← T-001, T-002
  ('8f552252-9053-45fe-8ffb-a35be93627b8', '78ced729-7fd7-4c24-a1f5-9445533b8244', 'blocks'),
  ('8f552252-9053-45fe-8ffb-a35be93627b8', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),
  -- T-005 ← T-002
  ('aa13afc9-5e9f-461e-a30d-c7f6ca241316', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),
  -- T-006 ← T-002, T-004
  ('70977758-9edf-441c-ac94-5b0e9546b81a', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),
  ('70977758-9edf-441c-ac94-5b0e9546b81a', '7156f5db-c7e1-402c-8ae7-cf3900154623', 'blocks'),
  -- T-007 ← T-002, T-003
  ('80650191-0c7d-4e18-8962-7c8085655377', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),
  ('80650191-0c7d-4e18-8962-7c8085655377', '8f552252-9053-45fe-8ffb-a35be93627b8', 'blocks'),
  -- T-008 ← T-002, T-005
  ('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),
  ('6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'aa13afc9-5e9f-461e-a30d-c7f6ca241316', 'blocks'),
  -- T-009 ← T-002
  ('0cd9e20c-ec44-47d6-8451-3610667c5950', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),
  -- T-010 ← T-006, T-007
  ('40739971-9477-4d49-b8e5-abffad23aeab', '70977758-9edf-441c-ac94-5b0e9546b81a', 'blocks'),
  ('40739971-9477-4d49-b8e5-abffad23aeab', '80650191-0c7d-4e18-8962-7c8085655377', 'blocks'),
  -- T-011 ← T-008, T-010
  ('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', '6826ce1a-5e02-4b74-805f-53e0bce0a2ee', 'blocks'),
  ('ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', '40739971-9477-4d49-b8e5-abffad23aeab', 'blocks'),
  -- T-012 ← T-009
  ('9194bc27-323c-431a-be4a-144653ddebef', '0cd9e20c-ec44-47d6-8451-3610667c5950', 'blocks');

COMMIT;
