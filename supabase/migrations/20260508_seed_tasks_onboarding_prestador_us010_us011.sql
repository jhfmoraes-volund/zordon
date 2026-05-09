-- =============================================================================
-- Seed: tasks técnicas — Lote A (US-010 + US-011)
-- Modulo: ONBOARDING_DO_PRESTADOR
-- Persona: Carlos
-- =============================================================================
-- US-010 (Acompanhar status KYC + boas-vindas) classificada DUPLICATA de US-081:
-- AC[0,1,2,4,5] já cobertos por T-044, T-045, T-046. AC[3] (boas-vindas + badge
-- + checklist) absorvido pela US-011 que naturalmente compoe a mesma tela.
--
-- US-011 NOVA (5 tasks). Anchor primario: feature `79f24380-6df9-41b5-a66f-b55684c5104a`
-- ([ONBOARDING][PRESTADOR] Primeiros Passos Pos-Aprovacao). Task 3 tambem
-- ancora em `4pnydyy` (boas-vindas) cobrindo AC[3] da US-010.
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
-- US-010 — DUPLICATA, marcar coverage
-- =============================================================================
SELECT runbook.mark_story_covered_by(
  'ZLAR-US-010',
  ARRAY['ZLAR-T-044','ZLAR-T-045','ZLAR-T-046'],
  'AC[0,1,2,4,5] cobertos por T-044 (waiting + Realtime), T-045 (reenvio com motivo), T-046 (bloqueio definitivo). AC[3] (boas-vindas + badge + checklist) absorvido pela US-011 task de welcome+checklist (mesma tela em UX).'
);

-- =============================================================================
-- US-011 — NOVA (5 tasks)
-- =============================================================================
DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story uuid := '97cb5443-b83c-48d1-a767-0b99355e10d3'; -- US-011
  v_feature text := '79f24380-6df9-41b5-a66f-b55684c5104a'; -- primeiros passos pos-aprovacao
  v_feature_welcome text := '4pnydyy'; -- aguardando + boas-vindas (US-010 absorvida)

  r_a text; r_b text; r_c text; r_d text; r_e text;
BEGIN

-- ─── TA — operator_availability + provider_bank_accounts schema ──────────────
r_a := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar tabelas operator_availability e provider_bank_accounts com RLS por user_id',
$d$## Objetivo
Schema das duas tabelas que governam quando Carlos entra no pool do matching
engine: disponibilidade semanal (`operator_availability`) e conta bancaria
verificada (`provider_bank_accounts`). Ambas referenciadas pela checklist de
primeiros passos (T-C) e pelo banner persistente (T-D).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Pre-condicao para AC produto
US-011 itens 1, 2, 4 (item 1 marcado se availability existir; item 2 marcado
se bank_accounts.verified; entrada no pool requer ambos).

`provider_bank_accounts` tambem e a base de US-012/US-086 (cadastro e
validacao de conta bancaria com Mercado Pago) — esta task cria o schema
minimo, US-012 vai estender com fluxo de validacao e webhook.

Stack: Postgres + RLS por user_id + FK em provider_profiles.

## Estado atual
Nenhuma das duas tabelas existe. AC produto referencia ambas mas nao ha schema.

## O que criar

### `supabase/migrations/<YYYYMMDD>_operator_availability.sql`
```sql
-- Tabela operator_availability (uma row por user, jsonb com slots semanais)
create table public.operator_availability (
  user_id      uuid primary key references public.provider_profiles(user_id) on delete cascade,
  weekly_slots jsonb not null default '[]'::jsonb,
  -- formato: [{ day: 0..6, start: "08:00", end: "18:00" }, ...]
  active       boolean not null default false,
  updated_at   timestamptz not null default now()
);

create index operator_availability_active_idx on public.operator_availability (active)
  where active = true;

alter table public.operator_availability enable row level security;

create policy operator_availability_self on public.operator_availability
  for all using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id);
```

