# Runbook — Contract/Proposal lifecycle + Alocação SSOT (execução humana, NÃO Ralph)

> Plano/decisões: [docs/platform/project-contract-allocation-ssot-plan.md](../platform/project-contract-allocation-ssot-plan.md) (D1–D12).
> PRD de referência (não vamos rodar via Ralph): docs/prd/backlog/prd-contract-allocation-ssot.md.
> Mocks: `/tmp/project-kind-options.html`, `/tmp/spot-allocation-options.html`.

## Modo de operação (decidido 2026-06-23)

- **Começamos pela Fase 1** (lifecycle de contrato). Fase 2 (convergência de alocação + spot) vem depois.
- **`getProjectTeam` = view SQL `v_project_team`** (Fase 2). Agentes leem do Postgres direto.
- **Cutover do roster = big-bang + backfill antes** (Fase 2): backfill órfãos → aponta tudo pra view de uma vez.
- **Migrations:** Claude roda via `psql "$DIRECT_URL" -f ...` (só PROD — staging não mantém schema). **Aprovação humana antes de cada migration.** Depois de cada uma, atualizar `src/lib/supabase/database.types.ts`.

Verificação padrão de cada step: `npx tsc --noEmit` (exit 0) + a query/checagem listada.

---

## FASE 1 — Lifecycle de contrato

Sequência (cada step só começa com o anterior verificado):

### F1.1 — Migration: `finance.contract.status`  · arquivo `20260624f_finance_contract_status.sql`
- Adiciona `status text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed','active','ended','declined'))` + index.
- Default `active` mantém os contratos-semente atuais válidos.
- **Verify:** `select column_default from information_schema.columns where table_schema='finance' and table_name='contract' and column_name='status'` → `'active'::text`.
- Pós: regenerar tipos da `finance.contract`.

### F1.2 — Migration: seed cliente interno Volund · arquivo `20260624g_seed_volund_client.sql`
- Insert idempotente de `Client` name='Volund' (guard por existência).
- **Verify:** `select count(*) from "Client" where name='Volund'` → `1` (mesmo rodando 2×).

### F1.3 — Status no contract sheet (`finance-contract-sheet.tsx`)
- Chip de status no header + select pra editar; PATCH `/api/finance/contract/[id]` aceita `status` com máquina de estados (proposed→active|declined, active→ended).
- **Verify:** tsc 0 + abrir sheet, trocar status, persiste.

### F1.4 — Kind selector no new-project sheet (`project-edit-sheet.tsx`)
- Topo do form: 3 cards Interno / Proposta / Contratado (ver `/tmp/project-kind-options.html`).
- kind define category/phase/cliente: Interno→internal+Volund; Proposta→billable+commercial; Contratado→billable+immersion.
- **Verify:** tsc 0 + cada kind molda o form como no mock.

### F1.5 — Fluxo de criação por kind (`/api/projects` POST)
- aceita `kind`; internal→Volund client, sem contrato; proposal→cria contrato `proposed`; contracted→cria contrato `active`.
- **Verify:** tsc 0 + criar 1 de cada e conferir contrato/fase no banco.

### F1.6 — Datas/engajamento derivados read-only (`project-edit-sheet.tsx`)
- Com contrato: `startDate`/`endDate`/`engagementType` viram read-only ("⤷ do contrato ativo") — trigger `contract_sync_project_dates` (20260623h) já sincroniza.
- Internos (sem contrato): campos manuais.
- **Verify:** tsc 0 + projeto com contrato mostra datas travadas; interno editável.

### F1.7 — Transição "ganhar proposta" (`/api/finance/contract/[id]/win` POST)
- proposed→active + bump `Project.phase` commercial→immersion (se ainda commercial) + cria `ProjectPhaseEvent`.
- **Verify:** tsc 0 + endpoint flippa status e fase; phase event registrado.

**Gate Fase 1:** proposta é 1ª classe (criar → ganhar → vira contrato ativo) sem re-digitar datas/valor/equipe; nada do fluxo atual se perde.

---

## FASE 2 — Convergência de alocação + participação pontual

Modelo spot (D11–D14): dias (não %/sprint), teto 60d/entrada, acesso contributor permanente.

### ✅ Concluído (F2.1–F2.4)
- F2.1 `labor_allocation` +kind +days, percent nullable, CHECK forma (migration 20260624j).
- F2.2 `v_contract_roster` +kind/days (20260624k).
- F2.3 código kind-aware (types + dal checkAllocation/allocRow/listContractRoster).
- F2.4 UI spot no contract sheet (botão Pontual, dias, cap 60) + grant ProjectAccess contributor permanente no createAllocation.

