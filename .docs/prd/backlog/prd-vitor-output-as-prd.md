---
status: draft
owner: João Moraes
date: 2026-05-29
domain: agents / product-spec pipeline
codenames:
  - vitor-as-pm        # Vitor reposicionado como Product Manager (gera PRDs)
  - vitoria-as-eng     # Vitoria reposicionada como Product Engineer (consome PRDs, opera GitHub)
  - prd-as-artifact    # PRD vira entidade de 1ª classe do domínio
references:
  - docs/agents/vitor/vitor-runbook-end-to-end.md
  - docs/prd/vitoria-prd.md
  - docs/features/meetings/planning-ceremony-plan.md
  - project_vitor_mcp_volund_v2 (memory)
  - project_zelar_v2 (memory)
---

# PRD — Vitor produz PRDs, Vitoria executa

> **TL;DR:** Hoje Vitor cria `Module/UserStory/Task/AC` direto no banco a partir do brainstorm da Design Session. Isso mistura **discovery de produto** com **planejamento de execução** no mesmo agente. Esta proposta reposiciona Vitor como **PM (gera array de PRDs, um por functionality do brainstorm)** e Vitoria como **Product Engineer (consome PRDs, gera tasks, monta sprints, opera GitHub)**. PRD vira o **artefato canônico de handoff** entre os dois — versionável, auditável, consumível também por AI builders externos.

---

## 1. Problema

### 1.1 Hoje (estado real)

Vitor (Design Session agent) tem 9 steps. No último (`briefing`), ele usa tools de mutação de domínio — `propose_modules`, `create_user_story`, `create_task`, `manage_story_ac`, `set_story_refinement` — pra escrever direto em `Module`, `UserStory`, `Task`, `AcceptanceCriterion`. Saída do Vitor = linhas no banco.

Vitoria (em construção) é o **copiloto do PM em Cerimônias** (Planning, Daily, Review). Lê `ProjectProfile` (sprints, US ativas, squad, blockers) e propõe composição de sprint a partir das US/Tasks **que o Vitor já criou**.

Pipeline atual:

```
brainstorm (DS step)
   ↓ Vitor (briefing step)
Module → UserStory → Task → AC   (linhas no banco)
   ↓ Vitoria (Planning Ceremony)
Sprint (linhas no banco)
   ↓ humano (PM/dev)
GitHub (issues, PRs, código)
```

### 1.2 Quatro dores

1. **Vitor está sobrecarregado.** Discovery (entender o porquê) e execução (modelar US/Task/dependências/AC) são atividades cognitivamente distintas. O mesmo prompt+toolset faz as duas → qualidade do "porquê" cai quando o agente já está preocupado em modelar dependsOn de task.
2. **Sem artefato durável "do produto"**. UserStory.title + want + soThat + AC[] **não compõem um briefing**. Quem entra no projeto depois (builder, sponsor, agente externo) não tem como consumir "o que é essa funcionalidade, por quê, pra quem, qual o sucesso, qual a história, qual o trade-off". Está fragmentado em N rows.
3. **AI builders ficam de fora.** A visão estratégica do Volund é que **AI product builders** (agentes externos, codex-style) consumam o spec do produto e implementem. Hoje não há artefato exportável — só DB rows acopladas ao schema do Zordon. Não tem como "dar pro builder" sem reconstruir um briefing manualmente.
4. **Confusão sobre quem planeja tasks.** Vitor gera Task hoje, mas Vitoria também precisa criar/refinar Task na Planning Ceremony. Dois agentes escrevendo na mesma tabela com lógicas diferentes vira ambiguidade de fonte da verdade.

### 1.3 Princípio do user

> **"Queremos separação de concerns o tempo todo."**
> — João, 2026-05-29

---

## 2. Solução em uma frase

**Vitor produz um array de PRDs (1 por functionality do brainstorm) como deep-briefing canônico. Vitoria consome os PRDs e materializa execução (tasks, sprint, GitHub). PRD vira entidade de 1ª classe do domínio, versionável, auditável, exportável.**

