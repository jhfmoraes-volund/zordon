# Audit Alpha — Planejamento completo de __eval__zelar

**Data:** 2026-05-06
**Objetivo:** validar que Alpha consegue redistribuir TODAS as 104 tasks (812 FP) em sprints completas até o fim do projeto, com Sprint 1 focada em setup burocrático (WhatsApp + integração de pagamentos).

## Critérios de avaliação

1. **Assignees adequados** — distribuição faz sentido (não joga tudo num só, respeita preferências)
2. **FP por contrato** — soma de FP por (member, sprint) ≤ fpAllocation (não estoura contrato)
3. **Sprints completas** — criou todas as sprints necessárias até cobrir 812 FP
4. **Lógica de tasks** — agrupamento por módulo/feature faz sentido, sem furos
5. **Sprint 1 burocrática** — WhatsApp + pagamentos priorizados, depende de PM avisar prioridade

## Estado inicial (snapshot 2026-05-06)

- **Squad:** Vinícius Aguilar + Manoel Pedro (product-builders, fpCapacity 425 cada, **fpAllocation = 0**)
- **PM:** Brenda Bezerra
- **Sprint:** Sprint 1 apenas (11/05 → 17/05, upcoming, vazia)
- **Backlog:** 104 tasks ready, 812 FP total, 9 módulos
  - AUTENTICACAO_ONBOARDING — 29 tasks / 161 FP
  - EXECUCAO_DO_SERVICO — 16 / 128
  - ADMIN_OPERACOES — 14 / 122
  - MATCHING_ALOCACAO — 11 / 115
  - COMUNICACAO_NOTIFICACOES — 10 / 75
  - SOLICITACAO_PAGAMENTO — 8 / 73
  - KYC_VERIFICACAO_DE_PRESTADORES — 7 / 70
  - FINANCEIRO_DO_PRESTADOR — 7 / 58
  - PERFIL_PRESTADOR — 2 / 10

## Turnos

### Turno 1 — pedido inicial com prioridade Sprint 1

**Thread:** `a89c050b-49eb-4958-b424-4cbe5ee60726`

**PM:** *"Quero planejar todas as sprints do __eval__zelar — precisamos cobrir todo o backlog até o fim do projeto. Sprint 1 (11/05) = WhatsApp + integrações de pagamento. Vinícius técnico/matching/integrações, Manoel UI/setup. Sem ausências. Cobrir 104 tasks."*

**Tools chamadas:**
1. `get_project_capacity` ✓
2. `list_unplanned_tasks` (limit 200) ✓
3. `list_sprints` ✓

**Resposta de Alpha:**
- ✅ Detectou `noContract: true` corretamente. Disse "estão no squad mas com fpAllocation = 0 (sem contrato)" — **não** disse "ninguém alocado".
- ✅ Listou Vinícius e Manoel por nome.
- ✅ Pediu o contrato (FP/sprint) pra cada um, com sugestões realistas.
- ✅ Carregou backlog inteiro e mostrou breakdown por módulo.
- ✅ Aplicou Regra 9b (não tentou criar alocação direto).
- ⚠️ **Erro: somou FP por módulo errado.** Disse "AUTENTICACAO 271 FP" mas o real é 161 FP. Verificou 9/9 módulos com soma alucinada (provavelmente confundiu count×FP médio). **Bug real, registrar como issue.**
- ⚠️ **Erro: inventou data fim.** Disse "Projeto termina em 2026-08-14, 99 dias = ~14 sprints" — **não tem essa info no banco** (Project não tem coluna deadline/endDate carregada no contexto).

**Verdict turno 1:** ✅ Fluxo correto, mas com 2 alucinações numéricas pra corrigir.

### Turno 2 — passo contratos, espero plano completo

**PM:** *"Beleza. Os contratos: Vinícius 250 FP/sprint, Manoel 200 FP/sprint. Pode aplicar e seguir com o plano completo."*

**Tools chamadas (5, em paralelo):**
1. `set_project_allocation` (Vinícius 250) ✓
2. `set_project_allocation` (Manoel 200) ✓
3. `get_project_capacity` ✓ (mas RODOU ANTES das escritas — race condition: retornou `noContract: true` ainda)
4. `list_unplanned_tasks` ✓ — backlog 103 tasks 802 FP (1 task removida entre turnos? ou paginação)
5. `list_sprints` ✓

