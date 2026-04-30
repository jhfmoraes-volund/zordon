# Story Hierarchy — Integração com Alpha (agente)

**Status:** plano de execução
**Data:** 2026-04-30
**Autor:** João + Alpha
**Escopo:** atualizar o agente Alpha pra trabalhar com a nova hierarquia (Module / UserStory / Task / AcceptanceCriterion). Cobre prompt, output schema, persistência e calibração.
**Pré-requisitos:**
- Fases 1-4 do [story-hierarchy-migration.md](./story-hierarchy-migration.md) executadas (schema + DAL + API).
- Fase 5 (page nova) **opcional** — Alpha grava direto via API e independe da UI.

**Documentos relacionados:**
- [story-hierarchy-plan.md](./story-hierarchy-plan.md) — V2 do schema-alvo
- [story-hierarchy-migration.md](./story-hierarchy-migration.md) — plano principal de migração
- [story-hierarchy-backfill.md](./story-hierarchy-backfill.md) — backfill de projetos legados
- [alpha-calibration-plan.md](./alpha-calibration-plan.md) — calibração geral do Alpha
- [project_alpha_agent.md](../../../.claude/projects/-Users-joaomoraes-projetos-ai-dev-Perke-perke-volund/memory/project_alpha_agent.md) — contexto do agente

---

## 0. Princípios

1. **Alpha classifica, não inventa taxonomia.** Recebe `modules` e `personas` do projeto e escolhe um. Só sugere novos via `proposedModuleName`.
2. **PM continua sendo gatekeeper.** Outputs do Alpha entram em `refinementStatus = 'draft'`. PM revisa antes de virar `refined`/`committed`.
3. **Persistência atomic.** UserStory + AC + Tasks vinculadas criados em transação única. Falha = rollback completo.
4. **Calibração obrigatória.** 5/5 cenários corretos antes de habilitar pro time.

---

## 1. Arquitetura — onde mexer

```
Alpha hoje:
  - Engine em src/lib/agent/ (motor genérico)
  - Definition em alpha-definition (prompt + tools + zod schemas)
  - Triggers: design-sessions, chat web, telegram

Mexer aqui:
  ├── Contexto que entra no prompt
  ├── Output schema (Zod)
  ├── System prompt (regras)
  ├── Persistência (RPC ou múltiplas chamadas DAL)
  └── Testes de calibração
```

> Convenção do agente vive na memória `project_alpha_agent`. Não renomear infra/cloudbuild — mexemos só na lógica.

---

## 2. Contexto do prompt

### 2.1 Hoje

Alpha já recebe contexto do projeto + members. Adicionar:

```ts
{
  // já existe
  project: {
    id: string;
    name: string;
    referenceKey: string;        // novo, populado após Fase 7 do backfill
    definitionOfDone: string[];  // novo
  },
  members: { id, name, role, seniority, dedicationPercent, fpCapacity }[],

  // novo
  modules: {
    id: string;
    name: string;        // ex: "LOGIN"
    description: string;
  }[],

  personas: {
    id: string;
    name: string;        // ex: "Builder", "Cliente"
    description: string;
  }[],

  // novo — anti-duplicação
  recentStories: {
    reference: string;   // ex: "CRM-US-014"
    title: string;
    moduleId: string | null;
    refinementStatus: 'draft' | 'refined' | 'committed';
  }[],
}
```

**`recentStories`**: últimas 20 stories do projeto. Serve pra Alpha **não duplicar** — se "magic-link com expiração" já existe, não cria de novo.

### 2.2 Fonte dos dados

Server-side, antes de invocar o Alpha:

```ts
import {
  getModulesForProject,
  getPersonasForProject,
} from "@/lib/dal/story-hierarchy";

const [modules, personas, recentStories] = await Promise.all([
  getModulesForProject(projectId),
  getPersonasForProject(projectId),
  getRecentStoriesForProject(projectId, { limit: 20 }),
]);
```

`getRecentStoriesForProject` é helper novo — adicionar ao DAL.

### 2.3 Quando popular o contexto

Em todos os pontos de entrada do Alpha que podem gerar story:
- **Design Session → Alpha extrai feature** (canal principal)
- **Chat web** (`/ops/...` quando usuário pede "crie uma user story pra X")
- **Telegram** (mesmo fluxo)

Pontos que NÃO precisam: Alpha respondendo perguntas sem criar nada (status, métricas).

