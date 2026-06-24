-- =====================================================================
-- Backlog tasks: ZLAR-V2-US-025 — Trocar mensagens com a outra parte via chat interno durante o servico
-- Persona: CLIENTE (envolve PRESTADOR como contraparte) | Modulo: NOTIFICACAO
-- DS: 264e6d07-d365-43ba-8029-d539ce6f7c6b | Project: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
-- US ID: 81dc7544-f5ca-4bb8-866d-16c263408e96
-- 12 tasks, 10 AC cobertos
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- T-178 [DATA] Criar tabelas conversations/messages/moderation_logs com RLS por contrato
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-178',
  'Criar tabelas conversations/messages/message_moderation_logs com RLS por contrato',
  $desc$## Objetivo
Estabelecer as tabelas-base do chat por contrato — uma conversa por service_request com RLS estrita garantindo que somente CLIENTE e PRESTADOR atores do contrato leiam/escrevam. Cobre AC #1 (chat isolado por contrato), AC #6 (status da mensagem), AC #9 (RLS por ator do contrato).

## Contexto
Modulo NOTIFICACAO. Substrato pra US-025 inteira. Conversations sao criadas no aceite (US-004) — ver T-179. Messages alimentam REALTIME (T-184), moderation logs alimentam admin (suporte). Status fluxo: sending → delivered → read | blocked.

## Estado atual / O que substitui
Nao existe tabela de chat. Composer/conversation/ ja vivem em src/components/ui/ mas sem persistencia.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_chat_tables.sql`
```sql
BEGIN;

-- Status da mensagem
CREATE TYPE message_status AS ENUM (
  'sending',     -- enfileirada no client (outbox)
  'delivered',   -- gravada no servidor
  'read',        -- lida pela contraparte
  'blocked'      -- bloqueada por moderacao pre-pagamento
);

-- Estado do canal de chat (derivado do service mas materializado pra perf)
CREATE TYPE conversation_status AS ENUM (
  'pre_payment',    -- aceite ok, pagamento pendente — moderacao ON
  'open',           -- pagamento capturado, troca livre
  'frozen'          -- servico concluido/cancelado, somente leitura
);

CREATE TABLE conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES auth.users(id),
  provider_id         uuid NOT NULL REFERENCES auth.users(id),
  status              conversation_status NOT NULL DEFAULT 'pre_payment',
  last_message_at     timestamptz,
  "createdAt"         timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_unique_per_service UNIQUE (service_request_id)
);
CREATE INDEX conv_client_idx   ON conversations(client_id, last_message_at DESC NULLS LAST);
CREATE INDEX conv_provider_idx ON conversations(provider_id, last_message_at DESC NULLS LAST);

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES auth.users(id),
  body              text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  status            message_status NOT NULL DEFAULT 'delivered',
  client_message_id text NOT NULL,            -- idempotency: gerado no client (uuid v4)
  blocked_reason    text,                      -- preenchido se status='blocked'
  read_at           timestamptz,
  "createdAt"       timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_idempotent UNIQUE (conversation_id, sender_id, client_message_id)
);
CREATE INDEX msg_conv_created_idx ON messages(conversation_id, "createdAt" DESC);

-- Log imutavel de cada decisao da moderacao (mesmo quando nao bloqueia)
CREATE TABLE message_moderation_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  body_excerpt    text NOT NULL,         -- copiado pra preservar mesmo se message foi recusada
  decision        text NOT NULL CHECK (decision IN ('allow','block')),
  reasons         text[] NOT NULL DEFAULT ARRAY[]::text[],  -- ['phone_number','email','cpf','external_link','llm_bypass']
  detector        text NOT NULL CHECK (detector IN ('regex','llm','manual')),
  raw_score       jsonb,
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX modlog_conv_idx ON message_moderation_logs(conversation_id, "createdAt" DESC);

ALTER TABLE conversations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_moderation_logs ENABLE ROW LEVEL SECURITY;

-- conversations: ator do contrato le; admin le tudo
CREATE POLICY "conv_actor_select" ON conversations FOR SELECT
  USING (auth.uid() IN (client_id, provider_id));
CREATE POLICY "conv_admin_all" ON conversations FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
-- INSERT/UPDATE de conversations e' service_role only (trigger no service_request).

-- messages: ator do contrato le mensagens da propria conversa; insert via RPC SECURITY DEFINER
CREATE POLICY "msg_actor_select" ON messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND auth.uid() IN (c.client_id, c.provider_id)
  ));
CREATE POLICY "msg_admin_all" ON messages FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
-- Sem CREATE POLICY de INSERT pra authenticated: send_message RPC (T-180) e' o unico caminho.

-- moderation_logs: ator do contrato le os logs da propria conversa (transparencia AC#3)
CREATE POLICY "modlog_actor_select" ON message_moderation_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_moderation_logs.conversation_id
      AND auth.uid() IN (c.client_id, c.provider_id)
  ));
CREATE POLICY "modlog_admin_all" ON message_moderation_logs FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger updatedAt
CREATE TRIGGER conv_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Nao expor INSERT em messages via RLS authenticated — toda escrita passa pela RPC send_message (T-180) que aplica moderacao + idempotencia
- ❌ Nao usar service_id como conversation_id (UNIQUE garante 1:1, mas chave propria permite trocar fluxo se preciso)
- ❌ Nao gravar PII em body_excerpt sem ofuscacao se decision='block' por phone/cpf/email — mantido cru pra auditoria, acesso restrito por RLS