### `supabase/migrations/<YYYYMMDD>_provider_bank_accounts.sql`
```sql
create type public.bank_account_type as enum ('checking', 'savings');

create table public.provider_bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.provider_profiles(user_id) on delete cascade,
  bank_code       text not null,             -- 001, 237, etc
  agency          text not null,
  account         text not null,
  account_type    public.bank_account_type not null,
  holder_cpf      text not null,             -- nao encrypted aqui (validado no front)
  recipient_id    text,                       -- Mercado Pago recipient_id (preenchido por US-012)
  verified        boolean not null default false,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index provider_bank_accounts_user_unique
  on public.provider_bank_accounts (user_id)
  where verified = true;
-- ^ Carlos so pode ter UMA conta verificada por vez. Trocar exige unverify
--   da anterior (US-086 cobre o fluxo de troca).

create index provider_bank_accounts_user_idx on public.provider_bank_accounts (user_id);

alter table public.provider_bank_accounts enable row level security;

create policy provider_bank_accounts_self_select on public.provider_bank_accounts
  for select using (auth.uid() = user_id or public.is_admin());

create policy provider_bank_accounts_self_insert on public.provider_bank_accounts
  for insert with check (auth.uid() = user_id);

create policy provider_bank_accounts_self_update on public.provider_bank_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Update de `verified` so via service_role (webhook Mercado Pago em US-012)
-- ou admin. Policy acima permite Carlos editar campos pessoais; tornar
-- `verified` write-protected via trigger.
create or replace function public.protect_bank_verified()
returns trigger language plpgsql as $f$
begin
  if (new.verified is distinct from old.verified)
     and not (auth.role() = 'service_role' or public.is_admin()) then
    raise exception 'verified can only be set by service_role or admin';
  end if;
  return new;
end;
$f$;

create trigger protect_bank_verified_trg
  before update on public.provider_bank_accounts
  for each row execute function public.protect_bank_verified();
```

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.

## Constraints / NAO fazer
- `recipient_id` NULLABLE — preenchido por webhook Mercado Pago (US-012).
- Apenas UMA conta `verified=true` por user (UNIQUE parcial). Troca exige
  unverify atomico da anterior (US-086 cobre).
- Carlos NAO pode setar `verified=true` direto — trigger bloqueia.
- Sem encrypt de bank/agency/account aqui — esses dados nao sao PII de mesma
  sensibilidade que CPF; Mercado Pago retorna recipient_id apos validacao.

## Convencoes
- Enum em `public.*`.
- Trigger pattern para campos write-protected.$d$,
  'medium', 'medium',
$n$**Habilita:** checklist de primeiros passos (T-C), entrada no pool de matching engine (US-011 item 4), US-012/US-086 (fluxo Mercado Pago em cima desse schema).
**Risco:** medio — schema reusado por matching engine + financeiro. Nao tem PII complexa, mas o trigger de verified e protecao critica.
**Estrategia de validacao:** integration test (a) Carlos insere bank_account; (b) tenta setar verified=true direto -> 403 do trigger; (c) service_role consegue setar verified=true; (d) operator_availability self-only.
**Ref:** Brainstorm card `79f24380-6df9-41b5-a66f-b55684c5104a` (technical_notes: operator_availability + provider_bank_accounts).
**Tempo estimado:** 5h-6h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Tabela `operator_availability` tem PK em user_id (1:1 com provider_profiles)',
    'Tabela `provider_bank_accounts` permite multiplas rows por user, mas UNIQUE parcial garante so 1 com verified=true',
    'Trigger `protect_bank_verified_trg` bloqueia UPDATE de `verified` por user authenticated; permite service_role e admin',
    'RLS: select de operator_availability/bank_accounts de outro user retorna 0 rows',
    'Constraint enum `bank_account_type` aceita apenas checking, savings',
    '`database.types.ts` regenerado; `pnpm typecheck` verde'
  ]
);
PERFORM pg_temp.add_dep(r_a, 'ZLAR-T-049', 'blocks');
PERFORM runbook.attach_task_anchor(r_a, v_feature, v_session_id, ARRAY[1,2], 'from_brainstorm');


-- ─── TB — provider_onboarding_completed_at + trigger ─────────────────────────
r_b := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Adicionar provider_onboarding_completed_at em provider_profiles com trigger de calculo automatico',
$d$## Objetivo
Coluna `provider_onboarding_completed_at` em `provider_profiles` que e
populada automaticamente quando ambos os pre-requisitos da US-011 estao
satisfeitos (operator_availability ativa + provider_bank_accounts verificada).
E o flag canonico que (a) remove o banner persistente da home (T-D), (b)
inclui Carlos no pool do matching engine (futuro), (c) marca conclusao de
onboarding em metricas.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-011 item 4.

