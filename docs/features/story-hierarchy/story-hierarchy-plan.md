# Story Hierarchy — Module / User Story / Task (V2)

**Status:** proposta consolidada pós-review crítica
**Data:** 2026-04-30
**Autor:** João + Alpha
**Substitui:** v1 do mesmo plano (mesma data — preservada no histórico git)
**Escopo:** schema, integração com Alpha e UI. **Não cobre** migração de dados existentes (ver doc separado `story-hierarchy-migration.md` quando entrar em execução).

---

## 1. Problema

Hoje o Zordon armazena trabalho como Tasks soltas (com `designSessionId` opcional). Não existe nível acima — não há agrupamento funcional por área de produto, nem unidade que carregue narrativa de valor de negócio.

Sintomas observados:
- Tasks geradas pelo Alpha misturam "endpoint de login" com "fluxo completo de autenticação" no mesmo nível
- Sem âncora narrativa, PM precisa reconstruir o "porquê" lendo várias tasks
- Planejamento de sprint vira lista de tasks órfãs em vez de entregas coerentes
- Difícil responder "o que está pronto no módulo de pagamentos?" sem agregação manual
- AC vive como `text` único, sem estado de validação — refresh do front-end perde o que já foi checado

## 2. Não-objetivos

Coisas que **não** vamos resolver aqui:
- ❌ **Migração de dados existentes** — escopo separado em doc próprio.
- ❌ **Épicos como entidade gerenciada** (com owner, MVP, hipótese de negócio à la SAFe)
- ❌ **Story points** — Function Points na Task já cobrem capacity.
- ❌ **Sub-tasks** — Task continua atômica; se precisar quebrar, vira 2 tasks.
- ❌ **Module ou Persona compartilhados entre projetos** — ambos `projectId NOT NULL`.
- ❌ **DoD por story** — DoD é universal por projeto.
- ❌ **Mexer no fluxo de Design Session** — ele continua sendo o input que gera US e Tasks.

## 3. Decisões fundamentadas

### 3.1 Hierarquia: 2 níveis + 1 tag, não 3 níveis

**Decisão:** `Module → UserStory → Task` onde `Module` é tag de agrupamento sem lifecycle.

**Por quê:**
- 3 níveis (Epic/US/Task) é vocabulário de empresa grande. Time pequeno + sprint semanal + MVP 8 semanas não justifica.
- Descartamos "Epic" como entidade porque carrega bagagem (lifecycle, owner, hipótese, dates). Se algum dia precisar de épico-de-verdade no sentido Cohn ("story grande que precisa quebrar"), vira `parentStoryId` na própria `UserStory`, ortogonal ao módulo.

### 3.2 Vocabulário: `Module`, não `Epic` nem `Theme`

**Decisão:** chamar o agrupamento de **`Module`** no schema e UI.

**Por quê (literatura formal):**
- Em **Cohn** (User Stories Applied, 2004), o que descrevemos como LOGIN, PAGAMENTOS é **theme** (agrupamento por afinidade), não epic (classificação de tamanho).
- **SAFe** define épico como iniciativa gerenciada com hipótese e MVP — não é o que queremos.
- **Jira** popularizou "epic = container de stories por tema" — tecnicamente impreciso e carrega expectativa errada.
- `Module` é neutro, descreve com precisão "área funcional do produto" e não cria expectativa que o schema não cumpre.

### 3.3 Story = unidade de **entendimento**. Task = unidade de **planejamento**.

**Decisão:** Function Points ficam **só na Task**. Story tem `totalFunctionPoints` **derivado** (soma das tasks vinculadas), exposto via view.

**Por quê:**
- Capacity model atual (`SprintMember.fpAllocation`, `Task.functionPoints`) já é task-driven. Não há valor em duplicar estimativa na story.
- Sprint planning arrasta story como agregadora visual + narrativa, mas o que conta capacity é a soma das tasks.
- Story sem tasks ainda no backlog → `totalFunctionPoints = 0`. Honestamente reflete "não estimada".

