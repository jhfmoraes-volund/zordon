# Runbook — Wiki Copiloto (afinar a Wiki por chat, grounded)

> **Executor:** agente Claude Code, fresh context. Leia inteiro antes de tocar código.
> **Toca DOIS repos:** `zordon` (SSOT) e `zordon-daemon` (espelho + executor). Tool nova = registrar + espelhar + restart do daemon.
> **Depende de:** composer da Wiki (em prod). Roda independente do B2, mas combina: pós-B2 o recompose roda no seat OAuth.
> **Doutrina:** segue [agent-construction-doctrine.md](../platform/agent-construction-doctrine.md) — poucas tools afiadas, SENSE rico, model orquestra, disciplina na escrita.
>
> **Status (2026-06-21):** Backend completo e em main (ZRD-JM-185). Feito: WCP-001 (migration `ProjectWikiEmphasis` rodada em prod + DAL), WCP-002 (composer aplica ênfase + entra no inputsHash), WCP-003 (tools/wiki.ts: read/emphasis/suppress/restore/recompose + registro), WCP-004 (surface `wiki` da Vitoria: registry + prepare-turn + prompt `wiki-copilot.ts` + `ensureWikiThread`). `recompose_wiki` desacoplado do composer do daemon: dispara `/api/internal/wiki-composer` via HTTP (`ZORDON_URL` + `CRON_SECRET`) — daemon NÃO precisa do composer (não depende do B2). `tsc`/`eslint` limpos; backend é INERTE até existir um thread `channel='wiki'`.
> **Pivot (2026-06-21):** decidido NÃO construir chat UI bespoke. O copiloto roda pelo **chat global do Alpha** (que já existe) — as tools foram tornadas route-scoped (`requireWikiProjectId` = `routeProjectId` p/ Alpha na página do projeto, `projectId` p/ a surface 'wiki' da Vitoria) e expostas ao `ALPHA_TOOLS` + nudge no prompt do Alpha. Não há "spawn de Vitoria" — capacidade = tools; quem as tem, faz. Daemon mirror = **schema-stubs** (execução proxiada pro tool router do app); o monorepo tem o `execute` real. `tsc` limpo nos dois repos.
> **Execução é proxiada:** o daemon só anuncia o stub; quando o Alpha chama a tool, o mcp-server faz POST `${ZORDON_URL}/api/agents/tools/<tool>` e o `execute` REAL roda **no processo do app** (que já tem `CRON_SECRET`). Logo NÃO precisa de secret no `.env` do daemon — o `recompose_wiki` usa o env do app.
> **Multi-instância:** jobs de chat são `assignToAnyone:true` → qualquer daemon (Mac OU Windows) pode claimar um turno do Alpha. As DUAS instâncias precisam do mesmo código → daemon repo commitado+pushado (origin); cada máquina dá `git pull` + restart.
> **Falta:** (a) `git pull` + **restart** do daemon em **ambas** as instâncias (Mac + Windows); (b) verify no browser: projeto → chat do Alpha → "ajusta a wiki: destaca X" → recompose. (Sem mudança de `.env` em nenhuma das duas.)

## 1. Problema

- A Wiki v2 é auto-gerada e **sem edição humana** (invariante anti-"documento morto"). Quando o PM acha que faltou algo ou que um bullet está mal-priorizado, a única saída é "Atualizar Wiki" (re-roda igual) ou "Ocultar bullet" (suppress manual via menu).
- Falta um caminho de **personalização conversacional** — dizer "o objetivo deveria focar em X" / "destaca o risco da migração" e a Wiki se ajustar — **sem** reintroduzir texto livre que aluciná ou que o cron sobrescreve.

## 2. Solução em uma frase

A Vitoria ganha uma superfície `wiki` (chat contextual no sheet da Wiki) com pouquíssimas tools que **afinam a geração grounded** — uma ênfase persistida que o composer honra em toda geração, mais suppress/restore de bullets — nunca escrevendo texto livre direto na Wiki.

## 3. Não-objetivos

