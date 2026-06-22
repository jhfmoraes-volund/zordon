# Finance App — plano end-to-end

> App de análise financeira da operação, exposto como **app no Overview** (org-level), espelhando o conceito de UI dos Zordon Apps que moram nos projetos. Primeiro app de uma nova **área de Apps no Overview**.

Status: **em construção**. Fase 0 (área de Apps no Overview + shell do app Finanças) feita. Schema final desenhado abaixo (§7) — migrations staged, **não aplicadas** (gated por review da RLS + `psql`).

---

## 1. Problema

A casa de software não tem visão financeira dentro do Zordon. Hoje:

1. Receita por projeto (faturamento) vive em planilha solta — ninguém no Zordon sabe quanto cada projeto fatura.
2. Despesa por projeto idem; custo de operação (salários/ferramentas) não é cruzado com nada.
3. **Margem de ganho por projeto** é invisível — não dá pra dizer qual projeto dá lucro depois do custo de equipe.

## 2. Solução em uma frase

Um app **Finanças** no Overview (admin-only) que registra receita e despesa por categoria/projeto/mês via formulários, e mostra receita × despesa × margem (direta e com equipe) — org-wide e por projeto.

## 3. Não-objetivos (v1)

- **Não** integra com banco / NF / contabilidade externa (entrada é manual).
- **Não** multi-moeda: valores lançados já em BRL (D14).
- **Não** expõe finanças pra PM/builder/guest. **Admin-only**, sem exceção.
- **Não** deriva rateio de mão-de-obra do PFV — usa alocação financeira manual própria (D12).

## 4. Personas e jornada

- **Admin (ceo/cro/head-ops)**: *"Vejo num lugar só quanto cada projeto fatura, quanto custa (ferramentas + equipe), e a margem real. Clico numa categoria (Ferramentas, Salários, Gastos extras) e navego item a item. Lanço receita/despesa sem abrir planilha."*
- **PM / builder / guest**: **sem acesso.** O app nem aparece no catálogo de Apps do Overview pra eles.

## 5. Decisões fixadas

| D | Decisão | Por quê |
|---|---|---|
| D1 | **Schema Postgres dedicado `finance`** (não `public`). | Isolar dado sensível; grants/RLS explícitos. Precedente: `runbook_schema`. |
| D2 | **RLS admin-only em TODAS as tabelas finance** (`is_admin()`). | Receita/despesa/margem/salário = admin. PM (manager) não vê finanças. |
| D5 | **Valores em centavos (`bigint`)**, sempre `BRL`. | Evita float; padrão do repo (`costUsdCents`). |
| D6 | **Granularidade mensal** (recorrência expandida por mês em view). | "margem por projeto/mês"; casa com o finco. |
| D9 | **Área de Apps no Overview** = 4ª aba `Apps`, mesmo conceito de UI dos apps de projeto, **registry próprio** (`OVERVIEW_APP_REGISTRY`). | Pedido: mesma UI, apps diferentes (org-scoped). |
| D10 | **Shell `AppDesktop`** extraído e compartilhado projeto ⇄ overview. | Reuse-first; sem fork da linguagem visual. |
| D11 | **Schema finance NÃO entra no client bundle.** Acesso só via `/api/finance/*` (assere isAdmin) + RLS. | Defense-in-depth; client nunca fala direto com finance. |
| **D12** | **Rateio de mão-de-obra por ALOCAÇÃO FINANCEIRA MANUAL** (`finance.labor_allocation`: membro × projeto × percent × vigência), **não** por PFV. | Decisão do dono: controle e histórico próprios, desacoplado do PFV. Σpercent por membro ≤ 100; resto = overhead. |
| **D13** | **Categorias EDITÁVEIS** (`finance.category`), seedadas. | Admin cria/arquiva categoria sem migration. Flags: `recurring_default`, `requires_member`, `feeds_labor`. |
| **D14** | **Só BRL** no v1 (sem fx). | Admin converte na hora; simplicidade. fx é incremento futuro. |
| **D15** | **Margem por projeto inclui mão-de-obra, com breakdown** (margem direta + margem com equipe). | Transparência sobre o que o rateio fez. |
| **D16** | **Transação unificada `finance.entry`** (não tabelas separadas por tipo). Categoria + flags definem a forma; UI muda os campos por categoria. | "clicar categoria → ver itens → abrir detalhe" exige categoria de 1ª classe + itens homogêneos. |
| **D17** | **Salário = entry na categoria Salários** (`member_id`, recorrente, vigência), 1 linha/pessoa. O rateio por projeto sai de `labor_allocation`, não de salário lançado por projeto. | Mantém a navegação por categoria consistente; comp é fonte única. |

