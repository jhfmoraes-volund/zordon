# 09 — Audit Protocol (V1)

Como o orchestrator `/task-gen-audit` se comunica com `module-auditor`s e `cross-auditor`.

Análogo ao [07-orchestration-protocol.md](07-orchestration-protocol.md) — mesma filosofia (HINT YAML in, RESUMO YAML out), aplicada a auditoria read-only em vez de geração.

## Modelo

```
┌──────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR — main agent                                    │
│  • Lê snapshot DS + mapping yaml                             │
│  • Resolve plan (módulos a auditar)                          │
│  • Despacha N module-auditors EM PARALELO (1 mensagem,       │
│    múltiplos Agent calls)                                    │
│  • Aguarda todos retornarem RESUMO YAML                      │
│  • Agrega evidência (schemas/endpoints/components)           │
│  • Despacha 1 cross-auditor com a agregação                  │
│  • Sintetiza relatório consolidado                           │
└──────────────────────────────────────────────────────────────┘
   │                                          │
   ▼ paralelo (até 8 agents fresh)           ▼ sequencial (depois)
┌──────────────────┐  ┌──────────────────┐    ┌──────────────────┐
│ module-auditor   │  │ module-auditor   │... │ cross-auditor    │
│ MODULE: A        │  │ MODULE: B        │    │  • input: 8 YAMLs│
│  • A+B+C         │  │  • A+B+C         │    │  • input: queries│
│  • escreve audit │  │  • escreve audit │    │  • escreve audit │
│  • retorna YAML  │  │  • retorna YAML  │    │  • retorna YAML  │
└──────────────────┘  └──────────────────┘    └──────────────────┘
```

## Marker

Os agents auditores detectam o marker `zelar_auditor: true` no hint pra:
1. Pular qualquer interação manual (auditoria é totalmente automática)
2. Emitir RESUMO YAML como output final (sem decoração)
3. Aplicar regras de [08-audit-rules.md](08-audit-rules.md) em vez de gerar tasks

## Hint do orchestrator → module-auditor

YAML único, passado como prompt do `Agent`:

```yaml
# === IDENTIDADE ===
role: module-auditor
target_module: ONBOARDING            # obrigatório
project_id: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
ds_session_id: 264e6d07-d365-43ba-8029-d539ce6f7c6b

# === MAPPING (do 06-brainstorm-module-mapping.yaml) ===
brainstorm_hints_for_module: [CADASTRO, LOGIN, ONBOARDING, LGPD]
feature_overrides_for_module: []     # filtrado do mapping pra esse módulo

# === REGRAS APLICÁVEIS ===
audit_dimensions: [A, B, C]          # cross só corre depois

audit_date: "2026-05-10"             # pra path do relatório
audit_output_path: "docs/task-gen/projects/zelar/audits/20260510_ONBOARDING_audit.md"

# === MARKER ===
zelar_auditor: true

# === INSTRUÇÕES ===
instructions: |
  Você é auditor read-only de 1 módulo Zelar v2.
  Lê APENAS — zero INSERT/UPDATE/DELETE no banco.

  Carregue (na ordem):
  1. docs/task-gen/08-audit-rules.md — regras A/B/C
  2. docs/task-gen/projects/zelar/06-brainstorm-module-mapping.yaml — mapping
  3. (referência) docs/task-gen/01-task-generation-rules.md
  4. (referência) docs/task-gen/02-quality-checklist.md

  Carregue env DIRECT_URL via Read tool em .env (NÃO via source/grep com
  sub-shell — usar valor literal inline em cada psql).

  Rode SELECTs das dimensões A, B, C conforme 08-audit-rules.md.
  Ao final, ESCREVA o relatório markdown em audit_output_path.

  IMPORTANTE — saída:
  - NÃO descreva trabalho intermediário no chat
  - NÃO emita texto narrativo
  - Retorne APENAS o RESUMO YAML estruturado abaixo
  - Se erro técnico, retorne status: aborted_error + flags_or_concerns
```

## Resumo de saída (module-auditor → orchestrator)

YAML único:

```yaml
module: ONBOARDING
status: completed                    # completed | aborted_error
audit_file: docs/task-gen/projects/zelar/audits/20260510_ONBOARDING_audit.md

stats:
  stories: 5
  ac_total: 48
  tasks: 58
  ac_da_task: 412
  brainstorm_features_mapped: 12

# === FINDINGS POR DIMENSÃO ===
findings:
  A:                                 # cobertura brainstorm
    covered: 11
    partial: 1
    missing: 0
    high: 0
    medium: 1
  B:                                 # coerência interna
    high: 1                          # ex: AC sem cobertura persona≠SISTEMA
    medium: 5
    low: 8
    sub_issues:
      B1_dup_ac_pairs: 2
      B2_ac_uncovered: 1
      B3_orphan_tasks: 0
      B4_dup_tasks: 1
      B5_schema_gaps: 0
      B6_data_api_no_rls: 0
      B6_no_checklist: 0
      B6_critério_pronto: 0
      B7_race_no_idempotency: 1
  C:                                 # qualidade AC-da-Task
    high: 0
    medium: 8
    low: 12
    sub_issues:
      C1_no_checklist: 0
      C2_unverifiable: 5
      C3_too_long: 3
      C4_dup_with_story_ac: 0
      C5_procrastinating: 0
      C6_placeholder: 0
      C7_rls_uncovered: 2
      C8_idempotency_uncovered: 1
      C9_race_uncovered: 0

# === EVIDÊNCIA pro cross-auditor ===
schemas_referenced:
  - { name: provider_profiles, in_stories: [US-001, US-007] }
  - { name: lgpd_consents, in_stories: [US-001] }
  - { name: auth_failed_attempts, in_stories: [US-008] }

endpoints_referenced:
  - { path: "POST /api/onboarding/provider/signup", in_story: US-001 }
  - { path: "POST /api/auth/magic-link", in_story: US-008 }

components_referenced:
  - { name: SignupWizard, in_story: US-001, role: created }
  - { name: LogoutButton, in_story: US-007, role: reused_from_us: US-002 }

# === SINAIS PRO CROSS-AUDITOR ===
unmapped_brainstorm_features: []     # features que mapping pôs no módulo
                                     # mas auditor classificou missing/orphan
cross_module_concerns:               # itens que MERECEM cruzamento
  - "Schema 'service_categories' citado em US-007 mas spec deve estar em SOLICITACAO"

flags_or_concerns: []                # mensagens de erro/abort se status != completed
```

### Status possíveis

- **`completed`** — auditoria concluída, relatório escrito
- **`aborted_error`** — psql falhou, schema não bate, mapping inválido — `flags_or_concerns` traz detalhe

## Hint do orchestrator → cross-auditor

```yaml
# === IDENTIDADE ===
role: cross-auditor
project_id: e41c492e-7a14-44b2-83b9-b8e0f2b38e4c
ds_session_id: 264e6d07-d365-43ba-8029-d539ce6f7c6b

audit_date: "2026-05-10"
audit_output_path: "docs/task-gen/projects/zelar/audits/20260510_consolidated_audit.md"

# === EVIDÊNCIA AGREGADA (do orchestrator) ===
modules_audited:
  - module: ONBOARDING
    audit_file: docs/task-gen/projects/zelar/audits/20260510_ONBOARDING_audit.md
    yaml_summary: <inline YAML do module-auditor>
  - module: EXECUCAO
    ...

# Pre-agregação que o orchestrator fez:
schemas_by_name:                     # de-duplicado, com origem
  provider_profiles:
    cited_in:
      - { module: ONBOARDING, story: US-001 }
      - { module: ONBOARDING, story: US-007 }
      - { module: PERFIL, story: US-007 }   # multi-módulo!
  service_requests:
    cited_in:
      - { module: EXECUCAO, story: US-004 }
      - { module: SOLICITACAO, story: US-010 }
      - { module: MATCHING, story: US-020 }
  ...

endpoints_by_path:
  "POST /api/services/cancel":
    cited_in:
      - { module: EXECUCAO, story: US-006 }
      - { module: ADMIN, story: US-019 }
  ...

components_by_name:
  SignupWizard:
    cited_in:
      - { module: ONBOARDING, story: US-001, role: created }
  LogoutButton:
    cited_in:
      - { module: ONBOARDING, story: US-007, role: reused_from_us: US-002 }
      - { module: ONBOARDING, story: US-002, role: created }
  ...

unmapped_features_aggregated: []     # union de unmapped_brainstorm_features
                                     # de todos os módulos

# === REGRAS APLICÁVEIS ===
audit_dimensions: [X1, X2, X3, X4, X5, X6]

# === MARKER ===
zelar_auditor: true

# === INSTRUÇÕES ===
instructions: |
  Você é cross-auditor. NÃO re-audita módulos.
  
  Recebe evidência destilada dos N module-auditors. Aplica os 6 padrões
  X1-X6 conforme docs/task-gen/08-audit-rules.md §X.
  
  Use psql APENAS pra X.6 (deps cross-module — única query SQL deste agent).
  
  Carregue env DIRECT_URL via Read tool em .env.
  
  Escreva relatório em audit_output_path com:
  - Resumo executivo (totais agregados)
  - Findings cross-module X1-X6 com evidência
  - Tabela-resumo por módulo (do 08-audit-rules.md)
  - Recomendações priorizadas (ALTO/MÉDIO/BAIXO)
  
  Retorne RESUMO YAML.
```

