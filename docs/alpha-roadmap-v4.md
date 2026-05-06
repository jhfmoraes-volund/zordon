---
title: Alpha — Roadmap V4 (executado + próximas ondas)
status: vigente · supersede V3 (V3 vira histórico)
last_updated: 2026-05-05
---

# Alpha — Roadmap V4

V3 foi o **plano**. V4 é o **runbook vigente** — reflete o que foi executado, o que está faltando e o que mudou depois das descobertas em campo.

**Princípio orientador (mantido da V3):** reusar plumbing antes de criar, calibrar antes de empilhar prompt, ship pequeno + piloto antes de empilhar fases.

---

## 0. Estado atual (snapshot 2026-05-05)

### O que está em prod hoje

- **Alpha** (modelo: `anthropic/claude-haiku-4.5` per-agent override) — usado por PMs pra inspecionar sprint/capacity, criar task ocasional, conduzir reuniões pm_review/daily/super_planning.
- **Vitor** (Sonnet 4.6 default) — agente de design session, intacto.

### O que foi entregue na Fase 1 (ondas 1.1 a 1.6)

| Onda | Entregue |
|---|---|
| 1.1 | Wrappers Alpha-only em [src/lib/agent/tools/alpha-hierarchy.ts](src/lib/agent/tools/alpha-hierarchy.ts) — 9 tools (list/get/create/update story, AC, módulo, persona) |
| 1.2 | Registro no Alpha em [agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts) — gated por `routeProjectId` + `writeTools` |
| 1.3 | Context loader em [agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts) — bloco "Taxonomia" (counts + nomes) no `buildProjectFocus` |
| 1.4 | Prompt em [agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts) — seção "Hierarquia" com 11 regras (incluindo regra 9b confirmação 2 turnos e regra 10 anti-alucinação) |
| 1.5a | Per-agent model override em `AgentDefinition.model` — Alpha em Haiku 4.5 (~10x mais barato que Sonnet) |
| 1.5b | Calibração 8 cenários × 3 runs (24 invocações) — [docs/alpha-calibration-fase1.md](docs/alpha-calibration-fase1.md) |
| 1.6 | (em progresso) Smoke E2E + ship Zordon |

**Métricas da calibração Fase 1:**
- 0 alucinações graves em 24 runs
- 0 criações acidentais (regra 9b sólida)
- 0 negações de entidade existente (regra 10 sólida)
- 15/24 ✅ estrito + 9/24 ⚠️ (Haiku conservador, mas correto)

### Auditoria adicional descoberta após calibração

[docs/alpha-audit-contrato.md](docs/alpha-audit-contrato.md) — investigou se Alpha entende o vocabulário "contrato" usado na UI Volund (`/members/[id]` chama `ProjectMember.fpAllocation` de "contrato").

| Cenário | Resultado |
|---|---|
| C1 — "qual o contrato do João?" | ✅ acertou (mapeou pra fpAllocation) |
| C2 — "vamos entregar dentro do contrato?" | ❌ alucinou modelo de escopo total + perguntou data/MVP |
| C3 — "aumenta o contrato do João pra 400" | ✅ acertou + pediu clarificação correta |

**Implicação:** Alpha tem inconsistência semântica com "contrato" — acerta quando vem com nome de pessoa, alucina quando vem com nome de projeto. Fix é 1 parágrafo no prompt. **Bloqueador de ship limpo** porque "vamos entregar dentro do contrato?" é pergunta natural do Head Ops.

---

## 1. Plano V4 — 5 ondas restantes

| Onda | Escopo | Tempo | Quando |
|---|---|---|---|
| **1.7** | Polimento de prompt — vocabulário "contrato" + apertar regra 10 | 1h | **Antes do ship Fase 1** |
| **1.8** | Smoke E2E na UI + commit + ship Zordon | 1h | Depois de 1.7 |
| **2** | Sprint Planner Mode — bulk RPC + tools + prompt (story-coherent + anti-editorialize + error recovery) + calibração 10 cenários | 11h | Depois de 1 semana piloto |
| **2.5** | Velocity histórica (opcional) | 1-2h | Após Fase 2, se PM pedir |
| **3** | Rollout + observability — kill switch + AgentQualityLog + dashboard | 4h | Após Fase 2 estabilizar |

