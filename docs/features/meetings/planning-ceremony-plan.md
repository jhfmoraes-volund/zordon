# Planning Ceremony — Alto Nível

> Discutido com João em 2026-05-27.
> Memory: `project_meetings_reorg` (seção "Planning Ceremony" — copiloto).

## Em uma frase

**A Planning-cerimônia é o copiloto de planejamento de sprint do PM.** O Alpha lê tudo que importa do contexto — múltiplas reuniões, estado do sistema, código do projeto — e ajuda o PM a construir tasks bem escritas, com base real, durante uma sessão estruturada.

Não é "a reunião onde planejamos a sprint". É **a sessão de planejamento com contexto rico**. A reunião humana (call) é um *insumo*, não a essência.

## Princípios de design

1. **Planning = ARTEFATO próprio (`PlanningCeremony`), não Meeting.** Decisão refinada 2026-05-28: Planning é entidade separada, igual `DesignSession`, respeitando a fronteira EVENTO↔ARTEFATO que custou caro estabelecer na reorg ([[project_meetings_reorg]]). Cadência de "Planning do projeto X" vive em 2 colunas no `Project` (`planningCadence` + `planningActive`) — sem tabela de série até aparecer cadência paralela. Meetings reais (calls) são linkados via `PlanningMeetingLink` quando relevantes.

2. **Fases vivem na PlanningCeremony.** Cada ocorrência tem `phase` (idle / reading / proposing / approving / closed / archived). Traz a UX de Briefing pra dentro de Planning, não de Meeting.

3. **UX é própria, mas o esqueleto é familiar.** Tab "Cerimônias" no projeto lista séries + ocorrências (próxima + histórico). Clicar abre o "command center da planning" — não é o Briefing literal, é mais enxuto.

4. **Composição, não herança.** Reusa peças maduras de Super Planning (MeetingTaskAction, sprint linkage, Alpha tools) e o *padrão* do Briefing (fases, ribbon de stats, governança), sem virar extensão de nenhum.

5. **Curadoria humana antes de magia.** Múltiplos transcripts entram via link manual (N:N reunião↔artefato, modelo já decidido). Alpha não inventa relevância — o PM decide o que alimenta a cerimônia.

## As 3 camadas de contexto

```
                  CONTEXTO QUE O ALPHA LÊ
                  ────────────────────────
   1. CONVERSA            2. SISTEMA              3. CÓDIGO
   (transcripts)          (sprint/backlog)        (GitHub)
   o que o time/cliente   o que o sistema         o que o projeto
   DISSE                  REGISTRA                É de verdade
       │                       │                       │
       └───────────────────────┴───────────────────────┘
                               │
                       ALPHA sintetiza
                       contexto rico
                               │
                               ▼
                       PROPÕE tasks
                       (bem escritas, com base real)
                               │
                               ▼
                       PM aprova/ajusta
                       (MeetingTaskAction — já existe)
                               │
                               ▼
                       Sprint comprometida
```

Diferenciação vs cerimônias do mercado:
- Maioria tem 1-2 dessas camadas.
- Vocês querem as 3 → diferença entre "ata" e "backlog acionável".
- Alpha lendo o repo é o que separa "task de PM" de "task que o dev pega e faz".

## Modelo de dados — SQL estruturado, sem jsonb

> **Princípio orientador (decidido 2026-05-27, pós-aprendizado DS):**
> DS sofreu por usar jsonb monolítico ([[project_design_session_normalization]]). Planning é fortemente relacional (ocorrências, transcripts, repos, capacidade, ações) — **cada conceito vira tabela**.
> Link com reunião/transcrição **é a coluna vertebral**, não opcional. Decidimos: tabelas tipadas próprias (não MeetingArtifactLink polimórfico), TranscriptRef como cidadão de 1ª classe, ContextNote como rows tipadas por kind (não jsonb).

### Visão conceitual

