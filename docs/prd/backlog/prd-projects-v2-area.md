# PRD — Projects V2 Area (admin-only board, Spec→PRD tree, merged PRD sheet)

> **Feature:** `projects-v2-area` · **id prefix:** `PV2A` · **Owner:** João (admin pilot) · **Created:** 2026-06-04
> **Depends on:** `projects-v2-schema` (consome as colunas `deliveryStatus`, `sprintId`, `userStoryId`, `estimateFp` + tabela `ProductRequirementAssignee`).
>
> Implementa a **área Projects V2 admin-only**: o clone da rota, o board Spec→PRD, e o side sheet de PRD mesclado. Cobre §1, §3, §9, e o lado de **display** de §4 (delivery status) e §7.2 (card de Spec colapsável) do plano [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md). **Não** roda a Forge nem faz planning — board é **view + Copy**; o botão *Enviar pra Forge* é um STUB desabilitado aqui (a fiação real vive em `projects-v2-forge-unlock`).

---

## §1 — Problema

Três problemas concretos, com fonte:

1. **Não há onde "ver" PRDs como unidade de trabalho.** Hoje o board do projeto (`src/app/(dashboard)/projects/[id]/page.tsx`) só renderiza `Task`. O `ProductRequirement` (entidade rica, Forge-able, com `specMarkdown` + `stories[]`) existe ([product-requirements.ts](../../../src/lib/dal/product-requirements.ts)) mas **só é visível dentro da Design Session que o gerou** — não há superfície project-scoped pra navegar os PRDs aprovados de um projeto. Plano §1, §3.3 ("PRD board/delivery status ❌ new").
2. **Spec→PRD não tem representação visual.** O plano fixa a árvore **Spec (`UserStory`) → PRD (`ProductRequirement`)** (D2/D14), mas nenhum componente agrupa PRDs por Spec. O board de Story atual (`stories-list.tsx`) agrupa Story por Módulo — o agrupamento PRD-por-Spec ainda não existe (plano §3.2, "PRD tree collapsible Spec card ❌ new").
3. **O conteúdo do PRD e os controles de delivery vivem separados.** Pra ver `specMarkdown`/`stories[]` o usuário usa a tela de Vitor; pra mexer em status/assignee/sprint ele usaria o `TaskSheet`. O plano §9 pede **um único side sheet mesclado** (`task-sheet.tsx` affordances + PRD viewer), que ainda não existe.

---

## §2 — Solução em uma frase

Uma área `projects-v2/` admin-gated que clona o board de projeto trocando os dados de `Task` por `ProductRequirement` agrupados por Spec (`UserStory`), com um side sheet mesclado que mostra `specMarkdown`/`stories[]` + controles de delivery (status/assignees/sprint) e um botão **Copiar** funcional (clipboard do `specMarkdown`) ao lado de um **Enviar pra Forge** desabilitado.

---

## §3 — Não-objetivos

Fica **de fora** deste PRD (vive em outras features):

- **Rodar a Forge / `createForgeRunFromProject`** — o botão *Enviar pra Forge* é STUB desabilitado. (→ `projects-v2-forge-unlock`)
- **Auto-transição de delivery status** (Forge `done` → `review`) e a coluna kanban Review/Production. (→ `projects-v2-forge-unlock`, plano §4.2 / §5)
- **Planning re-point** (Sprint Planning escrever `sprintId`, capacity math de PRD). (→ Fase 3 do plano, §6)
- **Autoria de PRD** (Vitor `propose_spec`, Vitoria `ensure_sprint_prd_session`, botão `+ New PRD`). (→ Fase 4 do plano, §7)
- **Qualquer mudança de schema** — todas as colunas consumidas chegam de `projects-v2-schema`.
- **Escrita de delivery status via API nova** — a edição de delivery status no sheet usa `updatePrd` (DAL existente) via uma rota PATCH fina; não há máquina de estado nova.

---

## §4 — Personas e jornada

- **Admin/PM piloto (João).** *"Quero abrir `projects-v2/`, ver os PRDs do projeto agrupados pelas Specs que o Vitor criou, abrir um PRD, ler o spec inteiro, copiar pra rodar no Claude Code na mão, e marcar onde ele está no delivery — tudo numa tela só, sem trocar de aba."*
- **Não-admin (builder/manager comum).** *"Se eu tentar a URL `projects-v2/<id>` eu sou redirecionado — essa área é piloto admin-only e não quero quebrar nada no fluxo de produção."*
- **Sistema.** *"A área lê PRDs project-scoped via DAL (`getPrdsForProject`) e os agrupa por `userStoryId`; PRDs sem Spec caem num grupo 'Sem Spec'."*

