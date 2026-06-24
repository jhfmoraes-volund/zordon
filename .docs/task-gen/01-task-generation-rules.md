# 01 — Regras de Geração de Tasks

Este é o regulamento que governa como AC viram tasks. Toda saída da skill `/task-gen-story` precisa passar por essas regras.

> ## Escopo da skill: **planejamento, não implementação**
>
> A skill registra **cards de backlog** nas tabelas internas do Zordon
> (`Task`, `AcceptanceCriterion`, `TaskAcceptanceCriterion`, `TaskDependency`).
>
> O conteúdo SDD em `Task.description` (snippets de SQL, TS, route handlers,
> migrations) é **referência para quem implementar a task depois** — num
> banco/repositório do produto Zelar, separado do Zordon. **A skill nunca
> executa esse SQL.**
>
> Por isso o arquivo gerado mora em `docs/task-gen/projects/zelar/backlog-sql/`, não em
> `supabase/migrations/`. Quem aplica esse arquivo só insere metadata em
> tabelas do Zordon que já existem; nenhum DDL de produto roda nesse passo.
>
> Exemplos de wording que aparece nas tasks e **não** virou ação da skill:
> - `## O que criar` com `CREATE TABLE service_categories ...` → snippet pra
>   implementador, fica em string `description`
> - `Migration aplicada via psql` num checklist técnico → diz que **quem
>   implementar** vai rodar essa migration no banco do produto Zelar, não
>   que a skill rode agora
> - `database.types.ts regenerado` → ação do implementador no repo do produto

## 1. As 5 camadas técnicas

Toda task pertence a **exatamente uma** camada (`Task.layer`):

| Camada | O que entra | Característica |
|---|---|---|
| **DATA** | Schema (tabelas, colunas, enums, indices, constraints, triggers, jobs `pg_cron`), policies RLS | Vive em migrations SQL. Versionada. |
| **API** | Edge Functions, RPCs Postgres, server actions Next, validação Zod, integrações externas (gateway de pagamento, KYC, mensageria, NLP) | Onde a regra de negócio "acontece". |
| **REALTIME** | Canais Supabase Realtime, broadcasts, eventos, locks otimistas, idempotência distribuída | Sem isso UI não atualiza ao vivo. |
| **UI** | Telas, componentes, formulários, optimistic updates, navegação, estados (vazio/loading/erro) | Caminho do usuário. |
| **OPS** | Feature flags, parâmetros configuráveis, seeds, dashboards de operação, runbook ops | Calibração sem deploy. |

> **Regra de ouro:** se uma task mistura camadas, está mal granularizada. Quebre.

## 2. Mapeamento AC → Camadas

Para cada AC, identifique quais camadas precisam tocar para o comportamento existir. Padrões comuns:

| Tipo de AC | Camadas tipicamente afetadas |
|---|---|
| "PRESTADOR vê <lista>" | DATA (índices, RLS) + API (query) + UI (tela) |
| "CLIENTE submete <form> e recebe confirmação" | DATA (tabela) + API (POST + Zod) + UI (form + feedback) |
| "SISTEMA detecta <evento> e dispara <ação>" | DATA (trigger ou job) + API (Edge Function) [sem UI] |
| "ADMIN configura <parâmetro>" | OPS (parâmetro) + UI (admin) + API (PUT com auth) |
| "Usuário recebe notificação" | API (envio) + REALTIME (push web) — NOTIFICACAO já existe |
| "Estado em tempo real entre 2 partes" | REALTIME (canal) + UI (subscriber) |

## 3. Cobertura obrigatória por AC

Toda AC, ao final da geração, **DEVE** ter:

```
1+ task em DATA ∪ API   E   1+ task em UI
```

**Exceção SISTEMA:** AC com persona = SISTEMA (matching, RLS, jobs, ciclo de vida, ciclo financeiro automático) podem ficar **só** em DATA + API + REALTIME, sem UI.

**Exceção OPS:** AC sobre configuração de parâmetro pode ficar OPS + UI (a UI é admin).

A view `task_coverage_v` deve ser consultada ao final:

```sql
SELECT story_ref, ac_order, ac_preview, layers_covered, total_tasks
FROM task_coverage_v
WHERE story_ref = 'ZLAR-V2-US-001'
ORDER BY ac_order;
```

