# Plano — Finance: Billing (NF) + Hub no canvas + Agent-fill

> Camada nova sobre o épico **Contrato-como-SSOT** ([contract-ssot-handoff.md](contract-ssot-handoff.md)).
> Esta nota trava a **arquitetura transversal** (procedência de dados, anexos, time planejado×real) e a
> **UX escolhida** (hub no canvas + sheets focados), pra que o schema já nasça certo. Mocks fiéis validados:
> [mockups/contract-canvas-sandbox.html](mockups/contract-canvas-sandbox.html) (escolhido: **V2 Dashboard**) ·
> [mockups/contract-ux-sandbox.html](mockups/contract-ux-sandbox.html) (estudo de opções).
> Última atualização: 2026-06-22 (pós-audit multi-agente). Decisões Q1–Q4+D9 fechadas (§6); faseamento **re-sequenciado por valor/risco** (§5, slice-vertical-primeiro). DDL pronto pra RB1.

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
- **Merge (mecânica — senão um PATCH ingênuo zera o mapa):** PATCH faz **deep-merge** (`provenance || jsonb_build_object(campo, …)`), nunca substitui o mapa inteiro. A regra sticky roda em **1 statement SQL** com `WHERE` no source atual (não SELECT-depois-UPDATE — evita race; tabelas finance não têm optimistic-concurrency). Agente só escreve campo cujo source ≠ `'manual'` salvo `force=true` (definir a superfície de `force`). **Verify automatizável:** set manual → roda agente → asserta inalterado.

### P2 — Anexos storage-agnósticos (NF, proposta, SOW, planilha de PF)
Documentos do faturamento e do contrato entram por uma abstração única; o provider (SharePoint **ou** Google Drive **ou** upload direto) pluga depois sem migrar dado.
- Tabela `finance.contract_document` (ou `finance_document`): `{ id, kind: 'proposal'|'sow'|'pf_sheet'|'nf_xml'|'nf_pdf'|'other', provider: 'gdrive'|'sharepoint'|'upload', external_ref (text), url?, contract_id?, invoice_id?, meta jsonb, source, created_at }`.
- **Nada no core referencia um provider específico** — só `provider + external_ref`. A integração (fase tardia) implementa um adapter `resolve(external_ref) → url/stream`. Espelha o padrão `ContextSource` (memory [[project_context_source_pool]]) e a integração Drive/Notion já existentes.
- **Onde o usuário coloca (UX, 1 slot por entidade):** seção **"Documentos"** no sheet de contrato (proposta · SOW · contrato · planilha de PF) e **"Anexo da NF"** (XML+PDF) no sheet de Emitir NF. Cada slot = **"Enviar arquivo"** (Supabase) **ou** **"Vincular do Drive/SharePoint"**.
- **Os 3 caminhos coexistem (não é ou/ou):** `provider='upload'` → Supabase Storage (bucket privado `finance-documents`); `'gdrive'|'sharepoint'` → só referência (arquivo fica lá, SSOT do cliente, anti-duplicação); `'erp'` → XML da NF vindo do emissor. **Política:** doc com casa oficial (proposta/contrato no Drive) = **vincular** (não copiar); doc sem casa (NF avulsa) = **enviar** pro storage.
- **Faseamento (pós-audit):** `contract_document` + upload = **Slice 4** (deferido — o MVP de NF não precisa de storage; ver §5). Quando vier: começa por **upload Supabase** (zero integração); Drive (Composio, já existe [[project_drive_integration]]) / SharePoint / ERP plugam no mesmo slot sem mudar a tabela.

### P3 — Time planejado × real
- **Planejado** (o agente extrai do contrato/proposta: *senioridade + quantidade*, sem nomes): `finance.contract_planned_role` → `{ contract_id, seniority, count, monthly_cost_cents?, note, source }`.
- **Real** (manual, por nome): `finance.labor_allocation` (já existe) **ganha `contract_id` nullable** → a alocação passa a pertencer a um contrato. **Resolve a sub-decisão do Batch D do épico (FK contract_id = SIM).**
- **Edição centralizada no sheet do contrato** (escopada à vigência): membros, %, período. Sai do form inline do `FinanceProjectSheet` (que escrevia no canvas — violava "canvas=lê"). O hub mostra equipe **read-only** + botão "Editar no contrato →".
- O hub mostra os dois: "planejado: 2 sênior + 1 pleno" vs "alocado: Ana, Bruno…" — gap visível.