---

## §5 — Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | A área vive em `src/app/(dashboard)/projects-v2/` (`page.tsx` lista + `[id]/page.tsx` detalhe), **admin-gated no server entry**: `[id]/page.tsx` é Server Component que chama `getEffectiveAccessLevel()` ([src/lib/dal.ts](../../../src/lib/dal.ts)) e `redirect("/projects")` se `!hasMinAccessLevel(level,"admin")`. | Piloto isolado, zero risco a prod (plano D1). Gate no server entry impede até o flash de conteúdo. |
| D2 | A lista `projects-v2/page.tsx` também é admin-gated server-side; renderiza os mesmos `Project` da lista atual, mas linka pra `projects-v2/[id]`. | Ponto de entrada coerente; reusa a query de `Project` existente. |
| D3 | O detalhe é um Client Component (`projects-v2-board.tsx`) montado pelo Server Component após o gate, recebendo `projectId` + `projectName`. | Mantém o gate no server e o estado interativo (sheet, collapse) no client, espelhando o split do layout `(dashboard)`. |
| D4 | Dados do board = `ProductRequirement` via `getPrdsForProject(projectId)` (DAL existente, já filtra `dismissedAt`), carregados por um hook novo `_hooks/use-prds-by-spec.ts`. **Nenhuma** query de `Task`. | Plano §9 ("swap the data hooks"); reusa DAL pronto. |
| D5 | Agrupamento: PRDs por `userStoryId` (Spec). Specs vêm de `UserStory` do projeto; PRDs sem `userStoryId` caem num grupo sintético **"Sem Spec"** sempre por último. | Plano D14 ("collapsible card per Spec"); grupo sintético cobre PRDs legados sem Spec (`userStoryId` nullable, schema D1). |
| D6 | A árvore é o **componente compartilhado** `src/components/prd/spec-prd-tree.tsx` (novo, **não** em `projects-v2/`): agrupa PRDs por `userStoryId`, card de Spec colapsável (`useState collapsed`, default expandido), bucket "Sem Spec" por último. É **parametrizado** — props `renderRowActions?(prd)` e `renderBadge?(prd)` + `onOpenPrd?` + `statusRegistry` — pra servir os **três** surfaces V2 (board aqui, tela de autoria do Vitor, Sprint Planning) **sem duplicar a árvore**. Derivado de `stories-list.tsx`. | Plano §9 ("one shared `SpecPrdTree`"); regra AGENTS.md "reuse first" — construído uma vez, consumido três. |
| D7 | Delivery status é exibido/editado via `StatusChipSelect` ([src/components/ui/status-chip-select.tsx](../../../src/components/ui/status-chip-select.tsx)) usando um registry novo **`DELIVERY_STATUS`** adicionado em [src/lib/status-chips.ts](../../../src/lib/status-chips.ts) com o conjunto exato do schema (`backlog,todo,in_progress,review,changes_requested,done,in_production`). | `TASK_STATUS` não tem `changes_requested`/`in_production`; o registry novo cobre o vocabulário de delivery do plano §4.2 sem tocar `TASK_STATUS`. |
| D8 | O side sheet (`prd-sheet.tsx`, novo) é **mesclado**: header com reference + `StatusChipSelect` de delivery + Spec pai; body com viewer de `specMarkdown` (via `Markdown` de [src/components/ui/markdown.tsx](../../../src/components/ui/markdown.tsx)) + lista de `stories[]` + controles (assignees, sprint, notes); footer com action row. Usa `ResponsiveSheet` size=`lg`. | Plano §9 ("merge the two side sheets into one PRD sheet"); reusa primitivos canônicos (regra AGENTS.md UI patterns). |
| D9 | Action row do sheet: **Copiar** (escreve `specMarkdown` no clipboard via `navigator.clipboard.writeText`, toast de sucesso via Sonner) + **Enviar pra Forge** `disabled` com `title="Disponível em breve (projects-v2-forge-unlock)"`. | Plano D6/§9; Copy é a única ação real nesta feature; Forge é STUB explícito. |
| D10 | Escrita de delivery status / assignees / sprint usa `updatePrd` ([product-requirements.ts](../../../src/lib/dal/product-requirements.ts)) através de uma rota fina `PATCH /api/projects-v2/prds/[prdId]` (valida Zod, só campos `deliveryStatus`/`sprintId`/`assignees`/`notes`). Mutação client via `useOptimisticCollection`. | Plano §3 ("consumption is project-based"); reusa DAL+optimistic, valida só no `/api` (regra AGENTS.md). |
| D11 | Assignees são editados por um picker simples (lista de `Member` do projeto) que persiste em `ProductRequirementAssignee` via a rota PATCH (DAL faz delete+insert do set). | Plano §3.3 (PRD assignees, schema D9 join table); set replace é idempotente. |
| D12 | Nenhuma capability de Forge/planning é importada aqui; o módulo `projects-v2/` não referencia `createForgeRunFromSession`/`createForgeRunFromProject`. | Mantém a fronteira de fase limpa (§3 não-objetivos). |

