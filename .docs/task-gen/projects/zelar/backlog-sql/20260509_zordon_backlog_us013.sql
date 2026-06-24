-- Zelar v2 — Backlog SQL: ZLAR-V2-US-013 (CLIENTE avalia, assina conclusao e ve historico)
-- Modulo: EXECUCAO | Persona: CLIENTE | AC: 12
-- Apenas insere metadata em tabelas internas do Zordon (Task, AcceptanceCriterion,
-- TaskAcceptanceCriterion, TaskDependency). NAO executa DDL de produto.
--
-- Story id:   858fd44d-4f0c-4ea3-8742-075b83dfeba7
-- Project id: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
-- DS id:      264e6d07-d365-43ba-8029-d539ce6f7c6b
-- Persona id (CLIENTE):   4ff1ab67-9c32-4024-80e7-d22bcdac063f
-- Persona id (PRESTADOR): fa9b4900-290e-4c82-b72e-d2ced409f289
-- Persona id (ADMIN):     bf056ca2-211d-4e2e-adfe-32de0c5af2b8
-- Persona id (SISTEMA):   085f0246-a5d1-4b23-9f09-025b5e37177b

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-318 (DATA: service_ratings — 1-5 estrelas + comentario, unique por SR, deadline via app_config)
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-318', 'Criar tabela service_ratings (1-5 estrelas + comentario opcional + RLS CLIENTE/PRESTADOR/ADMIN)',
 $desc$## Objetivo
Persistir uma avaliacao por servico (`UNIQUE(service_request_id)` total — apenas 1 por SR), com nota inteira 1..5 e comentario opcional. Cobre AC #3 (avaliacao opcional 1-5 + comentario), AC #5 (registrada no perfil do prestador, sem moderacao), AC #6 (nao avaliar 2x — mesmo SR retorna erro mapeavel), AC #7 (avaliar antigo enquanto janela aberta).

## Contexto
Modulo EXECUCAO. Ratings sao parte do score Q (qualidade) consumido por T-241 (`compute_provider_score`). Inseridas pelo CLIENTE via T-321; lidas pelo PRESTADOR (em US-007 perfil + US-028 historico) e pelo ADMIN (em US-016 dashboard). NAO ha moderacao intermediaria — registro direto. Janela de aceite e definida pelo `app_config.rating_window_days` (T-331), validada server-side em T-321 (nao via constraint imutavel — janela pode mudar com app_config).

## Estado atual / O que substitui
Nao existe. T-230 (RLS suite) menciona ratings mas a tabela ainda nao foi criada.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_ratings.sql`
```sql
BEGIN;

CREATE TABLE service_ratings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stars               int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment             text CHECK (char_length(coalesce(comment,'')) <= 1000),
  rated_at            timestamptz NOT NULL DEFAULT NOW(),
  -- imutavel: nao tem coluna updated_at; ratings sao append-only.
  "createdAt"         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX service_ratings_provider_idx ON service_ratings(provider_id, rated_at DESC);
CREATE INDEX service_ratings_client_idx   ON service_ratings(client_id, rated_at DESC);

ALTER TABLE service_ratings ENABLE ROW LEVEL SECURITY;

-- CLIENTE: SELECT de avaliacoes que ele criou
CREATE POLICY "rating_client_select" ON service_ratings FOR SELECT
  USING (auth.uid() = client_id);

-- CLIENTE: INSERT apenas com client_id=auth.uid() E status do SR='completed' E dentro da janela
-- (validacao real fica no RPC T-321; CHECK aqui e barreira de seguranca minima)
CREATE POLICY "rating_client_insert" ON service_ratings FOR INSERT
  WITH CHECK (auth.uid() = client_id);

-- PRESTADOR: SELECT de avaliacoes recebidas (sem comentario denuncia? sim, ele pode ver tudo)
CREATE POLICY "rating_provider_select" ON service_ratings FOR SELECT
  USING (auth.uid() = provider_id);

-- ADMIN
CREATE POLICY "rating_admin_all" ON service_ratings FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Bloqueio de UPDATE/DELETE pra nao-admin (avaliacoes sao imutaveis)
CREATE POLICY "rating_no_update" ON service_ratings FOR UPDATE
  USING (false);
CREATE POLICY "rating_no_delete" ON service_ratings FOR DELETE
  USING (false);

COMMIT;
```

## Constraints / NAO fazer
- NAO permitir 2a avaliacao no mesmo SR (UNIQUE total por service_request_id; AC #6)
- NAO permitir UPDATE/DELETE por client/provider — append-only (audit + abuso)
- NAO incluir coluna "moderation_status" — AC #5 explicita "sem moderacao intermediaria"
- NAO permitir rating sem SR = 'completed' — validacao no RPC T-321 (status check)
- NAO impor `rated_at <= signed_at + N dias` via CHECK — janela e parametrizada (`app_config.rating_window_days`); CHECK imutavel impede alteracao operacional

## Convencoes
- "createdAt" com aspas duplas (convencao do projeto)
- `rated_at` separado de "createdAt" para casos onde admin "backfila" rating (raro, mas fica claro qual data conta para janela)
- Comentario livre ate 1000 chars; entrada vazia => NULL
- Migration aplicada via psql; `database.types.ts` regenerado
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-319 (DATA: VIEW client_service_history_v + indices para listagem cronologica)
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-319', 'Criar VIEW client_service_history_v (lista cronologica + status + flags retrabalho/disputa)',
 $desc$## Objetivo
Expor pro CLIENTE uma lista cronologica completa de seus servicos com status agregado (`completed`, `cancelled`, `in_dispute`, `in_rework`, `in_progress`...), categoria, valor final, e flags binarias `has_pending_rating` e `within_warranty_window` (calculadas via `app_config`). Cobre AC #8 (historico cronologico com status + filtros), e e a fonte para o banner de "avaliacao pendente" (AC #4).

## Contexto
Modulo EXECUCAO. Lida pelo endpoint T-323 com paginacao por cursor + filtros (periodo, categoria). Substitui o que seria varias queries: junta `service_requests` + `service_categories` + `service_ratings` + `support_tickets` (kind=dispute/rework de T-147) + `app_config.rating_window_days` + `app_config.warranty_window_days`.

## Estado atual / O que substitui
Nao existe. Existe T-130 (`/api/provider/services/history`) — versao do PRESTADOR; aqui criamos a versao CLIENTE com flags adicionais (rating pendente, dentro de garantia).

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_client_service_history_view.sql`
```sql
BEGIN;

CREATE VIEW client_service_history_v
WITH (security_invoker = true) AS
WITH cfg AS (
  SELECT
    (value->>'rating_window_days')::int   AS rating_window_days,
    (value->>'warranty_window_days')::int AS warranty_window_days
  FROM app_config WHERE key = 'service_lifecycle'
)
SELECT
  sr.id                       AS service_request_id,
  sr.client_id,
  sr.provider_id,
  sr.status                   AS service_status,
  sr.category_id,
  cat.slug                    AS category_slug,
  cat.name                    AS category_name,
  sr.title                    AS service_title,
  sr.scheduled_for,
  sr.completed_at,
  sr.cancelled_at,
  sr.cancel_reason,
  sr.cancel_actor,            -- CLIENTE | PRESTADOR | SISTEMA | ADMIN
  sr.total_amount_cents,
  sr.travel_fee_cents,
  sr.platform_fee_cents,
  sr.materials_amount_cents,
  -- flags derivadas
  (
    sr.status = 'completed'
    AND rt.id IS NULL
    AND sr.completed_at + (cfg.rating_window_days || ' days')::interval > NOW()
  )                           AS has_pending_rating,
  (
    sr.status = 'completed'
    AND sr.completed_at + (cfg.warranty_window_days || ' days')::interval > NOW()
  )                           AS within_warranty_window,
  -- estado derivado por tickets abertos
  EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.service_request_id = sr.id
      AND t.kind = 'dispute'
      AND t.status NOT IN ('resolved','closed')
  )                           AS has_open_dispute,
  EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.service_request_id = sr.id
      AND t.kind = 'rework'
      AND t.status NOT IN ('resolved','closed')
  )                           AS has_open_rework,
  rt.stars                    AS rating_stars,
  rt.rated_at                 AS rated_at
FROM service_requests sr
JOIN service_categories cat ON cat.id = sr.category_id
LEFT JOIN service_ratings rt ON rt.service_request_id = sr.id
CROSS JOIN cfg
WHERE sr.client_id = auth.uid();   -- security_invoker => RLS de service_requests vale

COMMENT ON VIEW client_service_history_v IS
  'CLIENTE-only: historico cronologico com flags pendente_rating/within_warranty/dispute/rework.';

REVOKE ALL ON client_service_history_v FROM public, anon;
GRANT SELECT ON client_service_history_v TO authenticated;

-- Indices (no service_requests; VIEW nao tem indice proprio)
CREATE INDEX IF NOT EXISTS sr_client_completed_idx
  ON service_requests(client_id, completed_at DESC NULLS LAST)
  WHERE status IN ('completed','cancelled');
CREATE INDEX IF NOT EXISTS sr_client_status_idx
  ON service_requests(client_id, status, scheduled_for DESC);

COMMIT;
```

## Constraints / NAO fazer
- NAO incluir CPF/telefone do prestador na VIEW (a UI de detalhe puxa via `provider_profiles` apenas display_name+avatar)
- NAO permitir SELECT por outro cliente (security_invoker garante via RLS de `service_requests`)
- NAO calcular flags em loop no app — manter como CASE/EXISTS na VIEW
- NAO incluir tickets/dispute_history em colunas — esses puxam via T-325 endpoint (lazy)

## Convencoes
- `security_invoker = true` (consistente com T-305 client_active_matching_v)
- Indice composto no `service_requests` para satisfazer paginacao por cursor (T-323)
- `rating_window_days` e `warranty_window_days` lidos de `app_config` (T-331 seedaro)
$desc$,
 'DATA', 'CLIENTE', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-320 (DATA: service_receipts + bucket service-receipts privado)
('ef2075d7-885c-4885-b27f-f17212845b71', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-320', 'Criar service_receipts (PDF, hash audit) + bucket privado service-receipts',
 $desc$## Objetivo
Persistir referencia ao PDF do recibo gerado (path no bucket privado `service-receipts/`, hash sha256 do conteudo, kind = `completed` | `cancelled`, signed_url cache nao persistido) e tipo gerado. Cobre AC #2 (recibo enviado por canais externos com assinatura), AC #9 (download de comprovante), AC #11 (recibo bloqueado se em disputa) e AC #12 (comprovante separado de cancelamento).

## Contexto
Modulo EXECUCAO. Recibo e gerado pela Edge Function T-322 (`generate-service-receipt`) na transicao `completed` (gancho via T-235 `transition_service_status`) e tambem na transicao `cancelled` (US-015 quando criado). Hash garante imutabilidade (qualquer regeneracao com hash diferente e bug). Linha unica por (service_request_id, kind). Tabela referenciada por T-323/T-325 (endpoints CLIENTE) que retornam signed url quando autorizado.

## Estado atual / O que substitui
Nao existe. T-284 (US-005) menciona "acesso recibo no historico" mas nao define o backing store.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_service_receipts.sql`
```sql
BEGIN;

CREATE TYPE service_receipt_kind AS ENUM ('completed','cancelled');

CREATE TABLE service_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  kind                service_receipt_kind NOT NULL,
  storage_path        text NOT NULL,            -- ex: receipts/{sr_id}/{kind}-{timestamp}.pdf
  content_sha256      text NOT NULL,            -- hash do conteudo
  generated_by        text NOT NULL,            -- 'system'|'admin:<uuid>'
  total_amount_cents  bigint NOT NULL,
  metadata_jsonb      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_unique_per_kind UNIQUE (service_request_id, kind)
);

