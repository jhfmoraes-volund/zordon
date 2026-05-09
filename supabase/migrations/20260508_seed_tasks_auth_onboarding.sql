-- =============================================================================
-- Seed: tasks técnicas do módulo AUTENTICACAO_ONBOARDING (Inception Zelar)
-- =============================================================================
-- Stories cobertas: ZLAR-US-002 a ZLAR-US-006
-- Padrão: simulação do Vitor em sub-fase task_breakdown (regras de prompt.ts)
-- Idempotente: lookup por (designSessionId, userStoryId, title, status='draft')
--
-- Execução: aplicar como qualquer migration do projeto.
-- =============================================================================

BEGIN;

-- ─── FP matrix (espelha src/lib/function-points.ts FP_MATRIX_DEFAULT) ────────
CREATE OR REPLACE FUNCTION pg_temp.fp(p_scope text, p_complexity text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE p_scope
    WHEN 'micro'  THEN CASE p_complexity WHEN 'trivial' THEN 3 WHEN 'low' THEN 4  WHEN 'medium' THEN 5  WHEN 'high' THEN 7  END
    WHEN 'small'  THEN CASE p_complexity WHEN 'trivial' THEN 4 WHEN 'low' THEN 5  WHEN 'medium' THEN 7  WHEN 'high' THEN 10 END
    WHEN 'medium' THEN CASE p_complexity WHEN 'trivial' THEN 5 WHEN 'low' THEN 7  WHEN 'medium' THEN 10 WHEN 'high' THEN 15 END
    WHEN 'large'  THEN CASE p_complexity WHEN 'trivial' THEN 7 WHEN 'low' THEN 10 WHEN 'medium' THEN 15 WHEN 'high' THEN 21 END
  END)::int;
$$;

-- ─── Upsert task (mirror createTaskTool: lookup por title+story+session draft)
CREATE OR REPLACE FUNCTION pg_temp.upsert_task(
  p_session_id  uuid,
  p_project_id  uuid,
  p_story_id    uuid,
  p_title       text,
  p_description text,
  p_complexity  text,
  p_scope       text,
  p_notes       text,
  p_acs         text[]
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_task_id uuid;
  v_ref     text;
  v_fp      int := pg_temp.fp(p_scope, p_complexity);
  v_ac      text;
  v_idx     int;
BEGIN
  -- 1) Idempotency lookup
  SELECT id, reference INTO v_task_id, v_ref
  FROM "Task"
  WHERE "designSessionId" = p_session_id
    AND "userStoryId"     = p_story_id
    AND title             = p_title
    AND status            = 'draft'
  LIMIT 1;

  IF v_task_id IS NULL THEN
    -- INSERT path
    v_ref     := next_task_reference(p_project_id);
    v_task_id := gen_random_uuid();

    INSERT INTO "Task" (
      id, title, description, reference, status, complexity, scope,
      "functionPoints", "projectId", "designSessionId", "userStoryId",
      notes, "createdByAgent", priority, type, billable,
      "mergeAttempts", "createdAt", "updatedAt"
    ) VALUES (
      v_task_id, p_title, p_description, v_ref, 'draft', p_complexity, p_scope,
      v_fp, p_project_id, p_session_id, p_story_id,
      p_notes, true, 0, 'feature', true,
      0, NOW(), NOW()
    );
  ELSE
    -- UPDATE path
    UPDATE "Task"
    SET description     = p_description,
        complexity      = p_complexity,
        scope           = p_scope,
        "functionPoints"= v_fp,
        notes           = p_notes,
        "updatedAt"     = NOW()
    WHERE id = v_task_id;
  END IF;

  -- 2) Replace AC set
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

-- ─── Add dependency by ref (idempotent) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.add_dep(
  p_task_ref text,
  p_dep_ref  text,
  p_kind     text DEFAULT 'blocks'
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_task_id uuid;
  v_dep_id  uuid;
BEGIN
  SELECT id INTO v_task_id FROM "Task" WHERE reference = p_task_ref;
  SELECT id INTO v_dep_id  FROM "Task" WHERE reference = p_dep_ref;
  IF v_task_id IS NULL OR v_dep_id IS NULL THEN
    RAISE EXCEPTION 'add_dep: task ref % or dep ref % not found', p_task_ref, p_dep_ref;
  END IF;
  INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind, "createdAt")
  VALUES (v_task_id, v_dep_id, p_kind, NOW())
  ON CONFLICT DO NOTHING;
END;
$$;

-- =============================================================================
-- TASK GENERATION
-- =============================================================================
DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';

  v_us_002 uuid := 'ed0aacdf-1507-476d-81ec-e55185707638';
  v_us_003 uuid := 'd62f759e-b459-478b-84f3-a48ebcdf0cb4';
  v_us_004 uuid := 'b15401dd-f3ed-4d57-a588-412c728f04ee';
  v_us_005 uuid := 'cfe1d36e-83cf-477b-817f-411f94366de6';
  v_us_006 uuid := 'a04227ea-a908-43e4-80d8-54412bd97087';

  -- captured refs
  r_t1 text; r_t2 text; r_t3 text; r_t4 text; r_t5 text;
  r_t6 text; r_t7 text; r_t8 text; r_t9 text; r_t10 text; r_t11 text;
