-- =============================================================================
-- Seed: tasks técnicas — Story ZLAR-US-059
-- (Entender motivo da suspensao e solicitar reativacao da conta)
-- Modulo: ONBOARDING_DO_PRESTADOR
-- Persona: Carlos
-- =============================================================================
-- 5 tasks novas. Anchor: feature `6db0ebaf-9cca-479c-9e63-d6a2b1630281`
-- ([CONTA][PRESTADOR] Reativacao de Conta Suspensa).
--
-- Reuso:
-- - T-009/T-010 (US-052) cuidam de moderation_log mas nao cobrem provider_suspensions
--   (historico completo + contestacoes) — schema novo necessario.
-- - T-046 (US-081) ja cobre AC[5] suspensao definitiva por KYC — tela /blocked
--   referenciada pelo redirect, NAO duplicar. Apenas roteamento condicional.
-- - T-061 (US-011) sera estendido com branch /provider/suspended (T-E gap_fill).
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
-- TASKS — US-059
-- =============================================================================
DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story uuid := '15fcab61-5fb2-4de6-b201-52434ba671bf'; -- US-059
  v_feature text := '6db0ebaf-9cca-479c-9e63-d6a2b1630281'; -- reativacao conta suspensa

  r_a text; r_b text; r_c text; r_d text; r_e text;
BEGIN

-- ─── TA — provider_suspensions + suspension_contests schema ──────────────────
r_a := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar tabelas provider_suspensions e suspension_contests com enum origin e RLS',
$d$## Objetivo
Schema do historico completo de suspensoes (com origem, prazo, quem
suspendeu, quem reativou) e das contestacoes formais que Carlos pode submeter.
Tabela de suspensoes e a fonte de verdade pra renderizar a tela suspended
com variante correta (T-C). Tabela de contestacoes alimenta fila admin.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-059
itens 0 (motivo especifico), 2 (suspensao temporaria com prazo), 3
(contestacao com evidencias).

5 origens possiveis (do brainstorm):
- `no_show` — 3 no-shows consecutivos (auto)
- `manual` — Ana via painel admin (provider_moderation_log)
- `geolocation` — revogacao de consentimento essencial
- `kyc` — 2 reprovacoes KYC (definitiva, sem contestacao)
- `penalty` — penalidade gradativa (4+ ocorrencias)

Stack: Postgres + RLS por user_id + helper `is_admin()` ja existente.

## Estado atual
Sem fonte de verdade do "porque suspended". Apenas `provider_profiles.status`
diz `suspended` mas nao diz por que.

## O que criar

### `supabase/migrations/<YYYYMMDD>_provider_suspensions.sql`
```sql
create type public.suspension_origin as enum (
  'no_show', 'manual', 'geolocation', 'kyc', 'penalty'
);

create table public.provider_suspensions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.provider_profiles(user_id) on delete cascade,
  origin               public.suspension_origin not null,
  reason               text not null,
  suspended_at         timestamptz not null default now(),
  suspended_until      timestamptz,                       -- null = indefinido
  suspended_by         uuid references auth.users(id),    -- null em auto-suspensoes
  reactivated_at       timestamptz,
  reactivated_by       uuid references auth.users(id),
  reactivation_reason  text
);

create index provider_suspensions_user_active_idx
  on public.provider_suspensions (user_id)
  where reactivated_at is null;
create index provider_suspensions_pending_until_idx
  on public.provider_suspensions (suspended_until)
  where reactivated_at is null and suspended_until is not null;

alter table public.provider_suspensions enable row level security;

create policy provider_suspensions_self on public.provider_suspensions
  for select using (auth.uid() = user_id or public.is_admin());

-- Insert/update so via service_role (auto-suspensoes) ou admin.
create policy provider_suspensions_admin_write on public.provider_suspensions
  for all using (public.is_admin()) with check (public.is_admin());

-- Tabela de contestacoes
create type public.contest_status as enum ('pending', 'accepted', 'rejected');

create table public.suspension_contests (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.provider_profiles(user_id) on delete cascade,
  suspension_id         uuid not null references public.provider_suspensions(id) on delete cascade,
  description           text not null check (length(description) between 20 and 2000),
  evidence_urls         text[] not null default array[]::text[],
  status                public.contest_status not null default 'pending',
  admin_decision_notes  text,
  created_at            timestamptz not null default now(),
  decided_at            timestamptz,
  decided_by            uuid references auth.users(id),

  constraint contest_unique_per_suspension unique (suspension_id)
);

create index suspension_contests_pending_idx
  on public.suspension_contests (created_at)
  where status = 'pending';

alter table public.suspension_contests enable row level security;

create policy suspension_contests_self_select on public.suspension_contests
  for select using (auth.uid() = user_id or public.is_admin());

create policy suspension_contests_self_insert on public.suspension_contests
  for insert with check (auth.uid() = user_id);

-- Update so admin (decisao da contestacao).
create policy suspension_contests_admin_update on public.suspension_contests
  for update using (public.is_admin());

-- Bucket Storage `suspension-evidence` privado (criar via Dashboard).
-- Path: {user_id}/{suspension_id}/{filename}
```

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.

