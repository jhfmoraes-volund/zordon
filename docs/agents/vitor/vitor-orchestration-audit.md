# Vitor Orchestration Audit — Diagnóstico para o Alpha-Orquestrador

**Data:** 2026-05-05 / 2026-05-06
**Sessão executada:** `58d05f55-57c6-4b26-86c4-9199a8f67f34` (EVZL Inception "Zelar [eval]")
**Orquestrador (PM-no-chat):** Claude Code (modelo claude-opus-4-7[1m]) via `vitor-cli.ts`
**Executor:** Vitor (anthropic/claude-sonnet-4.6) via `bun x tsx scripts/vitor-cli.ts`
**Plano de referência:** [vitor-runbook-end-to-end.md](vitor-runbook-end-to-end.md)
**Espelho metodológico:** [alpha-audit.md](../alpha/alpha-audit.md) §3.4 (categorias de falha + tally + decisão go/no-go)

---

## Objetivo deste documento

Capturar, no formato de auditoria mensurável, **o que o Vitor é capaz de fazer sozinho** vs **o que precisa de PM-no-chat** quando conduzimos um briefing inception end-to-end. O sinal serve como blueprint pro **Alpha-orquestrador** — agente que vai conversar com o Vitor sem humano-no-loop.

Premissa metodológica: o orquestrador (eu) interagiu com o Vitor **só por linguagem natural via CLI**, espelhando exatamente o que um PM faz no chat web. SQL foi usado **apenas leitura** pra validar estado entre turns. A única exceção foi `scripts/approve-module-cli.ts` (criado neste exercício pra simular o "clique em Aprovar" do UI — ver §Achado-2).

---

## Setup

| Item | Valor |
|---|---|
| Project | EVZL (`__eval__zelar`) — `ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652` |
| Sessão | inception "Zelar [eval]" |
| Step da sessão | 9 (briefing) — único step que habilita `createTasks: true` |
| Módulos pré-existentes | AUTENTICACAO_ONBOARDING (9 stories aprovadas) + MATCHING_ALOCACAO (4 stories aprovadas) |
| Cards do brainstorm | 56 brutos / **54 únicos** (2 duplicatas confirmadas pelo Vitor) |
| Cards bucket=mvp | 38 |
| Volume gerado | 53 stories / 104 tasks / 812 FP / 0 drafts |
| Cobertura MVP final | **97,4%** (37/38 cards MVP cobertos — meta ≥90% ✅) |
| Wall-clock | ~5h, 15 turns CLI |
| Tool calls totais | ~190 (estimativa — média ~12 por turn) |

---

## Categorias de comportamento

Espelhando o spirit do alpha-audit.md, mas adaptado pro contexto de Vitor/briefing:

| Cat | Significado | Implicação pro Alpha |
|---|---|---|
| **autônomo** | Vitor entendeu, executou, output correto, sem ajuste | Alpha pode delegar cego |
| **autônomo-com-rampa** | Funciona, mas exige prompt rico/contextualizado | Alpha precisa investir em prompt-quality |
| **iterativo** | 2+ turns pra convergir (continue, refino) | Alpha precisa loop de validação |
| **decisão-de-produto** | Vitor parou pedindo input que muda escopo | Alpha precisa heurística OU defer humano |
| **erro-recuperável** | Tool falhou, Vitor se recuperou sozinho | Alpha não intervém |
| **erro-bloqueante** | Falha não auto-recuperável | Alpha precisa escalar |
| **fora-do-scope** | Faltou tool/contexto pro Vitor concluir | Buildar tool antes de Alpha |

---

## Tally por turn

