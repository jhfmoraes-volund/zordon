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

## FASE 2 — Convergência de alocação + participação pontual (depois)

Resumo (detalhar quando chegarmos):
- Migration `labor_allocation` + `kind`/`sprint_id` (spot) + CHECK spot⇒sprint_id.
- View `v_project_team` = alocados (labor_allocation vigente) ∪ access-only (ProjectAccess).
- **Backfill órfãos** (ProjectAccess viewer p/ ProjectMember sem allocation) ANTES do cutover.
- Apontar os 3 readers (api members, vitoria, alpha) pra `v_project_team`; remover squad do UNION.
- Member box do project sheet → read-only "Equipe (dos contratos)".
- Redirect members API + Alpha (insert→update-only).
- UI participação pontual (TagPicker de sprints, fan-out 1 row/sprint) + auto-grant ProjectAccess + chips no sprint view.
- Σ% validation (null-scoped + spot) + RLS audit admin-only.

---

## Log de execução

| Data | Step | Resultado |
|------|------|-----------|
| 2026-06-23 | runbook criado | Fase 1 definida |
| 2026-06-23 | F1.1 contract.status | ✅ aplicado PROD (11 contratos = active), index criado, types regenerados, tsc 0 |
| 2026-06-23 | F1.2 seed Volund | ✅ aplicado PROD (no-op: Volund já existia, count=1); migration idempotente no repo |
| 2026-06-23 | F1.3 status no contract sheet | ✅ ContractStatus + máquina de estados (dal) + chip/StatusChipSelect no sheet + CONTRACT_STATUS registry. tsc 0. NÃO commitado (sessão concorrente editando finance/dal.ts). |
