# Esteira de conclusão de task — pipeline determinístico Git ↔ Zordon

Plano para fazer o Zordon receber sinal canônico de "task concluída" a partir de eventos Git (merge em `main`), substituindo a leitura probabilística de transcript do Roam como fonte primária. Habilita agentes (Alpha e futuros) a agir em dado confiável, e expõe métricas de fluxo do time como subproduto.

> Decisão estratégica: padronizar commits/PRs é **infra para a esteira agêntica**, não ferramenta de medição individual. Métricas geradas são de fluxo de squad/sprint, nunca per-capita público.

## Objetivos

1. Sinal determinístico de "done" — quando uma task está concluída, o Zordon sabe sem depender de LLM ler reunião
2. Zero ritual no `git commit` — dev não digita ID em lugar nenhum; convenção de branch carrega o link
3. Linkagem auditável commit ↔ PR ↔ task ↔ design session, navegável em qualquer direção
4. Esteira reutilizável: qualquer agente novo herda o ônibus de dados (close task, gerar release notes, detectar tasks órfãs, reconciliar plano vs entrega)
5. Métricas de fluxo de time: cycle time, throughput por tipo, WIP, idade de PR aberto — sem leaderboard individual
6. Padrão replicável em todos os projetos do Zordon, instalável em < 5min em repo novo

## Não-objetivos

- **Não** medir produtividade individual por commit count, LOC ou tasks fechadas. Goodhart garante que isso degrada cultura e gera dado ruim.
- **Não** forçar trailer/ID em todo commit interno de branch. Standardização é no boundary do PR, não no ato de commitar.
- **Não** substituir transcript Roam — transcript continua útil para sinais que commit não captura (blockers, decisões de escopo, tasks novas descobertas em reunião). Esteira o complementa, não o aposenta.
- **Não** acoplar a deploy/produção neste MVP. "Done" = mergeado em `main`. Deploy é estado opcional pra fase futura.

## Estado atual

- Convenção de commit é `ZRD-JM-NN: <auto-summary>` ([feedback_commit_convention.md](memory)) — `NN` é incremental por autor, **não** referencia task. Logo, hoje não existe link commit↔task no histórico.
- Script `sync-main` ([commit bd1b060](git)) sincroniza `main` com seleção interativa de remote (staging/prod/all). Não emite sinal pra fora.
- Alpha consome transcript Roam (probabilístico) pra inferir status de task. Funciona, mas tem gap quando algo não foi falado em voz alta.
- Zordon tem entidades de task com states (definidos no schema). PR e commit não estão modelados como entidades linkadas à task.
- Não existe webhook GitHub → Zordon. Atualização de status é manual pelo PM ou inferida pelo Alpha.

## Princípios de desenho

| # | Princípio | Implicação |
|---|---|---|
| 1 | Merge em `main` é o único "done" canônico | Eventos antes (commit, push, PR aberto) podem mudar status mas não fecham |
| 2 | Branch name é a fonte do link task↔código | Devs já nomeiam branch; aproveitar elimina ritual extra |
| 3 | Standardização no PR boundary, não por commit | Commits internos da branch são livres |
| 4 | Convenção barata de seguir, cara de violar | Hook auto-injeta; CI bloqueia merge se branch não tem ID (com escape válido) |
| 5 | Ferramenta central, config por repo | CLI versionado central + `.zordon.json` por repo. Sem cópia de script entre projetos. |
| 6 | Reversibilidade explícita | Revert de merge reabre a task com nota; nada é "fechado pra sempre" |
| 7 | Métricas só de fluxo de time | Nunca exibir ranking individual; nunca usar como input de avaliação |

## Modelo conceitual

### Estados da task no Zordon

| Estado | Evento que dispara | Quem dispara |
|---|---|---|
| `Backlog` | task criada | PM ou agente (Super Planning, Design Session) |
| `To Do` | task entra em sprint | PM ou agente de sequencing |
| `In Progress` | branch criada com `*/ZRD-NNN-*` no nome (push da primeira ref) | GitHub App |
| `In Review` | PR aberto referenciando ZRD-NNN | GitHub App |
| **`Done`** | **PR mergeado em `main`** | **GitHub App (webhook `pull_request.closed` com `merged=true`)** |
| `Reverted` | merge revertido em `main` | GitHub App (detecta revert commit) |
| `Deployed` *(fase 2)* | release tag criada / deploy bem-sucedido | CI/CD webhook |