Triggers:
- `operator_availability` UPDATE/INSERT com `active=true` -> recalcular flag.
- `provider_bank_accounts` UPDATE com `verified=true` -> recalcular flag.
- Logica de calculo: ambos satisfeitos AND status='approved' -> set `now()`;
  caso contrario, set `null` (revogacao volta atras).

Stack: Postgres trigger function `security definer`.

## Estado atual
Sem coluna. Sem maneira de saber se Carlos completou onboarding pos-KYC.

## O que criar

### `supabase/migrations/<YYYYMMDD>_provider_onboarding_completed.sql`
```sql
alter table public.provider_profiles
  add column provider_onboarding_completed_at timestamptz;

create or replace function public.recalc_provider_onboarding_completed(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $f$
declare
  v_has_avail boolean;
  v_has_bank  boolean;
  v_status    public.provider_status;
begin
  select status into v_status from public.provider_profiles where user_id = p_user_id;

  select exists(
    select 1 from public.operator_availability
    where user_id = p_user_id and active = true
  ) into v_has_avail;

  select exists(
    select 1 from public.provider_bank_accounts
    where user_id = p_user_id and verified = true
  ) into v_has_bank;

  if v_status = 'approved' and v_has_avail and v_has_bank then
    update public.provider_profiles
       set provider_onboarding_completed_at = coalesce(provider_onboarding_completed_at, now())
     where user_id = p_user_id;
  else
    update public.provider_profiles
       set provider_onboarding_completed_at = null
     where user_id = p_user_id;
  end if;
end;
$f$;

-- Triggers de origem
create or replace function public.trg_recalc_onboarding()
returns trigger language plpgsql as $f$
begin
  perform public.recalc_provider_onboarding_completed(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$f$;

create trigger operator_availability_recalc
  after insert or update or delete on public.operator_availability
  for each row execute function public.trg_recalc_onboarding();

create trigger provider_bank_accounts_recalc
  after insert or update or delete on public.provider_bank_accounts
  for each row execute function public.trg_recalc_onboarding();

-- Tambem disparar quando status muda (approved -> active ou contrario)
create trigger provider_profiles_recalc
  after update of status on public.provider_profiles
  for each row execute function public.trg_recalc_onboarding();
```

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.

## Constraints / NAO fazer
- `coalesce(provider_onboarding_completed_at, now())` — preserva o timestamp
  da PRIMEIRA vez que Carlos completou. Se ele unverify e re-verify a conta,
  o flag volta pro mesmo timestamp original.
- Trigger NAO recursivo: trigger em `provider_profiles UPDATE OF status`
  evita disparar quando o proprio recalc faz UPDATE da coluna
  (`update of status` filtra essa coluna).
- Sem RLS especial — leitura ja esta coberta pela policy de provider_profiles
  (Carlos ve a propria row).
- `recalc` e idempotente — pode ser chamado quantas vezes for.

## Convencoes
- Trigger function `security definer` + `set search_path = public`.
- Nome `recalc_*` para funcoes de recalculo derivado.$d$,
  'medium', 'small',
