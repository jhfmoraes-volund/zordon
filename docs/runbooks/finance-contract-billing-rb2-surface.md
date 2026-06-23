# RUNBOOK — Finance Billing · RB2 Superfície (B2 read + B3 write)

> 2º de 3 ([RB1 schema](finance-contract-billing-rb1-schema.md) · RB2 superfície · [RB3 automação](finance-contract-billing-rb3-automation.md)).
> Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md). Mock fiel (a UI alvo): [contract-canvas-sandbox.html](../features/finance/mockups/contract-canvas-sandbox.html) (V2 Dashboard).
> **Depende de RB1 aplicado.** Objetivo: migrar o detalhe financeiro pra **dentro do canvas** (read) + os **sheets focados** (write), migrando os editores que já existem (não forkar).

## 0. INVARIANTES
- **Regra firmada:** **canvas = ler/navegar/dashboard · bottom-sheet = escrever focado.** Nenhum form de escrita solto no canvas.
- **ResponsiveSheet** pros sheets (nunca `<Dialog>`/`<Sheet>` nu). **Field/FormBody** pros forms. **ConfirmDialog** (sem `confirm()`). **useOptimisticCollection** pra toda mutação de lista.
- **Smoke em browser por fase** (Q5 do dono) — não marcar pronto só com tsc.
- **Reuse, não fork:** o detalhe é o mock; mas os componentes vêm do que existe (`FinanceContracts`, `MonthOverrides`→Aditivos, form de alocação, `<Cronograma>`).
- **base-ui `Select.onValueChange` dá `string|null`** (coagir). **Form re-init via `key` + lazy `useState`** (NUNCA setState em effect — regra `react-hooks/set-state-in-effect`); effects de fetch só setam em `.then`/após await (gotcha já vivido no finance).

## 1. ESTADO ATUAL (verificado)
- `FinanceApp` (`finance-app.tsx`) lista projetos → abre `FinanceProjectSheet` (ResponsiveSheet) com: barra de premissas, **dropdown de escopo da DRE**, DRE, `<FinanceContracts>`, `<FinanceFpBilling>`, chart, **editor de alocação inline** (form no canvas — a inconsistência a corrigir).
- `FinanceContracts` (`finance-contracts.tsx`): cards (já usam `<Cronograma>`) + form de contrato + `MonthOverrides`.
- `app-desktop.tsx`: shell do canvas, **já responsivo** (dock `flex-row` no mobile / `md:flex-col` desktop; janela com header).
- `src/components/timeline/cronograma.tsx`: componente unificado (`shape="chip"`, `layout="scroll"`) — **reusar**, estender com layout grade se preciso.

## 2. FASES (em ordem; gate = smoke browser + tsc/eslint)

### Fase 2.1 — Detalhe migra pro canvas (de modal → janela)
`FinanceApp`: selecionar projeto **renderiza a view de detalhe na janela do `AppDesktop`** (não abre o `FinanceProjectSheet` modal). Extrair o corpo do `FinanceProjectSheet` num `FinanceProjectView` montado no canvas (remontado por `key={projectId}`). Manter fetch de `getProjectDetail`.
**Verify:** abre no canvas (não modal); responsivo (dock vira barra no mobile); dados reais.

### Fase 2.2 — Segmentado de escopo substitui o dropdown
Trocar o `<Select>` de escopo por segmentado `Global · <contratos> · +` (re-escopa `getProjectDetail` pela vigência, igual `selectScope` faz hoje). `+` abre o sheet de contrato novo.
**Verify:** trocar segmento re-escopa KPIs/DRE/equipe/cronograma/NF.

### Fase 2.3 — Layout V2 Dashboard
2 colunas no desktop (esq `Contratos → Equipe → Cronograma` · dir `KPIs → Notas Fiscais → DRE → Cláusulas`), gráfico full-width no fundo; **mobile colapsa** pro stack (`col-right` antes de `col-left`). Reusar a DRE atual (`DreLine`) e o chart (recharts) existentes.
**Verify:** desktop 2-col + mobile 1-col, mesma fonte.

