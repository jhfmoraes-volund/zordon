# 08 — Audit Rules (Zelar v2)

Regras das 3 dimensões de auditoria + 6 padrões cross-module usadas pela skill `/task-gen-audit`.

A skill é **read-only**: roda SELECTs no Supabase via `psql "$DIRECT_URL"`, lê arquivos do repo, escreve apenas relatórios em `docs/task-gen/projects/zelar/audits/`. Zero INSERT/UPDATE/DELETE no banco.

## Dimensões

| # | Dimensão | Pergunta-chave | Onde roda |
|---|---|---|---|
| A | Cobertura brainstorm → AC | Tudo que foi levantado virou AC de alguma story? | module-auditor |
| B | Coerência interna | Redundâncias ou pontas soltas dentro do módulo? | module-auditor |
| C | Qualidade AC-da-Task | Os checklists técnicos das tasks estão bem feitos? | module-auditor |
| X | Cross-module | Esquemas/endpoints/components atravessam módulos com coerência? | cross-auditor |

## Severidades

- **ALTO** — bloqueia entrega; ação obrigatória antes de promover tasks pra `ready`/`in_progress`
- **MÉDIO** — sinaliza dívida; não bloqueia mas deve entrar em backlog de cleanup
- **BAIXO** — observação; aceitar conscientemente é OK

---

## A — Cobertura brainstorm → AC

### A.0 Mapeamento brainstorm → módulo

Carregar `docs/task-gen/projects/zelar/06-brainstorm-module-mapping.yaml`. Pra cada feature da brainstorm com `archived=false`:

1. Se `moduleHint` casa com algum `brainstorm_hints` no mapping → atribuir ao módulo
2. Se há `feature_overrides` com `title_contains` casando → usa `belongs_to`
3. Se `moduleHint='SISTEMA'` → aplicar `classification_hints` por título
4. Se `moduleHint IS NULL` → aplicar `unhinted_features_strategy`
5. Senão → bucket `_orphan` pra revisão humana

### A.1 Status de cobertura por feature

Pra cada feature mapeada ao módulo `M` que está sendo auditado:

| Status | Critério | Severidade |
|---|---|---|
| `covered` | ≥1 AC de story do módulo M cita comportamento descrito em `howItSolves` ou `userFlows` | ok |
| `partial` | AC menciona o tema mas falta cobertura de algum sub-comportamento explícito | MÉDIO |
| `missing` | Nenhum AC do módulo cobre | **ALTO** |
| `out_of_scope` | bucket=`out` ou comentário de exclusão explícito | ok (informativo) |

### A.2 Heurística (não-LLM-classifier)

A skill **não tenta classificar automaticamente** com similaridade textual. Em vez disso:

1. Pra cada feature, lista AC candidatos (todas AC das stories do módulo)
2. Apresenta lado-a-lado em formato:
   ```
   Feature brainstorm: <title>
   howItSolves: <primeiros 200 chars>
   AC candidatos do módulo:
     - US-001.1 — <text>
     - US-001.2 — <text>
     ...
   ```
3. Auditor classifica como `covered`/`partial`/`missing` com **confidence** (`high`/`med`/`low`)
4. Tudo `low` ou `missing` é destacado pra revisão humana

### A.3 Output

```markdown
## A — Cobertura brainstorm → AC (MODULE: <X>)

**Resumo:** N features mapeadas, C covered, P partial, M missing.

### Features cobertas (high/med confidence)
| Feature | Status | AC cobertos | Confidence |

### Lacunas (partial / missing / low confidence)
| Feature | Status | Evidência | Sugestão |
```

---

## B — Coerência interna do módulo

Seis checks no banco do módulo X.

### B.1 Duplicação semântica de AC

```sql
-- Lista AC com prefixo similar (heurística: 1ª palavra-chave + 1º substantivo)
SELECT
  s.reference, ac."order", ac.text
FROM "AcceptanceCriterion" ac
JOIN "UserStory" s ON s.id = ac."userStoryId"
JOIN "Module" m ON m.id = s."moduleId"
WHERE m.name = '<MODULE>'
  AND s."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b'
ORDER BY ac.text;
```

Auditor lê output e detecta pares `(US-A.N, US-B.M)` com texto semelhante. Severidade MÉDIO. Recomenda: extrair AC compartilhada ou dedupe.