## 6. Arquitetura

```
Overview (/) ── aba "Apps" ── apps-view (server, isAdmin) ── OverviewAppsDesktop ──┐
   └─ AppDesktop (shell) → surface "finance" → <FinanceApp/>                        │
                                                                                   │
FinanceApp (client)                                                                │
   home: KPIs + chart + cards de CATEGORIA                                         │
   clica categoria → ResponsiveSheet: itens (finance.entry da categoria)           │
   clica item      → detalhe da transação (editar/excluir)                         │
   + editor de alocação financeira (labor_allocation)                              │
   fetch: GET /api/finance/{overview,categories,entries,projects,allocations}      │
   write: POST/PATCH/DELETE /api/finance/{entries,allocations,categories}          │
                                                                                   │
/api/finance/* (server): assert admin + supabase.schema("finance") (RLS is_admin)  │
                                                                                   │
DB schema finance:                                                                 │
   category(slug, kind, recurring_default, requires_member, feeds_labor, …)        │
   entry(category_id, project_id?, member_id?, amount_cents, recurrence,           │
         occurred_on?, effective_from?, effective_to?, vendor?, description?)       │
   labor_allocation(member_id, project_id, percent, effective_from, effective_to?) │
   views: v_entry_month · v_member_comp_month · v_project_labor_month ·            │
          v_category_month · v_project_month · v_org_month                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 7. Schema (DDL completo + RLS)

> Migrations atômicas em `supabase/migrations/`, via `psql "$DIRECT_URL" -f …`. **Não aplicar sem review da RLS.** Após aplicar: regenerar `database.types.ts` (`npm run db:types`) + expor `finance` ao PostgREST (Dashboard → API → Exposed schemas).

### 7.1 `20260622a_finance_schema.sql`
```sql
create schema if not exists finance;
grant usage on schema finance to authenticated;
```

### 7.2 `20260622b_finance_category.sql`
```sql
create table finance.category (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,             -- ref estável p/ código
  kind             text not null check (kind in ('revenue','expense')),
  name             text not null,
  recurring_default boolean not null default false,  -- form abre como recorrente
  requires_member  boolean not null default false,   -- entry precisa de member_id
  feeds_labor      boolean not null default false,    -- entries são comp p/ rateio
  sort             int not null default 0,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table finance.category enable row level security;
create policy admin_all on finance.category for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on finance.category to authenticated;

insert into finance.category (slug, kind, name, recurring_default, requires_member, feeds_labor, sort) values
  ('faturamento',  'revenue', 'Faturamento',  false, false, false, 0),
  ('ferramentas',  'expense', 'Ferramentas',  true,  false, false, 1),
  ('salarios',     'expense', 'Salários',     true,  true,  true,  2),
  ('gastos_extras','expense', 'Gastos extras',false, false, false, 3);
```

### 7.3 `20260622c_finance_entry.sql`
```sql
create table finance.entry (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references finance.category(id),
  project_id     uuid references public."Project"(id) on delete cascade,  -- null = overhead org
  member_id      uuid references public."Member"(id) on delete restrict,  -- preenchido p/ Salários
  amount_cents   bigint not null check (amount_cents > 0),                 -- BRL; p/ recorrente = valor mensal
  recurrence     text not null default 'once' check (recurrence in ('once','monthly','annual')),
  occurred_on    date,                                  -- p/ recurrence='once'
  effective_from date,                                  -- p/ recorrente
  effective_to   date,                                  -- null = vigente
  vendor         text,                                  -- Figma, Vercel…
  description    text,
  created_by     uuid references public."Member"(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint entry_once_has_date check (recurrence <> 'once' or occurred_on is not null),
  constraint entry_recurring_has_from check (recurrence = 'once' or effective_from is not null),
  constraint entry_period_valid check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index entry_category_idx on finance.entry (category_id);
create index entry_project_idx  on finance.entry (project_id);
create index entry_member_idx   on finance.entry (member_id);

alter table finance.entry enable row level security;
create policy admin_all on finance.entry for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on finance.entry to authenticated;
-- member_id obrigatório p/ categoria requires_member: validado na API (cross-table).
```

### 7.4 `20260622d_finance_labor_allocation.sql`
```sql
create table finance.labor_allocation (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public."Member"(id) on delete cascade,
  project_id     uuid not null references public."Project"(id) on delete cascade,
  percent        numeric(5,2) not null check (percent > 0 and percent <= 100),
  effective_from date not null,
  effective_to   date,                                  -- null = vigente
  note           text,
  created_by     uuid references public."Member"(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint alloc_period_valid check (effective_to is null or effective_to >= effective_from)
);
create index labor_alloc_member_idx  on finance.labor_allocation (member_id, effective_from);
create index labor_alloc_project_idx on finance.labor_allocation (project_id, effective_from);

alter table finance.labor_allocation enable row level security;
create policy admin_all on finance.labor_allocation for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on finance.labor_allocation to authenticated;
-- Σpercent por membro/período ≤ 100 validado na API; o resto é overhead da operação.
```

### 7.5 `20260622e_finance_views.sql`
```sql
-- Expande cada entry em (id, category_id, project_id, member_id, month, amount_cents).
-- Recorrente: 1 linha por mês na vigência (annual amortizado /12). Once: mês do occurred_on.
create view finance.v_entry_month with (security_invoker = true) as
select e.id, e.category_id, e.project_id, e.member_id,
       date_trunc('month', gs)::date as month,
       case when e.recurrence = 'annual' then e.amount_cents / 12 else e.amount_cents end as amount_cents
from finance.entry e
cross join lateral generate_series(
  case when e.recurrence = 'once' then e.occurred_on else e.effective_from end,
  case when e.recurrence = 'once' then e.occurred_on else coalesce(e.effective_to, now()::date) end,
  interval '1 month'
) gs;

-- Comp mensal por membro (entries de categorias feeds_labor).
create view finance.v_member_comp_month with (security_invoker = true) as
select em.member_id, em.month, sum(em.amount_cents) as comp_cents
from finance.v_entry_month em
join finance.category c on c.id = em.category_id and c.feeds_labor
where em.member_id is not null
group by em.member_id, em.month;

-- Custo de mão-de-obra por projeto/mês = comp × percent vigente naquele mês.
create view finance.v_project_labor_month with (security_invoker = true) as
select la.project_id, cm.month,
       sum(cm.comp_cents * la.percent / 100.0)::bigint as labor_cents
from finance.labor_allocation la
join finance.v_member_comp_month cm
  on cm.member_id = la.member_id
 and cm.month >= la.effective_from
 and (la.effective_to is null or cm.month <= la.effective_to)
group by la.project_id, cm.month;

-- Totais por categoria/mês (cards + drill).
create view finance.v_category_month with (security_invoker = true) as
select em.category_id, c.kind, c.name, c.slug, em.month, sum(em.amount_cents) as amount_cents
from finance.v_entry_month em
join finance.category c on c.id = em.category_id
group by em.category_id, c.kind, c.name, c.slug, em.month;

-- Margem por projeto/mês (direta e com equipe).
create view finance.v_project_month with (security_invoker = true) as
with rev as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'revenue' and em.project_id is not null group by 1,2),
exp as (
  select em.project_id, em.month, sum(em.amount_cents) c
  from finance.v_entry_month em join finance.category cat on cat.id = em.category_id
  where cat.kind = 'expense' and em.project_id is not null group by 1,2),
lab as (select project_id, month, labor_cents from finance.v_project_labor_month)
select
  coalesce(rev.project_id, exp.project_id, lab.project_id) as project_id,
  coalesce(rev.month, exp.month, lab.month)                as month,
  coalesce(rev.c, 0)        as revenue_cents,
  coalesce(exp.c, 0)        as expense_cents,
  coalesce(lab.labor_cents, 0) as labor_cents,
  coalesce(rev.c,0) - coalesce(exp.c,0)                          as margin_direct_cents,
  coalesce(rev.c,0) - coalesce(exp.c,0) - coalesce(lab.labor_cents,0) as margin_team_cents
from rev
full join exp on exp.project_id = rev.project_id and exp.month = rev.month
full join lab on lab.project_id = coalesce(rev.project_id, exp.project_id)
            and lab.month       = coalesce(rev.month, exp.month);

-- Totais org/mês (inclui overhead sem projeto + comp total).
create view finance.v_org_month with (security_invoker = true) as
with rev as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind='revenue' group by 1),
exp as (
  select em.month, sum(em.amount_cents) c from finance.v_entry_month em
  join finance.category cat on cat.id = em.category_id where cat.kind='expense' group by 1)
select coalesce(rev.month, exp.month) as month,
       coalesce(rev.c,0) as revenue_cents,
       coalesce(exp.c,0) as expense_cents,
       coalesce(rev.c,0) - coalesce(exp.c,0) as net_cents
from rev full join exp on exp.month = rev.month;

grant select on
  finance.v_entry_month, finance.v_member_comp_month, finance.v_project_labor_month,
  finance.v_category_month, finance.v_project_month, finance.v_org_month
to authenticated;
```

## 8. APIs (todas asseram `isAdmin` server-side — D11)

| Método | Path | Contrato |
|---|---|---|
| GET | `/api/finance/overview?from&to` | `{ months: OrgMonthRow[], categories: CategoryTotal[], totals }` |
| GET | `/api/finance/projects?from&to` | `{ projects: [{ projectId, name, revenue, expense, labor, marginDirect, marginTeam }] }` |
| GET | `/api/finance/categories` | lista de `finance.category` |
| POST/PATCH/DELETE | `/api/finance/categories[/:id]` | CRUD categoria |
| GET | `/api/finance/entries?categoryId&projectId&from&to` | itens (drill da categoria) |
| POST/PATCH/DELETE | `/api/finance/entries[/:id]` | CRUD transação (valida `member_id` se `category.requires_member`) |
| GET | `/api/finance/allocations?memberId&projectId` | alocações financeiras |
| POST/PATCH/DELETE | `/api/finance/allocations[/:id]` | CRUD alocação (valida Σpercent/membro/período ≤ 100) |

Erros: 403 se não-admin (a UI esconde o app, a API é a barreira). Padrão `fetchOrThrow`/`HttpError`.

## 9. UX

```
Finanças (home) — período [2026 ▾]        [+ Receita] [+ Despesa] [Alocação]
┌ KPI Receita ┐ ┌ Despesa ┐ ┌ Margem equipe ┐ ┌ Burn (comp) ┐
└─────────────┘ └─────────┘ └───────────────┘ └─────────────┘
[ Ano — receita × despesa × margem ] (ComposedChart)

Categorias                                            ← cards/lista clicável
  ▸ Faturamento    R$ …         (revenue)
  ▸ Ferramentas    R$ …  N itens
  ▸ Salários       R$ …  N pessoas
  ▸ Gastos extras  R$ …  N itens
       │ clica → ResponsiveSheet (side-sheet)
       ▼  Itens de "Ferramentas" (AppFileList)
          ─ Figma     R$ 280/mês   org        ▸
          ─ Vercel    R$ 1.200/mês Projeto X  ▸
                │ clica item
                ▼ Detalhe da transação (Field/FormBody): editar/excluir

Margem por projeto                                    ← AppFileList
  ─ Projeto X  rec R$… · desp R$… · equipe R$…   [direta 82% · equipe 39%]
```

Reuso: `ResponsiveSheet` (drill categoria→itens→detalhe), `Field`/`FormBody` (forms), `ConfirmDialog` (delete), `useOptimisticCollection` (listas), `AppFileList/Row/Badge`, `recharts` (chart). Sem `confirm()`/`alert()` nativo.

## 10. Integrações

- **Projetos**: entries e allocations referenciam `public."Project"`.
- **Membros / squads**: comp e allocation referenciam `public."Member"`. A tela de alocação pode pré-listar membros do squad do projeto (`ProjectSquad → SquadMember`, + `Project.pmId`) pra facilitar — mas o percent é manual (D12), não derivado do PFV.
- **Metrics Registry** (futuro): `finance.v_*` viram fonte de métricas (margem média, burn).

## 11. Faseamento

| Fase | Entrega |
|---|---|
| **0 — Área de Apps no Overview** ✅ | Aba Apps, `AppDesktop` compartilhado, registry de overview, `FinanceApp` shell (empty state). |
| **1 — Schema + leitura** | Rodar migrations (review RLS), API `overview`/`projects`/`categories`/`entries`, FinanceApp lê real: KPIs + chart + cards de categoria + margem por projeto. |
| **2 — CRUD + drill** | Side-sheet categoria→itens→detalhe; forms de Receita/Despesa (Field/FormBody, optimistic); CRUD categoria. |
| **3 — Alocação + margem com equipe** | Editor `labor_allocation` (pré-lista squad); `v_project_labor_month` ativa; breakdown margem direta × margem equipe nos cards. |

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Vazamento de salário/finança | baixa | **alto** | RLS `is_admin()` + assert API (D2/D11) + schema isolado + sem acesso client direto + app escondido pra não-admin. |
| Σpercent de alocação > 100 | média | médio | Validação na API por membro/período; view de over-allocation pra flag; resto = overhead. |
| Margem histórica imprecisa | baixa | baixo | `labor_allocation` tem vigência própria (histórico) — melhor que snapshot; admin mantém. |
| annual amortizado confunde | baixa | baixo | Documentar na UI ("anual amortizado /12 no burn mensal"). |

## 13. Métricas de sucesso

| Métrica | Instrumento |
|---|---|
| Projetos com receita lançada | `select count(distinct project_id) from finance.entry e join finance.category c on c.id=e.category_id where c.kind='revenue'` |
| Margem equipe média por projeto | sobre `v_project_month` agregada |
| Burn mensal vs receita | `v_org_month` |

## 14. Open questions

- `annual` amortiza /12 (default escolhido) ou lança no mês aniversário? Confirmar na Fase 2.
- Over-allocation (Σ>100): bloquear no write ou permitir + flag? (default: bloquear). Confirmar na Fase 3.

## 15. Referências

- Apps de projeto (template): `src/app/(dashboard)/projects/[id]/_tabs/apps-tab.tsx`, `src/lib/apps/registry.ts`, `src/components/apps/app-file-list.tsx`.
- Shell: `src/components/apps/app-desktop.tsx`. Surface: `src/components/apps/finance/finance-app.tsx`.
- Overview: `src/app/(dashboard)/page.tsx`, `src/components/overview/{overview-tabs,apps-view,overview-apps-desktop}.tsx`.
- Alocação existente (PFV, **não** usada p/ rateio): `Member.fpCapacity`, `ProjectMember.fpAllocation`, `SprintMember.fpAllocation`, `src/lib/dal/capacity.ts`, view `sprint_member_capacity`. Squads: `Squad`/`SquadMember`/`ProjectSquad`.
- RLS helper: `public.is_admin()` (`20260428_add_cro_to_admin_helpers.sql`).
- Reference app: `projetos-perke/finco/components` (SummaryCards, TrendChart, CategoryBreakdown).
- Memories: `project_finance_app`, `project_zordon_apps`, `project_member_roles_access`, `feedback_headcount_by_position`.
```