---

## 3. Output schema (Zod)

### 3.1 Schema completo

```ts
// src/lib/agent/alpha/output-schemas.ts (ou onde os schemas vivem)

import { z } from "zod";

const acceptanceCriterion = z.object({
  text: z.string().min(5).max(500),
});

const taskOutput = z.object({
  title: z.string().min(5).max(120),
  description: z.string().nullable(),
  type: z.enum([
    'feature',
    'bugfix',
    'refactor',
    'setup',
    'component',
    'seed',
    'management',
  ]),
  scope: z.enum(['micro', 'small', 'medium', 'large']),
  complexity: z.enum(['trivial', 'low', 'medium', 'high']),
  area: z.enum(['front', 'back', 'infra', 'ops', 'mixed']).nullable(),
  // FP é opcional — server preenche via matriz scope×complexity se vier null
  functionPoints: z.number().int().min(1).max(50).nullable(),
  acceptanceCriteria: z.array(acceptanceCriterion).min(1).max(10),
});

export const userStoryOutput = z.object({
  // Module: ou referência existente OU proposta nova (mutex)
  moduleId: z.string().uuid().nullable(),
  proposedModuleName: z.string()
    .regex(/^[A-Z][A-Z0-9_]*$/, "Uppercase + underscore")
    .nullable(),

  // Persona: obrigatória, sempre da lista
  personaId: z.string().uuid(),

  title: z.string().min(5).max(120),
  want: z.string().min(5).max(500),
  soThat: z.string().nullable(),
  acceptanceCriteria: z.array(acceptanceCriterion).min(1).max(8),

  tasks: z.array(taskOutput).min(1).max(15),

  // Origem (preenchida pelo caller, não pelo Alpha)
  designSessionId: z.string().uuid().optional(),
  designSessionItemId: z.string().uuid().optional(),
}).refine(
  (data) =>
    (data.moduleId !== null && data.proposedModuleName === null) ||
    (data.moduleId === null && data.proposedModuleName !== null),
  { message: "moduleId XOR proposedModuleName" }
);

export const alphaStoryGenerationOutput = z.object({
  stories: z.array(userStoryOutput).min(1).max(10),
  /** Curta justificativa da escolha de modules/personas, debug. */
  reasoning: z.string().optional(),
});

export type AlphaStoryGenerationOutput = z.infer<typeof alphaStoryGenerationOutput>;
```

### 3.2 Decisões nos limits

| Field | Limit | Por quê |
|---|---|---|
| `tasks.min(1).max(15)` | 1-15 | Story sem task não faz sentido. > 15 vira spike — quebrar em 2 stories. |
| `acceptanceCriteria.min(1)` | ≥ 1 | Story sem AC é story incompleta. Bloqueia output ruim. |
| `stories.min(1).max(10)` | 1-10 por chamada | DS típica gera 3-7. > 10 sugere extração mal calibrada. |
| `functionPoints.nullable()` | aceita null | Server preenche via `suggestFunctionPoints(scope, complexity)` se vier null. |

---

## 4. System prompt — regras

Adicionar à seção de instruções do Alpha (definition):