Nenhuma decisão em aberto. Estas decisões ficam imutáveis pós-Rito 1.

---

## §6 — Arquitetura

```
                        projects-v2/page.tsx  (Server · admin gate)
                                  │  redirect("/projects") se !admin
                                  ▼
                        projects-v2/[id]/page.tsx  (Server · admin gate)
                                  │  passa projectId/projectName
                                  ▼
            ┌────────────  projects-v2-board.tsx  (Client) ────────────┐
            │                                                          │
   use-prds-by-spec.ts (hook)                              prd-sheet.tsx (Client)
   getPrdsForProject(projectId) ──► PRDs                   ├─ header: ref + StatusChipSelect(DELIVERY_STATUS)
   UserStory[] ─────────────────► Specs                    ├─ body: Markdown(specMarkdown) + stories[] list
            │  group by userStoryId                        │         + assignees picker + sprint + notes
            ▼                                               └─ footer: [ Copiar ] [ Enviar pra Forge (stub) ]
   prd/spec-prd-tree.tsx (Client · COMPARTILHADO)                                          │
   ├─ SpecCard (collapsible)  ◄── click PRD ──────────────────────────┘  abre sheet
   │   ├─ PrdRow  ──► onOpenPrd(prdId)      (área V2: linha abre o sheet)
   │   └─ PrdRow
   └─ SpecCard "Sem Spec"
   (mesmo componente serve a autoria do Vitor via renderBadge e o planning via renderRowActions)

   Escrita:  prd-sheet → PATCH /api/projects-v2/prds/[prdId] → updatePrd() (DAL)
   Leitura:  hook → getPrdsForProject() / UserStory select (DAL/supabase)
```

Cada caixa é arquivo/função real: `getPrdsForProject` ([product-requirements.ts](../../../src/lib/dal/product-requirements.ts)), `getEffectiveAccessLevel`/`hasMinAccessLevel` ([dal.ts](../../../src/lib/dal.ts)/[roles.ts](../../../src/lib/roles.ts)), `StatusChipSelect`, `Markdown`, `ResponsiveSheet`, `useOptimisticCollection`.

---

## §7 — Schema

**Sem mudança de schema — consome colunas de `prd-projects-v2-schema`** (`deliveryStatus`, `sprintId`, `userStoryId`, `estimateFp`, `ProductRequirementAssignee`).

A única adição de código não-UI é um **registry de chips** `DELIVERY_STATUS` em [src/lib/status-chips.ts](../../../src/lib/status-chips.ts) (display-only, não toca o banco):

```ts
export const DELIVERY_STATUS = defineRegistry({
  backlog:            { label: "Backlog",            tone: "muted"  },
  todo:               { label: "To Do",              tone: "blue"   },
  in_progress:        { label: "In Progress",        tone: "amber"  },
  review:             { label: "Review",             tone: "purple" },
  changes_requested:  { label: "Changes Requested",  tone: "red"    },
  done:               { label: "Done",               tone: "green"  },
  in_production:      { label: "In Production",       tone: "teal"   },
});
```

O conjunto espelha o CHECK de `deliveryStatus` definido em `projects-v2-schema` (D3). Se a área rodar antes do schema, as leituras de `deliveryStatus` retornam o default `'backlog'` — o board ainda renderiza.

---

## §8 — APIs

Quase tudo é **leitura via DAL/supabase** (Server Component + hook client). Uma rota fina nova pra escrita.

| Método/Path | Contrato | Origem |
|-------------|----------|--------|
| (DAL) `getPrdsForProject(projectId)` | retorna `ProductRequirementRow[]` (filtra `dismissedAt`) | existente ([product-requirements.ts](../../../src/lib/dal/product-requirements.ts)) |
| (DAL) `getEffectiveAccessLevel()` | `AccessLevel` do usuário corrente | existente ([dal.ts](../../../src/lib/dal.ts)) |
| (supabase) `from("UserStory").select(...).eq("projectId", id)` | Specs do projeto (id, title, persona…) | leitura client no hook |
| (supabase) `from("Member")` / `from("Sprint")` | membros + sprints do projeto pro picker | leitura client |
| **`PATCH /api/projects-v2/prds/[prdId]`** *(novo)* | body Zod `{ deliveryStatus?, sprintId?, assignees?: string[], notes? }`; admin-gate; chama `updatePrd` + sync `ProductRequirementAssignee`; retorna `{ prd }` 200, 403 se não-admin, 400 se Zod falha | novo |