## Constraints / NAO fazer
- `suspension_id` UNIQUE em `suspension_contests` — uma contestacao por
  suspensao. Re-submit substitui via UPDATE da contestacao existente
  (server action cuida).
- `evidence_urls` e text[] — paths do bucket Storage. Bucket privado.
- `description` length min 20 (forca Carlos a descrever) max 2000.
- Sem trigger de recalc aqui — reativacao automatica e responsabilidade da T-B.
- Suspensoes ATIVAS sao identificadas por `reactivated_at IS NULL` — queries
  da T-C devem filtrar por isso.

## Convencoes
- Enums em `public.*`.
- Policy split (select self, write admin) consistente com padrao da DS.$d$,
  'medium', 'medium',
$n$**Habilita:** tela suspended com variantes (T-C), contestacao (T-D), reativacao automatica (T-B), fila admin de contestacoes (futuro).
**Risco:** medio — schema com PII (descricao + evidencias) e RLS critico. Audit obrigatorio.
**Estrategia de validacao:** integration test — Carlos insere suspensao alheia retorna 403; admin le/atualiza tudo; UNIQUE em suspension_id rejeita duplicata.
**Ref:** Brainstorm `6db0ebaf-...` (technical_notes: provider_suspensions + suspension_contests).
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Enum `suspension_origin` tem 5 valores: no_show, manual, geolocation, kyc, penalty',
    'Enum `contest_status` tem 3 valores: pending, accepted, rejected',
    'UNIQUE em `suspension_contests.suspension_id` rejeita re-insert',
    'CHECK em `description` rejeita string com length < 20 ou > 2000',
    'RLS: Carlos le/insere apenas proprias rows; admin le/escreve todas',
    'Carlos NAO consegue UPDATE em provider_suspensions (only admin policy)',
    'Index parcial `provider_suspensions_user_active_idx` cobre `where reactivated_at is null`',
    '`database.types.ts` regenerado; `pnpm typecheck` verde'
  ]
);
PERFORM pg_temp.add_dep(r_a, 'ZLAR-T-041', 'blocks');
PERFORM runbook.attach_task_anchor(r_a, v_feature, v_session_id, ARRAY[0,2,3], 'from_brainstorm');


-- ─── TB — Reativacao automatica (trigger consent + pg_cron) ──────────────────
r_b := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar trigger de reativacao por consent_log e pg_cron job para reativacao por prazo expirado',
$d$## Objetivo
Dois mecanismos automaticos de reativacao:
1. **Trigger em consent_log**: quando Carlos re-aceita consentimento de
   geolocalizacao (INSERT com `consent_type='geolocation'` e `revoked_at IS NULL`),
   reativa conta automaticamente se ultima suspensao ativa tem `origin='geolocation'`.