### P4 — Aditivos & Overrides (billable × não-billable)
- Generaliza `finance.contract_month_override` (hoje só por mês, só receita) → **`finance.contract_override`** período-based: `{ contract_id, effective_from, effective_to, amount_cents, mode ('replace'|'add'), billable boolean, note, source }`. **Autorado por sprint** (preenche datas, padrão D2 do épico), faturado por mês.
- **`billable=true`** → entra na receita do período (`v_contract_revenue_month` soma fee + overrides billable ativos no mês). **`billable=false`** → só registra (aditivo de pessoas interno / custo), **NÃO** fatura. Vocabulário `billable`/`non_billable` **reusado** de `project_category` (já existe no repo).
- Edição **no sheet do contrato** (junto com termos/cláusulas/docs/equipe) — superfície única.
- **⚠️ Decisão (Slice 2):** migrar o `contract_month_override` (em prod, alimenta a view) → `contract_override` (1 conceito só, **recomendado**) com swap atômico DB+código — ver RB1 §3.

---

## 3. Modelo de dados (rascunho — confirmar §6)

Sobre o que já existe (`finance.contract` com `total_value_cents`/`price_per_fp_cents` GENERATED, `contract_month_override`, views de receita):

```
finance.contract  (estende)
  + warranty           text            -- garantia (P1: agent-fill)
  + proposal_ref       text            -- vínculo à proposta (doc em contract_document)
  + provenance         jsonb not null default '{}'  -- P1

finance.contract_clause            -- cláusulas (1-N; agent-fill + manual)
  id · contract_id · kind (text: 'sla'|'penalty'|'ip'|'confidentiality'|'readjust'|'other')
  · text · source · sort

finance.invoice                    -- NF por mês (cobrança/caixa; NÃO reconhece receita — Q4) — Slice 1
  id · contract_id · competence_month (date, dia 1)
  · amount_cents (= valor BRUTO da NF) · received_net_cents? (líquido na conta, p/ retenção)
  · number text? · status ('pending'|'issued'|'received'|'cancelled')
        -- issued=NF emitida (aguarda pgto) · received=pago · cancelled=NF cancelada
  · issued_at date? · received_at date? · due_at date?   -- due_at habilita aging/vencido
  · condition_kind ('pf_sheet'|'sow'|'none') · condition_met bool   -- por MÊS (Q3)
  · created_by uuid? → Member · provenance jsonb · created_at · updated_at
  -- 1-N por mês, SEM unique (Q1). amount = BRUTO; impostos da NF descritivos (DRE modela à parte, deliberadamente NÃO reconciliado — ver D9).
  -- Encomenda (fixed_scope): amount manual; "total" do rollup vem de contract.total_value_cents (invoice↔fp_delivery NÃO ligados; receita segue v_fp_delivery_month).
  -- 'cancelled' fica FORA dos rollups billed/received (RB2 §2.5).

finance.contract_document          -- P2 (anexos) — Slice 4 (DEFERIDO; MVP de NF não precisa de storage)
  id · kind · provider · external_ref · url? · full_text? (cache p/ o agente B6 ler) · contract_id? · invoice_id? · meta jsonb · source
  -- REUSA a máquina do ContextSource (extractTextFromBuffer + adapter Drive), NÃO a tabela (RLS difere: finance=admin × ContextSource=can_view_project).

finance.contract_planned_role      -- P3 (time planejado) — Slice 4 (DEFERIDO até o agente B6 existir)
  id · contract_id · seniority (enum junior|mid|senior|principal — espelha lib/capacity.ts) · count · monthly_cost_cents? · note · source

finance.labor_allocation  (estende) -- P3: alocação real ganha dono de contrato — Slice 1
  + contract_id  uuid null → fk contract   -- editável no sheet do contrato (resolve Batch D do épico)

finance.contract_override          -- P4 (generaliza contract_month_override) — Slice 2 (fase ARRISCADA, gated)
  id · contract_id · effective_from · effective_to · amount_cents
  · mode ('replace'|'add') · billable bool · note · source
  -- billable→receita (replace substitui o fee do mês; add soma). Composição: conta no mês que a vigência INTERSECTA;
  --   autoria por sprint faz SNAP das datas pra fronteira de mês (grão = mês, igual à view) — sem pró-rata ambíguo.
  -- EXCLUDE parcial: bloqueia 2 'replace' billable sobrepostos no mesmo contrato (somariam em silêncio); 'add' pode sobrepor.
```

- **RLS:** valores/NF/anexos = admin (espelha D8). Período/cláusulas legíveis por quem vê o projeto = **Slice 3** (`v_contract_period` com `can_view_project OR is_admin`), **GATED no Q3**; até lá **tudo admin-only** (`is_admin()` em toda tabela nova, inclusive `contract_clause`).
- **Receita ↔ invoice (Q4 confirmado):** `invoice` é **só** estado operacional (emissão/recebimento); a *receita reconhecida* segue as views atuais (`v_contract_revenue_month` etc.) — não reescreve o motor de receita.
- **Migrations atômicas, uma por arquivo**, via `psql` (regra do repo); atualizar `src/lib/finance/types.ts` em paralelo.