BEGIN

-- ─── US-002 / T1 — Splash ───────────────────────────────────────────────────
r_t1 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_002,
  'Renderizar splash publica com selecao de perfil cliente ou prestador',
$d$## Objetivo
Pagina inicial publica `/` que apresenta os dois perfis (cliente / prestador) e
encaminha o usuario pro fluxo de onboarding correto. Sessao ativa pula a splash
e vai pra home da role correspondente.

## Contexto
Modulo AUTENTICACAO_ONBOARDING. Persona Lucas (cliente residencial). Primeiro
ponto de contato com a plataforma — define qual app voce ta usando antes de
qualquer outra interacao.

Stack: Next.js 15 App Router (RSC) + Supabase Auth (cookie SSR) + Tailwind +
shadcn/ui.

## Estado atual
Nao existe rota `/`. App cai em 404 ou login direto.

## O que criar

### `apps/web/src/app/(public)/page.tsx` (RSC)
- Le sessao via `createServerClient` em `lib/supabase/server.ts`.
- Se autenticado, le `app_metadata.role` e:
  - `'client'` -> `redirect('/home')`
  - `'provider'` -> `redirect('/provider')`
  - `'admin'` -> `redirect('/admin')`
- Se nao autenticado, renderiza `<Splash next={searchParams.next} />`.

### `apps/web/src/components/auth/splash.tsx` (client)
- Logo Zelar (asset em `public/zelar-logo.svg`) + tagline "Servicos com confianca".
- Dois `<Button size="lg">`:
  - "Sou cliente" -> `/onboarding/client?next=...`
  - "Sou prestador" -> `/onboarding/provider?next=...`
- Link secundario "Ja tenho cadastro" -> `/login?next=...`.
- Mobile-first, safe-area iOS, sem scroll.

## Constraints / NAO fazer
- Nao usar `'use client'` na page (precisa SSR pra ler cookie).
- Nao implementar logica de auth aqui — so leitura de sessao.
- Nao misturar com tour (US-005).

## Convencoes
- Tokens Tailwind (sem hex hardcoded).
- `<Button>` shadcn ja em `components/ui/button`.$d$,
  'low', 'small',
$n$**Habilita:** todo deeplink WhatsApp, signup do cliente, signup do prestador.
**Risco:** baixo — UI estatica + redirect.
**Estrategia de validacao:** Playwright em viewport mobile + smoke manual com sessao ativa.
**Ref:** AC produto US-002.
**Tempo estimado:** 2h-3h.$n$,
  ARRAY[
    'Build (`pnpm build`) passa sem warning de "client component using server-only API"',
    '`pnpm typecheck` e `pnpm lint` passam sem novos erros',
    'Vitest cobre os tres caminhos de redirect (nao autenticado, role=client, role=provider) com `redirect` mockado',
    'Playwright em viewport mobile na rota `/` exibe os dois botoes e o link "Ja tenho cadastro"',
    'Acesso a `/?next=/services/123` mantem o `next` no `href` dos tres CTAs',
    'Acesso ao mesmo path com sessao mockada como `role=client` redireciona pra `/home` sem renderizar splash'
  ]
);

-- ─── US-002 / T2 — next-redirect helper ─────────────────────────────────────
r_t2 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_002,
  'Preservar destino de deeplink WhatsApp atraves do fluxo de auth via cookie HttpOnly',
$d$## Objetivo
Quando usuario clica em link de WhatsApp tipo `https://zelar.com.br/?next=/services/abc`,
o destino `next` precisa sobreviver a splash, signup/login e verificacao de
e-mail. Pos-auth, app navega pra `next` (validado contra whitelist de paths
internos) em vez de home default.

## Contexto
Supabase Auth tem callback fixo `/auth/callback?next=...`. Em fluxos OAuth
(Google), provider as vezes descarta querystring — por isso `next` viaja
tambem em cookie HttpOnly de fallback.

Modulo AUTENTICACAO_ONBOARDING. Persona Lucas. Cobre AC produto "Acesso via
deeplink de WA preserva destino para redirect pos-login".

## Estado atual
Sem mecanismo de redirect pos-login fora do default `/home`.

## O que criar

