```
  ███████╗ ██████╗ ██████╗  ██████╗ ███████╗
  ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝
  █████╗  ██║   ██║██████╔╝██║  ███╗█████╗
  ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝
  ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
        AGENT FACTORY · ZRD · v1
```

# FORGE — Runbook

> **Este documento é a FORJA.** Não descreve a FORGE. **É** a FORGE.
> Você abre, executa, e ela martela até o produto sair pronto.
> Não há saída neutra: cada fase fecha com gate; gate falha = volta ao loop;
> gate passa = avança. Termina só quando o último BOSS cai.

> **Companion**: nenhum. O runbook é único e autocontido.
> **Convenção de commit**: `ZRD-JM-NN: forge — <fase> — <slug>`.
> **Push**: `bash scripts/sync-main.sh -m "..."` (default, todos os remotes).
> **Migrations**: `psql "$DIRECT_URL" -f supabase/migrations/<file>.sql`.

---

## 0 · BRANDING — O QUE A FORGE É

```
NOME           FORGE
TIPO           Agent Factory · observatório vivo por projeto
CÓDIGO         forge-v1
ROTA           /forge                      (hub, top-level no sidebar)
               /forge/[projectId]          (observatório do projeto)
ACESSO         access_level >= builder     (não é mais dev-only)
TOM            sóbrio, mesmo idioma do app. Acento arcade (cyan / magenta)
               só em estado vivo: PixelBar, status dots, run em andamento.
TIPOGRAFIA     HUD: sans uppercase tracking-wider (text-[10px/11px])
               READOUTS: mono tabular-nums
               LOG (Mind tab): mono 12px com cursor █ no último parágrafo
FORMA          Card, Button, Sheet do design system. PixelBar e mono
               tabular são o tempero. Sem scanline, sem CRT vignette
               pesada, sem ASCII na UI, sem glow neon dominante.
SOM            off por default · 4 SFX opcionais (spawn/done/error/boss)
```

**Pipeline canônico (não-negociável):**

```
Design Session  ─►  Module + UserStory  ─►  ForgeTask  ─►  Run agêntica (ou humana)
   (alinhar)         (decompor)               (executar)        (resultado)
```

A FORGE é a etapa de **execução**. Tudo que é código passa por aqui. Tasks
humanas (deploy, design call, validação UX) convivem na mesma lista, marcadas
com `type=human`, e podem ser filtradas. A FORGE é suficiente porque está
plugada nos melhores modelos — basta alimentar bem (DS → Stories) que o
agente trabalha.

**Manifesto de UX (não-negociável):**

1. **60fps ou morte.** Tudo que pisca, anima, ou stream fica fora do React state.
2. **Latência percebida ≤ 80ms** do evento server → pixel na tela.
3. **Backpressure é design**, não bug: ao receber 200 eventos em 100ms, **batch e renderiza 1 frame**, nunca enfileira render.
4. **Side-sheet do agente é uma janela mágica**: o agente continua trabalhando, a UI continua viva, mesmo sheet aberto, mesmo em mobile.
5. **Sem skeletons.** Se está vazio, mostre o HUD vazio com `--` e barras escuras. Skeleton é mentira.
6. **Sobriedade é regra. Arcade é tempero.** A FORGE mora dentro do app — não é ilha visual. PixelBar, mono tabular e dots tonais carregam o sabor. Card/Button/Sheet do design system carregam a forma.
7. **Game-feel checklist por componente** (cada gate exige todos):
   - [ ] Tem tonalidade por estado (cor do dot/barra muda com status, sutil).
   - [ ] Tem easing (lerp ≥ 120ms) ou step quantizado proposital.
   - [ ] Tem readout numérico tabular.
   - [ ] Tem reação ao hover (não é só decorativo).

---

## 1 · ARQUITETURA (LEIA ANTES DE CODAR)

```
Sidebar
  └─ Forge ─► /forge                                HUB (lista projetos)
                  │
                  └─► /forge/[projectId]            OBSERVATÓRIO
                        ├─ Header projeto + breadcrumb
                        ├─ ForgeHud (Run progress global)
                        ├─ FactoryLineList (forge_tasks do projeto)
                        ├─ Filtros: All / Agentic / Human / Done
                        └─ Click row ─► TaskSheet (Mind/Tools/Metrics)
```