### Convenção de branch

```
<tipo>/<ZRD-NNN>-<slug-curto>

Exemplos:
  feat/ZRD-142-skill-filter
  fix/ZRD-187-login-redirect-loop
  chore/ZRD-203-bump-supabase-deps
  refactor/ZRD-220-extract-task-card
  spike/ZRD-NEW-explorar-llm-routing   ← spike sem task: ID virtual `ZRD-NEW`
```

- `<tipo>` ∈ `feat | fix | chore | refactor | docs | test | spike | hotfix`
- `<ZRD-NNN>` é o ID da task no Zordon. Para spikes/exploração sem task, usar `ZRD-NEW` — o GitHub App cria task automaticamente do tipo `spike` no merge.
- `<slug-curto>` é livre, kebab-case, < 50 chars.

### Convenção de PR

- **Título do PR**: livre, mas o GitHub App valida que `branch name OU body OU título` referencia ao menos um `ZRD-NNN`.
- **Body do PR** (template auto-injetado pelo GitHub App):

  ```markdown
  ## Tasks
  Closes: ZRD-142

  ## Resumo
  <preenchido pelo dev>

  ## Test plan
  - [ ] ...
  ```

- **Múltiplas tasks no mesmo PR**: `Closes: ZRD-142, ZRD-143` no body. Todas fecham no merge.
- **PR que toca task mas não fecha** (ex: parte de uma task grande): `Refs: ZRD-200` em vez de `Closes:`. Linka mas não muda estado.

### Trailer no merge commit (opcional, fase 2)

Squash merge gera commit com mensagem do PR. GitHub App pode injetar trailer canônico:

```
ZRD-JM-NN: <título do PR>

Closes: ZRD-142
PR: #237
```

Isso preserva o link no histórico do `git log` pra quem não tem acesso ao GitHub.

## Arquitetura técnica

### Componentes

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   GitHub (qualquer repo │         │     Zordon Platform      │
│   com .zordon.json)     │         │                          │
│                         │         │  ┌────────────────────┐  │
│   ┌─────────────────┐   │ webhook │  │  /api/github/      │  │
│   │ branch criada   │───┼─────────┼─▶│  webhook           │  │
│   │ PR aberto       │   │         │  │  (rota Next)       │  │
│   │ PR mergeado     │   │         │  └─────────┬──────────┘  │
│   │ revert detectado│   │         │            │             │
│   └─────────────────┘   │         │            ▼             │
│                         │         │  ┌────────────────────┐  │
│                         │         │  │ TaskTransition     │  │
│                         │         │  │ Service            │  │
│                         │         │  │ (parsea, valida,   │  │
│                         │         │  │  move estado)      │  │
│                         │         │  └─────────┬──────────┘  │
│                         │         │            ▼             │
│                         │         │  ┌────────────────────┐  │
│                         │         │  │ Supabase: tasks,   │  │
│                         │         │  │ task_events,       │  │
│                         │         │  │ task_pr_links      │  │
│                         │         │  └────────────────────┘  │
└─────────────────────────┘         └──────────────────────────┘
                                                 │
                                                 ▼
                                       Alpha lê task_events
                                       pra contexto / ações
