# RUNBOOK — Finance Billing · RB2 Superfície (B2 read + B3 write)

> 2º de 3 ([RB1 schema](finance-contract-billing-rb1-schema.md) · RB2 superfície · [RB3 automação](finance-contract-billing-rb3-automation.md)).
> Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md). Mock fiel (a UI alvo): [contract-canvas-sandbox.html](../features/finance/mockups/contract-canvas-sandbox.html) (V2 Dashboard).
> **Depende de RB1 aplicado.** Objetivo: migrar o detalhe financeiro pra **dentro do canvas** (read) + os **sheets focados** (write), migrando os editores que já existem (não forkar).

## 0. INVARIANTES
- **Regra firmada:** **canvas = ler/navegar/dashboard · bottom-sheet = escrever focado.** Nenhum form de escrita solto no canvas.
- **ResponsiveSheet** pros sheets (nunca `<Dialog>`/`<Sheet>` nu). **Field/FormBody** pros forms. **ConfirmDialog** (sem `confirm()`).
- **Listas — decisão explícita (não half-wire):** o finance hoje usa `fetchOrThrow`+`reload()` (só `FinanceCategorySheet` usa `useOptimisticCollection`). Adotar o hook nas coleções novas é **net-new**, não migração. Decidir por-coleção: adota agora **ou** mantém `reload()`-após-fetch — não misturar. **Recomendo `reload()` no MVP**, adiar optimistic.
- **Smoke em browser por fase** (Q5 do dono) — não marcar pronto só com tsc.
- **Reuse, não fork:** o detalhe é o mock; mas os componentes vêm do que existe (`FinanceContracts`, `MonthOverrides`→Aditivos, form de alocação, `<Cronograma>`).
- **base-ui `Select.onValueChange` dá `string|null`** (coagir). **Form re-init via `key` + lazy `useState`** (NUNCA setState em effect — regra `react-hooks/set-state-in-effect`); effects de fetch só setam em `.then`/após await (gotcha já vivido no finance).

## 1. ESTADO ATUAL (verificado)
- `FinanceApp` (`finance-app.tsx`) lista projetos → abre `FinanceProjectSheet` (ResponsiveSheet) com: barra de premissas, **dropdown de escopo da DRE**, DRE, `<FinanceContracts>`, `<FinanceFpBilling>`, chart, **editor de alocação inline** (form no canvas — a inconsistência a corrigir).
- `FinanceContracts` (`finance-contracts.tsx`): cards (já usam `<Cronograma>`) + form de contrato + `MonthOverrides`.
- `app-desktop.tsx`: shell do canvas, **já responsivo** (dock `flex-row` no mobile / `md:flex-col` desktop; janela com header).
- `src/components/timeline/cronograma.tsx`: componente unificado. O `shape="grid"` atual é **auto-fill** (`minmax(64px,1fr)`), **não** fixo-3; o único caller finance usa `shape="chip" layout="scroll"`. A grade-3 do mock é **extensão real** (prop genérica), não fork.

## 2. FASES (em ordem; gate = smoke browser + tsc/eslint)

### Fase 2.1 — Detalhe migra pro canvas (de modal → janela)
`FinanceApp`: selecionar projeto **renderiza a view de detalhe na janela do `AppDesktop`** (não abre o `FinanceProjectSheet` modal). Extrair o corpo do `FinanceProjectSheet` num `FinanceProjectView` montado no canvas (remontado por `key={projectId}`). Manter fetch de `getProjectDetail`. Passar **`windowSubtitle` dinâmico = nome do projeto** (o host hardcoda `'Overview'` em `overview-apps-desktop.tsx:58`).
**Verify:** abre no canvas (não modal); responsivo (dock vira barra no mobile); título da janela = projeto; dados reais.

### Fase 2.2 — Segmentado de escopo substitui o dropdown
Trocar o `<Select>` de escopo por segmentado `Global · <contratos> · +` (re-escopa `getProjectDetail` pela vigência, igual `selectScope` faz hoje). `+` abre o sheet de contrato novo.
**Verify:** trocar segmento re-escopa KPIs/DRE/equipe/cronograma/NF.

### Fase 2.3 — Layout V2 Dashboard
2 colunas no desktop (esq `Contratos → Equipe → Cronograma` · dir `KPIs → Notas Fiscais → DRE → Cláusulas`), gráfico full-width no fundo; **mobile colapsa** pro stack (`col-right` antes de `col-left`). Reusar a DRE atual (`DreLine`) e o chart (recharts) existentes.
**Verify:** desktop 2-col + mobile 1-col, mesma fonte.

### Fase 2.4 — KPIs + Cronograma 3-grid + Cláusulas card (read)
- **KPIs** scope-aware (Faturamento/Margem/Lucro/FP ou Mensalidade).
- **Cronograma**: grade **3-por-linha** (desktop) / faixa horizontal (mobile), lendo `sprints` reais; chip clicável (deep-link no RB3). Fazer via **prop genérica** no `<Cronograma>` (ex. `shape="grid" gridCols={3}`) — o grid atual é auto-fill, então é extensão; coordenar com a lane de unificação (parity-by-prop, sem importar de `finance/`).
- **Cláusulas & Garantia** card (read, scope-aware) lendo `contract_clause`.
**Verify:** os três lendo dados reais (clause da RB1 Fase 1.2).

