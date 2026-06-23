# Plano — Finance: Billing (NF) + Hub no canvas + Agent-fill

> Camada nova sobre o épico **Contrato-como-SSOT** ([contract-ssot-handoff.md](contract-ssot-handoff.md)).
> Esta nota trava a **arquitetura transversal** (procedência de dados, anexos, time planejado×real) e a
> **UX escolhida** (hub no canvas + sheets focados), pra que o schema já nasça certo. Mocks fiéis validados:
> [mockups/contract-canvas-sandbox.html](mockups/contract-canvas-sandbox.html) (escolhido: **V2 Dashboard**) ·
> [mockups/contract-ux-sandbox.html](mockups/contract-ux-sandbox.html) (estudo de opções).
> Última atualização: 2026-06-22. **DDL é rascunho até as decisões do §6 fecharem.**

---

## 1. UX travada (validada em mock)

- **Superfície:** o detalhe financeiro do projeto migra de `ResponsiveSheet`-sobre-canvas para **renderizar dentro da janela do canvas de Apps** (`app-desktop.tsx`, já responsivo). Regra geral que isso firma: **canvas = ler/navegar/dashboard · bottom-sheet = escrever de forma focada.**
- **Escopo:** segmentado `Global · Contrato 1 · Contrato 2 · +` re-escopa tudo (KPIs + DRE + equipe + cronograma + faturamento).
- **Layout (V2 Dashboard):** desktop em 2 colunas — esquerda `Contratos → Equipe → Cronograma`, direita `KPIs → Faturamento&NF → DRE → Cláusulas&Garantia`; gráfico mensal full-width no fundo. Mobile colapsa pro mesmo stack (uma coluna).
- **Cronograma:** grade **3-por-linha** no desktop, faixa horizontal no mobile; **chip de sprint navega** pro Planning e pro PM Review do projeto (rotas já existem: `/projects/[id]/planning`, `/projects/[id]/pm-review` — precisam aceitar `?sprint=`/`?week=`).
- **Notas Fiscais** (renomeado de "Faturamento&NF" p/ não colidir com a categoria "Faturamento" — ver §6): widget com **tira de meses** (status dot 🟢 recebido / 🟠 ação pendente / ⚪ bloqueado-futuro) + 3 passos por mês (**Condição → Faturado (NF emitida) → Recebido**). "Emitir NF" abre sheet focado.
- **Editar/criar contrato e Emitir NF:** `ResponsiveSheet` ricos (os únicos modais).

---

## 2. Princípios transversais (moldam o schema — não negociáveis)

### P1 — Agent-fill com procedência por campo + override manual sticky
Um agente vai **coletar contrato/proposta/anexos e preencher** a maioria dos campos. O humano edita pelos sheets. Regra:
- Cada entidade preenchível carrega um mapa de **procedência por campo**: `provenance jsonb` → `{ campo: { source: 'agent'|'manual'|'integration', at, runId?, confidence? } }`.
- **Edição manual marca `source='manual'` naquele campo e gruda**: re-rodar o agente **não** sobrescreve campo manual (a menos de `force`).
- A UI mostra um selo por campo/seção: *"preenchido pela IA"* (com confiança) vs *"editado por você"*.
- **Decisão:** procedência é `jsonb` por linha (não tabela por-campo) — simples, suficiente, sem explosão de linhas. Manual > integration > agent na precedência.

### P2 — Anexos storage-agnósticos (NF, proposta, SOW, planilha de PF)
Documentos do faturamento e do contrato entram por uma abstração única; o provider (SharePoint **ou** Google Drive **ou** upload direto) pluga depois sem migrar dado.
- Tabela `finance.contract_document` (ou `finance_document`): `{ id, kind: 'proposal'|'sow'|'pf_sheet'|'nf_xml'|'nf_pdf'|'other', provider: 'gdrive'|'sharepoint'|'upload', external_ref (text), url?, contract_id?, invoice_id?, meta jsonb, source, created_at }`.
- **Nada no core referencia um provider específico** — só `provider + external_ref`. A integração (fase tardia) implementa um adapter `resolve(external_ref) → url/stream`. Espelha o padrão `ContextSource` (memory [[project_context_source_pool]]) e a integração Drive/Notion já existentes.
- **Onde o usuário coloca (UX, 1 slot por entidade):** seção **"Documentos"** no sheet de contrato (proposta · SOW · contrato · planilha de PF) e **"Anexo da NF"** (XML+PDF) no sheet de Emitir NF. Cada slot = **"Enviar arquivo"** (Supabase) **ou** **"Vincular do Drive/SharePoint"**.
- **Os 3 caminhos coexistem (não é ou/ou):** `provider='upload'` → Supabase Storage (bucket privado `finance-documents`); `'gdrive'|'sharepoint'` → só referência (arquivo fica lá, SSOT do cliente, anti-duplicação); `'erp'` → XML da NF vindo do emissor. **Política:** doc com casa oficial (proposta/contrato no Drive) = **vincular** (não copiar); doc sem casa (NF avulsa) = **enviar** pro storage.
- **MVP (B3):** só **upload Supabase** (zero integração, "onde colocar" óbvio). **B7:** Drive (já existe via Composio [[project_drive_integration]]) / SharePoint (novo) / ERP plugam no mesmo slot — `contract_document` não muda.