```
                    ┌──────────────────────────────┐
                    │  SUPABASE  ·  forge_event    │  append-only
                    │  realtime postgres_changes   │  (run_id, seq, ts)
                    └──────────────┬───────────────┘
                                   │ stream
                                   ▼
                    ┌──────────────────────────────┐
                    │  ForgeStore  (vanilla TS)    │  fora do React
                    │  · ordering buffer por seq   │  framework-agnostic
                    │  · batch flush 16ms (1 frame)│  tree reducer
                    │  · subscribe(sliceFn) → fn   │
                    └─────┬────────┬───────────────┘
                          │        │
                ┌─────────▼──┐  ┌──▼──────────────────┐
                │ HUD topo   │  │ FactoryLineList     │  rows clicáveis
                │ progress   │  │ row = forge_task    │  DOM updates via raf
                │ run        │  │ slice por task.id   │  (não re-render)
                └────────────┘  └──┬──────────────────┘
                                   │ onClick(taskId)
                                   ▼
                          ┌──────────────────┐
                          │ TaskSheet        │  ResponsiveSheet size=lg
                          │ Mind/Tools/Met   │  3 abas, escopo = task
                          └──────────────────┘
```

**Regras de fluxo (lei):**

- **L1.** Componente nunca lê `store.state` direto. Sempre via `useForgeSlice(selector, equalityFn)`.
- **L2.** Animação de barra **não vive em state** — `style.width = ...` via `requestAnimationFrame` lendo da store fora do reconciler. (Refs ok; setState nas barras: proibido.)
- **L3.** Source da verdade é Supabase. Mock implementa a **mesma interface de source**. Trocar mock → realtime é um toggle no provider, **um arquivo**.
- **L4.** Eventos chegam fora de ordem: store **ordena por `(run_id, seq)`**, mantém buffer, drena em ordem.
- **L5.** Subagent spawn é um evento (`kind='spawn'`, `parent_id`). Reducer monta a árvore.
- **L6.** Render budget: **≤ 4ms por frame**. Estoura → bug.
- **L7.** Forge_task pertence a **um projeto** (`project_id` not null). Lista do Hub agrega por projeto, observatório filtra por projeto.

---

## 2 · ESQUEMA DE DADOS (CONTRATO IMUTÁVEL)

> v1 — adiciona escopo de projeto + tipo agentic/human.