### ⏳ Pontas restantes (executar em ordem)

Cada migration roda via psql com aprovação humana; cada step verifica com `npx tsc --noEmit` + a checagem listada.

**F2.5 — Custo do spot (alimenta cálculo)** · migration `20260624l_v_allocation_labor_month_spot.sql`
- Reescrever `finance.v_allocation_labor_month` como **UNION ALL**:
  - **standing**: lógica atual — `round(comp_mês × percent/100 × fração_dias_do_mês)`.
  - **spot**: 1 linha no mês de `effective_from`; `labor_cents = round(comp_mês × days / 22.0)` (22 = dias úteis/mês padrão; 1 dia = 8h). Sem spread por vigência.
  - `comp_mês` = reusar a CTE `rate` (entry feeds_labor) ou join `v_member_comp_month`.
- `v_project_member_labor_month` / `v_project_labor_month` herdam (agregam essa base) — não mudam.
- **Verify:** criar spot de N dias num projeto → aparece em `v_project_labor_month` SÓ no mês do início, `labor_cents>0`; uma alocação standing existente mantém o mesmo `labor_cents` de antes.

**F2.6 — Leitor canônico `v_project_team`** · migration `20260624m_v_project_team.sql`
- `CREATE VIEW finance.v_project_team` = 
  - **alocados**: `member_id` distinto de `labor_allocation` vigente (`effective_to IS NULL OR >= current_date`), incl. `contract_id` null; `source='allocated'` + kind/percent/days.
  - **∪ access-only**: linhas de `ProjectAccess` cujo `Member.userId` não está nos alocados; `source='access'` + role.
  - Gating: `can_view_project(project_id) OR is_admin()`.
- **Verify:** projeto com 1 alocado + 1 só-acesso (guest) retorna 2 linhas com `source` certo.

**F2.7 — Backfill órfãos (ANTES do cutover)** · migration `20260624n_backfill_roster.sql`
- Pra cada `ProjectMember` sem `labor_allocation` vigente E sem `ProjectAccess`, criar `ProjectAccess` viewer (resolve `Member.userId`; pula quem não tem userId — registra no log).
- **Verify:** `select count(*)` de ProjectMember órfão (sem allocation E sem ProjectAccess com userId resolvido) = 0.

**F2.8 — Apontar 3 readers pra `v_project_team` + remover squad (D9)**
- Helper `getProjectTeam(projectId)` em `src/lib/dal/project-team.ts` lê `v_project_team`.
- Trocar nos 3: `src/app/api/projects/[id]/members/route.ts`, `src/lib/agent/agents/vitoria/tools.ts` (loadProjectMembers), `src/lib/agent/agents/alpha/tools.ts` (get_allocated_project_members). Remover `ProjectSquad` do UNION (squad = pool, não roster).
- **Verify:** `! grep -rn 'ProjectSquad' nos 3 arquivos`; tsc 0; reuniões/agentes ainda listam equipe (smoke).

**F2.9 — Member box do project sheet read-only**
- `src/components/projects/project-edit-sheet.tsx`: trocar o seletor de membros por "Equipe (dos contratos)" read-only via `getProjectTeam`. Sheet para de escrever `ProjectMember` (delta sync sai).
- **Verify:** criar/editar projeto não insere `ProjectMember`; equipe aparece derivada read-only; tsc 0.

**F2.10 — RLS audit (write admin-only em `labor_allocation`)** · migration `20260624o_labor_allocation_rls.sql` (se faltar)
- Garantir POLICY explícita de INSERT/UPDATE/DELETE exigindo `is_admin()`.
- **Verify:** `select count(*) from pg_policies where schemaname='finance' and tablename='labor_allocation' and cmd in ('INSERT','UPDATE','DELETE')` ≥ 3.

**Gate Fase 2:** alocação (standing + spot) é SSOT único do roster; `v_project_team` é o leitor único; spot entra no custo; nada escreve roster fora do contrato/Finanças (admin).

---

## Log de execução