### 3.4 Story não tem `sprintId` próprio

**Decisão:** `sprintId` permanece **só na Task**. Story não armazena sprint association.

**Por quê:**
- Storage duplicado em 2 níveis sempre desincroniza (mesmo problema do status que motivou 3.5).
- "Sprint atual da story" = `MODE(sprintId)` das tasks não-done. Calculável quando precisar.
- Operação "mover story X pro sprint Y" = update transacional em `Task.sprintId` de todas as tasks da story. Ação, não estado.
- Story sem tasks não tem associação com sprint — não é problema, é a verdade.

### 3.5 Story status em **dois eixos ortogonais**

**Decisão:** separar lifecycle de entendimento (manual) de lifecycle de execução (calculado).

```
UserStory.refinementStatus  (manual, lifecycle de entendimento)
  draft        → Alpha gerou, ainda não revisado
  refined      → PM/builder validaram narrativa + AC
  committed    → entrou em sprint (alguma task tem sprintId)

UserStory.acValidatedAt + acValidatedBy  (manual, evento de PM)

computedStatus (derivado via view, lifecycle de execução)
  pending          → tem 0 tasks, OU todas pending
  in_progress     → ≥1 task done OU ≥1 em andamento
  tasks_complete   → todas tasks done, AC ainda não validado
  done             → tasks_complete + acValidatedAt IS NOT NULL
```

**Por quê:**
- Status manual em 2 níveis (story + task) sempre desincroniza.
- Mesclar refinement com execução é o que mata o status no Jira (vira lixeira de label).
- Os dois eixos são independentes: uma story `refined` pode estar em qualquer estado de execução.
- `done` exige AC validado → evita o sintoma "story 'done' que ninguém validou".

### 3.6 Acceptance Criteria como entidade de primeira classe

**Decisão:** AC vira tabela `AcceptanceCriterion` com ownership exclusivo (UserStory **ou** Task). DoD permanece como `jsonb` no Project.

**Por quê:**
- AC é checklist verificável **com estado**: `checkedAt`, `checkedBy`. JSONB de strings perde essa informação na recarga.
- Tabela permite RLS granular ("só PM/Admin marca AC"), histórico, filtros SQL nativos ("stories com AC pendente há > 3 dias").
- DoD continua JSONB no Project porque é só lista de referência, sem state per-story.

### 3.7 Module: per-project, descrição leve, name normalizado

**Decisão:** `Module` tem `name` (ex: `LOGIN`) + `description` (1-2 frases). `projectId NOT NULL`. Name normalizado: uppercase, trim, espaço→`_`. Constraint: `^[A-Z][A-Z0-9_]*$`.

**Por quê:**
- "PAGAMENTOS" do projeto X não é o mesmo do Y. Per-project evita namespace global.
- Enum fixo força migration toda vez que aparece módulo novo. Free text com normalização resolve.
- Normalização evita `LOGIN`/`Login`/`login`/`Auth` virarem 4 buckets do mesmo conceito.
- Sem `owner`, `dueDate`, `status`, `progress` — isso é Jira-épico, não é o que queremos.
- Unique: `(projectId, name)`.

### 3.8 `moduleId` é **nullable** + sugestão controlada de novo módulo

**Decisão:** `UserStory.moduleId` é nullable. Quando Alpha não encontra módulo que cabe, grava story com `moduleId NULL` e preenche `proposedModuleName text`. PM aprova → cria Module + atribui.

**Por quê:**
- NOT NULL forçaria Alpha a criar `[NEW] LOGIN` real no banco antes da aprovação do PM — polui a taxonomia que o constraint deveria proteger.
- Stories cross-cutting genuínas (ex: "ajustar typography global") podem viver sem módulo definitivo. Aceitar isso é honesto.
- UI ganha "inbox" de stories sem módulo, força triagem.

### 3.9 Persona: per-project, com seed automático