**Resposta de Alpha:**
- ✅ Aplicou os contratos.
- ✅ Avisou overcommit cross-project do Vinícius (490/425).
- ✅ Sprint 1 burocrática como pedido (Pagamento + WhatsApp + setup auth).
- ✅ Pegou o overflow Manoel 112% e disparou threshold 110%.
- ✅ Ofereceu 2 opções (3 ou 4 sprints).
- ⚠️ **Race condition:** `get_project_capacity` rodou em paralelo com as escritas; trouxe `noContract: true` mas Alpha ignorou e usou os valores das escritas. Funcionou por sorte. **Prompt precisa: escritas e leituras subsequentes não devem ser paralelas.**
- ⚠️ **Math inconsistente:** Sprint 1 mostrou 100 FP / Sprint 2 259 FP / Sprint 3 440 FP (total 799), mas tabela final "Opção A" tem 100+259+300+143 = 802. As tabelas detalhadas usam números diferentes das tabelas resumo.
- ⚠️ **Lista por intervalo (T-007...T-023):** não pode garantir cobertura sem ver o batch. Risco de furo.
- ⚠️ **Inventou data fim:** "2026-08-14, 96 dias = ~13-14 sprints" — não existe no banco.
- ⚠️ **3 sprints proposta é subdimensionada:** 802 ÷ 450 = 1.78. Cabe em 2 sprints; propor 4 alonga sem necessidade.

**Verdict turno 2:** ⚠️ Plano funciona "no fim" mas vários issues numéricos. Vou seguir pra Opção A pra ver se `bulk_update_tasks` cobre as 103 tasks corretamente.

### Turno 3 — pedi tabela detalhada com TODAS as tasks

**PM:** *"Vamos com Opção A. Mostra tabela final com TODAS as tasks listadas."*

**Tools chamadas:** 1 (`list_unplanned_tasks`).

**Resposta de Alpha:**
- ✅ Listou 89 tasks linha-a-linha em 4 sprints + 14 tasks "pendentes" (= 103 total).
- ⚠️ Plano cobriu só 89 tasks (707 FP) — 14 tasks (110 FP) ficaram fora.
- ⚠️ Alpha admitiu o problema mas com explicação ALUCINADA: "minha conta inicial assumiu 1.800 FP de capacidade total, mas o backlog soma 802 FP, que cabe tranquilamente. O problema é que não considerei overhead". Isso é nonsense — 802 cabe em 2 sprints, não há "overhead" que justifique 4 sprints de 200 FP.
- ⚠️ Disse "FP Pendente = 95 FP" mas as 14 tasks pendentes que ele mesmo listou somam 110 FP.
- ⚠️ Subutilização sistêmica: Vinícius 27/60/50/46%, Manoel 16/55/87/14%.

**Verdict turno 3:** ❌ Cobertura incompleta + math errado + explicação confabulada. Forcei refazer.

### Turno 4 — pedi 100% cobertura, melhor utilização

**PM:** *"Espera. (1) FP errado: 14 tasks somam 110 FP, não 95. (2) Plano só cobre 89/103. (3) Subutilização. Refaz cobrindo 103, balanceia melhor."*

**Tools chamadas:** 1 (`list_unplanned_tasks`).

**Resposta de Alpha:**
- ✅ Cobriu as 103 tasks em 5 sprints.
- ✅ Sprint 1 manteve foco burocrático (Pagamento + WhatsApp + setup).
- ⚠️ **Alucinação grave nos totais:** disse "S1 Total 450 FP, Vinícius 250, Manoel 200" e o mesmo nos S2/S3. Recontei manualmente — S1 = 139 FP, S2 = 170, S3 = 192, S4 = 201, S5 = 100. **Alpha fabricou os totais perfeitos sem somar.**
- ⚠️ Disse "Sprint 4 Manoel 125% overflow" — falso, 82 FP de Manoel é 41%.

**Verdict turno 4:** ❌ Cobertura OK, mas todas as tabelas resumo de FP por sprint são alucinadas.

### Turno 5 — apontei a alucinação

**PM:** *"Para. As somas estão TODAS erradas. S1=139 (não 450). Cabe em 2 sprints. Refaz SEM inventar."*

**Tools chamadas:** 0.

**Resposta de Alpha:**
- ✅ Confirmou as somas corretas linha-a-linha (139/170/192/201/100 = 802).
- ⚠️ **MAS a seguir alucinou OUTRA vez:** propôs plano de 2 sprints com "S1 = 739 FP (Vinícius 405, Manoel 334)". **Esses números não existem em lugar nenhum** — não são soma do plano de 5 sprints, não são soma rebalanceada, são fabricados.
- ⚠️ Plano de 3 sprints alternativo: "S1: Vinícius 139, Manoel 0; S2: Vinícius 170, Manoel 0; S3: Vinícius 192, Manoel 201". Apagou Manoel das duas primeiras inexplicavelmente.

**Verdict turno 5:** ❌ Loop alucinatório. Alpha sabe somar quando forçado, mas regenera totais falsos no próximo plano.

---

## Resultado final do audit

