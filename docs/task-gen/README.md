# Task Generation & Audit

Ferramenta para gerar tasks de implementação (e auditá-las) a partir de User Stories e Acceptance Criteria já refinados em uma Design Session.

Os documentos numerados (01–09) são **genéricos**: descrevem regras, camadas, playbooks, protocolos e padrões de qualidade que se aplicam a qualquer projeto. Hoje a ferramenta roda no **piloto Zelar**, mas é desenhada pra escalar pra outros projetos.

`projects/<nome>/` guarda os artefatos específicos de cada projeto consumidor — mapping de brainstorm, backlog SQL gerado, relatórios de auditoria.

## Piloto atual: Zelar (DS v2)

- **DS:** Inception Zelar v2 (`264e6d07-d365-43ba-8029-d539ce6f7c6b`)
- **Project:** Zelar (`e41c492e-7a14-44b2-83b9-b8e0f2b38e4c`, ref `ZLAR`)
- **Stories:** 28 (todas refined, todas com module + persona)
- **AC:** 274 (alvo 8-12, máx 15 por story)
- **Personas:** PRESTADOR, CLIENTE, ADMIN, SISTEMA
- **Modules:** ONBOARDING, SOLICITACAO, EXECUCAO, MATCHING, NOTIFICACAO, PERFIL, SUPORTE, ADMIN
- **Artefatos do piloto:** `projects/zelar/` (mapping, backlog-sql, audits)

## Princípio dirigente

> **Story = uma capacidade da persona, ponta a ponta.**
> AC = comportamento observável.
> Task = unidade de entrega coesa em uma camada técnica.

## Os 9 documentos

| # | Documento | Para quê |
|---|---|---|
| 01 | [task-generation-rules.md](01-task-generation-rules.md) | Regras das 5 camadas (DATA/API/REALTIME/UI/OPS), cobertura mínima por AC, granularidade |
| 02 | [quality-checklist.md](02-quality-checklist.md) | RLS por persona, segurança, race conditions, idempotência, audit log, performance |
| 03 | [layer-playbooks.md](03-layer-playbooks.md) | O que cada camada cobre, padrões de task por camada, exemplos |
| 04 | [reusable-components.md](04-reusable-components.md) | Catálogo de componentes/hooks/libs existentes para reuso obrigatório |
| 05 | [skill-runbook.md](05-skill-runbook.md) | Como rodar `/task-gen-story`, troubleshooting, rollback |
| 06 | [projects/zelar/06-brainstorm-module-mapping.yaml](projects/zelar/06-brainstorm-module-mapping.yaml) | **Project-specific (Zelar):** mapa `moduleHint` (brainstorm pré-consolidação) → módulo v2. Usado pela auditoria. |
| 07 | [orchestration-protocol.md](07-orchestration-protocol.md) | Protocolo main↔subagent de `/task-gen-orchestrate` (loop autônomo de módulo inteiro) |
| 08 | [audit-rules.md](08-audit-rules.md) | Regras das 3 dimensões da auditoria (A cobertura brainstorm, B coerência interna, C qualidade AC-da-Task) + 6 padrões cross-module (X) |
| 09 | [audit-protocol.md](09-audit-protocol.md) | Protocolo orchestrator↔subagent de `/task-gen-audit` (HINT/RESUMO YAML do harness de auditoria) |

## Fluxo de geração

```
US selecionada
    │
    ├─► Carrega: AC + brainstorm cards + tasks de outras US (para reuso)
    │
    ├─► Mapeia AC → camadas (matriz)
    │
    ├─► Identifica reuso/dependências cross-US
    │
    ├─► Gera draft de tasks (1 por unidade coesa por camada)
    │
    ├─► Valida automaticamente:
    │     ├─ Cobertura: cada AC tem 1+ task DATA/API + 1+ task UI (exceto SISTEMA)
    │     ├─ Não-duplicação: nenhuma task duplica outra do projeto
    │     └─ Qualidade: flags obrigatórias presentes
    │
    ├─► Apresenta interativamente (1ª, 2ª, 3ª US) ou autônomo (resto)
    │
    └─► Persiste 4 tipos de linha:
          ├─ Task (status=draft)
          ├─ TaskAcceptanceCriterion (vínculo task → AC-da-Story)
          ├─ AcceptanceCriterion (taskId=...) (checklist técnico, vira checkbox no TaskSheet)
          └─ TaskDependency (kind='blocks'|'relates_to' lowercase)
```

## Schema de banco

Implementado em `supabase/migrations/20260509_zelar_v2_tasks_schema.sql` (migration histórica, mantém nome `v2`):

- `Task.layer` — enum `TaskLayer` (DATA/API/REALTIME/UI/OPS)
- `Task.qualityFlags` — `text[]` (RLS_REQUIRED, IDEMPOTENCY_KEY, etc — ver doc 02)
- `Task.personaScope` — `text` (CLIENTE/PRESTADOR/ADMIN/SISTEMA/ANY)
- `AcceptanceCriterion` — uma só tabela com **constraint XOR** (`taskId XOR userStoryId`):
  - `userStoryId NOT NULL`: AC-da-Story (vem do produto, 274 já existem)
  - `taskId NOT NULL`: AC-da-Task (checklist técnico que renderiza como checkbox no TaskSheet — gerado pela skill)
