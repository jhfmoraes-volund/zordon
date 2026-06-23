# RUNBOOK — Finance Billing · RB1 Fundação de dados (B1)

> 1º de 3 runbooks (RB1 schema · [RB2 superfície](finance-contract-billing-rb2-surface.md) · [RB3 automação](finance-contract-billing-rb3-automation.md)).
> Plano-mãe: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md). Decisões Q1–Q4 + naming travados lá (§6).
> **Objetivo:** deixar o schema `finance` pronto pra billing(NF) + agent-fill + time planejado×real, **estendendo o que já existe** (não reinventar). Nada de UI aqui.

## 0. INVARIANTES (não-negociáveis)
- **Toda migration via `psql`** (regra do repo): `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<arquivo>.sql`. Nunca Dashboard.
- **1 migration atômica por arquivo** (1 CREATE TABLE ou 1 ALTER coeso). Rollback granular > economia.
- **Dry-run obrigatório** (`BEGIN; … ROLLBACK;`) em toda migration que **recria view** ou **migra dado** (Fase 1.5). Só dá `-f` no arquivo com `COMMIT` depois que o dry-run prova baseline.
- **`src/lib/finance/types.ts` é hand-authored** (finance não está em `database.types.ts`). Atualizar **na mesma fase** da migration.
- **RLS admin-only** em toda tabela nova, espelhando o padrão existente: `enable row level security` + `create policy admin_all … for all to authenticated using (is_admin()) with check (is_admin())` + `grant … to authenticated`.
- **Q4:** `invoice` é **só operacional** — **NÃO** wirar em view de receita. O motor de receita (`v_contract_revenue_month` etc.) só muda na Fase 1.5 (override billable), e **com baseline idêntico provado**.
- **Procedência:** coluna `provenance jsonb not null default '{}'` onde houver agent-fill; convenção `{ campo: { source, at, runId?, confidence? } }`; manual gruda (regra aplicada no PATCH, RB3).

## 1. ESTADO ATUAL (verificado — reuse-first)
- `finance.contract` — temporal (20260623d), gera receita (e), anti-overlap EXCLUDE (g), SSOT do período via trigger (h), `total_value_cents`+`price_per_fp_cents` GENERATED (i). 
- `finance.contract_month_override` (20260623e) — `(contract_id, month[1º dia], amount_cents, note)`, UNIQUE(contract,month), **alimenta `v_contract_revenue_month`**. → vira `contract_override` na Fase 1.5.
- `finance.labor_allocation` (20260622d) — `(member_id, project_id, percent, effective_from/to, note)`, **sem contract_id**.
- RLS pattern: `admin_all … using (is_admin())`. DAL: `src/lib/finance/dal.ts` (client de sessão + `.schema("finance")`, RLS é a barreira). API: `src/app/api/finance/*` (`requireMinAccessLevelApi("admin")`).
- Migrations já vão até `20260623i` → **novas usam `20260624{a..}`**.

## 2. FASES (executar em ordem; gate ao fim de cada)

> Cada fase = 1 arquivo de migration + update `types.ts` + verify. Commit a cada 2–3 fases (§4).

### Fase 1.1 — `contract` +metadados de agent-fill — `20260624a_finance_contract_meta.sql`
```sql
alter table finance.contract
  add column warranty      text,
  add column proposal_ref  text,
  add column provenance    jsonb not null default '{}'::jsonb;
```
`types.ts`: `Contract`/`ContractInput` ganham `warranty?`, `proposalRef?`, `provenance?` (jsonb → `Record<string, …>`).
**Verify:** `psql … -c '\d finance.contract'` mostra as 3 colunas · `npx tsc --noEmit` limpo.

