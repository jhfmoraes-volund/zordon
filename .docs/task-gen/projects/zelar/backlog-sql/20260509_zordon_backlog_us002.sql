-- ZLAR-V2-US-002 — Fazer login como prestador e ser roteado conforme situação da conta
-- Persona: PRESTADOR  |  Módulo: ONBOARDING  |  9 AC
-- 12 tasks: 2 DATA + 5 API + 5 UI
-- Geração via skill /task-gen-story (docs/task-gen/)

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
-- T-013 [DATA] account_status + telemetria de sessão em provider_profiles
-- ----------------------------------------------------------------------------
('975f6d52-aaca-4319-92b2-d538ac882bf8',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-013',
 'Estender provider_profiles com account_status e telemetria de sessão',
 $desc$## Objetivo
Adicionar colunas que sustentam o roteamento pós-login (AC #7) e dão observabilidade mínima a US-008 (suspensão) e US-017 (moderação): `account_status`, `suspended_at`, `suspension_reason`, `last_sign_in_at`. Sem essas colunas o guard de rota da T-019 não tem como decidir.

## Contexto
Módulo ONBOARDING — depende de T-002/US-001 ter aplicado a tabela base. Esta migration é aditiva (ALTER TABLE), não recria a tabela. Consumida por T-014 (view de roteamento), T-019 (guard server-side) e por US-008 (motivo de suspensão) / US-017 (ações de moderação) quando essas chegarem.

## Estado atual / O que substitui
`provider_profiles` é criada em T-002 da US-001 (ainda em draft, não aplicada no DB). Esta task **estende** o schema, não recria. Hoje não há `account_status` nem campos de suspensão.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_account_status.sql`
```sql
BEGIN;

CREATE TYPE provider_account_status AS ENUM (
  'active', 'suspended', 'blocked', 'deleted'
);

ALTER TABLE provider_profiles
  ADD COLUMN account_status     provider_account_status NOT NULL DEFAULT 'active',
  ADD COLUMN suspended_at       timestamptz,
  ADD COLUMN suspension_reason  text,
  ADD COLUMN last_sign_in_at    timestamptz;

CREATE INDEX ON provider_profiles(account_status);

-- RLS já existe na tabela (T-002). Reforço: prestador NÃO pode UPDATE
-- account_status/suspended_at/suspension_reason via policy de owner —
-- essas colunas só mudam via service role (US-017) ou Edge Function (suspensão automática).
-- Como a policy "provider_update_own_safe" é WITH CHECK (auth.uid() = user_id),
-- não há colunar lock. Adiciono trigger BEFORE UPDATE que bloqueia mudança
-- dessas colunas se o caller não for service_role.
CREATE OR REPLACE FUNCTION provider_profiles_protect_admin_cols()
RETURNS trigger AS $$
BEGIN
  IF auth.role() = 'service_role' OR
     (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.account_status IS DISTINCT FROM OLD.account_status
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason THEN
    RAISE EXCEPTION 'forbidden_column_update' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER provider_profiles_protect_admin_cols
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION provider_profiles_protect_admin_cols();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não usar policy de coluna do PG15 ainda — nem todos os ambientes têm; trigger é portável
- ❌ Não default `account_status='active'` em backfill sem decidir caso de prestadores em análise (`kyc_status='in_review'` ainda é `active`; bloqueio é por `kyc_status`, não por `account_status`)
- ❌ `last_sign_in_at` não substitui auditoria — é campo de UX (mostrar "último acesso há 3 dias"). Eventos completos vão em `audit_log` (US-023) ou `provider_moderation_log` (US-017)

## Convenções
- Migration via psql; regenerar `database.types.ts` após
- Enum em snake_case (consistente com `provider_kyc_status`)
- Trigger SECURITY DEFINER para acessar `auth.role()`/`auth.jwt()`
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-014 [DATA] view provider_onboarding_state
-- ----------------------------------------------------------------------------
('cdbd64ee-917f-46f3-9bab-98082c313c69',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-014',
 'Criar view provider_onboarding_state (resolução de roteamento pós-login)',
 $desc$## Objetivo
Concentrar em uma view a decisão de roteamento pós-login: `signup_step`, `kyc_status`, `account_status`, e flags de pré-requisitos (categorias selecionadas, disponibilidade configurada, conta bancária). API T-018 lê uma única linha e decide a rota. Cobre AC #2, #3, #4, #5, #6, #7.

## Contexto
Módulo ONBOARDING — fonte única de verdade para o resolver de rota. Algumas fontes ainda não existem (US-003 categorias completas, US-027 disponibilidade, US-028 conta bancária); a view usa `EXISTS (...)` com `COALESCE(..., false)` para que pré-requisitos faltantes não quebrem o resolver — eles aparecem como `false` e a UI mostra checklist vazio. Quando US-003/US-027/US-028 forem implementadas, esta view ganha mais sinais sem mudar contrato.

## Estado atual / O que substitui
Não existe view de roteamento. Hoje o decisor seria espalhado em N queries no client.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_onboarding_state_view.sql`
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
  -- Pré-requisitos (US-003, US-027, US-028 — ainda em draft).
  -- Cada EXISTS é envolvido em COALESCE(...,false) e o regclass check evita
  -- erro caso a tabela ainda não exista.
  COALESCE(
    (SELECT COUNT(*) > 0 FROM provider_categories pc WHERE pc.provider_id = pp.id),
    false
  ) AS has_categories,
  -- Placeholder para US-027 (provider_availability) — falsifica até existir
  false AS has_availability,
  -- Placeholder para US-028 (provider_bank_accounts) — falsifica até existir
  false AS has_bank_account,
  -- Decisão derivada
  CASE
    WHEN pp.account_status = 'suspended' THEN 'suspended'
    WHEN pp.account_status = 'blocked'   THEN 'blocked'
    WHEN pp.kyc_status = 'pending' AND pp.signup_step < 5 THEN 'continue_signup'
    WHEN pp.kyc_status = 'in_review'                       THEN 'kyc_in_review'
    WHEN pp.kyc_status = 'rejected'                        THEN 'kyc_rejected'
    WHEN pp.kyc_status = 'blocked'                         THEN 'kyc_blocked'
    WHEN pp.kyc_status = 'approved' AND NOT (
         COALESCE((SELECT COUNT(*) > 0 FROM provider_categories pc WHERE pc.provider_id = pp.id), false)
         -- AND has_availability AND has_bank_account (US-027/028)
       )                                                    THEN 'first_steps'
    WHEN pp.kyc_status = 'approved'                         THEN 'home'
    ELSE 'continue_signup'
  END AS route_target
FROM provider_profiles pp;

-- View herda RLS da tabela base (SECURITY INVOKER, default).
-- Prestador vê só sua linha; admin vê tudo via policy "admin_all".

GRANT SELECT ON provider_onboarding_state TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Não usar `SECURITY DEFINER` — view pública violaria RLS de outros prestadores
- ❌ Não materializar (estado muda em cada login — refresh seria sempre stale)
- ❌ Não consumir esta view do client diretamente — sempre via T-018 (deixa contrato estável)
- ❌ Não adicionar campos que vazem dados de moderação (motivos detalhados de suspensão vêm em US-017 via outro endpoint)

## Convenções
- View name singular (`..._state`, não `..._states`) — uma linha por prestador
- Coluna `route_target` é o output canônico do resolver; valores são contrato com a UI (`continue_signup | kyc_in_review | kyc_rejected | kyc_blocked | first_steps | home | suspended | blocked`)
- Quando US-027/US-028 chegarem, atualizar as duas linhas marcadas como placeholder
$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-015 [API] POST /api/auth/provider/login (email/senha)
-- ----------------------------------------------------------------------------
('0f80a696-4b3d-4b0f-ac55-64a664698032',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-015',
 'Implementar POST /api/auth/provider/login (email/senha + erro genérico)',
 $desc$## Objetivo
Autenticar prestador com email/senha e estabelecer sessão via `@supabase/ssr` (cookies httpOnly). Em qualquer falha de credencial, retornar mensagem genérica "credenciais inválidas" — sem distinguir email-não-existe vs senha-errada (AC #8). Atualizar `last_sign_in_at` em sucesso. Cobre AC #1 (email/senha) e AC #8 (mensagem genérica).

## Contexto
Módulo ONBOARDING — porta de entrada do prestador no app. Usa Supabase Auth (`signInWithPassword`) via cliente SSR (memory `project_supabase_auth`). Após login, cliente da UI (T-020) chama T-018 para descobrir a rota. Rate limit por IP previne brute-force (AC #8 implícito).

## Estado atual / O que substitui
Não há endpoint de login customizado para prestador. Pode existir setup base de Supabase Auth (verificar `src/lib/supabase/server.ts`); este endpoint adiciona o passo de auditoria + atualização de `last_sign_in_at`.

## O que criar

### `src/app/api/auth/provider/login/route.ts`
```ts
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimitByIp } from '@/lib/rate-limit'; // criar em utils se não existir

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const GENERIC_ERROR = { error: 'invalid_credentials' };

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (!(await rateLimitByIp(ip, 'auth.login', { window: '5m', max: 10 }))) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json(GENERIC_ERROR, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  // SEMPRE retornar mesma forma e status — não revela se email existe
  if (error || !data.user) {
    return Response.json(GENERIC_ERROR, { status: 401 });
  }

  // Atualiza last_sign_in_at (best-effort; não bloqueia login se falhar)
  await supabase
    .from('provider_profiles')
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq('user_id', data.user.id);

  return Response.json({ user_id: data.user.id });
}
```

### `src/lib/rate-limit.ts` (se ainda não existir)
- Implementação simples baseada em tabela `rate_limits` (chave + janela) ou Upstash Redis se já configurado
- Função `rateLimitByIp(ip, action, { window, max })` retornando boolean

## Constraints / NÃO fazer
- ❌ Distinguir `user_not_found` vs `wrong_password` na resposta (AC #8 — segurança via uniformidade)
- ❌ Logar email em texto plano em caso de erro (PII — log apenas IP/hash)
- ❌ Aceitar GET ou método não-POST (responde 405)
- ❌ Confiar em `req.ip` direto sem `x-forwarded-for` (proxy do Vercel)
- ❌ Setar cookie manualmente — `@supabase/ssr` faz isso na hidratação

## Convenções
- Sessão via cookies httpOnly (padrão `@supabase/ssr` — memory `project_supabase_auth`)
- Idempotente (mesmo login 2x não duplica session)
- Latência sucesso ~150ms; falha ~150ms (mesmo tempo, evita timing attack — Supabase já garante)
- Resposta de erro: shape `{ error: 'invalid_credentials' }` com 401, sempre
$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','RATE_LIMIT','SECRET_HANDLING','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-016 [API] POST /api/auth/provider/google (OAuth callback)
-- ----------------------------------------------------------------------------
('6946625a-e1bb-43e8-81d0-6dd29418f639',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-016',
 'Implementar callback OAuth Google para login do prestador',
 $desc$## Objetivo
Processar retorno do OAuth do Google (PKCE flow do Supabase Auth) e estabelecer sessão. Se for primeiro login (sem `provider_profiles`), redireciona para wizard de cadastro continuando do step 2 (dados pessoais). Cobre AC #1 (Google).

## Contexto
Módulo ONBOARDING — espelho do email/senha mas via OAuth. Usa Supabase Auth com provider Google (configurado em Supabase Console). PKCE flow significa que o callback recebe `?code=` e troca por sessão. Diferente de email/senha: aqui o `auth.users` pode ser criado pelo Supabase no primeiro callback, então temos que detectar e bifurcar (signup vs login).

## Estado atual / O que substitui
Não há callback OAuth implementado. Supabase Console precisa ter Google provider habilitado (config infra, fora desta task).

## O que criar

### `src/app/auth/callback/provider/route.ts`
```ts
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) redirect('/login?error=oauth_missing_code');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) redirect('/login?error=oauth_failed');

  // Detecta primeiro login: sem provider_profile ⇒ rota pra wizard
  const { data: profile } = await supabase
    .from('provider_profiles')
    .select('user_id, signup_step')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!profile) {
    // Cria profile mínimo (signup_step=1, kyc_status=pending) via RPC
    // create_provider_with_consents — mas aqui falta accepted_terms.
    // Decisão: redireciona pro step 4 (TermsStep) com flag oauth=true,
    // que ao confirmar termos chama POST /signup com method='google'
    // e o id_token guardado em sessão.
    redirect('/onboarding/terms?oauth=google');
  }

  // Login normal: atualiza last_sign_in_at e deixa T-018 decidir rota
  await supabase
    .from('provider_profiles')
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq('user_id', data.user.id);

  redirect('/onboarding/route');
}
```

## Constraints / NÃO fazer
- ❌ Não criar `provider_profiles` aqui sem `accepted_terms` (LGPD — termos têm que ser aceitos antes)
- ❌ Não confiar no `id_token` cliente sem trocar via `exchangeCodeForSession`
- ❌ Não logar `code` em logs (segredo de troca)
- ❌ Não responder JSON — é redirect

## Convenções
- Path `/auth/callback/provider` casa com config do Google OAuth no Supabase
- Redirects sempre absolutos no Next 16 — `redirect()` do `next/navigation`
- Erros vão como query param `?error=` para a UI exibir Sonner toast
- Quando aceitar termos pós-OAuth, T-006/US-001 já tem o caminho (POST /signup com method='google' e accepted_terms=true)
$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-017 [API] POST /api/auth/forgot-password
-- ----------------------------------------------------------------------------
('969b805b-62f8-4290-beda-7107dbd9e869',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-017',
 'Implementar POST /api/auth/forgot-password com link de reset por email',
 $desc$## Objetivo
Disparar email de recuperação de senha via Supabase Auth (`resetPasswordForEmail`). Resposta sempre uniforme (200) — não revela se email existe (alinhado com AC #8). Rate limit forte (3 por hora por IP+email). Cobre o "recuperação de senha disponível" do AC #1.

## Contexto
Módulo ONBOARDING — endpoint público (não requer sessão). Fluxo: usuário pede reset → recebe email com link assinado pelo Supabase → clica → cai em `/auth/reset-password?token=...` (UI ainda não implementada nesta task; vive em T-020 ou separada). Template de email é configurável no Supabase Console (ou customizável via Resend em US-024).

## Estado atual / O que substitui
Não há fluxo de recuperação. Supabase Auth tem fluxo nativo; este endpoint só envelopa com rate limit + log + URL de redirect customizada.

## O que criar

### `src/app/api/auth/forgot-password/route.ts`
```ts
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimitByIp } from '@/lib/rate-limit';