CREATE INDEX service_receipts_sr_idx ON service_receipts(service_request_id);

ALTER TABLE service_receipts ENABLE ROW LEVEL SECURITY;

-- CLIENTE: ve recibo do proprio servico
CREATE POLICY "receipt_client_select" ON service_receipts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
       WHERE sr.id = service_receipts.service_request_id
         AND sr.client_id = auth.uid()
    )
  );

-- PRESTADOR: ve recibo do servico que prestou
CREATE POLICY "receipt_provider_select" ON service_receipts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM service_requests sr
       WHERE sr.id = service_receipts.service_request_id
         AND sr.provider_id = auth.uid()
    )
  );

CREATE POLICY "receipt_admin_all" ON service_receipts FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- INSERT/UPDATE/DELETE bloqueado pra nao-admin (gera apenas via Edge Function service_role)
CREATE POLICY "receipt_no_user_write" ON service_receipts FOR INSERT
  WITH CHECK (false);
CREATE POLICY "receipt_no_update" ON service_receipts FOR UPDATE
  USING (false);
CREATE POLICY "receipt_no_delete" ON service_receipts FOR DELETE
  USING (false);

COMMIT;
```

### Bucket privado `service-receipts` (criado via Supabase Dashboard ou storage migration)
- Privado (sem acesso anonimo)
- Caminho: `receipts/{service_request_id}/{kind}-{timestamp}.pdf`
- Apenas Edge Function (T-322) com `SUPABASE_SERVICE_ROLE_KEY` faz upload
- CLIENTE/PRESTADOR consomem via signed URL (TTL 5min) gerada pelo endpoint T-325

## Constraints / NAO fazer
- NAO armazenar PDF inline em coluna bytea (volume de Storage e mais barato e suporta CDN)
- NAO permitir overwrite do PDF existente (UNIQUE por kind impede; Edge Function checa antes de gerar)
- NAO permitir CLIENTE/PRESTADOR fazerem INSERT (sempre via service_role)
- NAO expor signed URL na VIEW T-319 (gerar lazy quando o detalhe e consultado, evitando vazar TTL caches)
- NAO gerar recibo se SR tem `support_tickets` com `kind='dispute'` e `status NOT IN ('resolved','closed')` — bloqueio de AC #11 fica em T-322

## Convencoes
- Bucket privado igual padrao `service-photos`/`signatures`/`service-materials` (US-005/US-006)
- `content_sha256` = hash sobre o byte-stream do PDF gerado (anti-tamper interno)
- Referenciar `app_config.feature_flags.receipt_pdf_v` se houver versao do template
- Migration aplicada via psql; `database.types.ts` regenerado
$desc$,
 'DATA', 'ANY', ARRAY['RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-321 (API: POST /api/services/[id]/rating + RPC submit_service_rating idempotente)
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-321', 'Implementar POST /api/services/[id]/rating + RPC submit_service_rating',
 $desc$## Objetivo
Endpoint + RPC que registra avaliacao 1-5 (`stars`) com comentario opcional, valida (a) status do SR='completed', (b) `auth.uid() = client_id`, (c) janela `app_config.rating_window_days` aberta desde `completed_at`, (d) idempotencia (se ja existe rating, retorna {ok:true, idempotent:true} para nao gerar 409). Cobre AC #3 (avaliar opcional), AC #5 (registrada no perfil + emit notification ao prestador), AC #6 (mensagem informativa em duplicata, nao 500), AC #7 (recusa gentilmente apos janela).

## Contexto
Modulo EXECUCAO. Tela RatingSheet (T-329) chama esse endpoint. Apos sucesso, dispara `emit.ratingReceived(provider_user_id, sr_id, stars)` (T-326), que enfileira notification (US-022) e participa do recalculo do score Q via T-241 (`compute_provider_score`). NAO ha moderacao — registro vai direto.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_submit_service_rating_rpc.sql`
```sql
BEGIN;

CREATE OR REPLACE FUNCTION submit_service_rating(
  p_service_request_id uuid,
  p_stars               int,
  p_comment             text,
  p_idempotency_key     text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client uuid; v_provider uuid; v_status text; v_completed_at timestamptz;
  v_window_days int;
  v_existing service_ratings%ROWTYPE;
BEGIN
  IF p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'invalid_stars' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(p_comment,'')) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT client_id, provider_id, status, completed_at
    INTO v_client, v_provider, v_status, v_completed_at
  FROM service_requests WHERE id = p_service_request_id;
  IF v_client IS NULL THEN RAISE EXCEPTION 'sr_not_found' USING ERRCODE='P0002'; END IF;
  IF v_client != auth.uid() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF v_status != 'completed' THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023', DETAIL = v_status;
  END IF;

  -- Janela parametrizada
  SELECT (value->>'rating_window_days')::int INTO v_window_days
    FROM app_config WHERE key='service_lifecycle';
  IF v_completed_at + (v_window_days || ' days')::interval < NOW() THEN
    RAISE EXCEPTION 'rating_window_closed' USING ERRCODE='22023', DETAIL = v_window_days::text;
  END IF;

  -- Idempotencia: se ja avaliou, retorna sem erro (AC #6 — sem 500)
  SELECT * INTO v_existing FROM service_ratings WHERE service_request_id = p_service_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true,
      'rating_id', v_existing.id, 'stars', v_existing.stars);
  END IF;

  INSERT INTO service_ratings (service_request_id, client_id, provider_id, stars, comment)
  VALUES (p_service_request_id, v_client, v_provider, p_stars, NULLIF(p_comment,''));

  RETURN jsonb_build_object('ok', true, 'idempotent', false);
END $$;

REVOKE EXECUTE ON FUNCTION submit_service_rating FROM public, anon;
GRANT  EXECUTE ON FUNCTION submit_service_rating TO authenticated;

COMMIT;
```

### `src/app/api/services/[id]/rating/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { emit } from '@/lib/notifications/emit';
import { mapRpcError } from '@/lib/api/rpc-errors';

const Body = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error:'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_service_rating', {
    p_service_request_id: id,
    p_stars: body.stars,
    p_comment: body.comment ?? null,
    p_idempotency_key: idemKey,
  });
  if (error) return mapRpcError(error);

  // AC #5: notifica prestador (fire-and-forget)
  if (!data?.idempotent) {
    emit.ratingReceived(id).catch(()=>{}); // T-326 hotspot
  }
  return Response.json(data);
}
```

## Constraints / NAO fazer
- NAO retornar 409 em duplicata — AC #6 obriga "mensagem informativa sem erro generico"; RPC retorna `{idempotent:true}` e UI mostra Sonner.info
- NAO permitir UPDATE de rating existente (AC #5 imutavel)
- NAO bloquear emit se ja idempotent (rate-limit no proprio emit ja cuida)
- NAO validar `p_stars` no client (Zod no servidor; AC #6 confianca server-only)
- NAO esperar resposta do `emit.ratingReceived` (fire-and-forget — nao falhar a request)

## Convencoes
- Idempotency-Key obrigatoria (`rating-{sr_id}` estavel — qualquer retry mesmo)
- Mapping de errcodes para HTTP: `P0002` -> 404, `42501` -> 403, `22023 invalid_status` -> 409, `22023 rating_window_closed` -> 410 (Gone), `22023 invalid_stars/comment_too_long` -> 400
- Reuso: `mapRpcError`, `createClient` (server), `emit.ts`
- Logs estruturados (entity=service, action=rating_submitted, actor=client_id)
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-322 (API: Edge Function generate-service-receipt — gera PDF, sobe storage, insere row)
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-322', 'Implementar Edge Function generate-service-receipt (PDF + storage + audit)',
 $desc$## Objetivo
Edge Function (Deno) acionada (a) automaticamente apos `transition_service_status` -> `completed` (via gancho dentro de T-235 ou via gatilho separado T-326), e (b) apos `transition_service_status` -> `cancelled` (US-015 quando criado), gerando o PDF do recibo, fazendo upload no bucket privado `service-receipts/`, e inserindo row em `service_receipts` (T-320). Cobre AC #2 (recibo emitido + canais externos), AC #9 (PDF baixavel) e AC #12 (comprovante de cancelamento separado).

## Contexto
Modulo EXECUCAO. Edge Function recebe `{ service_request_id, kind: 'completed' | 'cancelled' }` e e idempotente (se ja existe row em `service_receipts` para mesmo (sr_id, kind), retorna 200 com path existente). PDF gerado com `pdfkit` (Deno-friendly) ou `react-pdf` server-side (preferir `@react-pdf/renderer` com `pnpm pdf-renderer` em build). Conteudo:
- Cabecalho Zelar + numero do servico + data
- Cliente: nome + endereco
- Prestador: nome + categoria
- Breakdown financeiro (servico, deslocamento, taxa, materiais)
- Assinatura (se kind='completed': embed PNG da `service_signatures` T-273; se 'cancelled': "Cancelado em {ts} por {actor}, reembolso R$X em ate Yd")

T-326 (`emit.serviceCompleted` hot spot) chama `supabase.functions.invoke('generate-service-receipt', { body: { service_request_id, kind:'completed' } })` apos a transicao. Recibo em `kind='cancelled'` sera disparado pela rota de cancelamento (US-015 — ainda a criar; relates_to).

## Estado atual / O que substitui
Nao existe. T-173 cria componentes React Email; aqui criamos um renderer PDF separado.

## O que criar

### `supabase/functions/generate-service-receipt/index.ts`
```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2';
import PDFDocument from 'npm:pdfkit@0.15';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

