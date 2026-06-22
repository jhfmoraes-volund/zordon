# Runbook — Unificação de capacidades dos agentes (organizar + otimizar) · v2

> **Executor:** agente Claude Code, fresh context. Leia inteiro antes de tocar código.
> **Toca DOIS repos:** `zordon` (SSOT, executa) e `zordon-daemon` (anuncia schema, proxia execução pro app). NÃO são byte-mirror — o daemon é um **subconjunto com binds stub** (ver §3.4). O guard de drift compara **nomes**, não bytes.
> **Doutrina:** [agent-construction-doctrine.md](../platform/agent-construction-doctrine.md) (classes SENSE/ACT/REMEMBER/ORIENT, contratos D12/D13/D14). Este runbook **operacionaliza** a doutrina no nível de organização (a doutrina cobre "como fazer 1 tool"; isto cobre "como capacidades se organizam, são compartilhadas e fluem entre agentes/superfícies").
> **Idioma de validação (CRAVADO, verificado no repo):**
> - Sem `npm test`. Testes rodam standalone: `npx tsx <arquivo>` com `node:assert/strict` (modelo: [scripts/gen-phase-sql.test.ts](../../scripts/gen-phase-sql.test.ts)).
> - **Qualquer teste que importe `tools-registry.ts` PRECISA de `--tsconfig tsconfig.eval.json`** — o registry puxa `server-only` transitivamente (via `dal/planning.ts`, `tools/alpha-hierarchy.ts`, `tools/alpha-planner.ts`) e `npx tsx` cru **dá throw** (`This module cannot be imported from a Client Component module`). O `tsconfig.eval.json` aliasa `server-only` → shim no-op (`src/eval/vitor/shims/server-only.ts`). Provado: `npx tsx --tsconfig tsconfig.eval.json -e "import('./src/lib/agent/tools-registry').then(m=>console.log(m.getToolNamesForAgent('alpha').length))"` → imprime sem crash.
> - Comportamento: `npm run eval:vitoria` (= `npx tsx --tsconfig tsconfig.eval.json src/eval/vitoria/runner.ts`), 12 cases em [src/eval/vitoria/cases/](../../src/eval/vitoria/cases/). **Nota:** o eval **não** importa o registry — não serve de prova de import-safety.
> - Gerador com `--check` (idempotência): idioma provado em [scripts/gen-phase-sql.ts](../../scripts/gen-phase-sql.ts).

---

## 0. O que mudou da v1 (e por quê)

A v1 tinha o **diagnóstico certo** e a **keystone certa** (descriptor como SSOT do pertencimento), mas três entregáveis estavam especificados contra uma realidade que não existe. Revisão adversarial (4 céticos, leituras empíricas nos 2 repos) derrubou e corrigiu:

| # | Defeito da v1 | Correção da v2 | Severidade |
|---|---------------|----------------|------------|
| F1 | Golden test = snapshot de `getToolNamesForAgent` (nomes por superfície). Mas `getToolNamesForAgent` **só lê os `Set` constants — nunca toca `bind`**. O snapshot é **estruturalmente cego** ao que o ACU de conversão muda (os binds). | Golden de nomes **+ bind-smoke test**: pra todo nome, chamar `bind(ctxCheio)` e assertar que devolve `Tool` sem throw. Pega `requireX` trocado, perda do truque `planningId ?? ""`, mis-index de factory. `db()` é lazy → bind-time não precisa de `.env`. | 🔴 blocking |
| F2 | Verifiables com `npm test` (não existe) e `npx tsx` cru (dá throw no `server-only`). | `npx tsx --tsconfig tsconfig.eval.json <arquivo>` em tudo que importa o registry; `npx tsc --noEmit`; `npm run eval:vitoria`. | 🔴 blocking |
| F3 | Drift guard = `hash(descriptors) monorepo === espelho`. Daemon é subconjunto com binds stub + `ToolContext` mais estreito → hash igual é impossível; daemon **não tem branch `wiki`** (cai em PM Review) → compare por-surface dá drift falso; e **não há CI** que tenha os 2 repos no disco. | Guard **name-only**, **union-subset** (`daemon ⊆ ∪ nomes do monorepo`), via **artefato versionado** (não clone irmão ao vivo), allowlist **vazia hoje** (provado: `comm -23` = vazio). Honestidade sobre onde roda (ver §3.4). | 🔴 blocking |
| F4 | "Custo de runtime: N rebuilds do bundle por lookup". Desprezível (só zod schemas). | Reframe honesto: o ganho do descriptor é **organização** (mata declared-2×, sharing=1-tag, drift-proof), NÃO perf. O desperdício mensurável real é **`db()` chamado 22× por toolset-build** em `vitoria/tools.ts` → hoist 1×. | 🟠 should-fix |
| F5 | DAL `project-reads.ts` unifica `get_tasks`/`list_project_tasks`. | **CORTADO.** Overlap real = 4 colunas + `.from("Task").order("priority")` (abaixo do próprio limite de corte); filtros de visibilidade **divergem** (`status!=draft` vs `dismissedAt is null`). Um helper viraria parameter-soup. O "otimizar" vira o hoist do `db()`. | 🟠 should-fix |
| F6 | Numeração `Fase N` vs `ACU-NNN` colidia; golden fora do caminho crítico; `ACU-000` só `manual_browser`. | Numeração única `ACU-000..007`; golden+bind-smoke é **ACU-001, antes de qualquer refactor**; zero `manual_browser`. | 🟡 |
| F7 | Descriptor `scope: ScopeReq` (enum único). | Não cobre o **OR-requirement** novo (`requireWikiProjectId` = `routeProjectId \|\| projectId`), nem o `planningId ?? ""` opcional, nem o reader de scope-objeto. Shape híbrido: `needs: NeedGroup[]` (array interno = OR), `optional?`, `require* fica DENTRO do bind` (preserva mensagens hand-tuned). | 🟠 |

**Achados colaterais** (descobertos pela auditoria, fora do escopo central — ver §8): o daemon serve **tools de PM Review quando pedem `wiki`** (fall-through latente); `vitoria/tools.ts` instancia **22 PostgREST clients** por build.

---

## 1. Problema (dívida levantada na auditoria 2026-06-21)

O miolo é bom (registry único, factories reusadas, superfícies explícitas, doutrina escrita, wiki já compartilhada 1× entre Vitoria e Alpha). Mas há dívida organizacional que **silo capacidades por default** e impede verificação:

1. **Pertencimento é `Set<string>` hand-maintained, declarado 2×** ([tools-registry.ts](../../src/lib/agent/tools-registry.ts): registrar a factory em `TOOL_REGISTRY` + repetir o nome no `Set` da superfície — `VITOR_TOOLS`, `VITORIA_{PMREVIEW,PLANNING,RELEASE_PLANNING,WIKI}_TOOLS`, `ALPHA_TOOLS`). Compartilhar = lembrar de adicionar o nome noutro `Set`. Default = silo. (A wiki já driblou isso manualmente — prova de que dá pra ser nativo.)
2. **6 padrões de binding distintos**, sem contrato comum: `requireSessionId`; `requireSessionId + projectId`; bundle-pick com `pmReviewId` (`buildPMReviewTools(...).x`); bundle-pick com `planningId`; bundle-pick com **`planningId ?? ""`** (opcional); `assembleAlphaTools(flags, route)[name]`; `ALPHA_ROUTE_FACTORIES[name](requireRouteProjectId)`; **OR-requirement** `requireWikiProjectId = routeProjectId || projectId`; scope-objeto `createReadContextSourceTool({sessionId,pmReviewId,planningId,releasePlanningId})`; no-ctx `createReadPrdTool()`. Sem um descriptor que modele isso, não dá pra derivar nada.
3. **Sharing não documentado** na doutrina (só vive no código).
4. **Espelhamento pro daemon é manual, sem guard** — drift silencioso. (E **já drifta**: ver §8.)
5. **Matriz de capacidade inexistente** — ninguém sabe, sem ler 1.5k linhas, qual tool serve qual superfície.

**Não-problema (desmascarado):** "custo de runtime do rebuild do bundle". É desprezível. Não justifique nada nisso.