const Body = z.object({ email: z.string().email() });

const GENERIC_OK = { sent: true };

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json(GENERIC_OK); // mesma resposta — não revela formato

  // Rate limit por IP+email (cap por par evita usuário pedir 100x)
  if (!(await rateLimitByIp(`${ip}:${parsed.data.email}`, 'auth.forgot', { window: '1h', max: 3 }))) {
    return Response.json(GENERIC_OK); // silenciosamente bloqueado — sem expor
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
  });

  // Sempre 200 — Supabase já retorna sucesso mesmo se email não existir
  return Response.json(GENERIC_OK);
}
```

## Constraints / NÃO fazer
- ❌ Diferenciar resposta entre "email existe" e "não existe" — sempre 200 com `{ sent: true }`
- ❌ Logar email em log estruturado de produção (PII; usar hash)
- ❌ Permitir domínio de redirect arbitrário — usar `NEXT_PUBLIC_APP_URL` fixo
- ❌ Encurtar janela de rate limit — 1h/3 é o que o Supabase tolera no plano padrão

## Convenções
- Mesma resposta em sucesso/falha (security via uniformidade)
- Rate key: `${ip}:${email}` (cap por par, não por IP só — evita falso-positivo em redes corporativas)
- Template padrão do Supabase no MVP; customização Resend fica em US-024 (NOTIFICACAO)
$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','RATE_LIMIT','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-018 [API] GET /api/onboarding/provider/route-state
-- ----------------------------------------------------------------------------
('138a5003-7960-4441-9b21-0a622e434486',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-018',
 'Implementar GET /api/onboarding/provider/route-state (resolver pós-login)',
 $desc$## Objetivo
Retornar para o cliente autenticado o `route_target` da view `provider_onboarding_state` + payload mínimo necessário para a tela alvo (ex: `kyc_blocked_reason` se rejected, contagem de tentativas restantes). UI (T-020/T-021/T-022/T-023) chama uma vez após login e navega. Cobre AC #2, #3, #4, #5, #6, #7.

## Contexto
Módulo ONBOARDING — single source of truth para roteamento. Lê uma linha da view `provider_onboarding_state` (T-014). Retorna shape estável que a UI consome com `switch`. Sem estado pós-login complicado: 1 chamada → 1 destino.

## Estado atual / O que substitui
Não existe resolver. Hoje seria espalhado em N queries no client.

## O que criar

### `src/app/api/onboarding/provider/route-state/route.ts`
```ts
import { createClient } from '@/lib/supabase/server';