**Decisão:** tabela `ProjectPersona` (`projectId NOT NULL`, `(projectId, name) UNIQUE`). Trigger `AFTER INSERT ON Project` semeia 3 personas default: `Builder`, `PM`, `Cliente`. PM ajusta nome/descrição quando faz sentido.

**Por quê:**
- Compartilhar persona entre projetos cria problemas reais: edição global afeta vários projetos (RLS frágil), e "Cliente Final" tem perfil diferente em cada domínio.
- Custo de duplicação é trivial (`name + description` curtos).
- Seed automático elimina atrito do dia 1 — projeto novo já vem populado.

### 3.10 Story tem narrativa **estruturada**, não blob

**Decisão:** UserStory tem `personaId uuid → ProjectPersona`, `want text NOT NULL`, `soThat text` (opcional).

**Por quê:**
- Cohn é explícito: persona é parte separada da story. UI mostra "Como **Builder**, quero filtrar tasks por sprint" — leitura ancorada na pessoa que pede.
- Pro Alpha: escolher persona de uma lista controlada > alucinar texto. Reduz drift ("Como o sistema...", "Para que possamos...").
- `soThat` opcional respeita Cohn — nem toda story precisa explicitar o "porquê" quando é óbvio.

### 3.11 Reference: per-project, prefixado pelo `referenceKey` do projeto

**Decisão:** `Project` ganha `referenceKey text NOT NULL UNIQUE` (3 letras uppercase, ex: `CRM`, `ZRD`). UserStory.reference vira `{KEY}-US-{NN}`, sequencial **por projeto**.

**Por quê:**
- "Fechei a US-014" é ambíguo em ops multi-projeto. `CRM-US-014` é unívoco.
- Sequencer global é dívida (já existe em Task) — não vamos replicar.
- Constraint `UNIQUE` global na coluna `reference` continua válida (`CRM-US-014` é único de qualquer forma).

### 3.12 `area` substitui `type`/`scope`, com escape hatch documentado

**Decisão:** `Task.area text` com check `area IN ('front','back','infra','ops','mixed') OR area IS NULL`. `mixed` para tasks cross-cutting; `NULL` aceitável quando não classificável.

**Por quê:**
- `type`+`scope` foram usados de formas inconsistentes — sem consenso de domínio.
- Forçar Alpha a chutar entre `front`/`back` em task de "ajustar contrato API + componente" gera lixo.
- `mixed` declarado é melhor que classificação errada.
- `NULL` reservado pra casos legítimos (spike, docs, tarefa exploratória).

### 3.13 Rastreabilidade até o item da Design Session

**Decisão:** UserStory tem `designSessionId uuid` **e** `designSessionItemId uuid` (ambos opcionais).

**Por quê:**
- O `DesignSessionItem` (card MoSCoW da sessão) é a âncora narrativa real — é dele que a story nasce.
- Sem `designSessionItemId`, Alpha gera N stories de 1 sessão sem rastreabilidade fina; PM perde a capacidade de revisitar a discussão original.
- Stories criadas manualmente ficam com ambos `NULL` — válido.

### 3.14 Alpha classifica, não inventa

**Decisão:** quando Alpha gera UserStory, recebe `modules: { name, description }[]` e `personas: { name, description }[]` do projeto e **escolhe** um de cada lista. Só sugere novo módulo se nenhum cabe — via `proposedModuleName` em vez de criar Module direto.

**Por quê:**
- Sem isso, Alpha vai criar `LOGIN`, `AUTH`, `AUTENTICACAO`, `SIGNIN` no mesmo projeto.
- Mantém PM como gatekeeper de taxonomia.
- Personas seguem o mesmo princípio — se nenhuma cabe, Alpha **não cria**, marca como dúvida pra PM resolver antes de gerar a story.

---

## 4. Schema-alvo

Convenção: PascalCase para tabelas, camelCase para colunas (alinhado ao existente).

### 4.1 `Project` — modificações

