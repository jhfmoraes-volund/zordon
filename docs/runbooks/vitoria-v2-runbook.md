```
  ██╗   ██╗██╗████████╗ ██████╗ ██████╗ ██╗ █████╗     ██╗   ██╗██████╗
  ██║   ██║██║╚══██╔══╝██╔═══██╗██╔══██╗██║██╔══██╗    ██║   ██║╚════██╗
  ██║   ██║██║   ██║   ██║   ██║██████╔╝██║███████║    ██║   ██║ █████╔╝
  ╚██╗ ██╔╝██║   ██║   ██║   ██║██╔══██╗██║██╔══██║    ╚██╗ ██╔╝██╔═══╝
   ╚████╔╝ ██║   ██║   ╚██████╔╝██║  ██║██║██║  ██║     ╚████╔╝ ███████╗
    ╚═══╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝      ╚═══╝  ╚══════╝
         COPILOTO DE PLANNING DE ELITE · ZRD · v2
```

# VITORIA V2 — Runbook

> **Este documento é a execução.** Não descreve a v2. **É** a v2 sendo construída.
> Você abre, executa, e o agente martela até o BOSS cair.
> Não há saída neutra: cada fase fecha com gate; gate falha = volta ao loop;
> gate passa = avança. Termina só quando o eval suite passa em ≥80% e
> a planning de smoke roda do início ao fim sem intervenção humana.

> **Plano**: [`docs/agents/vitoria/vitoria-v2-plan.md`](../agents/vitoria/vitoria-v2-plan.md).
> **Companion**: [`docs/agents/vitoria/intelligence-plan.md`](../agents/vitoria/intelligence-plan.md) (assume F0-F1.5 prontas).
> **Convenção de commit**: `ZRD-JM-NN: vitoria-v2 — <fase> — <slug>`.
> **Push**: `bash scripts/sync-main.sh -m "..."` (default, todos os remotes).
> **Migrations**: `psql "$DIRECT_URL" -f supabase/migrations/<file>.sql` + `npx supabase gen types`.

---

## 0 · MANIFESTO (LEIA ANTES DE MARTELAR)

```
NOME           VITORIA v2
TIPO           Orquestradora multi-especialista de planning
CÓDIGO         vitoria-v2
ROTA           /planning/[id]                (chat + side-sheets)
ACESSO         access_level >= builder       (read), >= manager (commit)
TOM            objetivo, em pt-BR, com confidence labels visíveis
MODELO ROOT    anthropic/claude-sonnet-4-6   (era haiku-4-5 — promovida)
SUB-LLMs       sonnet (drafter, conflict, forecaster) | haiku (source, reflector)
PIPELINE       abertura proativa → discussão gated → pré-commit forecast
```

**Manifesto de inteligência (não-negociável):**

1. **Decomposição funcional.** Uma responsabilidade por especialista. Especialista que faz 2 coisas se quebra em 2.
2. **Ciclo de aprendizado fechado.** Toda escrita gera `AgentProposalOutcome`. Toda sprint completed gera `SprintOutcome`. Vitoria lê o histórico do projeto no `loadContext`.
3. **Gates bloqueiam, não avisam.** Capacity Gate e Conflict Detector falham `propose_task_action` com erro estruturado. Não é prompt rule.
4. **Multi-fonte first-class.** Transcript, planilha, PDF, imagem, Granola, Roam têm Source Reader dedicado. `NormalizedSource` cacheado por planning. Vitoria nunca vê fonte crua.
5. **Confidence + provenance obrigatório.** Toda escrita estruturada carrega `confidence` + `sources[]`. Zod recusa null. Não é regra de prompt — é validação.
6. **Skill ≠ Tool.** Skill é texto progressivo (catálogo no system, content sob demanda). Tool é função TypeScript com side-effect. ~40% do prompt atual vira skill.

**Loop de Forja (aplicado aqui):**

```
1. Pre-condition check     → já existe? skip phase. Não? continue.
2. Implementa diff cirúrgico (1 fase = 1 commit, sem misturar)
3. Gate local: tsc --noEmit + eslint nos arquivos tocados
4. Gate funcional: smoke test descrito na fase
5. Gate falhou? volta ao 2 com diagnóstico. Não pula.
6. Gate passou? commit + push.
7. Avança pra próxima fase.
```

**Regra de ouro**: a fase só fecha quando o gate funcional roda. Type-check sozinho não conta. Smoke test que não pode rodar (ex.: precisa de planning real no DB) vai pra `tests/manual-smoke.md` da fase como TODO explícito do usuário — agente não inventa estado.

---

## 1 · PRÉ-FLIGHT (ESTADO ATUAL · 2026-05-29)

Antes de começar, garantir que dependências do `intelligence-plan` estão prontas:

| Dependência | Verificação | Status atual |
|-------------|-------------|--------------|
| `AgentUsage` table | `psql "$DIRECT_URL" -c "\d \"AgentUsage\""` | ✅ existe (20260529_agent_usage_telemetry) |
| `AgentProposalOutcome` table | `psql "$DIRECT_URL" -c "\d \"AgentProposalOutcome\""` | ✅ existe |
| `wrapWithUsage` helper | `test -f src/lib/agent/usage.ts && echo ok` | ✅ existe |
| `buildProjectProfile` | `test -f src/lib/agent/agents/vitoria/profile.ts && echo ok` | ✅ existe |
| `ProjectFpMatrix` table | `psql "$DIRECT_URL" -c "\d \"ProjectFpMatrix\""` | ❌ não existe (F4 do intelligence-plan não rodou) |
| `Project.repoManifest` col | `psql "$DIRECT_URL" -c "SELECT 'repoManifest'::regclass"` ou `\d "Project"` | ❌ não existe |
| `src/eval/vitoria/` | `test -d src/eval/vitoria && echo ok` | ❌ não existe |
| `src/lib/agent/agents/vitoria/extractors/` | `test -d src/lib/agent/agents/vitoria/extractors && echo ok` | ❌ não existe (sub-agents do intelligence-plan não rodaram) |
| Memória cross-agent shipada | `grep -q "projectMemoryMd" src/lib/agent/agents/vitoria/index.ts` | ✅ shipado em 2026-05-29 |
| `DesignDecision` / `DesignOpenQuestion` / `ProjectBusinessContext` | tabelas + RLS do Vitor | ✅ existem |
| `applyMarkdownMutation` helper | `test -f src/lib/agent/tools/_markdown.ts && echo ok` | ✅ shipado em 2026-05-29 |
| `TranscriptRef.source='spreadsheet'` | `psql -c "SELECT pg_get_constraintdef… WHERE relname='TranscriptRef'"` grep `spreadsheet` | ✅ shipado em 20260530_transcript_ref_spreadsheet — planilhas reusam TranscriptRef em vez de PlanningAttachment nova |
| `PlanningContextNote.kind='scope_creep'` + `generatedByAgent='vitoria'` | `psql -c "SELECT pg_get_constraintdef… WHERE relname='PlanningContextNote'"` | ✅ shipado em 20260529c_planning_context_note_vitoria (pre-G2, habilita eval case-07) |

**Bloqueio**: nenhum hard. Mas dois pré-requisitos podem ser pulados se ainda não rodaram:
- `intelligence-plan` F3 (`extract_planning_proposals`) — opcional, v2 cria caminho alternativo via Source Reader + Task Drafter.
- `intelligence-plan` F4 (`estimate_task` + `ProjectFpMatrix`) — opcional, Task Drafter v2 estima inline.

**Caminho recomendado**: começar direto pelo runbook v2 sem voltar pra fechar F3/F4 — v2 supera ambos.

---

## 2 · BOSS LIST (CONDIÇÕES DE VITÓRIA)

Termina quando **todas** caem:

1. **BOSS-EVAL**: `pnpm eval:vitoria` passa em ≥80% dos 10 cenários.
2. **BOSS-SMOKE**: planning real com 1 transcript + 1 planilha + 1 PDF roda do início ao commit sem intervenção; PM clica e ações aplicam.
3. **BOSS-CAPACITY**: tentativa de propor FP > 110% capacity retorna erro estruturado pro modelo, modelo reduz scope sozinho.
4. **BOSS-CONFLICT**: existe `DesignDecision active` "X fora do MVP"; PM pede algo que toca X; Vitoria abre conversa de revise_decision em vez de propor.
5. **BOSS-FORECAST**: ao fim de planning com 35 FP planejados e histórico de 5 sprints com ratio 0.7, banner mostra "p50=24 FP, p90=32 FP".
6. **BOSS-COST**: custo médio por planning em 7 dias ≤ $0.80 (com cache hit ≥70%).
7. **BOSS-CONFIDENCE**: 100% das propostas com `confidence` + `sources[]` no payload (validação Zod).

---

## 3 · FASE G0 · EVAL SUITE + OUTCOME WIRING

**Por quê primeiro**: sem baseline, "ficou melhor" é fé. Sem outcome wiring, especialistas seguintes não têm feedback.

### Pre-condition

```bash
# Skip se ambos passarem:
test -d src/eval/vitoria && \
test -f src/eval/vitoria/runner.ts && \
psql "$DIRECT_URL" -c "SELECT 1 FROM \"AgentProposalOutcome\" LIMIT 1" 2>&1 | grep -q "1 row" && \
echo "G0 já feito, skip" || echo "G0 precisa rodar"
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/eval/vitoria/types.ts` | NOVO | `EvalScenario { name, setup, turns, expected }`. Espelha [`src/eval/vitor/types.ts`](../../src/eval/vitor/types.ts). |
| `src/eval/vitoria/runner.ts` | NOVO | Lê yaml/ts scenarios em `cases/`, monta agentContext sintético, roda `vitoriaAgent` headless, valida `expected` via match/regex/tool-called. Espelha [`src/eval/vitor/runner.ts`](../../src/eval/vitor/runner.ts). |
| `src/eval/vitoria/cases/01-capacity-overflow.ts` | NOVO | Cenário 1 — sprint full, PM pede +5 tasks. Espera: gate retorna erro, modelo reduz scope. |
| `src/eval/vitoria/cases/02-decision-contradiction.ts` | NOVO | Cenário 2 — DesignDecision "iOS fora" ativa, PM pede iOS. Espera: Vitoria abre conversa, não propõe direto. |
| `src/eval/vitoria/cases/03-spreadsheet-totals.ts` | NOVO | Cenário 3 — planilha de OKRs com total. Espera: Vitoria cita total correto sem alucinação. |
| `src/eval/vitoria/cases/04-transcript-long.ts` | NOVO | Cenário 4 — transcript 60min. Espera: ≥3 signals identificados. |
| `src/eval/vitoria/cases/05-source-empty.ts` | NOVO | Cenário 5 — transcript marca `confidence: 'metadata_only'`. Espera: Vitoria avisa PM, não inventa. |
| `src/eval/vitoria/cases/06-multi-source.ts` | NOVO | Cenário 6 — planilha + transcript que se sobrepõem. Espera: 1 signal consolidado, não 2 duplicados. |
| `src/eval/vitoria/cases/07-scope-creep.ts` | NOVO | Cenário 7 — PM diz "podemos incluir relatórios" no fim. Espera: nota `scope_creep`. |
| `src/eval/vitoria/cases/08-edit-proposal.ts` | NOVO | Cenário 8 — PM pede ajuste de prioridade. Espera: `update_proposed_action` com ID correto. |
| `src/eval/vitoria/cases/09-deletion.ts` | NOVO | Cenário 9 — PM rejeita. Espera: `delete_proposed_action` + `AgentProposalOutcome.decision='deleted'`. |
| `src/eval/vitoria/cases/10-forecast-precommit.ts` | NOVO | Cenário 10 — fim de planning. Espera: `forecast_sprint` chamado, banner gerado. |
| `src/eval/vitoria/README.md` | NOVO | Como rodar (`pnpm eval:vitoria`), como adicionar cenário. |
| `package.json` | EDIT | Script `"eval:vitoria": "tsx src/eval/vitoria/runner.ts"`. |
| `src/lib/meetings/task-action-executor.ts` | EDIT | Confirmar que `AgentProposalOutcome` é inserido em accepted/edited/deleted (já planejado em F1.5 — validar). |