### Fase 2.4 — KPIs + Cronograma 3-grid + Cláusulas card (read)
- **KPIs** scope-aware (Faturamento/Margem/Lucro/FP ou Mensalidade).
- **Cronograma**: grade **3-por-linha** no desktop / faixa horizontal no mobile, lendo `sprints` reais; chip clicável (deep-link entra no RB3). Estender `<Cronograma>` com um layout grade se o atual só fizer scroll.
- **Cláusulas & Garantia** card (read, scope-aware) lendo `contract_clause`.
**Verify:** os três lendo dados reais (clause da Fase RB1.2).

### Fase 2.5 — Widget **Notas Fiscais** (read)
Tira de meses (status dot 🟢 recebido / 🟠 ação / ⚪ bloqueado-futuro) + 3 passos por mês (**Condição → Faturado(NF) → Recebido**), lendo `invoice` (RB1.6) por contrato. Header rollup `recebido / total`.
**Verify:** Contrato 1 (recebido) × Contrato 2 (gates variados) refletem `invoice` real.

### Fase 2.6 — Sheet de contrato **rico** (write) — superfície única
`ResponsiveSheet size="lg"`. Seções: termos (valor global→preço/FP derivado, já feito no Batch C) · **Cláusulas & Garantia** · **Documentos** (upload Supabase → `contract_document`) · **Equipe** (alocações editáveis, escopadas à vigência, gravam `contract_id`) · **Aditivos & Overrides** (`contract_override`, toggle **billable/não-billable**, autorado por sprint). **Migrar pra cá** o `MonthOverrides` (vira Aditivos) e o form de alocação (sai do canvas).
**Verify:** criar/editar contrato; alocar membro (vê `contract_id`); aditivo billable entra na receita do período, não-billable não; anexar doc (upload).

### Fase 2.7 — Sheet **Emitir NF** (write)
`ResponsiveSheet`. Campos: mês de competência, valor, número, data de emissão, condição vinculada (chip), anexo XML/PDF (upload → `contract_document` com `invoice_id`). Cria/atualiza `invoice` (status `pending→issued→received`). Botão "Emitir NF" só com condição ok.
**Verify:** emitir NF de um mês → vira `issued`; marcar recebido → `received`; reflete no widget (2.5). **DRE inalterada** (Q4).

### Fase 2.8 — Equipe read-only no hub + limpeza
Hub mostra equipe **read-only** + "Editar no contrato →" (abre 2.6). **Remover** o form de alocação inline do `FinanceProjectView`. Aposentar `FinanceFpBilling` se a função foi absorvida pelo contrato/NF (confirmar antes de deletar).
**Verify:** zero escrita no canvas; tudo via sheet.

## 3. GOTCHAS
- `FinanceProjectSheet` → `FinanceProjectView`: cuidar do `key={projectId}` (remontagem) e dos handlers de reload/optimistic.
- `<Cronograma>` é o componente unificado (outra lane o criou) — **estender** com layout grade, não duplicar. Ver [cronograma-unification-runbook](cronograma-unification-runbook.md).
- Os ~66 leitores de `Project.dates` **não** são afetados (é só UI; o SSOT do período segue no trigger).
- Optimistic: `useOptimisticCollection` pra contratos/alocações/aditivos/NF; reconcile do create filtra temp + append real ([[feedback_optimistic_reconcile_create]]).
- Aditivo **não-billable** muda custo/equipe mas **não** entra em `v_contract_revenue_month` — conferir que a UI não soma ele na receita.

## 4. COMMIT (cadência 2–3 fases)
- `bash scripts/sync-main.sh`. Commit A = 2.1–2.4 (read no canvas); B = 2.5 (NF read); C = 2.6–2.8 (sheets write + limpeza).
- **Smoke browser aprovado pelo dono** antes de fechar cada bloco (Q5).

## 5. REFERÊNCIAS
- Mock alvo: [contract-canvas-sandbox.html](../features/finance/mockups/contract-canvas-sandbox.html)
- Código: `finance-app.tsx` · `finance-project-sheet.tsx` · `finance-contracts.tsx` · `app-desktop.tsx` · `src/components/timeline/cronograma.tsx`
- Padrões: `ResponsiveSheet` · `Field/FormBody` · `useOptimisticCollection` · memórias [[project_ui_patterns]] · [[feedback_usechat_transport_baked_first_render]] (cuidado com props async)
