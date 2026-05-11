# 03 — Layer Playbooks

Padrões e exemplos por camada. Quando estiver gerando uma task, encontre o padrão mais próximo aqui e adapte.

> **Padrão de description: SDD** (ver [01-task-generation-rules.md §8](01-task-generation-rules.md)).
> Estrutura: **Objetivo / Contexto / Estado atual / O que criar (com snippets) / Constraints / Convenções**.
> O **checklist de pronto** NÃO vai no markdown — vai em `AcceptanceCriterion(taskId=...)` (ver [§6.5](01-task-generation-rules.md#65-modelo-de-ac-story-vs-task-leia-antes-de-gerar)).
> Os exemplos abaixo mostram a description; cada anatomy também lista o **checklist técnico típico** que vira AC-da-Task.

---

## DATA

### Quando criar uma task DATA?

- Existe schema novo (tabela, coluna, enum, índice, constraint, trigger, view)
- Existe RLS policy nova ou alterada
- Existe job `pg_cron`
- Existe migration de seed/dados iniciais

### Anatomia padrão (description SDD)

```markdown
Title: Criar tabela `<nome>` com RLS por <persona>

## Objetivo
<o que a tabela armazena, quem consome, em 1-2 frases. Refs a AC-da-Story por # quando útil>

## Contexto
<módulo, dependências entre US, quem grava (service role vs client), quem lê>

## Estado atual / O que substitui
<"não existe", ou "expande X", ou "substitui Y de US-NNN">

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_<feature>.sql`
```sql
BEGIN;

CREATE TABLE <nome> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- colunas
  "createdAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX ON <nome>(<col>);

ALTER TABLE <nome> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<nome>_select" ON <nome> FOR SELECT
  USING (auth.uid() = <fk>);
CREATE POLICY "<nome>_admin_all" ON <nome> FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

COMMIT;
```

## Constraints / NÃO fazer
- ❌ <colunas que NÃO entram aqui (vivem em outra US)>
- ❌ Permitir UPDATE de <coluna sensível> via RLS de owner (deixar pra service role)

## Convenções
- Migration via psql; `database.types.ts` regenerado
- `"createdAt"`/`"updatedAt"` com aspas duplas (convenção do projeto)
```

### Checklist técnico típico (`AcceptanceCriterion(taskId)`)

Itens que viram checkbox no TaskSheet — uma string por item:
- `Migration aplicada via psql; database.types.ts regenerado`
- `Tabela <nome> criada com colunas, índices e CHECK constraints`
- `RLS: persona A não lê linhas da persona B (smoke test via SET ROLE ou Supabase client com JWT)`
- `Constraint UNIQUE/CHECK ativos (smoke: violation retorna erro)`
- `Trigger updatedAt funciona em UPDATE`
- `Admin lê tudo (verificado com claim app_metadata.role='admin')`

### Padrão de migration de Zelar v2

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS <table_name> (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- colunas de domínio
  -- ...
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX <idx_name> ON <table_name>(<col>);

ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<policy_name>" ON <table_name>
  FOR <op> USING (<expr>) WITH CHECK (<expr>);

-- Trigger updatedAt (já existe util? confirmar)
CREATE TRIGGER <trigger_name>
  BEFORE UPDATE ON <table_name>
  FOR EACH ROW EXECUTE FUNCTION moddatetime("updatedAt");

COMMIT;
```

### Tipos comuns de task DATA por padrão

| Padrão | Exemplo Zelar |
|---|---|
| Tabela de domínio com RLS | `service_requests`, `provider_profiles`, `support_tickets` |
| Tabela de log imutável | `service_events`, `provider_moderation_log`, `dispute_decisions` |
| Constraint de transição | `validate_status_transition()` |
| Job pg_cron | release de escrow T+72h, aceite tácito T+48h, expiração de garantia D+30 |
| View materializada | `dashboard_kpis_mv`, `provider_score_mv` |
| Enum | `service_status`, `dispute_outcome`, `kyc_status` |

---

## API

### Quando criar uma task API?

- Endpoint Next route handler (`src/app/api/<path>/route.ts`)
- Server action Next (`src/app/<page>/actions.ts`)
- Edge Function Supabase (`supabase/functions/<name>/index.ts`)
- RPC Postgres (`CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql`)
- Integração externa (gateway, KYC, NLP, mensageria)

### Anatomia padrão (description SDD)

```markdown
Title: Implementar endpoint POST /api/services/[id]/cancel

## Objetivo
Permitir que cliente cancele serviço com aplicação automática da política de cancelamento (split financeiro + atualização de status). Cobre AC #N da US-NNN.

## Contexto
Módulo SOLICITACAO/EXECUCAO — chamado pela UI de detalhes do serviço. Depende da máquina de estados (US-023) e da política configurada em `app_config.cancellation_policy` (US-019). Notifica via fila (US-022) sem bloquear resposta.

## Estado atual / O que substitui
Não existe endpoint de cancelamento.

## O que criar

### `src/app/api/services/[id]/cancel/route.ts`
```typescript
import { z } from 'zod';

const Body = z.object({
  reason: z.enum(['client_change_mind', 'force_majeure', 'service_mismatch', 'other']),
  details: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idemKey = req.headers.get('idempotency-key');
  if (!idemKey) return Response.json({ error: 'missing_idempotency_key' }, { status: 400 });

  const body = Body.parse(await req.json());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_cancellation_policy', {
    p_service_id: params.id,
    p_reason: body.reason,
    p_details: body.details,
    p_actor: 'client',
  });
  // 403 via RLS; 409 se status terminal (RPC RAISE)
  if (error) return mapRpcError(error);
  return Response.json(data);
}
```

### RPC `apply_cancellation_policy`
- `LANGUAGE plpgsql SECURITY DEFINER`
- Lê `service_requests` + `app_config.cancellation_policy`
- Calcula split, atualiza status, registra `service_events`
- RAISE se status não for cancelável (mapeia para 409)

## Constraints / NÃO fazer
- ❌ Executar estorno no gateway aqui (vive em task separada)
- ❌ Enviar notificação síncrona (enfileira via US-022)
- ❌ Validar CPF/dados sensíveis no client

## Convenções
- Idempotency-Key header obrigatório
- Erros padronizados: 400 (validação), 403 (RLS), 409 (estado terminal)
- Logs estruturados (entity, action, actor)
- Secrets relevantes: nenhum direto (gateway é outra task)
```

### Checklist técnico típico (`AcceptanceCriterion(taskId)`)

- `Endpoint valida body com Zod (400 em formato inválido)`
- `403 quando usuário não é dono do recurso (via RLS)`
- `409 quando estado não permite a operação`
- `Idempotency-Key obrigatório (400 sem header)`
- `Mesma idempotency_key 2x não duplica efeito`
- `RPC criada, SECURITY DEFINER e testada via psql`
- `Logs estruturados de cada operação`
- `Audit log registra actor + decisão (quando AUDIT_LOG aplicável)`

### Padrão de validação Zod

```typescript
// src/app/api/services/[id]/cancel/route.ts
import { z } from 'zod';

const Body = z.object({
  reason: z.enum(['client_change_mind', 'force_majeure', 'service_mismatch', 'other']),
  details: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const idempotencyKey = req.headers.get('idempotency-key');
  const body = Body.parse(await req.json()); // throws ZodError -> 400
  // ...
}
```

### Padrão de Edge Function

Use Edge Function (Deno) para:
- Webhooks de provedores externos (Mercado Pago, Unico)
- Trigger de jobs pg_cron que precisam chamar APIs externas
- NLP (anti-bypass S4)
- Geração de PDFs (recibos)

Use Server Action para:
- Mutações chamadas direto da UI sem precisar de URL pública
- Forms simples com retorno de redirect

Use Route Handler `/api/*` para:
- Endpoints que precisam de URL pública e payload JSON
- Endpoints chamados por Edge Functions ou jobs

### Tipos comuns de task API por padrão

| Padrão | Exemplo Zelar |
|---|---|
| CRUD endpoint com RLS | `/api/services`, `/api/addresses` |
| Mutation com idempotency | `/api/services/[id]/accept`, `/api/payments/capture` |
| Webhook receiver | `/api/webhooks/mercadopago`, `/api/webhooks/unico` |
| Edge Function de job | `release-escrow`, `cancel-stale-broadcasts`, `recalc-bypass-score` |
| RPC Postgres | `apply_cancellation_policy()`, `validate_status_transition()`, `decide_dispute()` |
| Server action de form | submeter solicitação de serviço, enviar avaliação |

---

## REALTIME

### Quando criar uma task REALTIME?

- Tela atualiza ao vivo sem refresh (estado entre 2 partes)
- Broadcast para múltiplos clientes (pool de prestadores)
- Notificação push web
- Sincronização de estado distribuído

### Anatomia padrão (description SDD)

```markdown
Title: Configurar canal Realtime de stepper de execução

## Objetivo
Cliente vê em tempo real cada transição de estado feita pelo prestador na execução do serviço, com latência <500ms. Cobre AC #N de US-005/US-012.

## Contexto
Módulo EXECUCAO — depende da máquina de estados (US-023). Subscribers: PWA cliente (US-012) e PWA prestador (US-005). Mesma fonte (`service_requests` UPDATE), múltiplos consumers.

## Estado atual / O que substitui
Não há canal configurado.

## O que criar

### `src/hooks/use-service-realtime.ts`
```typescript
export function useServiceRealtime(serviceId: string, onUpdate: (s: ServiceRow) => void) {
  useEffect(() => {
    const channel = supabase
      .channel(`service:${serviceId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'service_requests',
        filter: `id=eq.${serviceId}`,
      }, (payload) => onUpdate(payload.new as ServiceRow))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [serviceId, onUpdate]);
}
```

### Fallback
- Hook auxiliar que faz polling a cada 10s caso `channel.subscribe()` retorne `CHANNEL_ERROR` ou `TIMED_OUT`.

## Constraints / NÃO fazer
- ❌ Sem unsubscribe no unmount (memory leak / channel duplicado)
- ❌ Subscribe em coluna específica que o RLS não autoriza (nada chega)
- ❌ Confiar 100% em Realtime sem fallback (rede móvel cai)

## Convenções
- Nome do canal: `<entidade>:<id>` (consistência cross-features)
- RLS da tabela já filtra quem pode ouvir (Postgres changes respeitam RLS)
- Reconnect: cliente Supabase faz automático
```

### Checklist técnico típico (`AcceptanceCriterion(taskId)`)

- `Canal subscrito no mount; unsubscribe no unmount (sem leak)`
- `UPDATE no DB chega em <500ms na UI (medido)`
- `Reconnect automático após perda de rede testado`
- `Fallback de polling a 10s ativa em CHANNEL_ERROR/TIMED_OUT`
- `RLS impede que outra persona ouça canal alheio (smoke test)`
- `Canal nomeado conforme convenção <entidade>:<id>`

### Padrão de canal

```typescript
// Subscriber
const channel = supabase
  .channel(`service:${serviceId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'service_requests',
    filter: `id=eq.${serviceId}`,
  }, (payload) => {
    setService(payload.new);
  })
  .subscribe();

// Cleanup
return () => { supabase.removeChannel(channel); };
```

### Tipos comuns de task REALTIME por padrão

| Padrão | Exemplo Zelar |
|---|---|
| Canal por entidade | `service:{id}` para acompanhamento, `provider:{id}` para agenda |
| Broadcast de evento | pool broadcast (US-004) — usar `broadcast` do Realtime, não tabela |
| Listagem ao vivo | agenda do prestador (US-027), dashboard admin (US-016) |
| Chat | mensagens entre cliente e prestador (US-025 — INSERT em `messages` com filter por conversation) |

---

## UI

### Quando criar uma task UI?

- Tela nova ou seção nova em tela existente
- Componente reutilizável novo (raro — preferir reuso)
- Form com validação client-side
- Lista mutável (precisa optimistic update)

### Anatomia padrão (description SDD)

```markdown
Title: Renderizar tela de catálogo de serviços com 7 categorias

## Objetivo
Cliente (autenticado ou anônimo) acessa home e vê grade com as 7 categorias do MVP, navegando para subcategorias ao tocar. Cobre AC #N de US-010.

## Contexto
Módulo SOLICITACAO — primeira UI pública. Lê categorias seedadas em T-001 (catálogo). Sem auth: RLS allow public. Em desktop renderiza grid 2x4; em mobile, lista vertical.

## Estado atual / O que substitui
Não existe home do cliente. `src/app/(client)/page.tsx` ainda não existe.

## O que criar

### `src/app/(client)/page.tsx`
```tsx
// Server Component — server-fetch direto (não precisa client)
export default async function HomePage() {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from('service_categories')
    .select('id, slug, name, icon')
    .eq('active', true)
    .order('order');

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="text-2xl font-semibold">O que você precisa hoje?</h1>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {categories?.map(c => <CategoryCard key={c.id} category={c} />)}
      </div>
    </main>
  );
}
```

### `src/components/catalog/CategoryCard.tsx`
- Reutiliza `Card` (`src/components/ui/card.tsx`)
- Tap leva a `/(client)/catalog/[categorySlug]`

## Constraints / NÃO fazer
- ❌ `<input>`/forms aqui (nenhum)
- ❌ Buscar categorias do client com `createBrowserClient` (já temos no server)
- ❌ Marcar página como `'use client'` (estática + SSR é mais rápido)

## Convenções
- Reuso: `Card`, `Skeleton` (loading), `Sonner` (erro)
- Sem optimistic update (lista read-only)
- Sem `ResponsiveSheet` (navegação direta)
- Mobile-first
```

### Checklist técnico típico (`AcceptanceCriterion(taskId)`)

- `7 categorias renderizadas com nome e ícone`
- `Tap em categoria navega para /catalog/[slug]`
- `Skeleton durante carregamento`
- `Funciona sem auth (anônimo)`
- `Layout mobile-first verificado em viewport <768px`
- `Reusa Card do design system (sem componente novo)`

### Padrão de form com Field compound API

```tsx
import { Field, FormBody } from '@/components/ui/field';

<FormBody density="comfortable">
  <Field name="title" required error={errors.title}>
    <Field.Label>Título</Field.Label>
    <Field.Control>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
    </Field.Control>
    <Field.Hint>Máximo 80 caracteres</Field.Hint>
  </Field>
</FormBody>
```

### Padrão de optimistic update

```tsx
import { useOptimisticCollection } from '@/hooks/use-optimistic-collection';

const { items, mutate } = useOptimisticCollection<Address>(initialAddresses);

const handleDelete = async (id: string) => {
  await mutate(
    { type: 'delete', id },
    async (signal) => {
      const res = await fetch(`/api/addresses/${id}`, {
        method: 'DELETE',
        signal,
      });
      if (!res.ok) throw new HttpError(res.status, await res.text());
    },
    { errorLabel: 'Falha ao remover endereço' }
  );
};
```

### Padrão de modal/sheet

```tsx
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';

<ResponsiveSheet open={open} onOpenChange={setOpen} size="md">
  <ResponsiveSheet.Header>Editar perfil</ResponsiveSheet.Header>
  <ResponsiveSheet.Body>
    <FormBody>...</FormBody>
  </ResponsiveSheet.Body>
  <ResponsiveSheet.Footer>
    <Button onClick={save}>Salvar</Button>
  </ResponsiveSheet.Footer>
</ResponsiveSheet>
```

### Tipos comuns de task UI por padrão

| Padrão | Exemplo Zelar |
|---|---|
| Lista com skeleton + estado vazio | agenda, histórico, carteira, painel admin |
| Form de submissão com Zod | solicitação de serviço, ticket de suporte |
| Stepper visual com tempo real | acompanhamento (US-012), execução (US-005) |
| Mapa inline | trajeto do prestador (US-012) |
| Modal de decisão | aprovar/recusar reajuste (US-015) |
| Sheet de edição | editar perfil (US-007), editar endereço (US-014) |
| Confirmação destrutiva | excluir endereço, cancelar serviço, suspender prestador |

---

## OPS

### Quando criar uma task OPS?

- Feature flag nova
- Parâmetro configurável sem deploy
- Dashboard de operação interno
- Runbook de operação
- Seed de dados base (categorias, templates)

### Anatomia padrão (description SDD)

```markdown
Title: Criar tabela `app_config` com parâmetros operacionais editáveis

## Objetivo
Permitir que admin ajuste pesos de matching, thresholds de KYC, prazos e feature flags sem deploy. Cobre AC #N de US-019.

## Contexto
Módulo ADMIN — fundação para parametrização. Lida por authenticated (todo backend); editada apenas por admin via US-019. Histórico imutável em `app_config_history`.

## Estado atual / O que substitui
Não existe tabela de config. Hoje constantes ficam em código.

## O que criar

### `supabase/migrations/<YYYYMMDD>_zelar_v2_app_config.sql`
```sql
BEGIN;

CREATE TABLE app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES auth.users(id),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE app_config_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid,
  "changedAt" timestamptz NOT NULL DEFAULT NOW()
);

-- Seeds
INSERT INTO app_config (key, value, description) VALUES
  ('matching_weights', '{"q":0.3,"t":0.2,"d":0.15,"f":0.15,"c":0.2}'::jsonb, 'Pesos engine matching'),
  ('broadcast_pool_size', '5'::jsonb, 'Tamanho do pool por broadcast'),
  ('kyc_auto_approve_threshold', '0.7'::jsonb, 'Score Unico para auto-aprovação'),
  ('feature_flags', '{"pix_enabled":true}'::jsonb, 'Flags de feature');

-- RLS
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select" ON app_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON app_config FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger histórico
CREATE OR REPLACE FUNCTION app_config_log() RETURNS trigger AS $$
BEGIN
  INSERT INTO app_config_history (key, old_value, new_value, changed_by)
  VALUES (NEW.key, OLD.value, NEW.value, NEW.updated_by);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER app_config_audit AFTER UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION app_config_log();

COMMIT;
```

## Constraints / NÃO fazer
- ❌ Permitir UPDATE por authenticated não-admin
- ❌ Mudar `value` sem trigger registrar histórico
- ❌ Substituir constantes hardcoded ainda — UI de admin (US-019) precisa existir antes

## Convenções
- Chaves em snake_case
- `value` sempre jsonb (mesmo escalar) para consistência
- `description` documenta semântica para o admin
```

### Checklist técnico típico (`AcceptanceCriterion(taskId)`)

- `Tabela app_config criada com seeds aplicados`
- `Tabela app_config_history criada para auditoria`
- `RLS: authenticated lê; somente admin escreve`
- `Trigger registra cada UPDATE em app_config_history`
- `Smoke: SELECT por client retorna; UPDATE retorna policy denied`
- `Admin via claim consegue UPDATE`

### Tipos comuns de task OPS por padrão

| Padrão | Exemplo Zelar |
|---|---|
| Tabela de config + seed | `app_config`, `pricing_categories`, `cancellation_policy` |
| Feature flag | habilita Pix, infinite scroll, fila prioritária |
| Dashboard interno admin | métricas operacionais, alertas |
| Runbook de operação | "como liberar saque antecipado", "como reverter no-show falso" |
| Templates pré-aprovados | mensagens transacionais (US-024) |

---

## Resumo: matriz "tipo de AC" → "camadas tipicamente afetadas"

| AC genérico | DATA | API | REALTIME | UI | OPS |
|---|---|---|---|---|---|
| Vê lista própria | ✅ (RLS) | ✅ | ⚠️ (se ao vivo) | ✅ | |
| Submete form | ✅ | ✅ | | ✅ | |
| Estado entre 2 partes em tempo real | ✅ | ✅ | ✅ | ✅ | |
| Decisão admin com auditoria | ✅ (audit) | ✅ | | ✅ | |
| Sistema dispara ação automática | ✅ (job) | ✅ | | | |
| Sistema valida regra | ✅ (constraint/RPC) | ✅ | | | |
| Configura parâmetro | | | | ✅ | ✅ |
| Recebe notificação externa | | ✅ | | | |
| Permissão por persona | ✅ (RLS) | | | | |