```
Você ajuda a transformar conversas e Design Sessions em UserStories executáveis.

REGRAS:

1. CLASSIFICAÇÃO DE MÓDULO
   - Você recebe `modules` (lista do projeto).
   - SEMPRE escolha um module existente se a story cabe num.
   - Se NENHUM module existente cabe, deixe `moduleId: null` e proponha
     `proposedModuleName` em UPPERCASE_SNAKE (ex: "AUDIT_LOG", "REPORTS").
   - PM aprovará o novo module antes da story virar oficial.

2. PERSONA
   - Você recebe `personas` (lista do projeto).
   - VOCÊ NUNCA INVENTA persona. Sempre use o id de uma da lista.
   - Se nenhuma persona da lista cabe, **pare** e responda ao usuário pedindo
     pra criar a persona apropriada antes. NÃO chute.

3. NARRATIVA
   - `title`: imperativo, curto. Ex: "Magic-link com expiração curta".
   - `want`: começa com verbo. Ex: "receber link de login que expira em 10 min".
   - `soThat`: o "porquê" do negócio. Opcional só se óbvio.
   - Formato final na UI: "Como {persona}, quero {want}, para que {soThat}."

4. ACCEPTANCE CRITERIA (story-level)
   - 1-8 critérios verificáveis e específicos.
   - Foco em comportamento de NEGÓCIO ("usuário consegue X"), não técnico.
   - Mau: "implementa endpoint REST". Bom: "Reusar link expirado mostra mensagem clara".

5. TASKS
   - Quebre em tasks atômicas: 1-15 por story.
   - Cada task: title verbal, area apropriada, AC técnico próprio (1-10).
   - AC de task = aceitação técnica ("retorna 410 Gone com message"); AC de
     story = aceitação de negócio.
   - `area`: front/back/infra/ops para tasks específicas. `mixed` quando
     genuinamente cross-cutting. `null` apenas para spikes/docs/exploração.
   - `type`: classifica intent (feature/bugfix/refactor/setup/component/seed/management).
   - `scope` × `complexity`: matriz pra estimar FP. Se incerto, deixe FP null —
     server calcula.

6. ANTI-DUPLICAÇÃO
   - Você recebe `recentStories` (últimas 20 do projeto).
   - Antes de criar, verifique se já existe story similar.
   - Se sim, mencione no `reasoning` e NÃO crie duplicata. Sugira reutilizar
     ou estender a existente.

7. REFINEMENT STATUS
   - Toda story que você gera entra como `draft`. PM marca como `refined`
     após revisão. Nunca pule pra `committed` direto.

8. EM CASO DE AMBIGUIDADE
   - Se o input do usuário é ambíguo (ex: "fazer o login melhor"), pergunte
     antes de gerar. Não gere stories vagas.
```

---

## 5. Persistência

### 5.1 Estratégia: RPC SQL única (recomendado)

Função SQL transactional que aceita o output do Alpha e cria tudo atomicamente.

```sql
-- supabase/migrations/20260520_create_story_with_tasks_rpc.sql

CREATE OR REPLACE FUNCTION create_user_story_with_tasks(
  p_project_id     uuid,
  p_input          jsonb,
  p_created_by     uuid,
  p_by_agent       boolean DEFAULT true
)
RETURNS TABLE (
  story_id        uuid,
  story_reference text
) AS $$
DECLARE
  v_story_id    uuid;
  v_reference   text;
  v_task_id     uuid;
  v_task_ref    text;
  v_task        jsonb;
  v_ac          jsonb;
BEGIN
  -- 1. Reservar reference
  v_reference := next_user_story_reference(p_project_id);

  -- 2. Inserir UserStory
  INSERT INTO "UserStory" (
    "projectId", "moduleId", "proposedModuleName", reference,
    title, "personaId", want, "soThat",
    "refinementStatus",
    "designSessionId", "designSessionItemId",
    "createdByAgent", "createdById"
  )
  VALUES (
    p_project_id,
    NULLIF(p_input->>'moduleId', '')::uuid,
    NULLIF(p_input->>'proposedModuleName', ''),
    v_reference,
    p_input->>'title',
    (p_input->>'personaId')::uuid,
    p_input->>'want',
    NULLIF(p_input->>'soThat', ''),
    'draft',
    NULLIF(p_input->>'designSessionId', '')::uuid,
    NULLIF(p_input->>'designSessionItemId', '')::uuid,
    p_by_agent,
    p_created_by
  )
  RETURNING id INTO v_story_id;

  -- 3. AC da story
  FOR v_ac IN SELECT * FROM jsonb_array_elements(p_input->'acceptanceCriteria')
  LOOP
    INSERT INTO "AcceptanceCriterion" ("userStoryId", text, "order")
    VALUES (
      v_story_id,
      v_ac->>'text',
      (v_ac->>'order')::int
    );
  END LOOP;

  -- 4. Tasks + AC de cada task
  FOR v_task IN SELECT * FROM jsonb_array_elements(p_input->'tasks')
  LOOP
    v_task_ref := next_task_reference();

    INSERT INTO "Task" (
      id, "projectId", "userStoryId", reference, title, description,
      status, type, scope, complexity, area, "functionPoints",
      billable, "createdByAgent", "createdById",
      "updatedAt"
    ) VALUES (
      gen_random_uuid(), p_project_id, v_story_id, v_task_ref,
      v_task->>'title',
      NULLIF(v_task->>'description', ''),
      'backlog',
      v_task->>'type',
      v_task->>'scope',
      v_task->>'complexity',
      NULLIF(v_task->>'area', ''),
      COALESCE(
        (v_task->>'functionPoints')::int,
        suggest_fp(v_task->>'scope', v_task->>'complexity')
      ),
      true,
      p_by_agent,
      p_created_by,
      now()
    )
    RETURNING id INTO v_task_id;

    FOR v_ac IN SELECT * FROM jsonb_array_elements(v_task->'acceptanceCriteria')
    LOOP
      INSERT INTO "AcceptanceCriterion" ("taskId", text, "order")
      VALUES (
        v_task_id,
        v_ac->>'text',
        (v_ac->>'order')::int
      );
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_story_id, v_reference;
END;
$$ LANGUAGE plpgsql;
```

