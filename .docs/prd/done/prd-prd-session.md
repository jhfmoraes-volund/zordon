# PRD — PRD Session (atalho pra criar PRDs sem Inception completa)

> **Contexto:** Hoje PRDs nascem como arquivos `.md` no Zordon ou via Vitor (Inception completa). Cliente que já tem PRDs prontos OU tem ideia simples ("clone app X") não tem caminho fluído. Esta feature cria um **session type leve** com dois modos: upload e quick-ask.

## 1 · Problema

1. **Cliente com PRDs prontos não tem porta de entrada.** Ele tem markdowns/specs próprios → hoje precisa: rodar Inception inteira (overkill) OU pedir pra um PM copiar pro Zordon (manual, error-prone).
2. **Ideia simples não justifica Inception.** "Cliente quer clonar Instagram" não precisa de discovery 4-fases; precisa de PRDs derivados rapidamente.
3. **Vitor (PM agent) já gera PRDs em Inception** — capacidade desperdiçada quando o caso é simples.

Resultado: PRDs ficam estancados em arquivos locais OU PMs perdem tempo digitando, em vez do que deveriam (executar Forge).

## 2 · Solução em uma frase

Novo tipo de Session "prd_session" — versão lightweight da Inception com **modo upload** (paste/upload markdown → cria rows em `ProductRequirement`) e **modo quick-ask** (chat curto com Vitor → ele gera PRDs estruturados em segundos).

## 3 · Não-objetivos

- Não substitui Inception (que continua sendo o caminho profundo de discovery).
- Não suporta upload de outros formatos além de Markdown nesta fase.
- Não faz versionamento de PRDs (V2; usa `ProductRequirement.version` no schema).
- Não orquestra Forge auto (PM ainda dispara manualmente após criação).
- Não bloqueia se PRD upload tiver schema fora de §1-§16 (aceita; valida com warnings).

## 4 · Personas e jornada

- **Cliente com PRDs prontos**: tem 5 markdowns escritos no Notion. Acessa Project → Sessions → "+ Nova Session" → escolhe **PRD Session (upload)** → cola/anexa os 5 → revisa → aprova → vê 5 rows em ProductRequirement.
- **Cliente com ideia rápida**: acessa Project → Sessions → "+ Nova Session" → escolhe **PRD Session (quick-ask)** → escreve em 2-3 frases "quero clonar Instagram com Stories e Reels" → Vitor gera 4-8 PRDs em ~30s → revisa → aprova.
- **PM**: vê ambas como Session normal no projeto; pode editar/aprovar antes de Forge consumir.

## 5 · Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| D1 | Aproveita `DesignSession` table com novo `type='prd_session'` | Não criar entidade nova; reusa relacionamentos (Project, Member, etc). |
| D2 | UI: `/projects/[id]/sessions/new` mostra picker com 3 opções (Inception / PRD Session / privado) | Padrão atual já tem picker; só estende. |
| D3 | Dois subTipos via coluna `DesignSession.subKind`: `upload` ou `quick_ask` | Schema simples; campos extras só quando precisar. |
| D4 | Upload accepts: paste textarea OR drag-drop de até 10 .md files | Cobre 95% dos casos sem inflar UI. |
| D5 | Parser permissivo — extrai só `title` (H1) + `problem` (primeiro §) + `acceptanceCriteria` (lista) | Não exige PRD perfeito; aceita texto livre + cria com warnings. |
| D6 | Quick-ask roda com Vitor connector existente, prompt especializado "PRD Generator" | Reusa infra; novo prompt em `src/lib/agent/vitor/prompts/prd-quickask.ts`. |
| D7 | Approval: cada PRD gerado vira `ProductRequirement.status='draft'`; PM clica "Aprovar" → `status='ready'` | Mesmo lifecycle do Inception. |
| D8 | Sem auto-disparo da Forge — PM disparar manualmente depois | Aprovação humana é gate intencional. |
| D9 | quick-ask hard cap: 10 PRDs por session | Anti-spam, anti-token-burn. |
| D10 | Sessions PRD são deletáveis após archive (PRDs persistem) | DS Inception é immutable; PRD Session é descartável. |

## 6 · Arquitetura

```
PM clica "+ Nova Session" em /projects/[id]/sessions
                │
                ▼ picker
        ┌───────┴───────┐
        │               │
   Inception      PRD Session
   (existing)         (NEW)
                       │
                       ▼ subKind picker
              ┌────────┴────────┐
              │                 │
          Upload          Quick-ask
              │                 │
              ▼                 ▼
      paste/upload      chat com Vitor
      .md files         (3-5 turnos)
              │                 │
              ▼                 ▼
      parsePrdMarkdown   Vitor.generatePrds(brief)
              │                 │
              └────────┬────────┘
                       ▼
              ProductRequirement[] (status=draft)
                       │
                       ▼
         PM revisa → clica "Aprovar" → status=ready
                       │
                       ▼
              Forge spike vê PRD pronto pra rodar
```