## Convenções
- Migration via psql; database.types.ts regenerado
- "createdAt"/"updatedAt" com aspas duplas
- Idempotencia de mensagem via UNIQUE (conversation_id, sender_id, client_message_id) — padrao reutilizado de outras filas (T-159)
- Status enum em snake_case lowercase
$desc$,
  'DATA', 'ANY',
  ARRAY['RLS_REQUIRED','INDEX_REQUIRED','RACE_CONDITION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-179 [DATA] Trigger cria conversation no aceite e congela em conclusao/cancelamento
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  'e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-179',
  'Trigger materializa conversation no aceite e transiciona status (pre_payment→open→frozen)',
  $desc$## Objetivo
Sincroniza ciclo de vida da conversation com a maquina de estados do service_request (US-023): cria a conversation no aceite, abre apos captura do pagamento (desliga moderacao), congela apos conclusao/cancelamento (somente leitura). Cobre AC #1 (chat existe quando contrato existe), AC #4 (moderacao desativa pos-captura), AC #8 (somente leitura pos-conclusao).

## Contexto
Modulo NOTIFICACAO ↔ EXECUCAO. Depende de service_requests (US-004), do enum service_status / service_payment_status (US-023). Conversation.status e' fonte de verdade pra UI bloquear input (T-187/T-188) e pra send_message RPC (T-180) decidir moderacao.

## Estado atual / O que substitui
Nao existe trigger. Conversation hoje seria criada manualmente.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_chat_lifecycle.sql`
```sql
BEGIN;

-- Cria conversation no aceite (status accepted)
CREATE OR REPLACE FUNCTION trg_create_conversation_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    INSERT INTO conversations (service_request_id, client_id, provider_id, status)
    VALUES (NEW.id, NEW.client_id, NEW.provider_id, 'pre_payment')
    ON CONFLICT (service_request_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION trg_create_conversation_on_accept() FROM PUBLIC;

CREATE TRIGGER service_request_create_conv
  AFTER INSERT OR UPDATE OF status ON service_requests
  FOR EACH ROW EXECUTE FUNCTION trg_create_conversation_on_accept();

-- Atualiza conversation.status conforme service evolui (pagamento e conclusao)
CREATE OR REPLACE FUNCTION trg_sync_conversation_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new_conv_status conversation_status;
BEGIN
  -- Decide novo status
  IF NEW.status IN ('completed','cancelled') THEN
    v_new_conv_status := 'frozen';
  ELSIF NEW.payment_status = 'captured' THEN
    v_new_conv_status := 'open';
  ELSE
    v_new_conv_status := 'pre_payment';
  END IF;

  UPDATE conversations
     SET status = v_new_conv_status,
         "updatedAt" = NOW()
   WHERE service_request_id = NEW.id
     AND status <> v_new_conv_status;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION trg_sync_conversation_status() FROM PUBLIC;

CREATE TRIGGER service_request_sync_conv_status
  AFTER UPDATE OF status, payment_status ON service_requests
  FOR EACH ROW EXECUTE FUNCTION trg_sync_conversation_status();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Nao deletar conversation em cancelamento — historico precisa permanecer (AC#8)
- ❌ Nao logar PII no proprio trigger (sem RAISE NOTICE de body)
- ❌ Nao depender de payment_status sozinho — concluido/cancelado tem prioridade sobre payment ainda 'captured'

## Convenções
- SECURITY DEFINER + REVOKE FROM PUBLIC — padrao obrigatorio (memory project_zelar_v2 + ZRD geral)
- search_path=public,pg_temp em todo SECURITY DEFINER
- Idempotencia via ON CONFLICT DO NOTHING + condicao de mudanca de status no UPDATE
$desc$,
  'DATA', 'SISTEMA',
  ARRAY['RLS_REQUIRED','AUDIT_LOG','RACE_CONDITION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-180 [API] RPC send_message — gating, idempotencia, invocacao moderacao
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-180',
  'Implementar RPC send_message com gating de status, idempotencia e moderacao pre-pagamento',
  $desc$## Objetivo
Unico caminho de gravacao de mensagem. Garante: (a) sender e' ator do contrato, (b) conversation nao esta frozen, (c) input bloqueado pre-pagamento ou apos congelamento, (d) idempotencia por client_message_id, (e) chama moderacao pre-payment. Cobre AC #2 (gating pre-pagamento), AC #3 (moderacao registrada), AC #4 (sem moderacao pos-captura), AC #7 (idempotencia no reconnect), AC #8 (frozen bloqueia novos envios).

## Contexto
Modulo NOTIFICACAO ↔ EXECUCAO. Consome conversations.status (T-179) e moderate-message edge function (T-181). Chamada via POST /api/conversations/[id]/messages do PWA (cliente e prestador). Apos sucesso, dispara emit.messageNew em fire-and-forget (T-183) — feito no route handler, nao na RPC, pra manter Postgres puro.

## Estado atual / O que substitui
Nao existe RPC nem endpoint.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_chat_send_rpc.sql`
```sql
CREATE OR REPLACE FUNCTION send_message(
  p_conversation_id   uuid,
  p_body              text,
  p_client_message_id text
)
RETURNS messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_conv conversations%ROWTYPE;
  v_msg  messages%ROWTYPE;
  v_pre_payment boolean;
  v_blocked boolean := false;
  v_reasons text[];
  v_detector text;
BEGIN
  -- 1. Carrega conversation, valida ator
  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() NOT IN (v_conv.client_id, v_conv.provider_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- 2. Gating: status frozen bloqueia
  IF v_conv.status = 'frozen' THEN
    RAISE EXCEPTION 'conversation_frozen' USING ERRCODE = '23514';
  END IF;

  -- 3. Pre-pagamento: aplica moderacao via NLP edge (chamada externa);
  --    aqui na RPC, fazemos somente o regex local rapido como cinto-de-seguranca.
  v_pre_payment := (v_conv.status = 'pre_payment');

  IF v_pre_payment THEN
    SELECT array_agg(r) INTO v_reasons FROM (
      SELECT 'phone_number'::text WHERE p_body ~* '\(?\d{2}\)?\s*9?\d{4}-?\d{4}'
      UNION ALL SELECT 'email' WHERE p_body ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
      UNION ALL SELECT 'cpf' WHERE p_body ~ '\d{3}\.?\d{3}\.?\d{3}-?\d{2}'
      UNION ALL SELECT 'external_link' WHERE p_body ~* '(https?://|whatsapp\.com|t\.me/|instagram\.com|facebook\.com)'
    ) AS reasons(r);
    v_blocked := v_reasons IS NOT NULL AND array_length(v_reasons, 1) > 0;
    v_detector := 'regex';
  END IF;

  -- 4. INSERT idempotente
  INSERT INTO messages (
    conversation_id, sender_id, body, status, client_message_id, blocked_reason
  ) VALUES (
    p_conversation_id,
    auth.uid(),
    p_body,
    CASE WHEN v_blocked THEN 'blocked' ELSE 'delivered' END,
    p_client_message_id,
    CASE WHEN v_blocked THEN array_to_string(v_reasons, ',') ELSE NULL END
  )
  ON CONFLICT (conversation_id, sender_id, client_message_id) DO UPDATE
    SET body = EXCLUDED.body  -- noop, mas faz UPDATE pra retornar a row
  RETURNING * INTO v_msg;

  -- 5. Log de moderacao (sempre que pre-pagamento, mesmo se passou)
  IF v_pre_payment THEN
    INSERT INTO message_moderation_logs (
      message_id, conversation_id, body_excerpt, decision, reasons, detector
    ) VALUES (
      v_msg.id,
      p_conversation_id,
      left(p_body, 500),
      CASE WHEN v_blocked THEN 'block' ELSE 'allow' END,
      COALESCE(v_reasons, ARRAY[]::text[]),
      v_detector
    );
  END IF;

  -- 6. Atualiza last_message_at
  UPDATE conversations
     SET last_message_at = NOW(), "updatedAt" = NOW()
   WHERE id = p_conversation_id;

  RETURN v_msg;
END;
$fn$;
REVOKE ALL ON FUNCTION send_message(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_message(uuid, text, text) TO authenticated;
```

### `src/app/api/conversations/[id]/messages/route.ts`
```typescript
// POST: envia mensagem (delegando pra RPC send_message)
// GET:  lista mensagens paginadas (cursor por createdAt)
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { emit } from '@/lib/notifications/emit';

const Body = z.object({
  body: z.string().min(1).max(2000),
  clientMessageId: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('send_message', {
    p_conversation_id:   params.id,
    p_body:              body.body,
    p_client_message_id: body.clientMessageId,
  });

  if (error) {
    if (error.code === '42501') return Response.json({ error: 'forbidden' }, { status: 403 });
    if (error.code === '23514') return Response.json({ error: 'conversation_frozen' }, { status: 409 });
    if (error.code === 'P0002') return Response.json({ error: 'conversation_not_found' }, { status: 404 });
    throw error;
  }

  // T-183: emit fire-and-forget pra push notification quando contraparte offline
  emit.messageNew({ conversationId: params.id, messageId: data.id })
    .catch(e => console.error('emit.messageNew failed', e));

  return Response.json(data);
}
```

## Constraints / NÃO fazer
- ❌ Nao chamar moderacao LLM dentro da RPC (latencia em transacao) — a RPC faz somente regex; LLM completo roda na edge moderate-message (T-181) chamada da route handler quando regex passa
- ❌ Nao usar Idempotency-Key header (padrao financeiro) — aqui o idempotency e' do payload (client_message_id) porque o cliente gera UUID antes do submit (suporta outbox offline reenvio AC#7)
- ❌ Nao expor INSERT direto em messages — sempre via RPC

## Convenções
- SECURITY DEFINER + REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated — padrao obrigatorio
- Erros mapeados: P0002→404, 42501→403, 23514→409
- Idempotencia via UNIQUE constraint, ON CONFLICT DO UPDATE retornando row existente (cliente reenvia, recebe mesma id)
- Zod no servidor (memory project_ui_patterns)
$desc$,
  'API', 'ANY',
  ARRAY['RLS_REQUIRED','INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-181 [API] Edge function moderate-message (NLP anti-bypass com OpenAI)
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  'fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-181',
  'Implementar edge function moderate-message (LLM anti-bypass para tentativas obfuscadas)',
  $desc$## Objetivo
Camada profunda de moderacao pre-pagamento que pega tentativas obfuscadas (ex: "meu zap zero um um nove eight..."). Roda async apos o INSERT e atualiza status pra blocked se LLM detectar bypass que regex nao pegou. Cobre AC #3 (moderacao registrada com motivo) — refina o regex de T-180.

## Contexto
Modulo NOTIFICACAO. Chamada do route handler /api/conversations/[id]/messages POST (T-180) em paralelo ao INSERT, somente quando conversation.status='pre_payment' e o regex liberou. Atualiza messages.status pra 'blocked' + grava moderation_log de detector='llm' se positivo. Usa OPENAI_API_KEY (memory project_zelar_v2 secrets).

## Estado atual / O que substitui
Nao existe edge function de moderacao. Regex local em send_message (T-180) e' a primeira linha; esta e' a segunda.

## O que criar

### `supabase/functions/moderate-message/index.ts`
```typescript
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';

interface Payload { messageId: string; conversationId: string; body: string; }

const PROMPT = `Voce e' classificador de bypass de chat em plataforma de servicos. A pessoa NAO PODE
trocar contato direto antes do pagamento. Detecte tentativas obfuscadas de:
- telefone (numeros por extenso, dividido por palavras, etc)
- email (em formatos disfarcados como "joao at gmail dot com")
- pedido de contato fora da plataforma (mande mensagem la fora, etc)
- link externo disfarcado (instagram com /, whatsapp .com etc)

Retorne JSON: {"bypass": true|false, "reasons": ["phone_number"|"email"|"external_contact_request"|"external_link"]}`;

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('forbidden', { status: 403 });
  }

  const { messageId, conversationId, body }: Payload = await req.json();

  const llm = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: body }],
    }),
  });
  const llmJson = await llm.json();
  const verdict = JSON.parse(llmJson.choices[0].message.content);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (verdict.bypass) {
    await supabase.from('messages').update({
      status: 'blocked',
      blocked_reason: verdict.reasons.join(','),
    }).eq('id', messageId);
  }

  await supabase.from('message_moderation_logs').insert({
    message_id: messageId,
    conversation_id: conversationId,
    body_excerpt: body.slice(0, 500),
    decision: verdict.bypass ? 'block' : 'allow',
    reasons: verdict.reasons ?? [],
    detector: 'llm',
    raw_score: llmJson,
  });

  return Response.json({ ok: true, blocked: verdict.bypass });
});
```

### Invocacao a partir do route handler (T-180)
- Apos a RPC send_message retornar status='delivered' (regex liberou) e conversation.status='pre_payment', o handler dispara fetch fire-and-forget para a edge function — sem bloquear resposta ao cliente. Se LLM bloquear, a UI ve mudanca via REALTIME (T-184) e marca a bolha como blocked.

## Constraints / NÃO fazer
- ❌ Nao chamar OpenAI direto do RPC plpgsql — latencia/timeout em transacao mata a UX
- ❌ Nao expor a edge sem auth — service_role bearer obrigatorio
- ❌ Nao gravar prompt LLM no log sem ofuscar PII se acionou bypass (basta o body_excerpt)
- ❌ Nao bloquear o reply 200 do POST esperando o LLM — fire-and-forget

## Convenções
- Secrets: OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY (memory project_zelar_v2)
- gpt-4o-mini com response_format json_object pra parsing seguro
- Decision logada SEMPRE (mesmo allow), pra auditoria de qualidade do detector
$desc$,
  'API', 'SISTEMA',
  ARRAY['SECRET_HANDLING','AUDIT_LOG','INPUT_VALIDATION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-182 [API] Endpoint de denuncia de mensagem abusiva ao suporte
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  'cb55339d-3498-4d45-b124-8b8b75402d91'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-182',
  'Implementar POST /api/conversations/[cid]/messages/[mid]/report (denuncia ao suporte)',
  $desc$## Objetivo
Permitir ator do contrato anexar uma mensagem abusiva a um ticket de suporte (cria ticket novo ou anexa ao existente). Cobre AC #10 (denuncia com mensagem anexada).

## Contexto
Modulo NOTIFICACAO ↔ SUPORTE. Depende de support_tickets (US-018, modulo SUPORTE) e da estrutura de anexos. Endpoint chamado pela UI de menu de mensagem (T-189). Cria ticket categoria='abusive_message' com referencia a messages.id.

## Estado atual / O que substitui
support_tickets ja existe (US-018). Falta o endpoint de denuncia especifico do chat.

## O que criar

### `src/app/api/conversations/[cid]/messages/[mid]/report/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  reason: z.enum(['harassment','spam','scam','other']),
  details: z.string().max(1000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { cid: string; mid: string } },
) {
  const body = Body.parse(await req.json());
  const supabase = await createClient();

  // Garante que reporter e' ator do contrato (RLS de messages pega isso)
  const { data: msg, error: e1 } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body')
    .eq('id', params.mid)
    .eq('conversation_id', params.cid)
    .single();
  if (e1) return Response.json({ error: 'message_not_found' }, { status: 404 });

  // Cria support_ticket com referencia
  const { data: ticket, error: e2 } = await supabase
    .from('support_tickets')
    .insert({
      category: 'abusive_message',
      subject: `Denuncia de mensagem em conversation ${params.cid.slice(0,8)}`,
      description: body.details ?? '(sem detalhes adicionais)',
      reference_entity_type: 'message',
      reference_entity_id:   params.mid,
      metadata: { reason: body.reason, message_excerpt: msg.body.slice(0, 200) },
    })
    .select()
    .single();
  if (e2) {
    if (e2.code === '42501') return Response.json({ error: 'forbidden' }, { status: 403 });
    throw e2;
  }

  return Response.json({ ticketId: ticket.id });
}
```

## Constraints / NÃO fazer
- ❌ Nao copiar o body inteiro pro ticket — deixa via reference_entity_id (admin segue o link)
- ❌ Nao deletar/ocultar a mensagem original automaticamente (decisao do moderador admin)
- ❌ Nao permitir denuncia de propria mensagem (validar sender_id != auth.uid())

## Convenções
- Zod no servidor
- 403 via RLS (SELECT em messages restrito ao ator)
- Reuse: support_tickets schema ja existente (US-018)
$desc$,
  'API', 'ANY',
  ARRAY['RLS_REQUIRED','INPUT_VALIDATION','AUDIT_LOG','RATE_LIMIT'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-183 [API] emit.messageNew helper (push para contraparte offline)
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  'e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-183',
  'Adicionar emit.messageNew em src/lib/notifications/emit.ts (push pra contraparte offline)',
  $desc$## Objetivo
Estender o helper emit.* (T-164) com messageNew(conversationId, messageId) que: (a) calcula o destinatario (contraparte do sender), (b) checa se ele esta com presence ativo (tem realtime channel aberto recentemente), (c) se offline, enfileira notification_event categoria='message_new' que sera entregue por dispatch-notifications via web_push primeiro e WhatsApp como fallback (memory project_zelar_v2 / brainstorm hwd91de). Cobre AC #5 (notificacao por canal externo apos curto intervalo sem leitura).

## Contexto
Modulo NOTIFICACAO. Reusa: notification_events (T-159), enqueue_notification_event RPC (T-162), emit pattern (T-164), dispatch-notifications (T-163), sendWhatsApp (T-171). Chamado em fire-and-forget no route handler T-180.

## Estado atual / O que substitui
emit.* ja tem kycResult, serviceAccepted, serviceStepChange, paymentReceipt, paymentRelease, disputeDecision, providerSuspended. Falta messageNew.

## O que criar

### `src/lib/notifications/emit.ts` (estender)
```typescript
// Adicionar:
async messageNew(args: { conversationId: string; messageId: string }) {
  const supabase = createAdminClient();

  // 1. Carrega conversation + ultima leitura da contraparte (presence)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, client_id, provider_id, service_request_id')
    .eq('id', args.conversationId)
    .single();
  if (!conv) return;

  const { data: msg } = await supabase
    .from('messages')
    .select('id, sender_id, body')
    .eq('id', args.messageId)
    .single();
  if (!msg) return;

  const recipientId = msg.sender_id === conv.client_id ? conv.provider_id : conv.client_id;

  // 2. Idempotencia: event_key inclui o messageId
  await supabase.rpc('enqueue_notification_event', {
    p_category:   'message_new',
    p_user_id:    recipientId,
    p_event_key:  `message_new:${args.messageId}`,
    p_payload: {
      conversationId: args.conversationId,
      messageId:      args.messageId,
      excerpt:        msg.body.slice(0, 120),
      serviceId:      conv.service_request_id,
    },
    // Curto intervalo de espera antes de despachar — se a contraparte abrir o app
    // dentro desse window e marcar leitura, dispatch-notifications pula.
    p_dispatch_after_seconds: 30,
  });
}
```

### `supabase/migrations/<YYYYMMDD>_zelar_v2_message_new_template.sql`
```sql
-- Catalogo de templates de notificacao precisa ter category=message_new
INSERT INTO message_templates (category, channel, current, subject_template, body_template, version)
VALUES
  ('message_new', 'web_push', true, 'Nova mensagem em servico', '{{senderName}}: {{excerpt}}', 1),
  ('message_new', 'whatsapp', true, NULL,                      '*Zelar*\nVoce tem mensagem nova em servico: {{excerpt}}\nResponder: {{deepLink}}', 1)
