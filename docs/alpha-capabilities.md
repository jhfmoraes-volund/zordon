# Alpha — O que ele faz hoje

**Versão:** v1.2 (Fase 1 + Fase 2 + Fase 3 parcial)
**Última atualização:** 2026-05-05
**Modelo LLM:** Anthropic Haiku 4.5 (`claude-haiku-4-5`)

---

## 1. O que é o Alpha

Alpha é o **agente de operações** do Volund — uma plataforma interna de gestão de
software houses que a Volund usa pra gerenciar projetos de software pra clientes.

Pensa nele como um **assistente que conversa em português** com PMs, Head de
Operações e tech leads. Em vez de você abrir 5 telas pra entender por que o sprint
está atrasando, você pergunta no chat: *"vai estourar o contrato do João nesse
projeto?"* e o Alpha lê os dados, calcula, e responde.

Ele opera num escopo bem definido:

- **Lê** estado real do banco (sprints, tasks, capacity, equipe, reuniões).
- **Cria/edita** tasks, user stories, módulos, alocações — sempre pedindo
  confirmação em 2 turnos antes de executar.
- **Distribui** backlog em sprints respeitando capacity por membro (Sprint
  Planner Mode).

Não substitui PM. Substitui o trabalho braçal de **navegar interface + somar
números na cabeça**.

---

## 2. Glossário (5 conceitos antes de qualquer coisa)

A Volund tem vocabulário próprio. Sem entender isso, nada faz sentido:

| Termo (UI / fala) | Entidade no banco | O que significa |
|---|---|---|
| **Bateria** | `Member.fpCapacity` | Quanto FP/sprint um membro entrega no total. Ex: João = 500 FP. |
| **Contrato** | `ProjectMember.fpAllocation` | Quanto da bateria do membro está dedicado a um projeto. Ex: João dedica 300 FP/sprint ao Zordon → seu "contrato no Zordon" é 300. **NÃO é "escopo total vendido".** Volund vende capacidade contínua, não pacote fechado. |
| **Squad** | `ProjectMember` (M:N) | Membros alocados a um projeto, mais o PM. |
| **FP (Function Points)** | inteiro em `Task.functionPoints` | Unidade de esforço. Calculado por `scope × complexity` na matriz da `AgentConfig`. |
| **Sprint** | `Sprint` | Janela de 7 dias, segunda→domingo. CHECK no DB rejeita formato fora desse padrão. Status: `upcoming`, `active`, `done`. |

**Hierarquia de produto** (entrou na Fase 1):

```
Module (LOGIN, BILLING, AUDIT_LOG…)
  └── UserStory ("Como X, quero Y, para que Z")
        └── Task (unidade técnica, com FP)
              └── AC (Acceptance Criterion: verificável)
```

---

## 3. Capabilities — 7 grupos de funções

Cada grupo lista o que o usuário pode pedir em linguagem natural, e como o
Alpha responde.

### 3.1 Inspeção operacional do sprint

**Pra que serve:** PM quer saber "como tá o sprint?" sem abrir 4 telas.

**Exemplos de pergunta:**
- "como tá o sprint?"
- "quem tá sobrecarregado?"
- "quais alertas existem?"
- "lista os sprints do Zordon"
- "qual o backlog desse projeto?"

**O que Alpha faz:** lê do banco e responde com tabela ou narrativa
estruturada (resumo do sprint, saúde da equipe, alertas, sugestões).

### 3.2 Análise de capacity / "contrato"

**Pra que serve:** Head Ops quer saber se o projeto cabe no contrato atual ou
se vai estourar.

**Exemplos de pergunta:**
- "qual a capacidade desse projeto?" → 1 chamada agregada (members + sprints + cross-project remaining)
- "qual o contrato do João nesse projeto?" → mapeia "contrato" pra `fpAllocation`
- "vai estourar o contrato?" → calcula `total_fp_backlog ÷ capacidade_efetiva` e responde concreto
- "quem está sobrecarregado em todos os projetos?"

**Como funciona o "contrato":** Alpha entende que **"contrato" = `ProjectMember.fpAllocation`**, não
escopo total vendido (descoberta da auditoria 2026-05-05). Quando o PM pergunta
"vai estourar o contrato?", Alpha lê `get_project_capacity` + `list_unplanned_tasks`
e responde "cabe em N sprints" ou "ultrapassa por X FP". **Não pergunta** dados
inexistentes como "data do contrato" ou "MVP".