---

## 4. Superfície de escrita = futura toolbelt do agente

Todo endpoint de escrita nasce **limpo o suficiente pra virar tool de agente** (padrão `ToolDescriptor`, ver [[project_daemon_tool_advertisement]]). Implicações:
- Writes **idempotentes** e validados server-side (Zod em `src/app/api/finance/**`).
- Toda escrita **seta procedência**: API normal → `source='manual'`; chamada do agente → `source='agent'` + `runId`/`confidence` (header ou campo).
- Endpoints novos: `POST/PATCH /api/finance/invoice`, `/api/finance/contract-document`, `/api/finance/contract-clause`, `/api/finance/planned-role` — todos admin, todos provenance-aware.
- **Não** construir o agente agora; só garantir que o contrato de dados não o impeça. (O agente coletor entra como fase própria.)
- **⚠️ Auth do agente (resolver antes do B6):** o router genérico de tools (`/api/agents/tools/[toolName]`) roda como `service_role` (bypassa RLS) e **sem** checagem de admin. Finance é admin-only → tool de finance **ou** roteia pelas `/api/finance/*` (preserva o gate) **ou** checa `is_admin()`/actor-admin dentro do `execute()` antes de qualquer escrita. **Não** herdar o padrão sem-auth das tools de leitura do Alpha. Procedência `source='agent'`+`runId` setada server-side. (Reconcilia a contradição do RB3 §0×§3.3.)
- **Criação de `invoice` é humana (não do agente):** sem `UNIQUE` (Q1) + POST agent-callable = risco de NF duplicada (sem chave natural pra dedup). Agente preenche termos/cláusulas/planned-role; **emissão de NF fica no sheet humano**.

---

## 5. Faseamento (re-sequenciado por valor/risco — audit 2026-06-22)

Não é B1→B7 monolítico (o audit mostrou que isso enterra o slice de maior ROI dentro de um schema gigante + carrega generalidade especulativa no caminho crítico). Ordena-se por **valor/esforço**, com o maior ROI primeiro e a generalização arriscada adiada até ter consumidor real.