---

## 3. Não-objetivos

- **Não** entregar a versão final do PRD-como-doc-renderizado (markdown bonito com gráficos) na v1. v1 = struct serializável; rendering vem depois.
- **Não** acoplar PRD ao formato do GitHub (issue body, project field, etc). PRD é **agnóstico** de destino — GitHub é um dos consumidores, Volund interno é outro, builder externo é outro.
- **Não** depreciar Module imediatamente — Module continua como **agrupador de PRDs** (grupo de functionalities). Só `UserStory/Task/AC` saem do output do Vitor.
- **Não** automatizar Vitoria→GitHub na v1. v1 = Vitoria gera tasks no Zordon a partir do PRD. GitHub integration entra em v2 (depois de provar PRD→task).
- **Não** migrar o Zelar v2 (28 stories pos-auditoria) automaticamente. Migração é fase à parte, com decisão consciente do user.
- **Não** mudar Planning Ceremony da Vitoria — ela continua sendo copiloto de ritual. Ganha **uma nova capability** (consumir PRD), não troca de papel.

---

## 4. Personas e jornada

### 4.1 PM / Product owner (João)

> "Rodo DS de Inception com Vitor. No fim, recebo **N PRDs**, um por functionality do brainstorm. Cada PRD é um briefing fechado — problema, persona, jornada, AC, métricas, edge cases, dependências de outros PRDs. Reviso, ajusto, aprovo. Aí dou pra Vitoria. Ela transforma cada PRD aprovado em tasks já com FP, scope, complexity, dependências resolvidas, e me propõe a sprint."

### 4.2 Vitoria (Product Engineer agent)

> "Recebo array de PRDs aprovados. Pra cada PRD: leio o briefing inteiro, leio o repo via GitHub MCP, decido tipo de cada task (build/research/spike), estimo FP, monto dependências, gero `Task[]` no Zordon. Na Planning Ceremony do projeto, monto o sprint a partir do pool de Tasks geradas. Não invento story — o "porquê" sempre referencia um PRD."

### 4.3 AI Builder externo (futuro)

> "Volund me passa um PRD via API. Eu (agente de código autônomo) leio o briefing, faço a implementação, abro PR. PRD é meu único contrato — não preciso navegar 5 tabelas do Zordon."

### 4.4 Sponsor / stakeholder

> "Vejo o array de PRDs do projeto e entendo o que está sendo construído, pra quem, e por quê, sem precisar do PM narrar. Cada PRD é leitura de 2-5min."

---

## 5. Decisões fixadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Output do Vitor | **Array de PRDs** (1 por functionality) | Briefing fechado por unidade de produto. Substitui criação de US/Task/AC pelo Vitor. |
| O que Vitor para de fazer | `create_user_story`, `update_user_story`, `create_task`, `update_task`, `manage_story_ac`, `set_story_refinement` saem do toolset | Concerns: discovery, não execução. |
| O que Vitor mantém | `propose_modules`, `approve_module` (Module = agrupador de PRDs); novas tools `propose_prd`, `update_prd`, `approve_prd` | Module continua sendo o "tema". PRD é o briefing dentro do tema. |
| Vitoria — escopo | **Acumula**: Planning Ceremony (live com PM) **+** novo modo "PRD → Tasks → Sprint" | Não trocar de papel; ganhar capability. Mesma identidade visual, mesmo agente. |
| Vitoria — GitHub | v2 (não v1) | v1 prova o handoff PRD→Task interno. v2 integra GitHub MCP (issues/PRs/repo read). |
| PRD é entidade do banco | **Sim — nova tabela `ProductRequirement`** (PRD) | Versionável, auditável, com FKs pra Module/Project. Não vai como blob em DesignSession. |
| Schema do PRD | Estruturado (campos tipados) + um campo `markdown` denormalizado pra render | Estrutura permite query/agregação. Markdown serve render + export pra builders. |
| Migração Zelar v2 | **Não automática**. Decidir caso-a-caso depois que pipeline novo estiver provado em um projeto fresh. | 28 stories pos-auditoria são caras pra mexer. Provar primeiro. |
| Fonte do "porquê" | PRD substitui o conjunto US.want + US.soThat + AC | PRD tem persona, jornada, AC, edge cases, sucesso, dependências — supraset. |