**Total restante: ~18h spread em 3-4 semanas com piloto entre fases.**

**Decisão arquitetural pendente — confirmada 2026-05-05:** validação de regras de negócio (ex: "João só faz backend") fica **no Alpha + revisão do PM**, não na RPC. RPC valida apenas integridade de banco. PM lê proposta em texto e corrige antes do bulk rodar. Custo de modelar `Member.specialty → Task.type` no Postgres só vale a pena depois que padrão de uso real estabilizar.

---

## 2. Onda 1.7 — Polimento de prompt (1h)

**Objetivo:** fechar gaps de vocabulário descobertos na auditoria de "contrato" antes do ship.

### 2.1 Adicionar seção "Vocabulário operacional" no prompt

**Arquivo:** [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts)

Após a seção "Hierarquia" e antes de "Suas ferramentas", inserir:

```
---

## Vocabulário operacional (UI ↔ schema)

A UI da Volund e o time usam termos que mapeiam pra entidades técnicas. Você precisa
**ouvir o vocabulário humano e traduzir pro técnico** sem pedir o termo certo.

### "Contrato" = ProjectMember.fpAllocation

A página `/members/[id]` chama `ProjectMember.fpAllocation` de **"contrato"**.
"O contrato do João no Zordon" = quanto FP/sprint João dedica a Zordon (ex: 300).

**NÃO existe entidade "contrato do projeto" como escopo total vendido.**
Volund vende capacidade humana por sprint, não pacote fechado de FP.

Mapeamentos:
- "qual o contrato do {membro}" → fpAllocation desse membro neste projeto (use `get_allocated_project_members`)
- "aumenta/diminui o contrato do {membro}" → `set_project_allocation` (todo o projeto) ou `set_sprint_allocation` (sprint específico)
- "dentro do contrato" → respeitando a soma de fpAllocation por sprint (= `sprint_capacity_overview.capacity`)
- "vai estourar o contrato?" → o backlog cabe nas próximas N sprints considerando capacity por sprint?

**NUNCA pergunte:** "qual a data do contrato?", "qual o escopo total contratado?", "qual o MVP?" — não existem como dados.

### "Bateria" = capacidade do membro

`Member.fpCapacity` (capacidade total) menos soma de `ProjectMember.fpAllocation` (committed) = restante (livre).
"Bateria do João" = 500 cap - 300 committed = 200 livre.
Use `get_member_commitments` ou direto do bloco `## Bateria por membro` no contexto.

### "Squad" = ProjectMembers do projeto

Use `get_allocated_project_members` — UNION de PM + ProjectMembers, com flag `isPM`.
```

### 2.2 Apertar regra 10 (anti-alucinação)

Editar a regra 10 existente, adicionando exemplo concreto:

```
10. **ANTI-ALUCINAÇÃO (regra dura, derivada da auditoria 2026-05-05)** — quando o usuário cita uma entidade que **você não vê listada no contexto**, você **NUNCA** afirma que ela não existe. Fluxo correto:
    - Primeiro **chame a tool de leitura**: `list_modules`, `list_personas`, `list_stories`, ou `get_story` (com a reference exata).
    - Se a tool retornar vazio: diga "não encontrei `X` — confirma a referência ou me passa o título?".
    - **NUNCA** diga "essa referência não existe no sistema" sem ter checado.
    - **NUNCA** use a ausência da entidade no contexto como prova de inexistência. O contexto é parcial.
    - **Atenção especial pra módulos:** se um nome de módulo aparece no contexto operacional ou em discussão, mas **não está na resposta de `list_modules`**, ele NÃO existe. Não trate como "existente mas não listado" ou "pendente de aprovação". Trate como inexistente — proponha criar via `proposedModuleName`.
    - **Não confunda `Task.status`** (`backlog/todo/in_progress/review/done`) **com `UserStory.refinementStatus`** (`draft/refined/committed`). São lifecycles diferentes em entidades diferentes.
