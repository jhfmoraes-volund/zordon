-- =============================================================================
-- Seed: tasks técnicas — Story ZLAR-US-081 (Login do Prestador c/ KYC routing)
-- Modulo: LOGIN (proposed)
-- Persona: Carlos
-- =============================================================================
-- Cobre os 7 AC produto da US-081 com slicing granular β (uma task por
-- camada/tela/regra). Reusa setup feito em AUTH_ONBOARDING (T-032 providers,
-- T-031 next-redirect, T-034 app_metadata role).
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
-- TASKS — US-081
-- =============================================================================
DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story uuid := 'bba586ff-d7ac-40b6-b067-4d591a2947ab'; -- US-081

  r_a text; r_b text; r_c text; r_d text; r_e text; r_f text; r_g text;
BEGIN

-- ─── TA — provider_profiles schema ───────────────────────────────────────────
r_a := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar tabela provider_profiles com status kyc_attempts e RLS por user_id',
$d$## Objetivo
Schema central que define o estado do prestador na plataforma — usado em
todas as decisoes de roteamento (login, middleware de rotas /provider, fila
de KYC do admin). Inclui contador `kyc_attempts` (max 2) que governa quando
o prestador perde acesso ao reenvio.

## Contexto
Modulo LOGIN. Persona Carlos. Pre-condicao para qualquer redirect pos-login
do prestador (ZLAR-T-NNN da US-081 + middleware /provider).

Status enum espelha o brainstorm card `[LOGIN][PRESTADOR]`:
- `pending_review` — KYC submetido, aguardando webhook Unico
- `approved` — KYC aprovado (auto ou manual)
- `rejected` — KYC reprovado, ainda com tentativas restantes
- `suspended` — bloqueado definitivo (kyc_attempts >= 2 reprovados, ou
  acao manual da Ana)

Stack: Postgres + RLS. Helper `is_admin()` ja existe no projeto (usado em
ZLAR-T-035 do AUTH_ONBOARDING).

## Estado atual
Tabela nao existe. Sem fonte de verdade do status do prestador.

## O que criar

### `supabase/migrations/<YYYYMMDD>_provider_profiles.sql`
```sql
create type public.provider_status as enum (
  'pending_review', 'approved', 'rejected', 'suspended'
);

create table public.provider_profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  status               public.provider_status not null default 'pending_review',
  kyc_attempts         int not null default 0 check (kyc_attempts >= 0 and kyc_attempts <= 5),
  kyc_rejection_reason text,
  kyc_decided_at       timestamptz,
  kyc_decided_by       uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index provider_profiles_status_idx on public.provider_profiles (status);

alter table public.provider_profiles enable row level security;

-- Carlos ve so o proprio perfil. Ana (admin) ve todos.
create policy provider_profiles_self_select on public.provider_profiles
  for select using (auth.uid() = user_id or public.is_admin());

-- Carlos NAO faz update de status diretamente — so o admin via RPC ou
-- webhook Unico via service_role.
create policy provider_profiles_admin_update on public.provider_profiles
  for update using (public.is_admin());

-- Insert: trigger quando user nasce com role='provider'.
create policy provider_profiles_self_insert on public.provider_profiles
  for insert with check (auth.uid() = user_id);
```

### Trigger de provisionamento automatico

Quando `app_metadata.role = 'provider'` no signup (definido pelo trigger
ZLAR-T-034), criar row em `provider_profiles` com `status='pending_review'`:

```sql
create or replace function public.handle_new_provider()
returns trigger language plpgsql security definer set search_path = public as $f$
begin
  if (new.raw_app_meta_data ->> 'role') = 'provider' then
    insert into public.provider_profiles (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$f$;

drop trigger if exists on_auth_user_provider on auth.users;
create trigger on_auth_user_provider
  after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_provider();
```

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.

## Constraints / NAO fazer
- `kyc_attempts` so cresce — nunca decrementa. Reset exige acao manual via
  RPC futura `reset_provider_kyc(user_id, reason)` (fora do escopo aqui).