## Resumo de saída (cross-auditor → orchestrator)

```yaml
status: completed                    # completed | aborted_error
audit_file: docs/task-gen/projects/zelar/audits/20260510_consolidated_audit.md

cross_findings:
  X1_schemas_cross_no_dep:
    high: 0
    medium: 2
    items:
      - { schema: provider_profiles, modules: [ONBOARDING, PERFIL], severity: medium }
      - { schema: service_requests, modules: [EXECUCAO, SOLICITACAO, MATCHING], severity: medium }
  X2_components_inconsistent:
    medium: 0
    low: 1
  X3_endpoints_duplicated:
    high: 1
    items:
      - { path: "POST /api/services/cancel", modules: [EXECUCAO, ADMIN], severity: high }
  X4_persona_inconsistent:
    high: 0
  X5_brainstorm_ambiguous:
    medium: 0
  X6_deps_cross_module:
    info: 12
    medium: 1
    items:
      - { from: "EXECUCAO/T-105", to: "MATCHING/T-067", kind: blocks, severity: medium }

# === TABELA RESUMO ===
module_summary:
  - { module: ONBOARDING, ac_covered: 11, ac_partial: 1, ac_missing: 0, b_high: 1, b_med: 5, c_high: 0, c_med: 8, total_high: 1 }
  - { module: EXECUCAO, ... }

# === TOTAIS GLOBAIS ===
totals:
  modules: 8
  total_high: 4
  total_medium: 32
  total_low: 47

flags_or_concerns: []
```

## Como o orchestrator parseia

Igual ao 07: extrai campos por regex/instrução. O que importa:

- `status` por agent (binário pra continuar ou abortar)
- `findings.{A,B,C}.{high,medium,low}` (estatística cumulativa)
- `schemas_referenced` / `endpoints_referenced` / `components_referenced` (insumo do cross-auditor)
- `unmapped_brainstorm_features` (sinal pro cross-auditor)
- `cross_module_concerns` (insumo pro cross-auditor)

## Tamanho típico

| Item | Tokens |
|---|---|
| Hint module-auditor | ~1000 |
| RESUMO module-auditor | ~600-1000 |
| Hint cross-auditor (com evidência agregada de 8) | ~3500 |
| RESUMO cross-auditor | ~700 |

Comparado a auditoria sequencial inline (~30k tok/módulo): paralelizar 8 module-auditors = ~30k tok cada (paralelo, fresh-context), main mantém ~20k de estado. Cross-auditor adiciona ~5k. Total no main agent ~25-30k vs ~240k+ se tudo inline.

## Decisões fixas

- Paralelismo dos module-auditors: usa `Agent` com múltiplos calls em uma única mensagem (ver Agent tool docs)
- Cross-auditor é sequencial (vem depois)
- Sem retry automático; falha de qualquer module-auditor = orchestrator continua com os que retornaram, marca o falho como `aborted` no consolidado
- Sem persistência de estado: tudo em memória do orchestrator