### `apps/web/src/lib/auth/next-redirect.ts`
- `setNextCookie(value: string)` — server action; escreve `zelar_next`
  HttpOnly + SameSite=Lax + 10min TTL. Sanitiza: aceita so paths comecando com
  `/`, sem `//` e sem `\`.
- `consumeNext(): string | null` — le e apaga cookie. Default `null`.
- `safeNext(raw: string | null): string` — sanitizador puro. Default `/home`.

### `apps/web/src/app/auth/callback/route.ts`
- Troca code por sessao, le `consumeNext()`, faz `redirect(safeNext(next))`.

### Integracao com splash
- `<Splash>` (criada em ZLAR-T-001) chama `setNextCookie(searchParams.next)`
  antes de navegar para `/onboarding/...` ou `/login`.

## Constraints / NAO fazer
- Nunca aceitar `next` que comece com `http://`, `https://`, `//`, ou contenha
  `\` — vetor de open redirect. Caso violado, cai em `/home` e loga warning Sentry.
- Nao usar `localStorage` — cookie HttpOnly garante leitura SSR.

## Convencoes
- Sanitizacao centralizada em `next-redirect.ts`. Toda rota que recebe `next`
  passa por `safeNext()`.$d$,
  'medium', 'small',
$n$**Habilita:** todos os deeplinks de WhatsApp pos-lancamento (templates Meta).
**Risco:** medio — open redirect e vetor classico de phishing. Code review por security-aware.
**Estrategia de validacao:** unit test de `safeNext` + Playwright + tentativa manual de XSS via querystring.
**Ref:** OWASP Unvalidated Redirects and Forwards.
**Tempo estimado:** 3h-4h.$n$,
  ARRAY[
    'Vitest `next-redirect.test.ts` cobre 6 casos: path interno OK, `//evil.com`, `https://x`, vazio, com `\`, path com query',
    'Playwright: `?next=/services/abc` chega em `/services/abc` apos login completo',
    'Tentativa de redirect para `https://attacker.com` cai em `/home` e nunca renderiza URL externa',
    'Cookie `zelar_next` desaparece apos o redirect (single-use, validado por Playwright)',
    '`pnpm typecheck` + `pnpm lint` continuam verdes apos a mudanca'
  ]
);

PERFORM pg_temp.add_dep(r_t2, r_t1, 'blocks');


-- ─── US-003 / T3 — Supabase Auth providers ──────────────────────────────────
r_t3 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_003,
  'Configurar provedores Supabase Auth para email senha Google OAuth e magic link',
$d$## Objetivo
Provisionar e versionar config de autenticacao no Supabase para os tres
caminhos de signup/login: e-mail+senha (com confirmacao obrigatoria), Google
OAuth (instantaneo), magic link. Templates de e-mail em PT-BR brandados Zelar.

## Contexto
Modulo AUTENTICACAO_ONBOARDING. Toda task de signup/login depende deste
boilerplate. Ambientes separados desde o dia 1: zelar-dev e zelar-prod.

Versionamento: `supabase/config.toml` + `supabase/templates/*.html` no git.
Pipeline do time aplica nos ambientes.

## Estado atual
Projeto Supabase recem-provisionado, sem providers ativos.

## O que criar

### `supabase/config.toml`
- `[auth] site_url = "https://zelar.com.br"`.
- `[auth] additional_redirect_urls = ["https://zelar.com.br/auth/callback", "https://dev.zelar.com.br/auth/callback", "http://localhost:3000/auth/callback"]`.
- `[auth.email] enable_confirmations = true`, `secure_password_change = true`, `otp_expiry = 3600` (1h pra magic link).
- `[auth.external.google] enabled = true`, `client_id = "env(GOOGLE_CLIENT_ID)"`, `secret = "env(GOOGLE_CLIENT_SECRET)"`.

### Templates PT-BR
- `supabase/templates/confirmation.html` — branding Zelar + `{{ .ConfirmationURL }}` + fallback texto.
- `supabase/templates/magic_link.html`.
- `supabase/templates/recovery.html`.

### Documentacao + secrets
- `docs/setup-google-oauth.md` — passo a passo no Google Cloud Console (criar OAuth client, redirect URIs, credenciais).
- `.env.example` ganha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## Constraints / NAO fazer
- Nao commitar secrets — so `.env.example` e refs `env(...)` no toml.
- Nao desabilitar `enable_confirmations` em prod (AC produto US-003 exige).
- Magic link com TTL de exatamente 1h via `otp_expiry`.

## Convencoes
- Mudancas de config sempre versionadas; nada via Dashboard direto.$d$,
  'medium', 'small',
$n$**Habilita:** signup form (T-NNN), signup persistencia de role (T-NNN), login form (T-NNN), reset password (T-NNN).
**Risco:** medio — config errada quebra OAuth em prod. Validar em dev antes de promover.
**Estrategia de validacao:** smoke manual de cada provider em ambiente dev + snapshot do template renderizado.
**Ref:** AC produto US-003.
**Tempo estimado:** 3h.$n$,
  ARRAY[
    'Os tres providers (e-mail+senha, Google, magic link) ficam ativos no Supabase de dev apos aplicar a config',
    'Templates HTML carregam logo Zelar e contem `{{ .ConfirmationURL }}` resolvido (snapshot em PR)',
    '`pnpm lint` + `pnpm typecheck` passam; nenhum secret no diff',
    'Smoke manual: signup com e-mail recebe template em PT-BR; click no link autentica e redireciona pra `/onboarding/client/profile`',
    '`docs/setup-google-oauth.md` listado no indice de docs e referenciado no README'
  ]
);

