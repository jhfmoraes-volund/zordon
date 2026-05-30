---
status: draft
owner: João Moraes
date: 2026-05-29
domain: agents / vitor
parent_prd: prd-vitor-output-as-prd.md (vision)
codenames:
  - vitor-discovery-only
references:
  - docs/prd/backlog/prd-vitor-output-as-prd.md
  - src/lib/agent/agents/vitor/index.ts
  - src/lib/agent/prompt.ts
  - src/lib/agent/tools.ts
  - src/lib/design-sessions/constants.ts
---

# PRD — Vitor discovery-only (prompt cleanup + sub-phases rename)

> **TL;DR:** Tools de mutação de UserStory/Task/AC já foram **removidos do toolset do Vitor** via flag `vitorAsPm: true`, mas o **prompt e o constants ainda referenciam esses tools extensivamente**. Resultado: o modelo recebe instrução pra chamar tools que não existem mais. Este PRD limpa o prompt, renomeia as sub-phases do briefing pra refletir o novo escopo (PRD-only), e renomeia "Story Tree" → "PRD Tree" na UI. Slice A do macro PRD `prd-vitor-output-as-prd`.

---

## 1. Problema

### 1.1 Estado atual (verificado em 2026-05-29)

- **Toolset:** `src/lib/agent/tools.ts:119-135` filtra os tools `create_user_story / update_user_story / set_story_refinement / manage_story_ac / delete_user_story / create_task / update_task / delete_task` quando `capabilities.vitorAsPm = true`. O agente Vitor seta essa flag em `src/lib/agent/agents/vitor/index.ts:239`. ✅
- **PRD tools:** Vitor tem `propose_prd / update_prd / approve_prd / link_prd_dependency / list_prds` em `src/lib/agent/agents/vitor/index.ts:246-348`. ✅
- **Prompt:** `src/lib/agent/prompt.ts` (1536 linhas) tem **26+ referências** aos tools removidos. Exemplos:
  - Linha 141: lista `create_user_story`, `create_task`, `manage_story_ac`, `set_story_refinement` como tools nivel 2.
  - Linhas 365-384: seção "AC de Produto / AC Tecnico" instrui usar `create_user_story.acceptanceCriteriaProduct` e `create_task.acceptanceCriteria`.
  - Linhas 556-579 (sub-phase STORY_TREE): "chame `create_user_story` para CADA story".
  - Linhas 609-620 (sub-phase STORY_DETAIL): "chame `create_user_story` (idempotente)".
  - Linhas 651-720 (sub-phase TASK_BREAKDOWN): bloco inteiro sobre `create_task`, FP, scope, complexity.
  - Linhas 760-847: exemplos com `create_user_story(...)` e `create_task(...)`.
- **Sub-phases:** `src/lib/design-sessions/constants.ts:10-22` define `MODULE_DISCOVERY / STORY_TREE / STORY_DETAIL / TASK_BREAKDOWN`. Sem US/Task, três delas estão obsoletas.
- **UI:** `src/components/design-session/design-session-tree.tsx` exibe "Story Tree" — termo obsoleto, Vitor agora produz PRDs.

### 1.2 Três dores concretas

1. **Modelo recebe instrução inconsistente.** Prompt manda `create_user_story`; toolset não tem a tool → modelo erra (tool-off-topic ou alucina argumentos). Já capturado em calibração informal.
2. **Cognitive load do prompt.** 1536 linhas, ~30% sobre conceitos mortos (US/Task/AC/FP/scope/complexity). Inflar contexto degrada qualidade (regra Anthropic: schema strictness > prompt strictness).
3. **UX dissonante.** PM abre DS, vê "Story Tree", espera ver UserStory; encontra PRDs. Termo errado quebra modelo mental.

### 1.3 Princípio

> **"Não modifique prompt/tool/schema sem capture aberto."** — AGENTS.md "Calibração contínua"