| # | Tema | Tools chamadas | Cat. primária | Cat. secundária |
|---|------|---------------|--------------|----------------|
| V1 | KYC discovery + decisão de produto (split KYC vs PERFIL) | 1 | decisão-de-produto | autônomo |
| V2 | Criar PERFIL_PRESTADOR + KYC stories+tasks | 31 | autônomo-com-rampa | erro-recuperável |
| V2-bis | Aprovação KYC + PERFIL via cli script | 0 | (orquestrador) | — |
| V3 | EXECUCAO discovery + insights de duplicatas | 2 | autônomo | — |
| V4 | EXECUCAO task_breakdown (parte 1) | 31 | iterativo | — |
| V5 | "Continue" — proposta de US-029 tasks | 2 | iterativo | decisão-de-produto |
| V6 | Fecha EXECUCAO | 6 | autônomo | — |
| V6-bis | Aprovação EXECUCAO | 0 | (orquestrador) | — |
| V7 | SOLICITACAO+FINANCEIRO discovery + decisão autônoma | 1 | autônomo | — |
| V8 | SOLICITACAO+FINANCEIRO task_breakdown em batch único | 32 | autônomo | — |
| V8-bis | Aprovações | 0 | (orquestrador) | — |
| V9 | COMUNICACAO discovery (decisão por canal) | 2 | decisão-de-produto | iterativo |
| V10 | COMUNICACAO execute | 22 | autônomo | — |
| V10-bis | Aprovação | 0 | (orquestrador) | — |
| V11 | ADMIN discovery+execute single batch | 29 | autônomo | — |
| V11-bis | Aprovação ADMIN | 0 | (orquestrador) | — |
| V12 | Self-audit duplo (granularidade + SDD-readiness) | 2 | autônomo | — |
| V13 | Plano cleanup pós-audit | 0 | iterativo | — |
| V14 | Cleanup + LGPD + refactor — **gap de tooling** | 17 | **fora-do-scope** | autônomo |
| V15 | Audit final cobertura | 0 | autônomo | — |

### Tally consolidado

| Categoria primária | Count | % |
|---|---|---|
| autônomo | 9/15 | 60% |
| autônomo-com-rampa | 1/15 | 7% |
| iterativo | 3/15 | 20% |
| decisão-de-produto | 2/15 | 13% |
| **fora-do-scope** | **1/15** | **7%** |
| erro-bloqueante | 0/15 | 0% |

### Sanity (pós-execução)

| Métrica | Valor | Pass? |
|---|---|---|
| Cobertura MVP | 97,4% | ✅ (>90%) |
| Tasks com FP=NULL | 0 | ✅ |
| Tasks em status `draft` ao final | 0 | ✅ |
| Stories sem persona | 0 | ✅ |
| Stories sem AC | 0 | ✅ |
| Stories zumbis (cleanup-debt) | **4** | ⚠️ (8% noise) |
| Inter-module deps registradas | sim | ✅ |
| Quality SDD (sample 8 tasks) | 25% OURO / 50% PRATA / 25% BRONZE | ⚠️ meta 65% OURO |

---

## Achados — ordem de prioridade pro Alpha

### **Achado #1 — CRÍTICO** — Vitor não tem tools de edição de stories

**Evidência:** V14 produziu **4 stories zumbis** (US-022, US-033, US-049 incompleta, US-053 duplicata, US-003 título antigo).

**Causa raiz:** Vitor expõe `create_user_story` (idempotente por título — se título mudar, cria nova) e `set_story_refinement`, mas **NÃO** expõe:
- `update_user_story` (alterar title/want/soThat/moduleId/personaId) — existe em `alpha-hierarchy.ts:289` mas só registrado pro Alpha
- `manage_story_ac` (CRUD de Acceptance Criteria de uma story existente) — existe em `alpha-hierarchy.ts:440` mas só registrado pro Alpha
- `delete_user_story` ou `archive_user_story` — não existe em lugar nenhum

Quando o PM pede "renomeie esta story" ou "remova LGPD do título de US-003", Vitor cai em fallback de `create_user_story(novo título)` — **cria duplicata silenciosamente**.

**Impacto pro Alpha-orquestrador:**
- Alpha autonomamente vai gerar exatamente o mesmo padrão de bagunça em escala — qualquer auto-correção pós-audit produz lixo.
- 8% de noise (4/50 stories) é inaceitável em prod. Em projetos com refinamento iterativo (multi-sprints), o ratio sobe.

