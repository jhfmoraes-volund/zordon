# Alpha — Auditoria de comportamento (Fase 0)

**Data:** 2026-05-05
**Plano de referência:** [alpha-story-hierarchy-calibration-v3.md](alpha-story-hierarchy-calibration-v3.md) §3
**Objetivo:** medir onde o Alpha falha hoje **antes** de empilhar prompt + tools de hierarquia. Decidir go/no-go pra Fase 1.

---

## Setup

- **Member-id:** `dc4d91f5-0d29-453a-b11e-d42dd6a7b158` (João Moraes)
- **Project-id:** `6f9b7443-547e-418e-b0a5-6f3bb38d762f` (Zordon)
- **Estado do Zordon (snapshot):**
  - 9 módulos aprovados: `AGENT`, `APP_SHELL`, `AUTOMATION`, `DESIGN_SESSION`, `INTEGRATIONS`, `PROJECT`, `SKILLS`, `SPRINTS`, `TASKS`
  - 4 personas
  - 30 user stories (várias em `committed`)
  - 89 tasks, 34 backlog ready (com FP + story)
  - 5 sprints, 2 ProjectMembers

### Template de comando

```bash
export ALPHA_MEMBER="dc4d91f5-0d29-453a-b11e-d42dd6a7b158"
export ALPHA_PROJECT="6f9b7443-547e-418e-b0a5-6f3bb38d762f"

npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --member-id "$ALPHA_MEMBER" \
  --new-thread \
  --current-path "/projects/$ALPHA_PROJECT" \
  --message "<PROMPT>"
```

**Nota:** sempre `--new-thread` pra não contaminar contexto entre prompts.

---

## Categorias de falha

Pra cada prompt, marcar UMA categoria primária:

| Cat | Significado | Implicação |
|---|---|---|
| **sem-tool** | Falta ferramenta exposta no Alpha | Fase 1 resolve (criar wrapper) |
| **sem-contexto** | Tool existe mas Alpha não sabe que entidade existe (não está no prompt/contexto) | Fase 1 resolve (taxonomia block) |
| **prompt-confuso** | Tool existe, contexto existe, regra é ambígua | **Pausar V3, fazer prompt cleanup primeiro** |
| **modelo-alucina** | Tudo existe, Alpha ignora e inventa | Discutir modelo/temperatura antes de Fase 1 |
| **correto** | Comportamento esperado | Sanity ok |

---

## Resultados (preencher rodando)

### A1 — "criar uma story de magic-link com expiração"

**Prompt:** `criar uma story de magic-link com expiração`
**Thread:** `e5aa8290-c7a0-4b9c-a6f4-9ac2dbd814ed`

- **Resultado:** Alpha criou **TASK-284** (Task, não Story). Inferiu type=feature, scope=small, complexity=medium, FP=7. Mostrou tabela e perguntou se queria atribuir/mover pra sprint. **Ignorou completamente a palavra "story" no input** — não distinguiu Task de UserStory, não mencionou módulo, persona ou AC.
- **Tools chamadas:** `create_task` (1)
- **Cleanup:** TASK-284 deletada via SQL.
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool (não há `create_user_story` no Alpha) + [x] sem-contexto (taxonomia Module/Story/Persona não está no prompt nem no contexto)
- **Notas:** falha dupla — Alpha não tem como criar story E não sabe que story é diferente de task. Confirma diagnóstico do plano V3.

---

### A2 — "qual módulo a feature 'auditoria de eventos' deveria entrar?"

**Thread:** `d47c8af1-4f84-485e-9159-71c39b1885b7`

- **Resultado:** Alpha **inventou módulos** — sugeriu "Observabilidade", "Segurança/Compliance", "Gestão de Projetos/Tasks", "Configurações/Admin". **Nenhum desses existe no Zordon.** Os reais (`AGENT`, `APP_SHELL`, `AUTOMATION`, `DESIGN_SESSION`, `INTEGRATIONS`, `PROJECT`, `SKILLS`, `SPRINTS`, `TASKS`) sequer foram considerados. Disse explicitamente "não está registrado no Zordon qual módulo pertence a qual feature".
- **Tools chamadas:** 0
- **Falha?** [x] sim
- **Categoria:** [x] sem-contexto (Module existe no DB, Alpha nem viu) + [x] sem-tool (não tem `list_modules`)
- **Notas:** Alpha não tem awareness de Module **existir** — confirma que taxonomia precisa entrar no contexto. Pior: ele alucinou nomes plausíveis em vez de admitir desconhecimento.

---

### A3 — "lista os módulos desse projeto"