ON CONFLICT DO NOTHING;
```

## Constraints / NÃO fazer
- ❌ Nao enviar email pra "nova mensagem" (volume alto, ruido) — somente push e WA
- ❌ Nao enviar pro proprio sender
- ❌ Nao incluir corpo cheio na notification (privacidade) — somente excerpt 120 chars
- ❌ Nao chamar emit.messageNew dentro de transacao da RPC send_message (T-180) — fire-and-forget no route handler, pos-COMMIT

## Convenções
- Padrao fire-and-forget (.catch console) replicado de outros emit.*
- Idempotencia via event_key=message_new:<messageId> (dispatch unico mesmo se POST repetir)
- Reuse: enqueue_notification_event (T-162), dispatch-notifications (T-163), sendWhatsApp (T-171)
$desc$,
  'API', 'ANY',
  ARRAY['SECRET_HANDLING','AUDIT_LOG'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-184 [REALTIME] Hook use-conversation-realtime
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  'f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-184',
  'Implementar hook use-conversation-realtime (canal conversation:{id})',
  $desc$## Objetivo
Subscriber Realtime pra mensagens (INSERT/UPDATE) e mudancas de conversation.status (UPDATE). Garante latencia <500ms pra entrega/leitura/bloqueio. Inclui fallback de polling 10s em CHANNEL_ERROR/TIMED_OUT. Cobre AC #5 (mensagem ao vivo enquanto online), AC #6 (status atualiza ao vivo: enviando→entregue→lida→bloqueada).

## Contexto
Modulo NOTIFICACAO. Subscribers: ChatThread (T-185). Mesma fonte (messages INSERT/UPDATE) atende cliente e prestador (RLS filtra). Padrao identico aos canais service:{id} de US-005/US-012. Eventos relevantes: messages INSERT (mensagem nova), messages UPDATE de status (delivered→read→blocked), conversations UPDATE de status (pre_payment→open→frozen).

## Estado atual / O que substitui
Nao existe hook de chat realtime. Hooks similares ja existem (use-service-realtime — referencia).

## O que criar

### `src/hooks/use-conversation-realtime.ts`
```typescript
import { useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';

type Message = Tables<'messages'>;
type Conversation = Tables<'conversations'>;

interface Args {
  conversationId: string;
  onMessageInsert: (msg: Message) => void;
  onMessageUpdate: (msg: Message) => void;
  onConversationUpdate: (conv: Conversation) => void;
}

export function useConversationRealtime({
  conversationId, onMessageInsert, onMessageUpdate, onConversationUpdate,
}: Args) {
  useEffect(() => {
    const supabase = createBrowserClient();
    let pollInterval: NodeJS.Timeout | null = null;

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `conversation_id=eq.${conversationId}` },
        (p) => onMessageInsert(p.new as Message))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages',
          filter: `conversation_id=eq.${conversationId}` },
        (p) => onMessageUpdate(p.new as Message))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations',
          filter: `id=eq.${conversationId}` },
        (p) => onConversationUpdate(p.new as Conversation))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // fallback polling
          pollInterval = setInterval(async () => {
            // Re-fetch ultimas mensagens (handler decide diff)
            const { data } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', conversationId)
              .order('createdAt', { ascending: false })
              .limit(20);
            data?.forEach(onMessageUpdate);
          }, 10_000);
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [conversationId, onMessageInsert, onMessageUpdate, onConversationUpdate]);
}
```

## Constraints / NÃO fazer
- ❌ Nao subscrever sem unmount cleanup (vazamento)
- ❌ Nao confiar 100% em Realtime — fallback polling 10s e' obrigatorio
- ❌ Nao usar createClient() server aqui — somente browser client
- ❌ Nao filtrar por sender_id no subscribe (RLS ja restringe; filtrar perde mensagens da contraparte)

## Convenções
- Nome do canal: conversation:{id} (consistente com service:{id} ja existente)
- RLS de messages e conversations ja filtra ator do contrato (T-178)
- Reconnect automatico via cliente Supabase
$desc$,
  'REALTIME', 'ANY',
  ARRAY['REALTIME_CHANNEL'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-185 [UI] Pagina /services/[id]/chat — lista de mensagens com status
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '1adfd427-76fd-410c-9819-61fca14861fd'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-185',
  'Renderizar pagina ChatThread em /services/[id]/chat com bolhas, status e scroll',
  $desc$## Objetivo
Tela de chat por contrato — bolhas alinhadas por sender, indicador de status (enviando/entregue/lida/bloqueada), header com nome da contraparte e status do contrato. Cobre AC #1 (chat existe por contrato), AC #6 (status visivel), AC #9 (so ve a propria conversa — RLS). Compartilhado entre cliente e prestador (mesma rota, RLS define permissao).

## Contexto
Modulo NOTIFICACAO. Compartilhada por (client) e (provider). Consome: hook use-conversation-realtime (T-184), ChatComposer (T-186), conversation/ existentes em src/components/ui/. Layout mobile-first com keyboard-aware.

## Estado atual / O que substitui
src/components/ui/chat-composer.tsx e src/components/ui/conversation/ ja existem (memory project_ui_patterns). Falta a tela orquestradora que junta tudo + persistencia real (chat existente e' design-session AI).

## O que criar

### `src/app/services/[id]/chat/page.tsx`
```tsx
// Server component — fetch inicial de mensagens + conversation status
import { createClient } from '@/lib/supabase/server';
import { ChatThreadClient } from './chat-thread-client';
import { notFound } from 'next/navigation';

