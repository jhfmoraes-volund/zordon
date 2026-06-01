# PRD — Zordon MCP Polish & DX

**Reference**: ZMC-DX
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Depende de**: prd-zordon-mcp-extract, prd-chat-via-claude-daemon, prd-zordon-mcp-server (todos shippados)

## §1 Problema

1. Pra escalar do João pro time, daemon precisa de **DX** competitivo com SaaS reais: auto-start no boot, telemetria visível, troubleshooting rápido.
2. Sync de tipos hoje é manual (`npm run sync:mcp-types`) — esquece, dá deriva entre Zordon e zordon-mcp.
3. Sem métricas de latência/custo por modo (claude-daemon vs openrouter), decisão de produto fica achismo.
4. README atual do zordon-mcp é mínimo. PM novo vai sofrer no setup.

## §2 Solução em uma frase

Polish do daemon: auto-start (LaunchAgent), self-test (`zordon-mcp test`), telemetria comparativa por modo, sync de tipos via GitHub Action, docs completos + screencast.

## §3 Não-objetivos

- Auto-update do daemon (`git pull` continua manual nesta fase).
- Migração pra npm publish (vira PRD própria depois de estabilizar).
- Dashboard de telemetria custom — usa Grafana/Logflare existente.
- Daemon central no servidor (mantém local-only).

## §4 Personas e jornada

- **PM novo**: "Quero rodar o quickstart e ter daemon ativo em <5min, sem ler 40 páginas de doc."
- **João (Volund)**: "Quero saber semanalmente: quantos % dos chats foram via claude-daemon, custo Volund evitado, daemons únicos ativos."
- **Builder Zordon**: "Quero CI travar quando shape de evento muda e zordon-mcp não foi atualizado."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | `zordon-mcp install-service` instala LaunchAgent (macOS) que roda daemon no login | Padrão macOS pra background services. Linux fica fora desta fase. |
| D2 | `zordon-mcp test` faz smoke completo em ~30s (auth + claim mock + spawn claude + emit + complete) | Onboarding feedback rápido + suporte ("rode `zordon-mcp test` e me mande output"). |
| D3 | GitHub Action `sync-mcp-types` rodando no Zordon: quando shape muda, abre PR no zordon-mcp | Sem deriva manual. PR é manual-merge pra dar review chance. |
| D4 | Telemetria via tabela existente `ChatTurn` (já tem tokensIn/Out/costUsd) — sem nova tabela | Reusa. Queries SQL nos métricas §13. |
| D5 | View materializada `chat_mode_metrics` (refresh diária via cron) pra dashboard | Avoid query pesada em prod. |
| D6 | README com 7 seções fixas: Quickstart, Comandos, Auth, Workspace, Troubleshooting, Update, Contributing | Estrutura previsível. PM acha o que precisa. |
| D7 | Screencast hospedado em YouTube unlisted (link em README) | Não bloqueia release; opcional pra PM visual. |
| D8 | Daemon version reportada em header `X-Daemon-Version` em todo request; Zordon log warn se mismatch > 1 major | Detecta daemon outdated automaticamente. |
| D9 | `zordon-mcp doctor` — diagnostic completo (auth + claude CLI + gh CLI + git + diskspace) | Pra quando PM diz "não funciona". |

## §6 Arquitetura

```
[Zordon webapp]
    │
    ├─ GitHub Action sync-mcp-types
    │    └─► detecta diff em src/types/* e bin/sync-mcp-types output
    │        └─► PR no zordon-mcp com types atualizados
    │
    └─ View materializada chat_mode_metrics
         └─► /admin/metrics — dashboard

[zordon-mcp]
    │
    ├─ bin/zordon-mcp install-service
    │    └─► escreve ~/Library/LaunchAgents/com.volund.zordon-mcp.plist
    │        └─► launchctl load (auto-start no login)
    │
    ├─ bin/zordon-mcp test
    │    └─► 5 checks em sequência, exit 0 quando todos passam
    │
    ├─ bin/zordon-mcp doctor
    │    └─► auth + claude CLI + gh + git + disco + version check
    │
    └─ X-Daemon-Version em todo request → server compara com expected
```