```

### GitHub App: `Zordon Sync`

- **Tipo**: GitHub App (não Action). Razões: (1) instala uma vez por org, vale pra todos os repos; (2) recebe webhooks de todos os eventos sem precisar `.github/workflows/` em cada repo; (3) auth via JWT/installation token, sem PAT.
- **Permissões necessárias**:
  - `Contents: Read` (ler branches, commits)
  - `Pull requests: Read & Write` (ler PRs, escrever comentário com link da task)
  - `Metadata: Read`
- **Eventos assinados**:
  - `push` (detectar branch nova com pattern `*/ZRD-NNN-*` → mover task pra `In Progress`)
  - `pull_request` (`opened`, `reopened`, `closed`, `edited`)
  - `pull_request_review` (opcional, pra detectar review aprovado/pedido)
- **Endpoint receptor**: `POST /api/github/webhook` no Zordon (Next route handler).
- **Verificação**: HMAC SHA-256 do payload com `GITHUB_WEBHOOK_SECRET`.

### Schema de banco (additions)

```sql
-- Liga PRs/branches a tasks (n:n via task_pr_links)
create table task_pr_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  repo_full_name text not null,           -- "perke/volund"
  pr_number int,                          -- null se ainda só branch
  branch_name text not null,
  link_type text not null,                -- 'closes' | 'refs'
  pr_state text,                          -- 'open' | 'merged' | 'closed' | 'reverted'
  merged_at timestamptz,
  merge_commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repo_full_name, pr_number, task_id)
);

-- Log auditável de transições
create table task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  event_type text not null,               -- 'state_change' | 'pr_opened' | 'pr_merged' | 'reverted' | 'comment'
  from_state text,
  to_state text,
  source text not null,                   -- 'github_app' | 'pm' | 'alpha' | 'system'
  payload jsonb,                          -- raw webhook ou contexto humano
  actor_id uuid references members(id),   -- null se vier de bot
  created_at timestamptz not null default now()
);

create index task_events_task_id_created_at_idx on task_events (task_id, created_at desc);
```

Mudança em `tasks`: adicionar `state` enum-like se ainda não existir, e `mergedAt timestamptz` pra cycle time.

### Endpoints do Zordon (novos)

| Método | Path | Uso |
|---|---|---|
| `POST` | `/api/github/webhook` | Recebe webhooks do GitHub App, valida HMAC, despacha pro `TaskTransitionService` |
| `GET` | `/api/tasks/:id/timeline` | Retorna `task_events` ordenado pra UI mostrar histórico |
| `POST` | `/api/tasks/:id/manual-state` | Override manual do PM (com motivo, registrado em `task_events`) |

### Fluxo end-to-end (caso feliz)

```
1. Dev:  git checkout -b feat/ZRD-142-skill-filter
   Push.
   ─→ GitHub App recebe `push`, parseia branch name, vê `ZRD-142`.
   ─→ Zordon: tasks.state = 'In Progress', task_events row criado.

2. Dev:  commits livres (sem ID, sem ritual).
   Push.
   ─→ GitHub App ignora (branch já linkada, nada muda).

3. Dev:  gh pr create
   ─→ GitHub App `pull_request.opened`. Lê branch name + body.
   ─→ Se body não tem `Closes: ZRD-142`, App injeta no body via API.
   ─→ Zordon: state = 'In Review', task_pr_links row criado com pr_number.
   ─→ App posta comentário no PR: "🔗 Linked to task ZRD-142 — [link]"

4. Reviewer aprova. Dev faz squash merge.
   ─→ GitHub App `pull_request.closed` com merged=true.
   ─→ Lê body: `Closes: ZRD-142`.
   ─→ Zordon: tasks.state = 'Done', mergedAt = now,
              task_pr_links.pr_state = 'merged', merge_commit_sha gravado.
   ─→ task_events row de tipo 'pr_merged'.

5. Alpha (em qualquer chat):
   ─→ Lê task_events recentes do projeto.
   ─→ Sabe que ZRD-142 foi mergeada em <sha>, em <horário>.
   ─→ Pode responder "ZRD-142 saiu hoje" sem alucinar.