### 3.3 Hierarquia de produto (Module / UserStory / AC)

**Pra que serve:** PM/Head Ops quer criar e refinar user stories sem sair do chat.

**Exemplos:**
- "lista os módulos desse projeto" → 9 módulos reais, com flag de aprovação
- "quais personas existem?" → 4 personas reais, descrições
- "criar story 'magic-link com expiração'" → propõe módulo + persona + AC,
  **para pra confirmar** (Regra 9b)
- "essa story (ZRDN-US-002) tá com AC ruim, melhora" → busca via `get_story`,
  propõe diff em texto, espera confirmação
- "marca a story X como refined" → transiciona refinementStatus

**Comportamento crítico — Regra 10 (anti-alucinação):** Alpha
**NUNCA** afirma que uma entidade não existe sem ter chamado a tool de
leitura. Se você cita "ZRDN-US-014", ele chama `get_story` antes de qualquer
afirmação. Sem essa regra, Alpha alucinava (a auditoria pegou ele negando
4 entidades reais).

**Comportamento crítico — Regra 9b (confirmação 2 turnos):** Toda
operação de escrita (criar story, editar AC, aprovar módulo, mexer em
allocation) **PARA pra confirmar** antes de executar. Você precisa
responder "sim" / "manda" / "ok" no turno seguinte.

### 3.4 Sprint Planner Mode (distribuir backlog em sprints)

**Pra que serve:** PM quer organizar 20-50 tasks do backlog em vários
sprints, respeitando capacity, preferências de assignee, e ausências.

**Como dispara:** Alpha **só ativa o modo planner** quando:
- Mensagem tem keyword de planning (`organizar`, `aloca`, `planejar`,
  `distribuir`, `prioriz`, `cabe`, `estourar`, `capacid`)
- Backlog tem ≥ 10 tasks "ready" (com FP definido + sem sprint)
- Pelo menos 1 ProjectMember com `fpAllocation > 0`

Sem essas 3 condições, Alpha responde normal — não polui conversa de inspeção
com 4 perguntas de planning.

**Fluxo (multi-turn):**
1. **Turno 1:** Alpha **pergunta as 4 perguntas obrigatórias** (preferências
   de assignee, prioridade de módulos, ausências/redução de capacity, escopo
   do plano). NÃO chama tools de capacity ainda.
2. **Turno 2:** PM responde. Alpha chama `get_project_capacity` +
   `list_unplanned_tasks`, monta tabela em texto (sprint × member × FP),
   pede confirmação.
3. **Turno 3:** PM confirma. Alpha executa **`bulk_update_tasks`** numa
   chamada atômica — se uma task falhar, **reverte tudo**.

**Caso "squad sem contrato":** se `get_project_capacity` retornar members com
`noContract: true` (= alocados ao projeto mas com `fpAllocation = 0`), Alpha
**NÃO** diz "ninguém alocado". Ele lista os builders, identifica que falta
contrato, e pergunta o FP/sprint de cada um — depois aplica via
`set_project_allocation` (Regra 9b: 2 turnos). Só então segue pro
dimensionamento.

**Status default:** task movida pra sprint vira `todo`, nunca `in_progress`/
`done` automático.

### 3.5 Operações de task granulares (legado, ainda em prod)

**Pra que serve:** edições pontuais (1-2 tasks por vez).

- Criar task isolada: `create_task`
- Mover pra sprint: `move_task_to_sprint`
- Atribuir membro: `assign_task`
- Mudar status: `update_task_status`
- Mudar prioridade: `update_task_priority`
- Re-estimar (scope × complexity): `update_task_estimate`
- Renomear: `update_task_title`
- Editar descrição: `update_task_description`
- Tirar do sprint: `remove_task_from_sprint`

**Heatmap em prod (14d):** essas tools são **mortas** — Alpha quase nunca usa.
Em planning real, `bulk_update_tasks` cobre tudo isso de uma vez. As granulares
ficam como fallback pra casos pontuais.

### 3.6 Allocation / "contrato" do membro

**Pra que serve:** Head Ops quer ajustar quanto um membro dedica a um projeto.