```sql
-- supabase/migrations/<date>_forge_v1.sql
-- TUDO em uma transação. RLS via ProjectAccess (can_view_project + is_manager
-- bypass; mutações usam can_edit_tasks). Realtime ligado nas 4 tabelas.
-- Convenção: tabelas PascalCase quoted, colunas camelCase quoted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "ForgeRun" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"   uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "ownerId"     uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  title         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('queued','running','done','error','aborted')),
  progress      int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  trigger       text NOT NULL CHECK (trigger IN ('story','task','ad_hoc')),
  "triggerRef"  uuid,                                -- id da story/task; null p/ ad_hoc
  "startedAt"   timestamptz,
  "endedAt"     timestamptz,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ForgeAgent" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "runId"       uuid NOT NULL REFERENCES "ForgeRun"(id) ON DELETE CASCADE,
  "parentId"    uuid REFERENCES "ForgeAgent"(id) ON DELETE CASCADE,
  name          text NOT NULL,
  role          text NOT NULL,                       -- 'root' | 'subagent' | 'tool'
  status        text NOT NULL CHECK (status IN ('idle','spawning','thinking','tool','streaming','done','error')),
  progress      int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  "tokensIn"    int  NOT NULL DEFAULT 0,
  "tokensOut"   int  NOT NULL DEFAULT 0,
  "costUsd"     numeric(10,4) NOT NULL DEFAULT 0,
  "startedAt"   timestamptz,
  "endedAt"     timestamptz,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Linha de produção da FORGE. Unidade atômica de execução.
-- type=agentic → roda no agente. type=human → marca p/ Builder/Designer/Ops.
CREATE TABLE "ForgeTask" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"     uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "userStoryId"   uuid REFERENCES "UserStory"(id) ON DELETE SET NULL,
  "runId"         uuid REFERENCES "ForgeRun"(id) ON DELETE SET NULL,  -- null se ainda na queue
  "agentId"       uuid REFERENCES "ForgeAgent"(id) ON DELETE SET NULL,
  ord             int  NOT NULL,                     -- ordem dentro do projeto (#001, #002, ...)
  title           text NOT NULL,
  type            text NOT NULL DEFAULT 'agentic' CHECK (type IN ('agentic','human')),
  "assigneeId"    uuid REFERENCES "Member"(id),      -- só relevante p/ type=human
  "dueDate"       timestamptz,                       -- só relevante p/ type=human
  status          text NOT NULL CHECK (status IN (
                    'queued','idle','spawning','thinking','tool','streaming','done','error',
                    'todo','doing','blocked'         -- estados humanos
                  )),
  progress        int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  "currentTool"   text,
  "tokensIn"      int  NOT NULL DEFAULT 0,
  "tokensOut"     int  NOT NULL DEFAULT 0,
  "costUsd"       numeric(10,4) NOT NULL DEFAULT 0,
  "startedAt"     timestamptz,
  "endedAt"       timestamptz,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE ("projectId", ord)
);

CREATE TABLE "ForgeEvent" (
  "runId"       uuid NOT NULL REFERENCES "ForgeRun"(id) ON DELETE CASCADE,
  seq           bigint NOT NULL,
  "agentId"     uuid REFERENCES "ForgeAgent"(id) ON DELETE CASCADE,
  "taskId"      uuid REFERENCES "ForgeTask"(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind          text NOT NULL CHECK (kind IN (
                  'thought','tool_call','tool_result','token','status','spawn','task_spawn','metric','error','done'
                )),
  payload       jsonb NOT NULL,
  PRIMARY KEY ("runId", seq)
);

CREATE INDEX "ForgeRun_project_idx"     ON "ForgeRun"("projectId", "createdAt" DESC);
CREATE INDEX "ForgeAgent_run_idx"       ON "ForgeAgent"("runId");
CREATE INDEX "ForgeTask_project_idx"    ON "ForgeTask"("projectId", ord);
CREATE INDEX "ForgeTask_story_idx"      ON "ForgeTask"("userStoryId");
CREATE INDEX "ForgeEvent_agent_idx"     ON "ForgeEvent"("agentId", seq);
CREATE INDEX "ForgeEvent_task_idx"      ON "ForgeEvent"("taskId", seq);

-- seq monotônico por run (advisory lock serializa sem trancar a tabela)
CREATE OR REPLACE FUNCTION public.forge_next_seq(p_run uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_run::text));
  SELECT coalesce(max(seq), 0) + 1 INTO s
  FROM "ForgeEvent" WHERE "runId" = p_run;
  RETURN s;
END$$;

-- RLS — view via can_view_project; mutação via can_edit_tasks; is_manager bypass
ALTER TABLE "ForgeRun"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForgeAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForgeTask"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForgeEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeRun_select" ON "ForgeRun"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "ForgeRun_mutate" ON "ForgeRun"
  FOR ALL USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "ForgeTask_select" ON "ForgeTask"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "ForgeTask_mutate" ON "ForgeTask"
  FOR ALL USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "ForgeAgent_select" ON "ForgeAgent"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId" AND public.can_view_project(r."projectId")
    )
  );
CREATE POLICY "ForgeAgent_mutate" ON "ForgeAgent"
  FOR ALL USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId" AND public.can_edit_tasks(r."projectId")
    )
  ) WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId" AND public.can_edit_tasks(r."projectId")
    )
  );

CREATE POLICY "ForgeEvent_select" ON "ForgeEvent"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId" AND public.can_view_project(r."projectId")
    )
  );
CREATE POLICY "ForgeEvent_mutate" ON "ForgeEvent"
  FOR ALL USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId" AND public.can_edit_tasks(r."projectId")
    )
  ) WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId" AND public.can_edit_tasks(r."projectId")
    )
  );

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeEvent";
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeAgent";
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeTask";
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeRun";
```

**Pós-migration:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -f supabase/migrations/<file>.sql
```

Depois: atualizar `src/lib/supabase/database.types.ts`.

---

## 3 · LOOP DE FORJA (a regra acima de todas)

Cada FASE roda este loop. **Não há atalho.**

```
   ┌──────────────────────────────────────────────────┐
   │  1. BUILD     escreva o código mínimo da fase    │
   │  2. SMOKE     npx tsc --noEmit && npx eslint     │
   │  3. DEMO      abra /forge no browser             │
   │  4. CRITIQUE  preencha a seção CRITIQUE da fase  │
   │  5. GATE      bata todos os checks. Falhou? → 1  │
   │  6. COMMIT    ZRD-JM-NN: forge — <fase> — <slug> │
   │  7. PUSH      bash scripts/sync-main.sh -m "..." │
   │  8. LOCK      marque [LOCKED] no header da fase  │
   └──────────────────────────────────────────────────┘
