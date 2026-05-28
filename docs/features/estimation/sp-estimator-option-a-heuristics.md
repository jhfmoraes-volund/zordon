# Estimador de SP — Opcao A: Heuristicas

> Estimativa automatica de Story Points baseada em regras deterministicas.
> Zero custo de API. Implementavel em 1 dia. Previsivel e auditavel.

---

## 1. Conceito

O estimador analisa a spec da task e calcula um score bruto baseado em indicadores mensuráveis. Esse score e mapeado pra escala Fibonacci (1, 2, 3, 5, 8, 13, 21).

Nao depende de LLM. As regras sao explicitas — o PM pode ver exatamente porque a task recebeu 8 SP e discordar se quiser.

---

## 2. Indicadores e pesos

### 2.1 Acceptance Criteria (peso alto)

Quantidade de criterios e o indicador mais forte de tamanho. Cada criterio e um "pedaco de trabalho" verificavel.

| Criterios | Score |
|-----------|-------|
| 1-3 | +2 |
| 4-6 | +5 |
| 7-10 | +9 |
| 11-15 | +14 |
| 16+ | +20 |

**Como contar:** cada linha que comeca com `- [ ]` ou `- ` no campo `acceptanceCriteria`.

### 2.2 Tipo de task (peso medio)

Tipos diferentes tem complexidade intrinseca diferente.

| Tipo | Score |
|------|-------|
| seed | +1 |
| bugfix | +2 |
| refactor | +2 |
| setup | +3 |
| management | +1 |
| feature | +4 |
| component | +5 |

Componentes reutilizaveis sao mais complexos que features pontuais — precisam de API generica, props tipadas, edge cases, responsividade.

### 2.3 Keywords de complexidade (peso medio)

Palavras no `technicalNotes`, `acceptanceCriteria` ou `description` que indicam trabalho extra.

| Keyword | Score | Razao |
|---------|-------|-------|
| drag-and-drop, dnd, sortable | +4 | Interacao complexa, edge cases |
| real-time, websocket, polling | +3 | Estado sincronizado |
| csv, import, export, parse | +3 | Parsing, encoding, edge cases |
| transacional, transaction | +2 | Logica de rollback |
| webhook, api externa | +3 | Integracao, error handling |
| multi-step, wizard, stepper | +3 | Estado multi-etapa |
| chart, grafico, sparkline, svg | +3 | Renderizacao visual |
| responsive, mobile, mobile-first | +2 | Breakpoints, layout alternativo |
| bulk, batch, mass | +2 | Operacoes em lote |
| score, scoring, calculo | +2 | Logica de negocio |
| auth, token, session, cookie | +2 | Seguranca |
| cache, memoize, debounce | +1 | Otimizacao |
| search, filtro, filter, sort | +2 | Query complexa |
| validacao, validation | +1 | Regras de input |

**Regra:** cada keyword conta apenas 1 vez por task, mesmo se aparece multiplas vezes.

### 2.4 Dependencias (peso baixo)

Tasks com muitas dependencias indicam integracao — mais risco de bloqueio e mais trabalho de "cola".

| Dependencias | Score |
|-------------|-------|
| 0 | +0 |
| 1 | +1 |
| 2-3 | +2 |
| 4+ | +4 |

### 2.5 Scope declarado (peso baixo, tiebreaker)

O scope que o PM/time definiu serve como ancora minima. O estimador nao pode sugerir menos que o piso do scope.

| Scope | Piso SP |
|-------|---------|
| micro | 1 |
| small | 2 |
| medium | 5 |
| large | 8 |

---

## 3. Calculo

```
score_bruto = criteria_score + type_score + keywords_score + deps_score

// Mapear pra Fibonacci mais proximo
fibonacci = [1, 2, 3, 5, 8, 13, 21]
sp_sugerido = fibonacci mais proximo do score_bruto (arredonda pra cima)

// Aplicar piso do scope
sp_final = max(sp_sugerido, piso_scope)
```