### P3 — Time planejado × real
- **Planejado** (o agente extrai do contrato/proposta: *senioridade + quantidade*, sem nomes): `finance.contract_planned_role` → `{ contract_id, seniority, count, monthly_cost_cents?, note, source }`.
- **Real** (manual, por nome): `finance.labor_allocation` (já existe) **ganha `contract_id` nullable** → a alocação passa a pertencer a um contrato. **Resolve a sub-decisão do Batch D do épico (FK contract_id = SIM).**
- **Edição centralizada no sheet do contrato** (escopada à vigência): membros, %, período. Sai do form inline do `FinanceProjectSheet` (que escrevia no canvas — violava "canvas=lê"). O hub mostra equipe **read-only** + botão "Editar no contrato →".
- O hub mostra os dois: "planejado: 2 sênior + 1 pleno" vs "alocado: Ana, Bruno…" — gap visível.

### P4 — Aditivos & Overrides (billable × não-billable)
- Generaliza `finance.contract_month_override` (hoje só por mês, só receita) → **`finance.contract_override`** período-based: `{ contract_id, effective_from, effective_to, amount_cents, mode ('replace'|'add'), billable boolean, note, source }`. **Autorado por sprint** (preenche datas, padrão D2 do épico), faturado por mês.
- **`billable=true`** → entra na receita do período (`v_contract_revenue_month` soma fee + overrides billable ativos no mês). **`billable=false`** → só registra (aditivo de pessoas interno / custo), **NÃO** fatura. Vocabulário `billable`/`non_billable` **reusado** de `project_category` (já existe no repo).
- Edição **no sheet do contrato** (junto com termos/cláusulas/docs/equipe) — superfície única.
- **⚠️ Decisão p/ B1:** migrar o `contract_month_override` existente (em prod, alimenta a view) → `contract_override`, OU adicionar tabela nova e manter month_override? *Recomendo migrar (1 conceito só).*

---

## 3. Modelo de dados (rascunho — confirmar §6)

Sobre o que já existe (`finance.contract` com `total_value_cents`/`price_per_fp_cents` GENERATED, `contract_month_override`, views de receita):

```
finance.contract  (estende)
  + warranty           text            -- garantia (P1: agent-fill)
  + proposal_ref       text            -- vínculo à proposta (doc em contract_document)
  + provenance         jsonb default '{}'  -- P1

finance.contract_clause            -- cláusulas (1-N; agent-fill + manual)
  id · contract_id · kind (text: 'sla'|'penalty'|'ip'|'confidentiality'|'readjust'|'other')
  · text · source · sort

finance.invoice                    -- NF por mês (cobrança/caixa; NÃO reconhece receita — Q4)
  id · contract_id · competence_month (date, dia 1) · amount_cents
  · number text? · issued_at date? · received_at date?
  · status ('pending'|'issued'|'received')   -- issued=Faturado(NF emitida) · received=Recebido(pago)
  · condition_kind ('pf_sheet'|'sow'|'none') · condition_met bool   -- por MÊS (Q3)
  · provenance jsonb · created_at · updated_at
  -- 1-N por mês, SEM unique (Q1)

finance.contract_document          -- P2 (anexos storage-agnósticos)
  id · kind · provider · external_ref · url? · contract_id? · invoice_id? · meta jsonb · source

finance.contract_planned_role      -- P3 (time planejado, agent-extraível)
  id · contract_id · seniority · count · monthly_cost_cents? · note · source

finance.labor_allocation  (estende) -- P3: alocação real ganha dono de contrato
  + contract_id  uuid null → fk contract   -- editável no sheet do contrato (resolve Batch D do épico)

finance.contract_override          -- P4 (generaliza contract_month_override)
  id · contract_id · effective_from · effective_to · amount_cents
  · mode ('replace'|'add') · billable bool · note · source   -- billable→receita; autorado por sprint
```

- **RLS:** valores/NF/anexos = admin (espelha D8 do épico); período/cláusulas legíveis por quem vê o projeto (via view com `can_view_project`).
- **Receita ↔ invoice (Q4 confirmado):** `invoice` é **só** estado operacional (emissão/recebimento); a *receita reconhecida* segue as views atuais (`v_contract_revenue_month` etc.) — não reescreve o motor de receita.
- **Migrations atômicas, uma por arquivo**, via `psql` (regra do repo); atualizar `src/lib/finance/types.ts` em paralelo.

---

## 4. Superfície de escrita = futura toolbelt do agente

Todo endpoint de escrita nasce **limpo o suficiente pra virar tool de agente** (padrão `ToolDescriptor`, ver [[project_daemon_tool_advertisement]]). Implicações:
- Writes **idempotentes** e validados server-side (Zod em `src/app/api/finance/**`).
- Toda escrita **seta procedência**: API normal → `source='manual'`; chamada do agente → `source='agent'` + `runId`/`confidence` (header ou campo).
- Endpoints novos: `POST/PATCH /api/finance/invoice`, `/api/finance/contract-document`, `/api/finance/contract-clause`, `/api/finance/planned-role` — todos admin, todos provenance-aware.
- **Não** construir o agente agora; só garantir que o contrato de dados não o impeça. (O agente coletor entra como fase própria.)

