# PRD — Vitor gera §16 rico (stories + verifiable)

**Reference**: VRS
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-02
**Runtime**: volund-web-app (este repo — executado via Ralph)
**Depende de**: `prd-forge-prd-rich-stories` (FRS — coluna `ProductRequirement.stories` + `ForgeStorySchema` + Forge consumindo por-story)

## Grounding

> Legenda: `[código]` = verificado no repo · `[decisão]` = decidido nesta conversa · `[inferência]` = proposta a validar.

- **[código]** `ProposePrdInput` ([vitor/prd-schemas.ts](src/lib/agent/agents/vitor/prd-schemas.ts)) gera só campos PM: `problem`, `goal`, `oneLiner`, `userJourney`, `acceptanceCriteria` (given/when/then, min 3), `successMetrics`, `outOfScope`, `technicalNotes`, `risksAndAssumptions`. **Não tem campo `stories`**.
- **[código]** A tool `propose_prd` ([vitor/index.ts](src/lib/agent/agents/vitor/index.ts):248+) insere esses campos; **não grava `stories`**.
- **[código]** O prompt do Vitor **não menciona** §16 / stories implementáveis / verifiable (grep = zero).
- **[código]** O Forge (`snapshotManifest`) sem `stories` cai no fallback: 1 PRD = 1 story, **sem `verifiable`** (caminho fraco — vide FRS).
- **[código]** `ForgeStorySchema` já existe ([src/lib/forge/spec/story-schema.ts](src/lib/forge/spec/story-schema.ts)) com `verifiable.min(1)`, `≤30min`, `dependsOn`, `agentProfile`.
- **[decisão]** Caminho 1: o **Vitor gera o §16 ele mesmo** (passo 1 do híbrido; o planner-refinement vem depois).

## §1 Problema

1. O Vitor produz PRD no nível **PM** (AC given/when/then), mas **não gera as §16 implementáveis com `verifiable`** — então um PRD do Vitor não é executável-1-shot pelo Forge (cai no fallback de 1 story sem check).
2. Sem `verifiable`, o agente autônomo **não tem "done" objetivo** → aluciná conclusão ou loop (modo de falha nº1 do AGENTS.md e da literatura).
3. Hoje o rigor do SIAL (§16 + checks automatizáveis) foi **feito à mão**; o Vitor não chega nesse nível sozinho.

## §2 Solução em uma frase

Estender o Vitor para gerar `stories` (§16 implementável, cada uma com ≥1 `verifiable` automatizável, `≤30min`, `dependsOn`, `agentProfile`) reusando o `ForgeStorySchema`, com prompt instruindo o §16 e validação bloqueante — pondo o Vitor no rigor do SIAL.

## §3 Não-objetivos

- **Refinamento do `verifiable` pelo planner no run-time (híbrido)** — é o próximo passo (Caminho 2); aqui o Vitor gera as stories e o `verifiable` sugerido.
- Mudar o trigger `prd_render_markdown` ou o fluxo de `markdown`.
- Vitor gerar `specMarkdown` narrativo (a "Especificação completa" do side sheet faz fallback ao `markdown` gerado — ver D7).

## §4 Personas e jornada

- **Vitor (agente PM)**: "Quando proponho um PRD, entrego também as stories implementáveis com checks objetivos — não só a intenção."
- **PM humano**: "Aprovo um PRD do Vitor e o Forge executa story a story, cada uma se auto-verificando, sem eu reescrever o §16 à mão."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Reusar `ForgeStorySchema` (não duplicar shape) | [código] story-schema.ts |
| D2 | `ProposePrdInput.stories: z.array(ForgeStorySchema).min(1)` — todo PRD precisa de ≥1 story executável | [decisão] |
| D3 | `propose_prd` grava `stories` no insert do `ProductRequirement` | [código] index.ts:248+ |
| D4 | Prompt do Vitor instrui o §16: cada story implementável, `≤30min`, **≥1 verifiable automatizável** (typecheck/sql/http/lint — evitar manual_browser como único), DAG via `dependsOn`, `agentProfile` correto | [decisão] (padrão SIAL/AGENTS.md) |
| D5 | Validação bloqueante: o schema já força `verifiable.min(1)`; a tool retorna erro legível por story inválida (não persiste) | [código] ForgeStorySchema |
| D6 | AC PM (given/when/then) **permanece** — é a intenção de produto, complementar às stories | [código] mantém ProposePrdInput |
| D7 | Side sheet "Especificação completa" faz fallback `specMarkdown ?? markdown` (PRD do Vitor mostra o markdown gerado dos campos PM) | [decisão] |
| D8 | `verifiable` ancorado no repo = híbrido (planner), fora deste PRD | [decisão] §3 |