```sql
ALTER TABLE "Project"
  ADD COLUMN referenceKey      text,
  ADD COLUMN definitionOfDone  jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill referenceKey de projetos existentes (script/manual antes do NOT NULL)
ALTER TABLE "Project"
  ALTER COLUMN referenceKey SET NOT NULL,
  ADD CONSTRAINT project_reference_key_format CHECK (referenceKey ~ '^[A-Z]{2,5}$'),
  ADD CONSTRAINT project_reference_key_unique UNIQUE (referenceKey);
```

`definitionOfDone` é array de strings (checklist items). Aplicado universalmente a toda story do projeto.

### 4.2 `ProjectPersona` — nova

```sql
CREATE TABLE "ProjectPersona" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projectId    uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  createdAt    timestamptz NOT NULL DEFAULT now(),
  updatedAt    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT persona_unique_per_project UNIQUE (projectId, name)
);

CREATE INDEX project_persona_project_idx ON "ProjectPersona"(projectId);

-- Seed automático ao criar projeto
CREATE OR REPLACE FUNCTION seed_project_personas()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "ProjectPersona" (projectId, name, description) VALUES
    (NEW.id, 'Builder',  'Membro do time que executa tasks'),
    (NEW.id, 'PM',       'Gestor do projeto, define prioridades e valida entregas'),
    (NEW.id, 'Cliente',  'Stakeholder externo / usuário final do produto');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_seed_personas_trigger
AFTER INSERT ON "Project"
FOR EACH ROW EXECUTE FUNCTION seed_project_personas();
```

### 4.3 `Module` — nova

```sql
CREATE TABLE "Module" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projectId     uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  createdAt     timestamptz NOT NULL DEFAULT now(),
  updatedAt     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT module_name_format CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT module_unique_per_project UNIQUE (projectId, name)
);

CREATE INDEX module_project_idx ON "Module"(projectId);
```

### 4.4 `UserStory` — nova

```sql
CREATE TABLE "UserStory" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projectId           uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,

  -- Classificação
  moduleId            uuid REFERENCES "Module"(id) ON DELETE SET NULL,
  proposedModuleName  text,                                      -- sugestão do Alpha quando nenhum module cabe
  reference           text NOT NULL,                              -- ex: "CRM-US-014" (per-project)

  -- Narrativa estruturada
  title               text NOT NULL,
  personaId           uuid REFERENCES "ProjectPersona"(id),
  want                text NOT NULL,                              -- "filtrar tasks por sprint"
  soThat              text,                                       -- "consigo focar no que entrega esta semana" (opcional)

  -- Lifecycle de entendimento
  refinementStatus    text NOT NULL DEFAULT 'draft'
                      CHECK (refinementStatus IN ('draft', 'refined', 'committed')),

  -- AC validation (lifecycle de execução, parte calculada)
  acValidatedAt       timestamptz,
  acValidatedBy       uuid REFERENCES "Member"(id),

  -- Origem
  designSessionId     uuid REFERENCES "DesignSession"(id),
  designSessionItemId uuid REFERENCES "DesignSessionItem"(id),

  -- Auditoria
  createdByAgent      boolean NOT NULL DEFAULT false,
  createdById         uuid REFERENCES "Member"(id),
  createdAt           timestamptz NOT NULL DEFAULT now(),
  updatedAt           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_story_reference_unique UNIQUE (reference),
  CONSTRAINT user_story_ac_validation_consistent CHECK (
    (acValidatedAt IS NULL  AND acValidatedBy IS NULL) OR
    (acValidatedAt IS NOT NULL AND acValidatedBy IS NOT NULL)
  )
);

CREATE INDEX user_story_project_idx     ON "UserStory"(projectId);
CREATE INDEX user_story_module_idx      ON "UserStory"(moduleId) WHERE moduleId IS NOT NULL;
CREATE INDEX user_story_refinement_idx  ON "UserStory"(refinementStatus);
CREATE INDEX user_story_ds_item_idx     ON "UserStory"(designSessionItemId) WHERE designSessionItemId IS NOT NULL;
```

**Sequencer da reference** — função `next_user_story_reference(projectId uuid)`:

```sql
CREATE OR REPLACE FUNCTION next_user_story_reference(p_project_id uuid)
RETURNS text AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT referenceKey INTO v_key FROM "Project" WHERE id = p_project_id;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-US\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM "UserStory"
  WHERE projectId = p_project_id;

  RETURN v_key || '-US-' || LPAD(v_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql;
```

### 4.5 `AcceptanceCriterion` — nova

```sql
CREATE TABLE "AcceptanceCriterion" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  userStoryId   uuid REFERENCES "UserStory"(id) ON DELETE CASCADE,
  taskId        uuid REFERENCES "Task"(id) ON DELETE CASCADE,
  text          text NOT NULL,
  "order"       integer NOT NULL DEFAULT 0,
  checkedAt     timestamptz,
  checkedBy     uuid REFERENCES "Member"(id),
  createdAt     timestamptz NOT NULL DEFAULT now(),
  updatedAt     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ac_owner_exclusive CHECK (
    (userStoryId IS NOT NULL AND taskId IS NULL) OR
    (userStoryId IS NULL AND taskId IS NOT NULL)
  ),
  CONSTRAINT ac_check_consistent CHECK (
    (checkedAt IS NULL  AND checkedBy IS NULL) OR
    (checkedAt IS NOT NULL AND checkedBy IS NOT NULL)
  )
);

CREATE INDEX ac_user_story_idx ON "AcceptanceCriterion"(userStoryId) WHERE userStoryId IS NOT NULL;
CREATE INDEX ac_task_idx       ON "AcceptanceCriterion"(taskId)      WHERE taskId      IS NOT NULL;
```

**Polimorfismo via 2 FKs nullable + CHECK exclusivo:** mantém integridade referencial real (vs polymorphic FK sem constraint), permite RLS granular, queries naturais (`WHERE userStoryId = ?`).

### 4.6 `Task` — modificações

```sql
ALTER TABLE "Task"
  ADD COLUMN userStoryId uuid REFERENCES "UserStory"(id) ON DELETE CASCADE,
  ADD COLUMN area        text;

ALTER TABLE "Task"
  ADD CONSTRAINT task_area_valid CHECK (
    area IS NULL OR area IN ('front', 'back', 'infra', 'ops', 'mixed')
  );

CREATE INDEX task_user_story_idx ON "Task"(userStoryId) WHERE userStoryId IS NOT NULL;
```

**Observações:**
- `userStoryId` é nullable porque tasks legacy (pré-feature) e tasks de manutenção sem story-mãe são reais.
- `acceptanceCriteria text` (campo antigo) **permanece** no schema mas perde uso. Drop fica fora deste plano (ver migração).
- `type` e `scope` permanecem no schema também — drop é tarefa de migração, não de schema novo.

### 4.7 View: `user_story_overview` (status + capacity em uma só)

```sql
CREATE OR REPLACE VIEW user_story_overview AS
SELECT
  us.id                                                                                AS "userStoryId",
  us."projectId",
  us."moduleId",
  us.reference,
  us.title,
  us."refinementStatus",
  us."acValidatedAt",
  COUNT(t.id)                                                                          AS "totalTasks",
  COUNT(t.id) FILTER (WHERE t.status = 'done')                                         AS "doneTasks",
  COALESCE(SUM(t."functionPoints"), 0)                                                 AS "totalFunctionPoints",
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status = 'done'), 0)                AS "doneFunctionPoints",
  CASE
    WHEN COUNT(t.id) = 0
      THEN 'pending'
    WHEN COUNT(t.id) FILTER (WHERE t.status = 'done') = COUNT(t.id)
         AND us."acValidatedAt" IS NOT NULL
      THEN 'done'
    WHEN COUNT(t.id) FILTER (WHERE t.status = 'done') = COUNT(t.id)
      THEN 'tasks_complete'
    WHEN COUNT(t.id) FILTER (WHERE t.status IN ('done','in_progress','review')) > 0
      THEN 'in_progress'
    ELSE 'pending'
  END                                                                                  AS "computedStatus"
FROM "UserStory" us
LEFT JOIN "Task" t ON t."userStoryId" = us.id
GROUP BY us.id;
```