> **Pré-requisito:** função `suggest_fp(scope, complexity)` em SQL espelhando `FP_MATRIX_DEFAULT` em `src/lib/function-points.ts`. Migration auxiliar:
>
> ```sql
> CREATE OR REPLACE FUNCTION suggest_fp(p_scope text, p_complexity text)
> RETURNS int AS $$
> BEGIN
>   RETURN CASE p_scope
>     WHEN 'micro' THEN
>       CASE p_complexity WHEN 'trivial' THEN 3 WHEN 'low' THEN 4 WHEN 'medium' THEN 5 WHEN 'high' THEN 7 ELSE 5 END
>     WHEN 'small' THEN
>       CASE p_complexity WHEN 'trivial' THEN 4 WHEN 'low' THEN 5 WHEN 'medium' THEN 7 WHEN 'high' THEN 10 ELSE 7 END
>     WHEN 'medium' THEN
>       CASE p_complexity WHEN 'trivial' THEN 5 WHEN 'low' THEN 7 WHEN 'medium' THEN 10 WHEN 'high' THEN 15 ELSE 10 END
>     WHEN 'large' THEN
>       CASE p_complexity WHEN 'trivial' THEN 7 WHEN 'low' THEN 10 WHEN 'medium' THEN 15 WHEN 'high' THEN 21 ELSE 15 END
>     ELSE 7
>   END;
> END;
> $$ LANGUAGE plpgsql IMMUTABLE;
> ```

### 5.2 Caller (TS)

```ts
// src/lib/agent/alpha/persist-stories.ts

import { createClient } from "@/lib/supabase/server";
import type { AlphaStoryGenerationOutput } from "./output-schemas";

export async function persistAlphaStories(
  projectId: string,
  output: AlphaStoryGenerationOutput,
  createdBy: string,
  context?: { designSessionId?: string },
): Promise<{ storyId: string; reference: string }[]> {
  const supabase = await createClient();
  const results = [];

  for (const story of output.stories) {
    const input = {
      ...story,
      designSessionId: context?.designSessionId,
    };

    const { data, error } = await supabase.rpc(
      "create_user_story_with_tasks",
      {
        p_project_id: projectId,
        p_input: input,
        p_created_by: createdBy,
        p_by_agent: true,
      },
    );
    if (error) throw error;
    if (!data?.[0]) throw new Error("RPC returned empty");

    results.push({
      storyId: data[0].story_id,
      reference: data[0].story_reference,
    });
  }

  return results;
}
```

**Atomicity por story.** Se a 3ª story falha, as 2 anteriores já foram persistidas. PM vê parcial. Aceitável — alternativa (transação ao redor das N stories) prende mais.

### 5.3 Estratégia alternativa: TS sem RPC

Mais simples, sem migration extra, mas não-atomic:

```ts
for (const story of output.stories) {
  const ref = await rpc("next_user_story_reference", { p_project_id: projectId });
  const inserted = await supabase.from("UserStory").insert({...}).select();
  await supabase.from("AcceptanceCriterion").insert(story.acceptanceCriteria.map(...));
  for (const task of story.tasks) {
    const taskRef = await rpc("next_task_reference");
    const t = await supabase.from("Task").insert({...}).select();
    await supabase.from("AcceptanceCriterion").insert(task.acceptanceCriteria.map(...));
  }
}
```

**Quando usar:** só na fase de sandbox/calibração. Prod usa RPC pra atomicidade real.

---

## 6. Calibração

### 6.1 Cenários de teste

Antes de habilitar pra qualquer projeto real, validar 5 cenários cobrindo o espectro:

| # | Input | Output esperado |
|---|---|---|
| 1 | DS com 1 feature simples ("login com email") | 1 story em `LOGIN`, persona `Builder`, 2-3 tasks |
| 2 | DS com 1 feature complexa ("checkout completo") | 1 story em `BILLING`, 5-8 tasks distribuídas em areas |
| 3 | DS com módulo novo ("auditoria") | 1 story com `moduleId: null` + `proposedModuleName: "AUDIT_LOG"` |
| 4 | Chat: "como tá o login?" (não pede criar) | Resposta narrativa, sem stories no output |
| 5 | DS ambígua ("melhorar dashboard") | Alpha PERGUNTA, não gera |

Cada um:
- Roda 3× pra validar consistência.
- PM revisa output: módulo correto? persona correta? AC verificáveis? FP coerente?
- Erro > 10% em qualquer cenário = ajustar prompt e rerodar.

### 6.2 Localização dos casos de teste

```
docs/alpha-calibration-results.md  ← já existe
```

Adicionar seção `## Story hierarchy v2` com os 5 cenários acima + outputs documentados.

### 6.3 Regression suite (futuro)

Quando estabilizar, virar script em `scripts/alpha-regression.ts` que roda os 5 inputs e compara com fixtures. Roda em CI ou pré-deploy do Alpha. Fora de escopo desta primeira entrega.

---

## 7. Rollout

| Etapa | Ação |
|---|---|
| 1 | Migration `suggest_fp` + `create_user_story_with_tasks` (`20260520_*.sql`) |
| 2 | Output schema + persistência (PR no codebase do Alpha) |
| 3 | System prompt update (PR separado, fácil de reverter) |
| 4 | Calibração no `/dev` ou em projeto-piloto com flag ON |
| 5 | Habilitar pra projetos reais conforme backfill avança |

**Feature flag:** Alpha respeita `Project.useStoryHierarchy`. Se OFF, **não cria stories** — fallback pro fluxo antigo (criação direta de tasks com `userStoryId: null`).

```ts
const project = await getProject(projectId);
if (!project.useStoryHierarchy) {
  // Modo legacy: cria tasks soltas (como hoje)
  return createTasksLegacy(...);
}
return persistAlphaStories(...);
```

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Alpha gera lista vazia de tasks (story órfã) | Zod `min(1)` no output bloqueia. Falha fail-fast. |
| Persona ID inválido (não pertence ao projeto) | RPC valida via FK; insert falha. Adicionar validação na caller TS antes pra mensagem amigável. |
| Stories duplicadas em sessões consecutivas | `recentStories` no contexto + regra anti-dup no prompt; PM pode deletar manualmente se escapar. |
| RPC retorna erro silencioso | Sempre `throw` em `error`, log estruturado. |
| Module proposto polui taxonomia | `moduleId NULL + proposedModuleName` força aprovação manual antes de virar Module real. |
| Calibração falsamente positiva (cenários poucos) | Após 1 mês, revisar saídas reais e expandir suite com casos não previstos. |

---

## 9. Métricas

Após 30 dias de uso real:

- ≥ 90% das stories geradas pelo Alpha com `moduleId` correto (não null e PM não muda)
- ≥ 95% das stories com `personaId` correto
- 0 stories com `acceptanceCriteria` vazio
- ≤ 5% de stories rejeitadas pelo PM (motivos: redundância, escopo errado, AC fraco)
- Tempo médio de Design Session → stories `committed`: meta < 2 dias

---

## 10. Decisões abertas

1. **Atomicity granular vs por-story:** transação ao redor de N stories falha tudo se 1 quebra. Atomicity por-story permite parcial. Recomendo **por-story** + log de falhas.

2. **Fallback quando persona não cabe:** Alpha pergunta ou Alpha cria persona automaticamente "tentativa"? Recomendo **pergunta**. Personas são poucas, criação inflate taxonomia.

3. **Quem aprova o `proposedModuleName`?** RLS da `UserStory` permite só PM/Admin atualizar `moduleId`. UI bloqueia builder. Confirmar.

4. **Alpha cria com `refinementStatus: 'refined'` direto?** Não — sempre `draft`. PM marca refined. Mantém gatekeeping mesmo que Alpha gere "perfeitamente".

5. **Histórico de prompts/outputs:** salvamos em `AgentUsage` (já existe) ou criamos `StoryGenerationLog`? Recomendo **AgentUsage existente** com payload incluindo `storiesCreated: [{reference, moduleId, ...}]`. Reusa infra.
