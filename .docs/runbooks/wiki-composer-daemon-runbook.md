# Runbook — Wiki composer no daemon (off OpenRouter), via fila

> **Executor:** agente Claude Code, fresh context. Leia inteiro antes de tocar código.
> **Toca DOIS repos:** `zordon` (monorepo, SSOT) e `zordon-daemon` (espelho + executor). Regra do tool-advertisement: mudança compartilhada vai nos dois + **restart do daemon**.
> **Commit:** `bash scripts/sync-main.sh -m "ZRD-JM-NN: wiki — <resumo>"` no monorepo; no daemon, commit no repo dele.

## 1. Problema

- O "Gerar Wiki" roda no **OpenRouter** (`anthropic/claude-sonnet-4.6` via `generateText`), pago por token — enquanto o chat dos agentes já migrou pro **daemon** (seat OAuth, custo marginal ~0).
- Decisão (2026-06-21): mover a composição da Wiki pro daemon também, **mantendo o determinismo** do composer (Zod + grounding + bulletHash), sem virar turno de agente.

## 2. Solução em uma frase

`/wiki/compose` (e o cron) param de chamar o worker OpenRouter e passam a **enfileirar um `ForgeJob{kind:"wiki"}`**; o daemon roda o **mesmo composer** (espelhado), trocando só o transporte do modelo por `query()` do Claude Agent SDK (one-shot, sem tools), e persiste direto via service-role.

## 3. Não-objetivos

- NÃO virar turno de agente / ChatTurn (isso era a Opção A, descartada). Sem tools, sem multi-turn, sem owner-thread.
- NÃO criar endpoint HTTP novo no daemon nem secret novo (isso era o B1, descartado). Canal = fila no DB; auth = service-role existente.
- NÃO mudar o schema da Wiki (`ProjectWikiSection`, `WikiJob`), o contrato do cliente (poll em `WikiJob`), nem o grounding/suppress.
- NÃO mudar a UI da Wiki (redesign ZRD-JM-183 fica intacto).

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Canal = **fila `ForgeJob`** (kind novo `wiki`), `assignToAnyone:true`, espelhando `enqueueChatJob` | Reusa o canal monorepo→daemon que já existe (DB); sem HTTP novo, sem secret |
| D2 | `composer.ts`/`schemas.ts`/`suppressed.ts` são **espelhados** no daemon (SSOT continua no monorepo) | Mesmo padrão de `chat-turn.ts` ("repo zordon-daemon que espelha este arquivo") |
| D3 | Transporte do modelo é **injetável**: `composer.ts` importa `generateSection()` de um módulo `wiki-generate.ts` **por-repo**. Monorepo = stub/fallback; daemon = `query()` one-shot | Só o transporte diverge entre repos; composer mirrors verbatim → sem drift na lógica de grounding |
| D4 | `query()` config: `maxTurns:1`, `allowedTools:[]`, sem `mcpServers`, sem `resume`, `cwd=repoRoot`, `permissionMode:"bypassPermissions"`, system+prompt concatenados; coleta `text_delta` | Vira completion determinística; reaproveita o padrão de `exec-chat-turn.ts` |
| D4b | **Pinar `model`** nas options do query() da wiki (≥ Sonnet 4.6 — idealmente Opus) | exec-chat-turn NÃO fixa modelo (usa default do seat); sem pin, a Wiki herda o default e pode regredir vs OpenRouter Sonnet 4.6 |
| D5 | Execução **inteira no daemon** (loadWikiContext + LLM + ground + persist + update WikiJob), via service-role | Sem ping-pong; igual forge/pm-review rodam end-to-end no daemon |
| D6 | `WikiJob` é o estado do job (igual hoje); cliente continua dando poll em `GET /wiki/jobs/[jobId]` | Zero mudança no cliente |
| D7 | `ownerId` do ForgeJob = memberId de quem disparou (manual) ou PM do projeto (cron). `assignToAnyone:true` | ForgeJob.ownerId é NOT NULL; com assignToAnyone qualquer daemon pega |
| D8 | OpenRouter sai do caminho da Wiki: `/api/internal/wiki-composer` + `getModel` no composer ficam como **fallback atrás de flag `WIKI_USE_OPENROUTER`** por 1 release, depois remove | Daemon v1 roda no Mac (cai às vezes); fallback evita Wiki travada até provar estável |
| D9 | Nova queue `wiki` entra em `ZD_QUEUES` (default passa a `chat,forge,wiki`) | Daemon precisa escutar a fila nova |

## 5. Arquitetura (fluxo)