interface Body { service_request_id: string; kind: 'completed' | 'cancelled'; }

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { service_request_id, kind } = await req.json() as Body;

  // Idempotencia
  const { data: existing } = await supabase
    .from('service_receipts')
    .select('id, storage_path')
    .eq('service_request_id', service_request_id)
    .eq('kind', kind)
    .maybeSingle();
  if (existing) {
    return Response.json({ ok:true, idempotent:true, path: existing.storage_path });
  }

  // AC #11: bloqueio se em disputa (apenas pra kind='completed')
  if (kind === 'completed') {
    const { data: openDispute } = await supabase
      .from('support_tickets')
      .select('id')
      .eq('service_request_id', service_request_id)
      .eq('kind', 'dispute')
      .not('status', 'in', '(resolved,closed)')
      .maybeSingle();
    if (openDispute) {
      return Response.json({ error:'dispute_open' }, { status: 409 });
    }
  }

  // Buscar dados consolidados (1 query lateral join)
  const { data: sr } = await supabase
    .from('service_requests')
    .select('*, service_categories(name), service_ratings(stars,comment), service_signatures(storage_path,client_name_typed)')
    .eq('id', service_request_id)
    .single();
  if (!sr) return Response.json({ error:'sr_not_found' }, { status: 404 });

  // Gerar PDF
  const buffers: Uint8Array[] = [];
  const doc = new PDFDocument();
  doc.on('data', (b: Uint8Array) => buffers.push(b));
  // ... layout: header, cliente, prestador, breakdown, assinatura embed (download .png do bucket signatures/)
  doc.end();
  await new Promise(res => doc.on('end', res));
  const pdfBytes = new Uint8Array(buffers.reduce((acc, b) => [...acc, ...b], []));

  // Upload Storage
  const ts = Date.now();
  const path = `receipts/${service_request_id}/${kind}-${ts}.pdf`;
  await supabase.storage.from('service-receipts').upload(path, pdfBytes, {
    contentType: 'application/pdf', upsert: false,
  });

  // Hash + insert
  const hashBuf = await crypto.subtle.digest('SHA-256', pdfBytes);
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  await supabase.from('service_receipts').insert({
    service_request_id, kind, storage_path: path,
    content_sha256: hash, generated_by: 'system',
    total_amount_cents: sr.total_amount_cents,
    metadata_jsonb: { signed_at: sr.signed_at ?? null, cancelled_at: sr.cancelled_at ?? null }
  });

  return Response.json({ ok:true, path, sha256: hash });
});
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_receipt_after_completed_trigger.sql`
```sql
-- Gancho: AFTER transition `completed`, chama Edge Function
CREATE OR REPLACE FUNCTION trigger_receipt_on_completed() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    PERFORM net.http_post(
      url => current_setting('app.edge_url') || '/functions/v1/generate-service-receipt',
      headers => jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.edge_key')),
      body => jsonb_build_object('service_request_id', NEW.id, 'kind','completed')::text
    );
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

## Constraints / NAO fazer
- NAO gerar PDF inline na request do CLIENTE (pesa; CLIENTE so consome signed URL via T-325)
- NAO incluir CPF/PIX/dados bancarios no recibo (LGPD — apenas display_name + cidade do prestador)
- NAO permitir overwrite (idempotencia checa antes; UNIQUE no banco trava)
- NAO chamar funcao com SUPABASE_ANON_KEY (precisa SERVICE_ROLE pra escrever em service_receipts)
- NAO gerar recibo se em disputa aberta (kind='completed' bloqueado; AC #11)

## Convencoes
- Edge Function privada (auth via service_role no caller); idempotent por (sr_id, kind)
- Reuso: T-127 padrao (Edge Function despachadora com createClient admin)
- Hash sha256 sempre — auditoria de integridade
- Bucket privado `service-receipts` (nao expor publicamente)
- Secrets: `SUPABASE_SERVICE_ROLE_KEY` (server-only)
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-323 (API: GET /api/client/services/history + GET /api/client/services/pending-rating)
('43a40429-3982-4413-972e-95285540b14c', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-323', 'Implementar GET /api/client/services/history (cursor + filtros) + /pending-rating',
 $desc$## Objetivo
Dois endpoints CLIENTE-scope:
1. `GET /api/client/services/history?period=30d|90d|all&category=<slug>&cursor=<ts>&limit=20` — paginado por cursor temporal sobre `client_service_history_v` (T-319). Cobre AC #8.
2. `GET /api/client/services/pending-rating` — retorna ate 5 servicos com `has_pending_rating=true` ordenados por `completed_at DESC`. Cobre AC #4 (avaliacao pendente em destaque, mais recente prioridade).

## Contexto
Modulo EXECUCAO. Listagem alimenta T-327 (UI historico) com infinite scroll e filtros. `pending-rating` alimenta o `PendingRatingBanner` (em T-329) na home do CLIENTE. `auth.uid()` filtra via security_invoker da VIEW.

## Estado atual / O que substitui
Nao existe. Existe T-130 (`/api/provider/services/history`) — referencia para paginacao por cursor, mas escopo PRESTADOR.

## O que criar

### `src/app/api/client/services/history/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Query = z.object({
  period: z.enum(['30d','90d','all']).default('90d'),
  category: z.string().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = Query.parse(Object.fromEntries(url.searchParams));
  const supabase = await createClient();
  let qb = supabase.from('client_service_history_v')
    .select('*')
    .order('scheduled_for', { ascending: false })
    .limit(q.limit + 1); // hasMore detection

  if (q.period === '30d') qb = qb.gte('scheduled_for', new Date(Date.now() - 30*864e5).toISOString());
  if (q.period === '90d') qb = qb.gte('scheduled_for', new Date(Date.now() - 90*864e5).toISOString());
  if (q.category)         qb = qb.eq('category_slug', q.category);
  if (q.cursor)           qb = qb.lt('scheduled_for', q.cursor);

  const { data, error } = await qb;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const hasMore = (data?.length ?? 0) > q.limit;
  const items = hasMore ? data!.slice(0, q.limit) : data ?? [];
  const nextCursor = hasMore ? items[items.length-1].scheduled_for : null;
  return Response.json({ items, nextCursor });
}
```

### `src/app/api/client/services/pending-rating/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('client_service_history_v')
    .select('service_request_id,service_title,category_name,completed_at,total_amount_cents,provider_id')
    .eq('has_pending_rating', true)
    .order('completed_at', { ascending: false })
    .limit(5);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}
```

## Constraints / NAO fazer
- NAO trazer mais que 50 itens por pagina (DoS via `limit` alto)
- NAO retornar CPF/email do prestador na lista (apenas provider_id; UI carrega snapshot via T-325 detalhe)
- NAO indexar por `completed_at` se `scheduled_for` ja for indice principal (T-319 ja cria `sr_client_completed_idx`)
- NAO permitir cursor invalido sem 400 — Zod valida `datetime()`
- NAO calcular `has_pending_rating` no servidor (fica na VIEW) — isso garante consistencia com banner

## Convencoes
- GET sem body; query string com Zod
- Cursor temporal sobre `scheduled_for` (mesmo campo de ordering — estavel)
- Reuso: `createClient` server, VIEW T-319
- Sem RLS_REQUIRED na flag (a VIEW e security_invoker → herda RLS de service_requests)
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','PAGINATION','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-324 (API: GET /api/client/services/[id] detalhe + signed url do recibo)
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-324', 'Implementar GET /api/client/services/[id] (detalhe + breakdown + signed url recibo)',
 $desc$## Objetivo
Endpoint que retorna a visao completa do servico para a tela de detalhe do CLIENTE (T-328): dados do SR, snapshot do prestador (sem PII sensivel), breakdown financeiro (`total`, `travel_fee`, `platform_fee`, `materials`), rating (se ja avaliou), flags `within_warranty_window`, `has_open_dispute`, `has_open_rework`, e signed URL do recibo (TTL 5min). Cobre AC #9 (breakdown + download PDF), AC #10 (botoes 30d), AC #11 (em disputa: bloqueio botao recibo), AC #12 (cancelamento: motivo + politica + reembolso).

## Contexto
Modulo EXECUCAO. Endpoint puxa de `client_service_history_v` (T-319) + `service_receipts` (T-320) com signed URL gerada via service_role; e tambem inclui (se `has_open_dispute` ou `has_open_rework`) snapshot do ticket aberto. Para AC #12, junta com `service_cancellations` (US-015 quando criado) — relates_to. Sem `service_cancellations` ainda, retorna `cancellation: null`.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/api/client/services/[id]/route.ts`
```typescript
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: sr }, { data: ratings }, { data: tickets }, { data: receipts }] = await Promise.all([
    supabase.from('client_service_history_v').select('*').eq('service_request_id', id).single(),
    supabase.from('service_ratings').select('id, stars, comment, rated_at').eq('service_request_id', id),
    supabase.from('support_tickets')
      .select('id, kind, status, "createdAt"')
      .eq('service_request_id', id)
      .in('kind', ['dispute','rework']),
    supabase.from('service_receipts').select('id, kind, storage_path, "createdAt"').eq('service_request_id', id),
  ]);
  if (!sr) return Response.json({ error:'not_found' }, { status: 404 });

  // Snapshot publico do prestador (display_name, avatar, badge, rating)
  const { data: providerSnap } = await supabase
    .from('provider_profiles')
    .select('id, display_name, avatar_url, trust_badge, rating_average')
    .eq('id', sr.provider_id).single();

  // Signed URLs para recibos (TTL 300s) — bloqueia se has_open_dispute (AC #11)
  const admin = createAdminClient();
  const receiptsWithUrl = sr.has_open_dispute
    ? receipts?.map(r => ({ ...r, signed_url: null, blocked_reason: 'dispute_open' }))
    : await Promise.all((receipts ?? []).map(async r => {
        const { data: signed } = await admin.storage.from('service-receipts').createSignedUrl(r.storage_path, 300);
        return { ...r, signed_url: signed?.signedUrl ?? null };
      }));

  return Response.json({
    service: sr,
    provider: providerSnap,
    rating: ratings?.[0] ?? null,
    tickets: tickets ?? [],
    receipts: receiptsWithUrl ?? [],
    can_rate: sr.has_pending_rating,
    can_request_rework: sr.within_warranty_window && !sr.has_open_dispute && !sr.has_open_rework && sr.service_status === 'completed',
    can_open_dispute:   sr.within_warranty_window && !sr.has_open_dispute && sr.service_status === 'completed',
  });
}
```

## Constraints / NAO fazer
- NAO usar service_role pra ler dados que RLS deveria gerar (apenas pra signed URLs do storage privado)
- NAO retornar CPF/telefone do prestador (apenas snapshot publico)
- NAO retornar signed_url se `has_open_dispute=true` (AC #11)
- NAO calcular `can_*` flags no client (fonte unica server-side)
- NAO seguir ate o ticket detalhe aqui (lista resumida; admin/usuario abre ticket separado)

## Convencoes
- TTL 300s nas signed URLs (curto — cliente ja deve estar consumindo nas proximas 5min)
- Reuso: `createClient` (server), `createAdminClient` (so storage signed URL)
- Endpoint server-rendered no Page (T-328); pode ser chamado tb client-side em refetch
- AC #10 e #11 derivados via `can_*` (UI binda direto sem reimplementar regra)
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RLS_REQUIRED'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-325 (API: POST /api/services/[id]/report-rework + POST /api/services/[id]/open-dispute)
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-325', 'Implementar POST /api/services/[id]/report-rework + open-dispute (gate 30d + estado)',
 $desc$## Objetivo
Dois endpoints CLIENTE que abrem ticket de retrabalho (`kind='rework'`) ou disputa (`kind='dispute'`) sobre um servico, validando (a) `service_status='completed'`, (b) `within_warranty_window=true` (`app_config.warranty_window_days`), (c) ausencia de outro ticket do mesmo kind aberto, (d) idempotencia. Cobre AC #10 (botoes "Solicitar retrabalho"/"Abrir disputa" em destaque dentro de 30d) e AC #11 (em disputa: retrabalho indisponivel — verificado server-side).

## Contexto
Modulo EXECUCAO + SUPORTE. Cria `support_tickets` (T-147 ja extendeu com kind=dispute; rework usa mesma tabela com kind=rework). Apos abertura, dispara fluxo da US-026 (admin recebe na fila). Para retrabalho, alem do ticket, inicia fluxo de retrabalho mediado da US-026 (T-153 — Edge Function dispute_rework_escalation eventualmente realoca outro prestador apos 24h sem aceite). UI fica em T-328 (botoes no detalhe).

## Estado atual / O que substitui
Nao existe. T-147 (US-026) cria base do support_tickets para disputa; aqui adicionamos endpoint do CLIENTE pra abrir.

## O que criar

### `src/app/api/services/[id]/report-rework/route.ts` (analogo para `open-dispute`)
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  description:    z.string().min(20).max(2000),
  evidence_paths: z.array(z.string()).max(10).optional(),
});

