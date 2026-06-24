# PRD — Forge Daemon Service (daemon-ctl.sh)

> Status: `backlog` · Owner: João · Created: 2026-05-31 · Target: 1 loop Ralph (~1h15min)

---

## 0 · Posicionamento

Quarto PRD da quinta **Forge-MVP**, independente (rodar em paralelo a F1/F2/F3). Resolve: **daemon morre quando o shell que o lançou termina**. Hoje só dá pra rodar `npx tsx scripts/forge/daemon.ts` direto no terminal — fechou terminal, suspendeu Mac, daemon morre. Solução: script `daemon-ctl.sh` com subcomandos `start/stop/status/logs/restart` que sobe o daemon **detached** (via `nohup` + `disown`), com PID file, log file próprio, e idempotência.

Princípio: **daemon é um serviço local, controlado por CLI declarativo (start/stop), não por shell live.**

---

## 1 · Problema

3 sintomas:

1. **Daemon morre com o shell** — observamos isso ao vivo nesta sessão: PID 60225 sumiu quando o shell que o lançou foi encerrado. `ForgeJob` ficou queued sem ninguém pra clamar.

2. **Sem visibility** — saber se o daemon tá rodando exige `ps aux | grep daemon.ts`. Sem `status` declarativo. PID file existe (`~/.forge/daemon.pid`) mas ninguém lê — fica desincronizado com a realidade (vimos `60225` no arquivo, processo já morto).

3. **Sem log persistido** — `stdio: 'inherit'` joga output no terminal de quem subiu. Sumiu o terminal, sumiu o histórico. Não dá pra diagnosticar crash post-mortem.

**Fonte:**
- [scripts/forge/daemon.ts:170-172](../../../scripts/forge/daemon.ts) — PID file escrito mas não checado por nada
- [scripts/forge/daemon.ts:121](../../../scripts/forge/daemon.ts) — `stdio: 'inherit'` no spawn dos workers (ok pro worker, problema é o próprio daemon)
- Falta de wrapper de controle. Hoje só `bash scripts/forge/cli.ts daemon` (que ainda invoca tsx no foreground).

## 2 · Solução em uma frase

**Script `scripts/forge/daemon-ctl.sh` com subcomandos `start | stop | status | logs | restart`: `start` faz `nohup npx tsx scripts/forge/daemon.ts > ~/.forge/daemon.log 2>&1 & disown` se PID file ausente/stale; `stop` SIGTERM + grace 10s + SIGKILL; `status` mostra PID, uptime, último heartbeat do registry; `logs` faz tail -f; `restart` = stop + start.**

## 3 · Não-objetivos

- ❌ Não usar `launchd` (macOS plist). Portabilidade > sobrevivência a reboot v1.
- ❌ Não usar `pm2` ou outro process manager NPM. Dependência extra desnecessária.
- ❌ Não rodar daemon como systemd unit (Linux-only). Mesmo motivo.
- ❌ Não permitir múltiplos daemons na mesma máquina v1. 1 daemon = simplicidade.
- ❌ Não suportar `--daemon-id <uuid>` flag agora (já há infra mas é caso raro).
- ❌ Não emitir notificação push em crash. Logs locais bastam.
- ❌ Não rotacionar logs. v1 acumula em `~/.forge/daemon.log` (logrotate fora do escopo).
- ❌ Não monitorar resource usage (CPU/RAM) do daemon.

## 4 · Personas e jornada

**Operador inicia trabalho do dia:**
> "Abro terminal. `bash scripts/forge/daemon-ctl.sh status` → 'not running'. `bash scripts/forge/daemon-ctl.sh start` → 'daemon started, PID 71234'. Volto a editar código. Fecho terminal. Daemon continua."

**Operador suspeita problema:**
> "`bash scripts/forge/daemon-ctl.sh status` → 'running, PID 71234, uptime 4h, last heartbeat 32s ago'. Tudo ok. `bash scripts/forge/daemon-ctl.sh logs` → tail -f do daemon.log, vejo último 'Heartbeat OK'."

**Operador deploya fix do daemon:**
> "`bash scripts/forge/daemon-ctl.sh restart` → 'stopping (SIGTERM)... stopped. starting... started, PID 71889'. Novo código rodando, sem perder estado de banco."