**Combina** o que era `user_story_status_overview` + soma de FPs numa única view. App lê tudo de uma vez.

---

## 5. Integração com o Alpha (agente Ops)

### 5.1 Contexto que o prompt recebe

```ts
{
  project: { id, name, referenceKey, definitionOfDone[] },
  modules: { id, name, description }[],
  personas: { id, name, description }[],
  recentStories: { reference, title, moduleId }[]   // pra evitar duplicação
}
```

### 5.2 Output schema (Zod)

```ts
const userStoryOutput = z.object({
  moduleId: z.string().uuid().nullable(),
  proposedModuleName: z.string().nullable(),       // só se moduleId null
  personaId: z.string().uuid(),                    // obrigatório — Alpha não inventa persona
  title: z.string().min(5),
  want: z.string().min(5),
  soThat: z.string().nullable(),
  acceptanceCriteria: z.array(z.string()).min(1),  // serão criadas como rows AcceptanceCriterion
  tasks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    area: z.enum(['front','back','infra','ops','mixed']).nullable(),
    functionPoints: z.number().int().min(1),
    acceptanceCriteria: z.array(z.string()).min(1),
  })),
});
```

### 5.3 Regras do system prompt

- "Você recebe lista de modules e personas do projeto. **Escolha um module existente.** Se nenhum cabe, deixe `moduleId: null` e proponha `proposedModuleName` (uppercase, snake-case) para PM revisar."
- "**Personas você nunca inventa.** Se nenhuma da lista cabe, pare e peça ao PM pra criar antes."
- "Toda UserStory começa em `refinementStatus: 'draft'` (PM marca `refined` após revisão)."
- "Cada Task atômica tem AC próprio (verificável). Cada UserStory tem AC de aceitação de negócio (validado pelo PM)."

---

## 6. Implicações de UI

### 6.1 Telas novas

- `/projects/[id]/modules` — CRUD de módulos.
- `/projects/[id]/personas` — CRUD de personas (vem com 3 default).
- `/projects/[id]/stories` — lista de stories agrupadas por module + seção "Sem módulo" (inbox de `moduleId NULL`).
- `/projects/[id]/stories/[ref]` — detalhe: persona, narrativa, AC com checkboxes (estado persistido), tasks aninhadas, DoD do projeto read-only no rodapé.
- `/projects/[id]/settings/dod` — editar DoD do projeto.

### 6.2 Telas afetadas

- **Lista de tasks atual** — agrupar por UserStory (collapsible). Tasks órfãs (`userStoryId NULL`) ficam em seção própria.
- **Sprint planning** — drag de UserStory aplica `sprintId` em todas as tasks da story (transação). UI mostra `totalFunctionPoints` da story.
- **Detalhe da Task** — breadcrumb `Module > UserStory > Task`. Mostra AC própria + DoD do projeto read-only.
- **Página do Member (capacity)** — agrupa capacity por UserStory dentro do sprint, não só por task.

### 6.3 Auto-cálculo (vindo da view)

- Story status badge: `pending` / `in_progress` / `tasks_complete` / `done`.
- Progress bar = `doneTasks / totalTasks` (e `doneFunctionPoints / totalFunctionPoints` em paralelo).
- Module overview: `N stories, M done, P FPs total`.

### 6.4 Refinement workflow

- `draft` → badge "rascunho" + ação "marcar refinada" (PM/builder).
- `refined` → entra no pool de sprint planning.
- `committed` → set automático quando ≥1 task da story tem `sprintId NOT NULL`.

### 6.5 AC validation

- Quando `computedStatus = 'tasks_complete'`, story ganha CTA "Validar AC" pro PM.
- Marcar = popula `acValidatedAt` + `acValidatedBy`. `computedStatus` recalcula → `done`.
- Notificação automática quando todas tasks done mas AC pendente há > 24h.

---