### Gates

```bash
# Type-check
npx tsc --noEmit 2>&1 | grep -E "src/eval/vitoria|task-action-executor" && echo FAIL || echo PASS

# Lint
npx eslint src/eval/vitoria/ src/lib/meetings/task-action-executor.ts 2>&1 | grep "error" && echo FAIL || echo PASS

# Smoke
pnpm eval:vitoria 2>&1 | tail -20
# expect: "10 cenários, X passaram, Y falharam" — número baseline, NÃO precisa ser ≥80% aqui.
# Apenas: runner roda sem crash e gera relatório.
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G0 — eval suite + outcome wiring baseline"
```

---

## 4 · FASE G1 · SOURCE READERS + CACHE

**Por quê**: multi-fonte first-class. Sem isso, todos os especialistas seguintes operam em texto crú = perda de qualidade + token.

### Pre-condition

```bash
test -d src/lib/agent/agents/vitoria/sources && \
psql "$DIRECT_URL" -c "\d \"PlanningSourceCache\"" 2>&1 | grep -q "Table" && \
echo "G1 já feito, skip" || echo "G1 precisa rodar"
```

### Migration

```sql
-- supabase/migrations/<YYYYMMDD>_planning_source_cache.sql
CREATE TABLE "PlanningSourceCache" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningId"    uuid NOT NULL REFERENCES "PlanningCeremony"(id) ON DELETE CASCADE,
  "sourceKind"    text NOT NULL CHECK ("sourceKind" IN ('transcript','spreadsheet','attachment','granola','roam','image','pdf')),
  "sourceRef"     text NOT NULL,                      -- id externo ou interno
  "normalizedJson" jsonb NOT NULL,                    -- NormalizedSource serializado
  "readerVersion" int NOT NULL DEFAULT 1,             -- bump quando schema muda
  "computedAt"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("planningId", "sourceKind", "sourceRef")
);

CREATE INDEX ON "PlanningSourceCache" ("planningId");

-- RLS: lê pelo can_view_planning, escreve pelo can_edit_planning ou service-role.
ALTER TABLE "PlanningSourceCache" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PSC_read" ON "PlanningSourceCache"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "PlanningCeremony" pc
      WHERE pc.id = "planningId" AND can_view_project(pc."projectId")
    )
  );
CREATE POLICY "PSC_write" ON "PlanningSourceCache"
  FOR ALL USING (false) WITH CHECK (false);  -- só service-role escreve
```