**Ação concreta:**
1. **Pré-Alpha**: registrar `updateStoryForOpsTool` e `manageStoryAcForOpsTool` em `src/lib/agent/tools.ts` no bloco `if (capabilities?.createTasks && capabilities?.projectId) { ... }` — replica o que está em `assembleAlphaTools` em `src/lib/agent/agents/alpha/tools.ts:536`.
2. **Pré-Alpha**: criar `archiveUserStoryTool` (soft-delete: muda title pra `[ARCHIVED]` + flag) ou `deleteUserStoryTool` (com guarda: bloqueia se tem tasks). Ambos faltam no produto inteiro.
3. **Alpha**: quando pede ao Vitor pra editar story, sempre passar `update_user_story(reference, patch)` no prompt como hint — caso contrário, Vitor vai tentar `create_user_story` com título novo.

**Impacto residual sem essa correção:** Vitor permanece "criador, não editor". Refinamento de stories só via PM-no-chat manual + SQL — Alpha-orquestrador inviável em projetos com ciclos de revisão.

---

### **Achado #2 — ALTO** — `approve_module` do Vitor não promove tasks `draft→backlog`

**Evidência:** No início do runbook, descobri que `approve_module` (registrado pro Vitor em `tools.ts`) **só marca `Module.approvedAt=now()` e linka stories pendentes**. **Não muda task.status**. A promoção `draft → backlog` só acontece via `promoteTasksForModule` (`src/lib/dal/story-hierarchy.ts:421`), invocada pelo endpoint `POST /api/modules/[id]/approve`.

Tive que criar [scripts/approve-module-cli.ts](../scripts/approve-module-cli.ts) pra simular o "clique do PM em Aprovar" no UI (faz a transação completa: `approvedAt + promoteTasksForModule + ModuleActivity`).

**Impacto pro Alpha-orquestrador:**
Sem tool consolidada, o Alpha tem 2 caminhos:
- (a) chamar `approve_module` (Vitor) e depois disparar HTTP no endpoint — exige stack do Next levantada e cookies de auth
- (b) replicar `approve-module-cli.ts` como tool nativa — é o caminho limpo

**Ação concreta:**
- Criar `approveModuleFullTool` (em `manage-stories.ts` ou novo arquivo) que faz o que `scripts/approve-module-cli.ts` faz: `Module.approvedAt + promoteTasksForModule + ModuleActivity`. Registrar pro Vitor E pro Alpha.
- Tool deve receber **guard-rails parametrizáveis**: `minCoverage`, `requireAllTasksHaveFP`, `requireAllStoriesCommitted`. Alpha aprova só quando guards passam.
- O endpoint HTTP `/api/modules/[id]/approve` continua existindo pro UI clicar — a tool nova é a mesma lógica embutida.

**Sinal pro produto**: hoje aprovação tem 2 caminhos divergentes (UI HTTP vs `approve_module` parcial do Vitor). Inconsistência. Consolidar.

---

### **Achado #3 — ALTO** — `list_project_tasks` quebrado (schema cache)

**Evidência:** V2 turn — Vitor chamou `list_project_tasks` e recebeu erro: `Could not find a relationship between 'Task' and 'DesignSession' in the schema cache`. Vitor degradou gracefully (chamou `list_stories` como fallback).

**Causa provável:** `listProjectTasksTool` em `src/lib/agent/tools/manage-tasks.ts` faz JOIN entre Task e DesignSession via Supabase client — relação que talvez não esteja exposta corretamente em PostgREST schema cache (pode precisar `NOTIFY pgrst, 'reload schema'`).

**Impacto pro Alpha-orquestrador:**
Alpha vai usar `list_project_tasks` rotineiramente pra entender estado de outros módulos antes de criar tasks novas com `relates_to`. Se essa tool falha silenciosamente, Alpha cria tasks órfãs sem inter-module deps.