## 7. Fora de escopo (decisões explícitas de NÃO fazer)

- ❌ **Story points / estimativa formal** — sprint semanal decide "cabe ou não cabe"; FPs cobrem.
- ❌ **Priority field na story** — ordem na sprint = prioridade.
- ❌ **Due date na story** — sprint dá o prazo.
- ❌ **Status manual de execução na story** — calculado das tasks. (Refinement é separado e manual.)
- ❌ **Sub-tasks** — task é unidade atômica.
- ❌ **Comments threads na story** — Design Session é o lugar pra discussão estruturada; Task tem `notes` livre.
- ❌ **Owner na UserStory** — owner vive nas tasks (Builder atribuído). Story tem PM responsável que é o do projeto.
- ❌ **Epic como entidade** — module é tag, não tem lifecycle.
- ❌ **DoD por story** — DoD é universal no projeto.
- ❌ **Sprint association na Story** — fica só na Task; sprint da story é derivado.
- ❌ **Module ou Persona compartilhados entre projetos.**
- ❌ **Migração de dados existentes** — escopo separado.

---

## 8. Questões abertas

Decisões que precisam ser fechadas **antes** da execução, já com proposta default. Confirmar:

1. **Quem pode marcar AC validado?**
   Proposta: `PM` e `Admin` do projeto (via RLS). Builder não.

2. **Como gerar `referenceKey` de projetos existentes no backfill?**
   Proposta: PM define manualmente (3-5 letras uppercase) na primeira execução do script. Sem default automático — taxonomia importa demais pra deixar máquina decidir.

3. **Story `refined` que nunca vai pra sprint — alerta ou silêncio?**
   Proposta: alerta no card após 14 dias parada (notificação pro PM). Não force-archive — só lembra.

4. **`proposedModuleName` aprovado vira novo Module automaticamente?**
   Proposta: **sim**, via ação na UI ("aprovar e criar"). PM clica → cria Module, atualiza `moduleId` da story, limpa `proposedModuleName`. Não é trigger automático no DB — é ação explícita do PM (mantém gatekeeping).

5. **Task pode ter AC próprio E herdar AC da story-mãe?**
   Proposta: **AC da Task é independente** do AC da Story. Story AC = aceitação de negócio (PM valida). Task AC = aceitação técnica (Builder/QA valida). Não há herança implícita — duplicar texto se precisar.

---

## 9. Fases de execução

> Migração de dados pré-existentes documentada em doc separado (não bloqueia este plano).

### Fase 0 — Alinhamento

- [ ] Revisar este plano (V2) com 1 PM + 1 Builder
- [ ] Fechar as 5 questões da seção 8
- [ ] Validar nomenclatura final (`Module`, `Persona`, `refinementStatus`, etc)

### Fase 1 — Schema base

- [ ] Migration: `Project.referenceKey` + `Project.definitionOfDone`
- [ ] Migration: `ProjectPersona` + trigger de seed
- [ ] Migration: `Module`
- [ ] Migration: `UserStory` + sequencer `next_user_story_reference`
- [ ] Migration: `AcceptanceCriterion`
- [ ] Migration: `Task.userStoryId` + `Task.area` (ambos nullable)
- [ ] View: `user_story_overview`
- [ ] Regenerar `database.types.ts`
- [ ] RLS policies pras 4 tabelas novas (alinhado à matriz Builder/PM/Admin)

### Fase 2 — Backend + DAL

- [ ] CRUD de Module (route handlers + helpers DAL)
- [ ] CRUD de Persona
- [ ] CRUD de UserStory (com criação aninhada de AC e Tasks)
- [ ] CRUD de AcceptanceCriterion (toggle check, edit text, reorder)
- [ ] DAL: `getModulesForProject`, `getPersonasForProject`, `getUserStoriesForSprint`, `getUserStoryWithTasksAndAC`
- [ ] Endpoint "approve proposedModuleName" (cria Module + atualiza Story)
- [ ] Endpoint "validate AC" (popula `acValidatedAt`/`acValidatedBy`)
- [ ] Endpoint "move story to sprint" (transação que atualiza `Task.sprintId` em massa)

