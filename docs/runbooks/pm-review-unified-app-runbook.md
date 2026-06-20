# PM Review como app única (cronograma navegável) — runbook

> **Status:** Rev. 3 — design + raio de explosão + legado + autoria retrospectiva (2026-06-20). Nada implementado ainda.
> **Decisões fechadas com o João:** régua = **grade de semanas ancorada nos sprints** · nó = semana (1 snapshot por PM Review) · **editabilidade por status (rascunho edita / publicada congela), em qualquer semana** · autoria back-dated em célula vazia ≤ hoje · zero schema novo (1 param de backend) · reuso do chassi do Planning (menos o toggle live/histórico) · órfãs navegáveis · archived fora da timeline.
> **Mockup fiel (atual × proposta):** artifact `pm-review-app` (Ao vivo · Histórico · mapeamento).
> **Companheiro:** [planning-versioned-living-runbook.md](planning-versioned-living-runbook.md) — o template que estamos espelhando.

---

## §1 — A dor

Hoje o PM Review é uma **coleção de páginas soltas**:

- Cada review vive em `/pm-reviews/[id]`, alcançada por uma lista (Rituais app). Não há régua, não há navegação entre semanas.
- A "memória viva da operação" — a sequência de riscos, decisões e milestones semana após semana — **é invisível na superfície**. Existe no banco (`PMReview` por `referenceWeek`), mas o usuário nunca vê a linha do tempo.
- O Planning acabou de ganhar exatamente isso (cronograma + canvas histórico navegável, ZRD-JM-176). O PM Review ficou para trás: dois rituais da Vitoria, duas UXs diferentes — viola a parity de agente ([[feedback_agent_ui_parity]]).