**Thread:** `c429197e-23ee-4497-b47b-a7413b7c3ab0`

- **Resultado:** Alpha chamou `get_tasks` + `get_backlog` e **inferiu "módulos" a partir de prefixos de tasks** (`APP-SHELL`, `ZORDON-PW`, `ZORDON-PS`, `GAPs`, etc). Apresentou como se fossem módulos reais. **Não bate com nada do schema** — os 9 Modules reais (`AGENT`, `APP_SHELL`, `AUTOMATION`, `DESIGN_SESSION`, `INTEGRATIONS`, `PROJECT`, `SKILLS`, `SPRINTS`, `TASKS`) não foram listados.
- **Tools chamadas:** `get_tasks`, `get_backlog`
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool (sem `list_modules`) + [x] sem-contexto (ProjectFocus não traz Modules)
- **Notas:** **Falha grave** — Alpha "fabrica" módulos a partir de strings de tasks. Cliente que ler isso vai achar que Zordon tem um módulo "GAP-JA". Reforça urgência da Fase 1.

---

### A4 — "lista as user stories desse projeto"

**Thread:** `e2a52e94-8304-46f1-abcd-d92fb10446da`

- **Resultado:** Alpha chamou `get_tasks` + `get_backlog` e listou **tasks**, não stories. Não diferenciou os conceitos. Ignorou totalmente que existem 30 UserStories reais no projeto.
- **Tools chamadas:** `get_tasks`, `get_backlog`
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool (sem `list_stories`) + [x] sem-contexto (UserStory não está no prompt)
- **Notas:** Mesmo padrão de A1/A3: vocabulário "story" é ignorado, Alpha cai em fallback de tasks.

---

### A5 — "criar 5 tasks pra implementar checkout"

**Thread:** `2348ccc5-e228-4397-b150-6b4b40addb5d`

- **Resultado:** Alpha **não criou nada** — pediu clarificação correta: tipo de checkout (produto/SaaS, feature específica, outro), backlog vs sprint, responsável. Bom comportamento de Regra 0.
- **Tools chamadas:** `get_sprint_overview`, `get_backlog`
- **Falha?** [ ] não
- **Categoria:** [x] correto
- **Notas:** Mas — **0 menção a UserStory**. "Checkout" naturalmente seria 1 story com 5 tasks. Alpha trata como 5 tasks isoladas. Falha sutil de modelo conceitual, não de execução.

---

### A6 — "como tá o sprint?" (CONTROLE — baseline)

**Thread:** `08654b9e-80e0-41cc-8dde-52334ef56c15`
**Esperado:** resposta narrativa correta, sem regressão.

- **Resultado:** Alpha chamou `get_sprint_overview`, identificou Sprint 5 (upcoming, 25/05→31/05), apontou que está vazio, listou capacidade dos membros, sugeriu ações. **Resposta correta e estruturada.** Bug pequeno: somou capacidade de "João Moraes 300 + Davi Moura 100 = 400" mas o output da tool mostrava João 500 (allocated 292), e listou Liliane/Vinícius/Eder também — pequena inconsistência interna na narrativa.
- **Tools chamadas:** `get_sprint_overview`
- **Falha?** [ ] não (sanity ok com pequena imprecisão)
- **Categoria:** [x] correto
- **Notas:** Baseline funciona. Sanity ✅.

---

### A7 — "organiza o backlog em sprints"

**Thread:** `8f820096-1da6-477a-8c8a-f1b621ae8b76`

- **Resultado:** Alpha **fez plano completo direto** — chamou `get_backlog`, `list_sprints`, 5× `get_sprint_capacity`. Apresentou tabela de capacidade, distribuiu 30 tasks em 4 sprints, calculou % de ocupação por sprint. Pediu confirmação antes de executar. **Não fez as 4 perguntas obrigatórias** do plano V3 §6.4 (preferências de quem, prioridade de features, férias, escopo). **Não considera UserStory na organização.**
- **Tools chamadas:** `get_backlog`, `list_sprints`, `get_sprint_capacity` ×5
- **Falha?** [x] parcial — executa o plano mas pula questões importantes
- **Categoria:** [x] prompt-confuso (regra existe pra "compor sprint" via heurística `sprint-composicao`, mas Alpha não foi instruído a perguntar antes em casos de planning multi-sprint) + [x] sem-contexto (UserStory ignorada na composição)
- **Notas:** Comportamento que **parece** bom mas pula etapas. Em prod com backlog grande e múltiplos builders com restrições, geraria plano sub-ótimo silenciosamente.

