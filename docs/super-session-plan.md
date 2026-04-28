# Super Session — Plano de Implementação

Formato LEGO de Design Session: o usuário escolhe quais steps usar e em que ordem, com Vitor sempre presente e ciente do conjunto escolhido. Coexiste com Inception e Continuous Improvement sem quebrar nenhum dos dois.

---

## Estado atual (mapeamento)

- **Fonte única dos steps:** [`src/lib/design-session-steps.ts`](../src/lib/design-session-steps.ts) (`INCEPTION_STEPS` + `CI_STEPS`).
- **`getSteps(type)` flui pra 2 lugares:**
  - Wizard: [`src/app/(dashboard)/design-sessions/[id]/steps/[step]/page.tsx:51`](../src/app/(dashboard)/design-sessions/%5Bid%5D/steps/%5Bstep%5D/page.tsx)
  - Prompt do Vitor: [`src/lib/agent/prompt.ts:173`](../src/lib/agent/prompt.ts)
- **Hardcodes de `type`:**
  - `totalSteps` em [`src/app/api/design-sessions/route.ts:54`](../src/app/api/design-sessions/route.ts)
  - Label header em [`src/components/design-session/wizard-layout.tsx:55`](../src/components/design-session/wizard-layout.tsx)
  - Label cards em [`src/app/(dashboard)/projects/[id]/page.tsx:716,737`](../src/app/(dashboard)/projects/%5Bid%5D/page.tsx)
- **Cuidado escondido:** [`prompt.ts:829`](../src/lib/agent/prompt.ts) concatena 9 seções de instrução (uma por step) **incondicionalmente**. Hoje funciona porque inception tem todos os steps. Numa Super Session enxuta isso polui o contexto com instruções de steps que não existem — Vitor falaria de personas mesmo se personas saiu do array.
- **Vitor já é "sempre presente":** o chat só some se `hideSidePanels=true` em [`wizard-layout.tsx:196`](../src/components/design-session/wizard-layout.tsx). Não precisa gatear por type.

---

## Princípio de coexistência

Não toca em `INCEPTION_STEPS`/`CI_STEPS`/`getSteps(type)`. Adiciona `type: "super"` novo + coluna `selectedSteps`. Quando `type === "super"`, o sistema lê de `selectedSteps`; senão, fallback no caminho atual. Inception/CI seguem byte-idênticos.

---

## 1. Catálogo unificado

Refatora [`src/lib/design-session-steps.ts`](../src/lib/design-session-steps.ts) extraindo um `STEP_CATALOG: Record<string, StepDef>` como fonte única. `INCEPTION_STEPS`/`CI_STEPS` viram views ordenadas dele. Adiciona:

```ts
export const ALWAYS_FIRST = "pre_work";
export const ALWAYS_LAST = "briefing";

export function getStepsFromKeys(keys: string[]): StepDef[] {
  // dedup, valida contra catálogo, força pre_work no início e briefing no fim,
  // re-indexa (.index = posição final no array)
}

export function getStepsForSession(session: { type: string; selectedSteps: string[] | null }): StepDef[] {
  return session.type === "super" && session.selectedSteps
    ? getStepsFromKeys(session.selectedSteps)
    : getSteps(session.type);
}
```

Esse vira o **novo entry point único**. Callers existentes de `getSteps(type)` migram pra `getStepsForSession(session)`.

---

## 2. Migration

`supabase/migrations/20260429_design_session_super.sql`:

```sql
ALTER TABLE "DesignSession" ADD COLUMN "selectedSteps" text[];
COMMENT ON COLUMN "DesignSession"."selectedSteps" IS 'Step keys ordenados quando type=super. NULL = preset por type';
```

Sem CHECK em keys (catálogo evolui no app). Validação fica no app. Regenera [`src/lib/supabase/database.types.ts`](../src/lib/supabase/database.types.ts) depois.

Execução conforme [`AGENTS.md`](../AGENTS.md):

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/20260429_design_session_super.sql
```

---

## 3. API

[`src/app/api/design-sessions/route.ts`](../src/app/api/design-sessions/route.ts):

- Aceita `selectedSteps?: string[]` no body.
- Se `type === "super"`: chama `validateSuperSteps(keys)` — todos existem no catálogo, sem duplicadas, força `pre_work` na frente e `briefing` no fim. `totalSteps = resultado.length`.
- Se `type !== "super"`: ignora `selectedSteps`, mantém branch atual (`totalSteps = body.type === "inception" ? 10 : 5`).

`validateSuperSteps` é função pura em `design-session-steps.ts`, importável tanto pelo route handler quanto pelo modal.

---

## 4. Vitor dinâmico — coração do plano

Três mudanças em [`src/lib/agent/prompt.ts`](../src/lib/agent/prompt.ts):

### 4a. Steps via session, não via type
`buildSystemPrompt` passa a aceitar `selectedSteps?: string[]`. Internamente:

```ts
const steps = selectedSteps
  ? getStepsFromKeys(selectedSteps)
  : getSteps(sessionType);