## §7 Schema

```sql
-- View pra dashboard /admin/metrics
CREATE MATERIALIZED VIEW chat_mode_metrics AS
SELECT
  date_trunc('day', "createdAt") AS day,
  "agentSlug",
  "mode",
  count(*) AS turn_count,
  count(*) FILTER (WHERE "status" = 'done') AS done_count,
  count(*) FILTER (WHERE "status" = 'error') AS error_count,
  count(*) FILTER (WHERE "errorReason" = 'daemon_offline') AS fallback_count,
  sum("tokensIn") AS tokens_in,
  sum("tokensOut") AS tokens_out,
  sum("costUsd") AS cost_usd,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))) AS p50_seconds,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))) AS p95_seconds
FROM "ChatTurn"
WHERE "endedAt" IS NOT NULL
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX chat_mode_metrics_pk ON chat_mode_metrics(day, "agentSlug", "mode");

-- Refresh diário
SELECT cron.schedule('refresh_chat_mode_metrics', '0 3 * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY chat_mode_metrics$$);
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/admin/metrics/chat-mode` | Query: `?since=2026-05-01&agentSlug=vitor` → Returns: rows da view |
| GET | `/api/daemon/version-check` | Returns: `{minVersion, recommendedVersion}` (consultado pelo doctor) |

## §9 UX

### `/admin/metrics` (Zordon UI, só admin)

```
┌──────────────────────────────────────────────────────────────────┐
│ Chat mode metrics — últimos 30 dias                               │
│ ──────────────────────────────────────────────────────────────── │
│                                                                   │
│ Vitor                                                             │
│   claude-daemon   1.247 turns · 92% done · 8% fallback           │
│                    P50 1.8s · P95 4.2s · custo Volund: $0        │
│   openrouter        531 turns · 99% done · 0% fallback           │
│                    P50 0.9s · P95 2.1s · custo Volund: $34.20    │
│                                                                   │
│ Vitoria                                                           │
│   claude-daemon     201 turns ...                                 │
│                                                                   │
│ Total economizado (claude-daemon): $89.30                        │
└──────────────────────────────────────────────────────────────────┘
```

### CLI improvements

```
$ zordon-mcp doctor
✓ ~/.zordon-mcp/auth.json (chmod 600)
✓ claude CLI: v1.0.45 (logged in as joao@volund.com.br)
✓ gh CLI: v2.40.1 (logged in)
✓ git: v2.43.0
✓ TERRAFORMING_HOME: ~/zordon-terraforming/ (writable, 240GB free)
✓ Daemon version: 1.2.0 (matches server expectation)
✓ Heartbeat: 12s ago

All systems go.
```

## §10 Integrações

- **Forge UI**: dashboard `/admin/metrics` linkado do menu admin.
- **Onboarding doc** (`/settings/daemon`): adiciona link pra `zordon-mcp test` na primeira hora.
- **CI Zordon**: GitHub Action que dispara sync-mcp-types em PRs que tocam `src/lib/forge/runtime/event-kinds.ts`, etc.

## §11 Faseamento

Fase 4.1 — Self-test + doctor:
1. `zordon-mcp test` (smoke 5 checks)
2. `zordon-mcp doctor` (diagnostic)

Fase 4.2 — Auto-start:
3. `zordon-mcp install-service` (LaunchAgent macOS)

Fase 4.3 — Telemetria + sync:
4. View materializada + refresh cron
5. Endpoint /admin/metrics
6. Dashboard UI