### Fase 1.2 — `contract_clause` (1-N) — `20260624b_finance_contract_clause.sql`
```sql
create table finance.contract_clause (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references finance.contract(id) on delete cascade,
  kind text not null default 'other' check (kind in ('sla','penalty','ip','confidentiality','readjust','warranty','other')),
  text text not null,
  sort int not null default 0,
  source text not null default 'manual' check (source in ('manual','agent','integration')),
  created_at timestamptz not null default now()
);
create index contract_clause_idx on finance.contract_clause (contract_id, sort);
alter table finance.contract_clause enable row level security;
create policy admin_all on finance.contract_clause as permissive for all to authenticated using (is_admin()) with check (is_admin());
grant select, insert, update, delete on finance.contract_clause to authenticated;
```
`types.ts`: `ContractClause` + `ContractClauseInput`. **Verify:** `\d` + RLS smoke (builder bloqueado) + tsc.

### Fase 1.3 — `contract_planned_role` (time planejado, P3) — `20260624c_finance_planned_role.sql`
```sql
create table finance.contract_planned_role (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references finance.contract(id) on delete cascade,
  seniority text not null,
  count int not null check (count > 0),
  monthly_cost_cents bigint check (monthly_cost_cents >= 0),
  note text,
  source text not null default 'manual' check (source in ('manual','agent','integration')),
  created_at timestamptz not null default now()
);
-- + RLS admin_all + grant (igual 1.2)
```
`types.ts`: `PlannedRole` + input. **Verify:** `\d` + tsc.

### Fase 1.4 — `labor_allocation` +contract_id (P3, resolve Batch D) — `20260624d_finance_alloc_contract.sql`
```sql
alter table finance.labor_allocation
  add column contract_id uuid references finance.contract(id) on delete set null;
create index labor_alloc_contract_idx on finance.labor_allocation (contract_id);
-- SEM backfill: alocações legadas ficam contract_id null (project-level), válidas.
```
`types.ts`: `Allocation`/`AllocationInput` ganham `contractId?: string | null`. **Verify:** `\d` + tsc. (Σ%≤100 segue por membro — não muda.)

### Fase 1.5 — 🚩 `contract_override` (generaliza month_override) — `20260624e_finance_contract_override.sql`
**A fase sensível (recria a view de receita + migra dado). GATE: confirmar com o dono "migrar vs nova tabela" antes de rodar (recomendado: migrar).**
1. Ler a def viva: `psql … -c '\sf+ finance.v_contract_revenue_month'` (e v_project_month/v_org_month).
2. Escrever a migration: cria `contract_override` (período + `mode('replace'|'add')` + `billable bool`), **migra** cada `contract_month_override` → `(effective_from=month, effective_to=fim do mês, mode='replace', billable=true)`, **recria** `v_contract_revenue_month` lendo `contract_override` (base = fee; `replace` billable substitui o mês; `add` billable soma; **não-billable ignorado na receita**), recria `v_project_month`/`v_org_month` verbatim, `drop table contract_month_override`.
3. **Dry-run** `BEGIN; …todo o passo 2…; <SELECT receita HITz>; ROLLBACK;` → provar receita **idêntica** ao baseline (R$ 86.366/mês HITz). Só então trocar `ROLLBACK`→`COMMIT` e `-f`.
`types.ts`: `ContractOverride` + input (`billable`, `mode`, `effectiveFrom/To`). **Verify:** baseline de receita idêntico + `\d` + tsc.

### Fase 1.6 — `invoice` (NF por mês; Q1 N · Q2 3-estados · Q3 condição/mês · Q4 só operacional) — `20260624f_finance_invoice.sql`
```sql
create table finance.invoice (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references finance.contract(id) on delete cascade,
  competence_month date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  number text,
  status text not null default 'pending' check (status in ('pending','issued','received')),
  issued_at date, received_at date,
  condition_kind text check (condition_kind in ('pf_sheet','sow','none')),
  condition_met boolean not null default false,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_competence_first_day check (date_trunc('month', competence_month) = competence_month)
);
create index invoice_contract_idx on finance.invoice (contract_id, competence_month);
-- 1-N por mês (Q1): SEM unique. + RLS admin_all + grant.
```
`types.ts`: `Invoice` + `InvoiceInput`. **Verify:** `\d` + RLS + tsc. **Não** mexer em nenhuma view (Q4).

