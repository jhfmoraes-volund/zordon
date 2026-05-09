-- =============================================================================
-- Seed: tasks técnicas — Story ZLAR-US-009
-- (Enviar documentos e realizar KYC via Unico)
-- Modulo: ONBOARDING_DO_PRESTADOR (proposed)
-- Persona: Carlos
-- =============================================================================
-- Cobre os 6 AC produto da US-009 com slicing DB → RPC → Edge → UI.
-- Reusa T-041 (provider_profiles + kyc_attempts) e T-049 (perfil estendido).
-- Anchor: feature `iy2o0hb` ([CADASTRO][PRESTADOR] Upload de Documentos e KYC via Unico).
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
-- TASKS — US-009
-- =============================================================================
DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story uuid := 'fd344a29-2ed8-4d7d-8187-4427f9d15eec'; -- US-009
  v_feature text := 'iy2o0hb'; -- brainstorm anchor

  r_a text; r_b text; r_c text; r_d text;
BEGIN

-- ─── TA — provider_documents schema + feature flag ───────────────────────────
r_a := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar tabela provider_documents com RLS e feature flag auto_approve_kyc',
$d$## Objetivo
Schema central que persiste o resultado do KYC do prestador — fonte de verdade
sobre o que foi enviado, score retornado pela Unico e decisao final. Feature
flag global `auto_approve_kyc` em tabela de settings controla se score >= 0.7
aprova automaticamente ou cai em fila manual.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Pre-condicao para webhook
Unico (T-C), RPC de decisao (T-B) e fila admin (T-013/T-014 da US-052).

Stack: Postgres + RLS por user_id + Storage URLs (documentos hospedados em
Supabase Storage no bucket `kyc-documents` privado).

## Estado atual
Tabela nao existe. Sem fonte de verdade dos documentos KYC.

## O que criar

### `supabase/migrations/<YYYYMMDD>_provider_documents.sql`
```sql
create type public.kyc_status as enum (
  'pending', 'approved', 'rejected', 'manual_review'
);

create type public.document_type as enum ('rg', 'cnh');

create table public.provider_documents (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.provider_profiles(user_id) on delete cascade,
  document_type         public.document_type not null,
  document_front_url    text not null,
  document_back_url     text,
  selfie_url            text not null,
  kyc_score             numeric(4,3) check (kyc_score >= 0 and kyc_score <= 1),
  kyc_status            public.kyc_status not null default 'pending',
  rejection_reason      text,
  unico_transaction_id  text unique,
  submitted_at          timestamptz not null default now(),
  reviewed_at           timestamptz,
  reviewed_by           uuid references auth.users(id)
);

create index provider_documents_user_idx on public.provider_documents (user_id);
create index provider_documents_status_idx on public.provider_documents (kyc_status)
  where kyc_status in ('pending', 'manual_review');

alter table public.provider_documents enable row level security;

-- Carlos le os proprios documentos. Ana (admin) le tudo.
create policy provider_documents_self_select on public.provider_documents
  for select using (auth.uid() = user_id or public.is_admin());

-- Insert: client autenticado pode inserir o proprio submit (front faz upload + insert).
create policy provider_documents_self_insert on public.provider_documents
  for insert with check (auth.uid() = user_id);

-- Update so via service_role (webhook) ou admin (fila manual).
create policy provider_documents_admin_update on public.provider_documents
  for update using (public.is_admin());
```

### Feature flag global
```sql
create table public.app_settings (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('auto_approve_kyc', 'true'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select using (true);
create policy app_settings_admin_write on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());
```

### Bucket de Storage
- Criar bucket `kyc-documents` privado (Supabase Dashboard ou via API).
- Policies do bucket: insert por `auth.uid() = user_id` no path; select so admin + dono.

### Tipos
- Regenerar `src/lib/supabase/database.types.ts`.

## Constraints / NAO fazer
- `kyc_score` numeric(4,3) — nao usar float (precisao consistente com Unico).
- `unico_transaction_id` UNIQUE para idempotencia do webhook (re-entregas).
- `provider_documents.kyc_status` espelha mas NAO substitui `provider_profiles.status`
  — provider_profiles.status e a fonte para routing (T-C decide essa transicao).
- `document_back_url` NULLABLE — selfie + frente sao obrigatorios; verso so
  para CNH.
- Tabela `app_settings` cobre apenas flags simples (boolean/string). Nao usar
  pra config complexa.

## Convencoes
- Enum em `public.*`.
- Migration com prefixo de data.$d$,
  'medium', 'medium',
