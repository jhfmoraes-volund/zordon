# 07 — Protocolo de Orquestração (V3)

Como o orquestrador `/task-gen-orchestrate` se comunica com subagents que geram tasks por US.

## Modelo

```
┌──────────────────────────────────────────────────────────────┐
│ ORQUESTRADOR — main agent (sessão Claude)                    │
│  • Carrega docs task-gen + snapshot DS uma vez               │
│  • Estado: plan, processed, generalizations, reusable_pool   │
│  • Decisão por US: inline (US 1..N) ou subagent (US N+1..)   │
└──────────────────────────────────────────────────────────────┘
   │                                      │
   ▼ inline (early US)                   ▼ subagent (later US)
┌──────────────────┐                ┌────────────────────────┐
│ /zelar-story-    │                │ Agent(general-purpose) │
│ tasks no main    │                │  • Contexto fresh      │
│ ~30k tokens      │                │  • Recebe HINT YAML    │
│                  │                │  • Roda skill stand-   │
│                  │                │    alone com marker    │
│                  │                │  • Retorna RESUMO YAML │
└──────────────────┘                └────────────────────────┘
                                              │
                                              ▼
                                     resumo (~800 tok)
                                     → main acumula em state
```

A partir da `inline_budget`-ésima US (default 2), o orquestrador para de gerar
tasks no próprio contexto e passa a despachar via `Agent`. Isso é a
"compactação": não comprime mensagens passadas — descarrega trabalho pesado
para subagent fresh, mantendo só resumos no main.

## Hint de entrada (orquestrador → subagent)

YAML único, passado como prompt completo do `Agent`. Campos obrigatórios e
opcionais:

```yaml
# === IDENTIDADE ===
target_us: ZLAR-V2-US-NNN              # obrigatório
project_id: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
ds_session_id: 264e6d07-d365-43ba-8029-d539ce6f7c6b
module: ONBOARDING                     # módulo da target_us

# === CONTEXTO ACUMULADO ===
prior_us_in_module:
  - ref: ZLAR-V2-US-001
    layers_touched: [DATA, API, UI, OPS]
    task_count: 12
    schemas_created: [provider_profiles, provider_categories, lgpd_consents]
    endpoints_created: ["POST /api/onboarding/provider/signup", "..."]
    components_created: [SignupWizard, KycFlow]
  - ref: ZLAR-V2-US-002
    layers_touched: [DATA, API, UI]
    task_count: 12
    schemas_created: [provider_account_status enum, view provider_onboarding_state]
    endpoints_created: ["POST /api/auth/provider/login", "..."]

generalizations_detected:
  - "Splash CLIENTE/PRESTADOR extraída em T-055 — usar /(public)/splash"
  - "Magic link genérico em T-051 (personaScope=ANY)"
  - "Captcha + auth_failed_attempts em T-047 — qualquer endpoint de auth pode reusar"

reusable_tasks_cross_us:
  - { ref: ZLAR-V2-T-019, purpose: "proxy guard por estado de conta" }
  - { ref: ZLAR-V2-T-024, purpose: "LogoutButton + invalidação server-side" }
  - { ref: ZLAR-V2-T-022, purpose: "pattern visual de tela bloqueante (KYC reprovado)" }

# === SEQUÊNCIA ===
next_task_reference: ZLAR-V2-T-NNN     # primeiro número livre que o subagent
                                       # deve usar no INSERT (ex: T-059)

# === MARKER (CRÍTICO) ===
zelar_orchestrator: true               # diz à skill /task-gen-story que está
                                       # rodando dentro de orquestração — saída
                                       # deve ser RESUMO YAML estruturado, não
                                       # reporte verbose

# === INSTRUÇÕES ===
instructions: |
  Você é gerador autônomo de tasks Zelar v2. Você NÃO viu a conversa do
  orquestrador — só este hint.

  Ações:
  1. Leia docs/task-gen/01..04 (todos)
  2. Rode etapas 0-9 da skill /task-gen-story para target_us:
     - Etapa 0: snapshot DS
     - Etapa 2: contexto da story + tasks cross-US
     - Etapas 3-5: mapear AC→camadas, identificar reuso, gerar draft
     - Etapa 8: escrever migration SQL e aplicar via psql
     - Etapa 9: rodar 6 queries de validação
  3. Considere generalizations_detected ao decidir extrações/reuso
  4. Considere reusable_tasks_cross_us ao decidir TaskDependency relates_to
  5. Use next_task_reference como ponto de partida

  IMPORTANTE — saída:
  - NÃO descreva o trabalho intermediário
  - NÃO imprima descrição de cada task gerada
  - Retorne APENAS o RESUMO YAML estruturado (formato em
    docs/task-gen/07-orchestration-protocol.md §"Resumo de saída")
  - Se validação falhar, retorne com status: aborted_validation + detalhe
  - Se erro técnico, retorne status: aborted_error + erro

  Tudo persistido via arquivo SQL em docs/task-gen/projects/zelar/backlog-sql/ (NÃO em
  supabase/migrations/ — esse SQL só insere metadata em tabelas internas
  do Zordon, não é migration de schema de produto). Status das tasks =
  'draft'. Convenções dos docs vencem sobre seu conhecimento prévio.
```