**Ação concreta:**
1. Reproduzir o erro com `bun x tsx scripts/vitor-cli.ts ... --message "list tasks"` e investigar.
2. Provavelmente uma migration pendente ou foreign key declarada via SQL mas não em `database.types.ts` regenerada.
3. Se o problema for no design da query, refatorar pra fazer 2 queries simples + JOIN no client.

---

### **Achado #4 — MÉDIO** — Vitor pede confirmação mesmo quando autorizado a decidir

**Evidência:** V3, V7, V9 — em todos, eu disse explicitamente "tome a decisão e execute". Vitor analisou, propôs, **e parou pra confirmar** antes de executar. V11 foi a única exceção (executou direto), provavelmente porque o prompt foi mais imperativo ("execute discovery + criação tudo em 1 turn").

**Causa raiz:** Regra 0 do prompt do Vitor (`src/lib/agent/prompt.ts`) — "sempre confirme antes de criar/destruir". Boa prática em UI web com PM humano. Vira fricção em loop autônomo.

**Impacto pro Alpha-orquestrador:**
Cada confirmação extra = 1 turn extra = ~10s de latência + tokens duplicados (Alpha lê output do Vitor, escreve "ok vai", Vitor lê e executa).

Em projetos de 6-8 módulos × 3-4 turns por módulo, isso pode adicionar 30-50% de turns no total.

**Ação concreta** (3 opções, escolher uma):
1. **Patch no prompt do Vitor**: condicionar Regra 0 a "se a mensagem do PM não autorizar explicitamente decidir, confirme; senão execute". Risco baixo, requer ajuste de poucas linhas em `prompt.ts`.
2. **Heurística no Alpha**: quando Vitor responde com "Posso ...?" ou "Quer que eu ...?", responder automaticamente "Sim, executa" e re-disparar. Bom pra demos curtas.
3. **Capability flag**: adicionar `capabilities.autoConfirm: boolean` que muda o tom do prompt do Vitor. Default `false` (UI web), `true` (Alpha-orquestrador).

Recomendação: **#3** (mais limpo, opt-in por contexto).

---

### **Achado #5 — MÉDIO** — Vitor é excelente "second-pass auditor" mas faz por iniciativa, não systemicamente

**Evidência:**
- V1: detectou que cards `[PERFIL][PRESTADOR]` não pertenciam ao módulo KYC e propôs split
- V3: detectou 2 duplicatas no brainstorm (`y8cm1x0=mmawwcf`, `9r8tohj=rx1awgd`) sem ser pedido
- V3: detectou risco estrutural (gate de avaliação sem moderação) e propôs incluir card bucket=out como MVP
- V7: detectou outra duplicata (s6m6tg0/6xklwv2) e outra lacuna (cadastro de conta bancária)
- V11: criou story estrutural "app_config" sem card no brainstorm — inferiu de contexto técnico
- V12: self-audit identificou 1 unificação clara + 1 futura + 8 tasks classificadas em SDD-readiness

**Padrão:** Vitor faz auditoria de qualidade espontaneamente — é parte da personalidade dele, não da instrução.

**Impacto pro Alpha-orquestrador:**
- Bom: Alpha pode confiar no Vitor como **revisor + criador**. Audit espontâneo é bonus.
- Ruim: depende de Vitor *querer* auditar naquele turn. Não é determinístico.

**Ação concreta:**
- Alpha deve ter um **"audit step" obrigatório no fim de cada módulo**: prompt explícito "self-audit do módulo: gaps de cobertura, granularidade, SDD-readiness, inter-module deps". Output estruturado vai pra `record_decision` ou similar pra trilha de auditoria.

---

### **Achado #6 — MÉDIO** — Decisões de produto pendentes geram tasks BRONZE silenciosas

**Evidência:** V12 — 25% das tasks-amostra (T-065 gateway, T-036 KYC SDK) são BRONZE porque dependem de decisões não tomadas no projeto: "qual gateway de pagamento?" (spec diz "A VALIDAR: Mercado Pago"); "qual KYC provider?" (sem nome no spec). Spec rica não compensa decisão pendente.

