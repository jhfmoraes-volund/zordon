# PRD — Projects V2: Spec authoring in Vitor

> **Status:** backlog (Rito 1 não rodou) · **Owner:** João (admin pilot) · **Created:** 2026-06-04
> **id prefix:** `PV2SP` · **Phase:** 1
> **Depends on (cross-feature):** `projects-v2-schema` — fornece `ProductRequirement.userStoryId` (§10 do plano); `projects-v2-area` — fornece o componente compartilhado `src/components/prd/spec-prd-tree.tsx` (PV2A-006), que esta feature **consome** (passando `renderBadge` de sizing). Não recria árvore própria.
> **Source of truth:** [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) — decisões **D10, D14, D15**, seções **§7.2** e **§8**.

---

## §1 — Problema

Três dores concretas, todas rastreáveis ao plano V2 ([projects-v2-plan.md §3.1, §7.1, §8](../../features/projects-v2/projects-v2-plan.md)):

1. **PRDs nascem soltos, sem agrupamento narrativo.** Hoje Vitor cria PRDs (`propose_prd`) ligados só ao projeto/sessão e ao `moduleId`. Não existe a camada **Spec** (pack de PRDs que conta a feature). O plano (§3.1, D2) define a árvore `Spec → PRD` como clone fiel de `Story → Task` — e essa camada **não existe** no fluxo de autoria. Fonte: `src/lib/agent/agents/vitor/index.ts` (tool `propose_prd` não seta `userStoryId`).
2. **A árvore de PRDs é plana.** `prd-briefing-step.tsx` renderiza PRDs como lista linear de `PrdCard` (`PRDs ({prds.length})`), sem o **card colapsável por Spec** que o plano pede (§3.2, §7.2, D14). Em projetos com dezenas/centenas de PRDs (D8: "hundreds per project") a lista plana fica inutilizável.
3. **Sem disciplina de tamanho, PRDs derivam pra os dois extremos.** O plano (§8) quer "1 PRD ≈ 1 PR · 1–4 verifiable · ≤30 min". Hoje não há sinal nenhum (nem soft) que avise o PM quando um PRD ficou grande demais (muitas stories) ou pequeno demais (zero stories de fato). A régua de stories existe no prompt (`prompt.ts` §567+) mas não há **decomposição Spec-first** nem validador advisory.

---

## §2 — Solução em uma frase

Dar ao Vitor uma tool **`propose_spec`** (cria um `UserStory` que funciona como **Spec/pack**), fazer **todo PRD nascer dentro de um Spec** (`propose_prd` seta `ProductRequirement.userStoryId`), renderizar a árvore como **cards de Spec colapsáveis**, relabelar o side sheet de `UserStory` como **Spec side sheet** no contexto V2, e adicionar um **validador SOFT (warn, não bloqueia)** de tamanho de PRD.

---

## §3 — Não-objetivos

- **Não** alterar a elaboração de PRD do Vitor (campos problem/goal/AC/`stories[]` ficam idênticos — D14). O único acréscimo ao contrato de `propose_prd` é o link `userStoryId`.
- **Não** criar/alterar schema de banco. A coluna `ProductRequirement.userStoryId` vem do feature `projects-v2-schema` (§10 do plano).
- **Não** enriquecer o Spec (sem novos campos no `UserStory`; é "thin pack" — D14). Usa-se `title/want/soThat/personaId` que já existem.
- **Não** forkar o componente `story-sheet.tsx` — apenas relabelar via props/strings (reuso, per AGENTS.md "reuse first").
- **Não** tornar o validador de tamanho um **hard-block**. É advisory (§8 do plano: "soft validator", "warn, not hard-block").
- **Não** mexer no fluxo da Forja, status de delivery, kanban, planning rituals ou rota `projects-v2/` (são outras fases/PRDs do plano).
- **Não** tocar Vitoria nem `ensure_sprint_prd_session` (D13 — feature separada).

---

## §4 — Personas e jornada

**PM (João, admin pilot)** — autor de produto que usa o workbench do Vitor:
> "Quando o Vitor cospe 20 PRDs numa discovery, eu quero vê-los agrupados pela feature que contam, não numa lista plana de 20 cards. E quero saber, sem ler código, quando um PRD ficou grande demais pra rodar numa tacada."