### Slice 1 — MVP: rastreio de NF + ganhos baratos (ROI #1, risco baixo)
O ouro: **"emitiu NF? recebeu?" por mês não existe hoje** (motivação declarada). Zero dependência de view (Q4).
- Schema: `contract` +meta (warranty/proposal_ref/provenance) · `contract_clause` · `labor_allocation` +contract_id (ROI #2: 1 ALTER, sem backfill, resolve Batch D) · `invoice` (rica — ver §3). **Sem** override-gen, **sem** `contract_document`, **sem** `planned_role`.
- UI: hub no canvas (read) + widget Notas Fiscais + sheet Emitir NF + sheet de contrato rico (cláusulas, garantia, equipe editável). Aditivos squad seguem no `contract_month_override` atual (sem billable ainda).
- **provenance gravada desde já** em toda escrita manual (`source='manual'`) — não dá pra backfillar depois.
- → RB1 (fases MVP) + RB2 (fases MVP).

### Slice 2 — Aditivos billable + HITz (a fase ARRISCADA — só quando um aditivo real pedir)
Gatilho: o builder adicional do HITz (+R$24.632) ou o 3º-mês part-time. **Inclui `mode='add'`** (modela o aditivo aditivo limpo); o que se adia de fato é o caminho `billable=false`.
- `contract_month_override` → `contract_override` (período + billable + mode): **recria a cadeia de views de receita** com dry-run **(baseline HITz real R$345k + seed sintético, ver §3)**, **EXCLUDE-replace**, e **migra os 5 consumidores no MESMO commit** (ou via view compat) — ver RB1 fase tardia.
- **Depois (ordem fixa):** backfill HITz como 1 transação (delete entry recorrente → set fee → insert override 3º-mês → COMMIT) + **view de auditoria multi-fonte** anti-double-count (o único guard estrutural).
- → RB1 fase tardia.

### Slice 3 — Segurança: período legível por quem vê o projeto (= Batch B do épico — GATED)
Não pode sumir silenciosamente (o audit pegou isso). Ou se constrói, ou se declara fora de escopo explicitamente.
- `v_contract_period` (`can_view_project OR is_admin`) + seção de contratos no tab do projeto + **prova guest-barrada**. **Precisa do Q3 do épico (quem edita o período).**
- → RB2 (fase Batch B).

### Slice 4 — Automação
- B5 selos de procedência (sticky) · B6 agente coletor (constrói `planned_role` + `contract_document` **reusando a máquina do ContextSource** — extração+adapter) · B4 deep-link cronograma · B7 storage Drive/SharePoint/ERP.
- → RB3.

**Fase 1 ≥ atual:** o que carrega o "≥" é o **rastreio de NF** (Slice 1). ⚠️ **Não aposentar `FinanceFpBilling`** (log de entregas = receita fixed_scope, Q4) ao migrar — só portar.

**Runbooks:** [RB1 schema](../../runbooks/finance-contract-billing-rb1-schema.md) · [RB2 superfície](../../runbooks/finance-contract-billing-rb2-surface.md) · [RB3 automação](../../runbooks/finance-contract-billing-rb3-automation.md). Slice 1 = RB1+RB2 (fases MVP) · Slice 2 = RB1 fase tardia · Slice 3 = RB2 Batch B · Slice 4 = RB3. Cada fase tem gate; commit a cada 2–3 fases.

---

## 6. Decisões (resolvidas pelo dono 2026-06-22)

- **Q1 — NF por mês = N** (entidade `invoice` livre, **sem** `UNIQUE`). Dono sem preferência → escolha de menor risco: N representa o caso comum (1/mês) E parcial+complemento, custo zero; travar em 1 custaria migration se errado.
- **Q2 — 4 estados** (3 do fluxo feliz + cancelamento): `pending` → `issued` (**NF emitida**, aguarda pgto) → `received` (**Recebido**) · + `cancelled` (NF cancelada, fora dos rollups). Carta-de-correção/substituta é não-objetivo da Fase 1, mas o status `cancelled` já existe. Copy: **"NF emitida", nunca "Faturado"**.
- **Q3 — Condição por MÊS:** `condition_kind`/`condition_met` vivem na `invoice` (cada NF mensal tem seu gate), squad inclusive. Sem propagação contrato→meses.
- **Q4 — `invoice` = SÓ cobrança/caixa; NÃO reconhece receita.** A receita da DRE segue das views atuais (termos do contrato); invoice é camada operacional (emitiu? recebeu?). Competência ≠ caixa → não acopla o P&L a um checkbox. **Não bloqueia a Slice 1** (a tabela é igual; Q4 só decide se as views leem invoice — e a resposta é não).

### Mapa de nomes (anti-colisão — confirmado 2026-06-22)
- **"Faturamento" (categoria)** = bucket do ledger (`finance.category`, lançamentos `entry`) — fica como está, no `FinanceCategorySheet`.
- **"Faturamento" (linha da DRE)** = **receita reconhecida** (top-line do P&L). Mesmo nome, conceito ≠ da categoria.
- **"Faturado" (status da NF)** = **NF emitida, aguardando pgto**. Como Q4 desacopla NF da receita, um mês pode estar "Faturado" com "Faturamento" (receita) diferente. **Copy: usar "NF emitida", NUNCA "Faturado", na UI** — senão é a 3ª colisão do mesmo radical na mesma tela.
- **"Notas Fiscais"** = o **widget novo** (NF/recebimento por mês/contrato). Renomeado de "Faturamento & NF".
- **Receita** = derivada (views), conceito do P&L.
- O entry recorrente de receita squad (ex.: HITz R$ 86.366) é **legado** → vira one-off / removido quando o contrato assume a receita (D3 do épico; item da fila HITz).

### Não-objetivos (Fase 1) + D9
- **D9 — competência ≠ caixa (decisão numerada, imutável):** a `invoice` (NF/recebimento) **nunca** reconcilia a receita da DRE. Duas verdades deliberadas: receita por competência (views/termos do contrato) × caixa por NF emitida/recebida. Idem impostos: NF descritiva × DRE modelada (Assumptions) — **não reconciliados de propósito**.
- **Cancelamento/correção de NF:** o enum tem `cancelled`, mas carta-de-correção / NF substituta (`replaced_by`) fica **fora da Fase 1** (não-objetivo explícito, não esquecimento).
- **Numeração fiscal:** `number` é manual/livre no MVP (sem série/regra fiscal automática).
- **Multi-moeda:** só BRL.

---

## 7. Referências
- Épico: [contract-ssot-handoff.md](contract-ssot-handoff.md) · plano original [finance-app-plan.md](finance-app-plan.md) · [pricing-pnl-model.md](pricing-pnl-model.md)
- Mocks: [mockups/contract-canvas-sandbox.html](mockups/contract-canvas-sandbox.html) · [mockups/contract-ux-sandbox.html](mockups/contract-ux-sandbox.html)
- Código: `src/components/apps/finance/*` · `src/lib/finance/{types,dal}.ts` · `src/components/apps/app-desktop.tsx` · `src/app/api/finance/*`
- Padrões: `ContextSource` (Drive/Notion) p/ P2 · `ToolDescriptor` p/ §4 · `ResponsiveSheet` p/ sheets
- Memórias: [[project_finance_app]] · [[project_context_source_pool]] · [[project_daemon_tool_advertisement]] · [[project_drive_integration]] · [[feedback_grounded_no_hallucination]]