**Padrão:**
- Vitor cria task com `// PROVEDOR_KYC.SDK(...)` (pseudocódigo) e segue.
- Não dispara `add_open_question` automaticamente — escreve a decisão pendente como nota dentro da descrição da task, onde fica enterrada.

**Impacto pro Alpha-orquestrador:**
- Alpha vai gerar tasks BRONZE em escala se não detectar o padrão.
- Em prod, agente IA executor recebe task BRONZE, **inventa** uma escolha de provider/SDK, vira código que não compila ou que usa lib errada.

**Ação concreta:**
1. Patch no prompt do Vitor: "antes de criar uma task que depende de decisão de produto não tomada (provider, SDK, lib não nomeada), chame `add_open_question` com a pergunta exata. Não enterre a decisão na descrição."
2. Heurística no Alpha pós-criação: detectar tasks com padrões `"A VALIDAR"`, `"PROVIDER.SDK"`, `"<TBD>"` na descrição e disparar `add_open_question` automático.

---

### **Achado #7 — BAIXO** — Limite real de batch é ~30+ tool calls/turn

**Evidência:**
- V2: 31 calls
- V4: 31 calls (parou no meio do módulo, precisou continue)
- V8: 32 calls (entregou completo)
- V11: 29 calls (entregou completo)
- V14: 17 calls (curto por natureza do trabalho)

Mediana ~25-30, máximo observado 32. Em V4, o stop foi **timing-related** (não atingiu hard limit, escolheu pausar). Em V8 e V11, batch maior funcionou sem problema.

**Impacto pro Alpha-orquestrador:**
- Alpha pode ser mais agressivo no batch size do que o "25-30" que assumi inicialmente.
- Pra evitar continues desnecessários, prompt do Alpha pra Vitor deve incluir: "se passar de 30 tool calls, OK pausar; senão, finalize em 1 turn".

**Ação concreta:** documentar o limite real no prompt do Alpha quando ele dispara batch grande.

---

### **Achado #8 — BAIXO** — Inter-module deps são identificadas mas não retroativas

**Evidência:** Vitor adiciona `relates_to` corretamente em tasks novas que apontam pra tasks antigas (ex: T-085 → T-044). **Mas não atualiza tasks antigas pra apontarem pras novas** (ex: T-044 nunca ganha `relates_to` T-085).

**Causa raiz:** Não há tool `add_task_dependency` (apenas `dependsOn` no momento da criação). Pra adicionar dep depois, teria que `update_task` com edição de campo de array — e `update_task` aceita só `title` + `description`.

**Impacto pro Alpha-orquestrador:**
- Grafo de deps fica **assimétrico**: tasks antigas não sabem que tasks novas dependem delas.
- Em queries de "o que essa task afeta?", as antigas parecem isoladas.

**Ação concreta:**
- Criar tool `add_task_dependency(taskRef, dependsOnRef, kind)` e expor pro Vitor + Alpha.
- Bonus: tool `remove_task_dependency` pra desfazer.

---

## Métricas de eficiência

### Turns por módulo

| Módulo | Turns Vitor | Tool calls | Wall-clock estimado |
|--------|-------------|-----------|--------------------:|
| KYC + PERFIL_PRESTADOR (V1-V2) | 2 | 32 | ~12 min |
| EXECUCAO_DO_SERVICO (V3-V6) | 4 | 41 | ~18 min |
| SOLICITACAO + FINANCEIRO (V7-V8) | 2 | 33 | ~14 min |
| COMUNICACAO_NOTIFICACOES (V9-V10) | 2 | 24 | ~10 min |
| ADMIN_OPERACOES (V11) | 1 | 29 | ~9 min |
| Self-audit + cleanup + LGPD (V12-V14) | 3 | 19 | ~12 min |
| Audit final (V15) | 1 | 0 | ~3 min |
| **Total** | **15** | **~178** | **~78 min** |

### Mediana e P95 por fase