```

**Kill criteria (toda fase):**
- Render > 4ms/frame por 3s seguidos com 1 run mockado e 4 subagents → derruba a fase.
- Memória cresce > 50MB em 60s de execução contínua → vazamento → derruba a fase.
- Type error em build → derruba a fase.
- Visual não passa no game-feel checklist → derruba a fase.

---

## 4 · FASES

> Status legend: `[OPEN]` `[IN PROGRESS]` `[LOCKED]` `[BOSS DOWN]` `[ALWAYS OPEN]`

| # | Tema | Status |
|---|---|---|
| 1 | Fundação HUD (sandbox) | `[LOCKED]` |
| 2 | Store & Contrato | `[LOCKED]` |
| 3 | Mock Source | `[LOCKED]` |
| 4 | Migração de rota `/dev/forge` → `/forge` | `[LOCKED]` |
| 5 | Schema Supabase forge_v1 | `[LOCKED]` |
| 6 | Hub `/forge` (lista de projetos vivos) | `[LOCKED]` |
| 7 | Observatório `/forge/[projectId]` | `[LOCKED]` |
| 8 | TaskSheet (Mind/Tools/Metrics) | `[LOCKED]` |
| 9 | forge_task type=human + filtros | `[OPEN]` |
| 10 | Geração DS → ForgeTask | `[OPEN]` |
| 11 | Realtime source | `[OPEN]` |
| 12 | Polish boss (game feel) | `[OPEN]` |
| 13 | Observabilidade + guard-rails | `[OPEN]` |
| 14 | Pitch | `[OPEN]` |
| ∞ | Loop infinito (ritual semanal) | `[ALWAYS OPEN]` |

---

### FASE 1 — FUNDAÇÃO `[LOCKED]`

Rota viva com HUD vazio, sem dados, no sandbox `/dev/forge`. Layout + readouts + controls. Sem store, sem mock. **Fechada em 2026-05-16** junto com Fases 2 e 3.

---

### FASE 2 — STORE & CONTRATO `[LOCKED]`

Store vanilla TS + reducer puro + interface de source. Buffer de ordering por seq, batch flush via raf (16ms). Hook `useForgeSlice` com `useSyncExternalStore`. **Fechada em 2026-05-16** junto com Fases 1 e 3.

Arquivos: `src/lib/forge/{types,reducer,store,source}.ts`, `src/hooks/use-forge-store.tsx`.

---

### FASE 3 — MOCK SOURCE `[LOCKED]`

`MockForgeSource` com storyline scriptado: ARCHITECT root spawna SCOUT/WRITER/TESTER, 6 forge_tasks, ~45s a 1×. Speed 1×/2×/4×, atalhos space/r/1/2/4. **Fechada em 2026-05-16** junto com Fases 1 e 2.

Arquivos: `src/lib/forge/sources/{mock-script,mock}.ts`.

---

### FASE 4 — MIGRAÇÃO DE ROTA `[LOCKED]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 0.5  ·  THE EXIT FROM SANDBOX    ║
   ║  /dev/forge morre. /forge nasce.       ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: tirar a Forja da sandbox dev-only. Vira rota top-level no sidebar, acessível a todo Builder. Zero alteração de comportamento — só de caminho. Schema, hub e escopo por projeto vêm na Fase 5+.

**Tarefas:**

- [ ] Criar `src/app/(dashboard)/forge/layout.tsx` com `requireMinLevel(BUILDER)`
- [ ] Criar `src/app/(dashboard)/forge/page.tsx` que renderiza o `ForgeShell` atual
- [ ] Manter `src/app/(dashboard)/forge/_components/` com os mesmos arquivos (path-agnostic)
- [ ] Manter `src/lib/forge/*` e `src/hooks/use-forge-store.tsx` (sem mudança)
- [ ] Deletar `src/app/(dashboard)/dev/forge/` inteiro
- [ ] Remover Card "FORGE · Agent Factory" do `/dev/page.tsx`
- [ ] Adicionar entrada no `app-sidebar.tsx`:
  - `{ title: "Forge", href: "/forge", icon: Flame }` no array de top-level
  - Posição: depois de "Projetos" no group principal
- [ ] Atualizar import paths nos componentes (`./_components/...` continua local)

**Acceptance gate:**
- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint 'src/app/(dashboard)/forge' 'src/lib/forge' 'src/hooks/use-forge-store.tsx'` clean
- [ ] `/forge` carrega, mock roda como antes
- [ ] `/dev/forge` retorna 404 (path removido)
- [ ] Sidebar mostra "Forge" entre "Projetos" e o resto, ícone Flame
- [ ] Builder (não-admin) consegue entrar; Guest é barrado pelo gating
- [ ] Mobile 375px: sidebar item visível, rota responsiva

**CRITIQUE:**
- [ ] "A migração é invisível pra quem usava o sandbox?" Sim/Não
- [ ] "O Forge no sidebar parece pertencer ali?" Sim/Não + 1 linha

**Commit:** `ZRD-JM-NN: forge — fase 4 — migra rota dev/forge → /forge`

---

### FASE 5 — SCHEMA forge_v1 `[LOCKED]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 1  ·  THE TABLES                 ║
   ║  Banco existe. RLS por projeto.        ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: criar as 4 tabelas (`ForgeRun`, `ForgeAgent`, `ForgeTask`, `ForgeEvent`) com escopo de projeto, tipo agentic/human, RLS via helpers existentes (`is_manager`, `can_view_project`, `can_edit_tasks`). Sem usar ainda — o mock continua mandando.

**Tarefas:**