Nenhum endpoint envolve LLM/job — todas as respostas são síncronas (< 1s). O *Enviar pra Forge* não tem endpoint nesta feature (STUB).

---

## §9 — UX

### Board (detalhe `projects-v2/[id]`)

```
┌─ Projects V2 · <Project name>  [admin pilot]            ◄ Voltar ──┐
│                                                                    │
│  ▼ Spec: Autenticação de prestador            3 PRDs   �+ (stub)   │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ PRJ-PRD-001  Login por magic link   [In Progress▾] ⦿⦿    │──►│ click → sheet
│    │ PRJ-PRD-002  Sessão + refresh        [Review▾]      ⦿     │   │
│    │ PRJ-PRD-003  Logout                  [Backlog▾]            │   │
│    └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ▶ Spec: Onboarding                           5 PRDs   (collapsed) │
│                                                                    │
│  ▼ Sem Spec                                   1 PRD                │
│    ┌──────────────────────────────────────────────────────────┐   │
│    │ PRJ-PRD-009  Hotfix billing          [Done▾]              │   │
│    └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### PRD side sheet (mesclado, `ResponsiveSheet` size=lg)

```
┌─ PRJ-PRD-001 · Login por magic link ───────────────────── ✕ ┐
│ Delivery: [In Progress ▾]   Spec: Autenticação de prestador  │
│ Sprint: [Sprint 4 ▾]        Assignees: [⦿ Ana] [⦿ Léo] [+]   │
├──────────────────────────────────────────────────────────────┤
│ ## §1 — Problema                                             │
│ <render Markdown(specMarkdown) … scrollável>                 │
│ ## §16 — Stories                                            │
│  • [verifiable] AUTH-001 …                                   │
│  • [verifiable] AUTH-002 …                                   │
│  ─────────────────────────                                   │
│  Notes: <textarea>                                          │
├──────────────────────────────────────────────────────────────┤
│           [ Copiar ]   [ Enviar pra Forge (disabled) ]       │
└──────────────────────────────────────────────────────────────┘
```

Não-admin que acessa a URL → `redirect("/projects")` antes de qualquer render.

---

## §10 — Integrações

- **`projects-v2-schema`** — fornece as colunas/tabela lidas aqui. Esta feature **não roda** se as colunas não existirem em prod, mas degrada de forma graciosa (default `'backlog'`).
- **`projects-v2-forge-unlock`** — assume o botão *Enviar pra Forge* (hoje STUB) e a auto-transição de status. O contrato do botão (recebe `prd`, hoje `disabled`) é o ponto de extensão.
- **Vitor (autoria)** — produz os `ProductRequirement`/`UserStory` que este board apenas lê. Sem acoplamento de código.
- **Componentes compartilhados** — `StatusChipSelect`, `Markdown`, `ResponsiveSheet`, `useOptimisticCollection`, `ConfirmDialog` (todos `src/components/ui/` + `src/hooks/`). Reuso, não cópia.

---

## §11 — Faseamento

Esta feature é **a Fase 1 do plano §11** ("Schema + read-only V2 board"), na metade de UI (a metade schema é `projects-v2-schema`). Entrega, em ordem:

1. **Gate + rotas** (PV2A-001..002) — área admin-only navegável.
2. **Registry + hook de dados** (PV2A-003..004) — `DELIVERY_STATUS` + PRDs agrupados por Spec.
3. **Árvore compartilhada** (PV2A-005..006) — `PrdRow` + `SpecPrdTree` em `src/components/prd/` (consumido também por `spec-authoring` e `planning`).
4. **Board client** (PV2A-007) — monta a árvore, sprint ribbon opcional reusada.
5. **Side sheet** (PV2A-008..010) — viewer + controles + Copy + Forge stub.
6. **Escrita** (PV2A-011) — rota PATCH + mutação optimistic.
7. **Wire-up final** (PV2A-012) — board ↔ sheet ↔ PATCH, smoke browser.

**Dependência declarada:** consome `deliveryStatus`, `sprintId`, `userStoryId`, `estimateFp`, `ProductRequirementAssignee` de `projects-v2-schema`. As stories de leitura toleram ausência (default), mas a escrita de `deliveryStatus` (PV2A-011) **requer** o CHECK do schema já aplicado em prod.

Fase 1 entrega **mais** que o sistema atual: hoje não há board de PRD nenhum; aqui passa a existir um navegável + copiável.

---

## §12 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Schema não aplicado quando a área roda (colunas ausentes) | Média | Médio | Leituras usam optional chaining + default `'backlog'`; PV2A-011 (escrita de delivery) é a única que exige o schema e tem `dependsOn` lógico via §11. |
| Vazamento de acesso (não-admin vê PRDs) | Baixa | Alto | Gate no **server entry** de ambas as rotas (`redirect` antes de render) + a rota PATCH revalida admin. Smoke browser cobre o redirect. |
| `specMarkdown` nulo/vazio em PRDs legados | Média | Baixo | Viewer cai num empty-state ("PRD sem spec markdown"); Copy fica desabilitado se `specMarkdown` vazio. |
| Drift entre `DELIVERY_STATUS` (chips) e o CHECK do schema | Baixa | Médio | §7 fixa o conjunto idêntico; comentário no registry referencia a migration `20260604c`. |
| Confusão com a área `projects/` antiga | Baixa | Baixo | Título "Projects V2 · admin pilot" + rota separada; nenhuma edição em `projects/`. |

---

## §13 — Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Área admin-only de fato | Query SQL: `SELECT count(*) FROM "ProductRequirement" pr JOIN "Project" p ON p.id=pr."projectId"` confirma que PRDs existem pra renderizar; teste manual de redirect coberto em PV2A-001 (`manual_browser`). |
| Board renderiza ≥1 Spec com PRDs | Verifiable `manual_browser` em PV2A-007/PV2A-012: abrir `projects-v2/<id>` como admin mostra ≥1 SpecCard com PRDs. |
| Copy funciona | `manual_browser` em PV2A-009: clicar **Copiar** e colar reproduz `specMarkdown`; toast de sucesso. |
| Delivery status persiste | SQL: `SELECT "deliveryStatus" FROM "ProductRequirement" WHERE id='<prd>'` reflete a mudança feita no sheet (PV2A-011). |
| Zero regressão de tipo | `npx tsc --noEmit` sai 0 após cada story (verifiable em todas). |
| Forge stub não dispara nada | `manual_browser` em PV2A-010: botão *Enviar pra Forge* está `disabled` e não faz request (Network vazio ao clicar). |

---

## §14 — Open questions

Vazio. Nenhuma decisão bloqueante pendente — autoria, Forge e planning estão explicitamente fora (§3) e cobertos por outras features.

---

## §15 — Referências

- Plano: [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) (§1, §3, §4, §7.2, §9)
- Schema: [docs/prd/backlog/prd-projects-v2-schema.md](./prd-projects-v2-schema.md) + [scripts/ralph/features/projects-v2-schema/prd.json](../../../scripts/ralph/features/projects-v2-schema/prd.json)
- Código a clonar: [src/app/(dashboard)/projects/[id]/page.tsx](../../../src/app/(dashboard)/projects/[id]/page.tsx) · [_hooks/use-tasks-and-sprints.ts](../../../src/app/(dashboard)/projects/[id]/_hooks/use-tasks-and-sprints.ts) · [story-hierarchy/task-sheet.tsx](../../../src/components/story-hierarchy/task-sheet.tsx) · [story-hierarchy/stories-list.tsx](../../../src/components/story-hierarchy/stories-list.tsx)
- DAL: [src/lib/dal/product-requirements.ts](../../../src/lib/dal/product-requirements.ts)
- Gate: [src/lib/roles.ts](../../../src/lib/roles.ts) (`hasMinAccessLevel`) · [src/lib/dal.ts](../../../src/lib/dal.ts) (`getEffectiveAccessLevel`)
- UI: [src/components/ui/status-chip-select.tsx](../../../src/components/ui/status-chip-select.tsx) · [src/components/ui/markdown.tsx](../../../src/components/ui/markdown.tsx) · [src/components/ui/responsive-sheet.tsx](../../../src/components/ui/responsive-sheet.tsx) · [src/lib/status-chips.ts](../../../src/lib/status-chips.ts)
- House style: [docs/prd/ready/prd-opportunities.md](../ready/prd-opportunities.md)

---

## §16 — Stories implementáveis

```yaml
- id: PV2A-001
  title: Rota lista projects-v2 admin-gated
  description: Cria src/app/(dashboard)/projects-v2/page.tsx (Server Component) que chama getEffectiveAccessLevel() e redirect("/projects") se não-admin; senão lista os Project (reusa a query da lista atual) linkando cada card pra /projects-v2/[id].
  acceptanceCriteria:
    - "src/app/(dashboard)/projects-v2/page.tsx existe e é async Server Component"
    - "Chama getEffectiveAccessLevel + hasMinAccessLevel(level,'admin'); redirect('/projects') quando false"
    - "Renderiza lista de Project com links href=/projects-v2/<id>"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "npx eslint 'src/app/(dashboard)/projects-v2/page.tsx'"
      expected: "no errors"
    - kind: manual_browser
      command_or_query: "Logar como NÃO-admin (builder) e abrir /projects-v2 → deve redirecionar pra /projects. Logar como admin → lista de projetos com links pra /projects-v2/<id>."
      expected: "Non-admin redirecionado; admin vê a lista"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/app/(dashboard)/projects-v2/page.tsx"]