### B.2 AC sem cobertura de tasks

```sql
SELECT story_ref, ac_order, LEFT(ac_preview, 120) AS ac
FROM task_coverage_v
WHERE story_ref IN (
  SELECT s.reference FROM "UserStory" s JOIN "Module" m ON m.id=s."moduleId"
  WHERE m.name = '<MODULE>'
    AND s."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b'
)
AND total_tasks = 0;
```

Severidade: **ALTO** se persona ≠ SISTEMA. MÉDIO se SISTEMA (algumas AC SISTEMA são executadas via job/edge function que podem não ter task UI).

### B.3 Tasks órfãs (sem AC-da-Story vinculada)

```sql
SELECT t.reference, t.title, t.layer
FROM "Task" t
JOIN "UserStory" s ON s.id = t."userStoryId"
JOIN "Module" m ON m.id = s."moduleId"
LEFT JOIN "TaskAcceptanceCriterion" tac ON tac."taskId" = t.id
WHERE m.name = '<MODULE>'
  AND s."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b'
GROUP BY t.id, t.reference, t.title, t.layer
HAVING COUNT(tac."acceptanceCriterionId") = 0;
```

Severidade: MÉDIO. Pode ser legítima (setup OPS/chore) — auditor classifica:
- task `type='chore'` ou layer `OPS` → ok (BAIXO)
- task `type='feature'` sem AC vinculada → MÉDIO

### B.4 Tasks duplicadas cross-story

```sql
SELECT
  LOWER(REGEXP_REPLACE(t.title, '\s+', ' ', 'g')) AS title_norm,
  ARRAY_AGG(s.reference || '/' || t.reference) AS occurrences,
  COUNT(*) AS dup_count
FROM "Task" t
JOIN "UserStory" s ON s.id = t."userStoryId"
JOIN "Module" m ON m.id = s."moduleId"
WHERE m.name = '<MODULE>'
  AND s."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b'
GROUP BY LOWER(REGEXP_REPLACE(t.title, '\s+', ' ', 'g'))
HAVING COUNT(*) > 1;
```

Pra cada dup, checar se há `TaskDependency` (relates_to) entre elas. Sem dep → MÉDIO ponta solta. Com dep → ok.

### B.5 Schemas/endpoints citados em description

Pra cada task do módulo, extrair via regex em `Task.description`:

- Tabelas: padrões `\b(provider|service|client|auth|lgpd|notification|dispute|category|payment|wallet|escrow|kyc)_\w+\b`
- Endpoints: `(GET|POST|PATCH|PUT|DELETE)\s+/api/[\w/\[\]:-]+`
- Componentes: padrões com upper-case CamelCase em código (`SignupWizard`, `ClientLogin`)

Auditor lista as ocorrências e identifica:
- Tabela X aparece em US-A mas não em US-B do mesmo módulo onde faria sentido → MÉDIO ponta solta
- Inconsistência de nome (`provider_profile` vs `provider_profiles`) → MÉDIO

Esse output também alimenta o cross-auditor (campo `schemas_referenced`).

### B.6 Validações herdadas da skill /task-gen-story

Re-roda em escala módulo as 6 validações da etapa 9 da skill:

```sql
-- B.6.1 AC sem cobertura (já em B.2 — duplicado pra completude)
-- B.6.2 Títulos duplicados intra-US
SELECT s.reference, t.title, COUNT(*)
FROM "Task" t JOIN "UserStory" s ON s.id=t."userStoryId"
JOIN "Module" m ON m.id=s."moduleId"
WHERE m.name='<MODULE>' AND s."designSessionId"='264e6d07-...'
GROUP BY s.reference, t.title HAVING COUNT(*) > 1;

-- B.6.3 Tasks sem checklist técnico (AC-da-Task)
SELECT t.reference, t.title FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
JOIN "Module" m ON m.id=s."moduleId"
LEFT JOIN "AcceptanceCriterion" ac ON ac."taskId" = t.id
WHERE m.name='<MODULE>' AND s."designSessionId"='264e6d07-...'
GROUP BY t.reference, t.title
HAVING COUNT(ac.id) = 0;
-- Severidade: ALTO

-- B.6.4 Description com "## Critério de pronto" (anti-pattern)
SELECT t.reference, t.title FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
JOIN "Module" m ON m.id=s."moduleId"
WHERE m.name='<MODULE>' AND s."designSessionId"='264e6d07-...'
  AND (t.description ILIKE '%## Critério de pronto%'
    OR t.description ILIKE '%## Definition of done%');
-- Severidade: MÉDIO

-- B.6.5 DATA/API sem decisão de RLS
SELECT t.reference, t.title, t.layer, t."personaScope", t."qualityFlags"
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
JOIN "Module" m ON m.id=s."moduleId"
WHERE m.name='<MODULE>' AND s."designSessionId"='264e6d07-...'
  AND t.layer IN ('DATA','API')
  AND t."personaScope" IS NULL
  AND NOT ('RLS_REQUIRED' = ANY(t."qualityFlags") OR 'NO_RLS_NEEDED' = ANY(t."qualityFlags"));
-- Severidade: ALTO
```