-- ─── US-003 / T4 — Signup form ──────────────────────────────────────────────
r_t4 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_003,
  'Renderizar formulario de signup do cliente com validacao inline e tres caminhos de auth',
$d$## Objetivo
Form de signup do cliente em `/onboarding/client` com tres caminhos
(e-mail/senha, Google, magic link) e validacao inline. E-mail duplicado e
senha fraca aparecem como mensagens proximas ao campo, sem alert. Pos-signup
bem-sucedido redireciona pra `/onboarding/client/profile`.

## Contexto
Stack: shadcn `<Form>` + react-hook-form + zod. Supabase JS browser client em
`apps/web/src/lib/supabase/client.ts`.

Modulo AUTENTICACAO_ONBOARDING. Persona Lucas. Depende dos providers
configurados em ZLAR-T-003.

## Estado atual
Sem form de signup. Pasta `(public)/onboarding/client/` ainda nao existe.

## O que criar

### `apps/web/src/app/(public)/onboarding/client/page.tsx` (RSC)
- Le sessao; redirect se autenticado.
- Renderiza `<SignupForm role="client" />`.

### `apps/web/src/components/auth/signup-form.tsx` (client)
- Tabs: "E-mail e senha", "Google", "Magic link".
- Schema zod: `email().email()`, `password.min(8).regex(/[0-9]/)`.
- Submit e-mail+senha:
  - `supabase.auth.signUp({ email, password, options: { data: { profile_kind: 'client' } } })`.
  - Erro `User already registered` -> mensagem inline com CTA "Fazer login".
  - Senha fraca bloqueada client-side antes do submit (zod) + check server-side de safety.
- Google: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl } })`.
- Magic link: `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callbackUrl } })` -> tela "verifique seu e-mail".
- Erros inesperados via `sonner` toast.

## Constraints / NAO fazer
- Nunca renderizar a senha em DOM alem do `type="password"`.
- Erro de e-mail duplicado e SEMPRE inline (AC produto US-003), nao toast.
- Nao auto-submit em Google OAuth (Safari ITP exige clique).

## Convencoes
- Field compound API (ver `AGENTS.md` secao 4) com `<FormBody density="comfortable">`.
- Validacao apenas via zod schema — sem regex avulso espalhado no JSX.$d$,
  'medium', 'medium',
$n$**Habilita:** Perfil basico (US-004), tour (US-005), todas as rotas autenticadas.
**Risco:** medio — UX de erro inline costuma escapar de unit test. Reforcar Playwright.
**Estrategia de validacao:** unit + E2E + QA manual em mobile real (iOS Safari + Android Chrome).
**Ref:** AC produto US-003. Field API em `AGENTS.md` (secao 4).
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Vitest `signup-form.test.tsx` cobre (a) submit OK, (b) e-mail duplicado, (c) senha fraca, (d) erro de rede',
    'Playwright `signup-client.spec.ts`: e-mail novo gera entrada em `auth.users` e redireciona pra `/onboarding/client/profile` apos confirmacao',
    'E-mail duplicado exibe mensagem inline e CTA "Fazer login" com `next=/onboarding/client/profile`',
    'Senha fraca bloqueia submit antes de bater no Supabase (validacao client-side via zod)',
    'Submit OAuth Google chama `signInWithOAuth` com `redirectTo` apontando pra `/auth/callback`',
    '`pnpm lint` + `pnpm typecheck` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_t4, r_t3, 'blocks');


-- ─── US-003 / T5 — Persistir app_metadata.role ──────────────────────────────
r_t5 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_003,
  'Persistir app_metadata role no signup via trigger postgres com fallback default',
$d$## Objetivo
Toda conta nova precisa de `app_metadata.role` (driver de RLS e roteamento).
Como `signUp` define apenas `user_metadata` (editavel pelo cliente, inseguro),
um trigger Postgres copia `user_metadata.profile_kind` para
`app_metadata.role` no momento do insert em `auth.users`.

## Contexto
RLS em todas as tabelas le `auth.jwt() -> 'app_metadata' ->> 'role'`.
`user_metadata` e editavel pelo cliente; `app_metadata` so pelo service_role.

Modulo AUTENTICACAO_ONBOARDING. Cobre dependencia transversal de todos os
modulos que usam RLS por role.

## Estado atual
`auth.users` zerado, sem trigger.

## O que criar

### `supabase/migrations/20260508_signup_role_trigger.sql`
```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $f$
declare
  kind text := coalesce(new.raw_user_meta_data ->> 'profile_kind', 'client');
begin
  if kind not in ('client', 'provider') then
    kind := 'client';
  end if;
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                              || jsonb_build_object('role', kind)
   where id = new.id;
  return new;
end;
$f$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### Regenerar tipos
- Atualizar `src/lib/supabase/database.types.ts` (rodar `supabase gen types`).

## Constraints / NAO fazer
- Trigger NUNCA bloqueia o insert — wrap em `begin/exception` se necessario,
  mas falha de role vira default `client`.
- Nada de RLS em `auth.users` — Supabase ja gerencia.