---

## 5. Faseamento

| Batch | Entrega | Depende de |
|---|---|---|
| **B1 · Schema** | Migrations: `invoice`, `contract_document`, `contract_clause`, `contract_planned_role`, `contract_override` (generaliza month_override, +billable+período), `+contract_id` em `labor_allocation`, `+warranty/proposal_ref/provenance` em `contract`; RLS; `types.ts`. | §6 fechado |
| **B2 · Hub no canvas (read)** | Detalhe migra pro canvas; segmentado; KPIs; DRE; cronograma 3-grid; card Cláusulas; widget Notas Fiscais (tira de meses) — **lendo dados reais**. | B1 |
| **B3 · Sheets focados (write)** | Sheet de contrato rico (cláusulas, garantia, valor global→preço/FP, planned-role) + sheet Emitir NF; tudo provenance-aware (`source='manual'`). | B1 |
| **B4 · Deep-link cronograma** | Chip → Planning/PM Review com `?sprint=`/`?week=`. | B2 |
| **B5 · Selos de procedência** | Badges "IA / editado" por seção; regra sticky no PATCH. | B1, B3 |
| **B6 · Agent coletor** | Endpoints viram tools; pipeline que lê proposta/contrato e popula (`source='agent'`). | B3, B5 |
| **B7 · Integração de storage** (tardia) | Adapter SharePoint/Drive por trás de `contract_document`. | B1 |

**Fase 1 ≥ atual:** B1+B2+B3 já entregam mais que o sheet de hoje (faturamento mensal, cláusulas, time planejado). B5/B6/B7 somam o "automático".

**Execução (runbooks, em ordem):** [RB1 schema](../../runbooks/finance-contract-billing-rb1-schema.md) (B1) · [RB2 superfície](../../runbooks/finance-contract-billing-rb2-surface.md) (B2+B3) · [RB3 automação](../../runbooks/finance-contract-billing-rb3-automation.md) (B4–B7). Cada fase tem gate de verificação; commit a cada 2–3 fases.

---

## 6. Decisões (resolvidas pelo dono 2026-06-22)

- **Q1 — NF por mês = N** (entidade `invoice` livre, **sem** `UNIQUE`). Dono sem preferência → escolha de menor risco: N representa o caso comum (1/mês) E parcial+complemento, custo zero; travar em 1 custaria migration se errado.
- **Q2 — 3 estados:** `pending` (NF não emitida) → `issued` = **Faturado** (NF emitida, aguarda pgto) → `received` = **Recebido** (na conta). O 3º passo do widget é **Recebido**, não "Faturado".
- **Q3 — Condição por MÊS:** `condition_kind`/`condition_met` vivem na `invoice` (cada NF mensal tem seu gate), squad inclusive. Sem propagação contrato→meses.
- **Q4 — `invoice` = SÓ cobrança/caixa; NÃO reconhece receita.** A receita da DRE segue das views atuais (termos do contrato); invoice é camada operacional (emitiu? recebeu?). Competência ≠ caixa → não acopla o P&L a um checkbox. **Não bloqueia o B1** (a tabela é igual; Q4 só decide se as views leem invoice — e a resposta é não).

### Mapa de nomes (anti-colisão — confirmado 2026-06-22)
- **"Faturamento"** = a **categoria** do ledger (`finance.category`, lançamentos `entry`) — fica como está, no `FinanceCategorySheet`.
- **"Notas Fiscais"** = o **widget novo** (NF/recebimento por mês/contrato). Renomeado de "Faturamento & NF" pra não colidir.
- **Receita** = derivada (views), conceito do P&L. Distinta das duas acima.
- O entry recorrente de receita squad (ex.: HITz R$ 86.366) é **legado** → vira one-off / removido quando o contrato assume a receita (D3 do épico; item da fila HITz).

---

## 7. Referências
- Épico: [contract-ssot-handoff.md](contract-ssot-handoff.md) · plano original [finance-app-plan.md](finance-app-plan.md) · [pricing-pnl-model.md](pricing-pnl-model.md)
- Mocks: [mockups/contract-canvas-sandbox.html](mockups/contract-canvas-sandbox.html) · [mockups/contract-ux-sandbox.html](mockups/contract-ux-sandbox.html)
- Código: `src/components/apps/finance/*` · `src/lib/finance/{types,dal}.ts` · `src/components/apps/app-desktop.tsx` · `src/app/api/finance/*`
- Padrões: `ContextSource` (Drive/Notion) p/ P2 · `ToolDescriptor` p/ §4 · `ResponsiveSheet` p/ sheets
- Memórias: [[project_finance_app]] · [[project_context_source_pool]] · [[project_daemon_tool_advertisement]] · [[project_drive_integration]] · [[feedback_grounded_no_hallucination]]
