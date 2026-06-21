# PM Review como app única (cronograma navegável) — runbook

> **Status:** Rev. 4 — pós-crítica adversarial (premissas verificadas no código). 2026-06-20. Nada implementado ainda.
> **Decisões fechadas com o João:** régua = **grade de semanas ancorada nos sprints** (construída do zero — ver §4 D1) · nó = semana (1 snapshot por PM Review) · **toda review é editável (published NÃO congela pro humano — comportamento atual); sem modo read-only** · autoria back-dated agora, fidelidade "aproximada" + **disclosure honesto** no report (point-in-time depois) · zero schema novo · órfãs navegáveis · archived fora da timeline.
> **Mudança vs Rev. 3 (o que a crítica derrubou):** "published congela" era **regressão** (hoje é editável de propósito) → removido. "back-dated não toca o agente" só vale na fidelidade aproximada → escolhida, com disclosure. "reuso de `weeks[]`/`CronogramaBlock`" era otimista → grade construída do zero, com teste de regressão no Planning. Detalhes em §12.
> **Mockup fiel (atual × proposta):** artifact `pm-review-app` (Ao vivo · Histórico · mapeamento).
> **Companheiro:** [planning-versioned-living-runbook.md](planning-versioned-living-runbook.md) — o template que estamos espelhando.

---

## §1 — A dor

Hoje o PM Review é uma **coleção de páginas soltas**:

- Cada review vive em `/pm-reviews/[id]`, alcançada por uma lista (Rituais app). Não há régua, não há navegação entre semanas.
- A "memória viva da operação" — a sequência de riscos, decisões e milestones semana após semana — **é invisível na superfície**. Existe no banco (`PMReview` por `referenceWeek`), mas o usuário nunca vê a linha do tempo.
- O Planning acabou de ganhar exatamente isso (cronograma + canvas histórico navegável, ZRD-JM-176). O PM Review ficou para trás: dois rituais da Vitoria, duas UXs diferentes — viola a parity de agente ([[feedback_agent_ui_parity]]).

**O que queremos:** uma app única por projeto, abre na semana corrente, com a régua de sprint no topo e navegação por semana. **Toda review é editável** quando aberta (published não congela — comportamento atual), e dá pra autorar reviews retrospectivas de semanas passadas. Os logs viram a memória viva.

---

## §2 — Por que PM Review é encaixe MAIS LIMPO que Planning (e onde NÃO é)

O Planning precisou inventar `PlanningEvent` + `PlanningEventSprint` + `PlanningEventTask` porque o substrato dele é o **board** (estado mutável e compartilhado). Cada "apply" tinha que virar um snapshot congelado, senão a navegação histórica mostraria o board de hoje.

**No PM Review esse problema não existe:**