## Convencoes
- Migration sempre com prefixo de data (`20260508_*`).$d$,
  'medium', 'small',
$n$**Habilita:** todas as RLS futuras (`role='client' | 'provider' | 'admin'`).
**Risco:** alto — falha aqui derruba RLS de todo o sistema. Validar com smoke + integration test.
**Estrategia de validacao:** integration test contra Supabase local (nao mock) com signup real.
**Ref:** Supabase docs sobre `app_metadata`.
**Tempo estimado:** 2h-3h.$n$,
  ARRAY[
    'Apos signup novo, `select raw_app_meta_data from auth.users where email = X` retorna `{"role":"client"}`',
    'Magic link signup com `data: { profile_kind: "provider" }` resulta em `role=provider`',
    '`profile_kind` invalido cai em default `client` (coberto por integration test com fixture)',
    'Migration aplica em dev sem erro; rollback documentado em comentario na migration',
    '`database.types.ts` regenerado e commitado junto com a migration',
    '`pnpm typecheck` verde apos regenerar tipos'
  ]
);

PERFORM pg_temp.add_dep(r_t5, r_t3, 'blocks');


-- ─── US-004 / T6 — client_profile + lgpd_consent ────────────────────────────
r_t6 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_004,
  'Criar tabelas client_profile e lgpd_consent com RLS por user_id e helper is_admin',
$d$## Objetivo
Schema persistente para perfil basico do cliente (nome, telefone, endereco
estruturado) e registro auditavel de consentimentos LGPD (versao dos termos
+ timestamp + tipo). RLS: cliente ve apenas seus dados; admin via helper
`is_admin()`.

## Contexto
Modulo AUTENTICACAO_ONBOARDING. Persona Lucas. Endereco estruturado (jsonb)
alimenta matching geografico em modulo MATCHING_ALOCACAO depois.

`lgpd_consent` e append-only (nao permite update/delete pelo usuario) — base
auditavel pra compliance.

## Estado atual
Schema vazio. Helper `is_admin()` ja deve existir no projeto (verificar antes).

## O que criar

### `supabase/migrations/20260508_client_profile_and_lgpd.sql`
```sql
create table public.client_profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null check (length(full_name) between 3 and 120),
  phone_e164 text not null check (phone_e164 ~ '^\+55[0-9]{10,11}$'),
  address    jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lgpd_consent (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  consent_key text not null check (consent_key in ('terms_of_use','privacy_policy','geolocation','marketing')),
  granted     boolean not null,
  version     text not null,
  granted_at  timestamptz not null default now(),
  source_ip   inet,
  user_agent  text,
  unique (user_id, consent_key, version)
);

alter table public.client_profile enable row level security;
alter table public.lgpd_consent   enable row level security;

create policy client_profile_self_select on public.client_profile
  for select using (auth.uid() = user_id or public.is_admin());
create policy client_profile_self_upsert on public.client_profile
  for insert with check (auth.uid() = user_id);
create policy client_profile_self_update on public.client_profile
  for update using (auth.uid() = user_id);

create policy lgpd_consent_self_select on public.lgpd_consent
  for select using (auth.uid() = user_id or public.is_admin());
create policy lgpd_consent_self_insert on public.lgpd_consent
  for insert with check (auth.uid() = user_id);
-- Append-only: sem update/delete por RLS.
```

### Regenerar tipos apos aplicar.

## Constraints / NAO fazer
- `lgpd_consent` e append-only — nunca habilitar `update` ou `delete` por RLS.
- `address` jsonb sempre validado por zod no client antes do insert.
- `phone_e164` so formato BR — outros paises entram quando expandirmos.

## Convencoes
- Helper `is_admin()` — verificar `database.types.ts` antes da migration.$d$,
  'medium', 'medium',
$n$**Habilita:** perfil form (T-NNN), tour onboarding (T-NNN), onboarding do prestador (modulo seguinte reusa pattern).
**Risco:** medio — schema e o ponto mais dificil de mudar depois. Revisar PR com PM.
**Estrategia de validacao:** integration test de RLS (cliente A nao ve cliente B) + tentativa de update em lgpd_consent.
**Ref:** memory `project_member_roles_access` (matriz de roles).
**Tempo estimado:** 4h-5h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro; tabelas criadas com checks de constraint',
    'Insert em `lgpd_consent` com `(user_id, consent_key, version)` duplicado falha com `unique_violation`',
    '`phone_e164` rejeita `''11999999999''` e aceita `''+5511999999999''` (testar via insert)',
    'Integration test: cliente A nao ve registro de `client_profile` do cliente B',
    'Tentativa de `update` em `lgpd_consent` retorna 403 RLS para o proprio user_id',
    '`database.types.ts` regenerado e commitado',
    '`pnpm typecheck` verde'
  ]
);

PERFORM pg_temp.add_dep(r_t6, r_t5, 'blocks');


-- ─── US-004 / T7 — Profile form com Places + ViaCEP ─────────────────────────
r_t7 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_004,
  'Persistir perfil basico do cliente com endereco autocomplete e consentimentos LGPD',
