# RUNBOOK — Finance Billing · RB1 Fundação de dados

> 1º de 3 ([RB1 schema] · [RB2 superfície](finance-contract-billing-rb2-surface.md) · [RB3 automação](finance-contract-billing-rb3-automation.md)).
> Plano-mãe: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md). Decisões Q1–Q4+D9 fechadas lá (§6); faseamento re-sequenciado por valor/risco (§5).
> **Objetivo:** schema `finance` pronto pra billing(NF), **estendendo o que já existe**. Nada de UI aqui.
> **Re-sequenciado pós-audit:** §2 = **Slice 1 (MVP)** roda já; §3 = **Slice 2 (override billable, ARRISCADA)** só quando um aditivo real pedir; `planned_role` + `contract_document` saíram pro RB3 (Slice 4, com o agente).

## 0. INVARIANTES (não-negociáveis)
- **Toda migration via `psql`** (regra do repo): `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<arquivo>.sql`. Nunca Dashboard.
- **psql ANTES/junto do push, nunca depois.** `sync-main.sh` empurra pra prod+staging por default e o Cloud Build auto-deploya; se o código subir antes do schema, os endpoints novos dão 500 (e `tsc` **não pega** — finance é cast `.schema("finance")` sem tipo). Aplicar via psql em **prod E staging** antes de (ou na mesma operação que) o push. Toda fase aditiva tem **down-migration idempotente** (`drop … if exists`).
- **1 migration atômica por arquivo** (1 CREATE TABLE ou 1 ALTER coeso). Exceção deliberada: a Slice 2 (swap do override) é **uma transação** que troca tabela+view+consumidores junta (ver §3).
- **Dry-run obrigatório** (`BEGIN; … ROLLBACK;`) em toda migration que **recria view** ou **migra dado** (só a Slice 2). E o dry-run tem que ser **seedado** (ver §3) — baseline em banco vazio prova `0==0`.
- **`src/lib/finance/types.ts` é hand-authored** (finance fora de `database.types.ts`). Atualizar **na mesma fase**. Verify de tabela = `\d` + RLS smoke + (Slice 1.5) curl/psql; **tsc não substitui** o smoke pra finance.
- **RLS admin-only** em toda tabela nova: `enable row level security` + `create policy admin_all … for all to authenticated using (is_admin()) with check (is_admin())` + `grant`. (O período legível por viewer = Slice 3/Batch B, gated — não aqui.)
- **Q4/D9:** `invoice` é **só operacional** — **NÃO** entra em view de receita. O motor de receita só muda na Slice 2 (override billable), com baseline seedado provado.
- **Procedência:** `provenance jsonb not null default '{}'` onde há agent-fill; PATCH faz **deep-merge** (`provenance || jsonb_build_object(...)`, nunca substitui o mapa); sticky em 1 SQL com `WHERE` no source atual (plano §2 P1).

## 1. ESTADO ATUAL (verificado — reuse-first)
- `finance.contract` — temporal (20260623d), gera receita (e), anti-overlap EXCLUDE (g), SSOT do período via trigger (h), `price_per_fp_cents` GENERATED (i).
- `finance.contract_month_override` (20260623e) — `(contract_id, month, amount_cents, note)`, UNIQUE(contract,month), **alimenta `v_contract_revenue_month`**. Os **5 consumidores vivos**: `dal.ts` (~708-758), `/api/finance/contract-override/route.ts` + `[id]/route.ts`, `types.ts` (`ContractMonthOverride*`), `MonthOverrides` em `finance-contracts.tsx`. → só mexe na Slice 2.
- `finance.labor_allocation` (20260622d) — sem `contract_id`. Dependentes de receita: `v_contract_revenue_month` → `v_project_month` → `v_org_month` (cadeia confirmada; labor views são **irmãs upstream**, não dependentes — não precisam recriação).
- RLS pattern: `admin_all … using (is_admin())`. Migrations vão até `20260623i` → novas usam `20260624{a..}`.

---

## 2. SLICE 1 — MVP (rastreio de NF + ganhos baratos) · roda já

> Risco baixo, zero recriação de view. Cada fase = 1 migration + `types.ts` + verify. `provenance` gravada desde já.