## 2. Solução em uma frase

Fazer de **`descriptor.surfaces` a única fonte do pertencimento** (some o `Set` hand-maintained; compartilhar = adicionar 1 surface ao array); derivar `getToolNamesForAgent` + a **matriz gerada** + um **guard de drift name-only** desse descriptor; **provar inércia** do refactor com golden de nomes **+ bind-smoke**; e tratar a "otimização" como o que de fato mede ganho (**hoist do `db()`**), não como uma camada DAL especulativa.

## 3. Arquitetura-alvo

```
src/lib/agent/tool-descriptor.ts   ← NOVO: type ToolDescriptor + helpers de teste
        │
src/lib/agent/tools-registry.ts    ← TOOL_REGISTRY: Record<string, ToolDescriptor>  (SSOT)
        │  cada entrada: { name, surfaces[], class, needs[], optional?, bind }
        │
        ├── getToolNamesForAgent()   = DERIVADO (filtra descriptors por surface) — some o Set
        ├── docs/platform/agent-surface.manifest.json  = GERADO (nomes por surface; golden + drift)
        ├── docs/platform/agent-capability-matrix.md    = GERADA (humano; nunca à mão)
        └── guard de drift name-only  = daemon ⊆ ∪(nomes monorepo)  (artefato versionado)

(o "otimizar" NÃO cria DAL nova — só hoist do db() por factory; ver §F5/ACU-004)
```

### 3.1 `ToolDescriptor` (shape — híbrido, cobre os 6 padrões)

```ts
// src/lib/agent/tool-descriptor.ts  (NOVO — shape espelhado no daemon; instâncias divergem)
import type { Tool } from "ai";
import type { ToolContext } from "./tools-registry";

export type Surface =
  | "vitor"
  | "vitoria:pm_review" | "vitoria:planning"
  | "vitoria:release_planning" | "vitoria:wiki"
  | "alpha";

export type ToolClass = "sense" | "act" | "remember"; // ORIENT = prompt, não tool (doutrina §2)

export type CtxNeed =
  | "sessionId" | "projectId" | "memberId"
  | "pmReviewId" | "planningId" | "releasePlanningId"
  | "routeProjectId" | "routeSprintId" | "workspacePath";

/** Array interno = grupo OR (basta UM presente). Ex.: requireWikiProjectId
 *  exige routeProjectId OU projectId → needs: [["routeProjectId", "projectId"]]. */
export type NeedGroup = CtxNeed | CtxNeed[];

export type ToolDescriptor = {
  name: string;                       // nome canônico (mcp__zordon__<name>) — SSOT
  surfaces: Surface[];                // ÚNICA fonte do pertencimento (mata dívida #1)
  class: ToolClass;                   // alimenta a matriz/doutrina
  needs: NeedGroup[];                 // METADATA: o que bind exige. Alimenta matriz + teste de consistência
  optional?: CtxNeed[];               // lido se presente (ex.: scope-objeto do read_context_source)
  summary: string;                    // alimenta a matriz gerada
  bind: (ctx: ToolContext) => Tool;   // a factory existente — require* fica AQUI DENTRO
};
```

**Decisões de shape (resolvendo cada padrão):**
- **`require*` continua DENTRO do `bind`.** NÃO trocamos por um `guardCtx` genérico — isso **regrediria** as mensagens hand-tuned (`requireRouteProjectId` ensina o PM a abrir `/projects/<id>` e oferece fallback; `requireWikiProjectId` tem mensagem própria de Wiki). `needs` é **metadata declarativa**, não o guard de runtime.
- **`needs` ↔ `bind` não desincronizam por TESTE, não por tipo:** o bind-smoke (ACU-001) roda `bind(ctx)` com cada `need` faltando e assere que **dá throw** — provando que `needs` reflete o que o `bind` de fato exige.
- **OR-requirement (wiki):** `needs: [["routeProjectId", "projectId"]]`. Satisfaz Vitoria (`projectId`) e Alpha (`routeProjectId`).
- **`planningId ?? ""` (11 reads compartilhados):** `needs: ["projectId"]` **só**. `planningId` NÃO entra (é açúcar interno do bind; listá-lo faria o guard rejeitar PM Review, que legitimamente tem `planningId=null`).
- **scope-objeto (`read_context_source`):** `needs: []`, `optional: ["sessionId","pmReviewId","planningId","releasePlanningId"]`. O tool se auto-resolve.
- **no-ctx (`read_prd`, `describe/query_structured_source`):** `needs: []`. Pra `[]` não ser confundido com "esqueceram o needs", o bind-smoke tem um **whitelist nominal** desses 3 tools como os únicos com `needs` vazio e sem `optional`.