$n$**Habilita:** banner persistente (T-D) le essa coluna; entrada no pool de matching engine (futuro modulo MATCHING_ALOCACAO); metricas de funil de onboarding.
**Risco:** medio — trigger em 3 tabelas. Loop infinito se mal-projetado. Test de carga necessario.
**Estrategia de validacao:** integration test que (a) cria availability+bank verificada -> flag preenche; (b) unverify bank -> flag volta a null; (c) re-verify -> volta ao timestamp original; (d) delete availability -> flag volta a null.
**Ref:** Brainstorm `79f24380-...` (provider_onboarding_completed_at no provider_profiles). AC produto US-011 item 4.
**Tempo estimado:** 4h-5h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Coluna `provider_onboarding_completed_at` adicionada em provider_profiles (timestamptz nullable)',
    'Triggers em operator_availability, provider_bank_accounts e provider_profiles (status) chamam recalc',
    'Integration test: criar avail+bank verificada quando status=approved -> flag preenche com now()',
    'Integration test: unverify bank -> flag volta a null no proximo recalc',
    'Integration test: re-verify bank -> flag volta a coalesce(timestamp original) (preserva primeira conclusao)',
    'Integration test: status=pending_review com avail+bank verificada NAO preenche flag',
    'Sem trigger loop: `update of status` no trigger garante que update de outras colunas nao re-dispara',
    '`pnpm typecheck` verde'
  ]
);
PERFORM pg_temp.add_dep(r_b, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_b, 'ZLAR-T-049', 'blocks');
PERFORM runbook.attach_task_anchor(r_b, v_feature, v_session_id, ARRAY[4], 'from_brainstorm');


-- ─── TC — Tela welcome + checklist primeiros passos ──────────────────────────
r_c := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar tela de boas-vindas pos-aprovacao com badge Verificado e checklist dinamica de primeiros passos',
$d$## Objetivo
Tela `/provider/welcome` que aparece UMA UNICA VEZ apos Carlos ser aprovado
no KYC, exibindo badge "Verificado", mensagem de boas-vindas e checklist com
2 itens marcados dinamicamente conforme o estado do banco. Ao concluir os 2
itens, exibe badge de nivel "Iniciante" e libera CTA pra `/provider/home`.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Tela unica que cobre:
- AC produto US-010 item 3 (boas-vindas + badge + checklist) — feature 4pnydyy
- AC produto US-011 itens 0, 1, 2, 5 (checklist, marcacao automatica, level badge)

Razao da fusao: brainstorm card 4pnydyy combina "aguardando aprovacao + boas-vindas"
em um mesmo card; aguardando ja foi resolvido por T-044 (waiting screen). Boas-vindas
naturalmente compoe a mesma tela do checklist da US-011 — separar em duas
telas/components seria sobreposicao gratuita.

Stack: Next.js 15 RSC pra carregar checklist state + client component pra
re-render quando availability/bank mudam.

## Estado atual
Pasta `/provider/welcome/` nao existe. T-043 (getProviderRedirect) hoje manda
approved direto pra `/provider/home`.

## O que criar

### `apps/web/src/app/provider/welcome/page.tsx` (RSC)
- Le sessao + provider_profiles + operator_availability + provider_bank_accounts.
- Guard:
  - Se `status !== 'approved'` -> `redirect(getProviderRedirect(...))`.
  - Se `provider_onboarding_completed_at IS NOT NULL` -> `redirect('/provider/home')`.
- Renderiza `<WelcomeAndChecklist initial={...} userId={...} />`.