**Vitor (agente autor)** — único agente que escreve PRD (D7):
> "Antes de criar PRDs eu já decomponho a feature em fatias PR-sized. Falta uma tool pra registrar o **Spec** (o pack que segura essas fatias) e fazer cada PRD apontar pro seu Spec."

Jornada (Spec-first, D10 / §7.1 do plano):
1. PM pede uma feature ao Vitor no PRD-tree screen.
2. Vitor chama `propose_spec({ title, want, soThat, personaId? })` → cria o pack (um `UserStory`).
3. Vitor chama `propose_prd({ prds: [...], userStoryId: <spec.id> })` → cada PRD nasce **dentro** do Spec.
4. A árvore renderiza **um card colapsável por Spec**, com seus PRDs dentro.
5. PM clica no Spec → abre o **Spec side sheet** (o `story-sheet` relabelado).
6. Se um PRD ficou grande (muitas stories) ou vazio, o card mostra um **aviso advisory** (não bloqueia aprovação).

---

## §5 — Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Spec = `UserStory` **as-is** (relabel, sem schema novo). Cria-se via nova tool `propose_spec`. | D4/D14 do plano: "Spec is a thin pack"; tabela já existe (`20260430_user_story.sql`). |
| D2 | `propose_spec` cria `UserStory` com `refinementStatus='draft'`, `createdByAgent=true`, ligado a `projectId` + `designSessionId` da sessão; campos `title`, `want` (NOT NULL), `soThat?`, `personaId?`, `moduleId?`. | Espelha as colunas reais de `UserStory` (NOT NULL em `title`/`want`). |
| D3 | **Todo PRD nasce dentro de um Spec.** `propose_prd` ganha `userStoryId` (uuid). Se nenhum Spec for passado, Vitor **primeiro** chama `propose_spec` e usa o id retornado. | D14: "always creates PRDs inside a Spec". |
| D4 | A coluna `ProductRequirement.userStoryId` é **consumida**, não criada aqui — vem de `projects-v2-schema`. Este PRD assume a coluna presente (nullable FK → `UserStory`). | §10 do plano (item 1). Migrations atômicas vivem no feature schema. |
| D5 | `userStoryId` em `propose_prd` é **opcional no schema Zod** (back-compat com Inception/super que ainda não passam Spec), mas o **prompt** instrui Vitor a sempre setá-lo (criando Spec antes se preciso). | Não quebrar surfaces existentes; disciplina via prompt, não via hard-fail (AGENTS.md "schema strictness > prompt, mas back-compat primeiro"). |
| D6 | A árvore de PRDs (`prd-briefing-step.tsx`) **consome o `SpecPrdTree` compartilhado** (`src/components/prd/spec-prd-tree.tsx`, de `projects-v2-area`), passando `renderBadge` pro chip de sizing. O agrupamento por `userStoryId` + bucket "Sem Spec" vivem **dentro** do componente — esta feature não reimplementa árvore nem card. | Plano §9 (árvore única); AGENTS.md "reuse first". |
| D7 | O **Spec side sheet** reusa `story-hierarchy/story-sheet.tsx` via uma prop de label (`entityLabel: "Spec" \| "Story"`, default `"Story"`). **Não** forka. | AGENTS.md "reuse first"; D14 "its side sheet becomes the Spec side sheet". |
| D8 | **Validador SOFT de tamanho** vive em `src/lib/agent/agents/vitor/prd-sizing.ts` — função pura `evaluatePrdSizing(prd)` → `{ level: 'ok'\|'warn', reasons: string[] }`. Heurística: `stories.length` em `[1,8]`, soma `estimateMinutes ≤ 240`, cada story `1–4 verifiable` e `≤30 min`. | §8 do plano: "1 PR ≈ 1–4 verifiable, ≤30 min"; advisory. |
| D9 | O validador **não bloqueia** `propose_prd`/`approve_prd`. É surfacado (a) como campo `sizing` no retorno da tool e (b) como badge advisory no `PrdCard`. | §8: "warn, not hard-block". |
| D10 | A **regra de decomposição Spec-first** é encodada nas instruções do Vitor (`prompt.ts`, bloco "Régua de Stories"/novo bloco "Spec-first"): decomponha a feature em PRDs PR-sized **antes** de criar; 1 PRD = 1 PR. | §8 + D10 do plano: "Encode it as a Vitor decomposition rule". |
| D11 | `propose_spec` retorna `{ id, reference, title }`; `propose_prd` retorna, por PRD criado, `{ id, reference, title, status, storiesCount, userStoryId, sizing }`. | Vitor precisa do `spec.id` pra ligar PRDs e do `sizing` pra reportar. |
| D12 | Lineage: `ProductRequirement.userStoryId → UserStory.id` (o Spec) e `UserStory.designSessionId → DesignSession` (a sessão de autoria). Sem `EntityLink` novo. | Reusa colunas existentes (`UserStory.designSessionId`). |

