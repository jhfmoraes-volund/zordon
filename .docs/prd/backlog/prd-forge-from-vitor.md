# PRD — Forge from Vitor (bridge ProductRequirement → Forge engine)

> Status: `backlog` · Owner: João · Created: 2026-05-30 · Target: 1 loop Ralph (~3h)

---

## 0 · Posicionamento no Duplo Diamante

Este PRD é a **cintura concreta entre Diamond 1 (Entender, via Vitor) e Diamond 2 (Construir, via Forge engine)** no caso específico em que o input do Forge é um PRD que vive **no banco** (não em filesystem). Hoje Vitor escreve `ProductRequirement` no DB e o orchestrator Forge lê `prd.json` em filesystem — a transição é feita por humano transcrevendo §16. Esse PRD elimina essa cola humana.

Não substitui `prd-forge-engine` (motor) nem `prd-vitor-output-as-prd` (Vitor escrevendo PRDs). Pluga os dois.

---

## 1 · Problema

Vitor (Design Session agent) já tem as tools `create_prd`, `update_prd`, `approve_prd` (ver [src/lib/agent/agents/vitor/index.ts:279](../../../src/lib/agent/agents/vitor/index.ts)). PRDs aprovados ficam na tabela `ProductRequirement` com `markdown` (texto completo, schema §1-§16) + `acceptanceCriteria` (Json paralelo).

Forge engine (PRD-mãe `prd-forge-engine`, FE-004 orchestrator) lê stories de `scripts/ralph/features/<slug>/prd.json` — formato estruturado com `userStories[]` contendo `id`, `title`, `acceptanceCriteria[]`, `verifiable[]`, `dependsOn[]`, `passes`.

**Três dores concretas:**

1. **Cola humana entre Vitor e Forge.** Hoje, quando Vitor aprova um PRD, alguém abre o markdown, copia o bloco §16, cola em um `prd.json` e cria a feature dir em `scripts/ralph/features/`. Fonte: tudo no diretório `scripts/ralph/features/` foi feito manualmente — ver `planning-session/prd.json`, `forge-engine/prd.json`, `opportunities/prd.json`.

2. **Stories de §16 não passam por validador antes do orchestrator.** O validador formal (regras AGENTS.md: ≥5 stories, todas com verifiable automatizável, ≤30min, dependsOn sem ciclo) é mental — humano lê e julga. Vitor pode emitir markdown com §16 inválido (yaml malformado, story com >30min, ciclo) e o orchestrator descobre tarde.

3. **PRD-as-source-of-truth quebrado.** Se o humano edita `prd.json` durante execução (ex: `passes: true`) e depois Vitor reaprova o PRD com v2, ambas as versões divergem. Hoje a sincronização é mental.

**Fonte de cada dor:**
- [scripts/ralph/intake.sh:96-105](../../../scripts/ralph/intake.sh) — script avisa se prd.json não existe mas não o gera; humano deve "gerar manualmente espelhando §16".
- [src/lib/agent/agents/vitor/index.ts:302](../../../src/lib/agent/agents/vitor/index.ts) — tool `approve_prd` muda `status='approved'` mas não tem next-step pro Forge.
- Memória `project_vitor_as_pm` — Vitor entrega PRD, Vitoria materializa Tasks. Forge sempre foi terceira ponta sem cola formal.

## 2 · Solução em uma frase

**Pipeline automatizado `ProductRequirement (DB) → prd.json + markdown mirror (FS)` via parser §16 yaml + validator + endpoint `POST /api/forge/specs/from-prd/[prdId]` + Vitor tool `emit_to_forge` + botão UI "Send to Forge" no PRD detail.**

## 3 · Não-objetivos

- ❌ Não substituir `prd-forge-engine` — bridge gera o `prd.json` que o orchestrator FE-004 consome.
- ❌ Não substituir `prd-vitor-output-as-prd` — esse PRD assume Vitor já escreve §16 corretamente.
- ❌ Não migrar PRDs existentes (`forge-engine`, `planning-session`, `opportunities`) automaticamente — humanos já transcreveram, não há ganho em re-emit.
- ❌ Não adicionar tabela `ForgeSpec` aqui — `prd-forge-engine` FE-003 já planeja isso. Bridge é puramente file-based v1.
- ❌ Não alterar o schema canônico §16 do AGENTS.md — bridge consome o schema atual.
- ❌ Não integrar Vitoria pré-emit — Vitoria materializa Tasks em outro fluxo, independente.
- ❌ Não auto-rodar Forge orchestrator pós-emit — `forge run` continua ato consciente do builder.
- ❌ Não suportar PRDs sem `projectId` (specs órfãs) — bridge exige projectId pra RLS.

## 4 · Personas e jornada

