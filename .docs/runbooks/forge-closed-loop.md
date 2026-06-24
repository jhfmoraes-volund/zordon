```
  ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
  ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
  █████╗  ██║   ██║██████╔╝██║  ███╗█████╗
  ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
  ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
       CLOSED LOOP · HERMES ALIGNMENT · v0
```

# FORGE — Closed Loop (Hermes alignment)

> **Status:** vision doc, não-canônico ainda. Sucessor lógico de **FE-013** (`ForgeLearning`) no PRD `prd-forge-engine`. Quando esse PRD fechar e FE-013 estiver em prod, esta evolução vira PRD próprio (`prd-forge-skill-library`).
>
> **Por que existe:** Nous Research publica **Hermes Agent** com built-in learning loop ("creates skills from experience · improves them during use"). FORGE hoje nasce zero-knowledge a cada autorun — só vê o repo + a Spec. Esta proposta fecha esse gap em 3 fases sem ferir o duplo diamante.

---

## 0 · Princípio

> **Skill = memória procedural reutilizável, produzida por runs, consumida por runs.**

Nem prompt, nem documentação humana. É **artefato** que o agente cria, melhora e descarta. A Spec.md continua sendo a cintura imutável **dentro de** um PRD; a Skill Library é a cintura imutável **entre** PRDs.

---

## 1 · O gap concreto vs Hermes

| Dimensão | Hermes | FORGE hoje | FORGE pós-FE-013 | FORGE alvo (este doc) |
|---|---|---|---|---|
| Memória cross-run | Skill library auto-curada | Nenhuma | Tabela `ForgeLearning` (lessons, profileScope) | Skill library (composable, recall por embedding, telemetria de uso) |
| Recall | FTS5 + LLM summarization | — | `WHERE profileScope = $1` literal | top-K por embedding(story.description) com filtro por profile |
| Evolução | Skill improves during use | — | Linha imutável após insert | `useCount`, `successCount`, `failureCount`, `confidenceScore` recalculados |
| Composição | Skill referencia skill | — | — | `relatedSkillIds[]` + extração automática de menções |
| Promoção | Auto a partir de trajetória | — | Manual via tool `record_learning` | Auto-extração via subagent `LearningExtractor` ao fim de cada run |
| Decaimento | Skill cai se não usada | — | — | `lastUsedAt` + score com decay exponencial |

**Resumo:** FE-013 é o **degrau 1** — habilita escrita de lições e leitura literal por profile. Hermes-alignment é o **degrau 2** — recall semântico + evolução + composição.

---

## 2 · Arquitetura proposta (degrau 2)

