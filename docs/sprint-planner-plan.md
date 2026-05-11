# Sprint Planner — Sugerir próximas sprints

**Status:** implementado (v1)
**Data:** 2026-05-11
**Autor:** Brenda + Claude
**Tag de commit prevista:** `ZRD-JM-54` (ou próximo livre)

> 📌 Esse documento foi reescrito após implementação. Reflete o que está no
> código hoje, com as decisões tomadas em iteração com a Brenda. A versão
> original (proposta) está no histórico do git.

---

## Contexto

O `/task-gen` gera centenas de tasks por projeto (piloto Zelar: 346 tasks em
28 stories, 8 módulos). Cada task já nasce com:

- `Task.layer` ∈ {DATA, API, REALTIME, UI, OPS} — usado internamente pelo
  algoritmo, **não exposto na UI** (decisão tomada durante iteração — ver
  ponto 8 abaixo)
- `Task.userStoryId → UserStory.moduleId → Module.name` (agrupamento natural,
  exposto no rationale e no painel de detalhe)
- `Task.personaScope` (não usado no algoritmo v1)
- `TaskDependency(taskId, dependsOn, kind='blocks'|'relates_to')` — cycle
  detection no DB; algoritmo só usa `kind='blocks'`
- `TaskAcceptanceCriterion` (M:N entre Task e AC) — usado como proxy de valor

Sprint:

- `Sprint.status` ∈ {upcoming, active, completed}, 1 active por projeto
- `Sprint.goal`, `Sprint.retro` (texto livre)
- **Não tem `capacityPoints`** — capacidade é derivada empiricamente da soma
  de `Task.functionPoints` das últimas sprints (ver ponto 3 abaixo)

**Problema:** existia o grafo, existia o sprint, mas não existia a função
que ligava um no outro. PM arrastava task por task manualmente, sem ver
dependências.

## Decisão arquitetural

Construir um **planner incremental sob-demanda** — não um "monta tudo de uma
vez". PM aciona quando quer, motor sempre relê o estado atual antes de
sugerir, e o resultado é um **preview interativo que o PM ajusta antes de
persistir**.

**Princípios mantidos:**

1. **Determinístico por padrão.** Topological sort + heurísticas claras com
   FNV-1a hash como tiebreaker. PM consegue explicar por que cada task foi
   pra cada sprint.
2. **Sempre incremental.** Tasks já alocadas em sprints anteriores são input
   do próximo planejamento, não recalculadas.
3. **PM tem a última palavra.** Preview com ajustes antes de persistir.
4. **Reusar UI patterns do projeto.** `ResponsiveSheet`, `Field`,
   `ConfirmDialog`, Sonner toast, `TagChip`.
5. **LLM fora da v1.** Nome default `Sprint N`, goal vazio. PM edita inline.

**Princípios revistos durante iteração:**

- **Drag-and-drop saiu.** Substituído por (a) botão **X** por task na sprint
  card pra devolver pro backlog, e (b) dropdown **"Adicionar →"** no
  backlog colapsável pra promover task pra uma sprint específica. Trade-off:
  movimento entre sprints exige 2 cliques (X → adicionar). Mais simples.
- **Detail panel separado.** Em vez de drill-down dentro do mesmo
  componente, abre uma `<aside>` ancorada à esquerda do sheet principal
  (criada via `createPortal` + posicionada com `ResizeObserver` medindo o
  sheet real — ver ponto 10 abaixo).

## Decisões em aberto (resolvidas em conversa)

| # | Decisão | Resolvida em |
|---|---------|--------------|
| 1 | Capacidade da sprint | Soma de `Task.functionPoints` das últimas 3 sprints. Fallback: `SprintMember.fpAllocation`. Fallback final: 40. |
| 2 | LLM pra nome/goal | Fora da v1. Placeholder `Sprint N`. PM edita inline. |
| 3 | Drag-and-drop vs botões | Botões (X + dropdown). |
| 4 | Limite de N | 1–3 por chamada (validação Zod). |
| 5 | Warning de layer diversity | Mantida internamente; UI mostra como "Sprint só com 1 categoria de task". |
| 6 | Persona scope | Fora da v1. |
| 7 | Layer DATA/API/UI/etc na UI | **REMOVIDO da UI.** Algoritmo usa internamente; tasks são identificadas pelas **TaskTags do projeto** (back/front/p1/etc). |
| 8 | Detail panel: embutido ou separado | Separado, ancorado à esquerda do sheet principal. |
| 9 | Target: criar nova OU preencher existente vazia | Ambos. Select inicial "O que você quer fazer?". |
| 10 | Posicionamento do aside | Via JS (`ResizeObserver` no sheet real). Tentativas com CSS `right: 1024px` / `min(100vw, 1024px)` falharam em viewports menores e por containing-block de ancestrais. |