```
Project ─── (planningCadence, planningActive — 2 cols inline)
   │
   │ 1:N
   ▼
PlanningCeremony  (a planning como artefato — NÃO funde com Meeting)
   ├─ projectId, sprintId, phase, facilitatorId
   ├─ scheduledFor, startedAt, briefingGeneratedAt, closedAt, archivedAt
   │
   ├──N:N── PlanningMeetingLink ───── Meeting
   │         (linkedBy, linkedAt, note)
   │
   ├──N:N── PlanningTranscriptLink ── TranscriptRef ── Meeting? (FK opcional)
   │         (weight, note)           (source, sourceId, capturedAt)
   │
   └──1:N── PlanningContextNote (briefing tipado por kind)
            (kind ∈ summary|theme|risk|capacity_signal|code_observation|open_question)
            (sourceTranscriptIds[], sourceMeetingIds[], priority, dismissedAt)

MeetingTaskAction (já existe) ── opcional FK: planningCeremonyId
```

### As 6 tabelas + 2 colunas (skeleton SQL — DDL real vai na migration)

```sql
-- 1. Project (2 colunas inline — sem ProjectCeremonySeries por ora)
ALTER TABLE "Project"
  ADD COLUMN "planningCadence" text CHECK (… IN ('weekly','biweekly')),
  ADD COLUMN "planningActive" boolean NOT NULL DEFAULT false;

-- 2. PlanningCeremony — artefato central
CREATE TABLE "PlanningCeremony" (
  id uuid PK,
  projectId uuid FK→Project ON DELETE CASCADE,
  sprintId uuid FK→Sprint ON DELETE SET NULL,
  phase text CHECK (… IN ('idle','reading','proposing','approving','closed','archived')),
  scheduledFor, startedAt, briefingGeneratedAt, closedAt, archivedAt timestamptz,
  facilitatorId uuid FK→Member,
  createdAt, updatedAt timestamptz,
  UNIQUE (projectId, sprintId)
);
-- Index: (projectId, phase) WHERE phase NOT IN ('closed','archived'); (sprintId).

-- 3. TranscriptRef — transcrição como entidade (extrai de Meeting.transcriptSource)
CREATE TABLE "TranscriptRef" (
  id uuid PK,
  source text CHECK (… IN ('roam','granola','manual')),
  sourceId text,
  title, byline text,
  capturedAt, importedAt timestamptz,
  importedById uuid FK→Member,
  meetingId uuid FK→Meeting ON DELETE SET NULL,  -- transcript pode não ter Meeting
  UNIQUE (source, sourceId)
);
-- Backfill: 1 row por Meeting.transcriptSource existente. Idempotente.

-- 4. PlanningMeetingLink — N:N planning↔meeting (TIPADO, não polimórfico)
CREATE TABLE "PlanningMeetingLink" (
  id uuid PK,
  planningCeremonyId uuid FK→PlanningCeremony ON DELETE CASCADE,
  meetingId uuid FK→Meeting ON DELETE CASCADE,
  linkedById uuid FK→Member, linkedAt timestamptz, note text,
  UNIQUE (planningCeremonyId, meetingId)
);

-- 5. PlanningTranscriptLink — N:N planning↔transcript (com weight)
CREATE TABLE "PlanningTranscriptLink" (
  id uuid PK,
  planningCeremonyId uuid FK→PlanningCeremony ON DELETE CASCADE,
  transcriptRefId uuid FK→TranscriptRef ON DELETE CASCADE,
  linkedById uuid FK→Member, linkedAt timestamptz,
  weight text CHECK (… IN ('primary','supporting','background')),  -- guidance pro Alpha
  note text,
  UNIQUE (planningCeremonyId, transcriptRefId)
);

-- 6. PlanningContextNote — briefing como rows tipadas (NÃO jsonb)
CREATE TABLE "PlanningContextNote" (
  id uuid PK,
  planningCeremonyId uuid FK→PlanningCeremony ON DELETE CASCADE,
  kind text CHECK (… IN (
    'summary','theme','risk','capacity_signal','code_observation','open_question'
  )),
  content text NOT NULL,                  -- markdown curto, atômico
  sourceTranscriptIds uuid[] DEFAULT '{}',-- citação (array tipado; GIN se virar gargalo)
  sourceMeetingIds uuid[] DEFAULT '{}',
  sourceRepoPath text,
  priority int DEFAULT 0,
  dismissedAt timestamptz,                -- PM dismissa sem refazer briefing
  generatedAt timestamptz,
  generatedByAgent text CHECK (… IN ('alpha')),   -- xor:
  generatedByMemberId uuid FK→Member,             --   agente OU membro, nunca ambos
  CHECK ((generatedByAgent IS NOT NULL AND generatedByMemberId IS NULL)
      OR (generatedByAgent IS NULL AND generatedByMemberId IS NOT NULL))
);
-- Index: (planningCeremonyId, kind) WHERE dismissedAt IS NULL.

-- 7. MeetingTaskAction (já existe) — adiciona FK opcional pra rastrear origem
ALTER TABLE "MeetingTaskAction"
  ADD COLUMN "planningCeremonyId" uuid REFERENCES "PlanningCeremony"(id) ON DELETE SET NULL;
```