- id: PV2A-002
  title: Rota detalhe projects-v2/[id] admin-gated + shell client
  description: Cria src/app/(dashboard)/projects-v2/[id]/page.tsx (Server Component) com mesmo gate admin; busca Project (id, name) e monta o client ProjectsV2Board com projectId/projectName. Cria o stub do client em src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx ("use client") que por enquanto só renderiza o título.
  acceptanceCriteria:
    - "[id]/page.tsx existe, async, com gate admin + redirect('/projects')"
    - "projects-v2-board.tsx existe com 'use client' e recebe { projectId, projectName }"
    - "page.tsx renderiza <ProjectsV2Board .../>"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "npx eslint 'src/app/(dashboard)/projects-v2/[id]/page.tsx' 'src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx'"
      expected: "no errors"
    - kind: manual_browser
      command_or_query: "Como builder, abrir /projects-v2/<id> → redireciona pra /projects. Como admin → vê o título do projeto."
      expected: "Gate redireciona non-admin; admin vê o shell"
  dependsOn: ["PV2A-001"]
  estimateMinutes: 25
  touches:
    - "src/app/(dashboard)/projects-v2/[id]/page.tsx"
    - "src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx"

- id: PV2A-003
  title: Registry DELIVERY_STATUS em status-chips
  description: Adiciona o registry DELIVERY_STATUS em src/lib/status-chips.ts via defineRegistry, com o conjunto exato do schema (backlog,todo,in_progress,review,changes_requested,done,in_production) e tones coerentes. Comentário referencia a migration 20260604c do projects-v2-schema.
  acceptanceCriteria:
    - "src/lib/status-chips.ts exporta DELIVERY_STATUS via defineRegistry"
    - "As 7 keys exatas existem: backlog,todo,in_progress,review,changes_requested,done,in_production"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'backlog|todo|in_progress|review|changes_requested|done|in_production' src/lib/status-chips.ts"
      expected: ">=7"
  dependsOn: []
  estimateMinutes: 10
  touches: ["src/lib/status-chips.ts"]