**Vitor (agent, futuro fluxo):**
> "Termino o briefing da Design Session, chamo `create_prd` com o markdown completo (já incluindo §16). Builder/PM revê e me pede `approve_prd`. Aí eu (Vitor) ofereço: 'Posso emitir esse PRD pro Forge agora?' — chamo `emit_to_forge(prdId)`, recebo de volta `{slug, prdJsonPath, storiesCount: 7, warnings: []}`. Reporto pro builder com path clicável."

**Builder/PM (João):**
> "Aprovei o PRD no Volund (`/projects/X/prds/Y`). Vejo o card 'Forge Status' com botão 'Send to Forge'. Click → 3s depois aparece ✅ + path. Abro terminal, `forge ps` lista a spec ready. `forge run <slug>` e o autopilot começa. Nada foi transcrito manualmente."

**Builder em iteração 2 do mesmo PRD:**
> "Vitor atualizou o PRD (corrigi a §16, removeu uma story problemática). Click 'Re-emit'. Bridge detecta que `prd.json` já tem `FE-002.passes=true` e preserva esse flag — só atualiza o resto. Não perco o trabalho anterior."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Parse `ProductRequirement.markdown` §16 yaml block (não adicionar campo `userStories` Json no DB) | Vitor já escreve markdown. Schema canônico está em AGENTS.md. Zero migration. Markdown é o source-of-truth do "porquê + como"; campo paralelo viraria desync. |
| D2 | Slug derivado de `ProductRequirement.reference` (lowercase, espaços→hyphen, non-alphanum stripped) | `reference` já é texto curto humano-friendly. PRDs existentes (`forge-engine`, `opportunities`) seguem esse padrão. Override opcional via body do endpoint. |
| D3 | Bridge é puramente filesystem v1: escreve `prd.json` + mirror `prd-<slug>.md` em `docs/prd/ready/`. Sem nova tabela. | `prd-forge-engine` FE-003 vai criar `ForgeSpec`. Bridge v2 (Phase 2) plugará nela. v1 mantém compat absoluta com Ralph atual. |
| D4 | Re-emit é idempotente via `specHash` (sha256 do markdown). Mesmo hash = no-op com warning `unchanged`. | Vitor pode chamar `emit_to_forge` várias vezes; bridge não duplica trabalho nem corrompe estado. |
| D5 | Re-emit preserva `passes: true` das stories cujo `id` bate no `prd.json` existente | Builder pode estar mid-execution; v2 do PRD não deve resetar progresso. Stories removidas no v2 são dropadas; novas adicionadas começam com `passes: false`. |
| D6 | Endpoint exige `ProductRequirement.status === 'approved'` (422 se não) | Aprovação humana/Vitor é o gate moral. Forge só roda PRD aprovado. |
| D7 | Validator é fail-fast: erros bloqueiam emit; warnings (`>80% manual_browser`, `<5 stories`) só registram | Erros = PRD não rodável; warnings = degradação aceitável que o builder decide. |
| D8 | Markdown mirror em `docs/prd/ready/prd-<slug>.md` ganha frontmatter `<!-- generated by forge-bridge from PRD <prdId>@<version>; do not hand-edit -->` | Humano sabe que edit manual será sobrescrito no próximo emit. |
| D9 | Auth: endpoint requer `can_edit_project(projectId)` ou `is_manager` (helpers SQL existentes) | Forge runs são WIP do builder (memory `project_zordon_ops_pipeline`). Quem pode editar projeto pode emitir spec. |
| D10 | Slug uniqueness check em `scripts/ralph/features/*/`. Conflito → 409 com sugestão `<slug>-<n>`. | Filesystem é state. Dois PRDs com mesmo slug se sobrescreveriam — fatal. |

## 6 · Arquitetura