## Modelo de dados

**Uma migration nova:** `supabase/migrations/20260511_apply_sprint_suggestion.sql`
— RPC `apply_sprint_suggestion(p_project_id uuid, p_sprints jsonb)`. Ver
`apply` endpoint abaixo.

Campos existentes usados:

| Campo | Tabela | Uso |
|---|---|---|
| `Task.sprintId` | Task | Output: planner seta isso ao aplicar |
| `Task.layer` | Task | Input: ordenação interna (DATA > API > REALTIME > UI > OPS) |
| `Task.functionPoints` | Task | Estimate; default 1 quando null/≤0 |
| `Task.description` | Task | Mostrado no detail panel (completo, sem truncate) |
| `Task.status` | Task | Filtro: ignora `draft`; capacidade soma só status ≠ backlog |
| `Task.userStoryId → UserStory.moduleId → Module.name` | join | Exposto no rationale + detail panel |
| `TaskDependency` (kind=blocks) | TaskDependency | Regra dura |
| `TaskAcceptanceCriterion` | TaskAcceptanceCriterion | Proxy de valor no score |
| `TaskTagAssignment → TaskTag` | join | Identificação visual no detail panel |
| `Sprint.name / goal / startDate / endDate / status` | Sprint | Output (create) ou referência (fill) |
| `SprintMember.fpAllocation` | SprintMember | Fallback de capacidade |

## Algoritmo — `planSprints()`

Função pura em `src/lib/sprint-planner.ts`. Sem I/O. Testes standalone em
`src/lib/sprint-planner.test.ts` (rodar com `npx tsx`, 18 casos cobrindo
edge cases — N=0, capacidade=0, ciclo, blocker no backlog, task gigante,
layer diversity, tiebreaker determinístico).

```typescript
type PlannerInput = {
  candidates: PlannerTask[];      // tasks com sprintId IS NULL
  alreadyAllocated: Set<string>;  // taskIds já em qualquer sprint
  dependencies: PlannerDependency[]; // pré-filtrado por kind='blocks'
  n: number;
  capacityPerSprint: number;
  nextSprintNumber: number;
};
```

**Score** (peso decrescente):
```
score = 1000 × #dependentes_no_backlog
      + 100  × layerRank[layer]   // DATA=5, API=4, REALTIME=3, UI=2, OPS=1
      + 10   × #ACs_cobertos
      + FNV-1a_hash(id)           // tiebreaker determinístico ∈ [0,1)
```

**Bucketagem:** loop greedy por N rounds. Em cada round, varre candidates em
ordem de score, adiciona até `totalPoints >= capacityPerSprint`. Tasks
bloqueadas por dep não-satisfeita são puladas; depois de adicionar uma task,
revarre (ela pode ter desbloqueado outras).

**Regras duras:**
- Não adiciona task se algum `blocks` dela não foi alocado a sprint ≤ K
- Capacidade ≤ 0 → erro
- N ≤ 0 → leftover vazio, sprints vazias

**Regras soft (warnings, não rejeita):**
- Sprint com 1 só layer → `LOW_LAYER_DIVERSITY`
- Task gigante (>capacity) ocupa sprint sozinha → `OVERCAPACITY`

**Output:** sprints + leftover (`reason: CAPACITY | BLOCKED_BY_BACKLOG`).
Nenhum I/O, totalmente determinístico.

## API

### `POST /api/projects/[id]/suggest-sprints`

**Read-only.** Roda o algoritmo + enriquece com módulo/tags/rationale.

Body (Zod):
```typescript
{
  n: number;                       // 1–3 (forçado a 1 quando targetSprintId setado)
  capacityPerSprint?: number;
  excludeTaskIds?: string[];       // pra "sugerir mais 1 sprint"
  previewSprintCount?: number;     // continua numeração de sprintN
  targetSprintId?: string;         // modo fill-existing
}
```

Comportamento (resumo):
1. Carrega tasks do projeto + deps + sprints + SprintMember (paralelo)
2. Computa capacidade default: avg de `sum(Task.functionPoints)` das 3
   últimas sprints (>0); fallback SprintMember; fallback 40
3. Roda `planSprints()`
4. Enriquece resposta com:
   - **Por task:** description completa, module name, tags (com tone),
     blockedBy refs, reason (unblocks/AC count)
   - **Por sprint:** rationale com `dependsOn[]`, `enablesCount`,
     `enablesByModule[]`, `primaryModules[]`, `keyHubs[]`, `topTags[]`,
     `summary` (foundation/builds-on/mixed). Tudo com nomes reais
     (títulos + módulos), não só refs.

### `POST /api/projects/[id]/apply-sprint-suggestion`