### Por que esta forma escala (decisões justificadas)

| Cenário (1-2 anos) | Como esta estrutura responde |
|---|---|
| 1000 plannings/mês | Indexes em (projectId, phase), (sprintId). Queries planas. |
| "Quais plannings este transcript alimentou?" | `SELECT FROM PlanningTranscriptLink WHERE transcriptRefId=…` — 1 index hit. |
| Alpha multi-agent (outro agente adiciona note) | `INSERT INTO PlanningContextNote` — concorrência ok. Sem race no jsonb. |
| PM dismissa nota irrelevante | UPDATE `dismissedAt` em 1 row. Sem rewrite do briefing. |
| RLS guest não vê `open_question` | `USING (kind <> 'open_question' OR …)` por linha. |
| Schema evolve (add `effort_estimate`) | ADD COLUMN nullable. Zero backfill. (Foi o que DS sofreu.) |
| Analytics "FP propostos vs aprovados" | JOIN ContextNote × MeetingTaskAction × Task. SQL puro. |
| Roam-note sem Meeting alimenta planning | TranscriptRef sem `meetingId`. Cobertura nativa. |

### Decisões NÃO tomadas aqui (por design)

- **`ProjectCeremonySeries` cortada do MVP.** 1 série por projeto → 2 colunas no Project.
  **Gatilho de promoção pra tabela (explícito, não promessa solta):** quando 2 cadências diferentes coexistirem no mesmo Project (ex: Planning *e* Daily ativas), refatorar pra `ProjectCeremonySeries` **na mesma PR que introduz a segunda cadência** — não depois. Sem gatilho explícito vira débito.
- **Não estendemos `Meeting` com `phase` nem `ceremonySeriesId`.** Planning é artefato separado (igual DS) — respeita a fronteira EVENTO vs ARTEFATO já decidida na reorg ([[project_meetings_reorg]]).

### Decisões refinadas 2026-05-28

- **`MeetingArtifactLink` polimórfico — nunca existiu em prod.** Verificado via `information_schema` 2026-05-28: a tabela nunca foi criada (era plano original da reorg que não virou migration). Migration 0 cortada do MVP. A regra **"todo link no sistema é tipado, sem exceção"** se cumpre naturalmente: `PlanningMeetingLink` e `PlanningTranscriptLink` nascem tipadas; se DS um dia precisar de link com Meeting, nasce como `DesignSessionMeetingLink`. Economia: ~1 dia.
- **`Sprint.capacityFp` — não existe e não precisa.** View `sprint_capacity_overview` já existe e deriva automaticamente: prioriza `SprintMember.fpAllocation` (override por sprint), cai pra `ProjectMember.fpAllocation`, inclui PM via UNION. Ribbon FP/capacidade consome direto da view. Verificado 2026-05-28.
- **`PlanningContextNote.sourceTranscriptIds/MeetingIds uuid[]` — INVERSÃO consciente 2026-05-28 (pós-execução).** Decisão inicial era normalizar em `PlanningContextNoteSource`, mas após o schema rodar João reverteu pra `uuid[]` por pragmatismo: tabela ainda está vazia em prod, normalizar agora gera 7ª tabela sem dado pra justificar. **Trade-off aceito:** princípio "rows tipadas, sem array" tem exceção aqui. **Gatilho de normalização (explícito, pra não virar dívida silenciosa):** quando (a) qualquer query precisar de "que notes este transcript alimentou?" (reverse lookup), OU (b) GIN nos uuid[] virar gargalo medido, criar `PlanningContextNoteSource` + backfill via unnest, e DROP das 2 colunas — na mesma PR que descobre o gatilho, não depois.
- **Modo Alpha = chat ao vivo (copiloto), não batch.** Implicação: streaming (reusa infra Vitor), persistência de mensagens por planning (`PlanningMessage` ou reuso de tabela de chat existente — decidir na implementação), tools do Alpha invocadas no meio da conversa (`add_planning_note` é tool de chat, não job).

