# 02 — Quality Checklist

Lista exaustiva de pontos de qualidade que a skill **deve** considerar e marcar via `Task.qualityFlags` quando aplicável.

## A. RLS por persona (DATA/API)

Toda task DATA/API que toque tabela com dados de usuário **deve**:

1. Definir `Task.personaScope` (CLIENTE/PRESTADOR/ADMIN/SISTEMA/ANY)
2. Ter flag `RLS_REQUIRED` em `qualityFlags`
3. Em description, declarar a policy explícita

### Padrões de RLS por persona

#### CLIENTE
```sql
-- SELECT: só seus próprios registros
CREATE POLICY "client_own_records" ON service_requests
  FOR SELECT USING (auth.uid() = client_id);

-- INSERT: só com client_id = auth.uid()
CREATE POLICY "client_create_own" ON service_requests
  FOR INSERT WITH CHECK (auth.uid() = client_id);

-- UPDATE: só seus + status permitido (ex: não pode mudar status para 'completed')
CREATE POLICY "client_update_own" ON service_requests
  FOR UPDATE USING (auth.uid() = client_id)
  WITH CHECK (status IN ('draft', 'queued', 'cancelled'));
```

#### PRESTADOR
```sql
-- SELECT: serviços onde é o prestador alocado
CREATE POLICY "provider_assigned" ON service_requests
  FOR SELECT USING (auth.uid() = provider_id);

-- SELECT pool: vê propostas elegíveis (durante broadcast)
-- Use uma função SECURITY DEFINER chamada pela API,
-- não exponha pool direto via RLS.

-- UPDATE: só campos operacionais permitidos por status
CREATE POLICY "provider_update_status" ON service_requests
  FOR UPDATE USING (auth.uid() = provider_id)
  WITH CHECK (validate_status_transition(OLD.status, NEW.status));
```