### 3.2 `getToolNamesForAgent` derivado (some o `Set`)

```ts
const key = (slug: string, surface?: string | null): Surface =>
  slug === "vitoria" ? (`vitoria:${surface ?? "pm_review"}` as Surface) : (slug as Surface);

export function getToolNamesForAgent(slug: string, surface?: string | null): string[] {
  const s = key(slug, surface);
  return Object.values(TOOL_REGISTRY).filter(d => d.surfaces.includes(s)).map(d => d.name);
}
```
Compartilhar uma tool = **adicionar 1 surface ao array do descriptor** (não tocar em `Set` algum). A wiki, hoje compartilhada à mão entre `vitoria:wiki` e `alpha`, vira `surfaces: ["vitoria:wiki", "alpha"]`.

### 3.3 A parede do `server-only` e o caminho de extração (CRÍTICO)

Tudo que importa `tools-registry.ts` em teste **roda com `--tsconfig tsconfig.eval.json`** (aliasa `server-only`). Provado funcionar. NÃO migrar pra static-parse (AST/regex dos `Set`) — é frágil e desnecessário, já que o runtime-import sob o eval-tsconfig funciona e ainda habilita o bind-smoke (que static-parse não conseguiria).

### 3.4 Guard de drift — name-only, artefato versionado, honesto sobre enforcement

**Realidade verificada do daemon** (não "consertar"):
- Binds são **stubs** (`buildAlphaTools()` global no-ctx; `buildReleasePlanningBoardToolStubs()`; structured/wiki "execução proxiada pro app"). O daemon **anuncia schema**; o monorepo **executa** via HTTP tool router.
- `ToolContext` do daemon é mais estreito (sem `releasePlanningId`/`routeProjectId`/`routeSprintId`).
- O daemon **não tem branch `surface==="wiki"`** → `wiki` cai no default `VITORIA_PMREVIEW_TOOLS` (bug latente, ver §8).
- **Não há CI** com os dois repos no disco: monorepo só tem `cloudbuild.yaml` (docker build + deploy, **zero teste/tsc**); daemon tem 2 workflows (`typecheck.yml` + `types-sync.yml`) que **só clonam o daemon** (nunca o monorepo). O `typecheck.yml` do daemon já roda `tsc` — útil pra ACU-007.

