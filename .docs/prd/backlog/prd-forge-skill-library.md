# PRD — Forge Skill Library (Hermes-aligned closed loop, Degrau 2)

> **Status:** draft seed. Depende de `prd-forge-engine` (FE-013 `ForgeLearning`) estar em prod **e** com ≥2 semanas de runs reais coletando learnings. NÃO promover pra `ready/` antes desse gate.
>
> **Espelho de design completo:** [docs/runbooks/forge-closed-loop.md](../../runbooks/forge-closed-loop.md) — esta é a versão executável-por-Ralph daquela visão.

## 1 · Problema

FORGE hoje nasce zero-knowledge a cada autorun. Mesmo quando FE-013 (`ForgeLearning`) entrar em prod, a memória será **literal por profile** — uma lista de lessons em texto cru injetada no prompt. Três problemas concretos:

1. **Não escala por volume.** ≥30 lessons/profile, o prompt explode e tokens viram custo > valor.
2. **Não compõe.** Lesson "use ResponsiveSheet, não Dialog nu" e lesson "ResponsiveSheet.Footer trata safe-area" vivem isoladas; o worker precisa derivar a composição toda vez.
3. **Não evolui.** Uma lesson errada (ou que virou obsoleta após refactor) continua infectando prompts até alguém manualmente deletar.

Hermes Agent (Nous Research) resolveu isso com skill library auto-curada + recall semântico + evolução por uso. FORGE pode adotar o mesmo padrão **dentro** do duplo diamante sem ferir Spec.md.

## 2 · Solução em uma frase

Substituir a leitura literal de `ForgeLearning` por **recall semântico top-K de `ForgeSkill`** (entidade composable, com embedding, telemetria de uso e score de confiança que decai), promovendo learnings em skills automaticamente.

## 3 · Não-objetivos

- Não containerizar workers (continua local até multi-máquina virar dor).
- Não compartilhar skills cross-organização (V2; nesta fase é per-projeto).
- Não substituir Spec.md (Spec é contrato intra-PRD; Skill é memória cross-PRD).
- Não treinar modelo proprietário com trajetórias (Hermes faz; aqui é só recall + injeção).

## 4 · Personas e jornada

- **Builder (worker LLM)**: "preciso fazer task X, alguém já fez parecido?" → recall_skills → recebe top-3 → cita ou ignora.
- **PM humano**: "essa skill `migrate-jsonb-com-gin-index` virou anti-pattern?" → UI mostra score caindo, marca como deprecated.
- **Vitoria (PM agent)**: "antes de aprovar próxima sprint, quais skills tiveram outcome=blocked em ≥30% dos usos?" → query.

## 5 · Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| D1 | Skill = entidade durável, Learning = candidato | Separar volátil (lesson) de estável (skill) permite gate de promoção. |
| D2 | Recall via pgvector ivfflat (cosine) | Já é extensão Supabase oficial; alt FTS perde nuance semântica. |
| D3 | Embedding via OpenAI text-embedding-3-small (1536 dim) | Match com pgvector default; alt local seria ollama, mas latência mata recall in-prompt. |
| D4 | Score = (success/use) × exp(-days/90) | Decay exponencial 90d alinha com cadência de refactor do repo. |
| D5 | Promoção auto quando candidato aparece em ≥2 runs distintos com outcome=helped | 1 ocorrência é ruído; 2 é padrão. |
| D6 | `kind` ∈ {recipe, pattern, anti-pattern, runbook} | 4 categorias cobrem o espaço sem inflar UI. |
| D7 | `confidenceScore < 0.2 ∧ useCount ≥ 3` → auto-rebaixa pra anti-pattern | Anti-pattern não some, vira aviso negativo no prompt. |
| D8 | RLS por `createdBy` + `projectId`; sem read global | Skill de projeto A não vaza pra projeto B (privacy). V2 abre opt-in. |
| D9 | `recall_skills` tool é síncrono (≤500ms p95) | Recall in-prompt; assíncrono inviabilizaria. |
| D10 | `use_skill` tool é fire-and-forget (não bloqueia worker) | Telemetria não pode atrapalhar throughput. |

## 6 · Arquitetura

Ver §2 e §3 de [docs/runbooks/forge-closed-loop.md](../../runbooks/forge-closed-loop.md). Diagrama ASCII e tabelas estão consolidados lá; este PRD herda por referência.

Componentes novos vs FE-013:
- `src/lib/forge/skills/dal.ts` — CRUD + recall semântico
- `src/lib/forge/skills/embed.ts` — wrapper `embed(text): Promise<number[]>` via OpenAI
- `src/lib/forge/skills/promoter.ts` — regra de auto-promoção (D5)
- Tools `recall_skills`/`use_skill` em `src/lib/forge/tools/`
- Migration `20260601e_forge_skill.sql` (pgvector + ForgeSkill + ForgeSkillUsage)