```

### 2.3 Recalibrar (3 runs por cenário, ~15min)

Rodar contra **mesma régua dos cenários C1, C2, C3** da [auditoria de contrato](docs/alpha-audit-contrato.md):

```bash
export ALPHA_MEMBER="dc4d91f5-0d29-453a-b11e-d42dd6a7b158"
export ALPHA_PROJECT="6f9b7443-547e-418e-b0a5-6f3bb38d762f"

for i in 1 2 3; do
  for prompt in \
    "qual o contrato do João nesse projeto?" \
    "vamos conseguir entregar Zordon dentro do contrato?" \
    "aumenta o contrato do João pra 400"; do
    npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
      --member-id "$ALPHA_MEMBER" --new-thread \
      --current-path "/projects/$ALPHA_PROJECT" \
      --message "$prompt"
  done
done
```

**Régua nova de C2** ("entregar dentro do contrato?"):
- ✅ Lê capacity por sprint (sprint_capacity_overview ou get_sprint_capacity)
- ✅ Lê backlog (FP total)
- ✅ Calcula "cabe em N sprints"
- ❌ **NÃO** pergunta "qual a data do contrato?"
- ❌ **NÃO** pede "escopo total" ou "MVP"

**Gate:** ≥ 2/3 nos 3 cenários. Se C2 ainda alucinar, apertar prompt mais.

### 2.4 Gate de ship

```bash
bunx tsc --noEmit
```

Sem erros + recalibração C1/C2/C3 ≥ 2/3 = OK pra ship.

---

## 3. Onda 1.8 — Smoke E2E + ship Zordon (1h)

### 3.1 Smoke manual na UI

Em projeto Zordon real:
1. Abrir chat Alpha em `/projects/<zordonId>`
2. Testar: "criar story 'audit log dos eventos do agente'" → confirma → checa banco
3. Testar: "qual o contrato do João nesse projeto?" → resposta correta
4. Testar: "lista as personas" → 4 personas reais
5. Testar (sanity): "como tá o sprint?" → sem regressão

### 3.2 Commit incremental

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: alpha — fase 1 hierarchy (wrappers + prompt + Haiku per-agent + vocab contrato)"
```

### 3.3 Piloto de 1 semana

Head Ops e PMs usam Alpha normalmente em projetos reais. Recolher feedback. Antes de iniciar Fase 2:
- ≥ 80% PM-satisfaction → segue Fase 2.
- 60-80% → 1 semana de iteração no prompt antes.
- < 60% → revisita classificação.

---

## 4. Onda 2 — Sprint Planner Mode (10h)

**Pré-condição:** Fase 1 em prod 1+ semana sem regressão.

### 4.1 Onda 2.1 — RPC `bulk_update_tasks` (2h)

**Migration:** template é [`task_acceptance_bulk_diff`](supabase/migrations/20260501_ac_bulk_diff_rpc.sql).