Fase 4.4 — DX final:
7. README completo (7 seções)
8. Sync-mcp-types GitHub Action
9. X-Daemon-Version header + warn

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| LaunchAgent quebra em macOS update | M | M | Doctor detecta + reinstall recipe no README |
| GH Action sync abre dezenas de PRs spam | M | B | Action dedupes; só abre PR se diff > 0 e nenhum PR open |
| View materializada fica stale (>24h) | B | B | Refresh diária + flag last_refresh_at no dashboard |
| Métricas exposem custo Volund a admins não-trusted | B | M | RLS na rota /admin/metrics: só super-admin (access_level=admin) |
| Daemon-version-check vira hot-path lento | B | B | Cached 5min server-side |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Tempo setup PM novo (clone → daemon ativo) | Manual com 2 PMs piloto; target ≤5min |
| % daemons up-to-date (versão <= 1 minor old) | `SELECT count(*) FILTER(WHERE version >= '1.x') / count(*) FROM "ForgeDaemon" WHERE "lastHeartbeatAt" > now() - interval '1 day'` |
| Custo Volund poupado (estimativa) | View `chat_mode_metrics` — sum(tokens_in+tokens_out * OpenRouter price) WHERE mode='claude-daemon' |
| Fallback rate (proxy de saúde do daemon) | View `chat_mode_metrics` — `sum(fallback_count) / sum(turn_count)` últimos 7 dias; target <10% |

## §14 Open questions

(vazio)

## §15 Referências

- LaunchAgent docs: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/
- Memory `feedback_local_ssot.md` — local-as-SSOT já bate com filosofia do daemon.

## §16 Stories implementáveis