async function openTicket(req: Request, params: Promise<{ id: string }>, kind: 'rework' | 'dispute') {
  const { id } = await params;
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error:'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('open_service_ticket', {
    p_service_request_id: id,
    p_kind: kind,
    p_description: body.description,
    p_evidence_paths: body.evidence_paths ?? [],
    p_idempotency_key: idemKey,
  });
  if (error) {
    // P0002 -> 404, 42501 -> 403, 22023 invalid_status -> 409, 22023 warranty_expired -> 410, 23505 -> 409 (already open)
    if (error.code === 'P0002') return Response.json({ error:'sr_not_found' }, { status: 404 });
    if (error.code === '42501') return Response.json({ error:'forbidden' }, { status: 403 });
    if (error.code === '23505') return Response.json({ error:'already_open' }, { status: 409 });
    if (error.code === '22023') {
      const detail = (error.details ?? '').includes('warranty_expired') ? 410 : 409;
      return Response.json({ error: error.message }, { status: detail });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return openTicket(req, params, 'rework');
}
```

### RPC `open_service_ticket(p_service_request_id, p_kind, p_description, p_evidence_paths[], p_idempotency_key)`
- `LANGUAGE plpgsql SECURITY DEFINER`
- Valida client_id, status='completed', warranty window, sem ticket existente do mesmo kind nao-fechado
- Para `kind='rework'`: rejeita se ja existe `kind='dispute'` aberto (AC #11)
- INSERT em `support_tickets` (kind, service_request_id, opened_by=auth.uid(), description, evidence_paths)
- INSERT em `support_ticket_events` (audit)
- Idempotency: se tem ticket com mesmo `idempotency_key` em `metadata`, retorna existing
- RAISE com errcodes mapeados pelo route handler

## Constraints / NAO fazer
- NAO permitir abertura sem janela aberta (AC #10 — apos 30d, 410 Gone com mensagem clara)
- NAO permitir 2 tickets abertos do mesmo kind (UNIQUE partial em support_tickets ja deve existir; AC bloqueia)
- NAO abrir rework se ha disputa aberta (AC #11)
- NAO abrir disputa se ha rework recem-aberto sem prazo? — rework pode escalar para disputa via US-026; aqui abrir dispute esta liberado
- NAO duplicar logica em 2 route handlers — mesmo helper `openTicket`

## Convencoes
- Idempotency-Key obrigatoria (`{kind}-{sr_id}-{ts}`)
- Evidencias `evidence_paths` referenciam paths em `dispute_evidences` bucket privado (T-147 cobre)
- Reuso: `mapRpcError`, `createClient`, `support_tickets` schema (T-147)
- Status inicial do ticket: `kind='rework'` -> `pending_provider_acceptance`; `kind='dispute'` -> `pending_admin_review`
$desc$,
 'API', 'CLIENTE', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-326 (API: emit.serviceCompleted + emit.ratingReceived hotspots)
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-326', 'Adicionar emit.serviceCompleted + emit.ratingReceived em src/lib/notifications/emit.ts',
 $desc$## Objetivo
Adicionar 2 helpers em `src/lib/notifications/emit.ts` (pattern T-164): `serviceCompleted(serviceId)` e `ratingReceived(serviceId)`. O primeiro e disparado pelo trigger FSM (T-227) na transicao `in_progress -> completed` e cumpre 2 efeitos: (a) enfileira notification ao CLIENTE (recibo + assinatura por canal externo, AC #2), (b) chama Edge Function `generate-service-receipt` (T-322) com kind='completed'. O segundo e chamado pelo route handler T-321 e enfileira notification ao PRESTADOR ("Voce recebeu uma nova avaliacao", AC #5).

## Contexto
Modulo NOTIFICACAO (estendido para EXECUCAO). Padrao identico a T-317 (`emit.providerEnRoute/providerArrived`) e T-183 (`emit.messageNew`). Uses `enqueue_notification_event` (T-162) com `event_key` deterministico para idempotencia. Templates novos (T-216 — versionados): `service_completed_client`, `rating_received_provider`. Emit e fire-and-forget — nunca falha a transicao.

## Estado atual / O que substitui
Nao existe. T-164 cobre os hotspots iniciais; aqui adicionamos especificos do USecase.

## O que criar

### `src/lib/notifications/emit.ts` (extensao)
```typescript
import { createAdminClient } from '@/lib/supabase/admin';
const admin = createAdminClient();

export const emit = {
  // ... existentes (serviceAccepted, providerEnRoute, providerArrived, messageNew, ...)

  /**
   * Disparado pelo trigger FSM (T-227) na transicao in_progress -> completed.
   * Efeito: (1) enqueue notification CLIENTE com recibo + assinatura,
   *         (2) chama Edge Function generate-service-receipt (T-322).
   * Idempotency-key: completed-{sr_id}.
   */
  async serviceCompleted(serviceId: string) {
    await admin.rpc('enqueue_notification_event', {
      p_event_key:    `completed-${serviceId}`,
      p_template_key: 'service_completed_client',
      p_audience:     'client',
      p_subject_id:   serviceId,
      p_payload:      { service_request_id: serviceId },
    });
    // Gera recibo (idempotente em T-322)
    void admin.functions.invoke('generate-service-receipt', {
      body: { service_request_id: serviceId, kind: 'completed' }
    }).catch(() => {}); // fire-and-forget
  },

  /**
   * Disparado pelo route handler T-321 apos rating registrado.
   * Efeito: enqueue notification PRESTADOR ("nova avaliacao recebida").
   * Idempotency-key: rating-{sr_id} (RPC ja idempotente; isso evita re-enqueue).
   */
  async ratingReceived(serviceId: string) {
    await admin.rpc('enqueue_notification_event', {
      p_event_key:    `rating-${serviceId}`,
      p_template_key: 'rating_received_provider',
      p_audience:     'provider',
      p_subject_id:   serviceId,
      p_payload:      { service_request_id: serviceId },
    });
  },
};
```

### Trigger gancho em service_requests (T-227 ja existe; estender com hook)
```sql
-- Opcional: gancho via NOTIFY ou via servico que polla; preferimos chamar
-- emit.serviceCompleted no proximo step (apos transicao bem-sucedida)
-- diretamente do RPC `transition_service_status` (T-235), via PERFORM net.http_post
-- ou via fila pg_cron que checa transicoes e dispara emit.
-- Aqui: T-235 ja tem audit em service_events; adicionamos hook no caller TS
-- (route handler T-278/T-276) que chamou transition.
```

### Templates seedados (`notification_templates` T-216)
- `service_completed_client` (push + email + whatsapp): "Servico concluido. Recibo no app." (link pra detalhe)
- `rating_received_provider` (push): "Voce recebeu nova avaliacao."

## Constraints / NAO fazer
- NAO acoplar geracao de PDF a transicao (Edge Function async; aqui so disparamos)
- NAO chamar push direto (HTTP) — sempre via fila T-162 (consumer T-163)
- NAO disparar 2x (idempotency keys estaveis: completed-{id}, rating-{id})
- NAO incluir CPF/dados financeiros do recibo no payload (template usa so `service_request_id`)
- NAO usar `service_role` no client (`emit.ts` e server-only)

## Convencoes
- Padrao: `emit.<event>` + `enqueue_notification_event` + idempotency_key estavel
- Reuso: `getAdminClient`, `enqueue_notification_event` (T-162), Edge Function generate-service-receipt (T-322)
- Templates pre-aprovados via T-216 (versionamento + status)
$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-327 (UI: /(client)/services/history — lista cronologica + filtros + infinite scroll)
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-327', 'Renderizar /(client)/services/history (lista + filtros periodo/categoria + infinite scroll)',
 $desc$## Objetivo
Tela CLIENTE de historico de servicos com listagem cronologica (mais recente primeiro), filtros por periodo (`30d`/`90d`/`all`) e categoria (chips), badges de status (`Concluido`/`Cancelado`/`Em disputa`/`Em retrabalho`/`Em andamento`), infinite scroll, skeleton de carregamento e estado vazio. Cobre AC #8 (historico cronologico completo + filtros) e AC #4 parcial (cards com indicador "avaliar pendente" em destaque).

## Contexto
Modulo EXECUCAO. Consome T-323 (`GET /api/client/services/history`). Cada card navega para T-328 (detalhe). Cards com `has_pending_rating=true` recebem badge "Avaliar" amarelo + CTA inline pra abrir RatingSheet (T-329). `useOptimisticCollection` com `external_update` para integrar resultado de submission de rating sem refetch.

## Estado atual / O que substitui
Nao existe. T-134 e a versao PRESTADOR; aqui criamos versao CLIENTE.

## O que criar

### `src/app/(client)/services/history/page.tsx`
```tsx
// Server Component bootstrap + client child
import { createClient } from '@/lib/supabase/server';
import { ClientHistoryView } from './client-view';

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ period?: string; category?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const url = new URL(`/api/client/services/history?period=${sp.period ?? '90d'}${sp.category ? `&category=${sp.category}` : ''}`, process.env.NEXT_PUBLIC_BASE_URL!);
  // OU consumir VIEW direto via supabase client server (sem http)
  const initial = await supabase
    .from('client_service_history_v')
    .select('*')
    .order('scheduled_for', { ascending: false })
    .limit(20);
  return <ClientHistoryView initialItems={initial.data ?? []} initialPeriod={sp.period ?? '90d'} initialCategory={sp.category} />;
}
```

### `src/app/(client)/services/history/client-view.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { Card, Badge, Skeleton, Button } from '@/components/ui';
// ...
// Filtros chips (period, category)
// Lista de cards com status chip (StatusChip) + valor + data
// Infinite scroll via IntersectionObserver no ultimo item
// Empty state: "Nenhum servico realizado ainda"
// Cards com has_pending_rating: badge amarela "Avaliar" + onClick abre RatingSheet
```

### `src/components/client-history/ServiceHistoryCard.tsx`
```tsx
// Reutiliza Card, Badge, StatusChip
// Props: { item: ServiceHistoryRow, onRate?: () => void }
// Tap navega para /services/{id}
// has_pending_rating: badge amarelo + botao "Avaliar agora"
// has_open_dispute: StatusChip vermelho "Em disputa"
```

## Constraints / NAO fazer
- NAO usar Dialog ou Sheet cru (AC visual: nao aplicavel; mas convencao do projeto)
- NAO disparar refetch full apos avaliacao — usar `external_update` em useOptimisticCollection (substitui flag has_pending_rating)
- NAO mostrar valores como `total_amount_cents/100` sem formatador — usar `formatBRL` lib utilitaria
- NAO carregar mais de 20 itens iniciais (paginar)
- NAO mostrar provider_name aqui (lista nao precisa — UI escolheu agregar info no detalhe)

## Convencoes
- Reuso: `Card`, `Badge`, `StatusChip`, `Skeleton`, `Button`, `useOptimisticCollection`, `useIsMobile`
- Mobile-first: lista vertical em mobile; em desktop pode ter grid 2 cols (max-w-3xl)
- Infinite scroll via `IntersectionObserver` no ultimo card
- Filtros como chips clicaveis (period chips: "30d"/"90d"/"Tudo"; category chips dinamicos baseados em `service_categories` table)
- StatusChip cor por status (config em `src/lib/status-chips.ts`)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','OPTIMISTIC_UPDATE','INFINITE_SCROLL','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-328 (UI: /(client)/services/[id] — detalhe completo + breakdown + acoes 30d + variantes)
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-328', 'Renderizar /(client)/services/[id] detalhe (breakdown + acoes 30d + variantes disputa/cancelado)',
 $desc$## Objetivo
Tela CLIENTE de detalhe do servico (completed/cancelled/in_dispute/in_rework). Mostra: status badge, snapshot do prestador (nome, foto, badge, rating), datas, breakdown financeiro (`total`, `travel_fee`, `platform_fee`, `materials`), rating ja submetida (se houver), botao "Baixar comprovante" (signed URL T-324), e — quando dentro de garantia (30d) — botoes "Solicitar retrabalho" e "Abrir disputa". Variantes:
- **Em disputa** (`has_open_dispute=true`): badge "Em disputa" vermelho, botao recibo desabilitado com tooltip, botao retrabalho oculto. (AC #11)
- **Cancelado** (`service_status='cancelled'`): mostra motivo, politica aplicada, valor reembolsado, prazo, link para "Comprovante de cancelamento" (T-320 kind='cancelled'). (AC #12)
- **Pos 30d**: botoes retrabalho/disputa somem; tooltip explicativo "Janela de 30 dias encerrada em {data}". (AC #10)

## Contexto
Modulo EXECUCAO. Consome T-324 (`GET /api/client/services/[id]`). Acoes que mutam: `Solicitar retrabalho` -> chama T-325 com `ConfirmDialog`; `Abrir disputa` -> abre `OpenDisputeSheet` (form com descricao + evidencias) e chama T-325. Cobre AC #9 (breakdown + PDF), AC #10, AC #11, AC #12.

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/app/(client)/services/[id]/page.tsx`
```tsx
// Server Component
import { createClient } from '@/lib/supabase/server';
import { ServiceDetailView } from './detail-view';

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/client/services/${id}`,
    { headers: { Cookie: ... }, cache: 'no-store' });
  if (!res.ok) notFound();
  const data = await res.json();
  return <ServiceDetailView data={data} />;
}
```

### `src/app/(client)/services/[id]/detail-view.tsx`
```tsx
'use client';
// Renderiza:
// - HeaderSection (StatusChip + scheduled_for)
// - ProviderCard (display_name, avatar, badge, rating)
// - FinancialBreakdownTable (total/travel/platform/materials) com formato BRL
// - RatingSection: se ja avaliou, mostra estrelas + comentario; senao botao "Avaliar"
//   abre T-329 RatingSheet
// - ReceiptSection: botao "Baixar comprovante" usa signed_url; bloqueado se has_open_dispute
//   (com tooltip "Disponivel apos resolucao da disputa")
// - ActionsSection (30d gate):
//   - within_warranty_window=true: botoes [Solicitar retrabalho] [Abrir disputa]
//     - Retrabalho: ConfirmDialog "Confirmar retrabalho?" -> POST T-325 /report-rework
//     - Disputa: abre OpenDisputeSheet (form com descricao + evidencias upload)
//   - within_warranty_window=false: tooltip "Janela de 30 dias encerrada em {warranty_until}"
//   - has_open_dispute=true: section Status disputa "Em analise pela equipe"
// - VariantSection (se cancelled): motivo + politica + valor reembolsado + prazo + link comprovante
```

### `src/components/client-service-detail/OpenDisputeSheet.tsx`
```tsx
// ResponsiveSheet size="md"
// Field compound API: textarea descricao (min 20 chars) + uploader fotos (max 10)
// Submit: POST /api/services/[id]/open-dispute com idempotency-key
// Sucesso: Sonner.success "Disputa aberta. Resposta em ate 24h." + close + refetch
```

## Constraints / NAO fazer
- NAO usar Dialog cru (sempre ResponsiveDialog/ResponsiveSheet)
- NAO usar window.confirm (sempre ConfirmDialog)
- NAO mostrar botao recibo se has_open_dispute (AC #11)
- NAO mostrar botoes retrabalho/disputa apos 30d (AC #10)
- NAO recalcular janela no client (`can_request_rework`/`can_open_dispute` vem do server T-324)
- NAO permitir abrir disputa sem evidencia/descricao minima (Zod no servidor + validation client side soft)

## Convencoes
- Reuso: `Card`, `Badge`, `StatusChip`, `Button`, `ResponsiveSheet`, `ConfirmDialog`, `Field`/`FormBody`, `Sonner`
- Reuso hook: `useOptimisticCollection` para acoes (rating/rework/dispute)
- Mobile-first; sticky CTA bottom nas acoes em mobile
- Formatador BRL (`Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'})`)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-329 (UI: RatingSheet + PendingRatingBanner — submeter avaliacao + destaque na home)
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-329', 'Renderizar RatingSheet + PendingRatingBanner (avaliacao opcional + destaque)',
 $desc$## Objetivo