**Crash do daemon:**
> "`status` → 'PID file points to 71889 but process not running (stale)'. Logs mostram 'uncaughtException' às 14:32. Diagnostico, fix, `start` de novo."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Script único em bash (`scripts/forge/daemon-ctl.sh`), portátil Mac+Linux | Bash > Node pra control plane. Sem dependências. |
| D2 | Subcomandos: `start`, `stop`, `status`, `logs`, `restart` | Conjunto mínimo familiar (`systemctl`-like). |
| D3 | Detach via `nohup ... > ~/.forge/daemon.log 2>&1 & disown` | nohup ignora SIGHUP do shell pai; `&` envia background; `disown` remove da job table → daemon sobrevive logout. |
| D4 | PID file em `~/.forge/daemon.pid` (já é a convenção) | Único arquivo de truth. `status` cruza PID file com `ps -p <pid>`. |
| D5 | `start` recusa se PID file existe E processo vivo (idempotente) | Previne 2 daemons. Mensagem clara: "already running, PID X". |
| D6 | `start` limpa PID file se stale (processo morto), e prossegue | UX: "found stale PID file, cleaning up... starting." |
| D7 | `stop` envia SIGTERM, espera até 10s checando `ps`, depois SIGKILL se ainda vivo | Graceful shutdown (daemon já trata SIGTERM em [daemon.ts:236-237](../../../scripts/forge/daemon.ts)). |
| D8 | `status` mostra: PID + uptime (`ps -o etime`) + última leitura de `lastHeartbeatAt` do `ForgeDaemon` registry | Combina view local (processo) + view remota (DB). |
| D9 | `logs` faz `tail -f ~/.forge/daemon.log` (com `-n 50` por default) | Padrão Unix; `journalctl -f` análogo. |
| D10 | `restart` = `stop` (block até confirmar morte) seguido de `start` (block até PID file novo) | Determinístico. |
| D11 | Log path fixo `~/.forge/daemon.log` — não configurável v1 | Convenção. Sem flag CLI ainda. |
| D12 | Exit codes: 0 success, 1 already-running (start), 2 not-running (stop/status), 3 timeout (stop), 64 misuse | Convenção sysadmin. Permite scripting. |

## 6 · Arquitetura

```
┌────────────────────────────────────────────────────────────┐
│  scripts/forge/daemon-ctl.sh                                │
│                                                             │
│  case "$1" in                                               │
│    start)   start_daemon ;;                                 │
│    stop)    stop_daemon ;;                                  │
│    status)  show_status ;;                                  │
│    logs)    tail -F "$LOG_FILE" ;;                          │
│    restart) stop_daemon && start_daemon ;;                  │
│    *)       usage; exit 64 ;;                               │
│  esac                                                       │
└────────────────────────────────────────────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
       ▼             ▼             ▼
   start_daemon  stop_daemon  show_status
       │             │             │
       │ check       │ kill -TERM  │ cat PID file
       │ PID file    │ poll 10s    │ ps -p <pid>
       │ → fresh?    │ kill -KILL  │ ps -o etime
       │             │             │ psql SELECT
       │ nohup       │             │   lastHeartbeatAt
       │   npx tsx   │             │
       │   daemon.ts │             │
       │   > log     │             │
       │   2>&1 &    │             │
       │ disown      │             │
       │ write PID   │             │
       └─────────────┴─────────────┘
                     │
                     ▼
       ┌─────────────────────────────────┐
       │ ~/.forge/                       │
       │   daemon.pid     ← single PID   │
       │   daemon.log     ← all stdout   │
       └─────────────────────────────────┘
```

Componentes novos:
- `scripts/forge/daemon-ctl.sh` — control script.
- `scripts/forge/lib/daemon-paths.sh` (opcional) — exporta `FORGE_HOME`, `DAEMON_PID_PATH`, `DAEMON_LOG_PATH`. Pode ser inline.

Componentes modificados:
- `scripts/forge/daemon.ts` — pequena correção: ao receber SIGTERM, gravar mensagem `"shutting down (signal)"` no log antes de exit (pra debugability).

## 7 · Schema

Nenhuma migration. `ForgeDaemon` tabela já existe e o daemon já registra presence em [scripts/forge/daemon.ts:193-214](../../../scripts/forge/daemon.ts).

