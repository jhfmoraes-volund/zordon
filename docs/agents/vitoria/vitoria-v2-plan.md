# Vitoria v2 — Copiloto de planning de elite

> Sucede [`intelligence-plan.md`](intelligence-plan.md) (em execução). Foco aqui: dar à Vitoria **arquitetura multi-especialista**, **leitura sofisticada de fontes** (transcripts, planilhas, anexos), **gates de qualidade que bloqueiam** (não só sugerem), **ciclo de aprendizado fechado** e **eval suite**. Inspirado nos padrões de delegação do [Volund OS](https://github.com/volund-ia/volund-os) (Oracle agent + `agent_delegates` + sub-threads).
>
> **Diferença para o `intelligence-plan.md`**: aquele plano deixa a Vitoria menos burra (profile rico, sub-extractors, telemetria). Este plano deixa a Vitoria **inteligente**: ela orquestra especialistas independentes, cada um avaliado em isolamento; aprende com outcome real; bloqueia proposta ruim; entende multi-fonte como cidadão de primeira classe.

## Tese

Vitoria v1 é um chat-bot que executa tools. Vitoria v2 é uma **orquestradora de especialistas** com 4 propriedades não-negociáveis:

1. **Decomposição funcional** — uma responsabilidade por especialista. Cada um tem prompt próprio, modelo próprio, eval próprio, custo medido. Vitoria sintetiza.
2. **Ciclo de aprendizado fechado** — toda proposta gera `AgentProposalOutcome` (aceita/editada/rejeitada). Vitoria lê o histórico do projeto no `loadContext`. Cada especialista tem feedback dedicado.
3. **Gates de qualidade que bloqueiam** — Capacity Gate, Conflict Detector e MVP-Style Sprint Check **devolvem `pass=false`** que faz `propose_task_action` falhar com mensagem estruturada. Não é prompt rule frouxa.
4. **Multi-fonte first-class** — transcript, planilha (markdown table no `fullText`), anexo PDF/imagem, payload Granola, link Roam — cada um tem um **Source Reader** dedicado que normaliza pra estrutura comum antes de chegar no orquestrador.

Sem os 4, "Vitoria inteligente" é claim. Com os 4, ela compete com um PM sênior em prep de planning.

## Diagnóstico — onde Vitoria v1 fica burra

Mesmo com `intelligence-plan.md` 100% executado, gaps que permanecem:

1. **Monolito de tools.** 14 tools no mesmo prompt, todas no token budget toda vez. Sem skill catalog progressivo — paga por capacidade que não usa.
2. **Sem gate hard.** `get_sprint_capacity` é sugestão. Vitoria pode propor 80 FP num sprint de 30 FP e nada impede. Equivalente a "tomar cuidado" no prompt — não funciona, nunca funcionou.
3. **Sem detecção de contradição estrutural.** [DesignDecision](../../../src/lib/agent/tools/memory.ts) ativas entram no prompt mas Vitoria não é obrigada a checar antes de propor. Vitor faz isso explicitamente — Vitoria não.
4. **Planilhas como markdown solto.** Hoje [planilhas viram `fullText`](../../../src/lib/agent/agents/vitoria/tools.ts#L230-L280) com markdown tables. Vitoria interpreta com LLM puro a cada turno. Sem **parser estrutural** (sheet → rows típicas → schema inferido) → ela perde colunas, repete cálculo, alucina totais.
5. **Anexos não-texto não entram.** PDF de relatório, imagem de board físico, vídeo de demo — Vitoria não tem source reader pra nenhum. Caem fora da prep.
6. **Sem proatividade ao abrir.** PM precisa pedir "lê esse transcript". Devia ser: PM abre planning → Vitoria já leu 5 sources + gerou 5 summaries + identificou 3 risks **antes** do PM digitar.
7. **Sem sprint forecaster.** Estima task individual, não prediz sprint. Sprint anterior fez 18 FP de 30 planejados; Vitoria propõe 35 FP no próximo. Sem aprendizado de delivery.
8. **Confidence label ausente.** Vitor obriga `hard_fact | inferred | assumption`. Vitoria escreve `aiReasoning` em prosa livre — PM não sabe pesar.
9. **Eval suite zero.** Cada mudança é fé. Não dá pra dizer "ficou melhor" — só "ficou diferente".
10. **Sem cross-pollination com Vitor.** [Patch shipado em 2026-05-29](../../../src/lib/agent/agents/vitoria/index.ts) carrega `Project.memoryMd` + decisions ativas no prompt, mas Vitoria não está **instruída a usar** — só lê passivamente.

## Princípios de design (novos no v2)

1. **Um especialista, uma responsabilidade.** Se um especialista faz 2 coisas, partir em 2. Eval só funciona em escopos pequenos.
2. **Skill ≠ Tool.** Skill é texto curado (rubrica, exemplares, padrões); Tool é função TypeScript com side-effect. Skills entram no prompt **progressivamente** (catálogo no system, content só quando usado). Reduz tokens em ~40%.
3. **Source primeiro, conteúdo depois.** Cada fonte (transcript/spreadsheet/attachment/granola) tem um Source Reader que normaliza pra `NormalizedSource { kind, structuredData, narrativeText, metadata }`. Especialistas trabalham só com `NormalizedSource` — nunca veem o crú.
4. **Gates bloqueiam, não avisam.** Capacity Gate / Conflict Detector / MVP-Style Sprint Check devolvem `{ pass: boolean, blockers[] }`. Se `pass=false`, `propose_task_action` falha com erro estruturado pro modelo entender o porquê.
5. **Outcome é input do próximo turno.** `AgentProposalOutcome` das últimas N planning entra no `loadContext` como "seu histórico de acerto neste projeto" — Vitoria vê o que ela mesma errou.
6. **Sintetizadora, não executora final.** Vitoria nunca chama `propose_task_action` sem ter passado pelos gates relevantes. Orquestra: chama especialistas → consolida output → propõe.

## Arquitetura — Vitoria + 6 especialistas

```
┌─────────────────────────────────────────────────────────────┐
│  VITORIA (orquestradora — Sonnet 4.6)                       │
│  Responsabilidades:                                          │
│   • Recebe input do PM, decide qual especialista chamar     │
│   • Sintetiza outputs em propostas com aiReasoning rico     │
│   • Mantém narrativa da planning (notes, conversa)          │
│   • Aplica gates antes de propose_task_action               │
│  NUNCA: lê transcript crú, faz math de capacity, draftea AC │
└─────────────────────────────────────────────────────────────┘
   ┌──────────────┬──────────────┬──────────────┬─────────────┐
   ↓              ↓              ↓              ↓             ↓
┌─────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌─────────────┐
│ Source  │ │ Capacity │ │  Conflict    │ │  Task    │ │   Sprint    │
│ Reader  │ │  Gate    │ │  Detector    │ │ Drafter  │ │ Forecaster  │
│ (Haiku) │ │ (Haiku   │ │  (Sonnet)    │ │ (Sonnet) │ │  (Sonnet)   │
│         │ │  + code) │ │              │ │          │ │             │
└─────────┘ └──────────┘ └──────────────┘ └──────────┘ └─────────────┘
   per src    blocker      blocker          enricher      predictor
                                                      ┌──────────────┐
                                                      │  Outcome     │
                                                      │  Reflector   │
                                                      │  (Haiku)     │
                                                      └──────────────┘
                                                       lê histórico
```

Cada especialista é uma função `extractor` no padrão do Alpha ([extractActions](../../../src/lib/agent/agents/alpha/extractors/actions.ts)) — `generateObject` com Zod schema, prompt PT-BR, envolto em `wrapWithUsage`. Não são "agents" no sentido Volund OS (não têm thread persistente nem RLS própria) — são **sub-LLM calls determinísticos**. Mais barato que threads, mais governável que tools.

Quando promover pra "agent real" com sub-thread: quando o especialista precisar de conversa multi-turn com o PM (ex.: Conflict Detector que precisa esclarecer). Hoje, nenhum precisa.

### 1. Source Reader — multi-fonte first-class

**Input**: `{ source: TranscriptRef | Attachment | SpreadsheetRef | GranolaPayload, projectContext }`
**Output**:
```ts
{
  kind: "transcript" | "spreadsheet" | "attachment" | "granola" | "roam",
  structuredData: unknown,   // schema-dependent (ver abaixo)
  narrativeText: string,     // texto plano canônico
  metadata: {
    capturedAt, participants?, source, sourceId,
    confidence: "complete" | "partial" | "metadata_only"
  },
  inferredSignals: Array<{
    kind: "capacity_signal" | "scope_creep" | "blocker" | "decision" | "risk" | "metric",
    content: string,
    sourceLocation: string  // "linha 142" | "aba 'Backlog'" | "01:23:45"
  }>
}
```

**Por tipo de fonte:**

| Fonte | Reader | Output específico |
|-------|--------|-------------------|
| **Transcript** (Granola, Roam, Otter) | `transcriptReader` | `structuredData: { utterances: [{ speaker, ts, text }], turnsByPerson, topicsExtracted }`. Identifica falas-decisão (`vamos focar em X`), commitments (`Eu fico com Y`), risks (`tô preocupado com Z`). |
| **Planilha** (`source='spreadsheet'`) | `spreadsheetReader` | Parser de markdown table → JSON. `structuredData: { sheets: [{ name, columns, rows, inferredSchema, totalsRow? }] }`. Detecta colunas tipo (data, dinheiro, status). Calcula totais/agregados **deterministicamente** (não confia LLM pra somar). |
| **PDF** (attachment) | `pdfReader` | Extração via [unpdf](https://github.com/unjs/unpdf) ou pdf-parse. `structuredData: { pages, tables?: parsedTables[] }`. Tabelas detectadas viram CSV. |
| **Imagem** (board físico, screenshot) | `imageReader` | Vision API (Claude vision). `structuredData: { ocrText, detectedLists?, detectedBoards? }`. |
| **Granola payload** raw | `granolaReader` | JSON direto da Granola → `structuredData: { highlights, decisions, attendees, agenda }`. Já vem semi-estruturado. |
| **Roam block** | `roamReader` | DFS no bloco → tree → `structuredData: { headings, todos, decisions }`. |

**Princípio**: Vitoria nunca vê `fullText` crú. Sempre vê `NormalizedSource`. Source Reader é caro mas roda **uma vez** quando a source é linkada à planning (não a cada turno) — cacheado em `PlanningSourceCache { sourceRef, normalizedJson, computedAt, computedVersion }`.

**Por que importa**: hoje uma planilha de 50 linhas vira 8k tokens de markdown que Vitoria releitar a cada turno. Com `spreadsheetReader`, vira ~600 tokens de JSON estruturado + signals pré-identificados. **Token + qualidade ganham juntos.**

### 2. Capacity Gate — bloqueador hard

**Input**: `{ sprintId, proposedDeltaFp, currentMember? }`
**Output**: `{ pass: boolean, currentTotal, capacity, byMember: [], blockers: string[], suggestion?: "split" | "defer" | "reassign" }`

**Lógica determinística (sem LLM no caminho crítico):**
- `currentTotal = sum(Task.functionPoints WHERE sprintId AND status != 'done')`
- `capacity = sum(SquadMember.fpCapacity * dedicationPercent)` (já existe em [project profile](../../../src/lib/agent/agents/vitoria/profile.ts))
- `projected = currentTotal + proposedDeltaFp`
- `pass = projected <= capacity * 1.1` (10% tolerância)
- Se `pass=false`: gera `blockers` com diagnóstico ("João já tem 12 FP, capacity 10. Adicionar 5 FP atinge 150% utilização").

**Wrap como tool obrigatória em Vitoria**: `propose_task_action({ type: "create" | "move", payload: { functionPoints?, sprintId } })` chama `capacityGate` internamente **antes** do INSERT. Se `pass=false`, devolve `{ ok: false, gate: "capacity", blockers, suggestion }` ao LLM. Modelo lê e ou (a) reduz scope, (b) move pra próxima sprint, (c) reaponta pra outro member, (d) explica ao PM e propõe sem prosseguir.

**Por que LLM no fim**: o **diagnóstico textual** ("João já tem 12 FP") usa Haiku barato pra escrever blocker. Math é determinístico. LLM só formata.

### 3. Conflict Detector — contradição com decisão ativa

**Input**: `{ proposalDraft, activeDecisions: DesignDecision[], openQuestions: DesignOpenQuestion[] }`
**Output**: `{ pass: boolean, conflicts: [{ decisionId, statement, severity: "blocking" | "warning", reasoning }], suggestion?: "revise_decision" | "split_proposal" }`

**Quando rodar**: antes de `propose_task_action` com `type in ['create', 'update']` que toca scope/platform/architecture (heurística: tags de DesignDecision intersectam com palavras-chave do payload).

**Modelo**: Sonnet 4.6 — detecção semântica de contradição não é trivial.

**Behavior**: se `pass=false` com severity=blocking:
- Vitoria não propõe direto. Em vez disso, abre conversa: "PM, sua sugestão de adicionar iOS conflita com a decisão de 2026-04-20 (`iOS fora do MVP`). Quer (a) reverter a decisão, (b) re-escopar como pesquisa não-MVP, ou (c) seguir sabendo do conflito?"
- Se PM confirma reverter: Vitoria chama `revise_decision` no Vitor's memory ([já existe](../../../src/lib/agent/tools/memory.ts#L58-L96)).

**Cross-agent**: este é o ponto principal de **uso ativo** da memória do Vitor. Não passivo (só ler) — ativo (orquestrar revisão de decisão quando contradição aparece).

### 4. Task Drafter — descrição + AC + dependências

**Input**: `{ proposalDraft (title + signal), projectProfile, styleProfile, repoManifest, similarTasks (top 30) }`
**Output**: `{ description (SDD), acceptanceCriteria[] (≥3, observáveis), suggestedAssignee, suggestedDependencies, estimatedFp, confidence: 'hard_fact' | 'inferred' | 'assumption', sources: { quotes, exemplars } }`

**Modelo**: Sonnet 4.6 — escrita de qualidade exige raciocínio. Custo absorvido por opt-in (PM clica "✨ Detalhar com Vitória").

Substitui B2 (`enrichTaskProposal`) do intelligence-plan v2 — mesma essência, agora obrigado a devolver `confidence` e `sources`. Sem isso, `update_proposed_action` que vier do drafter recusa.

### 5. Sprint Forecaster — predição de entrega

**Input**: `{ projectId, sprintId, plannedFp, historicalSprintOutcomes (últimas 5 sprints) }`
**Output**: `{ forecast: { likelyDelivered: { p50, p90 }, riskFactors[], suggestion } }`

**Sinal histórico**: `SprintOutcome { sprintId, plannedFp, deliveredFp, taskOutcomes[] }` — tabela nova, populada por trigger quando sprint vira `status='completed'`.

**Predição**: estatística simples + Sonnet pra contextualizar. Não ML do zero — só:
- `deliveryRatio = mean(deliveredFp / plannedFp over last 5 sprints)`
- `p50 = plannedFp * deliveryRatio`
- `p90 = plannedFp * percentile90(historical ratios)`
- LLM gera reasoning: "Time entrega ~70% do planejado historicamente. Sprint atual com 35 FP planejados deve entregar ~24 (p50). Pra atingir 30 FP, sugiro [reduzir escopo de X | reforçar Y]."

**Quando rodar**: ao fim de cada planning, antes do PM commitar. Vitoria mostra: "Forecast: vocês geralmente entregam 70% — esta planning planeja 35 FP, deve entregar 24. Confirma?"

**Por que importa**: vira loop fechado de **expectativa vs realidade**. PM toma decisão informada sobre tamanho do sprint. Sem isso, Vitoria propõe e ninguém mede se tá bem calibrada.

### 6. Outcome Reflector — leitor do passado

**Input**: `{ projectId, last N=5 planning sessions }`
**Output**: `{ summary: string, patterns: [{ pattern, evidence, confidence }] }` (max 800 tokens)

**Modelo**: Haiku — só lê + sumariza.

**Quando rodar**: no `loadContext` da Vitoria, a cada planning aberta. Saída entra no prompt como seção "Histórico de propostas neste projeto":

```
Últimas 5 plannings (taxa global: 68% aceitas, 18% editadas, 14% deletadas)
- Padrão: propostas de scope=infrastructure tem 85% de delete (PM prefere abordar via design session, não planning)
- Padrão: estimativas de complexity=high erram em média 3 FP pra mais
- Padrão: João aprova 90% das propostas dele; Carla edita 60% (estilo difere)
```

Vitoria lê e **calibra**: "Sobre infra, vou propor 1 nota de contexto em vez de criar task direto". É aprendizado real, sem fine-tune.

## Pipeline canônico — abertura → discussão → commit

### Fase A: Abertura (proativa, antes do PM digitar)

Quando PM abre planning com ≥1 source linkada:

1. **Source Reader paralelo** — N sources viram N `NormalizedSource` em paralelo (Promise.all). Cache em `PlanningSourceCache`.
2. **Outcome Reflector** carregado.
3. **Vitoria abre com**:
   > Li 3 sources (2 transcripts, 1 planilha de OKRs). Identifiquei:
   > - 2 commitments do João, 1 da Carla
   > - 3 risks (capacity em mobile, dependência Stripe, escopo de FUP)
   > - 1 sinal de scope creep ("podemos incluir relatórios" da daily 23/05)
   >
   > Histórico: vocês entregaram 22 FP de 30 last sprint (73%). Quer começar pelos commitments ou pelos risks?

Sem o PM ter digitado. **Ela já preparou.**

### Fase B: Discussão

PM e Vitoria conversam. Pra cada `propose_task_action`:

1. Vitoria valida `Capacity Gate` (sempre, se toca FP/sprint).
2. Se toca scope: valida `Conflict Detector`.
3. Se PM aprova draft inline: Vitoria propõe com `aiReasoning` consolidado (signal source + capacity ok + decisions checked).
4. Se PM pede "detalha essa": `Task Drafter` enriquece a proposta.

Cada proposta carrega `confidence` label visível no card UI (badge `hard_fact` verde, `inferred` amarelo, `assumption` laranja).

### Fase C: Pré-commit

Antes de PM clicar "Concluir planning":

1. **Sprint Forecaster** roda em background.
2. Vitoria mostra: "Forecast: 24 FP p50 / 32 FP p90 vs 35 FP planejados. Risco principal: 2 tasks de scope=infra ainda sem assignee."
3. PM decide: ajusta ou commita.

### Fase D: Pós-commit (observabilidade)

Quando PM clica "Concluir":

1. Cascade aplica MeetingTaskAction → Tasks reais.
2. Trigger Postgres em cada MeetingTaskAction inicia `AgentProposalOutcome { decision: 'accepted' | 'edited' }`.
3. Quando sprint termina: trigger atualiza `SprintOutcome` (planned vs delivered). Sprint Forecaster aprende.

## Skill catalog progressivo (porta de Volund OS)

Hoje system prompt da Vitoria tem ~3k tokens de instruções. ~40% disso são "como propor", "como adicionar nota", "como tratar planilha" — checklists/playbooks que pertencem a skills.

**Esquema**:
```sql
CREATE TABLE "AgentSkill" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug" text NOT NULL,           -- 'vitoria'
  name text NOT NULL,                   -- 'propose_task_quality_checklist'
  description text NOT NULL,            -- 1 linha — entra sempre no prompt
  content text NOT NULL,                -- markdown — entra só quando usada
  tags text[],
  "version" int NOT NULL DEFAULT 1,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
```

**Skills iniciais** (extraídas do prompt atual):
- `propose_task_quality_checklist` — rubrica AC observáveis, scope claro, dependências citadas
- `spreadsheet_interpretation_patterns` — padrões comuns (Backlog/OKRs/Roadmap)
- `transcript_signal_taxonomy` — taxonomia de signals (risk/commitment/decision/scope_creep)
- `sdd_description_template` — template de description estilo SDD
- `confidence_labeling_rubric` — quando é hard_fact vs inferred vs assumption
- `capacity_overflow_resolution_playbook` — opções quando Capacity Gate retorna pass=false
- `decision_contradiction_handoff` — como abrir conversa de revise_decision
- `multi_source_synthesis_patterns` — como combinar planilha + transcript

**Catálogo no system prompt** (sempre, ~200 tokens):
```
## Skills disponíveis
- propose_task_quality_checklist: rubrica pra create/update task
- transcript_signal_taxonomy: tipos de signals em conversa
- ... (8 skills)

Chame `load_skill(name)` pra ler o content de uma skill antes de aplicar.
```

**Tool** `load_skill(name)` carrega content na conversa. Modelo aprende a pedir só quando precisa. **Token redução estimada: 30-45%.**

## Schema deltas (v2 — incremental sobre intelligence-plan)

| Tabela / Mudança | Razão | Risco | Fase |
|------------------|-------|-------|------|
| `PlanningSourceCache (sourceRef, planningId, normalizedJson, computedAt, version)` | Source Reader cache | nenhum | G1 |
| `SprintOutcome (sprintId, plannedFp, deliveredFp, taskOutcomes, retrospectiveNotes)` | Forecaster | nenhum | G3 |
| `AgentSkill (agentSlug, name, description, content, version)` | Skill catalog | nenhum | G2 |
| `AgentProposalOutcome` (já em F1.5 do intelligence-plan) | Outcome Reflector | — | dep |
| Trigger `Sprint.status='completed'` → `SprintOutcome` populate | auto | baixo | G3 |
| Trigger `MeetingTaskAction.decision='accepted'` → `AgentProposalOutcome` populate | auto | baixo | G0 |
| Coluna `MeetingTaskAction.specialistLog jsonb` | rastrear qual specialist gerou | nenhum | G1 |
| Coluna `Project.confidenceLabelingEnforced bool DEFAULT true` | feature flag por projeto | nenhum | G2 |

Total: 3 tabelas novas + 2 colunas + 2 triggers. Aditivo.

## Fases — G0 a G7 (greatness)

Prefixo `G` pra não colidir com `F0-F5` do intelligence-plan. Cada G assume Fs concluídas em ordem (G0 depende de F1.5).

### G0 — Eval suite + outcome wiring (~6h)

Sem isso, qualquer G seguinte é fé.

| Entregável | Detalhe |
|------------|---------|
| `src/eval/vitoria/` | 10 plannings sintéticas (yaml) cobrindo: capacity overflow, contradição com decision, planilha mal formada, transcript longo, fonte vazia, multi-source, scope creep detection, edição de proposta, deletion, forecast post-commit. |
| Runner `src/eval/vitoria/runner.ts` | Espelha `src/eval/vitor/runner.ts`. Roda baseline antes de G1. |
| Trigger `AgentProposalOutcome` populate | em `task-action-executor.ts` (já planejado em F1.5, garantir). |
| Métricas baseline | Painel mostra %aceite/edição/deletion da Vitoria atual. Linha de base pra comparar. |

**Smoke**: rodar `pnpm eval:vitoria` → relatório com pass/fail dos 10 cenários + métricas reais do banco.

### G1 — Source Readers + cache (~8h)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/sources/transcript-reader.ts` (NOVO) | Speaker-aware parsing + signal extraction. Cache no `PlanningSourceCache`. |
| `src/lib/agent/agents/vitoria/sources/spreadsheet-reader.ts` (NOVO) | Markdown table → JSON. Inferred schema. Totais determinísticos. |
| `src/lib/agent/agents/vitoria/sources/pdf-reader.ts` (NOVO) | unpdf + table extraction. |
| `src/lib/agent/agents/vitoria/sources/image-reader.ts` (NOVO) | Claude vision via OpenRouter. Opt-in (custo). |
| `src/lib/agent/agents/vitoria/sources/granola-reader.ts` (NOVO) | Parser do payload Granola → NormalizedSource. |
| `src/lib/agent/agents/vitoria/sources/index.ts` (NOVO) | `normalizeSource(ref): NormalizedSource` — dispatcher por kind. |
| `supabase/migrations/<date>_planning_source_cache.sql` | Tabela + index `(planningId, sourceRef)`. |
| `src/lib/agent/agents/vitoria/tools.ts` | `read_transcript_content` agora retorna `NormalizedSource`. Tool nova `read_attachment_content(attachmentId)`. |
| `src/lib/agent/agents/vitoria/index.ts` (`loadContext`) | Pre-warm cache no abrir planning: chama `normalizeSource` em paralelo pra cada linked source. |

**Smoke**: linkar planilha 50 linhas + transcript 60min + PDF 10 páginas. `loadContext` retorna `NormalizedSource[]` com signals identificados. Vitoria pode citar "linha 23 da aba Backlog" textualmente.

### G2 — Skill catalog progressivo (~3h)

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/<date>_agent_skill.sql` | Tabela + RLS. |
| `scripts/seed/vitoria-skills.ts` (NOVO) | Seed dos 8 skills iniciais. |
| `src/lib/agent/skills.ts` (NOVO) | `listSkills(agentSlug)`, `loadSkill(name)`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Remove ~40% do conteúdo (skills extraídas). Adiciona catálogo (name+description). |
| `src/lib/agent/agents/vitoria/tools.ts` | Tool `load_skill(name)`. |
| Painel `/admin/agent-skills` | Edita skills (manager-only). Versão + diff. |

**Smoke**: token in/out por turno cai ≥30% (medido via `AgentUsage`). Vitoria carrega `transcript_signal_taxonomy` antes de classificar signals.

### G3 — Capacity Gate como bloqueio (~3h)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/gates/capacity-gate.ts` (NOVO) | Função determinística + LLM-formatter pra blocker text. |
| `src/lib/agent/agents/vitoria/tools.ts` | `propose_task_action` chama `capacityGate` internamente quando type in [create, move] e payload.functionPoints. Falha estruturada quando pass=false. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Skill `capacity_overflow_resolution_playbook` aplicado quando gate retorna pass=false. |

**Smoke**: PM pede "cria 5 tasks de 8 FP na sprint atual" (sprint capacity 30). Vitoria propõe as 3 que cabem, recusa as outras 2 explicando overflow + sugere split/defer.

### G4 — Conflict Detector (~4h)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/specialists/conflict-detector.ts` (NOVO) | Sonnet via `generateObject`. Schema com conflicts + severity. |
| `src/lib/agent/agents/vitoria/tools.ts` | `propose_task_action` chama `conflictDetector` quando proposal tag intersecta com active decisions. |
| `src/lib/agent/agents/vitoria/index.ts` | `loadContext` carrega `DesignDecision` ativas (já feito) — agora **instrui** uso no prompt. |
| `src/lib/agent/tools/memory.ts` | `revise_decision` agora invocável pela Vitoria (não só Vitor) — RLS já permite via `projectId`. |

**Smoke**: existe `DesignDecision { statement: "iOS fora do MVP", status: 'active' }`. PM pede "cria task de app iOS de pagamento". Vitoria detecta conflito → não propõe direto → abre conversa com 3 opções.

### G5 — Task Drafter consolidado (~4h)

Substitui B2 (enrich) do intelligence-plan v2 — escopo ampliado:

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/specialists/task-drafter.ts` (NOVO ou rename de B2) | Output schema obriga `confidence` + `sources`. |
| `src/lib/agent/agents/vitoria/tools.ts` | `enrich_proposal` agora chama `taskDrafter`. Recusa se `confidence: 'assumption'` sem fontes citadas (impossível). |
| `src/components/planning/proposal-card.tsx` | Badge de confidence visível (verde/amarelo/laranja). |

**Smoke**: PM diz "detalha VLD-107". Output tem description SDD + 4 AC observáveis + assignee + deps + estimatedFp + confidence='inferred' + sources=[{quote: "...", from: "transcript-23/05 linha 142"}].

### G6 — Sprint Forecaster (~4h)

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/<date>_sprint_outcome.sql` | Tabela + trigger no `Sprint.status='completed'`. |
| `src/lib/agent/agents/vitoria/specialists/sprint-forecaster.ts` (NOVO) | Math determinístico + Sonnet pra reasoning. |
| `src/lib/agent/agents/vitoria/tools.ts` | `forecast_sprint()` tool — chamada no fim da planning. |
| `src/components/planning/sprint-forecast-banner.tsx` (NOVO) | Mostra p50/p90 + risk factors antes do "Concluir planning". |

**Smoke**: planning com 35 FP planejados. Após 5 sprints históricos com ratio médio 0.7. Forecast: p50=24, p90=32. Banner mostra antes do PM commitar.

### G7 — Outcome Reflector + multi-source synthesis (~3h)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/specialists/outcome-reflector.ts` (NOVO) | Haiku. Lê últimas 5 plannings + outcomes. Output max 800 tokens. |
| `src/lib/agent/agents/vitoria/index.ts` (`loadContext`) | Chama `outcomeReflector` (cache 1h). Resultado entra no prompt como "Histórico de propostas neste projeto". |
| Skill `multi_source_synthesis_patterns` | Recheada com padrões reais (após 1 mês de dados). |

**Smoke**: após 5 plannings num projeto, abrir planning #6 — prompt da Vitoria contém parágrafo com padrões observados (taxa, scope que costuma deletar, members que editam vs aceitam).

## Métricas de sucesso (visão de negócio)

| Métrica | Como medir | Meta inicial | Meta amadurecida (90d) |
|---------|------------|--------------|------------------------|
| **% propostas aceitas** | `AgentProposalOutcome.decision='accepted' / total` | ≥ 70% | ≥ 85% |
| **# edições antes de aceitar** | média de campos editados | ≤ 2 | ≤ 1 |
| **FP error médio** | `\|fpEstimated - fpReal\|` post-done | ≤ 3 FP | ≤ 1.5 FP |
| **Sprint delivery ratio** | `deliveredFp / plannedFp` | sem regressão vs baseline | ≥ 85% (predição calibrada) |
| **Tempo de prep do PM** | self-report em research mensal | -50% vs sem Vitoria | -70% |
| **Capacity overflow events** | sprints com utilização > 110% | < 1 por mês | 0 |
| **Eval pass rate** | % dos 10 cenários passando | ≥ 70% pós-G3 | ≥ 90% pós-G7 |
| **Cache hit ratio** | `cachedInputTokens / inputTokens` | ≥ 70% | ≥ 80% |
| **Custo médio por planning** | `sum(costUsd) per sessionId` | ≤ $0.80 | ≤ $0.50 (post-G2 skill compression) |
| **Confidence label coverage** | % proposals com label não-null | 100% pós-G5 | 100% |
| **Contradição detectada / total contradição real** | manual sample 30d | ≥ 60% pós-G4 | ≥ 90% |

**Antimétricas (não otimizar)**:
- # de calls de tool por turno — ela pode ficar verbosa se tentamos minimizar.
- # de propostas por planning — não é proxy de qualidade.

## Princípio de confidence + provenance

Toda escrita estruturada (proposta, nota, decision marking) carrega 3 campos:

```ts
{
  confidence: "hard_fact" | "inferred" | "assumption",
  sources: Array<{
    kind: "transcript_quote" | "spreadsheet_cell" | "active_decision" | "historical_outcome" | "exemplar_task",
    reference: string,            // "transcript:abc#L142" | "spreadsheet:budget!B23" | "decision:abc"
    excerpt: string               // citação textual quando aplicável
  }>,
  reasoning: string               // por quê, em PT-BR
}
```

UI mostra badge de confidence e tooltip com sources. PM clica → vai pro local exato (linha do transcript / célula da planilha / decisão).

**Sem confidence + sources, recusa de schema.** Não é regra de prompt — é validação de Zod. Vitoria não consegue enviar.

## Como conversar com Vitor (cross-agent ativo)

Já existe (shipado 2026-05-29): Vitoria lê `Project.memoryMd`, `ProjectBusinessContext`, `DesignDecision` ativas, `DesignOpenQuestion` abertas. E tem tools `read_design_session_memory`, `read_design_session_step`, `append_project_memory`.

Faltam **comportamentos prescritos** no prompt v2:

1. **Ao abrir planning**: Vitoria lê `Project.memoryMd`. Se houver decisão recente (<7d) que toca scope do sprint planejado, abre com: "Vi que o Vitor registrou em DD/MM: '<statement>'. Essa decisão muda escopo desta sprint?"
2. **Antes de propose_task_action com scope/platform/architecture tags**: chamada obrigatória do Conflict Detector contra `activeDecisions`.
3. **Quando PM revelar info project-level**: regra dura no prompt — chamar `append_project_memory` com section apropriada. Vitor lê na próxima session.
4. **Ao detectar pergunta aberta relevante** (`DesignOpenQuestion`): Vitoria levanta antes de propor depender daquela info. Em vez de chutar, escalonar.

Essas regras vão como **skills**, não prompt monolítico: `cross_agent_protocol_with_vitor.md` skill.

## Roadmap visual

```
G0 (6h) → G1 (8h) → G2 (3h) → G3 (3h) → G4 (4h) → G5 (4h) → G6 (4h) → G7 (3h)
 │         │         │         │         │         │         │         │
 eval +    source    skills    gate      conflict  drafter   forecast  reflector
 outcome   readers   catalog   hard      detector  +badges   sprint    + cross-
 wiring    + cache             block                                   agent
```

**Total realista**: ~35h sobre F0-F5 do intelligence-plan (~22h). Total geral ~57h.

**Ordem é importante**: G0 antes de tudo (sem baseline, qualquer claim é vazio). G1 antes de G3-G5 (especialistas dependem de NormalizedSource). G2 cedo (reduz tokens dos próximos). G3 antes de G4 (capacity é dado bruto pra conflict).

## Decisões cravadas

| # | Decisão | Default |
|---|---------|---------|
| 1 | Especialistas como sub-LLM calls (não agents com thread) | Sub-LLM via `generateObject` — promover só se precisar conversa multi-turn |
| 2 | Source Reader cache key | `(planningId, sourceRef, computedVersion)` — versão bumpa quando schema do reader muda |
| 3 | Gates fail-mode | Erro estruturado pro modelo entender, não exception 500 |
| 4 | Skill content storage | Markdown plain no DB (não MDX), editável via UI manager-only |
| 5 | Confidence label | Schema obrigatório (Zod refuses null) |
| 6 | Sprint Forecaster modelo | Estatística simples + LLM pra contextualizar (não ML treinado) |
| 7 | Conflict Detector escopo | Só ativa quando proposal tags intersectam decision tags |
| 8 | Outcome Reflector frequência | Cache 1h, recomputa em loadContext após expirar |
| 9 | Cross-agent writes | Vitoria escreve `Project.memoryMd` via optimistic lock (já implementado) |
| 10 | Image reader opt-in | Custo de Vision API alto; PM marca attachment como "analisar imagem" pra ativar |

## Riscos

1. **Especialistas geram latência somada.** Pipeline canônico chama 4-5 specialists em paralelo na abertura. Cada um 1-3s → ~3-5s total (com paralelismo). PM pode achar lento. Mitigação: streaming de "Vitoria está lendo: ✓ transcript 1, ✓ planilha, ⏳ transcript 2".
2. **Custo dispara em planning com 10+ sources.** Source Reader é cacheado, mas primeira leitura é cara. Mitigação: budget per-session (~$5 cap pra plannings pesadas), priority queue (mais recentes primeiro).
3. **Conflict Detector false positives.** Sonnet pode achar conflito onde não há. Mitigação: gate retorna severity, "warning" não bloqueia; "blocking" sim. Eval suite cobre este eixo.
4. **Skill catalog vira gaveta de junk.** Sem disciplina, 50 skills viram noise. Mitigação: review trimestral, deprecate skill com `usage_count < 5/mês`.
5. **Outcome Reflector reforça viés histórico.** Se PM costuma editar muito, Vitoria pode "aprender" a propor menos — mas o problema talvez seja o estilo da Vitoria, não a expectativa. Mitigação: Reflector reporta padrões, **não muda comportamento direto**. PM lê e decide.
6. **Sprint Forecaster sem amostra (projeto novo).** < 3 sprints históricos → forecast retorna `confidence: 'low'` + fallback global.
7. **Image reader (vision) caro.** Manter opt-in. Se PM não marca attachment como image-analyzable, Vitoria só vê metadata.
8. **Multi-fonte sintetizar pode duplicar signal.** Transcript fala de "Stripe" e planilha tem coluna "Stripe MRR". Source Readers individuais não veem o outro. Mitigação: G7 introduz `multi_source_synthesis_patterns` skill com regras de dedup.

## Fora de escopo (v2)

- **RAG semântico sobre código** — backlog. Repo manifest manual (E1 do intelligence-plan) basta por agora.
- **Vector embeddings** dos `NormalizedSource` pra busca semântica cross-planning — backlog G8+.
- **Fine-tune** de modelo com `AgentProposalOutcome` — coletar ≥3 meses antes de considerar.
- **Multi-projeto cross-pollination** (Vitoria de um projeto sugerindo padrões pra outro) — backlog. Tenant isolation primeiro.
- **Conversa multi-turn com especialista** (ex.: Conflict Detector clarifying questions) — promover sub-LLM pra agent real só quando justificado.
- **Vitoria gerando próprias skills** (meta-learning) — fora de escopo G7.
- **Alerting fora do app** — backlog, daily digest aparece se virar dor.
- **A/B test de prompts/modelos por especialista** — backlog, infra de eval primeiro.

## Pontos abertos pós-G7

- **Quando promover especialista pra agent real (sub-thread)?** Sinal: PM pede esclarecimento ao output de um especialista mais de 3× por semana — vira agent com thread persistente, conversa multi-turn.
- **Vitoria escrevendo em `DesignSession.memoryMd`** (não só `Project.memoryMd`) — quando planning toca step específico de DS, vale puxar/atualizar memória da session? Probable yes, mas requires conflict resolution com Vitor.
- **Hot-reload de skills sem deploy** — versionar skills no DB, agent recarrega quando `updatedAt` muda. Já tem schema, falta hot-reload.
- **Specialist Marketplace interno** — outros projetos do Volund pedem "quero um Capacity Gate" pra outro agente. Generalizar.

## Dependências externas

- G0 depende de F1.5 do intelligence-plan (`AgentProposalOutcome` + telemetria) **completo**.
- G1 image-reader depende de Claude vision via OpenRouter (Sonnet 4.6 com input image — verificar pricing).
- G3 capacity gate depende de `ProjectSquad` + `SquadMember.fpCapacity` populados (já em produção).
- G6 forecaster depende de ≥3 sprints históricos completados (sem isso, fallback default).
- G7 reflector depende de `AgentProposalOutcome` com ≥30 rows no projeto (sem isso, skip).

## Inspirações citadas

- **[Volund OS Oracle pattern](https://github.com/volund-ia/volund-os/blob/main/lib/agent/core/oracle-prompt.ts)** — orquestrador puro que delega, nunca executa. Não copiamos como-está (Vitoria mantém domínio); copiamos o princípio de decomposição.
- **[Volund OS delegation tool](https://github.com/volund-ia/volund-os/blob/main/lib/ai/tools/delegation.ts)** — estrutura obrigatória de prompt (Contexto/Tarefa/Restrições/Formato/Critérios de sucesso). Aplicamos internamente em cada specialist (schema enforced).
- **[Volund OS skill catalog](https://github.com/volund-ia/volund-os/blob/main/lib/ai/tools/skills.ts)** — porta direta. Catálogo no prompt, content sob demanda.
- **[Vitor memory plan](../vitor/vitor-memory-plan.md)** — disciplina de confidence labels, optimistic locking, comportamentos prescritos no prompt. Vitoria herda padrão.
- **[Alpha extractors](../../../src/lib/agent/agents/alpha/extractors/actions.ts)** — `generateObject` + schema Zod + prompt PT-BR. Specialists seguem.

---

**Resumo executivo em 4 frases**:
1. Vitoria v2 vira orquestradora de 6 especialistas independentes, cada um avaliável e calibrável em isolamento.
2. Multi-fonte (transcript / planilha / PDF / imagem / Granola / Roam) tem Source Readers dedicados que normalizam pra `NormalizedSource` cacheado — Vitoria nunca vê fonte crua.
3. Capacity Gate e Conflict Detector são gates hard que **bloqueiam** propose_task_action — não sugestão.
4. Outcome loop fechado (AgentProposalOutcome + SprintOutcome) faz Vitoria aprender com o que aceitam, editam e entregam — sem fine-tune, só leitura disciplinada do histórico.

Sem os 4, "Vitoria inteligente" é claim. Com os 4, ela vira o copiloto de planning mais sofisticado que já se construiu sobre Next.js + Supabase + AI SDK.