## 7 · Schema

```sql
-- supabase/migrations/20260601c_prd_session_subkind.sql
ALTER TABLE "DesignSession"
  ADD COLUMN "subKind" text;

-- (type já existe; valores válidos passam a incluir 'prd_session')
COMMENT ON COLUMN "DesignSession"."subKind" IS
  'Specialization within type. For type=prd_session: upload | quick_ask. NULL para outros types.';

CREATE INDEX ix_designsession_type_subkind
  ON "DesignSession" (type, "subKind")
  WHERE type = 'prd_session';
```

RLS herda do DesignSession existente.

## 8 · APIs

```ts
// POST /api/sessions/prd/upload
// body: { projectId, files: [{ filename, content }] }
// response: { sessionId, productRequirements: PRRow[] }
// idempotente; mesma payload → mesma session (hash check)

// POST /api/sessions/prd/quick-ask/start
// body: { projectId, brief }
// response: 202 + { sessionId, jobId }
// Vitor processa async; cliente polla GET /api/jobs/[jobId]

// GET /api/sessions/[id]
// retorna session + nested ProductRequirements (status=draft|ready)

// POST /api/sessions/[id]/approve-prd
// body: { productRequirementId }
// promove draft → ready
```

## 9 · UX

**Picker de nova session:**
```
Nova Session                                                  [×]

  ┌──────────────┬──────────────┬──────────────┐
  │ Inception    │ PRD Session  │ Reunião      │
  │ Discovery    │ Upload OU    │ Daily, 1:1,  │
  │ completa     │ Quick-ask    │ Planning     │
  │ 4 fases      │ 5-10min      │              │
  └──────────────┴──────────────┴──────────────┘

  Cancelar                                       [ Próximo ]
```

**PRD Session, modo Upload:**
```
PRD Session — Upload                                          [×]

  Cole markdown ou arraste .md (máximo 10)

  ┌───────────────────────────────────────────────────┐
  │ ## PRD: User Auth                                  │
  │ Problema: ...                                      │
  │ ...                                                │
  │                                                    │
  │                  Arraste arquivos aqui             │
  │                  ou clique pra selecionar          │
  └───────────────────────────────────────────────────┘

  3 PRDs detectados · 2 com warnings (faltando AC)

  Cancelar                                  [ Criar Session ]
```

**PRD Session, modo Quick-ask:**
```
PRD Session — Quick-ask com Vitor                             [×]

  ─── Vitor ───────────────────────────────────────
    Em 2-3 frases, o que você quer construir?

  ─── Você ────────────────────────────────────────
    [textarea: quero clonar o Instagram com Reels...]

                                          [ Enviar ]

  ─── Vitor ───────────────────────────────────────
    Entendi. Gerei 6 PRDs:
    ▸ prd-user-auth
    ▸ prd-feed-timeline
    ▸ prd-reels-recorder
    ▸ ... (3 more)

    Cancelar                            [ Aprovar todos ]
```

## 10 · Integrações

- **DesignSession entity** ganha `subKind` coluna.
- **ProductRequirement entity** (já existe) recebe rows criadas com `designSessionId` apontando pra essa session.
- **Vitor agent** (`src/lib/agent/vitor/`) ganha prompt especializado "quick-ask PRD generator".
- **Forge spike** consome PRDs `status='ready'` linkados ao Project (depois que `prd-forge-project-tab` shippar, fica visível na project tab).
- **Sessions list page** (`/projects/[id]/sessions/`) renderiza PRD Sessions com badge diferente das Inceptions.

## 11 · Faseamento