## 8 · APIs

Nenhuma rota HTTP. CLI-only.

API CLI (`bash scripts/forge/daemon-ctl.sh <cmd>`):

| Comando | Args | Exit | Saída |
|---|---|---|---|
| `start` | — | 0 ok / 1 already | `daemon started, PID N` |
| `stop` | — | 0 ok / 2 not-running / 3 timeout | `daemon stopped (PID N)` |
| `status` | — | 0 running / 2 not-running | `running, PID N, uptime ..., last heartbeat ...` |
| `logs` | `[-n LINES]` | 0 (tail roda até Ctrl+C) | tail -F do daemon.log |
| `restart` | — | 0 ok / propaga falha | combinação |
| (qualquer outro) | — | 64 | usage |

## 9 · UX

CLI output em `bash` com cores básicas (verde/vermelho/amarelo via ANSI), já no padrão do `daemon.ts`. Exemplos:

```
$ bash scripts/forge/daemon-ctl.sh status
✗ daemon not running
  (no PID file at ~/.forge/daemon.pid)

$ bash scripts/forge/daemon-ctl.sh start
→ starting daemon...
✓ daemon started (PID 71234)
  log: ~/.forge/daemon.log

$ bash scripts/forge/daemon-ctl.sh status
✓ daemon running (PID 71234)
  uptime: 00:04:12
  last heartbeat: 12s ago (Joaos-MacBook-Pro.local)

$ bash scripts/forge/daemon-ctl.sh stop
→ stopping daemon (PID 71234)... SIGTERM sent
  waiting up to 10s...
✓ daemon stopped
```

## 10 · Integrações

- **F1/F2/F3** dependem do daemon estar rodando pra serem testáveis end-to-end. F4 facilita isso.
- **F5 (closeout)** roda dentro do `exec-prd.ts`, não toca daemon-ctl.
- **Memory `project_repo_organization`** — 4 hooks de qualidade são LOCAIS; daemon-ctl é control script, não hook. Sem conflito.

## 11 · Faseamento

1 fase. Script é entregável atômico.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| `nohup` falha em algum shell exótico (zsh+plugin que sobrescreve disown) | Baixa | Média | Testar em zsh nativo do macOS e bash 5 (CI). Documentar requirement. |
| PID file fica stale se daemon crashar antes de remover | Alta | Baixa | `start` D6 trata stale → não bloqueia. |
| Log cresce indefinidamente | Média | Baixa | Aceito v1. `logrotate` é PRD futuro se incomodar. |
| `psql` no `status` falha (DB caído / sem `DIRECT_URL`) | Média | Baixa | Status mostra "DB unavailable" no campo last_heartbeat e continua mostrando dados locais (PID/uptime). |
| `stop` envia SIGKILL e perde job mid-flight | Baixa | Alta | Grace de 10s pro SIGTERM. Daemon trata SIGTERM (já implementado). |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Daemon sobrevive ao fechar terminal | Manual: start, fechar terminal, abrir outro, `status` | running |
| `start` é idempotente | `start` duas vezes seguidas | 2ª retorna exit 1 com "already running" |
| `stop` faz graceful em < 10s para daemon ocioso | Tempo medido | < 5s típico |
| `logs` mostra entradas mid-run | Manual durante job ativo | linhas chegando em ≤1s |
| PID file sempre reflete realidade após `start/stop/restart` | Comparar PID file vs `ps` | 100% match |

## 14 · Open questions

- (Fase 2) Logrotate / cap de tamanho de daemon.log.
- (Fase 2) `launchd` plist macOS pra sobreviver a reboot.
- (Fase 2) Suporte multi-daemon na mesma máquina (cada um com PID file separado).

## 15 · Referências

- [scripts/forge/daemon.ts](../../../scripts/forge/daemon.ts) — daemon Node existente
- [scripts/sync-main.sh](../../../scripts/sync-main.sh) — exemplo de script bash robusto no repo
- Memory `project_forge_double_diamond`

## 16 · Stories implementáveis