$n$**Habilita:** webhook Unico (T-C), RPC de decisao (T-B), fila admin (T-013), tela admin de perfil prestador.
**Risco:** alto — schema KYC + URLs assinadas + flag global. Erro de RLS expoe documentos privados.
**Estrategia de validacao:** integration test (Carlos ve so propria row; admin ve todas; insert por outro user retorna 403; UNIQUE em unico_transaction_id rejeita duplicata).
**Ref:** Brainstorm card `iy2o0hb`. AC produto US-009 item 1.
**Tempo estimado:** 4h-5h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Enum `kyc_status` tem 4 valores: pending, approved, rejected, manual_review',
    'Tabela `provider_documents` tem colunas: id, user_id, document_type, document_front_url, document_back_url (nullable), selfie_url, kyc_score (numeric 4,3), kyc_status, rejection_reason, unico_transaction_id (unique), submitted_at, reviewed_at, reviewed_by',
    'Constraint `check (kyc_score between 0 and 1)` rejeita insert com score=2',
    'UNIQUE em unico_transaction_id rejeita re-insert do mesmo transaction_id',
    'RLS: insert por user_id != auth.uid() retorna 403; select de doc alheio retorna 0 rows',
    'Tabela `app_settings` criada com row `auto_approve_kyc: true` no seed',
    '`database.types.ts` regenerado; `pnpm typecheck` verde'
  ]
);
PERFORM pg_temp.add_dep(r_a, 'ZLAR-T-041', 'blocks');
PERFORM pg_temp.add_dep(r_a, 'ZLAR-T-049', 'blocks');
PERFORM runbook.attach_task_anchor(r_a, v_feature, v_session_id, ARRAY[1], 'from_brainstorm');


-- ─── TB — RPC decide_kyc_outcome ─────────────────────────────────────────────
r_b := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar RPC decide_kyc_outcome aplicando thresholds e incrementando kyc_attempts atomicamente',
$d$## Objetivo
RPC `decide_kyc_outcome(p_user_id, p_score, p_unico_transaction_id, p_rejection_reason)`
que aplica os thresholds do brainstorm e atualiza `provider_profiles.status` +
`kyc_attempts` em uma unica transacao. Chamada pelo webhook Unico (T-C) apos
gravar a row em `provider_documents`. Garante atomicidade entre
"documento gravado" -> "perfil atualizado" para o Realtime na tela waiting
disparar uma vez so por evento.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-009
itens 2 (auto-aprova >= 0.7), 3 (manual review 0.4-0.7), 4 (auto-rejeita < 0.4),
5 (apos 2 reprovacoes -> suspended).

Thresholds (do brainstorm):
- score >= 0.7 + flag `auto_approve_kyc=true` -> `approved`
- score >= 0.7 + flag `false` -> `manual_review` (Ana decide)
- 0.4 <= score < 0.7 -> `manual_review`
- score < 0.4 -> `rejected`, increment kyc_attempts; se attempts >= 2 -> `suspended`

Stack: Postgres function `security definer` + `set search_path = public`.

## Estado atual
Sem RPC. Webhook teria que fazer toda logica em JS — propenso a race condition.

## O que criar

