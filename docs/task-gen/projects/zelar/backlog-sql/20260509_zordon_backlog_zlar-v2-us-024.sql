-- Backlog SQL — ZLAR-V2-US-024 (NOTIFICACAO / SISTEMA)
-- "Configurar plataforma de comunicacao (e-mail, mensageria externa, jobs)"
-- 11 tasks (2 OPS, 2 DATA, 4 API, 3 UI) — fundação técnica que US-022 consome

BEGIN;

-- ============================================================================
-- 1. Tasks
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- ---------------------------------------------------------------------------
-- T-167 OPS: Domain Resend SPF/DKIM/DMARC
-- ---------------------------------------------------------------------------
('472b8214-340b-4a5d-9724-786d8c2c84d4',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-167',
 'Configurar domínio Resend com SPF, DKIM e DMARC',
 $desc$## Objetivo
Provisionar o domínio remetente Zelar (`mail.zelar.com.br` ou similar) no Resend com SPF/DKIM/DMARC ativos antes do dia 1, garantindo entregabilidade desde a primeira transação. Cobre AC #1.

## Contexto
Módulo NOTIFICACAO. Esta task entrega a base que `sendEmail` (T-171) consome via `RESEND_API_KEY`. Sem domínio autenticado, e-mails caem em spam — risco direto pra recibo, KYC, alerta de disputa (todos transacionais obrigatórios). Senders padrão: `noreply@mail.zelar.com.br` (transacional) e `suporte@mail.zelar.com.br` (replies — caixa monitorada por suporte).

## Estado atual / O que substitui
`RESEND_API_KEY` já existe no `.env` (memory: provavelmente sandbox). Nenhum domínio próprio configurado.

## O que criar

### Provisionamento Resend
1. Criar domínio em Resend Dashboard → Domains → Add Domain (`mail.zelar.com.br`)
2. Resend gera 3 registros DNS:
   - `TXT @` SPF: `v=spf1 include:_spf.resend.com ~all` (soft-fail — coexistir com Google Workspace se houver)
   - `TXT resend._domainkey` DKIM: chave pública do Resend (gerada)
   - `TXT @` DMARC: `v=DMARC1; p=quarantine; rua=mailto:postmaster@zelar.com.br; pct=100`
3. Configurar registros no provedor DNS (Cloudflare/AWS Route53)
4. Aguardar verificação Resend (≤24h)
5. Confirmar dashboard mostra todos 3 registros como "Verified"

### Senders + From-Name
- Default sender: `Zelar <noreply@mail.zelar.com.br>`
- Reply-To: `suporte@zelar.com.br` (caixa real, monitorada)
- Friendly-from: pt-BR (categorias específicas customizam, ver T-172)

### Documentação no repo do produto
- `docs/runbook/email-domain.md` (criar): como rotacionar DKIM, processo se Resend rejeitar, fallback (SES futuro). Inclui screenshots dos registros DNS verificados.

### Variáveis de ambiente (Vault Supabase + .env do app)
```
RESEND_API_KEY=re_<live_key>
RESEND_FROM_EMAIL=noreply@mail.zelar.com.br
RESEND_FROM_NAME=Zelar
RESEND_REPLY_TO=suporte@zelar.com.br
RESEND_DOMAIN=mail.zelar.com.br
```

## Constraints / NÃO fazer
- ❌ Usar domínio raiz `zelar.com.br` como sender (afeta DMARC do site institucional, complica). Subdomínio `mail.zelar.com.br` isola
- ❌ DMARC `p=reject` antes de validar 1 semana com `p=quarantine` (risco de bouncing legítimo)
- ❌ Sender genérico tipo `info@` (impacto reputação). Sempre `noreply@` p/ transacional
- ❌ Compartilhar API key live com ambiente staging (criar key separada)

## Convenções
- Setup é one-shot mas reverter exige cuidado (delete DNS records → API key parada de funcionar)
- `RESEND_*` são secrets — server-only (memory `feedback_role_helpers_postgres` aplica equivalente p/ env)
- Documentar postmaster@ como caixa que recebe DMARC reports$desc$,
 'OPS', 'SISTEMA', ARRAY['SECRET_HANDLING'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-168 OPS: Catálogo de templates WA pré-aprovados na Meta
-- ---------------------------------------------------------------------------
('903a7d25-9568-4295-9008-0d53b300299b',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-168',
 'Registrar catálogo inicial de templates WhatsApp pré-aprovados na Meta',
 $desc$## Objetivo
Submeter à Meta (WhatsApp Business Platform) o conjunto inicial de templates de mensageria com placeholders documentados, todos pré-aprovados antes do go-live. Alterações posteriores ficam sob escopo de US-019 (admin de parametrização). Cobre AC #2.

## Contexto
Módulo NOTIFICACAO. Cada template Meta tem aprovação manual (5–10 dias úteis). Este card consolida o catálogo MVP — sem ele, US-022 dispatcher trava em "template_not_found" no canal WA. Templates referenciados por `template_key` dentro de `message_templates` (T-170) que mapeia categoria → template_key WA + template_key Email.

Fonte de truth do catálogo: brainstorm card "Templates WhatsApp — Catálogo Completo" (DSBrainstorm `f7baeb66-...`).

## Estado atual / O que substitui
Não existe. WA Business Account precisa ser provisionada (assumir já feito ou criar como pré-req em runbook).

## O que criar

### Catálogo MVP (pré-aprovação Meta)
Templates obrigatórios (categorias do enum `notification_category` em US-022 T-159):

| template_key WA | category | placeholders |
|---|---|---|
| `kyc_result_approved`           | kyc_result            | `{{1}}` nome do prestador |
| `kyc_result_rejected`           | kyc_result            | `{{1}}` nome, `{{2}}` motivo curto |
| `service_accepted_provider`     | service_accepted      | `{{1}}` data, `{{2}}` categoria, `{{3}}` bairro |
| `service_step_change_otw`       | service_step_change   | `{{1}}` nome prestador (cliente) |
| `service_step_change_arrived`   | service_step_change   | `{{1}}` nome prestador |
| `service_step_change_started`   | service_step_change   | `{{1}}` categoria |
| `service_step_change_completed` | service_step_change   | `{{1}}` link avaliação |
| `service_reminder_24h`          | service_reminder_24h  | `{{1}}` data, `{{2}}` categoria |
| `service_reminder_2h`           | service_reminder_2h   | `{{1}}` horário, `{{2}}` endereço |
| `service_cancelled`             | service_cancelled     | `{{1}}` data, `{{2}}` motivo |
| `payment_release_provider`      | payment_release       | `{{1}}` valor, `{{2}}` data |
| `dispute_alert`                 | dispute_alert         | `{{1}}` link painel |
| `dispute_decision`              | dispute_decision      | `{{1}}` resultado, `{{2}}` valor (se aplicável) |
| `provider_suspended`            | provider_suspended    | `{{1}}` motivo categoria, `{{2}}` link painel |
| `provider_appeal_decision`      | provider_appeal_decision | `{{1}}` resultado, `{{2}}` próximo passo |
| `provider_reactivated`          | provider_reactivated  | `{{1}}` data |

Total: 16 templates.

### Documentação por template
Pra cada um, registrar em `docs/runbook/whatsapp-templates.md` (criar):
- Nome exato submetido à Meta
- Categoria Meta (TRANSACTIONAL/MARKETING/AUTHENTICATION/UTILITY)
- Idioma (pt_BR)
- Texto completo com `{{N}}` numerado
- Política de placeholder Meta (sem URL/CTA inválida; sem ALL CAPS)
- Estado: `draft → submitted → approved | rejected (motivo)`

### Submissão Meta
1. Para cada template: WhatsApp Manager → Templates → Create Template
2. Categoria Meta:
   - **UTILITY**: lembretes, confirmação, status de serviço, decisão de disputa (categorias operacionais ou transacionais não-promocionais)
   - **AUTHENTICATION**: kyc_result (questionável — Meta classifica como UTILITY normalmente)
3. Salvar template_id retornado pela Meta em `message_templates` (T-170)
4. Aguardar aprovação. Rejected → revisar texto, ressubmeter

### Variáveis de ambiente
```
META_WHATSAPP_TOKEN=<long_lived_access_token>
META_WHATSAPP_PHONE_NUMBER_ID=<wa_business_phone_id>
META_WHATSAPP_BUSINESS_ACCOUNT_ID=<waba_id>
META_WHATSAPP_API_VERSION=v18.0
```

## Constraints / NÃO fazer
- ❌ Submeter templates com URL absoluta no body (Meta rejeita; usar texto + dizer "veja no app")
- ❌ Usar Meta categoria MARKETING pra qualquer template aqui (todos transacionais)
- ❌ Criar templates novos depois de go-live sem passar pela US-019 (governança de mudança)
- ❌ Hardcoded `template_id` — sempre por `template_key` em `message_templates` (T-170)
- ❌ Submeter em inglês — público é pt_BR exclusivamente

## Convenções
- `template_key` segue padrão `<category>_<discriminator>` em snake_case
- Categoria Meta documentada em runbook (mudança de categoria = re-aprovação)
- Salvar screenshot de "approved" pra cada template no runbook$desc$,
 'OPS', 'SISTEMA', ARRAY['SECRET_HANDLING','AUDIT_LOG'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-169 DATA: send_log tables (email/wa/push) + view metrics
-- ---------------------------------------------------------------------------
('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-169',
 'Criar email/whatsapp/push send_log + notification_metrics_v',
 $desc$## Objetivo
Tabelas de **registro técnico bruto** dos envios em cada provedor (Resend, WA Cloud API, Web Push/FCM). Diferente de `notification_deliveries` (US-022 T-159), que registra a tentativa de **domínio** (1 evento × N tentativas em N canais), `*_send_log` registra a chamada técnica do provedor — payload, response code, message_id externo, bounce, delivered, read (quando suportado). Cobre AC #3.

View `notification_metrics_v` agrega para AC #10 (admin monitoria).

## Contexto
Módulo NOTIFICACAO. Helpers `sendEmail`/`sendWhatsApp`/`sendWebPush` (T-171) escrevem 1 linha aqui por chamada. Webhooks externos (Resend webhook de bounce/delivery, WA webhook de status) atualizam status. ADMIN consulta agregado via T-176/T-177.

## Estado atual / O que substitui
Não existe. `notification_deliveries` (US-022) registra resultado em nível de domínio; aqui é por canal técnico.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_send_logs.sql`
```sql
BEGIN;

CREATE TYPE provider_send_status AS ENUM (
  'pending',     -- enviado pra provedor, aguardando confirmação
  'sent',        -- provedor aceitou
  'delivered',   -- provedor confirmou entrega ao destinatário (webhook)
  'opened',      -- só email (webhook open beacon, opcional)
  'bounced',     -- hard bounce
  'failed',      -- erro na chamada
  'rejected'     -- provedor rejeitou (rate limit, template inválido, etc)
);

-- Email send log (Resend).
CREATE TABLE email_send_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Vínculo opcional ao notification_event que originou (US-022).
  -- NULL para emails ad-hoc (ex: convite admin).
  notification_event_id uuid REFERENCES notification_events(id) ON DELETE SET NULL,
  to_email        text NOT NULL,
  from_email      text NOT NULL,
  subject         text NOT NULL,
  template_key    text,                            -- ref message_templates
  -- Resend message_id (pra correlacionar webhooks).
  resend_id       text UNIQUE,
  status          provider_send_status NOT NULL DEFAULT 'pending',
  -- Última atualização vinda de webhook.
  delivered_at    timestamptz,
  bounced_at      timestamptz,
  bounce_type     text,                            -- 'hard' | 'soft' | 'complaint'
  failure_reason  text,
  -- Payload bruto pro debug (opcional, sem dados sensíveis).
  request_payload jsonb,
  response_payload jsonb,
  attempt_number  smallint NOT NULL DEFAULT 1,     -- T-171 retry escreve attempts incrementais
  attempted_at    timestamptz NOT NULL DEFAULT NOW(),
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX email_send_log_event_idx ON email_send_log(notification_event_id);
CREATE INDEX email_send_log_status_idx ON email_send_log(status, attempted_at DESC);
CREATE INDEX email_send_log_resend_idx ON email_send_log(resend_id) WHERE resend_id IS NOT NULL;
CREATE INDEX email_send_log_template_idx ON email_send_log(template_key, attempted_at DESC);

-- WhatsApp send log (Meta WA Cloud).
CREATE TABLE whatsapp_send_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_event_id uuid REFERENCES notification_events(id) ON DELETE SET NULL,
  to_phone        text NOT NULL,                   -- E.164
  template_key    text NOT NULL,
  -- WA wamid (correlaciona webhooks).
  wamid           text UNIQUE,
  status          provider_send_status NOT NULL DEFAULT 'pending',
  delivered_at    timestamptz,
  read_at         timestamptz,                     -- WA confirma leitura
  failure_reason  text,
  request_payload jsonb,
  response_payload jsonb,
  attempt_number  smallint NOT NULL DEFAULT 1,
  attempted_at    timestamptz NOT NULL DEFAULT NOW(),
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX whatsapp_send_log_event_idx ON whatsapp_send_log(notification_event_id);
CREATE INDEX whatsapp_send_log_status_idx ON whatsapp_send_log(status, attempted_at DESC);
CREATE INDEX whatsapp_send_log_wamid_idx ON whatsapp_send_log(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX whatsapp_send_log_template_idx ON whatsapp_send_log(template_key, attempted_at DESC);

-- Web Push send log (FCM).
CREATE TABLE web_push_send_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_event_id uuid REFERENCES notification_events(id) ON DELETE SET NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Endpoint do PushSubscription do browser (truncado por privacidade no log).
  endpoint_hash   text,
  template_key    text,
  fcm_message_id  text,
  status          provider_send_status NOT NULL DEFAULT 'pending',
  delivered_at    timestamptz,
  failure_reason  text,
  attempt_number  smallint NOT NULL DEFAULT 1,
  attempted_at    timestamptz NOT NULL DEFAULT NOW(),
  "createdAt"     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX web_push_send_log_event_idx ON web_push_send_log(notification_event_id);
CREATE INDEX web_push_send_log_status_idx ON web_push_send_log(status, attempted_at DESC);

-- View de métricas (consumido pelo admin dashboard, T-176/T-177).
-- Agrega last 30 dias por canal × template × dia.
CREATE OR REPLACE VIEW notification_metrics_v AS
WITH all_logs AS (
  SELECT 'email'::text AS channel, template_key, status, attempted_at
    FROM email_send_log
    WHERE attempted_at > NOW() - interval '30 days'
  UNION ALL
  SELECT 'whatsapp'::text, template_key, status, attempted_at
    FROM whatsapp_send_log
    WHERE attempted_at > NOW() - interval '30 days'
  UNION ALL
  SELECT 'web_push'::text, template_key, status, attempted_at
    FROM web_push_send_log
    WHERE attempted_at > NOW() - interval '30 days'
)
SELECT
  channel,
  template_key,
  date_trunc('day', attempted_at)::date AS day,
  COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened'))           AS sent,
  COUNT(*) FILTER (WHERE status = 'delivered')                              AS delivered,
  COUNT(*) FILTER (WHERE status = 'bounced')                                AS bounced,
  COUNT(*) FILTER (WHERE status IN ('failed','rejected'))                   AS failed,
  COUNT(*)                                                                  AS total
FROM all_logs
GROUP BY channel, template_key, date_trunc('day', attempted_at);

-- RLS — apenas admin lê. Service role escreve.
ALTER TABLE email_send_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_send_log_admin"    ON email_send_log
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "whatsapp_send_log_admin" ON whatsapp_send_log
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "web_push_send_log_admin" ON web_push_send_log
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- View herda RLS das tabelas-base.

COMMIT;
```

### Webhooks Resend / WA (escopo desta task)
- `/api/webhooks/resend/route.ts` — eventos `email.sent`, `email.delivered`, `email.bounced`, `email.complained`. UPDATE em `email_send_log` por `resend_id`.
- `/api/webhooks/whatsapp/route.ts` — Meta webhook (status: `sent`, `delivered`, `read`, `failed`). UPDATE em `whatsapp_send_log` por `wamid`.

(Implementação detalhada em T-171 — aqui só a tabela.)

## Constraints / NÃO fazer
- ❌ Permitir SELECT pra non-admin (privacidade — log contém destinatários e templates)
- ❌ Logar payload sensível (senha, código de confirmação, token) — sanitizar antes de salvar `request_payload`
- ❌ Reusar `id` entre attempts — cada retry vira nova linha (`attempt_number=2,3...`) referenciando mesmo `notification_event_id`
- ❌ Apagar log antigo sem retenção definida — manter ≥90 dias (regulatório/auditoria)

## Convenções
- ENUMs reusam padrão snake_case
- View tem janela 30d hardcoded — admin que quiser histórico maior consulta via SQL
- Índices em `(status, attempted_at DESC)` cobrem dashboard "últimas falhas" sem scan$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-170 DATA: message_templates + tolerance_window
-- ---------------------------------------------------------------------------
('de1e7b27-9179-405f-b7d5-65f4d41bba42',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-170',
 'Criar message_templates (catálogo) + tolerance_window em schedules',
 $desc$## Objetivo
Catálogo central de templates por canal × categoria × idioma. Substitui qualquer hardcoded de texto/template_key no código. Cobre parte de AC #2 (registro de placeholders) e AC #5 (tolerance window evita disparo duplicado em jobs com pequeno atraso/replay).

## Contexto
Módulo NOTIFICACAO. Lido pelo helper `renderTemplate` (T-172). 1 linha por (channel, category, locale). Para WA, contém o `template_id` que a Meta retornou na aprovação (T-168). Para email, contém `subject` e referência ao componente JSX (T-173) por slug. Versionável: ao atualizar texto WA (US-019 reaprova na Meta), nova linha com `version` incrementado e `current=true` no novo, `current=false` no antigo (audit trail).

Tolerance window: schedules de US-022 T-161 tem `fire_at`. Se o cron atrasar 30s ou replay acontecer, materializar 2× é problema só se NÃO houver tolerância. Adicionando coluna `materialize_tolerance interval` em `notification_schedules` (que combina com idempotência via UNIQUE event_key) cobre AC #5 explicitamente.

## Estado atual / O que substitui
Não existe `message_templates`. `notification_schedules` (US-022 T-161) já existe — esta task **expande** com 1 coluna.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_message_templates.sql`
```sql
BEGIN;

CREATE TYPE template_channel AS ENUM ('email', 'whatsapp', 'web_push');

CREATE TABLE message_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lookup key — combinação de canal + categoria + locale.
  template_key    text NOT NULL,                   -- ex: 'kyc_result_approved'
  channel         template_channel NOT NULL,
  category        notification_category NOT NULL,  -- enum de US-022 T-159
  locale          text NOT NULL DEFAULT 'pt_BR',
  -- Versionamento: só 1 (template_key, channel, locale) tem current=true.
  version         integer NOT NULL DEFAULT 1,
  current         boolean NOT NULL DEFAULT true,
  -- Conteúdo.
  -- Email: subject + body_html_component_slug (ref a T-173) + body_text (fallback)
  -- WA:    template_id (Meta) + body_text local pra validar placeholder count
  -- Push:  title + body
  subject         text,                            -- email only
  body_text       text,                            -- always (fallback, validation)
  body_component_slug text,                        -- email: nome do componente em src/emails/
  meta_template_id text,                           -- WA template id from Meta
  meta_template_status text,                       -- approved | pending | rejected
  -- Placeholders esperados (validação antes de enviar).
  placeholders    text[] NOT NULL DEFAULT ARRAY[]::text[],  -- ex: ['name','reason']
  notes           text,                            -- documentação livre
  "createdAt"     timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW(),
  CHECK (NOT current OR (current AND version > 0))
);

-- 1 ativo por (key, channel, locale).
CREATE UNIQUE INDEX message_templates_current_idx
  ON message_templates(template_key, channel, locale)
  WHERE current = true;

CREATE INDEX message_templates_lookup_idx
  ON message_templates(category, channel, locale)
  WHERE current = true;

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- authenticated lê (helper renderTemplate roda no contexto do request).
CREATE POLICY "message_templates_authenticated_select" ON message_templates
  FOR SELECT TO authenticated USING (current = true);

-- Admin escreve via UI futura (US-019). Aqui só seed via service_role.
CREATE POLICY "message_templates_admin_all" ON message_templates
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

-- ====================================================================
-- Tolerance window em notification_schedules (cobre AC #5 explicitamente).
-- Idempotência via event_key UNIQUE já trata replay; tolerance permite
-- "está atrasado mas ainda dispara" vs "atrasado demais, dropa".
-- ====================================================================
ALTER TABLE notification_schedules
  ADD COLUMN materialize_tolerance interval NOT NULL DEFAULT interval '15 minutes';

-- Atualizar materialize_due_notification_schedules pra checar tolerance:
-- se NOW() > fire_at + materialize_tolerance, marca como cancelled='expired'.
-- (Implementação na função; aqui só a coluna.)

COMMIT;
```

### Seed inicial (chore — rodar após T-167/T-168 deployados)
```sql
-- Seed templates email + wa pras 16 categorias documentadas em T-168.
-- Service role only.
INSERT INTO message_templates (template_key, channel, category, subject, body_text, body_component_slug, placeholders, notes) VALUES
  ('kyc_result_approved', 'email', 'kyc_result',
   'Seu cadastro foi aprovado!',
   'Olá {{name}}, seu cadastro como prestador foi aprovado. Acesse o app para configurar disponibilidade e dados bancários.',
   'KycApprovedEmail', ARRAY['name'], 'Disparado quando KYC retorna approved'),
  ('kyc_result_approved', 'whatsapp', 'kyc_result',
   NULL, 'Seu cadastro foi aprovado, {{1}}!', NULL, ARRAY['name'], 'Meta template_id após aprovação'),
  -- ... (mais 30 inserts pros outros 15 templates × 2 canais)
;

-- meta_template_id é populado pela admin UI quando registrar aprovação Meta (T-168).
```

## Constraints / NÃO fazer
- ❌ Permitir 2 linhas current=true pra mesma (key, channel, locale) — UNIQUE parcial impede
- ❌ Apagar templates antigos — versão antiga vai pra `current=false` (audit trail)
- ❌ tolerance_window > 1h (lembrete de 2h disparar 1.5h depois é confuso pro user)
- ❌ Template Email sem `body_text` fallback (AC #7 exige fallback texto)
- ❌ Mexer em `notification_schedules` além do ADD COLUMN (resto é US-022)

## Convenções
- `template_key` segue mesmo padrão do brainstorm/T-168 (snake_case, prefixo categoria)
- Versionamento via flag `current` é mais simples que tabela paralela `_history` (manter inline ajuda admin)
- `material_tolerance` default 15min — calibrado em US-019 sem deploy se necessário$desc$,
 'DATA', 'SISTEMA', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-171 API: comms.ts (provider helpers + retry+backoff)
-- ---------------------------------------------------------------------------
('5ba4fdad-c731-4a6b-9c10-e11d396d960c',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-171',
 'Implementar comms.ts (sendEmail/sendWhatsApp/sendWebPush + retry/backoff)',
 $desc$## Objetivo
Lib server-only com helpers de envio por canal. Cada helper:
1. Valida template (placeholders presentes via `message_templates`)
2. Insere linha em `*_send_log` antes da chamada externa (status `pending`)
3. Faz a chamada ao provedor (Resend / WA / FCM)
4. Em falha transitória: retry com backoff exponencial (2 tentativas, intervalo 1s e 4s)
5. Atualiza linha com response (`sent` ou `failed`)
6. Webhook do provedor (em rota separada) atualiza `delivered/bounced/read` depois

Cobre AC #4 (retry com backoff + fallback). Note que a **chain de fallback entre canais** mora em US-022 T-163 (dispatcher); aqui é o retry **dentro** de um canal.

## Contexto
Módulo NOTIFICACAO. Edge Function `dispatch-notifications` (US-022 T-163) chama `sendEmail/sendWhatsApp/sendWebPush` daqui. Webhooks (`/api/webhooks/resend`, `/api/webhooks/whatsapp`) também ficam neste arquivo (logica compartilhada).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/lib/notifications/comms.ts` (server-only)
```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { renderTemplate } from './templates'; // T-172

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESEND_FROM    = `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`;
const RESEND_REPLY   = process.env.RESEND_REPLY_TO!;

const META_TOKEN     = process.env.META_WHATSAPP_TOKEN!;
const META_PHONE_ID  = process.env.META_WHATSAPP_PHONE_NUMBER_ID!;
const META_API_VER   = process.env.META_WHATSAPP_API_VERSION ?? 'v18.0';

const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY!;

const RETRY_DELAYS_MS = [1000, 4000];  // exponencial 1s, 4s

// ----------------------- EMAIL (Resend) -----------------------
export async function sendEmail(input: {
  notificationEventId?: string;
  to: string;
  category: NotificationCategory;
  locale?: 'pt_BR';
  payload: Record<string, unknown>;
}): Promise<{ providerId: string; templateKey: string }> {
  const sb = createAdminClient();
  const { templateKey, subject, html, text } = await renderTemplate({
    channel: 'email',
    category: input.category,
    locale: input.locale ?? 'pt_BR',
    payload: input.payload,
  });

  // 1) Insert pending log.
  const { data: log } = await sb.from('email_send_log').insert({
    notification_event_id: input.notificationEventId ?? null,
    to_email: input.to,
    from_email: RESEND_FROM,
    subject,
    template_key: templateKey,
    status: 'pending',
    request_payload: { templateKey, payloadKeys: Object.keys(input.payload) }, // sem dados sensíveis
    attempt_number: 1,
  }).select().single();

  // 2) Try with retries.
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: input.to,
          subject,
          html,
          text,                                // plain text fallback (AC #7)
          reply_to: RESEND_REPLY,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(body)}`);

      await sb.from('email_send_log').update({
        status: 'sent',
        resend_id: body.id,
        response_payload: body,
        attempt_number: attempt,
      }).eq('id', log!.id);

      return { providerId: body.id, templateKey };
    } catch (e) {
      lastErr = e as Error;
      // Erro 4xx (exceto 429) não é retryable.
      if (/^resend 4(?!29)/.test(lastErr.message)) break;
      // Aguarda backoff antes da próxima tentativa.
      if (attempt <= RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }

  await sb.from('email_send_log').update({
    status: 'failed',
    failure_reason: lastErr!.message.slice(0, 500),
    attempt_number: RETRY_DELAYS_MS.length + 1,
  }).eq('id', log!.id);

  throw lastErr;
}

// ----------------------- WHATSAPP (Meta Cloud API) -----------------------
export async function sendWhatsApp(input: {
  notificationEventId?: string;
  toPhone: string;          // E.164
  category: NotificationCategory;
  locale?: 'pt_BR';
  payload: Record<string, unknown>;
}): Promise<{ providerId: string; templateKey: string }> {
  // Mesma estrutura: insert pending → tentar 3× com backoff → update sent/failed.
  // Body Meta: { messaging_product: 'whatsapp', to, type: 'template',
  //              template: { name: <key>, language: { code: 'pt_BR' },
  //                          components: [{ type: 'body', parameters: [...] }] } }
  // ... (similar ao sendEmail)
  return { providerId: '...', templateKey: '...' };
}

// ----------------------- WEB PUSH (Web Push Protocol + FCM) -----------------------
export async function sendWebPush(input: {
  notificationEventId?: string;
  userId: string;
  category: NotificationCategory;
  payload: Record<string, unknown>;
}): Promise<{ providerId: string; templateKey: string }> {
  // 1) Achar push_subscriptions ativas do user (tabela criada em US futura "Push setup").
  // 2) Enviar via web-push lib pra cada subscription. Em 410 (gone), marcar inactive.
  // 3) Fallback FCM se web-push falhar e user tiver token FCM.
  return { providerId: '...', templateKey: '...' };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

### Webhooks
- `src/app/api/webhooks/resend/route.ts` — POST. Verifica assinatura HMAC do Resend (header `svix-signature`). Para cada evento (`email.delivered`, `email.bounced`, `email.complained`, `email.opened`), UPDATE em `email_send_log` por `resend_id`.
- `src/app/api/webhooks/whatsapp/route.ts` — POST + GET. GET verifica challenge da Meta (`hub.verify_token`). POST: para cada `entry.changes[].value.statuses[]`, UPDATE em `whatsapp_send_log` por `wamid` (status: sent/delivered/read/failed).

```typescript
// src/app/api/webhooks/whatsapp/route.ts (snippet)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === process.env.META_WA_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.json();
  // Validar X-Hub-Signature-256 (HMAC SHA256 do body com app_secret).
  // ...
  const sb = createAdminClient();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        await sb.from('whatsapp_send_log').update({
          status: mapWaStatus(status.status),
          delivered_at: status.timestamp ? new Date(parseInt(status.timestamp) * 1000).toISOString() : null,
          read_at: status.status === 'read' ? new Date(parseInt(status.timestamp) * 1000).toISOString() : null,
          failure_reason: status.errors?.[0]?.message ?? null,
        }).eq('wamid', status.id);
      }
    }
  }
  return Response.json({ ok: true });
}
```

### Modo mock (continua de US-022)
- `if (process.env.NOTIFY_USE_MOCK === '1')`: skip chamada real, gerar `provider_id = 'mock_<rand>'`, status `sent`. Permite dev/CI sem credentials reais.

## Constraints / NÃO fazer
- ❌ Retry em erro 4xx não-retryable (400 validation, 401 auth, 422 template inválido) — só 5xx + 429 + network/timeout
- ❌ Bloquear thread com `await sleep` no path principal; este código roda em Edge Function timeout 60s — backoff total ≤ 5s deixa folga
- ❌ Vazar `RESEND_API_KEY` ou `META_TOKEN` em payload logado (pré-filtrar `request_payload`)
- ❌ Verificar webhook sem assinatura HMAC (todo mundo manda POST `/api/webhooks/*`; sem assinatura = vulnerabilidade)

## Convenções
- Backoff fixo `[1s, 4s]` — total max ~5s (cabe em Edge Function 60s mesmo com 50 events no batch)
- Webhooks ficam em `/api/webhooks/*` (já é convenção do projeto, ver US-011 mp webhook)
- `mapWaStatus` é função pequena no mesmo arquivo, não vale extrair
- HMAC verification helper compartilhado em `src/lib/notifications/webhook-auth.ts`$desc$,
 'API', 'SISTEMA', ARRAY['SECRET_HANDLING','RATE_LIMIT','INPUT_VALIDATION','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-172 API: templates.ts (renderTemplate via catalog)
-- ---------------------------------------------------------------------------
('61971f34-fc87-4850-b899-41c3d04cf59e',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-172',
 'Implementar templates.ts (renderTemplate por catálogo + components React Email)',
 $desc$## Objetivo
Lib server-only que resolve `(channel, category, locale)` → conteúdo pronto pra enviar (subject, html, text, ou template_id WA + params, ou title+body push). Lê de `message_templates` (T-170) e renderiza componentes React Email (T-173) pro canal email. Cobre parte de AC #2 (placeholders documentados) e AC #7 (componentes reutilizáveis + fallback texto).

## Contexto
Módulo NOTIFICACAO. Único caller: `comms.ts` (T-171). Mantém isolamento entre "como eu envio" (T-171) e "o que eu envio" (esta task). Renderização Email via `@react-email/components` que vira HTML. Renderização WA é só substituição de placeholders no template já aprovado.

## Estado atual / O que substitui
Não existe. Hoje todo texto seria hardcoded no helper de envio.

## O que criar

### `src/lib/notifications/templates.ts` (server-only)
```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { render } from '@react-email/render';

// Mapa estático slug → componente React. Carrega dinâmico ou estático;
// estático evita chunk dinâmico no Edge.
import * as EmailTemplates from '@/emails';   // T-173 — barrel export

type Channel = 'email' | 'whatsapp' | 'web_push';

interface RenderArgs {
  channel: Channel;
  category: NotificationCategory;
  locale?: 'pt_BR';
  payload: Record<string, unknown>;
}

interface EmailRendered {
  templateKey: string;
  subject: string;
  html: string;
  text: string;
}

interface WaRendered {
  templateKey: string;
  metaTemplateId: string;
  components: Array<{ type: 'body'; parameters: Array<{ type: 'text'; text: string }> }>;
}

interface PushRendered {
  templateKey: string;
  title: string;
  body: string;
}

export async function renderTemplate(args: RenderArgs): Promise<EmailRendered | WaRendered | PushRendered> {
  const sb = createAdminClient();
  const { data: tpl } = await sb.from('message_templates')
    .select('*')
    .eq('channel', args.channel)
    .eq('category', args.category)
    .eq('locale', args.locale ?? 'pt_BR')
    .eq('current', true)
    .single();

  if (!tpl) throw new Error(`template_not_found: ${args.channel}/${args.category}`);

  // Validar placeholders.
  for (const p of tpl.placeholders) {
    if (!(p in args.payload)) throw new Error(`template_placeholder_missing: ${p}`);
  }

  switch (args.channel) {
    case 'email': {
      const Component = (EmailTemplates as Record<string, React.FC<any>>)[tpl.body_component_slug!];
      if (!Component) throw new Error(`email_component_not_found: ${tpl.body_component_slug}`);
      const html = await render(Component(args.payload), { pretty: false });
      const text = renderPlainText(tpl.body_text!, args.payload);  // T-170 body_text como fallback
      return { templateKey: tpl.template_key, subject: interpolate(tpl.subject!, args.payload), html, text };
    }

    case 'whatsapp': {
      // Meta espera array de parameters na ordem dos placeholders.
      const components = [{
        type: 'body' as const,
        parameters: tpl.placeholders.map((p) => ({
          type: 'text' as const,
          text: String(args.payload[p] ?? ''),
        })),
      }];
      return { templateKey: tpl.template_key, metaTemplateId: tpl.meta_template_id!, components };
    }

    case 'web_push': {
      return {
        templateKey: tpl.template_key,
        title: interpolate(tpl.subject ?? '', args.payload),
        body: interpolate(tpl.body_text ?? '', args.payload),
      };
    }
  }
}

function interpolate(t: string, p: Record<string, unknown>): string {
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => String(p[k] ?? ''));
}

function renderPlainText(t: string, p: Record<string, unknown>): string {
  return interpolate(t, p);
}
```

### Convenção de cache (opcional)
Como `message_templates` muda raramente, considerar cache em-memória 5min por (channel, category) para reduzir SELECT em loop de 50 events. Implementar via `Map` simples; invalidar via key=`'all'` quando admin atualizar template (US-019 emite trigger pra cache bust — fora do escopo MVP).

## Constraints / NÃO fazer
- ❌ Renderizar email com React Server Components — `@react-email/components` é client-side-React-pra-HTML, roda em qualquer runtime (Node/Edge). Mas confirmar compatibilidade Edge antes
- ❌ Inject HTML do payload sem escape — `@react-email/render` faz escape automático em JSX, mas se passar `dangerouslySetInnerHTML`, abre XSS
- ❌ Reutilizar template inativo (`current=false`) — view-side filter no SELECT
- ❌ Falhar silencioso quando placeholder ausente — throw `template_placeholder_missing` faz dispatcher logar e avançar pro fallback channel

## Convenções
- Plain text é fallback obrigatório de email (AC #7) — todo template tem `body_text`
- Componente React Email referenciado por slug texto, não import dinâmico (Edge não suporta `import()` em alguns casos)
- Sempre validar placeholders antes de renderizar (falha cedo > falha no provedor)$desc$,
 'API', 'SISTEMA', ARRAY['INPUT_VALIDATION','SECRET_HANDLING'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-173 UI: Componentes React Email reutilizáveis
-- ---------------------------------------------------------------------------
('88aa0807-65df-4a34-9b75-7bb95e4b5bd4',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-173',
 'Criar componentes React Email (Header, Footer, Button, ServiceSummary, FinancialBreakdown)',
 $desc$## Objetivo
Biblioteca de componentes JSX que `@react-email/components` transforma em HTML cross-client (Gmail, Outlook, mobile mail). Cobre AC #7 (componentes reutilizáveis + fallback texto). Cada template específico (`KycApprovedEmail`, `PaymentReceiptEmail`, etc) compõe destes blocos.

## Contexto
Módulo NOTIFICACAO. Renderizado por `renderTemplate` (T-172). Stack: `@react-email/components` (versão estável). Tipografia/cor seguem brand Zelar (definir tokens). Acessibilidade: contraste mínimo, alt text em imagens, links com texto descritivo.

## Estado atual / O que substitui
Não existe. `react-email` provavelmente não está instalado no projeto.

## O que criar

### Dep
```bash
pnpm add @react-email/components @react-email/render
pnpm add -D react-email
```

### `src/emails/_components/` (blocos reusáveis)

#### `EmailLayout.tsx`
```tsx
import { Html, Head, Body, Container, Preview } from '@react-email/components';
import { EmailHeader } from './EmailHeader';
import { EmailFooter } from './EmailFooter';

export function EmailLayout({ preview, children, includeUnsubscribe = true, unsubscribeToken }: {
  preview: string;
  children: React.ReactNode;
  includeUnsubscribe?: boolean;
  unsubscribeToken?: string;
}) {
  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ background: '#f5f5f5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <Container style={{ background: '#fff', maxWidth: 560, padding: 32, margin: '24px auto' }}>
          <EmailHeader />
          {children}
          <EmailFooter includeUnsubscribe={includeUnsubscribe} unsubscribeToken={unsubscribeToken} />
        </Container>
      </Body>
    </Html>
  );
}
```

#### `EmailHeader.tsx`
```tsx
import { Img, Section } from '@react-email/components';

export function EmailHeader() {
  return (
    <Section style={{ paddingBottom: 16, borderBottom: '1px solid #eee' }}>
      <Img src="https://zelar.com.br/logo-email.png" alt="Zelar" width="120" height="32" />
    </Section>
  );
}
```

#### `EmailFooter.tsx`
```tsx
import { Section, Text, Link, Hr } from '@react-email/components';

export function EmailFooter({ includeUnsubscribe, unsubscribeToken }: {
  includeUnsubscribe: boolean;
  unsubscribeToken?: string;
}) {
  return (
    <Section style={{ paddingTop: 24, marginTop: 24 }}>
      <Hr />
      <Text style={{ fontSize: 12, color: '#777' }}>
        Zelar — serviços de manutenção residencial.
      </Text>
      {includeUnsubscribe && unsubscribeToken && (
        <Text style={{ fontSize: 12, color: '#777' }}>
          Não quer mais receber e-mails operacionais?{' '}
          <Link href={`https://app.zelar.com.br/unsubscribe/${unsubscribeToken}`}>
            Descadastrar
          </Link>
        </Text>
      )}
    </Section>
  );
}
```

#### `EmailButton.tsx`
```tsx
import { Button } from '@react-email/components';

export function EmailButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button href={href} style={{
      background: '#2563eb', color: '#fff', padding: '12px 20px',
      borderRadius: 6, textDecoration: 'none', display: 'inline-block',
    }}>
      {children}
    </Button>
  );
}
```

#### `ServiceSummaryBlock.tsx`
```tsx
import { Section, Text, Row, Column } from '@react-email/components';

export function ServiceSummaryBlock({ category, scheduledAt, address, providerName }: {
  category: string; scheduledAt: string; address: string; providerName?: string;
}) {
  return (
    <Section style={{ background: '#f9fafb', padding: 16, borderRadius: 8, margin: '16px 0' }}>
      <Row><Column><Text style={{ fontWeight: 600 }}>{category}</Text></Column></Row>
      <Row><Column><Text>{scheduledAt}</Text></Column></Row>
      <Row><Column><Text>{address}</Text></Column></Row>
      {providerName && <Row><Column><Text>Prestador: {providerName}</Text></Column></Row>}
    </Section>
  );
}
```

#### `FinancialBreakdownBlock.tsx`
```tsx
import { Section, Row, Column, Text, Hr } from '@react-email/components';

export function FinancialBreakdownBlock({ items, total }: {
  items: Array<{ label: string; amount: string }>;
  total: string;
}) {
  return (
    <Section style={{ margin: '16px 0' }}>
      {items.map((it, i) => (
        <Row key={i}>
          <Column><Text>{it.label}</Text></Column>
          <Column align="right"><Text>{it.amount}</Text></Column>
        </Row>
      ))}
      <Hr />
      <Row>
        <Column><Text style={{ fontWeight: 600 }}>Total</Text></Column>
        <Column align="right"><Text style={{ fontWeight: 600 }}>{total}</Text></Column>
      </Row>
    </Section>
  );
}
```

### `src/emails/` — templates por categoria
Pelo menos esqueleto pra cada categoria do MVP (16 totais — T-168). Exemplo:

```tsx
// src/emails/KycApprovedEmail.tsx
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './_components/EmailLayout';
import { EmailButton } from './_components/EmailButton';

export default function KycApprovedEmail({ name, unsubscribeToken }: { name: string; unsubscribeToken?: string }) {
  return (
    <EmailLayout preview={`Cadastro aprovado, ${name}!`} unsubscribeToken={unsubscribeToken} includeUnsubscribe={false /* obrigatório */}>
      <Heading>Bem-vindo, {name}!</Heading>
      <Text>Seu cadastro como prestador foi aprovado. Configure disponibilidade e dados bancários no app pra começar a receber serviços.</Text>
      <EmailButton href="https://app.zelar.com.br/(provider)/onboarding/post-approval">Configurar agora</EmailButton>
    </EmailLayout>
  );
}
```

### `src/emails/index.ts` — barrel export consumido por T-172
```ts
export { default as KycApprovedEmail } from './KycApprovedEmail';
export { default as KycRejectedEmail } from './KycRejectedEmail';
export { default as PaymentReceiptEmail } from './PaymentReceiptEmail';
// ... outros
```

### Preview dev (`react-email`)
`pnpm exec email dev` abre preview em localhost:3001. Cada template renderiza com payload de exemplo.

## Constraints / NÃO fazer
- ❌ Tailwind CSS direto em JSX (Gmail/Outlook não suportam classes — `@react-email/tailwind` faz inline; ainda assim, inline-style é mais previsível)
- ❌ Imagens linkando localhost ou URL com auth (precisa CDN público — Cloudinary/Supabase Storage public)
- ❌ Esquecer `<Preview>` (texto que aparece no inbox antes do user abrir)
- ❌ Adicionar componentes JS interativos (email é HTML estático; sem JS)
- ❌ Esquecer fallback texto em template — `body_text` em `message_templates` (T-170) é a fonte; `renderPlainText` (T-172) renderiza

## Convenções
- Estilo inline (não CSS classes) — máximo de cliente compatibility
- Cor primária #2563eb (azul-600) — alinhar com brand do projeto
- Largura máxima 560px (mobile-friendly)
- Componentes em `src/emails/_components/` (underscore prefix indica "interno", não rota Next)$desc$,
 'UI', 'SISTEMA', ARRAY['REUSE_EXISTING_COMPONENT','A11Y_REVIEW','MOBILE_FIRST'],
 'draft', 'component',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-174 API: unsubscribe token + endpoint
-- ---------------------------------------------------------------------------
('46e061d2-60d8-48bf-b60d-83749e8b51d9',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-174',
 'Implementar unsubscribe token + GET/POST /api/unsubscribe/[token]',
 $desc$## Objetivo
Gerar token assinado (JWT ou HMAC) único por user × email category bucket pra incluir no rodapé de e-mails operacionais. Endpoint público resolve token, valida e atualiza `notification_preferences` (US-022 T-160). Cobre AC #8 (link descadastramento em operacionais; transacionais obrigatórios não têm).

## Contexto
Módulo NOTIFICACAO. Token vai em todo email operacional via componente `EmailFooter` (T-173). Sem login necessário pra descadastrar (CAN-SPAM/LGPD friendly). Public route protegida só por token.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/lib/notifications/unsubscribe.ts` (server-only)
```typescript
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.UNSUBSCRIBE_SECRET!;  // 32+ bytes random

interface TokenPayload {
  userId: string;
  category: string;            // 'all_operational' OR specific notification_category
  issuedAt: number;            // unix ms
}

export function signUnsubscribeToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): TokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  // timing-safe compare.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    // Token vale 90 dias.
    if (Date.now() - payload.issuedAt > 90 * 24 * 60 * 60 * 1000) return null;
    return payload;
  } catch { return null; }
}
```

### `src/app/api/unsubscribe/[token]/route.ts`
```typescript
import { verifyUnsubscribeToken } from '@/lib/notifications/unsubscribe';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

// GET: validar token e retornar JSON (consumido pelo SSR de /unsubscribe/[token]).
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return Response.json({ error: 'invalid_or_expired' }, { status: 400 });
  return Response.json({
    userId: payload.userId,
    category: payload.category,
    issuedAt: payload.issuedAt,
  });
}

const Body = z.object({
  // 'all_operational' = opt-out de todas operacionais; ou category específica
  scope: z.union([z.literal('all_operational'), z.string()]),
  channels: z.array(z.enum(['email', 'whatsapp', 'web_push'])).default(['email']),
});

const OPERATIONAL_CATEGORIES = [
  'service_accepted', 'service_step_change',
  'service_reminder_24h', 'service_reminder_2h',
  'service_cancelled', 'message_new',
];

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return Response.json({ error: 'invalid_or_expired' }, { status: 400 });

  const body = Body.parse(await req.json());
  const sb = createAdminClient();

  const cats = body.scope === 'all_operational'
    ? OPERATIONAL_CATEGORIES
    : [body.scope];

  const upserts = cats.flatMap(category =>
    body.channels.map(channel => ({
      user_id: payload.userId,
      category,
      channel,
      enabled: false,
    }))
  );

  const { error } = await sb.from('notification_preferences').upsert(upserts);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, optedOutCategories: cats, channels: body.channels });
}
```

### Geração de token na hora do envio (T-171 chama)
```typescript
// Em comms.ts antes de enviar email operacional, gera token e injeta no payload
// pro EmailLayout (T-173) renderizar no footer.
const isOperational = !MANDATORY_CATEGORIES.has(input.category);
const unsubscribeToken = isOperational
  ? signUnsubscribeToken({ userId: recipientId, category: input.category, issuedAt: Date.now() })
  : undefined;
```

### Var de ambiente
```
UNSUBSCRIBE_SECRET=<random_32_bytes_base64>
```

## Constraints / NÃO fazer
- ❌ JWT lib pesada — HMAC simples é suficiente (sem expiration via JWT field, fazemos manual)
- ❌ Aceitar token em URL sem hash/sig — qualquer um descadastraria qualquer um
- ❌ Permitir POST sem token válido (open endpoint = abuso)
- ❌ Incluir token em transacional obrigatório (kyc_result, payment_receipt, etc) — `EmailLayout` recebe `includeUnsubscribe={false}` nessas categorias
- ❌ Logar `UNSUBSCRIBE_SECRET` em qualquer lugar

## Convenções
- Token TTL 90 dias (cobre forwarding e atrasos típicos)
- `OPERATIONAL_CATEGORIES` é constante exportada em `src/lib/notifications/categories.ts` (única source of truth com a função SQL `notification_is_allowed` de US-022 T-160)
- Endpoint público (`/api/unsubscribe/*` em proxy.ts allowlist)$desc$,
 'API', 'ANY', ARRAY['INPUT_VALIDATION','SECRET_HANDLING','RATE_LIMIT','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-175 UI: /unsubscribe/[token] page
-- ---------------------------------------------------------------------------
('bdc2502d-f082-4b31-b098-6f029118c4b9',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-175',
 'Renderizar página pública /unsubscribe/[token] com seleção granular',
 $desc$## Objetivo
Página pública (sem login) que valida token, mostra categoria atual, e permite ao usuário escolher: opt-out só desta categoria OU todas operacionais. Confirmação visual + estado terminal. Cobre AC #8 (UX clara de descadastramento).

## Contexto
Módulo NOTIFICACAO. Acessível por link no rodapé de e-mails operacionais (T-173). Caminho de link: `https://app.zelar.com.br/unsubscribe/<token>`. Server Component que faz GET no token endpoint (T-174) e mostra UI de confirmação. Mutação via Server Action ou client `fetch` POST.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/(public)/unsubscribe/[token]/page.tsx`
```tsx
import { notFound } from 'next/navigation';
import { UnsubscribeForm } from './UnsubscribeForm';

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Server fetch → endpoint GET /api/unsubscribe/[token]
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/unsubscribe/${token}`, {
    cache: 'no-store',
  });
  if (!res.ok) notFound();
  const data = await res.json();

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Descadastrar</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Você está descadastrando o e-mail vinculado à categoria <strong>{labelFor(data.category)}</strong>.
        Notificações obrigatórias (KYC, recibo, alertas de disputa, liberação de pagamento) continuam sendo enviadas.
      </p>
      <UnsubscribeForm token={token} category={data.category} />
    </main>
  );
}

function labelFor(cat: string): string {
  const map: Record<string, string> = {
    service_accepted: 'aceite de serviço',
    service_step_change: 'mudança de etapa',
    service_reminder_24h: 'lembrete 24h',
    service_reminder_2h: 'lembrete 2h',
    // ...
  };
  return map[cat] ?? cat;
}
```

### `src/app/(public)/unsubscribe/[token]/UnsubscribeForm.tsx` (`'use client'`)
```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormBody } from '@/components/ui/field';
import { toast } from 'sonner';

export function UnsubscribeForm({ token, category }: { token: string; category: string }) {
  const [scope, setScope] = useState<'specific' | 'all_operational'>('specific');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/unsubscribe/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: scope === 'specific' ? category : 'all_operational',
          channels: ['email'],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch (e) {
      toast.error('Erro ao descadastrar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mt-6 rounded-md bg-green-50 p-4 text-green-900">
        Pronto. Você não receberá mais essas notificações por e-mail.
      </div>
    );
  }

  return (
    <FormBody density="comfortable" className="mt-6">
      <Field name="scope" required>
        <Field.Label>O que descadastrar?</Field.Label>
        <Field.Control>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="w-full rounded-md border px-3 py-2"
          >
            <option value="specific">Só esta categoria</option>
            <option value="all_operational">Todas as notificações operacionais</option>
          </select>
        </Field.Control>
        <Field.Hint>
          Notificações obrigatórias (recibo, KYC, disputa, liberação de pagamento) continuam.
        </Field.Hint>
      </Field>

      <Button onClick={onSubmit} disabled={busy}>
        {busy ? 'Processando…' : 'Confirmar descadastramento'}
      </Button>
    </FormBody>
  );
}
```

### Allowlist no proxy
- `proxy.ts` (US-001) já tem rotas `(public)/*` liberadas; adicionar `/unsubscribe/*` se ainda não está.

## Reuso
- `Field`, `FormBody` (Field compound API)
- `Button`
- `Sonner` toast (`toast.error`)
- `useState` (sem react-hook-form)

## Constraints / NÃO fazer
- ❌ Login obrigatório (token já é a credencial; forçar login afasta destinatários antigos)
- ❌ Botão "voltar a receber" nesta versão MVP — gestão completa de prefs vem em US futura ("Preferências do usuário")
- ❌ Mostrar erro técnico cru (token inválido) — `notFound()` é mais elegante (404)
- ❌ Esquecer linguagem clara sobre obrigatórias (pra evitar reclamação "ainda recebo")

## Convenções
- Server Component renderiza dados; client component só submete
- Sem optimistic update (1-shot, ID terminal)
- Mobile-first (link clicado de qualquer client)
- Texto pt_BR claro, sem jargão$desc$,
 'UI', 'ANY', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-176 API: admin metrics endpoint
-- ---------------------------------------------------------------------------
('17fb6275-f859-4dc3-9e7b-be4006d75f44',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-176',
 'Implementar GET /api/admin/notifications/metrics (consume notification_metrics_v)',
 $desc$## Objetivo
Endpoint admin que serve agregação para dashboard (T-177). Lê `notification_metrics_v` (T-169), aplica filtros (canal, template, período) e devolve breakdown por dia. Cobre AC #10.

## Contexto
Módulo NOTIFICACAO. Caller único: dashboard `/admin/notifications` (T-177). Auth via `app_metadata.role='admin'` (RLS da view já filtra). Sem listagem detalhada de envios (privacidade) — só métricas agregadas.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/api/admin/notifications/metrics/route.ts`
```typescript
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Query = z.object({
  channel: z.enum(['email', 'whatsapp', 'web_push']).optional(),
  template_key: z.string().optional(),
  // Período em dias (1..30). Default 7.
  period_days: z.coerce.number().int().min(1).max(30).default(7),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return Response.json({ error: q.error.issues }, { status: 400 });

  const sb = await createClient();
  const since = new Date(Date.now() - q.data.period_days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  let qb = sb.from('notification_metrics_v')
    .select('channel, template_key, day, sent, delivered, bounced, failed, total')
    .gte('day', since);

  if (q.data.channel)      qb = qb.eq('channel', q.data.channel);
  if (q.data.template_key) qb = qb.eq('template_key', q.data.template_key);

  const { data, error } = await qb.order('day', { ascending: true });
  // RLS bloqueia se non-admin (forbidden no error code).
  if (error) {
    const status = error.code === '42501' ? 403 : 500;
    return Response.json({ error: error.message }, { status });
  }

  // Adicionar agregado total por canal pro card de resumo.
  const totals = (data ?? []).reduce<Record<string, { sent: number; delivered: number; bounced: number; failed: number; total: number }>>((acc, r) => {
    if (!acc[r.channel]) acc[r.channel] = { sent: 0, delivered: 0, bounced: 0, failed: 0, total: 0 };
    acc[r.channel].sent     += r.sent;
    acc[r.channel].delivered += r.delivered;
    acc[r.channel].bounced  += r.bounced;
    acc[r.channel].failed   += r.failed;
    acc[r.channel].total    += r.total;
    return acc;
  }, {});

  return Response.json({ rows: data, totals });
}
```

## Constraints / NÃO fazer
- ❌ Listar envios individuais aqui (privacidade — admin pode ver via SQL direto se necessário)
- ❌ Aceitar `period_days > 30` (view já recorta 30d; query de mais que isso volta vazia silenciosamente)
- ❌ Cache pesado — métricas operacionais devem refletir ~real-time (cache só de 30s no edge é ok)
- ❌ Sem validação Zod do query (forge URL → erros de tipo no DB)

## Convenções
- Endpoint admin sempre em `/api/admin/*` (já é convenção)
- RLS na view bloqueia non-admin transparentemente (não precisa duplicar no handler)
- Resposta combinando `rows` (gráfico timeseries) + `totals` (cards) pra cliente não fazer 2 queries$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','RLS_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- ---------------------------------------------------------------------------
-- T-177 UI: admin /admin/notifications dashboard
-- ---------------------------------------------------------------------------
('9a4effed-1e89-4dba-80c1-a87e8c7f02aa',
 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '62b6a9d0-f1d8-490a-954c-3fea6b6da47e',
 'ZLAR-V2-T-177',
 'Renderizar /admin/notifications (cards + timeseries por canal/template)',
 $desc$## Objetivo
Painel admin com visão de entregabilidade: cards por canal (taxa entrega, bounces, falhas, total), filtros (canal, template, período 7/14/30d) e timeseries por dia. Permite ADMIN identificar incidentes de entregabilidade. Cobre AC #10.

## Contexto
Módulo NOTIFICACAO + ADMIN. Caller: ADMIN navega `/admin/notifications` (link no menu admin sidebar). Lê via `/api/admin/notifications/metrics` (T-176). Sem mutação — read-only.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/app/admin/notifications/page.tsx`
```tsx
import { NotificationsDashboard } from './NotificationsDashboard';

export default function NotificationsAdminPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Notificações</h1>
      <p className="text-sm text-zinc-600 mt-1">
        Taxa de entrega, falhas e bounces por canal e período.
      </p>
      <NotificationsDashboard />
    </div>
  );
}
```

### `src/app/admin/notifications/NotificationsDashboard.tsx` (`'use client'`)
```tsx
'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Field, FormBody } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { showErrorToast } from '@/lib/optimistic/toast';

interface MetricsResponse {
  rows: Array<{ channel: string; template_key: string | null; day: string; sent: number; delivered: number; bounced: number; failed: number; total: number }>;
  totals: Record<string, { sent: number; delivered: number; bounced: number; failed: number; total: number }>;
}

export function NotificationsDashboard() {
  const [period, setPeriod] = useState<7 | 14 | 30>(7);
  const [channel, setChannel] = useState<'all' | 'email' | 'whatsapp' | 'web_push'>('all');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period_days: String(period) });
    if (channel !== 'all') params.set('channel', channel);
    fetch(`/api/admin/notifications/metrics?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch((e) => showErrorToast({ type: 'patch', id: 'metrics' } as any, e))
      .finally(() => setLoading(false));
  }, [period, channel]);

  return (
    <div className="mt-4 space-y-4">
      <FormBody density="compact">
        <Field.Row cols={2}>
          <Field name="period">
            <Field.Label>Período</Field.Label>
            <Field.Control>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value) as 7|14|30)} className="rounded-md border px-3 py-2 w-full">
                <option value={7}>7 dias</option>
                <option value={14}>14 dias</option>
                <option value={30}>30 dias</option>
              </select>
            </Field.Control>
          </Field>
          <Field name="channel">
            <Field.Label>Canal</Field.Label>
            <Field.Control>
              <select value={channel} onChange={(e) => setChannel(e.target.value as any)} className="rounded-md border px-3 py-2 w-full">
                <option value="all">Todos</option>
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="web_push">Web Push</option>
              </select>
            </Field.Control>
          </Field>
        </Field.Row>
      </FormBody>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(data.totals).map(([ch, t]) => (
              <Card key={ch} className="p-4">
                <div className="text-xs text-zinc-500 uppercase">{ch}</div>
                <div className="mt-1 text-2xl font-semibold">{t.total}</div>
                <div className="mt-2 text-sm text-zinc-600">
                  Entregues: {t.delivered} ({Math.round((t.delivered/Math.max(t.total,1))*100)}%)
                  {' · '}Bounces: {t.bounced}
                  {' · '}Falhas: {t.failed}
                </div>
              </Card>
            ))}
          </div>

          <Card className="p-4">
            <h2 className="font-semibold">Por dia</h2>
            <table className="mt-3 w-full text-sm">
              <thead className="text-zinc-500"><tr>
                <th align="left">Dia</th><th align="left">Canal</th><th align="left">Template</th>
                <th align="right">Sent</th><th align="right">Entregue</th><th align="right">Bounce</th><th align="right">Falha</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td>{r.day}</td><td>{r.channel}</td><td>{r.template_key ?? '—'}</td>
                    <td align="right">{r.sent}</td><td align="right">{r.delivered}</td>
                    <td align="right">{r.bounced}</td><td align="right">{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
```

### Sidebar admin
- Adicionar item "Notificações" no menu admin existente (US-016 ou layout admin) com link `/admin/notifications`.

## Reuso
- `Card`
- `Skeleton`
- `Field` + `FormBody` (compound API)
- `showErrorToast` de `@/lib/optimistic/toast`
- Sem `useOptimisticCollection` (read-only, sem mutação)
- Sem `ResponsiveSheet` (página dedicada)

## Constraints / NÃO fazer
- ❌ Lib de gráfico pesada (recharts/chart.js) só pra um timeseries — tabela dá vazão. Adicionar gráfico em iteração futura se necessário
- ❌ Refresh automático (polling) — ADMIN clica "atualizar" se quiser. Real-time aqui sobra
- ❌ Permitir non-admin ver — `/admin/*` proxy.ts (US-016) já bloqueia
- ❌ Mostrar dados sensíveis (destinatário, payload) — só agregado

## Convenções
- Lê endpoint admin (RLS via JWT)
- Mobile-first com responsive grid (`grid-cols-1 sm:grid-cols-3`)
- Estado vazio: cards mostram 0 quando não há dados (não erro)$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','FIELD_COMPOUND_API','MOBILE_FIRST','PAGINATION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW())
;

-- ============================================================================
-- 2. Vínculos task → AC-da-Story (TaskAcceptanceCriterion)
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId")
SELECT t.id, ac.id FROM (VALUES
  -- T-167 OPS: AC #1 (domínio + SPF/DKIM/DMARC)
  ('472b8214-340b-4a5d-9724-786d8c2c84d4'::uuid, 1),

  -- T-168 OPS: AC #2 (templates pré-aprovados)
  ('903a7d25-9568-4295-9008-0d53b300299b'::uuid, 2),

  -- T-169 DATA: AC #3 (registro de envios) + AC #10 (monitoria via view)
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3'::uuid, 3),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3'::uuid, 10),

  -- T-170 DATA: AC #2 (placeholders documentados via templates) + AC #5 (tolerance) + AC #6 (cancelamento — extensão schedules)
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42'::uuid, 2),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42'::uuid, 5),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42'::uuid, 6),

  -- T-171 API: AC #3 (escreve send_log) + AC #4 (retry/backoff) + AC #9 (event-driven via dispatcher)
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c'::uuid, 3),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c'::uuid, 4),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c'::uuid, 9),

  -- T-172 API: AC #2 (renderiza placeholders do catálogo) + AC #7 (fallback texto)
  ('61971f34-fc87-4850-b899-41c3d04cf59e'::uuid, 2),
  ('61971f34-fc87-4850-b899-41c3d04cf59e'::uuid, 7),

  -- T-173 UI: AC #7 (componentes reutilizáveis + plain text)
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4'::uuid, 7),

  -- T-174 API: AC #8 (link descadastramento)
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9'::uuid, 8),

  -- T-175 UI: AC #8 (página de unsubscribe)
  ('bdc2502d-f082-4b31-b098-6f029118c4b9'::uuid, 8),

  -- T-176 API: AC #10
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44'::uuid, 10),

  -- T-177 UI: AC #10
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa'::uuid, 10)
) v(task_id, ac_order)
JOIN "Task" t ON t.id = v.task_id
JOIN "AcceptanceCriterion" ac
  ON ac."userStoryId" = t."userStoryId"
 AND ac."order" = v.ac_order;

-- ============================================================================
-- 3. AC-da-Task (checklist técnico)
-- ============================================================================

-- T-167 OPS Resend domain
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'Domínio mail.zelar.com.br criado em Resend Dashboard', 0),
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'Registros DNS SPF, DKIM e DMARC publicados no provedor DNS', 1),
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'Resend Dashboard mostra "Verified" pros 3 registros', 2),
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'DMARC iniciado em p=quarantine pct=100 com rua=postmaster@', 3),
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'Variáveis RESEND_API_KEY/FROM_EMAIL/FROM_NAME/REPLY_TO/DOMAIN configuradas em Vault e .env', 4),
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'Email de teste enviado pra inbox externa (gmail/outlook) e classificado como inbox (não spam)', 5),
  ('472b8214-340b-4a5d-9724-786d8c2c84d4', 'docs/runbook/email-domain.md criado com screenshots e processo de rotação', 6);

-- T-168 OPS WA templates
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('903a7d25-9568-4295-9008-0d53b300299b', '16 templates submetidos à Meta com placeholders documentados', 0),
  ('903a7d25-9568-4295-9008-0d53b300299b', 'Todos templates do MVP em status "approved" antes de go-live', 1),
  ('903a7d25-9568-4295-9008-0d53b300299b', 'meta_template_id de cada um registrado em message_templates (T-170)', 2),
  ('903a7d25-9568-4295-9008-0d53b300299b', 'Categoria Meta (UTILITY) registrada por template', 3),
  ('903a7d25-9568-4295-9008-0d53b300299b', 'Variáveis META_WHATSAPP_TOKEN/PHONE_NUMBER_ID/BUSINESS_ACCOUNT_ID configuradas', 4),
  ('903a7d25-9568-4295-9008-0d53b300299b', 'docs/runbook/whatsapp-templates.md criado e atualizado por template', 5),
  ('903a7d25-9568-4295-9008-0d53b300299b', 'Template de teste (kyc_result_approved) enviado em ambiente staging com sucesso', 6);

-- T-169 DATA send logs + view
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'ENUM provider_send_status criado com 7 valores', 1),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'Tabelas email/whatsapp/web_push_send_log criadas com colunas e índices descritos', 2),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'UNIQUE em resend_id e wamid impede duplicação de webhook', 3),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'View notification_metrics_v criada e consultável', 4),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'RLS: authenticated não-admin retorna 0 linhas; admin lê tudo', 5),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'EXPLAIN da view mostra index scan (status, attempted_at) sem seq scan completo', 6),
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'FK notification_event_id ON DELETE SET NULL preserva log mesmo com event apagado', 7);

-- T-170 DATA message_templates + tolerance
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'Migration aplicada via psql; database.types.ts regenerado', 0),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'Tabela message_templates criada com colunas e ENUM template_channel', 1),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'UNIQUE parcial impede 2 current=true pra mesma (key, channel, locale)', 2),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'Coluna materialize_tolerance adicionada em notification_schedules com default 15min', 3),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'Seed de templates email + WA pras 16 categorias do MVP aplicado', 4),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'RLS: authenticated lê só current=true; admin all', 5),
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'Smoke: SELECT por (kyc_result, email, pt_BR, current=true) retorna 1 linha', 6);

-- T-171 API comms.ts
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'sendEmail implementado com retry [1s, 4s] em 5xx/429/network', 0),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', '4xx não-retryable (400, 401, 422) falha na 1ª tentativa', 1),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'Cada chamada gera 1 linha em email_send_log (pending → sent ou failed)', 2),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'sendWhatsApp implementado mesmo padrão com Meta Cloud API', 3),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'sendWebPush implementado com FCM fallback', 4),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'Webhook /api/webhooks/resend valida assinatura e atualiza email_send_log por resend_id', 5),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'Webhook /api/webhooks/whatsapp valida X-Hub-Signature-256 e atualiza por wamid', 6),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'Webhook GET /api/webhooks/whatsapp responde challenge da Meta com hub.verify_token correto', 7),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'NOTIFY_USE_MOCK=1 skipa chamada externa e marca sent imediatamente', 8),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'Payload sensível (token, senha) sanitizado antes de gravar request_payload', 9);

-- T-172 API templates.ts
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'renderTemplate(email/category/locale) resolve template current=true do catálogo', 0),
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'Placeholder ausente no payload throw template_placeholder_missing', 1),
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'Render email retorna {subject, html, text} com text como fallback', 2),
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'Render whatsapp retorna {metaTemplateId, components} pronto pra Meta API', 3),
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'Render web_push retorna {title, body} interpolados', 4),
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'Template não encontrado throw template_not_found (caller mapeia pra fallback channel)', 5);

-- T-173 UI React Email
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', '@react-email/components e render instalados; barrel src/emails/index.ts criado', 0),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'Componentes EmailLayout/Header/Footer/Button/ServiceSummary/FinancialBreakdown criados', 1),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'Pelo menos 4 templates específicos criados (KycApprovedEmail, PaymentReceiptEmail, etc)', 2),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'EmailFooter renderiza link de unsubscribe quando includeUnsubscribe=true e token presente', 3),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'Templates obrigatórios (KYC, payment_receipt, etc) usam includeUnsubscribe=false', 4),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'pnpm exec email dev abre preview em localhost:3001 com payloads de exemplo', 5),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'Render testado em Gmail e Outlook (não quebra layout)', 6),
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'body_text plain text registrado em message_templates pra cada email (fallback AC #7)', 7);

-- T-174 API unsubscribe
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'signUnsubscribeToken/verifyUnsubscribeToken implementados com HMAC SHA256', 0),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'Token expira em 90 dias; verify retorna null pra expirado ou tampered', 1),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'GET /api/unsubscribe/[token] valida e retorna {userId, category, issuedAt} ou 400', 2),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'POST /api/unsubscribe/[token] valida body Zod e faz upsert em notification_preferences', 3),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'scope=all_operational opta-out das 6 categorias operacionais', 4),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'scope específica opta-out só daquela categoria', 5),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'UNSUBSCRIBE_SECRET configurado em .env e Vault (32+ bytes)', 6),
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'Endpoint público liberado em proxy.ts allowlist', 7);

-- T-175 UI unsubscribe page
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'Página /(public)/unsubscribe/[token] renderiza categoria atual após GET válido', 0),
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'Token inválido/expirado retorna 404 (notFound)', 1),
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'Form com select "só esta categoria" / "todas operacionais" e botão Confirmar', 2),
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'POST sucesso mostra estado terminal "Pronto. Você não receberá mais essas notificações"', 3),
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'Erro mostra Sonner toast', 4),
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'Texto explica que obrigatórias continuam sendo enviadas', 5),
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', 'Mobile-first verificado em viewport <768px', 6);

-- T-176 API admin metrics
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44', 'Endpoint GET /api/admin/notifications/metrics implementado', 0),
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44', 'Validação Zod de query: channel/template_key/period_days(1..30)', 1),
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44', 'Resposta {rows, totals} com agregação por canal', 2),
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44', 'RLS bloqueia non-admin (403)', 3),
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44', 'Filtros channel e template_key aplicam corretamente (smoke: 2 calls com filtro diferente)', 4);

-- T-177 UI admin dashboard
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order") VALUES
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Página /admin/notifications acessível via menu admin', 0),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Filtros período (7/14/30) e canal funcionam e refazem fetch', 1),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Cards de resumo por canal mostram total/entregue/bounce/falha', 2),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Tabela timeseries renderiza linhas por (dia, canal, template)', 3),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Skeleton aparece durante loading; Sonner toast em erro', 4),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Reusa Card, Skeleton, Field, FormBody, showErrorToast (sem componente novo)', 5),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Mobile-first (grid responsivo cols-1 sm:cols-3)', 6),
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', 'Non-admin não acessa (proxy bloqueia em /admin/*)', 7);

-- ============================================================================
-- 4. Dependências
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind) VALUES
  -- T-170 (templates + tolerance) depende de T-168 (templates aprovados na Meta)
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', '903a7d25-9568-4295-9008-0d53b300299b', 'blocks'),

  -- T-169 (send_logs) referencia notification_events de US-022 T-159
  ('e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', '4e3b21ff-4655-4998-ae41-d6a96ccceb5e', 'blocks'),

  -- T-171 (comms.ts) depende de T-167 (Resend domain), T-168 (WA templates),
  -- T-169 (send_logs), T-170 (message_templates), T-172 (renderTemplate)
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', '472b8214-340b-4a5d-9724-786d8c2c84d4', 'blocks'),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', '903a7d25-9568-4295-9008-0d53b300299b', 'blocks'),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'blocks'),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', 'de1e7b27-9179-405f-b7d5-65f4d41bba42', 'blocks'),
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', '61971f34-fc87-4850-b899-41c3d04cf59e', 'blocks'),

  -- T-172 (renderTemplate) depende de T-170 (catalog) + T-173 (componentes JSX)
  ('61971f34-fc87-4850-b899-41c3d04cf59e', 'de1e7b27-9179-405f-b7d5-65f4d41bba42', 'blocks'),
  ('61971f34-fc87-4850-b899-41c3d04cf59e', '88aa0807-65df-4a34-9b75-7bb95e4b5bd4', 'blocks'),

  -- T-174 (unsubscribe API) depende de US-022 T-160 (notification_preferences)
  ('46e061d2-60d8-48bf-b60d-83749e8b51d9', 'e6d9d223-3b40-49ba-88fa-b47d8e817ee7', 'blocks'),

  -- T-175 (unsubscribe UI) depende de T-174
  ('bdc2502d-f082-4b31-b098-6f029118c4b9', '46e061d2-60d8-48bf-b60d-83749e8b51d9', 'blocks'),

  -- T-176 (metrics API) depende de T-169 (view)
  ('17fb6275-f859-4dc3-9e7b-be4006d75f44', 'e7cc4cef-0324-4126-b1ac-7d8d24bc5eb3', 'blocks'),

  -- T-177 (dashboard UI) depende de T-176
  ('9a4effed-1e89-4dba-80c1-a87e8c7f02aa', '17fb6275-f859-4dc3-9e7b-be4006d75f44', 'blocks'),

  -- T-173 (email components) referencia EmailFooter unsubscribe link → relates_to T-174
  ('88aa0807-65df-4a34-9b75-7bb95e4b5bd4', '46e061d2-60d8-48bf-b60d-83749e8b51d9', 'relates_to'),

  -- relates_to US-022 (consumidor desta infraestrutura)
  ('5ba4fdad-c731-4a6b-9c10-e11d396d960c', '132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'relates_to'),  -- US-022 dispatcher consome comms.ts
  ('61971f34-fc87-4850-b899-41c3d04cf59e', '132ce5eb-e45b-4d9f-99ae-6c1543ad6192', 'relates_to'),  -- US-022 dispatcher consome renderTemplate
  ('de1e7b27-9179-405f-b7d5-65f4d41bba42', 'f83559dd-afa2-4d16-b010-8e7cd82878ca', 'relates_to')   -- estende US-022 T-161 schedules
;

COMMIT;