$d$## Objetivo
Form em `/onboarding/client/profile` que coleta nome, telefone e endereco do
cliente. Endereco com autocomplete Google Places (preferencia) e fallback
manual via ViaCEP. Rascunho persiste em localStorage ate submit. Submit
grava `client_profile` + 4 rows em `lgpd_consent` (terms, privacy,
geolocation, marketing) e redireciona pra `/home`.

## Contexto
Google Places API e paga (~US$0,017/req) — debounce 300ms obrigatorio.
ViaCEP e gratuito mas nao retorna lat/lng — `address.source = 'viacep'` e
geocoding fica lazy (matching engine resolve depois).

Modulo AUTENTICACAO_ONBOARDING. Persona Lucas.

## Estado atual
Pasta `(public)/onboarding/client/profile/` nao existe.

## O que criar

### `apps/web/src/lib/address/places.ts`
- `searchPlaces(query: string): Promise<PlaceSuggestion[]>` — Google Places
  Autocomplete com `componentRestrictions: { country: 'br' }`.
- `getPlaceDetails(placeId: string): Promise<StructuredAddress>`.
- `fetchByCep(cep: string): Promise<StructuredAddress>` — ViaCEP fallback.

### `apps/web/src/components/onboarding/profile-form.tsx` (client)
- Schema zod: `fullName.min(3)`, `phoneE164.regex(/^\+55.../)`,
  `address` (objeto estruturado), `lgpdAccepted: literal(true)`.
- `<AddressInput>` com debounce 300ms; dropdown Places; botao "Nao
  encontrei meu endereco" abre modo CEP.
- localStorage rascunho em `zelar.draft.client_profile` em cada change.
- Submit:
  - Insert em `client_profile`.
  - 4 inserts em `lgpd_consent` com `version='v1.0.0'`.
  - Limpar localStorage e `router.push('/home')`.

### `apps/web/src/app/(public)/onboarding/client/profile/page.tsx` (RSC)
- Redirect se ja existe `client_profile` para o user_id.

## Constraints / NAO fazer
- Nunca submit sem `lgpdAccepted === true` — botao fica `disabled`.
- Nao persistir telefone/CPF cru em localStorage em prod — guardar so
  `addressDraft` ou mascarado (ultimos 4 chars).
- Nao geocodificar ViaCEP automaticamente — deixar lat/lng `null` e marcar
  `address.source = 'viacep'`.

## Convencoes
- Field compound API (ver AGENTS.md secao 4) + `<FormBody density="comfortable">`.
- Debounce via `useDebouncedValue` (criar em `lib/hooks/` se nao existir).
- Toast `sonner` apenas em erro de rede; validacao inline.$d$,
  'high', 'large',
$n$**Habilita:** tour (US-005), home do cliente, primeira solicitacao de servico (modulo CATALOGO_SOLICITACAO).
**Risco:** alto — form longo, integracao paga (Google Places). Custos podem disparar se debounce vazar (>1k chamadas/dia).
**Estrategia de validacao:** unit + E2E + canary do Places em dev (cap de gastos no Google Cloud).
**Ref:** AC produto US-004. Memory `project_ui_patterns` (Field/FormBody).
**Tempo estimado:** 1d-1.5d.$n$,
  ARRAY[
    'Vitest `profile-form.test.tsx` cobre (a) submit OK com Places, (b) submit OK com ViaCEP, (c) bloqueio sem LGPD, (d) recovery de localStorage',
    'Playwright: fluxo signup -> perfil -> home com fixture de Google Places mockado',
    'localStorage limpo apos submit OK; preserva apos reload pre-submit',
    'Quatro rows em `lgpd_consent` com `version=v1.0.0` apos submit (consultadas via integration test)',
    'Lighthouse mobile >= 85 na rota `/onboarding/client/profile`',
    '`pnpm lint` + `pnpm typecheck` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_t7, r_t6, 'blocks');
PERFORM pg_temp.add_dep(r_t7, r_t4, 'blocks');


-- ─── US-005 / T8 — coluna onboarding_completed_at ───────────────────────────
r_t8 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_005,
  'Adicionar coluna onboarding completed at em client profile para sinalizar tour concluido',
$d$## Objetivo
Sinalizar que o tour foi concluido. `null` = tour nao rodou; `timestamptz`
= concluido (nao exibir mais).

## Contexto
Coluna mora em `client_profile` (criada em ZLAR-T-006) — flag por usuario,
nao tabela separada. Server-side guard impede tour reaparecer.

Modulo AUTENTICACAO_ONBOARDING.

## Estado atual
Tabela `client_profile` existe (T-006), sem o campo.

## O que criar

### `supabase/migrations/20260508_onboarding_completed_at.sql`
```sql
alter table public.client_profile
  add column onboarding_completed_at timestamptz;
```

### Regenerar `database.types.ts` apos aplicar.

## Constraints / NAO fazer
- Nada de default `now()` — `null` e o estado valido inicial pra users existentes.

## Convencoes
- Migration com prefixo de data.$d$,
  'trivial', 'micro',
$n$**Habilita:** componente de tour (T-NNN seguinte), guard server-side da home.
**Risco:** baixo — alter table aditivo.
**Tempo estimado:** 30min.$n$,
  ARRAY[
    'Migration aplica sem erro em dev',
    '`database.types.ts` reflete o novo campo `onboarding_completed_at: string | null`',
    'Linhas existentes ficam `onboarding_completed_at IS NULL`'
  ]
);