### Fase 2.5 — Widget **Notas Fiscais** (read)
Tira de meses (status dot 🟢 recebido / 🟠 ação / ⚪ bloqueado-futuro) + 3 passos por mês (**Condição → NF emitida → Recebido** — copy "NF emitida", NUNCA "Faturado", §6 do plano), lendo `invoice` (RB1 Fase 1.4) por contrato. Header rollup `recebido / total`.
- **Aging:** `issued && !received && due_at < hoje` = vencido (o output mais valioso).
- **Indicador soft** (visibilidade, não constraint): Σ(invoice.amount do mês) vs `v_contract_revenue_month` do (project,month) — divergência é esperada por design (D9), só sinalizar.
- **`cancelled` fica FORA** dos rollups billed/received.
**Verify:** Contrato 1 (recebido) × Contrato 2 (gates variados) refletem `invoice` real; mês vencido aparece; NF cancelada some do rollup.

### Fase 2.6 — Sheet de contrato **rico** (write) — superfície única
`ResponsiveSheet size="lg"`. Seções (Slice 1): termos (valor global→preço/FP derivado, Batch C feito) · **Cláusulas & Garantia** · **Equipe** (alocações editáveis, escopadas à vigência, gravam `contract_id`) · **Aditivos** (no MVP = o `contract_month_override` atual migrado pra cá; **billable/período/`não-billable` chega na Slice 2** com `contract_override`). **Migrar pra cá** o `MonthOverrides` e o form de alocação (sai do canvas). **Documentos (upload)** = **Slice 4** (deferido — slot omitido/"em breve" no MVP).
**Verify:** criar/editar contrato; alocar membro (grava `contract_id`); aditivo de mês persiste; editar vigência re-resolve o escopo do hub (ver §3 reload).

### Fase 2.7 — Sheet **Emitir NF** (write)
`ResponsiveSheet`. Campos: mês de competência, valor (**bruto**) + líquido (recebido), número, datas (emissão/recebimento/**vencimento**), condição vinculada (chip). **Anexo XML/PDF = Slice 4** (MVP captura sem anexo). Cria/atualiza `invoice` (`pending→issued→received`; `cancelled` disponível). Botão "Emitir NF" só com condição ok. **Criação humana** (não-agente).
**Verify:** emitir NF → `issued`; marcar recebido → `received`; cancelar → `cancelled` (sai do rollup); reflete no widget (2.5). **DRE inalterada** (Q4).

### Fase 2.8 — Equipe read-only no hub + limpeza
Hub mostra equipe **read-only** + "Editar no contrato →" (abre 2.6). **Remover** o form de alocação inline do `FinanceProjectView`. ⚠️ **MANTER `FinanceFpBilling`** — ele loga `fp_delivered` = receita fixed_scope (`v_fp_delivery_month`), que a NF (operacional, Q4) **não** absorve; "absorvido pela NF" é erro de categoria. Só portar pra um sheet depois, **sem deletar**.
**Verify:** zero escrita no canvas (alocação); projeto fixed_scope **ainda loga entregas de FP** pós-migração.

### Fase 2.9 — 🔒 Batch B: período legível por quem vê o projeto (Slice 3 · GATED no Q3)
O épico decidiu isso e é **segurança** — não pode sumir silenciosamente. Migration `finance.v_contract_period` (`project_id,label,seq,effective_from,effective_to,billing_type` com `where can_view_project(project_id) OR is_admin()`); seção de contratos no **tab do projeto** (período pra viewer; valores só admin); **prova guest-barrada via psql** (`set role`/JWT). **Não rodar antes de decidir o Q3 do épico** (quem edita o período: admin-só × manager).
**Verify:** viewer com acesso vê período + **zero p/ guest** (psql); valores nunca retornam fora de admin.

## 3. GOTCHAS
- `FinanceProjectSheet` → `FinanceProjectView`: cuidar do `key={projectId}` (remontagem) e dos handlers de reload/optimistic.
- `<Cronograma>` é o componente unificado (outra lane o criou) — **estender** com layout grade, não duplicar. Ver [cronograma-unification-runbook](cronograma-unification-runbook.md).
- Os ~66 leitores de `Project.dates` **não** são afetados (é só UI; o SSOT do período segue no trigger).
- **Reload cross-component:** o sheet de contrato e o de NF recebem `onChanged` que re-roda o `reload()` do hub **E re-resolve o escopo** contra os contratos frescos — senão `selectScope` fica stale ao editar a vigência. Optimistic: ver decisão §0 (não half-wire).
- Aditivo **não-billable** (Slice 2) muda custo/equipe mas **não** entra em `v_contract_revenue_month` — conferir que a UI não soma na receita.

## 4. COMMIT (cadência 2–3 fases)
- `bash scripts/sync-main.sh`. Commit A = 2.1–2.4 (read no canvas); B = 2.5 (NF read); C = 2.6–2.8 (sheets write + limpeza).
- **Smoke browser aprovado pelo dono** antes de fechar cada bloco (Q5).

## 5. REFERÊNCIAS
- Mock alvo: [contract-canvas-sandbox.html](../features/finance/mockups/contract-canvas-sandbox.html)
- Código: `finance-app.tsx` · `finance-project-sheet.tsx` · `finance-contracts.tsx` · `app-desktop.tsx` · `src/components/timeline/cronograma.tsx`
- Padrões: `ResponsiveSheet` · `Field/FormBody` · `useOptimisticCollection` · memórias [[project_ui_patterns]] · [[feedback_usechat_transport_baked_first_render]] (cuidado com props async)