- `status` so muda via service_role (webhook Unico) ou RPC admin
  (`approve_provider(user_id)` / `reject_provider(user_id, reason)`).
- Nao criar `kyc_attempts` como soft-cap aqui — a regra de bloqueio definitivo
  fica na RPC que decide reject (incremento + transicao pra suspended quando
  attempts atinge 2).

## Convencoes
- Migration com prefixo de data.
- Enum em `public.*`.$d$,
  'medium', 'medium',
$n$**Habilita:** todo redirect pos-login do prestador (T seguinte), middleware /provider, fila de KYC do admin (US-052), tela de aguardando aprovacao com Realtime.
**Risco:** alto — schema nuclear. Erro aqui propaga para todas as decisoes de routing. Code review obrigatorio.
**Estrategia de validacao:** integration test (Carlos nao ve perfil de outro Carlos; Ana ve todos; tentativa de update direto retorna 403).
**Ref:** Brainstorm card "[LOGIN][PRESTADOR] Tela de Login do Prestador". AC produto US-081.
**Tempo estimado:** 4h-5h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Enum `provider_status` tem exatamente os 4 valores: pending_review, approved, rejected, suspended',
    'Trigger `on_auth_user_provider` cria row em `provider_profiles` quando `raw_app_meta_data.role` vira `provider` (testado por integration test com fixture)',
    'Integration test: cliente A nao ve perfil de prestador B; admin ve ambos',
    'Tentativa de update direto em `provider_profiles.status` por user nao-admin retorna 403 RLS',
    'Constraint `check (kyc_attempts between 0 and 5)` rejeita insert com `kyc_attempts = -1` ou `= 10`',
    '`database.types.ts` regenerado e commitado; `pnpm typecheck` verde'
  ]
);


-- ─── TB — Login form do prestador ────────────────────────────────────────────
r_b := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar tela de login do prestador com email senha e Google OAuth',
$d$## Objetivo
Tela `/provider/login` com dois caminhos: e-mail+senha e Google OAuth. Sem
magic link (Carlos tem baixo dominio tecnico — manter fluxo simples).
Erros inline genericos. Pos-autenticacao chama o helper de redirect
`getProviderRedirect()` (ZLAR-T-NNN) que decide o destino conforme o
status KYC.

## Contexto
Modulo LOGIN. Persona Carlos. Brainstorm `[LOGIN][PRESTADOR]` define
explicitamente "campo e-mail + senha (toggle show/hide) + botao Entrar +
divisor 'ou' + botao Continuar com Google + link Esqueci minha senha +
link Nao tenho conta — cadastrar".

Stack: Next.js 15 App Router + Supabase JS browser client + shadcn `<Form>` +
react-hook-form + zod + Field compound API.

Reusa providers configurados em ZLAR-T-032 (auth/email/Google).

## Estado atual
Pagina `/provider/login` nao existe. Cliente ja tem `/login` (ZLAR-T-039) — esta
tela e separada porque branding/estado pos-login diverge.

## O que criar

### `apps/web/src/app/(public)/provider/login/page.tsx` (RSC)
- Le sessao via `createServerClient`.
- Se autenticado e `app_metadata.role === 'provider'` -> chama
  `getProviderRedirect(userId)` (ZLAR-T-C) e faz `redirect(target)`.
- Se autenticado mas role != provider -> `redirect('/login')` com erro
  "Esta tela e so para prestadores".
- Se nao autenticado -> renderiza `<ProviderLoginForm />`.

### `apps/web/src/components/auth/provider-login-form.tsx` (client)
- Schema zod: `email().email()`, `password.min(8)`.
- Submit e-mail+senha:
  - `supabase.auth.signInWithPassword({ email, password })`.
  - Erro 400/401 -> "E-mail ou senha incorretos." inline.
  - Erro de rede -> toast `sonner`.
  - Sucesso -> `router.refresh()` (RSC re-le sessao e redireciona).