| Fase | Entrega |
|---|---|
| 1 | Migration `subKind` + DAL para criar PRD session |
| 2 | Upload mode: parser de markdown + endpoint + UI |
| 3 | Quick-ask mode: prompt Vitor + endpoint async + UI |
| 4 | Approval flow (draft → ready) + render na sessions list |

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Parser de markdown muito frouxo → PRDs ruins | A | M | D5: aceita com warnings; PM revisa antes de aprovar |
| Quick-ask custa muito token (cliente abusa) | M | M | D9: cap 10 PRDs/session; rate limit por owner |
| Cliente upload PRD com info sensível | M | A | Nota de privacy no upload UI; LGPD/SOC2 disclaimer |
| Vitor gera PRDs ruins p/ briefs vagos | A | M | Vitor pode pedir clarificação até 3× antes de gerar |
| PRDs com mesmo title viram dupes | M | B | Unique constraint em (projectId, reference); reference auto-gerado de slug(title) |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| % de Projects com pelo menos 1 PRD Session em 1 mês | `SELECT count(DISTINCT projectId) FROM DesignSession WHERE type='prd_session' / count(*) FROM Project` | ≥ 60% |
| Razão Quick-ask vs Upload | count(subKind='quick_ask') / count(subKind='upload') | mensurado, sem target rígido (revela preferência) |
| % PRDs aprovados (vs descartados) na revisão | `SELECT count(*) FILTER (status='ready') / count(*) FROM ProductRequirement WHERE designSession.type='prd_session'` | ≥ 70% |
| Tempo médio sessão upload (criação → aprovação) | timestamps na DesignSession | ≤ 5min mediana |
| Tempo médio sessão quick-ask | mesma fonte | ≤ 10min mediana |

## 14 · Open questions

Nenhuma. Tudo decidido em §5.

## 15 · Referências

- Memory `project_design_session.md` — Design Session conceito
- Memory `project_vitor_as_pm.md` — Vitor gera PRDs
- Memory `project_zordon_ops_pipeline.md` — pipeline canônico
- `src/lib/supabase/database.types.ts` — DesignSession + ProductRequirement
- `src/lib/agent/vitor/` — Vitor connector
- `src/app/(dashboard)/projects/[id]/sessions/` — sessions page (estrutura atual)

## 16 · Stories implementáveis