### Notas sobre o hint

- `prior_us_in_module` cresce a cada iteração — main acumula. Pode ser
  truncado pra last-N (default last-3) se ficar grande, mas como cada entry
  são ~150 tokens, 8 US dão ~1200 tokens — sem problema até o módulo todo.
- `generalizations_detected` é o canal pelo qual o main "ensina" o subagent.
  Se main não passa, subagent não sabe — então capturar bem é crucial.
- `reusable_tasks_cross_us` lista refs de tasks específicas que outras US
  devem mencionar como `relates_to` (não `blocks` — generalizações não
  bloqueiam, só dialogam).

## Resumo de saída (subagent → orquestrador)

YAML único, retornado como `result` do `Agent`. Main parseia e acumula.

```yaml
us_ref: ZLAR-V2-US-NNN
status: completed                       # completed | aborted_validation | aborted_error
backlog_sql_file: docs/task-gen/projects/zelar/backlog-sql/YYYYMMDD_zordon_backlog_usNNN.sql

task_count_by_layer:
  DATA: 4
  API: 6
  REALTIME: 0
  UI: 4
  OPS: 0
  total: 14

ac_coverage:
  total: 9
  covered: 9
  gaps: []                              # AC orders sem cobertura mínima

checklist_items: 99                     # AC-da-Task (AcceptanceCriterion taskId)
deps:
  blocks: 17
  relates_to: 12

# === O QUE A US PRODUZIU (alimenta hint da próxima) ===
schemas_created:
  - "client_profiles (tabela)"
  - "client_addresses (tabela)"
  - "auth_failed_attempts (tabela genérica)"
  - "view client_onboarding_state"
  - "enum suspension_category (5 valores)"

endpoints_created:
  - "POST /api/onboarding/client/signup"
  - "PATCH /api/onboarding/client/step"
  - "POST /api/auth/magic-link (genérico)"
  - "POST /api/auth/client/login (com captcha)"

components_created:
  - "SplashSelector (rota pública)"
  - "ClientWizard (4 steps)"
  - "ClientLogin (3 caminhos + captcha)"

# === SINAIS PRA O ORQUESTRADOR ===
new_generalizations:
  - "Splash CLIENTE/PRESTADOR extraída pra rota pública em T-055"
  - "Magic link genérico em T-051"

reuse_taken:
  - "T-024 LogoutButton — usado direto no menu CLIENTE"
  - "T-022 pattern visual — referência pra telas bloqueantes"

flags_or_concerns: []                   # findings que main deveria ver:
                                        # - AC sem cobertura intencional
                                        # - decisão controversa
                                        # - bloqueio detectado (e.g. tabela
                                        #   esperada de outra US ainda não criada)

next_task_ref_after: ZLAR-V2-T-058      # último ref usado, pra próxima US
                                        # começar em T-059
```

### Status possíveis

- **`completed`** — todas as 6 validações passaram, persistência OK
- **`aborted_validation`** — alguma das 6 queries de validação retornou linha
  problemática; o INSERT de metadata foi aplicado (transaction COMMIT) ou
  revertido (depende de qual validação) — campo `flags_or_concerns` detalha
- **`aborted_error`** — erro técnico (psql falhou, schema não bate, etc);
  campo `flags_or_concerns` traz a mensagem de erro

Em qualquer caso, main **decide se continua** (skip + segue), **aborta o
loop** ou **flagga pro usuário**. Default: parar e flaggar em qualquer não-
`completed` (loop foca em qualidade, não em força bruta).

## Como o orquestrador parseia

YAML é parseado linha-a-linha (regex simples) ou por instrução pro Claude
ler campos específicos. Não precisa parser formal: o que importa pra main é:

- `status` (binário pra decisão de continuar)
- `task_count_by_layer.total` (estatística cumulativa)
- `ac_coverage.gaps` (alerta se >0)
- `next_task_ref_after` (input da próxima)
- `new_generalizations` (acumula em `generalizations_detected`)
- `schemas_created` / `endpoints_created` / `components_created`
  (acumula em `prior_us_in_module[i]`)
- `reuse_taken` + `flags_or_concerns` (informa decisão de continuar)

## Marker `zelar_orchestrator: true`

A skill `/task-gen-story` detecta a presença desse campo na invocação:

- **Sem marker** (uso normal): comportamento atual — relatório markdown
  verbose na etapa 10 (cobertura, contagens, sugestões).
- **Com marker** (rodando dentro de subagent orquestrado): etapa 10 emite
  exclusivamente o RESUMO YAML acima — sem texto narrativo, sem decoração.

Implementação: skill checa primeira linha do prompt por `zelar_orchestrator:
true` ou flag `--orchestrator-output`.

## Tamanho típico

| Item | Tokens |
|---|---|
| Hint inicial (1ª US via subagent) | ~1500 |
| Hint após 4 US (acumula generalizations + prior_us) | ~3000 |
| Resumo de saída por US | ~600-900 |
| Estado interno do main (após 8 US) | ~12000 |

Comparado ao baseline (geração inline): ~30k tokens/US no main agent. Com
orquestração v3: ~30k até a 2ª US, depois ~900 tok/US. Diferença é dramática
a partir da 4ª US.