Rodar: `psql "$DIRECT_URL" -f supabase/migrations/<date>_planning_source_cache.sql && npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts`.

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/agents/vitoria/sources/types.ts` | NOVO | `NormalizedSource`, `InferredSignal`, `SourceReader<T>` interface. |
| `src/lib/agent/agents/vitoria/sources/transcript-reader.ts` | NOVO | Speaker-aware parser. Detecta utterances → topics → signals. Sub-LLM (Haiku) pra signal classification. |
| `src/lib/agent/agents/vitoria/sources/spreadsheet-reader.ts` | NOVO | Markdown table → JSON. `inferredSchema` por coluna (date/money/status/text). Totais determinísticos via parse numérico. |
| `src/lib/agent/agents/vitoria/sources/pdf-reader.ts` | NOVO | `unpdf` parse → pages[]. Detecção de tabelas via regex de pipes/spaces. |
| `src/lib/agent/agents/vitoria/sources/image-reader.ts` | NOVO | Claude vision via OpenRouter (`anthropic/claude-sonnet-4-6` com input image). Opt-in via `attachment.analyze_image=true`. |
| `src/lib/agent/agents/vitoria/sources/granola-reader.ts` | NOVO | Parser do payload Granola → `NormalizedSource`. |
| `src/lib/agent/agents/vitoria/sources/roam-reader.ts` | NOVO | DFS no bloco → tree → headings/todos/decisions. |
| `src/lib/agent/agents/vitoria/sources/index.ts` | NOVO | `normalizeSource(ref): Promise<NormalizedSource>` — dispatcher + cache check (read PlanningSourceCache before recomputing). |
| `src/lib/agent/agents/vitoria/index.ts` (`loadContext`) | EDIT | Pre-warm cache: pra cada linked source, chama `normalizeSource` em paralelo. Resultado entra em `agentContext.normalizedSources`. |
| `src/lib/agent/agents/vitoria/tools.ts` | EDIT | `read_transcript_content` agora devolve `NormalizedSource` (não `fullText`). Cobre transcripts E spreadsheets — migration `20260530_transcript_ref_spreadsheet` já fez spreadsheet entrar como `TranscriptRef.source='spreadsheet'`, sem tool nova. |
| `src/lib/agent/agents/vitoria/prompt.ts` | EDIT | Bloco "Fontes normalizadas" no volátil. Skill `multi_source_synthesis_patterns` referenciada (criada em G2). |
| `package.json` | EDIT | Adiciona deps: `unpdf` (PDF), `papaparse` (CSV se needed). |

### Gates

```bash
# Migration ok
psql "$DIRECT_URL" -c "\d \"PlanningSourceCache\"" | grep -q "planningId" && echo PASS || echo FAIL

# Type-check
npx tsc --noEmit 2>&1 | grep -E "vitoria/sources|vitoria/index|vitoria/tools" && echo FAIL || echo PASS

# Lint
npx eslint src/lib/agent/agents/vitoria/ 2>&1 | grep "error" && echo FAIL || echo PASS

# Smoke: fixture com 1 transcript + 1 markdown table
# Cria script `scripts/dev/smoke-source-reader.ts` que lê fixture em src/eval/vitoria/fixtures/ e chama normalizeSource.
# expect: NormalizedSource com kind, structuredData, narrativeText, ≥1 inferredSignal.
npx tsx scripts/dev/smoke-source-reader.ts 2>&1 | tail -10
```

### Live-mode wire (entra junto na G1)

G0 deixou eval em dry-run. G1 introduz Source Readers que **só** dão pra avaliar live — então o `live.ts` entra no mesmo commit (substitui o `scripts/dev/smoke-source-reader.ts` isolado):

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/eval/vitoria/live.ts` | NOVO | Espelha `src/eval/vitor/live.ts`. Seed: Client + Project + Sprint + Squad + Member + PlanningCeremony + TranscriptRef(s) + PlanningTranscriptLink(s) + opcional MeetingTaskAction. Tag `__eval__`. Cleanup cascade no fim. |
| `src/eval/vitoria/runner.ts` | EDIT | Wire `--live` (hoje retorna exit 2). Dispatcher pra `runLive`. Budget cap = 5 cases. |
| `src/eval/vitoria/judge.ts` | EDIT | Suporta `caseFilter`, `--keep` pra inspeção. |

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G1 — source readers + PlanningSourceCache + live.ts wired"
```

---

## 5 · FASE G2 · SKILL CATALOG PROGRESSIVO

**Por quê**: ~40% do prompt atual da Vitoria é checklist/playbook que devia ser skill. Reduz tokens em ~30%+ e torna conhecimento editável.

### Pre-condition

```bash
test -f src/lib/agent/skills.ts && \
psql "$DIRECT_URL" -c "\d \"AgentSkill\"" 2>&1 | grep -q "Table" && \
echo "G2 já feito, skip" || echo "G2 precisa rodar"
```

### Migration

```sql
-- supabase/migrations/<YYYYMMDD>_agent_skill.sql
CREATE TABLE "AgentSkill" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug"   text NOT NULL,
  name          text NOT NULL,
  description   text NOT NULL,
  content       text NOT NULL,
  tags          text[],
  "version"     int NOT NULL DEFAULT 1,
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("agentSlug", name)
);

CREATE INDEX ON "AgentSkill" ("agentSlug");

ALTER TABLE "AgentSkill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AS_read" ON "AgentSkill" FOR SELECT USING (true);   -- read público p/ user logado
CREATE POLICY "AS_write" ON "AgentSkill" FOR ALL USING (is_manager()) WITH CHECK (is_manager());
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/skills.ts` | NOVO | `listSkills(agentSlug)` (só name+description), `loadSkill(name)` (full content). Cache 5min in-memory. |
| `scripts/seed/vitoria-skills.ts` | NOVO | Seed dos 8 skills iniciais (lista abaixo). Idempotente — upsert por `(agentSlug, name)`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | EDIT | Remove ~40% (extraído pra skills). Adiciona catálogo `## Skills disponíveis\n- name: desc\n...`. |
| `src/lib/agent/agents/vitoria/tools.ts` | EDIT | Tool `load_skill(name)` que retorna content. |
| `src/app/(dashboard)/admin/agent-skills/page.tsx` | NOVO | Lista skills com filtro por agente + botão edit. |
| `src/components/admin/agent-skill-editor.tsx` | NOVO | Editor markdown + diff de versão. |

**8 skills iniciais** (criar como arquivos `.md` em `scripts/seed/vitoria-skills/` ou inline no seed):
- `propose_task_quality_checklist`
- `spreadsheet_interpretation_patterns`
- `transcript_signal_taxonomy`
- `sdd_description_template`
- `confidence_labeling_rubric`
- `capacity_overflow_resolution_playbook`
- `decision_contradiction_handoff`
- `multi_source_synthesis_patterns`

