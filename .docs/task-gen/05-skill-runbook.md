# 05 — Skill `/task-gen-story` Runbook

Como rodar a skill, o que esperar, e como recuperar de falhas.

## Quando usar

- DS Inception Zelar v2 está com 28/28 stories refined e 274 AC ✅
- Schema de tasks está aplicado (`Task.layer`, `TaskAcceptanceCriterion`, view `task_coverage_v`) ✅
- Próximo passo é gerar tasks de implementação

## Sintaxe

```
/task-gen-story <STORY-REF>     # 1 story específica (interativo)
/task-gen-story <MODULE>        # módulo inteiro (autônomo, ex: PERFIL)
/task-gen-story --all           # todas as stories pendentes (autônomo, com checkpoint a cada 5)
/task-gen-story --dry-run <REF> # mostra o plano sem persistir
/task-gen-story --regen <REF>   # regenera (deleta tasks da story e refaz)
```

## O que a skill faz (passo a passo)

### Etapa 1 — Carregar contexto

```sql
-- Story + AC
SELECT s.*, p.name AS persona, m.name AS modulo,
       json_agg(json_build_object('order', ac."order", 'text', ac.text) ORDER BY ac."order") AS criteria
FROM "UserStory" s
JOIN "ProjectPersona" p ON p.id = s."personaId"
JOIN "Module" m ON m.id = s."moduleId"
LEFT JOIN "AcceptanceCriterion" ac ON ac."userStoryId" = s.id
WHERE s.reference = '<STORY-REF>' AND s."designSessionId" = '264e6d07-...'
GROUP BY s.id, p.name, m.name;

-- Tasks já criadas em outras US (para reuso)
SELECT s.reference, t.layer, t.title, t.id
FROM "Task" t
JOIN "UserStory" s ON s.id = t."userStoryId"
WHERE s."designSessionId" = '264e6d07-...'
  AND s.reference != '<STORY-REF>'
ORDER BY s.reference, t.layer;

-- Brainstorm cards do módulo (contexto adicional)
SELECT id, title, "moduleHint", "howItSolves", "userFlows"
FROM "DesignSessionBrainstormFeature"
WHERE "sessionId" = '264e6d07-...'
  AND "moduleHint" ILIKE '%<modulo>%';
```

### Etapa 2 — Mapear AC → Camadas

Skill itera cada AC e decide quais camadas afeta. Saída interna:

```
AC#1: DATA + API + UI
AC#2: API + UI
AC#3: REALTIME + UI
...
```

### Etapa 3 — Identificar reuso

Para cada item da matriz acima, verifica se já existe task em outra US que cobre. Se sim, marca como dependência (`TaskDependency.kind='blocks'` lowercase) em vez de duplicar.

### Etapa 4 — Gerar draft

Constrói as `Task` em memória (não persiste ainda). Cada task com:
- title, description (estrutura do doc 01 §8)
- layer, personaScope, qualityFlags
- AC cobertos
- Dependências

### Etapa 5 — Validar

Roda as 3 queries de validação (doc 01 §10):
1. Cobertura DATA/API + UI por AC
2. Não-duplicação intra-US
3. Qualidade flags em DATA/API

Se qualquer falha: aborta antes de persistir e mostra o problema.

### Etapa 6 — Apresentar (modo interativo)

Mostra o plano em formato:

```
## US-001 — Cadastrar-se e ser aprovado como prestador

### Cobertura por camada
- DATA: 3 tasks
- API: 4 tasks
- REALTIME: 1 task
- UI: 5 tasks
- OPS: 0 tasks

### Tasks propostas
[DATA] T-001 Criar tabela `provider_profiles` com RLS por provider_id
       AC: 1, 4, 8 | flags: RLS_REQUIRED, INDEX_REQUIRED, AUDIT_LOG
       deps: -
[API]  T-002 Implementar webhook POST /api/webhooks/unico
       AC: 6 | flags: SECRET_HANDLING, INPUT_VALIDATION, IDEMPOTENCY_KEY
       deps: BLOCKS T-001
...

### Reuso identificado
- 0 tasks reutilizadas de outras US (US-001 é fundacional)
- 5 componentes UI do design system serão usados

### Próximo passo
[Y] Persistir como draft  [N] Cancelar  [E] Editar antes de persistir
```

### Etapa 7 — Persistir (após confirmação)

```sql
BEGIN;
-- 1. INSERT em Task: layer/personaScope/qualityFlags/status='draft', description em padrão SDD (sem "Critério de pronto" no markdown)
-- 2. INSERT em TaskAcceptanceCriterion: vínculo task → AC-da-Story (ponte N:N, sem texto próprio)
-- 3. INSERT em AcceptanceCriterion (taskId=..., userStoryId=NULL): checklist técnico — renderiza como checkbox no TaskSheet
-- 4. INSERT em TaskDependency: kind LOWERCASE ('blocks' ou 'relates_to')
COMMIT;

-- Pós-COMMIT, rodar as 6 queries de validação do plano §9 da skill.
```

## Modos