2. **pg_cron job a cada hora**: reativa contas com `suspended_until < NOW()`
   e `reactivated_at IS NULL` (suspensoes temporarias por no_show/penalty
   com prazo conhecido).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-059
itens 1 (geolocalizacao -> reativa automaticamente), 2 (contador regressivo
+ data de reativacao automatica).

`consent_log` e referenciado mas ainda nao existe (vai vir na US-013/US-087).
Esta task ASSUME schema mencionado no brainstorm e fica condicional ao
deploy de US-013. Ate la, so pg_cron job opera.

Stack: Postgres trigger function + pg_cron extension.

## Estado atual
Sem mecanismo automatico. Toda reativacao seria manual via Ana.

## O que criar

### `supabase/migrations/<YYYYMMDD>_suspension_auto_reactivation.sql`
```sql
-- 1. Funcao de reativacao
create or replace function public.reactivate_provider_account(
  p_user_id uuid,
  p_reason  text,
  p_decided_by uuid default null
) returns void language plpgsql security definer set search_path = public as $f$
begin
  update public.provider_suspensions
     set reactivated_at = now(),
         reactivated_by = p_decided_by,
         reactivation_reason = p_reason
   where user_id = p_user_id
     and reactivated_at is null;

  update public.provider_profiles
     set status = 'approved'  -- volta pra approved (matching engine vai validar onboarding_completed)
   where user_id = p_user_id
     and status = 'suspended';
end;
$f$;

revoke execute on function public.reactivate_provider_account(uuid, text, uuid)
  from anon, authenticated;

-- 2. Trigger em consent_log (condicional ao deploy de US-013)
-- Schema esperado: public.consent_log (user_id, consent_type, revoked_at)
do $$
begin
  if to_regclass('public.consent_log') is not null then
    create or replace function public.trg_consent_reactivate()
    returns trigger language plpgsql security definer set search_path = public as $f$
    declare
      v_active_suspension public.provider_suspensions;
    begin
      if new.consent_type = 'geolocation' and new.revoked_at is null then
        select * into v_active_suspension
          from public.provider_suspensions
         where user_id = new.user_id
           and reactivated_at is null
           and origin = 'geolocation'
         order by suspended_at desc
         limit 1;

        if found then
          perform public.reactivate_provider_account(new.user_id, 'consentimento de geolocalizacao reativado pelo usuario', new.user_id);
        end if;
      end if;
      return new;
    end;
    $f$;

    drop trigger if exists consent_reactivate on public.consent_log;
    create trigger consent_reactivate
      after insert on public.consent_log
      for each row execute function public.trg_consent_reactivate();
  else
    raise notice 'consent_log nao existe ainda — trigger sera criado quando US-013 for aplicada';
  end if;
end $$;

-- 3. pg_cron job — reativacao por prazo
-- Requer pg_cron habilitado (Supabase ja vem por default).
select cron.schedule(
  'auto-reactivate-expired-suspensions',
  '0 * * * *',  -- a cada hora
  $cron$
    with expired as (
      select user_id from public.provider_suspensions
      where reactivated_at is null
        and suspended_until is not null
        and suspended_until < now()
    )
    select public.reactivate_provider_account(user_id, 'prazo de suspensao expirado', null)
    from expired;
  $cron$
);
```

## Constraints / NAO fazer
- `reactivate_provider_account` e idempotente — chamar 2x na mesma suspensao
  ja reativada nao faz nada (filter `reactivated_at is null`).
- Trigger de consent_log e CONDICIONAL — nao falha se tabela nao existe ainda.
  Quando US-013 deploya, re-rodar essa migration cria o trigger.
- pg_cron job NAO duplica — `cron.schedule` faz upsert por nome do job.
- Status volta pra `approved` (nao `active`) — matching engine valida
  `provider_onboarding_completed_at` separadamente.
- Reativacao por kyc origin nao e coberta aqui — KYC suspended e definitivo
  (AC[5]) e exige acao manual da Ana.

