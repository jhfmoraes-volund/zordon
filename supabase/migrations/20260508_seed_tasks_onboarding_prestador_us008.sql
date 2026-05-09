-- =============================================================================
-- Seed: tasks técnicas — Story ZLAR-US-008
-- (Preencher dados pessoais e categorias de atuação no onboarding do prestador)
-- Modulo: ONBOARDING_DO_PRESTADOR (proposed)
-- Persona: Carlos
-- =============================================================================
-- Cobre os 6 AC produto da US-008 com slicing canônico DB → Server → UI.
-- Reusa T-041 (`provider_profiles` base) — esta story estende com colunas de
-- cadastro pessoal (name, cpf, phone, email) e cria tabelas auxiliares
-- (service_categories, provider_profile_categories).
--
-- Anchor: feature `cy0v5ix` do brainstorm (CADASTRO][PRESTADOR] Formulário de
-- Dados Pessoais e Categorias).
--
-- Idempotente: lookup por (designSessionId, userStoryId, title, status='draft').
-- =============================================================================

BEGIN;

-- ─── Helpers (escopo da sessão psql) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.fp(p_scope text, p_complexity text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE p_scope
    WHEN 'micro'  THEN CASE p_complexity WHEN 'trivial' THEN 3 WHEN 'low' THEN 4  WHEN 'medium' THEN 5  WHEN 'high' THEN 7  END
    WHEN 'small'  THEN CASE p_complexity WHEN 'trivial' THEN 4 WHEN 'low' THEN 5  WHEN 'medium' THEN 7  WHEN 'high' THEN 10 END
    WHEN 'medium' THEN CASE p_complexity WHEN 'trivial' THEN 5 WHEN 'low' THEN 7  WHEN 'medium' THEN 10 WHEN 'high' THEN 15 END
    WHEN 'large'  THEN CASE p_complexity WHEN 'trivial' THEN 7 WHEN 'low' THEN 10 WHEN 'medium' THEN 15 WHEN 'high' THEN 21 END
  END)::int;
$$;

CREATE OR REPLACE FUNCTION pg_temp.upsert_task(
  p_session_id uuid, p_project_id uuid, p_story_id uuid,
  p_title text, p_description text, p_complexity text, p_scope text,
  p_notes text, p_acs text[]
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_task_id uuid; v_ref text;
  v_fp int := pg_temp.fp(p_scope, p_complexity);
  v_ac text; v_idx int;
BEGIN
  SELECT id, reference INTO v_task_id, v_ref
  FROM "Task"
  WHERE "designSessionId" = p_session_id AND "userStoryId" = p_story_id
    AND title = p_title AND status = 'draft' LIMIT 1;
  IF v_task_id IS NULL THEN
    v_ref := next_task_reference(p_project_id);
    v_task_id := gen_random_uuid();
    INSERT INTO "Task" (
      id, title, description, reference, status, complexity, scope,
      "functionPoints", "projectId", "designSessionId", "userStoryId",
      notes, "createdByAgent", priority, type, billable, "mergeAttempts",
      "createdAt", "updatedAt"
    ) VALUES (
      v_task_id, p_title, p_description, v_ref, 'draft', p_complexity, p_scope,
      v_fp, p_project_id, p_session_id, p_story_id,
      p_notes, true, 0, 'feature', true, 0, NOW(), NOW()
    );
  ELSE
    UPDATE "Task" SET description = p_description, complexity = p_complexity,
      scope = p_scope, "functionPoints" = v_fp, notes = p_notes,
      "updatedAt" = NOW() WHERE id = v_task_id;
  END IF;
  DELETE FROM "AcceptanceCriterion" WHERE "taskId" = v_task_id;
  v_idx := 0;
  FOREACH v_ac IN ARRAY p_acs LOOP
    INSERT INTO "AcceptanceCriterion" (id, "taskId", text, "order", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), v_task_id, v_ac, v_idx, NOW(), NOW());
    v_idx := v_idx + 1;
  END LOOP;
  RETURN v_ref;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.add_dep(
  p_task_ref text, p_dep_ref text, p_kind text DEFAULT 'blocks'
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_task_id uuid; v_dep_id uuid;
BEGIN
  SELECT id INTO v_task_id FROM "Task" WHERE reference = p_task_ref;
  SELECT id INTO v_dep_id  FROM "Task" WHERE reference = p_dep_ref;
  IF v_task_id IS NULL OR v_dep_id IS NULL THEN
    RAISE EXCEPTION 'add_dep: ref % or % not found', p_task_ref, p_dep_ref;
  END IF;
  INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind, "createdAt")
  VALUES (v_task_id, v_dep_id, p_kind, NOW())
  ON CONFLICT DO NOTHING;