```
[Gerar Wiki] ─POST /wiki/compose─→ cria WikiJob(status=queued)
                                   └─ createJob(kind:"wiki", meta:{wikiJobId,projectId}, assignToAnyone)
cron/wiki-daily ──────────────────→ idem (trigger:"cron")

           (fila ForgeJob no DB — canal que já existe)
                              │
        daemon-loop: queueLoop("wiki") → claim → executeJob
                              │
        spawn exec-wiki-compose.ts <wikiJobId> <projectId>
                              │
   composeWiki() [ESPELHADO]:
     loadWikiContext (DB service-role)
     por seção: wiki-generate.query()  ← seat OAuth, maxTurns:1, sem tools
                parse → Zod → ground → bulletHash → persist (ProjectWikiSection)
     update WikiJob(done|failed)
                              │
   cliente: poll GET /wiki/jobs/[jobId] (igual hoje) → done
```

## 6. Mapa do código

**Monorepo (`zordon`):**
| O quê | Onde |
|-------|------|
| Composer (SSOT) | `src/lib/wiki/composer.ts` — extrair model-call p/ `wiki-generate.ts` |
| Schemas / suppress | `src/lib/wiki/schemas.ts`, `src/lib/wiki/suppressed.ts` |
| Enfileirar (entrada) | `src/app/api/projects/[id]/wiki/compose/route.ts` (troca fire-and-forget por createJob) |
| Cron | `src/app/api/cron/wiki-daily/route.ts` (idem) |
| Job DAL | `src/lib/forge/dal/job.ts` (`createJob`) — reusar |
| Worker legado (fallback) | `src/app/api/internal/wiki-composer/route.ts` (atrás de flag, D8) |

**Daemon (`zordon-daemon`):**
| O quê | Onde |
|-------|------|
| Espelho do composer | `src/lib/wiki/{composer,schemas,suppressed}.ts` (novo) |
| Transporte query() | `src/lib/wiki/wiki-generate.ts` (novo — usa `@anthropic-ai/claude-agent-sdk`) |
| Exec | `scripts/daemon/exec-wiki-compose.ts` (novo; molde: `exec-chat-turn.ts`) |
| Queue config | `src/core/env.ts` (allow + default `wiki`) |
| Dispatch | `src/runner/daemon-loop.ts` (`executeJob` branch kind `wiki` → spawn) |
| Claim (genérico por kind) | `src/runner/control-plane.ts` (verificar que `claim("wiki")` funciona sem mudança) |

## 7. Stories