- "aumenta o contrato do João pra 400" → `set_project_allocation`
- "Ana de férias na Sprint 9" → `set_sprint_allocation` (override pontual)
- "tira o override do Lucas" → `clear_sprint_allocation`

**Confirmação 2 turnos** obrigatória (Regra 9b — adendo da auditoria).

### 3.7 Reuniões (Atas Zordon + Transcrições Roam)

**Pra que serve:** Weekly PM, Daily, Super Planning, e busca de transcrição.

**Vocabulário rígido:**
- **Ata** = `Meeting` interna do Volund (estruturada, com `MeetingProjectReview`)
- **Transcrição** = registro do Roam (áudio transcrito, externo)
- **NUNCA** os mesmos. Alpha tem regra dura sobre isso.

**Tools:** `create_meeting`, `get_meeting_reviews`, `update_meeting_review`,
`list_meeting_actions`, `propose_task_action`, `discard_meeting_action`,
`get_meeting_transcript`, `ask_meeting`, `get_recent_meetings`.

**Regra crítica — durante reunião ativa:** Alpha NÃO chama tools de execução
direta de Task. Toda mudança vira `propose_task_action` (proposta pendente que
PM aprova/edita pela UI da reunião e o sistema aplica em batch).

---

## 4. Inventário completo de tools (45)

Lista exaustiva pra referência. Agrupada por finalidade.

### Leitura — Sprint / Capacity / Tasks (8)
| Tool | Função |
|---|---|
| `get_sprint_overview` | Estado completo do sprint ativo |
| `get_member_commitments` | Bateria de cada membro cross-project |
| `get_sprint_capacity` | Capacidade real de um sprint (respeita SprintMember overrides) |
| `get_tasks` | Lista tasks com filtros (status, membro) |
| `get_alerts` | Alertas de capacidade, prazos, atribuição |
| `list_sprints` | Sprints abertos do projeto |
| `get_backlog` | Tasks sem sprint |
| `get_allocated_project_members` | Squad (PM + ProjectMembers, com flag `isPM`) |

### Leitura — Hierarquia (4) — **NOVA Fase 1**
| Tool | Função |
|---|---|
| `list_modules` | Módulos do projeto + flag de aprovação |
| `list_personas` | Personas cadastradas no projeto |
| `list_stories` | User stories (filtra por module/refinementStatus) |
| `get_story` | Detalhes completos de uma story por reference |

### Leitura — Sprint Planner (2) — **NOVA Fase 2**
| Tool | Função |
|---|---|
| `get_project_capacity` | Members + sprints + cross-project remaining em **1 chamada agregada** |
| `list_unplanned_tasks` | Backlog "ready" (com FP, sem sprint), filtros opcionais |

### Escrita — Hierarquia (5) — **NOVA Fase 1, gated por kill switch**
| Tool | Função | Regra 9b? |
|---|---|---|
| `create_user_story` | Cria UserStory (refinementStatus=draft) | ✓ |
| `update_user_story` | Edita title/want/soThat/moduleId/personaId | ✓ |
| `set_story_refinement` | draft → refined → committed | ✓ |
| `approve_module` | Promove proposedModuleName em Module real | ✓ |
| `manage_story_ac` | add/edit/remove AC (até 15 ops por chamada) | ✓ |

### Escrita — Tasks (10)
| Tool | Função |
|---|---|
| `create_task` | Task isolada no backlog |
| `assign_task` | Atribui membro |
| `update_task_status` | Muda status |
| `update_task_priority` | 0-10 |
| `update_task_estimate` | scope × complexity (recalcula FP) |
| `update_task_title` | Renomeia |
| `update_task_description` | Edita descrição |
| `move_task_to_sprint` | Move 1 task pra sprint |
| `remove_task_from_sprint` | Volta pro backlog |
| `bulk_update_tasks` | **Atômico** — N tasks de uma vez (sprint, assignees, status). NOVA Fase 2. |

### Escrita — Allocation / Contrato (3)
| Tool | Função | Regra 9b? |
|---|---|---|
| `set_project_allocation` | "Contrato" padrão do membro no projeto | ✓ (Onda 1.7) |
| `set_sprint_allocation` | Override pontual (férias, crunch) | ✓ |
| `clear_sprint_allocation` | Remove override | ✓ |

### Escrita — Sprint (1)
| Tool | Função |
|---|---|
| `create_sprint` | Cria sprint segunda→domingo, status `upcoming` |

