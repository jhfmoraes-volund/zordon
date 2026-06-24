-- Zelar v2 — Backlog SQL: ZLAR-V2-US-004 (PRESTADOR aceita propostas)
-- Modulo: EXECUCAO | Persona: PRESTADOR | AC: 10
-- Apenas insere metadata em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). NAO executa DDL de produto.

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-265 (DATA: RPC decline_proposal) — vem antes do API que a usa
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-265', 'Criar RPC decline_proposal(round_id, provider_id) (idempotente, sem fechar round)',
 $desc$## Objetivo
RPC `SECURITY DEFINER` que registra a recusa de um prestador a uma proposta de matching, sem aplicar penalidade e sem encerrar o round (a proposta continua ativa pros demais candidatos elegíveis até aceite ou expiração). Cobre AC #3.

## Contexto
Modulo EXECUCAO consumindo tabelas do MATCHING (T-238 matching_rounds, matching_round_candidates) e o audit log (T-239 matching_round_events). Chamada pela API T-264 (`POST /api/matching/proposals/[round_id]/decline`). Não confundir com `accept_proposal` (T-244): aqui não há corrida — recusa é decisão local do prestador.

Funcionalmente: marca a linha do `matching_round_candidates` correspondente a `(round_id, provider_id)` como `declined` (com `decided_at = NOW()`); idempotente — se já está `declined`/`accepted`/`expired`/`closed`, não muda nada e retorna o estado atual; emite `candidate_declined` em `matching_round_events` (audit) na primeira vez.