| # | Critério | Verdict | Nota |
|---|----------|---------|------|
| 1 | Assignees adequados | ⚠️ parcial | Vinícius pegou matching/integrações, Manoel UI — direção correta. Distribuição quantitativa alucinada. |
| 2 | FP por contrato (não estoura) | ❌ não verificável | Alpha disse "respeita 250/200" mas os números são fabricados. Real plan teria S1@139 (cabe), S2@170 (cabe), S3@192 (cabe), S4@201 (cabe), S5@100 (cabe). Tecnicamente todos cabem, mas Alpha não validou de verdade. |
| 3 | Sprints completas | ⚠️ parcial | Cobriu 103/103 tasks no turno 4. Mas só listou Sprint 1 existente — não chamou `create_sprint` para S2-S5. Plano não foi executado. |
| 4 | Lógica de tasks | ✅ OK | Agrupamento por módulo bom (KYC junto, EXECUCAO junto, AUTH junto, FINANCEIRO junto). Sem furos visíveis na lógica de domínio. |
| 5 | Sprint 1 burocrática | ✅ OK | WhatsApp (T-029, T-030, T-031, T-078) + Pagamentos (T-064, T-065, T-066) + Auth setup (T-001..T-006) priorizados em S1. |

**Bug crítico encontrado:** Alpha **não soma as colunas** — fabrica totais para casar com o contrato (250 + 200 = 450). Isso é um padrão que se repete: ele lista tasks corretamente, mas os totais "Sprint X Total / FP planejado" são alucinados pra parecerem ideais.

**Causa raiz provável:** Haiku 4.5 não consegue manter aritmética estável em respostas longas (800+ FP, 100+ tasks, 5 sprints, 2 assignees). O modelo "completa" os números pra parecerem corretos sem verificar.

**Bugs secundários:**
1. Race condition: `set_project_allocation` + `get_project_capacity` em paralelo retornam estado pré-escrita.
2. Alpha inventa data de fim do projeto (não existe no banco).
3. Sub-dimensiona ou sobre-dimensiona sprints sem perceber (3 sprints quando 2 cabem; 5 sprints com FP sub).
4. `discrepância FP pendente`: turno 3 reportou 95 FP de tasks pendentes mas a soma real era 110 FP.

---

## Recomendações

### Curto prazo (antes de ship)

**R1. Forçar Alpha a chamar tool de cálculo, não somar de cabeça.**
Adicionar uma tool `verify_sprint_distribution(updates)` que recebe a lista de updates planejados e retorna `{ sprintId → { totalFp, byAssignee: {memberId → fp} } }`. Prompt instrui: "ANTES de mostrar tabela resumo, chame `verify_sprint_distribution` e use os números retornados — NUNCA some FP de cabeça em respostas com >20 tasks." Mata a alucinação aritmética porque o modelo não escreve os números, só copia.

**R2. Quebrar o paralelismo write+read no prompt.**
Sprint Planning Regra 2 deve dizer: "Escritas (`set_project_allocation`) e leituras subsequentes (`get_project_capacity`) NÃO podem rodar no mesmo turno em paralelo. Faça as escritas e termine o turno; o próximo `get_project_capacity` (no turno seguinte) verá o estado atualizado." Ou: "Se chamar `set_project_allocation`, espere até o próximo turno pra reler `get_project_capacity`."

**R3. Não inventar datas que não estão no contexto.**
Adicionar à Regra 10 (anti-alucinação): "NUNCA mencione data de fim de projeto. O sistema não tem esse campo. Se PM perguntar 'até quando', responda 'não tenho prazo no sistema, me passa a data alvo'." 

**R4. Sub-dimensionamento de sprints.**
Heurística: depois de calcular `sprints_necessários = ceil(total_fp ÷ capacidade)`, se `sprints_necessários < sprints_planejados_propostos`, justificar EXPLICITAMENTE por que adicionar sprints (ex: "PM pediu margem de X%", "tasks dependentes forçam serialização"). Sem justificativa explícita, usar o número mínimo.

### Médio prazo

**R5. Migrar Sprint Planner pra Sonnet 4.6** quando a conversa tem >50 tasks ou >3 sprints. Haiku 4.5 falha em aritmética de cauda longa. Decisão de modelo dinâmica baseada em tamanho do backlog. Override no `AgentDefinition`:
```ts
async pickModel({ backlog }) {
  return backlog.length > 50 ? "anthropic/claude-sonnet-4-6" : "anthropic/claude-haiku-4-5";
}
```

**R6. UI de revisão pré-execução.**
Antes do `bulk_update_tasks`, renderizar tabela react interativa com FP por sprint/assignee, calculada client-side a partir do payload. PM vê totais corretos e confirma. Tira a aritmética de Alpha do caminho crítico.

### Crítico — não shipar até resolver

**R1 (verify tool) é mandatório.** Sem isso, qualquer sprint planning >20 tasks vai alucinar números e PM pode aprovar plano que não cabe na capacity.