Cada skill = 1 arquivo markdown 200-500 linhas com:
```markdown
# <name>

> <description em 1 linha>

## Quando usar
...

## Padrões
...

## Antipadrões
...

## Exemplos
...
```

### Gates

```bash
psql "$DIRECT_URL" -c "SELECT count(*) FROM \"AgentSkill\" WHERE \"agentSlug\" = 'vitoria'" | grep -q "8" && echo PASS || echo FAIL
npx tsc --noEmit 2>&1 | grep -E "skills|admin/agent-skills" && echo FAIL || echo PASS

# Smoke: chamar loadSkill e medir tokens do prompt antes/depois.
# Salvar baseline em src/eval/vitoria/token-budget.json (input_tokens médio).
# Threshold: redução de ≥25% no input_tokens médio do system prompt.
npx tsx scripts/dev/smoke-token-budget.ts 2>&1 | tail -5
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G2 — skill catalog progressivo + 8 skills seed"
```

---

## 6 · FASE G3 · CAPACITY GATE COMO BLOQUEIO

**Por quê**: hoje `get_sprint_capacity` é sugestão. Vitoria pode propor 80 FP em sprint de 30. Gate hard.

### Pre-condition

```bash
test -f src/lib/agent/agents/vitoria/gates/capacity-gate.ts && \
echo "G3 já feito, skip" || echo "G3 precisa rodar"
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/agents/vitoria/gates/types.ts` | NOVO | `GateResult { pass, blockers[], suggestion?, metadata? }`. |
| `src/lib/agent/agents/vitoria/gates/capacity-gate.ts` | NOVO | `runCapacityGate({ projectId, sprintId, deltaFp, assigneeMemberId? }): Promise<GateResult>`. Math determinístico. LLM (Haiku) só pra formatar blocker text quando `pass=false`. |
| `src/lib/agent/agents/vitoria/tools.ts` | EDIT | `propose_task_action` quando `type in ['create','move']` e payload.functionPoints > 0 chama `runCapacityGate` antes do INSERT. Falha estruturada: `{ ok: false, gate: 'capacity', blockers, suggestion }`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | EDIT | Skill `capacity_overflow_resolution_playbook` referenciada — modelo aprende a chamar quando gate retorna fail. |
| `src/eval/vitoria/llm-judge.ts` | NOVO | Espelha [`src/eval/vitor/llm-judge.ts`](../../src/eval/vitor/llm-judge.ts). Haiku via OpenRouter, ~50 tokens/case. Avalia `judgeRubric` quando rule-based passa — sem isso cases 01/02/06/10 ficam em `partial` permanente. Custo total: ~$0.01/run cheio. |
| `src/eval/vitoria/judge.ts` | EDIT | Quando rule-based passa + tem judgeRubric + `--llm-judge` flag, escala pro LLM judge antes de selar pass/partial. |

### Gates

```bash
npx tsc --noEmit 2>&1 | grep -E "gates/capacity|vitoria/tools|llm-judge" && echo FAIL || echo PASS

# Smoke (eval scenario 01) — agora com LLM judge habilitado
pnpm eval:vitoria -- --live --case=capacity-overflow --llm-judge 2>&1 | tail -10
# expect: scenario pass — modelo recebe erro estruturado, propõe menos tasks; LLM judge confirma rubric.
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G3 — capacity gate como bloqueio em propose_task_action"
```

---

## 7 · FASE G4 · CONFLICT DETECTOR

**Por quê**: existe `DesignDecision` ativa, PM pede algo que contradiz, Vitoria precisa **detectar** e **escalonar** (não propor direto).

### Pre-condition

```bash
test -f src/lib/agent/agents/vitoria/specialists/conflict-detector.ts && \
echo "G4 já feito, skip" || echo "G4 precisa rodar"
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/agents/vitoria/specialists/conflict-detector.ts` | NOVO | `detectConflicts({ proposalDraft, activeDecisions, openQuestions }): Promise<GateResult & { conflicts[] }>`. Sonnet via `generateObject`. Envolto em `wrapWithUsage({callKind: 'conflict_detect'})`. |
| `src/lib/agent/agents/vitoria/tools.ts` | EDIT | `propose_task_action` chama `detectConflicts` quando proposal tags intersectam decision tags **ou** payload contém keywords (`iOS`, `mobile`, `pagamento`, ...). Severity `blocking` falha; `warning` segue mas anexa em `aiReasoning`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | EDIT | Skill `decision_contradiction_handoff` — comportamento de abrir conversa de `revise_decision` quando blocking. |
| `src/lib/agent/tools/memory.ts` | EDIT (já exporta `createReviseDecisionTool`) | Confirmar export e reusar em Vitoria — `vitoriaAgent.buildTools` inclui `revise_decision`. **RLS**: garantir que `DesignDecision` aceita UPDATE quando `auth.uid()` tem `can_edit_project(projectId)` (não só `can_edit_session`) — Vitoria escreve no contexto de Planning, não de DesignSession. Migration auxiliar se policy atual restringir a sessionId. |

### Gates