### Reuniões (10)
| Tool | Função |
|---|---|
| `create_meeting` | pm_review / general / daily / super_planning |
| `get_recent_meetings` | UNION de Atas + Transcrições (arrays separados) |
| `get_meeting_reviews` | Reviews por PM/projeto |
| `update_meeting_review` | sprintHealth/nextSteps/etc. |
| `get_meeting_transcript` | Cues + summary do Roam |
| `ask_meeting` | Pergunta livre ao Roam AI |
| `list_meeting_actions` | MeetingTaskActions pendentes |
| `propose_task_action` | Cria proposta de mudança em Task (NÃO executa) |
| `discard_meeting_action` | Descarta proposta pendente |
| `get_pending_actions` | Todos não resolvidos |

### Outros (2)
| Tool | Função |
|---|---|
| `create_todo` | To-do (recado/follow-up, sem FP) |
| `load_heuristic` | Carrega corpo de uma heurística do índice |

---

## 5. Comportamentos críticos (regras do prompt)

São regras **duras** que o Alpha respeita. Quebra de regra = bug.

### Regra 0 — Confirmação antes de executar
Toda ação destrutiva ou ambígua: Alpha mostra o plano em texto e espera "ok"/"sim"/"manda".

### Regra 9b — Confirmação em 2 turnos (regra dura)
Pra **escrita de hierarquia + allocation**:
- Turno 1: Alpha lê dados, propõe, **PARA**.
- Turno 2: PM confirma → Alpha executa.

Tools cobertas:
`create_user_story`, `update_user_story`, `manage_story_ac`, `approve_module`,
`set_story_refinement`, `set_project_allocation`, `set_sprint_allocation`,
`clear_sprint_allocation`.

**Exceção:** se PM disse explicitamente "manda direto", "sem confirmar", "crie já" no
mesmo turno, Alpha pode executar.

### Regra 10 — Anti-alucinação (regra dura)
Alpha **NUNCA** afirma que uma entidade não existe sem ter chamado a tool de
leitura correspondente. Se cita "ZRDN-US-014", chama `get_story` antes.

**Adendo:** se um nome aparece **no contexto** mas não em `list_modules`, **NÃO existe.**
A tool é a fonte da verdade, não o contexto.

### Vocabulário travado
- "Ata" ≠ "Transcrição" (Zordon vs Roam, regra dura)
- "Contrato" = `fpAllocation`, **não** escopo total vendido
- "Bateria" = `fpCapacity` total, não dedicação por projeto
- `Task.status` (backlog/todo/in_progress/review/done) ≠ `UserStory.refinementStatus` (draft/refined/committed)

---

## 6. Segurança operacional

### Per-project kill switch — **NOVA Fase 3**
`Project.alphaHierarchyEnabled` (boolean, default `true`).

Quando `false`, **todas as tools de escrita de hierarquia + planner ficam
indisponíveis** pro projeto:
`create_user_story`, `update_user_story`, `set_story_refinement`,
`approve_module`, `manage_story_ac`, `bulk_update_tasks`.

**Reads continuam liberados** (lista, get, get_capacity etc. — são seguros).

**Como desligar pra um projeto:** `UPDATE "Project" SET "alphaHierarchyEnabled" = false WHERE id = '<projectId>';`

Comportamento testado: Alpha tenta chamar a tool, ela não existe, ele detecta
e oferece fallback ("crie pela UI" ou "crio task isolada em vez de story?").
Sem stack trace pro usuário.

### Quality logging — **NOVA Fase 3 (parcial)**
`AgentQualityLog` registra cada decisão estruturada:
- `story_created` — payload: storyRef, moduleId, personaId, acCount, reasoning
- `module_classified` — payload: storyRef, moduleId, moduleName, reasoning (após `approve_module`)
- `module_proposed` — quando story cria com `proposedModuleName` em vez de moduleId
- `plan_executed` — payload: tasksUpdated, sprintsAffected, uniqueAssignees, reasoning
- `ac_managed` — payload: storyRef, opCount, breakdown {add, edit, remove}

Permite auditoria histórica via SQL: *"Alpha criou que stories no último mês?
Em qual módulo? Por qual reasoning?"*