END;
$$;

-- =============================================================================
-- TASKS — US-008
-- =============================================================================
DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story uuid := 'faf4baa9-1316-4c97-b002-635d9bc5eb12'; -- US-008
  v_feature text := 'cy0v5ix'; -- brainstorm anchor

  r_a text; r_b text; r_c text; r_d text; r_e text;
BEGIN

-- ─── TA — service_categories table + seed ────────────────────────────────────
r_a := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar tabela service_categories com seed inicial de categorias ativas',
$d$## Objetivo
Tabela de catalogo de categorias de servico (limpeza residencial, limpeza
pos-obra, jardinagem, etc). Lida pelo onboarding do prestador (selecao de
categorias) e pelo cliente na hora de solicitar servico. Seed inicial das
categorias do MVP definidas no brainstorm.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos (escolhe) + Cliente (solicita).
Pre-requisito de qualquer fluxo que envolva categorizacao: matching engine,
filtros admin, supply dashboard.

Stack: Postgres + RLS publico de leitura.

## Estado atual
Tabela nao existe. Categorias hoje sao implicitas no codigo / mocks.

## O que criar

### `supabase/migrations/<YYYYMMDD>_service_categories.sql`
```sql
create table public.service_categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  display_order int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index service_categories_active_order_idx
  on public.service_categories (display_order)
  where active = true;

alter table public.service_categories enable row level security;

-- Leitura publica (qualquer user autenticado le).
create policy service_categories_select on public.service_categories
  for select using (true);

-- Escrita so admin (RPCs admin no futuro).
create policy service_categories_admin_write on public.service_categories
  for all using (public.is_admin()) with check (public.is_admin());
```

### Seed inicial (MVP — derivado do brainstorm)
```sql
insert into public.service_categories (slug, name, display_order) values
  ('limpeza-residencial', 'Limpeza residencial', 1),
  ('limpeza-pos-obra',    'Limpeza pos-obra',     2),
  ('jardinagem',          'Jardinagem',           3),
  ('passadoria',          'Passadoria',           4),
  ('cuidado-idosos',      'Cuidado de idosos',    5)
on conflict (slug) do nothing;
```

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.

## Constraints / NAO fazer
- Nao usar enum Postgres — categorias precisam ser editaveis por admin no
  futuro sem migration (toggle `active`, novas categorias).
- Nao deletar row — apenas `active=false`. FK de outras tabelas
  (provider_profile_categories, service_requests) usa este id.
- Seed e idempotente via `on conflict (slug) do nothing` — re-rodar e seguro.

## Convencoes
- `slug` em kebab-case, sem acentos, unico.
- `display_order` controla ordem de listagem na UI.$d$,
  'low', 'small',