- `TaskAcceptanceCriterion` — ponte N:N entre Task e AC-da-Story (não tem texto próprio)
- `TaskDependency` — `(taskId, dependsOn, kind)`, kind em **lowercase** (`'blocks'` ou `'relates_to'`)
- `task_coverage_v` — view que consolida cobertura por AC-da-Story

## Onde mora cada coisa

| Artefato | Localização |
|---|---|
| Migrations de AC | `supabase/migrations/20260508*_zelar_v2_*` e `20260509*_zelar_v2_ac_*` (nomes históricos) |
| Migration de schema de tasks | `supabase/migrations/20260509_zelar_v2_tasks_schema.sql` (nome histórico) |
| Skill (1 US) | `.claude/commands/task-gen-story.md` |
| Skill (módulo inteiro, loop autônomo) | `.claude/commands/task-gen-orchestrate.md` |
| Skill (auditoria read-only) | `.claude/commands/task-gen-audit.md` |
| Docs operacionais | `docs/task-gen/` (este diretório) |
| Backlog SQL (cards Zordon) | `docs/task-gen/projects/zelar/backlog-sql/` |
| Relatórios de auditoria | `docs/task-gen/projects/zelar/audits/` |
| Memory | `~/.claude/.../memory/project_zelar_v2.md` |

## Comandos rápidos

```bash
# Estado da DS
psql "$DIRECT_URL" -c "
SELECT m.name, COUNT(s.id) stories, COUNT(ac.id) ac
FROM \"UserStory\" s
LEFT JOIN \"Module\" m ON m.id=s.\"moduleId\"
LEFT JOIN \"AcceptanceCriterion\" ac ON ac.\"userStoryId\"=s.id
WHERE s.\"designSessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b'
GROUP BY m.name ORDER BY m.name;"

# Cobertura de uma US específica
psql "$DIRECT_URL" -c "SELECT * FROM task_coverage_v WHERE story_ref='ZLAR-V2-US-001';"

# Tasks geradas até agora (modulo de Zelar v2)
psql "$DIRECT_URL" -c "
SELECT s.reference, t.layer, COUNT(*) FROM \"Task\" t
JOIN \"UserStory\" s ON s.id=t.\"userStoryId\"
WHERE s.\"designSessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b'
GROUP BY s.reference, t.layer ORDER BY s.reference, t.layer;"
```

## Convenções de referência

- Story: `ZLAR-V2-US-NNN` (existente)
- Task: `ZLAR-V2-T-NNN` (atribuído na geração, sequencial dentro do projeto)
- AC: `<story>.<order>` (ex: `ZLAR-V2-US-001.3` = AC #3 da story 001)
- Commits: `ZRD-JM-NN: zelar — <story> tasks` (ver memória `feedback_commit_convention`)

## Status

- ✅ Schema migration aplicada
- ✅ Documentação V2 publicada
- ✅ Skill `/task-gen-story` calibrada em ONBOARDING (5/5 US, 58 tasks)
- ✅ Skill `/task-gen-orchestrate` para loop autônomo de módulo inteiro
- ✅ Skill `/task-gen-audit` (auditoria read-only com harness paralelo de subagents)

## Como rodar (quick start)

### Uma US específica (interativo / autônomo single)
```
/task-gen-story ZLAR-V2-US-XXX
```

### Um módulo inteiro em loop autônomo (sem intervenção)
```
/task-gen-orchestrate <MODULE>
```

Default: US 1-2 inline (cache quente), US 3+ via subagent fresh-context com
hint acumulado. Falha pausa o loop. Ver
[`07-orchestration-protocol.md`](07-orchestration-protocol.md) pro protocolo.

### Auditoria read-only de módulo (após geração)
```
/task-gen-audit <MODULE>          # 1 módulo, sem cross-auditor
/task-gen-audit --all             # 8 paralelos + cross-auditor
/task-gen-audit --modules A,B,C   # subset paralelo + cross
```

Despacha 1 module-auditor por módulo em paralelo (fresh-context). Cada
auditor verifica:
- **A** — cobertura brainstorm features → AC do módulo
- **B** — coerência interna (AC sem cobertura, tasks órfãs/duplicadas, RLS)
- **C** — qualidade das AC-da-Task (testabilidade, placeholders, flags)

Em modo multi-módulo, despacha um cross-auditor depois (X1-X6: schemas
atravessando módulos, endpoints duplicados, componentes inconsistentes).

Output: `docs/task-gen/projects/zelar/audits/<DATE>_<MODULE>_audit.md` por módulo +
`<DATE>_consolidated_audit.md` (cross). Zero escrita no banco. Ver
[`08-audit-rules.md`](08-audit-rules.md) e [`09-audit-protocol.md`](09-audit-protocol.md).