### `supabase/migrations/<YYYYMMDD>_rpc_decide_kyc_outcome.sql`
```sql
create or replace function public.decide_kyc_outcome(
  p_user_id              uuid,
  p_score                numeric,
  p_unico_transaction_id text,
  p_rejection_reason     text default null
) returns table (
  new_status      public.provider_status,
  new_attempts    int,
  doc_kyc_status  public.kyc_status
) language plpgsql security definer set search_path = public as $f$
declare
  v_auto_approve  boolean;
  v_doc_status    public.kyc_status;
  v_new_status    public.provider_status;
  v_attempts      int;
begin
  select coalesce((value::text)::boolean, false) into v_auto_approve
  from public.app_settings where key = 'auto_approve_kyc';

  -- 1. Decide o status do documento
  if p_score is null then
    v_doc_status := 'pending';
  elsif p_score >= 0.7 and v_auto_approve then
    v_doc_status := 'approved';
  elsif p_score >= 0.4 then
    v_doc_status := 'manual_review';
  else
    v_doc_status := 'rejected';
  end if;

  -- 2. Atualiza provider_documents (idempotente por unico_transaction_id)
  update public.provider_documents
     set kyc_score        = p_score,
         kyc_status       = v_doc_status,
         rejection_reason = case when v_doc_status = 'rejected' then p_rejection_reason else null end,
         reviewed_at      = case when v_doc_status in ('approved','rejected') then now() else null end
   where unico_transaction_id = p_unico_transaction_id;

  -- 3. Decide transicao do provider_profiles
  if v_doc_status = 'approved' then
    update public.provider_profiles
       set status = 'approved',
           kyc_decided_at = now()
     where user_id = p_user_id
     returning status, kyc_attempts into v_new_status, v_attempts;
  elsif v_doc_status = 'rejected' then
    update public.provider_profiles
       set status = case when kyc_attempts + 1 >= 2 then 'suspended'::public.provider_status else 'rejected'::public.provider_status end,
           kyc_attempts = kyc_attempts + 1,
           kyc_rejection_reason = p_rejection_reason,
           kyc_decided_at = now()
     where user_id = p_user_id
     returning status, kyc_attempts into v_new_status, v_attempts;
  elsif v_doc_status = 'manual_review' then
    update public.provider_profiles
       set status = 'pending_review'  -- mantem em pending; Ana movimenta via outra RPC
     where user_id = p_user_id
     returning status, kyc_attempts into v_new_status, v_attempts;
  else
    select status, kyc_attempts into v_new_status, v_attempts
    from public.provider_profiles where user_id = p_user_id;
  end if;

  return query select v_new_status, v_attempts, v_doc_status;
end;
$f$;

-- So service_role chama (webhook). Anon e authenticated nao tocam.
revoke execute on function public.decide_kyc_outcome(uuid, numeric, text, text)
  from anon, authenticated;
```

## Constraints / NAO fazer
- `security definer` + `set search_path = public` — pattern obrigatorio
  (CVE-2018-1058 mitigation).
- Revoke explicito de `authenticated` — so webhook (service_role) chama.
- `manual_review` mantem `provider_profiles.status='pending_review'` — quem
  decide aprovado/reprovado nesse caso e a Ana via RPC de moderacao
  (US-052, ja existente).
- A RPC NAO insere row em `provider_documents` — assume que webhook ja inseriu
  pending antes de chamar. RPC so atualiza o existente por
  `unico_transaction_id`.
- Sem retry interno — se UPDATE falha, webhook reentrega e roda de novo
  (idempotencia via UNIQUE em transaction_id).

## Convencoes
- Funcao retorna table — webhook le `new_status` pra log/observability.$d$,
  'medium', 'small',
$n$**Habilita:** webhook Unico (T-C), tela waiting com Realtime (T-044), suspended automatico apos 2 falhas.
**Risco:** medio — logica de transicao critica, race possivel se dois webhooks reentregam simultaneo. UNIQUE em transaction_id mitiga.
**Estrategia de validacao:** Vitest com Supabase test client cobre 5 cenarios de score (0.9 com flag true, 0.9 com flag false, 0.5, 0.3 com attempts=0, 0.3 com attempts=1).
**Ref:** Brainstorm `iy2o0hb` thresholds. AC produto US-009 itens 2,3,4,5.
**Tempo estimado:** 4h-5h.$n$,
  ARRAY[
    'Migration aplica em dev sem erro',
    'Vitest cobre 5 cenarios de score: 0.9 + flag true -> approved/active; 0.9 + flag false -> manual_review/pending_review; 0.5 -> manual_review; 0.3 + attempts=0 -> rejected/attempts=1; 0.3 + attempts=1 -> suspended/attempts=2',
    'RPC retorna `(new_status, new_attempts, doc_kyc_status)` em todas as 5 transicoes',
    'Re-chamar a RPC com mesmo `unico_transaction_id` nao incrementa kyc_attempts duas vezes (idempotencia coberta)',
    'Funcao tem `security definer` + `set search_path = public`',
    'Authenticated NAO consegue executar a RPC (revoke aplicado) — testado via session no client supabase normal',
    '`pnpm typecheck` verde'
  ]
);
PERFORM pg_temp.add_dep(r_b, r_a, 'blocks');
PERFORM runbook.attach_task_anchor(r_b, v_feature, v_session_id, ARRAY[2,3,4,5], 'from_brainstorm');


-- ─── TC — Edge Function webhook Unico ────────────────────────────────────────
r_c := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Criar Edge Function de webhook Unico que popula provider_documents e dispara RPC de decisao',
$d$## Objetivo
Edge Function `unico-webhook` que recebe POST do servico Unico apos
processamento do KYC, valida assinatura HMAC, faz UPSERT da row em
`provider_documents` e chama `decide_kyc_outcome` (T-B) que decide o status
final. Realtime no canal `provider:{user_id}` propaga a mudanca pra tela
waiting (T-044).

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-009
itens 1, 2, 3, 4 (webhook popula + thresholds aplicados).