```
┌──────────────────────────────────────────────────────────────────────────┐
│  VITOR AGENT                                                             │
│  (src/lib/agent/agents/vitor/)                                           │
│                                                                          │
│   approve_prd ──► [usuário revê] ──► emit_to_forge(prdId)                │
│                                              │                           │
└──────────────────────────────────────────────┼───────────────────────────┘
                                               │ fetch internal
                                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  NEXT.JS API                                                             │
│  POST /api/forge/specs/from-prd/[prdId]                                  │
│  GET  /api/forge/specs/from-prd/[prdId]/preview     (dryRun)             │
│                                                                          │
│   ├─ auth (proxy.ts) + can_edit_project                                  │
│   ├─ ZodSchema body { slug? }                                            │
│   └─ call DAL.emitToForge(prdId, opts)                                   │
└──────────────────────────────────────────────┼───────────────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  DAL  src/lib/dal/forge-bridge.ts                                        │
│  emitToForge(prdId, { slug?, dryRun? }) → EmitResult                     │
│                                                                          │
│   1. read ProductRequirement (dal/product-requirements.getPrd)           │
│   2. assert status='approved'                                            │
│   3. parse §16 yaml → stories[]   ◄── src/lib/forge/spec/                │
│   4. validate stories             ◄── parse-prd-stories.ts               │
│                                       validate-stories.ts                │
│   5. derive slug (reference → kebab) or use override                     │
│   6. check slug uniqueness in scripts/ralph/features/                    │
│   7. if !dryRun:                                                         │
│       - merge with existing prd.json (preserve passes:true)              │
│       - writeFileSync(scripts/ralph/features/<slug>/prd.json)            │
│       - writeFileSync(docs/prd/ready/prd-<slug>.md  + frontmatter)       │
│   8. return { slug, prdJsonPath, mdMirrorPath, stories,                  │
│               warnings[], unchanged?: bool }                             │
└──────────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  FILESYSTEM (consumido pelo Ralph + Forge engine futuro)                 │
│                                                                          │
│   scripts/ralph/features/<slug>/prd.json   ◄── orchestrator FE-004 lê    │
│   docs/prd/ready/prd-<slug>.md             ◄── humano lê                 │
└──────────────────────────────────────────────────────────────────────────┘
```

**Componentes (cada caixa = arquivo real):**

| Componente | Path | Responsabilidade |
|---|---|---|
| Parser | `src/lib/forge/spec/parse-prd-stories.ts` | Extrai bloco ```yaml dentro de §16 do markdown; retorna `{stories[], errors[]}` com line:col |
| Validator | `src/lib/forge/spec/validate-stories.ts` | Aplica regras AGENTS.md (ids únicos, verifiable não-vazio, estimate ≤30, sem ciclo) |
| DAL | `src/lib/dal/forge-bridge.ts` | `emitToForge(prdId, opts)`: orquestra leitura PRD, parse, validate, escrita FS, merge idempotente |
| API POST | `src/app/api/forge/specs/from-prd/[prdId]/route.ts` | Auth + ownership + body Zod + chama DAL |
| API preview | `src/app/api/forge/specs/from-prd/[prdId]/preview/route.ts` | dryRun=true, retorna stories+warnings sem escrever |
| Vitor tool | `src/lib/agent/agents/vitor/tools.ts` (extensão) | `emit_to_forge` tool fetcha endpoint interno |
| UI card | `src/components/prd/forge-status-card.tsx` | Card no PRD detail com 3 estados (não-emitido/emitido/erro) + Send/Preview/Re-emit |
| CLI fallback | `scripts/forge/emit-from-prd.ts` | Debug + CI: chama DAL diretamente, output pretty-printed |

## 7 · Schema (DDL)

**Nenhuma migration nova nesta fase.** Tudo é leitura DB + escrita filesystem.

Idempotência via `specHash` armazenado no frontmatter do mirror markdown:

```markdown
<!-- generated by forge-bridge
     productRequirementId: <uuid>
     version: <int>
     specHash: <sha256>
     emittedAt: <iso>
     do not hand-edit -->