type RouteTarget =
  | 'continue_signup' | 'kyc_in_review' | 'kyc_rejected' | 'kyc_blocked'
  | 'first_steps' | 'home' | 'suspended' | 'blocked';

type Payload = {
  route_target: RouteTarget;
  signup_step?: number;
  kyc_attempts_remaining?: number;
  kyc_blocked_reason?: string | null;
  suspension_reason?: string | null;
  first_steps_pending?: Array<'categories' | 'availability' | 'bank_account'>;
};

export async function GET() {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const { data: state, error } = await supabase
    .from('provider_onboarding_state')
    .select('*')
    .eq('user_id', user.user.id)
    .maybeSingle();

  // Sem profile = primeiro acesso pós-OAuth sem termos ainda
  if (!state) {
    return Response.json({ route_target: 'continue_signup', signup_step: 0 } satisfies Payload);
  }

  const payload: Payload = { route_target: state.route_target };
  switch (state.route_target) {
    case 'continue_signup':
      payload.signup_step = state.signup_step;
      break;
    case 'kyc_rejected':
      payload.kyc_attempts_remaining = Math.max(0, 3 - state.kyc_attempts);
      payload.kyc_blocked_reason = state.kyc_blocked_reason;
      break;
    case 'kyc_blocked':
      payload.kyc_blocked_reason = state.kyc_blocked_reason;
      break;
    case 'first_steps': {
      const pending: NonNullable<Payload['first_steps_pending']> = [];
      if (!state.has_categories) pending.push('categories');
      if (!state.has_availability) pending.push('availability');
      if (!state.has_bank_account) pending.push('bank_account');
      payload.first_steps_pending = pending;
      break;
    }
    case 'suspended':
    case 'blocked':
      payload.suspension_reason = state.suspension_reason;
      break;
  }
  return Response.json(payload);
}
```

## Constraints / NÃO fazer
- ❌ Calcular o `route_target` em TS aqui — a view T-014 é a fonte. Manter lógica em SQL evita drift
- ❌ Retornar dados sensíveis (CPF, nome completo) — UI já tem do login
- ❌ Cachear (estado muda toda transição de KYC) — sempre dynamic
- ❌ Expor a view diretamente via PostgREST sem este wrapper — mantém contrato estável

## Convenções
- GET (não muta nada)
- Status: 200 sempre que autenticado; 401 sem session
- `route_target` é enum literal — TS strictness via `satisfies Payload`
- Quando `provider_onboarding_state` não retorna linha (signup incompleto pós-OAuth), retorna `continue_signup` com step 0 (UI manda pro splash)
$desc$,
 'API', 'PRESTADOR', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-019 [API] guard server-side em proxy.ts (Next 16) bloqueando rotas op
-- ----------------------------------------------------------------------------
('058ddbdd-09a2-41db-abf9-ad92ecc57e56',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-019',
 'Adicionar guard em proxy.ts bloqueando rotas operacionais por estado da conta',
 $desc$## Objetivo
Server-side guard que intercepta `/(provider)/dashboard/**` e demais rotas operacionais e redireciona para a tela correta se o prestador não pode estar lá: suspenso → `/suspended`, KYC em análise → `/onboarding/kyc-review`, KYC reprovado → `/onboarding/kyc-rejected`, sem pré-requisitos → `/onboarding/first-steps`. Cobre AC #3, AC #7 — explicitamente sem dependência de proteção no frontend.

## Contexto
Módulo ONBOARDING — usa o `proxy.ts` do Next 16 (substitui middleware.ts em versões anteriores; ver `node_modules/next/dist/docs/`). Lê `provider_onboarding_state` via Supabase server client. Roda em todo request a `/(provider)/...` (exceto `/onboarding/**` para evitar loop). Decisão tomada na borda — UI pode confiar que se carregou, está autorizada.

## Estado atual / O que substitui
Pode haver `proxy.ts` na raiz (verificar — se sim, esta task estende; se não, cria). Hoje há setup de auth proxy básico (memory `project_supabase_auth`).

## O que criar

### `proxy.ts` (raiz do projeto Next)
```ts
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PROVIDER_OP_PREFIX = ['/dashboard', '/services', '/wallet', '/agenda'];
const ALLOW_DURING_ONBOARDING = ['/onboarding', '/auth', '/_next', '/api/auth'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (ALLOW_DURING_ONBOARDING.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (!PROVIDER_OP_PREFIX.some(p => pathname.startsWith(p))) return NextResponse.next();

  const supabase = createServerClient(/* cookies handler — ver memory project_supabase_auth */);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const { data: state } = await supabase
    .from('provider_onboarding_state')
    .select('route_target')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!state) return NextResponse.redirect(new URL('/onboarding', req.url));

  const target = state.route_target;
  if (target === 'home') return NextResponse.next();

  const map: Record<typeof target, string> = {
    home: '',
    continue_signup: '/onboarding',
    kyc_in_review:   '/onboarding/kyc-review',
    kyc_rejected:    '/onboarding/kyc-rejected',
    kyc_blocked:     '/onboarding/kyc-blocked',
    first_steps:     '/onboarding/first-steps',
    suspended:       '/suspended',
    blocked:         '/blocked',
  };
  return NextResponse.redirect(new URL(map[target] || '/onboarding', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### Audit log (best-effort)
- Quando guard redireciona por `suspended`/`blocked`, registrar evento em `audit_log` (tabela genérica de US-023, ainda não criada). Até US-023 chegar, usar `console.warn` estruturado com `{ event: 'route_blocked', user_id, target, path }` que dá pra grep no logs do Vercel.

## Constraints / NÃO fazer
- ❌ Não fazer query pesada no proxy — só `provider_onboarding_state` (1 row, indexado por user_id). Latência target <50ms p95
- ❌ Não cachear decisão por mais de 1 request — KYC pode mudar de `in_review` para `approved` a qualquer momento
- ❌ Não confiar em cookie custom — usar `auth.getUser()` que valida JWT no servidor (memory `project_supabase_auth`)
- ❌ Não duplicar guard no client — proxy é a fonte de verdade

## Convenções
- Arquivo `proxy.ts` (Next 16 — não `middleware.ts`)
- Matcher exclui assets estáticos para reduzir overhead
- Redirect com `NextResponse.redirect` (não `redirect()` do `next/navigation` — só funciona em RSC)
- Quando US-023 implementar `audit_log`, esta task vira target de update (atualmente: `relates_to` US-023)
$desc$,
 'API', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-020 [UI] Tela de login do prestador (email/senha + Google + esqueci senha)
-- ----------------------------------------------------------------------------
('268cd834-08e5-47c1-a0b2-37b09733e36c',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-020',
 'Renderizar tela de login do prestador (email/senha, Google, esqueci senha)',
 $desc$## Objetivo
Tela única `/login` com tabs email/senha + Google, link "Esqueci minha senha" abre `ResponsiveDialog` com 1 field. Em sucesso, chama `GET /api/onboarding/provider/route-state` (T-018) e navega conforme `route_target`. Em erro de credencial, Sonner toast com "credenciais inválidas". Cobre AC #1, AC #8, AC #9 (sessão persiste — feita pelo `@supabase/ssr` automaticamente).

## Contexto
Módulo ONBOARDING — porta de entrada do app. Mobile-first PWA. Form único, sem masked-input lib. Uso do **Field compound API** (regra obrigatória do projeto). Estado via `useState` direto. Erros em Sonner toast.

## Estado atual / O que substitui
`src/app/(provider)/login/page.tsx` ou `src/app/login/page.tsx` ainda não existe. Pode haver shell de auth herdado (memory `project_supabase_auth`); este é a UI especifica do prestador.

## O que criar

### `src/app/(provider)/login/page.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormBody } from '@/components/ui/field';
import { Tabs } from '@/components/ui/tabs';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';

export default function ProviderLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/provider/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        toast.error('Credenciais inválidas');
        return;
      }
      const route = await fetch('/api/onboarding/provider/route-state').then(r => r.json());
      router.push(routeTargetToPath(route));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Entrar como prestador</h1>

      <Tabs defaultValue="password" className="mt-6">
        <Tabs.List>
          <Tabs.Trigger value="password">Email e senha</Tabs.Trigger>
          <Tabs.Trigger value="google">Google</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="password" className="mt-4">
          <FormBody density="comfortable">
            <Field name="email" required>
              <Field.Label>Email</Field.Label>
              <Field.Control>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </Field.Control>
            </Field>
            <Field name="password" required>
              <Field.Label>Senha</Field.Label>
              <Field.Control>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} />
              </Field.Control>
            </Field>
            <Button onClick={submit} disabled={busy} className="w-full">Entrar</Button>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-sm text-muted-foreground underline"
            >
              Esqueci minha senha
            </button>
          </FormBody>
        </Tabs.Content>

        <Tabs.Content value="google" className="mt-4">
          <Button asChild variant="outline" className="w-full">
            <a href="/auth/sign-in/google?provider=google">Continuar com Google</a>
          </Button>
        </Tabs.Content>
      </Tabs>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </main>
  );
}
```

### `src/components/auth/ForgotPasswordDialog.tsx`
```tsx
// ResponsiveDialog com 1 field email + botão "Enviar"
// chama POST /api/auth/forgot-password (T-017)
// fecha com toast: "Se houver conta com este email, enviaremos um link"
```

### Helper de roteamento
```ts
// src/lib/auth/route-target.ts
export function routeTargetToPath(payload: { route_target: string; signup_step?: number }) {
  switch (payload.route_target) {
    case 'home':            return '/dashboard';
    case 'continue_signup': return `/onboarding/${stepKey(payload.signup_step ?? 0)}`;
    case 'kyc_in_review':   return '/onboarding/kyc-review';
    case 'kyc_rejected':    return '/onboarding/kyc-rejected';
    case 'kyc_blocked':     return '/onboarding/kyc-blocked';
    case 'first_steps':     return '/onboarding/first-steps';
    case 'suspended':       return '/suspended';
    case 'blocked':         return '/blocked';
    default:                return '/onboarding';
  }
}
```

## Constraints / NÃO fazer
- ❌ `<input>` sem `Field` (regra)
- ❌ `react-hook-form` (regra)
- ❌ Validação Zod no client (Zod só servidor)
- ❌ Mostrar mensagem que diferencie "email não existe" de "senha errada"
- ❌ Persistir password no estado fora do componente (limpar no unmount)
- ❌ `window.confirm`/`alert` — Sonner para erro
- ❌ Bloquear UI em loading sem feedback — `busy` controla `Button.disabled`

## Convenções
- Mobile-first (memory `project_ui_patterns`); viewport <768px ok
- Sessão persiste por padrão via `@supabase/ssr` (cookies httpOnly) — AC #9
- `ResponsiveDialog` para "esqueci senha" (1 field, decisão pontual)
- Reuso: `Button`, `Input`, `Field`, `Tabs`, `ResponsiveDialog`, `Sonner`
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-021 [UI] Tela "KYC em análise"
-- ----------------------------------------------------------------------------
('b24119c0-4022-49e0-97fb-7f14b28c6738',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-021',
 'Renderizar tela "KYC em análise" com estado de espera e suporte',
 $desc$## Objetivo
Tela informativa quando `kyc_status='in_review'`. Comunica que verificação está em andamento, mostra prazo estimado (ex: "até 24h em dias úteis"), oferece acesso a suporte (link para US-018) e logout. Sem botão "tentar de novo". Cobre AC #3.

## Contexto
Módulo ONBOARDING — destino quando T-018 retorna `route_target='kyc_in_review'`. Server Component (não há mutação). Sem polling — quando KYC for aprovado/reprovado, próximo login resolve a rota. Real-time pode entrar depois (out of scope nesta task; basta refresh).

## Estado atual / O que substitui
`src/app/(provider)/onboarding/kyc-review/page.tsx` ainda não existe.

## O que criar

### `src/app/(provider)/onboarding/kyc-review/page.tsx`
```tsx
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClockIcon } from 'lucide-react';