```bash
npx tsc --noEmit 2>&1 | grep -E "conflict-detector|vitoria/tools" && echo FAIL || echo PASS

# Smoke (eval scenario 02)
pnpm eval:vitoria -- --case 02-decision-contradiction 2>&1 | tail -10
# expect: Vitoria não propõe direto, abre conversa com 3 opções (reverter, re-escopar, seguir consciente).
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G4 — conflict detector contra DesignDecision ativa"
```

---

## 8 · FASE G5 · TASK DRAFTER CONSOLIDADO + CONFIDENCE OBRIGATÓRIO

**Por quê**: descrição SDD + AC observáveis + confidence label + sources citadas. Sem isso, qualidade da proposta é genérica.

### Pre-condition

```bash
test -f src/lib/agent/agents/vitoria/specialists/task-drafter.ts && \
echo "G5 já feito, skip" || echo "G5 precisa rodar"
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/agents/vitoria/specialists/task-drafter.ts` | NOVO | `draftTask({ proposalDraft, projectProfile, styleProfile, repoManifest?, similarTasks })`. Sonnet via `generateObject`. Schema obriga `confidence`, `sources[]`, `acceptanceCriteria.length >= 3`. Envolto em `wrapWithUsage({callKind: 'task_draft'})`. |
| `src/lib/agent/agents/vitoria/tools.ts` | EDIT | `enrich_proposal(actionId)` chama `draftTask`. `propose_task_action.payload` schema agora exige `confidence: 'hard_fact' \| 'inferred' \| 'assumption'` e `sources: [{kind, reference, excerpt?}]`. Zod recusa null. |
| `src/components/planning/proposal-card.tsx` | EDIT | Badge de confidence (verde/amarelo/laranja). Tooltip com sources clicáveis. |
| `src/lib/agent/agents/vitoria/prompt.ts` | EDIT | Skill `sdd_description_template` + `confidence_labeling_rubric` referenciadas. Regra dura: "toda proposta carrega confidence + ≥1 source". |

### Gates

```bash
npx tsc --noEmit 2>&1 | grep -E "task-drafter|proposal-card" && echo FAIL || echo PASS

# Smoke
pnpm eval:vitoria -- --case 06-multi-source 2>&1 | tail -10
# expect: proposta tem description SDD com H2 sections, ≥3 AC observáveis, confidence label, ≥1 source citando location.

# Smoke UI: rodar dev server + abrir planning, propor task, ver badge de confidence no card.
# Esse smoke fica em manual-smoke (não automatizável sem playwright).
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G5 — task drafter + confidence + provenance obrigatório"
```

---

## 9 · FASE G6 · SPRINT FORECASTER

**Por quê**: PM decide tamanho do sprint baseado em chute. Forecaster usa histórico real de delivery.

### Pre-condition

```bash
test -f src/lib/agent/agents/vitoria/specialists/sprint-forecaster.ts && \
psql "$DIRECT_URL" -c "\d \"SprintOutcome\"" 2>&1 | grep -q "Table" && \
echo "G6 já feito, skip" || echo "G6 precisa rodar"
```

### Migration

```sql
-- supabase/migrations/<YYYYMMDD>_sprint_outcome.sql
CREATE TABLE "SprintOutcome" (
  "sprintId"        uuid PRIMARY KEY REFERENCES "Sprint"(id) ON DELETE CASCADE,
  "projectId"       uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "plannedFp"       int  NOT NULL DEFAULT 0,
  "deliveredFp"     int  NOT NULL DEFAULT 0,
  "tasksPlanned"    int  NOT NULL DEFAULT 0,
  "tasksDelivered"  int  NOT NULL DEFAULT 0,
  "tasksOverflowed" int  NOT NULL DEFAULT 0,
  "retrospectiveNotes" text,
  "computedAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "SprintOutcome" ("projectId", "computedAt" DESC);

-- Trigger: quando Sprint vira 'completed', popula SprintOutcome
CREATE OR REPLACE FUNCTION compute_sprint_outcome() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    INSERT INTO "SprintOutcome" ("sprintId", "projectId", "plannedFp", "deliveredFp", "tasksPlanned", "tasksDelivered")
    SELECT
      NEW.id,
      NEW."projectId",
      COALESCE(SUM(t."functionPoints"), 0),
      COALESCE(SUM(CASE WHEN t.status = 'done' THEN t."functionPoints" ELSE 0 END), 0),
      COUNT(*),
      COUNT(*) FILTER (WHERE t.status = 'done')
    FROM "Task" t
    WHERE t."sprintId" = NEW.id AND t."dismissedAt" IS NULL
    ON CONFLICT ("sprintId") DO UPDATE SET
      "plannedFp" = EXCLUDED."plannedFp",
      "deliveredFp" = EXCLUDED."deliveredFp",
      "tasksPlanned" = EXCLUDED."tasksPlanned",
      "tasksDelivered" = EXCLUDED."tasksDelivered",
      "computedAt" = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sprint_outcome
AFTER UPDATE ON "Sprint" FOR EACH ROW
EXECUTE FUNCTION compute_sprint_outcome();

ALTER TABLE "SprintOutcome" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SO_read" ON "SprintOutcome" FOR SELECT USING (can_view_project("projectId"));
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/agents/vitoria/specialists/sprint-forecaster.ts` | NOVO | `forecastSprint({ projectId, sprintId, plannedFp, history })`. Math: `p50 = planned * mean(ratios)`, `p90 = planned * percentile90(ratios)`. Sonnet pra reasoning. Envolto em `wrapWithUsage({callKind: 'forecast'})`. |
| `src/lib/agent/agents/vitoria/tools.ts` | EDIT | Tool `forecast_sprint(sprintId)`. Chama no fim da planning (auto antes do "Concluir"). |
| `src/components/planning/sprint-forecast-banner.tsx` | NOVO | Banner discreto antes do botão "Concluir planning": "Forecast p50/p90 + risk factors". |
| `src/app/(dashboard)/planning/[id]/page.tsx` | EDIT | Mostra banner quando `pendingActions.length > 0 && status='open'`. |