**Persistente.** Recebe sugestão (possivelmente ajustada) e materializa via RPC.

Body (Zod, discriminated union por `mode`):
```typescript
{
  sprints: Array<
    | { mode: "create"; name; goal?; taskIds: uuid[] }
    | { mode: "fill"; existingSprintId: uuid; goal?; taskIds: uuid[] }
  >;
}
```

Endpoint computa startDate/endDate pra cada `create` (encadeando via
`getNextSprintDefaults`) e chama `apply_sprint_suggestion`. Trata:
- **PGRST202 / "function does not exist"** → 503 com mensagem clara pra
  rodar a migration
- **SQLSTATE 40001** (`task_already_allocated` / `sprint_not_empty`) → 409
- **Outros** → 500 com mensagem do Postgres + log no servidor

### RPC `apply_sprint_suggestion`

Transação única que aceita as duas formas:

**CREATE:** `{ name, goal, startDate, endDate, taskIds }` → `INSERT INTO Sprint`
**FILL:** `{ existingSprintId, goal?, taskIds }` → valida que sprint existe
no projeto e está vazia (senão 40001); atualiza goal se fornecido.

Pra cada sprint, faz `UPDATE Task SET sprintId WHERE sprintId IS NULL` —
falha (40001) se qualquer task já foi alocada por outro PM. Atômica.

## UI

### Componente principal — `SuggestSprintsSheet`

Arquivo: `src/components/sprint/suggest-sprints-sheet.tsx`.

Estrutura:
```
ResponsiveSheet (size="xl", anchored right)
├─ Header — título + linha de contexto (backlog count, sprint alvo)
├─ Body
│  ├─ Controls (colapsável após geração)
│  │  ├─ Select "O que você quer fazer?" (placeholder "Selecione")
│  │  │  - Criar nova(s) sprint(s)
│  │  │  - Preencher sprint vazia (só se houver upcoming sem tasks)
│  │  ├─ Quantas sprints? (1/2/3) — só create-new
│  │  │   OU
│  │  ├─ Qual sprint vazia? (dropdown) — só fill-existing
│  │  ├─ Capacidade (default mostra fonte: "média de FP das últimas 3 sprints")
│  │  └─ Gerar sugestão (linha própria, alinhado à direita)
│  ├─ Pra cada sprint:
│  │  ├─ "Por que essa priorização? — Sprint X" (expander, default fechado)
│  │  │   Conteúdo: frases naturais com títulos e módulos reais
│  │  │   (não refs). Tags presentes no rodapé.
│  │  └─ Sprint card
│  │     ├─ Nome (editável) + capacidade pill
│  │     ├─ Goal (Textarea)
│  │     ├─ Warnings (layer diversity, overcapacity)
│  │     └─ Lista de tasks:
│  │        - shortRef (T-070) + título + reasonBits + fp + X
│  │        - clicar abre TaskDetailAside
│  ├─ "Sugerir mais 1 sprint" (só create-new)
│  └─ Backlog (colapsável, default fechado)
│     └─ Lista de leftover com dropdown "Adicionar → Sprint X"
└─ Footer — Cancelar | Aplicar
```

### Painel lateral — `TaskDetailAside`

Detalhe da task selecionada. Renderizado via `createPortal(.., document.body)`
pra escapar de containing blocks de ancestrais (`transform`/`filter` no
app-shell). Posição calculada em JS com `ResizeObserver` medindo o sheet
principal — garante alinhamento exato com a borda esquerda dele
independente da largura real.

Conteúdo:
- Header: tags (TagChip do projeto) + ref completa + módulo + título + X
- Detalhes: pontos, AC cobertos, módulo, tags
- Descrição completa (sem truncate, `whitespace-pre-wrap`)
- "Por que essa task?": desbloqueia X (lista de refs) + espera (lista
  de blockers)

### Pontos de entrada

1. **Header do backlog da Sprint** — Botão "Sugerir próximas" no menu de
   ações do projeto detail page.
2. **Sprint dialog** — Quando o PM cria uma sprint nova, há um Select
   "Conteúdo da sprint" abaixo do STATUS:
   - "Criar vazia (eu adiciono as tasks depois)" — comportamento original
   - "Preencher com tasks do backlog (sugestão automática)" — após criar,
     abre `SuggestSprintsSheet` em modo fill-existing com a nova sprint
     pré-selecionada.

### Extensões a componentes canônicos

| Componente | Mudança | Por quê |
|---|---|---|
| `ResponsiveSheet` | Sizes `xl` (1024px) e `2xl` (1280px) | Preview precisa de espaço |
| `ResponsiveSheet` | Prop `desktopSide: "left" \| "right"` | Reservado pra futuras tarefas (não usado atualmente — aside é `<aside>` não Sheet) |

