# Auditoria de arquitetura de dados — Volund

> Levantamento read-only do banco `public` em 2026-05-31. Cruza 3 fontes: contagem real de linhas, refs no código (`from("Table")` no DAL), e mapa de FKs. Este doc é tanto o **relatório de auditoria** quanto a base da **arquitetura-alvo**.

## 0. TL;DR

- **~110 tabelas, todas em `public`.** O volume não é o problema — a falta de 2 convenções é.
- **3 padrões de problema:** (1) explosão de tabelas-de-link (13 tabelas pra 1 conceito), (2) RLS inconsistente (12 tabelas UNRESTRICTED, várias irmãs de tabelas com RLS), (3) duplicação legada (`TaskAcceptanceCriterion` vs `AcceptanceCriterion`).
- **A maioria das tabelas vazias é feature nova legítima** (Forge, Opportunity, PMReview, Planning*, Wiki v2), não lixo. Não dropar.

## 1. Inventário por domínio

| Domínio | Tabelas-núcleo | Satélites | Obs |
|---|---|---|---|
| **Core delivery** | `Project`, `Task`, `Sprint`, `Module`, `UserStory` | `TaskActivity/Assignment/Comment/Dependency/Tag/TagAssignment/Iteration`, `AcceptanceCriterion`, `ModuleActivity`, `Sprint{Member,Deploy,Retrospective}` | maior tráfego do banco |
| **Design Session** | `DesignSession` | ~20 (`DesignSession{Persona,Risk,Hypothesis,Scope,ProductVision,TechnicalSpecs,Item,Gap,PriorityItem,BrainstormFeature,StepData,...}`) | fragmentação alta |
| **Meetings / Planning / PMReview** | `Meeting`, `PlanningSession`, `PlanningCeremony`, `PMReview` | famílias de `*Link`/`*Note` (ver §3) | anti-padrão concentrado aqui |
| **Agent** | `Agent`, `AgentConfig`, `AgentVersion`, `AgentHeuristic` | `Agent{Usage,QualityLog,ProposalOutcome}`, `AgentCalibration{Capture,Fix,Scoreboard}`, `ChatThread`, `ChatMessage` | RLS off em bloco |
| **Forge** | `ForgeRun`, `ForgeSpec`, `ForgeTask`, `ForgeJob` | `ForgeAgent`, `ForgeEvent`, `ForgeDaemon`, `ForgeLearning` | feature nova, ~vazia, **não tocar** |
| **Member / PDI** | `Member` | `Member{Skill,Assessment,Integration,PDI}`, `PDIAction` | |
| **Client / Insight** | `Client` | `ClientInsight`, `ProjectInsight`, `InsightJob`, `Opportunity`, `CsatResponse` | |
| **Refs compartilhadas** | `ContextSource`, `TranscriptRef` | — | alvo dos links (ver §3) |

## 2. 🔴 Achado — tabelas mortas (0 refs no código)

Candidatas a `DROP` via migration atômica. Validar dados antes em cada uma.

| Tabela | Linhas | Diagnóstico |
|---|---|---|
| `DesignSessionStepData_backup_20260512` | 20 | Backup datado de migração antiga. Lixo explícito. |
| `TaskAcceptanceCriterion` | 772 | **Duplicata legada** de `AcceptanceCriterion` (3647 linhas, 11 refs). Código só usa `AcceptanceCriterion`. |
| `DesignSessionExportLog` | 0 | 0 refs, 0 dados. |
| `ProjectResource` | 0 | 0 refs, 0 dados. |
| `AgentVersion` | 0 | 0 refs, 0 dados (FK fantasma de `ChatThread`). |
| `AgentCalibrationScoreboard` | 0 | Backlog F5, nunca construída (AGENTS.md: "por enquanto manual"). |

## 3. 🔴 Achado — explosão de tabelas-de-link (anti-padrão central)

Cada feature reinventou "anexar X a um host". **13 tabelas fazendo a mesma coisa:**

| Conceito | DesignSession | Planning | PMReview | Meeting |
|---|---|---|---|---|
| **→ ContextSource** | `DesignSessionContextLink` | `PlanningSessionContextLink` | `PMReviewContextLink` | — |
| **→ TranscriptRef** | `DesignSessionTranscriptLink` | `PlanningTranscriptLink` | `PMReviewTranscriptLink` | — |
| **→ Meeting** | — | `PlanningMeetingLink` | `PMReviewMeetingLink` | `MeetingProjectLink` |
| **Note** | `DesignSessionStepNote` | `PlanningContextNote` | `PMReviewNote` | `MeetingPersonalNote` |