PERFORM pg_temp.add_dep(r_t8, r_t6, 'blocks');


-- ─── US-005 / T9 — Tour component ───────────────────────────────────────────
r_t9 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_005,
  'Renderizar tour de tres tooltips contextuais na home com persistencia de progresso',
$d$## Objetivo
Tour overlay que aparece quando `client_profile.onboarding_completed_at IS NULL`.
Tres tooltips ancorados em elementos reais da home (busca de categoria,
"Solicitar servico", "Historico"). Cada tooltip com "Proximo" e "Pular tour".
Progresso persiste em localStorage. Pular ou completar popula
`onboarding_completed_at` via server action.

## Contexto
shadcn nao tem componente de tour; opcao de implementar custom em ~80 linhas
com `<Popover>` posicionado, sem dep nova.

Modulo AUTENTICACAO_ONBOARDING. Persona Lucas. Cobre todos AC produto US-005.

## Estado atual
Home (`/home`) ainda nao existe — pode ser criada como placeholder minimo
nesta task ou previamente em outro modulo.

## O que criar

### `apps/web/src/components/onboarding/tour.tsx` (client)
- Props: `steps: TourStep[]`, `onFinish: () => Promise<void>`, `onSkip: () => Promise<void>`.
- Estado: `currentStep` em localStorage (`zelar.tour.step`).
- Render: backdrop semi-transparente + tooltip absolutamente posicionado
  no `data-tour-anchor` do elemento alvo.

### `apps/web/src/app/(client)/home/page.tsx`
- RSC le `onboarding_completed_at` do `client_profile`.
- Se `null`, hidrata `<Tour>` cliente.
- Anchors: tres elementos com `data-tour-anchor="search" | "request" | "history"`.

### `apps/web/src/app/(client)/home/_actions.ts`
- `completeOnboarding()` server action — `update client_profile set onboarding_completed_at = now() where user_id = auth.uid()`.

## Constraints / NAO fazer
- Nao bloquear interacao com a home — backdrop "soft" (pointer-events na home
  ficam ativos atras do tooltip).
- Tour NUNCA reaparece apos `onboarding_completed_at` populado — guard
  server-side.
- Sem libs novas — implementacao manual.

## Convencoes
- Animacao via `motion` (ja dep do projeto) ou Tailwind transition.
- Acessibilidade: `role="dialog" aria-modal="false"`, foco em "Proximo".$d$,
  'medium', 'medium',