Zero pendências em aberto. Todas as decisões fechadas.

---

## §6 — Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│ Vitor (src/lib/agent/agents/vitor/index.ts → buildTools)            │
│                                                                     │
│   propose_spec(input)  ──► createUserStory(...)  [DAL: story-hier]  │
│        └─ retorna { id, reference, title }                          │
│                                                                     │
│   propose_prd({ prds[], userStoryId? })                             │
│        ├─ se userStoryId ausente → cria Spec via createUserStory    │
│        ├─ createPrd({ ..., userStoryId })   [DAL: product-reqs]     │
│        └─ evaluatePrdSizing(prd)  [lib/.../prd-sizing.ts]           │
│              └─ { level, reasons } anexado ao retorno               │
└─────────────────────────────────────────────────────────────────────┘
            │ persiste                          │ instrui
            ▼                                   ▼
   ProductRequirement.userStoryId      prompt.ts (bloco Spec-first)
   UserStory (= Spec)                  "decomponha PR-sized, 1 Spec/feature"
            │
            │ lê
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PRD-tree screen (prd-briefing-step.tsx)                             │
│   <SpecPrdTree prds specs renderBadge={sizingBadge} .../>           │
│        (componente COMPARTILHADO src/components/prd/ — agrupa,       │
│         colapsa e renderiza linhas; sizing entra por renderBadge)   │
│   clicar Spec  ──► StorySheet entityLabel="Spec"  (relabel only)    │
└─────────────────────────────────────────────────────────────────────┘
```

Cada caixa = função/arquivo real:
- `propose_spec` / `propose_prd` → `src/lib/agent/agents/vitor/index.ts`
- schemas → `src/lib/agent/agents/vitor/prd-schemas.ts`
- `evaluatePrdSizing` → `src/lib/agent/agents/vitor/prd-sizing.ts` (novo)
- `createUserStory` → `src/lib/dal/story-hierarchy.ts` (existente; reuso)
- `createPrd` → `src/lib/dal/product-requirements.ts` (existente; ganha `userStoryId` no insert)
- árvore → `SpecPrdTree` compartilhado (`src/components/prd/spec-prd-tree.tsx`, de `projects-v2-area`), montado em `prd-briefing-step.tsx` com `renderBadge` de sizing — **sem** `spec-card.tsx`/`groupPrdsBySpec` próprios
- relabel → `src/components/story-hierarchy/story-sheet.tsx`

---

## §7 — Schema

**Sem mudança de schema** — consome `userStoryId` de `prd-projects-v2-schema`; Spec = `UserStory` existente.

Detalhe do que é assumido presente (criado pelo feature `projects-v2-schema`, §10 item 1 do plano):

```sql
-- (já aplicado por projects-v2-schema — NÃO recriar aqui; tipo é uuid, ver PV2S-001)
ALTER TABLE public."ProductRequirement"
  ADD COLUMN "userStoryId" uuid
  REFERENCES public."UserStory"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS prd_user_story_idx
  ON public."ProductRequirement"("userStoryId");