export default async function ChatThreadPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from('conversations')
    .select('*, service:service_requests(id, title, client_id, provider_id)')
    .eq('service_request_id', params.id)
    .single();
  if (!conv) notFound();

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conv.id)
    .order('createdAt', { ascending: true })
    .limit(100);

  return <ChatThreadClient conversation={conv} initialMessages={messages ?? []} />;
}
```

### `src/app/services/[id]/chat/chat-thread-client.tsx`
```tsx
'use client';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { useConversationRealtime } from '@/hooks/use-conversation-realtime';
import { ChatComposer } from '@/components/ui/chat-composer';
import { MessageBubble } from '@/components/ui/conversation/message-bubble'; // reuse existente
import { StatusChip } from '@/components/ui/status-chip';

export function ChatThreadClient({ conversation, initialMessages }: Props) {
  const { items: messages, mutate } = useOptimisticCollection(initialMessages);
  const [conv, setConv] = useState(conversation);

  useConversationRealtime({
    conversationId: conversation.id,
    onMessageInsert: (m) => mutate({ type: 'external_update', items: [m] }, ...),
    onMessageUpdate: (m) => mutate({ type: 'external_update', items: [m] }, ...),
    onConversationUpdate: (c) => setConv(c),
  });

  return (
    <div className="flex h-dvh flex-col">
      <header>{counterpartName} <StatusChip>{conv.status}</StatusChip></header>
      <main className="flex-1 overflow-y-auto">
        {messages.map(m => <MessageBubble key={m.id} message={m} isOwn={m.sender_id === currentUserId} />)}
      </main>
      <ChatComposer conversationId={conv.id} disabled={conv.status === 'frozen'} preP ayment={conv.status === 'pre_payment'} />
    </div>
  );
}
```

### Bolha de mensagem (estender conversation/ existente se preciso)
- Mostra body, timestamp, indicador de status:
  - sending: spinner pequeno
  - delivered: ✓
  - read: ✓✓ (azul)
  - blocked: bolha cinza tachada + tooltip com motivo (do blocked_reason)

## Constraints / NÃO fazer
- ❌ Sem react-hook-form / mascara — input simples no composer
- ❌ Sem avatares (memory feedback_chat_ui — bolhas se diferenciam por lado+cor)
- ❌ Sem scroll automatico se usuario rolou pra cima manualmente (preserve scroll position)
- ❌ Sem fetch de mensagens no client diretamente; SSR carrega 100 ultimas, REALTIME atualiza dali

## Convenções
- Reuse: ChatComposer (src/components/ui/chat-composer.tsx), conversation/ (src/components/ui/conversation/), StatusChip, Skeleton
- useOptimisticCollection<Message> com reducer external_update pra reconciliar realtime
- Mobile-first; header sticky; keyboard-aware (input nao some atras do teclado)
- pt-BR direto nos textos (memory feedback_chat_ui + project_ui_patterns I18N_DEFERRED)
$desc$,
  'UI', 'ANY',
  ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','OPTIMISTIC_UPDATE','MOBILE_FIRST','PAGINATION'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-186 [UI] ChatComposer wired com outbox offline + idempotencia
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-186',
  'Wirar ChatComposer no fluxo: optimistic + outbox offline + retry sem duplicar',
  $desc$## Objetivo
Composer envia mensagem com optimistic update (bolha 'sending' aparece imediato), persiste pendentes em IndexedDB se offline, reenviar todas no reconnect SEM duplicar (idempotencia via clientMessageId UUID gerado no client). Cobre AC #5 (mensagem ao vivo), AC #6 (status sending→delivered), AC #7 (offline + reconexao sem duplicacao).

## Contexto
Modulo NOTIFICACAO. Estende ChatComposer existente em src/components/ui/chat-composer.tsx (catalogo doc 04). Usa useOptimisticCollection. Outbox em IndexedDB via lib leve (idb-keyval ou nativo) — somente do dispositivo ativo, nao sincroniza entre devices.

## Estado atual / O que substitui
ChatComposer existe mas hoje so chama callback do design-session-chat. Falta a integracao com a API de chat persistente + outbox offline.

## O que criar

### `src/components/conversation/chat-input-with-outbox.tsx`
```tsx
'use client';
import { useState, useEffect } from 'react';
import { ChatComposer } from '@/components/ui/chat-composer';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
import { fetchOrThrow } from '@/lib/optimistic/fetch';