- [ ] Migration `supabase/migrations/<date>_forge_v1.sql` com schema da Seção 2
- [ ] Helpers já existem em `20260501_text_to_uuid.sql`: `is_manager()`, `can_view_project(uuid)`, `can_edit_tasks(uuid)` — reusar
- [ ] Rodar migration via `psql "$DIRECT_URL" -f ...`
- [ ] Regenerar `src/lib/supabase/database.types.ts` (`npm run db:types`)
- [ ] Smoke RLS: usuário A não vê run de projeto onde não tem `ProjectAccess`
- [ ] Smoke `forge_next_seq`: 2 chamadas seguidas retornam 1 e 2

**Acceptance gate:**
- [ ] Migration roda sem erro
- [ ] `database.types.ts` reflete schema
- [ ] RLS smoke: 2 usuários, 2 projetos, cross-access bloqueado
- [ ] `tsc --noEmit` clean

**CRITIQUE:**
- [ ] "Algum campo faltou que vou precisar na Fase 7/8?" Lista
- [ ] "RLS está cobrindo o caso de Guest tentar listar tasks?" Sim/Não

**Commit:** `ZRD-JM-NN: forge — fase 5 — schema forge_v1 + RLS`

---

### FASE 6 — HUB `/forge` `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 2  ·  THE LIVING DIRECTORY       ║
   ║  Lista de projetos. Cada um, uma forja.║
   ╚════════════════════════════════════════╝
```

**Objetivo**: trocar a tela `/forge` (que hoje é o ForgeShell do mock) por um **hub** — lista de projetos do Builder, cada um com mini-HUD. Click → `/forge/[projectId]`.

**Idioma visual**: lista (igual `TasksList`, `StoriesList`). Não grid de cards arcade.

**Tarefas:**

- [ ] Criar `src/app/(dashboard)/forge/page.tsx` (server component) — lista projetos do membro atual via DAL
- [ ] Criar `src/app/(dashboard)/forge/_components/forge-hub.tsx` (client) — lista interativa
- [ ] Criar `src/app/(dashboard)/forge/_components/hub-row.tsx`:
  - Nome projeto + chip status
  - Mini-PixelBar 12 cells (progress do run ativo, ou trilho escuro se sem run)
  - Dot tonal do agente raiz (ou cinza)
  - "3 agentes · 12 tasks" mono tabular
  - Click → router push `/forge/${id}`
- [ ] Empty state: "Nenhum projeto disponível"
- [ ] Por enquanto: campos vivos são `null` (sem run real). Estrutura serve.

**Acceptance gate:**
- [ ] `tsc` + lint clean
- [ ] Lista projetos onde Builder tem `ProjectAccess.role >= contributor`
- [ ] Click numa row navega pra `/forge/[id]` (route stub OK)
- [ ] Mobile 375px: linhas legíveis, mini-bar visível

**CRITIQUE:**
- [ ] "Parece da família do `/projects`?" Sim/Não — se Não, **FALHA**
- [ ] "O mini-HUD vivo (mesmo mockado em null) me faz sentir que algo vai acontecer ali?" Sim/Não

**Commit:** `ZRD-JM-NN: forge — fase 6 — hub /forge`

---

### FASE 7 — OBSERVATÓRIO `/forge/[projectId]` `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 3  ·  ZOOM IN                    ║
   ║  Você entra. A forja é dele.           ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: pegar o ForgeShell atual (HUD + Controls + FactoryLineList) e escopar a **um projeto**. Header novo: nome do projeto, breadcrumb pra Hub, mesmo idioma do `/projects/[id]` hero. Continua mockado.

**Tarefas:**

- [ ] Criar `src/app/(dashboard)/forge/[projectId]/page.tsx` (server) — busca projeto, valida acesso, passa pra shell
- [ ] Criar `src/app/(dashboard)/forge/[projectId]/_components/project-forge-shell.tsx` (client)
- [ ] Header: back arrow → `/forge`, nome projeto, status chip, breadcrumb
- [ ] Reusa `ForgeHud`, `ForgeControls`, `FactoryLineList` (já existentes)
- [ ] Store/source: ainda mock por enquanto, mas armazenado no provider escopado por `projectId` (cada projeto tem sua store independente)
- [ ] Atualizar `useForgeStore` hook pra aceitar opção de escopo

**Acceptance gate:**
- [ ] `tsc` + lint clean
- [ ] Click no hub leva ao observatório certo
- [ ] Back arrow volta pra hub
- [ ] Start/Pause/Reset funcionam (mock)
- [ ] Render budget ≤ 4ms mantido
- [ ] Mobile responsivo

**CRITIQUE:**
- [ ] "Sinto que entrei no projeto, não numa Forja genérica?" Sim/Não
- [ ] "O header está abafando o HUD?" Sim/Não