**Design do guard** (sobrevive a tudo isso):
1. **Name-only.** Compara **conjuntos de nomes**, nunca `{needs,optional}` (esses divergem legitimamente entre repos → allowlist gigante = teatro). `needs/optional` ficam internos ao monorepo (matriz + bind-smoke).
2. **Union-subset, não por-surface.** Assere `∪(nomes anunciados pelo daemon) ⊆ ∪(nomes do monorepo) − allowlist`. Union evita o falso-drift da wiki (topologia de surface difere). Allowlist `agent-surface.daemon-exclusions.json` está **vazia hoje** (provado: `comm -23 daemon mono` = vazio).
3. **Artefato versionado, não clone ao vivo.** O daemon gera `agent-surface.daemon.json` **no próprio repo** (importável cru — provado) e o commita via `types-sync.yml` (`git diff --exit-code`). O monorepo **vendoriza** esse arquivo em `docs/platform/agent-surface.daemon.json`; o `check-daemon-surface.ts` compara dois **arquivos commitados** — roda em qualquer lugar, sem assumir repos irmãos.
4. **Enforcement (honesto):** o monorepo não tem CI de teste. ACU-006 adiciona um workflow mínimo `.github/workflows/agent-surface.yml` (só `npx tsx ... --check` + `check-daemon-surface`). Sem isso, o guard é **advisory**. Está explícito como story própria, não escondido.

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | **`descriptor.surfaces` é a única fonte do pertencimento.** Some `Set` hand-maintained; `getToolNamesForAgent` deriva | Mata a dívida #1; sharing vira 1 tag (keystone) |
| D2 | **`require*` fica DENTRO do `bind`; `needs` é metadata.** Consistência `needs↔bind` garantida por TESTE (bind-smoke), não por substituir o guard | Preserva mensagens hand-tuned; evita regressão de UX do modelo |
| D3 | **Inércia provada por golden de nomes + bind-smoke.** `getToolNamesForAgent` é cego ao bind → bind-smoke é obrigatório | F1: o golden sozinho não vê o que o refactor muda |
| D4 | **Toda validação que importa o registry usa `--tsconfig tsconfig.eval.json`.** | F2: `server-only` transitivo |
| D5 | **Matriz de capacidade é GERADA do descriptor** (`--check`able), nunca à mão | Doc nunca drifta |
| D6 | **Guard de drift name-only, union-subset, via artefato versionado.** Allowlist vazia hoje | F3: daemon é subset com binds stub + sem CI compartilhado |
| D7 | **NÃO force-merge tools divergentes; NÃO criar DAL nova.** "Otimizar" = hoist do `db()` (22→1) + deletar dup byte-idêntica se a ACU-000 achar (não há hoje) | F5: overlap real é fino; visibilidade diverge |
| D8 | **Daemon não copia `needs/optional`** — só o shape e os nomes. Instâncias do daemon refletem a realidade do daemon (binds stub, ctx estreito) | Espelhar metadata daria drift falso |
| D9 | Sequência: **ACU-000 → 001 (golden+bind-smoke, ANTES do refactor) → 002 (descriptor type) → 003 (conversão) → 004 (db() hoist) → 005 (guard) → 006 (CI) → [007 opcional: espelhar no daemon + fix wiki]**. Para depois da 003+005 já entrega "organizado + verificável" | Maior ganho/menor risco cedo; resto incremental |

## 5. Fases & Stories

> **Nota sobre `kind`:** o enum do `prd.json` é `typecheck|lint|sql|http|manual_browser` e não tem "shell". Convenção deste runbook: `typecheck` = `tsc`; `lint` = teste `npx tsx`; `http` = `eval:vitoria` (comportamental). O **comando** em `command_or_query` é a fonte de verdade. Zero `manual_browser`.