interface OutboxItem { clientMessageId: string; conversationId: string; body: string; createdAt: string; }

const OUTBOX_KEY = (cid: string) => `chat-outbox:${cid}`;

export function ChatInputWithOutbox({ conversationId, mutate, disabled, placeholder }: Props) {
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);

  // Recarrega outbox no mount
  useEffect(() => {
    const raw = localStorage.getItem(OUTBOX_KEY(conversationId));
    if (raw) setOutbox(JSON.parse(raw));
  }, [conversationId]);

  // Tenta drenar outbox quando volta online
  useEffect(() => {
    const drain = async () => {
      const items = JSON.parse(localStorage.getItem(OUTBOX_KEY(conversationId)) ?? '[]');
      for (const item of items) {
        try {
          await fetchOrThrow(`/api/conversations/${item.conversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: item.body, clientMessageId: item.clientMessageId }),
          });
          // remove apos sucesso (server retorna mesma row mesmo se duplicado pelo UNIQUE)
          const remaining = JSON.parse(localStorage.getItem(OUTBOX_KEY(conversationId)) ?? '[]')
            .filter((x: OutboxItem) => x.clientMessageId !== item.clientMessageId);
          localStorage.setItem(OUTBOX_KEY(conversationId), JSON.stringify(remaining));
          setOutbox(remaining);
        } catch {
          break; // tenta de novo no proximo online
        }
      }
    };
    if (navigator.onLine) drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
  }, [conversationId]);

  const handleSend = async (body: string) => {
    const clientMessageId = crypto.randomUUID();
    const tempMsg = {
      id: clientMessageId,            // tempId
      conversation_id: conversationId,
      sender_id: 'self',              // resolver no caller
      body, status: 'sending' as const,
      client_message_id: clientMessageId,
      createdAt: new Date().toISOString(),
    };

    await mutate(
      { type: 'create', item: tempMsg },
      async (signal) => {
        if (!navigator.onLine) {
          const newOutbox = [...outbox, { clientMessageId, conversationId, body, createdAt: tempMsg.createdAt }];
          localStorage.setItem(OUTBOX_KEY(conversationId), JSON.stringify(newOutbox));
          setOutbox(newOutbox);
          throw new Error('queued_offline'); // mantem optimistic com status sending
        }
        const res = await fetchOrThrow(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, clientMessageId }),
          signal,
        });
        return await res.json();
      },
      { errorLabel: 'Falha ao enviar mensagem' },
    );
  };

  return <ChatComposer onSend={handleSend} disabled={disabled} placeholder={placeholder} />;
}
```

## Constraints / NÃO fazer
- ❌ Nao usar timestamps do client como id permanente — server retorna o id real
- ❌ Nao bloquear UI esperando o POST — optimistic com status='sending'
- ❌ Nao reenviar mensagens ja confirmadas no drain (UNIQUE constraint server-side e' a salvaguarda final, mas a lib remove apos 200 ok)
- ❌ Sem react-hook-form

## Convenções
- clientMessageId = crypto.randomUUID() (uuid v4)
- localStorage por enquanto; IndexedDB/idb-keyval se mensagens com anexo entrarem (nao no MVP)
- Reuse: ChatComposer (catalogo doc 04), useOptimisticCollection (mutation 'create' + reconcile pelo INSERT realtime)
- fetchOrThrow + showErrorToast (memory project_ui_patterns)
$desc$,
  'UI', 'ANY',
  ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-187 [UI] Estado pre-pagamento (input desabilitado + tooltip)
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-187',
  'UI: bloqueio do composer pre-pagamento (CLIENTE) + banner explicando moderacao',
  $desc$## Objetivo
CLIENTE so envia mensagens apos pagamento confirmado; antes disso o input fica desabilitado com mensagem clara explicando "canal abrira apos confirmacao do pagamento". Para o PRESTADOR, banner de aviso indica que mensagens dele estao sendo moderadas. Cobre AC #2 (input gating cliente), AC #3 (transparencia da moderacao).

## Contexto
Modulo NOTIFICACAO. Conversation.status='pre_payment' e' a fonte de verdade — vem do trigger T-179 e atualiza via Realtime (T-184). Aplica-se a ambos os atores mas com texto diferente: cliente nao envia, prestador envia mas e' avisado da moderacao ON.

## Estado atual / O que substitui
Sem componente. ChatThreadClient (T-185) decide o disabled/placeholder.

## O que criar

### `src/components/conversation/pre-payment-banner.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';

interface Props { role: 'client' | 'provider'; }

export function PrePaymentBanner({ role }: Props) {
  if (role === 'client') {
    return (
      <Card className="m-3 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Canal de mensagens abre apos o pagamento.</strong>
        <p>Voce confirma o pagamento na pagina do servico. Apos a confirmacao, voce e o
          prestador podem trocar mensagens livremente.</p>
      </Card>
    );
  }
  return (
    <Card className="m-3 border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
      <strong>Moderacao ativa.</strong>
      <p>Antes da confirmacao do pagamento, mensagens com telefone, email ou links
        externos sao bloqueadas automaticamente. Apos pagamento, a moderacao e' desativada.</p>
    </Card>
  );
}
```

### Wiring no ChatThreadClient (T-185)
- Quando `conversation.status === 'pre_payment'`:
  - role='client': renderiza `<PrePaymentBanner role="client" />` ACIMA do composer + passa `disabled` ao ChatInputWithOutbox
  - role='provider': renderiza `<PrePaymentBanner role="provider" />` + composer ativo (mas mensagens sujeitas a moderacao)
- Quando `status === 'open'`: oculta o banner

## Constraints / NÃO fazer
- ❌ Nao usar window.alert pra explicar (sempre banner inline, conforme memory project_ui_patterns)
- ❌ Nao desabilitar prestador no pre_payment — ele pode mandar info de logistica, so passa pela moderacao
- ❌ Nao mostrar lista detalhada de regex ao usuario (UX — basta categoria: telefone/email/link)

## Convenções
- Reuse: Card (src/components/ui/card.tsx)
- Cores via tokens tailwind (amber/blue) — sem custom CSS
- Texto pt-BR direto
$desc$,
  'UI', 'CLIENTE',
  ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-188 [UI] Modo somente leitura apos conclusao/cancelamento (frozen)
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-188',
  'UI: modo somente leitura no chat apos servico concluido/cancelado',
  $desc$## Objetivo
Quando conversation.status='frozen', composer fica oculto/desabilitado, banner informa "servico concluido — historico preservado" e historico continua visivel. Cobre AC #8 (somente leitura pos-conclusao).

## Contexto
Modulo NOTIFICACAO. Status frozen e' setado pelo trigger T-179 quando service_request transiciona pra completed/cancelled. UI atualiza ao vivo via Realtime (T-184).

## Estado atual / O que substitui
Sem componente. ChatThreadClient (T-185) decide via prop `disabled` no composer.

## O que criar

### `src/components/conversation/frozen-banner.tsx`
```tsx
'use client';
import { Card } from '@/components/ui/card';
import { Lock } from 'lucide-react';

interface Props { reason: 'completed' | 'cancelled'; }

export function FrozenBanner({ reason }: Props) {
  return (
    <Card className="m-3 border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-700">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4" />
        <strong>{reason === 'completed' ? 'Servico concluido' : 'Servico cancelado'}.</strong>
      </div>
      <p>O historico esta preservado e voce pode consultar a qualquer momento. Novas
        mensagens nao podem mais ser enviadas neste contrato.</p>
    </Card>
  );
}
```

### Wiring no ChatThreadClient (T-185)
- Quando `conversation.status === 'frozen'`:
  - Substitui `<ChatInputWithOutbox>` por `<FrozenBanner reason={...} />`
  - Mantem lista de mensagens scrollavel acima
- Reason vem de `service.status` (carregado junto com conversation)

## Constraints / NÃO fazer
- ❌ Nao deletar mensagens (preservado pra evidencia em disputa US-026)
- ❌ Nao esconder o historico — somente leitura, nao apagado
- ❌ Nao permitir denuncia (T-189) tambem em frozen — mantem disponivel pra reportar abuso pos-fato

## Convenções
- Reuse: Card, lucide-react Lock icon
- Estilo neutro (zinc-50/300/700) — diferente dos banners pre-payment (amber/blue)
$desc$,
  'UI', 'ANY',
  ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- ---------------------------------------------------------------------
-- T-189 [UI] Acao de denuncia de mensagem (DropdownMenu + ConfirmDialog)
-- ---------------------------------------------------------------------
INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES (
  '780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid,
  'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c'::uuid,
  '81dc7544-f5ca-4bb8-866d-16c263408e96'::uuid,
  'ZLAR-V2-T-189',
  'UI: acao "Denunciar mensagem" no longpress/menu de bolha (ConfirmDialog + form)',
  $desc$## Objetivo
Em cada bolha da contraparte (nao da propria), longpress (mobile) ou icone de menu (desktop) abre dropdown com "Denunciar mensagem". Apos selecionar, ResponsiveDialog pede motivo (harassment/spam/scam/other) + detalhes opcionais e submete pra POST /api/conversations/[cid]/messages/[mid]/report (T-182). Cobre AC #10 (denuncia anexa mensagem ao ticket).

## Contexto
Modulo NOTIFICACAO ↔ SUPORTE. Renderizado dentro do MessageBubble (componente em src/components/ui/conversation/). Ao confirmar, toast de sucesso indica "Denuncia enviada ao suporte (ticket #XYZ)".

## Estado atual / O que substitui
Sem fluxo de denuncia. Bolhas atuais nao tem menu.

## O que criar

### `src/components/conversation/message-report-action.tsx`
```tsx
'use client';
import { useState } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Field, FormBody } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { fetchOrThrow } from '@/lib/optimistic/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';
import { Flag, MoreVertical } from 'lucide-react';

interface Props { conversationId: string; messageId: string; }

export function MessageReportAction({ conversationId, messageId }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'harassment' | 'spam' | 'scam' | 'other'>('harassment');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetchOrThrow(
        `/api/conversations/${conversationId}/messages/${messageId}/report`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, details: details || undefined }) },
      );
      const { ticketId } = await res.json();
      toast.success(`Denuncia enviada ao suporte (ticket #${String(ticketId).slice(0,8)}).`);
      setOpen(false);
      setDetails('');
    } catch (e) {
      showErrorToast({ type: 'create' }, e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger><MoreVertical className="h-4 w-4 opacity-60" /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <Flag className="mr-2 h-4 w-4" /> Denunciar mensagem
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialog.Header>Denunciar mensagem</ResponsiveDialog.Header>
        <ResponsiveDialog.Body>
          <FormBody density="comfortable">
            <Field name="reason" required>
              <Field.Label>Motivo</Field.Label>
              <Field.Control>
                <Select value={reason} onChange={(v) => setReason(v as any)}>
                  <option value="harassment">Assedio / linguagem ofensiva</option>
                  <option value="spam">Spam / propaganda</option>
                  <option value="scam">Tentativa de golpe</option>
                  <option value="other">Outro</option>
                </Select>
              </Field.Control>
            </Field>
            <Field name="details">
              <Field.Label>Detalhes (opcional)</Field.Label>
              <Field.Control>
                <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
              </Field.Control>
              <Field.Hint>Maximo 1000 caracteres.</Field.Hint>
            </Field>
          </FormBody>
        </ResponsiveDialog.Body>
        <ResponsiveDialog.Footer>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Enviar denuncia</Button>
        </ResponsiveDialog.Footer>
      </ResponsiveDialog>
    </>
  );
}
```

### Wiring no MessageBubble
- Renderiza <MessageReportAction /> somente quando `message.sender_id !== currentUserId`
- Em mobile, o longpress (~500ms) abre o DropdownMenu (Radix ja suporta touch)

## Constraints / NÃO fazer
- ❌ Sem window.confirm (memory project_ui_patterns — usar ResponsiveDialog)
- ❌ Sem react-hook-form (Field + useState)
- ❌ Sem opcao de denunciar propria mensagem
- ❌ Sem Zod no client (validacao server em T-182)

## Convenções
- Reuse: ResponsiveDialog, DropdownMenu, Field+Select+Textarea, Button, Sonner, fetchOrThrow, showErrorToast (catalogo doc 04)
- Mobile-first; longpress como gesture primario, kebab icon como fallback
- Toast positivo confirma criacao do ticket
$desc$,
  'UI', 'ANY',
  ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','MOBILE_FIRST'],
  'draft', 'feature',
  '264e6d07-d365-43ba-8029-d539ce6f7c6b'::uuid,
  true,
  NOW(), NOW()
);

-- =====================================================================
-- TaskAcceptanceCriterion (N:N task → AC-da-Story)
-- =====================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT v.task_id::uuid, ac.id
FROM (VALUES
  -- T-178 DATA tabelas: AC1 (chat por contrato), AC6 (status), AC9 (RLS)
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66', 1),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66', 6),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66', 9),
  -- T-179 trigger lifecycle: AC1 (chat materializado), AC4 (moderacao desativa), AC8 (frozen)
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983', 1),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983', 4),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983', 8),
  -- T-180 RPC send_message: AC2, AC3, AC4, AC7, AC8
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127', 2),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127', 3),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127', 4),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127', 7),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127', 8),
  -- T-181 LLM moderate: AC3 (registro com motivo)
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6', 3),
  -- T-182 report endpoint: AC10
  ('cb55339d-3498-4d45-b124-8b8b75402d91', 10),
  -- T-183 emit.messageNew: AC5 (push offline)
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a', 5),
  -- T-184 realtime hook: AC5 (ao vivo), AC6 (status ao vivo)
  ('f6583514-0a40-4546-9305-ba83f6c0e38a', 5),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a', 6),
  -- T-185 chat thread page: AC1, AC6, AC9
  ('1adfd427-76fd-410c-9819-61fca14861fd', 1),
  ('1adfd427-76fd-410c-9819-61fca14861fd', 6),
  ('1adfd427-76fd-410c-9819-61fca14861fd', 9),
  -- T-186 composer outbox: AC5, AC6, AC7
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5', 5),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5', 6),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5', 7),
  -- T-187 pre-payment banner: AC2, AC3
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd', 2),
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd', 3),
  -- T-188 frozen banner: AC8
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3', 8),
  -- T-189 report action UI: AC10
  ('780c0597-79fc-4d03-9a02-42c37b8cc868', 10)
) AS v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id::uuid
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
 AND ac."order" = v.ac_order;

-- =====================================================================
-- AcceptanceCriterion (taskId=...) — checklist tecnico de pronto por task
-- =====================================================================

-- T-178
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'Migration aplicada via psql; database.types.ts regenerado com conversations/messages/message_moderation_logs', 0),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'ENUMs message_status (sending|delivered|read|blocked) e conversation_status (pre_payment|open|frozen) criados', 1),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'UNIQUE constraint conversations_unique_per_service garante 1:1 com service_request', 2),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'UNIQUE (conversation_id, sender_id, client_message_id) em messages garante idempotencia', 3),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'RLS: ator do contrato (client OU provider) le suas conversas; admin claim le tudo', 4),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'RLS: ator do contrato NAO le mensagens de outras conversations (smoke test SET ROLE)', 5),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'Sem CREATE POLICY de INSERT em messages para authenticated (so via RPC send_message)', 6),
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'Indices conv_client_idx, conv_provider_idx, msg_conv_created_idx ativos', 7);

-- T-179
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'Migration aplicada via psql', 0),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'Trigger trg_create_conversation_on_accept cria conversation status=pre_payment quando service_request vira accepted', 1),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'Trigger trg_sync_conversation_status muda status para open quando payment_status=captured', 2),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'Trigger muda para frozen quando service.status in (completed, cancelled), com prioridade sobre payment_status', 3),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'Funcoes SECURITY DEFINER com search_path=public,pg_temp e REVOKE FROM PUBLIC aplicados', 4),
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'Trigger e idempotente (ON CONFLICT DO NOTHING + condicao de mudanca de status)', 5);

-- T-180
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'RPC send_message criada SECURITY DEFINER + search_path + REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated', 0),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'Endpoint POST /api/conversations/[id]/messages valida body com Zod (400 em formato invalido)', 1),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, '403 quando auth.uid() nao e ator do contrato (mapeamento erro 42501)', 2),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, '409 quando conversation.status=frozen (mapeamento erro 23514)', 3),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'Pre-pagamento: regex local detecta phone/email/cpf/external_link e marca status=blocked + log em message_moderation_logs', 4),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'Pos-pagamento (open): nenhuma moderacao aplicada, status=delivered direto', 5),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'Mesmo client_message_id 2x retorna a mesma message row (idempotencia via UNIQUE + ON CONFLICT)', 6),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'last_message_at em conversations atualizado em cada send', 7),
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'emit.messageNew chamado fire-and-forget pos-COMMIT (nao bloqueia resposta)', 8);

-- T-181
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, 'Edge function moderate-message deployada e exigindo Authorization Bearer SUPABASE_SERVICE_ROLE_KEY (403 sem)', 0),
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, 'Chamada OpenAI gpt-4o-mini com response_format json_object retorna {bypass, reasons[]}', 1),
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, 'Quando bypass=true, atualiza messages.status=blocked e blocked_reason concatenado de reasons', 2),
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, 'Sempre grava message_moderation_logs com detector=llm (decision allow ou block)', 3),
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, 'Disparada fire-and-forget do route handler T-180 sem bloquear resposta 200', 4),
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, 'OPENAI_API_KEY e SUPABASE_SERVICE_ROLE_KEY lidos de Deno.env (nunca expostos no client)', 5);

-- T-182
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, 'Endpoint POST /api/conversations/[cid]/messages/[mid]/report valida body com Zod (400 em formato invalido)', 0),
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, '403 quando reporter nao e ator do contrato (RLS de messages aplica)', 1),
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, '404 quando messageId nao pertence a conversationId informada', 2),
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, 'Cria support_ticket categoria=abusive_message com reference_entity_type=message + reference_entity_id', 3),
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, 'Bloqueia denuncia de propria mensagem (sender_id != auth.uid())', 4),
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, 'Resposta retorna ticketId pra UI exibir referencia ao usuario', 5);

-- T-183
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'emit.messageNew calcula recipientId como contraparte do sender (client ou provider)', 0),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'Enfileira notification_event categoria=message_new com event_key=message_new:<messageId>', 1),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'Chamada com mesmo messageId 2x nao duplica evento (idempotencia via event_key UNIQUE)', 2),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'Templates web_push e whatsapp seedados em message_templates com placeholders {{senderName}}/{{excerpt}}', 3),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'Fire-and-forget no route handler (.catch console) — falha em emit nao quebra POST de mensagem', 4),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'Excerpt limitado a 120 chars na payload da notificacao', 5);

-- T-184
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'Hook subscreve conversation:{id} com 3 listeners (messages INSERT, messages UPDATE, conversations UPDATE)', 0),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'INSERT em messages chega na UI em <500ms (medido com 2 abas)', 1),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'UPDATE em messages.status (delivered→read|blocked) propaga sem novo fetch', 2),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'UPDATE em conversations.status (pre_payment→open→frozen) propaga sem refresh', 3),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'CHANNEL_ERROR ou TIMED_OUT ativa fallback polling 10s', 4),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'Cleanup no unmount remove channel e clearInterval do polling (sem leak)', 5),
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'RLS de messages e conversations garante que outro ator nao recebe eventos da conversa alheia', 6);

-- T-185
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Pagina /services/[id]/chat carrega 100 ultimas mensagens via SSR (server component)', 0),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Layout mobile-first com header sticky, lista scrollavel e composer fixo no rodape', 1),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Bolhas alinhadas por sender (esquerda contraparte, direita propria) sem avatar (memory feedback_chat_ui)', 2),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Indicador de status visivel em cada bolha propria: spinner sending, ✓ delivered, ✓✓ read (azul), bolha tachada blocked', 3),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Tooltip da bolha blocked exibe motivo (de blocked_reason)', 4),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'StatusChip do contrato no header reflete conversation.status (pre_payment/open/frozen)', 5),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Reuse: ChatComposer + conversation/ + StatusChip do design system (sem componente novo de bubble)', 6),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'Scroll preserva posicao quando usuario rolou pra cima manualmente (nao auto-scroll forcado)', 7);

-- T-186
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'clientMessageId gerado com crypto.randomUUID antes do submit', 0),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'Optimistic update: bolha sending aparece imediatamente; reconciliacao via INSERT do realtime', 1),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'Offline (navigator.onLine=false): mensagem persistida em localStorage chave chat-outbox:<convId>', 2),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'Evento window online dispara drain do outbox enviando todas as pendentes em ordem', 3),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'Drain repetido nao duplica mensagens (UNIQUE server retorna mesma row; UI remove pos-200)', 4),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'Reuso de ChatComposer existente sem fork (passa onSend prop)', 5),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, 'fetchOrThrow + showErrorToast tratam falhas (403/409/5xx/network)', 6);

-- T-187
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid, 'Quando conversation.status=pre_payment e role=client: composer disabled e PrePaymentBanner role=client visivel', 0),
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid, 'Quando role=provider em pre_payment: composer ativo + PrePaymentBanner role=provider explicando moderacao', 1),
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid, 'Banner some quando conversation.status muda para open (via REALTIME, sem refresh)', 2),
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid, 'Texto pt-BR claro: cliente entende que precisa pagar; prestador entende que ha moderacao', 3),
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid, 'Reuso: Card do design system com cores tokenizadas (sem CSS custom)', 4);

-- T-188
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid, 'Quando conversation.status=frozen: ChatInputWithOutbox e substituido por FrozenBanner', 0),
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid, 'Lista de mensagens permanece visivel e scrollavel (somente leitura)', 1),
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid, 'Banner indica reason=completed ou cancelled com texto pt-BR diferenciado', 2),
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid, 'Acao de denuncia (T-189) continua disponivel mesmo em frozen', 3),
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid, 'Reuso: Card + Lock icon (lucide-react)', 4);

-- T-189
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'Acao Denunciar mensagem so aparece em bolhas onde sender_id != currentUserId', 0),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'Longpress (mobile) ou kebab icon (desktop) abre DropdownMenu com Denunciar', 1),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'ResponsiveDialog abre com Field+Select (motivo) e Field+Textarea (detalhes opcional)', 2),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'Submit chama POST /api/conversations/[cid]/messages/[mid]/report e mostra toast com ticketId', 3),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'Erro de rede/403/409 mostra showErrorToast (sem alert nativo)', 4),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'Reuso: ResponsiveDialog, DropdownMenu, Field+Select+Textarea, Button, Sonner (sem componente novo)', 5),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'Sem react-hook-form e sem Zod no client', 6);

-- =====================================================================
-- TaskDependency (intra-US blocks + cross-US relates_to)
-- =====================================================================

-- intra-US blocks
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-179 trigger lifecycle depende das tabelas T-178
  ('e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'blocks'),
  -- T-180 RPC depende das tabelas T-178
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'blocks'),
  -- T-180 RPC depende do trigger T-179 (status=pre_payment como fonte de gating)
  ('195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'blocks'),
  -- T-181 LLM moderate depende das tabelas T-178 (escreve em messages e logs)
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'blocks'),
  -- T-181 LLM e' chamada do route handler que vive em T-180
  ('fab28a67-0149-42a9-b49f-fbc11d5eaaa6'::uuid, '195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'blocks'),
  -- T-182 report endpoint depende das tabelas T-178
  ('cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'blocks'),
  -- T-183 emit.messageNew depende das tabelas T-178
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'blocks'),
  -- T-184 realtime hook depende das tabelas T-178
  ('f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, '753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, 'blocks'),
  -- T-185 chat thread depende do realtime T-184 e do trigger T-179
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'f6583514-0a40-4546-9305-ba83f6c0e38a'::uuid, 'blocks'),
  ('1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'e275c58b-d8bf-469d-a4d9-dcaf8f32e983'::uuid, 'blocks'),
  -- T-186 composer outbox depende da RPC T-180 e do thread T-185
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, '195d8c70-240d-4ba3-9a33-c00b08fa3127'::uuid, 'blocks'),
  ('2eb864a0-85d9-469d-9a7a-79523e17fdf5'::uuid, '1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'blocks'),
  -- T-187 banner pre-payment depende do thread T-185
  ('6e3c73b7-7746-4d97-8d58-0b9f87ef1dcd'::uuid, '1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'blocks'),
  -- T-188 frozen depende do thread T-185
  ('67c4e7d4-e078-4deb-a771-e95ddc9e6df3'::uuid, '1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'blocks'),
  -- T-189 report action UI depende do endpoint T-182 e do thread T-185
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, 'cb55339d-3498-4d45-b124-8b8b75402d91'::uuid, 'blocks'),
  ('780c0597-79fc-4d03-9a02-42c37b8cc868'::uuid, '1adfd427-76fd-410c-9819-61fca14861fd'::uuid, 'blocks');

-- cross-US relates_to
INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-178 chat tables relates_to T-159 notification_events (mesmo padrao queue idempotencia)
  ('753ab520-0e03-421f-bdf5-d36ff0aaba66'::uuid, '4e3b21ff-4655-4998-ae41-d6a96ccceb5e'::uuid, 'relates_to'),
  -- T-183 emit.messageNew relates_to T-159, T-162, T-163, T-164, T-171
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, '4e3b21ff-4655-4998-ae41-d6a96ccceb5e'::uuid, 'relates_to'),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, '42af5179-9d07-4566-8fbe-eec1a72d7ee8'::uuid, 'relates_to'),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, '132ce5eb-e45b-4d9f-99ae-6c1543ad6192'::uuid, 'relates_to'),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, 'a2d4e09c-a902-4c19-9a37-09a38779267c'::uuid, 'relates_to'),
  ('e4acdb9a-f9ef-4165-8dca-72176f14cd0a'::uuid, '5ba4fdad-c731-4a6b-9c10-e11d396d960c'::uuid, 'relates_to');

COMMIT;