```yaml
- id: ZMC-DX-001
  title: zordon-mcp test — smoke completo
  description: 5 checks em sequência (auth ping, claim mock, spawn claude version, emit event, complete). Exit 0 se todos passam; mostra qual quebrou.
  acceptanceCriteria:
    - "zordon-mcp test passa em ambiente saudável"
    - "Failure num check para imediato com mensagem clara"
    - "Saída colorida (verde ✓ / vermelho ✗)"
  verifiable:
    - kind: manual_browser
      command_or_query: "cd ~/zordon-mcp && ./bin/zordon-mcp test"
      expected: "exit 0 + '5/5 checks passed'"
  dependsOn: []
  estimateMinutes: 25
  touches: ["zordon-mcp/scripts/commands/test.ts"]

- id: ZMC-DX-002
  title: zordon-mcp doctor — diagnostic
  description: Verifica auth.json, claude version, gh login, git version, TERRAFORMING_HOME writable, daemon-version-check API. Output formatado.
  acceptanceCriteria:
    - "doctor reporta cada check com ✓/✗"
    - "Resumo final 'All systems go' ou 'N issues found'"
    - "Exit 0 se tudo ok, 1 caso contrário"
  verifiable:
    - kind: manual_browser
      command_or_query: "./bin/zordon-mcp doctor"
      expected: "exit 0 em setup limpo"
  dependsOn: [ZMC-DX-001]
  estimateMinutes: 25
  touches: ["zordon-mcp/scripts/commands/doctor.ts"]

- id: ZMC-DX-003
  title: zordon-mcp install-service — LaunchAgent macOS
  description: Escreve ~/Library/LaunchAgents/com.volund.zordon-mcp.plist apontando pro daemon. launchctl load. Persiste no boot/login.
  acceptanceCriteria:
    - "plist existe após install-service"
    - "launchctl list mostra com.volund.zordon-mcp"
    - "Daemon roda no próximo login (validado com reboot simulado)"
    - "uninstall-service remove tudo"
  verifiable:
    - kind: manual_browser
      command_or_query: "./bin/zordon-mcp install-service && launchctl list | grep zordon-mcp"
      expected: "match em listing"
  dependsOn: []
  estimateMinutes: 30
  touches: ["zordon-mcp/scripts/commands/install-service.ts"]

- id: ZMC-DX-004
  title: View materializada chat_mode_metrics + refresh cron
  description: CREATE MATERIALIZED VIEW conforme §7. Cron job refresh diário 03:00.
  acceptanceCriteria:
    - "View criada e populada"
    - "Cron job agendado e executado ao menos uma vez"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name='chat_mode_metrics'"
      expected: "1"
    - kind: sql
      command_or_query: "SELECT count(*) FROM cron.job WHERE jobname='refresh_chat_mode_metrics'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: ZMC-DX-005
  title: Endpoint GET /api/admin/metrics/chat-mode
  description: Lê view materializada com filtros (since, until, agentSlug). RLS: só access_level=admin.
  acceptanceCriteria:
    - "GET valida access_level=admin (403 caso contrário)"
    - "Filtros aplicados via where clauses"
    - "Response shape conforme view"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-DX-004]
  estimateMinutes: 25
  touches: ["src/app/api/admin/metrics/chat-mode/route.ts"]

- id: ZMC-DX-006
  title: UI /admin/metrics — chat mode dashboard
  description: Página admin com tabela agrupada por agente, mostrando claude-daemon vs openrouter. Filtro de período.
  acceptanceCriteria:
    - "Página renderiza dados da API"
    - "Filtro de 7/30/90 dias funciona"
    - "Hidden pra non-admin (proxy.ts)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: [ZMC-DX-005]
  estimateMinutes: 30
  touches: ["src/app/(dashboard)/admin/metrics/page.tsx"]

- id: ZMC-DX-007
  title: README completo do zordon-mcp (7 seções)
  description: Quickstart, Commands, Auth, Workspace (TERRAFORMING_HOME), Troubleshooting, Update, Contributing. Code blocks testáveis.
  acceptanceCriteria:
    - "Seções 1-7 presentes"
    - "Quickstart cabe em <80 linhas"
    - "Troubleshooting cobre 5 erros mais comuns"
  verifiable:
    - kind: manual_browser
      command_or_query: "Ler README do zerinho seguindo Quickstart"
      expected: "PM novo consegue rodar daemon sem ajuda"
  dependsOn: []
  estimateMinutes: 30
  touches: ["zordon-mcp/README.md"]

- id: ZMC-DX-008
  title: GitHub Action sync-mcp-types
  description: Workflow no Zordon — quando muda src/lib/forge/runtime/event-kinds.ts ou tipos shared, dispara bin/sync-mcp-types.ts em PR mode e abre PR em volund-ia/zordon-mcp.
  acceptanceCriteria:
    - ".github/workflows/sync-mcp-types.yml existe"
    - "Trigger em path filter dos arquivos críticos"
    - "Action abre PR (dedupes se já existir aberto)"
  verifiable:
    - kind: manual_browser
      command_or_query: "Mudar event-kinds.ts num branch, push, checar Actions tab"
      expected: "Action roda + PR criado em zordon-mcp"
  dependsOn: []
  estimateMinutes: 30
  touches: [".github/workflows/sync-mcp-types.yml"]

- id: ZMC-DX-009
  title: X-Daemon-Version header + warn no Zordon
  description: Cliente HTTP do zordon-mcp injeta header em todo request. Middleware Zordon compara contra MIN_DAEMON_VERSION. Se outdated, log warn + response header X-Daemon-Outdated=true.
  acceptanceCriteria:
    - "Daemon envia X-Daemon-Version em todas calls"
    - "Server log warn quando outdated > 1 minor"
    - "/api/daemon/version-check retorna shape {minVersion, recommendedVersion}"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: ""
  dependsOn: []
  estimateMinutes: 25
  touches: ["zordon-mcp/src/client/", "src/app/api/daemon/version-check/route.ts"]

- id: ZMC-DX-010
  title: Onboarding flow piloto — 2 PMs em <5min cada
  description: Time + screencast (5min YouTube unlisted) cobrindo o quickstart. PMs piloto reportam tempo e barreiras.
  acceptanceCriteria:
    - "2 PMs piloto completam setup"
    - "Tempo médio ≤5min"
    - "Issues levantadas viram refactors no README"
  verifiable:
    - kind: manual_browser
      command_or_query: "Time 2 PMs em call (Zoom screencast)"
      expected: "ambos onboarded; doc tweaks identificadas"
  dependsOn: [ZMC-DX-001, ZMC-DX-002, ZMC-DX-003, ZMC-DX-007]
  estimateMinutes: 30
  touches: ["(measurement task)"]
```

**Total: 10 stories, ~270min (~4h30).**