## §6 Arquitetura

```
Vitor (LLM)  ──propose_prd──►  ProductRequirement
   gera:                         ├─ campos PM (problem/goal/AC/metrics…)  → trigger gera `markdown`
   §16 stories[]  ───────────►   └─ stories jsonb (verifiable, ≤30min, dependsOn, agentProfile)
                                      ▲ validado por ForgeStorySchema (≥1 verifiable)
                                      │
                                 Forge (snapshotManifest) consome por-story  [já pronto via FRS]
```

## §7 Schema

Sem migration — a coluna `ProductRequirement.stories` já existe (FRS-001). Este PRD só popula via Vitor.

## §8 Contratos / mudanças

| Onde | Mudança |
|------|---------|
| `vitor/prd-schemas.ts` `ProposePrdInput` | += `stories: z.array(ForgeStorySchema).min(1)` |
| `vitor/index.ts` `propose_prd` | input schema inclui `stories`; insert grava `stories`; retorno reporta `storiesCount` |
| `vitor/prompt.ts` (ou definição do prompt) | bloco §16: como gerar stories implementáveis com verifiable, ≤30min, DAG, agentProfile |
| `src/components/prd/prd-detail.tsx` | "Especificação completa" usa `specMarkdown ?? prd.markdown` (fallback) |

## §9 UX

Sem UI nova além do fallback do side sheet. Efeito: PRDs do Vitor aparecem na nova side sheet com a seção **Stories de execução (N)** preenchida (não vazia) e a **Especificação completa** renderizada (do markdown gerado).

## §10 Integrações

- Consome `ForgeStorySchema` (FRS) e a coluna `stories` (FRS-001).
- Forge executa as stories via `snapshotManifest` (FRS-003).
- Próximo passo (fora daqui): planner refina/ancora `verifiable` no repo (híbrido).

## §11 Faseamento

Fase 1: schema do input → tool grava stories → prompt §16 → validação/erro claro → fallback do side sheet → eval/smoke do Vitor gerando ≥1 story verificável.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Vitor inventar `verifiable` que não roda (sem ver o repo) | A | A | Schema força tipo/shape; prompt exige checks objetivos; **híbrido (planner)** ancora no repo num próximo PRD; worker itera/reporta se o check falha. |
| Vitor gerar stories grandes (>30min) | M | M | Schema `estimateMinutes.max(30)` rejeita; prompt instrui granularidade. |
| Stories sem DAG coerente | M | M | `dependsOn` validado; orquestrador detecta ciclo. |
| Regressão na qualidade do PRD PM | B | M | AC PM permanece (D6); eval compara antes/depois. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| % PRDs do Vitor com `stories` não-vazio | `SELECT count(*) FILTER (WHERE jsonb_array_length(stories)>0)::float/count(*) FROM "ProductRequirement" WHERE "createdBy" IS NOT NULL` |
| Toda story com ≥1 verifiable | validação no propose_prd (0 rejeições esperadas após ajuste do prompt) |
| Stories ≤30min | `estimateMinutes` médio/máx por PRD |

## §14 Open questions

- ❓ O `verifiable` do Vitor deve ser ancorado no repo já agora (planner) ou aceitar "sugerido" e refinar depois? **Decisão: sugerido agora; planner no próximo PRD (híbrido).**
- ❓ Vitor deve gerar `specMarkdown` narrativo, ou o `markdown` gerado basta? **Basta (D7); revisitar se PM quiser narrativa rica.**

## §15 Referências