## 7 · Schema

DDL completo em [forge-closed-loop.md §3](../../runbooks/forge-closed-loop.md#3--tabelas-degrau-2--depende-de-fe-003-e-fe-013). Vai virar 2 migrations atômicas:

- `supabase/migrations/20260601e_forge_skill.sql` — CREATE TABLE ForgeSkill + indexes + RLS
- `supabase/migrations/20260601f_forge_skill_usage.sql` — CREATE TABLE ForgeSkillUsage + RLS

RLS policies (resumo):
- ForgeSkill: SELECT/UPDATE/DELETE quando `auth.uid()` é `createdBy` OU é admin OU compartilha projeto.
- ForgeSkillUsage: SELECT quando dono da run ou skill; INSERT só pelo worker (service role).

## 8 · APIs

Tools internos (worker side, expostos via Agent SDK tool registry):

| Tool | Sync? | Contrato |
|---|---|---|
| `recall_skills` | sync ≤500ms | `{ query, profile?, domain?, topK? }` → `Array<{ skillId, title, bodyMd, confidence }>` |
| `use_skill` | fire-and-forget | `{ skillId, outcome: 'helped'|'neutral'|'blocked', evidence? }` → `void` |
| `record_learning` (FE-013, extendido) | sync | adiciona `proposeAsSkill?: boolean` → retorna `{ learningId, skillCandidate? }` |

HTTP routes (UI):

| Método | Path | Contrato |
|---|---|---|
| GET | `/api/forge/skills` | lista skills do projeto com filtros (kind, profile, minConfidence) |
| GET | `/api/forge/skills/[id]` | detalhe + usage history |
| PATCH | `/api/forge/skills/[id]` | edit manual (title/body/deprecated) |
| POST | `/api/forge/skills/promote` | promote learning → skill (manual gate) |

## 9 · UX

Página `/forge-spike/skills` (ou `/forge/skills` após FE-010):

```
┌──────────────────────────────────────────────────────────────┐
│ Skill Library · forge-engine · 47 skills · 12 deprecated      │
├──────────────────────────────────────────────────────────────┤
│  ▽ recipe (28)  ▽ pattern (12)  ▽ anti-pattern (7)            │
│                                                                │
│  ▣ migrate-jsonb-com-gin-index         confidence 0.91  ★★★   │
│    Recipe • db • 14 uses • last 2d ago                         │
│                                                                │
│  ▣ responsive-sheet-safe-area          confidence 0.84  ★★★   │
│    Pattern • ui • 9 uses • last 5h ago                         │
│                                                                │
│  ▣ dont-mock-supabase-rls              confidence 0.18  ⚠      │
│    Anti-pattern • db,test • 11 uses • blocked in 8 of 11       │
└──────────────────────────────────────────────────────────────┘
```

Click numa skill: drawer com bodyMd + lista de runs onde foi usada + outcome.

## 10 · Integrações

- **FE-013 (ForgeLearning)**: precisa estar em prod. ForgeLearning vira "input queue" pro promoter.
- **FE-007 (dual-track events)**: usage events (`tool_use: recall_skills`, `tool_use: use_skill`) entram no event log dual.
- **FE-010 (UI dual-source)**: página de Skills aproveita Supabase realtime que FE-010 introduz.
- **Vitoria (post-forge audit)**: pode usar `ForgeSkillUsage` pra detectar skills com outcome=blocked > 30% e flaggar.
- **pgvector**: precisa `CREATE EXTENSION vector` antes (migration prep separada se ainda não habilitada).

## 11 · Faseamento

| Fase | Entrega |
|---|---|
| 1 | Migration + DAL + `recall_skills`/`use_skill` tools registrados (worker NÃO chama ainda) |
| 2 | Planner injeta recall no prompt do worker (substitui leitura literal de ForgeLearning) |
| 3 | LearningExtractor subagent + auto-promoção (D5) |
| 4 | UI Skills + manual edit/promote |
| 5 | Decay job (pg_cron diário) + auto-rebaixamento (D7) |

Fase 1 entrega **mais** que o sistema atual (tools existem mesmo sem uso), Fase 2 substitui a injeção literal por semântica.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Embedding API down (OpenAI outage) | M | Alto | Fallback graceful: se embed falhar, cai pra FTS5 simples na bodyMd. Tool retorna degraded=true. |
| Skill ruim infecta prompts em massa | M | Alto | Confidence score + gate de promoção (D5: ≥2 ocorrências). Anti-pattern auto-rebaixamento (D7). |
| pgvector latência > 500ms com 10k skills | L | Médio | ivfflat index + LIMIT 20; benchmark antes de prod. |
| Worker abusa recall_skills (chama 50× por run) | M | Médio | Rate limit per-run no tool registry (ex: max 10 calls/run). |
| RLS leak entre projetos | L | Alto | Test suite explícito: insere skill em projeto A, tenta SELECT como projeto B, espera empty. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| % de runs que usaram ≥1 skill com outcome=helped | `SELECT count(DISTINCT runId) FROM ForgeSkillUsage WHERE outcome='helped' / total runs` | ≥ 60% em 4 semanas |
| Redução de runs com error_max_turns vs baseline FE-013 | Comparar `events.jsonl` payload subtype | ≥ 20% redução |
| Skills auto-promovidas vs manualmente | Coluna `promotedFromLearningId IS NOT NULL ∧ created_by=service_role` | ≥ 70% auto |
| Latência p95 de recall_skills | Otel span no tool wrapper | ≤ 500ms |
| Skills em anti-pattern como % do total | `SELECT count(*) FILTER (WHERE kind='anti-pattern') / count(*)` | ≤ 10% (mais que isso = library tóxica) |

## 14 · Open questions

(vazio — preencher conforme FE-013 entra em prod e gera evidência empírica)

## 15 · Referências

- [docs/runbooks/forge-closed-loop.md](../../runbooks/forge-closed-loop.md) — design completo
- [docs/runbooks/forge-runbook.md](../../runbooks/forge-runbook.md) — canônico do FORGE
- FE-013 (`scripts/ralph/features/forge-engine/prd.json` → `userStories[id=FE-013]`)
- Hermes Agent — https://hermes-agent.nousresearch.com/docs/
- pgvector — https://github.com/pgvector/pgvector
- Memory `project_forge_double_diamond.md`

## 16 · Stories implementáveis

```yaml
- id: SKILL-001
  title: Migrations ForgeSkill + ForgeSkillUsage + pgvector extension
  description: |
    DDL canônico baseado em §3 do vision doc. 2 migrations atômicas (skill, usage)
    + 1 prep (pgvector extension). RLS por createdBy/projectId.
  acceptanceCriteria:
    - "supabase/migrations/20260601d_pgvector_ext.sql habilita extension"
    - "supabase/migrations/20260601e_forge_skill.sql cria ForgeSkill + ivfflat index + RLS"
    - "supabase/migrations/20260601f_forge_skill_usage.sql cria ForgeSkillUsage + RLS"
    - "ALTER TABLE ForgeLearning ADD COLUMN promotedToSkillId uuid REFERENCES ForgeSkill(id)"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('ForgeSkill','ForgeSkillUsage')"
      expected: "2"
    - kind: sql
      command_or_query: "SELECT extname FROM pg_extension WHERE extname='vector'"
      expected: "vector"
  dependsOn: []
  estimateMinutes: 20
  touches:
    - supabase/migrations/20260601d_pgvector_ext.sql
    - supabase/migrations/20260601e_forge_skill.sql
    - supabase/migrations/20260601f_forge_skill_usage.sql

- id: SKILL-002
  title: DAL src/lib/forge/skills/dal.ts + embed.ts
  description: |
    CRUD básico (createSkill, getSkill, listSkillsForProject, updateSkill)
    + recallSkills(query, profile?, topK) usando pgvector cosine similarity
    + embed(text) wrapper sobre OpenAI text-embedding-3-small.
  acceptanceCriteria:
    - "src/lib/forge/skills/dal.ts exporta CRUD + recallSkills"
    - "src/lib/forge/skills/embed.ts: embed(string): Promise<number[1536]>"
    - "recallSkills retorna ordenado por (1 - cosine_distance) DESC com filtro de profile"
    - "Unit test: insere 3 skills, recall com query similar à title de uma → primeira no resultado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx scripts/forge/test-skill-recall.ts"
      expected: "exit 0, prints top match correto"
  dependsOn: [SKILL-001]
  estimateMinutes: 30
  touches:
    - src/lib/forge/skills/dal.ts
    - src/lib/forge/skills/embed.ts
    - scripts/forge/test-skill-recall.ts

- id: SKILL-003
  title: Worker tools recall_skills + use_skill
  description: |
    Registra tools no Agent SDK tool registry usado pelo worker.
    recall_skills síncrono; use_skill fire-and-forget. Rate limit 10/run.
  acceptanceCriteria:
    - "src/lib/forge/tools/recall-skills.ts implementa tool com schema Zod"
    - "src/lib/forge/tools/use-skill.ts implementa tool fire-and-forget"
    - "Rate limit: 11ª chamada de recall_skills num mesmo runId retorna { error: 'rate_limit' }"
    - "use_skill grava em ForgeSkillUsage com taskId + runId corretos"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "SELECT count(*) FROM ForgeSkillUsage WHERE runId IS NOT NULL"
      expected: ">= 0"
  dependsOn: [SKILL-002]
  estimateMinutes: 25
  touches:
    - src/lib/forge/tools/recall-skills.ts
    - src/lib/forge/tools/use-skill.ts
    - src/lib/forge/tools/index.ts

- id: SKILL-004
  title: Planner injeta recall no prompt (substitui leitura literal de ForgeLearning)
  description: |
    Antes de spawnar worker, planner faz recall_skills(query=story.description, profile=story.agentProfile, topK=3).
    Injeta no system prompt sob seção "KNOWN PATTERNS". Mantém ForgeLearning como fallback se recall vazio.
  acceptanceCriteria:
    - "src/lib/forge/planner.ts chama recallSkills antes de buildPrompt"
    - "Prompt resultante contém bloco '## KNOWN PATTERNS' quando topK > 0"
    - "Fallback pra ForgeLearning literal quando recall retorna empty"
    - "Telemetria: event 'skills_injected' com count emitido em events.jsonl"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "grep -l 'KNOWN PATTERNS' .forge/*/events.jsonl | head -1"
      expected: "non-empty"
  dependsOn: [SKILL-003]
  estimateMinutes: 20
  touches:
    - src/lib/forge/planner.ts
    - src/lib/forge/profiles/index.ts

- id: SKILL-005
  title: LearningExtractor subagent + auto-promotion rule
  description: |
    Post-run hook spawn subagent haiku-4.5 com events.jsonl como input.
    Extrai { lessonCandidates, skillCandidates }. Rule: skill candidate
    que aparece em ≥2 runs distintos com outcome=helped vira ForgeSkill.
  acceptanceCriteria:
    - "src/lib/forge/skills/extractor.ts: extractFromRun(runId): Promise<{ skillCandidates, lessonCandidates }>"
    - "src/lib/forge/skills/promoter.ts: promoteIfThreshold() roda após cada done event"
    - "Test: inserir 2 events com candidate idêntico → 1 skill criada com promotedFromLearningId apontando ao 2º"
    - "Hook integrado em scripts/forge/exec-story.ts ao final"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "SELECT count(*) FROM ForgeSkill WHERE promotedFromLearningId IS NOT NULL"
      expected: ">= 0"
  dependsOn: [SKILL-004]
  estimateMinutes: 30
  touches:
    - src/lib/forge/skills/extractor.ts
    - src/lib/forge/skills/promoter.ts
    - scripts/forge/exec-story.ts

- id: SKILL-006
  title: UI /forge/skills — lista + detail drawer
  description: |
    Página em /forge-spike/skills (e depois /forge/skills) lista skills do projeto
    agrupadas por kind, com filtros (profile, minConfidence). Drawer mostra
    bodyMd + usage history + manual deprecate button.
  acceptanceCriteria:
    - "Página renderiza com Supabase realtime subscription em ForgeSkill"
    - "Filtros funcionais: kind, profile, minConfidence (slider)"
    - "Drawer abre com ResponsiveSheet (padrão UI canônico)"
    - "Botão 'Mark deprecated' faz PATCH /api/forge/skills/[id]"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "curl http://localhost:3333/forge-spike/skills"
      expected: "200 OK"
  dependsOn: [SKILL-002]
  estimateMinutes: 30
  touches:
    - src/app/forge-spike/skills/page.tsx
    - src/app/api/forge/skills/route.ts
    - src/app/api/forge/skills/[id]/route.ts
    - src/components/forge/skill-list.tsx
    - src/components/forge/skill-drawer.tsx

- id: SKILL-007
  title: Decay job (pg_cron) + auto-rebaixamento pra anti-pattern
  description: |
    Cron diário recalcula confidenceScore = (success/use) * exp(-days/90).
    Skills com score < 0.2 e useCount >= 3 viram kind='anti-pattern'.
    Skills com useCount=0 por 180d viram archived (não aparecem em recall).
  acceptanceCriteria:
    - "supabase/migrations/20260601g_forge_skill_decay_cron.sql agenda cron diário 03:00 UTC"
    - "Função PL/pgSQL forge_skill_recalc_scores() implementada"
    - "Test manual: insere skill com 10 uses 8 failures 2 success → após cron, kind=anti-pattern"
  verifiable:
    - kind: sql
      command_or_query: "SELECT jobname FROM cron.job WHERE jobname='forge_skill_decay'"
      expected: "forge_skill_decay"
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_proc WHERE proname='forge_skill_recalc_scores'"
      expected: "1"
  dependsOn: [SKILL-001]
  estimateMinutes: 20
  touches:
    - supabase/migrations/20260601g_forge_skill_decay_cron.sql
```

Total: 7 stories, ~175min estimados.