$n$**Habilita:** primeira solicitacao de servico (modulo CATALOGO_SOLICITACAO).
**Risco:** medio — posicionamento absoluto + responsivo costuma quebrar em landscape.
**Estrategia de validacao:** Playwright em tres viewports (iPhone 13, Pixel 7, iPad portrait).
**Ref:** AC produto US-005.
**Tempo estimado:** 6h-8h.$n$,
  ARRAY[
    'Vitest `tour.test.tsx` cobre avancar, pular, retomar do step 2 apos reload',
    'Playwright: novo cliente ve tour; fecha no step 1; reload; retoma no step 1; pula -> DB tem `onboarding_completed_at` nao-null; reload -> sem tour',
    'Server action `completeOnboarding` rejeita chamada de admin (RLS impede update de outro user_id) — coberto por integration test',
    'Lighthouse mobile >= 85 na rota `/home` com tour ativo',
    '`pnpm lint` + `pnpm typecheck` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_t9, r_t8, 'blocks');
PERFORM pg_temp.add_dep(r_t9, r_t7, 'blocks');


-- ─── US-006 / T10 — Login form ──────────────────────────────────────────────
r_t10 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_006,
  'Renderizar tela de login do cliente com tres caminhos e erros inline genericos',
$d$## Objetivo
`/login` com tres abas: e-mail+senha, Google, magic link. Erros inline
genericos ("E-mail ou senha incorretos") sem revelar qual campo errou
(security). Sessao ativa redireciona pra `/home` (cliente) ou `/provider`
sem renderizar form.

## Contexto
Mesma stack do signup; reusa parte da UI (extrair `<AuthFormShell>` em
shared se ficar redundante).

Modulo AUTENTICACAO_ONBOARDING. Persona Lucas. Cobre AC produto US-006.

## Estado atual
Pagina `/login` ainda nao existe.

## O que criar

### `apps/web/src/app/(public)/login/page.tsx` (RSC)
- Le sessao; se autenticado redireciona pra home da role.

### `apps/web/src/components/auth/login-form.tsx` (client)
- Tabs: "E-mail e senha", "Google", "Magic link".
- Submit e-mail/senha:
  - `supabase.auth.signInWithPassword({ email, password })`.
  - Erros 400/401 -> mensagem generica unica; loga `error.code` no Sentry sem expor.
- Magic link: `signInWithOtp` + tela "Verifique seu e-mail".
- Link "Esqueci minha senha" -> `/reset-password` (T-NNN seguinte).
- Pos-login: `consumeNext()` ou `/home`/`/provider` por role.

## Constraints / NAO fazer
- Nunca distinguir "e-mail nao existe" de "senha errada" — sempre mensagem unica.
- Nao logar password no Sentry (assert no breadcrumb filter).
- Nao desabilitar Google se magic link expirou — usuario escolhe caminho.

## Convencoes
- Field API + zod schema.
- Toast `sonner` apenas para erro de rede.$d$,
  'medium', 'medium',
$n$**Habilita:** todas as rotas autenticadas do cliente, login do prestador (modulo LOGIN), recuperacao de senha (T-NNN).
**Risco:** medio — UX de erro e o que mais gera ticket de suporte. Validar com 3 testers reais.
**Estrategia de validacao:** unit + E2E + manual em mobile real.
**Ref:** AC produto US-006. OWASP Authentication Cheat Sheet.
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Vitest `login-form.test.tsx` cobre (a) credencial OK, (b) e-mail inexistente, (c) senha errada, (d) rede caiu. Casos (b) e (c) renderizam mesma string',
    'Playwright: login com fixture redireciona pra `/home`; sessao ativa pula tela',
    'Magic link expirado renderiza CTA "Enviar novo link" (mock do erro `otp_expired`)',
    'Sentry breadcrumb nao contem password (snapshot do payload em teste de integracao)',
    '`pnpm lint` + `pnpm typecheck` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_t10, r_t3, 'blocks');
PERFORM pg_temp.add_dep(r_t10, r_t2, 'blocks');


-- ─── US-006 / T11 — Recuperar senha ─────────────────────────────────────────
r_t11 := pg_temp.upsert_task(
  v_session_id, v_project_id, v_us_006,
  'Recuperar senha do cliente via email com template Resend em PT-BR',
$d$## Objetivo
Permitir reset de senha via e-mail. Usuario digita e-mail em `/reset-password`,
Supabase envia template Resend em PT-BR, link leva pra
`/auth/callback?type=recovery&next=/account/password-reset`, rota troca a
senha e redireciona pra `/home`.

## Contexto
Template `recovery.html` ja versionado em ZLAR-T-003. Supabase usa
`redirectTo` no `resetPasswordForEmail` que precisa estar em
`additional_redirect_urls`.

Modulo AUTENTICACAO_ONBOARDING. Cobre AC produto US-006 ("Recuperacao de
senha envia e-mail").

## Estado atual
Sem rota de reset.

## O que criar

### `apps/web/src/app/(public)/reset-password/page.tsx` (client)
- Form com input de e-mail.
- `supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL + '/auth/callback?type=recovery&next=/account/password-reset' })`.
- Sempre exibe mensagem aparente de sucesso ("Se o e-mail existir, enviaremos
  instrucoes") — nao confirma existencia (LGPD + security).

### `apps/web/src/app/(authenticated)/account/password-reset/page.tsx` (client)
- Le sessao (recovery link autenticou).
- Form: nova senha + confirmacao. Validacao zod (mesmo schema do signup: 8+ chars + 1 numero).
- `supabase.auth.updateUser({ password })` -> redirect `/home`.

## Constraints / NAO fazer
- Nunca dizer "esse e-mail nao esta cadastrado" — vazamento de PII (LGPD).
- Validar nova senha com mesmo schema do signup.

## Convencoes
- Mesma estetica do form de login.$d$,
  'low', 'small',
$n$**Habilita:** SLA de suporte — reduz ticket "esqueci senha".
**Risco:** baixo — fluxo Supabase nativo.
**Estrategia de validacao:** unit + Playwright de fluxo completo (request -> e-mail -> click -> set new pwd -> login com nova).
**Ref:** AC produto US-006.
**Tempo estimado:** 3h.$n$,
  ARRAY[
    'Vitest `reset-password.test.tsx` cobre submit (sempre sucesso aparente, mesmo se e-mail nao existe)',
    'Playwright: fluxo completo request -> e-mail -> click -> set new password -> login com nova senha',
    'Erro de rede no `resetPasswordForEmail` exibe toast "Tente novamente"',
    '`additional_redirect_urls` no `config.toml` cobre prod, dev e localhost (regression check em PR)',
    '`pnpm lint` + `pnpm typecheck` verdes'
  ]
);

PERFORM pg_temp.add_dep(r_t11, r_t3, 'blocks');
PERFORM pg_temp.add_dep(r_t11, r_t10, 'blocks');


-- Resumo
RAISE NOTICE 'Tasks criadas (em ordem): % % % % % % % % % % %',
  r_t1, r_t2, r_t3, r_t4, r_t5, r_t6, r_t7, r_t8, r_t9, r_t10, r_t11;

END $seed$;

COMMIT;