Coluna `humanVerdict` (`correct` / `wrong` / `edited`) prevista pra ser preenchida
no futuro (cron heurístico ou review manual). **Hoje fica `null`** — só logamos.
Não há cron rodando ainda.

### RPC atômica
`bulk_update_tasks` (N tasks → sprint + assignees + status) roda em
transação implícita. Qualquer erro **reverte tudo** — sem estado parcial.

### Permissões
- Tools de escrita gated por `capabilities.writeTools` (passado pelo sistema)
- Tools de hierarquia adicionalmente gated por `routeProjectId` + `currentMemberId`
- RPC `bulk_update_tasks` valida que o actor é manager (cro/head-ops/pm/principal-engineer)
  ou PM do projeto ou ProjectMember — antes de mexer em qualquer task

---

## 7. Vitor — agente irmão (não é o Alpha)

**Importante separar:** o Volund tem 2 agentes:

- **Vitor** (modelo: `claude-sonnet-4-6`) — agente de **Design Sessions**.
  Conduz a inception de produto: discovery de módulos, definição de personas,
  geração de user stories vinculadas a uma `DesignSession`. **Não foi mexido
  na Fase 1/2/3 do Alpha.**

- **Alpha** (modelo: `claude-haiku-4-5`) — agente de **operações**. O que este
  doc descreve.

Os dois compartilham a DAL (`src/lib/dal/story-hierarchy.ts`) mas têm tools
totalmente separadas (`alpha-hierarchy.ts` vs as factories session-bound do
Vitor). Mexer no Alpha não afeta o Vitor.

---

## 8. Linha do tempo das fases (resumo)

### Fase 0 — Auditoria (entregue)
Rodou 15 prompts no Alpha em prod sem nenhuma das fases 1+. Mediu falhas em
`sem-tool / sem-contexto / prompt-confuso / modelo-alucina / correto`.
Resultado: 9/15 falharam por `sem-tool` em hierarquia → confirmou que era o
gargalo certo.

[Doc: `docs/alpha-audit.md`](alpha-audit.md)

### Fase 1 — Hierarquia + Vocab "contrato" (entregue)
- Onda 1.1: Wrappers Alpha-only em [`alpha-hierarchy.ts`](../src/lib/agent/tools/alpha-hierarchy.ts) (9 tools)
- Onda 1.2: Registro no Alpha
- Onda 1.3: Context loader carrega bloco de taxonomia (counts + nomes)
- Onda 1.4: Prompt — seção "Hierarquia" com 11 regras (incluindo regra 9b e regra 10)
- Onda 1.5a: Per-agent model — Alpha vai pra Haiku 4.5 (~10x mais barato que Sonnet 4.6)
- Onda 1.5b: Calibração 8 cenários × 3 runs (24 invocações), 0 alucinações graves
- Onda 1.7: Vocabulário "contrato" + apertar regra 10 (descoberta pós-calibração)

[Doc calibração: `docs/alpha-calibration-fase1.md`](alpha-calibration-fase1.md)
[Doc vocab contrato: `docs/alpha-audit-contrato.md`](alpha-audit-contrato.md)

### Fase 2 — Sprint Planner (entregue)
- Onda 2.1: RPC `bulk_update_tasks` (atomic, valida actor + sprint pertencimento)
- Onda 2.2: 3 tools (`get_project_capacity`, `list_unplanned_tasks`, `bulk_update_tasks`)
- Onda 2.3: Gate condicional planner mode (intent + estado, evita pollution)
- Onda 2.4: Prompt "Sprint Planning" com 9 regras (4 perguntas obrigatórias, dimensionamento, capacity, segmentação, proposta antes de executar, etc.)
- Onda 2.5: Calibração — 5/5 ✅ em cenários críticos, incluindo F2.1 multi-turn end-to-end

[Doc calibração: `docs/alpha-calibration-fase2.md`](alpha-calibration-fase2.md)

### Fase 3 — Rollout & Observability (parcial)
- Onda 3.1 ✅: Kill switch `Project.alphaHierarchyEnabled`, testado on/off
- Onda 3.2 ✅: `AgentQualityLog` + view `agent_quality_metrics`, integrado em 4 tools
- Onda 3.3 ❌: Dashboard mínimo (decidido **não fazer agora** — escopo overkill, dados acumulam, decide quando precisar)
- Cron heurístico de auto-verdict ❌: previsto pra V4 §6.2, **não implementado** — `humanVerdict` fica null por enquanto