- NÃO permitir texto livre na Wiki (decisão do usuário: **só grounded**). Sem bloco "Nota do PM", sem seção manual.
- NÃO deixar a Vitoria reescrever seções grounded diretamente. Ela só **steer + suppress + recompose**.
- NÃO criar readers de projeto novos: **reusar `VITORIA_SHARED_READ_NAMES`** (doutrina §1; dívida #1 da auditoria de tools).
- NÃO mudar o contrato/UX da Wiki (Identidade/Pulso/Atividade/narrativa) nem o schema das seções/jobs.
- NÃO resolver a dívida de capacidades sobrepostas entre agentes (refactor separado — ver §10).

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Agente = **Vitoria**, nova superfície `wiki` (`thread.channel='wiki'`), project-scoped | Já tem o núcleo de leitura de projeto + superfície grounded (PM Review/Planning). Alpha seria 4º silo |
| D2 | **Grounded-only** (escolha do usuário): copiloto só AFINA. Tools = read + emphasis + suppress/restore + recompose. Zero texto livre | Preserva o invariante anti-documento-morto + anti-alucinação |
| D3 | **Ênfase persiste e sobrevive ao cron**: o composer lê e aplica em TODA geração (não é edição pontual). Espelha o padrão `emphasis` do Ritual Playbook | A personalização não pode virar estática nem ser sobrescrita pela próxima geração |
| D4 | Persistência da ênfase = tabela mínima `ProjectWikiEmphasis` (1 por projeto): `projectId` PK, `emphasis text`, `updatedAt`, `updatedBy` + RLS | Não bloata `Project`; RLS explícita; histórico simples via updatedAt |
| D5 | Suppress/restore **reusam o mecanismo existente** (`ProjectWikiSection.suppressed[]` + `/wiki/suppress`); a tool só dirige | Sem reinventar; já testado e sobrevive a regeneração |
| D6 | Recompose = dispara o composer (mesmo do "Atualizar Wiki"), com a ênfase aplicada. Funciona pré e pós-B2 | Reuso total; pós-B2 roda no seat OAuth |
| D7 | Tools definidas **UMA vez** em `tools/wiki.ts` (factories), registradas no `TOOL_REGISTRY`, nome no `Set` da superfície `wiki`. Espelhadas no daemon | Modela o jeito certo (contra a dívida #2); doutrina §1 |
| D8 | Entrada de chat = botão "Ajustar com a Vitoria" no sheet da Wiki → thread por projeto (`channel='wiki'`) | Contextual; parity com como Planning/PM Review abrem chat |

## 5. As tools (poucas e afiadas — doutrina §1/§2)

| Tool | Classe | Contrato |
|------|--------|----------|
| `read_wiki` | SENSE | Devolve seções atuais (objectives/highlights) + ênfase vigente + bullets suprimidos. O agente "olha a realidade" antes de propor (mata alucinação) |
| `set_wiki_emphasis` | ACT (persiste) | Grava o steer livre do PM em `ProjectWikiEmphasis`. **Não** escreve na Wiki — só orienta a próxima geração |
| `suppress_wiki_bullet` / `restore_wiki_bullet` | ACT | Dirige o suppress existente por `(sectionKey, bulletHash)` |
| `recompose_wiki` | ACT | Dispara a geração (composer) com a ênfase aplicada; devolve o resumo do que mudou |

`projectId` vem do escopo do turno (closure, não arg — doutrina D13). Reuso de `VITORIA_SHARED_READ_NAMES` dá à Vitoria a consciência de sprint/tasks/DS pra conversar com contexto.

## 6. Mudança no composer (aplicar a ênfase)

`loadWikiContext`/`composeWiki` passam a ler `ProjectWikiEmphasis` do projeto e, havendo texto, anexam ao `userPrompt` de cada seção um bloco:

```
Ênfase do PM (orientação, não fonte): <emphasis>
Aplique a ênfase ao PRIORIZAR/destacar, mas NÃO invente: todo bullet continua
ancorado a um insumo real. Se a ênfase pede algo sem fonte, ignore-a.
```

Grounding intacto (a ênfase orienta o que destacar, não cria fato). O hash-guard precisa incluir a ênfase no `inputsHash` (senão "set_wiki_emphasis + recompose" seria pulado por "insumos iguais").

## 7. Stories

```yaml
- id: WCP-001
  title: Tabela ProjectWikiEmphasis + DAL
  description: >
    Migration: CREATE TABLE "ProjectWikiEmphasis" (projectId uuid PK refs Project,
    emphasis text not null default '', updatedAt timestamptz, updatedBy uuid refs Member)
    + RLS (manager/contributor/lead do projeto edita; viewer lê). DAL get/set.
  acceptanceCriteria:
    - "Migration roda via psql; database.types.ts atualizado"
    - "RLS: guest/viewer não escreve"
  verifiable:
    - kind: sql
      command_or_query: "\\d \"ProjectWikiEmphasis\""
      expected: "tabela com PK projectId + RLS habilitada"
  dependsOn: []
  estimateMinutes: 25
  touches: [supabase/migrations/, src/lib/dal/, src/lib/supabase/database.types.ts]

- id: WCP-002
  title: Composer aplica a ênfase + entra no hash
  description: >
    composeWiki lê ProjectWikiEmphasis; anexa o bloco de ênfase (§6) ao userPrompt
    de cada seção; inclui a ênfase no computeInputsHash. Grounding inalterado.
  acceptanceCriteria:
    - "Com ênfase setada, o prompt de cada seção a inclui"
    - "Mudar a ênfase muda o inputsHash (recompose não é pulado)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
  dependsOn: [WCP-001]
  estimateMinutes: 25
  touches: [src/lib/wiki/composer.ts]

- id: WCP-003
  title: tools/wiki.ts (read/emphasis/suppress/recompose) + registro
  description: >
    Factories em src/lib/agent/tools/wiki.ts (read_wiki, set_wiki_emphasis,
    suppress_wiki_bullet, restore_wiki_bullet, recompose_wiki). Registrar no
    TOOL_REGISTRY. projectId via ctx (closure). recompose_wiki reusa o trigger
    do compose (enfileira/dispara como o /wiki/compose).
  acceptanceCriteria:
    - "5 tools no TOOL_REGISTRY; nenhuma recria reader de projeto"
    - "set_wiki_emphasis persiste; suppress reusa /wiki/suppress"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
  dependsOn: [WCP-001]
  estimateMinutes: 30
  touches: [src/lib/agent/tools/wiki.ts, src/lib/agent/tools-registry.ts]

- id: WCP-004
  title: Superfície 'wiki' da Vitoria + prompt
  description: >
    getToolNamesForAgent: surface 'wiki' → WIKI_TOOLS = [wiki tools] +
    VITORIA_SHARED_READ_NAMES + read_context_source. Prompt/profile da Vitoria
    pra superfície wiki (copiloto que afina, não reescreve; grounded).
  acceptanceCriteria:
    - "surface='wiki' devolve as wiki tools + núcleo de leitura compartilhado"
    - "Nenhuma tool de escrita livre exposta"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
  dependsOn: [WCP-003]
  estimateMinutes: 25
  touches: [src/lib/agent/tools-registry.ts, src/lib/agent/agents/vitoria/]

- id: WCP-005
  title: Espelhar no daemon + entrada de chat no sheet
  description: >
    Espelhar tools/wiki.ts + tools-registry no zordon-daemon; mcp-server expõe a
    surface 'wiki'. No sheet da Wiki, botão "Ajustar com a Vitoria" abre thread
    channel='wiki' (parity com Planning/PM Review). Restart do daemon.
  acceptanceCriteria:
    - "daemon: tsc limpo; surface wiki anunciada"
    - "Chat no sheet ajusta ênfase + suppress + recompose e a Wiki reflete"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir Wiki → Ajustar com Vitoria → 'destaca o risco X' → recompose"
      expected: "Highlights re-priorizam grounded; ênfase persiste no próximo gen"
  dependsOn: [WCP-002, WCP-004]
  estimateMinutes: 35
  touches:
    - ../zordon-daemon/src/lib/agent/tools/wiki.ts
    - ../zordon-daemon/src/lib/agent/tools-registry.ts
    - src/components/project-wiki/
```

## 8. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Ênfase vira porta dos fundos pra alucinação | Média | Alto | §6: ênfase é orientação, não fonte; "se pede algo sem fonte, ignore"; grounding/refs inalterados |
| Recompose pulado pelo hash-guard | Alta | Médio | WCP-002: ênfase entra no inputsHash |
| Drift Vitoria↔daemon | Média | Médio | Espelhar tools/wiki.ts + registry; checklist no PORTING.md |
| Crescer 4º silo de tools | Média | Médio | D7: definir 1×, reusar SHARED_READ; não duplicar readers |

## 9. Definição de pronto

- Migration aplicada; `tsc`/`eslint` limpos nos dois repos.
- "Ajustar com a Vitoria" no sheet: setar ênfase + suppress + recompose, e a Wiki reflete **grounded** (refs intactas).
- Ênfase **persiste** e o cron continua honrando (não vira estática nem é sobrescrita).
- Zero texto livre escrito direto em seção da Wiki.

## 10. Fora de escopo (refactor separado — dívida da auditoria de tools 2026-06-21)

Não fazer aqui, mas registrado: **unificar capacidades sobrepostas entre agentes** (`get_project_capacity`≈`get_sprint_capacity`, `list_sprints`≈`list_project_sprints`, `get_tasks`≈`list_project_tasks`), tornar o **pertencimento de capacidade metadata-driven** (hoje é `Set` de nomes hand-maintained, declarado 2×), e **documentar o modelo de sharing** na doutrina. Hoje o sharing é opt-in por lista → default é silo.