| Data | Step | Resultado |
|------|------|-----------|
| 2026-06-23 | runbook criado | Fase 1 definida |
| 2026-06-23 | F1.1 contract.status | ✅ aplicado PROD (11 contratos = active), index criado, types regenerados, tsc 0 |
| 2026-06-23 | F1.2 seed Volund | ✅ aplicado PROD (no-op: Volund já existia, count=1); migration idempotente no repo |
| 2026-06-23 | F1.3 status no contract sheet | ✅ ContractStatus + máquina de estados (dal) + chip/StatusChipSelect no sheet + CONTRACT_STATUS registry. tsc 0. |
| 2026-06-23 | F1.4 kind selector | ✅ 3 cards (Interno/Proposta/Contratado) no project-edit-sheet (só criação); applyKind seta category/phase/cliente Volund. |
| 2026-06-23 | F1.5 criação por kind | ✅ save() cria contrato via POST /api/finance/contract (proposed/active, billing do engagementType, vigência das datas). Interno = sem contrato. Admin-only (403 → toast, projeto fica). |
| 2026-06-23 | F1.6 datas derivadas | ✅ edição: fetch contract-period → se há contrato, datas/engajamento read-only (DerivedDate "⤷ contrato"); interno editável. |
| 2026-06-23 | F1.7 ganhar proposta | ✅ winContract (dal): proposed→active + fase commercial→immersion + ProjectPhaseEvent. POST /api/finance/contract/[id]/win. Botão "🏆 Ganhar proposta" no sheet quando status=proposed. tsc 0, eslint limpo. Commitado ZRD-JM-222. |
| 2026-06-23 | **F2.1 fundação spot** | ✅ migration 20260624j PROD (labor_allocation +kind +days, percent nullable, CHECK forma 0<days≤60, 35 linhas=standing). |
| 2026-06-23 | F2.2 v_contract_roster +kind/days | ✅ migration 20260624k PROD (CREATE OR REPLACE, anexa kind/days no fim). |
| 2026-06-23 | F2.3 código kind-aware | ✅ types (AllocationKind, Allocation/Input/ContractRosterMember), dal (checkAllocation branch spot, allocRow, listContractRoster mapper). POST /api/finance/allocations já cria spot. tsc 0, eslint limpo. |
| 2026-06-23 | **F2.4 UI spot + acesso permanente** | ✅ contract sheet: botão "⚡ Pontual", campo Dias (8h, cap 60), branch save, linha "⚡ pontual · Xd", hint. createAllocation concede ProjectAccess contributor PERMANENTE (idempotente, não rebaixa). CHECK validado em prod (5d ok / 61d bloq / spot+% bloq). tsc 0, eslint limpo. |
| 2026-06-23 | **F2.5 custo do spot** | ✅ migration 20260624l PROD: `v_allocation_labor_month` vira UNION ALL (standing byte-idêntico, gated kind='standing' + spot = `round(comp_mês × days/22)` 1 linha no mês de effective_from via `v_member_comp_month`). Verificado: standing intacto (184 linhas / 71.071.710 cents antes=depois); spot 5d num projeto→ +454.545 cents SÓ em 2026-06 (rollback). Colunas da view inalteradas → sem update de types. tsc 0. |
| 2026-06-24 | **F2.6 v_project_team** | ✅ migration 20260624m PROD: view canônica do roster (allocated ∪ access-only), 17 colunas (member display + is_pm + fp_allocation + kind/percent/days/contract_id + access_role). DISTINCT ON (project,member) standing>spot. Gate `auth.uid() IS NULL OR is_admin() OR can_view_project` (escape p/ service-role, que não tem JWT) + GRANT USAGE finance + SELECT a service_role/authenticated. Verificado: dedup OK (0 user em 2 sources), projeto misto = 2 linhas com source certo. |
| 2026-06-24 | **F2.7 backfill órfãos** | ✅ migration 20260624n PROD: backfill PM ∪ ProjectMember sem alocação vigente E sem ProjectAccess → ProjectAccess (PM='lead', ProjectMember='viewer'). **Escopo estendido p/ PM** (runbook literal só ProjectMember deixaria 4 PMs caírem). INSERT 4 (os 4 PMs órfãos); 0 órfãos restantes; 0 pulados sem userId; 0 ProjectMember órfãos (já tinham acesso). NÃO cria labor_allocation (acesso≠custo). |
| 2026-06-24 | **F2.8 cutover 3 readers** | ✅ helper `getProjectTeam` em src/lib/dal/project-team.ts (lê v_project_team via service-role, filtra acesso sem Member). Os 3 readers apontados: rota /members, vitoria loadProjectMembers, alpha get_allocated_project_members — todos via getProjectTeam; squad fora do UNION (D9). Daemon: só schema-stub (execute no monorepo) → sem edit no daemon, descriptions/inputSchema intactos (sem surface regen). grep ProjectSquad nos 3 = vazio, tsc 0, eslint 0. Smoke PROD: 0 PMs sumidos do roster, todo projeto com ≥1 PM e team não-vazio (SILFAE=3). |
| | **Falta na Fase 2** | F2.9 member box read-only + F2.10 RLS audit. |