| Fase | Mediana (calls) | P95 (calls) |
|---|---:|---:|
| Discovery (V1, V3, V7, V9, V11.discovery) | 1.5 | 2 |
| Task breakdown (V2, V4, V8, V10, V11.execute) | 30 | 32 |
| Continuation (V5, V6) | 4 | 6 |
| Audit (V12, V15) | 1 | 2 |
| Cleanup com gap (V14) | 17 | — |

### Custo aproximado em tokens

Estimativa: ~50-80k tokens por turn rico (com brainstorm carregado). 15 turns × ~60k médio = **~900k-1.2M tokens totais**. Em Sonnet 4.6 com prompt caching agressivo: **~$3-5 USD**. Bate com o esperado pelo runbook.

---

## Padrões automatizáveis (regras pro Alpha)

Lista concreta de heurísticas que o Alpha pode aplicar sem PM-no-chat:

1. **Card bucket=out + dependência crítica não-coberta** → propor incluir como MVP estrutural. (Padrão de V3 com card 572677n moderação Claude Haiku.)

2. **2 cards do brainstorm com títulos similares (Levenshtein < 30%)** → marcar como duplicata candidata, escolher o de descrição mais detalhada.

3. **Card sem `targetPersona` claro mas com `[CLIENTE]` ou `[PRESTADOR]` no título** → inferir persona da tag. Padrão usado em todos os módulos.

4. **Task com `<PROVIDER>.SDK`, `"A VALIDAR"`, `"<TBD>"` na descrição** → disparar `add_open_question` automaticamente em vez de criar BRONZE silencioso.

5. **Story com mais de 5 tasks ou >40 FP** → propor split em 2 stories.

6. **Modulo com >8 stories** → revisar agrupamento — provavelmente 2 módulos misturados.

7. **Card movido entre módulos no discovery** → registrar `record_decision` com motivo, pra rastreabilidade.

8. **Após cada módulo aprovado** → computar cobertura % de cards por módulo + gerar `record_decision` com snapshot. Usar como gate pra próximo módulo.

9. **Self-audit obrigatório no fim de cada módulo** → 4 perguntas estruturadas:
   - "Algum card do brainstorm não foi coberto? Justifique."
   - "Stories > 5 tasks ou stories que poderiam ser unificadas?"
   - "Tasks BRONZE (decisão pendente)? Listar."
   - "Inter-module deps faltando? (tasks da minha lista que deveriam ter `relates_to` em tasks de outros módulos)"

10. **Decisão de produto bottom-up** (Vitor sugere algo que o brainstorm não tinha) → sempre passa por `record_decision` antes de criar story estrutural.

---

## Pontos onde humano permanece essencial (não automatizar)

1. **Decisão estratégica de provider externo** (gateway de pagamento, KYC provider, lib de mapas). Alpha pode disparar `add_open_question`; humano resolve.

2. **Renomear módulo aprovado** (impacto em referência cross-doc, código). Pode automatizar em módulo draft, não em aprovado.

3. **Descartar feature presente no brainstorm e em decision/scope** (vai contra decisão registrada). Alpha não tem autoridade.

4. **Conflito entre 2 decisões registradas** (revisão de scope altera o que prioritization disse). Humano precisa reconciliar.

5. **Reprovar módulo após aprovação** (volta tasks pra draft mas pode ter dependências em tasks pós-backlog em outros módulos). Operação destrutiva, humano confirma.

---

## Critérios de "pronto" mensuráveis pro Alpha

Alpha deve usar estes thresholds antes de marcar módulo como pronto:

- [ ] Cobertura de cards do módulo ≥ 90% (cards tag-relevantes / cards cobertos)
- [ ] Todas stories MVP do módulo com `refinementStatus = 'committed'`
- [ ] 0 tasks com `functionPoints IS NULL`
- [ ] 0 tasks com title contendo `:` ou padrão `^(Frontend|Backend|Migration):` (verbo no infinitivo, sem prefixo de camada)
- [ ] Tasks com `relates_to` ≥ 1 quando módulo depende de outro (exceto auth/onboarding que são raiz)
- [ ] % SDD OURO ≥ 65% em sample de 5 tasks (heurística de qualidade — calibrar)
- [ ] 0 tasks em status `draft` após aprovação (validar via SQL pós approve_module_full)