Stack: Supabase Edge Function (Deno) + service_role key + crypto.subtle pra
HMAC-SHA256 da assinatura.

## Estado atual
Sem webhook. Submissao do KYC nao tem callback de processamento.

## O que criar

### `supabase/functions/unico-webhook/index.ts`
```ts
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNICO_SECRET = Deno.env.get('UNICO_WEBHOOK_SECRET')!;

interface UnicoPayload {
  transaction_id: string;
  user_external_id: string; // nosso user_id
  score: number;
  status: 'completed' | 'failed';
  rejection_reason?: string;
  document_type: 'rg' | 'cnh';
  document_front_url: string;
  document_back_url?: string;
  selfie_url: string;
}

async function verifyHmac(body: string, signature: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(UNICO_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(body));
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();
  const signature = req.headers.get('x-unico-signature') ?? '';
  if (!await verifyHmac(body, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(body) as UnicoPayload;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. UPSERT documento (idempotente por transaction_id)
  const { error: upsertErr } = await supabase
    .from('provider_documents')
    .upsert({
      user_id: payload.user_external_id,
      document_type: payload.document_type,
      document_front_url: payload.document_front_url,
      document_back_url: payload.document_back_url ?? null,
      selfie_url: payload.selfie_url,
      unico_transaction_id: payload.transaction_id,
      kyc_status: 'pending',
    }, { onConflict: 'unico_transaction_id' });

  if (upsertErr) {
    console.error('upsert error', upsertErr);
    return new Response('DB error', { status: 500 });
  }

  // 2. Chama RPC de decisao
  const score = payload.status === 'failed' ? 0 : payload.score;
  const reason = payload.status === 'failed'
    ? (payload.rejection_reason ?? 'Documento ilegivel')
    : null;

  const { data, error: rpcErr } = await supabase.rpc('decide_kyc_outcome', {
    p_user_id: payload.user_external_id,
    p_score: score,
    p_unico_transaction_id: payload.transaction_id,
    p_rejection_reason: reason,
  });

  if (rpcErr) {
    console.error('rpc error', rpcErr);
    return new Response('Decision error', { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, outcome: data }), {
    headers: { 'content-type': 'application/json' },
  });
});
```

### Configuracao
- Env vars na Supabase Dashboard:
  - `UNICO_WEBHOOK_SECRET` (compartilhado com Unico)
  - Service role ja vem por default em Edge Functions.
- URL publica: `https://<proj>.supabase.co/functions/v1/unico-webhook` —
  registrar como callback no painel da Unico.

### Realtime
- Sem mudanca aqui — `provider_profiles` ja tem replication ativa por default
  no Supabase (RLS permite SELECT proprio user). T-044 (US-081) ja faz subscribe.

## Constraints / NAO fazer
- HMAC validation OBRIGATORIA — sem ela, qualquer um faz POST e aprova KYC.
- Logar `transaction_id` mas NUNCA `selfie_url` ou outros dados PII no log.
- Re-entrega do webhook DEVE ser idempotente — UPSERT por
  `unico_transaction_id` + RPC idempotente garantem.
- Nao usar `service_role` key fora de Edge Functions — exposicao no client
  e CRITICA. Service role so Deno.env aqui.
- Sem retry da Edge Function — Unico re-entrega em caso de 5xx.

## Convencoes
- Edge Function em `supabase/functions/<nome>/index.ts`.
- Deno + std lib + supabase-js (Deno-compatible build).
- Errors retornam status code consistente (401 invalid sig, 500 db, 405 method).$d$,
  'high', 'medium',