```

`UserStory` (a entidade Spec) já existe com RLS e sequencer (`20260430_user_story.sql`): `title`/`want` NOT NULL, `soThat`/`personaId`/`moduleId`/`designSessionId` nullable, `refinementStatus` default `draft`. Nenhuma policy nova: leitura/escrita de PRD e UserStory já são governadas pelas RLS existentes (`can_view_project` / managers).

---

## §8 — APIs (agent tools)

Este PRD adiciona/altera **agent tools** (não rotas HTTP novas — a persistência reusa as DALs já expostas). Contratos:

| Tool | Direção | Input | Output | Mudança |
|------|---------|-------|--------|---------|
| `propose_spec` | **nova** | `{ title: string(3..140), want: string(>=10), soThat?: string, personaId?: uuid, moduleId?: uuid }` | `{ id, reference, title }` | cria `UserStory` (Spec) na sessão atual |
| `propose_prd` | **alterada** | `{ prds: ProposePrdInput[], userStoryId?: uuid }` | `{ created: [{ id, reference, title, status, storiesCount, userStoryId, sizing }] }` | acrescenta `userStoryId` (link Spec) + `sizing` advisory no retorno. Conteúdo do PRD **inalterado** (D14) |

Regras de contrato:
- `propose_prd` sem `userStoryId`: a tool **cria um Spec automaticamente** (via `createUserStory` derivando `title` do 1º PRD) e usa o id. Resultado: nenhum PRD V2 fica sem `userStoryId`.
- `sizing` = `{ level: "ok" \| "warn", reasons: string[] }` (D8/D9). É informativo; não altera `status`.
- `update_prd`/`approve_prd`/`link_prd_dependency`/`list_prds` ficam **inalteradas** (fora de escopo).

Schemas Zod ficam em `prd-schemas.ts`: `ProposeSpecInput` (novo) + `ProposePrdInput` ganha `userStoryId: z.string().uuid().optional()` (a tool injeta no insert).

---

## §9 — UX (árvore de Spec colapsável)

```
┌──────────────────────────────────────────────── PRD tree (esquerda) ──┐
│  Specs (3)                                                            │
│                                                                       │
│  ▼  ACME-US-001 · Checkout one-click          [2 PRDs] [⚠ 1 grande]  │  ← SpecCard aberto
│      ├─ ▸ ACME-PRD-004 · Botão one-click       [draft]   [ok]        │
│      └─ ▸ ACME-PRD-005 · Tokenizar cartão      [draft]   [⚠ 11 sty]  │  ← badge sizing warn
│                                                                       │
│  ▸  ACME-US-002 · Histórico de pedidos         [4 PRDs]              │  ← SpecCard fechado
│                                                                       │
│  ▸  Sem Spec                                    [1 PRD]              │  ← legado/back-compat
└───────────────────────────────────────────────────────────────────────┘

  clicar no header do Spec  → toggle colapso
  clicar no nome do Spec     → abre Spec side sheet:

┌──────────── Spec side sheet (StorySheet, entityLabel="Spec") ─────────┐
│  Spec · ACME-US-001                                            [✕]    │
│  Título:  Checkout one-click                                          │
│  Como:    cliente recorrente                                          │
│  Quero:   finalizar compra em 1 clique                               │
│  Para:    reduzir abandono de carrinho                               │
│  Persona: [Cliente ▾]      Módulo: [Checkout ▾]                       │
└───────────────────────────────────────────────────────────────────────┘
```

Badge advisory (`sizing.level === "warn"`): chip âmbar "⚠ N sty" / "⚠ grande" no `PrdCard` e contagem agregada no `SpecCard`. Nunca impede aprovar.

---

## §10 — Integrações

- **projects-v2-schema** (dep): fornece `ProductRequirement.userStoryId`. Este PRD falha de forma graciosa se a coluna não existir (o insert do `createPrd` só passa `userStoryId` quando definido) — mas a feature só entrega valor com o schema aplicado.
- **Forja:** intocada. PRD continua Forge-able por `status='approved'`; o link Spec é metadado de agrupamento.
- **Inception / super / quick_ask:** todas as três surfaces (D15) herdam o agrupamento de graça — `prd-briefing-step.tsx` é o screen compartilhado.
- **Vitoria / Planning:** fora de escopo (D13 e §6 do plano são outras features). O `userStoryId` que esta feature popula é o que o planning lê depois.
- **`story-hierarchy/story-sheet.tsx`:** ganha prop `entityLabel` opcional; o uso atual (Story tree) não muda (default `"Story"`).

---

## §11 — Faseamento

Tudo é **Phase 1** deste PRD (mapeia pra Phase 4/5 do plano-mãe, mas é a fatia "Spec authoring + sizing"). Ordem interna pelo DAG:

1. **Schemas + sizing puro** (PV2SP-001, PV2SP-002) — base sem efeitos colaterais.
2. **Tools** (`propose_spec`, `propose_prd`+link+sizing) (PV2SP-003, PV2SP-004).
3. **Prompt** (regra Spec-first) (PV2SP-005).
4. **UI** (consome `SpecPrdTree` compartilhado com badge de sizing, relabel + abrir Spec side sheet) (PV2SP-006..008).

Fase 1 entrega **mais** que hoje (autoria plana → autoria agrupada por Spec + sinal de tamanho), nunca menos.

---

## §12 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Coluna `userStoryId` ainda não aplicada (dep não rodou) | Média | Alto | `createPrd` só inclui `userStoryId` no insert quando definido; story PV2SP-004 tem verifiable SQL que cria um Spec+PRD e confere o link — falha cedo e claro se a coluna faltar. |
| Fork acidental do `story-sheet` | Baixa | Médio | D7 fixa "prop de label, sem fork"; verifiable de PV2SP-009 confere que o arquivo do sheet não foi duplicado e que `entityLabel` existe. |
| Validador vira hard-block por engano | Baixa | Médio | D9; `evaluatePrdSizing` é função pura sem throw; teste unitário (PV2SP-002) cobre que `warn` não lança. |
| PRDs legados sem Spec somem da árvore | Média | Médio | D6: grupo "Sem Spec" no topo agrupa `userStoryId == null`; verifiable de PV2SP-006 cobre o agrupamento. |
| Prompt instrui mas modelo ignora o link | Média | Baixo | Tool cria Spec automático quando `userStoryId` ausente (§8) — o invariante "todo PRD tem Spec" é garantido em código, não só no prompt. |

---

## §13 — Métricas de sucesso

| Métrica | Instrumento | Alvo |
|---------|-------------|------|
| % de PRDs com Spec (não-null) criados após release | SQL: `SELECT round(100.0*count(*) FILTER (WHERE "userStoryId" IS NOT NULL)/NULLIF(count(*),0),1) FROM "ProductRequirement" WHERE "createdAt" > '2026-06-04';` | ≥ 95% |
| Specs criados por Vitor | SQL: `SELECT count(*) FROM "UserStory" WHERE "createdByAgent" = true AND "createdAt" > '2026-06-04';` | > 0 (cresce por discovery) |
| PRDs sinalizados como `warn` por tamanho | Telemetria: contagem de retornos de `propose_prd` com `sizing.level='warn'` (log do tool execute) / proxy SQL: `SELECT count(*) FROM "ProductRequirement" WHERE jsonb_array_length(stories) > 8;` | tendência ↓ ao longo das sessões |
| Specs com ≥1 PRD (packs não vazios) | SQL: `SELECT count(DISTINCT "userStoryId") FROM "ProductRequirement" WHERE "userStoryId" IS NOT NULL;` | = nº de Specs usados |
| Regressão de autoria (PRDs continuam aprováveis) | Eval harness: `pnpm eval:vitor` passa o gate de `propose_prd` (case de PRD authoring) | sem regressão vs baseline |

---

## §14 — Open questions

Vazio. (As Q2/Q6 do plano-mãe — heurística de sizing e uso do Spec — ficam **resolvidas** para o escopo desta feature por D8/D9 (soft validator) e D6 (Spec ativo na árvore). Refinamentos de UI do Spec além da árvore + side sheet são Fase ≥ 2 do plano.)

---

## §15 — Referências

- Plano-mãe: [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) (D10, D14, D15, §7.2, §8).
- Código vivo: [vitor/index.ts](../../../src/lib/agent/agents/vitor/index.ts) · [vitor/prd-schemas.ts](../../../src/lib/agent/agents/vitor/prd-schemas.ts) · [product-requirements.ts](../../../src/lib/dal/product-requirements.ts) · [prd-briefing-step.tsx](../../../src/components/sessions/prd-session/prd-briefing-step.tsx) · [prd-card.tsx](../../../src/components/sessions/prd-session/prd-card.tsx) · [story-sheet.tsx](../../../src/components/story-hierarchy/story-sheet.tsx) · [prompt.ts §567](../../../src/lib/agent/prompt.ts) · [20260430_user_story.sql](../../../supabase/migrations/20260430_user_story.sql).
- Eval: [src/eval/vitor/](../../../src/eval/vitor/) (`pnpm eval:vitor`).
- Memory: `project_vitor_as_pm`, `project_forge_double_diamond`, `project_rituals_taxonomy`.

---

## §16 — Stories implementáveis

```yaml
- id: PV2SP-001
  title: Schema Zod ProposeSpecInput + userStoryId em ProposePrdInput
  description: Adiciona ProposeSpecInput (title/want/soThat/personaId/moduleId) e acrescenta userStoryId opcional em ProposePrdInput, em prd-schemas.ts.
  acceptanceCriteria:
    - "prd-schemas.ts exporta ProposeSpecInput (zod object)"
    - "ProposePrdInput tem campo userStoryId opcional uuid"
    - "tsc passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'ProposeSpecInput' src/lib/agent/agents/vitor/prd-schemas.ts"
      expected: ">=1"
    - kind: lint
      command_or_query: "grep -c 'userStoryId' src/lib/agent/agents/vitor/prd-schemas.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'prd-schemas' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 15
  touches: [src/lib/agent/agents/vitor/prd-schemas.ts]