## Convencoes
- Funcao com `security definer` + revoke explicito.
- pg_cron jobs nomeados em kebab-case com prefixo do dominio.$d$,
  'medium', 'small',
$n$**Habilita:** Carlos volta automaticamente apos prazo ou re-consentimento — UX premium pra suspensoes temporarias.
**Risco:** medio — pg_cron + trigger condicional. Bug pode reativar conta antes do prazo (race) ou nao reativar nunca (cron silenciado).
**Estrategia de validacao:** integration test — (a) suspensao com `suspended_until` no passado e cron rodado manualmente reativa; (b) re-insert em consent_log com geolocation reativa se origin=geolocation; (c) origin=kyc nao reativa nunca.
**Ref:** Brainstorm `6db0ebaf-...` (pg_cron + trigger consent). AC US-059 itens 1, 2.
**Tempo estimado:** 4h-5h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Funcao `reactivate_provider_account` idempotente — chamar 2x na mesma suspensao reativada ja nao muda nada',
    'pg_cron job `auto-reactivate-expired-suspensions` registrado a cada hora',
    'Test manual: suspensao com `suspended_until` no passado + execucao manual do cron via `cron.alter_job` reativa',
    'Trigger consent_log NAO falha se tabela ainda nao existe (raise notice na migration)',
    'Test integration: insert em consent_log (geolocation, revoked_at=null) reativa conta com origin=geolocation; nao reativa se origin=manual',
    'Reativacao com origin=kyc nao acontece automaticamente (cobertura test)',
    '`pnpm typecheck` verde apos regen de types'
  ]
);
PERFORM pg_temp.add_dep(r_b, r_a, 'blocks');
PERFORM runbook.attach_task_anchor(r_b, v_feature, v_session_id, ARRAY[1,2], 'from_brainstorm');


-- ─── TC — Tela /provider/suspended com variantes ─────────────────────────────
r_c := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar tela /provider/suspended com variantes dinamicas por origin da suspensao mais recente',
$d$## Objetivo
Tela `/provider/suspended` que renderiza variante apropriada conforme
`provider_suspensions.origin` da suspensao ativa mais recente. 5 variantes:
- `no_show` / `penalty`: explica motivo + contador regressivo (se `suspended_until`).
- `manual`: explica motivo + CTA "Contestar suspensao" (T-D).
- `geolocation`: explica motivo + CTA "Reativar consentimento" -> redireciona pra /perfil/consents.
- `kyc`: redireciona pra `/onboarding/provider/blocked` (T-046 ja cobre — sem CTA contestar).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-059
itens 0, 1, 2, 3, 5.

AC[5] (KYC sem contestar) e roteado pra T-046 ja existente — esta tela
detecta `origin='kyc'` no servidor e redireciona, evitando duplicar UI.

Stack: Next.js 15 RSC + client component pra contador regressivo (Realtime
opcional pra reativacao em tempo real, mas simpler usa router.refresh em
intervalo).

## Estado atual
Pasta `/provider/suspended/` nao existe. Suspended hoje cai em `/blocked`
(T-046, US-081) que so cobre KYC.

## O que criar