Dois componentes reutilizaveis:
1. **RatingSheet** (`ResponsiveSheet` size="sm"): seletor 1-5 estrelas (componente custom — botoes radio acessiveis), textarea opcional (max 1000 chars), CTA "Enviar avaliacao". Submit: POST T-321 com idempotency-key estavel `rating-{sr_id}`. Sucesso: Sonner.success + close. Duplicata: Sonner.info "Voce ja avaliou este servico". Cobre AC #3 e AC #6.
2. **PendingRatingBanner**: banner persistente na home do CLIENTE (acima da lista de "servicos em andamento" se houver, senao topo). Consome T-323 `/pending-rating`, mostra ate 3 itens com priorizacao na mais recente (AC #4); cada item -> CTA inline "Avaliar agora" abre RatingSheet. Cobre AC #4.

## Contexto
Modulo EXECUCAO. RatingSheet e usado em 3 entradas: (a) banner T-329 (PendingRatingBanner), (b) card "Avaliar" no historico T-327, (c) tela detalhe T-328. Todos usam o mesmo componente — drift evita reimplementar logica. PendingRatingBanner mora em `(client)/page.tsx` (home cliente — ja existe stub T-058 que precisa ser estendido).

## Estado atual / O que substitui
Nao existe. T-058 e home cliente placeholder; este task adiciona PendingRatingBanner naquela home.

## O que criar

### `src/components/client-rating/RatingSheet.tsx`
```tsx
'use client';
import { useState } from 'react';
import { ResponsiveSheet, ResponsiveSheetHeader, ResponsiveSheetBody, ResponsiveSheetFooter } from '@/components/ui/responsive-sheet';
import { Field, FormBody, Textarea, Button } from '@/components/ui';
import { showErrorToast } from '@/lib/optimistic/toast';
import { toast } from 'sonner';

export function RatingSheet({ open, onOpenChange, serviceId, onRated }: {
  open: boolean; onOpenChange: (v:boolean)=>void;
  serviceId: string; onRated?: ()=>void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (stars < 1) return; // disabled
    setBusy(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/rating`, {
        method: 'POST',
        headers: { 'content-type':'application/json', 'idempotency-key': `rating-${serviceId}` },
        body: JSON.stringify({ stars, comment: comment.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'rating_failed');
      if (json.idempotent) {
        toast.info('Voce ja avaliou este servico.');
      } else {
        toast.success('Avaliacao registrada. Obrigado!');
      }
      onRated?.();
      onOpenChange(false);
    } catch (e) { showErrorToast({type:'create'}, e); }
    finally { setBusy(false); }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} size="sm">
      <ResponsiveSheetHeader>Como foi o servico?</ResponsiveSheetHeader>
      <ResponsiveSheetBody>
        <FormBody density="comfortable">
          <Field name="stars" required>
            <Field.Label>Sua nota</Field.Label>
            <Field.Control>
              <StarSelector value={stars} onChange={setStars} aria-label="De 1 a 5 estrelas" />
            </Field.Control>
          </Field>
          <Field name="comment">
            <Field.Label>Comentario (opcional)</Field.Label>
            <Field.Control>
              <Textarea maxLength={1000} value={comment} onChange={(e)=>setComment(e.target.value)} />
            </Field.Control>
            <Field.Hint>Max. 1000 caracteres.</Field.Hint>
          </Field>
        </FormBody>
      </ResponsiveSheetBody>
      <ResponsiveSheetFooter>
        <Button variant="ghost" onClick={()=>onOpenChange(false)} disabled={busy}>Agora nao</Button>
        <Button onClick={submit} disabled={busy || stars<1}>Enviar</Button>
      </ResponsiveSheetFooter>
    </ResponsiveSheet>
  );
}
```

### `src/components/client-rating/StarSelector.tsx`
```tsx
// 5 botoes radio acessiveis (role="radio") com estado highlight on hover
// Suporta keyboard (arrow left/right) e touch
```

### `src/components/client-rating/PendingRatingBanner.tsx`
```tsx
'use client';
// Fetch /api/client/services/pending-rating no mount
// Render: ate 3 itens em carousel horizontal mobile (1.2 cards visiveis); 3 cards em desktop
// Cada item -> botao "Avaliar agora" -> abre RatingSheet com serviceId
// Apos rated: remove item da lista (useOptimisticCollection delete)
// Empty: nao renderiza (banner fica oculto)
```

### Integrar em `src/app/(client)/page.tsx` (T-058 estendido)
- No topo: `<PendingRatingBanner />` (acima das demais secoes)
- Server-fetch lista no Server Component, hydrate no client

## Constraints / NAO fazer
- NAO usar `<Dialog>` cru
- NAO usar `react-hook-form` ou validacao Zod no client (Zod so no servidor T-321)
- NAO permitir submit com stars=0 (disabled)
- NAO mostrar erro generico em duplicata (`json.idempotent=true` -> Sonner.info, nao error)
- NAO recarregar a pagina apos submission — chamar `onRated` callback que faz update otimista no parent

## Convencoes
- Reuso: `ResponsiveSheet`, `Field`/`FormBody`, `Textarea`, `Button`, `Sonner`, `showErrorToast`, `useOptimisticCollection` (no banner)
- Idempotency-Key estavel `rating-{sr_id}` — qualquer retry e mesmo
- Mobile-first; bottom-sheet auto em <768px
- StarSelector: minimum tap target 44px
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST','A11Y_REVIEW'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-330 (UI: ServiceCancelledDetail + InDisputeBadge variants — embutidos em T-328)
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-330', 'Renderizar ServiceCancelledDetail + InDisputeBadge (variantes do detalhe)',
 $desc$## Objetivo
Dois componentes especializados consumidos pelo detalhe do servico (T-328):
1. **ServiceCancelledDetail**: bloco que substitui ActionsSection quando `service_status='cancelled'`. Mostra motivo (cancel_reason), politica aplicada (lookup `app_config.cancellation_policy[reason]`), valor reembolsado em BRL, prazo de reembolso (texto: "Em ate 5 dias uteis no metodo de pagamento original"), e link "Baixar comprovante de cancelamento" (signed URL T-320 kind='cancelled'). Cobre AC #12.
2. **InDisputeBadge**: chip vermelho com texto "Em disputa - resposta em ate 24h", visivel no header e topo do detalhe quando `has_open_dispute=true`. Cobre AC #11.

## Contexto
Modulo EXECUCAO. Componentes consumidos por T-328 (detail-view). Existe ja convencao `StatusChip` para variantes de status — InDisputeBadge usa StatusChip com variant=destructive. ServiceCancelledDetail nao depende ainda de US-015 (cancellation completo) — usa snapshot do que ja existe em `service_requests` (cancel_reason, cancel_actor) + `service_receipts` (kind='cancelled').

## Estado atual / O que substitui
Nao existe.

## O que criar

### `src/components/client-service-detail/ServiceCancelledDetail.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  service: {
    cancelled_at: string;
    cancel_reason: string;
    cancel_actor: 'CLIENTE' | 'PRESTADOR' | 'SISTEMA' | 'ADMIN';
    total_amount_cents: number;
    // valores derivados pelo endpoint T-324 (extends future US-015 service_cancellations)
    refund_amount_cents?: number;
    refund_eta_text?: string;
    cancel_policy_text?: string;
  };
  receipts: Array<{ kind: string; signed_url: string | null }>;
}