Este PRD trata o capture implícito: prompt-toolset divergence detectada em audit estático.

---

## 2. Solução em uma frase

**Reescrever as 3 sub-phases obsoletas do prompt do Vitor (STORY_TREE → PRD_DRAFTING, STORY_DETAIL → PRD_REVIEW, TASK_BREAKDOWN → removido), atualizar enum `BRIEFING_SUB_PHASES`, renomear "Story Tree" → "PRD Tree" na UI, e adicionar regression test que assegura prompt sem referências aos tools removidos.**

---

## 3. Não-objetivos

- **Não** mexer em `propose_prd / update_prd / approve_prd` (já funcionam).
- **Não** mexer em DSs antigas com US/Task criadas pelo Vitor legacy. Migração de Zelar v2 fica pro slice futuro.
- **Não** mudar schema de banco. PRD aqui é só prompt + constants + UI labels.
- **Não** alterar a sub-phase `MODULE_DISCOVERY` — continua igual.
- **Não** redesenhar o fluxo conceitual do briefing — só renomear+limpar prompt. Redesign do fluxo é trabalho de PM separado.
- **Não** mexer no `hierarchy-tree.tsx` (componente diferente, usado em outros lugares).

---

## 4. Personas e jornada

### 4.1 PM (João) rodando DS Inception

> "Termino o brainstorm. Vitor entra no briefing. Antes via 'Story Tree' aparecer ao lado, e ele ia criando US uma a uma. Agora quero ver 'PRD Tree' — ele cria PRDs (1 por functionality). Quando clico num PRD, vejo briefing completo. Aprovo seção por seção. Sem TaskBreakdown sub-phase — tasks não existem aqui."

### 4.2 Vitor agent (rodando briefing step)

> "Pre-mudança: meu prompt diz pra chamar `create_user_story` e `create_task` — mas o toolset não tem. Erro. Pós-mudança: prompt diz `propose_prd` + `approve_prd` em PRD_DRAFTING/PRD_REVIEW. Tools batem. Output coerente."

### 4.3 Dev na calibração

> "Hoje quando vou debugar Vitor, leio 1500 linhas de prompt onde 30% é sobre tools mortas. Pós-mudança: prompt enxuto, fluxo PRD claro, fica óbvio onde mexer."

---

## 5. Decisões fixadas

| ID | Decisão | Escolha | Por quê |
|---|---|---|---|
| **D1** | Renomear sub-phases do briefing | `STORY_TREE → PRD_DRAFTING`, `STORY_DETAIL → PRD_REVIEW`, `TASK_BREAKDOWN` removido, `MODULE_DISCOVERY` mantido | Vitor produz PRDs, não US/Task. TASK_BREAKDOWN é responsabilidade da Vitoria (slice C). |
| **D2** | Container UI "Story Tree" | Renomear pra "PRD Tree" (label + a11y + filename `design-session-tree.tsx` mantém o nome do arquivo; só o texto exibido muda) | Modelo mental do PM precisa bater com o output do Vitor. Filename preserva pra não criar churn em imports. |
| **D3** | DSs antigas (Zelar v2) | Não tocar neste slice — US/Task criadas no passado permanecem no banco | Migração é decisão à parte (Fase 4 do macro PRD). Slice A é purgativo, não destrutivo. |
| **D4** | Migração de `briefingSubPhase` em rows existentes | Rows com `briefingSubPhase IN ('story_tree','story_detail','task_breakdown')` ficam como estão (legacy). Próximas sessões usam novos valores | Sem migration SQL — coluna é text, novas DSs adotam novos valores. DSs antigas raramente são reabertas. |
| **D5** | Exemplos no prompt (linhas 760-847) | Substituir todos por exemplos `propose_prd(...)` com PRD completo (problem ≥50 chars, ≥3 AC) | Few-shot examples ditam comportamento do modelo. Exemplos errados = output errado. |
| **D6** | AC de Produto / AC Técnico (linhas 365-384) | Substituir por instrução única: "AC viram array `acceptanceCriteria` dentro do PRD (jsonb `{given, when, then}`)" | PRD absorve a distinção produto/técnico via `technicalNotes` separado. |
| **D7** | Regression test | Adicionar `src/eval/vitor/prompt-tools-coherence.test.ts` que faz grep do prompt e assertfalla se contém substrings dos tools removidos | Sem teste, prompt drift volta. CI bloqueia regressão. |
| **D8** | Compat `pickVerbosity` em vitor/index.ts | Função aceita os 2 valores novos. Valores legacy mapeiam pra `discovery` (fallback) | Sessões antigas reabertas com briefingSubPhase=story_tree não quebram. |