```yaml
- id: ACU-000
  title: Inventário + matriz (read-only) + provar o caminho de extração
  description: >
    Mapear TODA tool de TOOL_REGISTRY: {name, surfaces atuais, class, needs (com
    OR-groups), optional, padrão de binding, fonte}. Classificar: SHARED-OK |
    MISSED-SHARE | TRUE-DUP (byte-idêntica → candidata a delete) — não force LAYER.
    PROVAR que o registry importa sob o eval-tsconfig (base de todo o resto).
    Entregável: docs/platform/agent-capability-matrix.md (na ACU-005 vira gerado).
  acceptanceCriteria:
    - "Toda tool listada com surfaces+class+needs+optional+padrão de binding"
    - "Import do registry sob eval-tsconfig provado (sem crash de server-only)"
    - "Pares TRUE-DUP byte-idênticos nomeados (espera-se: nenhum)"
  verifiable:
    - kind: sql
      command_or_query: "npx tsx --tsconfig tsconfig.eval.json -e \"import('./src/lib/agent/tools-registry').then(m=>{const s=['vitor','alpha'];console.log('OK',m.getToolNamesForAgent('alpha').length)})\""
      expected: "imprime OK <n> sem throw"
  dependsOn: []
  estimateMinutes: 30
  touches: [docs/platform/agent-capability-matrix.md]

- id: ACU-001
  title: Golden de nomes + bind-smoke + baseline de eval (ANTES de qualquer refactor)
  description: >
    Criar scripts/gen-agent-surface.ts: importa getToolNamesForAgent (sob eval-tsconfig),
    itera uma const canônica SURFACES, escreve docs/platform/agent-surface.manifest.json
    = {`${slug}:${surface}`: nomes ordenados}. Suporta --check (exit 0 se em dia), idioma
    de gen-phase-sql.ts. Criar scripts/agent-surface.test.ts: (a) manifest == recompute;
    (b) BIND-SMOKE — pra todo name em TOOL_REGISTRY, bind(ctxCheio) devolve Tool sem throw
    (ctxCheio = todos os campos como strings dummy não-vazias); (c) bind(ctx) com cada need
    declarado faltando DÁ throw (consistência needs↔bind); (d) whitelist nominal dos únicos
    needs-vazios. Rodar e gravar baseline do eval:vitoria.
  acceptanceCriteria:
    - "agent-surface.manifest.json commitado (estado ATUAL, pré-refactor)"
    - "bind-smoke passa pra todos os nomes; teste de consistência needs↔bind passa"
    - "eval:vitoria baseline gravado (12 cases)"
  verifiable:
    - kind: lint
      command_or_query: "npx tsx --tsconfig tsconfig.eval.json scripts/agent-surface.test.ts"
      expected: "✓ manifest em dia, bind-smoke verde, consistência needs↔bind verde"
    - kind: http
      command_or_query: "npm run eval:vitoria"
      expected: "12/12 cases (baseline)"
  dependsOn: [ACU-000]
  estimateMinutes: 40
  touches: [scripts/gen-agent-surface.ts, scripts/agent-surface.test.ts, docs/platform/agent-surface.manifest.json]

- id: ACU-002
  title: Tipo ToolDescriptor + helpers (sem reescrever o registry)
  description: >
    Criar src/lib/agent/tool-descriptor.ts: Surface, ToolClass, CtxNeed, NeedGroup,
    ToolDescriptor (§3.1). Helpers: needsSatisfied(need, ctx) (trata OR-group) e o
    assert de consistência usado pelo bind-smoke. Nada do registry muda ainda.
  acceptanceCriteria:
    - "tool-descriptor.ts compila; tipos cobrem os 6 padrões de binding"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
  dependsOn: [ACU-001]
  estimateMinutes: 20
  touches: [src/lib/agent/tool-descriptor.ts]

- id: ACU-003
  title: Converter TOOL_REGISTRY → Record<string, ToolDescriptor> (keystone)
  description: >
    Migrar cada entrada pra um descriptor (name + surfaces + class + needs + optional
    + bind). bind = a arrow atual, INALTERADA (require* fica dentro). Derivar
    getToolNamesForAgent dos descriptors (§3.2). Remover VITOR_TOOLS/VITORIA_*/ALPHA_*
    e os *_NAMES. Wiki vira surfaces:["vitoria:wiki","alpha"] (1 descriptor, 2 surfaces).
    Golden e bind-smoke DEVEM ficar verdes (prova de inércia).
  acceptanceCriteria:
    - "Nenhum Set de nomes hand-maintained sobra; surfaces vivem no descriptor"
    - "Manifest --check idêntico ao golden da ACU-001 (zero mudança de exposição)"
    - "bind-smoke verde (zero regressão de binding)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: lint
      command_or_query: "npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --check docs/platform/agent-surface.manifest.json && npx tsx --tsconfig tsconfig.eval.json scripts/agent-surface.test.ts"
      expected: "manifest em dia + bind-smoke verde"
  dependsOn: [ACU-002]
  estimateMinutes: 40
  touches: [src/lib/agent/tools-registry.ts]

- id: ACU-004
  title: Otimização real — hoist do db() por factory (NÃO criar DAL)
  description: >
    Em src/lib/agent/agents/vitoria/tools.ts, hoist `const supabase = db();` uma vez
    no topo da factory e reusar (hoje db() é chamado ~22×, cada um cria um PostgREST
    client). Alpha já faz isso. NÃO extrair selectTaskCore/DAL — overlap get_tasks vs
    list_project_tasks é fino e visibilidade diverge (D7). Se a ACU-000 achou SELECT
    byte-idêntico cross-file, deletar; senão, no-op.
  acceptanceCriteria:
    - "db() em vitoria/tools.ts cai de ~22 pra ~1; saídas inalteradas"
    - "Nenhum arquivo novo em src/lib/dal/"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: http
      command_or_query: "npm run eval:vitoria"
      expected: "12/12 (>= baseline da ACU-001)"
  dependsOn: [ACU-003]
  estimateMinutes: 25
  touches: [src/lib/agent/agents/vitoria/tools.ts]

- id: ACU-005
  title: Matriz gerada + doutrina + guard de drift name-only (2 lados)
  description: >
    gen-agent-surface.ts passa a emitir TAMBÉM docs/platform/agent-capability-matrix.md
    (humano, --check). Seção nova na doutrina (descriptor + sharing + needs/OR + por que
    require* fica no bind). Lado daemon: zordon-daemon/scripts/gen-agent-surface.ts (import
    cru — daemon é importável) escreve agent-surface.daemon.json e entra no types-sync.yml
    (git diff --exit-code). Lado monorepo: vendoriza esse JSON em docs/platform/ e cria
    scripts/check-daemon-surface.ts: ∪(daemon) ⊆ ∪(monorepo) − exclusions (vazia hoje).
  acceptanceCriteria:
    - "Matriz gerada bate com getToolNamesForAgent (--check verde)"
    - "Doutrina §novo descreve descriptor + sharing + needs (OR) + require-no-bind"
    - "check-daemon-surface passa com allowlist vazia; falha se daemon anuncia nome fora do monorepo"
  verifiable:
    - kind: lint
      command_or_query: "npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --check docs/platform/agent-capability-matrix.md"
      expected: "matriz em dia (sem diff)"
    - kind: lint
      command_or_query: "npx tsx scripts/check-daemon-surface.ts"
      expected: "✓ daemon ⊆ monorepo (0 nomes fora; exclusions vazia)"
  dependsOn: [ACU-003]
  estimateMinutes: 45
  touches:
    - scripts/gen-agent-surface.ts
    - scripts/check-daemon-surface.ts
    - docs/platform/agent-capability-matrix.md
    - docs/platform/agent-surface.daemon.json
    - docs/platform/agent-construction-doctrine.md
    - ../zordon-daemon/scripts/gen-agent-surface.ts
    - ../zordon-daemon/.github/workflows/types-sync.yml

- id: ACU-006
  title: Enforcement — workflow mínimo no monorepo (sai do advisory)
  description: >
    O monorepo não tem CI de teste (só cloudbuild = build+deploy). Adicionar
    .github/workflows/agent-surface.yml rodando: tsc --noEmit; gen-agent-surface --check
    (manifest + matriz); agent-surface.test.ts (sob eval-tsconfig); check-daemon-surface.
    Sem isso o guard de drift é só advisory.
  acceptanceCriteria:
    - "Workflow roda os 4 checks em PR; falha vermelho em drift/regressão de bind"
  verifiable:
    - kind: sql
      command_or_query: "test -f .github/workflows/agent-surface.yml && grep -q 'tsconfig.eval.json' .github/workflows/agent-surface.yml && echo OK"
      expected: "OK"
  dependsOn: [ACU-005]
  estimateMinutes: 20
  touches: [.github/workflows/agent-surface.yml]

- id: ACU-007
  title: (Opcional) Espelhar shape no daemon + corrigir fall-through da wiki
  description: >
    Aplicar o shape ToolDescriptor ao registry do daemon (binds STUB preservados; ctx
    mais estreito; sem needs cross-repo — D8). Corrigir o bug §8: adicionar
    `if (surface==='wiki') return [...]` ao getToolNamesForAgent do daemon (hoje wiki cai
    em PM Review). Decidir o set certo (provavelmente as 5 wiki tools + read_context_source
    + shared reads, ou vazio se wiki não roteia pro daemon ainda).
  acceptanceCriteria:
    - "Daemon compila; check-daemon-surface continua verde"
    - "daemon getToolNamesForAgent('vitoria','wiki') != PM Review (bug fechado)"
  verifiable:
    - kind: typecheck
      command_or_query: "cd ../zordon-daemon && npx tsc --noEmit"
      expected: "sem erros"
    - kind: lint
      command_or_query: "npx tsx scripts/check-daemon-surface.ts"
      expected: "✓ daemon ⊆ monorepo"
  dependsOn: [ACU-005]
  estimateMinutes: 35
  touches: [../zordon-daemon/src/lib/agent/tools-registry.ts]
```

