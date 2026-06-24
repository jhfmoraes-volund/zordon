-- Backlog cards (Zordon) para ZLAR-V2-US-007
-- "PRESTADOR edita perfil, dados pessoais, bancarios e logout" (módulo PERFIL)
-- 9 tasks: 1 DATA + 4 API + 4 UI
-- Refs: ZLAR-V2-T-086..094
-- Reuso forte: provider_profiles (US-001 T-706e), provider_categories (US-001 T-8f55),
--   provider_bank_accounts (US-003 T-3131), edição bancária (US-003 T-2ba1),
--   logout proxy invalidação (US-002 T-5485)

BEGIN;

-- =====================================================================
-- 1) Tasks
-- =====================================================================
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-086 DATA: storage bucket + extensão de provider_profiles para foto/avatar
('3387bd93-0f2e-4692-b8e1-16490034edda',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-086',
 'Provisionar storage bucket provider-avatars + colunas avatar em provider_profiles',
 $desc$## Objetivo
Habilitar upload e leitura de foto de perfil do prestador (avatar usado no hub
de perfil e no perfil público — AC #1, #2). Criar bucket Supabase Storage
público (read), com escrita restrita ao próprio PRESTADOR via policy.

## Contexto
Módulo PERFIL — pré-requisito para AC #2 (editar foto). `provider_profiles`
já existe (US-001 T-706e) com colunas básicas. Esta task **estende** a tabela
com `avatar_path` (caminho no bucket) e `avatar_updated_at`. O bucket é
público para leitura porque o avatar aparece no perfil público do prestador
(visível inclusive a anônimos no momento do matching).

## Estado atual / O que substitui
`provider_profiles` existe (US-001) sem campo de avatar. Não há bucket de
storage criado ainda. Esta é a **primeira** task de Storage do projeto —
seguir convenção `<feature>-<entity-plural>` para nome de bucket.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_avatars.sql`
```sql
BEGIN;

-- 1. Extender provider_profiles
ALTER TABLE provider_profiles
  ADD COLUMN avatar_path text,
  ADD COLUMN avatar_updated_at timestamptz;

-- 2. Criar bucket via SQL helper Supabase (idempotente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'provider-avatars',
  'provider-avatars',
  true,                                              -- leitura pública
  2 * 1024 * 1024,                                   -- 2MB max
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Policies de storage (escrita restrita)
-- Path convention: provider-avatars/<auth.uid()>/<filename>
CREATE POLICY "provider_upload_own_avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "provider_update_own_avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "provider_delete_own_avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura é pública via bucket.public=true (sem policy SELECT necessária)

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Bucket privado (perfil público precisa servir o avatar a anônimos)
- ❌ Permitir mime arbitrário (limitar a jpeg/png/webp evita upload de SVG com XSS)
- ❌ Limite > 2MB (PWA mobile, comprimir no cliente)
- ❌ Permitir delete de avatar de outro user (path sempre prefixado por auth.uid())

## Convenções
- Nome do bucket em kebab-case: `provider-avatars`
- Path no bucket: `<user_id>/<uuid>.jpg` (uuid evita colisão com cache de CDN)
- `avatar_path` armazena só o path interno (não a URL pública); a URL é
  derivada via `supabase.storage.from(...).getPublicUrl(path)` na UI
- `avatar_updated_at` permite invalidar cache do CDN appendando `?v=<timestamp>`$desc$,
 'DATA', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INDEX_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-087 API: PATCH /api/profile/personal
('8105f3eb-4071-4370-b995-cbe215a97aa6',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-087',
 'Implementar PATCH /api/profile/personal (nome, telefone, foto)',
 $desc$## Objetivo
Permitir que PRESTADOR edite dados pessoais campo a campo com validação
inline (AC #2). Endpoint atômico que aceita patch parcial dos campos
editáveis. Foto vem como `avatar_path` já uploaded; endpoint só persiste o
path e atualiza `avatar_updated_at`.

## Contexto
Módulo PERFIL — chamado pelos sheets de edição (T-092). Faz UPDATE em
`provider_profiles` da row do auth.uid(). RLS já cobre (PRESTADOR só edita
o próprio perfil). Validação Zod no servidor; cliente envia só os campos
alterados.

## Estado atual / O que substitui
Não existe endpoint de edição de perfil. `provider_profiles` é tocado
hoje só pelo onboarding (US-001 T-806).

## O que criar

### `src/app/api/profile/personal/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().regex(/^\+?\d{10,14}$/, 'telefone inválido').optional(),
  avatarPath: z.string().max(500).nullable().optional(),
}).refine(b => Object.keys(b).length > 0, 'pelo menos 1 campo é obrigatório');

export async function PATCH(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const update: Record<string, unknown> = {};
  if (body.fullName !== undefined) update.full_name = body.fullName;
  if (body.phone !== undefined) update.phone = body.phone;
  if (body.avatarPath !== undefined) {
    update.avatar_path = body.avatarPath;
    update.avatar_updated_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('provider_profiles')
    .update(update)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return Response.json({ error: error.code }, { status: 400 });
  return Response.json({ profile: data });
}
```

## Constraints / NÃO fazer
- ❌ Permitir PATCH em colunas operacionais (`account_status`, `kyc_status`,
  `level_badge`) — essas são reservadas a SISTEMA/ADMIN
- ❌ Validar telefone com regex permissiva — exigir 10-14 dígitos para
  funcionar com WhatsApp (US-024 mensageria)
- ❌ Aceitar avatarPath de outro usuário (RLS no storage já cobre,
  mas o endpoint **deve** rejeitar paths que não comecem com `<user_id>/`)
- ❌ Disparar notificação no PATCH (mudança de perfil não notifica)

## Convenções
- Endpoint segue padrão de US-003 T-2abd (`/api/profile/availability`)
- Validação de path do avatar: `avatarPath.startsWith(\`\${user.id}/\`)`
- Toast de confirmação fica na UI (`Sonner`); endpoint só retorna o profile atualizado
- Erros de validação Zod retornam 400 com mensagem específica (UI mostra inline)$desc$,
 'API', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-088 API: PATCH /api/profile/categories
('7443f8c8-c3e7-41d8-973a-f5434b047872',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-088',
 'Implementar PATCH /api/profile/categories (≥1, vale só pra futuras alocações)',
 $desc$## Objetivo
Permitir que PRESTADOR atualize suas categorias de atuação com regra de
negócio: pelo menos 1 categoria, **novas categorias valem apenas para
alocações futuras** (não afetam serviços em andamento) — AC #3.

## Contexto
Módulo PERFIL — chamado pelo sheet de edição de categorias (T-093).
Sobrescreve atomicamente as linhas em `provider_categories` (M:N criada
em US-001 T-8f55). Como matching só considera prestadores **disponíveis
no momento do broadcast**, a regra "vale para futuras" é satisfeita
automaticamente: serviços em andamento (`status IN ('accepted',
'in_progress')`) já têm `provider_id` resolvido e não são re-matched.

## Estado atual / O que substitui
`provider_categories` (M:N) existe mas só é populada no onboarding
(US-001 T-806). Não há endpoint de edição.

## O que criar

### `src/app/api/profile/categories/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  categoryIds: z.array(z.string().uuid()).min(1, 'selecione ao menos 1 categoria'),
});

export async function PATCH(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // RPC para garantir atomicidade (delete + insert em transação)
  const { data, error } = await supabase.rpc('replace_provider_categories', {
    p_provider_id: user.id,
    p_category_ids: body.categoryIds,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ categoryIds: data });
}
```

### RPC `replace_provider_categories(p_provider_id uuid, p_category_ids uuid[])`
- `LANGUAGE plpgsql SECURITY DEFINER`
- Valida `array_length(p_category_ids, 1) >= 1` (RAISE com sqlstate '22023' senão)
- DELETE de todas as `provider_categories` do prestador
- INSERT das novas linhas
- RETURN array dos IDs persistidos
- **Não toca** em `service_requests` em andamento — regra "futuras" é implícita

## Constraints / NÃO fazer
- ❌ Permitir lista vazia (CHECK `array_length >= 1`)
- ❌ Tentar remover categorias com tasks ativas — não precisa (matching só
  consulta `provider_categories` no momento do broadcast)
- ❌ Reordenar `provider_categories` por enquanto (não há campo `order`)
- ❌ Aceitar IDs que não existem em `service_categories` (FK cobre, mas
  RPC pode pre-validar com NOT EXISTS pra mensagem melhor)

## Convenções
- RPC SECURITY DEFINER porque DELETE/INSERT em batch fica atômico
- Cliente recebe array de UUIDs persistidos (idempotência)
- Sem trigger/audit (mudança rotineira, não-crítica)
- Para auditar futuro, considerar `provider_category_history` (fora desta US)$desc$,
 'API', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-089 API: PATCH /api/profile/bank-account (dual-account semantic)
('ef661d0e-0dea-4f5a-8f99-445a0e56386a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-089',
 'Implementar PATCH /api/profile/bank-account com regra de pagamentos agendados',
 $desc$## Objetivo
Permitir que PRESTADOR atualize conta bancária com semântica dupla
(AC #4): conta nova entra como `pending` em "Em verificação" ate gateway
confirmar; **pagamentos já agendados continuam usando a conta original
(active); novos payouts passam a usar a nova conta apos validacao**.

## Contexto
Módulo PERFIL — chamado pelo sheet de edição bancária. **Estende** o
endpoint criado em US-003 T-05c9 (`POST/PATCH/GET /api/profile/bank-account`)
com semântica de **substituição não-destrutiva**: ao invés de UPDATE
in-place, **insere uma nova linha em `provider_bank_accounts` com status
`pending`** e mantém a row anterior `active` enquanto houver payouts
agendados referenciando-a. Assim que webhook do gateway aprovar a nova
conta, a UI/job marca a antiga como `superseded` e a nova como `active`.

## Estado atual / O que substitui
`provider_bank_accounts` (criada em US-003 T-3131) já tem `status enum`
com valores `pending|active|rejected`. Esta task **adiciona** o valor
`superseded` ao enum e introduz a semântica dual-account neste endpoint.
US-003 T-05c9 é o cadastro inicial (primeira conta); aqui é o **fluxo de
substituição**.

## O que criar

### `src/app/api/profile/bank-account/route.ts` (estende existing)
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  bankCode: z.string().regex(/^\d{3}$/),
  agency: z.string().regex(/^\d{4,5}(-\d)?$/),
  account: z.string().regex(/^\d{4,12}(-\d)?$/),
  accountType: z.enum(['checking','savings']),
  holderName: z.string().min(2).max(120),
  holderDocument: z.string().regex(/^\d{11}$|^\d{14}$/),
});

// PATCH = substituir conta. POST (US-003 T-05c9) = primeira conta.
export async function PATCH(req: Request) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // RPC garante: insere new (pending) sem mexer na active; valida que não
  // há outra pending pendente de validação (evita 3+ contas vivas)
  const { data, error } = await supabase.rpc('submit_bank_account_replacement', {
    p_provider_id: user.id,
    p_bank_code: body.bankCode,
    p_agency: body.agency,
    p_account: body.account,
    p_account_type: body.accountType,
    p_holder_name: body.holderName,
    p_holder_document: body.holderDocument,
  });
  if (error?.code === 'P0001') return Response.json({ error: 'replacement_pending' }, { status: 409 });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ account: data });
}
```

### RPC `submit_bank_account_replacement(...)`
- SECURITY DEFINER, language plpgsql
- INSERT em `provider_bank_accounts` com `status='pending'`
- RAISE EXCEPTION (sqlstate 'P0001') se já existir row `pending` para o prestador
- Não modifica row `active` existente
- Retorna a row criada

### Migration auxiliar: enum `superseded`
```sql
BEGIN;
ALTER TYPE bank_account_status ADD VALUE IF NOT EXISTS 'superseded';
COMMIT;
```

### Hook do gateway (sem implementar aqui — apenas referenciar)
- Webhook do gateway (vive em US-003 T-a993 ou Edge Function dedicada)
  aprova a `pending` → atualiza para `active`
- Trigger pós-UPDATE marca a `active` antiga como `superseded` quando
  detectar nova `active` pro mesmo provider_id
- Job de payout consulta `provider_bank_accounts` filtrando
  `status='active'` no momento de gerar a transferência

## Constraints / NÃO fazer
- ❌ UPDATE in-place na conta `active` (perde rastreabilidade dos payouts)
- ❌ Permitir mais de 1 `pending` simultânea (limita complexidade)
- ❌ Rejeitar PATCH se houver payouts agendados (a regra é justamente
  manter a conta velha para esses)
- ❌ Validar conta no servidor (gateway faz; aqui só persiste como pending)
- ❌ Retornar PII completa do `holder_document` no GET (mascarar últimos 4)

## Convenções
- Idempotency-Key não obrigatório (RPC já trata duplicação via constraint pending)
- Logs estruturados: `entity=provider_bank_account, action=replace_submit`
- Validação CPF/CNPJ formato apenas (digit-check fica no gateway)
- Reuso: `provider_bank_accounts` (US-003 T-3131), padrão de RPC SECURITY DEFINER$desc$,
 'API', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-090 API: DELETE /api/profile/account (com bloqueio se serviços ativos)
('a3ee1141-26a4-44f9-aa82-7e5eca133a9a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-090',
 'Implementar DELETE /api/profile/account com bloqueio se serviços ativos',
 $desc$## Objetivo
Permitir que PRESTADOR exclua a conta com gate de segurança: **bloqueia
exclusão se houver `service_requests` em status ativo** (`accepted`,
`in_progress`, `payment_pending`, `dispute_open`) onde o prestador é
parte. Retorna 409 com mensagem clara orientando a concluir/cancelar
antes (AC #5).

## Contexto
Módulo PERFIL — chamado pelo `ConfirmDialog` de exclusão (T-094). LGPD
exige right-to-erasure, mas plataforma precisa proteger contratos em
andamento. Solução: hard-delete da conta auth + soft-delete (anonimização)
de `provider_profiles` (mantém ID pra integridade referencial em logs e
em `service_requests` históricos).

## Estado atual / O que substitui
Não existe endpoint de exclusão de conta. `provider_profiles` não tem
campo `deleted_at`. Esta task **adiciona** o campo + RPC de anonimização.

## O que criar

### `src/app/api/profile/account/route.ts`
```typescript
import { createClient, createAdminClient } from '@/lib/supabase';

export async function DELETE(_req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // 1. Gate: serviços ativos?
  const { data: active } = await supabase
    .from('service_requests')
    .select('id, status')
    .eq('provider_id', user.id)
    .in('status', ['accepted','in_progress','payment_pending','dispute_open'])
    .limit(1);

  if (active && active.length > 0) {
    return Response.json({
      error: 'has_active_services',
      message: 'Conclua ou cancele seus serviços ativos antes de excluir a conta.',
      activeServiceCount: active.length,
    }, { status: 409 });
  }

  // 2. Anonimização atômica
  const admin = createAdminClient();
  const { error: anonErr } = await admin.rpc('anonymize_provider_profile', {
    p_provider_id: user.id,
  });
  if (anonErr) return Response.json({ error: anonErr.message }, { status: 500 });

  // 3. Hard-delete auth.users (admin API)
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 });

  return Response.json({ deleted: true });
}
```

### RPC `anonymize_provider_profile(p_provider_id uuid)`
- SECURITY DEFINER
- UPDATE em `provider_profiles` SET full_name='Conta excluída', phone=NULL,
  avatar_path=NULL, account_status='deleted', deleted_at=NOW()
- DELETE em `provider_categories` (sem FK em service_requests)
- DELETE em `provider_availability_windows`
- UPDATE `provider_bank_accounts` SET status='superseded', holder_document=NULL,
  account=NULL, agency=NULL (mantém row para auditoria de payouts passados)
- INSERT em `provider_moderation_log` (criado em US-001 ou afim) com
  action='self_delete', actor=p_provider_id

### Migration auxiliar
```sql
BEGIN;
ALTER TABLE provider_profiles
  ADD COLUMN deleted_at timestamptz;
ALTER TYPE provider_account_status ADD VALUE IF NOT EXISTS 'deleted';
COMMIT;
```

## Constraints / NÃO fazer
- ❌ Hard-delete `provider_profiles` (quebra FK em `service_requests`,
  `service_events`, `dispute_decisions` históricos)
- ❌ Permitir DELETE com qualquer serviço em andamento (UX clara: fala
  o quê concluir antes)
- ❌ Reverter exclusão (após hard-delete em auth.users não há volta)
- ❌ Notificar via WhatsApp/email após delete (canal já invalidado)
- ❌ Confiar só na UI pra conferir status (gate é server-side)

## Convenções
- Status terminal `deleted` em `provider_account_status` (separado de `blocked`)
- Logs estruturados: `entity=provider_account, action=self_delete`
- LGPD: mantém pseudonimização pra auditoria de N anos (definição em US-019)
- Reuso: padrão de gate por status já usado em US-002 T-058d (proxy guard)$desc$,
 'API', 'PRESTADOR',
 ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-091 UI: Hub de perfil (read summary)
('78a48bee-4c69-489f-8321-b6bc6a1efe34',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-091',
 'Renderizar hub de perfil do prestador com cards de seções editáveis',
 $desc$## Objetivo
Cliente PWA do PRESTADOR tem rota `/(provider)/profile` acessível pela
navegação principal a qualquer momento (AC #1). Mostra dados pessoais,
foto, badge de nível, avaliações recebidas, categorias, conta bancária,
link para perfil público. Cada seção tem botão "Editar" que abre o sheet
correspondente (T-092, T-093, ou navega para tela existente de banco T-2ba1).

## Contexto
Módulo PERFIL — entry point do prestador para todas as edições. Server
Component que faz fetch agregado dos dados via DAL. Ações de edição
abrem `ResponsiveSheet` (client). Página renderiza tudo já hidratado;
mutações otimistas via `useOptimisticCollection` ficam dentro de cada sheet.

## Estado atual / O que substitui
`/(provider)/profile` não existe. Hoje há apenas tela de cadastro
(US-001 T-407) e edição bancária (US-003 T-2ba1) acessada por outros
fluxos. Este hub centraliza a navegação.

## O que criar

### `src/app/(provider)/profile/page.tsx`
```tsx
// Server Component
import { createClient } from '@/lib/supabase/server';
import { ProfileHubSections } from '@/components/profile/ProfileHubSections';
import { redirect } from 'next/navigation';

export default async function ProviderProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [profileRes, categoriesRes, bankRes, ratingsRes] = await Promise.all([
    supabase.from('provider_profiles').select('*').eq('user_id', user.id).single(),
    supabase.from('provider_categories')
      .select('category_id, service_categories(id,name,slug)')
      .eq('provider_id', user.id),
    supabase.from('provider_bank_accounts')
      .select('*')
      .eq('provider_id', user.id)
      .in('status', ['active','pending'])
      .order('createdAt', { ascending: false }),
    supabase.from('service_ratings_summary_v')
      .select('rating_avg, rating_count')
      .eq('provider_id', user.id)
      .maybeSingle(),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <h1 className="text-2xl font-semibold">Meu perfil</h1>
      <ProfileHubSections
        profile={profileRes.data!}
        categories={categoriesRes.data ?? []}
        bankAccounts={bankRes.data ?? []}
        ratings={ratingsRes.data}
      />
    </main>
  );
}
```

### `src/components/profile/ProfileHubSections.tsx`
- Cards (`Card` do design system) por seção: Pessoal, Categorias, Bancário,
  Avaliações, Conta
- Cada card renderiza preview + botão "Editar" que abre Sheet correspondente
- Card "Conta": logout + excluir conta (abre `ConfirmDialog` de T-094)
- Link "Ver meu perfil público" (rota a definir em outra US, aqui só placeholder)

## Constraints / NÃO fazer
- ❌ Buscar dados no client (server fetch é mais rápido e tipado)
- ❌ Inline editing nos cards (UX confusa em mobile — sheets dedicados)
- ❌ Bloquear hub se KYC pendente (a US é sobre **manter** dados, não
  sobre completar onboarding — banner de pendência fica em US-003 T-ffeb)

## Convenções
- Reuso: `Card`, `Skeleton` (loading transitions), `Sonner` (erro)
- Mobile-first; em desktop max-w-2xl com cards empilhados
- Cada sheet tem state aberto local; lifting state ao parent só se necessário
- `service_ratings_summary_v` é uma view a ser criada em US futura;
  enquanto não existir, fallback para zeros no componente (defensivo)$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-092 UI: Sheet de edição de dados pessoais (com upload de foto)
('302665a0-d48e-48cf-aeb4-8c7db398627b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-092',
 'Renderizar ResponsiveSheet de edição de dados pessoais com upload de foto',
 $desc$## Objetivo
Sheet aberto pelo hub (T-091) para editar nome, telefone e foto, com
validação inline e toast de confirmação; tentativa de salvar com dado
inválido mostra mensagem específica **sem perder o resto do formulário**
(AC #2).

## Contexto
Módulo PERFIL — `ResponsiveSheet` size="md" abre em desktop como side-sheet
(640px) e em mobile como bottom-sheet (90dvh). Form usa Field compound API
(sem react-hook-form, sem masked-input). Upload de foto faz upload direto
ao bucket (T-086) antes de chamar PATCH (T-087); após sucesso, fecha sheet
e mostra toast "Perfil atualizado".

## Estado atual / O que substitui
Não existe sheet de edição de perfil pessoal. Cadastro (US-001 T-407)
usa wizard multi-step, mas sem reuso de componentes (este sheet **não**
reutiliza o wizard).

## O que criar

### `src/components/profile/PersonalSheet.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createBrowserClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { fetchOrThrow } from '@/lib/http';
import { showErrorToast } from '@/lib/optimistic/toast';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { fullName: string; phone: string; avatarPath: string | null };
  userId: string;
  onSaved: (next: typeof initial) => void;
};

export function PersonalSheet({ open, onOpenChange, initial, userId, onSaved }: Props) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [avatarPath, setAvatarPath] = useState(initial.avatarPath);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function uploadPhoto(file: File) {
    const sb = createBrowserClient();
    const ext = file.name.split('.').pop();
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('provider-avatars').upload(path, file);
    if (error) throw error;
    setAvatarPath(path);
  }

  async function save() {
    setErrors({});
    setBusy(true);
    try {
      const res = await fetchOrThrow('/api/profile/personal', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone, avatarPath }),
        headers: { 'content-type': 'application/json' },
      });
      const { profile } = await res.json();
      onSaved({ fullName: profile.full_name, phone: profile.phone, avatarPath: profile.avatar_path });
      toast.success('Perfil atualizado');
      onOpenChange(false);
    } catch (e: any) {
      // 400 com Zod issues -> mapeia para errors inline
      if (e?.status === 400 && e?.body?.issues) {
        const map: Record<string, string> = {};
        for (const i of e.body.issues) map[i.path[0]] = i.message;
        setErrors(map);
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
          {/* Foto: input file + preview */}
          <Field name="avatar">
            <Field.Label>Foto</Field.Label>
            <Field.Control>
              <input type="file" accept="image/jpeg,image/png,image/webp"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
            </Field.Control>
            <Field.Hint>JPG/PNG/WebP, máximo 2MB</Field.Hint>
          </Field>

          <Field name="fullName" required error={errors.fullName}>
            <Field.Label>Nome completo</Field.Label>
            <Field.Control><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field.Control>
          </Field>

          <Field name="phone" required error={errors.phone}>
            <Field.Label>Telefone (com DDD)</Field.Label>
            <Field.Control><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field.Control>
            <Field.Hint>10 a 14 dígitos. Será usado para WhatsApp.</Field.Hint>
          </Field>
        </FormBody>
      </ResponsiveSheet.Body>
      <ResponsiveSheet.Footer>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button onClick={save} disabled={busy}>Salvar</Button>
      </ResponsiveSheet.Footer>
    </ResponsiveSheet>
  );
}
```

## Constraints / NÃO fazer
- ❌ `<Dialog>` ou `<Sheet>` cru (sempre `ResponsiveSheet`)
- ❌ `<input>` cru sem `Field` wrapper
- ❌ react-hook-form / Zod no client
- ❌ Masked-input lib (telefone como `type="tel"` aceita formatação livre)
- ❌ Limpar form ao erro de validação (preserva input do usuário)
- ❌ Upload de foto via endpoint próprio (Supabase Storage tem upload direto
  via JWT; criar endpoint intermediário é overhead inútil)

## Convenções
- Reuso: `ResponsiveSheet`, `Field`/`FormBody`, `Input`, `Button`, `Sonner`
- Erros 400 com Zod issues mapeiam para `errors[fieldName]` exibidos inline
- Toast de sucesso usa `sonner.toast.success`
- Estado local: `useState` (sem store global pra um sheet)$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-093 UI: Sheet de edição de categorias
('6442c09f-07ad-4c51-8af6-f7e154ae132a',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-093',
 'Renderizar ResponsiveSheet de seleção de categorias com regra ≥1',
 $desc$## Objetivo
Sheet aberto pelo hub (T-091) para selecionar categorias de atuação, com
**bloqueio** de salvar se 0 selecionadas; banner informativo "Novas
categorias valem só pra alocações futuras" (AC #3).

## Contexto
Módulo PERFIL — abre `ResponsiveSheet` size="lg" (760px desktop) com
checklist de categorias do catálogo (`service_categories`, criado em
US-001 T-78ce). Multi-select otimista local; persiste via PATCH
`/api/profile/categories` (T-088). Banner amarelo no topo do sheet
informa a regra de "futuras alocações".

## Estado atual / O que substitui
Cadastro (US-001 T-407) já tem step de seleção de categorias, mas como
parte do wizard. Este sheet é a versão **edição** — independente, com
banner de regra e validação local de mínimo 1.

## O que criar

### `src/components/profile/CategoriesSheet.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchOrThrow } from '@/lib/http';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';

type Cat = { id: string; name: string; slug: string };
type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allCategories: Cat[];
  initialSelected: string[];
  onSaved: (next: string[]) => void;
};

export function CategoriesSheet({ open, onOpenChange, allCategories, initialSelected, onSaved }: Props) {
  const [selected, setSelected] = useState(new Set(initialSelected));
  const [busy, setBusy] = useState(false);
  const minError = selected.size === 0;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function save() {
    if (minError) return;
    setBusy(true);
    try {
      const res = await fetchOrThrow('/api/profile/categories', {
        method: 'PATCH',
        body: JSON.stringify({ categoryIds: [...selected] }),
        headers: { 'content-type': 'application/json' },
      });
      const { categoryIds } = await res.json();
      onSaved(categoryIds);
      toast.success('Categorias atualizadas');
      onOpenChange(false);
    } catch (e) {
      showErrorToast({ type: 'patch' } as any, e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="lg">
      <ResponsiveSheet.Header>Categorias de atuação</ResponsiveSheet.Header>
      <ResponsiveSheet.Body>
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
          Novas categorias valem para <strong>novas alocações</strong>.
          Serviços em andamento mantêm a categoria com a qual foram aceitos.
        </div>
        <ul className="mt-4 space-y-2">
          {allCategories.map(c => (
            <li key={c.id}>
              <label className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {minError && <p className="text-sm text-destructive mt-2">Selecione pelo menos 1 categoria.</p>}
      </ResponsiveSheet.Body>
      <ResponsiveSheet.Footer>
        <Badge>{selected.size} selecionadas</Badge>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button onClick={save} disabled={busy || minError}>Salvar</Button>
      </ResponsiveSheet.Footer>
    </ResponsiveSheet>
  );
}
```

## Constraints / NÃO fazer
- ❌ Permitir clicar Salvar com 0 selecionadas (botão disabled)
- ❌ Avisar mudança imediata sem mencionar a regra de "futuras"
- ❌ Recarregar lista de categorias do server toda hora (passa via prop;
  catálogo não muda em runtime)
- ❌ Substituir checkbox por chip select (UX de checklist é mais clara
  para multi-select de N=7)

## Convenções
- Reuso: `ResponsiveSheet`, `Button`, `Badge`, `Sonner`
- Banner de regra com classe estática (sem componente novo)
- Estado local com `Set<string>` (mais barato que array para toggle)
- Mobile-first; em desktop size="lg" comporta os 7+ itens sem scroll$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-094 UI: Logout + ConfirmDialog de exclusão de conta
('84ea4c23-9f4c-4623-9971-68c7986eaa38',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 'f7cad2d4-14ed-4056-afbb-8f601fedba2d',
 'ZLAR-V2-T-094',
 'Renderizar ações de logout e exclusão de conta com ConfirmDialog',
 $desc$## Objetivo
Botões "Sair" e "Excluir conta" no card "Conta" do hub (T-091). Logout
abre `ConfirmDialog` simples; excluir conta abre `ConfirmDialog`
destrutivo que dispara DELETE (T-090) e trata erro 409 mostrando
mensagem específica orientando a concluir/cancelar serviços ativos
antes (AC #5).

## Contexto
Módulo PERFIL — encerramento da sessão usa `signOut()` do Supabase
client + redirect para `/login`. Reuso forte do logout introduzido em
US-002 T-5485 (logout no menu de perfil) — esta task **complementa**
adicionando o botão dentro do hub e a ação de delete. Ambas usam
`ConfirmDialog` (proibido `window.confirm()`).

## Estado atual / O que substitui
Logout existe via menu de perfil (US-002 T-5485). Não há UI de exclusão
de conta. Esta task **adiciona** os botões no hub e o dialog de exclusão.

## O que criar

### `src/components/profile/AccountActions.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog, type ConfirmState } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { createBrowserClient } from '@/lib/supabase/client';
import { fetchOrThrow } from '@/lib/http';
import { toast } from 'sonner';

export function AccountActions() {
  const router = useRouter();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  function askLogout() {
    setConfirm({
      title: 'Sair da conta?',
      description: 'Você precisará entrar novamente para continuar.',
      confirmLabel: 'Sair',
      onConfirm: async () => {
        const sb = createBrowserClient();
        await sb.auth.signOut();
        router.push('/login');
      },
    });
  }

  function askDelete() {
    setConfirm({
      title: 'Excluir conta permanentemente?',
      description: 'Esta ação é irreversível. Seu histórico ficará anonimizado.',
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow('/api/profile/account', { method: 'DELETE' });
          toast.success('Conta excluída.');
          router.push('/');
        } catch (e: any) {
          if (e?.status === 409 && e?.body?.error === 'has_active_services') {
            toast.error(e.body.message || 'Conclua ou cancele seus serviços ativos antes.');
          } else {
            toast.error('Não foi possível excluir a conta. Tente novamente.');
          }
        }
      },
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={askLogout}>Sair</Button>
        <Button variant="destructive" onClick={askDelete}>Excluir conta</Button>
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
```

## Constraints / NÃO fazer
- ❌ `window.confirm()` ou `alert()` (proibido)
- ❌ Excluir conta inline sem confirmação destrutiva
- ❌ Tratar 409 com toast genérico (mensagem deve orientar passos)
- ❌ Redirecionar após delete sem `signOut()` implícito (admin já deletou
  o auth user; cliente já está sem sessão válida)
- ❌ Botão de exclusão grande e em destaque (UX de "ação rara e perigosa":
  texto destrutivo mas tamanho normal)

## Convenções
- Reuso: `ConfirmDialog`, `Button` (variant outline + destructive), `Sonner`
- `ConfirmDialog` trata busy + close async (não precisa try/finally aqui)
- Após delete, redirect para `/` (rota pública); SSR pega o estado deslogado$desc$,
 'UI', 'PRESTADOR',
 ARRAY['REUSE_EXISTING_COMPONENT','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- =====================================================================
-- 2) Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- =====================================================================
INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-086 (DATA avatar storage): suporta AC#1 (foto no hub) e AC#2 (editar foto)
  ('3387bd93-0f2e-4692-b8e1-16490034edda'::uuid, 1),
  ('3387bd93-0f2e-4692-b8e1-16490034edda'::uuid, 2),
  -- T-087 (API personal): AC#2 editar nome/telefone/foto
  ('8105f3eb-4071-4370-b995-cbe215a97aa6'::uuid, 2),
  -- T-088 (API categories): AC#3 categorias com ≥1 e regra futuras
  ('7443f8c8-c3e7-41d8-973a-f5434b047872'::uuid, 3),
  -- T-089 (API bank): AC#4 bancário em verificação + dual-account
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a'::uuid, 4),
  -- T-090 (API delete): AC#5 logout + bloqueio de exclusão
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a'::uuid, 5),
  -- T-091 (UI hub): AC#1 hub com tudo visível
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34'::uuid, 1),
  -- T-092 (UI sheet pessoal): AC#1 (preview no hub) e AC#2 (editar)
  ('302665a0-d48e-48cf-aeb4-8c7db398627b'::uuid, 1),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b'::uuid, 2),
  -- T-093 (UI sheet categorias): AC#3 categorias
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a'::uuid, 3),
  -- T-094 (UI logout/delete): AC#5
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38'::uuid, 5)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;

-- =====================================================================
-- 3) AC-da-Task (checklist técnico → checkbox no TaskSheet)
-- =====================================================================
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  -- T-086 DATA storage
  ('3387bd93-0f2e-4692-b8e1-16490034edda', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('3387bd93-0f2e-4692-b8e1-16490034edda', 'Bucket provider-avatars criado (public read, 2MB limit, mime jpeg/png/webp)', 1),
  ('3387bd93-0f2e-4692-b8e1-16490034edda', 'Policy: PRESTADOR só faz upload/update/delete em <auth.uid()>/<filename>', 2),
  ('3387bd93-0f2e-4692-b8e1-16490034edda', 'Smoke: PRESTADOR A não consegue upload em path do PRESTADOR B (RLS storage)', 3),
  ('3387bd93-0f2e-4692-b8e1-16490034edda', 'provider_profiles.avatar_path e avatar_updated_at criados', 4),

  -- T-087 API personal
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', 'PATCH valida body com Zod (400 em formato inválido com issues mapeáveis pelo client)', 0),
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', 'Atualiza só os campos enviados (patch parcial)', 1),
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', 'Rejeita avatarPath que não comece com auth.uid()/', 2),
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', '403/RLS quando user tenta editar perfil de outro provider (smoke)', 3),
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', 'avatar_updated_at atualizado quando avatarPath muda', 4),
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', 'Não permite PATCH em colunas operacionais (account_status, kyc_status, level_badge)', 5),

  -- T-088 API categories
  ('7443f8c8-c3e7-41d8-973a-f5434b047872', 'PATCH valida categoryIds.length >= 1 (400 com mensagem se vazio)', 0),
  ('7443f8c8-c3e7-41d8-973a-f5434b047872', 'RPC replace_provider_categories executa DELETE+INSERT em transação', 1),
  ('7443f8c8-c3e7-41d8-973a-f5434b047872', 'service_requests com status accepted/in_progress NÃO são afetados (smoke)', 2),
  ('7443f8c8-c3e7-41d8-973a-f5434b047872', 'IDs inválidos (não existem em service_categories) retornam 400 com mensagem', 3),
  ('7443f8c8-c3e7-41d8-973a-f5434b047872', 'RLS: PRESTADOR A não consegue trocar categorias de PRESTADOR B', 4),

  -- T-089 API bank
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'Migration adiciona enum value superseded em bank_account_status', 0),
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'PATCH cria nova row pending sem alterar a active existente', 1),
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'Retorna 409 se já existe pending pendente de validação', 2),
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'Validação Zod: bank_code (3 dígitos), agency, account, accountType, holder*', 3),
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'GET retorna holder_document mascarado (últimos 4)', 4),
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'RLS: smoke confirma PRESTADOR A não vê contas de B', 5),

  -- T-090 API delete
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'Migration adiciona deleted_at em provider_profiles e enum value deleted', 0),
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'DELETE retorna 409 has_active_services com count quando há service_requests ativos', 1),
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'Sem serviços ativos: anonimiza profile, deleta auth.users, retorna {deleted:true}', 2),
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'RPC anonymize_provider_profile preserva FK em service_requests/events históricos', 3),
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'provider_bank_accounts ficam com PII removida e status superseded', 4),
  ('a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'Audit log registra action=self_delete com actor=provider_id', 5),

  -- T-091 UI hub
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'Rota /(provider)/profile renderiza com user autenticado, redirect /login senão', 0),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'Cards: Pessoal, Categorias, Bancário, Avaliações, Conta — cada um com botão Editar/ação', 1),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'Foto, badge de nível e link para perfil público visíveis', 2),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'Server fetch agregado (Promise.all) — sem múltiplos round-trips', 3),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'Mobile-first verificado em viewport <768px (cards empilham)', 4),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'Reusa Card do design system (sem componente novo)', 5),

  -- T-092 UI sheet pessoal
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', 'ResponsiveSheet abre em side-sheet desktop e bottom-sheet mobile (90dvh)', 0),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', 'Form usa Field compound API (sem react-hook-form, sem masked-input)', 1),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', 'Erro 400 mantém valores digitados e mostra mensagem inline por campo', 2),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', 'Upload de foto vai direto ao bucket provider-avatars via JWT do user', 3),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', 'Toast de sucesso "Perfil atualizado" e sheet fecha após 200', 4),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', 'Tipos de arquivo limitados a image/jpeg|png|webp (input accept)', 5),

  -- T-093 UI sheet categorias
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a', 'Banner amarelo no topo informa regra de "novas alocações"', 0),
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a', 'Botão Salvar disabled quando 0 selecionadas; mensagem de erro abaixo', 1),
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a', 'Multi-select via checkbox; estado local com Set para toggle barato', 2),
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a', 'Badge mostra contagem de selecionadas no footer', 3),
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a', 'Toast de sucesso "Categorias atualizadas" após 200', 4),

  -- T-094 UI logout/delete
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', 'Botão "Sair" abre ConfirmDialog simples e chama supabase.auth.signOut()', 0),
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', 'Botão "Excluir conta" abre ConfirmDialog destrutivo (variant=destructive)', 1),
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', '409 has_active_services mostra toast com mensagem específica do servidor', 2),
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', 'Após DELETE 200, redireciona para / e usuário fica deslogado', 3),
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', 'Sem window.confirm() ou alert() em nenhum ponto', 4)
;

-- =====================================================================
-- 4) Dependências entre tasks (kind lowercase: 'blocks' | 'relates_to')
-- =====================================================================
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-087 (API personal) precisa de T-086 (storage + colunas)
  ('8105f3eb-4071-4370-b995-cbe215a97aa6', '3387bd93-0f2e-4692-b8e1-16490034edda', 'blocks'),
  -- T-091 (UI hub) precisa de TODAS as APIs (lê dados de cada seção)
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', '8105f3eb-4071-4370-b995-cbe215a97aa6', 'relates_to'),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', '7443f8c8-c3e7-41d8-973a-f5434b047872', 'relates_to'),
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', 'ef661d0e-0dea-4f5a-8f99-445a0e56386a', 'relates_to'),
  -- T-092 (sheet pessoal) chama T-087 e T-086
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', '8105f3eb-4071-4370-b995-cbe215a97aa6', 'blocks'),
  ('302665a0-d48e-48cf-aeb4-8c7db398627b', '3387bd93-0f2e-4692-b8e1-16490034edda', 'blocks'),
  -- T-093 (sheet categorias) chama T-088
  ('6442c09f-07ad-4c51-8af6-f7e154ae132a', '7443f8c8-c3e7-41d8-973a-f5434b047872', 'blocks'),
  -- T-094 (logout/delete) chama T-090 e relates a logout de US-002
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', 'a3ee1141-26a4-44f9-aa82-7e5eca133a9a', 'blocks'),
  ('84ea4c23-9f4c-4623-9971-68c7986eaa38', '5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'relates_to'),
  -- Cross-US relates: T-089 bank → US-003 T-3131 (provider_bank_accounts) e T-2ba1 (UI bank existente)
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', '31317d25-fae0-4da9-847e-90b3b2cfce98', 'relates_to'),
  ('ef661d0e-0dea-4f5a-8f99-445a0e56386a', '05c93219-134d-42b6-a420-770b5c80793d', 'relates_to'),
  -- T-088 categories → US-001 T-8f55 (provider_categories)
  ('7443f8c8-c3e7-41d8-973a-f5434b047872', '8f552252-9053-45fe-8ffb-a35be93627b8', 'relates_to'),
  -- T-091 hub → US-003 T-2ba1 (tela de bank existente, link a partir do hub)
  ('78a48bee-4c69-489f-8321-b6bc6a1efe34', '2ba1d246-2f6d-46df-b1ca-e41d7c5be841', 'relates_to'),
  -- T-086 estende provider_profiles de US-001 T-706e
  ('3387bd93-0f2e-4692-b8e1-16490034edda', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'relates_to')
;

COMMIT;