```sql
CREATE OR REPLACE FUNCTION bulk_update_tasks(
  p_project_id uuid,
  p_updates jsonb,    -- [{taskRef, sprintId?, assigneeIds?, status?}]
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  upd jsonb;
  v_task_id uuid;
  v_assignee_ids uuid[];
  v_results jsonb := '[]'::jsonb;
BEGIN
  -- Validar actor é manager+ no projeto
  IF NOT EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    JOIN "Member" m ON m.id = pm."memberId"
    WHERE pm."projectId" = p_project_id
      AND pm."memberId" = p_actor_id
      AND m.role IN ('cro','head-ops','pm','principal-engineer','ceo')
  ) THEN
    RAISE EXCEPTION 'Actor sem permissão de planejamento neste projeto';
  END IF;

  FOR upd IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    SELECT id INTO v_task_id
    FROM "Task"
    WHERE reference = upd->>'taskRef' AND "projectId" = p_project_id;
    IF v_task_id IS NULL THEN
      RAISE EXCEPTION 'Task % não encontrada no projeto', upd->>'taskRef';
    END IF;

    IF upd ? 'sprintId' AND upd->>'sprintId' IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM "Sprint"
        WHERE id = (upd->>'sprintId')::uuid AND "projectId" = p_project_id
      ) THEN
        RAISE EXCEPTION 'Sprint % não pertence ao projeto', upd->>'sprintId';
      END IF;
    END IF;

    UPDATE "Task" SET
      "sprintId" = CASE
        WHEN upd ? 'sprintId' THEN NULLIF(upd->>'sprintId', '')::uuid
        ELSE "sprintId"
      END,
      status = CASE
        WHEN upd ? 'status' THEN upd->>'status'
        ELSE status
      END,
      "updatedAt" = now()
    WHERE id = v_task_id;

    IF upd ? 'assigneeIds' THEN
      DELETE FROM "TaskAssignment" WHERE "taskId" = v_task_id;
      v_assignee_ids := ARRAY(SELECT jsonb_array_elements_text(upd->'assigneeIds'))::uuid[];
      INSERT INTO "TaskAssignment" ("taskId", "memberId")
      SELECT v_task_id, m_id
      FROM unnest(v_assignee_ids) m_id
      WHERE EXISTS (
        SELECT 1 FROM "ProjectMember"
        WHERE "projectId" = p_project_id AND "memberId" = m_id
      );
    END IF;

    v_results := v_results || jsonb_build_object('taskRef', upd->>'taskRef', 'ok', true);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', jsonb_array_length(v_results), 'results', v_results);
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_tasks(uuid, jsonb, uuid) TO authenticated, service_role;
```

**Aplicar:**
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<DATE>_bulk_update_tasks.sql
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```

### 4.2 Onda 2.2 — Tools planner (2h)

Em [agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts), adicionar:

- **`get_project_capacity`** — 1 chamada → members (cap/committed/remaining/projectAllocation) + sprints (cap/planejado/disponível).
- **`list_unplanned_tasks`** — backlog ready (status='backlog' AND userStoryId IS NOT NULL AND functionPoints IS NOT NULL), com filtro opcional por moduleId.
- **`bulk_update_tasks`** — gated `writeTools`, chama RPC, loga em AgentUsage.

### 4.3 Onda 2.3 — Gate condicional planner mode (1h)

**Princípio (≠ V3 que era automático):** carregar bloco "planner capacity" só se intent + estado batem.

Em `buildProjectFocus`:
```ts
const plannerHints = ['organiz', 'aloca', 'planej', 'sprint', 'capacity', 'cabe', 'distribu', 'priori'];
const plannerIntent = plannerHints.some(h => userMessage.toLowerCase().includes(h));

const hasReadyBacklog = backlogReady.taskCount >= 10;
const hasBuilders = members.some(m => m.fpAllocation > 0);

if (plannerIntent && hasReadyBacklog && hasBuilders) {
  focusBlock += renderPlannerCapacityBlock(snapshot, members, sprints);
}
```

**Mas:** [agents/alpha/index.ts:18](src/lib/agent/agents/alpha/index.ts#L18) precisa passar `userMessage` adiante, hoje `buildOpsContext` não recebe. Pequena refatoração.

### 4.4 Onda 2.4 — Prompt "Sprint Planning" (1h)

Adicionar em [prompt.ts](src/lib/agent/agents/alpha/prompt.ts), após "Hierarquia":

```
## Sprint Planning

Quando aparece o bloco "Capacidade do projeto (planning mode)" no contexto, você atua como sprint planner.

### Fluxo obrigatório