**Commit:** `ZRD-JM-NN: forge — fase 7 — observatório /forge/[projectId]`

---

### FASE 8 — TASK SHEET `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 4  ·  INSIDE THE WORK            ║
   ║  Você vê a task acontecendo.           ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: click numa row da FactoryLineList → abre `ResponsiveSheet size="lg"` com 3 abas: Mind, Tools, Metrics. Continua viva (não pausa store). Trocar de task sem fechar repopula in-place.

**Tarefas:**

- [ ] `src/app/(dashboard)/forge/_components/task-sheet.tsx` (client)
- [ ] Estado `[selectedTaskId, setSelectedTaskId]` no shell
- [ ] Header: `#001` ord, title, agent dono, status chip, subhead tokens/cost/elapsed
- [ ] **Mind**: stream de `thought` + `token` filtrado por task_id, mono terminal, cursor `█` no último parágrafo se status ∈ {thinking, streaming}, pin-to-bottom
- [ ] **Tools**: timeline `tool_call`/`tool_result` pareados, ícone por tool, latência, expand pra JSON
- [ ] **Metrics**: 4 PixelBars (tokens in/out, cost relativo, progress) + sparkline canvas 1Hz
- [ ] Atalhos: `esc` fecha, `j/k` navega na lista visível
- [ ] Mobile: bottom-sheet 90dvh com abas sticky

**Acceptance gate:**
- [ ] Abrir/fechar/trocar 20× em 10s sem leak
- [ ] Mock em 4×, sheet aberto: ≤ 4ms/frame
- [ ] Auto-scroll respeita scroll do usuário
- [ ] Trocar task preserva scroll/aba de cada task em sessão

**CRITIQUE:**
- [ ] "Sinto que estou vendo a task acontecer?" Sim/Não + 1 linha
- [ ] "Algum tab parece desnecessário?" Lista

**Commit:** `ZRD-JM-NN: forge — fase 8 — task sheet mind/tools/metrics`

---

### FASE 9 — FORGE_TASK type=human + FILTROS `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 5  ·  HUMAN IN THE LINE          ║
   ║  Mesma linha. Outro modo.              ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: forge_task com `type=human` convive na mesma lista. Diferencia visual sutil. Filtro segmented no topo: `Todas · Agentic · Human · Done`.

**Diferenças visuais quando `type=human`:**
- Dot: cinza neutro (não tonal de execução)
- Coluna "Tool" → mostra assignee (avatar/iniciais)
- Coluna "Progress" → status humano: `todo / doing / done / blocked`
- Tokens/Cost: `—`
- Click na row abre sheet com 1 aba só: "Briefing" (descrição + assignee + due_date), sem Mind/Tools/Metrics

**Tarefas:**

- [ ] Atualizar `factory-line-list.tsx` pra renderizar duas variantes de row (`agentic` vs `human`)
- [ ] Filtro segmented (`<ToggleGroup>`-like): Todas / Agentic / Human / Done
- [ ] Contador "12 de 24 tasks" sensível ao filtro
- [ ] TaskSheet: condicional — se `type=human`, mostra aba única `Briefing`
- [ ] Mock-script estende: incluir 2 forge_tasks `type=human` (ex.: "Deploy em staging", "Validar UX com 3 usuários")

**Acceptance gate:**
- [ ] Filtros funcionam, contador bate
- [ ] Row human é instantaneamente distinguível de row agentic
- [ ] TaskSheet abre o modo certo conforme type
- [ ] Mock storyline mostra os dois tipos lado a lado

**CRITIQUE:**
- [ ] "Bate o olho, distingue agentic de human em < 1s?" Sim/Não
- [ ] "Forçar 'agente trabalhando' aqui parece artificial?" — se Sim, repensar mock

**Commit:** `ZRD-JM-NN: forge — fase 9 — forge_task human + filtros`

---

### FASE 10 — GERAÇÃO DS → FORGE_TASK `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 6  ·  THE PIPELINE CLOSES        ║
   ║  DS aprovada → tasks aparecem.         ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: fechar o pipeline canônico. Quando uma DesignSession transiciona pra `completed`, gera `forge_task` pra cada `UserStory` aprovada do projeto, `type=agentic` default. Builder pode editar antes de disparar run.

**Tarefas:**

- [ ] DAL: `generateForgeTasksFromSession(sessionId)` — cria N forge_tasks com `project_id`, `user_story_id`, `title` da story, `type='agentic'`, `status='queued'`, `ord` incremental
- [ ] Trigger Postgres ou server action no `/complete` da DS
- [ ] UI no observatório: banner "Geradas 8 forge_tasks dessa DS · [Revisar]" linkando pro filtro `Queued`
- [ ] Edit inline (`ResponsiveDialog`): mudar `type`, atribuir `assignee_id` (se human), editar título
- [ ] Botão "Disparar run" no header do observatório — agrupa tasks queued numa run nova