---

## 6. Arquitetura

### 6.1 Componentes tocados

```
┌──────────────────────────────────────────────────────────────────┐
│  src/lib/design-sessions/constants.ts                            │
│    BRIEFING_SUB_PHASES enum (rename STORY_TREE→PRD_DRAFTING etc) │
│    ALL_BRIEFING_SUB_PHASES array (rebuild)                       │
└──────────────────────────────────────────────────────────────────┘
                          ↓ imported by
┌──────────────────────────────────────────────────────────────────┐
│  src/lib/agent/agents/vitor/index.ts                             │
│    pickVerbosity() — switch case: novos valores + fallback legacy│
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  src/lib/agent/prompt.ts (1536 linhas)                           │
│    Reescrever 4 seções:                                          │
│      - Sub-phase STORY_TREE  → PRD_DRAFTING                      │
│      - Sub-phase STORY_DETAIL → PRD_REVIEW                       │
│      - Sub-phase TASK_BREAKDOWN → remover                        │
│      - Exemplos (criação) → propose_prd                          │
│      - AC de Produto/Técnico → AC dentro do PRD                  │
│      - Linha 141 (tools nivel 2) → remover refs antigas          │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  src/components/design-session/design-session-tree.tsx           │
│    Trocar todos labels "Story Tree" / "stories" por "PRD Tree"   │
│    / "PRDs" no contexto do header e empty state                  │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│  src/eval/vitor/prompt-tools-coherence.test.ts (NOVO)            │
│    Vitest: import buildSystemPrompt + assert ausência das tools  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Fluxo end-to-end pós-mudança

```
DS Inception → step "briefing":
  ↓
  sub-phase MODULE_DISCOVERY (inalterada): Vitor chama propose_modules + approve_module
  ↓
  sub-phase PRD_DRAFTING (nova): Vitor chama list_prds + propose_prd em lote (1 por functionality)
  ↓
  sub-phase PRD_REVIEW (nova): Vitor chama update_prd / approve_prd guiado pelo PM
  ↓
  step "briefing" completa → DS para approval
```

---

## 7. Schema

**Sem migration SQL.** Coluna `DesignSession.briefingSubPhase` já é `text` (nullable). Valores novos coexistem com legacy. Sem CHECK constraint a adicionar (não restringimos os valores na DB — enum vive em TS).

Se no futuro quisermos restringir, fica como follow-up:
```sql
-- não rodar agora — só anotado
ALTER TABLE "DesignSession"
ADD CONSTRAINT briefing_subphase_check
CHECK (briefingSubPhase IN ('module_discovery', 'prd_drafting', 'prd_review',
                            'story_tree', 'story_detail', 'task_breakdown'));