- id: PV2A-004
  title: Hook use-prds-by-spec (carrega PRDs + Specs, agrupa)
  description: Cria src/app/(dashboard)/projects-v2/[id]/_hooks/use-prds-by-spec.ts que carrega ProductRequirement do projeto (via supabase client, espelhando getPrdsForProject — eq projectId, is dismissedAt null) + UserStory (Specs) do projeto, e expõe { prds, specs, prdMutate, reload }. O agrupamento por Spec vive no SpecPrdTree (PV2A-006), não no hook. Usa useOptimisticCollection pra os PRDs.
  acceptanceCriteria:
    - "Arquivo existe e exporta usePrdsBySpec(projectId)"
    - "Expõe prds + specs (UserStory do projeto) + prdMutate + reload"
    - "Usa useOptimisticCollection (não setState após fetch dos PRDs)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -c 'useOptimisticCollection' 'src/app/(dashboard)/projects-v2/[id]/_hooks/use-prds-by-spec.ts'"
      expected: ">=1"
  dependsOn: ["PV2A-002"]
  estimateMinutes: 30
  touches: ["src/app/(dashboard)/projects-v2/[id]/_hooks/use-prds-by-spec.ts"]

- id: PV2A-005
  title: PrdRow (linha de PRD reutilizável, em src/components/prd/)
  description: Cria src/components/prd/prd-row.tsx — linha de PRD reutilizável (derivada de story-row em stories-list.tsx) mostrando reference, title (truncado) e um StatusChip vindo de um statusRegistry passado por prop (DELIVERY_STATUS na área V2). Slots opcionais renderBadge(prd) e renderRowActions(prd); onOpenPrd(prdId) ao clicar a linha. NÃO vive em projects-v2/ — é primitivo compartilhado.
  acceptanceCriteria:
    - "Arquivo src/components/prd/prd-row.tsx existe; recebe { prd, statusRegistry, onOpenPrd?, renderBadge?, renderRowActions? }"
    - "Renderiza reference + title + StatusChip(statusRegistry)"
    - "onClick dispara onOpenPrd(prd.id); renderBadge/renderRowActions renderizam quando passados"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'renderBadge|renderRowActions|statusRegistry' src/components/prd/prd-row.tsx"
      expected: ">=2"
  dependsOn: ["PV2A-003"]
  estimateMinutes: 20
  touches: ["src/components/prd/prd-row.tsx"]

