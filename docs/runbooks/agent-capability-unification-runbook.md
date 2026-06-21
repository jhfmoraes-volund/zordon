# Runbook — Unificação de capacidades dos agentes (organizar + otimizar)

> **Executor:** agente Claude Code, fresh context. Leia inteiro antes de tocar código.
> **Toca DOIS repos:** `zordon` (SSOT) e `zordon-daemon` (espelho). O `tools-registry.ts` é espelhado — o objetivo final inclui um **guard de drift** que torna o espelhamento verificável.
> **Doutrina:** [agent-construction-doctrine.md](../platform/agent-construction-doctrine.md) (classes SENSE/ACT/REMEMBER/ORIENT, contratos D12/D13/D14). Este runbook **operacionaliza** a doutrina no nível de organização (a doutrina cobre "como fazer 1 tool"; isto cobre "como capacidades se organizam e fluem entre agentes").
> **Validação de comportamento:** mudanças que afetam runtime são gated por `golden test` (sets idênticos) e/ou `eval` (`zordon-daemon/scripts/daemon/eval-backfill.ts`).

## 1. Problema (dívida levantada na auditoria 2026-06-21)

O miolo é bom (registry único, factories reusadas, superfícies explícitas, doutrina escrita). Mas há dívida organizacional que **silo capacidades por default** e duplica lógica:

1. **Pertencimento de capacidade é `Set<string>` de nomes, hand-maintained, declarado 2×** ([tools-registry.ts](../../src/lib/agent/tools-registry.ts): registrar a factory + repetir o nome no `Set` do agente). Compartilhar uma tool = lembrar de adicionar o nome noutro `Set`. Default = silo.
2. **Duplicação de camada, não de tool.** `get_tasks`/`list_project_tasks`, `list_sprints`/`list_project_sprints`, `get_project_capacity`/`get_sprint_capacity` **não são idênticas** — divergiram por motivo real (Alpha: cross-project + atribuições; Vitoria: single-project + story/dedup). Mas **reimplementam a mesma query** sem uma camada de leitura comum. Uma evolui, a outra fica pra trás.
3. **3 convenções de montagem** (Vitor: factories diretas; Vitoria: `buildVitoriaTools` bundle; Alpha: `assembleAlphaTools` dict) + **2 lares de código** (`tools/*` granular vs `agents/*/tools.ts` monolítico de ~1.3k linhas). Sem caminho óbvio pra "adicionar agente/superfície N".
4. **Sharing não documentado** na doutrina (só vive no código).
5. **Espelhamento pro daemon é manual, sem guard** — drift silencioso.

**Custo de runtime:** o registry rebuilda o bundle inteiro (`buildVitoriaTools`/`assembleAlphaTools`) **a cada lookup de 1 nome** — N rebuilds pra montar o set.

## 2. Solução em uma frase

Tornar **cada tool a única fonte de verdade do próprio pertencimento e escopo** via um descriptor declarativo; derivar registry + dispatch + matriz de capacidade + guard de drift desse descriptor; e extrair uma **camada de leitura de projeto compartilhada** por baixo das tools que hoje reimplementam a mesma query.

## 3. Arquitetura-alvo

```
src/lib/agent/tools/*.ts          ← factories (uma família por arquivo) — único lar
        │  cada uma exporta seu ToolDescriptor
        ▼
src/lib/agent/capabilities.ts     ← const TOOLS: ToolDescriptor[]  (SSOT)
        │
        ├── TOOL_REGISTRY            = derivado (name → factory + scope-guard)
        ├── getToolNamesForAgent()   = derivado (filtra por surface)
        ├── agent-capability-matrix  = gerado (doc nunca dริfta)
        └── daemon drift guard       = hash(descriptors) monorepo === espelho

src/lib/dal/project-reads.ts      ← queries canônicas (tasks/sprints/capacity/
                                     members/deps). Tools chamam isto; não
                                     reimplementam a query (forma do tool pode
                                     diferir por agente; a LEITURA é uma só).
```

### ToolDescriptor (shape)

```ts
type Surface =
  | "vitor"
  | "vitoria:pm_review" | "vitoria:planning"
  | "vitoria:release_planning" | "vitoria:wiki"
  | "alpha";

type ToolClass = "sense" | "act" | "remember";   // doutrina §2 (ORIENT = prompt, não tool)
type ScopeReq =
  | "none" | "session" | "project"
  | "pmReview" | "planning" | "releasePlanning" | "routeProject";

type ToolDescriptor = {
  id: string;                          // nome único (mcp__zordon__<id>)
  factory: (ctx: ToolContext) => Tool; // sem require* manual — o scope-guard vem de `scope`
  class: ToolClass;
  scope: ScopeReq;                     // dirige o guard automaticamente
  surfaces: Surface[];                 // ÚNICA fonte do pertencimento
  summary: string;                     // alimenta a matriz/doc gerada
};
```