## Estado atual / O que substitui
Não existe. Hoje o prestador não tem como recusar — só não aceitar.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_decline_proposal_rpc.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION decline_proposal(
  p_round_id uuid,
  p_provider_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidate matching_round_candidates%ROWTYPE;
  v_round matching_rounds%ROWTYPE;
BEGIN
  -- Lê round + candidate atomicamente
  SELECT * INTO v_round FROM matching_rounds WHERE id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_candidate
  FROM matching_round_candidates
  WHERE round_id = p_round_id AND provider_id = p_provider_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_not_in_round' USING ERRCODE = 'P0002'; END IF;

  -- Idempotência: se ja terminal, retorna estado sem mudar
  IF v_candidate.decision IN ('declined','accepted','expired','closed') THEN
    RETURN jsonb_build_object(
      'round_id', p_round_id,
      'decision', v_candidate.decision,
      'decided_at', v_candidate.decided_at,
      'idempotent', true
    );
  END IF;

  -- 1ª recusa: marca candidate, registra audit
  UPDATE matching_round_candidates
  SET decision = 'declined', decided_at = NOW()
  WHERE id = v_candidate.id;

  INSERT INTO matching_round_events (round_id, candidate_id, kind, payload)
  VALUES (
    p_round_id, v_candidate.id, 'candidate_declined',
    jsonb_build_object('provider_id', p_provider_id)
  );

  RETURN jsonb_build_object(
    'round_id', p_round_id,
    'decision', 'declined',
    'decided_at', NOW(),
    'idempotent', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION decline_proposal FROM public, anon;
GRANT EXECUTE ON FUNCTION decline_proposal TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Encerrar o round (mudar `matching_rounds.status`) — recusa não fecha pool, só remove o candidato
- ❌ Aplicar penalidade no score do prestador (AC #3 explicitamente sem penalidade)
- ❌ Permitir recusa após `accepted`/`expired` — retorna estado atual (idempotência)
- ❌ Notificar cliente — recusa é decisão privada do prestador (apenas audit log)

## Convenções
- RPC SECURITY DEFINER + REVOKE/GRANT explícitos (mesmo padrão T-244 accept_proposal)
- Audit em `matching_round_events` com `kind='candidate_declined'` (enum já em T-239)
- Idempotência via verificação de `decision` antes de UPDATE
- Erros via RAISE EXCEPTION com code (P0002 = no_data_found) — API mapeia para 404$desc$,
 'DATA', 'PRESTADOR', ARRAY['RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-263 (API: HTTP wrapper accept_proposal)
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-263', 'Implementar POST /api/matching/proposals/[round_id]/accept (HTTP wrapper)',
 $desc$## Objetivo
Endpoint HTTP que o PWA do prestador chama ao tocar "Aceitar". Wrapper fino sobre a RPC `accept_proposal` (T-244) — repassa idempotency-key, mapeia erros do Postgres pra HTTP (409, 400, 403, 404, 500) e retorna o resultado em JSON. Cobre AC #2, #7, #8, #10.

## Contexto
Módulo EXECUCAO. A lógica de corrida (lock atômico, idempotência, transição da SR, cancelamento dos demais candidatos do round, emit `candidate_accepted`) vive 100% na RPC T-244. Este endpoint apenas faz:
1. Lê JWT, extrai `provider_id` do `auth.uid()`
2. Lê `idempotency-key` do header (obrigatório — pra retry seguro do AC #7)
3. Chama `accept_proposal(round_id, provider_id, idempotency_key)`
4. Mapeia erros e retorna 201/409/etc.

## Estado atual / O que substitui
Não existe. Hoje a RPC só seria invocável via supabase-js client direto, sem encapsulamento de idempotency e mapping de erros.

## O que criar

### `src/app/api/matching/proposals/[round_id]/accept/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const ParamsSchema = z.object({ round_id: z.string().uuid() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ round_id: string }> }
) {
  const { round_id } = ParamsSchema.parse(await params);
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.rpc('accept_proposal', {
    p_round_id: round_id,
    p_provider_id: user.id,
    p_idempotency_key: idemKey,
  });

  if (error) {
    // Postgres errcodes mapeados pra HTTP
    // 23505 unique_violation -> race perdida -> 409
    // P0002 no_data -> round/candidate ausente -> 404
    // RAISE EXCEPTION 'race_lost' -> 409
    // RAISE EXCEPTION 'round_expired' -> 410
    // RAISE EXCEPTION 'provider_not_in_round' -> 403
    if (error.code === '23505' || error.message.includes('race_lost')) {
      return Response.json({ error: 'already_accepted' }, { status: 409 });
    }
    if (error.message.includes('round_expired')) {
      return Response.json({ error: 'expired' }, { status: 410 });
    }
    if (error.message.includes('provider_not_in_round')) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    if (error.code === 'P0002') {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[accept_proposal]', error);
    return Response.json({ error: 'internal' }, { status: 500 });
  }

  return Response.json(data, { status: 201 });
}
```

## Constraints / NÃO fazer
- ❌ Reimplementar lógica de race aqui — quem garante atomicidade é a RPC T-244
- ❌ Aceitar sem `idempotency-key` (400 sem header) — AC #7 exige retry seguro
- ❌ Confiar no `provider_id` vindo do body (sempre extrair do JWT)
- ❌ Logar a `idempotency-key` em texto cleartext nos logs (PII fraca, mas OK truncado)

## Convenções
- Idempotency-key obrigatória (header) — passada à RPC, que persiste em `matching_round_events.payload`
- Erros padronizados (mesma forma de T-079, T-260):
  - 400 = validação ou idempotency-key ausente
  - 401 = sem JWT
  - 403 = JWT válido mas provider_id não está no round (RLS via RPC)
  - 404 = round_id inválido
  - 409 = corrida perdida (outro prestador aceitou primeiro)
  - 410 = round já expirou
- Logs estruturados (round_id, provider_id, decision)
- Sem rate limit dedicado (matching já protegido pelo round window)$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RACE_CONDITION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-264 (API: HTTP wrapper decline_proposal)
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-264', 'Implementar POST /api/matching/proposals/[round_id]/decline',
 $desc$## Objetivo
Endpoint HTTP chamado quando o prestador toca "Recusar" no card. Repassa pra RPC `decline_proposal` (T-265) e retorna o resultado. Card sumindo da tela é responsabilidade da UI (T-268) reagindo ao retorno + ao evento Realtime `candidate_declined`. Cobre AC #3.

## Contexto
Módulo EXECUCAO. Sem efeitos colaterais financeiros — só audit + remoção do candidato do pool *para esse prestador*; round continua para os demais. Sem necessidade de idempotency-key (operação naturalmente idempotente — RPC T-265 trata).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/matching/proposals/[round_id]/decline/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const ParamsSchema = z.object({ round_id: z.string().uuid() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ round_id: string }> }
) {
  const { round_id } = ParamsSchema.parse(await params);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.rpc('decline_proposal', {
    p_round_id: round_id,
    p_provider_id: user.id,
  });

  if (error) {
    if (error.code === 'P0002' || error.message.includes('candidate_not_in_round')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    console.error('[decline_proposal]', error);
    return Response.json({ error: 'internal' }, { status: 500 });
  }

  return Response.json(data, { status: 200 });
}
```

## Constraints / NÃO fazer
- ❌ Aplicar penalidade no score (AC #3 sem penalidade)
- ❌ Encerrar round (recusa é só pra esse prestador)
- ❌ Notificar cliente (recusa é privada)

## Convenções
- Operação naturalmente idempotente — sem header obrigatório
- Mesma autenticação JWT do T-263
- Mapping de erros: 401, 404, 500$desc$,
 'API', 'PRESTADOR', ARRAY['INPUT_VALIDATION','RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-266 (API: GET propostas ativas — retomada após reconnect)
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-266', 'Implementar GET /api/matching/proposals/active (retomada pós reconnect)',
 $desc$## Objetivo
Endpoint que retorna a lista de propostas ainda válidas (broadcast ativo, prestador ainda candidato, dentro do prazo) para o `auth.uid()` requisitante. Garante AC #5 (perda de conexão → reconectar e ver o que ainda está aberto) e AC #7 (loading que sobrevive a refresh sem aceite duplicado, porque ainda mostra a proposta certa).

## Contexto
Módulo EXECUCAO. Chamado pela UI no boot do PWA do prestador (T-267 hook), antes de subscrever ao canal Realtime (T-247) — bootstrap inicial da lista. Daí em diante o canal alimenta INSERT/UPDATE em tempo real. Sem isso, prestador que abriu o app depois do `candidate_offered` não veria nada até a próxima oferta.

Lê via JOIN `matching_round_candidates` × `matching_rounds` × `service_requests` (resumo público que não vaza dados sensíveis pré-aceite). Filtra:
- `mc.provider_id = auth.uid()`
- `mc.decision = 'offered'`
- `mr.status = 'broadcasting'`
- `mr.expires_at > NOW()`

Retorna apenas o que o card precisa: `round_id`, `service_request_id`, categoria/subcategoria, endereço aproximado (CEP truncado), valor estimado, `expires_at`.

## Estado atual / O que substitui
Não existe. Sem isso, AC #5 falha em qualquer reconnect.

## O que criar

### `src/app/api/matching/proposals/active/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // RLS de matching_round_candidates já filtra por provider_id (T-238).
  // Aqui usamos VIEW dedicada que JOINa o que UI precisa (sem expor dados sensiveis).
  const { data, error } = await supabase
    .from('provider_active_proposals_v')
    .select('round_id, service_request_id, category, subcategory, area_label, estimated_value_cents, expires_at')
    .order('expires_at', { ascending: true });

  if (error) {
    console.error('[active_proposals]', error);
    return Response.json({ error: 'internal' }, { status: 500 });
  }

  return Response.json({ proposals: data ?? [] });
}
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_provider_active_proposals_view.sql`
```sql
-- VIEW com security_invoker = true (respeita RLS do caller)
CREATE OR REPLACE VIEW provider_active_proposals_v
WITH (security_invoker = true) AS
SELECT
  mr.id            AS round_id,
  sr.id            AS service_request_id,
  sr.category      AS category,
  sr.subcategory   AS subcategory,
  -- endereço aproximado: bairro + CEP truncado (sem rua/numero pre-aceite)
  CONCAT(addr.neighborhood, ' · ', LEFT(addr.zipcode, 5)) AS area_label,
  sr.estimated_value_cents,
  mr.expires_at
FROM matching_round_candidates mc
JOIN matching_rounds mr        ON mr.id = mc.round_id
JOIN service_requests sr       ON sr.id = mr.service_request_id
LEFT JOIN addresses addr       ON addr.id = sr.address_id
WHERE mc.decision = 'offered'
  AND mr.status = 'broadcasting'
  AND mr.expires_at > NOW()
  AND mc.provider_id = auth.uid();

GRANT SELECT ON provider_active_proposals_v TO authenticated;
```

## Constraints / NÃO fazer
- ❌ Expor endereço completo, telefone, CPF do cliente — pré-aceite, AC #1 explicitamente diz "endereço aproximado"
- ❌ Retornar propostas já decidied (decline/accept/expire) — só `offered`
- ❌ Cache no client com TTL longo — propostas mudam em segundos

## Convenções
- VIEW `security_invoker=true` (respeita RLS do caller, não da função)
- Sort por `expires_at ASC` — UI pode renderizar com countdown decrescente
- Sem paginação (top_N do round é configurado em app_config matching.top_n, default 5)$desc$,
 'API', 'PRESTADOR', ARRAY['RLS_REQUIRED','INPUT_VALIDATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-267 (UI: hook use-provider-matching)
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-267', 'Implementar hook use-provider-matching (Realtime + bootstrap + state)',
 $desc$## Objetivo
Hook React que mantém a lista de propostas ativas do prestador em tempo real. Combina: (a) bootstrap via GET `/api/matching/proposals/active` (T-266) no mount, (b) subscrição ao canal Realtime `matching:provider:{provider_id}` (T-247), (c) reconciliação dos eventos `candidate_offered`/`candidate_closed`/`candidate_expired`/`candidate_accepted` na lista local. Cobre AC #1 (tempo real), #5 (retomada), #10 (remoção via update push), #11 (fechamento simultâneo).

## Contexto
Módulo EXECUCAO. Consome canal entregue por T-247 (que já cuida de subscribe/unsubscribe + RLS via VIEW `provider_matching_events`). Foundational hook — todas as telas do PWA prestador que mostram propostas dependem dele (T-268, T-269).

Estado interno: `proposals: Proposal[]` indexed por `round_id` (chave). Mutações:
- `candidate_offered` → adiciona à lista (ou substitui se já existe)
- `candidate_closed`/`candidate_expired`/`candidate_accepted` → remove `round_id` da lista
- decline local (callback acceptDecline) → otimisticamente remove + chama API + reverte se erro

Reconnect: Supabase client refaz subscribe automaticamente, **mas** estado local pode ter ficado stale durante o gap. Solução: no callback `SUBSCRIBED` do canal, refaz GET `/api/matching/proposals/active` e reconcilia (`useOptimisticCollection` external_update).

## Estado atual / O que substitui
Não existe. T-247 entrega o canal mas não faz state-keeping da lista no client.

## O que criar

### `src/hooks/use-provider-matching.ts`
```typescript
'use client';
import { useCallback, useEffect } from 'react';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';
import { createBrowserClient } from '@/lib/supabase/client';

export type ProposalCard = {
  round_id: string;
  service_request_id: string;
  category: string;
  subcategory: string;
  area_label: string;
  estimated_value_cents: number;
  expires_at: string;
};

export function useProviderMatching(providerId: string, initial: ProposalCard[]) {
  const { items, mutate } = useOptimisticCollection<ProposalCard>(initial, {
    keyOf: (p) => p.round_id,
  });

  // Bootstrap fresh state após connect/reconnect
  const refetch = useCallback(async () => {
    try {
      const data = await fetchOrThrow<{ proposals: ProposalCard[] }>('/api/matching/proposals/active');
      await mutate(
        { type: 'external_update', items: data.proposals },
        async () => {} // sem persist — só sincroniza local
      );
    } catch (err) { /* swallow — Realtime cobre o resto */ }
  }, [mutate]);

  // Subscribe canal matching:provider:{id}
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`matching:provider:${providerId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'matching_round_events',
        filter: `provider_id=eq.${providerId}`,
      }, (payload) => {
        const ev = payload.new as { kind: string; round_id: string; payload: any };
        if (ev.kind === 'candidate_offered') {
          mutate({ type: 'create', item: ev.payload.proposal as ProposalCard }, async () => {});
        } else if (['candidate_closed','candidate_expired','candidate_accepted'].includes(ev.kind)) {
          mutate({ type: 'delete', id: ev.round_id }, async () => {});
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch();
      });

    return () => { supabase.removeChannel(channel); };
  }, [providerId, mutate, refetch]);

  // Decline com optimistic remove
  const decline = useCallback(async (round_id: string) => {
    await mutate(
      { type: 'delete', id: round_id },
      async (signal) => {
        await fetchOrThrow(`/api/matching/proposals/${round_id}/decline`, {
          method: 'POST', signal,
        });
      },
      { errorLabel: 'Falha ao recusar proposta' }
    );
  }, [mutate]);

  return { proposals: items, decline, refetch };
}
```

## Constraints / NÃO fazer
- ❌ `setState` direto após fetch (regra do projeto: sempre `useOptimisticCollection`)
- ❌ Subscrever sem unsubscribe no unmount (memory leak / canal duplicado)
- ❌ Confiar 100% em Realtime sem refetch no SUBSCRIBED (AC #5 rede móvel)
- ❌ Aceitar `provider_id` vindo de prop sem validação (deve ser `auth.uid()` da sessão server, passado pelo Server Component que renderiza `/(provider)/home`)

## Convenções
- Reuso: `useOptimisticCollection` (`src/hooks/use-optimistic-collection.ts`), `fetchOrThrow` (`src/lib/optimistic/fetch.ts`), `showErrorToast` (`src/lib/optimistic/toast.ts`)
- Nome do canal segue convenção `<entidade>:<id>` já estabelecida em T-247
- Bootstrap acontece no callback `SUBSCRIBED` (não no mount sem aguardar) — evita race com Realtime$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_HOOK','REALTIME_CHANNEL','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-268 (UI: ProposalCard com countdown + ações)
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-268', 'Renderizar ProposalCard com countdown, accept/decline e estados',
 $desc$## Objetivo
Componente que mostra uma proposta na tela do prestador: categoria, endereço aproximado, valor estimado, countdown decrescente até `expires_at`, botão "Aceitar" (com loading) e botão "Recusar" (sem confirmação destrutiva — recusa é leve). Trata estados: idle / accepting / accepted-redirect / race-lost (Sonner). Cobre AC #1, #3, #7, #8.

## Contexto
Módulo EXECUCAO. Consumido pela tela `/(provider)/home` (T-269) que itera `proposals` do hook (T-267). Card "sumir" da tela é feito pelo hook (delete via mutation), não pelo card — card só dispara a ação.

Comportamento de countdown: derivado de `expires_at - now()`. Atualiza via `setInterval(1000)`. Quando atinge 0, card chama `onExpire(round_id)` (delete local opcional — Realtime já vai remover). Visual: cor amarela < 60s, vermelha < 15s.

Race-lost handling (AC #8): se `POST accept` retorna 409, mostra `Sonner.error("Esta proposta já foi aceita por outro prestador")` e card é removido pelo Realtime que vai chegar em paralelo. Sem ConfirmDialog — feedback é via toast, card já some.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/provider-matching/ProposalCard.tsx`
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sonner, showErrorToast } from '@/lib/optimistic/toast';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { useRouter } from 'next/navigation';
import type { ProposalCard as ProposalT } from '@/hooks/use-provider-matching';

export function ProposalCard({
  proposal,
  onDecline,
}: {
  proposal: ProposalT;
  onDecline: (round_id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(() => secondsUntil(proposal.expires_at));
  const router = useRouter();

  useEffect(() => {
    const t = setInterval(() => setRemaining(secondsUntil(proposal.expires_at)), 1000);
    return () => clearInterval(t);
  }, [proposal.expires_at]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetchOrThrow<{ service_request_id: string }>(
        `/api/matching/proposals/${proposal.round_id}/accept`,
        { method: 'POST', headers: { 'idempotency-key': `accept-${proposal.round_id}` } }
      );
      router.push(`/(provider)/services/${res.service_request_id}/accepted`);
    } catch (err: any) {
      if (err.status === 409) {
        Sonner.toast.error('Este serviço já foi aceito');
        // card será removido via Realtime; nada mais a fazer
      } else if (err.status === 410) {
        Sonner.toast.error('Esta proposta expirou');
      } else {
        showErrorToast({ type: 'accept_proposal' }, err);
      }
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <Badge>{proposal.category}</Badge>
          <h3 className="mt-2 text-lg font-semibold">{proposal.subcategory}</h3>
          <p className="text-sm text-muted-foreground">{proposal.area_label}</p>
          <p className="mt-2 text-base font-medium">
            R$ {(proposal.estimated_value_cents / 100).toFixed(2)}
          </p>
        </div>
        <Countdown seconds={remaining} />
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="ghost" onClick={() => onDecline(proposal.round_id)} disabled={busy}>
          Recusar
        </Button>
        <Button className="flex-1" onClick={accept} disabled={busy} aria-busy={busy}>
          {busy ? 'Aceitando…' : 'Aceitar'}
        </Button>
      </div>
    </Card>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const tone = seconds < 15 ? 'text-red-600' : seconds < 60 ? 'text-amber-600' : 'text-foreground';
  const m = Math.max(0, Math.floor(seconds / 60));
  const s = Math.max(0, seconds % 60).toString().padStart(2, '0');
  return <span className={`font-mono text-base ${tone}`}>{m}:{s}</span>;
}

function secondsUntil(iso: string) {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}
```

## Constraints / NÃO fazer
- ❌ Mostrar endereço completo / nome do cliente / telefone (AC #1: "aproximado" — só categoria, área, valor, prazo)
- ❌ ConfirmDialog na recusa (AC #3 dispatch leve, sumir imediatamente)
- ❌ ConfirmDialog no aceite (AC #2 quem aceita primeiro leva — UX favorece velocidade)
- ❌ Disable do botão sem `aria-busy` (a11y)
- ❌ Reconectar canal aqui (responsabilidade de T-267)

## Convenções
- Reuso: `Card`, `Button`, `Badge` (`src/components/ui/`), `Sonner` (`@/lib/optimistic/toast`), `fetchOrThrow`
- Idempotency-key calculada local: `accept-${round_id}` (estável, único por round — retry seguro AC #7)
- Sem `'use client'` exception — depende de useState/effects$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-269 (UI: tela /(provider)/home com lista de propostas + estado vazio + indisponível)
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-269', 'Renderizar /(provider)/home com lista de propostas, estado vazio e indisponível',
 $desc$## Objetivo
Tela inicial do PWA do prestador: lista propostas ativas (renderiza `ProposalCard` por item via hook do T-267), estado vazio "Aguardando proposta…" com Skeleton, banner "Você está indisponível" (lido de `provider_profiles.is_available`) e CTA pra reativar via toggle (T-121 já existente). Cobre AC #1 (tempo real), #4 (estado pós expiração — vazio), #6 (não recebe quando indisponível).

## Contexto
Módulo EXECUCAO. É a home do PWA prestador depois da onboarding (T-010/T-021). Tela mobile-first. Se `is_available = false`, lista some e banner aparece — porque com `is_available = false` o filtro `compute_eligible_providers` (T-240) já exclui o prestador, então a lista naturalmente fica vazia, mas precisamos sinalizar isso explicitamente pra usuário (sem isso ele pensa que falta de propostas é por baixa demanda).

Server Component carrega initial state via T-266 e o flag `is_available` da T-002 (provider_profiles). Client component mantém a lista viva via hook T-267.

## Estado atual / O que substitui
Não existe `/(provider)/home`. O scaffolding base de rotas `(provider)` foi criado em T-010 (onboarding wizard) — esta task adiciona a home pós-onboarding.

## O que criar

### `src/app/(provider)/home/page.tsx`
```tsx
// Server Component — pega initial e flag de disponibilidade
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ProviderHomeClient } from './ProviderHomeClient';

export default async function ProviderHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Flag disponibilidade (T-002 provider_profiles)
  const { data: profile } = await supabase
    .from('provider_profiles')
    .select('is_available, kyc_status')
    .eq('id', user.id)
    .single();

  // Initial proposals (RLS já filtra)
  const { data: proposals } = await supabase
    .from('provider_active_proposals_v')
    .select('*')
    .order('expires_at', { ascending: true });

  return (
    <ProviderHomeClient
      providerId={user.id}
      initialProposals={proposals ?? []}
      isAvailable={profile?.is_available ?? false}
      kycStatus={profile?.kyc_status ?? 'pending'}
    />
  );
}
```

### `src/app/(provider)/home/ProviderHomeClient.tsx`
```tsx
'use client';
import { useProviderMatching, type ProposalCard as ProposalT } from '@/hooks/use-provider-matching';
import { ProposalCard } from '@/components/provider-matching/ProposalCard';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AvailabilityToggle } from '@/components/provider-profile/AvailabilityToggle'; // T-121

export function ProviderHomeClient({
  providerId, initialProposals, isAvailable, kycStatus,
}: {
  providerId: string;
  initialProposals: ProposalT[];
  isAvailable: boolean;
  kycStatus: string;
}) {
  const { proposals, decline } = useProviderMatching(providerId, initialProposals);

  if (kycStatus !== 'approved') {
    return <KycPendingState status={kycStatus} />; // reuso T-021
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Propostas</h1>
        <AvailabilityToggle initial={isAvailable} />
      </header>

      {!isAvailable && (
        <Card className="mt-4 border-amber-200 bg-amber-50 p-3 text-sm">
          Você está indisponível. Ative para receber propostas.
        </Card>
      )}

      {isAvailable && proposals.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <Skeleton className="h-12 w-12 rounded-full" />
          <p className="text-sm text-muted-foreground">Aguardando proposta…</p>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {proposals.map((p) => (
          <li key={p.round_id}>
            <ProposalCard proposal={p} onDecline={decline} />
          </li>
        ))}
      </ul>
    </main>
  );
}
```

## Constraints / NÃO fazer
- ❌ Recriar AvailabilityToggle (já em T-121)
- ❌ Mostrar lista quando `is_available = false` (banner basta — backend já não envia, mas UI deve confirmar visualmente)
- ❌ Implementar gate de KYC aqui (já em T-019 proxy guard) — esta verificação local é UX adicional pra evitar piscar

## Convenções
- Reuso: `Card`, `Skeleton`, `AvailabilityToggle` (T-121), `KycPendingState` (T-021), `useProviderMatching` (T-267)
- Mobile-first (default no projeto)
- Server Component pra initial state, Client Component pra reatividade$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-270 (UI: tela detalhe pós-aceite + Estou a caminho)
('d448df34-6279-47ad-8b88-06d882d8d737', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '180ba23a-393d-4054-a01e-bbe560e166e6',
 'ZLAR-V2-T-270', 'Renderizar /(provider)/services/[id]/accepted (detalhe + Estou a caminho)',
 $desc$## Objetivo
Tela que aparece imediatamente após o `accept` bem-sucedido (T-263). Mostra detalhes completos do serviço aceito (descrição completa, fotos, endereço completo, contato do cliente desofuscado) e botão "Estou a caminho" que dispara a transição de estado pra `provider_en_route` (esta transição é responsabilidade de US-005, mas a tela vive aqui — é a primeira tela pós-aceite). Cobre AC #9.

## Contexto
Módulo EXECUCAO. Após `POST /accept` 201 (T-263), `ProposalCard` (T-268) faz `router.push('/(provider)/services/[id]/accepted')`. A tela é Server-rendered porque dados não mudam até o prestador agir. Botão "Estou a caminho" delega pra endpoint que será criado em US-005 — aqui o botão fica como CTA com handler placeholder (ou já chama T-235 transition_service_status se útil).

Lê de `service_requests` (T-070) — RLS canônica de provider (T-229) já permite leitura de SR onde `provider_id = auth.uid()`. Antes do aceite, RLS bloqueia detalhes; depois do aceite, libera.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(provider)/services/[id]/accepted/page.tsx`
```tsx
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OnTheWayButton } from './OnTheWayButton';

export default async function AcceptedServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: sr } = await supabase
    .from('service_requests')
    .select('id, status, description, photos, scheduled_at, contact_phone, address:addresses(*), client:client_profiles(name)')
    .eq('id', id)
    .eq('provider_id', user.id)
    .single();

  if (!sr) notFound();

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="space-y-1">
        <Badge>{sr.status}</Badge>
        <h1 className="text-xl font-semibold">Serviço aceito</h1>
      </header>

      <Card className="mt-4 p-4 space-y-3">
        <Section label="Cliente">{sr.client?.name}</Section>
        <Section label="Quando">{formatDateTime(sr.scheduled_at)}</Section>
        <Section label="Endereço">
          {sr.address?.street}, {sr.address?.number}<br />
          {sr.address?.neighborhood} · {sr.address?.zipcode}<br />
          {sr.address?.complement && <span className="text-sm">{sr.address.complement}</span>}
        </Section>
        <Section label="Contato">
          <a href={`tel:${sr.contact_phone}`} className="underline">{sr.contact_phone}</a>
        </Section>
        <Section label="Descrição">{sr.description}</Section>
        {sr.photos?.length > 0 && <PhotoGallery photos={sr.photos} />}
      </Card>

      <div className="mt-6 sticky bottom-4">
        <OnTheWayButton serviceId={sr.id} />
      </div>
    </main>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}
```

### `src/app/(provider)/services/[id]/accepted/OnTheWayButton.tsx`
```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';
import { useRouter } from 'next/navigation';

export function OnTheWayButton({ serviceId }: { serviceId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Esta transição (provider_en_route) será implementada em US-005.
  // Placeholder: chama o endpoint de transição genérico (T-235).
  const click = async () => {
    setBusy(true);
    try {
      await fetchOrThrow(`/api/services/${serviceId}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `enroute-${serviceId}` },
        body: JSON.stringify({ to: 'provider_en_route' }),
      });
      router.push(`/(provider)/services/${serviceId}/in-progress`);
    } catch (err) {
      showErrorToast({ type: 'transition' }, err);
      setBusy(false);
    }
  };

  return (
    <Button className="w-full" size="lg" onClick={click} disabled={busy}>
      {busy ? 'Atualizando…' : 'Estou a caminho'}
    </Button>
  );
}
```

## Constraints / NÃO fazer
- ❌ Mostrar dados sensíveis (CPF, número da casa) antes de validar que `provider_id = auth.uid()` (RLS já cuida, mas garantir no `.eq()` reforça)
- ❌ Implementar a transição completa aqui (vive em US-005) — apenas botão CTA
- ❌ Esconder botão "Estou a caminho" — é o único caminho funcional pós-aceite
- ❌ Mostrar histórico de outros prestadores (ex.: quem perdeu) — UI individual

## Convenções
- Server Component pra leitura inicial (RLS faz auth)
- Reuso: `Card`, `Button`, `Badge`
- `<a href="tel:">` pra contato (PWA → app de telefone do device)
- Idempotency-key estável `enroute-${id}` (mesmo handler em retry seguro)
- Sticky CTA bottom-4 (mobile-first)$desc$,
 'UI', 'PRESTADOR', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. TaskAcceptanceCriterion (vínculo task → AC-da-Story)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-265 RPC decline_proposal cobre AC #3
  ('b097da0a-50f3-4df0-841d-b3cec295a9d2'::uuid, 3),

  -- T-263 API accept cobre AC #2, #7, #8, #10
  ('a546395d-69b7-43f4-b73c-3395a98c62b3'::uuid, 2),
  ('a546395d-69b7-43f4-b73c-3395a98c62b3'::uuid, 7),
  ('a546395d-69b7-43f4-b73c-3395a98c62b3'::uuid, 8),
  ('a546395d-69b7-43f4-b73c-3395a98c62b3'::uuid, 10),

  -- T-264 API decline cobre AC #3
  ('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a'::uuid, 3),

  -- T-266 GET active cobre AC #5, #7
  ('1b597cfd-995a-41ff-a781-a7080f2a3a56'::uuid, 5),
  ('1b597cfd-995a-41ff-a781-a7080f2a3a56'::uuid, 7),

  -- T-267 hook cobre AC #1, #5, #10, #11 (mas só temos 10 AC; #11 não existe — manter 1,5,10)
  ('42c6c774-1190-4b54-a4b1-120c24bf89cf'::uuid, 1),
  ('42c6c774-1190-4b54-a4b1-120c24bf89cf'::uuid, 5),
  ('42c6c774-1190-4b54-a4b1-120c24bf89cf'::uuid, 10),

  -- T-268 ProposalCard cobre AC #1, #3, #7, #8
  ('31868fb7-d616-4032-8f11-cf3f5f824e00'::uuid, 1),
  ('31868fb7-d616-4032-8f11-cf3f5f824e00'::uuid, 3),
  ('31868fb7-d616-4032-8f11-cf3f5f824e00'::uuid, 7),
  ('31868fb7-d616-4032-8f11-cf3f5f824e00'::uuid, 8),

  -- T-269 home cobre AC #1, #4, #6
  ('afb5e381-c700-4b6a-9fcb-5cfd21c53a97'::uuid, 1),
  ('afb5e381-c700-4b6a-9fcb-5cfd21c53a97'::uuid, 4),
  ('afb5e381-c700-4b6a-9fcb-5cfd21c53a97'::uuid, 6),

  -- T-270 detalhe pós-aceite cobre AC #9
  ('d448df34-6279-47ad-8b88-06d882d8d737'::uuid, 9)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
  AND ac."order" = v.ac_order;


-- ============================================================================
-- 3. AcceptanceCriterion (taskId) — checklist técnico (checkbox no TaskSheet)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-265 DATA decline_proposal RPC
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'RPC decline_proposal criada com SECURITY DEFINER e search_path explícito', 1),
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'REVOKE de public/anon e GRANT EXECUTE para authenticated aplicados', 2),
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'Idempotência: chamar 2× retorna mesmo estado sem duplicar evento', 3),
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'Recusa não muda matching_rounds.status (round permanece broadcasting)', 4),
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'Erro round_not_found / candidate_not_in_round retorna code P0002', 5),
('b097da0a-50f3-4df0-841d-b3cec295a9d2', 'Audit em matching_round_events com kind=candidate_declined registrado', 6),

-- T-263 API accept HTTP wrapper
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Endpoint POST /api/matching/proposals/[round_id]/accept criado', 0),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Header idempotency-key obrigatório (400 sem header)', 1),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'JWT validado e provider_id extraído de auth.uid() (não do body)', 2),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Race perdida: 409 com error=already_accepted (smoke 2 prestadores simultâneos)', 3),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Round expirado: 410 com error=expired', 4),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Provider fora do round: 403 com error=forbidden', 5),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Sucesso retorna 201 com service_request_id', 6),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Mesma idempotency-key 2× não duplica aceite (resultado idêntico)', 7),
('a546395d-69b7-43f4-b73c-3395a98c62b3', 'Logs estruturados (round_id, provider_id, decision, status_code)', 8),

-- T-264 API decline HTTP wrapper
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'Endpoint POST /api/matching/proposals/[round_id]/decline criado', 0),
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'JWT obrigatório (401 sem auth)', 1),
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'Provider fora do round retorna 404 (não 403, evita enumeration)', 2),
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', '2 calls consecutivas retornam mesmo estado (idempotente)', 3),
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'Sem rate limit dedicado — RPC e RLS cobrem proteção', 4),
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'Sem efeito em score do prestador (smoke: score_factors antes=depois)', 5),

-- T-266 GET active proposals
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'Endpoint GET /api/matching/proposals/active criado', 0),
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'View provider_active_proposals_v criada com security_invoker=true', 1),
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'Retorna apenas propostas com decision=offered, status=broadcasting, expires_at>NOW()', 2),
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'Endereço retornado é apenas bairro + CEP truncado (sem rua/número)', 3),
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'JWT obrigatório (401 sem auth)', 4),
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'Smoke: prestador A não vê propostas do prestador B (RLS via VIEW security_invoker)', 5),
('1b597cfd-995a-41ff-a781-a7080f2a3a56', 'Sort por expires_at ASC (UI renderiza decrescentemente)', 6),

-- T-267 hook use-provider-matching
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'Hook subscribe ao canal matching:provider:{id} no mount', 0),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'Unsubscribe no unmount (sem leak — verificar com 2 mounts/unmounts seguidos)', 1),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'candidate_offered → adiciona proposal à lista local (useOptimisticCollection create)', 2),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'candidate_closed/expired/accepted → remove da lista (delete)', 3),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'No SUBSCRIBED inicial e em reconnect, refaz GET /api/matching/proposals/active', 4),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'decline(round_id) faz optimistic delete + POST /decline + revert se erro', 5),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'Latência <500ms entre INSERT em matching_round_events e atualização da UI (medido)', 6),

-- T-268 ProposalCard
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Card mostra categoria, subcategoria, área aproximada, valor estimado, countdown', 0),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Countdown decrescente atualiza por segundo; muda cor amarelo<60s, vermelho<15s', 1),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Botão Aceitar usa fetchOrThrow com idempotency-key=accept-{round_id}', 2),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Aceite 201 redireciona via router.push para /services/[id]/accepted', 3),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Aceite 409 mostra Sonner.error "Este serviço já foi aceito" sem navegar', 4),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Aceite 410 mostra Sonner.error "Esta proposta expirou"', 5),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Botão Recusar chama onDecline (delete optimistic do hook), sem ConfirmDialog', 6),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'aria-busy aplicado durante aceite (a11y)', 7),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'Não exibe nome do cliente, telefone, CPF ou endereço completo (verificar lint visual)', 8),

-- T-269 home page
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'Server Component em src/app/(provider)/home/page.tsx renderiza initial', 0),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'Lista de ProposalCard alimentada pelo hook useProviderMatching', 1),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'Estado vazio com Skeleton + texto "Aguardando proposta…" quando lista vazia E disponível', 2),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'Banner "Você está indisponível" quando is_available=false', 3),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'AvailabilityToggle (T-121) integrado no header sem reimplementar', 4),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'KycPendingState renderizado quando kyc_status != approved (reuso T-021)', 5),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', 'Mobile-first verificado em viewport <768px', 6),

-- T-270 accepted detail page
('d448df34-6279-47ad-8b88-06d882d8d737', 'Tela /(provider)/services/[id]/accepted/page.tsx criada (Server Component)', 0),
('d448df34-6279-47ad-8b88-06d882d8d737', 'Filtro .eq(provider_id, auth.uid()) garante que prestador só vê serviço aceito por ele', 1),
('d448df34-6279-47ad-8b88-06d882d8d737', 'Mostra endereço completo, telefone do cliente, descrição, fotos', 2),
('d448df34-6279-47ad-8b88-06d882d8d737', 'Botão "Estou a caminho" sticky bottom, chama POST /api/services/[id]/transition (T-235)', 3),
('d448df34-6279-47ad-8b88-06d882d8d737', 'Idempotency-key estável enroute-{id} no transition', 4),
('d448df34-6279-47ad-8b88-06d882d8d737', 'Erro de transição mostra showErrorToast e libera botão pra retry', 5),
('d448df34-6279-47ad-8b88-06d882d8d737', '404 quando prestador acessa direto sem ter aceitado (notFound() do Next)', 6);


-- ============================================================================
-- 4. TaskDependency (kind lowercase: blocks | relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES

-- T-264 API decline depende de T-265 RPC decline_proposal (blocks)
('77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'b097da0a-50f3-4df0-841d-b3cec295a9d2', 'blocks'),

-- T-263 API accept depende de T-244 (RPC accept_proposal já existente)
('a546395d-69b7-43f4-b73c-3395a98c62b3',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-244'), 'blocks'),

-- T-266 GET active depende da view de matching (T-238 + RLS T-229)
('1b597cfd-995a-41ff-a781-a7080f2a3a56',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-238'), 'blocks'),
('1b597cfd-995a-41ff-a781-a7080f2a3a56',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-229'), 'relates_to'),

-- T-267 hook depende de T-247 (canal Realtime), T-263, T-264, T-266
('42c6c774-1190-4b54-a4b1-120c24bf89cf',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-247'), 'blocks'),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', 'a546395d-69b7-43f4-b73c-3395a98c62b3', 'blocks'),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', '77ad29d3-2766-4e4f-95c2-b5aa0edf4b5a', 'blocks'),
('42c6c774-1190-4b54-a4b1-120c24bf89cf', '1b597cfd-995a-41ff-a781-a7080f2a3a56', 'blocks'),

-- T-268 ProposalCard depende de T-267 + T-263
('31868fb7-d616-4032-8f11-cf3f5f824e00', '42c6c774-1190-4b54-a4b1-120c24bf89cf', 'blocks'),
('31868fb7-d616-4032-8f11-cf3f5f824e00', 'a546395d-69b7-43f4-b73c-3395a98c62b3', 'blocks'),

-- T-269 home depende de T-267, T-268, T-121 (AvailabilityToggle), T-021 (KycPendingState)
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', '42c6c774-1190-4b54-a4b1-120c24bf89cf', 'blocks'),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97', '31868fb7-d616-4032-8f11-cf3f5f824e00', 'blocks'),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-121'), 'relates_to'),
('afb5e381-c700-4b6a-9fcb-5cfd21c53a97',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-021'), 'relates_to'),

-- T-270 accepted detail depende de T-263 (push após accept) + T-235 (transition_service_status)
('d448df34-6279-47ad-8b88-06d882d8d737', 'a546395d-69b7-43f4-b73c-3395a98c62b3', 'blocks'),
('d448df34-6279-47ad-8b88-06d882d8d737',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'relates_to'),
('d448df34-6279-47ad-8b88-06d882d8d737',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'relates_to');


COMMIT;