```yaml
- id: PRS-001
  title: Migration DesignSession.subKind + 'prd_session' type
  description: |
    ALTER TABLE DesignSession ADD COLUMN subKind text. Tipo 'prd_session' já
    pode existir como string no campo type. Índice parcial type+subKind.
  acceptanceCriteria:
    - "supabase/migrations/20260601c_prd_session_subkind.sql criado e aplicado"
    - "Coluna DesignSession.subKind existe (text nullable)"
    - "Índice ix_designsession_type_subkind existe com WHERE type='prd_session'"
    - "database.types.ts atualizado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT column_name FROM information_schema.columns WHERE table_name='DesignSession' AND column_name='subKind'"
      expected: "subKind"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - supabase/migrations/20260601c_prd_session_subkind.sql
    - src/lib/supabase/database.types.ts
  agentProfile: db

- id: PRS-002
  title: parsePrdMarkdown — extrai title + problem + AC de markdown
  description: |
    Função pura que recebe markdown text e retorna { title, oneLiner?, problem?,
    acceptanceCriteria[], warnings[] }. Permissiva (D5). Usa regex simples,
    sem AST parser pesado.
  acceptanceCriteria:
    - "src/lib/sessions/prd-session/parser.ts exporta parsePrdMarkdown(text): ParsedPrd"
    - "Type ParsedPrd tem title (string), oneLiner (string?), problem (string?), acceptanceCriteria (string[]), warnings (string[])"
    - "Title extraído do primeiro H1; warnings.push se ausente"
    - "AC extraídos de listas após heading 'Acceptance Criteria' (case-insensitive)"
    - "Unit test: 3 PRDs de exemplo retornam shape correto"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/sessions/prd-session/parser.ts
  agentProfile: db

- id: PRS-003
  title: POST /api/sessions/prd/upload — endpoint + DAL
  description: |
    Recebe { projectId, files }, cria DesignSession (type='prd_session',
    subKind='upload'), parseia cada file, cria ProductRequirement rows
    (status='draft'). Idempotente via hash do payload.
  acceptanceCriteria:
    - "src/app/api/sessions/prd/upload/route.ts implementa POST"
    - "Validation Zod no body (max 10 files, max 200kb cada)"
    - "Cria DesignSession + N ProductRequirement em transação"
    - "Hash SHA256 do payload em DesignSession.meta.payloadHash"
    - "Retry com mesma payload retorna sessionId existente (sem dupe)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -X POST http://localhost:3333/api/sessions/prd/upload -H 'Content-Type: application/json' -d '{\"projectId\":\"abc\",\"files\":[{\"filename\":\"x.md\",\"content\":\"# Test\"}]}'"
      expected: "JSON with sessionId"
  dependsOn: [PRS-001, PRS-002]
  estimateMinutes: 30
  touches:
    - src/app/api/sessions/prd/upload/route.ts
    - src/lib/sessions/prd-session/dal.ts
  agentProfile: api

- id: PRS-004
  title: Vitor prompt "quick-ask PRD generator"
  description: |
    Prompt especializado que recebe brief (2-3 frases) e gera array de PRDs
    estruturados. Output schema Zod-validado. Cap 10 PRDs por chamada.
  acceptanceCriteria:
    - "src/lib/agent/vitor/prompts/prd-quickask.ts exporta promptTemplate + outputSchema"
    - "outputSchema valida array de PRDs com title, oneLiner, problem, AC, dependencies"
    - "Função generatePrdsFromBrief(brief): Promise<ParsedPrd[]> existe"
    - "Hard cap: response truncated a 10 items"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [PRS-002]
  estimateMinutes: 25
  touches:
    - src/lib/agent/vitor/prompts/prd-quickask.ts
  agentProfile: api

- id: PRS-005
  title: POST /api/sessions/prd/quick-ask/start — async endpoint
  description: |
    Recebe { projectId, brief }, cria DesignSession (subKind='quick_ask'),
    enfileira job. Retorna 202 + { sessionId, jobId }. Job worker chama
    Vitor.generatePrdsFromBrief, popula ProductRequirements (draft).
  acceptanceCriteria:
    - "src/app/api/sessions/prd/quick-ask/start/route.ts retorna 202 + ids"
    - "Job criado em ForgeJob (ou similar) com type='prd_quickask'"
    - "Worker processa async; popula ProductRequirements quando termina"
    - "GET /api/jobs/[jobId] retorna status (queued|running|done|failed)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -X POST http://localhost:3333/api/sessions/prd/quick-ask/start -H 'Content-Type: application/json' -d '{\"projectId\":\"abc\",\"brief\":\"clone instagram\"}'"
      expected: "JSON 202 with sessionId and jobId"
  dependsOn: [PRS-001, PRS-004]
  estimateMinutes: 30
  touches:
    - src/app/api/sessions/prd/quick-ask/start/route.ts
    - src/lib/sessions/prd-session/jobs.ts
  agentProfile: api

- id: PRS-006
  title: UI ResponsiveSheet — PRD Session upload
  description: |
    Modal aberto via "+ Nova Session" → PRD Session → Upload. Textarea +
    drag-drop até 10 .md files. Preview ao vivo (PRDs detectados +
    warnings). Botão "Criar Session" POST /api/sessions/prd/upload.
  acceptanceCriteria:
    - "src/components/sessions/prd-session/upload-sheet.tsx implementa ResponsiveSheet"
    - "Drag-drop limita a 10 files .md (extension check)"
    - "Preview mostra título extraído + warnings em tempo real"
    - "Botão Criar dispatcha POST + redirect pra /projects/[id]/sessions/[sessionId]"
    - "Erro de network mostra toast (não Dialog)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm exec eslint src/components/sessions/prd-session/upload-sheet.tsx"
      expected: "exit 0"
  dependsOn: [PRS-003]
  estimateMinutes: 30
  touches:
    - src/components/sessions/prd-session/upload-sheet.tsx
  agentProfile: ui

- id: PRS-007
  title: UI ResponsiveSheet — PRD Session quick-ask
  description: |
    Modal com mini-chat com Vitor (3-5 turnos). Textarea com brief, envia,
    Vitor responde com lista de PRDs detectados. Botão "Aprovar todos" ou
    individual.
  acceptanceCriteria:
    - "src/components/sessions/prd-session/quick-ask-sheet.tsx implementa ResponsiveSheet"
    - "Chat UI usa padrão existente em src/components/agent/"
    - "POST inicial → polling GET jobs/[id] a cada 2s → atualiza UI quando done"
    - "Botão 'Aprovar todos' faz batch PATCH para mover status draft→ready"
    - "Sem avatar (per feedback_chat_ui memory)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm exec eslint src/components/sessions/prd-session/quick-ask-sheet.tsx"
      expected: "exit 0"
  dependsOn: [PRS-005]
  estimateMinutes: 35
  touches:
    - src/components/sessions/prd-session/quick-ask-sheet.tsx
  agentProfile: ui

- id: PRS-008
  title: Picker de Session no /projects/[id]/sessions/new
  description: |
    Estende picker atual com card "PRD Session". Click abre sub-picker
    (upload / quick-ask). Cada sub-card abre sheet correspondente.
  acceptanceCriteria:
    - "src/app/(dashboard)/projects/[id]/sessions/new/page.tsx (ou componente picker) tem card PRD Session"
    - "Sub-picker mostra Upload e Quick-ask com ícones lucide"
    - "Cards seguem padrão visual das outras Sessions"
    - "Sem novo tipo de animação ou tema"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [PRS-006, PRS-007]
  estimateMinutes: 20
  touches:
    - src/app/(dashboard)/projects/[id]/sessions/new/page.tsx
  agentProfile: ui
```

Total: 8 stories, ~210min estimados.
