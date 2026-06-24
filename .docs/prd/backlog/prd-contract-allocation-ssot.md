# PRD — Contract / Proposal lifecycle + Alocação como SSOT

> Estado: **backlog** · 2026-06-23 · Rito 1 (Intake) não rodou.
> Plano de origem: [docs/platform/project-contract-allocation-ssot-plan.md](../../platform/project-contract-allocation-ssot-plan.md).
> Mocks: `/tmp/project-kind-options.html`, `/tmp/spot-allocation-options.html`.

## 1. Problema

1. Criar projeto mistura identidade + comercial + equipe num form de 14 campos; **datas/engajamento/equipe duplicam** entre `Project` e `finance.contract` → dois donos, drift. [doc: plano §1]
2. **"Proposta" não existe** como entidade — só `proposal_ref` texto. O funil proposta→piloto/MVP→contrato não tem casa. [doc]
3. **Alocação de membro tem 5 semânticas e ~16 caminhos de escrita** (ProjectMember, labor_allocation, ProjectSquad, pmId, SprintMember); só Finanças é admin-gated; roster lido de 3 jeitos divergentes. Head of ops não tem lugar canônico pra atender pedidos de alocação. [inventário no plano §6]

## 2. Solução em uma frase

Contrato é a verdade comercial (datas, faturamento, **roster + %**) e o Projeto projeta; Proposta = Contrato `status='proposed'`; toda alocação (inclusive participação pontual por sprint) passa pela interface do contrato, admin-only, e o Projeto só lê.

## 3. Não-objetivos

- Não fundir `ProjectMember.fpAllocation` (teto PFV / planning) com `labor_allocation.percent` (custo).
- Não mexer em `SprintMember` (teto PFV por sprint) — eixo capacidade, não custo.
- Não construir versionamento de proposta (múltiplas opções de preço). Proposta = 1 contrato `proposed`.
- Não relaxar `Project.clientId` (internos usam cliente Volund).

## 4. Personas e jornada

- **Head of ops (João, admin):** "Me pediram um builder por 2 sprints. Eu abro o contrato, adiciono a participação pontual a 10% no Sprint 5, e o custo já aparece. Eu sou o único que aloca — sei quem faz o quê."
- **PM:** "Vejo a equipe do projeto (fixa + pontual do sprint) sem poder alterar % — alocação é do head of ops."
- **Builder pontual:** "Entrei pra ajudar no Sprint 5; ganhei acesso ao projeto enquanto durou."

## 5. Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Proposta = `finance.contract.status='proposed'` (sem tabela nova) | proposta e contrato são o mesmo em estágios diferentes |
| D2 | Contrato dono de datas/engajamento; Projeto deriva | trigger `contract_sync_project_dates` (20260623h) já existe |
| D3 | Internal usa client 'Volund' (clientId continua required) | sem mudar constraint/queries |
| D4 | Kind selector (Interno/Proposta/Contratado) no new-project sheet | um clique molda form + lifecycle |
| D5 | Fase independe do status do contrato; só `commercial` reservada à Proposta | corrige acoplamento |
| D6 | `labor_allocation` = roster de record; contrato/Finanças único escritor, admin-only; Projeto lê | SSOT de dados + experiência |
| D7 | Internos alocam com `contract_id=null`, mesma interface | tabela já permite |
| D8 | Acesso ≠ alocação; `ProjectAccess` (viewer/guest) dá view-only sem % | preserva guest-access |
| D9 | Squad linkada = pool/contexto, não membership (sai do UNION) | continua derivando PM |
| D10 | Leitor canônico `getProjectTeam(projectId, at?)` = alocados ∪ access-only | mata 3 UNIONs divergentes |
| D11 | Participação pontual = `labor_allocation kind='spot'` ancorada a `sprint_id`, % de ajuda | mesma tabela, sem fragmentar |
| D12 | Seleção de sprints da participação = **TagPicker** (multi-select chip, reuso de `src/components/tags/tag-picker.tsx` em modo pure-selection, `max`≥12). Selecionar N sprints **fan-out em N rows** `kind='spot'` (1 por sprint), mesmo %. | João: "escolher sprints é igual a adicionar tags numa task — escala pra 12+, navegação melhor". 1 row/sprint mantém custo-por-sprint limpo. |

## 6. Arquitetura