- id: PV2A-006
  title: SpecPrdTree compartilhado (grouping + Spec card colapsável)
  description: >
    Cria src/components/prd/spec-prd-tree.tsx — o componente de árvore COMPARTILHADO pelos três
    surfaces V2. Recebe { prds, specs, statusRegistry, onOpenPrd?, renderBadge?, renderRowActions? },
    agrupa PRDs por userStoryId INTERNAMENTE (grouping vive aqui, não nos consumidores), renderiza um
    SpecCard colapsável (useState collapsed, default aberto, chevron, contagem de PRDs) por Spec e um
    bucket "Sem Spec" por último, com PrdRow em cada linha. Sem acoplamento a delivery/autoria/planning —
    o que varia entra por renderBadge/renderRowActions/statusRegistry.
  acceptanceCriteria:
    - "src/components/prd/spec-prd-tree.tsx existe exportando SpecPrdTree"
    - "Agrupa PRDs por userStoryId internamente; expõe renderBadge/renderRowActions/statusRegistry/onOpenPrd"
    - "SpecCard colapsável (chevron, default expandido) com contagem de PRDs; bucket 'Sem Spec' por último"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'collapsed|Sem Spec|userStoryId' src/components/prd/spec-prd-tree.tsx"
      expected: ">=2"
    - kind: manual_browser
      command_or_query: "Não aplicável isolado — validado em PV2A-007. Confirmar que compila e exporta SpecPrdTree."
      expected: "Componente exporta SpecPrdTree"
  dependsOn: ["PV2A-005"]
  estimateMinutes: 30
  touches: ["src/components/prd/spec-prd-tree.tsx"]

- id: PV2A-007
  title: Montar SpecPrdTree no ProjectsV2Board
  description: Edita projects-v2-board.tsx pra usar usePrdsBySpec(projectId), montar <SpecPrdTree prds={prds} specs={specs} statusRegistry={DELIVERY_STATUS} onOpenPrd={...}/> (do componente compartilhado src/components/prd/) e guardar selectedPrdId em useState (sheet montado em PV2A-010). Header "Projects V2 · <name> · admin pilot".
  acceptanceCriteria:
    - "projects-v2-board.tsx chama usePrdsBySpec e renderiza SpecPrdTree (de src/components/prd/)"
    - "Passa statusRegistry=DELIVERY_STATUS + onOpenPrd; selectedPrdId em useState"
    - "Header mostra o nome do projeto + rótulo de piloto admin"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'SpecPrdTree|usePrdsBySpec' 'src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx'"
      expected: ">=2"
    - kind: manual_browser
      command_or_query: "Como admin, abrir /projects-v2/<id> de um projeto com PRDs → board mostra ≥1 SpecCard colapsável com PrdCards dentro; toggle do chevron colapsa/expande."
      expected: "Board renderiza a árvore Spec→PRD; collapse funciona"
  dependsOn: ["PV2A-004", "PV2A-006"]
  estimateMinutes: 25
  touches: ["src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx"]

- id: PV2A-008
  title: PrdSheet shell (ResponsiveSheet + header)
  description: Cria src/components/projects-v2/prd-sheet.tsx usando ResponsiveSheet size=lg. Header com reference + title + StatusChipSelect(DELIVERY_STATUS) (onChange chama prop onChangeDeliveryStatus) + nome do Spec pai + Sprint select. Recebe { prd, spec, sprints, members, onClose, onChange* } props. Sem body de markdown ainda.
  acceptanceCriteria:
    - "prd-sheet.tsx existe usando ResponsiveSheet (não Sheet/Dialog nus)"
    - "Header mostra reference + StatusChipSelect com options=DELIVERY_STATUS"
    - "Abre quando prd != null, fecha via onClose"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'ResponsiveSheet|StatusChipSelect|DELIVERY_STATUS' src/components/projects-v2/prd-sheet.tsx"
      expected: ">=3"
  dependsOn: ["PV2A-003"]
  estimateMinutes: 25
  touches: ["src/components/projects-v2/prd-sheet.tsx"]