- id: PV2SP-002
  title: Validador SOFT evaluatePrdSizing (função pura + teste)
  description: Cria src/lib/agent/agents/vitor/prd-sizing.ts com evaluatePrdSizing(prd) -> { level:'ok'|'warn', reasons:string[] } (stories 1..8, soma estimateMinutes<=240, cada story 1..4 verifiable e <=30min). Nunca lança. Teste co-localizado cobre ok e warn.
  acceptanceCriteria:
    - "prd-sizing.ts exporta evaluatePrdSizing"
    - "Função retorna level 'warn' quando stories>8; 'ok' no caso base"
    - "Função não lança (advisory)"
    - "Teste unitário passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'export function evaluatePrdSizing' src/lib/agent/agents/vitor/prd-sizing.ts"
      expected: "1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'prd-sizing' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "npx vitest run src/lib/agent/agents/vitor/prd-sizing.test.ts 2>&1 | grep -E 'passed|PASS' | head -1 || echo check-manually"
      expected: "passed (ou PASS)"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitor/prd-sizing.ts
    - src/lib/agent/agents/vitor/prd-sizing.test.ts

- id: PV2SP-003
  title: Tool propose_spec no Vitor
  description: Adiciona a tool propose_spec em vitor/index.ts (buildTools) que cria um UserStory (Spec) via DAL createUserStory na sessão atual e retorna { id, reference, title }.
  acceptanceCriteria:
    - "buildTools registra propose_spec"
    - "execute chama createUserStory com projectId/designSessionId da sessão"
    - "Retorna { id, reference, title }"
    - "tsc passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'propose_spec' src/lib/agent/agents/vitor/index.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'agents/vitor/index' || echo no-errors"
      expected: "no-errors"
    - kind: manual_browser
      command_or_query: "Numa sessão prd_session, pedir ao Vitor pra criar um Spec; confirmar que um UserStory aparece (reference -US-NNN) e o chat reporta o reference."
      expected: "Spec criado, reference -US- visível"
  dependsOn: [PV2SP-001]
  estimateMinutes: 25
  touches: [src/lib/agent/agents/vitor/index.ts]

- id: PV2SP-004
  title: propose_prd seta userStoryId + auto-Spec + sizing no retorno
  description: Altera propose_prd em vitor/index.ts pra aceitar userStoryId; se ausente, cria um Spec via createUserStory e usa o id; passa userStoryId no createPrd; anexa evaluatePrdSizing(prd) no retorno por PRD.
  acceptanceCriteria:
    - "propose_prd aceita userStoryId e o injeta no createPrd"
    - "Quando userStoryId ausente, cria Spec automático antes de criar PRD"
    - "Retorno inclui userStoryId e sizing por PRD criado"
    - "Conteúdo do PRD (problem/goal/AC/stories) inalterado"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'userStoryId' src/lib/agent/agents/vitor/index.ts"
      expected: ">=2"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'agents/vitor/index' || echo no-errors"
      expected: "no-errors"
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"ProductRequirement\" pr JOIN \"UserStory\" us ON us.id = pr.\"userStoryId\" WHERE pr.\"createdAt\" > now() - interval '1 day';"
      expected: ">=0 (query roda; coluna userStoryId existe e o JOIN é válido)"
  dependsOn: [PV2SP-001, PV2SP-002, PV2SP-003]
  estimateMinutes: 30
  touches: [src/lib/agent/agents/vitor/index.ts]

- id: PV2SP-005
  title: Regra Spec-first no prompt do Vitor
  description: Adiciona ao prompt.ts (bloco após "Régua de Stories") a regra de decomposição Spec-first — decomponha a feature em PRDs PR-sized antes de criar; 1 PRD ≈ 1 PR (1–4 verifiable, ≤30 min); todo PRD vive num Spec (use propose_spec). Texto, não código.
  acceptanceCriteria:
    - "prompt.ts menciona propose_spec e a regra Spec-first / PR-sized"
    - "tsc passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'propose_spec' src/lib/agent/prompt.ts"
      expected: ">=1"
    - kind: lint
      command_or_query: "grep -ciE 'Spec-first|PR-sized|1 PRD' src/lib/agent/prompt.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'agent/prompt' || echo no-errors"
      expected: "no-errors"
  dependsOn: [PV2SP-003]
  estimateMinutes: 15
  touches: [src/lib/agent/prompt.ts]