```
Opportunity ─promote()─▶ Project ──tem──▶ Contract(s)  [proposed→active→ended/declined]
                        (identidade)        effective_from/to · billing_type · valor
                            │                     │
                ┌───────────┴─────────┐          └─ labor_allocation (roster + %)  ◀─ ÚNICO escritor (admin)
                ▼                     ▼                    │  standing | spot(sprint_id)
          ProjectAccess        startDate/endDate           │ deriva
        (lead/viewer/guest)    engagementType ◀─ trigger ──┘
                │              (read-through)
                └────────────┬──────────────────────────────┐
                             ▼                                ▼
                  getProjectTeam(projectId, at?) = alocados ∪ access-only  [leitor único]
```

Cada caixa mapeia a artefato real: `finance.contract` (tabela), `finance.labor_allocation` (tabela), `ProjectAccess` (tabela), `getProjectTeam` (view/DAL), trigger `contract_sync_project_dates` (existe).

## 7. Schema

Migrations atômicas (1 por arquivo), via `psql "$DIRECT_URL" -f ...` (só prod — ver memory).

**M1 — `20260624d_finance_contract_status.sql`**
```sql
ALTER TABLE finance.contract
  ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('proposed','active','ended','declined'));
CREATE INDEX idx_contract_status ON finance.contract(status);
```

**M2 — `20260624e_labor_allocation_spot.sql`**
```sql
ALTER TABLE finance.labor_allocation
  ADD COLUMN kind text NOT NULL DEFAULT 'standing'
    CHECK (kind IN ('standing','spot')),
  ADD COLUMN sprint_id uuid REFERENCES public."Sprint"(id) ON DELETE CASCADE;
-- invariante: kind='spot' ⇒ sprint_id NOT NULL
ALTER TABLE finance.labor_allocation
  ADD CONSTRAINT spot_requires_sprint
  CHECK (kind <> 'spot' OR sprint_id IS NOT NULL);
CREATE INDEX idx_alloc_sprint ON finance.labor_allocation(sprint_id) WHERE sprint_id IS NOT NULL;
```

**M3 — `20260624f_seed_volund_client.sql`** — insert idempotente do cliente interno 'Volund' (`ON CONFLICT (name) DO NOTHING` ou guard por existência).

**M4 — `20260624g_get_project_team_view.sql`** — view `v_project_team` (ou função): alocados vigentes de `labor_allocation` ∪ rows de `ProjectAccess`, com origem (`allocated`|`access`) e `percent`/`role`.

**RLS:** garantir POLICY de write admin-only em `finance.labor_allocation` (auditar; D6).

## 8. APIs

| Método | Path | Contrato |
|--------|------|----------|
| PATCH | `/api/finance/contract/[id]` | aceita `status`; valida transição proposed→active/declined, active→ended |
| POST | `/api/finance/contract/[id]/win` | proposed→active; bumpa Project.phase commercial→immersion se ainda commercial; 200 |
| POST | `/api/finance/allocations` | aceita `kind`,`sprintId`; spot exige sprintId; valida Σ% |
| GET | `/api/projects/[id]/members` | passa a delegar a `getProjectTeam` (mesma resposta, fonte única) |
| POST | `/api/projects` | aceita `kind`; internal→Volund client + sem contrato; proposal/contracted→cria contrato no status certo |

## 9. UX

Wireframes vivos: `/tmp/project-kind-options.html` (kind selector + datas derivadas) e `/tmp/spot-allocation-options.html` (Equipe fixa + Participações pontuais por sprint + custo). Ambos com tokens reais. A escolha de sprints na participação pontual usa o **TagPicker** (mesmo chip multi-select das tags de task), escalável a 12+ sprints.

## 10. Integrações

- **Planning/sprint view:** chips de participação pontual no sprint; lê `getProjectTeam(projectId, sprintWindow)`.
- **Finance views** (`v_project_labor_month`, `v_member_comp_month`): spot entra no custo do mês do sprint sem mudança (já agregam `labor_allocation` por mês).
- **Agentes Vitoria/Alpha:** `loadProjectMembers`/`get_allocated_project_members` passam a chamar `getProjectTeam`; Alpha `manage_allocation` scope=project vira update-only.

## 11. Faseamento