### Fase 1.7 — `contract_document` + bucket Storage (P2) — `20260624g_finance_contract_document.sql`
```sql
create table finance.contract_document (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references finance.contract(id) on delete cascade,
  invoice_id  uuid references finance.invoice(id)  on delete cascade,
  kind text not null check (kind in ('proposal','sow','pf_sheet','nf_xml','nf_pdf','contract','other')),
  provider text not null default 'upload' check (provider in ('upload','gdrive','sharepoint','erp')),
  external_ref text not null,         -- storage path | fileId Drive | item SharePoint | id ERP
  url text, meta jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual','agent','integration')),
  created_at timestamptz not null default now()
);
-- + RLS admin_all + grant.
```
**Bucket** privado `finance-documents` (via `insert into storage.buckets (id,name,public) values ('finance-documents','finance-documents',false)` + policy de `storage.objects` restrita a `is_admin()`). **Verify:** `\d` + bucket existe + policy nega não-admin.

### Fase 1.8 — DAL + API (provenance-aware, agent-tool-ready) — sem migration
- `dal.ts`: CRUD de `invoice`, `contract_document`, `contract_clause`, `contract_planned_role`, `contract_override` (+ allocations já existe; só passa `contract_id`). Toda escrita aceita `source` (default `'manual'`).
- API `src/app/api/finance/*`: `invoice` (GET/POST), `invoice/[id]` (PATCH/DELETE), idem `contract-document`, `contract-clause`, `planned-role`, `contract-override`. Todos `requireMinAccessLevelApi("admin")` + Zod. **Escritas setam `provenance`** (API normal → `source='manual'`).
- **Verify:** `tsc`+`eslint` limpos · curl smoke por endpoint pós-deploy OU `psql` prova insert/select.

## 3. GOTCHAS
- **Fase 1.5 é a única arriscada** — recria 3 views vivas + migra dado. Sem dry-run = não roda. Baseline = receita HITz centavo-a-centavo.
- `contract_override` **pode sobrepor de propósito** (aditivo coexiste com fee) → **NÃO** colocar EXCLUDE/anti-overlap nele (≠ `contract`).
- `labor_allocation.contract_id` **nullable** — legado fica null; não backfillar cegamente (refina na UI, RB2).
- finance **fora** de `database.types.ts` → `npm run db:types` não cobre; editar `types.ts` à mão (e não rola aqui sem token).
- Storage: policy é em `storage.objects` (não na tabela) — testar que não-admin é barrado.
- `is_admin()` é a função de RLS já usada pelo finance; reusar (não criar policy custom).

## 4. COMMIT (cadência 2–3 fases)
- `bash scripts/sync-main.sh` (auto-tag `ZRD-JM-NN`; push prod+staging). Sweepa tudo — `git status` antes ([[feedback_local_ssot]]).
- Sugerido: commit A = Fases 1.1–1.4 (estruturas aditivas, baixo risco); commit B = Fase 1.5 (override, pós dry-run aprovado); commit C = 1.6–1.8 (invoice/document/dal/api).
- **Não** marcar fase pronta sem `\d`/baseline + `tsc`/`eslint` limpos.

## 5. REFERÊNCIAS
- Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md) · épico [contract-ssot-handoff.md](../features/finance/contract-ssot-handoff.md)
- Mock: [contract-canvas-sandbox.html](../features/finance/mockups/contract-canvas-sandbox.html)
- Migrations base: `supabase/migrations/20260622d` (labor), `20260623e` (month_override+view), `20260623i` (GENERATED)
- Memórias: [[project_finance_app]] · [[feedback_local_ssot]] · [[feedback_role_helpers_postgres]]