### B.7 RACE_CONDITION sem IDEMPOTENCY_KEY

```sql
SELECT t.reference, t.title
FROM "Task" t
JOIN "UserStory" s ON s.id=t."userStoryId"
JOIN "Module" m ON m.id=s."moduleId"
WHERE m.name='<MODULE>' AND s."designSessionId"='264e6d07-...'
  AND 'RACE_CONDITION' = ANY(t."qualityFlags")
  AND NOT 'IDEMPOTENCY_KEY' = ANY(t."qualityFlags");
-- Severidade: MÉDIO
```

### B.8 Output

```markdown
## B — Coerência interna (MODULE: <X>)

### B.1 Duplicação semântica de AC: N pares
### B.2 AC sem cobertura: N (X ALTO + Y MÉDIO)
### B.3 Tasks órfãs: N
### B.4 Tasks duplicadas cross-story: N (X com dep, Y ponta solta)
### B.5 Schemas/endpoints inconsistentes: N
### B.6 Validações task-gen-story: P passaram, F falharam
### B.7 RACE sem IDEMPOTENCY: N

[detalhamento por subseção com tabela]
```

---

## C — Qualidade das AC-da-Task

Heurísticas determinísticas em cima do texto de cada `AcceptanceCriterion(taskId NOT NULL)` do módulo.

| # | Check | Critério | Severidade |
|---|---|---|---|
| C1 | Tem ≥1 AC-da-Task | toda task tem ≥1 item de checklist | ALTO se faltar |
| C2 | Verificável | começa com particípio passado / "Smoke test" / "Index" / "Constraint" / "RLS" / "Endpoint" / "Componente" | MÉDIO se vago |
| C3 | Curta | ≤ 200 chars | BAIXO |
| C4 | Não duplica AC-da-Story | texto não bate com nenhuma AC-da-Story vinculada à task | MÉDIO |
| C5 | Não-procrastinante | sem "vai", "deveria", "futuramente", "em breve" | MÉDIO |
| C6 | Sem placeholder | sem TODO/FIXME/XXX/`<...>` literal | ALTO |
| C7 | Cobre RLS_REQUIRED | task com flag `RLS_REQUIRED` tem ≥1 AC-da-Task que cita RLS/policy/smoke RLS | MÉDIO |
| C8 | Cobre IDEMPOTENCY_KEY | task com flag `IDEMPOTENCY_KEY` tem ≥1 AC-da-Task citando idempotência | MÉDIO |
| C9 | Cobre RACE_CONDITION | task com flag `RACE_CONDITION` tem ≥1 AC-da-Task citando race/lock/CAS/SKIP LOCKED | MÉDIO |

### C SQL base

```sql
-- Todas AC-da-Task do módulo + flags da task
SELECT
  t.reference AS task_ref,
  t.title AS task_title,
  t."qualityFlags",
  ac."order",
  ac.text,
  LENGTH(ac.text) AS chars
FROM "AcceptanceCriterion" ac
JOIN "Task" t ON t.id = ac."taskId"
JOIN "UserStory" s ON s.id = t."userStoryId"
JOIN "Module" m ON m.id = s."moduleId"
WHERE m.name = '<MODULE>'
  AND s."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b'
ORDER BY t.reference, ac."order";
```