```

## Casos de borda

| Caso | Tratamento |
|---|---|
| **Branch sem ID** (`feat/quick-fix`) | App posta comentário no PR pedindo `Closes: ZRD-NNN` no body. Bloqueia merge via status check até resolver. |
| **PR fecha múltiplas tasks** | `Closes: ZRD-142, ZRD-143` no body. App fecha as duas no merge. |
| **PR toca task mas não fecha** | `Refs: ZRD-200` em vez de `Closes:`. Cria link mas não muda estado. |
| **Hotfix sem task prévia** | Branch `hotfix/ZRD-NEW-fix-prod-crash`. App cria task `hotfix` no merge, com título inferido do PR e linkada ao commit. |
| **Spike sem task** | Branch `spike/ZRD-NEW-...`. App cria task `spike` opcionalmente (toggleable em `.zordon.json`). |
| **Squash merge** | Body do PR é a fonte da verdade. App não depende de commits internos sumirem. |
| **Merge commit (não squash)** | Mesmo fluxo; App lê body do PR. |
| **Revert de merge** | App detecta `Revert "..."` em commit em main. Reabre task pra estado anterior, com `task_event` `reverted`. |
| **PR fechado sem merge** | `pull_request.closed` com merged=false. Move task de `In Review` → `To Do` (não `Done`). |
| **Branch renomeada** | `pull_request.edited` com mudança de `head.ref`. App re-parseia. |
| **PR cross-repo** (fork) | Mesmo fluxo. Links guardam `repo_full_name`. |
| **Task ID inválido** (ZRD-9999 não existe) | App rejeita, posta comentário no PR avisando. |
| **Repo sem `.zordon.json`** | App ignora silenciosamente. Opt-in explícito. |

## Configuração por repo

`.zordon.json` na raiz:

```json
{
  "projectId": "uuid-do-projeto-no-zordon",
  "trackerUrl": "https://zordon.perke.com",
  "branchPattern": "^(feat|fix|chore|refactor|docs|test|spike|hotfix)/(ZRD-(NEW|\\d+))-[a-z0-9-]+$",
  "createTaskOnSpike": false,
  "blockMergeWithoutTaskId": true,
  "autoInjectPrTemplate": true
}
```

Comitado no repo, auditável em PR. Mudança = PR review.

## CLI opcional: `npx @zordon/cli init`

Pra reduzir setup ainda mais (fase 2):

```
$ npx @zordon/cli init
? Project ID (busca no Zordon): › agent-ops
? Bloquear merge sem task ID? (Y/n) › Y
? Criar task auto em spike? (y/N) › N
✔ .zordon.json criado
✔ .husky/prepare-commit-msg adicionado (valida branch name no commit)
✔ Commitando hooks no repo
```

CLI fino: só escreve config + hook que chama `npx @zordon/cli check-branch`. Lógica vive central, atualiza com `npx`.

## Métricas de fluxo (subproduto)

Expostas no nível **squad/sprint**, nunca per-dev público:

| Métrica | Definição | Pra quê |
|---|---|---|
| Cycle time | `mergedAt - inProgressAt`, p50 e p90 | Saúde do fluxo |
| Throughput | tasks `Done` / sprint, por tipo | Capacidade real |
| WIP | tasks em `In Progress` ou `In Review` no momento | Detecta gargalo |
| Idade média de PR aberto | hoje - prOpenedAt para PRs `In Review` | Detecta review parado |
| Taxa de revert | `Reverted` / `Done` last 30d | Qualidade |
| Tasks órfãs | tasks `Done` no Zordon sem nenhum `task_pr_link` | Detecta drift convenção |

PM tem dashboard. Diretoria vê resumo por sprint. Ninguém vê "João fechou X tasks essa semana".

## Faseamento

### MVP-0 — webhook básico (1 semana)

- GitHub App com perms mínimas, instalado só em `perke/volund` primeiro
- Endpoint `/api/github/webhook` com HMAC + handler de `pull_request.closed`
- Schema `task_pr_links` + `task_events`
- Parser de branch name + body do PR (regex simples)
- Fecha task no merge se branch tem `ZRD-NNN`. Outros eventos ignorados.
- **Critério de saída**: 5 PRs reais mergeados no `volund` fecham task no Zordon sem intervenção.

### MVP-1 — convenção completa (2 semanas)

- Eventos `pull_request.opened` (move pra In Review) + `push` em branch nova (move pra In Progress)
- Auto-inject de template no PR body
- Status check bloqueando merge sem task ID (com bypass via label `no-task` pra PMs)
- Detecção de revert
- Suporte a `Refs:` (não-fechante)
- `.zordon.json` per-repo
- Instalação do App em mais 2-3 repos do Zordon
- **Critério de saída**: 80% dos PRs em todos os repos onboardados têm linkagem automática; PM não move card no Zordon manualmente.

### MVP-2 — métricas + CLI (3 semanas)

- Dashboard de fluxo no Zordon (cycle time, throughput, WIP, idade de PR)
- `@zordon/cli init` publicado no npm interno
- `task_events` exposto na timeline de cada task na UI
- Alpha consome `task_events` no contexto (substitui parte do Roam-parsing)
- **Critério de saída**: Alpha responde "qual o status de ZRD-X?" sem ler transcript em 90% dos casos.

### Fase 3 — futuro (não incluso neste plano)

- Estado `Deployed` via webhook de CI/CD
- GitHub App detecta `Co-Authored-By:` pra atribuir crédito a múltiplos devs (sem virar métrica individual)
- Reconciliação automática Alpha vs commit (transcript diz "fechei X" mas não há merge → flag pro PM)
- Release notes auto-geradas de tasks `Done` desde último deploy

## Riscos & mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Devs ignoram convenção de branch | Alta | Alto | Status check bloqueante + auto-injection. Fricção em desviar > fricção em seguir. |
| Convenção vira métrica de avaliação individual e degrada cultura | Média | Crítico | Política explícita escrita no doc; dashboards só de squad; sem export per-dev. |
| GitHub App fica fora do ar e perde eventos | Baixa | Médio | GitHub re-entrega webhooks por ~72h. Endpoint idempotente (chave: `delivery_id`). |
| Repo legado não consegue adotar | Média | Baixo | App é opt-in via `.zordon.json`. Repos sem config são ignorados. |
| Spam de tasks `ZRD-NEW` em hotfixes | Baixa | Baixo | Toggle `createTaskOnSpike` + revisão semanal de tasks `spike`/`hotfix` órfãs. |
| Squash merge esconde co-autoria | Baixa | Baixo | App lê `Co-Authored-By:` no body do squash commit. Não é prioridade pro MVP. |
| Branch name com typo no ID (ZRD-1422 em vez de 142) | Média | Médio | App valida que ID existe no Zordon antes de fechar; comenta no PR se inválido. |
| Drift de convenção entre repos | Baixa | Médio | CLI central + `.zordon.json` esquematizado; CI valida o arquivo. |

## Decisões em aberto

- [ ] Bloquear merge sem task ID por default, ou opt-in por repo? (proposta: default Y, com bypass via label `no-task`)
- [ ] Quem cria a task em `ZRD-NEW`? GitHub App auto-cria, ou App apenas comenta pedindo PM criar manualmente? (proposta: auto-criar com tipo `spike`/`hotfix` e flag `needs_review`)
- [ ] Estado `In Progress` dispara em `push` da branch ou em `pull_request.opened`? (proposta: `push`, pra refletir que o trabalho começou mesmo antes do PR)
- [ ] Notificação no Slack quando task entra em `In Review`? (fora do escopo MVP, fácil adicionar depois)
- [ ] CLI vale a pena pra fase 1 ou só fase 2? (proposta: fase 2 — convenção sozinha já resolve 80%)

## Critérios de sucesso

1. PM da Volund nunca mais move card de "In Progress" pra "Done" manualmente em projeto onboardado.
2. Alpha responde 90% das perguntas de status de task sem precisar ler transcript Roam.
3. Onboarding de repo novo na esteira leva < 10 minutos (criar `.zordon.json`, instalar App, fim).
4. Dashboard de fluxo é olhado em retro de sprint — vira ferramenta do time, não relatório morto.
5. Zero casos de uso da métrica individual em conversa de avaliação. Se isso vazar, a esteira morre.

## Referências

- DORA metrics: deployment frequency, lead time, change failure rate, MTTR — pra inspiração nas métricas de fluxo
- SPACE framework (Microsoft Research) — argumento forte contra medição individual
- GitHub Apps docs: `node_modules/...` (verificar versão antes de implementar)
- Plano de Super Planning ([memory project_super_planning.md](memory)) — fluxo upstream que cria as tasks que essa esteira fecha