- Google: `signInWithOAuth({ provider: 'google', options: { redirectTo: '<SITE_URL>/auth/callback?role=provider' } })`.
- Toggle show/hide na senha (`<Eye />` icon do lucide).
- Links auxiliares:
  - "Esqueci minha senha" -> `/reset-password?role=provider`.
  - "Nao tenho conta — cadastrar" -> `/onboarding/provider`.

### `apps/web/src/app/auth/callback/route.ts` (extensao)
- Ja existe (ZLAR-T-031). Quando `?role=provider` no callback, garantir que
  `redirect()` final passa pelo `getProviderRedirect()` (caso pos-OAuth
  o usuario caia direto em `/provider/home` por route param).

## Constraints / NAO fazer
- Erros de credencial SEMPRE genericos — nunca distinguir "e-mail nao existe"
  de "senha errada" (vazamento de PII + AC produto).
- Nao logar password no Sentry (assert no breadcrumb filter).
- Nao incluir magic link nesta tela — divergencia consciente do cliente.
- Nao bloquear o form enquanto Google OAuth ta autenticando — o popup
  trata sozinho.

## Convencoes
- Field compound API + `<FormBody density="comfortable">` (ver AGENTS.md).
- Toast `sonner` so pra erro de rede. Erros de auth ficam inline.
- Branding "Zelar Prestador" no header (diferente do form do cliente).$d$,
  'medium', 'medium',
$n$**Habilita:** todos os fluxos pos-login do prestador (provider home, KYC waiting, reenvio docs, blocked).
**Risco:** medio — UX de erro inline e o que mais gera ticket. Validar com 3 prestadores reais (Carlos persona).
**Estrategia de validacao:** unit + Playwright + manual em mobile real.
**Ref:** Brainstorm `[LOGIN][PRESTADOR]`. AC produto US-081 itens 0 e 6.
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Vitest `provider-login-form.test.tsx` cobre (a) credencial OK -> chama signInWithPassword, (b) credencial errada -> mensagem inline generica, (c) erro de rede -> toast',
    'Casos (b) "e-mail nao existe" e "senha errada" produzem string identica no DOM',
    'Playwright: login OK redireciona via `/auth/callback` para `/provider/home` quando status=approved',
    'Toggle show/hide alterna `type` do input de password entre `password` e `text`',
    'Submit OAuth Google chama `signInWithOAuth` com `redirectTo` contendo `?role=provider`',
    'Sentry breadcrumb capturado em teste de integracao nao contem o valor do campo password',
    '`pnpm lint` + `pnpm typecheck` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_b, 'ZLAR-T-032', 'blocks');  -- providers configurados


-- ─── TC — Helper de redirect pos-login ───────────────────────────────────────
r_c := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Resolver redirect pos login do prestador conforme status do perfil KYC',
$d$## Objetivo
Funcao server-side `getProviderRedirect(userId)` que le `provider_profiles.status`
e devolve o path correto para o redirect pos-autenticacao. E o ponto unico de
verdade para essa decisao — usado pela pagina `/provider/login`, pelo
middleware de protecao de rotas `/provider/**` e por qualquer outro lugar
que precise rotear o prestador apos login.

## Contexto
Modulo LOGIN. Persona Carlos. Cobre AC produto US-081 itens 1, 2, 3, 4, 5
(verificacao do status + redirect proporcional).

Mapeamento status -> destino (do brainstorm):

| Status | Destino |
|---|---|
| `approved` | `/provider/home` |
| `pending_review` | `/onboarding/provider/waiting` |
| `rejected` (kyc_attempts < 2) | `/onboarding/provider/kyc` |
| `suspended` (ou kyc_attempts >= 2) | `/onboarding/provider/blocked` |

Stack: Next.js 15 server-side. Le sessao via `createServerClient`.

## Estado atual
Sem helper. `/provider/login` nao tem como decidir destino.

## O que criar