Auditor processa em memória aplicando os 9 checks.

### C Output

```markdown
## C — Qualidade AC-da-Task (MODULE: <X>)

**Resumo:** N AC-da-Task analisadas. F ALTO, M MÉDIO, B BAIXO.

### Por check
| Check | Issues | Severidade default |
| C1 — sem checklist | N | ALTO |
| C6 — placeholder | N | ALTO |
...

### Detalhes
| Task | Item AC | Problema | Severidade | Sugestão |
```

---

## X — Padrões cross-module (cross-auditor)

Roda **depois** dos N module-auditors. Recebe agregação dos YAMLs (não re-lê o banco do zero — opera em cima de evidência destilada).

### X.1 Schema declarado em A consumido em B sem dep

Pra cada schema agregado em `schemas_by_name` com `cited_in` em ≥2 módulos:
- Verifica se há `TaskDependency` cruzando os módulos das tasks que citam o schema
- Sem dep → MÉDIO

### X.2 Componente UI extraído mas órfão

Pra cada componente em `components_by_name`:
- Se aparece com role `created` em US-A e role `reused_from: US-X` em US-B onde X≠A → MÉDIO inconsistência
- Se aparece só com role `created` em uma US e nunca `reused_from` em outra → BAIXO (não-aproveitamento)

### X.3 Endpoint duplicado entre módulos

Pra cada endpoint em `endpoints_by_path` com `cited_in` em ≥2 módulos:
- Severidade: **ALTO** (rota única, especificada em 2 lugares = bug em potencial)

### X.4 Persona scope inconsistente

Pra cada schema em `schemas_by_name` que aparece em tasks com `personaScope` diferente:
- Se NÃO tem task com `RLS_REQUIRED` cobrindo todas as personas que tocam → **ALTO**
- Auditor cruza com B.6.5 (já feito por módulo) pra evitar duplo-report

### X.5 Brainstorm feature mapeada pra ≥2 módulos

Se `unmapped_brainstorm_features` ou features classificadas como `partial` aparecem em 2+ módulos → MÉDIO (não-decisão sobre onde mora a feature).

### X.6 Cadeia de blocks órfã cross-módulo

Query final que pode rodar no banco (não vem do YAML):

```sql
-- Tasks com TaskDependency.dependsOn em outro módulo
SELECT
  t1.reference AS dependent_task,
  m1.name AS dependent_module,
  t2.reference AS dependency_task,
  m2.name AS dependency_module,
  td.kind
FROM "TaskDependency" td
JOIN "Task" t1 ON t1.id = td."taskId"
JOIN "Task" t2 ON t2.id = td."dependsOn"
JOIN "UserStory" s1 ON s1.id = t1."userStoryId"
JOIN "UserStory" s2 ON s2.id = t2."userStoryId"
JOIN "Module" m1 ON m1.id = s1."moduleId"
JOIN "Module" m2 ON m2.id = s2."moduleId"
WHERE m1.name != m2.name
  AND s1."designSessionId" = '264e6d07-d365-43ba-8029-d539ce6f7c6b';
```

Cross-auditor lista deps cross-module com severidade BAIXO (informativo, não problema). Mas marca MÉDIO se `kind='blocks'` e o módulo bloqueador não tem task com status promovido (sem MVP cycle definido).

### X Output

```markdown
## Findings cross-module

### X.1 Schemas atravessando módulos
### X.2 Componentes UI inconsistentes
### X.3 Endpoints duplicados [ALTO]
### X.4 Persona scope inconsistente [ALTO]
### X.5 Brainstorm features ambíguas
### X.6 Dependências cross-module
```

---

## Tom dos relatórios

- Direto, factual, com evidência (story_ref + ac_order, nunca texto inteiro)
- Cada finding tem: **Local + Evidência + Severidade + Sugestão**
- Nunca propor INSERT/UPDATE no relatório — só descrever o que precisa mudar
- Recomendações priorizadas no fim: ALTO → MÉDIO → BAIXO

---

## Tabela-resumo (pra cross-auditor preencher)

| Módulo | A.covered | A.partial | A.missing | B.high | B.med | C.high | C.med | Total ALTO |
|---|---|---|---|---|---|---|---|---|

Ordena por `Total ALTO` desc na saída final consolidada.