```

---

## 8. APIs

**Sem mudança de endpoint.** O endpoint que persiste `briefingSubPhase` (provavelmente `PATCH /api/design-sessions/[id]`) aceita string, então os novos valores passam sem schema change.

---

## 9. UX

### 9.1 Antes (Story Tree)

```
┌──────────────────────────────────────────┐
│ Design Session "Inception Zelar"         │
│ Step: Briefing · sub-phase: STORY_TREE   │
├──────────────────────────────────────────┤
│  [Story Tree]                            │
│  📁 Auth                                 │
│    📝 US-001 Login com email             │
│    📝 US-002 Recuperar senha             │
│  📁 Onboarding                           │
│    📝 US-003 Wizard de cadastro          │
└──────────────────────────────────────────┘
```

### 9.2 Depois (PRD Tree)

```
┌──────────────────────────────────────────┐
│ Design Session "Inception Zelar"         │
│ Step: Briefing · sub-phase: PRD_DRAFTING │
├──────────────────────────────────────────┤
│  [PRD Tree]                              │
│  📁 Auth                                 │
│    📄 EVZL-PRD-001 Login com email [⊙]   │
│    📄 EVZL-PRD-002 Recuperar senha [⊙]   │
│  📁 Onboarding                           │
│    📄 EVZL-PRD-003 Wizard cadastro [✓]   │
│                                          │
│  Legenda: ⊙ draft  ✓ approved            │
└──────────────────────────────────────────┘
```

Mudanças visuais:
- Header: "Story Tree" → "PRD Tree"
- Itens-folha: `📝 US-NNN` → `📄 EVZL-PRD-NNN`
- Chip de status (já existe via StatusChip): aplicar à row do PRD

---

## 10. Integrações

- **DS Inception/CI** — sub-phases passam pelos novos nomes. UI do tab "Step" deve refletir.
- **Calibração** (`/calibrate vitor`) — runbook `docs/runbooks/agent-audits/vitor-audit-v1.md` precisa atualizar cenários V0..V_NN que mencionam tools antigas. **Fora do escopo deste PRD** — anotar como follow-up.
- **PRD Wiki composer** (`prd-project-wiki.md` em blocked/) — não afetado; lê PRDs aprovados independente do prompt.

---

## 11. Faseamento

**Fase única.** Slice é pequeno e atômico — 8 stories, ~3h totais de implementação. Não faz sentido dividir mais.

A Fase 1 entrega **mais que o sistema atual**: prompt coerente com toolset, UI alinhada ao output. Sistema atual está quebrado (prompt manda tool inexistente).

---

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| DS antiga reabre com `briefingSubPhase='story_tree'` e quebra `pickVerbosity` | Média | Baixo | D8: fallback `default: discovery` em pickVerbosity; smoke test reabrindo DS antiga |
| Reescrita do prompt remove instrução crítica não-óbvia | Média | Médio | Diff-review story-by-story; teste manual com Vitor numa DS fresh entre cada story |
| Regression test (D7) fica frágil (string match exato) | Baixa | Baixo | Test usa `expect(prompt).not.toMatch(/\bcreate_user_story\b/)` — match de palavra, não substring |
| Rename "Story Tree" → "PRD Tree" quebra teste de UI/snapshot | Baixa | Baixo | Atualizar snapshots junto com label change |
| Vitor sem TASK_BREAKDOWN sub-phase fica sem guidance pra finalizar briefing | Média | Médio | PRD_REVIEW vira sub-phase terminal — prompt instrui "step completo quando todos PRDs estão approved" |

---

## 13. Métricas de sucesso

| Métrica | Instrumento | Baseline | Target |
|---|---|---|---|
| Refs a tools removidos no prompt | `grep -cE '\b(create_user_story\|create_task\|manage_story_ac\|set_story_refinement\|update_user_story\|delete_user_story\|update_task\|delete_task)\b' src/lib/agent/prompt.ts` | 26+ | **0** |
| Linhas do prompt.ts | `wc -l src/lib/agent/prompt.ts` | 1536 | ≤1300 (remover blocos mortos sem inflar substituição) |
| Erro tool-not-found em logs do Vitor (1 semana pós-deploy) | Query em `AgentCalibrationCapture WHERE agent='vitor' AND category='tool-off-topic' AND createdAt > deploy_date` | n/a (não medido) | 0 capturas dessa categoria |
| Test `prompt-tools-coherence` em CI | `pnpm vitest run src/eval/vitor/prompt-tools-coherence.test.ts` | n/a | passa |

---

## 14. Open questions

(vazio — todas resolvidas em §5)

---

## 15. Referências

- Macro PRD (visão): [docs/prd/backlog/prd-vitor-output-as-prd.md](../backlog/prd-vitor-output-as-prd.md)
- Toolset filter: [src/lib/agent/tools.ts:119-135](../../../src/lib/agent/tools.ts#L119-L135)
- Vitor agent: [src/lib/agent/agents/vitor/index.ts](../../../src/lib/agent/agents/vitor/index.ts)
- Prompt: [src/lib/agent/prompt.ts](../../../src/lib/agent/prompt.ts)
- Sub-phases: [src/lib/design-sessions/constants.ts](../../../src/lib/design-sessions/constants.ts)
- UI tree: [src/components/design-session/design-session-tree.tsx](../../../src/components/design-session/design-session-tree.tsx)
- Memory: `project_vitor_as_pm.md`

---

## 16. Stories implementáveis

```yaml
- id: VTRDISC-001
  title: Renomear BRIEFING_SUB_PHASES (constants + ALL_BRIEFING_SUB_PHASES)
  description: |
    Em src/lib/design-sessions/constants.ts: renomear STORY_TREE→PRD_DRAFTING,
    STORY_DETAIL→PRD_REVIEW. Remover TASK_BREAKDOWN. Atualizar
    ALL_BRIEFING_SUB_PHASES array e DEFAULT_BRIEFING_SUB_PHASE. Não muda valores
    de string ainda (manter "story_tree" como string interna se necessário)?
    Decidido D1: muda valores também — "prd_drafting", "prd_review". MODULE_DISCOVERY
    inalterado.
  acceptanceCriteria:
    - "src/lib/design-sessions/constants.ts exporta BRIEFING_SUB_PHASES com chaves: MODULE_DISCOVERY, PRD_DRAFTING, PRD_REVIEW"
    - "Valores: 'module_discovery', 'prd_drafting', 'prd_review'"
    - "ALL_BRIEFING_SUB_PHASES tem 3 entradas na ordem: MODULE_DISCOVERY → PRD_DRAFTING → PRD_REVIEW"
    - "Sem referência a STORY_TREE / STORY_DETAIL / TASK_BREAKDOWN em constants.ts"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'STORY_TREE|STORY_DETAIL|TASK_BREAKDOWN' src/lib/design-sessions/constants.ts"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE 'PRD_DRAFTING|PRD_REVIEW' src/lib/design-sessions/constants.ts"
      expected: ">=2"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - src/lib/design-sessions/constants.ts