```
┌──────────────────────────────────────────────────────────────┐
│                       FORGE Closed Loop                       │
│                                                                │
│   ┌─────────────────┐                                          │
│   │  Story Picker   │  ────►  embed(story.description)         │
│   └─────────────────┘                  │                       │
│                                         ▼                       │
│   ┌─────────────────┐         ┌──────────────────────┐          │
│   │   Skill Recall  │ ◄────── │  ForgeSkill (pgvector)│          │
│   │  top-K by embed │         │  + ForgeLearning      │ (FE-013) │
│   └─────────────────┘         └──────────────────────┘          │
│            │                                                     │
│            ▼                                                     │
│   ┌─────────────────┐                                            │
│   │ Prompt builder  │   "KNOWN PATTERNS:\n  - {skill.title}\n   │
│   │                 │    {skill.body}\n   ..."                   │
│   └─────────────────┘                                            │
│            │                                                     │
│            ▼                                                     │
│   ┌─────────────────┐    tool_use: record_learning, use_skill   │
│   │   Worker run    │ ─────►  events.jsonl                       │
│   └─────────────────┘                                            │
│            │                                                     │
│            ▼  (post-run hook)                                    │
│   ┌──────────────────────┐                                       │
│   │ LearningExtractor    │  haiku-4.5, lê events.jsonl,          │
│   │  (subagent)          │  emite { skill_candidates, lessons }  │
│   └──────────────────────┘                                       │
│            │                                                     │
│            ▼                                                     │
│   ┌──────────────────────┐                                       │
│   │ Skill Promoter       │  candidatos com ≥2 ocorrências        │
│   │  (auto+manual gate)  │  + telemetria positiva → ForgeSkill   │
│   └──────────────────────┘                                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 3 · Tabelas (degrau 2 — depende de FE-003 e FE-013)

```sql
-- Skill library propriamente — entidade durável
CREATE TABLE "ForgeSkill" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text NOT NULL,
  bodyMd          text NOT NULL,                  -- corpo da skill (recipe)
  kind            text NOT NULL CHECK (kind IN ('recipe','pattern','anti-pattern','runbook')),
  profileScope    text[] DEFAULT '{}',            -- ['db','api'] etc; vazio = qualquer
  domainTags      text[] DEFAULT '{}',            -- ['auth','payments','forge']
  embedding       vector(1536),                   -- pgvector — para recall semântico
  sourceRunId     uuid REFERENCES "ForgeRun"(id) ON DELETE SET NULL,
  sourceStoryId   text,                           -- ex: "FE-007"
  promotedFromLearningId uuid REFERENCES "ForgeLearning"(id) ON DELETE SET NULL,
  useCount        int NOT NULL DEFAULT 0,
  successCount    int NOT NULL DEFAULT 0,
  failureCount    int NOT NULL DEFAULT 0,
  confidenceScore numeric(4,3) NOT NULL DEFAULT 0.5,  -- 0..1, recalculado
  lastUsedAt      timestamptz,
  createdAt       timestamptz NOT NULL DEFAULT now(),
  updatedAt       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "ForgeSkill" USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON "ForgeSkill" USING gin (profileScope);

-- Telemetria de uso: quem usou que skill em que run
CREATE TABLE "ForgeSkillUsage" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skillId     uuid NOT NULL REFERENCES "ForgeSkill"(id) ON DELETE CASCADE,
  runId       uuid NOT NULL REFERENCES "ForgeRun"(id) ON DELETE CASCADE,
  taskId      uuid REFERENCES "ForgeTask"(id) ON DELETE SET NULL,
  outcome     text NOT NULL CHECK (outcome IN ('helped','neutral','blocked','unused')),
  evidenceMd  text,                              -- citação curta do trecho que comprovou
  createdAt   timestamptz NOT NULL DEFAULT now()
);
```

**RLS:** `createdBy` + projeto, igual ForgeLearning. Skills são por organização, não globais ainda (V2: pool compartilhado entre clientes).

---

## 4 · Tool API (worker side)

Hoje (FE-013): `record_learning({ lesson, severity })`
Acrescentar (degrau 2):

```ts
// Antes de tentar abordagem nova, peço uma recall focada
recall_skills({
  query: string,                  // texto livre, ex: "como adicionar coluna jsonb com index gin"
  profile?: string,               // 'db' | 'api' | ...
  domain?: string[],              // ['supabase','migration']
  topK?: number                   // default 3
}): Array<{ skillId, title, bodyMd, confidence }>

// Reporta uso explícito de skill (alimenta telemetria)
use_skill({
  skillId: string,
  outcome: 'helped' | 'neutral' | 'blocked',
  evidence?: string               // ex: "usei o pattern X linha 42-50"
}): void