```

Read no re-emit: bridge faz `head -10 docs/prd/ready/prd-<slug>.md`, extrai `specHash` do frontmatter, compara com hash atual do markdown PRD. Igual → no-op + warning `unchanged`.

**Pós-merge com prd-forge-engine FE-003 (futuro)**: bridge passará a fazer upsert em `ForgeSpec` table além do filesystem. Esse upgrade é story separada, fora deste PRD.

## 8 · APIs

| Método | Path | Async? | Contrato |
|---|---|---|---|
| POST | `/api/forge/specs/from-prd/[prdId]` | sync | body: `{ slug?: string }` → 200 `{ slug, prdJsonPath, mdMirrorPath, storiesCount, warnings[], unchanged?: boolean }` |
| GET | `/api/forge/specs/from-prd/[prdId]/preview` | sync | → 200 `{ stories[], warnings[] }` (dryRun, não escreve) |

**Erros mapeados:**
- 400 — body Zod inválido
- 401 — sem auth (proxy.ts redireciona)
- 403 — sem `can_edit_project` nem `is_manager`
- 404 — ProductRequirement não existe
- 409 — slug em uso por outro PRD (response inclui `suggestion: '<slug>-2'`)
- 422 — `status !== 'approved'` OU §16 inválido (erros em `body.errors[]` com line:col)

**Vitor tool contract:**

```typescript
{
  name: "emit_to_forge",
  description: "Emite um PRD aprovado pro Forge. Gera prd.json + markdown mirror. Idempotente.",
  parameters: z.object({
    productRequirementId: z.string().uuid(),
    slug: z.string().optional(),  // default: derivado de reference
  }),
}
```

## 9 · UX

**Tela 1 — PRD detail (`/projects/[id]/prds/[prdId]`)** ganha card "Forge Status":

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚒  Forge Status                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Estado A — não emitido + approved:                                │
│   ───────────────────────────                                       │
│   PRD aprovado · 7 stories detectadas em §16                        │
│                                                                     │
│   [ Send to Forge ]   [ Preview ]                                   │
│                                                                     │
│   ───                                                               │
│                                                                     │
│   Estado B — emitido:                                               │
│   ─────────────                                                     │
│   ✅ Emitted 2026-05-30 14:23                                       │
│   slug: forge-from-vitor · 7 stories · 0 warnings                   │
│   → scripts/ralph/features/forge-from-vitor/prd.json                │
│                                                                     │
│   [ Re-emit ]   [ Preview ]                                         │
│                                                                     │
│   ───                                                               │
│                                                                     │
│   Estado C — erro de parse:                                         │
│   ──────────────────                                                │
│   ❌ §16 inválido (3 errors):                                       │
│   • line 542: yaml: missing closing bracket on dependsOn            │
│   • line 567: story FE-008 verifiable vazio                         │
│   • line 591: cycle detected: FE-010 → FE-012 → FE-010              │
│                                                                     │
│   [ Preview ]   ← abre modal com tabela stories + warnings          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Tela 2 — Preview modal (ResponsiveDialog)**:

```
┌───── Forge Preview · prd-forge-from-vitor ──────────────────────────┐
│                                                                     │
│  7 stories · 2 warnings                                             │
│                                                                     │
│  id        title                              est   verifiable      │
│  ──────────────────────────────────────────────────────────────     │
│  VTF-001   Parser §16 yaml block              25m   ✓ tc, ✓ manual  │
│  VTF-002   Validator stories                  25m   ✓ tc            │
│  VTF-003   DAL forge-bridge                   30m   ✓ tc            │
│  VTF-004   API routes from-prd                25m   ✓ tc, ✓ http    │
│  VTF-005   Vitor tool emit_to_forge           20m   ✓ tc            │
│  VTF-006   UI Forge Status card               30m   ✓ tc, ✓ manual  │
│  VTF-007   CLI fallback + smoke E2E           20m   ✓ tc, ✓ manual  │
│                                                                     │
│  ⚠ warnings:                                                        │
│  • 2 stories têm verifiable kind='manual_browser' (28% do total)    │
│                                                                     │
│  [ Cancel ]                              [ Confirm Send to Forge ]  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Padrões UI (memory `project_ui_patterns`):
- `ResponsiveDialog` no preview (não `Dialog` nu)
- `useOptimisticCollection` no estado do card (Send muda local-first, reconcilia)
- Erros via `showErrorToast` (Sonner), não alert
- `Field` compound API se algum dia tiver input slug

## 10 · Integrações

| Sistema | Integração | Direção |
|---|---|---|
| ProductRequirement DAL | `src/lib/dal/product-requirements.ts` (read) | DAL → bridge |
| Vitor agent | Tool `emit_to_forge` no toolset | Vitor → API → DAL |
| Filesystem Ralph | Escrita em `scripts/ralph/features/`, `docs/prd/ready/` | bridge → FS |
| prd-forge-engine FE-004 | Consome `prd.json` gerado | bridge → orchestrator (indireto) |
| prd-vitor-output-as-prd | Vitor precisa escrever §16 estruturado (upstream) | Pré-requisito conceitual; v1 funciona com markdown manual também |
| Supabase Auth/RLS | `can_edit_project` helper | gate de write |

## 11 · Faseamento

**Fase 1 (este PRD) — Bridge filesystem v1:** parser, validator, DAL, 2 endpoints, Vitor tool, UI card, CLI fallback. Vitor (ou builder) emite, Forge orchestrator consome `prd.json` sem cola. **Entrega: 100% dos PRDs novos do Vitor chegam ao Forge sem humano transcrever §16.**

**Fase 2 (PRD futuro, pós FE-003 do prd-forge-engine):** bridge passa a fazer upsert em `ForgeSpec` table além do filesystem. Spec ganha `productRequirementId` FK. Filesystem mirror continua pra compat com Ralph atual.

**Fase ∞:** orchestrator consome direto do DB (ForgeSpec + ProductRequirement). Filesystem mirror deprecated.