- id: VTRDISC-002
  title: Atualizar pickVerbosity em vitor/index.ts pra novas sub-phases
  description: |
    Em src/lib/agent/agents/vitor/index.ts, função pickVerbosity:
    - case BRIEFING_SUB_PHASES.PRD_DRAFTING → return "refinement" (era STORY_TREE)
    - case BRIEFING_SUB_PHASES.PRD_REVIEW → return "execution" (era STORY_DETAIL/TASK_BREAKDOWN)
    - default: return "discovery" (fallback pra DSs antigas com valores legacy)
  acceptanceCriteria:
    - "pickVerbosity reconhece PRD_DRAFTING e PRD_REVIEW"
    - "Default fallback mapeia valores legacy ('story_tree' etc.) pra 'discovery'"
    - "Sem refs a STORY_TREE/STORY_DETAIL/TASK_BREAKDOWN nas variáveis do switch"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'BRIEFING_SUB_PHASES.STORY_TREE|BRIEFING_SUB_PHASES.STORY_DETAIL|BRIEFING_SUB_PHASES.TASK_BREAKDOWN' src/lib/agent/agents/vitor/index.ts"
      expected: "0"
  dependsOn: [VTRDISC-001]
  estimateMinutes: 10
  touches:
    - src/lib/agent/agents/vitor/index.ts