export function ServiceCancelledDetail({ service, receipts }: Props) {
  const cancelledReceipt = receipts.find(r => r.kind === 'cancelled');
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">Servico cancelado</h3>
      <p className="text-sm">Motivo: {humanizeReason(service.cancel_reason)}</p>
      <p className="text-sm">Politica: {service.cancel_policy_text ?? '—'}</p>
      <p className="text-sm">Reembolso: <strong>{formatBRL(service.refund_amount_cents ?? 0)}</strong></p>
      <p className="text-xs text-muted-foreground">{service.refund_eta_text ?? 'Em ate 5 dias uteis no metodo de pagamento original.'}</p>
      {cancelledReceipt?.signed_url && (
        <Button asChild variant="outline" size="sm">
          <a href={cancelledReceipt.signed_url} target="_blank" rel="noopener">Baixar comprovante de cancelamento</a>
        </Button>
      )}
    </Card>
  );
}
```

### `src/components/client-service-detail/InDisputeBadge.tsx`
```tsx
import { StatusChip } from '@/components/ui/status-chip';

export function InDisputeBadge() {
  return <StatusChip variant="destructive" label="Em disputa" sublabel="Resposta em ate 24h" />;
}
```

## Constraints / NAO fazer
- NAO usar `<a>` cru sem `<Button asChild>` (consistencia visual)
- NAO mostrar `cancel_actor` cru (humanizar via tabela: CLIENTE -> "Voce", PRESTADOR -> "O prestador", etc.)
- NAO mostrar valores em centavos (sempre formatBRL)
- NAO renderizar quando `service_status != 'cancelled'` (parent T-328 controla)
- NAO assumir que `refund_amount_cents` existe (US-015 ainda nao implementado — tratar undefined gracefully)

## Convencoes
- Reuso: `Card`, `Button`, `StatusChip` (com variant destructive)
- Texts pt-BR fixos (sem i18n)
- Mobile-first; cards stackam em mobile
- AC #12 explicita "comprovante de cancelamento separado" — se `signed_url` ausente, esconder botao (servico cancelado sem pagamento processado nao tem comprovante)
$desc$,
 'UI', 'CLIENTE', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-331 (OPS: seedar app_config rating/warranty windows + bucket service-receipts + templates)
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '858fd44d-4f0c-4ea3-8742-075b83dfeba7',
 'ZLAR-V2-T-331', 'Seedar app_config service_lifecycle (rating/warranty days) + bucket + templates',
 $desc$## Objetivo
Configurar parametros operacionais consumidos por T-318/T-319/T-321/T-322:
1. Adicionar/atualizar entrada `app_config` `service_lifecycle` com `rating_window_days` (default 30) e `warranty_window_days` (default 30). Cobre AC #7 (avaliar antigo enquanto janela aberta) e AC #10 (botoes 30d).
2. Provisionar bucket privado `service-receipts` (config Storage).
3. Seedar 2 templates novos em `notification_templates` (T-216): `service_completed_client` (push+email+whatsapp) e `rating_received_provider` (push). Necessarios para T-326.

## Contexto
Modulo ADMIN/OPS. `app_config` ja existe (T-215). Bucket criado via Supabase Dashboard ou storage migration. Templates seedados via INSERT idempotente em `notification_templates` (T-216).

## Estado atual / O que substitui
- `app_config.service_lifecycle` ja foi seedado em T-237 (`aceite tacito, escrow 70/30, garantia, stale`); aqui apenas garantimos que tem `rating_window_days` e `warranty_window_days`.
- Bucket `service-receipts` nao existe.
- Templates `service_completed_client`/`rating_received_provider` nao existem.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_us013_ops.sql`
```sql
BEGIN;

-- 1. app_config: garantir keys de janela
UPDATE app_config
   SET value = jsonb_set(
     jsonb_set(value, '{rating_window_days}',   to_jsonb(30), true),
     '{warranty_window_days}', to_jsonb(30), true
   )
WHERE key = 'service_lifecycle';

-- Se nao existe ainda (defensivo)
INSERT INTO app_config (key, value, description, section)
SELECT 'service_lifecycle',
  '{"rating_window_days":30,"warranty_window_days":30,"acceptance_tacit_hours":48,"escrow_release_hours":72}'::jsonb,
  'Janelas e prazos do ciclo de vida do servico',
  'lifecycle'
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'service_lifecycle');

-- 2. Templates
INSERT INTO notification_templates (key, channel, subject, body, status, version, audience)
VALUES
  ('service_completed_client', 'push',
   'Servico concluido',
   'Seu servico foi finalizado. O recibo esta disponivel no app.',
   'active', 1, 'client'),
  ('service_completed_client', 'email',
   'Recibo do servico {{service_title}}',
   'Ola {{client_name}}, seu servico foi concluido em {{completed_at}}. Veja o recibo: {{receipt_link}}',
   'active', 1, 'client'),
  ('service_completed_client', 'whatsapp',
   NULL,
   'Servico concluido. Recibo no app: {{receipt_link}}',
   'active', 1, 'client'),
  ('rating_received_provider', 'push',
   'Nova avaliacao',
   'Voce recebeu uma nova avaliacao. Veja em seu perfil.',
   'active', 1, 'provider')
ON CONFLICT (key, channel) DO NOTHING;

COMMIT;
```

### Bucket `service-receipts`
- Criar via Supabase Dashboard: Storage > New bucket > `service-receipts` > Private
- Policy de Storage: bloqueia public/anon; INSERT/SELECT permitido apenas para `service_role`
- Documentar no runbook OPS

### Pg_cron (opcional, futuro)
- Job `cleanup_old_receipts_logs` (diario) limpa logs > 1 ano (auditoria fiscal cumprida em outra tabela)

## Constraints / NAO fazer
- NAO mudar `rating_window_days` sem trigger registrar `app_config_history` (T-215 ja faz audit)
- NAO seedar templates como `draft` (devem ja sair `active=true` apos seed)
- NAO permitir bucket public (recibos contem dados pessoais — strict private)
- NAO usar mesmas chaves de `notification_templates` em diferentes audiences (cada audience tem template separado)