- id: PV2SP-006
  title: Consumir SpecPrdTree compartilhado em prd-briefing-step (renderBadge=sizing)
  description: >
    Troca a lista plana de PrdCard em prd-briefing-step.tsx por <SpecPrdTree prds specs
    renderBadge={...}/> do componente compartilhado src/components/prd/spec-prd-tree.tsx
    (de projects-v2-area). Carrega os Specs (UserStory) da sessão e passa pro componente; o
    agrupamento por userStoryId, o card colapsável e o bucket "Sem Spec" vêm do componente.
    O renderBadge usa evaluatePrdSizing(prd) pra mostrar o chip advisory de tamanho. NÃO cria
    spec-card.tsx nem groupPrdsBySpec próprios.
  acceptanceCriteria:
    - "prd-briefing-step.tsx importa SpecPrdTree de src/components/prd/spec-prd-tree.tsx"
    - "Passa prds + specs + renderBadge (sizing.level warn → chip âmbar via evaluatePrdSizing)"
    - "Nenhum arquivo spec-card.tsx ou helper groupPrdsBySpec é criado nesta feature"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'spec-prd-tree' src/components/sessions/prd-session/prd-briefing-step.tsx"
      expected: ">=1"
    - kind: lint
      command_or_query: "ls src/components/sessions/prd-session/spec-card.tsx 2>/dev/null | wc -l | tr -d ' '"
      expected: "0"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'prd-briefing-step' || echo no-errors"
      expected: "no-errors"
    - kind: manual_browser
      command_or_query: "Abrir uma prd_session com PRDs em ≥2 Specs. Confirmar: cards de Spec colapsáveis (do SpecPrdTree), bucket 'Sem Spec', e PRD com >8 stories mostra badge âmbar via renderBadge."
      expected: "Specs colapsáveis + badge warn visível"
  dependsOn: [PV2SP-004]
  estimateMinutes: 25
  touches: [src/components/sessions/prd-session/prd-briefing-step.tsx]

- id: PV2SP-007
  title: Relabel StorySheet como Spec side sheet (prop entityLabel)
  description: Adiciona prop opcional entityLabel ('Spec'|'Story', default 'Story') em story-sheet.tsx; usa-a nos títulos/labels visíveis. Sem fork — mesmo componente.
  acceptanceCriteria:
    - "story-sheet.tsx aceita prop entityLabel com default 'Story'"
    - "Título do sheet usa entityLabel"
    - "Nenhum arquivo novo duplicando StorySheet"
    - "tsc passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'entityLabel' src/components/story-hierarchy/story-sheet.tsx"
      expected: ">=2"
    - kind: lint
      command_or_query: "ls src/components/**/spec-sheet.tsx 2>/dev/null | wc -l | tr -d ' '"
      expected: "0"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'story-sheet' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 20
  touches: [src/components/story-hierarchy/story-sheet.tsx]

- id: PV2SP-008
  title: Abrir Spec side sheet ao clicar no Spec na árvore
  description: Liga o clique no header/nome do Spec no SpecPrdTree (via callback onOpenSpec passado pelo prd-briefing-step) pra abrir StorySheet com entityLabel='Spec', hidratando o UserStory do Spec. Reusa o componente.
  acceptanceCriteria:
    - "Clicar no Spec abre StorySheet com entityLabel='Spec'"
    - "Sheet hidrata o UserStory correspondente"
    - "tsc + lint passam"
  verifiable:
    - kind: lint
      command_or_query: "grep -c \"entityLabel\" src/components/sessions/prd-session/prd-briefing-step.tsx"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'prd-briefing-step|story-sheet' || echo no-errors"
      expected: "no-errors"
    - kind: manual_browser
      command_or_query: "Clicar no nome de um Spec na árvore. Confirmar que abre o side sheet rotulado 'Spec' com want/soThat do UserStory."
      expected: "Spec side sheet abre com dados corretos"
  dependsOn: [PV2SP-006, PV2SP-007]
  estimateMinutes: 25
  touches:
    - src/components/sessions/prd-session/prd-briefing-step.tsx
```