```yaml
- id: FDS-001
  title: Implementar daemon-ctl.sh com start/stop/status
  description: Script bash com 3 comandos core. nohup detach, PID file, status que cruza PID + ps.
  acceptanceCriteria:
    - "scripts/forge/daemon-ctl.sh existe e é executável (chmod +x)"
    - "Suporta start / stop / status"
    - "start usa nohup + disown, redirect stdout/stderr pra ~/.forge/daemon.log"
    - "start escreve PID em ~/.forge/daemon.pid"
    - "start retorna exit 1 se já rodando"
    - "stop manda SIGTERM, espera 10s, SIGKILL se preciso"
    - "status combina PID file + ps + (se disponível) DB lastHeartbeatAt"
    - "shellcheck passa (`shellcheck scripts/forge/daemon-ctl.sh`)"
  verifiable:
    - kind: lint
      command_or_query: "test -x scripts/forge/daemon-ctl.sh && echo OK"
      expected: "OK"
    - kind: lint
      command_or_query: "shellcheck scripts/forge/daemon-ctl.sh 2>&1 | wc -l"
      expected: "0"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - scripts/forge/daemon-ctl.sh
  agentProfile: ops
  passes: false

- id: FDS-002
  title: Adicionar comandos logs e restart
  description: logs faz tail -F, restart é stop + start sequencial com waits.
  acceptanceCriteria:
    - "Comando 'logs' faz tail -F ~/.forge/daemon.log (suporta -n N)"
    - "Comando 'restart' chama stop (bloqueia até confirmação) + start (bloqueia até PID novo)"
    - "shellcheck passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'logs)\\|restart)' scripts/forge/daemon-ctl.sh"
      expected: "2"
    - kind: lint
      command_or_query: "shellcheck scripts/forge/daemon-ctl.sh 2>&1 | wc -l"
      expected: "0"
  dependsOn: ["FDS-001"]
  estimateMinutes: 15
  touches:
    - scripts/forge/daemon-ctl.sh
  agentProfile: ops
  passes: false

- id: FDS-003
  title: daemon.ts loga 'shutdown signal received' antes do exit
  description: Pequena melhoria de debugability ao receber SIGTERM/SIGINT.
  acceptanceCriteria:
    - "handleShutdown imprime mensagem 'shutdown signal received' com timestamp"
    - "Mensagem aparece em ~/.forge/daemon.log após bash daemon-ctl.sh stop"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit scripts/forge/daemon.ts"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'shutdown signal received' scripts/forge/daemon.ts"
      expected: "1"
  dependsOn: []
  estimateMinutes: 10
  touches:
    - scripts/forge/daemon.ts
  agentProfile: code
  passes: false

- id: FDS-004
  title: Atualizar AGENTS.md (ou docs/runbooks) com uso do daemon-ctl
  description: Bloco curto explicando os 5 subcomandos e onde mora o log. Atualiza memory project_forge_double_diamond se relevante.
  acceptanceCriteria:
    - "docs/runbooks/forge-daemon-runbook.md existe ou bloco no AGENTS.md sob heading 'Forge daemon'"
    - "Inclui exemplos: start, stop, status, logs, restart"
    - "Aponta pra ~/.forge/daemon.log e ~/.forge/daemon.pid"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'daemon-ctl.sh' docs/runbooks/forge-daemon-runbook.md AGENTS.md 2>/dev/null | awk -F: '{s+=$2} END {print (s>0)?\"OK\":\"FAIL\"}'"
      expected: "OK"
  dependsOn: ["FDS-002"]
  estimateMinutes: 10
  touches:
    - docs/runbooks/forge-daemon-runbook.md
  agentProfile: docs
  passes: false

- id: FDS-005
  title: Smoke test detach + sobrevivência
  description: Roteiro que sobe daemon, mata o shell que subiu, verifica daemon ainda vivo.
  acceptanceCriteria:
    - "scripts/forge/test-smoke-daemon-detach.sh sobe daemon em subshell"
    - "Mata o subshell (kill -9 do shell)"
    - "Verifica daemon ainda no ps (pelo PID file)"
    - "Verifica heartbeat continua chegando no DB"
    - "Cleanup: stop daemon ao final"
  verifiable:
    - kind: manual_browser
      command_or_query: "bash scripts/forge/test-smoke-daemon-detach.sh"
      expected: "PASS"
  dependsOn: ["FDS-001"]
  estimateMinutes: 20
  touches:
    - scripts/forge/test-smoke-daemon-detach.sh
  agentProfile: ops
  passes: false
```