## Fluxo da ocorrência (uma planning)

```
1. AGENDADA           PM clica "criar próxima planning" → INSERT em PlanningCeremony.
                      Fase = idle. (Cron automático fica pra fase futura.)

2. PREPARAÇÃO         PM linka N transcripts relevantes (call de cliente, sync,
                      1:1). Fase muda pra `reading`. Alpha começa a ingerir.

3. LENDO              Alpha lê em paralelo:
                      • os transcripts linkados (conversa)
                      • sprint atual + backlog + capacidade (sistema)
                      • GitHub do projeto, se configurado (código)
                      Produz um "briefing de contexto" — o que ele entendeu.
                      PM vê o briefing antes de continuar.

4. PROPONDO           Alpha propõe a composição da sprint:
                      • novas tasks (com descrição rica, baseada em código real)
                      • tasks do backlog que entram
                      • mudanças em tasks existentes
                      Cada proposta → MeetingTaskAction (decision=pending).

5. APROVANDO          PM revisa ação por ação (UI já existe — MeetingTaskActionSheet).
                      Pode editar a descrição antes de aprovar (`wasEdited`).

6. FECHADO            Aprovações aplicadas → tasks na sprint. Fase = closed.
                      Vira input pro Overview/Wiki (Fase 3 do plano original).
```

A UX é familiar (chat + ribbon de stats), mas o **conteúdo** é diferente do Briefing: em vez de story-tree, é sprint-composition.

## Máquina de estados — fases da planning

> Trava `phase` ANTES de qualquer migration. `Meeting.type` virou 83 decision points por falta disso — não repetir.

| De → Para | Quem dispara | Pré-condição | Side effect |
|---|---|---|---|
| `idle → reading` | PM clica "começar briefing" | ≥1 transcript OU meeting linkado | enfileira ingestão Alpha; stamp `startedAt` |
| `reading → proposing` | Alpha emite "briefing pronto" no chat | ≥1 `PlanningContextNote` de `kind='summary'` E ≥3 outras notes | stamp `briefingGeneratedAt`; UI revela ações |
| `proposing → approving` | PM clica "revisar" | ≥1 `MeetingTaskAction` pending | trava criação de novas actions pelo Alpha |
| `approving → closed` | PM aprova/dispensa todas | 0 actions pending | aplica MeetingTaskAction → tasks; stamp `closedAt` |
| `reading\|proposing → idle` | PM "resetar briefing" | — | DELETE `PlanningContextNote` desta planning; mantém links |
| `closed → archived` | cron (30d após close) OU PM manual | — | só pra Overview/Wiki não poluir |

**Implementação:** `src/lib/planning/phase.ts` (TS puro, testável) + validação na API antes do UPDATE. Aprendizado Meeting (`canViewMeeting` TS + `can_view_meeting` SQL precisam coexistir) — adiciona **trigger `BEFORE UPDATE` leve** em `PlanningCeremony` que rejeita transições impossíveis (ex: `closed → reading`). TS valida ricamente (pré-condições, side effects); trigger é só o cinto de segurança contra escrita via service_role/seed.

## O que reusa, o que é novo

**Reusa (já existe e funciona):**
- `MeetingTaskAction` (aprovação ação por ação) — ganha FK opcional `planningCeremonyId`
- Alpha tools: `get_sprint_overview`, `get_allocated_project_members`, `get_backlog`, `list_unplanned_tasks`, `create_task`, `bulk_update_tasks`, `update_task`, `manage_allocation`
- Tab Cerimônias no projeto (já adicionado em [`src/components/project-ceremonies-tab.tsx`](src/components/project-ceremonies-tab.tsx))
- `MeetingProjectLink` + sprint linkage
- Pattern de import de transcript (Roam/Granola) — só passa a popular `TranscriptRef`