### Gates

```bash
psql "$DIRECT_URL" -c "\d \"SprintOutcome\"" | grep -q "deliveredFp" && echo PASS || echo FAIL
npx tsc --noEmit 2>&1 | grep -E "sprint-forecaster|sprint-forecast-banner" && echo FAIL || echo PASS

# Smoke (eval scenario 10)
pnpm eval:vitoria -- --case 10-forecast-precommit 2>&1 | tail -10
# expect: forecast_sprint chamado, output tem p50/p90/riskFactors.
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G6 — sprint forecaster + SprintOutcome trigger"
```

---

## 10 · FASE G7 · OUTCOME REFLECTOR + CROSS-AGENT ATIVO

**Por quê**: Vitoria precisa aprender com o passado e usar a memória do Vitor **ativamente** (não só ler passivamente).

### Pre-condition

```bash
test -f src/lib/agent/agents/vitoria/specialists/outcome-reflector.ts && \
grep -q "cross_agent_protocol_with_vitor" supabase/migrations/*_agent_skill_seed*.sql 2>/dev/null && \
echo "G7 já feito, skip" || echo "G7 precisa rodar"
```

### Arquivos

| Caminho | Ação | Conteúdo |
|---------|------|----------|
| `src/lib/agent/agents/vitoria/specialists/outcome-reflector.ts` | NOVO | `reflectOutcomes({ projectId, lastN: 5 })`. Haiku. Lê `AgentProposalOutcome` + `SprintOutcome` últimos 30d. Output: `{ summary, patterns: [{ pattern, evidence, confidence }] }` (≤800 tokens). Cache 1h. Envolto em `wrapWithUsage({callKind: 'reflect'})`. |
| `src/lib/agent/agents/vitoria/index.ts` (`loadContext`) | EDIT | Chama `reflectOutcomes(projectId)` em paralelo com outras queries. Entra no contexto como `historicalPatterns`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | EDIT | Nova seção volátil "Histórico de propostas neste projeto". |
| `scripts/seed/vitoria-skills.ts` | EDIT | Adiciona skill `cross_agent_protocol_with_vitor` com 4 regras prescritas (ler memoryMd ao abrir, checar contradição, append em info project-level, escalar open_question). |

### Gates

```bash
npx tsc --noEmit 2>&1 | grep -E "outcome-reflector|vitoria/index" && echo FAIL || echo PASS

# Smoke: criar 5 plannings sintéticas, popular AgentProposalOutcome, rodar reflectOutcomes manualmente.
npx tsx scripts/dev/smoke-outcome-reflector.ts 2>&1 | tail -15
# expect: output com ≥2 patterns identificados.

# Eval suite full
pnpm eval:vitoria 2>&1 | tail -20
# expect: ≥80% pass rate (8 de 10 cenários).
```

### Commit

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — G7 — outcome reflector + cross-agent ativo com Vitor"
```

---

## 11 · BOSS · INTEGRAÇÃO FINAL

Última fase. Não introduz código novo — valida que tudo conecta.

### Pre-condition

Todas as fases G0-G7 commitadas, todos os smokes individuais passando.

### Validação (manual + automatizada)

```bash
# 1. Eval suite completo
pnpm eval:vitoria 2>&1 | tee /tmp/vitoria-v2-final-eval.log
grep -E "passed:.*of 10" /tmp/vitoria-v2-final-eval.log
# pass: ≥8 de 10 cenários.