$n$**Habilita:** selecao de categorias no onboarding (T-D), filtros admin de prestadores, matching engine futuro, dashboard de supply por categoria.
**Risco:** baixo — schema simples, RLS publico de leitura.
**Estrategia de validacao:** integration test (qualquer user le; nao-admin nao escreve) + assert que seed tem >=5 rows ativas.
**Ref:** Brainstorm card `cy0v5ix` ([CADASTRO][PRESTADOR] Formulario de Dados Pessoais e Categorias). AC produto US-008 item 5.
**Tempo estimado:** 2h-3h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Tabela `service_categories` tem colunas: id (uuid PK), slug (text unique), name (text), description (text), display_order (int), active (bool), created_at, updated_at',
    'Seed inicial tem >=5 categorias ativas (limpeza-residencial, limpeza-pos-obra, jardinagem, passadoria, cuidado-idosos)',
    'Index parcial `service_categories_active_order_idx` existe e cobre `where active = true`',
    'RLS: user autenticado consegue SELECT; user nao-admin recebe 403 em INSERT/UPDATE',
    'Re-rodar a migration nao duplica seed (testado via re-execucao)',
    '`database.types.ts` regenerado e commitado; `pnpm typecheck` verde'
  ]
);
PERFORM runbook.attach_task_anchor(r_a, v_feature, v_session_id, ARRAY[5], 'from_brainstorm');


-- ─── TB — Estender provider_profiles + provider_profile_categories ───────────
r_b := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Estender provider_profiles com colunas de cadastro pessoal e tabela de categorias do prestador',
$d$## Objetivo
Adicionar colunas pessoais (`name`, `cpf` encrypted, `phone`, `email`) na
tabela `provider_profiles` ja criada em ZLAR-T-041, e criar tabela auxiliar
`provider_profile_categories` para o relacionamento N:N com `service_categories`.
Adicionar tambem coluna `onboarding_step` para registrar progresso do
formulario multi-step server-side (fallback ao localStorage).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Base de dados para AC produto
US-008 itens 0, 2, 3, 4 + serve de base para US-009 (KYC), US-011 (primeiros
passos), US-012 (conta bancaria).

ZLAR-T-041 (US-081) ja criou `provider_profiles` com `user_id`, `status`,
`kyc_attempts`, `kyc_rejection_reason`, `kyc_decided_at`, `kyc_decided_by`.
Esta task ESTENDE com colunas pessoais (eram null ate agora — provider entra
no fluxo so com user_id setado pelo trigger).

Stack: Postgres + pgcrypto para `cpf` encrypted + RLS herdado de T-041.

## Estado atual
`provider_profiles` so tem dados de status KYC. Sem `name`, `cpf`, `phone`,
`email`. Sem relacao com categorias.

## O que criar

