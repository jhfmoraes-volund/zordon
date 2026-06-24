# PRD — Forge consome §16 rico (stories + verifiable) do DB

**Reference**: FRS
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Runtime**: volund-web-app (este repo — executado via Ralph)
**Depende de**: — (evolução do motor Forge existente)

## Grounding

> Legenda: `[código]` = verificado no repo · `[decisão]` = decidido nesta conversa · `[inferência]` = proposta a validar.

- **[código]** `snapshotManifest` ([src/lib/dal/forge-project.ts:556-590](src/lib/dal/forge-project.ts)) hoje achata **1 PRD = 1 story**: `{id: reference, title, ac: flatten(acceptanceCriteria), dependsOn: []}`. `ManifestStory` = `{id, title, ac, dependsOn}` — **sem `verifiable`**.
- **[código]** O Forge-DB lê do `ProductRequirement`: `problem`, `goal`, `oneLiner`, `acceptanceCriteria`. **Não lê `markdown`** (ignora §16) nem `prd.json`.
- **[código]** `planner.ts` (`PlanStorySchema`) **já** define o modelo rico: `acceptanceCriteria: string[]`, `dependsOn`, `agentProfile`, `estimateMinutes ≤30`, e **`verifiable.min(1)`** (`{kind, command_or_query, expected}`). `worker.ts` **já** renderiza `verifiable` no prompt e itera até passar ([worker.ts:241,247](src/lib/forge/worker.ts)).
- **[código]** Filtro de elegibilidade do run: `status IN ('approved','ready')`.
- **[decisão]** DB é a fonte da verdade do PRD; stories ricas vivem em **coluna `ProductRequirement.stories` (jsonb)**, não no markdown. AC no formato `{text}` (que `stringifyAc` já prioriza).

## §1 Problema

1. O Forge **achata cada PRD em 1 story sem `verifiable`** — perde a granularidade (§16, ≤30min, DAG) e, principalmente, o **check automatizável**, que é o "done" objetivo sem o qual o agente alucina conclusão ou entra em loop (modo de falha nº1 do AGENTS.md e da literatura).
2. O modelo rico **já existe** (`planner.ts`, `worker.ts` consomem `verifiable`), mas o caminho DB→manifest (`snapshotManifest`) **não o popula** — há um gap entre o ideal e o consumo real.
3. As stories ricas hoje só existem no markdown/`prd.json` (filesystem, Ralph) — invisíveis ao Forge, que é DB-driven.

## §2 Solução em uma frase

Levar o §16 rico (stories + `verifiable` + `dependsOn` + `agentProfile`) para uma coluna `ProductRequirement.stories`, e fazer `snapshotManifest` emitir **uma manifest story por story** (com `verifiable`), alinhando o Forge ao modelo que `planner`/`worker` já suportam.

## §3 Não-objetivos

- Geração das stories pelo **Vitor** (o conector Vitor→§16 é upstream; aqui consumimos o que estiver em `ProductRequirement.stories`, e fornecemos um importer de backfill).
- Reescrever `worker.ts`/`planner.ts` — eles já consomem `verifiable`; só precisamos **alimentá-los** via manifest.
- Mudar o filesystem/Ralph — Ralph segue como está; esta PRD é o caminho **Forge (DB)**.

## §4 Personas e jornada

- **PM rodando Forge**: "Quero disparar um PRD e ver o agente executar story a story, cada uma se auto-verificando, não um bloco único sem critério."
- **Builder Forge**: "Quero que o manifest carregue o `verifiable` que o worker já sabe rodar."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Nova coluna `ProductRequirement.stories jsonb default '[]'` no shape do `PlanStorySchema` (id, title, description?, acceptanceCriteria string[], verifiable[], dependsOn, agentProfile, estimateMinutes, touches, passes?) | [decisão] DB = fonte da verdade |
| D2 | `ManifestStory` ganha `verifiable`, `agentProfile`, `estimateMinutes`, `touches` | [código] alinhar ao planner/worker |
| D3 | `snapshotManifest` emite **1 manifest story por item de `stories`** (não 1 por PRD); se `stories` vazio, fallback ao comportamento atual (1 story, retrocompat) | [decisão] |
| D4 | `dependsOn` no manifest = intra-PRD (story.dependsOn) ∪ cross-PRD (deriva de `ProductRequirement.dependencies` → prefixa stories do PRD dependente) | [inferência] |
| D5 | Validação no run-creation: PRD elegível com `stories` não-vazio exige **cada story com ≥1 `verifiable`**; senão **bloqueia** com erro claro (espelha `planner` min(1)) | [código] regra do planner |
| D6 | AC fica `{text}` (machine-checkable); `stringifyAc` já prioriza `.text` | [código] forge-project.ts:600 |
| D7 | Importer de backfill: `scripts/ralph/features/<slug>/prd.json` → `ProductRequirement.stories` por `reference` (destrava SIAL + PRDs existentes) | [decisão] |