# 2. Telemetria sanity
psql "$DIRECT_URL" -c "
SELECT
  \"callKind\",
  count(*) as n,
  avg(\"costUsd\") as avg_cost,
  avg(\"cachedInputTokens\"::float / NULLIF(\"inputTokens\", 0)) as cache_ratio
FROM \"AgentUsage\"
WHERE \"agentSlug\" = 'vitoria'
  AND \"createdAt\" > now() - interval '1 day'
GROUP BY \"callKind\";
"
# expect: callKind cobrindo turn, conflict_detect, task_draft, forecast, reflect, source_normalize.
# cache_ratio: turn ≥ 0.7.

# 3. Outcome wiring sanity
psql "$DIRECT_URL" -c "
SELECT decision, count(*)
FROM \"AgentProposalOutcome\"
WHERE \"agentName\" = 'vitoria' AND \"decidedAt\" > now() - interval '7 days'
GROUP BY decision;
"
# expect: rows com decision in [accepted, edited, deleted].

# 4. Smoke real (manual)
# - Abrir planning de dev com 1 transcript + 1 planilha
# - Vitoria abre proativa lendo as 2 sources + outcome reflector
# - PM pede capacidade que estoura sprint → Capacity Gate barra
# - PM pede algo contra DesignDecision → Conflict Detector abre conversa
# - PM aprova 3 propostas → cards têm confidence + sources
# - Antes de commit → Forecast banner aparece
# - PM clica Concluir → tasks aplicam, AgentProposalOutcome populado
```

### BOSS LIST — verificação final

- [ ] **BOSS-EVAL**: `pnpm eval:vitoria` ≥80% pass rate.
- [ ] **BOSS-SMOKE**: planning real do início ao commit sem intervenção.
- [ ] **BOSS-CAPACITY**: 110% overflow retorna erro estruturado, modelo reduz.
- [ ] **BOSS-CONFLICT**: contradição abre conversa de revise_decision.
- [ ] **BOSS-FORECAST**: banner p50/p90 aparece com risk factors.
- [ ] **BOSS-COST**: avg $/planning em 7d ≤ $0.80, cache hit ≥70%.
- [ ] **BOSS-CONFIDENCE**: 100% das propostas com confidence + sources (Zod recusa null).

### Commit final

```bash
bash scripts/sync-main.sh -m "vitoria-v2 — BOSS — integração final + validação"
```

Atualiza `docs/agents/vitoria/intelligence-plan.md` com seção "v2 shipado em <data>" apontando pro runbook v2-plan.md.

---

## 12 · LOOP DE RECUPERAÇÃO (QUANDO O GATE FALHA)

```
Gate falhou.
  ├─ Diagnóstico: ler tail do log, identificar arquivo + erro exato.
  ├─ Não bypassar (sem --no-verify, sem disable de lint, sem skip de eval).
  ├─ Aplicar fix cirúrgico no arquivo identificado.
  ├─ Rodar gate de novo.
  ├─ Loop até gate passar.
  └─ Se 3 tentativas falharem com mesmo erro → PARA, pede revisão do plano.
```

**Não pular gate**:
- Gate `tsc --noEmit` falha → não comita.
- Gate eslint falha (error, não warning) → não comita.
- Gate funcional falha → não comita.
- Smoke manual marcado TODO no manual-smoke.md → ok comitar se outros gates passaram, mas BOSS-SMOKE no final precisa rodar manualmente.

**Sinais de "plano errado, não falha de execução"**:
- 3+ tentativas com erro estrutural diferente em cada uma → plano subestimou complexidade, escala pra usuário.
- Smoke passa mas eval cai abaixo do baseline → regressão. Volta a fase anterior.
- Custo médio sobe ≥2x sem melhora de qualidade → especialista mal calibrado. Volta a fase, revisa modelo (Sonnet → Haiku ou vice).

---

## 13 · PÓS-BOSS (BACKLOG DEPOIS DA V2 SAIR)

Não rodar como parte do runbook — anotar pra próximas iterações:

- **G8 — Vector embeddings dos `NormalizedSource`** pra busca semântica cross-planning.
- **G9 — Specialist Marketplace** — generalizar specialists pra outros agents (Capacity Gate reusável).
- **G10 — Hot-reload de skills** sem deploy (server-sent invalidation).
- **G11 — Fine-tune** com `AgentProposalOutcome` após 3 meses de dados.
- **G12 — Vitoria escreve em DesignSession.memoryMd** (não só Project.memoryMd) com conflict resolution.

---

## 14 · DEPENDÊNCIAS DE INFRA

- `OPENROUTER_API_KEY` — modelo Sonnet/Haiku.
- `DIRECT_URL` — migrations.
- `Redis` (opcional) — cache de `PlanningSourceCache` reads / outcome reflector cache. Fallback: in-memory.
- `unpdf` (G1) — npm install.
- `playwright` (opcional, smoke UI) — não-bloqueante.

---

## 15 · ROADMAP VISUAL

```
G0 (6h)  →  G1 (8h)  →  G2 (3h)  →  G3 (3h)  →  G4 (4h)  →  G5 (4h)  →  G6 (4h)  →  G7 (3h)  →  BOSS (1h)
eval +      source       skill       capacity   conflict   drafter   forecast   reflector   integration
outcome     readers      catalog     hard       detector   +badges   sprint     + cross-    final
wiring      + cache                  block                                      agent
```

**Total realista**: ~36h.
**Custo de tokens estimado em dev/eval**: ~$50 (Sonnet para drafter/conflict/forecast, Haiku para resto, eval suite ~$5).

---

## 16 · CONVENÇÕES (RECAP)

- **Commit**: `ZRD-JM-NN: vitoria-v2 — <fase> — <slug>` via `bash scripts/sync-main.sh -m "..."`.
- **Migration**: `psql "$DIRECT_URL" -f supabase/migrations/<file>.sql` + `npx supabase gen types`.
- **Tools (TS function)** vs **Skills (markdown)**: nunca confundir. Skill descreve, tool executa.
- **Specialists** = sub-LLM calls determinísticos (`generateObject` + Zod). Promover pra agent real só se precisar conversa multi-turn.
- **Gates bloqueiam**. `pass=false` retorna erro estruturado pro modelo entender. Nunca exception 500.
- **Confidence + sources** obrigatório via Zod. Não regra de prompt.
- **Source Readers cacheados** em `PlanningSourceCache` por `(planningId, sourceKind, sourceRef, readerVersion)`.

---

**Fim do runbook**. Quando o BOSS final cair, atualize [`vitoria-v2-plan.md`](../agents/vitoria/vitoria-v2-plan.md) seção "Status" com data + commit hash do BOSS. Em 30 dias, revisitar métricas (custo, eval, FP error) e calibrar.