### `supabase/migrations/<YYYYMMDD>_provider_profiles_personal.sql`
```sql
-- 1. Colunas pessoais
alter table public.provider_profiles
  add column name             text,
  add column cpf_encrypted    bytea,    -- pgcrypto encrypted
  add column phone            text,
  add column email            text,
  add column onboarding_step  int not null default 0
    check (onboarding_step >= 0 and onboarding_step <= 5);

-- Index pra lookup de duplicata por email no onboarding (AC item 3)
create unique index provider_profiles_email_idx
  on public.provider_profiles (email)
  where email is not null;

-- 2. Helper de encrypt/decrypt do CPF (so service_role usa)
create or replace function public.encrypt_cpf(p_cpf text)
returns bytea language sql security definer set search_path = public, extensions as $f$
  select pgp_sym_encrypt(p_cpf, current_setting('app.cpf_secret'));
$f$;

create or replace function public.decrypt_cpf(p_cpf bytea)
returns text language sql security definer set search_path = public, extensions as $f$
  select pgp_sym_decrypt(p_cpf, current_setting('app.cpf_secret'));
$f$;

revoke execute on function public.decrypt_cpf(bytea) from anon, authenticated;

-- 3. N:N prestador <-> categorias
create table public.provider_profile_categories (
  user_id     uuid not null references public.provider_profiles(user_id) on delete cascade,
  category_id uuid not null references public.service_categories(id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (user_id, category_id)
);

create index provider_profile_categories_category_idx
  on public.provider_profile_categories (category_id);

alter table public.provider_profile_categories enable row level security;

-- Carlos le/escreve so as proprias relacoes
create policy ppc_self_select on public.provider_profile_categories
  for select using (auth.uid() = user_id or public.is_admin());

create policy ppc_self_write on public.provider_profile_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.
- Atualizar export em `src/lib/types/provider.ts` se existir.

## Constraints / NAO fazer
- `cpf_encrypted` NUNCA exposto ao cliente (Carlos ve a propria row mas o
  campo bytea nao serve no frontend). Decrypt so via service_role em RPCs
  pontuais (ex: webhook Unico, fila admin).
- `app.cpf_secret` setado via `ALTER DATABASE ... SET app.cpf_secret = '...'`
  fora desta migration (settings env). Nao commitar a chave aqui.
- `email` UNIQUE so quando nao-null — `where email is not null` no index
  permite multiplos provider_profiles em estado pre-email-step.
- `onboarding_step` cresce monotonamente; UI nao deve "voltar" o step
  no banco quando user retorna pra step anterior (so localStorage importa).

## Convencoes
- Helpers `encrypt_cpf`/`decrypt_cpf` com `security definer` + revoke explicito.
- Migration aplicada com prefixo de data.$d$,
  'medium', 'medium',
$n$**Habilita:** todo o resto do onboarding do prestador (server action, UI multi-step). Tambem habilita US-009 (KYC pode ler nome/cpf), US-011 (primeiros passos), US-012 (conta bancaria valida CPF do titular).
**Risco:** alto — schema central + dados PII (CPF). Erro de RLS/encrypt aqui vaza CPF. Code review obrigatorio + audit do helper de encrypt.
**Estrategia de validacao:** integration test (a) Carlos le proprio cpf_encrypted retorna bytea; (b) cliente nao-admin ve 403 em provider_profile_categories de outro user; (c) decrypt_cpf nao executavel por authenticated.
**Ref:** Brainstorm card `cy0v5ix` (technical_notes: provider_profiles + cpf ENCRYPTED).
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Colunas adicionadas em `provider_profiles`: name (text), cpf_encrypted (bytea), phone (text), email (text), onboarding_step (int 0..5)',
    'Index `provider_profiles_email_idx` e UNIQUE com filtro `where email is not null`',
    'Tabela `provider_profile_categories` com PK composta (user_id, category_id) e FK on delete cascade pro perfil + on delete restrict pra categoria',
    'Funcao `decrypt_cpf` retorna 403 quando chamada por user `authenticated` (revoke aplicado)',
    'Integration test: cliente nao-admin recebe 403 em SELECT de provider_profile_categories alheia',
    'Constraint `check (onboarding_step between 0 and 5)` rejeita insert com step=10',
    '`database.types.ts` regenerado; `pnpm typecheck` verde'
  ]
);
PERFORM pg_temp.add_dep(r_b, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_b, 'ZLAR-T-041', 'blocks');
PERFORM runbook.attach_task_anchor(r_b, v_feature, v_session_id, ARRAY[0,2,4], 'from_brainstorm');


-- ─── TC — Server Action de upsert progressivo + signup ──────────────────────
r_c := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar Server Action de upsert progressivo por step com signup Supabase Auth no step de e-mail',
$d$## Objetivo
Server Action `saveProviderOnboardingStep(step, data)` que persiste o progresso
de cada step do onboarding em `provider_profiles` via upsert idempotente. No
step de e-mail+senha, executa `supabase.auth.signUp` e dispara o trigger que
cria a row em `provider_profiles` (T-041 ja faz isso). Nos steps seguintes,
faz UPDATE com `onConflict (user_id) do update`.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-008 itens
0 (formulario multi-step), 3 (e-mail duplicado).

Mapeamento step -> dados (do brainstorm):

| Step | Dados | Comportamento |
|---|---|---|
| 0 | nome, telefone | UPDATE only (user ainda nao existe) — guardado em localStorage |
| 1 | e-mail, senha | `signUp` -> trigger cria provider_profile -> UPDATE com nome/phone do step 0 |
| 2 | categorias (array de category_ids) | UPSERT em `provider_profile_categories` |

Stack: Next.js 15 Server Actions + Supabase server client + zod.

## Estado atual
Sem server action. Onboarding hoje so existe na T-041 (status base, sem dados pessoais).

## O que criar

### `apps/web/src/app/(public)/onboarding/provider/actions.ts`
```ts
'use server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const Step0 = z.object({
  step: z.literal(0),
  name: z.string().min(2).max(100),
  phone: z.string().regex(/^\+?\d{10,14}$/),
});
const Step1 = z.object({
  step: z.literal(1),
  email: z.string().email(),
  password: z.string().min(8),
  // dados do step 0 (cliente envia junto pro server enriquecer signUp)
  name: z.string().min(2),
  phone: z.string(),
});
const Step2 = z.object({
  step: z.literal(2),
  categoryIds: z.array(z.string().uuid()).min(1),
});