1. **PERGUNTAS ANTES DE PROPOR (regra dura)**
Antes de qualquer alocação, faça estas 4 perguntas em UMA mensagem:
   a. "Tem preferência de quem pega o quê? (Ex: Lucas só backend, João full-stack.)"
   b. "Quer priorizar algum module/feature primeiro?"
   c. "Algum builder fora do ar / com capacidade reduzida em algum sprint?"
   d. "Quer cobrir todo o backlog ou só os próximos N sprints?"
NUNCA chute essas. Pergunte.

2. **DIMENSIONAMENTO**
Calcule: total_fp_backlog ÷ capacidade_efetiva_por_sprint = sprints_necessários.
Se sprints_necessários > sprints_existentes, **proponha criar** os que faltam via `create_sprint`.
Sprints são seg→dom, 7 dias, sequenciais (CHECK no DB trava).

3. **RESPEITO DE CAPACIDADE (= CONTRATO)**
"Capacidade por sprint" do projeto = soma de `fpAllocation` dos ProjectMembers (que a UI chama de "contrato").
- Soma de FP por (member, sprint) ≤ allocation efetiva (com overrides de SprintMember se houver).
- Se não cabe, NUNCA force. Empurre tasks pro próximo sprint.
- Se cap total < backlog mesmo com todos os sprints planejados, alerte:
  "Backlog ultrapassa capacidade total — falta um builder ou sprint adicional?"

4. **SEGMENTAÇÃO POR ASSIGNEE**
- Você não conhece skill por task. Use SÓ o que o PM disser nas preferências (pergunta 1a).
- Sem preferência → distribua proporcional ao remaining FP.
- Tasks sem assignee óbvio: `assigneeIds: []`, PM resolve depois.
- **Validação de regras de negócio é responsabilidade do PM**, não do RPC. Você apresenta a proposta em texto, PM revisa restrições (ex: "tira o frontend do João"), você refaz, depois executa. O `bulk_update_tasks` valida apenas integridade do banco (task ref existe, sprint pertence ao projeto, member está em ProjectMember) — não regras como "João só faz backend".

5. **STORY-COHERENT PLANNING (regra dura)**
Tasks da **mesma `userStoryId`** preferencialmente cabem **no mesmo sprint**. Entregar metade de uma story por sprint = ninguém consegue testar/validar a feature.
- Antes de distribuir, agrupe tasks por `userStoryId`.
- Sprint a sprint, encha alocando **stories inteiras** (todas as tasks vinculadas), não tasks soltas.
- **Exceção:** story "grande" (soma de FP das tasks > 40 FP, ou > 50% da cap por sprint) pode dividir entre 2 sprints. Quando dividir, **avise explicitamente** na proposta: "Story X-US-014 (52 FP) dividida: tasks 1–4 no Sprint 8, tasks 5–7 no Sprint 9".
- Tasks sem `userStoryId` (legacy/avulsas) entram por última, depois das stories alocadas.

6. **PROPOSTA EM TEXTO + CONFIRMAÇÃO**
Mostre tabela em texto antes de chamar tools. Após "confirma":
- `create_sprint` (1 chamada por sprint novo)
- `bulk_update_tasks` em UMA chamada com TODOS os updates

7. **ERROR RECOVERY (bulk_update_tasks falhou)**
A RPC é atômica — rollback total se uma task falhar. Erros possíveis: taskRef inexistente, sprintId inválido, assignee não está em ProjectMember.
- **NÃO retry automático.** Mostre ao PM exatamente qual ref/sprint/assignee falhou (a mensagem do erro identifica).
- Peça correção: "Falhou ao mover TASK-281 — reference não existe. Era TASK-280? Refaço a proposta com o que sobrou."
- Refaz a proposta sem o item problemático ou com a correção, mostra de novo, espera "manda".