**Fase 1 entrega mais que o sistema atual** porque:
- (a) elimina transcrição manual de §16 (hoje 100% manual)
- (b) validador formal pré-emit que humanos não rodam
- (c) idempotência via specHash que humanos não garantem
- (d) preservação de `passes` em re-emit que humanos quebram (tendem a sobrescrever)

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Vitor escreve §16 yaml mal-formado | Alta | Alto | Parser retorna erros line:col acionáveis; Vitor system prompt (story VTF-005) referencia exemplo `prd-forge-engine.md` como template canônico. |
| Re-emit destrói `passes: true` mid-execution | Média | Alto | D5: merge por `id` preserva flags. Test cobre cenário (story VTF-003 AC). |
| Slug autogen colide silenciosamente | Média | Alto | D10: check uniqueness em `scripts/ralph/features/*/` antes de escrever; 409 com sugestão. |
| Humano edita mirror markdown manualmente; re-emit destrói edits | Média | Médio | D8: frontmatter avisa "do not hand-edit". Edits humanos ao PRD devem ir pro PRD do banco (via Vitor `update_prd`). |
| Markdown PRD muito grande (>500KB) trava parser | Baixa | Baixo | Safety cap 2MB; parser stream-friendly em chunks. |
| `acceptanceCriteria` (Json) e §16 stories.acceptanceCriteria divergem | Média | Médio | v1 ignora `acceptanceCriteria` Json (campo legado); SSOT = §16 do markdown. Warning se Json field não-vazio diverge. |
| Validador rejeita PRDs com `kind: manual_browser` demais | Alta | Baixo | Warning, não error. Builder decide. Threshold (80%) é só sinal. |
| Token expirado / RLS bloqueia DAL read | Baixa | Médio | Endpoint usa server-side client (service role); RLS bypass justificada por D9 (auth no endpoint). |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Tempo `approve_prd` → `prd.json` no FS | Diff `os.statSync(prdJsonPath).mtimeMs - prd.approvedAt` | < 5s p95 |
| Bridge success rate | `% de POST /from-prd que retornam 2xx` (parse log linha `forge.bridge.emit`) | ≥ 95% |
| Re-emit idempotência | SHA256 do `prd.json` estável após re-emit sem mudança no markdown | 100% |
| Stories drop rate | `(stories_in_markdown - stories_in_prd_json) / stories_in_markdown` | 0% |
| Verifiable automatizável rate | `% de stories com kind != 'manual_browser'` por PRD emitido | ≥ 70% |
| Vitor agent usa emit_to_forge | `count de tool calls emit_to_forge / approve_prd` no log do agent | ≥ 50% (após VTF-005) |
| 0 PRDs transcritos manualmente pós-VTF | grep audit em `scripts/ralph/features/*/prd.json` sem header frontmatter | 100% novos emitidos pela bridge |

## 14 · Open questions

- **OQ1**: slug derivation — `reference` field pode ter caracteres especiais (`/`, `:`)? Validar com PRDs existentes na story VTF-003. Se sim, regex de slug filtra. *(decide em VTF-003)*
- **OQ2**: `acceptanceCriteria` Json field do `ProductRequirement` — manter como audit log paralelo? Ou ignorar permanentemente em favor de §16? *(não-bloqueante; v1 ignora, decisão final em Fase 2)*

## 15 · Referências

- [docs/prd/backlog/prd-forge-engine.md](prd-forge-engine.md) — PRD-mãe do motor que consome bridge output
- [docs/prd/backlog/prd-vitor-output-as-prd.md](prd-vitor-output-as-prd.md) — Vitor escrevendo PRD (upstream conceitual)
- [src/lib/agent/agents/vitor/tools.ts](../../../src/lib/agent/agents/vitor/tools.ts) — toolset atual do Vitor
- [src/lib/agent/agents/vitor/index.ts:279](../../../src/lib/agent/agents/vitor/index.ts) — tools `create_prd`/`update_prd`/`approve_prd`
- [src/lib/dal/product-requirements.ts](../../../src/lib/dal/product-requirements.ts) — DAL existente
- [scripts/ralph/intake.sh](../../../scripts/ralph/intake.sh) — script Rito 1 que avisa "gerar manualmente" (ponto de eliminação)
- [scripts/ralph/features/forge-engine/prd.json](../../../scripts/ralph/features/forge-engine/prd.json) — exemplo canônico de prd.json
- AGENTS.md — bloco "PRDs — escrever pra Ralph" (schema §16)
- Memory `project_vitor_as_pm` — Vitor reposicionado como gerador de PRDs

## 16 · Stories implementáveis

