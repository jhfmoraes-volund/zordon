# Forge Daemon — Runbook

> **Daemon de execução contínua** pra Forge runs autônomas. Roda fora do servidor Next.js, sobrevive ao shell que disparou, persiste em ~/.forge/, reporta heartbeat via DB.

---

## Localização

| Item | Path |
|------|------|
| **CLI de controle** | `scripts/forge/daemon-ctl.sh` |
| **Daemon source** | `scripts/forge/daemon.ts` |
| **PID file** | `~/.forge/daemon.pid` |
| **Logs** | `~/.forge/daemon.log` |
| **DB heartbeat** | `ForgeDaemon` table → `lastHeartbeatAt` |

---

## Comandos

```bash
# Start daemon (detach via nohup + disown)
bash scripts/forge/daemon-ctl.sh start

# Stop daemon (SIGTERM → 10s → SIGKILL se preciso)
bash scripts/forge/daemon-ctl.sh stop

# Status check (PID + uptime + last heartbeat from DB)
bash scripts/forge/daemon-ctl.sh status

# Show logs (default: last 50 lines)
bash scripts/forge/daemon-ctl.sh logs
bash scripts/forge/daemon-ctl.sh logs -n 100       # custom line count
bash scripts/forge/daemon-ctl.sh logs -f           # follow mode (tail -F)

# Restart (stop + start sequencial)
bash scripts/forge/daemon-ctl.sh restart
```

---

## Comportamento

### `start`
- Cria `~/.forge/` se não existir
- Usa `nohup npx tsx scripts/forge/daemon.ts > ~/.forge/daemon.log 2>&1 &` pra detach
- Faz `disown` pra sobreviver ao shell exit
- Escreve PID em `~/.forge/daemon.pid`
- Verifica se processo está vivo após 2s
- **Exit 1 se daemon já rodando**
- Limpa PID file stale (processo morto mas PID file existe)

### `stop`
- Lê PID de `~/.forge/daemon.pid`
- Envia `SIGTERM`, espera até 10s pra graceful shutdown
- Se ainda vivo, envia `SIGKILL` e espera 1s
- Remove PID file ao confirmar morte
- **Exit 2 se daemon não rodando**
- **Exit 3 se SIGKILL falhar**

### `status`
- Lê PID file
- Cruza com `ps -p <pid>` (processo vivo?)
- Mostra uptime via `ps -o etime`
- **Se DIRECT_URL disponível**, busca `lastHeartbeatAt` da tabela `ForgeDaemon` (opcional, gracefully degrada se DB offline)
- **Exit 2 se daemon não rodando ou PID stale**

### `logs`
- Mostra últimas N linhas de `~/.forge/daemon.log` (default 50)
- `-n <num>` ajusta quantidade
- `-f` / `--follow` faz `tail -F` (live stream)
- **Exit 2 se log file não existir**

### `restart`
- Chama `stop_daemon` (bloqueia até morte)
- Sleep 1s pra cleanup
- Chama `start_daemon` (bloqueia até novo PID)

---

## Detach vs. Foreground

O daemon **sempre roda detached** quando disparado via `daemon-ctl.sh start`. Isso significa:
- Sobrevive ao shell que disparou
- Sobrevive ao logout de sessão SSH
- Sobrevive ao close do terminal
- Stdout/stderr vão pra `~/.forge/daemon.log`, não pro terminal

Pra rodar em foreground (debug), execute direto:
```bash
npx tsx scripts/forge/daemon.ts
```

---

## Shutdown Signal Logging

Quando `daemon-ctl.sh stop` envia `SIGTERM` ou `SIGINT`, o daemon loga:
```
[YYYY-MM-DDTHH:MM:SS.sssZ] shutdown signal received
```

Isso aparece em `~/.forge/daemon.log` antes do daemon encerrar. Útil pra debug de paradas inesperadas.

---

## Troubleshooting

| Sintoma | Diagnóstico | Fix |
|---------|-------------|-----|
| `start` retorna "already running" mas `status` mostra "not running" | PID file stale | `rm ~/.forge/daemon.pid && bash scripts/forge/daemon-ctl.sh start` |
| Daemon para sozinho após X minutos | Crash ou exceção não tratada | `tail -n 100 ~/.forge/daemon.log` e busque stacktrace |
| `status` mostra "DB unavailable" | DIRECT_URL não exportado ou DB offline | `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')` |
| Logs não aparecem | Permissões em `~/.forge/` | `ls -la ~/.forge/` — deve ter owner = user rodando daemon |
| SIGKILL falha (exit 3) | Processo zombie ou permissão negada | `ps aux | grep daemon.ts` e `kill -9 <PID>` manual |

---

## Smoke Test

Verifica se daemon sobrevive ao shell que disparou:

```bash
# Em um subshell:
(bash scripts/forge/daemon-ctl.sh start && sleep 2 && exit)

# Subshell morreu. Daemon ainda vivo?
bash scripts/forge/daemon-ctl.sh status
# ✓ daemon running (PID <N>)
#   uptime: <X>

# Cleanup:
bash scripts/forge/daemon-ctl.sh stop
```

Ver `scripts/forge/test-smoke-daemon-detach.sh` pra script automatizado.

---

## Desenvolvimento

Convenções:
- **Migrations** de schema `ForgeDaemon` em `supabase/migrations/`, executar via `psql "$DIRECT_URL" -f ...`
- **Tipos** regenerar com `npm run db:types` após migration
- **Linting**: `shellcheck scripts/forge/daemon-ctl.sh` deve sair clean
- **Typecheck**: `npx tsc --noEmit scripts/forge/daemon.ts` deve sair clean
- **Commit**: via `bash scripts/sync-main.sh -m "..."`

---

## Referências

- **Forge main runbook**: `docs/runbooks/forge-runbook.md`
- **Closed-loop doc**: `docs/runbooks/forge-closed-loop.md`
- **Schema migration pattern**: `AGENTS.md` → bloco Supabase
- **Git workflow**: `AGENTS.md` → bloco Git