- id: VTRDISC-003
  title: Reescrever seção "Sub-phase STORY_TREE" no prompt → PRD_DRAFTING (com checklist de qualidade)
  description: |
    Em src/lib/agent/prompt.ts, identificar bloco que descreve sub-phase STORY_TREE
    (linhas ~543-590 hoje). Reescrever pra PRD_DRAFTING com REQUISITOS DUROS de
    qualidade — cada PRD gerado pelo Vitor deve absorver TUDO que foi levantado
    no processo da DS:

    Fluxo passo-a-passo (deve estar explícito no prompt):
    1. `list_prds({})` — checar duplicatas no projeto.
    2. `read_session_memory({})` — puxar memória estruturada (decisões, research).
    3. Pra cada functionality identificada no brainstorm:
       a. Identificar grupo de cards do brainstorm (`bs#ids`) que originam ela.
       b. Identificar decisões ativas relacionadas (já vêm em activeDecisions do contexto).
       c. Identificar personas afetadas (já vêm em existingPersonas).
       d. Compor PRD com todos os campos preenchidos, garantindo grounding nos artefatos.
    4. `propose_prd(...)` em lote.

    Checklist obrigatório de qualidade (deve estar no prompt como REGRA DURA):
    - **sourceCardIds[] NÃO PODE ser vazio** — sempre referenciar ≥1 `bs#id` do brainstorm
    - **problem** deve mencionar a dor concreta levantada nos cards (não abstração)
    - **personaIds[]** vem das personas existentes da DS (não inventar)
    - **userJourney** deve refletir a jornada discutida no brainstorm/prioritization
    - **acceptanceCriteria** ≥3, formato `{given, when, then}` específico (não placeholder)
    - **technicalNotes** cita decisões ativas relevantes por ID quando aplicável (ex: "Conforme decisão D7: usar Supabase Realtime...")
    - **successMetrics** com baseline (se conhecido) e target
    - **risksAndAssumptions** com pelo menos 1 risco e 1 assumption do processo

    Manter regras existentes:
    - "8 linhas máx no chat antes de tools"
    - Idempotência: propose_prd com mesmo (projectId, title) atualiza em vez de duplicar (verificar se prd-schemas já garante isso; senão anotar como follow-up)

    Exemplo few-shot completo (1 PRD do Zelar) com todos os campos populados e
    grounding visível: sourceCardIds com 3 bs#ids, technicalNotes citando D-NN,
    personaIds não-vazio.
  acceptanceCriteria:
    - "Bloco STORY_TREE substituído por seção PRD_DRAFTING"
    - "Seção menciona tools: list_prds, read_session_memory, propose_prd (não create_user_story/create_task)"
    - "Checklist de qualidade presente com 8 bullets (sourceCardIds, problem grounded, personaIds, userJourney, AC formato dado/quando/então, technicalNotes cita decisões, successMetrics com target, risksAndAssumptions ≥1 cada)"
    - "Exemplo few-shot completo com sourceCardIds não-vazio (≥2 ids), technicalNotes referenciando decisão por ID"
    - "Prompt instrui explicitamente: 'sourceCardIds NÃO PODE ser vazio'"
  verifiable:
    - kind: sql
      command_or_query: "grep -cE 'Sub-phase STORY_TREE|sub-phase story_tree' src/lib/agent/prompt.ts"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE 'Sub-phase PRD_DRAFTING|sub-phase prd_drafting' src/lib/agent/prompt.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'sourceCardIds.*N[AÃ]O PODE|sourceCardIds.*obrigat[óo]rio|sourceCardIds.*n[aã]o[- ]vazio' src/lib/agent/prompt.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'read_session_memory' src/lib/agent/prompt.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'bs#[0-9a-z]+' src/lib/agent/prompt.ts"
      expected: ">=2"
  dependsOn: [VTRDISC-001]
  estimateMinutes: 30
  touches:
    - src/lib/agent/prompt.ts