#### ADMIN
```sql
-- Tudo via claim em app_metadata.role = 'admin'
CREATE POLICY "admin_all" ON service_requests
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

> Ver memory `feedback_role_helpers_postgres`: ao adicionar role, atualizar `ROLE_LEVELS` (TS) E `is_admin/is_manager` (Postgres).

#### SISTEMA
- Jobs `pg_cron` rodam com `service_role` — RLS **não se aplica**
- Edge Functions usam `SUPABASE_SERVICE_ROLE_KEY` apenas para operações sistêmicas (notificações, recálculo de score, broadcast)
- **NUNCA expor service_role no frontend**
- Edge Functions chamadas por usuário usam o `anon` key + JWT do caller

#### ANONYMOUS
- Catálogo público (US-010 catálogo de serviços antes do login)
- `CREATE POLICY "anon_read_catalog" ON categories FOR SELECT USING (true);`
- Tudo mais negado por padrão

### Checklist de RLS

- [ ] Policy de SELECT cobre acesso de leitura?
- [ ] Policy de INSERT/UPDATE/DELETE cobre escrita?
- [ ] `WITH CHECK` previne escalação de privilégio?
- [ ] Tabela tem `ENABLE ROW LEVEL SECURITY`?
- [ ] Service role bypass está documentado?
- [ ] Tabela auditável tem policy de leitura para ADMIN?

## B. Segurança em API

### Validação de input
- **Zod no servidor** para todo body POST/PATCH/PUT (`src/app/api/**`)
- **Nunca confiar** no frontend para validação de regras de negócio
- Sanitizar strings que viram conteúdo de notificação externa (XSS via WhatsApp/email é raro mas possível)

Flag: `INPUT_VALIDATION` em qualityFlags.

### Secrets
- `process.env.X` em server-only files (server actions, Edge Functions, route handlers)
- **NUNCA** em arquivos com `'use client'` ou exportados para o cliente
- Lista mínima esperada para Zelar:
  - `MERCADOPAGO_ACCESS_TOKEN` (gateway)
  - `UNICO_API_KEY` (KYC)
  - `META_WHATSAPP_TOKEN` (mensageria)
  - `RESEND_API_KEY` (email)
  - `OPENAI_API_KEY` (NLP anti-bypass)
  - `SUPABASE_SERVICE_ROLE_KEY` (jobs/Edge Functions sistêmicas)

Flag: `SECRET_HANDLING`.

### Rate limit
Endpoints sensíveis devem ter rate limit (via middleware Next ou Edge Function):

- POST /api/services/cancel — limita por user
- POST /api/services/[id]/client-absent — geolocalizado, limita por device
- POST /api/disputes/report-bypass — limita por par (cliente, prestador)
- POST /api/auth/* — limita por IP

Flag: `RATE_LIMIT`.

### Idempotência
Mutações financeiras críticas precisam de `idempotency_key`:

- Criação de pagamento (US-011)
- Aceite de proposta (US-004 — race no banco)
- Liberação de escrow (US-005, US-023)
- Estorno por disputa (US-026)

Flag: `IDEMPOTENCY_KEY`.

### Audit log imutável
Decisões de admin e eventos críticos do ciclo de vida:

- Aprovação/reprovação KYC (US-017)
- Suspensão/reativação de prestador (US-017)
- Decisão de disputa (US-026)
- Alteração de parâmetros operacionais (US-019)
- Transições de estado do serviço (US-023)

Tabela genérica `audit_log (entity_type, entity_id, actor_id, action, payload jsonb, created_at)` ou tabelas específicas (`provider_moderation_log`, `dispute_decisions`, `service_events`).

Flag: `AUDIT_LOG`.

## C. Race conditions

Onde tem corrida pelo aceite ou recursos compartilhados:

- US-004 — pool broadcast: usar `SELECT FOR UPDATE SKIP LOCKED` ou constraint única `(service_request_id, status='accepted')`
- US-021 — recálculo de score R(o,c) concorrente: lock advisory por par `pg_advisory_xact_lock(provider_id, client_id)`
- US-005 — geração de código de confirmação: constraint única `(service_request_id) WHERE used_at IS NULL`
- US-023 — transição de estado paralela: `UPDATE WHERE status = ?old_status` (CAS otimista)

Flag: `RACE_CONDITION`.

## D. Reuso de UI (qualityFlags em tasks UI)

Toda task UI **deve** verificar reuso antes (catálogo em [04-reusable-components.md](04-reusable-components.md)). Flags possíveis:

- `REUSE_EXISTING_COMPONENT` — usa componente do `src/components/ui/`
- `REUSE_EXISTING_HOOK` — usa hook do `src/hooks/`
- `RESPONSIVE_SHEET_REQUIRED` — não pode usar `<Dialog>` cru
- `CONFIRM_DIALOG_REQUIRED` — não pode usar `window.confirm()`
- `FIELD_COMPOUND_API` — formulário usa `<Field/>` compound, não input cru
- `OPTIMISTIC_UPDATE` — lista mutável usa `useOptimisticCollection`

## E. Performance

### Listas longas
US com listas que podem crescer (carteira, histórico, painel admin, agenda) precisam:

- Paginação OU scroll infinito declarado na task
- Query com `LIMIT` + cursor
- Índice em coluna de ordenação (geralmente `created_at`)

Flag: `PAGINATION` ou `INFINITE_SCROLL`.

### Realtime
Toda task REALTIME declara:

- Nome do canal (ex: `service_requests:{provider_id}`)
- Quem subscreve (cliente PWA / prestador PWA / admin painel)
- Eventos transmitidos (INSERT/UPDATE de quais colunas)

Flag: `REALTIME_CHANNEL`.

### Queries pesadas
Relatórios admin (US-016) e queries com agregação histórica:

- Considerar **materialized view** com refresh agendado (`pg_cron`)
- Índice em colunas de filtro (`category`, `period`, `status`)

Flag: `MATERIALIZED_VIEW` ou `INDEX_REQUIRED`.

## F. Acessibilidade

Tasks UI devem usar componentes do design system, que já cobrem acessibilidade básica:

- Forms com `<Field.Label>` injetando `htmlFor` automaticamente
- Modais com gestão de foco (já no `responsive-dialog.tsx`)
- Contraste mínimo via tokens do tailwind

Flag: `A11Y_REVIEW` quando há componente novo (não-reuso).

## G. Mobile-first

Skill assume **mobile-first** porque o produto é PWA. Padrões:

- Toda tela mobile-first com `useIsMobile()` (já em hooks)
- `ResponsiveSheet` em vez de `Dialog` para edição rica
- `ResponsiveDialog` para decisão pontual
- Tap targets ≥ 44px

Flag: `MOBILE_FIRST` (default em UI; explicitar quando crítico).

## H. Internacionalização

Zelar v2 é **pt-BR only no MVP**. Strings em arquivos `.tsx` em pt-BR direto. **Sem** i18n setup.

Flag: `I18N_DEFERRED` (não-flag; só explicitar se alguém tentar adicionar).

## I. Tabela-resumo de flags

| Flag | Quando aplicar |
|---|---|
| `RLS_REQUIRED` | Task DATA/API com tabela de dados de usuário |
| `NO_RLS_NEEDED` | Task DATA com tabela 100% pública (catálogo) ou interna SISTEMA |
| `INPUT_VALIDATION` | Task API com body de POST/PATCH/PUT |
| `SECRET_HANDLING` | Task API que usa secret de ambiente |
| `RATE_LIMIT` | Task API em endpoint sensível (ver lista B) |
| `IDEMPOTENCY_KEY` | Task API com mutação financeira ou de aceite |
| `AUDIT_LOG` | Task DATA/API com decisão de admin ou transição crítica |
| `RACE_CONDITION` | Task DATA/API com corrida ou recurso compartilhado |
| `REUSE_EXISTING_COMPONENT` | Task UI usando componente do design system |
| `REUSE_EXISTING_HOOK` | Task UI usando hook (`useOptimisticCollection`, `useIsMobile`) |
| `RESPONSIVE_SHEET_REQUIRED` | Task UI de edição rica |
| `CONFIRM_DIALOG_REQUIRED` | Task UI com confirmação de ação destrutiva |
| `FIELD_COMPOUND_API` | Task UI com formulário |
| `OPTIMISTIC_UPDATE` | Task UI mutando coleção |
| `PAGINATION` | Task UI/API com lista longa |
| `INFINITE_SCROLL` | Task UI com lista longa |
| `REALTIME_CHANNEL` | Task REALTIME |
| `MATERIALIZED_VIEW` | Task DATA com agregação pesada |
| `INDEX_REQUIRED` | Task DATA com query de filtro/ordenação |
| `A11Y_REVIEW` | Task UI com componente novo |
| `MOBILE_FIRST` | Task UI com necessidade explícita (a maioria UI já é) |