---

## 9. O que NÃO está implementado (e por quê)

| Faltando | Razão |
|---|---|
| **Fase 2.5 — Velocity histórica** | Opcional. View `project_velocity` previa "média das últimas 3 sprints fechadas vs alocação". Faz sentido pra Head Ops perguntar "tá no ritmo?" mas pode esperar. |
| **Cron heurístico de auto-verdict** | Sem ele, `AgentQualityLog.humanVerdict` fica null. Tabela acumula dados, mas não há dashboard automático. PM pode verificar manualmente via SQL. |
| **Dashboard UI de quality metrics** | Decisão explícita de **não fazer**. Escopo overkill. Quando precisar, query é trivial: `SELECT * FROM agent_quality_metrics`. |
| **Refatoração de tools granulares mortas** | Heatmap mostra `assign_task`, `update_task_status` etc. quase nunca usadas. **Não removidas** — ficam como fallback pra casos pontuais. Podem morrer naturalmente após Fase 2 estabilizar. |
| **Cenários adversariais F2.2-F2.5** | Precisam manipular estado do banco (estourar cap, simular férias). Deixados pra piloto real, não calibração sintética. |

---

## 10. Como testar manualmente

```bash
# CLI direto, sem precisar abrir UI:
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --member-id <uuid-do-member> \
  --new-thread \
  --current-path "/projects/<projectId>" \
  --message "<sua pergunta em PT>"
```

Multi-turn: salvar `thread-id` da resposta e usar `--thread-id <uuid>` no próximo
turno em vez de `--new-thread`.

**Casos de teste recomendados:**
1. "lista os módulos desse projeto" → deve chamar `list_modules` (não `get_tasks`)
2. "qual o contrato do João?" → mapeamento contrato → fpAllocation
3. "vai estourar o contrato?" → cálculo concreto, sem perguntar MVP/data
4. "organiza o backlog em sprints" → 4 perguntas obrigatórias, NÃO chama tools no turno 1
5. "criar story 'X'" → propõe + para pra confirmar (Regra 9b)

---

## 11. Migrations criadas nesta sessão (6)

| Migration | O que faz |
|---|---|
| `20260505_bulk_update_tasks_rpc.sql` | RPC atômico de update em N tasks (Onda 2.1) |
| `20260505_alpha_hierarchy_kill_switch.sql` | Adiciona `Project.alphaHierarchyEnabled` (Onda 3.1) |
| `20260505_agent_quality_log.sql` | Tabela `AgentQualityLog` + RLS + índices (Onda 3.2) |
| `20260505_agent_quality_metrics_view.sql` | View agregada de 30 dias (Onda 3.3 — opcional, criada mas pouco útil sem cron) |

Migrations não-Alpha que apareceram em paralelo (não documentadas aqui):
`module_activity`, `unify_task_refs`, `task_refs_and_dependencies`,
`drop_default_persona_seed`, `module_approval`, `draft_task_references`,
`ac_xor_check`. Foram trabalho fora desta sessão.

---

## 12. Próximos passos sugeridos

Quando voltar a mexer no Alpha:

1. **Smoke E2E real na UI** (não foi feito — eu rodei via CLI). Abrir `/projects/<zordon>` no chat, rodar fluxo de Sprint Planning ponta a ponta, conferir que UX da UI segue o flow esperado.
2. **Commit de tudo** via `bash scripts/sync-main.sh -m "ZRD-JM-NN: alpha — fases 1+2+3 (hierarchy + planner + kill switch + quality log)"`.
3. **Piloto de 1 semana** com Head Ops e PMs usando Alpha em projeto real (Zordon).
4. **Recolher feedback** e iterar prompt nas regras que vieram com `⚠️` na calibração:
   - Haiku às vezes faz 4-5 perguntas em vez de propor direto quando contexto é claro
   - C2 ("entregar dentro do contrato") editorializa demais — Alpha lê dados certo, só fala mais do que precisa
   - `bulk_update_tasks` foi chamado 2× em F2.1 R1 (ideal seria 1)
5. **Decidir Fase 2.5 (Velocity)** com base no feedback do piloto.
6. **Decidir cron de auto-verdict** se a tabela `AgentQualityLog` acumular dados úteis.