## §6 Arquitetura

```
ProductRequirement (DB)
  ├─ acceptanceCriteria (PM, {text})        ← já existe
  └─ stories jsonb [NOVO]  (rich: ac[] + verifiable[] + dependsOn + agentProfile)
        ▲ backfill importer (prd.json) / futuramente Vitor
        │
createForgeRunFromSession → snapshotManifest
        └─ por story de PR.stories → ManifestStory{ id, title, ac, verifiable, dependsOn, agentProfile }
        ▼
ForgeRun.manifest → daemon (exec-forge-run) → prd.json local → worker
        └─ worker renderiza verifiable e itera até passar  ([já existe])
```

## §7 Schema

```sql
-- 1) <data>_pr_stories.sql                         -- [decisão] stories ricas no DB
ALTER TABLE "ProductRequirement"
  ADD COLUMN "stories" jsonb NOT NULL DEFAULT '[]'::jsonb;
-- shape por item (validado na app, não no DB):
-- { id, title, description?, acceptanceCriteria: string[], dependsOn: string[],
--   agentProfile, estimateMinutes, touches: string[],
--   verifiable: [{kind, command_or_query, expected}], passes?: boolean }
```

> Sem CHECK estrutural no DB (jsonb livre); a **validação de shape** mora na app (Zod), reusando/estendendo `PlanStorySchema` de `planner.ts`.

## §8 APIs / Contratos internos

| Onde | Mudança |
|------|---------|
| `src/lib/forge/dal/forge-project.ts` `ManifestStory` | += `verifiable`, `agentProfile`, `estimateMinutes`, `touches` |
| `snapshotManifest` | mapeia `p.stories` → N manifest stories (fallback 1-story se vazio) |
| run-creation (`createForgeRunFromSession`) | valida ≥1 `verifiable` por story; bloqueia com `error: 'story_without_verifiable'` |
| `scripts/daemon/exec-forge-run.ts` | propaga `verifiable` do manifest pro `prd.json` local (Story type += verifiable) |
| `src/lib/forge/spec/schema.ts` (StoryShape) | exportar schema único de story reusado por planner/manifest/importer |
| `scripts/forge/import-prd-stories.ts` [NOVO] | backfill prd.json → PR.stories |

## §9 UX

Sem UI nova. Efeito observável: a aba "Execução" do PRD passa a mostrar **N stories** (não 1), cada uma com seus checks; o stream de `ForgeEvent` emite `story_picked/story_done` por story real.

## §10 Integrações

- **Vitor** (upstream): quando gerar PRD, deve popular `stories` (conector `project_vitor_to_forge_connector`). Até lá, o importer cobre.
- **worker.ts/planner.ts**: já consomem `verifiable` — passam a recebê-lo de fato.
- **SIAL**: após backfill, os 25 PRDs ficam executáveis com granularidade real.

## §11 Faseamento

Fase 1: coluna `stories` + schema único de story → `ManifestStory` rico → `snapshotManifest` por-story (com fallback) → propagação do `verifiable` até o worker → validação no run-creation → importer de backfill → smoke. Retrocompatível (PRDs sem `stories` seguem 1-story).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Quebrar runs de PRDs antigos (sem `stories`) | M | A | Fallback explícito: `stories` vazio → comportamento atual (1 story). |
| Story sem `verifiable` passar batido | M | A | Validação bloqueante no run-creation (D5), espelhando `planner.min(1)`. |
| DAG cross-PRD gerar ciclo | B | M | Derivar de `dependencies` já validadas; detecção de ciclo no orchestrator. |
| jsonb livre divergir do schema | M | M | Validação Zod na escrita (importer/Vitor) e na leitura (snapshot). |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| PRDs executados como N stories (não 1) | `SELECT jsonb_array_length(manifest->'prds'->0->'stories') FROM "ForgeRun" ORDER BY "createdAt" DESC LIMIT 1` > 1 |
| Stories com verifiable no manifest | inspeção do manifest: toda story tem `verifiable[]` não-vazio |
| Runs com self-verify | contagem de `story_done` precedidos de checks que passaram (ForgeEvent) |

## §14 Open questions

- ❓ DAG cross-PRD: prefixar stories do PRD dependente é suficiente, ou precisa de deps story-a-story entre PRDs? **Assumido prefixo por PRD (D4); refinar se necessário.**
- ❓ Vitor passa a popular `stories` nesta fase ou em PRD separado? **Separado (upstream); importer cobre agora.**

## §15 Referências