---

### A8 — "quem tá sobrecarregado?" (CONTROLE — capacity baseline)

**Thread:** `09cca06c-9030-4ce5-ad8b-9902aec67908`

- **Resultado:** Alpha respondeu **direto do contexto** (sem tool call), com tabela de % de ocupação. Identificou Liliane (71%) como mais comprometida, ninguém sobrecarregado de fato. Notou Filipe Moreira com capacity zerada. Resposta sólida.
- **Tools chamadas:** 0 (usou bateria do contexto)
- **Falha?** [ ] não
- **Categoria:** [x] correto
- **Notas:** Baseline capacity funciona. Sanity ✅.

---

### A9 — "criar story 'login' e já criar as tasks dela"

**Thread:** `149fbd57-2d25-4a6a-9f57-3c07438134ac`

- **Resultado:** Alpha pediu clarificação de escopo (auth básico vs completo vs onboarding) e perguntou sobre sprint/responsável. **Não diferenciou story de tasks** no fluxo — tratou como sinônimos: "5 tasks" implícitos.
- **Tools chamadas:** `get_sprint_overview`, `get_backlog`
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool (sem `create_user_story`) + [x] sem-contexto
- **Notas:** Ainda que peça clarificação (ok), Alpha não tem como criar a hierarquia story→tasks. O "sim" futuro vai criar 5 tasks soltas, não vinculadas.

---

### A10 — "essa story aqui (ZRDN-US-002) tá com AC ruim, melhora"

**Thread:** `e56beeae-b947-4c6b-82a9-8a1fecad633b`
**Fato:** ZRDN-US-002 **EXISTE** = "Identidade persistente do usuário no contexto Alpha".

- **Resultado:** Alpha buscou em `get_tasks` (não em UserStory!), não achou (porque não tem tool de Story), e disse: "essa referência não existe no sistema (as tasks aqui usam o padrão `TASK-NNN`)". **Negou existência de uma story que existe.** Sugeriu hipóteses falsas (Jira, Linear, Notion).
- **Tools chamadas:** `get_tasks`
- **Falha?** [x] sim — grave
- **Categoria:** [x] sem-tool + [x] sem-contexto + [x] modelo-alucina (afirma que não existe sem ter ferramenta pra checar)
- **Notas:** Pior tipo de falha de produto. PM vai abandonar a feature achando que story não existe.

---

### A11 — "quero refinar a story ZRDN-US-003, dividir em 3 menores"

**Thread:** `2e508cb0-0b1b-4926-87fb-31289ce8988c`
**Fato:** ZRDN-US-003 **EXISTE** = "Geração de tasks/backlog/SPECs via IA".

- **Resultado:** Mesmo padrão de A10. Buscou em `get_tasks`, não achou, negou existência. Ofereceu criar 3 tasks "diretamente" — pulando o conceito de story.
- **Tools chamadas:** `get_tasks`
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool + [x] sem-contexto + [x] modelo-alucina
- **Notas:** Operação de "split" não existe nem como tool nem como conceito no prompt. Gap de produto além de tool.

---

### A12 — "melhorar dashboard" (vago)

**Thread:** `509fbb43-8794-4042-9e04-1ad2a794727d`

- **Resultado:** Alpha chamou `get_tasks` + `get_backlog` (waste — não precisava) MAS depois fez **as perguntas certas**: qual dashboard, qual tipo de melhoria. Cita TASK-255 e outras existentes pra evitar duplicar. Não criou nada.
- **Tools chamadas:** `get_tasks`, `get_backlog`
- **Falha?** [ ] não (comportamento correto, mas com tool waste)
- **Categoria:** [x] correto
- **Notas:** Comportamento de clarificação OK. Side note: chamadas extras de leitura "preventivas" são padrão — não custa muito mas polui.

---

### A13 — "essa task aqui tá errada, ajusta o título" (sem ref específico)

**Thread:** `05deae16-5393-42e1-a9ef-eed652a473ca`

- **Resultado:** Resposta **mínima** ("Qual task você quer renomear, e qual deve ser o novo título?"). Sem tool call. Comportamento perfeito.
- **Tools chamadas:** 0
- **Falha?** [ ] não
- **Categoria:** [x] correto
- **Notas:** Baseline de update_task_title funciona — Alpha pergunta antes.

---

### A14 — "marca a story ZRDN-US-002 como refined"

**Thread:** `733d9672-f86e-436f-a76a-b6bba0da29dd`
**Fato:** ZRDN-US-002 existe e está em `committed`. Refinement status do schema = (`draft`, `refined`, `committed`).