8. **NÃO EDITORIALIZE (regra dura, derivada da auditoria de contrato)**
Quando você termina um cálculo ou proposta, apresente o resultado e PARE. Não:
- Sugira "rediscutir contrato"
- Proponha "cortar escopo" ou "trocar builders"
- Adicione recomendações que o PM não pediu
Se algo merece atenção (ex: capacity ociosa em outro projeto), guarde pra quando o PM perguntar. Resposta direta: o que ele pediu, nada além.

9. **STATUS DEFAULT**
Status default em planning = 'todo'. NUNCA mexa em doing/review/done sem ordem direta.

10. **PREFERÊNCIAS NÃO PERSISTEM**
As respostas das 4 perguntas valem só pra esta sessão. NÃO chame tools de "salvar preferência" — não existem.

11. **ESCOPO DE PLANEJAMENTO**
Você só entra em planning mode quando:
   (a) o usuário pediu (palavra-chave detectada),
   (b) há ≥ 10 tasks no backlog ready (com FP e story),
   (c) há ProjectMembers com FP > 0 alocados.
Se faltar (b) ou (c), explique o que falta antes de prometer plano.
```

### 4.5 Onda 2.5 — Calibração (3h)

Cenários multi-turn (use `--thread-id` reusado):

| # | Turn 1 | Turn 2 | Esperado |
|---|---|---|---|
| F2.1 | "organiza o backlog em sprints" | (responde 4 perguntas) → "manda" | Pergunta 4 → propõe → executa bulk após confirma |
| F2.2 | "aloca tudo no Sprint 8" (estoura cap) | — | Alerta + propõe split com create_sprint |
| F2.3 | "vai estourar o contrato?" | — | Lê capacity + backlog, calcula "cabe em N sprints" SEM editorializar (sem sugerir cortar escopo, rediscutir contrato, trocar builders) |
| F2.4 | "Lucas e Pedro só backend, João full" → "manda" | — | Tasks de frontend NÃO vão pro Lucas/Pedro |
| F2.5 | Backlog 600 FP / cap 390 (não cabe) | — | Alerta "falta builder ou sprint extra" sem sugerir cortar stories |
| F2.6 | "Ana de férias no Sprint 9" → "manda" | — | Cap recalculada sem Ana |
| F2.7 | "como tá o sprint?" (controle) | — | Resposta narrativa SEM planner block carregado |
| F2.8 | "vai dar pra entregar até daqui 4 sprints?" | — | Lê backlog + capacity de N=4 sprints, responde sim/não com números, **não** pergunta "qual MVP" nem sugere cortar escopo |
| F2.9 | "organiza mantendo cada story em 1 sprint só" → "manda" | — | Agrupa tasks por userStoryId, aloca stories inteiras por sprint. Se split necessário, **avisa explicitamente** ("Story X-US-014 dividida em S8/S9") |
| F2.10 | Bulk falha — primeiro propõe plano, depois PM responde com taskRef inválida na confirmação ("manda mas troca TASK-281 por TASK-9999") | — | Tenta bulk, RPC retorna erro de ref inexistente, Alpha mostra qual falhou, refaz proposta sem retry automático |

3 runs cada, gate 2/3.

### 4.6 Onda 2.6 — Smoke + ship (1h)

Idem 1.8. Ship Zordon, 1 semana piloto.

---

## 5. Onda 2.5 — Velocity histórica (1-2h, opcional)

**Quando:** após Fase 2 estável, se PM pedir "qual a velocity real?".

**Migration leve — view computada:**
```sql
CREATE VIEW project_velocity AS
SELECT
  p.id AS "projectId",
  p.name,
  s.id AS "sprintId",
  s.name AS sprint_name,
  s.status,
  s."endDate",
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status = 'done'), 0) AS delivered_fp,
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status NOT IN ('done', 'draft')), 0) AS committed_fp
FROM "Project" p
JOIN "Sprint" s ON s."projectId" = p.id
LEFT JOIN "Task" t ON t."sprintId" = s.id
GROUP BY p.id, p.name, s.id, s.name, s.status, s."endDate";
```

**Tool:** `get_project_velocity` — média das últimas 3 sprints fechadas vs alocação atual.

---

## 6. Onda 3 — Rollout + Observability (4h)

### 6.1 Onda 3.1 — Kill switch por projeto (1h)

```sql
ALTER TABLE "Project" ADD COLUMN "alphaHierarchyEnabled" boolean NOT NULL DEFAULT true;
```

Em `buildProjectFocus` e `assembleAlphaTools`, gatear:
```ts
if (capabilities.writeTools && project.alphaHierarchyEnabled) {
  // tools de hierarquia
}
```

**Razão:** se em prod Alpha alucinar em projeto cliente, desliga via SQL/UI sem rollback de código.

### 6.2 Onda 3.2 — `AgentQualityLog` (2h)

```sql
CREATE TABLE "AgentQualityLog" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug" text NOT NULL DEFAULT 'alpha',
  "projectId" uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  "memberId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "threadId" uuid REFERENCES "ChatThread"(id) ON DELETE SET NULL,
  category text NOT NULL,  -- 'story_created', 'module_classified', 'plan_proposed', 'plan_executed'
  payload jsonb NOT NULL,  -- { storyRef, moduleId, reasoning }
  "humanVerdict" text,     -- 'correct', 'wrong', 'edited', null
  "verdictAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_quality_log_unverified
  ON "AgentQualityLog"("agentSlug", "createdAt" DESC)
  WHERE "humanVerdict" IS NULL;