| Eixo | Planning | PM Review |
|---|---|---|
| Substrato | board mutável compartilhado | narrativa semanal discreta |
| Nó da timeline | `PlanningEvent` (criado a cada apply) | **a própria `PMReview`** (1 por `referenceWeek`) — **já existe** |
| Snapshot congelado | precisa copiar (board vaza) | report+notes da semana **são** a fonte da verdade — não vazam |
| Thread de chat | regenera por versão (`startNewReleasePlanningThread`, [context.ts:294](../../src/lib/agent/context.ts#L294)) | **já é 1 thread por semana** (`ensurePMReviewThread`, agentName=pmReviewId, [context.ts:228](../../src/lib/agent/context.ts#L228)) |
| Binning por semana | construído do zero no page.tsx | **construído do zero também** — o `weeks[]` de [project-overview.ts:153](../../src/lib/dal/project-overview.ts#L153) é janela fixa de 4, só published, sem âncora de sprint (só referência de mapeamento) |

**Conclusão:** o trabalho é quase todo **frontend + reuso de chassi**. Zero migração de schema, e a **Fase 1 não toca o agente** (a fidelidade aproximada da D14). O backend muda **pouco**: param de `referenceWeek` + filtro `capturedAt` no `refresh` (D14) e 2 guards de API (D3 imutável, D13 futuro). A Rev. 3 dizia "1 param só" — era otimista (crítica). A thread por-semana e o get-or-create da semana corrente já estão prontos.

**Onde NÃO é mais limpo (o que exige cuidado):** o PM Review tem **mais conexões downstream** que o Planning (Wiki, overview executivo, cron, playbook, daemon, feeds Granola/Drive). É aí que mora o risco — não na feature em si, mas em **não atropelar quem lê PMReview**. Ver §5.

---

## §3 — Modelo mental

```
                 GRADE SEMANAL ancorada na régua de sprint
  ┌────┬────┬────┬────┬────┬──────┬────┬────┐
  │ w1 │ w2 │ w3 │ w4 │ w5 │ [w6] │ w7 │ w8 │   ← cada célula = 1 semana (= sprint, onde existe)
  └────┴────┴────┴────┴────┴──────┴────┴────┘
   pub  pub  ∅    pub  rasc CORRENTE  ·    ·
        └──── todas EDITÁVEIS quando abertas ───┘   └─ futuro (inerte) ─┘
   ∅ = semana sem review (clica → "Fazer PM Review")   · = futuro, sem autoria

  Nó = a PMReview daquela semana. Memória viva = ler a cadeia de nós.
```

- **Toda review é editável quando aberta — NÃO há modo read-only.** PM Review é **retrospectivo** — revisar o passado *é* o trabalho (≠ Planning). E published, no código atual, **continua editável de propósito** ("marcador de disponível pra consulta, não fechado"). Então não há binário live/histórico nem read-only por data/status: abriu a célula, edita (chat da Vitoria disponível). O único "freeze" é o **cron não sobrescrever** uma review published (já existe).
- **O cronograma é a espinha** (sem toggle live/histórico). Cada célula = uma semana com estado-rótulo: rascunho · publicada · vazia · futura. "Semana atual" = botão de pular-pra-hoje.
- **Autoria back-dated**: célula vazia ≤ hoje → "Fazer PM Review desta semana" cria rascunho daquele `referenceWeek`. A síntese usa os **insumos daquela semana**, mas o contexto de projeto (sprint/tasks) é o de hoje → o report **declara essa limitação** de forma minimalista e honesta (D14/D15). Células futuras são inertes.
- **Régua** = grade de semanas ancorada nos sprints (1:1 com `referenceWeek`, já que sprint = seg→dom, [[project_sprint_week_model]]). **Construída do zero** — o `weeks[]` do overview e o `CronogramaBlock` do Planning não servem direto (§4 D1, §7).
- **Memória viva da operação** = a leitura cross-semana (tendência de risco, decisões acumuladas, milestones) — **não** um estado acumulado como o board do Planning.

Invariante central: **toda review é editável; a navegação é por célula de semana; a grade-semanal ancorada em sprint alinha os dois rituais; review retroativa declara sua limitação de contexto.**

---

## §4 — Decisões fixadas (Dn)

| Dn | Decisão | Por quê |
|----|---------|---------|
| **D1** | Régua = **grade de semanas ancorada na grade de sprint** (não blocos de sprint puros), **construída do zero**. Cada review = 1 célula de semana; semana com sprint é rotulada pelo sprint, semana sem sprint pela data. | Sprint = semana (1:1), a grade sobrepõe a de sprints onde existem → alinhamento com o Planning (Fase 3), mas preserva navegação 1:1 das órfãs (§5.6). **Crítica corrigiu:** o `CronogramaBlock` do Planning é keyed por `sprintId` e colapsa órfãs num bucket único; o `weeks[]` do overview é janela fixa de 4, só published. Nenhum serve direto — a grade é nova (e regeneralizar o `CronogramaBlock` mexe no Planning em prod → teste de regressão, §7). |
| **D2** | Nó da timeline = a própria `PMReview` (1 por `referenceWeek`). **Zero tabela nova.** | O artefato semanal já é discreto e congelável. Não há substrato mutável que vaze — não precisa snapshot copiado tipo `PlanningEventTask`. |
| **D3** | `referenceWeek` é **imutável depois de criada**. | É a chave do nó. Hoje o PATCH permite trocar ([pm-review/[id]/route.ts](../../src/app/api/pm-review/[id]/route.ts)) — adicionar guard. Trocar a semana = outro nó, não editar o mesmo. |
| **D4** | Review published **NÃO congela pro humano** — segue editável (comportamento atual). O único freeze é o **cron não sobrescrever** published ([refresh.ts:127](../../src/lib/pm-review/refresh.ts#L127) → `frozen`). Sem guard de status nas rotas. | **Crítica corrigiu Rev. 3:** o código deixa published editável de propósito (comentário em `publish/route.ts`: "disponível pra consulta, não fechado"). Congelar seria **regressão** + guards de backend. Decidido manter editável. `status='archived'` continua fora da timeline (D11), aí sim é "aposentada". |
| **D5** | **Não há modo read-only** (nem por data, nem por status). Toda review é editável quando aberta; o chat da Vitoria fica disponível em qualquer semana. | Decorre da D4. Simplifica: sem `composerSubmitDisabled`, sem canvas read-only, sem live↔histórico. A célula só carrega um **rótulo** de status (rascunho/publicada). A thread já existe por review ([context.ts:228](../../src/lib/agent/context.ts#L228)). |
| **D6** | Chassi (cronograma, history-sheet) vira **compartilhado por prop** entre os 2 rituais — mas com **teste de regressão no Planning** (está em prod). | Parity de agente ([[feedback_agent_ui_parity]]). **Crítica avisou:** o `CronogramaBlock` é keyed por `sprintId` e deriva `kind` de hoje-vs-janela-de-sprint; regeneralizar pra `weekStart` + N células órfãs **toca o Planning**. Sem o toggle live/histórico (D5 o tornou desnecessário). |
| **D7** | Digest executivo (`audience='executive'`) e notes de detalhe (`audience='detail'`) **continuam separados**. | Consumido separadamente pelo overview ([project-overview.ts:798](../../src/lib/dal/project-overview.ts#L798)) e Wiki. Não fundir. |
| **D8** | Playbook, cron, owner-resolution e feeds permanecem **por projeto** (não por semana/review). | A automação semanal é batched por projeto no cron. Mover pra nível de review/semana quebra o batching. |
| **D9** | Rota canônica vira `/projects/[id]/pm-review` (espelha `/projects/[id]/planning`). Antiga `/pm-reviews/[id]` → redirect. | Single-app por projeto; back-href já aponta pro mesmo lugar (`?tab=apps&app=ceremonies`). |
| **D10** | Review em **semana sem sprint** (órfã) = célula de semana navegável, tom "fora de sprint" (não colapsa em bucket). | Padrão estrutural (projeto sem sprints, gap entre contratos, semana pré-kickoff). Hoje 4/13 (§5.6). |
| **D11** | Reviews `status='archived'` ficam **fora da timeline**. | Archived = aposentada; não polui a régua. Hoje 2/13 (Validação 25/05, Volundly 25/05). |
| **D12** | Drafts passados com `reportMarkdown` vazio = célula **esmaecida** "rascunho sem síntese"; **sem backfill**. Sem digest executivo → fallback nas notes de detalhe. | Zero schema; renderiza o que existe. Fallback já é o comportamento do overview ([project-overview.ts:175](../../src/lib/dal/project-overview.ts#L175)). Hoje 2 reports vazios (Zordon, Vivix). |
| **D13** | Célula **vazia ≤ hoje** → "Fazer PM Review desta semana" cria `draft` daquele `referenceWeek`. Células **futuras** são inertes, **e o backend rejeita `referenceWeek > brtMonday(now)`**. | PM Review é retrospectivo: autorar ≤ hoje é legítimo (catch-up); futuro não faz sentido. O `createPMReview` já aceita `referenceWeek` arbitrário (e normaliza p/ segunda); **crítica achou que o POST aceita futuro** → adicionar guard de servidor, não só esconder na UI. |
| **D14** | Back-dated usa fidelidade **"aproximada"**: contexto de projeto (sprint/tasks) = hoje; a limitação é **declarada** no report (D15). | **DEFERIDO p/ Fase 2 na implementação:** o fluxo de Fase 1 cria draft + síntese **manual** via chat (não passa pela janela do `refresh`), e o cron só faz a semana corrente — então **não há caller** que auto-sintetize uma semana passada. Param de `referenceWeek` + filtro `capturedAt` no `refresh` seriam código morto agora; entram quando existir um gatilho "auto-sintetizar semana X". (Threadar `referenceWeek` no context loader da Vitoria = 2 repos, também Fase 2.) |
| **D15** | Review back-dated **declara sua limitação** no report, de forma minimalista e honesta (ex: nota/seletor "review retroativa — contexto de projeto é o atual, não o da semana de referência; insumos são da semana correta"). | Princípio anti-alucinação ([[feedback_grounded_no_hallucination]]): separar fato (insumos da semana) de limitação (contexto = hoje). Torna a fidelidade aproximada (D14) **honesta e já entregável**, sem esperar o point-in-time. |
| **D16** | A âncora de semana da grade é **`brtMonday`** (a mesma do cron/refresh), não `mondayOf` (UTC) nem `startOfWeek` (TZ do server). | **Crítica achou 3 funções divergentes** de "segunda da semana" no código (`refresh.ts:62`, `pm-review.ts:157`, `project-overview.ts:189`). A régua TEM que casar com o cron que cria as reviews, senão a célula da semana corrente desalinha em borda de domingo→segunda BRT. |
| **D18** | PM Review aparece nos **Rituais como UMA linha contínua "PM Review do Projeto"** (espelha "Planning do Projeto"), estilo `ativo · atualizado <data>` — **não** uma linha por semana. As semanas (inclusive antigas) viram **navegação na régua dentro da app**, não itens soltos. Archived fora (D11). | Confirmado com João (screenshot do Planning). Fecha a visão "app única": a lista é o ritual contínuo; o tempo se navega por dentro. Implementado em `rituals/route.ts` (1 item, `lastActivityAt`) + `rituais-file-view` (render contínuo). `featured` era código morto (sem consumidor) → mantido inerte. |
| **D17** | **Uma review por semana, atualizada in-place; o STATUS é a versão de registro.** Sem empilhamento (`UNIQUE(projectId, referenceWeek)`) e sem histórico intra-semana — re-síntese **sobrescreve** o `reportMarkdown`. O que overview/Wiki consomem é a **published** da semana; draft = WIP, invisível pros consumidores. | Confirmado com João. Overview já encoda isso: lê só published e **exclui draft de propósito** ([project-overview.ts:688](../../src/lib/dal/project-overview.ts#L688) + comentário 685-687) pra um rascunho da semana corrente não encobrir a última publicada. **Implicação na UI:** a célula mostra draft↔published como **estado semântico** (não enfeite); abrir a semana corrente pode mostrar um rascunho ainda não oficial (correto); **publicar = promover à versão da semana**. Histórico intra-semana só com Opção B (tabela de evento) — descartada. |

---

## §5 — Raio de explosão: as conexões que podem quebrar

**Esta é a seção que o João pediu.** Agrupado por superfície. Legenda de risco: 🔴 alto (toca → quebra prod) · 🟡 médio (precisa atualizar junto) · 🟢 baixo (no raio, mas seguro se não mexer).

### 5.1 — Frontend & navegação (🟡 — atualizar junto, senão 404)

| Conexão | Arquivo:linha | Quebra se |
|---|---|---|
| Redirect pós-create | [rituais-file-view.tsx:221](../../src/components/apps/rituais-file-view.tsx#L221) `router.push(/pm-reviews/${created.id})` | rota muda e este não aponta pra nova → cria review e cai em 404 |
| Link "Abrir →" no widget de projetos | [projetos-board.tsx:1409](../../src/components/overview/projetos-board.tsx#L1409) `href={/pm-reviews/${...}}` | idem 404 |
| href na API de Rituais | [rituals/route.ts:167](../../src/app/api/projects/[id]/rituals/route.ts#L167) `href: /pm-reviews/${r.id}` | a lista de Rituais e o `onOpen` ([rituais-file-view.tsx:310](../../src/components/apps/rituais-file-view.tsx#L310)) leem daqui → corrigir aqui cobre os dois (a create-push :221 é fix separado) |
| Rota antiga | `src/app/(dashboard)/pm-reviews/[id]/page.tsx` | deletar sem redirect → links externos/bookmarks 404. **Manter como redirect.** |
| Importadores de `components/pm-review/*` | só a página + `rituais-file-view` (usa `PMReviewSheet`) | baixo — componentes migram junto |

**Mitigação:** os 3 hrefs viram `/projects/${projectId}/pm-review`; a rota antiga vira um redirect server-side. Back-href já está correto.

### 5.2 — Leitores downstream de PMReview (🟢 — no raio, mas seguros)

Estes leem PMReview **por query, não por URL** — então a mudança de rota/shell **não os afeta**. Só quebram se mexermos em schema/dados (não vamos). Listados pra *verificar* que continuam intactos:

| Consumidor | Arquivo:linha | Lê | Cuidado |
|---|---|---|---|
| Wiki composer | [wiki/composer.ts:91](../../src/lib/wiki/composer.ts#L91) | top-2 published `reportMarkdown` | não mover `reportMarkdown` pra notes |
| Overview executivo | [project-overview.ts:682](../../src/lib/dal/project-overview.ts#L682), [:778-798](../../src/lib/dal/project-overview.ts#L778) | `weeks[]`, notes split por `audience`, health por `stance` de risco | manter split detail/executive (D7) |
| API Rituais (union) | [rituals/route.ts](../../src/app/api/projects/[id]/rituals/route.ts) | `listPMReviewsForProject` shape | manter `PMReviewSummary` (linkedCount, noteCountByKind) |

### 5.3 — Agente Vitoria & daemon (🟡 — regra das 2 cópias se tocar tools)

| Conexão | Arquivo:linha | Quebra se |
|---|---|---|
| Surface dispatch | [vitoria/index.ts:40-54](../../src/lib/agent/agents/vitoria/index.ts#L40) (context), :217-224 (prompt), :227-260 (tools) | string `"pm_review"` muda, ou `params.pmReviewId` some |
| prepare-turn resolve | [prepare-turn/route.ts:175-200](../../src/app/api/agents/[slug]/prepare-turn/route.ts#L175) | `thread.channel`/`thread.agentName` mudam de semântica |
| Thread por semana | [context.ts:228](../../src/lib/agent/context.ts#L228) `ensurePMReviewThread` | **NÃO precisa mexer** — já é 1 thread por PMReview = 1 por semana. (O agente sugeriu chavear por `(pmReviewId, week)`; **descartado** — pmReviewId já é a semana.) |
| Tools mirror 2 repos | monorepo [tools-registry.ts:320](../../src/lib/agent/tools-registry.ts#L320) + `zordon-daemon/src/lib/agent/tools-registry.ts` | adicionar/renomear tool num repo só → daemon anuncia schema stale ([[project_daemon_tool_advertisement]]). **Fase 1 não toca tools** → risco zero nesta fase. |

**Mitigação:** Fase 1 é puramente UI/rota. Não muda surface, não muda tool, não muda thread. Daemon e prepare-turn ficam intactos.

### 5.4 — Cron, playbook & feeds (🔴 — não tocar; só conhecer)

| Conexão | Arquivo:linha | Quebra se |
|---|---|---|
| pg_cron | [20260617c_pm_review_refresh_cron.sql](../../supabase/migrations/20260617c_pm_review_refresh_cron.sql) `0 11 * * 1-5` → `kick_pm_review_refresh()` | schedule/jobname mudam; secrets `pm_review_refresh_url`/`_auth_token` não seedados |
| Endpoint cron | [api/cron/pm-review-refresh/route.ts](../../src/app/api/cron/pm-review-refresh/route.ts) | env `PM_REVIEW_REFRESH_AUTH_TOKEN` muda/some (gate ainda pendente no Cloud Run, [[project_ritual_playbook]]) |
| Get-or-create da semana | [refresh.ts:62](../../src/lib/pm-review/refresh.ts#L62) `brtMonday`, [:119-146](../../src/lib/pm-review/refresh.ts#L119) | âncora de semana BRT muda → janela desalinha; **o binning novo do cronograma TEM que usar o mesmo `brtMonday`/`referenceWeek`** |
| Playbook | [20260617d_ritual_playbook.sql](../../supabase/migrations/20260617d_ritual_playbook.sql), [ritual-playbook.ts](../../src/lib/dal/ritual-playbook.ts) `getEffectivePlaybook`/`derivePromptParams` | binding é por `(projectId, ritualType)` — mover pra review/semana quebra o batch do cron (D8) |
| Owner resolution | `resolvePMReviewOwner` (refresh) → primeiro `ProjectGranolaFolder.memberId` | mover owner pra por-semana quebra o daemon turn |

**Mitigação:** a app **só consome** o que o cron/refresh já produz. O único acoplamento novo é: o binning do cronograma precisa usar **a mesma definição de semana** (`brtMonday` / `referenceWeek` na régua de sprint). Não reimplementar a aritmética de semana — importar/reusar.

### 5.5 — Schema & RLS (🟢 — intacto)

`UNIQUE(projectId, referenceWeek)` + CHECK `referenceWeek` = segunda ([20260529d_pm_review.sql](../../supabase/migrations/20260529d_pm_review.sql)) são **load-bearing e permanecem**. RLS encadeia por `PMReview.projectId` (select via `can_view_project`, edit via `can_create_pm_review`). EntityLink XOR (meeting|contextSource|...) permanece. **Nada de DDL muda aqui.** Duas validações de **API** (não schema) entram: guard D3 (`referenceWeek` imutável pós-create) e guard D13 (rejeitar `referenceWeek` futuro). A corrida no `UNIQUE` em autoria back-dated já é tratada (refresh é conflict-safe, [refresh.ts:144-161](../../src/lib/pm-review/refresh.ts#L144)).

### 5.6 — Reviews legadas: casam bem na UX nova? (dados reais 2026-06-20)

Snapshot do banco: **13 reviews, 10 projetos, 4 semanas (25/05→15/06)** — cadência semanal ainda imatura (1–2 reviews/projeto). Quando há sprint cobrindo a semana, o alinhamento é **exato** (`sprint.startDate` segunda = `referenceWeek` segunda). **9/13 casam 1:1.**

**As 4 órfãs (semana sem sprint) — padrão estrutural, não exceção:**

| Review | Modo de falha | Tratamento |
|---|---|---|
| ALESP 08/06 (draft) | projeto com **0 sprints** | célula de semana avulsa, navegável (D10) |
| Vivix 08/06 (draft, vazio) | **antes** do 1º sprint (22/06) | célula esmaecida "rascunho" (D10+D12) |
| Zordon 01/06 (draft, vazio) | **gap depois** do último sprint (24/05) | célula esmaecida "rascunho" (D10+D12) |
| Validação 25/05 (archived) | **antes** do 1º sprint (15/06) **e** archived | **fora da timeline** (D11) — não renderiza |

> **Correção da crítica:** a 4ª órfã verdadeira é a **Validação 25/05** (archived, sem sprint). A **Volundly 25/05** *tem* sprint cobrindo — não é órfã; é archived alinhada, e sai pela D11 mesmo assim.

**Estados legados a renderizar com graça (sem migração):**
- **2 reports vazios** (Zordon, Vivix): drafts nunca sintetizados → "rascunho sem síntese" esmaecido (D12).
- **2 archived** (Validação 25/05 órfã, Volundly 25/05 com-sprint): ambas fora da régua (D11).
- **sem digest executivo** em reviews antigas: fallback nas notes de detalhe, comportamento que o overview já tem.

**Veredito:** com a régua de grade-semanal (D1) + D10/D11/D12, **casam bem**. A grade absorve órfãs como células avulsas; archived saem; drafts vazios viram células esmaecidas honestas. **Zero backfill.** O único risco real era o bucket "Sem sprint" colapsando o histórico — eliminado pela D1.

---

## §6 — Arquitetura de dados (o que muda: ~nada)

- **Tabelas:** `PMReview`, `PMReviewNote`, `EntityLink`, `RitualPlaybook`, `ProjectGranolaFolder` — **todas permanecem como estão**.
- **Migração nova:** nenhuma obrigatória. (Opcional D3: nenhum DDL — só bloquear `referenceWeek` no PATCH.)
- **Snapshot:** não há tabela de snapshot. O nó histórico = `getPMReview(id)` da semana passada renderizado read-only.
- **database.types.ts:** sem mudança.

Contraste deliberado com o Planning, que precisou de 3 tabelas novas. Aqui o motor de dados já está pronto.

---

## §7 — O que falta de fato (gaps + reuso)

### Construir (novo)
1. **Shell `/projects/[id]/pm-review/page.tsx`** — espelha [planning/page.tsx](../../src/app/(dashboard)/projects/[id]/planning/page.tsx). Carrega lista de reviews do projeto (`GET /api/projects/[id]/pm-reviews`), resolve a semana corrente como "ao vivo" (get-or-create via refresh já existente), monta `CronogramaBlock[]` na régua de sprint.
2. **Grade-semanal ancorada nos sprints, do zero** (D1, D16) — montar células de semana cobrindo o span [primeira review/sprint → semana corrente]; cada review = 1 célula. Semana com sprint → rótulo do sprint; sem sprint → rótulo da data, tom "fora de sprint" (D10). **Excluir `status='archived'`** (D11). Drafts vazios → célula esmaecida (D12). Âncora = `brtMonday` (D16). **Não dá pra reusar `weeks[]`** (janela fixa de 4, só published) — só serve de referência de mapeamento review→semana. `logCount` = nº de notes ativos.
3. **Guard D3 + guard D13** — API bloqueia troca de `referenceWeek` pós-create **e** rejeita `referenceWeek` futuro.
4. **3 hrefs** → `/projects/[id]/pm-review` (§5.1, linhas 221/1409/167) + redirect da rota antiga.
5. **Entry point de autoria back-dated** (D13) — célula vazia ≤ hoje → "Fazer PM Review desta semana" → `POST /api/pm-review { referenceWeek }` (já existe) → abre o draft editável.
6. **Backend da síntese back-dated** (D14) — `refreshPMReviewForProject` aceita `referenceWeek` explícito (default `brtMonday(now)`) **e** filtra fontes por `capturedAt` (não `createdAt`) na via retroativa. Não é "1 param só" como dizia a Rev. 3.
7. **Disclosure de review retroativa** (D15) — nota/banner minimalista no report quando o contexto é aproximado.

### Reusar (generalizar por prop)
- [planning-cronograma.tsx](../../src/components/planning-session/planning-cronograma.tsx) — **regeneralizar** `CronogramaBlock` (`sprintId` → `weekStart` + N células órfãs; `kind` por estado, não por hoje-vs-sprint). **Toca o Planning em prod → exige teste de regressão da mini-régua** (D6).
- [planning-history-sheet.tsx](../../src/components/planning-session/planning-history-sheet.tsx) — picker; eventos viram "reviews da semana".
- **Canvas:** renderizar [pm-review-report.tsx](../../src/components/pm-review/pm-review-report.tsx) (já existe), **sempre editável** (D4/D5) — sem modo read-only.
- **NÃO reusar** [live-history-toggle.tsx](../../src/components/planning-session/live-history-toggle.tsx). PM Review não tem live↔history nem read-only (D5); a navegação é a grade + botão "Semana atual" (pular-pra-hoje). Sem `composerSubmitDisabled`.

**Recomendação de ordem:** extrair os 3 componentes de chassi pra um lugar compartilhado **antes** de plugar no PM Review, pra Planning e PM Review dividirem um só código (senão viram 2 cópias divergentes).

---

## §8 — Faseamento

| Fase | Entrega | Toca |
|------|---------|------|
| **1 — App única + cronograma** | Rota nova, abre na semana corrente; grade-semanal (do zero); navegação por célula; **toda review editável** (sem read-only); autoria back-dated com fidelidade aproximada + disclosure (D14/D15); botão "Semana atual"; 3 hrefs + redirect; guards D3/D13. | frontend + chassi (com teste de regressão no Planning) + backend pequeno no refresh (param de semana + `capturedAt`). **Não** toca o agente/daemon/schema. |
| **2 — Fidelidade point-in-time + tendência** | Back-dated fiel: threadar `referenceWeek` no context loader da Vitoria (sprint/tasks/decisões da semana-alvo) — **toca o agente nos 2 repos**. + leitura cross-semana (evolução de riscos, decisões, milestones; "o que mudou desde a semana passada"). | agente (2 repos) + leitura nova sobre dados existentes. |
| **3 — Sobreposição com Planning** | Mesma régua de sprint → ver "plano" (Planning) e "pulso" (PM Review) na mesma posição. Possível ribbon unificado. | UI; nada de dados. |

Fase 1 entrega ≥ o que existe hoje (a lista vira navegação interna + ganha timeline + autoria retroativa) **sem regressão** — porque published continua editável (D4), nada é tirado.

---

## §9 — Referências de código (vivo)

- **Template:** [planning-versioned-living-runbook.md](planning-versioned-living-runbook.md) · [planning/page.tsx](../../src/app/(dashboard)/projects/[id]/planning/page.tsx)
- **Chassi a reusar:** [planning-cronograma.tsx](../../src/components/planning-session/planning-cronograma.tsx) · [live-history-toggle.tsx](../../src/components/planning-session/live-history-toggle.tsx) · [planning-history-sheet.tsx](../../src/components/planning-session/planning-history-sheet.tsx)
- **PM Review hoje:** [pm-reviews/[id]/page.tsx](../../src/app/(dashboard)/pm-reviews/[id]/page.tsx) · [components/pm-review/](../../src/components/pm-review/) · [dal/pm-review.ts](../../src/lib/dal/pm-review.ts)
- **Backend pronto:** [refresh.ts](../../src/lib/pm-review/refresh.ts) (get-or-create + brtMonday) · [context.ts:228](../../src/lib/agent/context.ts#L228) (thread por semana)
- **Downstream:** [project-overview.ts](../../src/lib/dal/project-overview.ts) · [wiki/composer.ts](../../src/lib/wiki/composer.ts)
- **Agente:** [vitoria/index.ts](../../src/lib/agent/agents/vitoria/index.ts) · [vitoria/pm-review.ts](../../src/lib/agent/agents/vitoria/pm-review.ts) · daemon: `zordon-daemon/src/lib/agent/`
- **Automação:** [ritual-playbook.ts](../../src/lib/dal/ritual-playbook.ts) · [api/cron/pm-review-refresh/route.ts](../../src/app/api/cron/pm-review-refresh/route.ts) · [20260617c](../../supabase/migrations/20260617c_pm_review_refresh_cron.sql) · [20260617d](../../supabase/migrations/20260617d_ritual_playbook.sql)
- **Memories:** [[project_pm_review]] · [[project_vitoria_daemon_surfaces]] · [[project_ritual_playbook]] · [[project_planning_versioned_living]] · [[feedback_agent_ui_parity]] · [[project_daemon_tool_advertisement]]

---

## §10 — HANDOFF: o que NÃO tocar

Para o próximo agente que implementar a Fase 1:

1. **NÃO** crie tabela de snapshot. O nó é a `PMReview`. (≠ Planning)
2. **NÃO** crie modo read-only nem congele published — toda review é editável (D4/D5). A thread já é por-semana (`agentName=pmReviewId, channel='pm_review'`); não mude a chave.
3. **NÃO** toque em surface/tools/daemon na **Fase 1** (a fidelidade aproximada da D14 não toca o agente). Point-in-time é Fase 2 → aí sim 2 repos + restart do daemon.
4. **NÃO** reimplemente a aritmética de semana e **NÃO** use `weeks[]` (janela fixa de 4, só published). Use `brtMonday` (D16) — a mesma do cron.
5. **NÃO** funda `audience='detail'` e `'executive'`. Overview e Wiki dependem do split.
6. **NÃO** mova playbook/cron/owner pra nível de semana. É por projeto.
7. **SEMPRE** atualize os 3 hrefs juntos (221/1409/167) + redirect da rota antiga, ou vira 404.
8. **TESTE de regressão no Planning** ao regeneralizar o `CronogramaBlock` — ele está em prod (D6).
9. **Back-dated:** filtre fontes por `capturedAt` (D14) e rejeite semana futura no POST (D13).
10. **VERIFIQUE** depois: Wiki composer e overview executivo continuam lendo PMReview sem erro (smoke nos 2 widgets).

---

## §11 — Open questions

- ~~**OQ1**~~ **RESOLVIDA + IMPLEMENTADA (interim rollback-safe):** em vez de redirect imediato, os 3 hrefs apontam pra `/projects/[id]/pm-review?week=YYYY-MM-DD` (shell lê `?week` no mount) e a rota antiga `/pm-reviews/[id]` **continua viva como wrapper fino** do `PMReviewWorkspace`. Rollback = reverter os 3 hrefs (a app nova some da navegação, a antiga volta). **Pós-estabilização:** trocar o wrapper por `permanentRedirect` (308) com lookup `id→projectId+referenceWeek`. Docs Next 16: `redirect`=307, `permanentRedirect`=308 em Server Components. (cobre OQ3.)
- ~~**OQ2**~~ **RESOLVIDA:** não exigir sprints — a grade degenera graciosamente (semanas com review + a corrente). Projeto 0-sprints (ALESP) abre numa timeline fina. Reversível.
- **OQ3 (Fase 1):** **rollback/feature-flag.** Com a rota antiga virando redirect, se a app nova regredir não há fallback. Flag pra rota nova + manter a antiga viva atrás dela até estabilizar?
- **OQ4 (Fase 1):** **concorrência cron × humano** — humano editando draft às 10:59, cron dispara 11:00 na mesma thread. Hoje o refresh só pula se há turn em voo; não há lock de edição manual. Aceitável ou precisa de guard?
- **OQ5 (Fase 2):** "o que mudou desde a semana passada" é on-read (diff de notes) ou a Vitoria escreve um note `kind='summary'` de delta?
- **OQ6 (Fase 3):** ribbon unificado Planning+PM Review é uma 3ª app ("Operação") ou dois toggles na mesma régua?

---

## §12 — Registro da crítica adversarial (Rev. 4)

Um subagente revisou a Rev. 3 **verificando cada premissa no código** (e re-rodando o `psql`). Resultado: esqueleto aprovado, 3 premissas derrubadas, correções aplicadas.

**Premissas verificadas:**

| Premissa (Rev. 3) | Verdict | Evidência | Consequência |
|---|---|---|---|
| Thread já é por-semana | ✅ | `context.ts:228-260`, `prepare-turn:176-200` | mantido |
| Downstream lê por query, não URL | ✅ | `wiki/composer.ts:90`, `project-overview.ts:682,778` | mantido |
| Snapshot 13/9/4/2/2 | ✅ (atribuição trocada) | psql | §5.6 corrigido (Validação é a órfã, não Volundly) |
| `createPMReview` aceita semana arbitrária | ⚠️ aceita **futuro** | `api/pm-review/route.ts` | +guard D13 |
| "Published congela" | ❌ **editável de propósito** | `publish/route.ts` (comentário) | D4 reescrito (sem freeze) |
| "Back-dated não toca o agente" | ❌ só na fidelidade aproximada | `vitoria/pm-review.ts:87-103` (`todayISO`) | D14 reescrito; point-in-time → Fase 2 |
| "reabrir = natural" | ❌ não existe na state machine | `pm-review/status.ts` | irrelevante agora (D4 não congela) |
| Reuso `weeks[]`/`CronogramaBlock` | ❌ otimista | `project-overview.ts:153,187`; `planning-cronograma.tsx:6` | grade do zero (D1); +teste de regressão (D6) |
| Janela de fontes por `createdAt` | ⚠️ bug p/ back-dated | `refresh.ts:135` | D14: filtrar `capturedAt` |
| 3 funções de "segunda da semana" | ⚠️ divergem | `refresh.ts:62`, `pm-review.ts:157`, `project-overview.ts:189` | +D16 (usar `brtMonday`) |

**O que mudou de Rev. 3 → 4:** D4 (published não congela), D5 (sem read-only), D14 (fidelidade aproximada + `capturedAt`), +D13 guard futuro, +D15 disclosure honesto, +D16 âncora de semana. Faseamento: point-in-time foi pra Fase 2. Backend deixou de ser "1 param" → param + `capturedAt` + 2 guards (ainda sem schema, sem agente na Fase 1). +OQ3 (rollback/flag), +OQ4 (concorrência cron×humano).