- Código: [vitor/prd-schemas.ts](src/lib/agent/agents/vitor/prd-schemas.ts), [vitor/index.ts](src/lib/agent/agents/vitor/index.ts), [story-schema.ts](src/lib/forge/spec/story-schema.ts), [forge-project.ts](src/lib/dal/forge-project.ts) (snapshotManifest).
- Memory: [[project_vitor_to_forge_connector]] ("Vitor passa a gerar §16 rico"), [[project_forge_prd_consumption]], [[project_forge_double_diamond]], [[feedback_grounded_no_hallucination]].
- PRD irmão: `prd-forge-prd-rich-stories` (FRS).

## §16 Stories implementáveis

```yaml
- id: VRS-001
  title: ProposePrdInput += stories (ForgeStorySchema)
  description: Adiciona `stories: z.array(ForgeStorySchema).min(1)` ao ProposePrdInput, importando o schema único. Atualiza tipos.
  acceptanceCriteria:
    - "ProposePrdInput tem campo stories tipado por ForgeStorySchema"
    - "stories exige min(1); cada story exige verifiable.min(1) (herdado)"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/agent/agents/vitor/prd-schemas.ts"]

- id: VRS-002
  title: propose_prd grava stories no insert
  description: A tool inclui `stories` no input e no insert do ProductRequirement; retorna storiesCount no resultado.
  acceptanceCriteria:
    - "propose_prd aceita stories no payload"
    - "insert persiste stories"
    - "retorno inclui storiesCount"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VRS-001]
  estimateMinutes: 25
  touches: ["src/lib/agent/agents/vitor/index.ts"]

- id: VRS-003
  title: Prompt do Vitor — bloco §16
  description: Adiciona instrução pro Vitor gerar stories implementáveis (≤30min, ≥1 verifiable automatizável, dependsOn DAG, agentProfile), com exemplos no padrão SIAL.
  acceptanceCriteria:
    - "Prompt descreve o §16 e os tipos de verifiable (typecheck/sql/http/lint)"
    - "Prompt instrui evitar manual_browser como único check"
    - "Prompt instrui granularidade ≤30min e dependsOn"
  verifiable:
    - kind: manual_browser
      command_or_query: "Inspecionar o prompt renderizado do Vitor inclui o bloco §16"
      expected: "bloco §16 presente"
  dependsOn: [VRS-001]
  estimateMinutes: 25
  touches: ["src/lib/agent/agents/vitor/prompt.ts"]

- id: VRS-004
  title: Validação/erro claro por story inválida
  description: Se o Vitor mandar story sem verifiable (ou >30min), a tool retorna erro legível identificando a story; não persiste o PRD.
  acceptanceCriteria:
    - "Story sem verifiable → erro com id da story"
    - "Story >30min → erro com id da story"
    - "PRD não é inserido em caso de erro"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VRS-002]
  estimateMinutes: 20
  touches: ["src/lib/agent/agents/vitor/index.ts"]

- id: VRS-005
  title: Side sheet "Especificação completa" — fallback specMarkdown ?? markdown
  description: prd-detail.tsx renderiza specMarkdown se houver, senão o markdown gerado (pra PRDs do Vitor não ficarem com a seção vazia).
  acceptanceCriteria:
    - "Com specMarkdown → renderiza specMarkdown"
    - "Sem specMarkdown → renderiza prd.markdown"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches: ["src/components/prd/prd-detail.tsx"]

- id: VRS-006
  title: Eval/smoke — Vitor gera PRD com stories verificáveis
  description: Caso de eval (ou smoke CLI) que roda o Vitor sobre um brief mínimo e valida que o PRD proposto tem ≥1 story, todas com ≥1 verifiable e ≤30min.
  acceptanceCriteria:
    - "Vitor propõe PRD com stories não-vazio"
    - "Toda story tem ≥1 verifiable e estimateMinutes ≤30"
    - "Roda via CLI/eval sem browser"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VRS-002, VRS-003, VRS-004]
  estimateMinutes: 30
  touches: ["src/eval/vitor/cases/", "scripts/forge/"]
```

**Total: 6 stories, ~135min (~2h15).**