Qualquer linha com `layers_covered` que não inclua DATA/API E UI (exceto exceções) é falha de cobertura.

## 4. Granularidade

**Não há número fixo.** Granularidade é por coesão:

- 1 task = 1 unidade de entrega coesa **dentro de uma camada**
- Se uma task tem mais de 1 critério de pronto realmente independente, divida
- Se duas tasks dependem mutuamente (não conseguem ser feitas em paralelo nem invertidas), considere fundir

**Heurísticas de quebra:**
- Tabela nova + RLS dela = **1 task DATA** (vivem juntas, RLS sem tabela é nada)
- Endpoint POST + sua validação Zod = **1 task API** (Zod sem endpoint é nada)
- Tela + form + integração com endpoint = **1 task UI** se fluxo curto, **2 tasks UI** se fluxo tem múltiplas telas
- Job `pg_cron` + Edge Function que ele chama = **2 tasks** (DATA agenda, API executa)
- Realtime channel + subscriber UI = **2 tasks** (REALTIME provê canal, UI consome)

## 5. Reuso forçado

**Antes de criar task nova**, a skill checa:

1. **Tasks já criadas em outras US do projeto** que cobrem a mesma necessidade
   - Se sim: nova task referencia via `TaskDependency` (kind=`'blocks'`), **não duplica**
2. **Componentes/hooks/libs existentes** (ver [04-reusable-components.md](04-reusable-components.md))
   - Toda task UI lista os componentes reutilizáveis e marca `qualityFlags=['REUSE_EXISTING_COMPONENT']`
3. **Tabelas/colunas/RPCs já existentes**
   - Toda task DATA/API verifica antes de propor schema novo

Exemplos comuns de reuso cross-US:
- US-005 (PRESTADOR executa) e US-012 (CLIENTE acompanha) → ambas dependem de **máquina de estados** (US-023)
- US-013 (CLIENTE avalia) → depende de **endpoint de avaliação** (US-013 mesma) e **job de aceite tácito** (US-023)
- Várias US → dependem de **plataforma de comunicação** (US-024) e **policies RLS base** (US-023)

## 6. Estrutura mínima de uma task

Toda task tem:

| Campo | Tipo | Obrigatório? |
|---|---|---|
| `title` | string concisa, modo imperativo | ✅ |
| `description` | briefing técnico em padrão SDD (ver §8) | ✅ |
| `layer` | enum DATA/API/REALTIME/UI/OPS | ✅ |
| `userStoryId` | FK | ✅ |
| `personaScope` | string (CLIENTE/PRESTADOR/ADMIN/SISTEMA/ANY) | ⚠️ se DATA/API com RLS |
| `qualityFlags` | array (ver doc 02) | ⚠️ aplicar todas que se aplicam |
| `status` | `draft` (default na geração) | ✅ |
| `type` | string existente (`feature/component/chore/refactor/bugfix`) | ✅ |
| `storyAcceptanceCriterionIds` | UUIDs de AC-da-Story → `TaskAcceptanceCriterion` (N:N) | ✅ |
| `taskAcceptanceCriteria` | array de strings (checklist técnico) → `AcceptanceCriterion(taskId=...)` | ✅ |
| `dependsOn` | via `TaskDependency` (kind=`blocks`/`relates_to`) | ⚠️ se há dependência |

## 6.5. Modelo de AC: Story vs Task (LEIA ANTES DE GERAR)

A tabela `AcceptanceCriterion` (uma só) armazena **dois tipos** de critério, distinguidos por uma constraint XOR (`taskId XOR userStoryId`):

```
AcceptanceCriterion
├── id, text, "order", checkedAt, checkedBy
├── userStoryId  ← preenchido SE for AC-da-Story (taskId obrigatoriamente NULL)
└── taskId       ← preenchido SE for AC-da-Task  (userStoryId obrigatoriamente NULL)
```

### AC-da-Story
- **`AcceptanceCriterion(userStoryId=...)`** com `taskId=NULL`
- **Não criamos** essas — já vieram do refinamento de produto da DS Inception
- Linguagem de **usuário/comportamento** ("PRESTADOR escolhe 'Sou prestador'…")
- 274 já existem para Zelar v2 (28 stories × média 9–11 AC)