```yaml
- id: VTF-001
  title: Parser §16 yaml block (markdown → structured stories)
  description: |
    Função parseStoriesYaml(markdown: string): { stories[], errors[] }.
    Localiza a seção §16 do markdown PRD (regex robusta cobrindo
    "## §16", "## 16", "## Stories implementáveis"), extrai o bloco
    ```yaml ... ``` interno e parseia via lib `yaml` (já é dep transitiva
    do projeto). Erros incluem line:col da linha do markdown que falhou
    (offset do bloco yaml + 1 + linha relativa do erro yaml).
    Não valida deps/ciclos/estimate — só shape mínimo (id, title presentes).
    VTF-002 faz validação semântica.
  acceptanceCriteria:
    - "src/lib/forge/spec/parse-prd-stories.ts exporta parseStoriesYaml(md: string): { stories: Story[]; errors: ParseError[] }"
    - "Tipo Story tem ao menos: id, title, description?, acceptanceCriteria?, verifiable?, dependsOn?, estimateMinutes?, touches?, agentProfile?"
    - "Detecta §16 com regex matching ^## §?16 ou ^## Stories implementáveis (case-insensitive)"
    - "Erros têm shape { line: number; col?: number; message: string }"
    - "Markdown sem §16 retorna stories: [], errors: [{line: 0, message: 'section §16 not found'}]"
    - "Markdown com yaml malformado retorna stories: [], errors com line do erro yaml"
    - "Test: parse de docs/prd/backlog/prd-forge-engine.md retorna 14 stories sem errors"
    - "Test: parse de markdown vazio retorna stories: [], errors com message 'no markdown content'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx -e \"import('./src/lib/forge/spec/parse-prd-stories.ts').then(m=>{const fs=require('fs');const md=fs.readFileSync('docs/prd/backlog/prd-forge-engine.md','utf8');const r=m.parseStoriesYaml(md);console.log(JSON.stringify({n:r.stories.length,errors:r.errors.length}))})\""
      expected: '{"n":14,"errors":0}'
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/forge/spec/parse-prd-stories.ts
    - src/lib/forge/spec/parse-prd-stories.test.ts
  agentProfile: api

- id: VTF-002
  title: Validator de stories (regras AGENTS.md)
  description: |
    Função validateForgeStories(stories: Story[]): { ok: boolean; errors: ValidationError[]; warnings: ValidationWarning[] }.
    Regras aplicadas:
      ERROR (fail emit):
        - id ausente, duplicado, ou não-string
        - title ausente
        - verifiable[] vazio ou ausente
        - verifiable[i] sem kind ou command_or_query ou expected
        - dependsOn referencia id inexistente
        - dependsOn forma ciclo (DFS topological)
      WARNING (registra, não bloqueia):
        - estimateMinutes > 30 OU ausente
        - <5 stories no PRD
        - >80% das stories têm verifiable kind === 'manual_browser'
        - touches[] ausente
        - agentProfile ausente
    Errors e warnings têm shape { storyId?: string; field?: string; message: string }.
  acceptanceCriteria:
    - "src/lib/forge/spec/validate-stories.ts exporta validateForgeStories(stories): ValidationResult"
    - "Cycle detection via DFS: stories A→B→A retorna error com message contendo 'cycle: A → B → A'"
    - "Id duplicado retorna error com storyId + 'duplicate id'"
    - "verifiable vazio retorna error (não warning)"
    - "<5 stories: warnings inclui 'only N stories; AGENTS.md recommends ≥5'"
    - ">80% manual_browser: warning 'X of N stories verifiable is manual_browser only (≥80%)'"
    - "Test: stories do prd-forge-engine.md retornam ok=true, errors=[], warnings com 0 ou poucos itens"
    - "Test: stories com ciclo retornam ok=false, errors[].message contém 'cycle'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx -e \"Promise.all([import('./src/lib/forge/spec/parse-prd-stories.ts'),import('./src/lib/forge/spec/validate-stories.ts')]).then(([p,v])=>{const fs=require('fs');const md=fs.readFileSync('docs/prd/backlog/prd-forge-engine.md','utf8');const stories=p.parseStoriesYaml(md).stories;const r=v.validateForgeStories(stories);console.log(JSON.stringify({ok:r.ok,errs:r.errors.length}))})\""
      expected: '{"ok":true,"errs":0}'
  dependsOn: [VTF-001]
  estimateMinutes: 25
  touches:
    - src/lib/forge/spec/validate-stories.ts
    - src/lib/forge/spec/validate-stories.test.ts
  agentProfile: api

- id: VTF-003
  title: DAL forge-bridge — emitToForge orchestrator
  description: |
    src/lib/dal/forge-bridge.ts: emitToForge(prdId, opts?): Promise<EmitResult>.
    EmitResult = { slug, prdJsonPath, mdMirrorPath, storiesCount, warnings[], unchanged?: boolean }.
    Pipeline:
      1. ProductRequirement read via dal/product-requirements
      2. throw if status !== 'approved'
      3. parseStoriesYaml(markdown) (VTF-001) — throw com formatted errors se errors.length > 0
      4. validateForgeStories(stories) (VTF-002) — throw se !ok
      5. slug = opts.slug ?? slugify(prd.reference). Regex slugify: lowercase, espaços→-, non-[a-z0-9-]→stripped, multiple-hyphens→single
      6. checkSlugUnique(slug) em scripts/ralph/features/<slug>/; conflito → throw com suggestion <slug>-2
      7. specHash = sha256(prd.markdown). Read mirror md frontmatter; se hash bate, return { ..., unchanged: true } sem escrever
      8. mergeWithExistingPrdJson(stories): se prd.json existe, preserva passes:true das stories com id match
      9. writeFileSync(scripts/ralph/features/<slug>/prd.json, JSON.stringify({feature: slug, prd_path: 'docs/prd/ready/prd-<slug>.md', runtime: 'volund-web-app', userStories: stories}, null, 2))
      10. writeFileSync(docs/prd/ready/prd-<slug>.md, frontmatter + prd.markdown)
      11. return { slug, prdJsonPath, mdMirrorPath, storiesCount: stories.length, warnings: validator.warnings }
    dryRun=true pula 8-10, retorna result.
  acceptanceCriteria:
    - "src/lib/dal/forge-bridge.ts exporta emitToForge"
    - "slugify('Forge Engine v2!') === 'forge-engine-v2'"
    - "Throws WithMessage 'PRD not approved' se status='draft'"
    - "Throws com sugestão se slug conflita: 'slug \"foo\" in use; try \"foo-2\"'"
    - "Re-emit com mesmo specHash: result.unchanged === true, FS não modificado"
    - "Merge: prd.json existente com VTF-001.passes=true mantém após re-emit do markdown atualizado"
    - "Stories removidas no v2 não aparecem no prd.json final"
    - "Stories novas no v2 aparecem com passes: false"
    - "Frontmatter do mirror md contém productRequirementId, version, specHash, emittedAt"
    - "dryRun=true: result completo mas fs.existsSync(prdJsonPath) NÃO mudou de estado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VTF-002]
  estimateMinutes: 30
  touches:
    - src/lib/dal/forge-bridge.ts
    - src/lib/dal/forge-bridge.test.ts
  agentProfile: api

- id: VTF-004
  title: API routes — POST emit + GET preview
  description: |
    Duas rotas Next 16 App Router:
      POST /api/forge/specs/from-prd/[prdId]/route.ts
        body Zod: { slug?: string }
        auth: session via proxy.ts; permissão: can_edit_project(prd.projectId) OR is_manager()
        chama emitToForge(prdId, { slug })
        mapping erros → HTTP: 400 (Zod), 403 (no perm), 404 (PRD not found), 409 (slug conflict), 422 (not approved OR §16 invalid)
      GET /api/forge/specs/from-prd/[prdId]/preview/route.ts
        chama emitToForge(prdId, { dryRun: true })
        retorna 200 { stories, warnings } ou 422 com errors
    Schemas Zod em src/lib/forge/api-schemas.ts (não inline na rota — convenção AGENTS.md).
    Resposta sempre JSON.
  acceptanceCriteria:
    - "src/app/api/forge/specs/from-prd/[prdId]/route.ts existe + exporta POST"
    - "src/app/api/forge/specs/from-prd/[prdId]/preview/route.ts existe + exporta GET"
    - "POST com body inválido → 400 + { error, issues[] }"
    - "POST com PRD não-approved → 422 + { error: 'PRD must be approved before emit' }"
    - "POST sem permissão → 403 + { error: 'forbidden' }"
    - "POST com slug em uso → 409 + { error, suggestion }"
    - "GET preview retorna stories + warnings sem efeitos colaterais (re-call retorna mesmo result)"
    - "Validação Zod via src/lib/forge/api-schemas.ts (importada)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/forge/specs/from-prd/00000000-0000-0000-0000-000000000000"
      expected: "401"
  dependsOn: [VTF-003]
  estimateMinutes: 25
  touches:
    - src/app/api/forge/specs/from-prd/[prdId]/route.ts
    - src/app/api/forge/specs/from-prd/[prdId]/preview/route.ts
    - src/lib/forge/api-schemas.ts
  agentProfile: api

- id: VTF-005
  title: Vitor tool emit_to_forge + system prompt update
  description: |
    Adiciona tool emit_to_forge em src/lib/agent/agents/vitor/tools.ts.
    Schema Zod: { productRequirementId: z.string().uuid(), slug: z.string().optional() }.
    Implementação: fetch interno (mesmo origin) pro endpoint POST com Bearer
    do session do agent. Retorna shape { ok: boolean; prdJsonPath?: string;
    storiesCount?: number; warnings?: string[]; error?: string }.
    Atualiza src/lib/agent/agents/vitor/index.ts ou prompt fonte:
    adiciona linha mencionando 'Após approve_prd bem-sucedido, ofereça
    emit_to_forge se o markdown tem §16 estruturado. Não chame
    automaticamente — espere usuário confirmar.'
    Não auto-chama — Vitor sugere, builder confirma.
  acceptanceCriteria:
    - "buildVitorTools() retorna toolset incluindo emit_to_forge"
    - "Schema Zod valida productRequirementId como uuid"
    - "Tool description menciona pré-req status=approved"
    - "Erro 4xx do endpoint mapeado pra { ok: false, error: <message> } (não throw raw)"
    - "Sucesso: { ok: true, prdJsonPath, storiesCount, warnings }"
    - "Vitor's system prompt menciona emit_to_forge no flow pós-approve_prd"
    - "Tool NÃO é chamada automaticamente (não é parte de approve_prd workflow)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "grep -c 'emit_to_forge' src/lib/agent/agents/vitor/tools.ts"
      expected: "≥ 1"
  dependsOn: [VTF-004]
  estimateMinutes: 20
  touches:
    - src/lib/agent/agents/vitor/tools.ts
    - src/lib/agent/agents/vitor/index.ts
  agentProfile: api

- id: VTF-006
  title: UI Forge Status card no PRD detail
  description: |
    src/components/prd/forge-status-card.tsx: client component que renderiza
    3 estados na page PRD detail (/projects/[id]/prds/[prdId]).
    Estados (mutex):
      - approved + não-emitido: botão 'Send to Forge' + 'Preview' (secondary)
      - emitido (mirror md existe + status=approved): ✅ + slug + prdJsonPath + Re-emit + Preview
      - parse error (preview retornou 422): ❌ + first 3 errors + Preview button
    Send chama POST internal endpoint via fetchOrThrow.
    Preview abre ResponsiveDialog com PreviewTable (stories[] + warnings[]).
    State management: useOptimisticCollection<EmitState, EmitMutation> com
    reducer simples (set/clear) — mutation persist chama API.
    Erros via showErrorToast (Sonner). Loading inline no botão.
    Integrar em src/app/(dashboard)/projects/[id]/prds/[prdId]/page.tsx
    (ou route equivalente do PRD detail atual — verificar antes via Read).
  acceptanceCriteria:
    - "src/components/prd/forge-status-card.tsx existe"
    - "Card só renderiza se prd.status === 'approved'"
    - "Preview modal usa ResponsiveDialog (não Dialog raw)"
    - "PreviewTable mostra: id, title, estimateMinutes, verifiable kinds"
    - "Send com loading state durante POST (botão disabled + spinner)"
    - "Errors via Sonner toast"
    - "Optimistic: clicar Send muda estado local-first; reconcilia após response"
    - "Re-emit: warning toast 'unchanged' se response.unchanged === true"
    - "Page PRD detail importa ForgeStatusCard e renderiza"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "grep -r 'ForgeStatusCard' src/app/(dashboard)/projects | head -1"
      expected: "non-empty match"
  dependsOn: [VTF-005]
  estimateMinutes: 30
  touches:
    - src/components/prd/forge-status-card.tsx
    - src/components/prd/forge-preview-modal.tsx
    - src/app/(dashboard)/projects/[id]/prds/[prdId]/page.tsx
  agentProfile: ui

- id: VTF-007
  title: CLI fallback + smoke E2E
  description: |
    scripts/forge/emit-from-prd.ts <prdId> [--slug=<x>] [--dry-run] [--json]:
    chama emitToForge diretamente (não via HTTP — debug/CI).
    Output: pretty-printed table OU JSON com --json.
    package.json script 'forge:emit-from-prd': 'tsx scripts/forge/emit-from-prd.ts'.
    Smoke E2E em test:bridge-e2e: dado um PRD seed (criar via DAL mock OR
    usar PRD existente como 'forge-engine' lendo do markdown sem DB), roda
    emitToForge --dry-run, asserta stories.length > 0, valida shape do
    prd.json gerado.
    Docs: append em docs/runbooks/forge-runbook.md seção 'Bridge from Vitor'
    (3 parágrafos: o que é, como chamar via API/CLI, troubleshoot common
    errors).
  acceptanceCriteria:
    - "scripts/forge/emit-from-prd.ts compila + responde a --help"
    - "package.json adicionou script 'forge:emit-from-prd'"
    - "CLI com --dry-run NÃO modifica filesystem"
    - "CLI com --json output é JSON parseável"
    - "Smoke script:test:bridge-e2e roda + asserta prd.json shape"
    - "docs/runbooks/forge-runbook.md ganha seção 'Bridge from Vitor' (≥3 parágrafos)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "npx tsx scripts/forge/emit-from-prd.ts --help 2>&1 | grep -c 'dry-run'"
      expected: "≥ 1"
  dependsOn: [VTF-006]
  estimateMinutes: 20
  touches:
    - scripts/forge/emit-from-prd.ts
    - package.json
    - docs/runbooks/forge-runbook.md
  agentProfile: wiring
```

---

```
╔════════════════════════════════════════════════════════════╗
║  END OF PRD · Forge ganha cola com Diamond 1.              ║
║  Vitor aprova → Forge consome. Sem humano de meio.         ║
╚════════════════════════════════════════════════════════════╝
```