**Novo (precisa construir):**
- 6 tabelas SQL (ver "Modelo de dados") + backfill de `TranscriptRef` a partir de `Meeting.transcriptSource`
- `src/lib/planning/phase.ts` — máquina de estados (tabela acima)
- `src/lib/dal/planning.ts` — DAL com RLS
- API: `POST /api/planning`, `PATCH /api/planning/[id]`, `POST /api/planning/[id]/phase`, `POST /api/planning/[id]/transcripts`, `POST /api/planning/[id]/meetings`
- Tela "command center da planning" (chat + ribbon próprios — **escrever do zero**, não copiar Briefing; extrair primitivas só quando shape estabilizar)
- Alpha tools novas:
  - `list_planning_context(planningId)` — lê transcripts (com weight) + notes + meetings linkados
  - `add_planning_note(planningId, kind, content, sources)` — Alpha escreve em `PlanningContextNote`
  - `read_project_github(projectId)` — **MVP = README + tree** (decisão tomada, não deferir; promove pra Vitor MCP só quando (a) provar limitação real)
- Lógica de cadência/agendamento — **MVP só manual** (botão "criar próxima planning"); cron na próxima leva
- **Capacity awareness** explícita: Alpha consulta `Sprint.capacityFp` (ou deriva de allocations) e propõe volume calibrado; ribbon mostra `propostas FP / capacidade`

## MVP — escopo (revisado pós-decisão SQL-first)

**Entra no MVP (revisado 2026-05-28 pós-validação de prod):**
1. ~~Migration 0 — limpeza polimórfica~~ **(cortada — `MeetingArtifactLink` nunca existiu em prod)**.
2. Schema completo das **7 tabelas** (6 + `PlanningContextNoteSource`) + 2 colunas no Project + backfill `TranscriptRef` (8 rows Granola, trivial).
3. Tab Cerimônias listando plannings do projeto + próxima ocorrência manual + histórico.
4. UI "command center" enxuto: **chat ao vivo com Alpha** (streaming, reusa infra Vitor) + ribbon FP/capacidade + lista de notes + lista de actions.
5. Fases completas (`idle → reading → proposing → approving → closed → archived`) com trigger SQL guardrail.
6. Link manual de múltiplos transcripts (com `weight`) E meetings (PM cura).
7. Alpha lê transcripts (linked) + sistema (sprint/backlog/capacidade) + GitHub (README+tree).
8. Alpha escreve `PlanningContextNote` **durante o chat** (tools invocadas mid-conversation, não job background).
9. Alpha propõe tasks via `MeetingTaskAction` (PM aprova) — com `planningCeremonyId` rastreado.
10. Ribbon mostra capacity-vs-proposed em tempo real.

**Tamanho honesto:** MVP cresceu ~2-3 dias com as 3 decisões refinadas (link tipado + normalização + chat ao vivo). Custo pago consciente pra não acumular dívida.

**Decisões tomadas (não deferir mais):**
- GitHub no MVP = **README + tree** (não Vitor MCP/semantic). Promove só se (a) provar insuficiente em uso real.
- Cadência = **só botão manual** ("criar próxima planning"). Cron fica pra próxima leva.
- UI = **escrever do zero**, sem reaproveitar Briefing primitives. Extrai depois.
- Links = **tabelas tipadas próprias** (não MeetingArtifactLink genérico).

**Fora do MVP (fases futuras, em ordem):**
- Cron de agendamento automático (cria PlanningCeremony da próxima sprint).
- Daily/Review como cerimônias (cada uma com seu artefato; Daily provavelmente bem mais leve).
- Alpha sugerindo relevância de transcripts (auto-link com confirmação humana).
- Extração das primitivas de UI (`<CommandCenter>`, `<ContextRibbon>`) compartilhadas com Briefing.
- GitHub semantic via Vitor MCP/Volund v2 ([[project_vitor_mcp_volund_v2]]).
- Status semanal automático ([[project_meetings_reorg]] Fase 3 — Alpha → Wiki).
- Analytics agregada: FP propostos vs aprovados, hit-rate de notes, tempo médio por fase.