### `apps/web/src/app/provider/suspended/page.tsx` (RSC)
```tsx
import { createServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getProviderRedirect } from '@/lib/auth/provider-redirect';
import { SuspendedNoShow } from '@/components/suspended/suspended-no-show';
import { SuspendedManual } from '@/components/suspended/suspended-manual';
import { SuspendedGeolocation } from '@/components/suspended/suspended-geolocation';

export default async function Page() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/provider/login');

  // Guard: status deve ser suspended; se nao, helper redireciona
  const { data: profile } = await supabase
    .from('provider_profiles')
    .select('status')
    .eq('user_id', user.id)
    .single();

  if (profile?.status !== 'suspended') {
    redirect(await getProviderRedirect(user.id));
  }

  // Ultima suspensao ativa
  const { data: suspension } = await supabase
    .from('provider_suspensions')
    .select('*')
    .eq('user_id', user.id)
    .is('reactivated_at', null)
    .order('suspended_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!suspension) {
    // Sem suspensao ativa mas status=suspended: estado inconsistente — manda pra welcome
    redirect('/provider/welcome');
  }

  if (suspension.origin === 'kyc') {
    redirect('/onboarding/provider/blocked');
  }

  switch (suspension.origin) {
    case 'no_show':
    case 'penalty':
      return <SuspendedNoShow suspension={suspension} />;
    case 'manual':
      return <SuspendedManual suspension={suspension} userId={user.id} />;
    case 'geolocation':
      return <SuspendedGeolocation suspension={suspension} />;
  }
}
```

### Components (3 variantes)

#### `apps/web/src/components/suspended/suspended-no-show.tsx`
- Header: "Conta suspensa temporariamente".
- Descricao: motivo (`suspension.reason`).
- Contador regressivo client-side ate `suspended_until` (atualiza a cada segundo).
- CTA: "Falar com suporte" (mailto).
- Quando contador zera, `router.refresh()` chama o RSC que detecta
  reativacao via cron job (T-B) e Carlos cai em /welcome ou /home.

#### `apps/web/src/components/suspended/suspended-manual.tsx`
- Header: "Conta suspensa pela equipe Zelar".
- Descricao: motivo.
- CTA primario: "Contestar suspensao" -> abre modal/sheet com form (T-D).
- CTA secundario: "Falar com suporte".
- Se ja tem contestacao pendente: mostrar "Sua contestacao esta em analise"
  + status atual (`suspension_contests.status`).

#### `apps/web/src/components/suspended/suspended-geolocation.tsx`
- Header: "Conta suspensa: consentimento de geolocalizacao revogado".
- Descricao explicativa.
- CTA: "Reativar consentimento" -> link pra `/perfil/consents` (rota da
  US-013/US-087, fora desta task).
- Aviso: "Ao reativar, sua conta sera reativada automaticamente em segundos."

## Constraints / NAO fazer
- Logica de variante MORA NO SERVIDOR (RSC) — nao no cliente. Carlos nao
  manipula query param pra ver variante errada.
- Sem subscribe Realtime aqui — `router.refresh()` quando contador zera e
  suficiente. Subscribe seria over-engineering.
- KYC origin redireciona pra T-046 — NAO duplicar tela blocked.
- Sem CTA de "Reativar agora" pra origin=no_show/penalty — prazo e fixo,
  reativacao manual quebra fairness.

## Convencoes
- Estrutura tela suspended com 3 components dedicados (split por variante).
- Card layout com tom warning (laranja) no header — diferente do blocked
  (vermelho/neutro) e do welcome (verde).$d$,
  'medium', 'medium',
$n$**Habilita:** Carlos sai do limbo "conta suspensa, sem saber porque". UX critica pra reduzir tickets.
**Risco:** medio — 3 variantes + redirect pra T-046 + dependencia de schema novo. Test cobre todas variantes.
**Estrategia de validacao:** Vitest cobre 3 variantes (no_show com contador, manual com CTA contestar, geolocation com CTA reativar) + redirect KYC; Playwright e2e simula cada origin.
**Ref:** Brainstorm `6db0ebaf-...` (5 origens + variantes). AC produto US-059 itens 0, 1, 2, 3, 5.
**Tempo estimado:** 6h-8h.$n$,
  ARRAY[
    'Vitest cobre 4 cenarios: origin=no_show com `suspended_until` futuro renderiza contador; origin=manual sem contestacao renderiza CTA contestar; origin=geolocation renderiza CTA reativar consentimento; origin=kyc renderiza redirect pra /onboarding/provider/blocked',
    'Vitest cobre estado: Carlos com origin=manual e contestacao pendente ve mensagem "em analise" sem CTA contestar repetido',
    'Guard server-side: status != suspended redireciona via getProviderRedirect',
    'Guard server-side: status=suspended sem suspensao ativa em provider_suspensions redireciona pra /welcome (estado inconsistente)',
    'Contador regressivo zera + `router.refresh()` chama RSC que (apos cron job) detecta reactivated_at preenchido e Carlos cai em /welcome',
    'Logica de variante mora no RSC, nao no cliente (test que muta query param nao muda variante)',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_c, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_c, 'ZLAR-T-061', 'blocks');