- **Fase 1 — Lifecycle de contrato:** M1, M3; status no contract sheet; kind selector; datas read-only derivadas; transição "ganhar proposta". (Entrega ≥ hoje: proposta vira 1ª classe sem perder nada.)
- **Fase 2 — Convergência de alocação + spot:** M2, M4; `getProjectTeam` + apontar 3 readers; member box read-only; redirect members API + Alpha; remover squad do UNION; UI de participação pontual; auto-grant ProjectAccess; Σ% validation; backfill órfãos; RLS audit.

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| ProjectMembers órfãos (sem allocation) somem do roster | Alta | Médio | CAS-018 backfill antes do cutover do reader |
| Internos sem contrato quebram leitura | Média | Médio | D7 contract_id=null; getProjectTeam não exige contrato |
| Alpha/Planning quebram ao perder insert | Média | Médio | update-only + erro claro |
| Σ% conflita entre contrato/projeto/spot | Média | Baixo | validar por projeto somando standing+spot vigentes |
| Transição de status inválida | Baixa | Médio | máquina de estados explícita na API |

## 13. Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| 0 caminhos de escrita de roster fora do contrato | grep CI: nenhum INSERT em ProjectMember fora do reconciler |
| 100% projetos com datas = derivadas do contrato | SQL: `Project` cujas datas ≠ min/max das vigências = 0 |
| Participações pontuais ativas visíveis no custo | SQL: `labor_allocation WHERE kind='spot'` aparece em `v_project_labor_month` |
| Roster lido de 1 fonte | grep: `getProjectTeam` é o único UNION; 3 readers antigos removidos |

## 14. Open questions

- `getProjectTeam` = view SQL ou helper TS? (Fase 2 — preferir view se agentes leem do Postgres.) [não-bloqueante]
- Default de `ProjectMember.fpAllocation` quando roster vira derivado. [Fase 2]

## 15. Referências

- Plano: docs/platform/project-contract-allocation-ssot-plan.md
- Trigger datas: supabase/migrations/20260623h_finance_contract_period_ssot.sql
- labor_allocation+contract_id: supabase/migrations/20260624c_finance_alloc_contract.sql
- Readers: src/app/api/projects/[id]/members/route.ts, src/lib/agent/agents/vitoria/tools.ts, src/lib/agent/agents/alpha/tools.ts
- Sheets: src/components/apps/finance/finance-contract-sheet.tsx, src/components/projects/project-edit-sheet.tsx
- Memórias: project_project_contract_proposal_ssot, project_finance_app, project_labor_allocation_model, project_member_roles_access, project_guest_access, project_project_squad_from_pm, project_sprint_week_model

## 16. Stories implementáveis