### Fase 1.1 — `contract` +metadados — `20260624a_finance_contract_meta.sql`
```sql
alter table finance.contract
  add column warranty      text,
  add column proposal_ref  text,
  add column provenance    jsonb not null default '{}'::jsonb;
-- down: alter table finance.contract drop column if exists warranty, drop column if exists proposal_ref, drop column if exists provenance;
```
`types.ts`: `Contract`/`ContractInput` +`warranty?`/`proposalRef?`/`provenance?`. **Verify:** `\d finance.contract` + tsc.

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
`types.ts`: `ContractClause` + input. **Verify:** `\d` + RLS smoke (builder bloqueado) + tsc.

### Fase 1.3 — `labor_allocation` +contract_id (resolve Batch D do épico) — `20260624c_finance_alloc_contract.sql`
```sql
alter table finance.labor_allocation
  add column contract_id uuid references finance.contract(id) on delete set null;
create index labor_alloc_contract_idx on finance.labor_allocation (contract_id);
-- SEM backfill: alocações legadas ficam null (project-level), válidas. down: drop column if exists contract_id.
```
`types.ts`: `Allocation`/`AllocationInput` +`contractId?: string | null`. **Verify:** `\d` + tsc. (Σ%≤100 por membro não muda.)

### Fase 1.4 — `invoice` (NF por mês) — `20260624d_finance_invoice.sql`
Q1 N (sem unique) · Q2 4 estados · Q3 condição/mês · Q4 só operacional · campos fiscais (due/net/cancelled).
```sql
create table finance.invoice (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references finance.contract(id) on delete cascade,
  competence_month date not null,
  amount_cents bigint not null check (amount_cents >= 0),       -- valor BRUTO da NF
  received_net_cents bigint check (received_net_cents >= 0),    -- líquido na conta (retenção)
  number text,
  status text not null default 'pending' check (status in ('pending','issued','received','cancelled')),
  issued_at date, received_at date, due_at date,                -- due_at → aging/vencido
  condition_kind text check (condition_kind in ('pf_sheet','sow','none')),
  condition_met boolean not null default false,
  created_by uuid,                                              -- → Member (confirmar FK target; entry.created_by usa o mesmo)
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_competence_first_day check (date_trunc('month', competence_month) = competence_month)
);
create index invoice_contract_idx on finance.invoice (contract_id, competence_month);
create index invoice_due_idx on finance.invoice (due_at) where status = 'issued';
-- 1-N por mês (Q1): SEM unique. + RLS admin_all + grant.
```
`types.ts`: `Invoice` + `InvoiceInput`. **Verify:** `\d` + RLS + tsc. **Não** tocar view nenhuma (Q4). *Encomenda:* `amount` manual (regra no plano §3); `cancelled` fica fora dos rollups (RB2 §2.5).

### Fase 1.5 — DAL + API (provenance-aware) — sem migration
- `dal.ts`: CRUD de `invoice`, `contract_clause` + `allocations` passando `contract_id`. Escrita aceita `source` (default `'manual'`); PATCH faz deep-merge de `provenance`.
- API: `invoice` (GET/POST) + `invoice/[id]` (PATCH/DELETE); `contract-clause` idem. `requireMinAccessLevelApi("admin")` + Zod. **Criação de invoice é humana** (sem agente — Q1 sem unique = risco de dup).
- **Verify:** tsc+eslint · **curl/psql insert+select por endpoint** (não confiar só em tsc).

**Commit Slice 1:** 1.1–1.5 (tudo aditivo, baixo risco). UI vem no RB2.

---

## 3. SLICE 2 — Aditivos billable + HITz (ARRISCADA · gated) · só quando um aditivo real pedir

> 🚩 Gatilho: builder adicional HITz (+R$24.632) ou 3º-mês part-time. **Recria a cadeia de views de receita.** Confirmar com o dono antes.