- **Resultado:** Alpha **negou que `refined` exista**: "esse status não existe no lifecycle padrão de Task do Zordon (backlog → todo → in_progress → review → done)". **Tentou mapear story pra task de novo.** Sugeriu setar pra `todo`.
- **Tools chamadas:** 0
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool + [x] sem-contexto + [x] modelo-alucina (afirma com confiança que `refined` não existe quando existe)
- **Notas:** Confunde `Task.status` (lifecycle execução) com `UserStory.refinementStatus` (lifecycle refinement). Não tem essa distinção no prompt.

---

### A15 — "quais personas existem nesse projeto?"

**Thread:** `63e651e6-65f4-4d93-934c-b36cbc102377`

- **Resultado:** Alpha **negou que personas existam**: "Persona não é um conceito que o Zordon rastreia como entidade — não há um cadastro de 'personas' associado a projetos aqui." Isso está **factualmente errado** — `ProjectPersona` existe e Zordon tem 4 personas cadastradas.
- **Tools chamadas:** 0
- **Falha?** [x] sim
- **Categoria:** [x] sem-tool (sem `list_personas`) + [x] sem-contexto (ProjectPersona não está no prompt) + [x] modelo-alucina (Alpha **afirma com confiança que não existe**, em vez de admitir ignorância)
- **Notas:** Pior tipo de falha — Alpha mente com confiança. Alfabetiza errado o vocabulário do produto pro PM.

---

## Heatmap de tool usage (últimos 14 dias)

```sql
WITH alpha_msgs AS (
  SELECT cm.parts
  FROM "ChatMessage" cm
  JOIN "ChatThread" ct ON ct.id = cm."threadId"
  WHERE ct."agentName" = 'alpha'
    AND cm.parts IS NOT NULL
    AND cm."createdAt" > now() - interval '14 days'
)
SELECT
  part->>'toolName' AS tool_name,
  count(*) AS calls
FROM alpha_msgs,
     LATERAL jsonb_array_elements(parts) part
WHERE part->>'type' = 'tool-call'
GROUP BY 1
ORDER BY 2 DESC;
```

| Tool | Calls |
|---|---|
| get_recent_meetings | 11 |
| get_tasks | 8 |
| get_backlog | 6 |
| get_sprint_capacity | 6 |
| get_sprint_overview | 5 |
| get_allocated_project_members | 4 |
| create_task | 3 |
| create_meeting | 2 |
| load_heuristic | 2 |
| create_todo | 1 |
| list_sprints | 1 |
| list_meeting_actions | 1 |
| propose_task_action | 1 |

**Tools dominantes (top 5):** `get_recent_meetings`, `get_tasks`, `get_backlog`, `get_sprint_capacity`, `get_sprint_overview` — todas leitura.

**Tools mortas (0 calls em 14d):**
- **Escrita granular:** `assign_task`, `update_task_status`, `update_task_priority`, `update_task_estimate`, `update_task_title`, `update_task_description`, `move_task_to_sprint`, `remove_task_from_sprint`
- **Allocation:** `set_project_allocation`, `set_sprint_allocation`, `clear_sprint_allocation`
- **Reuniões granular:** `update_meeting_review`, `get_meeting_reviews`, `get_meeting_transcript`, `ask_meeting`, `discard_meeting_action`
- **Outros:** `get_pending_actions`, `get_alerts`

**Observações:**
1. Heatmap mostra **Alpha vive de leitura** — cria task ocasional (3 em 14d), o resto é "explica o que tá acontecendo".
2. Tools de escrita granular são **mortas em produção real** (não só na auditoria). Sinal forte de que o uso real do Alpha é **chat de inspeção + task occasional**, não fluxo iterativo.
3. **Nenhuma chamada a tools de capacity write** em 14d. Allocation é mexida via UI, não via Alpha.
4. **`load_heuristic` chamado só 2 vezes em 14d** — Alpha praticamente não consulta o índice de heurísticas. Sinal de que prompt direciona pouco esse uso.
5. **`get_recent_meetings` é a tool #1** — Alpha é usado bastante pra pesquisa de reuniões. Importante: não regredir esse caminho na Fase 1.

---

## Tally final

| Categoria primária | Count |
|---|---|
| sem-tool | **9/15** (A1, A2, A3, A4, A9, A10, A11, A14, A15) |
| sem-contexto | **9/15** (A1, A2, A3, A4, A9, A10, A11, A14, A15 — sobreposição com sem-tool, contam ambas) |
| prompt-confuso | **1/15** (A7) |
| modelo-alucina | **4/15** (A2, A10, A11, A14, A15 — falhas onde Alpha **afirma com confiança** algo falso) |
| correto | **5/15** (A5, A6, A8, A12, A13) |