```yaml
- id: WCD-001
  title: Extrair transporte do modelo do composer (monorepo)
  description: >
    Mover a chamada de modelo de callSectionLLM para src/lib/wiki/wiki-generate.ts
    exportando generateSection({projectId, sectionKey, system, prompt}) => Promise<string>.
    Implementação atual (generateText/getModel/recordSubAgentUsage) vai pra lá,
    atrás da flag WIKI_USE_OPENROUTER (D8). composer.ts passa a importar generateSection.
  acceptanceCriteria:
    - "composer.ts não importa mais getModel/generateText diretamente"
    - "Com WIKI_USE_OPENROUTER=1, compose roda igual hoje"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
  dependsOn: []
  estimateMinutes: 25
  touches: [src/lib/wiki/composer.ts, src/lib/wiki/wiki-generate.ts]

- id: WCD-002
  title: /wiki/compose + cron enfileiram ForgeJob kind=wiki (monorepo)
  description: >
    POST /wiki/compose: depois de criar o WikiJob, em vez do fetch fire-and-forget
    pro worker, chamar createJob({kind:"wiki", ownerId:<memberId do user>,
    projectId, assignToAnyone:true, meta:{wikiJobId, trigger:"manual"}}).
    cron/wiki-daily: idem com trigger:"cron" e ownerId = PM do projeto.
    Atrás da flag: se WIKI_USE_OPENROUTER=1, mantém o caminho antigo.
  acceptanceCriteria:
    - "POST /wiki/compose retorna 202 {jobId} e cria ForgeJob kind=wiki"
    - "Sem daemon rodando, WikiJob fica queued (não quebra a request)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: sql
      command_or_query: "SELECT kind,status FROM \"ForgeJob\" WHERE kind='wiki' ORDER BY \"createdAt\" DESC LIMIT 1"
      expected: "1 linha kind=wiki status=queued após clicar Gerar Wiki"
  dependsOn: [WCD-001]
  estimateMinutes: 25
  touches:
    - src/app/api/projects/[id]/wiki/compose/route.ts
    - src/app/api/cron/wiki-daily/route.ts

- id: WCD-003
  title: Espelhar composer + transporte query() no daemon
  description: >
    Copiar src/lib/wiki/{composer,schemas,suppressed}.ts pro daemon (verbatim;
    imports @/ resolvem pra src do daemon). Criar src/lib/wiki/wiki-generate.ts
    no daemon implementando generateSection via query() (D4): concatena system+
    prompt, maxTurns:1, allowedTools:[], sem mcpServers/resume, coleta text_delta,
    retorna texto. Registrar uso (tokens/cost do result) como wiki-composer-<seção>.
  acceptanceCriteria:
    - "daemon: npx tsc --noEmit limpo"
    - "wiki-generate retorna string; sem tools habilitadas no query()"
  verifiable:
    - kind: typecheck
      command_or_query: "cd ../zordon-daemon && npx tsc --noEmit"
      expected: "sem erros"
  dependsOn: [WCD-001]
  estimateMinutes: 30
  touches:
    - ../zordon-daemon/src/lib/wiki/composer.ts
    - ../zordon-daemon/src/lib/wiki/schemas.ts
    - ../zordon-daemon/src/lib/wiki/suppressed.ts
    - ../zordon-daemon/src/lib/wiki/wiki-generate.ts

- id: WCD-004
  title: exec-wiki-compose + dispatch da fila wiki (daemon)
  description: >
    scripts/daemon/exec-wiki-compose.ts (molde exec-chat-turn): recebe
    <wikiJobId> <projectId>, marca WikiJob running, chama composeWiki(projectId,
    wikiJobId, trigger), trata erro → WikiJob failed. env.ts: aceitar "wiki" em
    ZD_QUEUES + default chat,forge,wiki. daemon-loop executeJob: branch kind
    "wiki" → spawn tsx exec-wiki-compose.ts. Confirmar claim("wiki") genérico.
  acceptanceCriteria:
    - "ZD_QUEUES default inclui wiki; daemon loga 'escutando ... wiki'"
    - "Job kind=wiki é claimado e spawna exec-wiki-compose"
    - "WikiJob vai a done; ProjectWikiSection persiste com sources (grounding intacto)"
  verifiable:
    - kind: manual_browser
      command_or_query: "Com daemon rodando, clicar Gerar Wiki num projeto com DS"
      expected: "WikiJob done; seções Objetivos/Highlights preenchidas via daemon"
  dependsOn: [WCD-002, WCD-003]
  estimateMinutes: 35
  touches:
    - ../zordon-daemon/scripts/daemon/exec-wiki-compose.ts
    - ../zordon-daemon/src/core/env.ts
    - ../zordon-daemon/src/runner/daemon-loop.ts

- id: WCD-005
  title: Validar e-2-e + cutover da flag
  description: >
    Rodar manual + (opcional) cron. Confirmar custo agora bate em uso de daemon
    (não OpenRouter). Default WIKI_USE_OPENROUTER ausente → caminho daemon. Documentar
    no runbook que o worker interno vira fallback a remover no próximo release.
  acceptanceCriteria:
    - "Sem WIKI_USE_OPENROUTER, Gerar Wiki roda 100% no daemon"
    - "recordSubAgentUsage loga wiki-composer-* no daemon"
  verifiable:
    - kind: manual_browser
      command_or_query: "Gerar Wiki 2x (fresh + re-gen com hash guard)"
      expected: "1ª gera, 2ª pula seções sem mudança (hash guard intacto)"
  dependsOn: [WCD-004]
  estimateMinutes: 20
  touches: [docs/runbooks/wiki-composer-daemon-runbook.md]
```

## 8. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Daemon offline (v1 = Mac do João) | Média | Alto | Flag `WIKI_USE_OPENROUTER` (D8) como fallback até v2; WikiJob fica queued, não quebra |
| Drift entre composer do monorepo e do daemon | Média | Médio | D3: só `wiki-generate.ts` diverge; composer/schemas/suppressed verbatim. Checklist de sync no PORTING.md |
| `query()` devolve prosa fora do JSON | Baixa | Médio | `parseJson` do composer já extrai o 1º `{...}`; system prompt já exige "APENAS JSON" |
| `query()` puxa tools/itera | Baixa | Médio | D4: maxTurns:1 + allowedTools:[] + sem mcpServers |
| Modelo do seat < Sonnet 4.6 → regride qualidade | Média | Alto | D4b: pinar `model` no query() da wiki; validar 1 saída real vs versão OpenRouter |
| `ownerId`/claim do job wiki não casa com daemon personal | Baixa | Médio | `assignToAnyone:true` (igual chat); validar claim por kind |
| Custo/uso não atribuído | Baixa | Baixo | recordSubAgentUsage no exec (tokens/cost do result do query) |

## 9. Definição de pronto

- Monorepo + daemon: `tsc` limpo nos dois.
- Sem `WIKI_USE_OPENROUTER`: Gerar Wiki cria `ForgeJob{kind:"wiki"}`, daemon executa, `WikiJob` → done, seções persistem com grounding/sources intactos e hash-guard funcionando.
- Uso registrado como `wiki-composer-*` (daemon), não mais OpenRouter.
- Cliente (poll WikiJob) inalterado; UI inalterada.
- Fallback OpenRouter documentado como removível no próximo release.