### `apps/web/src/lib/auth/provider-redirect.ts`
```ts
import { createServerClient } from '@/lib/supabase/server';

export type ProviderRedirectTarget =
  | '/provider/home'
  | '/onboarding/provider/waiting'
  | '/onboarding/provider/kyc'
  | '/onboarding/provider/blocked';

export async function getProviderRedirect(userId: string): Promise<ProviderRedirectTarget> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('provider_profiles')
    .select('status, kyc_attempts')
    .eq('user_id', userId)
    .single();

  // Sem perfil -> assume pending (trigger ainda nao rodou). Mata redirect
  // loop deixando o prestador na tela de waiting com explicacao.
  if (error || !data) return '/onboarding/provider/waiting';

  if (data.status === 'approved') return '/provider/home';
  if (data.status === 'suspended' || data.kyc_attempts >= 2) return '/onboarding/provider/blocked';
  if (data.status === 'rejected') return '/onboarding/provider/kyc';
  return '/onboarding/provider/waiting'; // pending_review
}
```

### Integracao
- `/provider/login/page.tsx` chama `getProviderRedirect(user.id)` apos
  `getUser()` autenticada.
- `middleware.ts` (ZLAR-T-G) chama mesma funcao para proteger `/provider/**`.

## Constraints / NAO fazer
- Helper e PURO em termos de side effects fora do read da DB. Nao logar,
  nao mudar estado, nao mandar e-mail.
- `kyc_attempts >= 2` precede `status === 'rejected'` na ordem de checagem —
  evita que Carlos com 2 tentativas e status='rejected' caia em `/kyc` em vez
  de `/blocked` por ordem de avaliacao.
- Nunca cachear o resultado em memoria do server — status pode mudar entre
  requests via webhook Unico. Cada chamada le DB.

## Convencoes
- Tipos com union literal pra path serem checaveis em compile time.$d$,
  'medium', 'small',
$n$**Habilita:** login form prestador (T-B), middleware /provider (T-G), tela waiting com Realtime (T-D).
**Risco:** medio — logica nuclear de routing. Bug aqui leva Carlos pra tela errada e parece "app quebrado".
**Estrategia de validacao:** unit test cobre as 4 transicoes + edge case (sem perfil + kyc_attempts = 2 com status approved logico nao-existente).
**Ref:** Brainstorm `[LOGIN][PRESTADOR]` secao "Technical Notes". AC produto US-081.
**Tempo estimado:** 2h-3h.$n$,
  ARRAY[
    'Vitest `provider-redirect.test.ts` cobre 5 casos: approved -> /home; pending_review -> /waiting; rejected com kyc_attempts=1 -> /kyc; rejected com kyc_attempts=2 -> /blocked; suspended -> /blocked',
    'Caso edge "user sem row em provider_profiles" retorna `/waiting` em vez de quebrar',
    'Tipo `ProviderRedirectTarget` e literal union — `pnpm typecheck` reclama de paths invalidos',
    'Helper le DB em cada chamada (sem cache) — coberto por test que muta status entre duas chamadas e ve resultado diferente',
    'Sem `console.log` ou efeito colateral fora do read da DB (lint rule contra console em prod)'
  ]
);

PERFORM pg_temp.add_dep(r_c, r_a, 'blocks');


-- ─── TD — Tela waiting com Realtime ──────────────────────────────────────────
r_d := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar tela de aguardando aprovacao com atualizacao do status KYC via Supabase Realtime',
$d$## Objetivo
Tela `/onboarding/provider/waiting` que mostra "KYC em analise" + estimativa
de tempo (24h) + lista do que ja foi enviado. Subscreve canal Realtime
`provider:{user_id}` — quando webhook Unico atualiza `provider_profiles.status`,
a tela reage em tempo real e redireciona pro destino correto sem usuario
recarregar.

## Contexto
Modulo LOGIN. Persona Carlos. Cobre AC produto US-081 item 3 + edge case
do brainstorm "Status KYC atualizado enquanto Carlos esta na tela de espera".