// Continua existindo, mas agora pode opcionalmente promover
record_learning({
  lesson: string,
  severity: 'low' | 'medium' | 'high',
  proposeAsSkill?: boolean        // worker sugere; gate humano ou auto-rule promove
}): { learningId, skillCandidate?: boolean }
```

---

## 5 · Auto-promoção (LearningExtractor)

Post-run, subagent `LearningExtractor` (haiku-4.5, ~300 tokens) lê `events.jsonl` filtrado por `tool_use` + `assistant_text`:

- Identifica **decisões cruciais** ("escolhi X porque Y") → candidato a skill
- Identifica **erros recuperados** ("tentei A, falhou; B funcionou") → candidato a anti-pattern
- Identifica **referências a docs/specs** → candidato a runbook resumido

Output:
```json
{
  "lessonCandidates": [{ "text": "...", "severity": "medium" }],
  "skillCandidates": [{ "title": "...", "kind": "recipe", "bodyMd": "...", "profileScope": ["db"] }]
}
```

Promoção automática quando: skill candidate aparece em ≥2 runs distintos OU run de origem fecha com `verifiable: all passes`.

---

## 6 · Decay & garbage collection

Score recalculado periodicamente (cron diário):

```
confidenceScore = (successCount / max(useCount, 1))
                * exp(-daysSinceLastUse / 90)
```

Skill com `confidenceScore < 0.2` e `useCount >= 3`: marcada `kind = 'anti-pattern'` automaticamente (continua disponível, mas como aviso no prompt em vez de exemplo).

Skill com `useCount == 0` por 180 dias: arquivada (não some, mas sai do recall).

---

## 7 · Fases de adoção

| Fase | Quando | Entrega |
|---|---|---|
| 0 (hoje) | FE-013 done | `ForgeLearning` table + `record_learning` tool + planner injeta literal por profile |
| 1 | PRD `prd-forge-skill-library` | `ForgeSkill` + `ForgeSkillUsage` tables, `recall_skills`/`use_skill` tools, embedding via pgvector, prompt builder lê das duas tabelas |
| 2 | PRD `prd-forge-learning-extractor` | Subagent post-run que auto-extrai candidatos; promoção manual via UI |
| 3 | PRD `prd-forge-skill-evolution` | Decay job (pg_cron), auto-degradação para anti-pattern, sharing cross-projeto |

Cada fase é um PRD próprio, escrito quando a anterior estabiliza. **Não é o roadmap do `prd-forge-engine`.**

---

## 8 · O que esta proposta NÃO faz

- **Não substitui Spec.md.** Spec é o contrato intra-PRD; Skill é memória cross-PRD.
- **Não toca o Duplo Diamante.** Continua: Vitor entende → Spec.md → workers constroem. Skill apenas torna os workers menos amnésicos.
- **Não adiciona dependência runtime nova além de pgvector** (já tem `vector` extension habilitável no Supabase).
- **Não muda o filesystem-as-state do PRD pipeline.** Apenas adiciona DB tables paralelas.
- **Não introduz containerização** (Modal/Daytona-style). Workers continuam local até que multi-máquina vire problema real.

---

## 9 · Próximo passo cronológico

1. Deixar `prd-forge-engine` rodar até FE-013 fechar (ForgeLearning entra em prod).
2. Observar 2-3 runs reais usando learnings literais — coletar evidência de quanto isso já ajuda.
3. Se ROI claro: abrir PRD `prd-forge-skill-library` baseado no §3 acima.
4. Se ROI fraco: revisitar premissas — talvez learnings literais bastem por mais tempo.

> **Regra de ouro:** Hermes-alignment é convite, não meta. Forge alcança Hermes-style **se e quando** o gap doer. Hoje a dor é UI single-run invisível (resolvido em FE-010), não falta de memória entre runs.

---

## 10 · Referências

- Hermes Agent (Nous Research): https://hermes-agent.nousresearch.com/docs/ — built-in learning loop, FTS5 recall, scheduled automations.
- pgvector docs: https://github.com/pgvector/pgvector — ivfflat index, cosine similarity.
- FE-013 spec: `scripts/ralph/features/forge-engine/prd.json` → `userStories[id=FE-013]`.
- Forge runbook canônico: [docs/runbooks/forge-runbook.md](forge-runbook.md).
- Duplo Diamante Agêntico: memory `project_forge_double_diamond.md`.