### `apps/web/src/components/onboarding/welcome-and-checklist.tsx` (client)
```tsx
'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/browser';

interface ChecklistState {
  hasAvailability: boolean;
  hasBankVerified: boolean;
}

export function WelcomeAndChecklist({ initial, userId }: { initial: ChecklistState; userId: string }) {
  const [state, setState] = useState(initial);
  const supabase = createBrowserClient();

  // Realtime subscribe — re-render quando availability/bank mudam
  useEffect(() => {
    const channel = supabase
      .channel(`onboarding:${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'operator_availability', filter: `user_id=eq.${userId}` },
        async () => {
          const { data } = await supabase.from('operator_availability').select('active').eq('user_id', userId).single();
          setState((s) => ({ ...s, hasAvailability: !!data?.active }));
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'provider_bank_accounts', filter: `user_id=eq.${userId}` },
        async () => {
          const { data } = await supabase.from('provider_bank_accounts').select('verified').eq('user_id', userId).eq('verified', true).maybeSingle();
          setState((s) => ({ ...s, hasBankVerified: !!data }));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase]);

  const allDone = state.hasAvailability && state.hasBankVerified;

  return (
    <main>
      <header>
        <h1>Bem-vindo, prestador!</h1>
        <Badge variant="success">Verificado</Badge>
      </header>
      <Checklist
        items={[
          { label: 'Configurar disponibilidade', done: state.hasAvailability, href: '/provider/availability' },
          { label: 'Adicionar conta bancaria', done: state.hasBankVerified, href: '/provider/bank' },
        ]}
      />
      {allDone && (
        <section>
          <Badge variant="level">Iniciante</Badge>
          <Button asChild><Link href="/provider/home">Comecar a receber servicos</Link></Button>
        </section>
      )}
    </main>
  );
}
```

### `apps/web/src/lib/auth/provider-redirect.ts` — extensao
- Adicionar branch: se `status='approved'` AND `provider_onboarding_completed_at IS NULL`
  -> `/provider/welcome` (primeira visita).
- Detalhes na T-E (delta separada para isolar mudanca em helper compartilhado).

## Constraints / NAO fazer
- Tela aparece "uma unica vez" — guard server-side via `provider_onboarding_completed_at`.
  Carlos pode tentar acessar /welcome direto, mas redirect manda ele pra /home.
- Realtime subscribe necessario — Carlos pode configurar availability em outra
  aba/tela e voltar pra welcome. Sem subscribe, item nao atualiza.
- Cleanup do channel obrigatorio (ver T-044 pra padrao).
- NAO chamar `recalc_provider_onboarding_completed` daqui — trigger DB cuida.
- Badge "Iniciante" e nivel inicial fixo — sistema completo de niveis fica
  fora do MVP.

## Convencoes
- Field/Card components do shadcn.
- Toast `sonner` em mudanca de estado ("Disponibilidade configurada!").$d$,
  'medium', 'medium',
$n$**Habilita:** Carlos sai do KYC com clareza dos proximos passos. Reduz drop-off.
**Risco:** medio — Realtime + multipart UI + redirect logic. Bug aqui = Carlos preso em /welcome.
**Estrategia de validacao:** Vitest cobre render por estado (0, 1, 2 itens marcados); Playwright e2e que muta DB e ve UI re-renderizar; manual em mobile.
**Ref:** Brainstorm cards `4pnydyy` (boas-vindas) + `79f24380-...` (primeiros passos). AC produto US-010 item 3 + US-011 itens 0, 1, 2, 5.
**Tempo estimado:** 6h-8h.$n$,
  ARRAY[
    'Vitest `welcome-and-checklist.test.tsx` cobre 4 estados: 0 marcados, so avail, so bank, ambos (CTA libera)',
    'Playwright e2e: estado inicial 0 marcados; INSERT em operator_availability via API admin; UI re-renderiza item 1 marcado; UPDATE em bank_accounts com verified=true; UI re-renderiza item 2 + badge Iniciante',
    'Guard: acesso a /provider/welcome com status=pending_review redireciona via getProviderRedirect',
    'Guard: acesso com provider_onboarding_completed_at preenchido redireciona pra /provider/home',
    'Cleanup do channel coberto: 100 ciclos mount/unmount nao deixam channels orfaos',
    'Badge "Verificado" sempre visivel; badge "Iniciante" so aparece com allDone=true',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_c, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_c, r_b, 'blocks');
-- Anchor duplo: feature primaria + feature da US-010 absorvida
PERFORM runbook.attach_task_anchor(r_c, v_feature, v_session_id, ARRAY[0,1,2,5], 'from_brainstorm');


-- ─── TD — Banner persistente na home ─────────────────────────────────────────
r_d := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar banner persistente na home enquanto onboarding nao estiver completo',
$d$## Objetivo
Banner fixo no topo de `/provider/home` que aparece enquanto
`provider_onboarding_completed_at IS NULL`. Mostra resumo do que falta
(checklist condensada) e CTA pra `/provider/welcome`. Some automaticamente
quando os dois pre-requisitos sao satisfeitos.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-011 item 3
(banner persistente nao-removivel manualmente).

Caso de uso: Carlos viu /welcome, clicou em /provider/home antes de completar
o checklist, agora precisa de lembrete persistente ate concluir.

Stack: Next.js 15 RSC + client component pra Realtime subscribe.

## Estado atual
`/provider/home` ainda nao existe (sera coberta pelo proprio modulo
EXECUCAO_DO_SERVICO). Esta task entrega o COMPONENT do banner; integracao no
layout home fica pra quando home for criada — banner ja fica disponivel pra
import.

## O que criar

### `apps/web/src/components/onboarding/onboarding-banner.tsx` (client)
```tsx
'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/browser';
import Link from 'next/link';