PERFORM runbook.attach_task_anchor(r_c, v_feature, v_session_id, ARRAY[0,1,2,3,5], 'from_brainstorm');


-- ─── TD — Server Action de submit de contestacao ─────────────────────────────
r_d := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar Server Action de submit de contestacao com upload de evidencias para storage privado',
$d$## Objetivo
Server Action `submitSuspensionContest({ suspensionId, description, evidenceFiles })`
que faz upload das evidencias pro bucket `suspension-evidence` privado e
insere row em `suspension_contests`. Re-submit de contestacao na mesma
suspensao substitui via UPSERT (UNIQUE em suspension_id).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-059
item 3 (formulario de contestacao com evidencias).

Stack: Next.js 15 Server Action + Supabase Storage + zod.

## Estado atual
Sem fluxo de contestacao. Carlos sem caminho formal pra reagir a suspensao manual.

## O que criar

### `apps/web/src/app/provider/suspended/actions.ts`
```ts
'use server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const ContestInput = z.object({
  suspensionId: z.string().uuid(),
  description: z.string().min(20).max(2000),
  // Files virao via FormData; aqui assumimos que ja foram convertidos pra blobs
});

export async function submitSuspensionContest(formData: FormData) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthorized' };

  const parsed = ContestInput.safeParse({
    suspensionId: formData.get('suspensionId'),
    description: formData.get('description'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  // Validacao: suspensao pertence ao user e esta ativa com origin=manual
  const { data: suspension } = await supabase
    .from('provider_suspensions')
    .select('id, user_id, origin, reactivated_at')
    .eq('id', parsed.data.suspensionId)
    .single();

  if (!suspension || suspension.user_id !== user.id) return { ok: false, error: 'not_found' };
  if (suspension.reactivated_at) return { ok: false, error: 'already_reactivated' };
  if (suspension.origin !== 'manual') return { ok: false, error: 'not_contestable' };

  // Upload das evidencias
  const files = formData.getAll('evidence') as File[];
  const urls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `${user.id}/${suspension.id}/${Date.now()}-${i}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from('suspension-evidence')
      .upload(path, file, { upsert: false });
    if (upErr) return { ok: false, error: 'upload_failed' };
    urls.push(path);
  }

  // Upsert da contestacao (UNIQUE em suspension_id)
  const { error: insErr } = await supabase
    .from('suspension_contests')
    .upsert({
      user_id: user.id,
      suspension_id: suspension.id,
      description: parsed.data.description,
      evidence_urls: urls,
      status: 'pending',
    }, { onConflict: 'suspension_id' });

  if (insErr) return { ok: false, error: 'unknown' };

  revalidatePath('/provider/suspended');
  return { ok: true };
}
```

### Bucket config
- Bucket `suspension-evidence` privado (criar via Supabase Dashboard).
- Path scheme: `{user_id}/{suspension_id}/{timestamp}-{idx}-{filename}`.
- Limit: 5 arquivos por submit, max 10MB cada (validado client-side em T-C).

## Constraints / NAO fazer
- Validar OWNERSHIP da suspensao server-side — Carlos nao contesta suspensao alheia.
- Validar que suspensao esta ATIVA — re-contestar suspensao ja reativada
  retorna `already_reactivated`.
- Validar que origin == 'manual' — contestar no_show/penalty/kyc nao faz
  sentido (auto-suspensoes objetivas).
- UPSERT por `suspension_id` permite Carlos editar a contestacao ate Ana decidir.
- Apos `decided_at` preenchido por Ana, Carlos NAO consegue editar (RLS de
  update so admin) — UI deve esconder form quando status != pending.
- NUNCA salvar arquivos no FS local — sempre Storage (Edge Functions / Vercel sao stateless).

## Convencoes
- Erros tipados com union string (serializavel pra client).
- Path scheme do Storage com timestamp + idx pra evitar colisao.$d$,
  'medium', 'small',
$n$**Habilita:** fluxo formal de contestacao com trilha de auditoria. Reduz tickets de suporte.
**Risco:** medio — upload + RLS + ownership check. Bug expoe evidencias alheias.
**Estrategia de validacao:** Vitest com mocks do Supabase Storage; Playwright e2e simula upload de 2 arquivos + submit; teste de path traversal no path.
**Ref:** Brainstorm `6db0ebaf-...` (suspension_contests + evidence). AC produto US-059 item 3.
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Vitest cobre 5 erros: unauthorized (sem user), invalid_input (desc < 20 chars), not_found (suspensao alheia), already_reactivated, not_contestable (origin != manual)',
    'Vitest cobre upload OK + insert na tabela com paths corretos',
    'Vitest cobre re-submit: UPSERT por suspension_id substitui description e urls',
    'Vitest valida ownership: tentativa de contestar suspensao de outro user retorna `not_found` (sem expor existencia)',
    'Path do upload contem `{user_id}/{suspension_id}/` — assert via spy',
    'Bucket config privado: tentar acessar URL publica retorna 401',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_d, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_d, r_c, 'blocks');
PERFORM runbook.attach_task_anchor(r_d, v_feature, v_session_id, ARRAY[3], 'from_brainstorm');


-- ─── TE — getProviderRedirect: branch /provider/suspended ────────────────────
r_e := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Estender getProviderRedirect e middleware para enviar suspended para /provider/suspended em vez de /blocked',
$d$## Objetivo
Adicionar branch ao helper `getProviderRedirect` (T-043 + extensoes) que
diferencia:
- `status='suspended'` AND ultima suspensao com `origin='kyc'` -> `/onboarding/provider/blocked` (T-046, comportamento atual).
- `status='suspended'` AND outra origin -> `/provider/suspended` (T-C, NOVO).

Tambem atualizar middleware (T-047) pra incluir `/provider/suspended` no
matcher de rotas autenticadas mas NAO bloquear acesso (Carlos suspended PODE
ver essa tela — e o destino dele).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-059
item 0 (acessar tela com motivo) e item 4 (apos reativacao -> /home).

Lacuna estrutural: T-043 + T-061 atualmente mandam `suspended` direto pra
`/blocked`, sem distinguir origin. Esta task fecha o gap pra que apenas
KYC origin caia em /blocked; demais variantes vao pra /suspended.

Stack: TypeScript + funcao server-side ja existente.

## Estado atual
`getProviderRedirect` (apos T-061): 5 paths possiveis. `suspended` atualmente
mapeia pra `/blocked` independente de origin.

## O que criar

### `apps/web/src/lib/auth/provider-redirect.ts` — patch
```ts
export type ProviderRedirectTarget =
  | '/provider/home'
  | '/provider/welcome'
  | '/provider/suspended'  // NOVO
  | '/onboarding/provider/waiting'
  | '/onboarding/provider/kyc'
  | '/onboarding/provider/blocked';