---

## 6. O que é um PRD (schema)

### 6.1 Estrutura conceitual

Cada PRD descreve **uma functionality** (recortada de um card do brainstorm ou de agrupamento de cards). Campos:

| Campo | Tipo | Conteúdo |
|---|---|---|
| `id` | uuid | PK |
| `projectId` | uuid FK | Projeto dono |
| `moduleId` | uuid FK nullable | Agrupador (Module continua existindo) |
| `designSessionId` | uuid FK | DS onde nasceu |
| `reference` | text | Ex: `EVZL-PRD-001` (auto, formato `<projectKey>-PRD-NNN`) |
| `title` | text | Nome da functionality |
| `oneLiner` | text | Resumo de 1 linha (vai pro hero da Wiki, header de issue) |
| `personaIds` | uuid[] | Personas alvo (FK pra `Persona` da DS) |
| `problem` | text | A dor que essa functionality resolve (não a feature em si) |
| `goal` | text | Resultado de produto esperado |
| `userJourney` | jsonb | Array de steps `{actor, action, expectation}` |
| `acceptanceCriteria` | jsonb | Array de AC tipadas `{given, when, then}` ou Gherkin-like |
| `successMetrics` | jsonb | Array `{metric, baseline?, target}` |
| `outOfScope` | text[] | O que essa functionality **não** faz (clarifica fronteira) |
| `dependencies` | jsonb | Array `{prdId, kind: 'blocks'|'enables'|'shares-data'}` (refs cross-PRD) |
| `technicalNotes` | text | Notas técnicas vindas do brainstorm (não-vinculantes) |
| `risksAndAssumptions` | jsonb | `[{kind: 'risk'|'assumption', text, mitigation?}]` |
| `sourceCardIds` | text[] | IDs dos cards do brainstorm que originaram esse PRD |
| `status` | enum | `draft \| review \| approved \| superseded` |
| `version` | int | Incrementa em mudanças após `approved` |
| `markdown` | text | Render denormalizado pra export (gerado por trigger ou app code) |
| `approvedAt` | timestamptz | Marca aprovação (cascateia visibilidade) |
| `approvedBy` | uuid FK | Member que aprovou |
| `createdAt`, `updatedAt` | timestamptz | Auditoria padrão |

Tabela auxiliar `ProductRequirementActivity` (espelha `ModuleActivity`) pra histórico — quem mudou o quê e quando.

### 6.2 Markdown export (exemplo, abreviado)

```markdown
# [EVZL-PRD-007] Acompanhamento de evolução do prestador

**Module:** Acompanhamento · **Personas:** Prestador, Admin · **Status:** approved v2

## Problema
Prestadores não têm visibilidade de como estão evoluindo ao longo do tempo...

## Goal
Prestador abre o app e vê em <5s onde está, o que melhorou, o que cair em alerta.

## Jornada
1. Prestador → abre dashboard → espera ver status atual + delta vs semana passada
2. ...

## Acceptance Criteria
- **Given** um prestador com >= 4 semanas de histórico, **When** abre /dashboard, **Then** vê gráfico de tendência das 8 últimas semanas.
- ...

## Métricas
- engagement_dashboard_weekly: baseline 0 → target 60%
- ...

## Dependências
- blocks: EVZL-PRD-003 (sem login não vê dashboard)
- shares-data: EVZL-PRD-012 (mesma agregação semanal)

## Out of scope
- Comparação com pares (PRD futuro)
- Notificação push (Module Notificações)
```

---

## 7. Arquitetura — handoff Vitor → Vitoria

### 7.1 Diagrama