## Convencoes
- `app_config` keys em snake_case
- Templates seguem padrao versionamento T-216 (key+channel UNIQUE; nova versao = INSERT com `status='active'`, antiga vira `status='deprecated'`)
- Bucket privado igual padrao service-photos / signatures / service-materials
- Migration aplicada via psql; database.types.ts regenerado
$desc$,
 'OPS', NULL, ARRAY['NO_RLS_NEEDED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. TaskAcceptanceCriterion (vinculo task -> AC-da-Story desta US)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-318 service_ratings cobre AC #3 (avaliacao opcional), #5 (registrada perfil), #6 (nao 2x), #7 (janela)
  ('c9f39923-469f-4b06-b5e6-df85074df5c0'::uuid, 3),
  ('c9f39923-469f-4b06-b5e6-df85074df5c0'::uuid, 5),
  ('c9f39923-469f-4b06-b5e6-df85074df5c0'::uuid, 6),
  ('c9f39923-469f-4b06-b5e6-df85074df5c0'::uuid, 7),

  -- T-319 client_service_history_v cobre AC #4 (pendente em destaque), #8 (cronologico+filtros)
  ('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3'::uuid, 4),
  ('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3'::uuid, 8),

  -- T-320 service_receipts cobre AC #2 (recibo), #9 (PDF download), #11 (bloqueio dispute), #12 (comprovante cancel)
  ('ef2075d7-885c-4885-b27f-f17212845b71'::uuid, 2),
  ('ef2075d7-885c-4885-b27f-f17212845b71'::uuid, 9),
  ('ef2075d7-885c-4885-b27f-f17212845b71'::uuid, 11),
  ('ef2075d7-885c-4885-b27f-f17212845b71'::uuid, 12),

  -- T-321 RPC submit_service_rating cobre AC #3, #5, #6, #7
  ('4262bc59-b6a8-4dad-ba39-32201ce14f98'::uuid, 3),
  ('4262bc59-b6a8-4dad-ba39-32201ce14f98'::uuid, 5),
  ('4262bc59-b6a8-4dad-ba39-32201ce14f98'::uuid, 6),
  ('4262bc59-b6a8-4dad-ba39-32201ce14f98'::uuid, 7),

  -- T-322 generate-service-receipt cobre AC #2 (recibo gerado+canal), #9 (PDF), #11 (bloqueio), #12 (cancel)
  ('d14dc0dc-373b-4cde-b972-2c1db3e03a2a'::uuid, 2),
  ('d14dc0dc-373b-4cde-b972-2c1db3e03a2a'::uuid, 9),
  ('d14dc0dc-373b-4cde-b972-2c1db3e03a2a'::uuid, 11),
  ('d14dc0dc-373b-4cde-b972-2c1db3e03a2a'::uuid, 12),

  -- T-323 endpoints history+pending-rating cobre AC #4 (pendente destaque), #8 (historico+filtros)
  ('43a40429-3982-4413-972e-95285540b14c'::uuid, 4),
  ('43a40429-3982-4413-972e-95285540b14c'::uuid, 8),

  -- T-324 endpoint detalhe cobre AC #9 (breakdown+PDF), #10 (botoes 30d via can_*), #11 (bloqueio), #12 (cancel data)
  ('f1e1695c-bab9-4eb0-bf31-a07dc150b000'::uuid, 9),
  ('f1e1695c-bab9-4eb0-bf31-a07dc150b000'::uuid, 10),
  ('f1e1695c-bab9-4eb0-bf31-a07dc150b000'::uuid, 11),
  ('f1e1695c-bab9-4eb0-bf31-a07dc150b000'::uuid, 12),

  -- T-325 report-rework / open-dispute cobre AC #10 (botoes 30d), #11 (rework bloqueado em disputa)
  ('b54a3861-79d6-4c9a-aec4-c1574eb69342'::uuid, 10),
  ('b54a3861-79d6-4c9a-aec4-c1574eb69342'::uuid, 11),

  -- T-326 emit hotspots cobre AC #2 (recibo canal externo), #5 (notif prestador rating)
  ('71ad3d4f-c1cc-4119-83ec-08657ac71d31'::uuid, 2),
  ('71ad3d4f-c1cc-4119-83ec-08657ac71d31'::uuid, 5),

  -- T-327 history UI cobre AC #4 (banner avaliar pendente em listagem), #7 (ver antigo), #8 (cronologico+filtros)
  ('592f0c63-d78d-4bfe-af76-531b872f7c51'::uuid, 4),
  ('592f0c63-d78d-4bfe-af76-531b872f7c51'::uuid, 7),
  ('592f0c63-d78d-4bfe-af76-531b872f7c51'::uuid, 8),

  -- T-328 detail UI cobre AC #9 (breakdown+PDF), #10 (botoes 30d), #11 (variante disputa), #12 (variante cancel)
  ('3164502c-9081-421f-8f20-5cdfe8be9ceb'::uuid, 9),
  ('3164502c-9081-421f-8f20-5cdfe8be9ceb'::uuid, 10),
  ('3164502c-9081-421f-8f20-5cdfe8be9ceb'::uuid, 11),
  ('3164502c-9081-421f-8f20-5cdfe8be9ceb'::uuid, 12),

  -- T-329 RatingSheet + PendingRatingBanner cobre AC #3 (avaliar opcional), #4 (banner destaque), #5 (UI submit dispara notif provider), #6 (msg duplicata), #7 (ver antigo)
  ('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2'::uuid, 3),
  ('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2'::uuid, 4),
  ('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2'::uuid, 5),
  ('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2'::uuid, 6),
  ('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2'::uuid, 7),

  -- T-330 ServiceCancelledDetail + InDisputeBadge cobre AC #11 (badge disputa), #12 (motivo+politica+reembolso+comprovante)
  ('53c19569-ca26-4cb2-ac94-9ce231083dad'::uuid, 11),
  ('53c19569-ca26-4cb2-ac94-9ce231083dad'::uuid, 12),

  -- T-331 OPS app_config cobre AC #7 (janela parametrizada), #10 (warranty_window_days)
  ('5d939fc4-114b-4280-9b7f-d808fc981d90'::uuid, 7),
  ('5d939fc4-114b-4280-9b7f-d808fc981d90'::uuid, 10)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
 AND ac."order" = v.ac_order;


-- ============================================================================
-- 2.5 TaskAcceptanceCriterion (CROSS-US: liga tasks reusadas a AC desta US)
-- ============================================================================
-- Reuso forcado: tasks de outras US cobrem AC desta story sem duplicar.

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- AC #1 assinatura digital -> ja coberta por US-005 (T-273 service_signatures + T-278 record_signature RPC + T-284 UI)
  ('ZLAR-V2-T-273', 1),
  ('ZLAR-V2-T-278', 1),
  ('ZLAR-V2-T-284', 1),

  -- AC #2 confirmacao por canais externos -> tambem coberto por T-162 enqueue + T-163 dispatch + T-171 comms
  ('ZLAR-V2-T-162', 2),
  ('ZLAR-V2-T-163', 2),
  ('ZLAR-V2-T-171', 2),

  -- AC #5 prestador notificado da nova avaliacao -> reuso T-164 hotspots (mas T-326 estende — ja vinculado acima)
  ('ZLAR-V2-T-164', 5),

  -- AC #10 retrabalho/disputa apos botao -> ja coberto pelo fluxo admin US-026
  ('ZLAR-V2-T-150', 10),
  ('ZLAR-V2-T-153', 10),
  ('ZLAR-V2-T-147', 10),

  -- AC #11 disputa ativa -> reuso DATA support_tickets/dispute_evidences (T-147)
  ('ZLAR-V2-T-147', 11),

  -- Coverage fix: AC #2 confirmacao canais externos -> T-327 (history mostra link recibo) + T-328 (detail mostra recibo)
  ('ZLAR-V2-T-327', 2),
  ('ZLAR-V2-T-328', 2)
) v(task_ref, ac_order)
JOIN "Task" t ON t.reference = v.task_ref
JOIN "UserStory" us ON us.reference = 'ZLAR-V2-US-013'
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = us.id
 AND ac."order" = v.ac_order
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 3. AcceptanceCriterion (taskId) — checklist tecnico (checkbox no TaskSheet)
-- ============================================================================

INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES

-- T-318 service_ratings DATA
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'Tabela service_ratings criada com UNIQUE(service_request_id) e CHECK(stars BETWEEN 1 AND 5)', 1),
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'RLS: CLIENTE le so seus, PRESTADOR le so recebidas, ADMIN le tudo (smoke test via SET ROLE)', 2),
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'INSERT permitido apenas com auth.uid()=client_id', 3),
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'UPDATE/DELETE bloqueados por RLS para nao-admin (append-only)', 4),
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'Indices service_ratings_provider_idx e service_ratings_client_idx criados', 5),
('c9f39923-469f-4b06-b5e6-df85074df5c0', 'Smoke: 2o INSERT com mesmo service_request_id retorna violation 23505', 6),

-- T-319 client_service_history_v DATA
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'VIEW client_service_history_v criada com security_invoker=true', 1),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'Cliente A nao ve servicos do cliente B (smoke: SELECT * com cliente A vs B)', 2),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'Flags has_pending_rating, within_warranty_window, has_open_dispute, has_open_rework calculadas corretamente', 3),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'Indices sr_client_completed_idx e sr_client_status_idx criados em service_requests', 4),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'GRANT SELECT pra authenticated; REVOKE de public/anon', 5),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'Smoke: rating_window_days=30 -> servico ha 31d tem has_pending_rating=false', 6),

-- T-320 service_receipts + bucket DATA
('ef2075d7-885c-4885-b27f-f17212845b71', 'Migration aplicada via psql; database.types.ts regenerado', 0),
('ef2075d7-885c-4885-b27f-f17212845b71', 'Enum service_receipt_kind criado (completed, cancelled)', 1),
('ef2075d7-885c-4885-b27f-f17212845b71', 'Tabela service_receipts criada com UNIQUE(service_request_id, kind)', 2),
('ef2075d7-885c-4885-b27f-f17212845b71', 'Bucket privado service-receipts provisionado (Dashboard Supabase)', 3),
('ef2075d7-885c-4885-b27f-f17212845b71', 'RLS: CLIENTE/PRESTADOR le so seus; ADMIN le tudo; INSERT/UPDATE/DELETE bloqueados pra nao-admin', 4),
('ef2075d7-885c-4885-b27f-f17212845b71', 'content_sha256 nao-NULL e validado por CHECK (length=64)', 5),
('ef2075d7-885c-4885-b27f-f17212845b71', 'Smoke: 2o INSERT mesmo (sr_id, kind) retorna 23505', 6),

-- T-321 POST rating API
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'Endpoint valida body com Zod (400 em formato invalido: stars fora 1..5, comment >1000)', 0),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'Idempotency-Key obrigatoria (400 sem header)', 1),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'RPC submit_service_rating criada com SECURITY DEFINER e GRANT authenticated', 2),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'Mesmo SR avaliado 2x retorna {idempotent:true} (200, sem 409)', 3),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', '403 quando auth.uid() != client_id (mapping de 42501)', 4),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', '409 quando service_status != completed', 5),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', '410 (Gone) quando rating_window_days vencido', 6),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'Apos sucesso (nao-idempotent), emit.ratingReceived chamado fire-and-forget', 7),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'Logs estruturados (entity=service, action=rating_submitted)', 8),

-- T-322 Edge Function generate-service-receipt
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Edge Function deployed via supabase functions deploy', 0),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Idempotente: 2a chamada para mesmo (sr_id, kind) retorna {idempotent:true}', 1),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Bloqueio: kind=completed e support_ticket dispute aberto -> 409 dispute_open', 2),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'PDF gerado contem header, breakdown financeiro completo, e (kind=completed) embed da assinatura PNG', 3),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Upload no bucket service-receipts com path receipts/{sr_id}/{kind}-{ts}.pdf', 4),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Hash sha256 calculado e armazenado em content_sha256', 5),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'INSERT em service_receipts realizado com generated_by=system', 6),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Sem CPF/PIX/dados bancarios no PDF (apenas display_name + cidade)', 7),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'Smoke: emit.serviceCompleted dispara funcao e PDF aparece em <30s', 8),

-- T-323 endpoints history + pending-rating
('43a40429-3982-4413-972e-95285540b14c', 'Endpoint /api/client/services/history valida period e cursor com Zod', 0),
('43a40429-3982-4413-972e-95285540b14c', 'Paginacao por cursor temporal funciona (ultimo item nextCursor=scheduled_for)', 1),
('43a40429-3982-4413-972e-95285540b14c', 'Filtro period 30d/90d aplicado corretamente', 2),
('43a40429-3982-4413-972e-95285540b14c', 'Filtro category retorna apenas servicos da categoria', 3),
('43a40429-3982-4413-972e-95285540b14c', 'Cliente A nao ve servicos do cliente B (RLS via VIEW)', 4),
('43a40429-3982-4413-972e-95285540b14c', 'Endpoint /pending-rating retorna ate 5 itens com has_pending_rating=true ordenados por completed_at DESC', 5),
('43a40429-3982-4413-972e-95285540b14c', 'limit max 50 (DoS protection)', 6),

-- T-324 GET detail
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'Endpoint /api/client/services/[id] retorna 404 se nao existe ou nao e do cliente', 0),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'Provider snapshot retorna so display_name, avatar, badge, rating (sem PII)', 1),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'Signed URL do recibo gerada com TTL 300s', 2),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'has_open_dispute=true -> signed_url=null com blocked_reason=dispute_open', 3),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'can_request_rework derivado de within_warranty + sem dispute + sem rework + completed', 4),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'can_open_dispute derivado de within_warranty + sem dispute + completed', 5),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'Rating embutida (se houver) com stars + comment + rated_at', 6),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'Tickets abertos kind=dispute|rework listados em snapshot (id, status, createdAt)', 7),