```

### 4b. Seções por step viram tabela
Hoje [`prompt.ts:829`](../src/lib/agent/prompt.ts) concatena 9 seções fixas. Refatora pra:

```ts
const sectionByStep: Record<string, string> = {
  pre_work: preWorkSection,
  product_vision: productVisionSection,
  scope_definition: scopeDefinitionSection,
  personas_journeys: personasSection,
  brainstorm: brainstormSection,
  risks_gaps: risksGapsSection,
  prioritization: prioritizationSection,
  hypotheses: hypothesesSection,
  technical_specs: technicalSpecsSection,
  briefing: briefingSection,
};
const activeSections = steps.map(s => sectionByStep[s.key]).filter(Boolean).join("");
```

Pra inception/CI, resultado **byte-idêntico** ao atual (todas as seções já estão no array). Pra super enxuta, Vitor só recebe instruções dos steps que existem — economia de tokens + zero alucinação sobre steps removidos.

### 4c. Ordem topológica do pre_work dinâmica
[`prompt.ts:198`](../src/lib/agent/prompt.ts) tem string hardcoded `product_vision -> scope_definition -> ...`. Gera de:

```ts
const fillOrder = steps
  .filter(s => s.key !== "pre_work" && s.key !== "briefing")
  .map(s => s.key)
  .join(" -> ");
```

Vitor só preenche o que existe na sessão.

### 4d. Label do tipo
[`prompt.ts:812`](../src/lib/agent/prompt.ts): adiciona ramo `"super"` →

```
"Super Session (steps customizados: ${steps.map(s => s.key).join(', ')})"
```

Vitor lista explicitamente o conjunto da sessão atual.

---

## 5. Modal de criação

Novo `<SuperSessionModal>` em `src/components/design-session/super-session-modal.tsx`:

- **Lista do catálogo.** `pre_work` e `briefing` aparecem fixos (checked, disabled, com badge "obrigatório") no topo e fim. Os outros 8 steps no meio com checkbox.
- **Reordenação:** setas up/down nos steps marcados (entrega rápida; DnD vira issue depois).
- **Presets no topo:**
  - **Completa** — todos os 10
  - **Enxuta** — sem `product_vision`, `personas_journeys`, `risks_gaps`
  - **Em branco** — só os obrigatórios
- **Validação:** mínimo 3 steps (pre_work + 1 + briefing). Botão "Criar" disabled senão.
- **Submit:** POST `/api/design-sessions` com `type: "super"`, `selectedSteps`, `title`.

Trigger: terceiro botão em [`projects/[id]/page.tsx:765`](../src/app/(dashboard)/projects/%5Bid%5D/page.tsx) (ao lado de "Inception" e "Melhoria Contínua").

---

## 6. Wizard

[`steps/[step]/page.tsx:51`](../src/app/(dashboard)/design-sessions/%5Bid%5D/steps/%5Bstep%5D/page.tsx): troca `getSteps(session.type)` por `getStepsForSession(session)`. Sidebar e progresso já são dirigidos pelo array, funcionam automaticamente. GET de session já vai trazer `selectedSteps` se for `select("*")`.

---

## 7. Labels minor

- [`wizard-layout.tsx:55`](../src/components/design-session/wizard-layout.tsx): `super` → "Super Session"
- [`projects/[id]/page.tsx:716`](../src/app/(dashboard)/projects/%5Bid%5D/page.tsx) e `:737`: idem
- `prompt.ts:812`: já coberto em 4d

---

## 8. Backwards-compat (verificada)

- Sessões existentes (inception/CI): `selectedSteps = NULL` → fallback no `type`. Zero impacto.
- Eval cases em `src/eval/vitor/`: todos usam `type: "inception"` → intactos.
- Nenhum if dispersado a procurar — toda a lógica concentrada em `getStepsForSession` e no `sectionByStep`.

---

## 9. Ordem de execução (sequência segura)

1. Migration + types regen.
2. Catálogo unificado + `getStepsForSession` (callers ainda chamam `getSteps`).
3. Refactor `sectionByStep` no prompt — testa com Inception clássica, prompt deve sair equivalente. **Importante validar aqui antes de seguir.**
4. Wizard e prompt passam a usar `getStepsForSession`.
5. API aceita `selectedSteps` + `validateSuperSteps`.
6. Modal + botão.
7. Smoke test.

---

## 10. Smoke test

- Criar Super enxuta (`pre_work` + `brainstorm` + `prioritization` + `briefing`).
- Wizard mostra 4 steps na sidebar.
- Abrir Vitor, perguntar "quais steps existem nesta sessão?" — deve listar só esses 4.
- Pedir "preenche pra mim" no `pre_work` — Vitor deve seguir ordem `brainstorm -> prioritization` e não mencionar personas/visão/riscos.
- Criar Inception clássica em paralelo — comportamento idêntico ao de hoje.

---

## Esforço

- **~3h** ponta-a-ponta com setas up/down.
- **+1h** se quiser DnD (`@dnd-kit/sortable`).

---

## Decisões pendentes

1. **Nome do type:** `"super"` (combina com seu termo) ou `"custom"`?
2. **`pre_work` obrigatório?** Sugiro travar como `briefing` — é onde Vitor coleta contexto inicial.
3. **Setas up/down agora, DnD depois?** Ou DnD já no v1?
4. **Preset "Enxuta" = remover `product_vision` + `personas_journeys` + `risks_gaps`?** Confirma que esses 3 são os exatos.