export type SaveStepResult =
  | { ok: true; userId?: string; nextStep: number }
  | { ok: false; error: 'email_exists' | 'invalid_input' | 'unknown'; field?: string };

export async function saveProviderOnboardingStep(
  raw: unknown
): Promise<SaveStepResult> {
  const parsed = z.discriminatedUnion('step', [Step0, Step1, Step2]).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const data = parsed.data;
  const supabase = createServerClient();

  if (data.step === 1) {
    // signUp -> trigger cria provider_profile
    const { data: signup, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { role: 'provider' } },
    });
    if (error?.message?.toLowerCase().includes('already')) {
      return { ok: false, error: 'email_exists', field: 'email' };
    }
    if (error || !signup.user) return { ok: false, error: 'unknown' };
    // UPDATE com nome/phone do step 0 (vieram no payload)
    await supabase.from('provider_profiles').update({
      name: data.name, phone: data.phone, email: data.email,
      onboarding_step: 1,
    }).eq('user_id', signup.user.id);
    return { ok: true, userId: signup.user.id, nextStep: 2 };
  }

  if (data.step === 0) {
    // Sem userId ainda — apenas valida. UI guarda em localStorage.
    return { ok: true, nextStep: 1 };
  }

  // step === 2 — categorias
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unknown' };
  // Limpa categorias anteriores e re-insere
  await supabase.from('provider_profile_categories').delete().eq('user_id', user.id);
  const rows = data.categoryIds.map((id) => ({ user_id: user.id, category_id: id }));
  const { error } = await supabase.from('provider_profile_categories').insert(rows);
  if (error) return { ok: false, error: 'unknown' };
  await supabase.from('provider_profiles')
    .update({ onboarding_step: 2 })
    .eq('user_id', user.id);
  revalidatePath('/onboarding/provider');
  return { ok: true, userId: user.id, nextStep: 3 };
}
```

### Helper de validacao de CPF inline (AC item 1)
- Validacao de CPF e responsabilidade do CLIENT (T-D) — server confia que veio
  validado. Mas: `Step0` no servidor nao pede `cpf` (CPF e parte do KYC, vem
  no step de identificacao da US-009).
- Caso de uso aqui: server action so cobre name, phone, email, password,
  categorias.

## Constraints / NAO fazer
- Nao logar `password` no Sentry/logs (assert no breadcrumb filter).
- Nao retornar mensagem detalhada do supabase em `error: 'unknown'` — sempre
  generico para o cliente.
- Nao chamar `signUp` se step != 1 — guard pelo discriminated union.
- Nao usar `revalidatePath` no step 0 (sem mudanca persistida).

## Convencoes
- Server Action com `'use server'` no topo.
- Zod com `discriminatedUnion('step', ...)` para type-narrow.
- Erros tipados com union string em vez de Error class (serializavel pra client).$d$,
  'medium', 'medium',
$n$**Habilita:** UI multi-step (T-D) tem ponto unico de persistencia. Reuso por server actions futuras (resume KYC etc).
**Risco:** medio — fluxo de signUp + upsert tem race conditions sutis (ex: trigger ainda nao rodou quando UPDATE chega). Adicionar retry com backoff curto se aparecer.
**Estrategia de validacao:** Vitest com Supabase test client (3 cenarios: step 0 OK, step 1 com email existente -> error 'email_exists', step 2 com user nao autenticado -> error 'unknown') + Playwright e2e.
**Ref:** Brainstorm card `cy0v5ix` (technical_notes: signUp + upsert por step). AC produto US-008 itens 0, 3.
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Vitest `provider-onboarding-actions.test.ts` cobre 3 cenarios: step=0 valida e retorna nextStep=1; step=1 com email novo cria user + UPDATE perfil; step=1 com email existente retorna `error: email_exists`',
    'Vitest cobre step=2 com user autenticado: limpa relacoes anteriores em provider_profile_categories e insere novas',
    'Vitest cobre step=2 sem auth: retorna `error: unknown` sem expor detalhes do supabase',
    'Zod rejeita payload com `step=99` ou phone fora do padrao /^\\+?\\d{10,14}$/',
    'Mensagem de erro do Supabase NAO aparece no objeto retornado ao cliente em `error: unknown`',
    '`pnpm typecheck` verde — discriminated union funciona em compile time',
    '`pnpm lint` verde'
  ]
);
PERFORM pg_temp.add_dep(r_c, r_b, 'blocks');
PERFORM runbook.attach_task_anchor(r_c, v_feature, v_session_id, ARRAY[0,3], 'from_brainstorm');


-- ─── TD — UI multi-step com validacao inline + categorias ────────────────────
r_d := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar formulario multi-step de onboarding com validacao inline de CPF e selecao de categorias',
$d$## Objetivo
Tela `/onboarding/provider` com formulario multi-step (3 steps) + barra de
progresso. Cada step valida inline (zod no client), persiste via Server Action
da T-C e avanca. Step de categorias carrega `service_categories` via RSC e
exige >=1 marcada. Step de e-mail valida formato + duplicata server-side
(retorno `email_exists` da action).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-008 itens
0, 1, 2, 3 (formulario multi-step + validacoes inline + erro de duplicata).

Stack: Next.js 15 App Router + RSC pra carregar categorias + Client Component
para formulario + Field compound API + Zustand opcional pra estado entre
steps (ou apenas useState orquestrador).

## Estado atual
Pasta `/(public)/onboarding/provider/` nao existe. Onboarding hoje chega ate
T-041 (login + base do perfil) sem coleta de dados.

## O que criar

### `apps/web/src/app/(public)/onboarding/provider/page.tsx` (RSC)
```tsx
import { createServerClient } from '@/lib/supabase/server';
import { ProviderOnboardingFlow } from '@/components/onboarding/provider-onboarding-flow';