**Acceptance gate:**
- [ ] DS de teste com 3 stories aprovadas → ao completar, 3 forge_tasks aparecem no observatório
- [ ] Edit inline persiste (optimistic + reconcile)
- [ ] "Disparar run" associa tasks ao novo run e muda status pra `idle`
- [ ] Reabrir DS (reopen cascade) → o que faz com tasks queued? **Decidir explicitamente** (manter / arquivar / deletar)

**CRITIQUE:**
- [ ] "O Builder entende o que veio da DS vs o que adicionou manual?" Sim/Não
- [ ] "Reopen da DS quebra alguma expectativa?" Lista

**Commit:** `ZRD-JM-NN: forge — fase 10 — geração DS → forge_task`

---

### FASE 11 — REALTIME SOURCE `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  TIER 7  ·  THE REAL FORGE             ║
   ║  Mock cai. Dados vivem no Supabase.    ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: implementar `RealtimeForgeSource` que assina `forge_event` por `run_id`. Toggle no provider: `useForgeSource('mock'|'realtime')`.

**Tarefas:**

- [ ] `src/lib/forge/sources/realtime.ts` — Supabase channel sub em `forge_event` filter `run_id=eq.{runId}`
- [ ] Backfill inicial: `select * from forge_event where run_id=? order by seq` antes de live
- [ ] Reconcile gap entre backfill e live (ignora seq < lastSeq)
- [ ] Reconnect: refaz backfill desde último seq visto
- [ ] API route `POST /api/forge/runs` — cria run + agents + tasks via RPC seedada
- [ ] Toggle em dev (`?source=realtime`) — em prod default realtime

**Acceptance gate:**
- [ ] Run criado via API aparece no observatório em < 500ms
- [ ] Wifi off 5s → reconecta, não duplica seq
- [ ] 2 abas no mesmo run: estado idêntico
- [ ] 50 eventos/s sustentados sem perda

**CRITIQUE:**
- [ ] "Mock e realtime são indistinguíveis na UI?" Sim
- [ ] "Edge case de reconnect testado?" Lista

**Commit:** `ZRD-JM-NN: forge — fase 11 — realtime source + reconcile`

---

### FASE 12 — POLISH BOSS `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  BOSS 1  ·  THE FEEL                   ║
   ║  Microinteração carrega peso.          ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: o frame da Steam. Easing, sons opcionais, boot/end sequences, error boss state. **Sem exagero** — sobriedade é regra.

**Tarefas:**

- [ ] Boot sequence (clicar START): typewriter `RUN ——` → `RUN 042`, 600ms total
- [ ] End sequence: sweep verde na barra global, stamp "FORGED" 800ms
- [ ] Error boss state: acento magenta no header global até reset
- [ ] Sons opcionais (toggle, default OFF, localStorage): spawn/done/error/boss, Web Audio API
- [ ] Easing audit: toda transição < 80ms ou > 400ms → bug
- [ ] `prefers-reduced-motion`: respeitar
- [ ] Dev overlay `~`: fps / render ms / events/s / buffer size

**Acceptance gate:**
- [ ] Vídeo 30s do run completo → "isso é produto" Sim
- [ ] Mobile CPU 4× slowdown: ainda fluido
- [ ] Lighthouse acessibilidade ≥ 95

**CRITIQUE:**
- [ ] "Eu pagaria pra usar?" Sim/Não + 1 linha
- [ ] "Falta algo pra virar lenda?" Lista — se ≠ vazia, **gate não fecha**

**Commit:** `ZRD-JM-NN: forge — fase 12 — polish boss + game feel`

---

### FASE 13 — OBSERVABILIDADE + GUARD-RAILS `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  BOSS 2  ·  THE SILENT KILLER          ║
   ║  Coisa que parece ok mas mata em prod. ║
   ╚════════════════════════════════════════╝