## 6. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Refactor muda exposição/binding sem querer (3 agentes em prod) | Média | Alto | ACU-001 golden de nomes **+ bind-smoke**; gate de ACU-003 |
| Golden cego ao bind (F1) | — | — | Resolvido: bind-smoke é obrigatório (D3) |
| Verifiable não roda (`server-only`) (F2) | — | — | Resolvido: `--tsconfig tsconfig.eval.json` em tudo (D4) |
| Guard de drift vermelho falso / sem onde rodar (F3) | — | — | Resolvido: name-only, union-subset, artefato versionado, ACU-006 (D6) |
| Daemon `ctx` estreito faz metadata divergir | Alta | Médio | D8: guard compara só nomes, nunca needs/optional |
| Fall-through da wiki no daemon (§8) mascara/gera drift | Média | Médio | Union-subset não usa topologia de surface; ACU-007 fecha o bug |
| Monorepo sem CI → guard advisory | Alta | Médio | ACU-006 cria workflow; explícito, não escondido |
| Tentação de extrair DAL (parameter-soup) | Média | Médio | D7: cortado; "otimizar" = hoist do db() |
| Escopo estoura | Média | Médio | D9: parar após 003+005 já entrega organizado+verificável; 004/006/007 incrementais |

## 7. Definição de pronto (por marco)