export default async function Page() {
  const supabase = createServerClient();
  const { data: categories } = await supabase
    .from('service_categories')
    .select('id, slug, name, display_order')
    .eq('active', true)
    .order('display_order');
  return <ProviderOnboardingFlow categories={categories ?? []} />;
}
```

### `apps/web/src/components/onboarding/provider-onboarding-flow.tsx` (client)
- `useState<{ step: 0 | 1 | 2; data: Partial<OnboardingData> }>` com hidratacao do localStorage no mount.
- Renderiza `<ProgressBar step={step} total={3} />` no topo.
- Switch por step:
  - Step 0: `<Step0Form />` — Field name + phone com mask BR (sem lib, regex inline).
  - Step 1: `<Step1Form />` — Field email + password (toggle show/hide).
  - Step 2: `<Step2Form categories={categories} />` — checkbox group.
- Cada step chama `saveProviderOnboardingStep(...)` e avanca em sucesso.
- CPF NAO e coletado nesta tela (vem no KYC da US-009). Mas o step 0 valida
  CPF se o usuario ja preencheu (campo opcional aqui — fica gravado em
  localStorage pra reuso na US-009).

### Validacao inline (cliente)
```ts
// Field CPF: validacao por digito verificador
function isValidCpf(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  // ... algoritmo de digitos verificadores
}
```

### `apps/web/src/components/onboarding/category-grid.tsx`
- Grid 2-cols mobile / 3-cols desktop.
- Cada card e um `<Checkbox + Label>` com nome da categoria.
- Estado `selectedIds: Set<string>` controlado.
- Submit desabilitado enquanto `selectedIds.size === 0` (AC item 2).

### Mensagem de e-mail duplicado (AC item 3)
- Apos `saveProviderOnboardingStep` retornar `email_exists`, renderizar inline
  abaixo do campo email: "Esse e-mail ja tem cadastro. Quer entrar?" + CTA
  Link pra `/provider/login?email={email}`.

## Constraints / NAO fazer
- Nao usar libs de mask (`react-imask`, etc) — regex inline + `<Input type=tel>`.
- Sem react-hook-form — useState direto (regra projeto, ver AGENTS.md).
- Validacao zod NAO roda no client — apenas regex/condicionais. Zod fica
  na server action.
- Nao mostrar `<Skeleton />` nos cards de categoria — sao carregados via RSC
  em <100ms; loading desnecessario.

## Convencoes
- `<Field>` compound API + `<FormBody density="comfortable">`.
- Toast `sonner` apenas em erro de rede. Erros de validacao ficam inline.
- Mobile-first: stepper colapsa em barra de progresso unica em mobile.$d$,
  'medium', 'medium',
$n$**Habilita:** primeira tela onde Carlos efetivamente entra na plataforma. Bug aqui = 0 prestadores.
**Risco:** medio — UX de erro inline + multi-step e o que mais gera abandono. Validar com 3 prestadores reais.
**Estrategia de validacao:** Vitest cobre 3 steps + transicoes; Playwright e2e completo (inicio -> step 2 com signup); manual em mobile real (Carlos persona).
**Ref:** Brainstorm card `cy0v5ix`. AC produto US-008 itens 0, 1, 2, 3.
**Tempo estimado:** 8h-10h.$n$,
  ARRAY[
    'Vitest `provider-onboarding-flow.test.tsx` cobre transicoes entre os 3 steps com payload valido',
    'Vitest valida regra: CPF invalido (ex: 11111111111) bloqueia avanco do step 0',
    'Vitest valida regra: step 2 com `selectedIds.size === 0` mantem botao submit disabled',
    'Vitest valida render de mensagem inline com CTA de login quando server action retorna `email_exists`',
    'Playwright e2e: preenche steps 0, 1, 2 com user novo; assert que `provider_profiles` tem row com onboarding_step=2 e categorias relacionadas',
    'Toggle show/hide alterna `type` do password input entre `password` e `text`',
    'Layout mobile (375px): stepper colapsa em barra horizontal sem scroll lateral',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_d, r_c, 'blocks');
PERFORM runbook.attach_task_anchor(r_d, v_feature, v_session_id, ARRAY[0,1,2,3], 'from_brainstorm');


-- ─── TE — Persistir progresso em localStorage ────────────────────────────────
r_e := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Persistir progresso do onboarding em localStorage com hidratacao ao retomar e limpeza pos-KYC',
$d$## Objetivo
Salvar o estado do onboarding (`{ step, data }`) em localStorage a cada
mudanca de campo, hidratar no mount do `<ProviderOnboardingFlow />` e limpar
o store quando o KYC e submetido (US-009 chama o helper de cleanup).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-008 item 4
(progresso salvo em localStorage — formulario retoma do ultimo step ao retornar).

Razao do localStorage (e nao apenas DB): no step 0 ainda nao tem `user_id`
(signUp acontece no step 1). Sem localStorage, refresh no step 0 perde tudo.

Stack: Browser localStorage + helper TS + hook React.

## Estado atual
Sem persistencia local. Refresh no step 0 zera o formulario.

## O que criar

### `apps/web/src/lib/onboarding/provider-storage.ts`
```ts
const KEY = 'zelar:provider-onboarding';
const VERSION = 1;