export function OnboardingBanner({ userId, initialCompleted }: { userId: string; initialCompleted: string | null }) {
  const [completed, setCompleted] = useState(initialCompleted);
  const supabase = createBrowserClient();

  useEffect(() => {
    const channel = supabase
      .channel(`onboarding-banner:${userId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'provider_profiles', filter: `user_id=eq.${userId}` },
        (payload) => setCompleted(payload.new.provider_onboarding_completed_at))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase]);

  if (completed) return null;

  return (
    <div className="onboarding-banner">
      <p>Complete seu cadastro para comecar a receber servicos.</p>
      <Link href="/provider/welcome">Ver passos pendentes</Link>
    </div>
  );
}
```

### Layout home (placeholder)
- Quando `/provider/home/page.tsx` for criada (modulo futuro), incluir:
  ```tsx
  const { data: profile } = await supabase.from('provider_profiles').select('provider_onboarding_completed_at').single();
  return (
    <>
      <OnboardingBanner userId={user.id} initialCompleted={profile?.provider_onboarding_completed_at ?? null} />
      ...
    </>
  );
  ```

## Constraints / NAO fazer
- Banner NAO removivel manualmente — sem botao X. AC explicito.
- Banner some automaticamente quando flag preenche — sem refresh manual.
- Sem persistencia em localStorage — estado vem todo do DB via Realtime.
- Component-only nesta task — integracao no layout home e responsabilidade
  do modulo EXECUCAO_DO_SERVICO quando criar `/provider/home`.

## Convencoes
- Cor neutra (nao usar destructive/warning) — e informativo, nao alerta.
- `<Alert variant="info">` shadcn ou estilo similar.$d$,
  'low', 'small',
$n$**Habilita:** Carlos sempre lembra de completar onboarding ao abrir o app. Reduz tickets "como recebo servicos?".
**Risco:** baixo — component isolado, sem efeitos colaterais.
**Estrategia de validacao:** Vitest cobre render condicional + subscribe/cleanup; Playwright cobre integracao quando home for criada.
**Ref:** Brainstorm `79f24380-...` (banner persistente). AC produto US-011 item 3.
**Tempo estimado:** 2h-3h.$n$,
  ARRAY[
    'Vitest `onboarding-banner.test.tsx` cobre render quando initialCompleted=null + esconde quando completed muda pra timestamp via Realtime payload mock',
    'Component NAO renderiza botao de fechar/dismiss',
    'Cleanup do channel coberto (100 ciclos mount/unmount)',
    'Realtime subscribe filtra por user_id=eq.<id> (assert via spy do .channel call)',
    'Component exporta props tipadas (userId: string, initialCompleted: string | null)',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_d, r_b, 'blocks');
PERFORM runbook.attach_task_anchor(r_d, v_feature, v_session_id, ARRAY[3], 'from_brainstorm');


-- ─── TE — getProviderRedirect: branch /provider/welcome ──────────────────────
r_e := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Estender getProviderRedirect para enviar para /provider/welcome quando onboarding incompleto',
$d$## Objetivo
Adicionar branch ao helper `getProviderRedirect` (criado em T-043, US-081)
para retornar `/provider/welcome` quando `status='approved'` AND
`provider_onboarding_completed_at IS NULL`. Hoje T-043 manda approved
direto pra `/provider/home`, pulando a tela de boas-vindas.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-010 item 2
(aprovacao navega automaticamente para tela de boas-vindas).

Razao de task separada: helper `getProviderRedirect` e ponto unico de routing
do prestador; e usado em 4+ lugares (login form, middleware, waiting screen,
welcome guard). Mudanca isolada em uma task facilita code review e regression
test.

Lacuna estrutural: brainstorm 4pnydyy explicita "direcionado para a home com
boas-vindas" mas T-043 do scope LOGIN nao tinha conceito de welcome screen
— so existia /home. Esta task fecha o gap.

Stack: TypeScript + funcao server-side ja existente.

## Estado atual
`apps/web/src/lib/auth/provider-redirect.ts` (T-043) tem 4 branches:
approved -> /provider/home, suspended -> /blocked, rejected -> /kyc,
pending_review -> /waiting. Falta o branch de welcome.

## O que criar

### `apps/web/src/lib/auth/provider-redirect.ts` — patch
```ts
export type ProviderRedirectTarget =
  | '/provider/home'
  | '/provider/welcome'  // NOVO
  | '/onboarding/provider/waiting'
  | '/onboarding/provider/kyc'
  | '/onboarding/provider/blocked';

export async function getProviderRedirect(userId: string): Promise<ProviderRedirectTarget> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('provider_profiles')
    .select('status, kyc_attempts, provider_onboarding_completed_at')  // adicionar campo
    .eq('user_id', userId)
    .single();

  if (error || !data) return '/onboarding/provider/waiting';

  if (data.status === 'approved') {
    // NOVA logica: welcome se onboarding incompleto
    return data.provider_onboarding_completed_at
      ? '/provider/home'
      : '/provider/welcome';
  }
  if (data.status === 'suspended' || data.kyc_attempts >= 2) return '/onboarding/provider/blocked';
  if (data.status === 'rejected') return '/onboarding/provider/kyc';
  return '/onboarding/provider/waiting'; // pending_review
}
```

### Locais que precisam ser revalidados
- `/provider/login/page.tsx` (T-042) — usa `getProviderRedirect`. Sem mudanca aqui.
- `middleware.ts` (T-047) — usa `getProviderRedirect`. Sem mudanca aqui.
- `/onboarding/provider/waiting/page.tsx` (T-044) — usa `getProviderRedirect`. Sem mudanca aqui.
- `/provider/welcome/page.tsx` (T-C desta migration) — usa `getProviderRedirect`. Sem mudanca aqui.

A mudanca e centralizada no helper; todos os callers se beneficiam automaticamente.

## Constraints / NAO fazer
- Manter ordem de checagem original (suspended/kyc_attempts antes de rejected)
  — invariante critica documentada em T-043.
- NAO cachear resultado em memoria — ja documentado em T-043. Cada chamada le DB.
- Type union literal preserva safety em compile time — manter pattern.
- Test deve cobrir os 5 casos novos (approved+completed, approved+null) sem
  regredir os 4 originais.

## Convencoes
- TypeScript literal union pra paths.$d$,
  'low', 'small',
$n$**Habilita:** Carlos approved cai em /welcome na primeira vez; volta a /home quando completou o checklist.
**Risco:** medio — helper e single source of truth de routing prestador. Bug aqui afeta 4+ rotas.
**Estrategia de validacao:** Vitest extende cobertura existente da T-043 com 2 cenarios novos (approved+completed, approved+null) + nao regride os 4 originais.
**Ref:** Brainstorm 4pnydyy (aprovacao navega para boas-vindas). AC produto US-010 item 2.
**Tempo estimado:** 2h-3h.$n$,
  ARRAY[
    'Vitest cobre 6 cenarios: approved+null -> /provider/welcome; approved+timestamp -> /provider/home; pending_review -> /waiting; rejected+attempts<2 -> /kyc; rejected+attempts=2 -> /blocked; suspended -> /blocked',
    'Type ProviderRedirectTarget inclui /provider/welcome — `pnpm typecheck` reclama de paths invalidos',
    'Caso edge: row sem provider_profile retorna /waiting (regressao da T-043 cobre)',
    'SELECT da query inclui provider_onboarding_completed_at',
    '`pnpm lint` verde'
  ]
);
PERFORM pg_temp.add_dep(r_e, r_b, 'blocks');
PERFORM pg_temp.add_dep(r_e, 'ZLAR-T-043', 'blocks');
PERFORM runbook.attach_task_anchor(
  r_e, v_feature_welcome, v_session_id, ARRAY[2], 'gap_fill',
  'T-043 do modulo LOGIN nao tinha conceito de welcome screen — so /home. Brainstorm 4pnydyy explicita "direcionado para boas-vindas" mas a logica de routing precisa estender o helper compartilhado.'
);


RAISE NOTICE 'US-011 tasks: % % % % %', r_a, r_b, r_c, r_d, r_e;

END $seed$;

COMMIT;
