-- Backlog cards (Zordon) para ZLAR-V2-US-014
-- "CLIENTE gerencia perfil, endereços e consentimentos LGPD" (módulo PERFIL)
-- 15 tasks: 3 DATA + 6 API + 6 UI
-- Refs: ZLAR-V2-T-096..110
-- Reuso: client_profiles (US-009 T-91d6), client_addresses (US-009 T-c631),
--   lgpd_consents (US-001 T-7156), padrão storage avatars (T-086),
--   padrão self-delete (T-090), AccountActions (T-094)

BEGIN;

-- =====================================================================
-- 1) Tasks
-- =====================================================================
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-096 DATA: Storage client-avatars + colunas em client_profiles
('fda1d674-e4b1-4574-9154-55c8bccffcbc',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-096',
 'Provisionar storage bucket client-avatars + colunas avatar em client_profiles',
 $desc$## Objetivo
Habilitar foto de perfil do CLIENTE (visível no hub e nos cards de
solicitação enviados a prestadores) — AC #1, #2, #3. Reusa exatamente o
padrão estabelecido em T-086 (provider-avatars).

## Contexto
Módulo PERFIL — pré-requisito para PATCH /api/profile/personal (T-099) e
sheet de edição pessoal (T-106). `client_profiles` já existe (US-009
T-91d6) sem campo de avatar. Esta task **estende** com `avatar_path` e
`avatar_updated_at`. Bucket público para leitura (mesma justificativa
de T-086: avatar pode aparecer em contextos onde o consumidor não está
autenticado, ex: card de proposta de cliente para prestador antes do
match).

## Estado atual / O que substitui
`client_profiles` existe sem campos de avatar. Bucket `provider-avatars`
foi a primeira instância do padrão (T-086); aqui replicamos para CLIENTE.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_avatars.sql`
```sql
BEGIN;

ALTER TABLE client_profiles
  ADD COLUMN avatar_path text,
  ADD COLUMN avatar_updated_at timestamptz;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-avatars',
  'client-avatars',
  true,
  2 * 1024 * 1024,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "client_upload_own_avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "client_update_own_avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "client_delete_own_avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Bucket privado (avatar pode ser exibido em cards públicos pré-match)
- ❌ Mime SVG (XSS via SVG)
- ❌ Limite > 2MB (PWA mobile, redimensionar no cliente — AC #3)

## Convenções
- Mesmo padrão de T-086 (`<entity-plural>-avatars`, path `<user_id>/<filename>`)
- `avatar_updated_at` pra invalidação de cache CDN via query param$desc$,
 'DATA', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-097 DATA: extend client_addresses + terms_versions + extend lgpd_consents
('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-097',
 'Estender client_addresses com is_primary + criar terms_versions + estender lgpd_consents',
 $desc$## Objetivo
Ampliar o schema de PERFIL CLIENTE com (a) flag de endereço principal
exclusivo (AC #5, #6); (b) tabela `terms_versions` para versionamento de
termos (AC #8); (c) campos de revogação em `lgpd_consents` para histórico
auditável e não-essencialidade (AC #7).

## Contexto
Módulo PERFIL — base para CRUD de endereços (T-100), endpoints de
consents (T-101) e re-consent flow (T-102, T-109).
- `client_addresses` (US-009 T-c631) já existe; precisa de `is_primary`
  + UNIQUE parcial garantindo no máximo 1 primary por cliente
- `lgpd_consents` (US-001 T-7156) é insert-only; vamos manter insert-only
  e modelar revogação como **nova linha** com `revoked_at`/`replaces_id`
  para histórico
- `terms_versions` é nova; armazena versão atual e arquivo do texto

## Estado atual / O que substitui
- `client_addresses` existe sem flag primary (AC #5 não satisfeito)
- `lgpd_consents` existe insert-only mas sem versionamento de termos
- Não existe tabela de versões de termos (AC #8 inviável sem ela)

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_perfil_lgpd.sql`
```sql
BEGIN;

-- 1. is_primary em client_addresses
ALTER TABLE client_addresses
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

-- UNIQUE parcial: no máximo 1 primary por cliente
CREATE UNIQUE INDEX client_addresses_one_primary
  ON client_addresses(client_id) WHERE is_primary = true;

-- 2. terms_versions
CREATE TABLE terms_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version     text NOT NULL UNIQUE,        -- ex: '2026-05', 'v3.1'
  audience    text NOT NULL CHECK (audience IN ('CLIENTE','PRESTADOR','ANY')),
  body_md     text NOT NULL,               -- texto integral em markdown
  effective_at timestamptz NOT NULL DEFAULT NOW(),
  is_current  boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX terms_versions_one_current
  ON terms_versions(audience) WHERE is_current = true;

-- Leitura pública (anônimo precisa ler termos antes do signup)
ALTER TABLE terms_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "terms_public_read" ON terms_versions FOR SELECT USING (true);
CREATE POLICY "terms_admin_write" ON terms_versions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 3. Estender lgpd_consents (insert-only mantido)
ALTER TABLE lgpd_consents
  ADD COLUMN essential boolean NOT NULL DEFAULT true,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN replaces_id uuid REFERENCES lgpd_consents(id),
  ADD COLUMN terms_version_id uuid REFERENCES terms_versions(id);

CREATE INDEX lgpd_consents_user_kind_active
  ON lgpd_consents(user_id, kind)
  WHERE revoked_at IS NULL;

-- Helper RPC para current consent state por user
CREATE OR REPLACE FUNCTION get_active_consents(p_user_id uuid)
RETURNS TABLE(kind text, essential boolean, version text, accepted_at timestamptz) AS $$
  SELECT lc.kind, lc.essential, tv.version, lc."createdAt"
  FROM lgpd_consents lc
  LEFT JOIN terms_versions tv ON tv.id = lc.terms_version_id
  WHERE lc.user_id = p_user_id AND lc.revoked_at IS NULL
  ORDER BY lc."createdAt" DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ UPDATE em `lgpd_consents` para revogar — manter insert-only (revoke
  é insert de nova linha com `revoked_at` setado e `replaces_id` apontando)
- ❌ Permitir mais de 1 `is_current=true` por audience (UNIQUE parcial bloqueia)
- ❌ Permitir CLIENTE delete em `client_addresses` referenciado por
  `service_requests` ativo (ON DELETE RESTRICT na FK)
- ❌ Mudar `kind` em `lgpd_consents` (PII trail é por evento)

## Convenções
- `lgpd_consents.essential=true` para consentimentos obrigatórios (LGPD,
  termos de uso); revogação só permitida se `essential=false`
- `is_current=true` ativo via uma única linha por audience; admin promove
  nova versão setando old.is_current=false e new.is_current=true em transação
- `get_active_consents` evita N+1 no hub e endpoints de consents$desc$,
 'DATA', 'ANY',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-098 DATA: account_deletion_requests (Art. 18 LGPD via suporte) + retention
('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-098',
 'Criar tabela account_deletion_requests + job de retenção fiscal/auditoria',
 $desc$## Objetivo
Suportar dois fluxos de exclusão LGPD distintos: (a) **self-delete** pelo
hub (AC #10 — confirmar digitando EXCLUIR, anonimização imediata); (b)
**solicitação Art. 18** via suporte (AC #11 — texto livre, ticket SLA,
remoção de documentos sensíveis após prazo legal). Esta task cobre o
schema do segundo fluxo + job que executa retenção.

## Contexto
Módulo PERFIL — fronteira com SUPORTE (US-024..028). Tabela armazena o
**pedido** (não a anonimização em si). Job pg_cron roda diariamente,
consulta requests aprovadas com `legal_retention_until <= NOW()` e
remove documentos sensíveis (KYC, comprovantes) do storage. Registros
financeiros (`payments`, `service_requests` com valor) são preservados
para obrigação fiscal de N anos.

## Estado atual / O que substitui
Não existe schema de Art. 18 nem retention policy. Documentos KYC ficam
em `storage.objects` (bucket privado configurado em US-001).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_account_deletion.sql`
```sql
BEGIN;

CREATE TABLE account_deletion_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  user_role       text NOT NULL CHECK (user_role IN ('CLIENTE','PRESTADOR')),
  request_type    text NOT NULL CHECK (request_type IN ('self_delete','art18_support')),
  reason          text,                         -- texto livre AC #11
  requested_at    timestamptz NOT NULL DEFAULT NOW(),
  approved_at     timestamptz,                  -- ADMIN ou auto-approve
  approved_by     uuid REFERENCES auth.users(id),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','executed','rejected')),
  -- Retenção legal
  legal_retention_until timestamptz NOT NULL,   -- min(financeiro=5y, audit=N)
  executed_at     timestamptz,                  -- quando docs sensíveis foram removidos
  rejection_reason text,
  support_ticket_id uuid                        -- FK frouxa pra US-024 (suporte)
);

CREATE INDEX idx_adr_pending ON account_deletion_requests(status, legal_retention_until)
  WHERE status IN ('pending','approved');

ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adr_own_read" ON account_deletion_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "adr_own_create" ON account_deletion_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "adr_admin_all" ON account_deletion_requests FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Job de retenção: roda diário, executa anonimização final em requests
-- approved com prazo vencido
SELECT cron.schedule(
  'execute-deletion-retention',
  '0 3 * * *',           -- 03:00 UTC diário
  $$
  SELECT execute_deletion_retention_batch();
  $$
);

-- Função invocada pelo cron (esqueleto — implementação detalhada em US futura)
CREATE OR REPLACE FUNCTION execute_deletion_retention_batch()
RETURNS int AS $$
DECLARE
  affected int := 0;
BEGIN
  -- Para cada approved com retenção vencida:
  -- 1. Remove documentos sensíveis do storage (KYC, comprovantes)
  -- 2. Anonimiza profile (nome → 'Conta excluída', email → null, etc)
  -- 3. Marca executed_at = NOW(), status = 'executed'
  UPDATE account_deletion_requests
  SET status = 'executed', executed_at = NOW()
  WHERE status = 'approved' AND legal_retention_until <= NOW();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Hard-delete imediato em fluxo Art. 18 (requer SLA + análise pelo suporte)
- ❌ Permitir `user_id` arbitrário no INSERT (RLS força auth.uid())
- ❌ Status `executed` reverter para outro (terminal)
- ❌ Job rodar fora de janela noturna (impacto em queries do dia)
- ❌ Remover registros financeiros antes do prazo legal (obrigação fiscal)

## Convenções
- `legal_retention_until` é calculado pela API que cria o request (default
  5 anos para financeiro, ajustável por config)
- Job idempotente via `WHERE status='approved'` (executados saem do filtro)
- Self-delete (AC #10) NÃO usa esta tabela (anonimização imediata via T-103);
  este schema é só para AC #11 (Art. 18 via suporte)$desc$,
 'DATA', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-099 API: PATCH /api/profile/personal (CLIENTE)
('5ac9f0ca-80ee-4297-a762-fbd649a74b49',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-099',
 'Implementar PATCH /api/profile/personal cliente (nome, telefone, foto, OAuth gates)',
 $desc$## Objetivo
Permitir que CLIENTE edite dados pessoais com validação inline (AC #2, #3).
Detecta vínculo OAuth (Google/Apple) e bloqueia edição de email; expõe
flag `canUnlinkOAuth` se há senha cadastrada como fallback (AC #4).

## Contexto
Módulo PERFIL — chamado pelo sheet de edição (T-106). Reusa o **padrão**
de T-087 (provider PATCH personal) com diferenças: (a) email read-only se
OAuth, (b) telefone opcional (CLIENTE pode não ter), (c) avatar bucket é
`client-avatars`. Provedor OAuth é detectado por `auth.identities` do
Supabase.

## Estado atual / O que substitui
US-009 T-fd83 (`PATCH /api/onboarding/client/step`) cobre o **wizard** de
onboarding. Este endpoint é dedicado à **edição pós-onboarding** —
contratos diferentes, validações independentes.

## O que criar

### `src/app/api/profile/personal/route.ts` (cliente — distinto do provider em T-087)
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().regex(/^\+?\d{10,14}$/).nullable().optional(),
  avatarPath: z.string().max(500).nullable().optional(),
}).refine(b => Object.keys(b).length > 0);

export async function PATCH(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Validar avatarPath: precisa começar com user.id
  if (body.avatarPath && !body.avatarPath.startsWith(`${user.id}/`)) {
    return Response.json({ error: 'invalid_avatar_path' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.fullName !== undefined) update.full_name = body.fullName;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.avatarPath !== undefined) {
    update.avatar_path = body.avatarPath;
    update.avatar_updated_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('client_profiles')
    .update(update)
    .eq('user_id', user.id)
    .select()
    .single();
  if (error) return Response.json({ error: error.code }, { status: 400 });

  return Response.json({ profile: data });
}

// GET retorna profile + flags OAuth para o hub
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const [profileRes, identitiesRes] = await Promise.all([
    supabase.from('client_profiles').select('*').eq('user_id', user.id).single(),
    supabase.auth.getUser(), // identities estão em user.identities
  ]);

  const identities = identitiesRes.data.user?.identities ?? [];
  const oauthProviders = identities.filter(i => i.provider !== 'email').map(i => i.provider);
  const hasPasswordFallback = identities.some(i => i.provider === 'email');

  return Response.json({
    profile: profileRes.data,
    email: user.email,
    emailReadOnly: oauthProviders.length > 0,
    oauthProviders,
    canUnlinkOAuth: hasPasswordFallback && oauthProviders.length > 0,
  });
}
```

## Constraints / NÃO fazer
- ❌ Aceitar PATCH em `email` (mudança de email passa por flow separado, fora desta US)
- ❌ Permitir alterar `signup_step` ou `consents` (vão por endpoints próprios)
- ❌ Validar telefone como obrigatório (CLIENTE pode não ter cadastrado)
- ❌ Mock de OAuth provider — usar `supabase.auth.getUser().identities` real

## Convenções
- Mesmo padrão de T-087 (PATCH provider personal); diferença está em
  campos opcionais e na resposta GET com flags OAuth
- Erros Zod retornam 400 com `issues` para mapeamento inline na UI
- `email` nunca vem no body PATCH (read-only sempre)$desc$,
 'API', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-100 API: CRUD endereços + set-primary
('07d8115a-6ca1-45c3-a338-e86f31a49fc2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-100',
 'Implementar CRUD /api/profile/addresses + POST /set-primary',
 $desc$## Objetivo
CRUD completo de endereços salvos (AC #5, #6). Set-primary marca um endereço
como principal **sem afetar service_requests em andamento** (que armazenam
snapshot do endereço no momento da solicitação).

## Contexto
Módulo PERFIL — chamado pelo sheet de endereços (T-107). Tabela
`client_addresses` existe (US-009 T-c631) com `is_primary` adicionado em
T-097. Service requests guardam endereço inline (snapshot) em coluna
própria — UPDATE em `client_addresses` não afeta serviços em curso. RPC
para set-primary garante que máximo 1 está marcado por cliente.

## Estado atual / O que substitui
US-009 T-fd83 (PATCH onboarding step) faz INSERT do **primeiro** endereço
durante signup. Este endpoint cobre **gerenciamento contínuo** (criar
adicional, editar, definir principal, deletar).

## O que criar

### `src/app/api/profile/addresses/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const AddressBody = z.object({
  label: z.string().min(1).max(50),       // "Casa", "Trabalho"
  zipCode: z.string().regex(/^\d{5}-?\d{3}$/),
  street: z.string().min(1).max(200),
  number: z.string().max(20),
  complement: z.string().max(100).nullable().optional(),
  neighborhood: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  state: z.string().length(2),
  reference: z.string().max(200).nullable().optional(),
  isPrimary: z.boolean().optional().default(false),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('client_addresses')
    .select('*')
    .eq('client_id', user.id)
    .order('is_primary', { ascending: false })
    .order('createdAt', { ascending: false });

  return Response.json({ addresses: data ?? [] });
}

export async function POST(req: Request) {
  const body = AddressBody.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Se vai criar como primary, desmarcar a primary atual em transação
  if (body.isPrimary) {
    const { error } = await supabase.rpc('set_address_primary_on_create', {
      p_client_id: user.id, p_payload: body,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
  } else {
    const { data, error } = await supabase.from('client_addresses')
      .insert({ ...mapToColumns(body), client_id: user.id })
      .select().single();
    if (error) return Response.json({ error: error.code }, { status: 400 });
    return Response.json({ address: data });
  }
}
```

### `src/app/api/profile/addresses/[id]/route.ts`
```typescript
const PatchBody = AddressBody.partial();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = PatchBody.parse(await req.json());
  // ... UPDATE WHERE id=params.id AND client_id=auth.uid() (RLS cobre)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  // Gate: não permitir delete se referenciado por service_requests ativos
  const { data: usage } = await supabase
    .from('service_requests')
    .select('id')
    .eq('address_id', params.id)
    .in('status', ['queued','accepted','in_progress','payment_pending'])
    .limit(1);

  if (usage && usage.length > 0) {
    return Response.json({
      error: 'address_in_use',
      message: 'Endereço em uso por serviço em andamento',
    }, { status: 409 });
  }

  const { error } = await supabase.from('client_addresses')
    .delete().eq('id', params.id);
  if (error) return Response.json({ error: error.code }, { status: 400 });
  return Response.json({ deleted: true });
}
```

### `src/app/api/profile/addresses/[id]/primary/route.ts`
```typescript
// POST /api/profile/addresses/[id]/primary
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // RPC garante atomicidade: unset all + set one
  const { error } = await supabase.rpc('set_address_primary', {
    p_client_id: user.id,
    p_address_id: params.id,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
```

### RPC `set_address_primary(p_client_id uuid, p_address_id uuid)`
- SECURITY DEFINER, language plpgsql
- BEGIN
  - UPDATE client_addresses SET is_primary=false WHERE client_id=p_client_id AND is_primary=true
  - UPDATE client_addresses SET is_primary=true WHERE id=p_address_id AND client_id=p_client_id
  - Verifica row_count=1; RAISE se 0 (address não pertence ao cliente)
- COMMIT (transação implícita por function)
- Como `is_primary` tem UNIQUE parcial, executar UPDATEs nesta ordem evita conflito

## Constraints / NÃO fazer
- ❌ DELETE sem gate de uso (quebra integridade de service_requests)
- ❌ Permitir 2 primary simultaneamente (UNIQUE parcial em DB + RPC força)
- ❌ Snapshot do endereço em service_request via FK simples (manter cópia
  inline OU FK + colunas snapshot — fora desta US, decisão da US-011)
- ❌ Deletar primary sem migrar a flag para outro endereço (oferecer
  opção na UI ou rejeitar com 409 e mensagem)

## Convenções
- Endpoint segue padrão REST: collection (POST, GET) e item (PATCH, DELETE, primary)
- `is_primary` no GET ordena resultados (primary first)
- Set primary é POST a sub-resource em vez de PATCH com flag (intenção mais clara)$desc$,
 'API', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-101 API: GET/POST consents (histórico + revogar)
('8edcb034-7016-4695-b6a9-8d0a42719143',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-101',
 'Implementar GET /api/profile/consents (histórico) + POST /revoke (não-essenciais)',
 $desc$## Objetivo
Listar histórico completo de consentimentos com data e versão, e permitir
revogar consents marcados como `essential=false` (AC #7). Revogação é
uma INSERT de nova linha em `lgpd_consents` com `revoked_at` setado
(insert-only mantido).

## Contexto
Módulo PERFIL — chamado pelo sheet de consentimentos (T-108). Tabela
`lgpd_consents` (US-001 T-7156) é insert-only por design (audit trail).
Revogação não faz UPDATE; insere nova linha referenciando a anterior via
`replaces_id`. Helper RPC `get_active_consents` (criada em T-097) lê
view virtual do estado atual.

## Estado atual / O que substitui
Não existe endpoint de leitura ou revogação de consents. T-097 criou as
colunas `essential`, `revoked_at`, `replaces_id`, `terms_version_id`.

## O que criar

### `src/app/api/profile/consents/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Histórico completo (insert-only): toda linha do user, ordem cronológica
  const { data: history } = await supabase
    .from('lgpd_consents')
    .select(`
      id, kind, essential, revoked_at, replaces_id, "createdAt",
      terms_version:terms_versions(id, version, audience)
    `)
    .eq('user_id', user.id)
    .order('createdAt', { ascending: false });

  // Estado atual (active = mais recente sem revoked_at por kind)
  const { data: active } = await supabase.rpc('get_active_consents', { p_user_id: user.id });

  return Response.json({ history: history ?? [], active: active ?? [] });
}
```

### `src/app/api/profile/consents/revoke/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  consentId: z.string().uuid(),  // ID da linha ativa que está sendo revogada
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // 1. Buscar consent target — precisa ser do user, ativo e não-essencial
  const { data: target, error: tErr } = await supabase
    .from('lgpd_consents')
    .select('id, kind, essential, revoked_at, terms_version_id')
    .eq('id', body.consentId)
    .eq('user_id', user.id)
    .single();

  if (tErr || !target) return Response.json({ error: 'not_found' }, { status: 404 });
  if (target.essential) return Response.json({
    error: 'essential_consent',
    message: 'Este consentimento é obrigatório e não pode ser revogado.',
  }, { status: 409 });
  if (target.revoked_at) return Response.json({ error: 'already_revoked' }, { status: 409 });

  // 2. Insert revocation row
  const { data, error } = await supabase
    .from('lgpd_consents')
    .insert({
      user_id: user.id,
      kind: target.kind,
      essential: target.essential,
      terms_version_id: target.terms_version_id,
      revoked_at: new Date().toISOString(),
      replaces_id: target.id,
    })
    .select().single();

  if (error) return Response.json({ error: error.code }, { status: 400 });
  return Response.json({ consent: data });
}
```

## Constraints / NÃO fazer
- ❌ UPDATE em `lgpd_consents` para revogar (quebra audit trail insert-only)
- ❌ Permitir revogar `essential=true` (LGPD: termos são pré-requisito de uso)
- ❌ Bloquear acesso à plataforma após revogar não-essencial (marketing
  pode ser revogado livremente; não impacta uso)
- ❌ Listar só active no GET (histórico completo é direito do titular)

## Convenções
- Insert-only mantido (modelo já estabelecido em T-7156)
- `replaces_id` aponta para a linha que está sendo revogada (audit trail)
- RPC `get_active_consents` reusada (criada em T-097)
- Zod no servidor; cliente envia só `consentId`$desc$,
 'API', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-102 API: GET current terms + POST accept (re-consent flow)
('5037b5d7-ba41-4f61-87f5-555e893ceb6b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-102',
 'Implementar GET /api/terms/current + POST /api/terms/accept (re-consent)',
 $desc$## Objetivo
Suportar fluxo de re-consent (AC #8, #9): UI consulta `/api/terms/current`
no boot do app; se versão > última aceita pelo user, abre modal bloqueante
(T-109). Aceite chama POST /accept que insere nova linha em `lgpd_consents`
com `terms_version_id` da nova versão.

## Contexto
Módulo PERFIL — chamado pelo modal de re-consent (T-109) e pelo bootstrap
do hub. `terms_versions` (T-097) tem flag `is_current` (UNIQUE parcial por
audience). Endpoint **não bloqueia em si**; só retorna estado e o cliente
decide quando renderizar o modal (suprimindo se há serviço ativo — AC #9).

## Estado atual / O que substitui
Não existe endpoint de termos. Aceite de termos no signup hoje (US-009)
não usa `terms_version_id`.

## O que criar

### `src/app/api/terms/current/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const audience = url.searchParams.get('audience') ?? 'CLIENTE';

  const supabase = await createClient();

  // Termos atuais por audience (público — não precisa auth)
  const { data: current } = await supabase
    .from('terms_versions')
    .select('id, version, audience, body_md, effective_at')
    .eq('audience', audience)
    .eq('is_current', true)
    .single();

  // Se autenticado, comparar com última aceita
  const { data: { user } } = await supabase.auth.getUser();
  let needsReconsent = false;
  let lastAcceptedVersion: string | null = null;

  if (user && current) {
    const { data: lastConsent } = await supabase
      .from('lgpd_consents')
      .select('terms_version_id, terms_versions(version)')
      .eq('user_id', user.id)
      .eq('kind', 'terms_of_use')
      .is('revoked_at', null)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    lastAcceptedVersion = (lastConsent?.terms_versions as any)?.version ?? null;
    needsReconsent = lastAcceptedVersion !== current.version;
  }

  return Response.json({
    current,
    needsReconsent,
    lastAcceptedVersion,
  });
}
```

### `src/app/api/terms/accept/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  termsVersionId: z.string().uuid(),
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Confirma que termsVersionId corresponde ao is_current (anti-replay)
  const { data: tv } = await supabase
    .from('terms_versions')
    .select('id, audience, is_current')
    .eq('id', body.termsVersionId)
    .single();

  if (!tv || !tv.is_current) {
    return Response.json({ error: 'not_current_version' }, { status: 409 });
  }

  // Insert consent row
  const { data, error } = await supabase
    .from('lgpd_consents')
    .insert({
      user_id: user.id,
      kind: 'terms_of_use',
      essential: true,
      terms_version_id: body.termsVersionId,
    })
    .select().single();

  if (error) return Response.json({ error: error.code }, { status: 400 });
  return Response.json({ consent: data });
}
```

## Constraints / NÃO fazer
- ❌ Bloquear acesso na API se needsReconsent=true (UI decide gate; AC #9
  exige delay durante serviço ativo — só UI sabe disso)
- ❌ Permitir accept de versão não-current (replay com versão antiga)
- ❌ UPDATE em lgpd_consents (insert-only)
- ❌ Forçar prazo máximo (AC #8 explicita "sem prazo máximo forçado")

## Convenções
- GET /current é público (anônimo precisa ler termos antes do signup)
- POST /accept é authenticated; força `terms_version_id` corresponder à current
- Comparação por `version` (string semântica) na resposta facilita UI
- `kind='terms_of_use'` é um dos kinds canônicos; outros: `privacy_policy`,
  `marketing_email`, `marketing_whatsapp` (ver enum em US futura ou check constraint)$desc$,
 'API', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-103 API: DELETE /api/profile/account (CLIENTE self-delete)
('951e2d2b-dc5a-4db5-8be1-b42bc69028a5',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-103',
 'Implementar DELETE /api/profile/account cliente (gate por serviços ativos)',
 $desc$## Objetivo
Permitir self-delete de conta CLIENTE com confirmação explícita (UI exige
digitar "EXCLUIR" — T-110). Bloqueia 409 se houver `service_requests` em
status ativo onde o cliente é parte; sem ativos, anonimiza profile e
hard-deleta auth.users (AC #10).

## Contexto
Módulo PERFIL — chamado pelo `ConfirmDialog` destrutivo de exclusão
(T-110). **Reusa o padrão estabelecido em T-090** (provider self-delete)
com diferenças: (a) gate por `client_id`, (b) anonimiza `client_profiles`
e `client_addresses`, (c) preserva `service_requests` históricos para
obrigação fiscal.

## Estado atual / O que substitui
Não existe endpoint de delete cliente. T-090 (provider) é o template.

## O que criar

### `src/app/api/profile/account/route.ts` (cliente — distinto do T-090)
```typescript
import { createClient, createAdminClient } from '@/lib/supabase';

export async function DELETE(_req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Gate: serviços ativos onde user é client?
  const { data: active } = await supabase
    .from('service_requests')
    .select('id, status')
    .eq('client_id', user.id)
    .in('status', ['queued','matching','accepted','in_progress','payment_pending','dispute_open'])
    .limit(1);

  if (active && active.length > 0) {
    return Response.json({
      error: 'has_active_services',
      message: 'Você tem serviços em andamento. Cancele ou aguarde a conclusão antes de excluir a conta.',
      activeServiceCount: active.length,
    }, { status: 409 });
  }

  const admin = createAdminClient();

  // Anonimização imediata (self-delete = AC #10)
  const { error: anonErr } = await admin.rpc('anonymize_client_profile', {
    p_client_id: user.id,
  });
  if (anonErr) return Response.json({ error: anonErr.message }, { status: 500 });

  // Hard-delete auth.users
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 });

  return Response.json({ deleted: true });
}
```

### RPC `anonymize_client_profile(p_client_id uuid)`
- SECURITY DEFINER, plpgsql
- UPDATE client_profiles SET full_name='Conta excluída', phone=NULL,
  avatar_path=NULL, deleted_at=NOW()
- DELETE em client_addresses (sem FK pra service_requests pois snapshot é inline)
- INSERT em account_deletion_requests (audit trail) com request_type='self_delete',
  status='executed', executed_at=NOW(), legal_retention_until=NOW() + interval '5 years'
- Mantém service_requests, payments, ratings históricos

### Migration auxiliar
```sql
ALTER TABLE client_profiles ADD COLUMN deleted_at timestamptz;
```

## Constraints / NÃO fazer
- ❌ Hard-delete client_profiles (quebra FK em service_requests históricos)
- ❌ Permitir delete com qualquer service_request em curso
- ❌ Reverter delete (auth.users hard-delete = sem volta)
- ❌ Notificar cliente após delete (canal já invalidado)
- ❌ Confiar na UI pra validar a string "EXCLUIR" (UX, não segurança;
  servidor confia no JWT do user)

## Convenções
- Mesmo padrão de T-090 (provider self-delete); RPC dedicada por entidade
- `deleted_at` em client_profiles para distinguir de hard-delete (preserva FK)
- INSERT em account_deletion_requests para audit (mesmo no self-delete imediato)
- Reuso: padrão de gate por status ativo, padrão de RPC SECURITY DEFINER$desc$,
 'API', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-104 API: POST /api/support/data-deletion-request (Art. 18)
('d6da0be1-1e6d-4de1-b33f-f1411a0e4319',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-104',
 'Implementar POST /api/support/data-deletion-request (Art. 18 LGPD)',
 $desc$## Objetivo
Receber pedido de exclusão de dados pessoais (Art. 18 LGPD) via texto
livre (AC #11). Cria registro em `account_deletion_requests` com
`request_type='art18_support'`, status='pending', `legal_retention_until`
calculada (default 5 anos para financeiro). Suporte (US-024..028) opera o
ticket; job pg_cron (T-098) executa retenção quando prazo vence.

## Contexto
Módulo PERFIL ↔ SUPORTE — endpoint do PERFIL cria o request; SUPORTE
depois aprova/rejeita via fluxo próprio (US futura). Fluxo distinto do
self-delete (T-103) por: (a) requer SLA de análise, (b) preserva conta
ativa até execução, (c) respeita prazos legais por tipo de dado.

## Estado atual / O que substitui
Não existe endpoint de Art. 18. T-098 criou o schema. T-103 cobre só o
self-delete imediato.

## O que criar

### `src/app/api/support/data-deletion-request/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  reason: z.string().min(10).max(2000),
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // Detectar role para preencher user_role
  const role = (user.app_metadata?.role === 'PRESTADOR') ? 'PRESTADOR' : 'CLIENTE';

  // Já existe request pendente do mesmo user?
  const { data: existing } = await supabase
    .from('account_deletion_requests')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['pending','approved'])
    .limit(1);

  if (existing && existing.length > 0) {
    return Response.json({
      error: 'duplicate_request',
      message: 'Você já tem uma solicitação em andamento.',
      existingId: existing[0].id,
    }, { status: 409 });
  }

  // Calcular prazo legal: 5 anos para registros financeiros (default)
  const retentionDate = new Date();
  retentionDate.setFullYear(retentionDate.getFullYear() + 5);

  const { data, error } = await supabase
    .from('account_deletion_requests')
    .insert({
      user_id: user.id,
      user_role: role,
      request_type: 'art18_support',
      reason: body.reason,
      legal_retention_until: retentionDate.toISOString(),
      status: 'pending',
    })
    .select().single();

  if (error) return Response.json({ error: error.code }, { status: 400 });

  // TODO US futura: criar ticket no SUPORTE (US-024) com referência a este request
  return Response.json({ request: data });
}
```

## Constraints / NÃO fazer
- ❌ Auto-aprovar Art. 18 (requer análise pelo suporte)
- ❌ Permitir múltiplos pendentes simultâneos (1 por user)
- ❌ Anonimizar imediatamente (anonimização ocorre via job de T-098 quando
  retention vence E status=approved)
- ❌ Permitir reason curto (mínimo 10 chars para análise útil)
- ❌ Expor approved_by no GET para o user titular (campo é interno do suporte)

## Convenções
- Endpoint vive sob `/api/support/*` (não `/api/profile/*`) porque trata
  fluxo de suporte (Art. 18 ≠ self-delete; UX deve refletir essa fronteira)
- `user_role` derivado do app_metadata (não confiar no body)
- Zod min(10) reason: força explicação útil pro suporte
- Retention default 5 anos, ajustável em US futura via app_config$desc$,
 'API', 'CLIENTE',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG','RATE_LIMIT'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-105 UI: Hub de perfil cliente
('6f17b083-87c7-4c48-9707-c456d45cbd50',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-105',
 'Renderizar hub de perfil do cliente com cards de seções editáveis',
 $desc$## Objetivo
Cliente CLIENTE tem rota `/(client)/profile` acessível pela navegação
principal (AC #1). Mostra dados pessoais (nome, foto, telefone, email),
endereço principal e seção de consentimentos. Cada seção tem botão
"Editar" que abre o sheet correspondente (T-106, T-107, T-108).

## Contexto
Módulo PERFIL — entry point do CLIENTE para todas as edições. Server
Component que faz fetch agregado via DAL/multiple supabase calls. Modal
de re-consent (T-109) é montado em layout superior, dispara em mount.
Ação de exclusão de conta abre `ConfirmDialog` (T-110).

## Estado atual / O que substitui
`/(client)/profile` não existe. Hoje há apenas wizard de cadastro
(US-009 T-7151) e home placeholder (US-009 T-a3d9). Este hub centraliza.

## O que criar

### `src/app/(client)/profile/page.tsx`
```tsx
// Server Component
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ClientProfileHub } from '@/components/profile/ClientProfileHub';

export default async function ClientProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [profileRes, addressesRes, consentsRes, identitiesRes] = await Promise.all([
    supabase.from('client_profiles').select('*').eq('user_id', user.id).single(),
    supabase.from('client_addresses').select('*').eq('client_id', user.id)
      .order('is_primary', { ascending: false }),
    supabase.rpc('get_active_consents', { p_user_id: user.id }),
    supabase.auth.getUser(),
  ]);

  const identities = identitiesRes.data.user?.identities ?? [];
  const oauthProviders = identities.filter(i => i.provider !== 'email').map(i => i.provider);
  const hasPasswordFallback = identities.some(i => i.provider === 'email');

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <h1 className="text-2xl font-semibold">Meu perfil</h1>
      <ClientProfileHub
        profile={profileRes.data!}
        addresses={addressesRes.data ?? []}
        activeConsents={consentsRes.data ?? []}
        email={user.email ?? ''}
        emailReadOnly={oauthProviders.length > 0}
        oauthProviders={oauthProviders}
        canUnlinkOAuth={hasPasswordFallback && oauthProviders.length > 0}
      />
    </main>
  );
}
```

### `src/components/profile/ClientProfileHub.tsx`
- Cards: Pessoal, Endereços, Consentimentos, Conta
- Cada card renderiza preview + botão Editar que abre sheet
- Card Pessoal mostra email com tooltip "vinculado ao Google" se OAuth
- Banner offline quando navigator.onLine=false (AC #12 — usa
  `useOnlineStatus()` hook a criar)

## Constraints / NÃO fazer
- ❌ Buscar dados no client (server fetch tipado)
- ❌ Bloquear hub se não tem endereço (signup_step exigia, mas hub é
  acessível mesmo sem endereço cadastrado)
- ❌ Mostrar PII de outro user (RLS cobre, mas defensivo no fetch)
- ❌ Misturar UI de exclusão Art. 18 com self-delete (botões separados)

## Convenções
- Reuso: `Card`, `Skeleton`, `Sonner`, `Tooltip`
- Mobile-first; max-w-2xl em desktop
- Badge offline acima dos cards quando aplicável (AC #12)
- Sheet states geridos no parent (lift state pra coordinator)$desc$,
 'UI', 'CLIENTE',
 ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-106 UI: Sheet edição pessoal cliente (com OAuth + foto galeria/câmera)
('3c251097-b2ac-493d-a516-eeb3acb29fae',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-106',
 'Renderizar ResponsiveSheet de edição pessoal cliente com foto galeria/câmera',
 $desc$## Objetivo
Sheet aberto pelo hub (T-105) para editar nome, telefone, foto. Upload via
galeria ou câmera com **redimensionamento client-side** (AC #3). Email
read-only com tooltip "vinculado a Google/Apple" se OAuth (AC #4). Campo
revertido em erro mantendo o resto do form (AC #2).

## Contexto
Módulo PERFIL — `ResponsiveSheet` size="md". Reusa **estrutura** de T-092
(provider sheet) com diferenças:
- Email read-only com tooltip explicativo
- Botão "Desvincular Google" só aparece se `canUnlinkOAuth=true`
- Upload aceita `accept="image/*"` + `capture="environment"` (câmera mobile)
- Redimensionamento via canvas API antes do upload (max 1200x1200, JPEG q=0.85)

## Estado atual / O que substitui
T-092 é o sheet provider; este é o **equivalente cliente**. Componente
distinto pela natureza dos campos (cliente não tem categorias, banco, badge).

## O que criar

### `src/components/profile/ClientPersonalSheet.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { createBrowserClient } from '@/lib/supabase/client';
import { resizeImage } from '@/lib/image-utils';      // helper a criar
import { fetchOrThrow } from '@/lib/http';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { fullName: string; phone: string | null; avatarPath: string | null };
  email: string;
  emailReadOnly: boolean;
  oauthProviders: string[];
  userId: string;
  onSaved: (next: typeof initial) => void;
};

export function ClientPersonalSheet({ open, onOpenChange, initial, email,
  emailReadOnly, oauthProviders, userId, onSaved }: Props) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [avatarPath, setAvatarPath] = useState(initial.avatarPath);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const resized = await resizeImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.85 });
      const sb = createBrowserClient();
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from('client-avatars').upload(path, resized);
      if (error) throw error;
      setAvatarPath(path);
    } catch (e) {
      toast.error('Falha no upload da foto. Tente novamente.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setErrors({}); setBusy(true);
    const prevValues = { fullName, phone, avatarPath };
    try {
      const res = await fetchOrThrow('/api/profile/personal', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone: phone || null, avatarPath }),
        headers: { 'content-type': 'application/json' },
      });
      const { profile } = await res.json();
      onSaved({ fullName: profile.full_name, phone: profile.phone, avatarPath: profile.avatar_path });
      toast.success('Perfil atualizado');
      onOpenChange(false);
    } catch (e: any) {
      if (e?.status === 400 && e?.body?.issues) {
        const map: Record<string, string> = {};
        for (const i of e.body.issues) map[i.path[0]] = i.message;
        setErrors(map);
        // AC #2: campo errado é revertido (mantemos no input para usuário corrigir)
      } else {
        showErrorToast({ type: 'patch' } as any, e);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="md">
      <ResponsiveSheet.Header>Dados pessoais</ResponsiveSheet.Header>
      <ResponsiveSheet.Body>
        <FormBody density="comfortable">
          <Field name="avatar">
            <Field.Label>Foto</Field.Label>
            <Field.Control>
              <input type="file" accept="image/*" capture="environment"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </Field.Control>
            <Field.Hint>{uploading ? 'Processando...' : 'Galeria ou câmera. Será redimensionada automaticamente.'}</Field.Hint>
          </Field>

          <Field name="fullName" required error={errors.fullName}>
            <Field.Label>Nome completo</Field.Label>
            <Field.Control><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field.Control>
          </Field>

          <Field name="email">
            <Field.Label>E-mail</Field.Label>
            <Field.Control>
              <Input value={email} readOnly disabled />
            </Field.Control>
            <Field.Hint>
              {emailReadOnly
                ? `Vinculado a ${oauthProviders.join(', ')}. Para alterar, contate o suporte.`
                : 'O e-mail é usado como identificador único.'}
            </Field.Hint>
          </Field>

          <Field name="phone" error={errors.phone}>
            <Field.Label>Telefone (opcional)</Field.Label>
            <Field.Control><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field.Control>
            <Field.Hint>10 a 14 dígitos com DDD. Usado para notificações WhatsApp.</Field.Hint>
          </Field>
        </FormBody>
      </ResponsiveSheet.Body>
      <ResponsiveSheet.Footer>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button onClick={save} disabled={busy || uploading}>Salvar</Button>
      </ResponsiveSheet.Footer>
    </ResponsiveSheet>
  );
}
```

### `src/lib/image-utils.ts` (helper novo)
- `resizeImage(file: File, opts: { maxWidth, maxHeight, quality }): Promise<Blob>`
- Implementação via canvas: load → draw resized → toBlob('image/jpeg', quality)
- Retorna Blob redimensionado pronto pra upload

## Constraints / NÃO fazer
- ❌ Lib externa pra resize (canvas API basta; <1KB de código)
- ❌ Upload sem redimensionar (pode subir 8MP de smartphone — limite 2MB
  do bucket bloqueia, UX ruim)
- ❌ Editar email inline (rota separada por motivo de segurança/auth)
- ❌ Mostrar campo senha (AC #4 — quando OAuth não há senha visível)

## Convenções
- Reuso: `ResponsiveSheet`, `Field`/`FormBody`, `Input`, `Button`, `Tooltip`, `Sonner`
- Helper `image-utils.ts` é compartilhável (provider pode reusar em
  refactor futuro de T-092 se quiser redimensionamento)
- `capture="environment"` abre câmera em mobile; ignorado em desktop
- Telefone opcional pra cliente (provider exige obrigatório em T-092)$desc$,
 'UI', 'CLIENTE',
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-107 UI: Lista/sheet de endereços + set primary + offline indicator
('df043bbf-9b93-45e7-a3c8-8a06395974dc',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-107',
 'Renderizar gerenciamento de endereços (lista + sheet criar/editar + primary + offline)',
 $desc$## Objetivo
Permitir CLIENTE cadastrar/editar/excluir endereços salvos, definir
principal (AC #5, #6) e ver indicador de modo offline com fields
desabilitados (AC #12). Mutações com optimistic update via
`useOptimisticCollection`.

## Contexto
Módulo PERFIL — abre `ResponsiveSheet` para criar/editar; lista inline
no hub mostra todos os endereços salvos, com badge "Principal" no marcado.
ConfirmDialog para deletar; toast 409 explica "endereço em uso por serviço
em andamento". Hook `useOnlineStatus` (a criar) detecta `navigator.onLine`
e dispara reconnect handler.

## Estado atual / O que substitui
US-009 cobre cadastro **inicial** durante signup. Esta task é
**gerenciamento contínuo** com CRUD completo + UX de modo offline.

## O que criar

### `src/components/profile/AddressesList.tsx`
```tsx
'use client';
import { useState, useMemo } from 'react';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { useOnlineStatus } from '@/hooks/use-online-status';   // hook novo
import { ConfirmDialog, type ConfirmState } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AddressSheet } from './AddressSheet';
import { fetchOrThrow } from '@/lib/http';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';
import type { Address } from '@/lib/supabase/types';

export function AddressesList({ initial }: { initial: Address[] }) {
  const online = useOnlineStatus();
  const { items, mutate } = useOptimisticCollection<Address>(initial);
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  async function setPrimary(addr: Address) {
    if (!online) return;
    await mutate(
      { type: 'bulkPatch', ids: items.map(a => a.id), patch: (a) => ({ ...a, is_primary: a.id === addr.id }) },
      async (signal) => {
        const res = await fetchOrThrow(`/api/profile/addresses/${addr.id}/primary`, { method: 'POST', signal });
        if (!res.ok) throw new Error('falha');
      },
      { errorLabel: 'Falha ao definir como principal' }
    );
  }

  function askDelete(addr: Address) {
    setConfirm({
      title: 'Remover este endereço?',
      description: `${addr.label} • ${addr.street}, ${addr.number}`,
      confirmLabel: 'Remover',
      destructive: true,
      onConfirm: async () => {
        await mutate(
          { type: 'delete', id: addr.id },
          async (signal) => {
            const res = await fetchOrThrow(`/api/profile/addresses/${addr.id}`, { method: 'DELETE', signal });
            if (res.status === 409) {
              const body = await res.json();
              toast.error(body.message ?? 'Endereço em uso');
              throw new Error('in_use');
            }
            if (!res.ok) throw new Error('falha');
          },
          { errorLabel: 'Falha ao remover endereço' }
        );
      },
    });
  }

  return (
    <>
      {!online && (
        <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
          Você está offline. Edição liberada quando reconectar.
        </div>
      )}
      <div className="space-y-2 mt-2">
        {items.map(addr => (
          <Card key={addr.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <strong>{addr.label}</strong>
                {addr.is_primary && <Badge>Principal</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {addr.street}, {addr.number} — {addr.city}/{addr.state}
              </p>
            </div>
            <div className="flex gap-1">
              {!addr.is_primary && (
                <Button size="sm" variant="ghost" disabled={!online} onClick={() => setPrimary(addr)}>
                  Definir principal
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={!online} onClick={() => setEditing(addr)}>Editar</Button>
              <Button size="sm" variant="ghost" disabled={!online} onClick={() => askDelete(addr)}>Remover</Button>
            </div>
          </Card>
        ))}
      </div>
      <Button className="mt-3" disabled={!online} onClick={() => setEditing('new')}>+ Novo endereço</Button>

      {editing && (
        <AddressSheet
          open={!!editing}
          onOpenChange={() => setEditing(null)}
          initial={editing === 'new' ? null : editing}
          onSaved={(addr) => {
            mutate(
              editing === 'new' ? { type: 'create', item: addr } : { type: 'patch', id: addr.id, patch: () => addr },
              async () => addr,
              { errorLabel: 'Falha ao salvar endereço' }
            );
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
```

### `src/components/profile/AddressSheet.tsx`
- `ResponsiveSheet` size="md" com Field compound API
- Campos: label, zipCode, street, number, complement, neighborhood, city, state, reference, isPrimary checkbox
- ZIP lookup opcional via API ViaCEP (sem dep, fetch direto) — fora desta task
- POST /api/profile/addresses ou PATCH /api/profile/addresses/[id]

### `src/hooks/use-online-status.ts`
```typescript
'use client';
import { useEffect, useState } from 'react';
export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
```

## Constraints / NÃO fazer
- ❌ `setState` direto após fetch (sempre `mutate`)
- ❌ `window.confirm()` (sempre `ConfirmDialog`)
- ❌ Permitir edição offline (drafts complicam — bloquear visivelmente é
  UX mais simples e satisfaz AC #12)
- ❌ Re-fetch da lista após cada mutação (otimismo + reconcile basta)
- ❌ Lib pra ZIP lookup (ViaCEP via fetch é trivial)

## Convenções
- Reuso: `useOptimisticCollection`, `ConfirmDialog`, `ResponsiveSheet`,
  `Card`, `Badge`, `Button`, `Field`/`FormBody`, `Sonner`
- Hook `use-online-status.ts` é novo; pode ser reusado por outras telas
  que precisem do mesmo gate
- `set-primary` usa `bulkPatch` (atualiza todos local pra desmarcar antigo
  e marcar novo de uma vez, evitando inconsistência visual)$desc$,
 'UI', 'CLIENTE',
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-108 UI: Sheet de consentimentos (histórico + revogar)
('248d1c46-337a-49dc-a98b-9b890ad94a43',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-108',
 'Renderizar ResponsiveSheet "Meus consentimentos" com histórico e revogar não-essenciais',
 $desc$## Objetivo
CLIENTE acessa "Meus consentimentos" e vê histórico completo (data e
versão) de cada consentimento aceito ou revogado. Pode revogar
não-essenciais (AC #7). Essenciais aparecem com badge "Obrigatório" e
botão de revogar disabled.

## Contexto
Módulo PERFIL — `ResponsiveSheet` size="lg" com lista agrupada por kind:
- Active consents (badge verde "Ativo")
- Revoked consents (badge cinza "Revogado em DD/MM")
- Histórico cronológico de cada kind (collapsible)
GET `/api/profile/consents` (T-101) retorna `{history, active}`. Revogar
chama POST `/revoke` que insere nova linha (insert-only).

## Estado atual / O que substitui
Não existe UI de consents. Tela de signup (US-009 T-7151) só captura
aceite inicial.

## O que criar

### `src/components/profile/ConsentsSheet.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, type ConfirmState } from '@/components/ui/confirm-dialog';
import { fetchOrThrow } from '@/lib/http';
import { toast } from 'sonner';
import { format } from 'date-fns';

type ConsentRow = {
  id: string;
  kind: string;
  essential: boolean;
  revoked_at: string | null;
  createdAt: string;
  terms_version?: { version: string } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { history: ConsentRow[]; active: { kind: string; essential: boolean; version: string }[] };
  onChanged: () => Promise<void>;   // re-fetch após revogar
};

const KIND_LABELS: Record<string, string> = {
  terms_of_use: 'Termos de uso',
  privacy_policy: 'Política de privacidade',
  marketing_email: 'Marketing por e-mail',
  marketing_whatsapp: 'Marketing por WhatsApp',
};

export function ConsentsSheet({ open, onOpenChange, initial, onChanged }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  function askRevoke(active: { kind: string; essential: boolean }, latestId: string) {
    setConfirm({
      title: `Revogar "${KIND_LABELS[active.kind] ?? active.kind}"?`,
      description: 'Você pode reativar a qualquer momento atualizando suas preferências.',
      confirmLabel: 'Revogar',
      destructive: true,
      onConfirm: async () => {
        try {
          const res = await fetchOrThrow('/api/profile/consents/revoke', {
            method: 'POST',
            body: JSON.stringify({ consentId: latestId }),
            headers: { 'content-type': 'application/json' },
          });
          if (!res.ok) {
            const body = await res.json();
            toast.error(body.message ?? 'Não foi possível revogar.');
            return;
          }
          await onChanged();
          toast.success('Consentimento revogado');
        } catch {
          toast.error('Erro de conexão.');
        }
      },
    });
  }

  // Agrupar histórico por kind
  const byKind = initial.history.reduce((acc, row) => {
    (acc[row.kind] ??= []).push(row);
    return acc;
  }, {} as Record<string, ConsentRow[]>);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="lg">
      <ResponsiveSheet.Header>Meus consentimentos</ResponsiveSheet.Header>
      <ResponsiveSheet.Body>
        {Object.entries(byKind).map(([kind, rows]) => {
          const latest = rows[0];   // ordenado desc no API
          const active = !latest.revoked_at;
          return (
            <Card key={kind} className="p-3 mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <strong>{KIND_LABELS[kind] ?? kind}</strong>
                  <div className="flex gap-2 mt-1">
                    {latest.essential && <Badge variant="outline">Obrigatório</Badge>}
                    {active
                      ? <Badge>Ativo desde {format(new Date(latest.createdAt), 'dd/MM/yyyy')}</Badge>
                      : <Badge variant="secondary">Revogado em {format(new Date(latest.revoked_at!), 'dd/MM/yyyy')}</Badge>}
                    {latest.terms_version && <Badge variant="outline">v{latest.terms_version.version}</Badge>}
                  </div>
                </div>
                {active && !latest.essential && (
                  <Button size="sm" variant="ghost" onClick={() => askRevoke({ kind, essential: false }, latest.id)}>
                    Revogar
                  </Button>
                )}
              </div>
              <details className="mt-2">
                <summary className="text-sm text-muted-foreground cursor-pointer">Histórico ({rows.length})</summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {rows.map(r => (
                    <li key={r.id} className="flex justify-between">
                      <span>{r.revoked_at ? 'Revogado' : 'Aceito'}</span>
                      <span className="text-muted-foreground">
                        {format(new Date(r.revoked_at ?? r.createdAt), 'dd/MM/yyyy HH:mm')}
                        {r.terms_version && ` • v${r.terms_version.version}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          );
        })}
      </ResponsiveSheet.Body>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </ResponsiveSheet>
  );
}
```

## Constraints / NÃO fazer
- ❌ Permitir clicar em "Revogar" para essenciais (botão hidden/disabled)
- ❌ Dizer que revogar marketing afeta uso (AC #7 explicita "sem impacto")
- ❌ Mostrar PII de outros users (RLS cobre)
- ❌ Ocultar histórico de revogações (transparência LGPD exige)

## Convenções
- Reuso: `ResponsiveSheet`, `Card`, `Badge`, `Button`, `ConfirmDialog`, `Sonner`
- Agrupamento por kind no client (lista virá small, ~4-6 kinds × algumas linhas)
- Helper `KIND_LABELS` centraliza tradução; futuro pode mover pra constante exportada$desc$,
 'UI', 'CLIENTE',
 ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-109 UI: Modal re-consent global (gate em mount, suprime se serviço ativo)
('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-109',
 'Renderizar ReConsentGate global com modal bloqueante (suprime durante serviço ativo)',
 $desc$## Objetivo
Quando termos atualizam, CLIENTE vê modal de re-consent na próxima
abertura do app, antes de qualquer outra tela; não consegue prosseguir
até aceitar a nova versão (AC #8). **Exceção**: se há serviço em
andamento, o modal aguarda o serviço encerrar (AC #9).

## Contexto
Módulo PERFIL — componente provider montado no layout `/(client)/layout.tsx`
para cobrir todas as rotas autenticadas. No mount, chama
`/api/terms/current?audience=CLIENTE`; se `needsReconsent=true` E não há
serviço ativo, renderiza modal bloqueante (não-fechável até aceitar).
Polling leve para detectar fim do serviço ativo (alternativamente,
realtime channel de service_requests).

## Estado atual / O que substitui
Não existe gate de re-consent. Termos atualizados hoje não interrompem
fluxo do user.

## O que criar

### `src/components/profile/ReConsentGate.tsx`
```tsx
'use client';
import { useEffect, useState } from 'react';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { createBrowserClient } from '@/lib/supabase/client';
import { fetchOrThrow } from '@/lib/http';
import { toast } from 'sonner';

type TermsResponse = {
  current: { id: string; version: string; body_md: string } | null;
  needsReconsent: boolean;
  lastAcceptedVersion: string | null;
};

export function ReConsentGate() {
  const [terms, setTerms] = useState<TermsResponse | null>(null);
  const [hasActiveService, setHasActiveService] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // 1. Boot: pega termos + verifica serviço ativo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tRes, sRes] = await Promise.all([
          fetch('/api/terms/current?audience=CLIENTE'),
          fetch('/api/services/active-count'),   // endpoint a criar (ou via SDK)
        ]);
        if (cancelled) return;
        const tData: TermsResponse = await tRes.json();
        const sData = await sRes.json();
        setTerms(tData);
        setHasActiveService((sData.activeCount ?? 0) > 0);
      } catch {
        // Falha silenciosa — gate só opera se backend respondeu
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2. Realtime: monitora service_requests do user; quando todos finalizam,
  //    re-checa hasActiveService
  useEffect(() => {
    if (!terms?.needsReconsent || hasActiveService === false) return;
    const sb = createBrowserClient();
    const channel = sb.channel('reconsent-watcher')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'service_requests',
      }, () => {
        // recheca contagem
        fetch('/api/services/active-count').then(r => r.json()).then(d => {
          setHasActiveService((d.activeCount ?? 0) > 0);
        });
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [terms?.needsReconsent, hasActiveService]);

  async function accept() {
    if (!terms?.current) return;
    setBusy(true);
    try {
      const res = await fetchOrThrow('/api/terms/accept', {
        method: 'POST',
        body: JSON.stringify({ termsVersionId: terms.current.id }),
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        toast.error('Não foi possível registrar o aceite.');
        return;
      }
      toast.success('Aceite registrado');
      setTerms({ ...terms, needsReconsent: false });
    } finally {
      setBusy(false);
    }
  }

  // Gate só renderiza se: terms carregou, precisa reconsent, e SEM serviço ativo
  const shouldShow = terms?.needsReconsent && hasActiveService === false;
  if (!shouldShow || !terms?.current) return null;

  return (
    <ResponsiveDialog open onOpenChange={() => { /* não-fechável até aceitar */ }}>
      <ResponsiveDialog.Header>Atualização dos termos de uso</ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <p className="text-sm text-muted-foreground mb-2">
          Versão {terms.current.version}
          {terms.lastAcceptedVersion && ` (você aceitou v${terms.lastAcceptedVersion})`}
        </p>
        <div className="max-h-96 overflow-y-auto">
          <Markdown source={terms.current.body_md} />
        </div>
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button onClick={accept} disabled={busy}>Aceitar e continuar</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
```

### Montagem em `src/app/(client)/layout.tsx`
- Adicionar `<ReConsentGate />` logo abaixo do provider de auth e acima do conteúdo

### Endpoint auxiliar `/api/services/active-count` (server) — ou inline via DAL
- Retorna `{ activeCount: number }` baseado em service_requests do user
- Pode ser DAL puro chamado pelo Server Component se preferir (evitar round trip)

## Constraints / NÃO fazer
- ❌ Permitir fechar o modal sem aceitar (AC #8 explicita "não consegue prosseguir")
- ❌ Bloquear enquanto há serviço ativo (AC #9 — espera o serviço encerrar)
- ❌ Forçar prazo máximo (AC #8 — "sem prazo máximo forçado")
- ❌ Renderizar fora do `/(client)/layout.tsx` (PRESTADOR tem fluxo próprio)
- ❌ Acoplar ao hook de online status (re-consent é pre-requisito mesmo offline,
  mas accept exige network — UI mostra erro de network se offline)

## Convenções
- Reuso: `ResponsiveDialog`, `Button`, `Markdown`, `Sonner`
- Endpoint `/api/services/active-count` é fino; pode evoluir pra DAL helper
- Realtime watch via `service_requests` (RLS cobre — só vê próprios)
- Modal não-fechável: omitir handler de `onOpenChange` ou setar para no-op$desc$,
 'UI', 'CLIENTE',
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-110 UI: ConfirmDialog destrutivo de exclusão (digitar EXCLUIR) + trigger Art. 18
('c5d0b89b-236f-4f03-8ee6-be610f66a716',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '27445262-3265-49bc-87ef-f6e75ac8b307',
 'ZLAR-V2-T-110',
 'Renderizar exclusão de conta (digitar EXCLUIR) + trigger de Art. 18 LGPD',
 $desc$## Objetivo
Card "Conta" do hub (T-105) com 3 ações: Sair (logout), Excluir conta
(self-delete com confirmação digitando "EXCLUIR" — AC #10) e Solicitar
exclusão de dados via suporte (Art. 18 — AC #11). Cada ação abre o
diálogo apropriado.

## Contexto
Módulo PERFIL — componente análogo a T-094 (provider) mas com:
- Confirmação destrutiva exige digitar **literal "EXCLUIR"** (UX
  defensivo extra, não substitui server-side gate de T-103)
- Botão adicional "Solicitar exclusão LGPD" abre sheet com texto livre
  e POST /api/support/data-deletion-request (T-104)
- Reusa logout do US-002 T-5485 (importar handler ou duplicar minimal)

## Estado atual / O que substitui
T-094 cobre provider. Cliente precisa do mesmo padrão + dialog
diferenciado pra digitar "EXCLUIR" + sheet de Art. 18.

## O que criar

### `src/components/profile/ClientAccountActions.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog, type ConfirmState } from '@/components/ui/confirm-dialog';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createBrowserClient } from '@/lib/supabase/client';
import { fetchOrThrow } from '@/lib/http';
import { toast } from 'sonner';

export function ClientAccountActions() {
  const router = useRouter();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [art18Open, setArt18Open] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [art18Reason, setArt18Reason] = useState('');
  const [busy, setBusy] = useState(false);

  function askLogout() {
    setConfirm({
      title: 'Sair da conta?',
      confirmLabel: 'Sair',
      onConfirm: async () => {
        const sb = createBrowserClient();
        await sb.auth.signOut();
        router.push('/login');
      },
    });
  }

  async function executeDelete() {
    if (confirmText !== 'EXCLUIR') return;
    setBusy(true);
    try {
      const res = await fetchOrThrow('/api/profile/account', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json();
        if (body.error === 'has_active_services') {
          toast.error(body.message);
        } else {
          toast.error('Falha ao excluir conta');
        }
        return;
      }
      toast.success('Conta excluída');
      router.push('/');
    } finally {
      setBusy(false);
      setDeleteOpen(false);
      setConfirmText('');
    }
  }

  async function submitArt18() {
    if (art18Reason.length < 10) return;
    setBusy(true);
    try {
      const res = await fetchOrThrow('/api/support/data-deletion-request', {
        method: 'POST',
        body: JSON.stringify({ reason: art18Reason }),
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json();
        toast.error(body.message ?? 'Falha ao enviar solicitação');
        return;
      }
      toast.success('Solicitação enviada. O suporte responderá em até 15 dias úteis.');
      setArt18Open(false);
      setArt18Reason('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={askLogout}>Sair</Button>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Excluir conta</Button>
        <Button variant="ghost" onClick={() => setArt18Open(true)}>
          Solicitar exclusão de dados (LGPD Art. 18)
        </Button>
      </div>

      {/* Modal de exclusão com digitar EXCLUIR */}
      <ResponsiveDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ResponsiveDialog.Header>Excluir conta permanentemente</ResponsiveDialog.Header>
        <ResponsiveDialog.Body>
          <p className="text-sm text-muted-foreground mb-3">
            Esta ação é irreversível. Seu histórico será anonimizado conforme LGPD,
            mas registros financeiros serão preservados pelo prazo legal.
          </p>
          <FormBody density="compact">
            <Field name="confirm" required>
              <Field.Label>Digite "EXCLUIR" para confirmar</Field.Label>
              <Field.Control>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="EXCLUIR" />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
          <Button variant="destructive" disabled={confirmText !== 'EXCLUIR' || busy} onClick={executeDelete}>
            Excluir definitivamente
          </Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>

      {/* Sheet de Art. 18 com texto livre */}
      <ResponsiveDialog open={art18Open} onOpenChange={setArt18Open}>
        <ResponsiveDialog.Header>Solicitar exclusão de dados (LGPD Art. 18)</ResponsiveDialog.Header>
        <ResponsiveDialog.Body>
          <p className="text-sm text-muted-foreground mb-3">
            Sua solicitação será analisada pelo suporte em até 15 dias úteis.
            Documentos sensíveis serão removidos após o prazo legal de retenção fiscal.
          </p>
          <FormBody>
            <Field name="reason" required>
              <Field.Label>Motivo</Field.Label>
              <Field.Control>
                <Textarea value={art18Reason} onChange={(e) => setArt18Reason(e.target.value)} rows={5}
                  placeholder="Descreva o motivo da solicitação (mínimo 10 caracteres)..." />
              </Field.Control>
              <Field.Hint>{art18Reason.length}/2000 caracteres</Field.Hint>
            </Field>
          </FormBody>
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="ghost" onClick={() => setArt18Open(false)}>Cancelar</Button>
          <Button disabled={art18Reason.length < 10 || busy} onClick={submitArt18}>Enviar solicitação</Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
```

## Constraints / NÃO fazer
- ❌ `window.confirm()` ou `alert()` (sempre componentes do design system)
- ❌ Habilitar botão de excluir antes de digitar "EXCLUIR" exato (case-sensitive)
- ❌ Mostrar Art. 18 e self-delete como mesmo botão (fluxos diferentes,
  AC distintos)
- ❌ Auto-submit por Enter na input de "EXCLUIR" (UX intencionalmente friccional)
- ❌ Ocultar Art. 18 (LGPD obriga oferecer canal — botão visível sempre)

## Convenções
- Reuso: `ConfirmDialog`, `ResponsiveDialog`, `Button`, `Field`/`FormBody`,
  `Input`, `Textarea`, `Sonner`
- 3 ações distintas, 3 níveis visuais: outline (logout), destructive (delete),
  ghost (Art. 18 — disponível mas discreto)
- Validação de "EXCLUIR" client-side é UX; servidor já rejeita por status$desc$,
 'UI', 'CLIENTE',
 ARRAY['REUSE_EXISTING_COMPONENT','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- =====================================================================
-- 2) Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- =====================================================================
INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-096 (DATA avatar) → AC#1, #2, #3
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc'::uuid, 1),
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc'::uuid, 2),
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc'::uuid, 3),
  -- T-097 (DATA addresses+terms+consents) → AC#5, #6, #7, #8
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005'::uuid, 5),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005'::uuid, 6),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005'::uuid, 7),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005'::uuid, 8),
  -- T-098 (DATA deletion_requests) → AC#11
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd'::uuid, 11),
  -- T-099 (API personal) → AC#2, #4
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49'::uuid, 2),
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49'::uuid, 4),
  -- T-100 (API addresses) → AC#5, #6
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2'::uuid, 5),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2'::uuid, 6),
  -- T-101 (API consents) → AC#7
  ('8edcb034-7016-4695-b6a9-8d0a42719143'::uuid, 7),
  -- T-102 (API terms) → AC#8, #9
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b'::uuid, 8),
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b'::uuid, 9),
  -- T-103 (API delete account) → AC#10
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5'::uuid, 10),
  -- T-104 (API Art.18) → AC#11
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319'::uuid, 11),
  -- T-105 (UI hub) → AC#1, #4, #12
  ('6f17b083-87c7-4c48-9707-c456d45cbd50'::uuid, 1),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50'::uuid, 4),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50'::uuid, 12),
  -- T-106 (UI sheet pessoal) → AC#1, #2, #3, #4
  ('3c251097-b2ac-493d-a516-eeb3acb29fae'::uuid, 1),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae'::uuid, 2),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae'::uuid, 3),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae'::uuid, 4),
  -- T-107 (UI addresses) → AC#5, #6, #12
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc'::uuid, 5),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc'::uuid, 6),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc'::uuid, 12),
  -- T-108 (UI consents) → AC#7
  ('248d1c46-337a-49dc-a98b-9b890ad94a43'::uuid, 7),
  -- T-109 (UI re-consent modal) → AC#8, #9
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2'::uuid, 8),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2'::uuid, 9),
  -- T-110 (UI delete + Art.18) → AC#10, #11
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716'::uuid, 10),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716'::uuid, 11)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =====================================================================
-- 3) AC-da-Task (checklist técnico)
-- =====================================================================
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  -- T-096 DATA storage client-avatars
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc', 'Bucket client-avatars criado (public read, 2MB, jpeg/png/webp)', 1),
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc', 'Policies: CLIENTE só faz upload/update/delete em <auth.uid()>/<filename>', 2),
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc', 'Smoke: CLIENTE A não consegue upload em path do CLIENTE B', 3),
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc', 'client_profiles.avatar_path e avatar_updated_at criados', 4),

  -- T-097 DATA addresses+terms+consents
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'Migration aplicada; database.types.ts regenerado', 0),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'is_primary em client_addresses + UNIQUE parcial (1 primary por client)', 1),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'terms_versions criada com is_current UNIQUE parcial por audience', 2),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'lgpd_consents estendida com essential, revoked_at, replaces_id, terms_version_id', 3),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'Index lgpd_consents_user_kind_active acelera queries de "consents ativos"', 4),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'Function get_active_consents retorna kind/essential/version/accepted_at', 5),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'RLS terms_versions: SELECT público; ALL admin', 6),
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'Smoke: tentativa de 2 is_primary=true para mesmo client falha', 7),

  -- T-098 DATA deletion_requests + retention job
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'Migration aplicada; database.types.ts regenerado', 0),
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'account_deletion_requests com CHECK em request_type/status/user_role', 1),
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'RLS: own_read, own_create, admin_all', 2),
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'pg_cron job execute-deletion-retention agendado para 03:00 UTC diário', 3),
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'Function execute_deletion_retention_batch idempotente (filtro WHERE status=approved)', 4),
  ('eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'Smoke: CLIENTE A não vê requests de B', 5),

  -- T-099 API personal
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'PATCH valida body com Zod (400 com issues mapeáveis pelo client)', 0),
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'Atualiza só os campos enviados (patch parcial, telefone opcional)', 1),
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'Rejeita avatarPath que não comece com auth.uid()/', 2),
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'GET retorna profile + email + emailReadOnly + oauthProviders + canUnlinkOAuth', 3),
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'OAuth detection via supabase.auth.getUser().identities (não mock)', 4),
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'PATCH em colunas operacionais (signup_step, etc) bloqueado', 5),

  -- T-100 API addresses
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'POST cria endereço; PATCH atualiza; DELETE com gate de uso por service_request ativo', 0),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'POST /addresses/[id]/primary marca atomicamente via RPC set_address_primary', 1),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'DELETE retorna 409 address_in_use quando há service_request em status ativo', 2),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'Edição de primary não afeta service_requests em andamento (snapshot inline)', 3),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'GET ordena primary first, depois createdAt desc', 4),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'RLS: CLIENTE A não vê endereços de B (smoke)', 5),
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'Validação Zod (zipCode regex, state length 2, label min 1)', 6),

  -- T-101 API consents
  ('8edcb034-7016-4695-b6a9-8d0a42719143', 'GET retorna {history, active} ordenado cronologicamente', 0),
  ('8edcb034-7016-4695-b6a9-8d0a42719143', 'POST /revoke insere nova linha com replaces_id (insert-only mantido)', 1),
  ('8edcb034-7016-4695-b6a9-8d0a42719143', 'POST /revoke retorna 409 essential_consent quando essential=true', 2),
  ('8edcb034-7016-4695-b6a9-8d0a42719143', 'POST /revoke retorna 409 already_revoked quando latest tem revoked_at', 3),
  ('8edcb034-7016-4695-b6a9-8d0a42719143', 'RLS: CLIENTE A não vê consents de B', 4),

  -- T-102 API terms
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b', 'GET /current?audience=CLIENTE retorna current + needsReconsent + lastAcceptedVersion', 0),
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b', 'GET é público (acessível sem auth para leitura de termos pré-signup)', 1),
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b', 'POST /accept rejeita 409 not_current_version se id não é is_current', 2),
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b', 'POST /accept insere linha em lgpd_consents com kind=terms_of_use, essential=true', 3),
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b', 'Endpoint não força gate; UI decide quando renderizar modal', 4),

  -- T-103 API delete account cliente
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'Migration adiciona deleted_at em client_profiles', 0),
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'DELETE retorna 409 has_active_services se service_requests em status ativo', 1),
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'Sem ativos: anonimiza profile + addresses, hard-delete auth.users', 2),
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'RPC anonymize_client_profile preserva FK em service_requests/payments', 3),
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'INSERT em account_deletion_requests com request_type=self_delete, status=executed', 4),
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'Service role usado só server-side via createAdminClient()', 5),

  -- T-104 API Art.18
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'POST valida reason min 10 chars, max 2000', 0),
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'Retorna 409 duplicate_request se já existe pending/approved do user', 1),
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'Calcula legal_retention_until = NOW() + 5 anos (default fiscal)', 2),
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'user_role derivado do app_metadata.role (não do body)', 3),
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'INSERT em account_deletion_requests com status=pending', 4),
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'Rate limit aplicado (1 request por user por janela)', 5),

  -- T-105 UI hub cliente
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Rota /(client)/profile renderiza com user autenticado, redirect /login senão', 0),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Cards: Pessoal, Endereços, Consentimentos, Conta — cada um com botão Editar/ação', 1),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Dados pessoais mostram nome, foto, telefone, email com tooltip OAuth', 2),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Endereço principal aparece em destaque', 3),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Banner offline visível quando navigator.onLine=false (AC #12)', 4),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Server fetch agregado (Promise.all) sem N+1', 5),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', 'Mobile-first em <768px (cards empilham)', 6),

  -- T-106 UI sheet pessoal cliente
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'ResponsiveSheet abre em side-sheet desktop e bottom-sheet mobile (90dvh)', 0),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'Form usa Field compound API (sem react-hook-form, sem masked-input)', 1),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'Email read-only (input disabled) com tooltip se OAuth', 2),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'Upload aceita galeria E câmera (capture=environment)', 3),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'resizeImage redimensiona para max 1200x1200 JPEG q=0.85 antes do upload', 4),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'Erro 400 mostra mensagem inline e mantém valores digitados', 5),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'Toast sucesso "Perfil atualizado" após PATCH 200', 6),
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'Helper image-utils.ts criado e exportado', 7),

  -- T-107 UI addresses
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'Lista renderiza com primary first, badge "Principal" no marcado', 0),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'CRUD via useOptimisticCollection (sem setState pós-fetch)', 1),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'Set primary usa bulkPatch (atualiza todos local atomicamente)', 2),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'DELETE com 409 in_use mostra toast com mensagem específica', 3),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'Hook useOnlineStatus desabilita ações quando offline', 4),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'Banner amarelo visível quando offline', 5),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'AddressSheet usa Field compound API; ResponsiveSheet size="md"', 6),
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', 'ConfirmDialog destrutivo para delete (nunca window.confirm)', 7),

  -- T-108 UI consents
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', 'Sheet agrupa consents por kind com badge ativo/revogado e versão', 0),
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', 'Botão Revogar oculto/disabled para essentials', 1),
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', 'ConfirmDialog destrutivo na revogação', 2),
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', 'Histórico colapsável (<details>) por kind', 3),
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', 'Após POST /revoke 200, callback re-fetch atualiza estado', 4),
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', '409 essential_consent mostra toast de erro', 5),

  -- T-109 UI re-consent gate
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'Gate montado em /(client)/layout.tsx; cobre rotas autenticadas do cliente', 0),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'Bootstrap chama /api/terms/current + /api/services/active-count em paralelo', 1),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'Modal só renderiza se needsReconsent=true E activeCount=0', 2),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'Modal não-fechável até aceitar (onOpenChange no-op)', 3),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'Realtime watch em service_requests dispara recheck quando UPDATE chega', 4),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'POST /api/terms/accept esconde modal e mostra toast de sucesso', 5),
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', 'Sem prazo máximo forçado (modal só aparece quando seguro)', 6),

  -- T-110 UI delete + Art.18
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'Card Conta tem 3 botões: Sair (outline), Excluir (destructive), Art.18 (ghost)', 0),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'Modal de exclusão exige digitar "EXCLUIR" exato (case-sensitive) pra habilitar botão', 1),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', '409 has_active_services mostra toast com mensagem do servidor', 2),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'Modal Art.18 com Textarea min 10 chars e contador 0/2000', 3),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', '409 duplicate_request informa "já tem solicitação em andamento"', 4),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'Sucesso Art.18 mostra toast "responderá em até 15 dias úteis"', 5),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'Sem window.confirm() em nenhum ponto', 6),
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'Logout reusa padrão de US-002 T-5485 (signOut + redirect /login)', 7)
;

-- =====================================================================
-- 4) Dependências (kind lowercase: blocks | relates_to)
-- =====================================================================
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- Intra-US blocks
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'fda1d674-e4b1-4574-9154-55c8bccffcbc', 'blocks'),  -- API personal precisa avatars
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', '7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'blocks'),  -- API addresses precisa is_primary
  ('8edcb034-7016-4695-b6a9-8d0a42719143', '7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'blocks'),  -- API consents precisa schema
  ('5037b5d7-ba41-4f61-87f5-555e893ceb6b', '7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'blocks'),  -- API terms precisa terms_versions
  ('d6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'blocks'),  -- API Art.18 precisa schema
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'eb3c4f9f-1a5c-4fbd-9b6a-801f8688dedd', 'blocks'),  -- self-delete usa schema audit
  -- UI hub depende de todas APIs (relates)
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', '5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'relates_to'),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', '07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'relates_to'),
  ('6f17b083-87c7-4c48-9707-c456d45cbd50', '8edcb034-7016-4695-b6a9-8d0a42719143', 'relates_to'),
  -- Sheets blocks suas APIs
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', '5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'blocks'),  -- sheet pessoal
  ('3c251097-b2ac-493d-a516-eeb3acb29fae', 'fda1d674-e4b1-4574-9154-55c8bccffcbc', 'blocks'),  -- sheet pessoal precisa storage
  ('df043bbf-9b93-45e7-a3c8-8a06395974dc', '07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'blocks'),  -- addresses UI
  ('248d1c46-337a-49dc-a98b-9b890ad94a43', '8edcb034-7016-4695-b6a9-8d0a42719143', 'blocks'),  -- consents UI
  ('7017a2d5-f97f-4cd0-a4b0-ec6422f5c6b2', '5037b5d7-ba41-4f61-87f5-555e893ceb6b', 'blocks'),  -- re-consent UI
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', '951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'blocks'),  -- delete UI
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', 'd6da0be1-1e6d-4de1-b33f-f1411a0e4319', 'blocks'),  -- Art.18 UI
  -- Cross-US relates_to (reuso)
  ('fda1d674-e4b1-4574-9154-55c8bccffcbc', '3387bd93-0f2e-4692-b8e1-16490034edda', 'relates_to'),  -- T-096 ↔ T-086 (mesmo padrão)
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', '8105f3eb-4071-4370-b995-cbe215a97aa6', 'relates_to'),  -- T-099 ↔ T-087 (provider equiv)
  ('07d8115a-6ca1-45c3-a338-e86f31a49fc2', 'c63111bd-2964-4b5d-ad61-3d33778c65df', 'relates_to'),  -- T-100 ↔ US-009 client_addresses
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', '91d639dc-2242-49de-b489-3b38ac381b89', 'relates_to'),  -- T-099 ↔ US-009 client_profiles
  ('5ac9f0ca-80ee-4297-a762-fbd649a74b49', 'fd83e774-91b1-4493-8d95-dc8efd570ff5', 'relates_to'),  -- T-099 ↔ US-009 PATCH onboarding step
  ('8edcb034-7016-4695-b6a9-8d0a42719143', '7156f5db-c7e1-402c-8ae7-cf3900154623', 'relates_to'), -- T-101 ↔ lgpd_consents (US-001)
  ('951e2d2b-dc5a-4db5-8be1-b42bc69028a5', 'a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'relates_to'), -- T-103 ↔ T-090 (provider self-delete)
  ('c5d0b89b-236f-4f03-8ee6-be610f66a716', '84ea4c23-9f4c-4623-9971-68c7986eaa38', 'relates_to'), -- T-110 ↔ T-094 (provider AccountActions)
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', '7156f5db-c7e1-402c-8ae7-cf3900154623', 'relates_to'), -- T-097 estende lgpd_consents
  ('7afeb7a3-f9d7-4fe3-a2ad-75d10d734005', 'c63111bd-2964-4b5d-ad61-3d33778c65df', 'relates_to')  -- T-097 estende client_addresses
;

COMMIT;