- **Após ACU-003+005 (core):** pertencimento 100% `descriptor.surfaces`; `getToolNamesForAgent` derivado; golden+bind-smoke verdes; matriz gerada; doutrina atualizada; guard name-only ativo (advisory). Sharing vira 1 tag. — *Entrega "organizado + verificável".*
- **Após ACU-004:** `db()` instanciado 1×/factory; eval ≥ baseline. — *Entrega o "otimizar" real (sem DAL especulativa).*
- **Após ACU-006:** guard sai de advisory pra enforced em CI.
- **Após ACU-007 (opcional):** daemon espelha o shape; fall-through da wiki fechado.

## 8. Achados colaterais (descobertos pela auditoria — fora do escopo central)

1. **Daemon serve PM Review quando pedem `wiki`.** `getToolNamesForAgent` do daemon não tem branch `wiki` → cai no default `VITORIA_PMREVIEW_TOOLS`. Se algum chat de superfície `wiki` roteia pro daemon, ele recebe notas/report/indicadores de PM Review em vez das tools de Wiki. Fechado por ACU-007 (5a). É a prova viva de que o guard de drift tem valor.
2. **`vitoria/tools.ts` instancia ~22 PostgREST clients por toolset-build** (`db()` chamado 22×). É o único "custo de runtime" mensurável (≠ o rebuild de zod schemas, que é ruído). Endereçado por ACU-004.

## 9. Referências

- Código vivo: [src/lib/agent/tools-registry.ts](../../src/lib/agent/tools-registry.ts), [agents/alpha/tools.ts](../../src/lib/agent/agents/alpha/tools.ts), [agents/vitoria/tools.ts](../../src/lib/agent/agents/vitoria/tools.ts)
- Idiomas provados: [scripts/gen-phase-sql.ts](../../scripts/gen-phase-sql.ts) (`--check`), [scripts/gen-phase-sql.test.ts](../../scripts/gen-phase-sql.test.ts) (`node:assert` + tsx), `tsconfig.eval.json` (alias `server-only`), [src/eval/vitoria/](../../src/eval/vitoria/) (12 cases)
- Doutrina: [agent-construction-doctrine.md](../platform/agent-construction-doctrine.md)
- Memórias: `project_daemon_tool_advertisement` (2 cópias, daemon anuncia/proxia), `feedback_agent_chat_daemon_only`, `project_repo_organization` (.claude hooks locais)
```
