# Super Session — Plano de Implementação

Formato LEGO de Design Session: usuário escolhe quais steps usar e em que ordem. `pre_work` e `briefing` são obrigatórios (sempre primeiro e último). Vitor enxerga só os steps da sessão e preenche **um por turno, com confirmação**. Coexiste com Inception e CI sem quebrar nenhum.

Plano dividido em duas frentes independentes:
- **Frente A — UX/UI/Banco** (plumbing pra criar e renderizar Super Sessions).
- **Frente B — Prompt do Vitor** (resolver o problema real: Vitor sabendo escopo + parando de atropelar).

As frentes têm dependência fraca: B precisa de `selectedSteps` no objeto da sessão (item A.2) pra construir o prompt. Fora isso, podem ir em paralelo.

---

## Estado atual (referências)

- **Fonte de steps:** [src/lib/design-session-steps.ts](../src/lib/design-session-steps.ts) (`INCEPTION_STEPS` + `CI_STEPS`).
- **Callers de `getSteps(type)`:**
  - Wizard: [src/app/(dashboard)/design-sessions/[id]/steps/[step]/page.tsx:51](../src/app/(dashboard)/design-sessions/%5Bid%5D/steps/%5Bstep%5D/page.tsx#L51)
  - Prompt: [src/lib/agent/prompt.ts:173](../src/lib/agent/prompt.ts#L173)
- **Hardcodes de `type`:**
  - `totalSteps` em [src/app/api/design-sessions/route.ts:54](../src/app/api/design-sessions/route.ts#L54)
  - Label em [src/components/design-session/wizard-layout.tsx:55](../src/components/design-session/wizard-layout.tsx#L55)
  - Labels em [src/app/(dashboard)/projects/[id]/page.tsx:716,737](../src/app/(dashboard)/projects/%5Bid%5D/page.tsx#L716)
- **Concatenação inteira de seções:** [src/lib/agent/prompt.ts:829](../src/lib/agent/prompt.ts#L829) — 9 strings concatenados sempre, mesmo se step não existe na sessão.
- **Vitor sempre presente:** wizard só esconde chat se `hideSidePanels=true` em [wizard-layout.tsx:196](../src/components/design-session/wizard-layout.tsx#L196). Não precisa gatear por type.

---

## Princípio de coexistência

Não toca em `INCEPTION_STEPS`/`CI_STEPS`/`getSteps(type)`. Adiciona `type: "super"` + coluna `selectedSteps`. Quando `type === "super"`, sistema lê de `selectedSteps`; senão fallback no caminho atual. Inception/CI seguem byte-idênticos no banco e na UI. Auditoria de paridade do prompt fica pra depois — refactor da Frente B mantém ordem e composição original pra inception/CI por construção.

---

# FRENTE A — UX/UI/Banco

Plumbing pra criar Super Session, persistir os steps escolhidos e renderizar o wizard com o array dinâmico.

## A.1. Catálogo de steps unificado

Refatora [src/lib/design-session-steps.ts](../src/lib/design-session-steps.ts) extraindo `STEP_CATALOG: Record<string, StepDef>` como fonte única. `INCEPTION_STEPS`/`CI_STEPS` viram views ordenadas dele.

```ts
export const ALWAYS_FIRST = "pre_work";
export const ALWAYS_LAST = "briefing";

export const SUPER_OPTIONAL_STEPS = [
  "product_vision",
  "scope_definition",
  "personas_journeys",
  "brainstorm",
  "risks_gaps",
  "prioritization",
  "hypotheses",
  "technical_specs",
];

export function getStepsFromKeys(keys: string[]): StepDef[] {
  // dedup, valida contra catálogo, força pre_work no início e briefing no fim,
  // re-indexa (.index = posição final no array)
}

export function getStepsForSession(session: { type: string; selectedSteps: string[] | null }): StepDef[] {
  return session.type === "super" && session.selectedSteps
    ? getStepsFromKeys(session.selectedSteps)
    : getSteps(session.type);
}

export function validateSuperSteps(keys: string[]): { ok: true; normalized: string[] } | { ok: false; error: string } {
  // todas existem no catálogo, sem duplicadas, força pre_work na frente e briefing no fim
}
```

`getStepsForSession` vira o **entry point único**. Callers existentes de `getSteps(type)` migram pra `getStepsForSession(session)`.

## A.2. Migration + tipo

Arquivo `supabase/migrations/20260429_design_session_super.sql`:

```sql
ALTER TABLE "DesignSession" ADD COLUMN "selectedSteps" text[];
COMMENT ON COLUMN "DesignSession"."selectedSteps" IS 'Step keys ordenados quando type=super. NULL = preset por type';
```

**Verificar antes:** se `DesignSession.type` tiver CHECK constraint ou enum restritivo, alterar pra aceitar `"super"`. Se for text livre, segue.

Sem CHECK em `selectedSteps` (catálogo evolui no app). Validação fica no app via `validateSuperSteps`.

Execução conforme [AGENTS.md](../AGENTS.md):

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/20260429_design_session_super.sql
```

Depois regenera [src/lib/supabase/database.types.ts](../src/lib/supabase/database.types.ts).

## A.3. API de criação

[src/app/api/design-sessions/route.ts](../src/app/api/design-sessions/route.ts):

- Aceita `selectedSteps?: string[]` no body.
- Se `type === "super"`: chama `validateSuperSteps(keys)`. Se inválido, 400. `totalSteps = resultado.length`.
- Se `type !== "super"`: ignora `selectedSteps`, mantém branch atual (`totalSteps = body.type === "inception" ? 10 : 5`).

## A.4. Modal de criação

Novo `<SuperSessionModal>` em `src/components/design-session/super-session-modal.tsx`:

- **Lista do catálogo:**
  - `pre_work` fixo no topo (checked, disabled, badge "obrigatório").
  - 8 steps opcionais no meio com checkbox.
  - `briefing` fixo no fim (checked, disabled, badge "obrigatório").
- **Reordenação** dos opcionais marcados: setas up/down (DnD vira issue depois — corta escopo agora).
- **Presets no topo:**
  - **Completa** — todos os 10
  - **Enxuta** — sem `product_vision`, `personas_journeys`, `risks_gaps`
  - **Em branco** — só `pre_work + briefing`
- **Validação:** sem mínimo arbitrário — `pre_work + briefing` (preset Em branco) é válido, são os 2 obrigatórios. Se uma sessão "só descoberta + briefing" faz sentido, deixa rolar.
- **Submit:** POST `/api/design-sessions` com `type: "super"`, `selectedSteps`, `title`.

Trigger: terceiro botão em [projects/[id]/page.tsx:765](../src/app/(dashboard)/projects/%5Bid%5D/page.tsx#L765) (ao lado de "Inception" e "Melhoria Contínua").

## A.5. Wizard

[steps/[step]/page.tsx:51](../src/app/(dashboard)/design-sessions/%5Bid%5D/steps/%5Bstep%5D/page.tsx#L51): troca `getSteps(session.type)` por `getStepsForSession(session)`. Sidebar e progresso são dirigidos pelo array, funcionam automaticamente. GET de session já traz `selectedSteps` se for `select("*")`.

**Verificar:** o switch que renderiza o componente de cada step (`PreWorkStep`, `BrainstormStep` etc.) já bate por `step.key`, então é compatível com Super sem alterações. Confirmar antes de mergear.

## A.6. Labels

- [wizard-layout.tsx:55](../src/components/design-session/wizard-layout.tsx#L55): `super` → "Super Session"
- [projects/[id]/page.tsx:716,737](../src/app/(dashboard)/projects/%5Bid%5D/page.tsx#L716): idem nos cards.

## A.7. Backwards-compat

- Sessões existentes (inception/CI): `selectedSteps = NULL` → fallback no `type`. Zero impacto.
- Eval cases em [src/eval/vitor/](../src/eval/vitor/): todos usam `type: "inception"` → intactos.
- Toda lógica de seleção concentrada em `getStepsForSession`.

## A.8. Ordem de execução — Frente A

1. Migration + types regen.
2. Catálogo unificado + `getStepsForSession` + `validateSuperSteps` (callers ainda chamam `getSteps`).
3. Wizard + API passam a usar `getStepsForSession`.
4. Modal + botão.
5. Smoke: criar Super enxuta, criar Inception em paralelo, abrir as duas no wizard.

**Esforço Frente A:** 4-5h.

---

# FRENTE B — Prompt do Vitor

Resolver os dois problemas que o refactor sozinho não resolve:
1. Vitor não respeita escopo (menciona steps que não existem).
2. Vitor preenche tudo de uma vez em silêncio.

Três mudanças, em ordem de impacto:

## B.1. Lista de steps no topo do system prompt como escopo fechado

Hoje [prompt.ts:812](../src/lib/agent/prompt.ts#L812) tem `Tipo: ${sessionType === "inception" ? ... : ...}` e [prompt.ts:816-817](../src/lib/agent/prompt.ts#L816) lista steps em `## Steps do wizard`. Vitor passa por cima — empiricamente menciona personas em CI sem personas.

**Mudança:** logo após o nome do agente, antes de qualquer outra seção, injeta bloco com framing dura de escopo fechado:

```
## Steps DESTA sessao (escopo fechado)
Esta sessao tem EXATAMENTE estes steps, nesta ordem:
1. pre_work — Pre-Trabalho
2. brainstorm — Brainstorm de Funcionalidades
3. prioritization — Priorizacao & Escopo
4. briefing — Briefing

Regras de escopo:
- Nao mencione, nao sugira, nao tente preencher steps fora desta lista.
- Se o usuario pedir algo que pertenceria a um step ausente (ex: "vamos definir personas" quando personas_journeys nao existe), responda: "Esta sessao nao tem o step de [X]. Quer adicionar como gap pra revisitar, ou seguir sem?"
- Se identificar um gap relevante (ex: usuario falou de persona mas a sessao nao tem persona), registre via add_open_question — nao improvise um preenchimento fantasma.
```

`buildSystemPrompt` recebe `selectedSteps?: string[]` no input. Quando `type === "super"`, monta o bloco com a lista da sessão. Quando `type === "inception"/"ci"`, monta com a lista do preset (mantém comportamento atual + ganha framing de escopo).

A frase sobre `add_open_question` substitui o que a Frente A removeu (sem `dependsOn` declarativo) — confiamos no Vitor pra notar lacuna e registrar como pergunta aberta.

## B.2. Regra 0 em `buildBehaviorRules` — contrato step-a-step

Hoje a regra "preenche step-a-step com confirmação" vive enterrada em [prompt.ts:191-195](../src/lib/agent/prompt.ts#L191-L195) dentro de `preWorkSection` (200+ linhas). Modelo prioriza topo do prompt + tools disponíveis — regra textual no meio é ignorada.

**Mudança:** hoist pra `buildBehaviorRules` ([prompt.ts:110](../src/lib/agent/prompt.ts#L110)) como **Regra 0**, antes de todas as outras:

```
0. **Contrato de preenchimento — UM step por turno, com confirmacao.**
   Voce NUNCA preenche mais de um step por turno. Antes de tocar QUALQUER dado:
   a. Confirme com o usuario qual step quer trabalhar agora (use a lista de "Steps DESTA sessao" acima).
   b. Proponha em texto o que pretende preencher — bullets curtos, decisoes destacadas. Nao chame tools de escrita ainda.
   c. Pergunte: "Posso aplicar?"
   d. So execute set_field/add_item/update_item depois de confirmacao explicita ("ok", "vai", "manda", "aplica").
   e. Apos aplicar UM step, pare. Resuma o que foi feito + pergunte se quer ajustar ou ir pro proximo. Nao encadeie.

   Excecao: tools de leitura (get_step_data, list_*) podem ser chamadas livremente — nao alteram dados.
```

Remove a duplicata em `preWorkSection` (linhas 191-198) — vira referência pra Regra 0. `preWorkSection` segue existindo pra detalhar **o que** preencher em cada step (campo de personas, brainstorm etc.), mas o **contrato de cadência** sai dali e vira regra global.

## B.3. Tool-mediated propose/commit (a parte que de fato resolve)

Regra textual continua sendo regra textual — modelo pode ignorar sob pressão de "preenche tudo pra mim". Travar via tool é o que garante.

**Mudança:** duas tools novas em [src/lib/agent/](../src/lib/agent/) (registrar onde as outras tools de Vitor moram — `tools/` ou similar):

- `propose_step_fill({ stepKey, summary, draft })` — registra proposta em memória da sessão (in-memory ou tabela `DesignSessionProposal` se quiser persistir). Retorna `proposalId`. **Não escreve em `DesignSessionStepData`.**
- `commit_step_fill({ proposalId })` — só executa se UI marcar a proposta como aceita pelo usuário. Aplica `set_field`/`add_item` correspondentes.

UI: a resposta do Vitor mostra o draft + botão "Aplicar" (e "Ajustar"). Click no botão chama `commit_step_fill` ou devolve a conversa pro Vitor com feedback.

System prompt na Regra 0 ganha:

```
   Implementacao tecnica do contrato:
   - Pra propor: chame propose_step_fill com summary + draft estruturado.
   - NUNCA chame set_field/add_item/update_item sem proposalId aceito.
   - O usuario aceita pela UI (botao "Aplicar") ou explicitamente no chat ("aplica essa proposta").
```

**Trade-off:** isso é o item mais caro da Frente B (2-3h), mas é o único que **garante** que Vitor não atropela. Se cortar escopo, mantém B.1 + B.2 e aceita que a regra textual vai falhar 1 em cada N vezes.

## B.4. Refactor de seções por step (cosmético + economia de tokens)

Hoje [prompt.ts:829](../src/lib/agent/prompt.ts#L829) concatena 9 seções incondicionalmente. Numa Super enxuta, Vitor lê instruções de personas/visão/riscos que não existem na sessão.

**Mudança:** vira tabela indexada por step key.

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
const activeSections = steps
  .map(s => sectionByStep[s.key])
  .filter(Boolean)
  .join("");
```

**Importante:** preservar a **ordem de concatenação atual pra inception/CI** — não basta iterar `steps[]` direto porque a ordem hoje é `preWork → briefing → productVision → ...`, diferente da ordem do `INCEPTION_STEPS`. Pra evitar mudar comportamento atual, mantém a ordem original explícita pra `type !== "super"`:

```ts
const fixedOrder = ["pre_work", "briefing", "product_vision", "scope_definition", "personas_journeys", "brainstorm", "risks_gaps", "prioritization", "hypotheses", "technical_specs"];
const order = sessionType === "super" ? steps.map(s => s.key) : fixedOrder;
const activeSections = order.map(k => sectionByStep[k]).filter(Boolean).join("");
```

Inception/CI: byte-idêntico (ordem antiga preservada). Super: ordem da sessão. Auditoria de paridade fica pra depois — por construção, o output pra inception não muda.

## B.5. Ordem topológica do pre_work dinâmica

[prompt.ts:198](../src/lib/agent/prompt.ts#L198) tem string hardcoded `product_vision -> scope_definition -> ...`. Gera de:

```ts
const fillOrder = steps
  .filter(s => s.key !== "pre_work" && s.key !== "briefing")
  .map(s => s.key)
  .join(" -> ");
```

Vitor só lista o que existe na sessão. Trivial mas necessário pra Super enxuta não receber ordem com steps que não existem.

## B.6. Ordem de execução — Frente B

1. **B.4** (refactor `sectionByStep`) — base mecânica, não muda comportamento.
2. **B.5** (fillOrder dinâmico) — trivial, junto com B.4.
3. **B.1** (lista de steps no topo + escopo fechado) — primeiro ganho de comportamento.
4. **B.2** (Regra 0 em `buildBehaviorRules`) — segundo ganho.
5. **B.3** (propose/commit tools) — terceiro e maior ganho. Pode ir em PR separado.

**Esforço Frente B:** 4-6h (B.1+B.2+B.4+B.5 em ~2h, B.3 em 2-4h dependendo de UI).

---

## Smoke test conjunto (depois das duas frentes)

- Criar Super enxuta (`pre_work + brainstorm + prioritization + briefing`).
- Wizard mostra 4 steps na sidebar.
- Abrir Vitor: perguntar "quais steps existem nesta sessão?" → deve listar exatamente esses 4.
- "preenche pra mim" no `pre_work` → Vitor propõe (não aplica), pergunta confirmação. Aceitar via botão → escreve. **Para no primeiro step.** Pergunta se quer próximo.
- Mencionar persona durante a conversa → Vitor responde "esta sessão não tem o step de personas, registro como gap?" e chama `add_open_question`.
- Criar Inception clássica em paralelo → comportamento idêntico ao de hoje (mesma ordem de seções, mesmo fluxo).

---

## Esforço total

- **Frente A:** 4-5h
- **Frente B (sem propose/commit):** 2h
- **Frente B (com propose/commit):** 4-6h

**Total realista:** 8-11h. Frentes podem ir em PRs separados. Frente A entrega a feature visível; Frente B entrega o comportamento que você quer do Vitor.

---

## Decisões pendentes

1. **Nome do type:** `"super"` ou `"custom"`? Plano usa `super`.
2. **Preset "Enxuta":** confirmar exatamente quais 3 steps remover. Plano sugere `product_vision + personas_journeys + risks_gaps`.
3. **B.3 vai junto ou em PR separado?** Recomendo separado — A + B.1/B.2/B.4/B.5 já entrega 80% do valor; propose/commit é o polimento final.