Stack: Next.js 15 App Router + `@supabase/supabase-js` Realtime + Tailwind.

## Estado atual
Pasta `/(public)/onboarding/provider/waiting/` nao existe.

## O que criar

### `apps/web/src/app/(public)/onboarding/provider/waiting/page.tsx` (RSC)
- Le sessao + `provider_profiles` do user atual.
- Se `status !== 'pending_review'` na primeira leitura, redireciona via
  `getProviderRedirect()` (ZLAR-T-C) — guard anti-direct-access.
- Renderiza `<WaitingScreen userId={user.id} />`.

### `apps/web/src/components/onboarding/waiting-screen.tsx` (client)
- Header com cronometro estimado ("Estimativa de aprovacao: ate 24h").
- Lista do que foi enviado (renderizar a partir de `provider_kyc_submissions`
  se existir; senao, hardcoded a partir do brainstorm: "Documento de
  identidade", "Selfie", "Categorias de servico").
- `useEffect` cria subscription Supabase Realtime no canal:
  ```ts
  const channel = supabase
    .channel(`provider:${userId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'provider_profiles', filter: `user_id=eq.${userId}` },
      (payload) => {
        const newStatus = payload.new.status;
        if (newStatus !== 'pending_review') router.refresh();
      })
    .subscribe();
  return () => supabase.removeChannel(channel);
  ```
- `router.refresh()` re-roda o RSC, que chama `getProviderRedirect` e move
  Carlos pra tela apropriada (home / kyc / blocked).

## Constraints / NAO fazer
- Subscription criada no client component (Realtime nao funciona em RSC).
- Cleanup do channel obrigatorio no return do useEffect — vazamento causa
  aumento de connections no Supabase Realtime tier.
- Nao mostrar `kyc_rejection_reason` aqui — essa info aparece so na tela de
  reenvio (T-E).

## Convencoes
- `<Spinner />` ou `<Skeleton />` shadcn enquanto Realtime nao confirma.
- Toast `sonner` quando status muda ("Seu KYC foi aprovado!" ou "Documentos
  reprovados — veja motivo na proxima tela").$d$,
  'medium', 'medium',
$n$**Habilita:** experiencia premium pos-KYC submetido. Sem isso, Carlos precisa fechar o app e reabrir.
**Risco:** medio — Realtime da Supabase tem reconexao instavel em rede 4G. Adicionar fallback de `setInterval` 30s pro `router.refresh()` se quiser belt-and-suspenders.
**Estrategia de validacao:** Playwright simula update na DB enquanto a tela esta aberta + manual em rede instavel.
**Ref:** Brainstorm secao "Edge Cases" do card LOGIN PRESTADOR.
**Tempo estimado:** 6h-8h.$n$,
  ARRAY[
    'Vitest `waiting-screen.test.tsx` cobre subscription criada com filter correto + cleanup no unmount',
    'Playwright: Carlos abre tela com status=pending_review; teste injeta UPDATE em provider_profiles via API admin; tela faz `router.refresh()` em < 2s; Carlos cai em /provider/home',
    'Cleanup do channel coberto: rodar 100 ciclos mount/unmount em test nao deixa channels orfaos (assert via `supabase.getChannels().length`)',
    'Pagina renderiza estado de loading (`<Skeleton />`) ate primeira leitura confirmar status=pending_review',
    'Acesso direto via URL com status != pending_review redireciona via `getProviderRedirect` antes de renderizar',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_d, r_c, 'blocks');
PERFORM pg_temp.add_dep(r_d, r_a, 'blocks');


-- ─── TE — Tela de reenvio de docs ────────────────────────────────────────────
r_e := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar tela de reenvio de documentos com motivo da reprovacao e tentativas restantes',
$d$## Objetivo
Tela `/onboarding/provider/kyc` que aparece para Carlos quando `status='rejected'`
e ele ainda tem tentativas (`kyc_attempts < 2`). Mostra o motivo especifico
da reprovacao (ex: "Selfie nao corresponde ao documento", "Documento ilegivel"),
quantas tentativas restam e o CTA pra refazer o KYC.

## Contexto
Modulo LOGIN. Persona Carlos. Cobre AC produto US-081 item 4.

Aqui apenas RENDERIZA e dispara o fluxo de reenvio. A submissao real do KYC
mora no modulo ONBOARDING_DO_PRESTADOR (US-009 — fora desta story).

Stack: Next.js 15 + Supabase + Tailwind.

## Estado atual
Pasta `/(public)/onboarding/provider/kyc/` nao existe (a parte de submissao
existe na US-009 do outro modulo, mas o entry point especifico de reenvio
e novo).

## O que criar

### `apps/web/src/app/(public)/onboarding/provider/kyc/page.tsx` (RSC)
- Le `provider_profiles` do user.
- Guard: se `status !== 'rejected'` ou `kyc_attempts >= 2`, redireciona via
  `getProviderRedirect()` (ZLAR-T-C).
- Le `kyc_rejection_reason` da row e renderiza `<KycRejectedScreen reason={...} attemptsLeft={2 - kyc_attempts} />`.

### `apps/web/src/components/onboarding/kyc-rejected-screen.tsx` (client)
- Header: "Documentos nao aprovados".
- Card destacado: motivo (`kyc_rejection_reason` cru — vem do admin/Unico em PT-BR).
- Contador: "Voce tem **N** tentativa(s) restante(s)".
- CTA primario: `<Button>` "Reenviar documentos" -> navega pra
  `/onboarding/provider/kyc/upload` (rota da US-009, fora deste escopo).
- CTA secundario: link "Falar com suporte" -> `mailto:suporte@zelar.com.br`.
- Mensagem de aviso quando `attemptsLeft === 1`: "Esta e sua **ultima**
  tentativa. Se reprovar de novo, sua conta sera encerrada definitivamente."

## Constraints / NAO fazer
- NUNCA mostrar essa tela quando `kyc_attempts >= 2` — usuario tem que cair
  em /blocked. Guard server-side e a unica rede de seguranca.
- Nao chamar API de submissao aqui — so renderizar e linkar pro upload.
- Motivo da reprovacao vem cru da DB; nao e responsabilidade desta tela
  traduzir/modificar.

## Convencoes
- Card destacado com tom "rose" (status-chips do projeto).
- Aviso de ultima tentativa em `<Alert variant="destructive">` shadcn.$d$,
  'low', 'small',
$n$**Habilita:** retorno do prestador apos primeira reprovacao do KYC.
**Risco:** baixo — UI relativamente estatica, dados ja vem prontos da DB.
**Estrategia de validacao:** Playwright cobre 3 cenarios (1 tentativa restante, ultima tentativa, ja sem tentativas -> redireciona).
**Ref:** Brainstorm `[LOGIN][PRESTADOR]` secao Key Screens.
**Tempo estimado:** 3h-4h.$n$,
  ARRAY[
    'Vitest `kyc-rejected-screen.test.tsx` cobre render com 1 e 2 tentativas restantes; aviso de ultima tentativa so aparece com attemptsLeft=1',
    'Playwright: status=rejected + kyc_attempts=0 mostra "2 tentativas restantes"; status=rejected + kyc_attempts=1 mostra "1 tentativa restante" + alert',
    'Acesso direto com status=approved redireciona via getProviderRedirect (nao renderiza esta tela)',
    'Acesso direto com kyc_attempts=2 redireciona pra /blocked (nao renderiza esta tela)',
    'CTA "Reenviar documentos" tem `href="/onboarding/provider/kyc/upload"` (rota da US-009)',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_e, r_c, 'blocks');
PERFORM pg_temp.add_dep(r_e, r_a, 'blocks');


-- ─── TF — Tela bloqueio definitivo ───────────────────────────────────────────
r_f := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar tela informativa de cadastro encerrado sem opcao de reenvio',
$d$## Objetivo
Tela `/onboarding/provider/blocked` que aparece quando Carlos perdeu acesso
definitivamente — `status='suspended'` ou `kyc_attempts >= 2`. Sem CTA pra
refazer KYC (acabaram tentativas), apenas orientacao pra falar com suporte.

## Contexto
Modulo LOGIN. Persona Carlos. Cobre AC produto US-081 item 5.

Tom da tela: respeitoso, sem culpa, sem JS de "tentar de novo". E o ponto
final do funil pra prestador bloqueado — daqui ele so sai por intervencao
manual da equipe Zelar (Ana via painel admin).

## Estado atual
Pasta `/(public)/onboarding/provider/blocked/` nao existe.

## O que criar

### `apps/web/src/app/(public)/onboarding/provider/blocked/page.tsx` (RSC)
- Le `provider_profiles` do user.
- Guard: se status nao for `suspended` E `kyc_attempts < 2`, redireciona via
  `getProviderRedirect()` (Carlos veio aqui errado).
- Renderiza `<BlockedScreen reason={kyc_rejection_reason} />`.

### `apps/web/src/components/onboarding/blocked-screen.tsx` (server component, sem state)
- Header: "Seu cadastro foi encerrado".
- Texto principal:
  > "Apos a analise dos documentos, nao foi possivel concluir seu cadastro
  > como prestador na Zelar. Para entender o motivo ou reabrir seu cadastro,
  > entre em contato com a equipe Zelar."
- Card com `kyc_rejection_reason` (se existir).
- CTAs:
  - Primario: `<Button>` "Falar com suporte" -> `mailto:suporte@zelar.com.br?subject=Cadastro%20encerrado&body=...`.
  - Secundario: link "Voltar para tela inicial" -> `/`.
- NAO incluir botao "Tentar de novo" / "Reenviar documentos".

## Constraints / NAO fazer
- Sem CTA de reenvio. Sem botao escondido. Sem link clandestino pra `/kyc`.
- Sem JS — server component puro. Estado vem todo do RSC pai.
- Tom respeitoso. Nao usar palavras "rejeitado", "reprovado", "negado" no
  texto principal — preferir "nao foi possivel concluir".

## Convencoes
- Layout centrado. `<Card>` com tone neutro (sem destaque vermelho — a
  decisao ja foi tomada, sem dramatizar).$d$,
  'low', 'micro',
$n$**Habilita:** Carlos sai do funil sem ficar preso em loop de tentativas. Reduz suporte.
**Risco:** baixo — UI estatica.
**Estrategia de validacao:** Playwright cobre 2 cenarios (suspended; rejected com kyc_attempts=2).
**Ref:** Brainstorm `[LOGIN][PRESTADOR]` Key Screens "KYC cancelado definitivamente".
**Tempo estimado:** 2h.$n$,
  ARRAY[
    'Vitest `blocked-screen.test.tsx` cobre render com e sem `reason` prop',
    'Playwright: status=suspended renderiza tela; status=rejected + kyc_attempts=2 renderiza tela; status=rejected + kyc_attempts=1 redireciona pra /kyc',
    'DOM nao contem texto "Reenviar", "Tentar", "Refazer" — assert por regex no test',
    'Link mailto contem `subject=Cadastro%20encerrado` no href',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_f, r_c, 'blocks');
PERFORM pg_temp.add_dep(r_f, r_a, 'blocks');


-- ─── TG — Middleware de protecao /provider/** ────────────────────────────────
r_g := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Proteger rotas provider via middleware Next que verifica status do KYC em cada request',
$d$## Objetivo
Middleware Next.js que protege todas as rotas `/provider/**` (exceto
`/provider/login` e `/onboarding/provider/**`) — em cada request, le
`provider_profiles.status` e bloqueia acesso se Carlos nao for
`approved`. Carlos com KYC pendente que tenta acessar `/provider/home`
direto e mandado pra tela apropriada via `getProviderRedirect()`.

## Contexto
Modulo LOGIN. Persona Carlos. Cobre AC produto US-081 item 1 + edge case
do brainstorm "Carlos tenta acessar rota de prestador com KYC nao aprovado".

Stack: Next.js 15 middleware (`middleware.ts` na raiz). Roda em Edge Runtime
— ATENCAO: nao pode usar dependencies que nao funcionam em Edge.

## Estado atual
Sem middleware. Acesso a `/provider/home` antes de login leva pro 401 default
do Supabase, sem routing inteligente.

## O que criar

### `apps/web/middleware.ts`
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase/middleware';
import { getProviderRedirect } from '@/lib/auth/provider-redirect';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // So protege /provider/** (exclui login e onboarding)
  const protectsProvider =
    pathname.startsWith('/provider') &&
    !pathname.startsWith('/provider/login');

  if (!protectsProvider) return NextResponse.next();

  const { supabase, response } = createMiddlewareClient(req);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/provider/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Cliente tentando acessar /provider/* -> manda pra /home
  const role = user.app_metadata?.role;
  if (role !== 'provider') {
    const url = req.nextUrl.clone();
    url.pathname = '/home';
    return NextResponse.redirect(url);
  }

  // Provider autenticado mas KYC nao approved -> redireciona pra tela certa
  const target = await getProviderRedirect(user.id);
  if (target !== '/provider/home' && pathname.startsWith('/provider/home')) {
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/provider/:path*']
};
```

### `apps/web/src/lib/supabase/middleware.ts`
- Cria cliente Supabase para middleware (Edge Runtime) — pattern oficial.

## Constraints / NAO fazer
- Nao chamar `getProviderRedirect` se a rota nao precisa (ex: `/onboarding/provider/*`)
  pra evitar latencia em rotas que nao requerem o check.
- Nao fazer cache da decisao de redirect — pre-condicao "le em cada request"
  pro update de status pelo webhook Unico ser instantaneo.
- Edge Runtime: nao importar nada que precise de Node.js APIs (fs, crypto.subtle e ok).
- Nao bloquear /provider/login no matcher — usuario nao logado precisa
  acessar a tela.

## Convencoes
- Nome `middleware.ts` na raiz `apps/web/` (convencao Next.js).
- Matcher minimo necessario — middleware roda em CADA request, custa
  performance acumular paths.$d$,
  'high', 'medium',
$n$**Habilita:** seguranca de rotas /provider — Carlos nao pode acessar features pos-aprovacao antes de aprovar.
**Risco:** alto — middleware roda em CADA request. Bug aqui derruba o app inteiro do prestador. Code review obrigatorio + canary deploy.
**Estrategia de validacao:** unit test do middleware com mocks de request + Playwright em 5 cenarios (sem auth, role=client, provider pending, provider rejected, provider approved).
**Ref:** Brainstorm secao "Edge Cases". AC produto US-081 item 1.
**Tempo estimado:** 6h-8h.$n$,
  ARRAY[
    'Vitest `middleware.test.ts` cobre 5 cenarios: (a) sem auth -> /provider/login com next; (b) role=client -> /home; (c) provider approved + acessa /provider/home -> passa; (d) provider pending + acessa /provider/home -> /onboarding/provider/waiting; (e) provider suspended + acessa /provider/jobs -> /onboarding/provider/blocked',
    'Playwright em ambiente real reproduz os 5 cenarios via cookies de sessao mockados',
    'Middleware NAO faz check em /provider/login (matcher exclui via early return)',
    'Middleware NAO faz check em /onboarding/provider/* (pra evitar redirect loop)',
    'Performance: tempo medio do middleware < 50ms p99 (medido em Vercel preview)',
    '`pnpm build` em Edge Runtime passa sem erros de "Module not supported in Edge"',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_g, r_c, 'blocks');
PERFORM pg_temp.add_dep(r_g, r_a, 'blocks');


RAISE NOTICE 'US-081 tasks: % % % % % % %', r_a, r_b, r_c, r_d, r_e, r_f, r_g;

END $seed$;

COMMIT;