export async function getProviderRedirect(userId: string): Promise<ProviderRedirectTarget> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('provider_profiles')
    .select('status, kyc_attempts, provider_onboarding_completed_at')
    .eq('user_id', userId)
    .single();

  if (error || !data) return '/onboarding/provider/waiting';

  if (data.status === 'approved') {
    return data.provider_onboarding_completed_at ? '/provider/home' : '/provider/welcome';
  }

  if (data.status === 'suspended') {
    // Diferencia kyc origin (definitivo, sem contestacao) das demais
    const { data: suspension } = await supabase
      .from('provider_suspensions')
      .select('origin')
      .eq('user_id', userId)
      .is('reactivated_at', null)
      .order('suspended_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (suspension?.origin === 'kyc' || data.kyc_attempts >= 2) {
      return '/onboarding/provider/blocked';
    }
    return '/provider/suspended';
  }

  if (data.kyc_attempts >= 2) return '/onboarding/provider/blocked';
  if (data.status === 'rejected') return '/onboarding/provider/kyc';
  return '/onboarding/provider/waiting';
}
```

### `apps/web/middleware.ts` (T-047) — patch
- Adicionar `/provider/suspended` ao matcher (ja coberto por `/provider/:path*`).
- Excluir `/provider/suspended` do block de status != approved (Carlos suspended PODE acessar).
- Logica:
  ```ts
  const allowSuspended = pathname.startsWith('/provider/suspended');
  // ...
  if (target !== '/provider/home' && pathname.startsWith('/provider/home') && !allowSuspended) {
    return NextResponse.redirect(url);
  }
  ```

## Constraints / NAO fazer
- Manter ordem de checagem: kyc origin/attempts >= 2 ANTES de `/suspended`
  generico (consistente com filosofia "definitivo bloqueia mais").
- Cada chamada faz 2 queries (perfil + suspensao) — aceitavel pq routing
  acontece poucas vezes (apos auth, em transicao). NAO cachear.
- Test deve cobrir 7 cenarios agora (5 originais + 2 novos: suspended+kyc, suspended+other).
- Middleware NAO deve fazer redirect loop em /provider/suspended -> getProviderRedirect
  -> /provider/suspended (cobertura test).

## Convencoes
- Type union literal preserva safety.
- Query secundaria so quando necessario (status=suspended) — ramo curto-circuita.$d$,
  'low', 'small',
$n$**Habilita:** Carlos suspended por origens nao-KYC ve tela apropriada com CTA. Carlos KYC continua em /blocked como T-046.
**Risco:** medio — helper compartilhado por 4+ rotas. Test extensivo necessario.
**Estrategia de validacao:** Vitest extende cobertura de T-043+T-061 com 2 cenarios novos (suspended+kyc, suspended+manual) + nao regride os 6 anteriores; test de loop em /provider/suspended.
**Ref:** Brainstorm `6db0ebaf-...` (5 origens com paths distintos). AC produto US-059 itens 0, 4.
**Tempo estimado:** 3h-4h.$n$,
  ARRAY[
    'Vitest cobre 8 cenarios: approved+null -> /welcome; approved+timestamp -> /home; pending_review -> /waiting; rejected+attempts<2 -> /kyc; rejected+attempts=2 -> /blocked; suspended+origin=kyc -> /blocked; suspended+origin=manual -> /suspended; suspended sem suspensao ativa -> /blocked (kyc_attempts >= 2 fallback)',
    'Type ProviderRedirectTarget inclui /provider/suspended',
    'Middleware NAO faz redirect loop em /provider/suspended (regressao test)',
    'Test integration: Carlos com status=suspended + origin=manual acessa /provider/suspended (200, sem redirect)',
    'Test integration: Carlos com status=suspended + origin=kyc acessa /provider/suspended e e redirecionado para /onboarding/provider/blocked',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_e, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_e, 'ZLAR-T-061', 'blocks');
PERFORM pg_temp.add_dep(r_e, 'ZLAR-T-047', 'blocks');
PERFORM runbook.attach_task_anchor(
  r_e, v_feature, v_session_id, ARRAY[0,4], 'gap_fill',
  'T-043+T-061 mapeavam suspended -> /blocked sem distinguir origin. Brainstorm exige variantes; helper precisa estender + middleware atualizar matcher pra permitir acesso a /provider/suspended.'
);


RAISE NOTICE 'US-059 tasks: % % % % %', r_a, r_b, r_c, r_d, r_e;

END $seed$;

COMMIT;
