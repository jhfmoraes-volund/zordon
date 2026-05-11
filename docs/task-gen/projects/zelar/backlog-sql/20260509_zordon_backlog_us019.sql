-- Zordon backlog cards: ZLAR-V2-US-019 (ADMIN — Configurar feature flags, templates e parâmetros operacionais)
-- Persona: ADMIN | Module: ADMIN | 12 AC | 10 tasks (T-215..T-224)
-- Persisted into: Task / TaskAcceptanceCriterion / AcceptanceCriterion(taskId) / TaskDependency
-- Reusa cross-US:
--   T-064 (US-010) seed inicial app_config — ESTENDE schema + adiciona seeds
--   T-204 (US-017) audit imutável (provider_moderation_log) — pattern p/ app_config_history
--   T-194 (US-016) assertAdmin + GET /api/admin/* — pattern endpoint admin
--   T-198 (US-016) realtime admin:dashboard — pattern p/ admin:config:updated
--   T-203 (US-016) seeds OPS app_config supply_min/peak_hours — esta US adiciona keys novas
--   T-162 (US-022) enqueue_notification_event — registrar mudança de parâmetro crítico (notify SISTEMA admin)
--   T-190 (US-016) admin_alerts genérico — emit alert quando parâmetro crítico muda

BEGIN;

-- ============================================================================
-- 1. Tasks (10 cards)
-- ============================================================================

INSERT INTO "Task" (
  id, "projectId", "userStoryId", reference, title, description,
  layer, "personaScope", "qualityFlags", status, type,
  "designSessionId", "createdByAgent", "createdAt", "updatedAt"
) VALUES

-- T-215 DATA — estender app_config + criar app_config_history imutável + view
('315c57de-7769-4f90-b45c-2447edd086a2', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-215', 'Estender app_config com section/critical/value_schema + app_config_history imutável + view',
 $desc$## Objetivo
Tornar `app_config` (criado em T-064 da US-010) capaz de suportar a UI de admin de US-019: agrupamento por seção (matching/pagamento/KYC/anti-bypass/supply/comunicação), flag `critical` (dispara confirmação extra) e `value_schema` jsonb (validação por chave). Criar `app_config_history` append-only para AC #11 (histórico imutável + revert) e view `app_config_full_v` que combina valor atual + última edição. Cobre AC #1 (agrupamento), #11 (histórico imutável).

## Contexto
Módulo ADMIN. T-064 já criou `app_config` com colunas mínimas (key text PK, value jsonb, description, updated_by, updatedAt). Hoje é único e usado por T-203 (US-016 supply_min/peak_hours) e T-064 (US-010 visita técnica). Aqui ESTENDEMOS — não recriar. Hist segue padrão imutável de `provider_moderation_log` (T-204): triggers BEFORE UPDATE/DELETE que `RAISE EXCEPTION`.

## Estado atual / O que substitui
`app_config` existe (T-064). Não tem section, não tem critical flag, não tem value_schema, não tem tabela de histórico. Esta task adiciona TUDO isso via `ALTER TABLE` + nova tabela + view.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_app_config_extend.sql`
```sql
BEGIN;

-- Estende app_config (já criado em T-064 US-010)
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'misc'
    CHECK (section IN ('matching','pagamento','kyc','anti_bypass','supply','comunicacao','misc')),
  ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS value_schema jsonb,           -- JSON Schema p/ validar value
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS unit text;                    -- 'min','%','count','BRL', etc

CREATE INDEX IF NOT EXISTS app_config_section_idx
  ON app_config(section, display_order);

-- Histórico append-only (AC #11)
CREATE TABLE IF NOT EXISTS app_config_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key    text NOT NULL REFERENCES app_config(key) ON DELETE RESTRICT,
  old_value     jsonb,                          -- NULL no INSERT inicial (seed)
  new_value     jsonb NOT NULL,
  changed_by    uuid NOT NULL REFERENCES auth.users(id),
  justification text NOT NULL,                  -- AC #11 obrigatório
  is_revert     boolean NOT NULL DEFAULT false, -- true quando gerada por POST /revert
  reverted_from uuid REFERENCES app_config_history(id), -- linha original que foi revertida
  "createdAt"   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX app_config_history_key_idx
  ON app_config_history(config_key, "createdAt" DESC);
CREATE INDEX app_config_history_changed_by_idx
  ON app_config_history(changed_by, "createdAt" DESC);

ALTER TABLE app_config_history ENABLE ROW LEVEL SECURITY;

-- ADMIN lê tudo
CREATE POLICY "config_history_admin_read" ON app_config_history
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- INSERT só via SECURITY DEFINER (RPC apply_config_change em T-219)
REVOKE INSERT ON app_config_history FROM authenticated;

-- Append-only triggers
CREATE OR REPLACE FUNCTION app_config_history_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app_config_history is append-only';
END $$;
CREATE TRIGGER ach_no_update BEFORE UPDATE ON app_config_history
  FOR EACH ROW EXECUTE FUNCTION app_config_history_immutable();
CREATE TRIGGER ach_no_delete BEFORE DELETE ON app_config_history
  FOR EACH ROW EXECUTE FUNCTION app_config_history_immutable();

-- Trigger em app_config: bloqueia UPDATE direto (toda mudança DEVE passar pela RPC)
CREATE OR REPLACE FUNCTION app_config_block_direct_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.config_via_rpc', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'app_config UPDATE deve passar por apply_config_change()';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_config_no_direct_update BEFORE UPDATE ON app_config
  FOR EACH ROW WHEN (OLD.value IS DISTINCT FROM NEW.value)
  EXECUTE FUNCTION app_config_block_direct_update();

-- View consolidada (admin UI lê)
CREATE OR REPLACE VIEW app_config_full_v AS
SELECT
  c.key,
  c.section,
  c.critical,
  c.unit,
  c.display_order,
  c.value,
  c.value_schema,
  c.description,
  c."updatedAt",
  c.updated_by,
  (SELECT COUNT(*) FROM app_config_history h WHERE h.config_key = c.key) AS history_count,
  (SELECT row_to_json(h.*) FROM app_config_history h
     WHERE h.config_key = c.key ORDER BY h."createdAt" DESC LIMIT 1) AS last_change
FROM app_config c;

GRANT SELECT ON app_config_full_v TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ DROPAR e recriar `app_config` (T-064 já está em uso por US-010 + US-016)
- ❌ Permitir UPDATE/DELETE em `app_config_history` (triggers garantem)
- ❌ Permitir UPDATE direto em `app_config.value` por SQL fora da RPC (trigger guard via `app.config_via_rpc`)
- ❌ Esquecer ON DELETE RESTRICT no FK config_key (não pode sumir histórico)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- Padrão append-only espelha T-204 (provider_moderation_log)
- Section enum aberto a futuras seções via CHECK CONSTRAINT (não enum nativo p/ flexibilidade)
- value sempre jsonb (mesmo escalar) — convenção herdada de T-064$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-216 DATA — notification_templates lifecycle (versioning + status)
('e88368da-f36c-47ad-8d88-416a809d9d23', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-216', 'Estender notification_templates com versioning, status enum e audit log',
 $desc$## Objetivo
Suportar ciclo de vida pós go-live de templates de comunicação externa (WhatsApp Business e e-mail): cadastrar, marcar como aprovado pela plataforma de mensageria (Meta), ativar, desativar, criar nova versão. Cobre AC #8 (lifecycle templates).

## Contexto
Módulo ADMIN/COMUNICACAO. Tabela `notification_templates` é criada na US-024 (responsabilidade do conjunto inicial de go-live, conforme AC #8 da US-019 explicita). Esta task ESTENDE com colunas e tabela de log para o ciclo de vida pós-go-live administrado em US-019. Se US-024 ainda não foi implementada quando esta for executada, a migration cria a tabela base mínima para não bloquear (com `IF NOT EXISTS`).

## Estado atual / O que substitui
US-024 cria `notification_templates` com columns base (id, code, channel, body, locale). Esta task ADICIONA versionamento, status enum e log. Não substitui US-024.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_notification_templates_lifecycle.sql`
```sql
BEGIN;

-- Garante existência mínima (idempotente — US-024 cria base)
CREATE TABLE IF NOT EXISTS notification_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('whatsapp','email','push','sms')),
  locale      text NOT NULL DEFAULT 'pt-BR',
  body        text NOT NULL,
  variables   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TYPE IF NOT EXISTS notification_template_status AS ENUM (
  'draft',                  -- cadastrado, ainda não submetido pra aprovação externa
  'pending_external',       -- aguardando aprovação Meta/Resend
  'approved_inactive',      -- aprovado externamente, mas não ligado
  'active',                 -- em uso
  'deprecated'              -- desativado (substituído por versão nova ou removido)
);

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS status notification_template_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES notification_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_ref text,         -- id retornado pela Meta/Resend
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

-- Único 'active' por (code, channel, locale)
CREATE UNIQUE INDEX IF NOT EXISTS notif_templates_active_uq
  ON notification_templates(code, channel, locale)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS notif_templates_status_idx
  ON notification_templates(status, channel);

-- Audit append-only
CREATE TABLE IF NOT EXISTS notification_template_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES notification_templates(id) ON DELETE RESTRICT,
  admin_id    uuid NOT NULL REFERENCES auth.users(id),
  action      text NOT NULL CHECK (action IN (
    'created','submitted_external','approved_external','rejected_external',
    'activated','deactivated','versioned','deprecated'
  )),
  old_status  notification_template_status,
  new_status  notification_template_status,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX notification_template_log_template_idx
  ON notification_template_log(template_id, "createdAt" DESC);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_template_log ENABLE ROW LEVEL SECURITY;

-- ADMIN tudo; SISTEMA (service role) bypass RLS
CREATE POLICY "templates_admin_all" ON notification_templates
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- authenticated: SELECT só de templates ativos (consumo do agente / dispatcher)
CREATE POLICY "templates_active_read" ON notification_templates
  FOR SELECT TO authenticated USING (status = 'active');

CREATE POLICY "template_log_admin_read" ON notification_template_log
  FOR SELECT USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

REVOKE INSERT ON notification_template_log FROM authenticated;

-- Append-only
CREATE OR REPLACE FUNCTION notif_template_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'notification_template_log is append-only';
END $$;
CREATE TRIGGER ntl_no_update BEFORE UPDATE ON notification_template_log
  FOR EACH ROW EXECUTE FUNCTION notif_template_log_immutable();
CREATE TRIGGER ntl_no_delete BEFORE DELETE ON notification_template_log
  FOR EACH ROW EXECUTE FUNCTION notif_template_log_immutable();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ DELETE de template (deprecated é estado terminal — preserva histórico de envios)
- ❌ Permitir 2 versões 'active' simultaneamente para mesmo (code, channel, locale) — UNIQUE INDEX bloqueia
- ❌ Substituir versão sem registrar `supersedes_id` (rastro de evolução perdido)
- ❌ Endpoint público (templates só authenticated lê 'active'; ADMIN lê tudo)

## Convenções
- Versionar = criar NOVA linha com `version=old.version+1`, `supersedes_id=old.id`, status='draft'
- `external_ref` guarda id Meta WhatsApp Business / id Resend para correlacionar webhook
- Log append-only espelha pattern de T-204 (provider_moderation_log) e T-215$desc$,
 'DATA', 'ADMIN', ARRAY['RLS_REQUIRED','INDEX_REQUIRED','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-217 API — endpoints config CRUD + history + revert
('0758ed61-2424-4209-8d84-991707f2ddb4', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-217', 'Implementar GET/PUT /api/admin/config + history + POST /[key]/revert',
 $desc$## Objetivo
Expor endpoints admin para ler todas as keys de `app_config_full_v` agrupadas por section, atualizar valor com justificativa obrigatória, listar histórico por key e reverter para versão anterior. Cobre AC #1 (lista agrupada), #2-#7, #9-#10 (mudanças sem deploy), #11 (histórico + revert).

## Contexto
Módulo ADMIN. Toda mutação de `app_config` passa por `apply_config_change()` (RPC criada em T-219) — endpoints aqui só validam input + chamam RPC. Reusa `assertAdmin` de T-194 (US-016). Realtime: ao mudar config crítica, RPC já dispara INSERT em `admin_alerts` (T-190) + `enqueue_notification_event` (T-162).

## Estado atual / O que substitui
Não existe endpoint admin de config. Hoje constantes em código + leituras direto de `app_config` por outras tasks.

## O que criar

### `src/app/api/admin/config/route.ts`
```typescript
// GET — lista agrupada por section
import { z } from 'zod';
import { assertAdmin } from '@/lib/admin/assert';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  await assertAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_config_full_v')
    .select('*')
    .order('section')
    .order('display_order');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // Agrupa por section
  const grouped = data!.reduce<Record<string, typeof data>>((acc, row) => {
    (acc[row.section] ??= []).push(row);
    return acc;
  }, {});
  return Response.json({ sections: grouped });
}
```

### `src/app/api/admin/config/[key]/route.ts`
```typescript
// PUT — atualizar valor
const Body = z.object({
  value: z.unknown(),                      // jsonb arbitrário; RPC valida via value_schema
  justification: z.string().min(10).max(500),
  acknowledge_critical: z.boolean().optional(), // exigido p/ critical=true
});

export async function PUT(req: Request, { params }: { params: { key: string } }) {
  await assertAdmin();
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_config_change', {
    p_key: params.key,
    p_new_value: body.value,
    p_justification: body.justification,
    p_acknowledge_critical: body.acknowledge_critical ?? false,
    p_idempotency_key: idemKey,
  });
  if (error) {
    if (error.message.includes('schema_violation'))
      return Response.json({ error: 'invalid_value', details: error.details }, { status: 400 });
    if (error.message.includes('critical_requires_ack'))
      return Response.json({ error: 'critical_requires_ack' }, { status: 409 });
    if (error.message.includes('cap_violation'))
      return Response.json({ error: 'cap_violation', details: error.details }, { status: 400 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}
```

### `src/app/api/admin/config/[key]/history/route.ts`
```typescript
export async function GET(_req: Request, { params }: { params: { key: string } }) {
  await assertAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_config_history')
    .select('id, old_value, new_value, justification, is_revert, reverted_from, "createdAt", changed_by')
    .eq('config_key', params.key)
    .order('"createdAt"', { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ history: data });
}
```

### `src/app/api/admin/config/[key]/revert/route.ts`
```typescript
const Body = z.object({
  history_id: z.string().uuid(),           // linha do histórico p/ qual reverter
  justification: z.string().min(10).max(500),
});

export async function POST(req: Request, { params }: { params: { key: string } }) {
  await assertAdmin();
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });
  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('revert_config_change', {
    p_key: params.key,
    p_history_id: body.history_id,
    p_justification: body.justification,
    p_idempotency_key: idemKey,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
```

## Constraints / NÃO fazer
- ❌ Mutação direta com `update().eq('key', ...)` — sempre via RPC (trigger guard bloqueia)
- ❌ Aceitar payload sem `justification` (AC #11 exige texto)
- ❌ Aceitar mudança em key `critical=true` sem `acknowledge_critical=true` (AC #12)
- ❌ Retornar histórico de outras keys junto (escopar ao key da rota)

## Convenções
- `assertAdmin` (T-194 US-016) abre 401/403 antes de qualquer query
- Idempotency-Key em PUT/POST (pattern do projeto — T-194)
- Erros padronizados: 400 (validação Zod / schema_violation / cap_violation), 409 (critical_requires_ack), 500 (interno)
- Logs estruturados (action, key, actor)$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-218 API — endpoints templates CRUD + activate/deactivate/version
('d05c5b90-8091-46dc-bae0-fe993412ccbf', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-218', 'Implementar CRUD /api/admin/templates + activate/deactivate/version',
 $desc$## Objetivo
Expor endpoints admin para gerenciar ciclo de vida pós go-live de templates de comunicação externa: criar, listar, atualizar (cria nova versão), submeter aprovação externa (Meta/Resend), ativar (após aprovado), desativar, deprecar. Cobre AC #8.

## Contexto
Módulo ADMIN/COMUNICACAO. Reusa `notification_templates` (T-216 desta US estende) e `assertAdmin` (T-194 US-016). Submissão externa real (chamar API Meta WhatsApp Business / Resend) é tratada em US-024; aqui apenas marcamos status `pending_external` e guardamos `external_ref` quando webhook retorna (webhook receiver em US-024).

## Estado atual / O que substitui
US-024 cria endpoints para emissão de notificações (consumir templates ativos). Aqui criamos os endpoints de gestão admin (CRUD + transições de status).

## O que criar

### `src/app/api/admin/templates/route.ts`
```typescript
const ListQuery = z.object({
  channel: z.enum(['whatsapp','email','push','sms']).optional(),
  status: z.enum(['draft','pending_external','approved_inactive','active','deprecated']).optional(),
});

export async function GET(req: Request) {
  await assertAdmin();
  const url = new URL(req.url);
  const q = ListQuery.parse(Object.fromEntries(url.searchParams));
  const supabase = await createClient();
  let query = supabase.from('notification_templates').select('*').order('"updatedAt"', { ascending: false });
  if (q.channel) query = query.eq('channel', q.channel);
  if (q.status) query = query.eq('status', q.status);
  const { data, error } = await query.limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ templates: data });
}

const CreateBody = z.object({
  code: z.string().min(2).max(80),
  channel: z.enum(['whatsapp','email','push','sms']),
  locale: z.string().default('pt-BR'),
  body: z.string().min(1).max(4000),
  variables: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  await assertAdmin();
  const body = CreateBody.parse(await req.json());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_notification_template', body);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
```

### `src/app/api/admin/templates/[id]/route.ts`
```typescript
// PATCH — cria nova versão (não edita in-place quando active)
const PatchBody = z.object({
  body: z.string().min(1).max(4000).optional(),
  variables: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await assertAdmin();
  const body = PatchBody.parse(await req.json());
  const supabase = await createClient();
  // RPC decide: se atual é 'draft' → edita; se 'active'/'deprecated' → cria nova versão
  const { data, error } = await supabase.rpc('upsert_notification_template_version', {
    p_id: params.id, p_body: body.body, p_variables: body.variables,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
```

### `src/app/api/admin/templates/[id]/transition/route.ts`
```typescript
const TransitionBody = z.object({
  action: z.enum(['submit','activate','deactivate','deprecate']),
  external_ref: z.string().optional(),       // p/ activate, vindo do retorno Meta/Resend
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await assertAdmin();
  const body = TransitionBody.parse(await req.json());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('transition_notification_template', {
    p_id: params.id, p_action: body.action, p_external_ref: body.external_ref,
  });
  if (error) {
    if (error.message.includes('invalid_transition'))
      return Response.json({ error: 'invalid_transition', from: error.details }, { status: 409 });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}
```

### RPCs (criadas pela própria task, em `notification_templates_rpc.sql`)
- `create_notification_template(...)` → INSERT status='draft', registra log 'created'
- `upsert_notification_template_version(...)` → se status='draft' UPDATE in-place; senão INSERT com `version=old+1`, `supersedes_id=old.id`, status='draft'
- `transition_notification_template(p_id, p_action, p_external_ref)`:
  - 'submit': draft → pending_external (log 'submitted_external')
  - 'activate': approved_inactive → active (deprecate active anterior do mesmo (code,channel,locale)); registra `external_ref`
  - 'deactivate': active → approved_inactive
  - 'deprecate': qualquer não-deprecated → deprecated; seta `deprecated_at`
  - RAISE 'invalid_transition' se transição não permitida

## Constraints / NÃO fazer
- ❌ DELETE template (sem endpoint — apenas deprecate)
- ❌ Editar `body` direto em template 'active' (cria nova versão obrigatoriamente)
- ❌ Permitir 2 active simultâneos (UNIQUE INDEX em T-216 bloqueia; activate em RPC desativa o anterior)
- ❌ Activate sem `external_ref` se channel='whatsapp' (Meta exige id de aprovação)

## Convenções
- `assertAdmin` antes de tudo (T-194)
- Idempotência via Idempotency-Key em POST/PATCH (alinhado a T-194/T-217)
- Logs estruturados em `notification_template_log` via cada RPC (audit imutável)
- 409 para transição inválida; 400 para validação Zod$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-219 API — RPC apply_config_change com validação composta + impact preview + revert
('831020bd-0794-483c-b0ef-68f42563e51d', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-219', 'Implementar RPC apply_config_change + revert_config_change + preview_config_impact',
 $desc$## Objetivo
Centralizar mutação de `app_config` em RPC SECURITY DEFINER que: valida via `value_schema`, valida regras compostas (soma pesos matching=1, cap teto pricing, KYC thresholds coerentes, % cancelamento somam <=100), exige `acknowledge_critical=true` quando key.critical=true, registra histórico, dispara `admin_alerts` (T-190) e `enqueue_notification_event` (T-162) quando key crítica muda. Função `revert_config_change` cria nova entrada de histórico apontando pra valor anterior. `preview_config_impact` retorna diff humano-legível pro UI mostrar antes do salvar (AC #12). Cobre AC #2 (matching), #4 (cap pricing), #5 (KYC), #10 (cancelamento), #12 (preview).

## Contexto
Módulo ADMIN. RPC é o ÚNICO ponto de UPDATE de `app_config` (T-215 trigger bloqueia UPDATE direto via `app.config_via_rpc` flag). Reusa `enqueue_notification_event` (T-162 US-022) p/ notificar SISTEMA admins quando matching_weights/pricing/kyc mudam. Reusa `admin_alerts` (T-190 US-016) emitindo INSERT com kind='config_critical_changed'.

## Estado atual / O que substitui
Não existe RPC. Hoje T-064/T-203 só fazem INSERT/UPDATE direto via migration (que vai parar de funcionar pós-T-215 trigger). Esta task viabiliza mutação em runtime.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_app_config_rpcs.sql`
```sql
BEGIN;

-- Valida value contra value_schema (JSON Schema simples — só campos top-level)
CREATE OR REPLACE FUNCTION validate_app_config_value(p_key text, p_value jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_schema jsonb;
  v_sum    numeric;
BEGIN
  SELECT value_schema INTO v_schema FROM app_config WHERE key = p_key;
  IF v_schema IS NULL THEN RETURN; END IF;

  -- jsonschema_lite: type checks básicos
  IF v_schema->>'type' = 'object' AND jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'schema_violation' USING DETAIL = 'expected object';
  END IF;

  -- Regra composta: matching_weights soma 1.0
  IF p_key = 'matching_weights' THEN
    v_sum := COALESCE((p_value->>'q')::numeric,0)
           + COALESCE((p_value->>'t')::numeric,0)
           + COALESCE((p_value->>'d')::numeric,0)
           + COALESCE((p_value->>'f')::numeric,0)
           + COALESCE((p_value->>'c')::numeric,0);
    IF abs(v_sum - 1.0) > 0.001 THEN
      RAISE EXCEPTION 'schema_violation' USING DETAIL = 'matching weights must sum to 1.0, got ' || v_sum;
    END IF;
  END IF;

  -- Regra composta: cancellation_policy percentuais válidos
  IF p_key = 'cancellation_policy' THEN
    FOR v_sum IN
      SELECT (jsonb_array_elements(p_value->'tiers')->>'refund_pct')::numeric
    LOOP
      IF v_sum < 0 OR v_sum > 100 THEN
        RAISE EXCEPTION 'schema_violation' USING DETAIL = 'refund_pct out of range 0..100';
      END IF;
    END LOOP;
  END IF;

  -- Regra composta: kyc thresholds coerentes
  IF p_key = 'kyc_score_thresholds' THEN
    IF (p_value->>'auto_reject')::numeric >= (p_value->>'auto_approve')::numeric THEN
      RAISE EXCEPTION 'schema_violation' USING DETAIL = 'auto_reject must be < auto_approve';
    END IF;
  END IF;
END $$;

-- Valida cap teto: pricing_caps vs subcategories preço indicativo
CREATE OR REPLACE FUNCTION validate_pricing_cap(p_value jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_violation record;
BEGIN
  -- p_value formato: { "<categoria_slug>": { "min": 50, "max": 500, "complexity_multiplier_max": 2.0 } }
  FOR v_violation IN
    SELECT sc.name, (p_value->sc.slug->>'max')::numeric * (p_value->sc.slug->>'complexity_multiplier_max')::numeric AS effective_max,
           sc.cap_teto
    FROM service_categories sc
    WHERE p_value ? sc.slug
      AND sc.cap_teto IS NOT NULL
      AND (p_value->sc.slug->>'max')::numeric * (p_value->sc.slug->>'complexity_multiplier_max')::numeric > sc.cap_teto
  LOOP
    RAISE EXCEPTION 'cap_violation'
      USING DETAIL = format('categoria %s: max*mult=%s > cap_teto=%s',
                            v_violation.name, v_violation.effective_max, v_violation.cap_teto);
  END LOOP;
END $$;

-- RPC principal
CREATE OR REPLACE FUNCTION apply_config_change(
  p_key                  text,
  p_new_value            jsonb,
  p_justification        text,
  p_acknowledge_critical boolean DEFAULT false,
  p_idempotency_key      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin    uuid := auth.uid();
  v_old      jsonb;
  v_critical boolean;
  v_history_id uuid;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Idempotency: chave registrada em app_config_history.metadata
  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM app_config_history
    WHERE config_key = p_key
      AND new_value = p_new_value
      AND changed_by = v_admin
      AND "createdAt" > NOW() - INTERVAL '24 hours'
      -- (idempotency_key store separado seria ideal; aqui reutiliza histórico)
  ) THEN
    SELECT id INTO v_history_id FROM app_config_history
      WHERE config_key=p_key AND new_value=p_new_value AND changed_by=v_admin
      ORDER BY "createdAt" DESC LIMIT 1;
    RETURN jsonb_build_object('idempotent', true, 'history_id', v_history_id);
  END IF;

  SELECT value, critical INTO v_old, v_critical FROM app_config WHERE key = p_key;
  IF v_old IS NULL THEN RAISE EXCEPTION 'unknown_key'; END IF;

  IF v_critical AND NOT p_acknowledge_critical THEN
    RAISE EXCEPTION 'critical_requires_ack';
  END IF;

  PERFORM validate_app_config_value(p_key, p_new_value);
  IF p_key = 'pricing_caps' THEN PERFORM validate_pricing_cap(p_new_value); END IF;

  -- Marca trigger guard
  PERFORM set_config('app.config_via_rpc', 'true', true);
  UPDATE app_config SET value = p_new_value, updated_by = v_admin, "updatedAt" = NOW()
    WHERE key = p_key;

  INSERT INTO app_config_history (config_key, old_value, new_value, changed_by, justification)
    VALUES (p_key, v_old, p_new_value, v_admin, p_justification)
    RETURNING id INTO v_history_id;

  -- Side-effect: alert + notify se critical
  IF v_critical THEN
    INSERT INTO admin_alerts (kind, severity, payload)
      VALUES ('config_critical_changed', 'info',
              jsonb_build_object('key', p_key, 'admin_id', v_admin, 'history_id', v_history_id));
    PERFORM enqueue_notification_event(
      'config.critical.changed',
      jsonb_build_object('key', p_key, 'admin_id', v_admin),
      ARRAY['admin']
    );
  END IF;

  RETURN jsonb_build_object('history_id', v_history_id, 'old_value', v_old, 'new_value', p_new_value);
END $$;

-- Revert
CREATE OR REPLACE FUNCTION revert_config_change(
  p_key             text,
  p_history_id      uuid,
  p_justification   text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_target_value jsonb;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT new_value INTO v_target_value FROM app_config_history
    WHERE id = p_history_id AND config_key = p_key;
  IF v_target_value IS NULL THEN RAISE EXCEPTION 'history_not_found'; END IF;

  RETURN apply_config_change(p_key, v_target_value, p_justification, true, p_idempotency_key);
END $$;

-- Preview impact (read-only)
CREATE OR REPLACE FUNCTION preview_config_impact(p_key text, p_new_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old jsonb;
  v_critical boolean;
  v_warnings text[] := '{}';
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT value, critical INTO v_old, v_critical FROM app_config WHERE key = p_key;

  -- Tenta validação (não persiste)
  BEGIN
    PERFORM validate_app_config_value(p_key, p_new_value);
    IF p_key = 'pricing_caps' THEN PERFORM validate_pricing_cap(p_new_value); END IF;
  EXCEPTION WHEN OTHERS THEN
    v_warnings := array_append(v_warnings, SQLERRM);
  END;

  RETURN jsonb_build_object(
    'key', p_key, 'critical', v_critical,
    'old_value', v_old, 'new_value', p_new_value,
    'requires_ack', v_critical, 'warnings', v_warnings,
    'human_summary', format('%s: %s → %s', p_key, v_old, p_new_value)
  );
END $$;

GRANT EXECUTE ON FUNCTION apply_config_change(text, jsonb, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION revert_config_change(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preview_config_impact(text, jsonb) TO authenticated;

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Mutação em `app_config` fora desta RPC (trigger T-215 bloqueia)
- ❌ Permitir bypass de critical (sem `p_acknowledge_critical=true` raise)
- ❌ Cap teto bypassed (regra explícita do AC #4)
- ❌ Side-effects síncronos pesados (alert+notify são INSERT/RPC; envio real é async via T-162)

## Convenções
- SECURITY DEFINER com check explícito de claim admin (defense in depth)
- Histórico SEMPRE registrado (mesmo no revert — gera linha nova com `is_revert=true` via apply_config_change reuso)
- Nome `apply_config_change` segue pattern `apply_*` de T-156 (US-026 apply_dispute_decision)$desc$,
 'API', 'ADMIN', ARRAY['INPUT_VALIDATION','IDEMPOTENCY_KEY','AUDIT_LOG','RACE_CONDITION'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-220 UI — /admin/config página com 6 seções
('62485f81-556c-4777-9fa3-ed2dcb6ab47c', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-220', 'Renderizar /admin/config com seções colapsáveis (matching/pagamento/KYC/anti-bypass/supply/comunicacao)',
 $desc$## Objetivo
Tela admin que lista todos os parâmetros operacionais agrupados por section, com nome, valor atual, descrição, unit, indicador de critical, último changed_by/changedAt e botões "Editar" + "Histórico". Cobre AC #1 (lista agrupada), e habilita edição via T-221 + histórico via T-222.

## Contexto
Módulo ADMIN. Server Component que server-fetcha `GET /api/admin/config` (T-217). Cards por section com Field readonly + status visual de critical. Edit abre `ConfigEditDialog` (T-221); History abre `ConfigHistorySheet` (T-222). Reusa `Card`, `Badge` (critical), `Button`, `Skeleton`, `StatusChip`, `Sonner` do design system.

## Estado atual / O que substitui
Não existe `/admin/config`. Tela nova.

## O que criar

### `src/app/admin/config/page.tsx`
```tsx
// Server Component
import { assertAdmin } from '@/lib/admin/assert';
import { ConfigSections } from '@/components/admin/ConfigSections';

export default async function AdminConfigPage() {
  await assertAdmin();
  // server-fetch
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/admin/config`, {
    headers: { cookie: '<forward>' }, cache: 'no-store',
  });
  const { sections } = await res.json();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Configuração operacional</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Parâmetros que afetam o produto em tempo real, sem deploy. Mudanças críticas exigem confirmação.
      </p>
      <ConfigSections sections={sections} />
    </main>
  );
}
```

### `src/components/admin/ConfigSections.tsx`
```tsx
'use client';
// Renderiza Accordion (Radix) por section. Cada section = lista de cards.
// Cada card: nome (key formatada), value preview (jsonb compacto), description,
// Badge "crítico" se critical, último changed_by/changedAt.
// Botões: "Editar" → abre ConfigEditDialog (T-221); "Histórico" → abre ConfigHistorySheet (T-222).

const SECTION_LABELS: Record<string, string> = {
  matching: 'Matching',
  pagamento: 'Pagamento',
  kyc: 'KYC',
  anti_bypass: 'Anti-bypass',
  supply: 'Supply',
  comunicacao: 'Comunicação',
  misc: 'Outros',
};

export function ConfigSections({ sections }: { sections: Record<string, ConfigRow[]> }) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <>
      <div className="mt-6 space-y-4">
        {Object.entries(sections).map(([sec, rows]) => (
          <Card key={sec} className="p-4">
            <h2 className="text-lg font-medium">{SECTION_LABELS[sec] ?? sec}</h2>
            <div className="mt-3 grid gap-2">
              {rows.map(r => <ConfigRowCard key={r.key} row={r}
                onEdit={() => setEditingKey(r.key)}
                onHistory={() => setHistoryKey(r.key)} />)}
            </div>
          </Card>
        ))}
      </div>
      {editingKey && <ConfigEditDialog configKey={editingKey} onClose={() => setEditingKey(null)} />}
      {historyKey && <ConfigHistorySheet configKey={historyKey} onClose={() => setHistoryKey(null)} />}
    </>
  );
}
```

### `src/components/admin/ConfigRowCard.tsx`
- Renderiza key em human-friendly (`matching_weights` → "Pesos do matching")
- `value` jsonb formatado compacto (ex `{q:.3, t:.2, ...}`); se objeto grande, "Ver detalhes" via Tooltip
- Badge "Crítico" (Badge variant=destructive) se row.critical
- `unit` ao lado do valor numérico ("min", "%", "BRL")

## Constraints / NÃO fazer
- ❌ Mutação inline (sem Edit dialog) — UI de edit é T-221 (com confirmação)
- ❌ `<Dialog>` cru — usar ResponsiveDialog/Sheet via T-221/T-222
- ❌ react-hook-form / lib externa de form
- ❌ Renderizar histórico inline (ResponsiveSheet via T-222 — escala melhor mobile)

## Convenções
- Reusa: `Card`, `Badge`, `Button`, `Skeleton`, `Sonner` (`showErrorToast`)
- Mobile-first: section accordion empilha vertical; cards full-width <768px
- Sem optimistic update na lista (re-fetch após T-221/T-222 fechar com sucesso)
- Tipos: gerar de `database.types.ts` regenerado (após T-215)$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-221 UI — ConfigEditDialog com preview + ack crítico
('348f6e58-6c71-4662-ba65-b5e4655e23ad', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-221', 'Renderizar ConfigEditDialog (ResponsiveDialog) com preview de impacto + ack crítico',
 $desc$## Objetivo
Modal de edição de uma key de `app_config`. Renderiza editor adequado por type (number/slider/json/array de tiers); fetcha `preview_config_impact` ao mudar valor (debounced) mostrando diff + warnings; exige justificativa (>=10 chars); para keys critical exige checkbox "Confirmo que entendo o impacto"; botão Salvar chama PUT /api/admin/config/[key]. Cobre AC #2 (matching), #3 (broadcast), #4 (pricing — mostra cap), #5 (KYC), #6 (supply), #7 (anti-bypass), #9 (feature flags), #10 (cancellation), #12 (confirmação crítica).

## Contexto
Módulo ADMIN. Aberto por `ConfigSections` (T-220). Reusa `ResponsiveDialog`, `Field`/`FormBody`, `Input`, `Textarea`, `Slider`, `Button`, `Sonner`. Para `feature_flags` (jsonb com chaves boolean) renderiza lista de Switches. Para `matching_weights` renderiza 5 sliders com soma exibida (alerta se != 1.0). Para `cancellation_policy.tiers` renderiza array editor.

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/admin/ConfigEditDialog.tsx`
```tsx
'use client';
import { useState, useEffect } from 'react';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Field, FormBody } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { showErrorToast } from '@/lib/optimistic/toast';
import { fetchOrThrow } from '@/lib/fetch';
import { useFieldDebounce } from '@/hooks/use-field-debounce';

type Props = { configKey: string; onClose: () => void; };

export function ConfigEditDialog({ configKey, onClose }: Props) {
  const [row, setRow] = useState<ConfigRow | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [justification, setJustification] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [preview, setPreview] = useState<{ warnings: string[]; human_summary: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Carrega row
  useEffect(() => { /* fetch /api/admin/config/[key] */ }, [configKey]);

  // Preview debounced
  const debouncedDraft = useFieldDebounce(draft, 400);
  useEffect(() => {
    if (!debouncedDraft) return;
    fetchOrThrow(`/api/admin/config/${configKey}/preview`, { method: 'POST', body: JSON.stringify({ value: debouncedDraft }) })
      .then(r => r.json()).then(setPreview).catch(() => {});
  }, [debouncedDraft, configKey]);

  const canSave = justification.length >= 10 && (!row?.critical || acknowledged) && (preview?.warnings?.length ?? 0) === 0;

  const save = async () => {
    setBusy(true);
    try {
      const idem = crypto.randomUUID();
      await fetchOrThrow(`/api/admin/config/${configKey}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': idem, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: draft, justification, acknowledge_critical: acknowledged }),
      });
      onClose();
    } catch (err) { showErrorToast({ type: 'patch' }, err); }
    finally { setBusy(false); }
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <ResponsiveDialog.Header>Editar {row?.key}</ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <FormBody density="comfortable">
          {/* Editor por shape (componente switch — ConfigValueEditor) */}
          <ConfigValueEditor row={row} value={draft} onChange={setDraft} />
          <Field name="justification" required>
            <Field.Label>Justificativa (mínimo 10 caracteres)</Field.Label>
            <Field.Control>
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={500} />
            </Field.Control>
          </Field>
          {row?.critical && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              Confirmo que entendo o impacto desta mudança crítica.
            </label>
          )}
          {preview && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium">Resumo do impacto</div>
              <div className="mt-1">{preview.human_summary}</div>
              {preview.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-destructive">
                  {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
        </FormBody>
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} disabled={!canSave || busy}>Salvar</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
```

### `src/components/admin/ConfigValueEditor.tsx`
- Switch por `row.key`:
  - `matching_weights` → 5 `<Slider>` (q/t/d/f/c) + soma exibida; warning se != 1.0
  - `feature_flags` → lista de toggles (1 por chave do jsonb)
  - `cancellation_policy` → editor de array (window_min, refund_pct) com botão +/-
  - `pricing_caps` → editor por categoria com min/max/multiplier
  - default → `<Textarea>` JSON com format on blur

## Constraints / NÃO fazer
- ❌ `window.confirm()` para ack crítico (checkbox dentro do dialog basta)
- ❌ `react-hook-form` (Field compound API + useState)
- ❌ Validar Zod no client (servidor faz; cliente só usa preview RPC)
- ❌ Salvar com warnings != [] (botão disabled)
- ❌ Idempotency-Key fixo (gerar novo UUID por sessão de edição — cobre retry de save sem duplicar)

## Convenções
- ResponsiveDialog (size auto — mobile bottom-sheet)
- Field compound API (`Field`/`Field.Label`/`Field.Control`)
- Optimistic update da lista parent? Não — re-fetch após onClose com sucesso (lista parent T-220 reload)
- Sonner toast em erros via `showErrorToast`
- Debounce 400ms no preview$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','FIELD_COMPOUND_API','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-222 UI — ConfigHistorySheet com timeline + revert
('efeffc63-6f14-444e-96be-82fbce975798', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-222', 'Renderizar ConfigHistorySheet com timeline e revert em 1 clique',
 $desc$## Objetivo
ResponsiveSheet que mostra histórico imutável de uma key (admin, valor anterior, valor novo, justificativa, timestamp) ordenado desc; cada entry tem botão "Reverter para este valor" que abre `ConfirmDialog` exigindo justificativa do revert e chama `POST /api/admin/config/[key]/revert`. Cobre AC #11.

## Contexto
Módulo ADMIN. Aberto por `ConfigSections` (T-220). Reusa `ResponsiveSheet`, `ConfirmDialog`, `Button`, `Sonner`. Server-fetch via `GET /api/admin/config/[key]/history` (T-217). Diff visual entre old/new value (ex: jsondiffpatch — ou format simples lado-a-lado).

## Estado atual / O que substitui
Não existe.

## O que criar

### `src/components/admin/ConfigHistorySheet.tsx`
```tsx
'use client';
import { useState, useEffect } from 'react';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ConfirmDialog, type ConfirmState } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { fetchOrThrow } from '@/lib/fetch';
import { showErrorToast } from '@/lib/optimistic/toast';

type HistoryEntry = {
  id: string; old_value: unknown; new_value: unknown;
  justification: string; "createdAt": string;
  changed_by_email?: string; is_revert: boolean;
};

export function ConfigHistorySheet({ configKey, onClose }: { configKey: string; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => {
    fetchOrThrow(`/api/admin/config/${configKey}/history`)
      .then(r => r.json()).then(d => setEntries(d.history));
  }, [configKey]);

  const askRevert = (entry: HistoryEntry) => {
    setConfirm({
      title: 'Reverter para este valor?',
      description: `Vai criar uma nova entrada no histórico aplicando ${JSON.stringify(entry.new_value)} novamente.`,
      confirmLabel: 'Reverter',
      destructive: true,
      onConfirm: async () => {
        try {
          const idem = crypto.randomUUID();
          await fetchOrThrow(`/api/admin/config/${configKey}/revert`, {
            method: 'POST',
            headers: { 'Idempotency-Key': idem, 'Content-Type': 'application/json' },
            body: JSON.stringify({ history_id: entry.id, justification: 'Revert via UI' }),
          });
          // re-fetch
          const fresh = await fetchOrThrow(`/api/admin/config/${configKey}/history`).then(r => r.json());
          setEntries(fresh.history);
        } catch (err) { showErrorToast({ type: 'patch' }, err); throw err; }
      },
    });
  };

  return (
    <>
      <ResponsiveSheet open onOpenChange={(o) => { if (!o) onClose(); }} size="lg">
        <ResponsiveSheet.Header>Histórico — {configKey}</ResponsiveSheet.Header>
        <ResponsiveSheet.Body>
          {!entries && <Skeleton className="h-40" />}
          {entries && entries.length === 0 && <p className="text-muted-foreground">Sem alterações registradas.</p>}
          <ol className="mt-2 space-y-3">
            {entries?.map(e => (
              <li key={e.id} className="rounded-md border p-3">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{e.changed_by_email ?? e.id}</span>
                  <span>{new Date(e["createdAt"]).toLocaleString('pt-BR')}</span>
                </div>
                <DiffView old={e.old_value} next={e.new_value} />
                <p className="mt-1 text-sm">{e.justification}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => askRevert(e)}>
                  Reverter para este valor
                </Button>
              </li>
            ))}
          </ol>
        </ResponsiveSheet.Body>
      </ResponsiveSheet>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
```

### `src/components/admin/DiffView.tsx`
- Render side-by-side de jsonb (old/new) com tokens diferentes destacados (verde/vermelho)
- Para escalares: simples antes → depois
- Para objetos: lista de chaves alteradas

## Constraints / NÃO fazer
- ❌ `window.confirm()` no revert — ConfirmDialog stateless
- ❌ Permitir UPDATE/DELETE de entry (UI não expõe — backend bloqueia via T-215 trigger)
- ❌ Sem feedback de erro no revert — Sonner toast via showErrorToast
- ❌ Re-fetch da página inteira após revert — apenas a lista de history (componente local)

## Convenções
- ResponsiveSheet size="lg" (480px desktop / 90dvh mobile)
- ConfirmDialog destrutivo (revert é mudança intencional, mas reversível)
- Idempotency-Key gerado por click (não cache — cada revert é evento único)$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-223 UI — /admin/templates lista CRUD + edição com versioning
('d80e73c5-e9e3-4414-aeca-a4a380708ec9', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-223', 'Renderizar /admin/templates com lista por canal/status e TemplateSheet de edição',
 $desc$## Objetivo
Tela admin para gerenciar templates de comunicação externa (WhatsApp/email). Lista filtrada por canal/status; cada linha mostra code, version, status (StatusChip), última atualização. Botões: "Editar" (abre `TemplateSheet`), "Submeter" (transition→pending_external), "Ativar" (após approved_inactive), "Desativar", "Deprecar" (com ConfirmDialog). `TemplateSheet` permite editar body/variables; se template está active/deprecated, save cria nova versão (chama PATCH que RPC decide). Cobre AC #8.

## Contexto
Módulo ADMIN/COMUNICACAO. Reusa `ResponsiveSheet`, `Field`/`FormBody`, `Textarea`, `StatusChipSelect`, `Button`, `ConfirmDialog`, `useOptimisticCollection`. Endpoints T-218.

## Estado atual / O que substitui
Não existe `/admin/templates`. Tela nova.

## O que criar

### `src/app/admin/templates/page.tsx`
```tsx
import { assertAdmin } from '@/lib/admin/assert';
import { TemplatesList } from '@/components/admin/TemplatesList';

export default async function AdminTemplatesPage() {
  await assertAdmin();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Templates de comunicação</h1>
      <TemplatesList />
    </main>
  );
}
```

### `src/components/admin/TemplatesList.tsx`
```tsx
'use client';
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';
// Filtros (channel, status); useOptimisticCollection<NotificationTemplate, 'patch'|'create'|'delete'> para
// suportar criação/transições otimistas.
// Render lista com StatusChipSelect (clicar muda status via transition endpoint).
// Botão "Novo template" abre TemplateSheet em modo create.
```

### `src/components/admin/TemplateSheet.tsx`
```tsx
'use client';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { Field, FormBody } from '@/components/ui/field';
// Form: code (readonly em edit), channel (Select), locale, body (Textarea grande), variables (lista de chips)
// Save: POST (create) ou PATCH (edit; RPC cria nova versão se ativo)
// Footer: Cancelar | Salvar (+ Salvar como nova versão se active)
```

### `src/components/admin/TemplateRow.tsx`
- Mostra: code, channel badge, version, StatusChip(status), updatedAt
- Dropdown de ações por status:
  - draft → Editar | Submeter aprovação | Deletar(? não — deprecate)
  - pending_external → Marcar como aprovado (manual) | Voltar pra draft
  - approved_inactive → Editar | Ativar | Deprecar
  - active → Editar (cria nova versão) | Desativar | Deprecar
  - deprecated → Visualizar | Reabrir como nova versão (cria draft com supersedes)

## Constraints / NÃO fazer
- ❌ Edição inline no body (mobile inviável — sheet full screen)
- ❌ Permitir DELETE (não existe — deprecate é estado terminal)
- ❌ Salvar template active sem confirmar (ConfirmDialog: "Vai criar versão N+1, pendente de aprovação externa")
- ❌ Filtro server-side via window.location (use estado React + URL via Next router se quiser shareable)

## Convenções
- ResponsiveSheet size="lg" para edit (corpo grande)
- StatusChipSelect (componente existente) para mudar status com menu
- useOptimisticCollection: reducer extra que mapeia transições (status atual → próximo)
- Sonner toast em invalid_transition (vem como 409 do API)$desc$,
 'UI', 'ADMIN', ARRAY['REUSE_EXISTING_COMPONENT','REUSE_EXISTING_HOOK','RESPONSIVE_SHEET_REQUIRED','CONFIRM_DIALOG_REQUIRED','FIELD_COMPOUND_API','OPTIMISTIC_UPDATE','MOBILE_FIRST'],
 'draft', 'feature',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW()),

-- T-224 OPS — seedar app_config com 12 keys default + critical flags
('ae31a446-0593-4bc9-b208-810edf3d6cab', 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c',
 '3a62380d-f805-4221-bbee-a1999c943350',
 'ZLAR-V2-T-224', 'Seedar app_config com keys default por seção (matching/pagamento/KYC/anti-bypass/supply/cancellation/feature_flags)',
 $desc$## Objetivo
Inserir/atualizar (ON CONFLICT DO UPDATE) as 12+ keys de `app_config` necessárias pra UI de US-019 estar usável dia 1: matching_weights, broadcast_pool_size, broadcast_accept_deadline_min, broadcast_search_visible_min, broadcast_max_radius_by_category, pricing_caps, kyc_score_thresholds, kyc_max_manual_attempts, supply_min_by_category (já em T-203 — só atualiza section/critical/value_schema), anti_bypass_weights, anti_bypass_levels, cancellation_policy, feature_flags. Marca section/critical/unit/value_schema/display_order pra cada uma. Cobre AC #2-#7, #9, #10 (valores default coerentes com referências citadas nos AC: pool=5, accept=15min, search_visible=10min, supply_min=5, kyc_max_attempts=2, refunds 90/60/30/10/0).

## Contexto
Módulo ADMIN. Roda DEPOIS de T-215 (estende schema com section/critical/value_schema). T-064 e T-203 (US-010, US-016) já criaram algumas keys (visita_tecnica, supply_min_by_category, peak_hours) — esta task usa `ON CONFLICT (key) DO UPDATE` para anotar section/critical/value_schema sem perder valor.

## Estado atual / O que substitui
T-064 seedou `visita_tecnica*`. T-203 seedou `supply_min_by_category`, `peak_hours`. Esta task ADICIONA matching, pricing, KYC, anti-bypass, cancellation, feature_flags. Total esperado pós-seed: ≥12 keys.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_app_config_seeds_us019.sql`
```sql
BEGIN;

-- helper para upsert de seed (mantém value se já existe, atualiza metadata)
INSERT INTO app_config (key, value, description, section, critical, unit, value_schema, display_order)
VALUES
  ('matching_weights',
   '{"q":0.3,"t":0.2,"d":0.15,"f":0.15,"c":0.2}'::jsonb,
   'Pesos do score de matching: q=qualidade, t=confiança, d=disponibilidade, f=frequência, c=cobertura. Soma deve ser 1.0.',
   'matching', true, NULL,
   '{"type":"object","required":["q","t","d","f","c"],"properties":{"q":{"type":"number"},"t":{"type":"number"},"d":{"type":"number"},"f":{"type":"number"},"c":{"type":"number"}}}'::jsonb,
   10),

  ('broadcast_pool_size', '5'::jsonb,
   'Tamanho do top-N de prestadores selecionados por broadcast.',
   'matching', true, 'count',
   '{"type":"number","minimum":1,"maximum":20}'::jsonb, 20),

  ('broadcast_accept_deadline_min', '15'::jsonb,
   'Janela em minutos para um prestador aceitar antes do broadcast expirar.',
   'matching', false, 'min',
   '{"type":"number","minimum":1,"maximum":60}'::jsonb, 30),

  ('broadcast_search_visible_min', '10'::jsonb,
   'Janela em minutos visível ao cliente como "buscando prestador".',
   'matching', false, 'min',
   '{"type":"number","minimum":1,"maximum":60}'::jsonb, 40),

  ('broadcast_max_radius_by_category',
   '{"limpeza":15,"manutencao":20,"reparos":20,"jardinagem":30,"piscinas":30,"mudancas":50,"montagem":15}'::jsonb,
   'Raio máximo (km) de busca por categoria.',
   'matching', false, 'km',
   '{"type":"object"}'::jsonb, 50),

  ('pricing_caps',
   '{"limpeza":{"min":80,"max":600,"complexity_multiplier_max":2.0},"manutencao":{"min":120,"max":1200,"complexity_multiplier_max":2.5}}'::jsonb,
   'Faixas de preço por categoria com cap teto. RPC valida que max*multiplier_max <= cap_teto da categoria.',
   'pagamento', true, 'BRL',
   '{"type":"object"}'::jsonb, 10),

  ('kyc_score_thresholds',
   '{"auto_approve":0.8,"auto_reject":0.4}'::jsonb,
   'Thresholds do score KYC: ≥auto_approve aprova automático; <auto_reject reprova; entre os dois → review manual.',
   'kyc', true, NULL,
   '{"type":"object","required":["auto_approve","auto_reject"]}'::jsonb, 10),

  ('kyc_max_manual_attempts', '2'::jsonb,
   'Quantidade máxima de reprovações manuais antes de bloquear conta.',
   'kyc', true, 'count',
   '{"type":"number","minimum":1,"maximum":5}'::jsonb, 20),

  ('anti_bypass_weights',
   '{"contact_share":0.4,"link_share":0.3,"cancel_then_match":0.2,"keyword_pattern":0.1}'::jsonb,
   'Pesos dos sinais anti-bypass.',
   'anti_bypass', true, NULL,
   '{"type":"object"}'::jsonb, 10),

  ('anti_bypass_levels',
   '{"N1":0.3,"N2":0.5,"N3":0.7,"N4":0.9}'::jsonb,
   'Limiares dos 4 níveis de escalonamento (N1=warning, N4=block).',
   'anti_bypass', true, NULL,
   '{"type":"object","required":["N1","N2","N3","N4"]}'::jsonb, 20),

  ('cancellation_policy',
   '{"tiers":[{"window_min":1440,"refund_pct":90},{"window_min":720,"refund_pct":60},{"window_min":240,"refund_pct":30},{"window_min":60,"refund_pct":10},{"window_min":0,"refund_pct":0}],"no_show_visit_fee_pct":50}'::jsonb,
   'Política de cancelamento por janela (em minutos antes do agendamento) com percentual de reembolso, e taxa de visita por ausência.',
   'pagamento', true, '%',
   '{"type":"object","required":["tiers"]}'::jsonb, 30),

  ('feature_flags',
   '{"pix_enabled":true,"infinite_scroll_history":true,"priority_queue_admin":false,"csv_export_async":true,"rework_mediated":false}'::jsonb,
   'Feature flags individuais. Desligar esconde caminho do app sem quebrar.',
   'misc', false, NULL,
   '{"type":"object"}'::jsonb, 100)

ON CONFLICT (key) DO UPDATE SET
  description  = EXCLUDED.description,
  section      = EXCLUDED.section,
  critical     = EXCLUDED.critical,
  unit         = EXCLUDED.unit,
  value_schema = EXCLUDED.value_schema,
  display_order = EXCLUDED.display_order;
  -- value NÃO é sobrescrito (preserva valor de produção)

-- Atualiza metadados das keys já criadas em T-064/T-203 (sem mudar value)
UPDATE app_config SET section='supply', critical=false, unit='count', display_order=10
  WHERE key='supply_min_by_category';
UPDATE app_config SET section='matching', critical=false, display_order=60
  WHERE key='peak_hours';
UPDATE app_config SET section='pagamento', critical=false, unit='%', display_order=40
  WHERE key LIKE 'visita_tecnica%';

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Sobrescrever `value` em produção (ON CONFLICT atualiza só metadata)
- ❌ Marcar `feature_flags` como critical (mudanças aqui são reversíveis e baixo risco)
- ❌ Pular `value_schema` em keys critical (UI depende para validar)
- ❌ Esquecer cancellation_policy.tiers ordenado desc por window_min (lookup matemático no apply assume ordem)

## Convenções
- ON CONFLICT DO UPDATE preserva produção (default-value mas safe)
- Cada seção tem display_order com gaps de 10 (espaço para inserts futuros)
- Dia 1: aplicação real consome essas keys via lib/config.ts (cache 30s)
- Reuso direto: T-064 (US-010 visita), T-203 (US-016 supply)$desc$,
 'OPS', 'SISTEMA', ARRAY['NO_RLS_NEEDED','AUDIT_LOG'],
 'draft', 'chore',
 '264e6d07-d365-43ba-8029-d539ce6f7c6b', true, NOW(), NOW());


-- ============================================================================
-- 2. AcceptanceCriterion (taskId) — checklist técnico de cada task
-- ============================================================================

INSERT INTO "AcceptanceCriterion" (id, "taskId", text, "order", "createdAt", "updatedAt") VALUES
-- T-215 DATA app_config extend
('9c509f23-01b3-4b35-9201-ab23c529adb3','315c57de-7769-4f90-b45c-2447edd086a2','Migration aplicada via psql; database.types.ts regenerado',0,NOW(),NOW()),
('8d40ad15-bb54-43c7-852e-c3929d1e5d9b','315c57de-7769-4f90-b45c-2447edd086a2','app_config tem colunas section, critical, value_schema, display_order, unit',1,NOW(),NOW()),
('f8bc4735-cced-4740-a8f4-ff4fcea71564','315c57de-7769-4f90-b45c-2447edd086a2','app_config_history criada com FK ON DELETE RESTRICT em config_key',2,NOW(),NOW()),
('0fe69fa3-6627-4d69-b6cc-3cd034c04fda','315c57de-7769-4f90-b45c-2447edd086a2','UPDATE direto em app_config.value sem set_config(app.config_via_rpc) raise',3,NOW(),NOW()),
('7d4fa7d0-3d67-4c19-a5ed-4606a80f3ed0','315c57de-7769-4f90-b45c-2447edd086a2','UPDATE/DELETE em app_config_history raise (append-only)',4,NOW(),NOW()),
('581b1d32-7e42-4509-966c-9ca3425f40fd','315c57de-7769-4f90-b45c-2447edd086a2','RLS: authenticated não-admin nega SELECT em app_config_history',5,NOW(),NOW()),
('8753b739-a1d0-46cb-a41a-88e377f85e49','315c57de-7769-4f90-b45c-2447edd086a2','View app_config_full_v retorna last_change e history_count por key',6,NOW(),NOW()),

-- T-216 DATA notification_templates lifecycle
('3564c35b-6150-4565-9de7-57185ec7bf3d','e88368da-f36c-47ad-8d88-416a809d9d23','Migration aplicada via psql; database.types.ts regenerado',0,NOW(),NOW()),
('a61b4d05-6a90-4429-bb6e-fb23c5b3aef0','e88368da-f36c-47ad-8d88-416a809d9d23','Enum notification_template_status com 5 valores criado',1,NOW(),NOW()),
('43b703c2-a5ae-4c43-b804-afd0f10c3e21','e88368da-f36c-47ad-8d88-416a809d9d23','UNIQUE INDEX bloqueia 2 templates active mesmo (code,channel,locale)',2,NOW(),NOW()),
('2f133b23-efac-4aef-b2a4-319d050b3410','e88368da-f36c-47ad-8d88-416a809d9d23','RLS: authenticated SELECT só status=active; admin tudo',3,NOW(),NOW()),
('f5fda069-ea6b-4252-a738-5093a348e53b','e88368da-f36c-47ad-8d88-416a809d9d23','notification_template_log append-only (UPDATE/DELETE raise)',4,NOW(),NOW()),
('062d9560-7ba4-4fad-966c-bae3c47d5e2e','e88368da-f36c-47ad-8d88-416a809d9d23','supersedes_id permite NULL; ON DELETE SET NULL',5,NOW(),NOW()),

-- T-217 API config endpoints
('52233a42-f498-4301-bc9a-66daad220cfa','0758ed61-2424-4209-8d84-991707f2ddb4','GET /api/admin/config retorna sections agrupadas por section ordem display_order',0,NOW(),NOW()),
('33e51247-e294-43f5-ab3a-cc5bef496e06','0758ed61-2424-4209-8d84-991707f2ddb4','PUT /api/admin/config/[key] valida body com Zod (400 em formato inválido)',1,NOW(),NOW()),
('80092730-d755-4a2e-af5d-28949232efbf','0758ed61-2424-4209-8d84-991707f2ddb4','PUT 400 sem Idempotency-Key header',2,NOW(),NOW()),
('e68c8c91-fa35-43ec-97af-b47e868aa20e','0758ed61-2424-4209-8d84-991707f2ddb4','PUT 401/403 quando claim role!=admin (assertAdmin)',3,NOW(),NOW()),
('30fd6fee-f947-4bbb-8274-afe20f8ed081','0758ed61-2424-4209-8d84-991707f2ddb4','PUT 409 critical_requires_ack quando key.critical=true e acknowledge_critical=false',4,NOW(),NOW()),
('0d770a0e-b6bc-4d44-ae04-efa2cfdc5bb0','0758ed61-2424-4209-8d84-991707f2ddb4','GET /history retorna últimas 100 entries ordem desc por createdAt',5,NOW(),NOW()),
('9641250d-b5c2-4515-b2b1-234687d33668','0758ed61-2424-4209-8d84-991707f2ddb4','POST /revert valida history_id pertence à key (RPC raise se não)',6,NOW(),NOW()),
('05a09971-7ede-438e-9c22-a48ccd58b846','0758ed61-2424-4209-8d84-991707f2ddb4','Mesma Idempotency-Key 2x não duplica entry em app_config_history',7,NOW(),NOW()),

-- T-218 API templates endpoints
('67441daf-0fb5-45ba-bace-b7345968b08b','d05c5b90-8091-46dc-bae0-fe993412ccbf','GET /api/admin/templates aceita filtros channel/status (Zod query)',0,NOW(),NOW()),
('beeb806f-068b-457f-bbb1-20a2955991d7','d05c5b90-8091-46dc-bae0-fe993412ccbf','POST /api/admin/templates cria com status=draft (RPC create_notification_template)',1,NOW(),NOW()),
('a46a18f5-e934-437d-a119-e782f1d805c4','d05c5b90-8091-46dc-bae0-fe993412ccbf','PATCH /[id] em template active cria nova versão (version+1, supersedes_id, status=draft)',2,NOW(),NOW()),
('a295e38c-ef12-4869-ae8d-9b6dea06eeba','d05c5b90-8091-46dc-bae0-fe993412ccbf','POST /transition action=activate desativa active anterior (mesmo code/channel/locale)',3,NOW(),NOW()),
('ff99b2cd-5e82-4dce-b672-49b65e4bdbe4','d05c5b90-8091-46dc-bae0-fe993412ccbf','POST /transition retorna 409 invalid_transition em transição não permitida',4,NOW(),NOW()),
('3d838225-a0f4-4b6d-9260-516adbde8347','d05c5b90-8091-46dc-bae0-fe993412ccbf','Cada transição registra entry em notification_template_log',5,NOW(),NOW()),
('9c811679-4e0e-4af1-974d-6528503d0a23','d05c5b90-8091-46dc-bae0-fe993412ccbf','assertAdmin bloqueia 401/403 em todos os endpoints',6,NOW(),NOW()),

-- T-219 RPCs
('8e795587-7fda-43ee-86ba-d3b568f20113','831020bd-0794-483c-b0ef-68f42563e51d','Migration aplicada via psql; RPCs criadas com SECURITY DEFINER',0,NOW(),NOW()),
('a10cda5c-66a0-42cb-8b3e-90bb6368787a','831020bd-0794-483c-b0ef-68f42563e51d','apply_config_change raise forbidden quando claim role!=admin',1,NOW(),NOW()),
('aba340b9-bd84-4d86-b884-ba67a3a939d1','831020bd-0794-483c-b0ef-68f42563e51d','validate_app_config_value raise schema_violation quando matching_weights soma != 1.0',2,NOW(),NOW()),
('a6a05f6a-f766-4106-88cf-8232407af8da','831020bd-0794-483c-b0ef-68f42563e51d','validate_pricing_cap raise cap_violation quando max*mult > cap_teto da categoria',3,NOW(),NOW()),
('e4a4bbee-dae5-474c-92cb-dd6168f25384','831020bd-0794-483c-b0ef-68f42563e51d','validate_app_config_value raise quando kyc auto_reject >= auto_approve',4,NOW(),NOW()),
('27e44bdd-f916-4704-acd7-53a998e4ce2a','831020bd-0794-483c-b0ef-68f42563e51d','apply_config_change registra entry em app_config_history com justification',5,NOW(),NOW()),
('8b5c5c97-21ab-4f34-8b84-1b85fbeb9995','831020bd-0794-483c-b0ef-68f42563e51d','apply_config_change para key.critical insere admin_alerts(kind=config_critical_changed) e enqueue_notification_event',6,NOW(),NOW()),
('130bcb65-609f-4594-99f9-374b8ae2d198','831020bd-0794-483c-b0ef-68f42563e51d','revert_config_change cria nova entry de histórico (não muda histórico passado)',7,NOW(),NOW()),
('ba8ce399-2d6b-4626-aeec-99eec69aacef','831020bd-0794-483c-b0ef-68f42563e51d','preview_config_impact retorna warnings sem persistir (read-only)',8,NOW(),NOW()),

-- T-220 UI /admin/config
('cfb3d791-5227-4ac4-8d72-f0d561697151','62485f81-556c-4777-9fa3-ed2dcb6ab47c','/admin/config server-fetcha GET /api/admin/config (assertAdmin no server)',0,NOW(),NOW()),
('1a03c5a0-d300-4e43-8f4f-2f5948042473','62485f81-556c-4777-9fa3-ed2dcb6ab47c','Cards agrupados por section com label human-friendly',1,NOW(),NOW()),
('09565eae-9722-4d56-a043-dd6db41169e2','62485f81-556c-4777-9fa3-ed2dcb6ab47c','Badge "Crítico" em rows com critical=true',2,NOW(),NOW()),
('ab29ac79-87b4-42df-9182-e6a050d37204','62485f81-556c-4777-9fa3-ed2dcb6ab47c','Botões Editar/Histórico abrem dialogs locais (T-221/T-222)',3,NOW(),NOW()),
('eb5de8c1-bbdf-467e-9d79-a4addac04bfc','62485f81-556c-4777-9fa3-ed2dcb6ab47c','Layout mobile-first (cards full-width <768px)',4,NOW(),NOW()),
('7c26fff1-a2aa-47c7-b54e-2183e72b22a9','62485f81-556c-4777-9fa3-ed2dcb6ab47c','Reusa Card/Badge/Button do design system (sem componente novo)',5,NOW(),NOW()),

-- T-221 UI ConfigEditDialog
('93947606-d7a7-42ad-94f1-4f8231558d8c','348f6e58-6c71-4662-ba65-b5e4655e23ad','ResponsiveDialog usado (mobile bottom-sheet automático)',0,NOW(),NOW()),
('8303c3a9-52ce-4b8e-9c73-7b2c11e64c34','348f6e58-6c71-4662-ba65-b5e4655e23ad','Field compound API (Field/Field.Label/Field.Control) usado em todos os campos',1,NOW(),NOW()),
('5c0c0ae8-3827-4c17-b407-b98d07f4c336','348f6e58-6c71-4662-ba65-b5e4655e23ad','Editor por shape: matching_weights=5 sliders; feature_flags=lista toggles; cancellation_policy=array editor',2,NOW(),NOW()),
('35999bea-7841-4a92-b6c9-24ec58962550','348f6e58-6c71-4662-ba65-b5e4655e23ad','Preview de impacto via POST /preview com debounce 400ms',3,NOW(),NOW()),
('f830e349-4cd5-4720-a47e-9c09fed82b2e','348f6e58-6c71-4662-ba65-b5e4655e23ad','Botão Salvar disabled enquanto justification < 10 chars',4,NOW(),NOW()),
('705f938e-2460-4555-b5b0-9566fb008a52','348f6e58-6c71-4662-ba65-b5e4655e23ad','Para critical=true, checkbox de ack obrigatório antes de salvar',5,NOW(),NOW()),
('cdf9cb0b-2f91-4861-b00f-ede197734dc1','348f6e58-6c71-4662-ba65-b5e4655e23ad','Idempotency-Key novo gerado por sessão de edição (não fixo)',6,NOW(),NOW()),
('cb969681-4fdf-410d-9a7c-7eab78f23f00','348f6e58-6c71-4662-ba65-b5e4655e23ad','showErrorToast em erro de save (Sonner, distingue 400/409/5xx)',7,NOW(),NOW()),

-- T-222 UI ConfigHistorySheet
('02521263-b245-4ce8-a9b2-b6400aa1721f','efeffc63-6f14-444e-96be-82fbce975798','ResponsiveSheet size=lg usado',0,NOW(),NOW()),
('d1c35ac6-8c22-4cab-a4f7-073219765d4e','efeffc63-6f14-444e-96be-82fbce975798','Timeline ordenada desc por createdAt com diff visual entre old/new',1,NOW(),NOW()),
('3c258b65-c25f-4911-90a5-b94652247339','efeffc63-6f14-444e-96be-82fbce975798','Botão "Reverter para este valor" abre ConfirmDialog destrutivo',2,NOW(),NOW()),
('d7244ba1-fe4e-4431-97d5-7a12e81b2d0a','efeffc63-6f14-444e-96be-82fbce975798','Confirm chama POST /revert com Idempotency-Key + justification mínima',3,NOW(),NOW()),
('b0bc1387-74fc-4a36-bdc5-d4bb6208c933','efeffc63-6f14-444e-96be-82fbce975798','Após revert sucesso, lista de history re-fetcha (não duplica)',4,NOW(),NOW()),
('3bf88d39-ea4c-420d-8d75-478bbe4626f1','efeffc63-6f14-444e-96be-82fbce975798','Sem window.confirm (ConfirmDialog stateless)',5,NOW(),NOW()),

-- T-223 UI /admin/templates
('866b8814-a9b9-4769-8646-e2a05193033b','d80e73c5-e9e3-4414-aeca-a4a380708ec9','Lista filtrável por channel/status com StatusChip por status',0,NOW(),NOW()),
('7cb8783f-65df-404b-9d55-fa96fbf62ad0','d80e73c5-e9e3-4414-aeca-a4a380708ec9','useOptimisticCollection com transitions otimistas (status muda na UI antes do servidor)',1,NOW(),NOW()),
('ecc6eaeb-f9e7-433a-b66c-9318aa1a4e76','d80e73c5-e9e3-4414-aeca-a4a380708ec9','TemplateSheet (ResponsiveSheet size=lg) com Field compound API',2,NOW(),NOW()),
('dc0058bc-cd1b-43e7-a378-ddea64b5ca56','d80e73c5-e9e3-4414-aeca-a4a380708ec9','Edit em template active dispara ConfirmDialog "Vai criar versão N+1"',3,NOW(),NOW()),
('d5415f61-becc-4180-8233-290f5b84b800','d80e73c5-e9e3-4414-aeca-a4a380708ec9','Sem botão DELETE (apenas deprecate)',4,NOW(),NOW()),
('ad86b5e5-0631-41f5-91b7-18fee0aa6bd8','d80e73c5-e9e3-4414-aeca-a4a380708ec9','Layout mobile-first; sheet 90dvh em <768px',5,NOW(),NOW()),
('fd4a734d-0381-4543-9ca4-fb7da5c27824','d80e73c5-e9e3-4414-aeca-a4a380708ec9','showErrorToast em invalid_transition (409) com mensagem clara',6,NOW(),NOW()),

-- T-224 OPS seeds
('a154183c-481c-4a10-b9fa-b9e28cb4799f','ae31a446-0593-4bc9-b208-810edf3d6cab','Migration aplicada via psql',0,NOW(),NOW()),
('10f8eebf-f61e-4115-9e0e-ffe50f178fef','ae31a446-0593-4bc9-b208-810edf3d6cab','12 keys default presentes em app_config após seed (matching_weights..feature_flags)',1,NOW(),NOW()),
('f2cb41d5-7465-4bb2-bec9-5f227a6a839c','ae31a446-0593-4bc9-b208-810edf3d6cab','ON CONFLICT preserva value de produção (apenas metadata atualizada)',2,NOW(),NOW()),
('1461f644-cb69-4de1-ae9d-73cf8fc99fa1','ae31a446-0593-4bc9-b208-810edf3d6cab','Keys de T-064/T-203 (visita_tecnica*, supply_min_by_category, peak_hours) recebem section/critical/unit corretos',3,NOW(),NOW()),
('b597c907-3a66-412f-9caa-b92a8bfc6902','ae31a446-0593-4bc9-b208-810edf3d6cab','value_schema presente em todas as keys critical=true',4,NOW(),NOW()),
('750f07c4-4b5b-49f6-ae25-446bf506d0a5','ae31a446-0593-4bc9-b208-810edf3d6cab','Defaults coerentes com referências dos AC (pool=5, accept=15min, search=10min, max_attempts=2, refunds 90/60/30/10/0)',5,NOW(),NOW()),
('1f8b5120-03dd-49ab-bf37-63603870eca8','ae31a446-0593-4bc9-b208-810edf3d6cab','feature_flags inclui pix_enabled, infinite_scroll_history, priority_queue_admin, csv_export_async',6,NOW(),NOW()),
('d3af3240-9425-4d97-bbea-47d3c5887a1b','ae31a446-0593-4bc9-b208-810edf3d6cab','cancellation_policy.tiers ordenado desc por window_min',7,NOW(),NOW());


-- ============================================================================
-- 3. TaskAcceptanceCriterion — N:N task ↔ AC-da-Story
-- ============================================================================

INSERT INTO "TaskAcceptanceCriterion" ("taskId", "acceptanceCriterionId", "createdAt") VALUES
-- T-215 cobre AC #1 (agrupamento), #11 (histórico imutável)
('315c57de-7769-4f90-b45c-2447edd086a2','91d812ec-f174-41a4-b1a0-f04f50755a6c',NOW()),
('315c57de-7769-4f90-b45c-2447edd086a2','7a1908d4-a8a2-4d63-b408-8b2f38ef42ad',NOW()),

-- T-216 cobre AC #8
('e88368da-f36c-47ad-8d88-416a809d9d23','8a5597c9-bf3d-4134-934a-a7d57dc48b6f',NOW()),

-- T-217 cobre AC #1, #2, #3, #5, #6, #7, #9, #11
('0758ed61-2424-4209-8d84-991707f2ddb4','91d812ec-f174-41a4-b1a0-f04f50755a6c',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','9966fc59-5db4-4f30-b22c-0cd5466b117d',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','d65b6cf9-1f38-4a31-bd7e-f6f265ee9e9b',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','878df3c7-bc5d-42b2-a05f-1e6986cf8b14',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','2a2c1468-14cf-45b2-8126-8e6d8852d40a',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','cd170a4d-8ea3-4a21-b91a-8d87b755418b',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','ca50015e-9bbd-4321-b0ec-ec307d88122c',NOW()),
('0758ed61-2424-4209-8d84-991707f2ddb4','7a1908d4-a8a2-4d63-b408-8b2f38ef42ad',NOW()),

-- T-218 cobre AC #8
('d05c5b90-8091-46dc-bae0-fe993412ccbf','8a5597c9-bf3d-4134-934a-a7d57dc48b6f',NOW()),

-- T-219 cobre AC #2 (matching weights), #4 (cap), #5 (KYC), #10 (cancellation), #12 (preview)
('831020bd-0794-483c-b0ef-68f42563e51d','9966fc59-5db4-4f30-b22c-0cd5466b117d',NOW()),
('831020bd-0794-483c-b0ef-68f42563e51d','c3e92b2f-4d1c-4c77-ac5e-e63d90656f70',NOW()),
('831020bd-0794-483c-b0ef-68f42563e51d','878df3c7-bc5d-42b2-a05f-1e6986cf8b14',NOW()),
('831020bd-0794-483c-b0ef-68f42563e51d','4ee85389-9d5d-4c21-8241-11e0b659e9c2',NOW()),
('831020bd-0794-483c-b0ef-68f42563e51d','dd468e10-26eb-487f-b5f4-222866ccc7ef',NOW()),

-- T-220 cobre AC #1 (lista agrupada por section)
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','91d812ec-f174-41a4-b1a0-f04f50755a6c',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','9966fc59-5db4-4f30-b22c-0cd5466b117d',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','d65b6cf9-1f38-4a31-bd7e-f6f265ee9e9b',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','c3e92b2f-4d1c-4c77-ac5e-e63d90656f70',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','878df3c7-bc5d-42b2-a05f-1e6986cf8b14',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','2a2c1468-14cf-45b2-8126-8e6d8852d40a',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','cd170a4d-8ea3-4a21-b91a-8d87b755418b',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','ca50015e-9bbd-4321-b0ec-ec307d88122c',NOW()),
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','4ee85389-9d5d-4c21-8241-11e0b659e9c2',NOW()),

-- T-221 cobre AC #2-#7, #9, #10 (edição) + #12 (confirmação crítica)
('348f6e58-6c71-4662-ba65-b5e4655e23ad','9966fc59-5db4-4f30-b22c-0cd5466b117d',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','d65b6cf9-1f38-4a31-bd7e-f6f265ee9e9b',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','c3e92b2f-4d1c-4c77-ac5e-e63d90656f70',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','878df3c7-bc5d-42b2-a05f-1e6986cf8b14',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','2a2c1468-14cf-45b2-8126-8e6d8852d40a',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','cd170a4d-8ea3-4a21-b91a-8d87b755418b',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','ca50015e-9bbd-4321-b0ec-ec307d88122c',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','4ee85389-9d5d-4c21-8241-11e0b659e9c2',NOW()),
('348f6e58-6c71-4662-ba65-b5e4655e23ad','dd468e10-26eb-487f-b5f4-222866ccc7ef',NOW()),

-- T-222 cobre AC #11 (histórico + revert)
('efeffc63-6f14-444e-96be-82fbce975798','7a1908d4-a8a2-4d63-b408-8b2f38ef42ad',NOW()),

-- T-223 cobre AC #8
('d80e73c5-e9e3-4414-aeca-a4a380708ec9','8a5597c9-bf3d-4134-934a-a7d57dc48b6f',NOW()),

-- T-224 cobre AC #2-#7, #9, #10 (defaults seedados)
('ae31a446-0593-4bc9-b208-810edf3d6cab','9966fc59-5db4-4f30-b22c-0cd5466b117d',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','d65b6cf9-1f38-4a31-bd7e-f6f265ee9e9b',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','c3e92b2f-4d1c-4c77-ac5e-e63d90656f70',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','878df3c7-bc5d-42b2-a05f-1e6986cf8b14',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','2a2c1468-14cf-45b2-8126-8e6d8852d40a',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','cd170a4d-8ea3-4a21-b91a-8d87b755418b',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','ca50015e-9bbd-4321-b0ec-ec307d88122c',NOW()),
('ae31a446-0593-4bc9-b208-810edf3d6cab','4ee85389-9d5d-4c21-8241-11e0b659e9c2',NOW());


-- ============================================================================
-- 4. TaskDependency — ordem de execução intra-US + cross-US relates_to
-- ============================================================================

INSERT INTO "TaskDependency" ("taskId", "dependsOn", kind, "createdAt") VALUES
-- Intra-US blocks (DAG: T-215 → T-217/T-219; T-216 → T-218; T-217+T-219 → T-220/T-221/T-222; T-218 → T-223; T-215 → T-224)
('0758ed61-2424-4209-8d84-991707f2ddb4','315c57de-7769-4f90-b45c-2447edd086a2','blocks',NOW()),  -- T-217 blocked by T-215
('831020bd-0794-483c-b0ef-68f42563e51d','315c57de-7769-4f90-b45c-2447edd086a2','blocks',NOW()),  -- T-219 blocked by T-215
('0758ed61-2424-4209-8d84-991707f2ddb4','831020bd-0794-483c-b0ef-68f42563e51d','blocks',NOW()),  -- T-217 blocked by T-219
('d05c5b90-8091-46dc-bae0-fe993412ccbf','e88368da-f36c-47ad-8d88-416a809d9d23','blocks',NOW()),  -- T-218 blocked by T-216
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','0758ed61-2424-4209-8d84-991707f2ddb4','blocks',NOW()),  -- T-220 blocked by T-217
('348f6e58-6c71-4662-ba65-b5e4655e23ad','0758ed61-2424-4209-8d84-991707f2ddb4','blocks',NOW()),  -- T-221 blocked by T-217
('348f6e58-6c71-4662-ba65-b5e4655e23ad','831020bd-0794-483c-b0ef-68f42563e51d','blocks',NOW()),  -- T-221 blocked by T-219
('efeffc63-6f14-444e-96be-82fbce975798','0758ed61-2424-4209-8d84-991707f2ddb4','blocks',NOW()),  -- T-222 blocked by T-217
('d80e73c5-e9e3-4414-aeca-a4a380708ec9','d05c5b90-8091-46dc-bae0-fe993412ccbf','blocks',NOW()),  -- T-223 blocked by T-218
('ae31a446-0593-4bc9-b208-810edf3d6cab','315c57de-7769-4f90-b45c-2447edd086a2','blocks',NOW()),  -- T-224 blocked by T-215

-- Cross-US relates_to (reuso documentado)
('315c57de-7769-4f90-b45c-2447edd086a2','70c81687-43c2-4d0f-acd7-d66c67dbd5a4','relates_to',NOW()),  -- T-215 estende app_config de T-064 (US-010)
('315c57de-7769-4f90-b45c-2447edd086a2','d9322290-f18b-4cae-bfaa-08ce5f111b19','relates_to',NOW()),  -- T-215 reusa pattern append-only de T-204 (US-017)
('0758ed61-2424-4209-8d84-991707f2ddb4','21ffd791-ccbe-4b58-b076-68053e32f7d8','relates_to',NOW()),  -- T-217 reusa assertAdmin de T-194 (US-016)
('d05c5b90-8091-46dc-bae0-fe993412ccbf','21ffd791-ccbe-4b58-b076-68053e32f7d8','relates_to',NOW()),  -- T-218 reusa assertAdmin de T-194
('831020bd-0794-483c-b0ef-68f42563e51d','42af5179-9d07-4566-8fbe-eec1a72d7ee8','relates_to',NOW()),  -- T-219 chama enqueue_notification_event T-162 (US-022)
('831020bd-0794-483c-b0ef-68f42563e51d','cbf51fd6-4b0d-47c7-86d4-1be386d5d5f0','relates_to',NOW()),  -- T-219 INSERT em admin_alerts T-190 (US-016)
('ae31a446-0593-4bc9-b208-810edf3d6cab','70c81687-43c2-4d0f-acd7-d66c67dbd5a4','relates_to',NOW()),  -- T-224 amplia seeds de T-064 (US-010)
('ae31a446-0593-4bc9-b208-810edf3d6cab','bfc20471-88f9-4260-ae8d-9d539cb14387','relates_to',NOW()),  -- T-224 amplia seeds de T-203 (US-016)
('62485f81-556c-4777-9fa3-ed2dcb6ab47c','21ffd791-ccbe-4b58-b076-68053e32f7d8','relates_to',NOW()),  -- T-220 segue pattern endpoint admin de T-194
('e88368da-f36c-47ad-8d88-416a809d9d23','d9322290-f18b-4cae-bfaa-08ce5f111b19','relates_to',NOW());  -- T-216 reusa append-only pattern de T-204

COMMIT;