$n$**Habilita:** decisao de KYC totalmente automatica para 0.7+ e <0.4. Reduz fila admin pra so casos 0.4-0.7.
**Risco:** alto — Edge Function tocando service_role + assinatura HMAC. Bug aqui aprova KYC sem documento valido.
**Estrategia de validacao:** Deno test cobre HMAC verify (valid + invalid signature) + integration com mock Unico payload em todos os 4 cenarios de score; manual com sandbox Unico.
**Ref:** Brainstorm `iy2o0hb` (technical_notes: webhook popula provider_documents). AC produto US-009 itens 1,2,3,4.
**Tempo estimado:** 6h-8h.$n$,
  ARRAY[
    'Deno test `unico-webhook.test.ts` cobre: assinatura HMAC valida -> 200; assinatura invalida -> 401; payload sem signature header -> 401',
    'Integration test cobre 4 cenarios (score 0.9, 0.5, 0.3 com attempts=0, status=failed) e assert que provider_documents + provider_profiles ficam em estado consistente apos webhook',
    'Re-entrega do mesmo `transaction_id` NAO duplica row em provider_documents (UPSERT cobre)',
    'Re-entrega do mesmo `transaction_id` NAO incrementa `kyc_attempts` duas vezes (RPC cobre)',
    'Logs NAO contem `selfie_url`, `document_front_url`, `document_back_url` — assert via spy de console',
    'Edge Function deploya sem erro (`supabase functions deploy unico-webhook`)',
    '`UNICO_WEBHOOK_SECRET` env var documentado em README do projeto'
  ]
);
PERFORM pg_temp.add_dep(r_c, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_c, r_b, 'blocks');
PERFORM runbook.attach_task_anchor(r_c, v_feature, v_session_id, ARRAY[1,2,3,4], 'from_brainstorm');