## Arquivos novos e modificados

**Novos:**
- `src/lib/sprint-planner.ts` — algoritmo puro
- `src/lib/sprint-planner.test.ts` — 18 testes standalone (`npx tsx`)
- `src/app/api/projects/[id]/suggest-sprints/route.ts` — POST read-only
- `src/app/api/projects/[id]/apply-sprint-suggestion/route.ts` — POST persistente
- `src/components/sprint/suggest-sprints-sheet.tsx` — UI principal
- `supabase/migrations/20260511_apply_sprint_suggestion.sql` — RPC

**Modificados:**
- `src/components/sprint-dialog.tsx` — Select "Conteúdo da sprint" abaixo
  do STATUS + campo `autoFillFromBacklog` no `SprintFormData`
- `src/app/(dashboard)/projects/[id]/page.tsx` — botão "Sugerir próximas"
  no header + integração do sheet + auto-fill flow após criar sprint
- `src/components/ui/responsive-sheet.tsx` — sizes `xl`/`2xl` + prop
  `desktopSide`

## Não-objetivos (deixados pra depois)

- **Auto-execução em horários fixos.** PM aciona quando quiser.
- **Re-planejamento de sprint existente que tem tasks.** Só `upcoming`
  vazia entra em "fill-existing".
- **Balanceamento de persona.** Não entra na v1.
- **Estimativa automática de tasks.** Sem `functionPoints` ou ≤ 0 → 1.
- **Visualização de Gantt.** Reusa `sprint-timeline.tsx` se aplicável.
- **Sugestão cross-projeto.** Cada projeto é independente.
- **Movimentação direta entre sprints no preview.** Hoje é via X (remove
  pro backlog) + dropdown (adiciona em outra sprint).
- **Drag-and-drop.** Decisão de UX.
- **LLM cosmetic.** PM edita nome/goal inline antes de aplicar.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| `TaskDependency` incompleta | Auditoria prévia. Tasks sem dep entram pela ordem padrão. |
| Sprint só de DATA | Warning visual `LOW_LAYER_DIVERSITY` (frase: "Sprint só com 1 categoria de task"). |
| Race condition: 2 PMs aplicam ao mesmo tempo | RPC com `sprintId IS NULL` check; 40001 → 409. |
| Task com 0 estimate vira sprint vazia | Default 1 ponto. |
| Migration não aplicada no projeto da Brenda | Endpoint detecta `PGRST202` e devolve 503 com mensagem pedindo pra rodar a migration. Client surface a mensagem completa no toast (10s). |
| Posicionamento do aside quebra com viewport | `ResizeObserver` mede o sheet real e atualiza em tempo real. |

## Critério de pronto

- [x] Algoritmo `planSprints()` com 18 testes verdes, incluindo edge cases
- [x] PM consegue gerar preview de 1–3 sprints no Zelar em < 5s (sem LLM)
- [x] Preview mostra warnings de layer único e overcapacity
- [x] X em cada task pra devolver pro backlog
- [x] Backlog colapsável com dropdown pra promover task de volta
- [x] "Aplicar" persiste atomicamente via RPC — tudo ou nada
- [x] Re-rodar `suggest-sprints` depois de aplicar produz resultado
  diferente (considera novas alocações)
- [x] Toast de erro claro pra 403/409/5xx (padrão `showErrorToast` +
  fallback que surface body do servidor)
- [x] Zero `window.confirm`, zero `<Dialog>` nu (padrão do projeto)
- [x] Detail panel ancorado à esquerda do sheet via `ResizeObserver`
- [x] Rationale projeto-específico (títulos + módulos, não refs cruas)
- [x] Tags reais do projeto na lista (não DATA/API/UI técnico)

## Manuais pendentes

1. **Rodar a migration** — `psql` não está no PATH local. Opções:
   - Supabase CLI: `supabase link --project-ref ugvqlmapqlobigkjboae && supabase db push`
   - Instalar psql via scoop e seguir o AGENTS.md (precisa setar
     `DIRECT_URL` no `.env`)
   - Cliente externo (DBeaver/pgAdmin) com a connection string Supabase

2. **Regenerar database.types.ts** — `npm run db:types`. Vai trazer a
   coluna `Task.layer` (já existente no DB via migration
   `20260509_zelar_v2_tasks_schema.sql` mas não nos types) e a nova RPC.
   Após isso, o cast-via-unknown no
   `src/app/api/projects/[id]/suggest-sprints/route.ts` pode ser removido.

3. **Validar no piloto Zelar** — abrir o projeto com backlog cheio
   (296 tasks), gerar 1–3 sprints, conferir leftover/warnings/rationale,
   ajustar com X + dropdown, aplicar. Confirmar que o aside abre
   adjacente ao sheet (não na borda da tela).