export default function KycReviewPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <ClockIcon className="size-12 text-amber-500" />
        <h1 className="text-2xl font-semibold">Verificação em análise</h1>
        <p className="text-sm text-muted-foreground">
          Recebemos seu envio. Em até 24h em dias úteis você recebe o resultado por
          email e push. Você não precisa fazer nada agora.
        </p>
      </div>

      <Card className="p-4 text-sm">
        <p className="font-medium">Enquanto isso:</p>
        <ul className="mt-2 list-disc pl-4 text-muted-foreground">
          <li>Mantenha seus dados em mãos caso precisemos validar algo</li>
          <li>Verifique a caixa de entrada e o spam</li>
        </ul>
      </Card>

      <div className="flex flex-col gap-2">
        <Button asChild variant="outline"><a href="/support">Falar com suporte</a></Button>
        <Button asChild variant="ghost"><a href="/auth/logout">Sair</a></Button>
      </div>
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Não permitir refazer envio de documento aqui (KYC já está em review; reenvio é só após `rejected`)
- ❌ Não mostrar "voltar para home" — não há home enquanto in_review
- ❌ Não polling de status (custo desnecessário; refresh manual ok)
- ❌ Sem `'use client'` (página estática)

## Convenções
- Reuso: `Card`, `Button`, `lucide-react`
- Mobile-first
- Sem optimistic update (read-only)
- Suporte aponta para `/support` (rota da US-018, ainda em draft)
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-022 [UI] Tela "KYC reprovado" com motivo + reenvio condicional
-- ----------------------------------------------------------------------------
('08b784b8-cc67-43a8-a3a7-f052a39b5422',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-022',
 'Renderizar tela "KYC reprovado" com motivo e reenvio se houver tentativas',
 $desc$## Objetivo
Quando T-018 retorna `route_target='kyc_rejected'`, renderizar motivo (`kyc_blocked_reason`) + contador de tentativas restantes (`kyc_attempts_remaining`). Botão "Enviar novamente" só aparece se restam tentativas; senão, tela de bloqueio definitivo com link para suporte. Cobre AC #4.

## Contexto
Módulo ONBOARDING — destino do roteamento pós-login para `kyc_status='rejected'`. Reenvio dispara fluxo do KYC (T-008 da US-001 — POST que inicia nova sessão Unico). Após 3 tentativas, bloqueio definitivo (`kyc_status` vira `blocked`).

## Estado atual / O que substitui
`src/app/(provider)/onboarding/kyc-rejected/page.tsx` ainda não existe. UI de envio de doc (passo do wizard) já está em T-011 da US-001 — esta tela é informativa antes de roteá-lo de volta.

## O que criar

### `src/app/(provider)/onboarding/kyc-rejected/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertTriangleIcon } from 'lucide-react';

export default async function KycRejectedPage() {
  const supabase = await createClient();
  const { data: state } = await supabase
    .from('provider_onboarding_state')
    .select('kyc_attempts, kyc_blocked_reason')
    .single();

  const remaining = Math.max(0, 3 - (state?.kyc_attempts ?? 0));
  const canRetry = remaining > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertTriangleIcon className="size-12 text-destructive" />
        <h1 className="text-2xl font-semibold">
          {canRetry ? 'Verificação não aprovada' : 'Verificação bloqueada'}
        </h1>
      </div>

      <Card className="p-4">
        <p className="text-sm font-medium">Motivo</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {state?.kyc_blocked_reason ?? 'Documento ilegível ou dados inconsistentes'}
        </p>
      </Card>

      {canRetry ? (
        <div className="flex flex-col gap-2">
          <p className="text-center text-sm text-muted-foreground">
            Você ainda tem {remaining} {remaining === 1 ? 'tentativa' : 'tentativas'}.
          </p>
          <Button asChild><a href="/onboarding/kyc">Enviar novamente</a></Button>
          <Button asChild variant="ghost"><a href="/auth/logout">Sair</a></Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-center text-sm text-muted-foreground">
            Limite de tentativas atingido. Entre em contato com o suporte.
          </p>
          <Button asChild variant="outline"><a href="/support?topic=kyc">Falar com suporte</a></Button>
          <Button asChild variant="ghost"><a href="/auth/logout">Sair</a></Button>
        </div>
      )}
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Mostrar contador de tentativas em formato técnico ("3/3" — usar linguagem natural)
- ❌ Permitir reenviar se `remaining === 0` (server-side já bloqueia, mas UI também não oferece)
- ❌ Vazar detalhes de fraude detectada (`kyc_blocked_reason` é texto curado pelo admin/Unico, não payload bruto)
- ❌ Auto-redirecionar para tela de envio sem confirmação visual

## Convenções
- Reuso: `Card`, `Button`, `lucide-react`
- Server Component (não `'use client'`)
- Texto descritivo curto e empático — não jurídico
- Mobile-first
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-023 [UI] Tela "primeiros passos" (checklist de pré-requisitos)
-- ----------------------------------------------------------------------------
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-023',
 'Renderizar tela "primeiros passos" com checklist de pré-requisitos',
 $desc$## Objetivo
Quando aprovado mas `first_steps_pending` não vazio, mostrar checklist com itens pendentes (categorias, disponibilidade, conta bancária) e CTAs para cada. Itens completos aparecem checados e desabilitados. Quando todos concluídos, redireciona para home. Cobre AC #5 e parte de AC #6.

## Contexto
Módulo ONBOARDING — destino do roteamento pós-login para prestadores aprovados sem pré-requisitos completos. Lê `first_steps_pending` da T-018 ou direto de `provider_onboarding_state`. CTAs apontam para US-003 (categorias se incompletas), US-027 (disponibilidade), US-028 (banco). Enquanto essas US não têm UI, links retornam 404 graciosamente — task fica completa mesmo assim, basta as US futuras criarem as rotas.

## Estado atual / O que substitui
`src/app/(provider)/onboarding/first-steps/page.tsx` ainda não existe. T-012 da US-001 fez "tela de boas-vindas pós-aprovação" — esta evolui para checklist persistente (US-001 só mostra mensagem; US-002 é o gate antes da home).

## O que criar

### `src/app/(provider)/onboarding/first-steps/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2Icon, CircleIcon } from 'lucide-react';

const STEPS: Array<{ key: 'categories' | 'availability' | 'bank_account'; label: string; href: string }> = [
  { key: 'categories',   label: 'Selecionar categorias de serviço', href: '/profile/categories' },
  { key: 'availability', label: 'Configurar disponibilidade semanal', href: '/profile/availability' },
  { key: 'bank_account', label: 'Cadastrar conta bancária', href: '/profile/bank' },
];

export default async function FirstStepsPage() {
  const supabase = await createClient();
  const { data: state } = await supabase
    .from('provider_onboarding_state')
    .select('has_categories, has_availability, has_bank_account')
    .single();

  if (!state) redirect('/onboarding');

  const completed: Record<string, boolean> = {
    categories:   state.has_categories,
    availability: state.has_availability,
    bank_account: state.has_bank_account,
  };
  if (Object.values(completed).every(Boolean)) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <header className="mt-6">
        <h1 className="text-2xl font-semibold">Primeiros passos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Complete para começar a receber propostas.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {STEPS.map(step => {
          const done = completed[step.key];
          return (
            <Card key={step.key} className="flex items-center gap-3 p-4">
              {done
                ? <CheckCircle2Icon className="size-6 shrink-0 text-emerald-600" />
                : <CircleIcon className="size-6 shrink-0 text-muted-foreground" />}
              <div className="flex-1">
                <p className={done ? 'text-sm text-muted-foreground line-through' : 'text-sm font-medium'}>
                  {step.label}
                </p>
              </div>
              {!done && <Button asChild size="sm" variant="outline"><a href={step.href}>Concluir</a></Button>}
            </Card>
          );
        })}
      </ul>
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Bloquear navegação para `/dashboard` aqui — guard server-side em T-019 já cuida
- ❌ Mutação de estado aqui (página é só visualização — mutações vivem nas US dos pré-requisitos)
- ❌ Auto-refresh — após completar item, usuário volta navegando (refresh natural revalida via Server Component)
- ❌ Mostrar items futuros não-pendentes (página só lista os 3 fixos; quando US-027/US-028 não existem, ficam sempre `false` → sempre pendente, e CTA leva pra rota que ainda 404)

## Convenções
- Reuso: `Card`, `Button`, `lucide-react`
- Server Component (lê estado direto, sem hidratação)
- Sem `useOptimisticCollection` (read-only)
- Itens em ordem fixa (não dinâmica) — UX previsível
- Mobile-first
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ----------------------------------------------------------------------------
-- T-024 [UI] Logout no menu de perfil
-- ----------------------------------------------------------------------------
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '51e9e577-0d7d-443b-94e6-0d5c4e517b2e',
 'ZLAR-V2-T-024',
 'Adicionar logout no menu de perfil com confirmação e invalidação server-side',
 $desc$## Objetivo
Item "Sair" no menu de perfil (e nos pontos onde já oferecemos no fluxo de KYC review/rejected) abre `ConfirmDialog`. Confirma → chama route handler que invoca `supabase.auth.signOut()` e redireciona para `/login`. Cobre AC #9 ("encerrar sessão manualmente pelo perfil").

## Contexto
Módulo ONBOARDING — botão isolado, mas global. Vai aparecer em (a) menu de perfil futuro (US-007), (b) telas de KYC review/rejected (T-021/T-022) e (c) tela suspensão (US-008). Esta task entrega o **mecanismo** + um ponto de uso default. Os outros pontos só importam o componente.

## Estado atual / O que substitui
Não há logout implementado. Pode haver setup de Supabase Auth client (memory `project_supabase_auth`).

## O que criar

### `src/components/auth/LogoutButton.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LogOutIcon } from 'lucide-react';

type Props = { variant?: 'ghost' | 'outline' | 'default'; label?: string };

export function LogoutButton({ variant = 'ghost', label = 'Sair' }: Props) {
  const router = useRouter();
  const [confirmState, setConfirmState] = useState<null | object>(null);

  return (
    <>
      <Button variant={variant} onClick={() => setConfirmState({})}>
        <LogOutIcon className="size-4" />
        {label}
      </Button>
      <ConfirmDialog
        state={confirmState && {
          title: 'Sair da sua conta?',
          confirmLabel: 'Sair',
          cancelLabel: 'Cancelar',
          destructive: true,
          onConfirm: async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            router.push('/login');
            router.refresh();
          },
        }}
        onClose={() => setConfirmState(null)}
      />
    </>
  );
}
```

### `src/app/api/auth/logout/route.ts`
```ts
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}
```

### Substituir `<a href="/auth/logout">` em T-021 e T-022
- Trocar pelo `<LogoutButton variant="ghost" />` quando esta task completar (essa troca é parte do checklist técnico).

## Constraints / NÃO fazer
- ❌ `window.confirm()` — usar `ConfirmDialog` (regra obrigatória)
- ❌ Logout só client-side (`signOut()` no browser) — sempre server-side para invalidar cookie httpOnly
- ❌ `<a>` simples — não invalida sessão server-side
- ❌ Redirecionar para "/" (root) — sempre `/login` para evitar loop com proxy guard

## Convenções
- Reuso: `Button`, `ConfirmDialog`, `Sonner` (futuro), `lucide-react`
- Estado de confirm: `state | null` (memory `project_ui_patterns`)
- `router.refresh()` após push para revalidar Server Components com nova sessão (vazia)
- Sem optimistic update (logout é definitivo)
$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());

-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculos task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT v.task_id::uuid, ac.id
FROM (VALUES
  -- T-013 [DATA account_status]: AC #7 (suspensão)
  ('975f6d52-aaca-4319-92b2-d538ac882bf8', 7),
  -- T-014 [DATA view onboarding_state]: AC #2,3,4,5,6,7
  ('cdbd64ee-917f-46f3-9bab-98082c313c69', 2),
  ('cdbd64ee-917f-46f3-9bab-98082c313c69', 3),
  ('cdbd64ee-917f-46f3-9bab-98082c313c69', 4),
  ('cdbd64ee-917f-46f3-9bab-98082c313c69', 5),
  ('cdbd64ee-917f-46f3-9bab-98082c313c69', 6),
  ('cdbd64ee-917f-46f3-9bab-98082c313c69', 7),
  -- T-015 [API login]: AC #1, #8
  ('0f80a696-4b3d-4b0f-ac55-64a664698032', 1),
  ('0f80a696-4b3d-4b0f-ac55-64a664698032', 8),
  -- T-016 [API google]: AC #1
  ('6946625a-e1bb-43e8-81d0-6dd29418f639', 1),
  -- T-017 [API forgot-password]: AC #1
  ('969b805b-62f8-4290-beda-7107dbd9e869', 1),
  -- T-018 [API route-state]: AC #2,3,4,5,6,7
  ('138a5003-7960-4441-9b21-0a622e434486', 2),
  ('138a5003-7960-4441-9b21-0a622e434486', 3),
  ('138a5003-7960-4441-9b21-0a622e434486', 4),
  ('138a5003-7960-4441-9b21-0a622e434486', 5),
  ('138a5003-7960-4441-9b21-0a622e434486', 6),
  ('138a5003-7960-4441-9b21-0a622e434486', 7),
  -- T-019 [API guard]: AC #3, #7
  ('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 3),
  ('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 7),
  -- T-020 [UI login]: AC #1, #8, #9
  ('268cd834-08e5-47c1-a0b2-37b09733e36c', 1),
  ('268cd834-08e5-47c1-a0b2-37b09733e36c', 8),
  ('268cd834-08e5-47c1-a0b2-37b09733e36c', 9),
  -- T-021 [UI kyc-review]: AC #3
  ('b24119c0-4022-49e0-97fb-7f14b28c6738', 3),
  -- T-022 [UI kyc-rejected]: AC #4
  ('08b784b8-cc67-43a8-a3a7-f052a39b5422', 4),
  -- T-023 [UI first-steps]: AC #5, #6
  ('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 5),
  ('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 6),
  -- T-024 [UI logout]: AC #9
  ('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 9)
) v(task_id, ac_order)
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = '51e9e577-0d7d-443b-94e6-0d5c4e517b2e'
 AND ac."order" = v.ac_order;

-- AC #2 também é coberto pela UI via T-010 da US-001 (wizard de cadastro retomado).
-- Vínculo cross-US documentado:
INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT '40739971-9477-4d49-b8e5-abffad23aeab'::uuid, ac.id
FROM "AcceptanceCriterion" ac
WHERE ac."userStoryId" = '51e9e577-0d7d-443b-94e6-0d5c4e517b2e'
  AND ac."order" = 2;

-- ============================================================================
-- 3. AcceptanceCriterion(taskId) — checklist técnico (AC-da-Task)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-013 [DATA account_status + telemetria]
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'Enum provider_account_status criado com 4 valores (active/suspended/blocked/deleted)', 1),
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'Colunas account_status, suspended_at, suspension_reason, last_sign_in_at adicionadas em provider_profiles', 2),
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'Índice em account_status criado', 3),
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'Trigger BEFORE UPDATE bloqueia mudança de account_status/suspended_at/suspension_reason por não-admin (smoke: UPDATE por prestador retorna ERRCODE 42501)', 4),
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'Service role consegue UPDATE dessas colunas sem erro', 5),
('975f6d52-aaca-4319-92b2-d538ac882bf8', 'last_sign_in_at é UPDATABLE pelo próprio prestador (T-015 atualiza em login)', 6),

-- T-014 [DATA view provider_onboarding_state]
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'View criada com SECURITY INVOKER (default) e GRANT SELECT TO authenticated', 0),
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'route_target retorna um dos 8 valores: continue_signup/kyc_in_review/kyc_rejected/kyc_blocked/first_steps/home/suspended/blocked', 1),
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'has_categories reflete EXISTS em provider_categories do prestador', 2),
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'has_availability e has_bank_account marcados como placeholder=false até US-027/US-028 existirem', 3),
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'Smoke: PRESTADOR autenticado lê só sua própria linha (RLS herdada)', 4),
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'Smoke: account_status suspended ⇒ route_target=suspended (mesmo com KYC aprovado)', 5),
('cdbd64ee-917f-46f3-9bab-98082c313c69', 'Smoke: kyc_status approved + has_categories=false ⇒ route_target=first_steps', 6),

-- T-015 [API POST /api/auth/provider/login]
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'Endpoint valida body com Zod (email + password)', 0),
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'Erro de credencial retorna 401 com {error:"invalid_credentials"} — mesma resposta para email inexistente e senha errada', 1),
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'Sucesso: cookie de sessão httpOnly setado via @supabase/ssr', 2),
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'last_sign_in_at em provider_profiles é atualizado em sucesso (best-effort, não bloqueia)', 3),
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'Rate limit 10/5min por IP retorna 429 quando excedido', 4),
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'Método não-POST retorna 405', 5),
('0f80a696-4b3d-4b0f-ac55-64a664698032', 'Body inválido (não-JSON ou shape errado) retorna 401 com mesma mensagem genérica (não 400)', 6),

-- T-016 [API OAuth Google]
('6946625a-e1bb-43e8-81d0-6dd29418f639', 'Callback /auth/callback/provider troca code por sessão via exchangeCodeForSession', 0),
('6946625a-e1bb-43e8-81d0-6dd29418f639', 'Sem code na query string, redireciona para /login?error=oauth_missing_code', 1),
('6946625a-e1bb-43e8-81d0-6dd29418f639', 'Primeiro login (sem provider_profile): redireciona para /onboarding/terms?oauth=google', 2),
('6946625a-e1bb-43e8-81d0-6dd29418f639', 'Login subsequente (com profile): atualiza last_sign_in_at e redireciona para /onboarding/route', 3),
('6946625a-e1bb-43e8-81d0-6dd29418f639', 'Provider Google habilitado em Supabase Console (config infra documentada na PR)', 4),
('6946625a-e1bb-43e8-81d0-6dd29418f639', 'code/id_token não aparece em logs estruturados', 5),

-- T-017 [API forgot-password]
('969b805b-62f8-4290-beda-7107dbd9e869', 'Endpoint sempre retorna 200 com {sent:true} — nunca distingue email existente', 0),
('969b805b-62f8-4290-beda-7107dbd9e869', 'Rate limit 3/hora por IP+email funciona (4ª chamada bloqueada silenciosa)', 1),
('969b805b-62f8-4290-beda-7107dbd9e869', 'resetPasswordForEmail é chamado com redirectTo=NEXT_PUBLIC_APP_URL/auth/reset-password', 2),
('969b805b-62f8-4290-beda-7107dbd9e869', 'Email não vazado em logs (PII)', 3),
('969b805b-62f8-4290-beda-7107dbd9e869', 'Smoke: email existente recebe link; inexistente também retorna 200 (sem email enviado)', 4),

-- T-018 [API GET /api/onboarding/provider/route-state]
('138a5003-7960-4441-9b21-0a622e434486', 'GET retorna 401 sem sessão', 0),
('138a5003-7960-4441-9b21-0a622e434486', 'Lê uma linha de provider_onboarding_state filtrada por user_id', 1),
('138a5003-7960-4441-9b21-0a622e434486', 'Payload de saída tipado e estável (route_target enum + campos opcionais por target)', 2),
('138a5003-7960-4441-9b21-0a622e434486', 'kyc_rejected retorna kyc_attempts_remaining (0..3) e kyc_blocked_reason', 3),
('138a5003-7960-4441-9b21-0a622e434486', 'first_steps retorna array first_steps_pending com itens não-completos', 4),
('138a5003-7960-4441-9b21-0a622e434486', 'suspended/blocked retorna suspension_reason', 5),
('138a5003-7960-4441-9b21-0a622e434486', 'Smoke: 6 estados diferentes mockados retornam route_target esperado', 6),

-- T-019 [API proxy guard]
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'proxy.ts bloqueia /(provider)/dashboard/** sem sessão (redireciona /login)', 0),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'Prestador suspended acessando /dashboard é redirecionado para /suspended', 1),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'Prestador com kyc_status=in_review acessando /dashboard cai em /onboarding/kyc-review', 2),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'Rotas /onboarding/** e /auth/** não disparam guard (sem loop)', 3),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'Latência p95 do proxy < 50ms (medido com 1 query indexada)', 4),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'Bloqueio loga {event:route_blocked, user_id, target, path} via console.warn estruturado', 5),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'Matcher exclui assets estáticos (_next/static, _next/image, favicon)', 6),

-- T-020 [UI login]
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Página /(provider)/login renderiza tabs email/senha e Google', 0),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Form usa Field compound API (sem <input> cru, sem react-hook-form)', 1),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Erro de credencial mostra Sonner toast "Credenciais inválidas" — sem distinguir email vs senha', 2),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Sucesso: chama GET /api/onboarding/provider/route-state e router.push para o destino', 3),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Botão "Esqueci minha senha" abre ResponsiveDialog com 1 campo email', 4),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Submit do dialog dispara POST /api/auth/forgot-password e fecha com toast genérico', 5),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Sessão persiste entre acessos sem refresh do user (verificado em iframe/aba)', 6),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Mobile <768px: form ocupa largura total, botões >=44px', 7),
('268cd834-08e5-47c1-a0b2-37b09733e36c', 'Botão "Continuar com Google" leva para fluxo OAuth Supabase', 8),

-- T-021 [UI kyc-review]
('b24119c0-4022-49e0-97fb-7f14b28c6738', 'Página /(provider)/onboarding/kyc-review é Server Component', 0),
('b24119c0-4022-49e0-97fb-7f14b28c6738', 'Mostra título, prazo estimado e instruções', 1),
('b24119c0-4022-49e0-97fb-7f14b28c6738', 'Sem botão de reenvio (proibido durante in_review)', 2),
('b24119c0-4022-49e0-97fb-7f14b28c6738', 'Botão "Falar com suporte" aponta para /support', 3),
('b24119c0-4022-49e0-97fb-7f14b28c6738', 'Botão "Sair" usa LogoutButton (após T-024 mergear) — nesta task pode ser <a> simples', 4),
('b24119c0-4022-49e0-97fb-7f14b28c6738', 'Reusa Card e Button do design system', 5),

-- T-022 [UI kyc-rejected]
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'Página /(provider)/onboarding/kyc-rejected é Server Component que lê provider_onboarding_state', 0),
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'Mostra kyc_blocked_reason em Card', 1),
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'Quando kyc_attempts < 3: botão "Enviar novamente" leva a /onboarding/kyc + texto com tentativas restantes', 2),
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'Quando kyc_attempts = 3: tela de bloqueio definitivo + botão "Falar com suporte"', 3),
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'Texto de motivo é o curado em kyc_blocked_reason — sem payload bruto da Unico', 4),
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'Reusa Card e Button do design system', 5),

-- T-023 [UI first-steps]
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'Página /(provider)/onboarding/first-steps é Server Component que lê has_categories/has_availability/has_bank_account', 0),
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'Lista 3 itens fixos: categorias, disponibilidade, conta bancária', 1),
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'Itens completos aparecem checkados, com texto riscado, sem CTA', 2),
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'Itens pendentes mostram CTA "Concluir" linkando para rota da US correspondente', 3),
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'Quando todos completos, redireciona para /dashboard (redirect server-side)', 4),
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', 'Mobile-first: cada Card ocupa largura total', 5),

-- T-024 [UI LogoutButton]
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'Componente LogoutButton em src/components/auth/LogoutButton.tsx', 0),
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'Click abre ConfirmDialog com title="Sair da sua conta?" e botão destrutivo', 1),
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'Confirm chama POST /api/auth/logout que invoca supabase.auth.signOut() server-side', 2),
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'Após signOut: router.push("/login") + router.refresh()', 3),
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'Cookie de sessão httpOnly é invalidado (verificado em devtools)', 4),
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'T-021 e T-022 trocam <a href="/auth/logout"> por <LogoutButton variant="ghost" />', 5),
('5485e3b3-323f-474d-8f5b-fdcaf2d7f3ac', 'Sem window.confirm(); sem <a> simples; sem signOut só client-side', 6);

-- ============================================================================
-- 4. TaskDependency (intra-US blocks + cross-US relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
-- Intra-US blocks
-- T-014 (view) depende de T-013 (account_status)
('cdbd64ee-917f-46f3-9bab-98082c313c69', '975f6d52-aaca-4319-92b2-d538ac882bf8', 'blocks'),
-- T-018 (resolver API) depende de T-014 (view)
('138a5003-7960-4441-9b21-0a622e434486', 'cdbd64ee-917f-46f3-9bab-98082c313c69', 'blocks'),
-- T-019 (proxy guard) depende de T-014 (view) e T-013 (account_status)
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', 'cdbd64ee-917f-46f3-9bab-98082c313c69', 'blocks'),
('058ddbdd-09a2-41db-abf9-ad92ecc57e56', '975f6d52-aaca-4319-92b2-d538ac882bf8', 'blocks'),
-- T-020 (UI login) depende de T-015, T-016, T-017, T-018
('268cd834-08e5-47c1-a0b2-37b09733e36c', '0f80a696-4b3d-4b0f-ac55-64a664698032', 'blocks'),
('268cd834-08e5-47c1-a0b2-37b09733e36c', '6946625a-e1bb-43e8-81d0-6dd29418f639', 'blocks'),
('268cd834-08e5-47c1-a0b2-37b09733e36c', '969b805b-62f8-4290-beda-7107dbd9e869', 'blocks'),
('268cd834-08e5-47c1-a0b2-37b09733e36c', '138a5003-7960-4441-9b21-0a622e434486', 'blocks'),
-- T-021/T-022/T-023 (UI estados) dependem de T-018 (resolver)
('b24119c0-4022-49e0-97fb-7f14b28c6738', '138a5003-7960-4441-9b21-0a622e434486', 'blocks'),
('08b784b8-cc67-43a8-a3a7-f052a39b5422', '138a5003-7960-4441-9b21-0a622e434486', 'blocks'),
('1e26cc23-c12b-4b1d-a74b-afd52c1ac03f', '138a5003-7960-4441-9b21-0a622e434486', 'blocks'),
-- T-022 (kyc-rejected) precisa do dado de kyc_blocked_reason e kyc_attempts (T-002 da US-001)
('08b784b8-cc67-43a8-a3a7-f052a39b5422', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'blocks'),

-- Cross-US relates_to
-- T-013 estende T-002 (US-001) — mesma tabela
('975f6d52-aaca-4319-92b2-d538ac882bf8', '706ef4c5-3ee1-4720-ab2f-3dd3c7394e07', 'relates_to'),
-- T-014 (view) lê provider_categories de T-003 (US-001)
('cdbd64ee-917f-46f3-9bab-98082c313c69', '8f552252-9053-45fe-8ffb-a35be93627b8', 'relates_to'),
-- T-018 (resolver) consome signup_step que T-007 (US-001) atualiza
('138a5003-7960-4441-9b21-0a622e434486', '80650191-0c7d-4e18-8962-7c8085655377', 'relates_to'),
-- T-022 (kyc-rejected) leva ao fluxo de reenvio de T-011 (US-001) — UI de envio
('08b784b8-cc67-43a8-a3a7-f052a39b5422', 'ca716c62-bad3-4919-b5e0-14d3f1d4a5bc', 'relates_to'),
-- T-019 (proxy guard) escreverá em audit_log de US-023 quando US-023 for gerada
-- (sem dependência ainda — task será atualizada na geração da US-023)

-- T-020 (UI login) usa wizard de T-010 (US-001) como destino quando AC#2 (continue_signup)
('268cd834-08e5-47c1-a0b2-37b09733e36c', '40739971-9477-4d49-b8e5-abffad23aeab', 'relates_to');

COMMIT;