**O que queremos:** uma app única por projeto, abre na semana corrente, com a régua de sprint no topo e navegação por semana. Editabilidade segue o status (rascunho edita / publicada congela), em qualquer semana — inclusive autorar reviews retrospectivas. Os logs viram a memória viva.

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
| Binning por semana | construído do zero no page.tsx | **já existe** em [project-overview.ts:153](../../src/lib/dal/project-overview.ts#L153) (`weeks[]` com `isCurrentWeek`) |

**Conclusão:** o trabalho é quase todo **frontend + reuso de chassi**. Zero migração de schema. A thread por-semana e o get-or-create da semana corrente já estão prontos no backend. **Única exceção de backend:** parametrizar a janela de síntese por `referenceWeek` pra autoria back-dated (D14) — não é schema, é um argumento.

**Onde NÃO é mais limpo (o que exige cuidado):** o PM Review tem **mais conexões downstream** que o Planning (Wiki, overview executivo, cron, playbook, daemon, feeds Granola/Drive). É aí que mora o risco — não na feature em si, mas em **não atropelar quem lê PMReview**. Ver §5.

---

## §3 — Modelo mental

```
                 RÉGUA DE SPRINT (mesma do Planning)
  ┌────┬────┬────┬────┬────┬──────┬────┬────┐
  │ s1 │ s2 │ s3 │ s4 │ s5 │ [s6] │ s7 │ s8 │   ← cada bloco = 1 sprint-semana
  └────┴────┴────┴────┴────┴──────┴────┴────┘
   pub  pub  ∅    pub  pub  CORRENTE fut  fut
                            (ao vivo)
        └──── histórico (read-only) ────┘   └─ futuro (sem review) ─┘

  Nó = a PMReview daquela semana. Memória viva = ler a cadeia de nós.
```

- **Editabilidade segue o STATUS, não a data.** PM Review é **retrospectivo** — revisar o passado *é* o trabalho (≠ Planning, onde não se "planeja o passado"). Logo, **não há binário live/histórico**:
  - `draft` → **editável em qualquer semana** (Vitoria trabalha, chat habilitado), inclusive catch-up de semana passada.
  - `published` → congelada, read-only (reabrir = extensão natural).
- **O cronograma é a espinha** (sem toggle live/histórico). Cada célula = uma semana com estado: rascunho · publicada · vazia · futura. "Semana atual" = botão de pular-pra-hoje.
- **Autoria back-dated**: célula vazia no passado/presente → "Fazer PM Review desta semana" cria rascunho daquele `referenceWeek`. Células futuras são inertes.
- **Régua** = grade de semanas ancorada nos sprints (1:1 com `referenceWeek`, já que sprint = seg→dom, [[project_sprint_week_model]]).
- **Memória viva da operação** = a leitura cross-semana (tendência de risco, decisões acumuladas, milestones) — **não** um estado acumulado como o board do Planning.

Invariante central: **o status manda na editabilidade (rascunho edita / publicada congela), em qualquer semana; a grade-semanal ancorada em sprint alinha os dois rituais.**

---

## §4 — Decisões fixadas (Dn)

| Dn | Decisão | Por quê |
|----|---------|---------|
| **D1** | Régua = **grade de semanas ancorada na grade de sprint** (não blocos de sprint puros). Cada review = 1 célula de semana; semana com sprint é rotulada pelo sprint, semana sem sprint pela data. | Sprint = semana (1:1), então a grade semanal **sobrepõe** a de sprints onde elas existem → mantém o alinhamento com o Planning pro overlay (Fase 3), mas **preserva navegação 1:1 das reviews em semanas sem sprint** (ver §5.6). Blocos-de-sprint puros colapsariam as órfãs num bucket único. |
| **D2** | Nó da timeline = a própria `PMReview` (1 por `referenceWeek`). **Zero tabela nova.** | O artefato semanal já é discreto e congelável. Não há substrato mutável que vaze — não precisa snapshot copiado tipo `PlanningEventTask`. |
| **D3** | `referenceWeek` é **imutável depois de criada**. | É a chave do nó. Hoje o PATCH permite trocar ([pm-review/[id]/route.ts](../../src/app/api/pm-review/[id]/route.ts)) — adicionar guard. Trocar a semana = outro nó, não editar o mesmo. |
| **D4** | Review **published congela** (read-only, exceto append de note). | Já é respeitado pelo refresh ([refresh.ts:127](../../src/lib/pm-review/refresh.ts#L127) → `frozen`). UI histórica reforça via `composerSubmitDisabled`. |
| **D5** | Read-only é determinado por **`status==published`, NÃO por "semana passada"**. Um `draft` de semana passada **é editável** (Vitoria trabalha). Read-only é client-side (composer desabilitado + canvas read). **Sem mudança no agente.** | PM Review é retrospectivo — drafts passados (ex: ALESP 08/06, Zordon 01/06) precisam ser termináveis. A thread já existe por semana; congelar = só não deixar mandar mensagem quando published. Espelha `chatReadOnly` ([planning/page.tsx:493](../../src/app/(dashboard)/projects/[id]/planning/page.tsx#L493)) mas com gatilho de status, não de data. |
| **D6** | Chassi (cronograma, toggle, history-sheet) vira **compartilhado por prop** entre os 2 rituais. | Parity de agente ([[feedback_agent_ui_parity]]). Diferença vem por prop, nunca por cópia. |
| **D7** | Digest executivo (`audience='executive'`) e notes de detalhe (`audience='detail'`) **continuam separados**. | Consumido separadamente pelo overview ([project-overview.ts:798](../../src/lib/dal/project-overview.ts#L798)) e Wiki. Não fundir. |
| **D8** | Playbook, cron, owner-resolution e feeds permanecem **por projeto** (não por semana/review). | A automação semanal é batched por projeto no cron. Mover pra nível de review/semana quebra o batching. |
| **D9** | Rota canônica vira `/projects/[id]/pm-review` (espelha `/projects/[id]/planning`). Antiga `/pm-reviews/[id]` → redirect. | Single-app por projeto; back-href já aponta pro mesmo lugar (`?tab=apps&app=ceremonies`). |
| **D10** | Review em **semana sem sprint** (órfã) = célula de semana navegável, tom "fora de sprint" (não colapsa em bucket). | Padrão estrutural (projeto sem sprints, gap entre contratos, semana pré-kickoff). Hoje 4/13 (§5.6). |
| **D11** | Reviews `status='archived'` ficam **fora da timeline**. | Archived = aposentada; não polui a régua. Hoje 2/13 (Validação 25/05, Volundly 25/05). |
| **D12** | Drafts passados com `reportMarkdown` vazio = célula **esmaecida** "rascunho sem síntese"; **sem backfill**. Sem digest executivo → fallback nas notes de detalhe. | Zero schema; renderiza o que existe. Fallback já é o comportamento do overview ([project-overview.ts:175](../../src/lib/dal/project-overview.ts#L175)). Hoje 2 reports vazios (Zordon, Vivix). |
| **D13** | Célula **vazia no passado/presente** → "Fazer PM Review desta semana" cria `draft` daquele `referenceWeek`. Células **futuras** são inertes (sem autoria). | PM Review é retrospectivo: autorar review de semana ≤ hoje é legítimo (catch-up); de semana futura não faz sentido. O `createPMReview` já aceita `referenceWeek` arbitrário; só falta o ponto de entrada na UI. |
| **D14** | A **síntese de review back-dated ancora a janela de fontes no `referenceWeek` da review**, não em `now`. | [refresh.ts:101](../../src/lib/pm-review/refresh.ts#L101) hoje crava `brtMonday(now)`. Pra autorar a semana passada com os insumos *daquela* semana, `refreshPMReviewForProject` precisa aceitar uma semana explícita. **Única mudança de backend do projeto** (parametrização pequena). |

---

## §5 — Raio de explosão: as conexões que podem quebrar

**Esta é a seção que o João pediu.** Agrupado por superfície. Legenda de risco: 🔴 alto (toca → quebra prod) · 🟡 médio (precisa atualizar junto) · 🟢 baixo (no raio, mas seguro se não mexer).

### 5.1 — Frontend & navegação (🟡 — atualizar junto, senão 404)

| Conexão | Arquivo:linha | Quebra se |
|---|---|---|
| Redirect pós-create | [rituais-file-view.tsx:209](../../src/components/apps/rituais-file-view.tsx#L209) `router.push(/pm-reviews/${created.id})` | rota muda e este não aponta pra nova → cria review e cai em 404 |
| Link "Abrir →" no widget de projetos | [projetos-board.tsx:1409](../../src/components/overview/projetos-board.tsx#L1409) `href={/pm-reviews/${...}}` | idem 404 |
| href na API de Rituais | [rituals/route.ts:139](../../src/app/api/projects/[id]/rituals/route.ts#L139) `href: /pm-reviews/${r.id}` | a lista de Rituais e o `onOpen` ([rituais-file-view.tsx:269](../../src/components/apps/rituais-file-view.tsx#L269)) leem daqui → corrigir aqui cobre os dois |
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

`UNIQUE(projectId, referenceWeek)` + CHECK `referenceWeek` = segunda ([20260529d_pm_review.sql](../../supabase/migrations/20260529d_pm_review.sql)) são **load-bearing e permanecem**. RLS encadeia por `PMReview.projectId` (select via `can_view_project`, edit via `can_create_pm_review`). EntityLink XOR (meeting|contextSource|...) permanece. **Nada muda aqui** (exceto, opcionalmente, o guard D3 de imutabilidade de `referenceWeek`, que é validação de API, não DDL).

### 5.6 — Reviews legadas: casam bem na UX nova? (dados reais 2026-06-20)

Snapshot do banco: **13 reviews, 10 projetos, 4 semanas (25/05→15/06)** — cadência semanal ainda imatura (1–2 reviews/projeto). Quando há sprint cobrindo a semana, o alinhamento é **exato** (`sprint.startDate` segunda = `referenceWeek` segunda). **9/13 casam 1:1.**

**As 4 órfãs (semana sem sprint) — padrão estrutural, não exceção:**

| Review | Modo de falha | Tratamento (D10) |
|---|---|---|
| ALESP 08/06 (draft) | projeto com **0 sprints** | célula de semana avulsa, navegável |
| Validação 25/05 (archived) | **antes** do 1º sprint (15/06) | **fora da timeline** (D11) |
| Vivix 08/06 (draft, vazio) | **antes** do 1º sprint (22/06) | célula esmaecida "rascunho" (D10+D12) |
| Zordon 01/06 (draft, vazio) | **gap depois** do último sprint (24/05) | célula esmaecida "rascunho" (D10+D12) |

**Estados legados a renderizar com graça (sem migração):**
- **2 reports vazios** (Zordon, Vivix): drafts nunca sintetizados → "rascunho sem síntese" esmaecido (D12).
- **2 archived** (Validação, Volundly, ambas 25/05): fora da régua (D11) → na prática some 1 das órfãs e 1 das alinhadas.
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
2. **Grade-semanal ancorada nos sprints** (D1) — montar células de semana cobrindo o span [primeira review/sprint → semana corrente]; cada review = 1 célula. Semana com sprint → rótulo do sprint; sem sprint → rótulo da data, tom "fora de sprint" (D10). **Excluir `status='archived'`** (D11). Drafts vazios → célula esmaecida (D12). **Reusar a lógica de `weeks[]` de [project-overview.ts:153](../../src/lib/dal/project-overview.ts#L153)** (já mapeia review→semana→isCurrentWeek) e a aritmética `brtMonday`/`referenceWeek`. `logCount` = nº de notes ativos da semana.
3. **Guard D3** — PATCH bloqueia troca de `referenceWeek` pós-create.
4. **3 hrefs** → `/projects/[id]/pm-review` (§5.1) + redirect da rota antiga.
5. **Entry point de autoria back-dated** (D13) — célula vazia ≤ hoje → "Fazer PM Review desta semana" → `POST /api/pm-review { referenceWeek }` (já existe) → abre o draft editável.
6. **Parametrizar a janela de síntese** (D14) — `refreshPMReviewForProject` aceita `referenceWeek` explícito (default `brtMonday(now)`). **Única mudança de backend.**

### Reusar (generalizar por prop)
- [planning-cronograma.tsx](../../src/components/planning-session/planning-cronograma.tsx) — `CronogramaBlock` já é genérico; mover pra local neutro/ritual-aware.
- [planning-history-sheet.tsx](../../src/components/planning-session/planning-history-sheet.tsx) — picker; eventos viram "reviews da semana".
- **Canvas:** renderizar [pm-review-report.tsx](../../src/components/pm-review/pm-review-report.tsx) (já existe); read-only quando `status==published`, editável quando `draft`.
- **NÃO reusar o binário** [live-history-toggle.tsx](../../src/components/planning-session/live-history-toggle.tsx) como modo. PM Review não tem live↔history; tem **editabilidade por status** (D5) + um botão "Semana atual" (pular-pra-hoje). O `composerSubmitDisabled` ([planning/page.tsx:510](../../src/app/(dashboard)/projects/[id]/planning/page.tsx#L510)) é reusado, mas com gatilho `status==published`, não "semana passada".

**Recomendação de ordem:** extrair os 3 componentes de chassi pra um lugar compartilhado **antes** de plugar no PM Review, pra Planning e PM Review dividirem um só código (senão viram 2 cópias divergentes).

---

## §8 — Faseamento

| Fase | Entrega | Toca |
|------|---------|------|
| **1 — App única + cronograma** | Rota nova, abre na semana corrente; mini-régua de sprint (grade-semanal); navegação por célula; editabilidade por status (rascunho edita / publicada read-only); autoria back-dated em célula vazia; botão "Semana atual"; 3 hrefs + redirect; param de `referenceWeek` no refresh (D14). | frontend + chassi compartilhado + 1 param de backend. **Não** toca agente/daemon/cron/playbook/schema. |
| **2 — Leitura de tendência (memória viva)** | Cross-semana: evolução de riscos (stance), decisões acumuladas, milestones na timeline. Indicador de "o que mudou desde a semana passada". | leitura nova sobre dados existentes; talvez 1 helper de DAL. |
| **3 — Sobreposição com Planning** | Mesma régua de sprint → ver "plano" (Planning) e "pulso" (PM Review) na mesma posição. Possível ribbon unificado. | UI; nada de dados. |

Fase 1 entrega ≥ o que existe hoje (a lista vira navegação interna + ganha timeline). Sem regressão.

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
2. **NÃO** mude a chave da thread. `agentName=pmReviewId, channel='pm_review'` já é por-semana. Read-only é client-side.
3. **NÃO** toque em surface/tools/daemon na Fase 1. É só rota + chassi. (Se um dia tocar tool → regra das 2 cópias + restart do daemon.)
4. **NÃO** reimplemente a aritmética de semana. Reuse `brtMonday`/`referenceWeek`/`weeks[]`.
5. **NÃO** funda `audience='detail'` e `'executive'`. Overview e Wiki dependem do split.
6. **NÃO** mova playbook/cron/owner pra nível de semana. É por projeto.
7. **SEMPRE** atualize os 3 hrefs juntos + redirect da rota antiga, ou vira 404.
8. **VERIFIQUE** depois: Wiki composer e overview executivo continuam lendo PMReview sem erro (smoke nos 2 widgets).

---

## §11 — Open questions

- **OQ1 (Fase 1):** a rota antiga `/pm-reviews/[id]` vira redirect server-side pra `/projects/[id]/pm-review` (sem deep-link pra review específica) ou pra `/projects/[id]/pm-review?week=YYYY-MM-DD`? (preferência: com `?week` pra preservar bookmarks de reviews antigas).
- **OQ2 (Fase 1):** projeto com **0 sprints** (ex: ALESP) — a grade-semanal degenera pra "só as semanas com review + a corrente". Confirmar que é aceitável (timeline fina) vs. exigir ≥1 sprint pra abrir a app.
- **OQ3 (Fase 2):** "o que mudou desde a semana passada" é computado on-read (diff de notes) ou a Vitoria escreve um note `kind='summary'` de delta? (não-bloqueante p/ Fase 1).
- **OQ4 (Fase 3):** ribbon unificado Planning+PM Review é uma 3ª app ("Operação") ou dois toggles na mesma régua? (decidir só ao chegar na Fase 3).