```

**Quem grava:** wrappers da Fase 1/2 chamam `logAgentQuality(...)`.

**Quem valida:** cron diário com heurísticas:
- `story_created` com moduleId X → 7 dias depois, se Story.moduleId ainda é X → `correct`. Se mudou → `wrong`.
- `plan_proposed` → se `bulk_update_tasks` foi chamado nos próximos 10min → `correct`. Senão → `wrong`.

### 6.3 Onda 3.3 — Dashboard mínimo (30min)

1 query no painel Ops:
```sql
SELECT
  category,
  count(*) FILTER (WHERE "humanVerdict" = 'correct') AS correct,
  count(*) FILTER (WHERE "humanVerdict" = 'wrong') AS wrong,
  count(*) FILTER (WHERE "humanVerdict" IS NULL) AS pending,
  round(100.0 * count(*) FILTER (WHERE "humanVerdict" = 'correct')
        / NULLIF(count(*) FILTER (WHERE "humanVerdict" IS NOT NULL), 0), 1) AS pct_correct
FROM "AgentQualityLog"
WHERE "agentSlug" = 'alpha'
  AND "createdAt" > now() - interval '30 days'
GROUP BY 1;
```

### 6.4 Onda 3.4 — Rollout gradual (30min)

1. Ligar nos próximos 2 projetos (não-Zordon)
2. 1 semana de uso
3. Ligar nos demais
4. Manter kill switch como porta de saída

---

## 7. Métricas de aceite (medíveis após Fase 3)

| Métrica | Como medir | Gate |
|---|---|---|
| Story `moduleId` correto | `AgentQualityLog.humanVerdict` | ≥ 90% após 30d |
| Story `personaId` correto | idem | ≥ 95% |
| AC vazio | query: stories sem AC criadas pelo Alpha | 0 |
| Plano de sprint rejeitado pelo PM | proposta sem bulk_update_tasks em 10min | ≤ 5% |
| Bulk parcial | RPC atômica | 0 incidentes |
| Vocab "contrato" interpretado correto | calibração C1/C2/C3 | ≥ 8/9 (após Onda 1.7) |
| Tamanho do prompt em conversa não-hierárquica | log do buildOpsContext | < 2kb crescimento vs baseline |

---

## 8. Riscos consolidados (atualizado)

| Risco | Mitigação | Onda |
|---|---|---|
| Vocabulário "contrato" alucina | Adendo prompt §2.1 + recalibração C1/C2/C3 | 1.7 |
| Haiku conservador demais (4-5 perguntas) | Iteração de prompt durante piloto | 1.8 |
| Estender wrappers quebra Vitor | Wrappers Alpha-only, DAL session-agnóstica | 1.1 ✅ |
| Bulk falha no meio | RPC atômica, rollback total | 2.1 |
| Capacity stale | RPC revalida ProjectMember em cada bulk | 2.1 |
| Planner mode polui conversa não-planner | Gate intent + estado, não só estado | 2.3 |
| Prompt cresce demais (>1500 linhas) | Métrica de tamanho + lazy taxonomia (já feito) | — ✅ |
| Comportamento ruim em projeto sensível | Kill switch `alphaHierarchyEnabled` | 3.1 |
| Métricas sem dado humano | AgentQualityLog + heurística auto-verdict | 3.2 |

---

## 9. Conventions (recap)

- Migrations: `psql "$DIRECT_URL" -f <path>` (nunca dashboard)
- Após migration: regerar `database.types.ts`
- `bunx tsc --noEmit` antes de cada commit
- Commits: `bash scripts/sync-main.sh -m "ZRD-JM-NN: <auto-summary>"`
- Calibração: 3 runs/cenário com régua objetiva escrita
- Sprints seg→dom, 7d (CHECK no DB)
- **Sem feature flag** em context loader (heurística é determinística)
- **COM kill switch** em rollout (Project.alphaHierarchyEnabled)
- **Per-agent model:** Alpha em Haiku 4.5, Vitor em Sonnet 4.6 default

---

## 10. Decisões V4 vs V3

| Item | V3 | V4 |
|---|---|---|
| Modelo Alpha | DEFAULT_MODEL (Sonnet 4.6) | **Haiku 4.5** per-agent override (~10x mais barato) |
| Vocabulário "contrato" | não previsto | Onda 1.7 adicionada (descoberta pós-calibração) |
| Refinement loop | Fase 1 §4.1 | ✅ entregue na 1.1 (manage_story_ac) |
| Wrappers vs estender factories | wrappers Alpha-only | ✅ confirmado em prod, Vitor intacto |
| Context block hierarquia | condicional por intent | minimal sempre + lazy via tools (mais simples, funcionou na calibração) |
| Calibração 5 runs/cenário | 5 runs | 3 runs (gate 2/3 = 66%; aceito após validar com Haiku) |
| Modelo de "contrato" | escopo total vendido | **alocação por sprint** (`fpAllocation`) — modelo Volund real |
| AgentQualityLog | Fase 3 | mantido Fase 3 |
| Tempo total restante | 30h | **17h** (Fase 1 já entregue) |

---

## 11. Próximo passo concreto

**Hoje (~2h):**
1. Ler §2 (Onda 1.7) — 2 min
2. Editar [agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts) — adicionar "Vocabulário operacional" + apertar regra 10 (~30 min)
3. Recalibrar C1/C2/C3 — 3 runs cada, registrar em [docs/alpha-audit-contrato.md](docs/alpha-audit-contrato.md) (~30 min)
4. Smoke E2E na UI Volund (`/projects/<zordonId>` chat) — (~30 min)
5. `bash scripts/sync-main.sh -m "ZRD-JM-NN: alpha — fase 1 hierarchy + vocab contrato"` (~5 min)

**Depois (1 semana piloto):**
- Head Ops/PMs usam Alpha
- Recolher feedback antes de iniciar Fase 2

**Pontos de stop obrigatórios:**
- Gate 1.7 (vocab contrato 2/3 mínimo)
- Gate Fase 1 piloto (1 semana sem regressão crítica)
- Gate Fase 2 (calibração 2/3 + 1 semana piloto)
- Gate Fase 3 (rollout gradual com kill switch)

**Sem atalhos.** Calibração com régua objetiva é o que separa "agente que parece funcionar" de "agente que funciona em prod."