### Fase 2.1 — `contract_month_override` → `contract_override` — `20260624e_finance_contract_override.sql` (1 transação)
**Atômica DB+código:** o `drop table` e a reescrita dos 5 consumidores (dal/2 rotas/types/MonthOverrides UI) vão **no mesmo commit** — OU deixar `contract_month_override` como **view de compat** sobre `contract_override` até o cutover do RB2. Senão, entre o drop e a reescrita, `/api/finance/contract-override` dá 500 (tsc não pega).
1. Ler defs vivas: `\sf+ finance.v_contract_revenue_month v_project_month v_org_month` (só esses 3 — labor views NÃO dependem; ver §1).
2. Migration:
   - `create table finance.contract_override (id, contract_id, effective_from, effective_to, amount_cents, mode 'replace'|'add', billable bool, note, source)`.
   - **migra** cada `contract_month_override` → `(effective_from=month, effective_to=fim-do-mês, mode='replace', billable=true)`.
   - **EXCLUDE parcial** (btree_gist, padrão 20260623g): bloqueia 2 `replace` billable sobrepostos no mesmo contrato; `add` pode sobrepor.
   - **recria** `v_contract_revenue_month` (base=fee; `replace` billable substitui o mês; `add` billable soma; não-billable ignorado) **mantendo as MESMAS colunas de saída** (`project_id, month, revenue_cents`) → `CREATE OR REPLACE` basta, dependentes intocados. Composição: override conta no mês que a vigência **intersecta** (datas já snapadas a mês na escrita).
   - `drop table contract_month_override` (após a view recriada).
   - **view de auditoria multi-fonte** anti-double-count (entries+fp+contrato por project/month; alerta se >1 fonte no mesmo mês).
3. **Dry-run SEEDADO** (banco está vazio de valores hoje — baseline real é 0):
```sql
BEGIN;
  -- …todo o passo 2…
  insert into finance.contract (…) values (…squad sintético…);  -- fee + 1 replace + 1 add + 1 non-billable
  -- asserts por mês: mês normal = fee; mês replace = valor substituto; mês add = fee+add; mês non-billable = fee (inalterado)
  select * from finance.v_contract_revenue_month where project_id = '<sintético>';
ROLLBACK;
```
Só troca `ROLLBACK`→`COMMIT` quando a aritmética seedada bate. `types.ts`: `ContractOverride` + input. **Verify:** asserts seedados + view de auditoria vazia p/ casos sãos + `\d` + curl no endpoint reescrito.

### Fase 2.2 — Backfill HITz (DEPOIS da 2.1, ordem fixa) — script SQL transacional
1 transação: `delete` entry recorrente `6b8cac38` → `update contract set monthly_fee_cents` → `insert contract_override` (3º-mês part-time R$72.640 replace + builder adicional add) → `COMMIT`. O trigger 20260623h ressincroniza o prazo. **Cross-ref [contract-ssot-handoff.md](../features/finance/contract-ssot-handoff.md) §6.** ⚠️ O double-count estrutural vai live no instante que um fee é setado com o entry recorrente presente → por isso delete+set na MESMA tx.

---

## 4. GOTCHAS
- **Slice 2 é a única arriscada.** Swap atômico DB+código (ou view compat). Dry-run **seedado** (vazio prova nada). `CREATE OR REPLACE` da view preserva colunas → dependentes intocados.
- `contract_override`: `add` pode sobrepor (aditivo); **mas 2 `replace` billable sobrepostos somam em silêncio** → EXCLUDE parcial só pra esse caso.
- `labor_allocation.contract_id` nullable — legado fica null; refina na UI (RB2).
- finance fora de `database.types.ts` → editar `types.ts` à mão; **verify de finance é curl/psql, não tsc**.
- `is_admin()` é a função de RLS já usada; reusar.
- Migration via psql em prod **e** staging **antes** do push (§0).

## 5. COMMIT (cadência)
- `bash scripts/sync-main.sh` (auto-tag `ZRD-JM-NN`). `git status` antes ([[feedback_local_ssot]]).
- Slice 1 = 1 commit (1.1–1.5). Slice 2 = 1 commit pós dry-run seedado aprovado (2.1) + 1 commit backfill (2.2).
- **Não** marcar fase pronta sem `\d`/curl + tsc/eslint.

## 6. REFERÊNCIAS
- Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md) · épico [contract-ssot-handoff.md](../features/finance/contract-ssot-handoff.md)
- Migrations base: `20260622d` (labor), `20260623e` (month_override+view), `20260623i` (GENERATED)
- Memórias: [[project_finance_app]] · [[feedback_local_ssot]] · [[feedback_role_helpers_postgres]]