### AC-da-Task (checklist técnico)
- **`AcceptanceCriterion(taskId=...)`** com `userStoryId=NULL`
- **Criamos** uma para cada item do checklist técnico de pronto
- Linguagem de **engenharia/verificável** ("Migration aplicada via psql", "POST 409 quando…", "Field compound API usado em vez de input cru")
- Renderiza como **checkbox no TaskSheet** (UI atual lê `AcceptanceCriterion.taskId`)
- **NÃO** colocar como markdown na `description` — é dado, não texto

### TaskAcceptanceCriterion (a ponte)
- Junção N:N: `(taskId, acceptanceCriterionId)`
- Liga uma Task aos **AC-da-Story** que ela ajuda a satisfazer
- Resposta a "se eu marcar essa task done, quais AC do produto avançam?"
- View `task_coverage_v` deriva cobertura por AC desta tabela

### Diagrama mental

```
UserStory ──1:N──► AcceptanceCriterion (userStoryId)  ← AC-da-Story
                          ▲
                          │ N:N via TaskAcceptanceCriterion
                          │
                        Task ──1:N──► AcceptanceCriterion (taskId) ← AC-da-Task
```

### Regra prática

Para cada task gerada, produzir:
1. **`storyAcceptanceCriterionIds`** = lista de UUIDs das AC-da-Story que essa task ataca → vira N linhas em `TaskAcceptanceCriterion`
2. **`taskAcceptanceCriteria`** = lista de strings de pronto técnico → vira N linhas em `AcceptanceCriterion` com `taskId=<task>`, `userStoryId=NULL`, `order=0..N-1`

Erro comum a evitar: NÃO duplicar texto de AC-da-Story em AC-da-Task. Se o item de checklist técnico é só "atender AC #3 da story", remova — o vínculo via `TaskAcceptanceCriterion` já cobre isso. AC-da-Task descreve o que precisa ficar pronto **tecnicamente** (migration aplicada, validação Zod presente, smoke test passou).

## 7. Title style

- **Imperativo, conciso, ≤ 80 caracteres**
- Começa com verbo: "Criar tabela…", "Implementar endpoint…", "Renderizar tela…", "Configurar job…", "Aplicar RLS…"
- Inclui o objeto-alvo: "Criar tabela `service_requests` com RLS por client_id"
- Sem prefixos genéricos ("Tarefa de", "Fazer a")

## 8. Description style — padrão SDD

Description é um **briefing de engenharia em padrão SDD** (Spec-Driven Development). **Não inclui checklist de pronto** — esse vai em `taskAcceptanceCriteria` (vira `AcceptanceCriterion(taskId)`).

Estrutura obrigatória:

```markdown
## Objetivo
<o que entrega + por quê, em 1-2 frases — referencia AC-da-Story por número quando útil>

## Contexto
<módulo, dependências entre US, quem consome essa task, qual o estado upstream/downstream>

## Estado atual / O que substitui
<"não existe", ou "substitui X de US-NNN", ou "expande Y já existente"; sem mentir sobre estado>

## O que criar

### `caminho/do/arquivo.ts`
<comentário de uma linha do papel do arquivo>
```ts
// Snippet curto, REAL — assinaturas, types, contornos do que é não-óbvio.
// Não copiar implementação inteira; mostrar o suficiente pra quem implementa
// não inventar contrato diferente.
```

### `outro/arquivo.sql`
```sql
-- migrations: SQL real, não pseudo
```

## Constraints / NÃO fazer
- ❌ <antipattern específico>
- ❌ <decisão arquitetural já recusada>
- <restrições de segurança/performance que não são óbvias do código>

## Convenções
- <padrões do projeto que se aplicam — refs a docs/task-gen/04, memories>
- <secrets necessários, libs reutilizáveis, helpers existentes>
```