> **Nota:** soma > 15 porque categorias se sobrepõem. A primária (mais grave) é a que conta pro gate.

**Sanity (A6 sprint, A8 capacity):** 2/2 — ✅ baseline ok.

**Categorização exclusiva (uma única categoria por prompt — primária):**

| # | Categoria primária |
|---|---|
| A1 | sem-tool |
| A2 | sem-tool (modelo-alucina secundário — inventa módulos) |
| A3 | sem-tool (modelo-alucina secundário — fabrica módulos a partir de prefixos) |
| A4 | sem-tool |
| A5 | correto |
| A6 | correto |
| A7 | prompt-confuso |
| A8 | correto |
| A9 | sem-tool |
| A10 | sem-tool (modelo-alucina secundário — afirma que story não existe) |
| A11 | sem-tool (modelo-alucina secundário) |
| A12 | correto |
| A13 | correto |
| A14 | sem-tool (modelo-alucina secundário — afirma que `refined` não existe) |
| A15 | sem-tool (modelo-alucina secundário — nega personas) |

**Tally exclusivo:**
- sem-tool: **9/15 (60%)**
- prompt-confuso: 1/15
- modelo-alucina (primário): 0/15 — sempre secundário, derivado de sem-tool
- correto: 5/15

---

## Decisão go/no-go

**Critérios do plano §3.4:**
- `sem-tool + sem-contexto ≥ 8/15` → **GO Fase 1**

**Resultado: 9/15 falhas primárias = sem-tool. ✅ GATE PASSA — GO Fase 1.**

### Diagnóstico fino

1. **Hierarquia É o gargalo.** 9 dos 10 cenários de hierarquia falharam por falta de tool exposta. Plano V3 §4 (Fase 1) ataca isso diretamente.

2. **Padrão de alucinação preocupante mas derivado.** Quando falta tool, Alpha **inventa com confiança** em vez de admitir ignorância (A2 inventa módulos, A10/A11 negam stories existentes, A14 nega `refined`, A15 nega personas). Isso é **comportamento de modelo + prompt** que precisa ser endereçado **junto** com a Fase 1, não depois.
   - **Ação:** adicionar à Onda 1.4 (prompt) uma regra explícita: *"Quando você não tem tool para verificar uma entidade que o usuário cita (story, módulo, persona), NÃO afirme que ela não existe. Diga: 'não tenho ferramenta para verificar isso ainda — pode confirmar a referência ou descrever?'"*. Sem isso, Alpha pode passar a Fase 1 mas continuar mentindo em casos não cobertos.

3. **Refinement loop tem zero suporte.** A10, A11, A14 são todos refinement — falham todos. Confirma decisão V3 de incluir refinement na Fase 1 (não deixar pra Fase 2).

4. **Sanity sólida.** A6 e A8 (sprint/capacity) funcionam bem. Isso significa que Fase 1 pode adicionar tools sem risco de regredir baseline — desde que **não toque** em `get_sprint_overview`, `get_member_commitments`, `get_sprint_capacity`.

5. **Heatmap revela uso real ≠ uso planejado.** Tools granulares de escrita são mortas em prod. Ao planejar Fase 2 (planner mode), considerar que **PMs prefere `bulk_update_tasks` over `move_task_to_sprint` × N** — o desuho do bulk RPC já está correto.

6. **A7 é o único `prompt-confuso`** — Alpha entrou em modo planning sem perguntar nada. Endereçado pela Fase 2 (Onda 2.4 prompt "Sprint Planning" obriga as 4 perguntas). Mas vale **atenção pra não regredir a heurística `sprint-composicao`** — ela existe e Alpha já carrega às vezes.

### Próximo passo

**GO Fase 1**, com 1 ajuste:

> **Adendo à Fase 1, Onda 1.4 (prompt):** incluir regra anti-alucinação. Antes de "concluir" que uma entidade não existe (story, módulo, persona, status), Alpha **deve** primeiro chamar a tool de leitura correspondente (`list_modules`, `list_personas`, `get_story`). Se mesmo assim não achar, dizer "não encontrei `X` — confirma a referência?" em vez de "X não existe".

Próximas ações concretas:
1. Atualizar V3 com este adendo (1 parágrafo na §4.4).
2. Iniciar Onda 1.1 — wrappers Alpha-only.

---

## Tally final

_(consolidado na seção acima)_