-- T-325 report-rework / open-dispute
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'RPC open_service_ticket criada com SECURITY DEFINER + GRANT authenticated', 0),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'Endpoint /report-rework e /open-dispute valida body Zod (description min20-max2000, evidence_paths max10)', 1),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'Idempotency-Key obrigatoria; mesma key 2x nao duplica', 2),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', '410 Gone quando warranty_window_days vencido (AC #10)', 3),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', '409 quando ja existe ticket aberto do mesmo kind', 4),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'rework rejeitado se ha dispute aberto (AC #11)', 5),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', '403 quando auth.uid() != client_id (42501)', 6),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'INSERT em support_ticket_events feito (audit log imutavel)', 7),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'rework: status inicial pending_provider_acceptance; dispute: pending_admin_review', 8),

-- T-326 emit hotspots
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'emit.serviceCompleted e emit.ratingReceived adicionados em src/lib/notifications/emit.ts', 0),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'Idempotency keys estaveis: completed-{sr_id}, rating-{sr_id}', 1),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'serviceCompleted invoca generate-service-receipt fire-and-forget', 2),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'ratingReceived enfileira notification com template rating_received_provider', 3),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'Templates seedados em notification_templates (T-331)', 4),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'Hot spots chamados pelo route handler T-321 (ratingReceived) e RPC T-235 transition->completed (serviceCompleted)', 5),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'emit nunca quebra a request original (catch + ignore)', 6),

-- T-327 history UI
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Pagina /(client)/services/history criada (Server Component + client child)', 0),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Filtros chips period (30d/90d/Tudo) e category renderizam', 1),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Infinite scroll via IntersectionObserver no ultimo card', 2),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Skeleton durante carregamento; estado vazio com mensagem', 3),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Cards com has_pending_rating=true: badge "Avaliar" + CTA inline abre RatingSheet', 4),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'StatusChip cor por status (concluido/cancelado/disputa/retrabalho/em andamento)', 5),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Apos rating submetido, item perde badge sem refetch full (external_update)', 6),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Mobile-first verificado em viewport <768px', 7),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'Tap em card navega para /services/{id}', 8),

-- T-328 detail UI
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Pagina /(client)/services/[id] criada (Server Component + client child)', 0),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Header mostra StatusChip + scheduled_for', 1),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'ProviderCard mostra display_name, avatar, badge, rating (sem CPF/telefone)', 2),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'FinancialBreakdownTable formata BRL e mostra total/travel/platform/materials', 3),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Botao Baixar comprovante usa signed_url; bloqueado se has_open_dispute (tooltip explicativo)', 4),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Acoes 30d: dentro da janela mostra botoes retrabalho+disputa; fora some com tooltip', 5),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Solicitar retrabalho usa ConfirmDialog (sem window.confirm)', 6),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Abrir disputa abre OpenDisputeSheet (ResponsiveSheet) com Field compound API', 7),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Variante cancelled renderiza ServiceCancelledDetail (T-330)', 8),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Variante in_dispute renderiza InDisputeBadge (T-330) e bloqueia recibo', 9),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'Mobile-first com sticky CTA bottom em <768px', 10),

-- T-329 RatingSheet + PendingRatingBanner
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'RatingSheet usa ResponsiveSheet size=sm (sem Dialog cru)', 0),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'StarSelector tem 5 botoes radio acessiveis (role=radio + arrow keys)', 1),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'Botao Enviar disabled enquanto stars=0 ou busy', 2),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'Idempotency-Key estavel rating-{sr_id} no fetch', 3),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'Sucesso: Sonner.success "Avaliacao registrada"', 4),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'Duplicata (idempotent=true): Sonner.info "Voce ja avaliou este servico" (sem error)', 5),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'PendingRatingBanner aparece na home (client) quando ha itens pendentes', 6),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'PendingRatingBanner mostra ate 3 itens com mais recente em prioridade', 7),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'Apos rated, item desaparece da lista (useOptimisticCollection delete)', 8),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'Tap target StarSelector >= 44px; Mobile-first verificado', 9),

-- T-330 ServiceCancelledDetail + InDisputeBadge
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'ServiceCancelledDetail renderiza motivo, politica, valor reembolsado, prazo', 0),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'Botao Baixar comprovante de cancelamento aparece se receipt kind=cancelled disponivel', 1),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'cancel_actor humanizado (Voce/O prestador/Sistema/Equipe)', 2),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'Valores formatados em BRL (Intl.NumberFormat)', 3),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'InDisputeBadge usa StatusChip variant=destructive com label "Em disputa"', 4),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'InDisputeBadge sublabel "Resposta em ate 24h"', 5),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'Componentes integrados em T-328 detail-view', 6),

-- T-331 OPS seeds
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'Migration aplicada via psql', 0),
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'app_config.service_lifecycle contem rating_window_days=30 e warranty_window_days=30', 1),
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'Bucket privado service-receipts provisionado no Supabase Dashboard', 2),
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'Templates service_completed_client (push/email/whatsapp) seedados com status=active', 3),
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'Template rating_received_provider (push) seedado com status=active', 4),
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'app_config_history registra mudanca em service_lifecycle (audit T-215)', 5),
('5d939fc4-114b-4280-9b7f-d808fc981d90', 'Smoke: GET /api/admin/config retorna service_lifecycle com novas keys', 6);


-- ============================================================================
-- 4. TaskDependency (kind lowercase: blocks | relates_to)
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES

-- T-318 service_ratings depende de service_requests (T-070), RLS canonica (T-229), T-241 (consumer Q score)
('c9f39923-469f-4b06-b5e6-df85074df5c0',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'blocks'),
('c9f39923-469f-4b06-b5e6-df85074df5c0',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-229'), 'relates_to'),
('c9f39923-469f-4b06-b5e6-df85074df5c0',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-241'), 'relates_to'),

-- T-319 VIEW depende de T-318 (ratings), T-070 (service_requests), T-147 (support_tickets dispute), T-237 (app_config seed)
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'c9f39923-469f-4b06-b5e6-df85074df5c0', 'blocks'),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'blocks'),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'blocks'),
('cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-237'), 'relates_to'),

-- T-320 service_receipts depende de service_requests (T-070), bucket pattern do US-005 (T-273), RLS suite (T-230)
('ef2075d7-885c-4885-b27f-f17212845b71',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-070'), 'blocks'),
('ef2075d7-885c-4885-b27f-f17212845b71',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-273'), 'relates_to'),
('ef2075d7-885c-4885-b27f-f17212845b71',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-230'), 'relates_to'),

-- T-321 RPC submit rating depende de T-318 (tabela), T-227 (FSM ja faz transicao para completed), T-326 (emit hotspot)
('4262bc59-b6a8-4dad-ba39-32201ce14f98', 'c9f39923-469f-4b06-b5e6-df85074df5c0', 'blocks'),
('4262bc59-b6a8-4dad-ba39-32201ce14f98',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-227'), 'relates_to'),
('4262bc59-b6a8-4dad-ba39-32201ce14f98', '71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'relates_to'),
('4262bc59-b6a8-4dad-ba39-32201ce14f98',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-237'), 'relates_to'),

-- T-322 Edge Function generate-receipt depende de T-320 (tabela+bucket), T-273 (signatures fonte), T-235 (transition gancho), T-147 (support_tickets para bloqueio)
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'ef2075d7-885c-4885-b27f-f17212845b71', 'blocks'),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-273'), 'blocks'),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-235'), 'relates_to'),
('d14dc0dc-373b-4cde-b972-2c1db3e03a2a',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'relates_to'),

-- T-323 endpoints history+pending-rating depende de T-319 (VIEW)
('43a40429-3982-4413-972e-95285540b14c', 'cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'blocks'),

-- T-324 GET detail depende de T-319 (VIEW), T-318 (ratings), T-320 (receipts), T-147 (support_tickets)
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'blocks'),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'c9f39923-469f-4b06-b5e6-df85074df5c0', 'blocks'),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'ef2075d7-885c-4885-b27f-f17212845b71', 'blocks'),
('f1e1695c-bab9-4eb0-bf31-a07dc150b000',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'blocks'),

-- T-325 report-rework / open-dispute depende de T-147 (support_tickets schema), T-319 (window flag), T-150 (decide_dispute downstream)
('b54a3861-79d6-4c9a-aec4-c1574eb69342',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-147'), 'blocks'),
('b54a3861-79d6-4c9a-aec4-c1574eb69342', 'cbbbcbb1-2ddf-4579-9a4c-1311d9da45a3', 'blocks'),
('b54a3861-79d6-4c9a-aec4-c1574eb69342',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-150'), 'relates_to'),
('b54a3861-79d6-4c9a-aec4-c1574eb69342',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-153'), 'relates_to'),

-- T-326 emit hotspots depende de T-162 (enqueue), T-171 (comms), T-216 (templates), T-322 (Edge Function), T-227 (trigger FSM)
('71ad3d4f-c1cc-4119-83ec-08657ac71d31',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-162'), 'blocks'),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-171'), 'blocks'),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31', 'd14dc0dc-373b-4cde-b972-2c1db3e03a2a', 'blocks'),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-227'), 'relates_to'),
('71ad3d4f-c1cc-4119-83ec-08657ac71d31',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-216'), 'relates_to'),

-- T-327 history UI depende de T-323 (endpoint), T-329 (RatingSheet inline)
('592f0c63-d78d-4bfe-af76-531b872f7c51', '43a40429-3982-4413-972e-95285540b14c', 'blocks'),
('592f0c63-d78d-4bfe-af76-531b872f7c51', 'ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'blocks'),

-- T-328 detail UI depende de T-324 (endpoint), T-325 (acoes), T-329 (RatingSheet), T-330 (variantes)
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'blocks'),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'b54a3861-79d6-4c9a-aec4-c1574eb69342', 'blocks'),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', 'ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', 'blocks'),
('3164502c-9081-421f-8f20-5cdfe8be9ceb', '53c19569-ca26-4cb2-ac94-9ce231083dad', 'blocks'),

-- T-329 RatingSheet + Banner depende de T-321 (POST endpoint), T-323 (pending-rating endpoint)
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', '4262bc59-b6a8-4dad-ba39-32201ce14f98', 'blocks'),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2', '43a40429-3982-4413-972e-95285540b14c', 'blocks'),
('ef3e7a67-cb77-4872-92ca-bc3228a9e6c2',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-058'), 'relates_to'),

-- T-330 variantes depende de T-320 (receipts) e T-324 (detail endpoint que retorna receipts kind=cancelled)
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'ef2075d7-885c-4885-b27f-f17212845b71', 'blocks'),
('53c19569-ca26-4cb2-ac94-9ce231083dad', 'f1e1695c-bab9-4eb0-bf31-a07dc150b000', 'blocks'),

-- T-331 OPS seeds depende de T-215 (app_config schema), T-216 (templates schema), T-237 (service_lifecycle base)
('5d939fc4-114b-4280-9b7f-d808fc981d90',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-215'), 'blocks'),
('5d939fc4-114b-4280-9b7f-d808fc981d90',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-216'), 'blocks'),
('5d939fc4-114b-4280-9b7f-d808fc981d90',
 (SELECT id FROM "Task" WHERE reference='ZLAR-V2-T-237'), 'relates_to');


COMMIT;