```yaml
- id: CAS-001
  title: Migration finance.contract.status
  description: Adiciona coluna status (proposed/active/ended/declined) default active + index.
  acceptanceCriteria:
    - "Coluna finance.contract.status existe com CHECK nos 4 valores e default 'active'"
    - "Index idx_contract_status criado"
  verifiable:
    - kind: sql
      command_or_query: "select column_name, column_default from information_schema.columns where table_schema='finance' and table_name='contract' and column_name='status'"
      expected: "1 linha, default 'active'::text"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/20260624d_finance_contract_status.sql, src/lib/supabase/database.types.ts]

- id: CAS-002
  title: Seed cliente interno Volund (idempotente)
  description: Migration que garante 1 Client 'Volund' pra projetos internos.
  acceptanceCriteria:
    - "Existe exatamente 1 Client name='Volund' após rodar 2x"
  verifiable:
    - kind: sql
      command_or_query: "select count(*) from \"Client\" where name='Volund'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 10
  touches: [supabase/migrations/20260624f_seed_volund_client.sql]

- id: CAS-003
  title: Status no contract sheet
  description: Select de status no FinanceContractSheet + chip de status no header; persiste via PATCH.
  acceptanceCriteria:
    - "Sheet mostra status atual como chip e permite editar (proposed/active/ended/declined)"
    - "PATCH /api/finance/contract/[id] aceita e persiste status"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-001]
  estimateMinutes: 30
  touches: [src/components/apps/finance/finance-contract-sheet.tsx, src/app/api/finance/contract/[id]/route.ts]

- id: CAS-004
  title: Kind selector no new-project sheet
  description: Topo do ProjectEditSheet ganha seletor Interno/Proposta/Contratado (3 cards).
  acceptanceCriteria:
    - "Form de criação mostra seletor de kind no topo"
    - "kind selecionado define category/phase/cliente conforme tabela do mock"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-002]
  estimateMinutes: 30
  touches: [src/components/projects/project-edit-sheet.tsx]

- id: CAS-005
  title: Fluxo de criação por kind
  description: POST /api/projects aceita kind; internal→Volund+sem contrato; proposal→contrato proposed; contracted→contrato active.
  acceptanceCriteria:
    - "kind=internal cria Project category=internal client=Volund, sem contrato"
    - "kind=proposal cria Project phase=commercial + contrato status=proposed"
    - "kind=contracted cria Project phase=immersion + contrato status=active"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-004, CAS-001]
  estimateMinutes: 30
  touches: [src/app/api/projects/route.ts]

- id: CAS-006
  title: Datas/engajamento derivados (read-only) no project sheet
  description: Quando o projeto tem contrato, startDate/endDate/engagementType ficam read-only ("do contrato ativo"); internos mantêm manual.
  acceptanceCriteria:
    - "Campos de data/engajamento desabilitados quando há contrato"
    - "Internos (sem contrato) mantêm campos editáveis"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-005]
  estimateMinutes: 25
  touches: [src/components/projects/project-edit-sheet.tsx]

- id: CAS-007
  title: Transição "ganhar proposta"
  description: POST /api/finance/contract/[id]/win → proposed→active + bump Project.phase commercial→immersion se ainda commercial.
  acceptanceCriteria:
    - "Endpoint flippa status proposed→active"
    - "Project.phase vira immersion se estava commercial; senão inalterado"
    - "Cria ProjectPhaseEvent na transição"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-001]
  estimateMinutes: 30
  touches: [src/app/api/finance/contract/[id]/win/route.ts]

- id: CAS-008
  title: Migration labor_allocation kind + sprint_id
  description: Adiciona kind (standing/spot) + sprint_id FK + CHECK spot⇒sprint_id + index.
  acceptanceCriteria:
    - "Colunas kind e sprint_id existem; CHECK spot_requires_sprint ativo"
    - "Insert spot sem sprint_id falha o CHECK"
  verifiable:
    - kind: sql
      command_or_query: "select count(*) from information_schema.columns where table_schema='finance' and table_name='labor_allocation' and column_name in ('kind','sprint_id')"
      expected: "2"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/20260624e_labor_allocation_spot.sql, src/lib/supabase/database.types.ts]

- id: CAS-009
  title: Leitor canônico getProjectTeam / v_project_team
  description: View ou helper que retorna alocados (labor_allocation vigente) ∪ access-only (ProjectAccess), com origem.
  acceptanceCriteria:
    - "getProjectTeam(projectId, at?) retorna lista deduplicada com origem allocated|access"
    - "Membro alocado e membro só-acesso ambos aparecem com flag correta"
  verifiable:
    - kind: sql
      command_or_query: "select count(*) from information_schema.views where table_name='v_project_team'"
      expected: ">=1 (ou helper TS coberto por typecheck)"
  dependsOn: [CAS-008]
  estimateMinutes: 30
  touches: [supabase/migrations/20260624g_get_project_team_view.sql, src/lib/dal/project-team.ts]

- id: CAS-010
  title: Apontar 3 readers para getProjectTeam
  description: api/projects/[id]/members, vitoria loadProjectMembers, alpha get_allocated_project_members passam a usar getProjectTeam.
  acceptanceCriteria:
    - "Os 3 readers chamam getProjectTeam; UNIONs ad-hoc removidos"
  verifiable:
    - kind: lint
      command_or_query: "! grep -rn 'ProjectSquad' src/app/api/projects/*/members/route.ts src/lib/agent/agents/vitoria/tools.ts src/lib/agent/agents/alpha/tools.ts"
      expected: "sem matches (squad fora do roster)"
  dependsOn: [CAS-009]
  estimateMinutes: 30
  touches: [src/app/api/projects/[id]/members/route.ts, src/lib/agent/agents/vitoria/tools.ts, src/lib/agent/agents/alpha/tools.ts]

- id: CAS-011
  title: Backfill órfãos antes do cutover
  description: Pra cada ProjectMember sem labor_allocation vigente, criar ProjectAccess viewer (ou allocation placeholder) pra não sumir do roster.
  acceptanceCriteria:
    - "Nenhum membro hoje visível some do getProjectTeam após cutover"
  verifiable:
    - kind: sql
      command_or_query: "select count(*) from \"ProjectMember\" pm where not exists (select 1 from finance.labor_allocation la where la.member_id=pm.\"memberId\" and la.project_id=pm.\"projectId\") and not exists (select 1 from \"ProjectAccess\" pa where pa.\"memberId\"=pm.\"memberId\")"
      expected: "0"
  dependsOn: [CAS-009]
  estimateMinutes: 25
  touches: [supabase/migrations/20260624h_backfill_roster.sql]

- id: CAS-012
  title: Member box do project sheet vira read-only
  description: Substitui o seletor de membros por "Equipe (dos contratos)" read-only que lê getProjectTeam.
  acceptanceCriteria:
    - "Project sheet não escreve mais ProjectMember; mostra equipe derivada read-only"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-010, CAS-011]
  estimateMinutes: 25
  touches: [src/components/projects/project-edit-sheet.tsx]

- id: CAS-013
  title: Redirect members API + Alpha para update-only
  description: PUT /api/members/[id]/allocations escreve só labor_allocation; Alpha manage_allocation scope=project não insere membro (só atualiza).
  acceptanceCriteria:
    - "members API não insere ProjectMember"
    - "Alpha scope=project em membro não alocado retorna erro claro"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-010]
  estimateMinutes: 30
  touches: [src/app/api/members/[id]/allocations/route.ts, src/lib/agent/agents/alpha/tools.ts]

- id: CAS-014
  title: UI de participação pontual no contract sheet (sprints via TagPicker)
  description: Seção "Participações por sprint" + form inline (builder + sprints + %). Seleção de sprints reutiliza TagPicker (pure-selection, max>=12); N sprints selecionados fazem fan-out em N rows labor_allocation kind=spot (1 por sprint), mesmo %.
  acceptanceCriteria:
    - "Sprints escolhidos via TagPicker (chips, searchable, max>=12) — sem dropdown single-select"
    - "Selecionar N sprints cria N rows kind=spot, 1 por sprint, com sprint_id e mesmo %"
    - "Vigência de cada row = janela do sprint (effective_from/to derivados do Sprint)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-008]
  estimateMinutes: 30
  touches: [src/components/apps/finance/finance-contract-sheet.tsx, src/components/tags/tag-picker.tsx, src/app/api/finance/allocations/route.ts]

- id: CAS-015
  title: Spot auto-grant ProjectAccess
  description: Ao criar spot, garantir ProjectAccess contributor pelo período da vigência.
  acceptanceCriteria:
    - "Builder spot ganha ProjectAccess; sem duplicar se já tem"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-014]
  estimateMinutes: 25
  touches: [src/app/api/finance/allocations/route.ts]

- id: CAS-016
  title: Chips de participação pontual no sprint/Planning view
  description: Sprint view mostra equipe fixa + chips "pontual" lendo getProjectTeam pela janela do sprint.
  acceptanceCriteria:
    - "Sprint com spot mostra chip do builder pontual + %"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-014, CAS-009]
  estimateMinutes: 30
  touches: [src/components/sprint, src/app/(dashboard)/projects/[id]/planning/page.tsx]

- id: CAS-017
  title: Validação Σ% com null-scoped + spot
  description: createAllocation valida soma ≤100 por projeto considerando contract_id=null (internos) e spot vigentes no período.
  acceptanceCriteria:
    - "Σ% > 100 no período bloqueia (ou avisa, conforme labor_allocation_model)"
    - "Spot conta no período do sprint; standing no período da vigência"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 errors"
  dependsOn: [CAS-008]
  estimateMinutes: 25
  touches: [src/lib/finance/dal.ts]

- id: CAS-018
  title: RLS audit write admin-only em labor_allocation
  description: Garantir POLICY explícita de INSERT/UPDATE/DELETE admin-only.
  acceptanceCriteria:
    - "Policies de write em finance.labor_allocation exigem admin"
  verifiable:
    - kind: sql
      command_or_query: "select count(*) from pg_policies where schemaname='finance' and tablename='labor_allocation' and cmd in ('INSERT','UPDATE','DELETE')"
      expected: ">=3"
  dependsOn: [CAS-008]
  estimateMinutes: 20
  touches: [supabase/migrations/20260624i_labor_allocation_rls.sql]
```