```
┌────────────────────────────────────────────────────────────────────────┐
│  DS Inception (steps 1-8: vision → brainstorm → prioritization)        │
└────────────────────────────────────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────────────┐
│  Vitor (step 9: briefing) — Product Manager                            │
│    Tools: propose_modules, approve_module,                             │
│           propose_prd, update_prd, approve_prd                         │
│    Output: ProductRequirement[] (status=draft → review → approved)     │
└────────────────────────────────────────────────────────────────────────┘
                                ↓ (PRDs approved)
┌────────────────────────────────────────────────────────────────────────┐
│  Vitoria — Product Engineer (novo modo "execution-from-prd")           │
│    Input: ProductRequirement[] approved + repo context (v2: GitHub MCP)│
│    Output: Task[] (com FP, scope, dependsOn, type), Sprint composition │
│    Tools: create_task, update_task, propose_sprint, link_task_to_prd   │
└────────────────────────────────────────────────────────────────────────┘
                                ↓
                  Planning Ceremony (Vitoria + PM live)
                                ↓
                       Sprint commit → execução
```

### 7.2 Nova FK: `Task.productRequirementId`

`UserStory` **deixa de ser obrigatório**. Substitui pela FK opcional `Task.productRequirementId` (uuid → `ProductRequirement.id`). Manter `Task.userStoryId` como deprecated nullable na v1 (migração gradual).

Refinement status (`refined/committed`) sai da Task — vira propriedade do PRD (`PRD.status = approved` ⇒ Tasks daquele PRD podem ir pra sprint).

### 7.3 Tools do Vitor (novo toolset)

| Tool | Input | Side effect |
|---|---|---|
| `propose_modules` | `[{name, description, brainstormCardIds[]}]` | Insere Module(s) `approvedAt=null` |
| `approve_module` | `moduleId` | Set `approvedAt=now()` |
| `propose_prd` | `{moduleId?, title, oneLiner, problem, goal, personaIds, sourceCardIds, ...}` | Insere PRD `status=draft` |
| `update_prd` | `{id, ...partial}` | Update PRD (não-aprovado) |
| `approve_prd` | `prdId` | Valida AC mínimas + dependências resolvidas, set `status=approved`, `approvedAt`, `approvedBy` |
| `link_prd_dependency` | `{fromPrdId, toPrdId, kind}` | Cria entrada em `PRD.dependencies` |
| `get_brainstorm_cards` | — | Read-only do `brainstorm.solutions` |

Tools removidos do Vitor: `create_user_story`, `update_user_story`, `create_task`, `update_task`, `manage_story_ac`, `set_story_refinement`, `link_task_dependency` (tudo isso passa pra Vitoria).

### 7.4 Tools da Vitoria (delta — só os novos)

Mantém todos os tools de Planning Ceremony (não detalhados aqui, ver `vitoria-prd.md`). Ganha:

| Tool | Input | Side effect |
|---|---|---|
| `list_approved_prds` | `{projectId, moduleId?}` | Read PRDs `status=approved` ainda não materializados |
| `materialize_prd_to_tasks` | `{prdId, taskDrafts: [{title, type, scope, complexity, fp, dependsOn}]}` | Cria Tasks com FK `productRequirementId`, marca PRD como `materializedAt` |
| `update_task` | (mesmo de hoje) | Edita Task |
| `propose_sprint_from_prds` | `{prdIds[], targetCapacityFP, startDate}` | Gera sugestão de sprint com tasks dos PRDs informados |
| `read_repo` *(v2)* | `{path?, query?}` | Lê repo via GitHub MCP pra calibrar tasks (existência de módulo, lib, padrão) |

---

## 8. Fluxo end-to-end (exemplo Zelar)