---

## Decisão go/no-go pro Alpha-orquestrador

### Critérios

| Métrica | Resultado | Threshold | Pass? |
|---|---:|---:|:---:|
| Cobertura MVP | 97,4% | ≥90% | ✅ |
| Turns autônomos (incl. autônomo-com-rampa) | 67% | ≥50% | ✅ |
| Falhas erro-bloqueante | 0/15 | 0 | ✅ |
| Falhas fora-do-scope | 1/15 | <2 | ✅ |
| Stories zumbis (cleanup-debt) | 4 | <2 | ❌ |
| % SDD OURO sample | 25% | ≥40% | ⚠️ borderline |

### Diagnóstico

**Vitor é Alpha-ready em capacidade de criação**, mas **não em capacidade de edição**. Achado #1 (gap de tools `update_user_story`/`manage_story_ac`) é o único bloqueador real — sem ele, Alpha-orquestrador vai gerar lixo em escala em qualquer ciclo de refinamento.

Achados #2, #3, #6 são "alto/médio" e não bloqueiam Alpha mas vão precisar resolver no primeiro mês de uso real. Achados #4, #5, #7, #8 são otimizações.

### Recomendação: **GO Alpha Fase 1 condicional**

**Pré-requisitos antes de implementar Alpha-orquestrador:**

1. **Achado #1**: registrar `updateStoryForOpsTool` + `manageStoryAcForOpsTool` pro Vitor. Adicionar `archiveUserStoryTool` ou `deleteUserStoryTool` (não existe pra ninguém). [Esforço: ~1h]

2. **Achado #2**: criar `approveModuleFullTool` consolidando lógica de `approve-module-cli.ts` (set approvedAt + promote tasks + ModuleActivity). Registrar pro Vitor + Alpha. [Esforço: ~2h]

3. **Achado #3**: investigar e corrigir `list_project_tasks` schema cache. Bug bloqueia Alpha entender estado cross-módulo. [Esforço: ~30min-2h, depende da causa]

**Pode ser feito junto ou pós-Alpha:**

4. **Achado #4**: capability `autoConfirm` no contexto do Vitor. [Esforço: ~30min]
5. **Achado #6**: prompt do Vitor — disparar `add_open_question` em decisões pendentes. [Esforço: ~15min — texto no prompt]
6. **Achado #8**: tool `add_task_dependency` retroativa. [Esforço: ~1h]

**Total esforço pré-Alpha**: ~4-6h de produto.

---

## Próximos passos sugeridos

1. **Resolver Achados #1, #2, #3** em PR único — todas mexem em `tools.ts` e `manage-stories.ts`.
2. **Re-rodar EVZL** após correções pra ver se as 4 zumbis somem (deveria ser 0 cleanup-debt).
3. **Iniciar prototype do Alpha-orquestrador** com base nas 10 heurísticas + 5 critérios de "pronto" deste doc.
4. **Calibrar threshold de % SDD OURO** rodando 1-2 projetos a mais — 25% pode ser baixo porque sample de V12 foi enviesada (pegou 2 BRONZE conhecidas).
5. **Atualizar [vitor-runbook-end-to-end.md](vitor-runbook-end-to-end.md)** removendo as instruções "SQL de aprovação" e apontando pro `approve-module-cli.ts` (já fiz parcialmente em commits anteriores).

---

## Anexo: log turn-by-turn

Capturado em `/tmp/vitor-runbook/audit-log.md` durante a execução. Contém para cada turn V1-V15:
- Prompt enviado (resumido)
- Tools chamadas (lista)
- Resultado observado
- Falha? Categoria primária + secundária
- Notas pro Alpha

Não está checked-in por ser efêmero, mas pode ser anexado se necessário.