- Código: [forge-project.ts](src/lib/dal/forge-project.ts) (`snapshotManifest`), [planner.ts](src/lib/forge/planner.ts) (`PlanStorySchema`), [worker.ts](src/lib/forge/worker.ts) (verifiable), [exec-forge-run.ts](scripts/daemon/exec-forge-run.ts).
- Memory: [[project_vitor_to_forge_connector]], [[project_forge_double_diamond]], [[feedback_grounded_no_hallucination]].
- Best practice: machine-verifiable AC + granularidade (Addy Osmani, chatprd).

## §16 Stories implementáveis

```yaml
- id: FRS-001
  title: Migration — ProductRequirement.stories jsonb
  description: ALTER ADD COLUMN stories jsonb NOT NULL DEFAULT '[]'. Atualiza database.types.ts.
  acceptanceCriteria:
    - "Coluna stories existe em ProductRequirement com default '[]'"
    - "database.types.ts reflete a coluna"
  verifiable:
    - kind: sql
      command_or_query: "SELECT data_type FROM information_schema.columns WHERE table_name='ProductRequirement' AND column_name='stories'"
      expected: "jsonb"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/", "src/lib/supabase/database.types.ts"]

- id: FRS-002
  title: Schema único de story (Zod) reusado por planner/manifest/importer
  description: Extrai/centraliza ForgeStorySchema (id, title, description?, acceptanceCriteria string[], verifiable.min(1), dependsOn, agentProfile, estimateMinutes, touches, passes?). planner.PlanStorySchema passa a reusar.
  acceptanceCriteria:
    - "src/lib/forge/spec/story-schema.ts exporta ForgeStorySchema"
    - "verifiable exige min(1)"
    - "planner.ts importa o schema único (sem duplicar)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/lib/forge/spec/story-schema.ts", "src/lib/forge/planner.ts"]

- id: FRS-003
  title: ManifestStory rico + snapshotManifest por-story (com fallback)
  description: ManifestStory += verifiable/agentProfile/estimateMinutes/touches. snapshotManifest emite 1 story por item de PR.stories; se vazio, fallback 1-story (retrocompat).
  acceptanceCriteria:
    - "PRD com stories[] gera N manifest stories com verifiable"
    - "PRD com stories=[] gera 1 manifest story (comportamento atual)"
    - "Cada manifest story carrega ac (text) + verifiable"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRS-001, FRS-002]
  estimateMinutes: 30
  touches: ["src/lib/dal/forge-project.ts"]

- id: FRS-004
  title: Validação bloqueante de verifiable no run-creation
  description: createForgeRunFromSession rejeita PRD elegível cujo stories[] tenha story sem ≥1 verifiable (error 'story_without_verifiable').
  acceptanceCriteria:
    - "Run com story sem verifiable falha com erro claro"
    - "Run com todas stories verifiáveis prossegue"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRS-003]
  estimateMinutes: 25
  touches: ["src/lib/dal/forge-project.ts"]

- id: FRS-005
  title: Propagar verifiable manifest → prd.json local → worker
  description: exec-forge-run.ts Story type += verifiable; ao escrever prd.json local, inclui verifiable/agentProfile. Worker já renderiza.
  acceptanceCriteria:
    - "prd.json local escrito pelo daemon inclui verifiable por story"
    - "Prompt do worker lista os checks (já suportado)"
  verifiable:
    - kind: typecheck
      command_or_query: "cd ~/zordon-mcp 2>/dev/null && npx tsc --noEmit || npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRS-003]
  estimateMinutes: 25
  touches: ["scripts/daemon/exec-forge-run.ts"]

- id: FRS-006
  title: Importer de backfill prd.json → ProductRequirement.stories
  description: scripts/forge/import-prd-stories.ts lê scripts/ralph/features/<slug>/prd.json e grava userStories em ProductRequirement.stories casando por reference. Valida via ForgeStorySchema.
  acceptanceCriteria:
    - "Rodar o importer popula stories dos PRDs por reference"
    - "Stories inválidas (sem verifiable) são reportadas, não gravadas"
    - "Idempotente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [FRS-002, FRS-001]
  estimateMinutes: 30
  touches: ["scripts/forge/import-prd-stories.ts"]

- id: FRS-007
  title: Smoke — PR rico vira run multi-story com verifiable
  description: Backfill de 1 PRD (ex.: sial-core-process) → cria run → manifest tem N stories, cada uma com verifiable.
  acceptanceCriteria:
    - "Manifest do run tem >1 story para o PRD"
    - "Toda story do manifest tem verifiable não-vazio"
  verifiable:
    - kind: sql
      command_or_query: "SELECT bool_and(jsonb_array_length(s->'verifiable')>0) FROM \"ForgeRun\", jsonb_array_elements(manifest->'prds'->0->'stories') s ORDER BY \"createdAt\" DESC LIMIT 1"
      expected: "t"
  dependsOn: [FRS-004, FRS-005, FRS-006]
  estimateMinutes: 25
  touches: ["scripts/forge/test-smoke-rich-stories.sh"]
```

**Total: 7 stories, ~175min (~3h).**