```
1. DS Inception roda steps 0-8. Brainstorm tem 94 cards.
2. Vitor (step 9) chama propose_modules → cria 8 Modules draft.
3. Vitor chama approve_module pra cada → aprovados.
4. Vitor chama propose_prd pra cada functionality (estimativa: ~25-40 PRDs).
5. PM revisa cada PRD na UI (rota /projects/[id]/prds/[prdId]):
   - aprova → Vitor.approve_prd
   - pede ajuste → Vitor.update_prd
6. PM marca DS como completed → cascateia visibilidade dos PRDs approved.
7. Vitoria entra em modo "execution-from-prd":
   - list_approved_prds
   - pra cada PRD: materialize_prd_to_tasks (cria Tasks já com FP, dependsOn)
8. Planning Ceremony semanal: Vitoria propõe sprint via propose_sprint_from_prds,
   PM confirma na UI, sprint vira commit.
9. (v2) Vitoria abre issues no GitHub linkadas a cada Task aprovada.
```

---

## 9. Migração

### 9.1 Zelar v2 (28 stories existentes, 274 AC)

**Decisão:** não migrar automaticamente. Opções, escolha pós-prova-de-conceito:

| Opção | Esforço | Risco |
|---|---|---|
| Migrar US→PRD 1:1 com script | Médio (~1 dia) | Médio — US do Zelar já são granulares, alguns PRDs sairão pobres |
| Recriar PRDs do Zelar com Vitor a partir do brainstorm v2 | Alto (~3 dias + revisão) | Baixo — PRDs nascem com qualidade do novo pipeline |
| Manter Zelar no modelo antigo, novo projeto começa no pipeline novo | Zero | Alto — duas convenções vivas indefinidamente |

Recomendação para revisão: começar projeto novo no pipeline PRD (greenfield). Zelar fica no modelo antigo até v1 estar provada. Decidir Zelar na **Fase 4**.

### 9.2 Compatibilidade transitória

- `UserStory` permanece no schema com flag `legacy=true` em rows pré-migração.
- `Task.userStoryId` e `Task.productRequirementId` coexistem (um dos dois NOT NULL via CHECK).
- `getProjectProfile` aceita os dois mundos (lê tasks por sprint, FK não importa pra Vitoria-planning).
- Wiki composer (PRD `prd-project-wiki.md`) passa a ler PRDs aprovados em vez de Module+US (atualização planejada em Fase 3).

---

## 10. Fases

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **1 — Schema + Vitor tools** | Tabela `ProductRequirement` + activity; novos tools no Vitor; tools antigos de US/Task removidos do Vitor | Vitor gera 5 PRDs num projeto fresh, sem tocar US/Task |
| **2 — UI de revisão de PRD** | `/projects/[id]/prds`, `/projects/[id]/prds/[id]` (read + edit + approve) | PM aprova um PRD pela UI, status flipa |
| **3 — Vitoria PRD→Tasks (modo novo)** | `materialize_prd_to_tasks`, `propose_sprint_from_prds`; novo tab "Execution" no profile do PRD | Vitoria gera 10 Tasks de um PRD aprovado, monta sprint, PM commita |
| **4 — Decisão Zelar + Wiki migration** | Decidir migração Zelar; Wiki composer lê PRDs | Wiki do projeto novo gera narrativa a partir de PRDs |
| **5 — GitHub MCP (Vitoria v2)** | Tool `read_repo`; sync Task ↔ Issue | Vitoria cria issue no GitHub vinculada à Task |

Fases 1-3 = MVP. Fase 4-5 = expansão.

---

## 11. Métricas de sucesso

| Métrica | Baseline (hoje) | Target v1 |
|---|---|---|
| Tempo Vitor (start DS → output pronto pra PM) | ~6h (briefing produz N artifacts misturados) | ≤4h (só PRDs estruturados) |
| Densidade de informação por unidade de produto | US.want+soThat+AC = ~300 chars | PRD = ~1500-3000 chars estruturados |
| % PRDs aprovados sem rework após primeira revisão | n/a | ≥60% |
| % Tasks da Vitoria com `productRequirementId` not null | n/a | 100% (em projeto greenfield) |
| Re-uso de PRD por consumidor externo (builder/sponsor reading) | 0 | ≥1 sponsor lê PRD sem narrativa do PM por projeto |

---