export interface ProviderOnboardingDraft {
  version: 1;
  step: 0 | 1 | 2;
  data: {
    name?: string;
    phone?: string;
    email?: string;
    cpf?: string;
    categoryIds?: string[];
  };
  updatedAt: string; // ISO
}

export function loadDraft(): ProviderOnboardingDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== VERSION) return null;
    return parsed as ProviderOnboardingDraft;
  } catch { return null; }
}

export function saveDraft(draft: Omit<ProviderOnboardingDraft, 'version' | 'updatedAt'>) {
  if (typeof window === 'undefined') return;
  const full: ProviderOnboardingDraft = { ...draft, version: VERSION, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(KEY, JSON.stringify(full));
}

export function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
```

### `apps/web/src/hooks/use-provider-onboarding-draft.ts`
```ts
'use client';
import { useEffect, useState } from 'react';
import { loadDraft, saveDraft, clearDraft } from '@/lib/onboarding/provider-storage';

export function useProviderOnboardingDraft() {
  const [draft, setDraft] = useState<ReturnType<typeof loadDraft>>(null);
  useEffect(() => { setDraft(loadDraft()); }, []);
  return {
    draft,
    save: (next: Parameters<typeof saveDraft>[0]) => { saveDraft(next); setDraft({ ...next, version: 1, updatedAt: new Date().toISOString() }); },
    clear: () => { clearDraft(); setDraft(null); },
  };
}
```

### Integracao na T-D
- `<ProviderOnboardingFlow />` chama `useProviderOnboardingDraft()` no mount.
- Cada `onChange` de campo faz `save({ step, data })` debounced 300ms.
- Apos `saveProviderOnboardingStep` step=2 retornar OK, `clear()` limpa.
- US-009 (KYC submission) tambem chama `clear()` ao final do KYC.

## Constraints / NAO fazer
- NUNCA salvar `password` em localStorage. O hook explicitamente exclui o
  campo password do `data` salvo.
- NUNCA salvar `cpf` se a tela nao coletar (campo cpf so existe pra reuso na
  US-009 apos coleta no KYC — opcional aqui).
- Versionamento (`version: 1`): se mudar formato, bump version e descartar
  drafts antigos via `parsed.version !== VERSION`.
- localStorage falha em modo privado em alguns browsers — `try/catch` + retorno
  `null` evita crash.

## Convencoes
- `KEY` namespacado com prefixo do projeto.
- Helper agnostico de React (`provider-storage.ts`) + hook que envolve
  (`use-provider-onboarding-draft.ts`).$d$,
  'low', 'small',
$n$**Habilita:** prestador retoma onboarding do ponto que parou apos fechar/abrir o app. Reduz abandono.
**Risco:** baixo — escopo isolado, sem efeitos colaterais.
**Estrategia de validacao:** Vitest com mock de localStorage (3 cenarios: load vazio, save+load, clear); Playwright e2e que recarrega a pagina e verifica que campos voltam preenchidos.
**Ref:** Brainstorm card `cy0v5ix` (technical_notes: localStorage como fallback). AC produto US-008 item 4.
**Tempo estimado:** 3h-4h.$n$,
  ARRAY[
    'Vitest `provider-storage.test.ts` cobre 4 cenarios: loadDraft vazio retorna null; save+load round-trip preserva dados; load com version diferente retorna null; clear remove o item',
    'Vitest do hook cobre hidratacao no mount + save mutavel + clear',
    'Playwright e2e: preenche step 0, recarrega a pagina, assert que name/phone voltam preenchidos no DOM',
    'Helper `saveDraft` NUNCA salva `password` no localStorage — assert via spy do JSON.stringify',
    'Versionamento: mudar VERSION pra 2 no helper descarta drafts existentes (testado via mock)',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_e, r_d, 'blocks');
PERFORM runbook.attach_task_anchor(r_e, v_feature, v_session_id, ARRAY[4], 'from_brainstorm');


RAISE NOTICE 'US-008 tasks: % % % % %', r_a, r_b, r_c, r_d, r_e;

END $seed$;

COMMIT;