`getToolNamesForAgent(slug, surface)` = `TOOLS.filter(t => t.surfaces.includes(key(slug,surface))).map(t=>t.id)`.
`TOOL_REGISTRY` = `Object.fromEntries(TOOLS.map(t => [t.id, withScopeGuard(t.scope, t.factory)]))`.
Compartilhar uma tool = **adicionar 1 surface ao array** (não tocar em `Set` algum).

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | **Descriptor é a única fonte do pertencimento.** Acabam os `Set`s hand-maintained e os require* espalhados | Mata a dívida #1; sharing vira 1 tag |
| D2 | **NÃO force-merge tools de forma diferente.** Unificar a CAMADA (DAL) por baixo; merge só de TRUE-DUP idênticas (Fase 0 decide) | Respeita a doutrina ("um conceito por tool, afiada"); a divergência Alpha/Vitoria é legítima |
| D3 | **Zero mudança de comportamento nas fases mecânicas** (1, 3): gated por golden test (sets derivados === sets atuais) | Refactor de produção em 3 agentes — segurança primeiro |
| D4 | **Fases que mudam leitura (2)** são gated por **eval** (eval-backfill), não só tsc | Doutrina §3: toda amarra/mudança rastreia a um achado de eval |
| D5 | **Matriz de capacidade é gerada do descriptor**, não escrita à mão | Doc nunca drifta (mata #4) |
| D6 | **Guard de drift do daemon** = test que compara hash dos descriptors do monorepo com o espelho | Mata #5; espelhamento vira verificável |
| D7 | Sequência recomendada: **0 → 1 → 4(guard+doc) → 2 → 3**. 1+4 entregam o maior ganho/menor risco; 2/3 são mais profundas | Permite parar depois da 1+4 já bem organizado |

## 5. Fases & Stories

```yaml
- id: ACU-000
  title: Inventário + matriz de capacidade (read-only)
  description: >
    Mapear TODA tool: {id, surfaces atuais, class, scope, DAL/fonte que toca}.
    Classificar cada uma: SHARED-OK | MISSED-SHARE (útil presa a 1 agente) |
    LAYER-DUP (mesma query reimplementada) | TRUE-DUP (idêntica → merge).
    Entregável: docs/platform/agent-capability-matrix.md (na Fase 4 vira gerado).
  acceptanceCriteria:
    - "Toda tool listada com surfaces+class+scope+DAL"
    - "Pares LAYER-DUP e TRUE-DUP nomeados explicitamente"
  verifiable:
    - kind: manual_browser
      command_or_query: "Revisar a matriz contra getToolNamesForAgent"
      expected: "cobertura 100% das tools registradas"
  dependsOn: []
  estimateMinutes: 30
  touches: [docs/platform/agent-capability-matrix.md]

- id: ACU-001
  title: ToolDescriptor + registry/dispatch derivados (keystone)
  description: >
    Criar src/lib/agent/capabilities.ts com ToolDescriptor + const TOOLS[].
    Migrar cada entrada do TOOL_REGISTRY pra um descriptor (factory + class +
    scope + surfaces). Derivar TOOL_REGISTRY (com withScopeGuard) e
    getToolNamesForAgent dos descriptors. Remover os Set hand-maintained
    (VITOR_TOOLS, VITORIA_*, ALPHA_*) e os require* manuais.
  acceptanceCriteria:
    - "getToolNamesForAgent derivado; nenhum Set de nomes hand-maintained sobra"
    - "scope-guard automático por descriptor.scope (sem require* espalhado)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: manual_browser
      command_or_query: "golden test: para todo (slug,surface), set derivado === set atual (snapshot pré-refactor)"
      expected: "igualdade exata — zero mudança de exposição"
  dependsOn: [ACU-000]
  estimateMinutes: 35
  touches: [src/lib/agent/capabilities.ts, src/lib/agent/tools-registry.ts]

- id: ACU-002
  title: Golden test do dispatch
  description: >
    Test que congela o output de getToolNamesForAgent pra todas as combinações
    (vitor; vitoria×{pm_review,planning,release_planning}; alpha) ANTES da Fase 1,
    e roda contra o derivado. Guarda contra regressão de exposição.
  acceptanceCriteria:
    - "Test cobre todas as superfícies; falha se uma tool entra/sai sem querer"
  verifiable:
    - kind: lint
      command_or_query: "npm test -- agent-capabilities (ou o runner do repo)"
      expected: "passa; sets idênticos ao snapshot"
  dependsOn: [ACU-001]
  estimateMinutes: 20
  touches: [src/lib/agent/__tests__/capabilities.test.ts]

- id: ACU-003
  title: Camada de leitura de projeto compartilhada (DAL)
  description: >
    Extrair as queries canônicas (tasks/sprints/capacity/members/deps) pra
    src/lib/dal/project-reads.ts. Migrar as tools LAYER-DUP dos dois agentes pra
    chamarem o DAL (mantendo a FORMA/escopo de cada tool — Alpha cross-project+
    atribuições; Vitoria single-project+story). Merge só dos TRUE-DUP da Fase 0.
  acceptanceCriteria:
    - "Tasks/sprints/capacity readers chamam um DAL único (query não reimplementada)"
    - "Output de cada tool inalterado (snapshot por tool)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: manual_browser
      command_or_query: "eval-backfill (Vitoria) + smoke do Alpha (get_tasks/get_sprint_overview)"
      expected: "scorecard >= baseline; saídas equivalentes"
  dependsOn: [ACU-001]
  estimateMinutes: 40
  touches: [src/lib/dal/project-reads.ts, src/lib/agent/agents/alpha/tools.ts, src/lib/agent/agents/vitoria/tools.ts]

- id: ACU-004
  title: Normalizar lares + aposentar bundles de montagem
  description: >
    Quebrar agents/{alpha,vitoria}/tools.ts monolíticos em tools/<família>.ts
    (factories por-tool). Aposentar buildVitoriaTools/assembleAlphaTools (bundle
    rebuild por lookup) → factory por tool registrada via descriptor (build 1×).
    Incremental por família; golden test verde a cada passo.
  acceptanceCriteria:
    - "Sem bundle rebuild por-lookup; cada factory construída uma vez"
    - "agents/*/tools.ts não são mais monólitos de tool"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: lint
      command_or_query: "npm test -- agent-capabilities"
      expected: "golden test verde"
  dependsOn: [ACU-002, ACU-003]
  estimateMinutes: 45
  touches: [src/lib/agent/tools/, src/lib/agent/agents/]

- id: ACU-005
  title: Matriz gerada + doutrina + guard de drift do daemon
  description: >
    Script que gera docs/platform/agent-capability-matrix.md dos descriptors.
    Seção nova na doutrina documentando o modelo descriptor/sharing. Test/CI que
    compara hash dos descriptors do monorepo com o espelho do zordon-daemon e
    falha em divergência (espelhar capabilities.ts no daemon).
  acceptanceCriteria:
    - "Matriz gerada bate com getToolNamesForAgent"
    - "Doutrina §novo descreve descriptor + sharing + scope-guard"
    - "Drift guard falha quando monorepo != daemon"
  verifiable:
    - kind: lint
      command_or_query: "npm run gen:capability-matrix && git diff --exit-code docs/platform/agent-capability-matrix.md"
      expected: "matriz em dia (sem diff)"
    - kind: typecheck
      command_or_query: "cd ../zordon-daemon && npx tsc --noEmit"
      expected: "sem erros (espelho compila)"
  dependsOn: [ACU-001]
  estimateMinutes: 35
  touches:
    - scripts/gen-capability-matrix.ts
    - docs/platform/agent-construction-doctrine.md
    - src/lib/agent/__tests__/daemon-mirror-drift.test.ts
    - ../zordon-daemon/src/lib/agent/capabilities.ts
```

## 6. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Refactor muda exposição de tool sem querer (3 agentes em prod) | Média | Alto | ACU-002 golden test: sets derivados === snapshot pré-refactor, gate de toda fase mecânica |
| Camada DAL muda sutilmente uma leitura | Média | Alto | D4: eval-backfill + snapshot por tool antes de mergear |
| Force-merge quebra a forma específica de um agente | Média | Médio | D2: unificar camada, não tool; merge só TRUE-DUP |
| Espelho do daemon drifta durante o refactor | Alta | Médio | ACU-005 guard de drift; espelhar capabilities.ts |
| Escopo estoura (monólitos grandes) | Média | Médio | D7: parar após 1+4 já é grande ganho; 3/4 incrementais por família |

## 7. Definição de pronto (por marco)

- **Após Fase 1+4 (core):** pertencimento é 100% descriptor-driven; `getToolNamesForAgent` derivado e golden-tested; matriz gerada; doutrina atualizada; guard de drift do daemon ativo. Sharing vira 1 tag. — *Já entrega "organizado".*
- **Após Fase 2:** zero query de projeto reimplementada; readers sobre um DAL único; eval >= baseline. — *Entrega "otimizado" (sem duplicação de camada).*
- **Após Fase 3:** um lar por tool, uma convenção de montagem, build 1× por factory. — *Entrega "bem construído" (sem monólito/bundle-rebuild).*