## 12. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| PRD vira "documento morto" (PM aprova rápido, não revisa de verdade) | Alta | UI força revisão por seção (checklist); `approve_prd` exige confirmação por seção |
| Vitor gera PRDs com baixa qualidade (problema/goal pobres) | Alta | Tools com validação no servidor (problem ≥ 50 chars, goal mensurável, ≥3 AC); Vitor's prompt redesenhado pra discovery-only |
| Vitoria materializa mal (tasks rasas, FP errado) | Média | Eval harness — comparar tasks geradas com baseline humano em 3 PRDs piloto |
| Duplicação de fonte da verdade (US + PRD coexistindo) | Média | CHECK em Task (exatamente uma FK preenchida); flag `legacy=true` em US migrados |
| Dependências entre PRDs viram grafo infinito | Baixa | Limitar a `blocks/enables/shares-data` (3 kinds), depth máx 2 na UI |
| AI builders externos quebrarem com mudança de schema | Baixa | Versionar PRD (`version` int); export via endpoint estável `GET /api/prds/[id]?format=markdown` |

---

## 13. Perguntas em aberto

1. **PRD por functionality ou por persona?** Hoje brainstorm tem cards tagueados `[MODULO][PERSONA]`. Um PRD descreve a functionality pra **todas** as personas envolvidas (preferência), ou um PRD por persona/functionality? → Preferência: por functionality, com `personaIds[]`.
2. **Granularidade do PRD vs Module.** Module agrupa PRDs. Onde mora o "tema técnico" (ex: "auth")? Module ou PRD? → Preferência: Module = tema, PRD = capacidade dentro do tema.
3. **Aprovação cascateia tasks?** Quando PRD vai pra `approved`, Vitoria materializa automaticamente ou só após pedido explícito do PM? → Preferência: explícito (PM aciona `materialize` na UI).
4. **Vitor escreve markdown direto?** Vitor preenche campos estruturados e o `markdown` é gerado por trigger/code, ou Vitor escreve markdown e a app parseia? → Preferência: estrutura primeiro, markdown derivado.
5. **DS sem brainstorm gera PRD?** Hoje DS Inception tem 9 steps; DS CI (continuous improvement) é mais leve. CI gera PRD também? → Adiar pra v2; v1 só Inception.

---

## 14. Anexo — comparativo antes/depois

| Aspecto | Hoje | Pós-mudança |
|---|---|---|
| Output do Vitor | Module + UserStory[] + Task[] + AC[] (DB rows) | Module + ProductRequirement[] (PRD = briefing fechado) |
| Quem cria Task | Vitor (briefing) + Vitoria (planning) | **Só** Vitoria (materializa PRD → Tasks) |
| Quem cria AC | Vitor (`manage_story_ac`) | Vitor (dentro do PRD, campo `acceptanceCriteria`) |
| Fonte do "porquê" | US.want + US.soThat + AC[] (3 tabelas) | PRD (1 row estruturada + markdown) |
| Exportável pra builder externo | Não (precisa montar manual) | Sim (markdown + JSON via endpoint) |
| Refinement status | `UserStory.refinementStatus` | `ProductRequirement.status` |
| Planning Ceremony da Vitoria | Lê US/Task | Lê PRDs aprovados + tasks materializadas |
| Vitoria opera GitHub | Não | v2: sim (issues, repo read) |

---

## 15. Próximos passos (se o PRD for aprovado)

1. **Plano técnico detalhado** em `docs/agents/vitor/vitor-as-pm-plan.md` — schema SQL exato da tabela `ProductRequirement`, migrations, mudança de prompt do Vitor, novos tools com Zod schemas.
2. **Plano técnico Vitoria** em `docs/agents/vitoria/vitoria-prd-execution-plan.md` — novo modo de execução, integração com Planning Ceremony.
3. **Spike de UI** em `/projects/[id]/prds` — wireframe da revisão por seção.
4. **Eval baseline** — gerar 3 PRDs com Vitor novo num projeto fresh, comparar densidade/qualidade contra US/Task equivalentes do Zelar.