Todas quase vazias, todas com shape quase idêntico (`hostId`, `refId`, `linkedById`, `createdAt`). Consequências reais:
- **RLS inconsistente** entre irmãs (ver §4) — porque cada uma nasceu numa migration diferente.
- Toda feature nova com anexos cria +3–4 tabelas. Não escala.

### Alvo: link polimórfico único

```sql
CREATE TABLE "EntityLink" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_type   text NOT NULL,   -- 'design_session' | 'pm_review' | 'planning_session' | 'meeting'
  host_id     uuid NOT NULL,
  ref_type    text NOT NULL,   -- 'context_source' | 'transcript_ref' | 'meeting'
  ref_id      uuid NOT NULL,
  linked_by   uuid REFERENCES "Member"(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_type, host_id, ref_type, ref_id)
);
CREATE INDEX ON "EntityLink" (host_type, host_id);
CREATE INDEX ON "EntityLink" (ref_type, ref_id);
```

- **1 tabela, 1 conjunto de policies RLS** em vez de 13 inconsistentes.
- `Note` é caso à parte (tem corpo de texto, não é só link) → vira `EntityNote(host_type, host_id, body, author_id, ...)` (1 tabela em vez de 4).
- Resultado: **13 tabelas → 2**, e a próxima feature não cria nenhuma.

> Alinha com `[[project_transcript_ssot]]` (TranscriptRef como SSOT, "2 ilhas legadas a sanear").

## 4. 🔴 Achado — RLS desligado (12 tabelas UNRESTRICTED)

```
Link inconsistente : PMReviewMeetingLink, PMReviewTranscriptLink, DesignSessionTranscriptLink
Live sem RLS       : SprintMember (14 linhas, 5 refs)
Agent galaxy       : Agent, AgentConfig, AgentHeuristic, AgentVersion, ChatThread, ChatMessage
Mortas             : TaskAcceptanceCriterion, DesignSessionStepData_backup_20260512
```

- **Link inconsistente:** as irmãs (`*ContextLink`, `PMReviewNote`) têm RLS; estas não. Buraco real. Some sozinho na consolidação §3.
- **`SprintMember`:** tabela em uso, totalmente aberta. Corrigir já.
- **Agent galaxy:** provavelmente "interno" (sem API pública client-facing), mas no Supabase RLS-off = qualquer key anon lê. Defense-in-depth: ligar RLS + policy `is_manager()`.

## 5. 🟡 Achado — FK columns sem índice de cobertura (~90)

Maioria é tabela pequena (irrelevante hoje). Subset que importa por volume:

| Coluna | Linhas na tabela |
|---|---|
| `AcceptanceCriterion.checkedBy` | 3.647 |
| `TaskActivity.actorMemberId` | 1.506 |
| `Notification.actorMemberId` | 447 |
| `ChatThread.agentId` / `createdBy` / `agentVersionId` | 192 |

Resto (<50 linhas) pode esperar, mas vale uma convenção: **toda FK ganha índice na migration que a cria.**

## 6. 🟡 Achado — fragmentação do Design Session

`DesignSession` tem ~20 tabelas-filha. Várias guardam **1 linha por sessão** (`DesignSessionProductVision`: 5 linhas / `DesignSessionTechnicalSpecs`: 4 / `DesignSessionScope`: 6). Essas seriam colunas/JSONB num `DesignSessionStepData`, não tabelas próprias. Não-bloqueante; revisitar caso a caso.

## 7. Arquitetura-alvo — 2 convenções

1. **Link polimórfico canônico** (`EntityLink` + `EntityNote`) em vez de `<Feature><Ref>Link`. Mata o anti-padrão na raiz.
2. **Toda tabela nova nasce com RLS + índice em toda FK.** Sem exceção. (Candidato a hook/lint na migration.)
3. *(Opcional, maior)* **Postgres schemas por domínio** (`core`, `design`, `agent`, `forge`, `planning`). Hoje tudo em `public`. Quebra `database.types.ts` e o DAL — só se a dor justificar.

## 8. Plano de remediação faseado

| Fase | Escopo | Risco | Reversível |
|---|---|---|---|
| **F1 — RLS gaps** | Ligar RLS + policy nas 12 UNRESTRICTED (exceto as que morrem em F2) | baixo | sim |
| **F2 — Cleanup mortas** | `DROP` das 6 da §2, com `pg_dump` de backup antes | médio | via backup |
| **F3 — Índices FK** | Índices no subset da §5 | baixo | sim |
| **F4 — Consolidar links** | `EntityLink`/`EntityNote` + migração de dados das 13 + atualizar DAL + dropar antigas | alto | faseado |
| **F5 — Convenção** | Doc + (hook) que exige RLS + índice FK em migration nova | — | — |

Cada fase = migrations atômicas (1 ALTER/CREATE por arquivo), via `psql "$DIRECT_URL" -f`, com update de `database.types.ts`.