## Riscos honestos

1. **Backfill do TranscriptRef precisa ser idempotente.** Se rodar 2× não pode duplicar. `INSERT … ON CONFLICT (source, sourceId) DO NOTHING`. Janela curta — poucos meetings com transcript hoje.

2. **Dual-presence de transcriptSource em Meeting + TranscriptRef.** Não dual-write (aprendizado DS). Depois do backfill, código novo lê SÓ de `TranscriptRef`. Limpar a coluna `Meeting.transcriptSource` é PR separado, com sweep nos 5 lugares que leem.

3. **"Bem escrita" é critério humano.** Primeira leva vai ter ajuste de prompt e exemplos. Não é one-shot. Reservar tempo de iteração no Alpha (prompt + few-shots) tanto quanto no código.

4. **Risco de criar entidade demais (ainda).** 6 tabelas é o **máximo** justificado pelo aprendizado DS. Toda tabela 7ª passa por: "é tabela ou coluna?". Princípios: 1 conceito = 1 tabela, N:N tipado, jsonb nunca pra dados consultáveis.

5. **Fronteira com Briefing.** Briefing é design-time (Vitor, story-tree, único por DS). Planning é operation-time (Alpha, sprint-composition, recorrente). Não copiar primitivas agora — escrever do zero. Extrair só quando shape estabilizar (provavelmente 2-3 sprints de uso real).

6. **Capacity = ground truth.** Se `Sprint.capacityFp` não existe ou está desatualizado, todo cálculo de "propostas FP vs capacidade" é teatro. **Verificar primeiro** se o campo existe e tem dado; se não, é pré-requisito antes do MVP, não dentro dele.

## Ordem de execução (cada passo entregável)

1. ~~Verificação prévia capacityFp~~ **resolvido**: view `sprint_capacity_overview` já existe e deriva. Código consome direto.
2. ~~Migration 0~~ **cortada**: `MeetingArtifactLink` nunca existiu em prod.
3. **Migration 1 — fundação transcript:** `TranscriptRef` + backfill idempotente dos 8 `Meeting.transcriptSource` (todos Granola). Atualiza `database.types.ts`. Entrega autônoma, reusável.
4. **Migration 2 — planning core:** `Project.planningCadence/Active` + `PlanningCeremony` + `PlanningMeetingLink` + `PlanningTranscriptLink` + RLS + trigger guardrail de phase. Atualiza types.
5. **Migration 3 — context normalizado:** `PlanningContextNote` + `PlanningContextNoteSource` (sem `uuid[]`) + FK opcional em `MeetingTaskAction.planningCeremonyId`.
5. **TS state machine:** `src/lib/planning/phase.ts` + tests.
6. **TS state machine:** `src/lib/planning/phase.ts` + tests (transições válidas, pré-condições por fase).
7. **DAL:** `src/lib/dal/planning.ts` (queries com joins de transcripts/meetings/notes/sources; visibilidade via RLS).
8. **API:** rotas `POST/PATCH /api/planning`, `/phase`, `/transcripts`, `/meetings`, `/notes`. Validação Zod só aqui ([[project_ui_patterns]]).
9. **Alpha tools:** `list_planning_context`, `add_planning_note` (chamada mid-chat), `read_project_github` (versão README+tree). Prompt da Alpha ganha seção condicional pra fluxo Planning.
10. **UI command center (chat ao vivo):** componente `<PlanningCommandCenter>` consumindo `ResponsiveSheet` + `Field`/`FormBody`. Streaming reusa infra Vitor (`BriefingTaskChat`-like). `useOptimisticCollection` pra notes e actions.
11. **Wire da tab Cerimônias:** lista plannings do projeto, abre command center. Botão "criar próxima planning" (manual).

Cada passo é PR fechado. 2 (migration 0 polimórfico) é independente e pode rodar antes de tudo. 3→5 podem rodar no mesmo dia se a janela permitir; 6→11 são incrementais.

---

**Princípio final:** isto não é uma reunião com cara nova. É um copiloto que respeita o ritmo da sprint. Se em qualquer fase de execução parecer que estamos rebatizando ata de reunião, parar e revisar — provavelmente perdemos a fronteira.