- id: VTRDISC-004
  title: Reescrever seção "Sub-phase STORY_DETAIL" no prompt → PRD_REVIEW
  description: |
    Em src/lib/agent/prompt.ts, bloco STORY_DETAIL (linhas ~595-630 hoje).
    Reescrever pra PRD_REVIEW: fluxo é update_prd (ajustes) + approve_prd
    (quando PM aprova). Sub-phase terminal — instruir "step briefing completo
    quando todos PRDs candidatos estão approved".
  acceptanceCriteria:
    - "Bloco STORY_DETAIL substituído por PRD_REVIEW"
    - "Menciona update_prd e approve_prd; remove create_user_story (idempotente etc.)"
    - "Instrução de terminação do step presente"
  verifiable:
    - kind: sql
      command_or_query: "grep -cE 'Sub-phase STORY_DETAIL|sub-phase story_detail' src/lib/agent/prompt.ts"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE 'Sub-phase PRD_REVIEW|sub-phase prd_review' src/lib/agent/prompt.ts"
      expected: ">=1"
  dependsOn: [VTRDISC-001]
  estimateMinutes: 25
  touches:
    - src/lib/agent/prompt.ts

- id: VTRDISC-005
  title: Remover seção "Sub-phase TASK_BREAKDOWN" do prompt
  description: |
    Em src/lib/agent/prompt.ts, bloco TASK_BREAKDOWN (linhas ~635-855 hoje —
    inclui blocos de exemplo de create_task com FP/scope/complexity). Remover
    inteiro. Não substituir — TASK_BREAKDOWN deixa de existir como sub-phase
    (D1). Tasks são responsabilidade da Vitoria, não do Vitor.
  acceptanceCriteria:
    - "Sem referência a 'Sub-phase TASK_BREAKDOWN' no prompt"
    - "Sem refs a create_task / set_story_refinement / FP/scope/complexity (no contexto Vitor)"
    - "Prompt tem ≥200 linhas a menos que o estado pré-story"
  verifiable:
    - kind: sql
      command_or_query: "grep -cE 'Sub-phase TASK_BREAKDOWN|TASK_BREAKDOWN' src/lib/agent/prompt.ts"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE '\\bcreate_task\\b|\\bset_story_refinement\\b' src/lib/agent/prompt.ts"
      expected: "0"
  dependsOn: [VTRDISC-001]
  estimateMinutes: 20
  touches:
    - src/lib/agent/prompt.ts

- id: VTRDISC-006
  title: Substituir blocos de exemplo (create_user_story/create_task) por propose_prd
  description: |
    Em src/lib/agent/prompt.ts, linhas ~750-855 (blocos "→ create_user_story(...)"
    e "→ create_task(...)"). Substituir por 2-3 exemplos completos de
    propose_prd com PRD completo: title, oneLiner, problem (≥50 chars), goal,
    personaIds (placeholders), userJourney (2-3 steps), acceptanceCriteria
    (≥3 given/when/then), successMetrics, outOfScope, technicalNotes,
    risksAndAssumptions. Realista, derivado de Zelar.
  acceptanceCriteria:
    - "Sem '→ create_user_story(' ou '→ create_task(' no prompt"
    - "Pelo menos 1 exemplo '→ propose_prd(' presente com todos campos obrigatórios"
  verifiable:
    - kind: sql
      command_or_query: "grep -cE '→ create_user_story\\(|→ create_task\\(' src/lib/agent/prompt.ts"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE '→ propose_prd\\(' src/lib/agent/prompt.ts"
      expected: ">=1"
  dependsOn: [VTRDISC-003, VTRDISC-004, VTRDISC-005]
  estimateMinutes: 25
  touches:
    - src/lib/agent/prompt.ts