```

**Objetivo**: tudo que evita "funciona na minha máquina".

**Tarefas:**

- [ ] Métricas client em `ForgeStore`: `events_received_total`, `events_dropped_total`, `buffer_max`, `render_ms_p95`, `reconnects_total` — expostas em `window.__forgeMetrics`
- [ ] Painel `/forge/_debug` (admin only): live counters, stress "Inject 1000 eventos/1s", resilience "Drop next 10 eventos"
- [ ] RPC server-side valida `seq = max+1` (ou rejeita)
- [ ] Feature flag `NEXT_PUBLIC_FORGE_ENABLED` — off esconde rota + sidebar
- [ ] `docs/forge-postmortem-template.md`

**Acceptance gate:**
- [ ] Stress 1000/1s → store sustenta, drop=0
- [ ] Drop 10 → buffer recupera, run íntegro
- [ ] Flag OFF → rota 404, sidebar oculta

**CRITIQUE:**
- [ ] "Se quebrar em demo, sei o que olhar primeiro?" Sim/Não

**Commit:** `ZRD-JM-NN: forge — fase 13 — observabilidade + guard-rails`

---

### FASE 14 — PITCH `[OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  FINAL BOSS  ·  THE PITCH              ║
   ║  Você abre, o CEO assiste, ele sorri.  ║
   ╚════════════════════════════════════════╝
```

**Tarefas:**

- [ ] `docs/forge-demo-script.md` — 6 beats de 15s
- [ ] URL curta de demo com run pré-seedado
- [ ] Screenshot heroico `public/forge-hero.png` (1600×900)
- [ ] PR description usa o ASCII do topo

**Acceptance gate:**
- [ ] 3 demos seguidas sem nada quebrar
- [ ] Pessoa que nunca viu pergunta "como vocês fizeram isso" em ≤ 30s

**CRITIQUE FINAL:**
- [ ] "Isso é o killer feature?" Sim/Não — se Não, abre Fase ∞

**Commit:** `ZRD-JM-NN: forge — fase 14 — pitch ready`

---

### FASE ∞ — LOOP INFINITO `[ALWAYS OPEN]`

```
   ╔════════════════════════════════════════╗
   ║  POST-GAME  ·  NEW GAME +              ║
   ║  Toda semana, uma volta na forja.      ║
   ╚════════════════════════════════════════╝
```

**Ritual semanal (60min):** re-play → re-bench → re-spawn (1 microfeature) → re-lock.

**Backlog:**

- [ ] Replay scrubber: timeline horizontal, arrasta pra rebobinar
- [ ] Multi-run no mesmo projeto: histórico no observatório
- [ ] Custo cumulativo do dia no header
- [ ] Heatmap de agents que mais erram
- [ ] Export de run como `.forge.json`
- [ ] Compartilhar run via URL pública (RLS tokenizado)
- [ ] Audit dashboard: histórico com filtros
- [ ] Branching agents: sub-subagent (testar árvore N>2)
- [ ] Wallpaper mode: `/forge?wallpaper=1` esconde controles

**Quando parar:** nunca.

---

## 5 · APÊNDICE A — CONVENÇÕES DE CÓDIGO LOCAIS

- **Pasta raiz**: `src/app/(dashboard)/forge/` (não mais `dev/forge`).
- **Reuso obrigatório**: `PixelBar`, `PixelDot`, `PixelHud`, `ResponsiveSheet`, `Card`, `Button`.
- **Hooks**: `src/hooks/use-forge-*.tsx`.
- **Lib**: `src/lib/forge/`.
- **Migrations**: `supabase/migrations/<date>_forge_*.sql` via `psql "$DIRECT_URL" -f`.
- **Smoke**: `npx tsc --noEmit && npx eslint <path>` (não existe `npm run typecheck`).

## 6 · APÊNDICE B — RISCOS REAIS

| # | Risco | Probabilidade | Impacto | Fase que endereça |
|---|---|---|---|---|
| R1 | Render thrash com muitos agents | Alta | Alta | 2, 7 (raf nas barras) |
| R2 | Eventos out-of-order | Alta | Alta | 2 (buffer + seq) |
| R3 | Reconnect duplica eventos | Média | Alta | 11 (backfill + lastSeq) |
| R4 | Mobile derruba fps | Média | Alta | 7, 12 |
| R5 | Demo trava no momento errado | Baixa | Catastrófico | 13, 14 |
| R6 | RLS bloqueia legitimamente | Baixa | Médio | 5 (smoke RLS) |
| R7 | seq monotônico sob concorrência | Média | Alta | 5 (`forge_next_seq` FOR UPDATE) |
| R8 | DS → ForgeTask gera lixo | Média | Médio | 10 (revisão antes de disparar run) |
| R9 | Confusão forge_task vs Task humana legada | Alta | Médio | 0 (vocabulário separado), 9 (filtros) |

## 7 · APÊNDICE C — KILL SWITCH

```bash
# 1. desativa rota + sidebar
echo 'NEXT_PUBLIC_FORGE_ENABLED=false' >> .env
# 2. reverte último commit forge
git revert <sha>
# 3. push
bash scripts/sync-main.sh -m "ZRD-JM-NN: forge — kill switch"
```

Schema (improvável, é sandbox):
```bash
psql "$DIRECT_URL" -c "drop table if exists forge_event, forge_agent, forge_task, forge_run cascade;"
```

---

```
   ╔════════════════════════════════════════════╗
   ║  END OF RUNBOOK · THE LOOP NEVER CLOSES.   ║
   ║  Volte ao topo. A FORGE espera.            ║
   ╚════════════════════════════════════════════╝
```