### Interativo (default nas primeiras 2-3 US)
- Para após etapa 6, espera confirmação
- Permite editar antes de persistir (com `[E]` re-executa etapa 4-5)
- Útil para calibrar a régua

### Autônomo (default após US calibradas)
- Rola etapas 1-7 sem pausa
- Aborta se qualquer validação falhar
- Imprime resumo ao final

### Dry-run
- Roda etapas 1-6 e mostra o plano
- Não persiste em hipótese alguma
- Útil para revisar sem risco

### Regen
- Antes de gerar, deleta tasks existentes da story
- **Atenção:** `TaskDependency` tem `ON DELETE RESTRICT` no `dependsOn` — apagar primeiro as TaskDependency, depois as Tasks. `AcceptanceCriterion(taskId)` e `TaskAcceptanceCriterion` caem por `ON DELETE CASCADE` quando a Task é deletada.
- Útil quando AC-da-Story foi alterado e tasks antigas estão obsoletas

## Recuperação de falha

### Falha na validação de cobertura
```
❌ AC#7 sem task UI (e não é SISTEMA)
```
Solução: revisar mapping AC → camadas. Provavelmente faltou identificar o caminho do usuário.

### Falha de duplicação
```
❌ Title "Criar tabela service_requests" já existe em US-023
```
Solução: substituir pela referência via `TaskDependency`. Skill faz automaticamente, mas se erro persistir é bug.

### Falha de qualidade
```
❌ Task T-005 (DATA) sem RLS_REQUIRED nem NO_RLS_NEEDED
```
Solução: explicitar a decisão de RLS. Toda task DATA/API decide explicitamente.

### Persistência interrompida no meio
- Migration usa `BEGIN` ... `COMMIT`. Se interromper, `ROLLBACK` automático.
- Estado anterior preservado.
- Re-rodar a skill com `--regen` é seguro (deleta + recria).

## Comandos úteis pós-geração

### Ver tasks de uma US
```sql
SELECT t.layer, t.title, t."personaScope", t."qualityFlags"
FROM "Task" t
JOIN "UserStory" s ON s.id = t."userStoryId"
WHERE s.reference = 'ZLAR-V2-US-001'
ORDER BY t.layer, t.title;
```

### Cobertura visual
```sql
SELECT * FROM task_coverage_v WHERE story_ref = 'ZLAR-V2-US-001' ORDER BY ac_order;
```

### Dependências
```sql
SELECT
  src.title AS task,
  src_us.reference AS from_story,
  dst.title AS depends_on,
  dst_us.reference AS to_story,
  d.kind
FROM "TaskDependency" d
JOIN "Task" src ON src.id = d."taskId"
JOIN "Task" dst ON dst.id = d."dependsOn"
JOIN "UserStory" src_us ON src_us.id = src."userStoryId"
JOIN "UserStory" dst_us ON dst_us.id = dst."userStoryId"
WHERE src_us."designSessionId" = '264e6d07-...'
ORDER BY src_us.reference, src.title;
```

### Stats globais Zelar v2
```sql
SELECT
  s.reference,
  COUNT(t.id) AS tasks,
  COUNT(*) FILTER (WHERE t.layer = 'DATA') AS data,
  COUNT(*) FILTER (WHERE t.layer = 'API') AS api,
  COUNT(*) FILTER (WHERE t.layer = 'REALTIME') AS realtime,
  COUNT(*) FILTER (WHERE t.layer = 'UI') AS ui,
  COUNT(*) FILTER (WHERE t.layer = 'OPS') AS ops
FROM "UserStory" s
LEFT JOIN "Task" t ON t."userStoryId" = s.id
WHERE s."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b'
GROUP BY s.reference
ORDER BY s.reference;
```

## Rollback de uma US

`TaskDependency` tem `ON DELETE RESTRICT` no `dependsOn`, então é preciso apagar dependências antes:

```sql
BEGIN;

-- 1. Apaga dependências (ambos os lados) das tasks da US
DELETE FROM "TaskDependency"
WHERE "taskId" IN (
  SELECT t.id FROM "Task" t
  JOIN "UserStory" s ON s.id = t."userStoryId"
  WHERE s.reference = 'ZLAR-V2-US-XXX'
)
   OR "dependsOn" IN (
  SELECT t.id FROM "Task" t
  JOIN "UserStory" s ON s.id = t."userStoryId"
  WHERE s.reference = 'ZLAR-V2-US-XXX'
);

-- 2. Apaga as tasks (cascade limpa AcceptanceCriterion(taskId) e TaskAcceptanceCriterion)
DELETE FROM "Task" t USING "UserStory" s
WHERE t."userStoryId" = s.id
  AND s.reference = 'ZLAR-V2-US-XXX';

COMMIT;
```

## Próximos passos

Após geração de tasks:
1. Triagem por sprint/release (US tem `module`, deriva ordem natural)
2. Atribuição (`Task.assigneeId` se existir, ou via outro modelo)
3. Estimativa de FP (separadamente, conforme acordado)
4. Promote `status` de `draft` → `todo` quando entrar em sprint