### Exemplo: TASK-013 (Pipeline visual — Kanban de Deals)

```
Acceptance Criteria: 12 items         → +14
Tipo: feature                         → +4
Keywords: drag-and-drop, filter, sort → +4 +2 +2 = +8
Dependencias: 3 (TASK-002, 006, 009)  → +2
                                        ────
Score bruto:                            28

Fibonacci mais proximo (cima): 21
Scope declarado: medium (piso 5)
SP sugerido: 21
SP original: 13
```

Nesse caso o estimador sugeriria 21 ao inves de 13. O PM pode aceitar ou ajustar. O ponto e que a estimativa e justificada e discutivel.

### Exemplo: TASK-012 (CRUD de Empresas)

```
Acceptance Criteria: 6 items          → +5
Tipo: feature                         → +4
Keywords: nenhuma relevante           → +0
Dependencias: 2 (TASK-005, 009)       → +2
                                        ────
Score bruto:                            11

Fibonacci mais proximo (cima): 13
Scope declarado: small (piso 2)
SP sugerido: 13
SP original: 3
```

Aqui o estimador superestima. O CRUD de empresas e simples apesar de ter 6 criterios (sao criterios triviais). Isso mostra a **limitacao das heuristicas**: nao distinguem criterios triviais de complexos.

---

## 4. Output pro usuario

Na tela de criacao/edicao de task, ao preencher a spec:

```
┌──────────────────────────────────────────┐
│ SP Sugerido: 13                          │
│                                          │
│ Breakdown:                               │
│  • 6 acceptance criteria        +5       │
│  • Tipo: feature                +4       │
│  • Keyword: filter              +2       │
│  • 2 dependencias               +2       │
│  • Score bruto: 13 → SP: 13             │
│                                          │
│ [Aceitar 13]  [Ajustar manualmente ___]  │
└──────────────────────────────────────────┘
```

O PM ve o breakdown, entende o raciocinio, e decide se aceita ou ajusta.

---

## 5. Calibracao com dados reais

Apos cada sprint:

1. Coletar pares: `(sp_estimado, sp_real)` onde `sp_real` e ajustado pelo PM pos-sprint com base no esforco real
2. Calcular erro medio: `erro = media(|sp_estimado - sp_real| / sp_real)`
3. Se erro > 30%: revisar pesos dos indicadores
4. Se um tipo de keyword consistentemente subestima: aumentar seu peso
5. Se acceptance criteria sempre superestima: reduzir o peso ou adicionar "peso por criterio trivial"

**Meta:** erro medio < 20% apos 3 sprints.

---

## 6. Vantagens e limitacoes

### Vantagens
- Zero custo (sem API de LLM)
- Deterministico — mesma spec = mesma estimativa, sempre
- Auditavel — PM ve exatamente porque recebeu aquele SP
- Rapido — calculo instantaneo, nao espera resposta de API
- Funciona offline
- Facil de ajustar — mudar um peso e deploy

### Limitacoes
- **Nao entende contexto.** "6 acceptance criteria" pode ser 6 campos de formulario (trivial) ou 6 integrações complexas (enorme). Heuristica trata igual.
- **Keywords sao frageis.** Se alguem escreve "arrastar e soltar" ao inves de "drag-and-drop", nao detecta.
- **Nao aprende sozinho.** Precisa de ajuste manual dos pesos apos cada sprint.
- **Superestima CRUD simples, subestima tarefas de integracao.** O score por criterio e linear, mas a complexidade real nao e.

---

## 7. Implementacao

### Arquivos
- `src/lib/sp-estimator.ts` — funcao pura `estimateSP(task) → { sp, breakdown }`
- Chamada no form de criacao/edicao de task, recalcula ao mudar spec fields
- Resultado mostrado como sugestao, nao como valor forcado

### Esforco
- ~4h de implementacao (funcao + integracao no form)
- ~2h de testes com as 24 tasks existentes pra validar pesos iniciais

### Dependencias
- Nenhuma. Funcao pura, zero libs externas.