-- ─── TD — UI step de KYC com Web SDK Unico ───────────────────────────────────
r_d := pg_temp.upsert_task(
  v_session_id, v_project_id, v_story,
  'Renderizar step de KYC com Web SDK Unico embarcado capturando documento e selfie',
$d$## Objetivo
Step final do onboarding (`/onboarding/provider/kyc`) que embarca o Web JS SDK
da Unico, abre camera para captura de documento (frente/verso) e selfie, faz
upload pro bucket `kyc-documents` no Supabase Storage e dispara a transacao
no servico Unico. Apos submit OK, redireciona pra tela `/onboarding/provider/waiting`
(T-044) e limpa o draft de localStorage da T-052.

## Contexto
Modulo ONBOARDING_DO_PRESTADOR. Persona Carlos. Cobre AC produto US-009 item 0
(SDK abre camera + captura documento + selfie). Demais AC sao server-side
(webhook + RPC).

Stack: Next.js 15 client component + `@unico/sdk-web` (Web SDK Unico) +
Supabase Storage + Field compound API.

## Estado atual
Pasta `/onboarding/provider/kyc/` ja existe na T-045 (US-081) — mas e a tela
de **reenvio**. Esta task cria o step de **submissao inicial** que aparece
como ultimo step do flow da T-051.

Convencao de rotas:
- `/onboarding/provider/kyc` (RSC: decide flow inicial vs reenvio por
  `kyc_attempts`) — ja existe, vamos estender.
- `/onboarding/provider/kyc/upload` (NOVO) — captura via SDK Unico.
- `/onboarding/provider/waiting` (T-044) — pos-submit.

## O que criar

### `apps/web/src/app/(public)/onboarding/provider/kyc/upload/page.tsx` (RSC)
- Le sessao + `provider_profiles`. Guard:
  - Se `status='approved'` -> `redirect('/provider/home')`.
  - Se `kyc_attempts >= 2` ou `status='suspended'` -> `redirect('/onboarding/provider/blocked')`.
- Renderiza `<KycUploadFlow userId={user.id} />`.

### `apps/web/src/components/onboarding/kyc-upload-flow.tsx` (client)
```tsx
'use client';
import { useState } from 'react';
import { UnicoCheck } from '@unico/sdk-web';
import { createBrowserClient } from '@/lib/supabase/browser';
import { clearDraft } from '@/lib/onboarding/provider-storage';
import { useRouter } from 'next/navigation';

export function KycUploadFlow({ userId }: { userId: string }) {
  const [stage, setStage] = useState<'doc-front'|'doc-back'|'selfie'|'submitting'>('doc-front');
  const [files, setFiles] = useState<{ front?: Blob; back?: Blob; selfie?: Blob }>({});
  const supabase = createBrowserClient();
  const router = useRouter();

  async function captureWithUnico(stage: 'doc-front' | 'doc-back' | 'selfie') {
    const result = await UnicoCheck.capture({ /* config Unico */ });
    setFiles((prev) => ({ ...prev, [stage === 'selfie' ? 'selfie' : stage === 'doc-front' ? 'front' : 'back']: result.blob }));
  }

  async function submit() {
    setStage('submitting');
    // 1. Upload pro bucket
    const paths = await Promise.all([
      supabase.storage.from('kyc-documents').upload(`${userId}/front.jpg`, files.front!),
      files.back ? supabase.storage.from('kyc-documents').upload(`${userId}/back.jpg`, files.back) : null,
      supabase.storage.from('kyc-documents').upload(`${userId}/selfie.jpg`, files.selfie!),
    ]);
    // 2. Dispara transacao Unico (server action que retorna transaction_id)
    const { transaction_id } = await fetch('/api/kyc/start', {
      method: 'POST',
      body: JSON.stringify({ paths: paths.map((p) => p?.data?.path) }),
    }).then((r) => r.json());
    // 3. Limpa draft localStorage
    clearDraft();
    // 4. Redireciona pra waiting (T-044 faz Realtime)
    router.push('/onboarding/provider/waiting');
  }

  // render por stage
  // ...
}
```

### `apps/web/src/app/api/kyc/start/route.ts` (server action / API route)
- Recebe paths dos uploads, chama API da Unico (`POST /v1/checks` com webhook
  configurado), recebe `transaction_id`.
- Insere row inicial em `provider_documents` com `kyc_status='pending'` e
  `unico_transaction_id` (UPSERT por transaction_id).
- Retorna `transaction_id` pro client.

### Cleanup do localStorage da T-052
- `clearDraft()` chamado APENAS apos submit OK (apos receber transaction_id).
- Falha no submit nao limpa — Carlos pode tentar de novo com dados.

## Constraints / NAO fazer
- Web SDK da Unico exige HTTPS — testar so em `vercel preview` ou `localhost`
  com cert valido.
- NUNCA commitar credenciais Unico — config via env (`NEXT_PUBLIC_UNICO_API_KEY`
  para SDK + `UNICO_API_SECRET` server-side).
- Bucket `kyc-documents` PRIVADO. URLs sao paths de storage, nao publicas.
- Apos submit OK, redirecionar pra waiting — NAO deixar Carlos refazer
  upload na mesma tela (transaction Unico ja em andamento).
- Mobile: SDK Unico abre camera nativa via `getUserMedia`. Testar em iOS Safari
  + Android Chrome (browsers reais, nao emulator).

## Convencoes
- Field compound API + `<FormBody>` na orquestracao do flow.
- Toast `sonner` em erro de upload/SDK.
- Indicador de progresso `<Progress>` shadcn entre as 3 capturas.$d$,
  'high', 'medium',
$n$**Habilita:** Carlos completa o onboarding e cai na tela waiting (T-044) com Realtime ja escutando o webhook (T-C).
**Risco:** alto — integracao 3rd party (Unico SDK) + camera + upload + chamada API. Bug aqui = 0 prestadores aprovados.
**Estrategia de validacao:** Playwright e2e simula upload com fixtures (sem SDK real); manual com sandbox Unico em dispositivo real (iOS + Android); test do route /api/kyc/start.
**Ref:** Brainstorm `iy2o0hb` (Web JS SDK + bucket privado). AC produto US-009 item 0.
**Tempo estimado:** 8h-10h.$n$,
  ARRAY[
    'Vitest `kyc-upload-flow.test.tsx` cobre transicoes entre os 3 stages (doc-front -> doc-back -> selfie -> submit) com mock do SDK',
    'Playwright e2e: usa fixtures de imagem pro mock do SDK; simula 3 capturas; verifica POST em /api/kyc/start; verifica redirect para /onboarding/provider/waiting',
    'Vitest `route /api/kyc/start` cobre criacao de row em provider_documents com kyc_status=pending e unico_transaction_id setado',
    '`clearDraft()` da T-052 chamado APENAS apos transaction_id recebido (assert via spy)',
    'Submit com erro 5xx do Unico mantem tela em stage submitting com toast de erro + opcao de retry; localStorage NAO e limpo',
    'Guard server-side: kyc_attempts >= 2 redireciona pra /onboarding/provider/blocked (testado via Playwright com fixture)',
    'Bucket `kyc-documents` configurado privado; teste tenta acessar URL publica e recebe 401',
    '`pnpm typecheck` + `pnpm lint` verdes'
  ]
);
PERFORM pg_temp.add_dep(r_d, r_a, 'blocks');
PERFORM pg_temp.add_dep(r_d, 'ZLAR-T-051', 'blocks');
PERFORM pg_temp.add_dep(r_d, 'ZLAR-T-052', 'blocks');
PERFORM runbook.attach_task_anchor(r_d, v_feature, v_session_id, ARRAY[0], 'from_brainstorm');


RAISE NOTICE 'US-009 tasks: % % % %', r_a, r_b, r_c, r_d;

END $seed$;

COMMIT;