### Fase 3 — UI

- [ ] Tela de Modules (CRUD)
- [ ] Tela de Personas (CRUD, com seed visível)
- [ ] Tela de Stories (lista agrupada, inbox de "sem módulo")
- [ ] Detalhe da Story (narrativa, AC interativo, tasks)
- [ ] Settings de DoD por projeto
- [ ] Refator da lista de tasks: agrupamento por UserStory
- [ ] Sprint planning: drag de story
- [ ] Breadcrumb e DoD read-only na Task
- [ ] Refinement workflow (draft → refined → committed)
- [ ] CTA "Validar AC" quando `tasks_complete`

### Fase 4 — Alpha integration

- [ ] Atualizar contexto do Alpha (passar `modules`, `personas`, `recentStories`)
- [ ] Atualizar output schema (Zod) com `userStories[].tasks[].acceptanceCriteria[]`
- [ ] Persistência: criar UserStory + AcceptanceCriterion (story-level) + Tasks + AcceptanceCriterion (task-level) numa transação
- [ ] System prompt: regras de classificação de module e escolha de persona
- [ ] Testes de calibração: Alpha gera saída coerente em 5 cenários

### Fase 5 — Cleanup pós-rollout

- [ ] Documentar fluxo no `AGENTS.md`
- [ ] Atualizar `prd-design-session.md`
- [ ] Drop de `Task.acceptanceCriteria` (text), `Task.type`, `Task.scope` — **só após** doc de migração rodar e validar zero leitura desses campos.

---

## 10. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Alpha cria módulos duplicados (`LOGIN` vs `AUTH`) | Taxonomia poluída | Constraint unique + Alpha obrigado a passar lista existente; `proposedModuleName` requer aprovação manual do PM |
| `area` mal classificada pelo Alpha | Filtros inúteis | `mixed` e `null` aceitos; validação manual em sample pós-rollout |
| Story refinada que nunca entra em sprint | Backlog inflado | Alerta 14 dias (questão 8.3) |
| Story `tasks_complete` permanente (PM esquece de validar AC) | Burndown errado | Notificação automática 24h após `tasks_complete` |
| Refinement state vira ritual burocrático | Atrito desnecessário | Default `draft → refined` é 1 clique; não exige formulário longo |
| `referenceKey` de projetos existentes mal escolhido (renomear depois é dor) | Histórico inconsistente | Backfill manual com PM no loop (questão 8.2) |
| Trigger de seed de personas falha silenciosamente | Projeto novo sem personas → bloqueia Alpha | Teste de migration cobre INSERT em `Project` + verifica 3 rows em `ProjectPersona` |
| Builder marca AC validado em produção (escapa do gatekeeping) | Story falsamente "done" | RLS strict em `UserStory.acValidatedAt`/`acValidatedBy` (questão 8.1) |

---

## 11. Métricas de sucesso

- ≥ 90% das stories novas (pós-rollout) têm `moduleId` correto sem PM corrigir
- ≥ 95% das stories têm `personaId` correto sem PM corrigir
- 0 stories com 0 AC em produção
- 0 stories `done` sem `acValidatedAt`
- Tempo médio de `tasks_complete` → `done`: meta < 48h (PM valida AC rápido)
- Tempo de onboarding novo PM no Zordon: hoje N → meta N–30%

---

## 12. Referências

- Mike Cohn, *User Stories Applied for Agile Software Development* (2004) — Theme vs Epic, persona-as-role, INVEST
- Mike Cohn, *Agile Estimating and Planning* (2005)
- SAFe Framework — Portfolio Epic (referência do que **NÃO** queremos)
- Capacity model atual: `docs/capacity-model.md`
- Design Session PRD: `docs/prd-design-session.md`
- Sprint delivery model: memória `project_sprint_delivery_model.md`
- Migração de dados: `docs/story-hierarchy-migration.md` (a criar quando entrar em execução)