**Não inclua** (vão em outros campos / outras tabelas):
- ❌ "Critério de pronto" / "Definition of done" → vai em `taskAcceptanceCriteria` (AC-da-Task)
- ❌ Lista de qualityFlags → vai no campo `qualityFlags`
- ❌ Lista de dependências → vai em `TaskDependency` (mencionar **inline em "Contexto"** quando útil pra entender, mas não duplicar como seção)
- ❌ "AC #1, AC #4" como seção própria → vai em `TaskAcceptanceCriterion` (mencionar inline em "Objetivo" quando útil)

## 9. O que NÃO virar task

- **Decisões de produto** já tomadas (já estão nos AC; task assume)
- **Documentação** que não é runbook (descrições internas em CLAUDE.md / docs já existem)
- **Refactor "preventivo"** que não atende AC específico (entra em backlog separado)
- **Testes E2E exaustivos** (entram como 1 task de qualidade ao final do módulo, não por US)

## 10. Validações automáticas no fim da geração

A skill, ao terminar cada US, roda:

```sql
-- 1. Cobertura
SELECT * FROM task_coverage_v
WHERE story_ref='<US>'
  AND NOT (
    'UI' = ANY(layers_covered) AND ('DATA' = ANY(layers_covered) OR 'API' = ANY(layers_covered))
    OR -- exceção SISTEMA:
    (SELECT s."personaId" FROM "UserStory" s
     WHERE s.reference='<US>' AND s.id IN (
       SELECT "userStoryId" FROM "AcceptanceCriterion" WHERE id=ac_id
     )) = (SELECT id FROM "ProjectPersona" WHERE name='SISTEMA' AND "projectId"='e41c492e-...')
  );
-- Esperado: 0 linhas. Linhas presentes = AC sem cobertura mínima.

-- 2. Não-duplicação (intra-US)
SELECT title, COUNT(*) FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='<US>'
GROUP BY title HAVING COUNT(*) > 1;
-- Esperado: 0 linhas.

-- 3. Qualidade flags em DATA com persona
SELECT t.title, t.layer, t."personaScope", t."qualityFlags"
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='<US>'
  AND t.layer IN ('DATA','API')
  AND t."personaScope" IS NULL
  AND NOT ('RLS_REQUIRED' = ANY(t."qualityFlags") OR 'NO_RLS_NEEDED' = ANY(t."qualityFlags"));
-- Esperado: 0 linhas. Linhas presentes = task DATA/API sem RLS decision documentada.

-- 4. Toda task gerada tem checklist técnico (AcceptanceCriterion com taskId)
SELECT t.reference, t.title
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
LEFT JOIN "AcceptanceCriterion" ac ON ac."taskId" = t.id
WHERE s.reference='<US>'
GROUP BY t.reference, t.title
HAVING COUNT(ac.id) = 0;
-- Esperado: 0 linhas. Linhas presentes = task sem checklist técnico (TaskSheet renderizaria sem checkboxes).

-- 5. Description não tem "## Critério de pronto" (anti-pattern: deveria virar AC-da-Task)
SELECT t.reference, t.title
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
WHERE s.reference='<US>'
  AND (t.description ILIKE '%## Critério de pronto%' OR t.description ILIKE '%## Definition of done%');
-- Esperado: 0 linhas. Se aparecer, refatorar: mover bullets do markdown para AcceptanceCriterion(taskId=...).
```

## 11. Saída da geração

Por US, ao final, a persistência produz **4 tipos de linha**:

1. **`Task`** rows com `status='draft'` (uma por task)
2. **`TaskAcceptanceCriterion`** rows — ponte N:N entre task e AC-da-Story
3. **`AcceptanceCriterion(taskId=...)`** rows — checklist técnico da task (renderiza como checkbox no TaskSheet)
4. **`TaskDependency`** rows — ordem de execução entre tasks (`kind='blocks'` ou `'relates_to'`, lowercase)

Resumo no chat: contagem por camada + AC-da-Story cobertos + total de itens de checklist técnico + reuso identificado.

### Validação visual recomendada

Após persistir, abrir o TaskSheet de 1 task no app deve mostrar:
- Description em padrão SDD (Objetivo / Contexto / Estado atual / O que criar / Constraints / Convenções)
- **Checkboxes de checklist técnico** vindos de `AcceptanceCriterion(taskId)` — clicáveis
- Vínculos com AC-da-Story listados em algum lugar (vem de `TaskAcceptanceCriterion`)
