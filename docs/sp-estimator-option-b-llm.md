# Estimador de SP — Opcao B: LLM-Assisted

> Estimativa de Story Points usando modelo de linguagem (OpenAI).
> Entende contexto, aprende com historico, justifica em linguagem natural.

---

## 1. Conceito

O estimador envia a spec da task para o LLM com:
1. A task-ancora (CRUD = 5 SP) como referencia
2. Um conjunto de tasks ja estimadas como few-shot examples
3. O historico de velocity (SP estimado vs SP real) pra calibrar

O modelo retorna: SP sugerido + justificativa em texto + nivel de confianca.

A diferenca fundamental da Opcao A: **o LLM entende que "6 acceptance criteria de formulario" e diferente de "6 acceptance criteria de integracao"**. Ele le o conteudo, nao apenas conta linhas.

---

## 2. Arquitetura

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Task Spec   │────▶│  Prompt      │────▶│  OpenAI     │
│  (AC, tech   │     │  Builder     │     │  API        │
│   notes,     │     │              │     │  (gpt-4o)   │
│   deps...)   │     │  + ancora    │     │             │
└─────────────┘     │  + examples  │     └──────┬──────┘
                     │  + historico │            │
                     └──────────────┘            │
                                                 ▼
                                    ┌─────────────────────┐
                                    │  { sp: 8,           │
                                    │    confidence: 0.85, │
                                    │    reasoning: "..." }│
                                    └─────────────────────┘
```

---

## 3. O Prompt

### System prompt

```
Voce e um estimador de Story Points para um time de desenvolvimento de software.

Contexto:
- Sprint de 15 dias (10 dias uteis)
- Time usa escala Fibonacci: 1, 2, 3, 5, 8, 13, 21
- Task-ancora: um CRUD simples (listagem + create + edit + delete de 1 entidade
  com 5-6 campos, API + pagina frontend) = 5 SP
- 1 SP ≈ ~1h de trabalho focado de um desenvolvedor pleno
- Tasks maiores que 21 SP devem ser sugeridas para quebra

Regras:
1. Analise a spec COMPLETA: acceptance criteria, technical notes, dependencias, tipo
2. Compare com a task-ancora e com os exemplos fornecidos
3. Considere complexidade REAL, nao apenas quantidade de criterios
4. Penalize: integracoes externas, drag-and-drop, parsing, logica de negocio complexa
5. Nao penalize: criterios triviais (campos de formulario, badges, etc)
6. Retorne JSON exato no formato especificado
```

### User prompt (template)

```
## Task a estimar

**Titulo:** {title}
**Tipo:** {type}
**Descricao:** {description}
**Scope declarado:** {scope}
**Complexity declarada:** {complexity}
**Dependencias:** {dependencies}

**Acceptance Criteria:**
{acceptanceCriteria}

**Technical Notes:**
{technicalNotes}

**Business Context:**
{businessContext}

## Exemplos de referencia (tasks ja estimadas)

{few_shot_examples}

## Historico de calibracao (se disponivel)

{calibration_data}

## Responda em JSON:

{
  "sp": <numero fibonacci>,
  "confidence": <0.0 a 1.0>,
  "reasoning": "<justificativa em 2-3 frases>",
  "risks": ["<risco 1>", "<risco 2>"],
  "suggestion": "<sugestao de quebra se sp > 13, ou null>"
}
```

### Few-shot examples

Selecionados do banco — as tasks ja entregues com SP validado pelo time:

```
Exemplo 1: CRUD de Empresas
- Tipo: feature
- AC: 6 items (listagem, dialog, busca, delete, click-to-edit, API)
- Tech: _count no Prisma
- SP real: 3
- Nota: CRUD simples, sem logica, 6 AC mas todos triviais

Exemplo 2: Pipeline Kanban
- Tipo: feature
- AC: 12 items (kanban, drag-and-drop, filtros, dialog, slide-over, API)
- Tech: @dnd-kit, stages, deals, PATCH com activity auto
- SP real: 13
- Nota: DnD complexo, multiplas interacoes, estado compartilhado