- id: VTRDISC-007
  title: Atualizar seção "AC de Produto / AC Técnico" no prompt
  description: |
    Em src/lib/agent/prompt.ts, linhas ~360-390 (bloco "AC de Produto vai em
    create_user_story.acceptanceCriteriaProduct" / "AC Tecnico vai em
    create_task.acceptanceCriteria"). Substituir por instrução única:
    "Acceptance Criteria viram array jsonb dentro do PRD (campo
    acceptanceCriteria, formato {given, when, then}). Notas técnicas vão em
    campo technicalNotes separado." Remover distinção produto/técnico.
  acceptanceCriteria:
    - "Sem 'acceptanceCriteriaProduct' no prompt"
    - "Sem 'AC Tecnico' / 'AC Tecnico (vai em create_task' no prompt"
    - "Menção a 'acceptanceCriteria' (campo do PRD) presente com formato given/when/then"
  verifiable:
    - kind: sql
      command_or_query: "grep -cE 'acceptanceCriteriaProduct|AC Tecnico|AC de Produto.*create_user_story' src/lib/agent/prompt.ts"
      expected: "0"
  dependsOn: [VTRDISC-001]
  estimateMinutes: 15
  touches:
    - src/lib/agent/prompt.ts

- id: VTRDISC-008
  title: Renomear "Story Tree" → "PRD Tree" em design-session-tree.tsx
  description: |
    Em src/components/design-session/design-session-tree.tsx: localizar e
    trocar labels visíveis "Story Tree" → "PRD Tree", "stories" → "PRDs" (no
    contexto do header/empty state — não em variáveis de código nem props).
    Filename do componente PERMANECE design-session-tree.tsx (D2 — sem churn
    de imports). Atualizar aria-label e empty state.
  acceptanceCriteria:
    - "Texto exibido 'Story Tree' não aparece mais no componente"
    - "Texto exibido 'PRD Tree' presente no header"
    - "aria-label / role corretos"
  verifiable:
    - kind: sql
      command_or_query: "grep -cE 'Story Tree|story tree' src/components/design-session/design-session-tree.tsx"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE 'PRD Tree|PRDs' src/components/design-session/design-session-tree.tsx"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - src/components/design-session/design-session-tree.tsx

- id: VTRDISC-009
  title: Adicionar regression test prompt-tools-coherence
  description: |
    Criar src/eval/vitor/prompt-tools-coherence.test.ts:
    - importa buildSystemPrompt
    - constrói prompt mínimo (mocks de agentContext)
    - assertfalla que NÃO contém regex \\b(create_user_story|update_user_story|
      delete_user_story|set_story_refinement|manage_story_ac|create_task|
      update_task|delete_task)\\b
    - assertfalla que contém substrings: propose_prd, update_prd, approve_prd
    - assertfalla que sub-phases válidas são MODULE_DISCOVERY/PRD_DRAFTING/PRD_REVIEW
    Roda em CI via pnpm test.
  acceptanceCriteria:
    - "Arquivo src/eval/vitor/prompt-tools-coherence.test.ts existe"
    - "Teste passa: pnpm vitest run src/eval/vitor/prompt-tools-coherence.test.ts"
    - "Teste cobre os 8 nomes de tools removidos via regex"
  verifiable:
    - kind: sql
      command_or_query: "test -f src/eval/vitor/prompt-tools-coherence.test.ts && echo ok"
      expected: "ok"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "pnpm vitest run src/eval/vitor/prompt-tools-coherence.test.ts"
      expected: "Tests passed"
  dependsOn: [VTRDISC-003, VTRDISC-004, VTRDISC-005, VTRDISC-006, VTRDISC-007]
  estimateMinutes: 20
  touches:
    - src/eval/vitor/prompt-tools-coherence.test.ts
```

Total estimado: ~170min (~3h) em 9 stories paralelizáveis em parte (003/004/005/007/008 independentes após 001).