- id: PV2A-009
  title: PrdSheet body — specMarkdown + stories + Copiar
  description: Adiciona ao prd-sheet.tsx o body que renderiza Markdown(prd.specMarkdown) (empty-state se vazio), lista prd.stories[] (id + title + flag verifiable), textarea de notes, e a action row com botão Copiar (navigator.clipboard.writeText(specMarkdown) + toast Sonner de sucesso, disabled se specMarkdown vazio).
  acceptanceCriteria:
    - "Body renderiza Markdown(specMarkdown) com empty-state quando vazio"
    - "Lista prd.stories[] com id/title"
    - "Botão Copiar escreve specMarkdown no clipboard + toast; disabled se vazio"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'clipboard|Markdown|specMarkdown' src/components/projects-v2/prd-sheet.tsx"
      expected: ">=2"
    - kind: manual_browser
      command_or_query: "Abrir um PRD com specMarkdown no sheet, clicar Copiar, colar num editor → reproduz o specMarkdown; toast de sucesso aparece."
      expected: "Clipboard contém o specMarkdown; toast visível"
  dependsOn: ["PV2A-008"]
  estimateMinutes: 25
  touches: ["src/components/projects-v2/prd-sheet.tsx"]

- id: PV2A-010
  title: PrdSheet action row — Enviar pra Forge (stub) + montagem no board
  description: Adiciona ao prd-sheet.tsx o botão "Enviar pra Forge" disabled com title="Disponível em breve (projects-v2-forge-unlock)". Monta <PrdSheet/> em projects-v2-board.tsx, resolvendo o prd selecionado por selectedPrdId, passando sprints/members carregados pelo hook.
  acceptanceCriteria:
    - "Botão Enviar pra Forge presente e disabled (não dispara request)"
    - "projects-v2-board.tsx monta <PrdSheet prd={selected} onClose=.../>"
    - "Clicar num PrdCard abre o sheet do PRD correto"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'PrdSheet|disabled' 'src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx' src/components/projects-v2/prd-sheet.tsx"
      expected: ">=2"
    - kind: manual_browser
      command_or_query: "No board, clicar num PrdCard → sheet abre com o PRD certo. Botão 'Enviar pra Forge' está cinza/disabled; clicar não faz nada (Network vazio)."
      expected: "Sheet abre; Forge button disabled e inerte"
  dependsOn: ["PV2A-007", "PV2A-009"]
  estimateMinutes: 20
  touches:
    - "src/components/projects-v2/prd-sheet.tsx"
    - "src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx"

- id: PV2A-011
  title: PATCH /api/projects-v2/prds/[prdId] (delivery/assignees/sprint/notes)
  description: Cria src/app/api/projects-v2/prds/[prdId]/route.ts. PATCH admin-gated (getEffectiveAccessLevel → 403 se não-admin), valida Zod { deliveryStatus?, sprintId?, assignees?: string[], notes? } (deliveryStatus restrito ao enum DELIVERY_STATUS), chama updatePrd e sincroniza ProductRequirementAssignee (delete+insert do set). Retorna { prd } 200.
  acceptanceCriteria:
    - "route.ts existe com export PATCH"
    - "Gate admin retorna 403 pra não-admin"
    - "Zod valida deliveryStatus contra o enum; rejeita valor fora do set com 400"
    - "Chama updatePrd + sync de ProductRequirementAssignee"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'updatePrd|z\\.(object|enum|string)' 'src/app/api/projects-v2/prds/[prdId]/route.ts'"
      expected: ">=2"
  dependsOn: ["PV2A-003"]
  estimateMinutes: 30
  touches: ["src/app/api/projects-v2/prds/[prdId]/route.ts"]

- id: PV2A-012
  title: Wire-up escrita — delivery status optimistic + smoke
  description: Conecta o StatusChipSelect/assignees/sprint/notes do PrdSheet à mutação optimistic do hook (prdMutate → PATCH /api/projects-v2/prds/[prdId]) em projects-v2-board.tsx. Erros via showErrorToast. Smoke browser end-to-end.
  acceptanceCriteria:
    - "Mudar deliveryStatus no sheet dispara prdMutate(patch, persist) → PATCH"
    - "Reverte + toast em erro (showErrorToast); não usa setState após fetch"
    - "Mudança persiste após reload"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'prdMutate|showErrorToast' 'src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx'"
      expected: ">=1"
    - kind: manual_browser
      command_or_query: "Como admin: abrir um PRD, trocar Delivery de Backlog→Review, fechar sheet, dar reload → status persistiu (Review). Trocar de novo e ver o chip atualizar otimisticamente."
      expected: "deliveryStatus persiste; update otimista visível"
  dependsOn: ["PV2A-010", "PV2A-011"]
  estimateMinutes: 25
  touches: ["src/app/(dashboard)/projects-v2/[id]/projects-v2-board.tsx"]
```