Exemplo 3: Import CSV
- Tipo: feature
- AC: 9 items (upload, mapeamento, preview, resultado, parser, API)
- Tech: parser CSV, upsert, transaction, deteccao duplicatas
- SP real: 13
- Nota: multi-step wizard, parsing com edge cases, backend transacional
```

Inicialmente usamos as 24 tasks do CRM como exemplos (SP definidos manualmente). Conforme sprints passam, substituimos por SP validados pos-entrega.

---

## 4. Calibracao com velocity real

### O loop de feedback

Apos cada sprint:

1. Coletar pares: `(spec, sp_estimado, sp_real, tempo_dias)`
2. Adicionar ao banco de calibracao
3. Selecionar os 10 exemplos mais relevantes pra cada estimativa futura (por tipo similar, scope similar)
4. Incluir no prompt como historico:

```
## Historico de calibracao

Nas ultimas estimativas deste time:
- Tasks de tipo "feature" com 6-8 AC foram estimadas em media 5.2 SP e entregues em media 6.1 SP (subestimacao de 17%)
- Tasks com keyword "drag-and-drop" levaram em media 1.4x mais que a estimativa
- Tasks de tipo "component" foram estimadas com precisao (erro medio 8%)

Ajuste suas estimativas considerando esse historico.
```

### Selecao inteligente de exemplos

Nao mandamos todos os exemplos — selecionamos os **5-8 mais similares** a task sendo estimada:

```typescript
function selectExamples(task: TaskSpec, history: CalibratedTask[]): CalibratedTask[] {
  return history
    .map(h => ({
      ...h,
      similarity: computeSimilarity(task, h) // tipo + scope + keywords em comum
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 8);
}
```

Quanto mais similar o exemplo, melhor a estimativa. Um CRUD simples deve ser comparado com outros CRUDs, nao com um dashboard complexo.

---

## 5. Output pro usuario

### Na tela de task

```
┌──────────────────────────────────────────────────────┐
│ 🤖 SP Sugerido: 8                  Confianca: 85%   │
│                                                      │
│ "Task de feature com 8 acceptance criteria, inclui   │
│  integracao com webhook externo e deteccao de         │
│  duplicatas. Comparavel a TASK-014 (Import CSV, 13   │
│  SP) mas sem o wizard multi-step — estimativa         │
│  reduzida para 8."                                   │
│                                                      │
│ Riscos:                                              │
│  • Parsing de payload flexivel pode ter edge cases   │
│  • Deteccao de duplicatas por email depende de index │
│                                                      │
│ [Aceitar 8]  [Ajustar manualmente ___]               │
└──────────────────────────────────────────────────────┘
```

### Quando confianca < 60%

```
┌──────────────────────────────────────────────────────┐
│ ⚠️ SP Sugerido: 13               Confianca: 45%     │
│                                                      │
│ "Spec incompleta — poucos acceptance criteria e sem  │
│  technical notes. Baseado apenas no titulo e tipo,   │
│  estimativa e imprecisa. Recomendo detalhar a spec   │
│  antes de confirmar SP."                             │
│                                                      │
│ [Aceitar 13]  [Ajustar ___]  [Completar spec primeiro]│
└──────────────────────────────────────────────────────┘
```

Isso incentiva o time a escrever specs melhores — quanto mais completa a spec, maior a confianca da estimativa.

### Quando sugere quebra (SP > 13)

```
┌──────────────────────────────────────────────────────┐
│ 🤖 SP Sugerido: 21                 Confianca: 70%   │
│                                                      │
│ "Task grande com 15 acceptance criteria cobrindo     │
│  dashboard completo com 5 secoes, filtros, e dados   │
│  agregados. Recomendo quebrar em 2-3 subtasks."      │
│                                                      │
│ Sugestao de quebra:                                  │
│  1. Stats cards + funil (8 SP)                       │
│  2. Tabela ROI + filtros (8 SP)                      │
│  3. Charts temporais + top leads (5 SP)              │
│                                                      │
│ [Aceitar 21]  [Quebrar em subtasks]  [Ajustar ___]   │
└──────────────────────────────────────────────────────┘
```

---

## 6. Evolucao em 3 fases

### Fase 1 — Cold start (Sprint 1)

- Sem historico de velocity
- Few-shot: as 24 tasks do CRM com SP manuais
- Confianca sera baixa (~50-70%)
- **Valor principal:** forcar o time a pensar na spec antes de estimar

### Fase 2 — Calibracao (Sprints 2-3)

- Historico de Sprint 1 alimenta o prompt
- Few-shot: mix de tasks manuais + tasks com SP validado
- Confianca sobe (~65-80%)
- **Valor principal:** detectar padroes de subestimacao/superestimacao

### Fase 3 — Estavel (Sprint 4+)

- Historico robusto (30+ tasks calibradas)
- Few-shot: apenas tasks com SP validado, selecionadas por similaridade
- Confianca alta (~75-90%)
- **Valor principal:** estimativas confiaveis sem planning poker. PM valida em vez de estimar do zero.

---

## 7. Custo

### Por estimativa

- Modelo: gpt-4o-mini (barato, suficiente pra essa tarefa)
- Tokens por request: ~1.500 input (prompt + examples) + ~200 output
- Custo por request: ~$0.003 (R$ 0,015)

### Por sprint

- 20-30 tasks estimadas por sprint
- Custo: ~$0.09 (R$ 0,45) por sprint
- **Custo anual: ~R$ 12**

Custo desprezivel. Nao e fator de decisao.

### Latencia

- gpt-4o-mini: ~1-2 segundos por request
- Aceitavel para UX (botao "Estimar" com loading)
- Pode pre-calcular ao salvar a spec (background)

---

## 8. Vantagens e limitacoes

### Vantagens
- **Entende contexto.** Distingue "6 AC triviais" de "6 AC complexos"
- **Justifica em linguagem natural.** PM entende o raciocinio sem ver pesos numericos
- **Aprende com historico.** Cada sprint melhora a precisao
- **Sugere quebra de tasks grandes.** Previne tasks de 21 SP que deveriam ser 3 de 8 SP
- **Incentiva specs melhores.** Confianca baixa = spec incompleta
- **Detecta riscos.** Aponta edge cases que o PM pode nao ter visto
- **Custo irrelevante.** R$ 12/ano

### Limitacoes
- **Depende de API externa.** Se OpenAI cair, estimativa nao funciona (fallback pra Opcao A)
- **Nao deterministica.** Mesma spec pode gerar SP ligeiramente diferente em 2 chamadas
- **Cold start fraco.** Primeiras estimativas sem historico sao pouco melhores que heuristicas
- **Alucinacao possivel.** Modelo pode inventar justificativas convincentes mas erradas
- **Depende da qualidade da spec.** "Criar tela de contatos" sem AC gera estimativa ruim (mas isso e feature, nao bug — forca spec melhor)

---

## 9. Implementacao

### Arquivos

```
src/lib/sp-estimator-llm.ts    — funcao estimateSPWithLLM(task, examples, history)
src/lib/sp-examples.ts         — selecao de few-shot examples por similaridade
src/app/api/tasks/estimate/route.ts — endpoint POST que retorna estimativa
```

### Fluxo no frontend

1. PM preenche spec da task (AC, tech notes, tipo, scope)
2. Clica "Estimar SP" ou estimativa roda automaticamente ao salvar spec
3. Frontend chama `POST /api/tasks/estimate` com a spec
4. Backend monta prompt, chama OpenAI, retorna resultado
5. Frontend mostra SP + reasoning + confianca + riscos
6. PM aceita ou ajusta

### Esforco

- ~6h implementacao (prompt, API, integracao no form, display)
- ~2h teste e ajuste do prompt com as 24 tasks
- ~1h fallback pra Opcao A quando API falha

### Dependencias

- `openai` (ja no package.json)
- Variavel `OPENAI_API_KEY` no .env

---

## 10. Opcao A + B: abordagem hibrida (recomendada)

A melhor solucao nao e A **ou** B. E **A como base + B como refinamento:**

```
1. Heuristica (Opcao A) roda instantaneamente → SP base
2. LLM (Opcao B) roda em background → SP refinado + justificativa
3. Se LLM falha → usa SP da heuristica
4. PM ve os dois: "Heuristica: 8 SP | IA: 13 SP — Justificativa: ..."
5. PM decide
```

**Por que hibrido?**
- Heuristica e instantanea (UX imediata)
- LLM e mais preciso (chega em 1-2s)
- Fallback garantido (sem dependencia de API)
- PM ve duas perspectivas — se divergem muito, e sinal de que a task precisa de discussao

### Implementacao hibrida

```typescript
// No form de task
const heuristicSP = estimateSP(taskSpec);           // instantaneo
const llmEstimate = await estimateSPWithLLM(taskSpec); // 1-2s

// Mostrar ambos
// Se diferenca > 3 SP: highlight amarelo "estimativas divergem"
```
