---
status: draft
owner: João Moraes
date: 2026-06-01
domain: agents / vitor / prd-session
codenames:
  - quick-ask-launcher   # a side sheet vira launcher de discovery, não gerador single-shot
  - vitor-first-analysis # Vitor faz a 1ª análise no chat (adaptativa) ao invés de um job Haiku
related_prds:
  - docs/prd/backlog/prd-vitor-prd-authoring-quality.md   # QUALIDADE/§16 do conteúdo — este PRD é o FLUXO de entrada
  - docs/prd/backlog/prd-vitor-output-as-prd.md           # define a entidade ProductRequirement
  - docs/prd/backlog/prd-forge-from-vitor.md              # consumidor downstream (Forja)
references:
  - src/components/sessions/prd-session/quick-ask-sheet.tsx     # launcher atual (a refatorar)
  - src/lib/sessions/prd-session/jobs.ts                        # job single-shot (a aposentar)
  - src/lib/agent/vitor/prompts/prd-quickask.ts                 # gerador Haiku (a aposentar)
  - src/components/sessions/prd-session/prd-briefing-step.tsx   # chat (command center) — reusado
  - src/components/agent/context-import/                         # infra de insumos (reusada no launcher)
  - src/app/api/design-sessions/[id]/chat/route.ts             # transport do chat com Vitor
---

# PRD — Quick-Ask vira Launcher de Discovery com insumos + 1ª análise do Vitor no chat

> **TL;DR:** Hoje o "PRD Quick-Ask com Vitor" é uma side sheet que recebe **só um brief de texto**, dispara um **job Haiku single-shot** que gera PRDs rasos, mostra a lista na própria sheet e só depois abre o chat. Este PRD inverte o fluxo: a sheet vira um **launcher** que coleta **insumos** (reuniões/planilhas/github) + brief **opcional**, e ao confirmar **cria a PRD Session e joga o PM direto no chat com o Vitor**, onde ele faz a **1ª análise adaptativa** — se os insumos são ricos, propõe um **scaffold macro de PRDs**; se são ralos, **pergunta antes**. O scaffold **sempre** inclui um **PRD-000 de Setup & Stack** (raiz do DAG, stack-da-casa Next+Supabase por default) pra dar terreno à Forja. A partir daí, refino conversacional. A barra de qualidade/§16 dos PRDs é responsabilidade do PRD irmão, não deste.

---

## 1. Problema

### 1.1 O brief de texto é uma porta estreita

O launcher atual ([quick-ask-sheet.tsx:220-234](src/components/sessions/prd-session/quick-ask-sheet.tsx#L220-L234)) só aceita um `<Textarea>` (10–2000 chars). Todo o contexto que o PM já tem — transcript da reunião de discovery, planilha de requisitos do cliente, repo de referência — fica de fora. O PM precisa **destilar manualmente** esse material num brief curto, perdendo fidelidade. A infra de insumos (`src/components/agent/context-import/`: transcript, planilha, github) **já existe** e é usada no chat de refino, mas **não na porta de entrada**.

### 1.2 O job single-shot gera PRDs rasos e cegos ao contexto

[generatePrdsFromBrief](src/lib/agent/vitor/prompts/prd-quickask.ts#L87) roda **Haiku single-shot** com `generateObject` sobre **apenas a string do brief**. Não lê insumos, não pergunta nada, não tem loop. Resultado: PRDs com `title + oneLiner + problem + AC plana` e nada mais (a auditoria de 2026-05-31 no PRD irmão confirma: 8 de 10 PRDs saem como shells). O modelo não tem como planejar a partir de material que nunca viu.

### 1.3 Não há PRD de fundação — a Forja tropeça na largada

Os PRDs gerados são todos de **feature**. Ninguém garante o **PRD-000: Setup & Stack** (scaffold do projeto, stack, migrations base, auth, CI). A Forja ([src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts)) consome a fila e, sem terreno, tropeça na primeira story — uma das causas observadas de timeout/retrabalho no loop autônomo.

### 1.4 Princípio do user

> "Quero importar os insumos logo de cara, e em vez de eu dizer pro Vitor, ele pega os insumos e planeja. Ao dar OK é como se criasse a session e abrisse o chat, e o Vitor já faz a primeira análise. Vitor precisa criar um PRD de setup e stack."
> — João, 2026-06-01

---

## 2. Solução em uma frase

**Transformar a side sheet do Quick-Ask num launcher que coleta insumos (reuniões/planilhas/github) + brief opcional e, ao confirmar, cria a PRD Session e abre o chat com o Vitor, onde ele faz uma 1ª análise adaptativa — propondo um scaffold macro de PRDs (sempre com um PRD-000 de Setup & Stack como raiz do DAG) ou perguntando antes quando o contexto for ralo.**

---

## 3. Não-objetivos

- **Não** definir a barra de qualidade nem o §16 (stories ≤30min, `verifiable`) dos PRDs — isso é do [prd-vitor-prd-authoring-quality.md](docs/prd/backlog/prd-vitor-prd-authoring-quality.md). Aqui o scaffold é **macro** (title/oneLiner/problem/AC); o detalhe e a quebra fina vêm no refino e no gate da Forja.
- **Não** mudar a entidade `ProductRequirement`. As tools agentic (`propose_prd`, `update_prd`, `link_prd_dependency`, `read_context_source`) já existem e são reusadas.
- **Não** reescrever o chat de refino (`prd-briefing-step.tsx`) — ele é o command center e já tem insumos + tools. Só adicionamos o gatilho de 1ª análise.
- **Não** criar um agente novo. A "1ª análise" é um modo de prompt do próprio Vitor no step `prd_briefing`.
- **Não** tocar no fluxo de **upload** (`upload-sheet.tsx`, `subKind="upload"`) — segue como está.
- **Não** implementar o gate de §16 que bloqueia o envio pra Forja (delegado ao PRD irmão).

---

## 4. Personas e jornada

### 4.1 João (PM, abrindo uma discovery)

> "Acabei de sair de uma call de descoberta gravada no Granola e tenho a planilha de requisitos do cliente. Quero abrir o launcher, jogar a transcrição + a planilha + (talvez) o repo de referência, escrever uma linha de contexto se eu quiser, e dar OK. Não quero ficar destilando tudo num brief. Quero cair direto no chat com o Vitor já com a leitura inicial dele na tela."

### 4.2 Vitor (PRD author, no step prd_briefing)

> "Recebo a session recém-criada com insumos linkados e um brief opcional. Eu **leio os insumos** via `read_context_source`. Se o material é rico, já proponho um scaffold macro de PRDs via `propose_prd`, sempre começando por um **PRD-000 Setup & Stack** que todos os outros dependem. Se o material é ralo/ambíguo, faço 2-3 perguntas-chave antes de propor qualquer coisa. Depois disso, refino com o PM no chat."

### 4.3 Forja (consumidor downstream)

> "Quando recebo a fila de PRDs, preciso de um PRD-000 que estabeleça scaffold + stack + migrations base + auth + CI **antes** dos PRDs de feature, e que todos dependam dele. Sem essa raiz, eu invento decisão de stack e tropeço na primeira story."

### 4.4 João (refinando depois)

> "No command center eu continuo conversando: 'detalha o PRD de pagamentos', 'separa esse em dois', 'a stack vai ser Remix, troca o PRD-000'. O Vitor ajusta. Quando estiver bom, mando pra Forja."

---

## 5. Decisões fixadas

| ID | Decisão | Escolha | Por quê |
|---|---|---|---|
| **D1** | Side sheet vira **launcher**, não gerador | A sheet coleta insumos + brief e ao OK **cria a session e navega pro chat**. Some o display de resultado/polling dentro da sheet | O valor passa a estar no chat (loop agêntico), não num job cego |
| **D2** | Brief é **opcional** | Validação no `start`: exige **brief OU ≥1 insumo**. Brief sozinho continua válido (retrocompat) | Insumos podem ser fonte primária; brief vira instrução de foco |
| **D3** | Insumos no launcher reusam a infra existente | `src/components/agent/context-import/` (transcript/planilha/github) é embedado na sheet; linka **direto na session draft** (criada no open) via a infra que já assume `sessionId` | Zero UI nova + zero refactor nos modais; consistência com o chat de refino ([feedback_agent_ui_parity]) |
| **D4** | 1ª análise acontece **no chat** | Job Haiku single-shot é **aposentado**. A geração vira o **primeiro turno do Vitor** no step `prd_briefing`, usando tools existentes | Loop agêntico lê insumos sob demanda (`read_context_source`) — resolve o "single-shot não cabe no contexto" |
| **D5** | 1ª análise é **adaptativa** | Insumos ricos → scaffold macro direto; insumos ralos/ambíguos → 2-3 perguntas-chave antes. Vitor decide pela qualidade do contexto | Equilibra "progresso imediato" com "não chutar em cima de contexto ruim" |
| **D6** | Scaffold é **macro** | PRDs gerados na 1ª análise têm title/oneLiner/problem/AC (nível atual). §16 e densidade vêm depois (refino + PRD irmão) | Mantém a 1ª análise rápida; não duplica o PRD de qualidade |
| **D7** | **PRD-000 Setup & Stack sempre** | Vitor **sempre** emite um PRD-000 de fundação como **raiz do DAG**; todo PRD de feature `dependsOn` ele | A Forja precisa de terreno antes da 1ª feature; sem raiz = tropeço |
| **D8** | Stack **fixa da casa, override possível** | Template-da-casa (Next + Supabase) parametriza o PRD-000 por default; Vitor/PM pode trocar no chat se o projeto pedir | Previsível pra Forja na maioria dos casos, flexível na exceção |
| **D9** | Gatilho determinístico da 1ª análise | `DesignSession.firstAnalysisStatus` (`pending`→`done`/`skipped`). O step `prd_briefing`, com thread vazio + status `pending`, dispara o kickoff e o chat marca `done` ao concluir | Sem flag, a 1ª análise re-dispararia a cada mount; flag torna idempotente |
| **D10** | Brief persiste na **session**, não em job | `DesignSession.launcherBrief` (nullable). `PrdQuickAskJob` deixa de ser criado no novo fluxo | O job era só carrier do brief + status do single-shot; sem single-shot, não precisa |
| **D11** | `subKind` mantido (`quick_ask`) | Sem migração de dados; a mudança é de **fluxo**, não de tipo de session | Evitar churn em queries/RLS que filtram por `subKind` |
| **D12** | Caminho antigo aposentado, não deletado em produção | `generatePrdsFromBrief` + worker + rota `jobs/[id]` ficam deprecados (sem novo call-site) e removidos em story dedicada após o novo fluxo validar | Rollback seguro; remoção atômica separada |
| **D13** | Ciclo de vida: **session draft no open** | Ao abrir o launcher, cria `DesignSession` draft (`status='draft'`, `firstAnalysisStatus='pending'`); insumos linkam ao vivo nessa session. OK **finaliza** (set `launcherBrief` + `status='in_progress'`) e navega; **cancelar/fechar sem finalizar deleta** a draft | Resolve §14.1 sem refatorar os modais (que já assumem `sessionId`); cancelar não deixa lixo |
| **D14** | `propose_prd` é **batch** (`{ prds: [...] }`) | A tool cria N PRDs num único call e retorna `{ created: [...] }`. O prompt da 1ª análise (contexto rico) cria o scaffold inteiro de uma vez, **sem pedir confirmação** | Descoberto no teste E2E (Allos): com 1-PRD-por-chamada o Sonnet parava no meio (criava 3 de 5) e pedia confirmação entre turnos. Batch segue o padrão canônico `write_brainstorm` ([_batched-write.ts](src/lib/agent/tools/_batched-write.ts)) e alinha com o few-shot de Inception, que já chamava `propose_prd({ prds: [...] })` |

---

## 6. Arquitetura

### 6.1 Fluxo novo

```
┌─ LAUNCHER (quick-ask-sheet.tsx, refatorado) ───────────────────────┐
│  ABRIR sheet:                                                      │
│    └─ POST /api/sessions/prd/quick-ask/draft  → 202 { sessionId }  │
│         INSERT DesignSession (type=prd_session, subKind=quick_ask, │
│           status='draft', firstAnalysisStatus='pending')          │
│                                                                    │
│  + InsumosButton → context-import (transcript / planilha / github) │
│      linka AO VIVO na session draft (infra existente, usa sessionId)│
│  + Textarea brief (OPCIONAL)                                       │
│                                                                    │
│  [Criar e abrir chat]                                              │
│    └─ PATCH /api/sessions/prd/quick-ask/[sessionId]/finalize       │
│         { brief? }  → valida brief>=10 OU >=1 insumo (senão 422)   │
│         set launcherBrief + status='in_progress'                  │
│    └─ router.push(/projects/[id]/sessions/[sessionId])            │
│                                                                    │
│  [Cancelar/fechar sem finalizar]                                   │
│    └─ DELETE /api/sessions/prd/quick-ask/[sessionId] (limpa draft) │
│  (NÃO cria PrdQuickAskJob, NÃO chama Haiku em nenhum momento)      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ COMMAND CENTER (prd-briefing-step.tsx, +gatilho) ─────────────────┐
│  on mount: thread vazio && firstAnalysisStatus==='pending'         │
│     └─ auto-POST kickoff → /api/design-sessions/[id]/chat          │
│           currentStepKey='prd_briefing', kickoff=true             │
│  Vitor (1ª análise ADAPTATIVA):                                    │
│     read_context_source(insumos) →                                 │
│       rico  → propose_prd × N  (PRD-000 Setup&Stack + features)    │
│              link_prd_dependency (todos dependsOn PRD-000)         │
│       ralo  → 2-3 perguntas no chat (sem propose_prd ainda)        │
│  chat marca firstAnalysisStatus='done' ao fim do turno            │
│  → refino conversacional normal (já existente)                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Componentes a criar / modificar

| Componente | Arquivo | Ação |
|---|---|---|
| Schema session | `supabase/migrations/20260601e_design_session_launcher_fields.sql` (novo) | `ALTER "DesignSession" ADD launcherBrief text, ADD firstAnalysisStatus text DEFAULT 'pending'` |
| Setup & Stack template | `src/lib/agent/agents/vitor/setup-stack-template.ts` (novo) | Template-da-casa (Next+Supabase) → `buildSetupStackPrd(overrides?)` retorna `ProposePrdInput` |
| Draft creator | `src/app/api/sessions/prd/quick-ask/draft/route.ts` (novo) | `POST` cria `DesignSession` draft (status=draft, firstAnalysisStatus=pending) e retorna `sessionId` |
| Finalize/cleanup | `src/app/api/sessions/prd/quick-ask/[sessionId]/route.ts` (novo) | `PATCH .../finalize` (set launcherBrief + status, valida brief-OU-insumo) e `DELETE` (limpa draft no cancel) |
| Session DAL | `src/lib/sessions/prd-session/dal.ts` | `createPrdDraftSession()`, `finalizePrdLauncherSession()`, `deletePrdDraftSession()` |
| Launcher sheet | `src/components/sessions/prd-session/quick-ask-sheet.tsx` | Remove polling/result; cria draft no open; embeda InsumosButton + context-import (linka ao vivo); brief opcional; OK finaliza + navega; cancel deleta draft |
| Vitor prompt | `src/lib/agent/prompt.ts` (step `prd_briefing`) | Diretriz de 1ª análise adaptativa + regra "sempre PRD-000 via template" |
| Chat kickoff | `src/app/api/design-sessions/[id]/chat/route.ts` | Trata `kickoff=true`: injeta brief + insumos no 1º turno; marca `firstAnalysisStatus='done'` |
| Kickoff trigger | `src/components/sessions/prd-session/prd-briefing-step.tsx` | on mount: thread vazio + `pending` → auto-submit kickoff |
| Deprecação | `src/lib/sessions/prd-session/jobs.ts`, `src/lib/agent/vitor/prompts/prd-quickask.ts`, `src/app/api/sessions/prd/quick-ask/jobs/[id]/route.ts` | Remover call-sites; remover em story dedicada após validação |

### 6.3 PRD-000 Setup & Stack — template-da-casa

`buildSetupStackPrd(overrides?)` retorna um `ProposePrdInput` macro com:
- `title`: "Setup & Stack — Fundação do Projeto"
- `oneLiner`: scaffold Next.js + Supabase, auth base, CI, migrations iniciais.
- `problem`: por que a fundação precede features (terreno pra Forja).
- `acceptanceCriteria`: scaffold roda, auth base funciona, migration inicial aplica, CI verde, `database.types.ts` gerado.
- `dependencies`: `[]` (é a raiz).

Overrides permitem trocar a stack (ex: `{ framework: 'remix' }`) — Vitor passa overrides quando o PM pede no chat.

---

## 7. Schema

### 7.1 Migration — campos de launcher na DesignSession

```sql
-- supabase/migrations/20260601e_design_session_launcher_fields.sql
ALTER TABLE "DesignSession"
  ADD COLUMN IF NOT EXISTS "launcherBrief" text,
  ADD COLUMN IF NOT EXISTS "firstAnalysisStatus" text NOT NULL DEFAULT 'pending'
    CHECK ("firstAnalysisStatus" IN ('pending', 'done', 'skipped'));

COMMENT ON COLUMN "DesignSession"."launcherBrief" IS
  'Brief opcional digitado no launcher do Quick-Ask (substitui PrdQuickAskJob.brief no fluxo novo).';
COMMENT ON COLUMN "DesignSession"."firstAnalysisStatus" IS
  'Gatilho idempotente da 1ª análise do Vitor no step prd_briefing: pending → done|skipped.';
```

RLS: nenhuma policy nova — colunas herdam a policy de `DesignSession` (já existente via `can_view_project`/`can_edit_session`). Sem nova tabela. Após aplicar, regenerar `src/lib/supabase/database.types.ts`.

### 7.2 Links de insumos

Sem DDL novo: reusa o mecanismo de links já existente ([project_entitylink_unification] + `useSessionFiles` + transcripts). `createPrdLauncherSession` linka os refs coletados no launcher após o INSERT da session, na mesma transação lógica.

---

## 8. APIs

| Método | Path | Contrato | Mudança |
|---|---|---|---|
| HTTP | `POST /api/sessions/prd/quick-ask/draft` | In: `{ projectId }`. Out: `202 { sessionId }` — cria session draft (status=draft, firstAnalysisStatus=pending) | **Endpoint novo** (chamado no open) |
| HTTP | `PATCH /api/sessions/prd/quick-ask/[sessionId]/finalize` | In: `{ brief?: string }`. Valida brief≥10 **OU** ≥1 insumo linkado; set launcherBrief + status=in_progress. Out: `202 { sessionId }`. **422** se sem brief e sem insumo | **Endpoint novo** (chamado no OK) |
| HTTP | `DELETE /api/sessions/prd/quick-ask/[sessionId]` | Deleta a session draft (só se ainda `status=draft`). Out: `204` | **Endpoint novo** (chamado no cancel) |
| HTTP | `POST /api/design-sessions/[id]/chat` | In existente + `kickoff?: boolean`. Quando `kickoff=true` e `firstAnalysisStatus='pending'`: injeta brief+insumos, roda 1ª análise, marca `done` | **Param novo** `kickoff` |
| HTTP | `POST /api/sessions/prd/quick-ask/start` + `GET .../jobs/[id]` | — | **Deprecados** (sem novo call-site; removidos na story de cleanup) |
| Tool | `propose_prd` / `update_prd` / `link_prd_dependency` / `read_context_source` | sem mudança de contrato | reusadas pela 1ª análise |

Nota: `start` continua retornando `202` (async-friendly), mas agora a operação é leve (INSERT + links) — o trabalho pesado migrou pro chat.

---

## 9. UX

> **Casca inalterada:** "Launcher" descreve o **papel** da sheet, não um componente novo. A UI continua sendo o mesmo `ResponsiveSheet size="lg"` (side sheet no desktop, bottom sheet no mobile) com o mesmo título "PRD Quick-Ask com Vitor". O que muda é **dentro** dela: brief opcional + `InsumosButton`/import entram; spinner de geração, lista de PRDs e botões "Aprovar" saem (migram pro chat). Ao confirmar, a sheet fecha e navega pro chat — não renderiza mais resultado.

### 9.1 Launcher (refatorado)

```
┌── PRD Quick-Ask com Vitor ───────────────────────────────┐
│  Importe insumos e/ou descreva a ideia. Vitor faz a      │
│  primeira análise no chat.                                │
│                                                           │
│  [ 📎 Insumos (2) ]   ← transcript · planilha · github   │
│   • call-discovery-cliente.txt        (transcript)        │
│   • requisitos-v3.xlsx                (planilha)          │
│                                                           │
│  DESCREVA SUA IDEIA  (opcional)                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Ex: foca no módulo de agendamento e pagamentos…     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│              [ Cancelar ]   [ Criar e abrir chat ]        │
└───────────────────────────────────────────────────────────┘
```

- Botão **Criar e abrir chat** habilita quando há **≥1 insumo OU brief ≥10 chars**.
- Sem polling, sem lista de PRDs na sheet — ao confirmar, navega.

### 9.2 Chat — 1ª análise (caminho rico)

```
Vitor: Li a transcrição da call e a planilha. Minha leitura inicial — 6 PRDs:

  • PRD-000  Setup & Stack (Next + Supabase)        [raiz]
  • PRD-001  Autenticação & Onboarding         ← dep: 000
  • PRD-002  Agenda & Disponibilidade          ← dep: 000
  • PRD-003  Pagamentos                        ← dep: 000, 001
  • PRD-004  Notificações                      ← dep: 000, 002
  • PRD-005  Painel do Prestador               ← dep: 000, 002

Quer ajustar o recorte antes de eu detalhar? Posso dividir, juntar ou trocar a stack.
```

### 9.3 Chat — 1ª análise (caminho ralo)

```
Vitor: O brief é curto e não anexou insumos. Antes de propor os PRDs, 3 perguntas:
  1. Quem é o usuário principal — prestador, cliente, admin?
  2. Tem integração de pagamento prevista? Qual gateway?
  3. É web, mobile ou os dois?
```

---

## 10. Integrações

| Sistema | Integração |
|---|---|
| **context-import** (`src/components/agent/context-import/`) | Embedado no launcher; os mesmos modais (transcript/planilha/github) coletam refs que `start` linka na criação. |
| **Chat Vitor** (`/api/design-sessions/[id]/chat`) | Recebe `kickoff` e roda a 1ª análise; reusa tools + `read_context_source`. |
| **Forja** ([src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts)) | Passa a receber sempre um PRD-000 raiz; consome a ordem topológica do DAG. |
| **PRD de qualidade** ([prd-vitor-prd-authoring-quality.md](docs/prd/backlog/prd-vitor-prd-authoring-quality.md)) | Define a barra/§16 que roda **depois** do scaffold macro deste PRD. Fronteira explícita. |

---

## 11. Faseamento

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **1 — Fundação + launcher** | Migration (campos session) + Setup&Stack template + `createPrdLauncherSession` + launcher refatorado (insumos + brief opcional) + start v2 | Abrir launcher, anexar 1 insumo sem brief, dar OK → session criada com insumos linkados + navega pro chat. Brief sozinho ainda funciona. |
| **2 — 1ª análise no chat** | Prompt `prd_briefing` (adaptativo + PRD-000 sempre) + kickoff trigger + chat `kickoff` handler | Session nova com insumos ricos → Vitor auto-propõe scaffold com PRD-000 raiz; insumos ralos → Vitor faz perguntas. `firstAnalysisStatus` vira `done`. |
| **3 — Cleanup** | Remover `generatePrdsFromBrief`, worker `jobs.ts`, rota `jobs/[id]` | `grep` não encontra call-sites; build verde; fluxo antigo some sem quebrar upload. |

Fase 1 entrega **mais** que o sistema atual: insumos na porta de entrada (que hoje não existem) + criação atômica de session com contexto. A geração de PRDs migra pro chat na Fase 2 — até lá, o chat de refino já permite o PM pedir os PRDs manualmente (paridade), então não há regressão funcional dura.

---

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| 1ª análise no chat fica lenta (lê insumos grandes via tool) | Média | Média | `read_context_source` lê sob demanda + truncado; Vitor resume antes de propor; medir latência no piloto |
| Session draft órfã (PM abre launcher, anexa, fecha aba sem cancelar) | Média | Baixa | Cancelar/fechar explícito chama DELETE; pra abandono sem evento (fechar aba), sweep periódico deleta drafts `status=draft` + `firstAnalysisStatus=pending` com `createdAt` > 24h e sem PRDs |
| Kickoff dispara em duplicidade (race no mount) | Média | Alta | `firstAnalysisStatus='pending'` como lock idempotente; guarda client-side `useRef` + check server antes de rodar |
| Vitor esquece de emitir o PRD-000 | Média | Alta | Regra dura no prompt + checagem: se scaffold não tem raiz sem deps, Vitor injeta `buildSetupStackPrd()` antes de finalizar o turno |
| Stack-da-casa não serve o projeto (cliente quer outra) | Baixa | Média | Override no template via chat (D8); PRD-000 é editável como qualquer PRD |
| Remoção do caminho antigo quebra algo não mapeado | Baixa | Alta | Fase 3 isolada; remoção só após Fase 2 validar; `grep` de call-sites antes de deletar |
| Brief opcional + insumo vazio = session sem contexto | Baixa | Média | Validação 422 no `start` (brief OU insumo obrigatório) |

---

## 13. Métricas de sucesso

| Métrica | Instrumento | Baseline | Target v1 |
|---|---|---|---|
| % de PRD Sessions criadas via launcher com ≥1 insumo | `SELECT COUNT(*) FILTER (WHERE existe link de insumo) / COUNT(*) FROM "DesignSession" WHERE "subKind"='quick_ask' AND "createdAt" > <fase1-deploy>` | 0% (insumos não entram hoje) | ≥ 60% |
| % de sessions launcher cujo scaffold inclui PRD-000 raiz | Query: PRDs com `dependencies=[]` e título matching Setup&Stack por session | 0% | 100% |
| Tempo OK→1º scaffold visível no chat | Telemetria client (`firstAnalysisStatus` pending→done) | n/a (não existe) | < 60s p50 |
| % de 1ªs análises que perguntam (caminho ralo) quando sem insumo+brief curto | Log de turnos `prd_briefing` kickoff sem `propose_prd` | n/a | medir (esperado quando contexto ralo) |
| Runs de Forja que tropeçam por falta de fundação | Log estruturado da Forja em [src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts) | ~30% (observação 05/2026) | < 10% |

---

## 14. Open questions

1. **Github como insumo de planejamento** — repo pode ser grande; o Vitor lê via `read_context_source` resumido ou só metadados (README/estrutura)? **Quem resolve:** piloto Fase 2. **Fase:** 2 (não-bloqueante).

---

## 15. Referências

- [prd-vitor-prd-authoring-quality.md](docs/prd/backlog/prd-vitor-prd-authoring-quality.md) — barra de qualidade + §16 (fronteira explícita: este PRD é o fluxo, aquele é o conteúdo).
- [prd-vitor-output-as-prd.md](docs/prd/backlog/prd-vitor-output-as-prd.md) — entidade `ProductRequirement`.
- [prd-forge-from-vitor.md](docs/prd/backlog/prd-forge-from-vitor.md) — consumidor downstream.
- [quick-ask-sheet.tsx](src/components/sessions/prd-session/quick-ask-sheet.tsx) — launcher atual.
- [jobs.ts](src/lib/sessions/prd-session/jobs.ts) + [prd-quickask.ts](src/lib/agent/vitor/prompts/prd-quickask.ts) — caminho single-shot (a aposentar).
- [prd-briefing-step.tsx](src/components/sessions/prd-session/prd-briefing-step.tsx) — command center reusado.
- [context-import/](src/components/agent/context-import/) — infra de insumos.
- Memories: `project_vitor_as_pm`, `project_vitor_context_pool`, `feedback_agent_ui_parity`, `project_forge_double_diamond`.

---

## 16. Stories implementáveis

```yaml
- id: QAL-001
  title: Migration — campos launcherBrief + firstAnalysisStatus na DesignSession
  description: |
    ALTER "DesignSession" adicionando launcherBrief (text, nullable) e firstAnalysisStatus
    (text NOT NULL default 'pending', CHECK in pending|done|skipped). Regenerar database.types.ts.
  acceptanceCriteria:
    - "supabase/migrations/20260601e_design_session_launcher_fields.sql aplicado via psql"
    - "Coluna launcherBrief existe (nullable text)"
    - "Coluna firstAnalysisStatus existe com CHECK (pending|done|skipped) e default 'pending'"
    - "src/lib/supabase/database.types.ts regenerado com os 2 campos"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='DesignSession' AND column_name IN ('launcherBrief','firstAnalysisStatus')"
      expected: "2"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches:
    - supabase/migrations/20260601e_design_session_launcher_fields.sql
    - src/lib/supabase/database.types.ts

- id: QAL-002
  title: Template Setup & Stack (PRD-000 da casa)
  description: |
    src/lib/agent/agents/vitor/setup-stack-template.ts exporta buildSetupStackPrd(overrides?)
    retornando um ProposePrdInput macro com a stack-da-casa (Next + Supabase): title, oneLiner,
    problem, acceptanceCriteria (scaffold/auth/migration/CI/types), dependencies=[]. Overrides
    permitem trocar framework/db.
  acceptanceCriteria:
    - "buildSetupStackPrd() retorna objeto que passa o Zod de ProposePrdInput (parse sem throw)"
    - "dependencies é [] (raiz do DAG)"
    - "Override { framework: 'remix' } reflete no oneLiner/AC"
    - "Teste vitest cobre default + 1 override"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "npx tsx src/lib/agent/agents/vitor/setup-stack-template.test.ts"
      expected: "All setup-stack-template tests passed."
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitor/setup-stack-template.ts
    - src/lib/agent/agents/vitor/setup-stack-template.test.ts

- id: QAL-003
  title: Endpoints draft/finalize/delete + DAL da session launcher
  description: |
    Ciclo de vida draft-no-open. dal.ts ganha createPrdDraftSession({projectId, actorMemberId})
    (INSERT DesignSession type=prd_session, subKind=quick_ask, status='draft',
    firstAnalysisStatus='pending'), finalizePrdLauncherSession({sessionId, brief}) (valida brief>=10
    OU >=1 insumo linkado; set launcherBrief + status='in_progress') e deletePrdDraftSession (só se
    status='draft'). Rotas: POST draft, PATCH [sessionId]/finalize, DELETE [sessionId].
  acceptanceCriteria:
    - "POST /api/sessions/prd/quick-ask/draft {projectId} retorna 202 + sessionId com status='draft'"
    - "PATCH .../[sessionId]/finalize com >=1 insumo linkado e sem brief retorna 202; status vira 'in_progress'"
    - "PATCH finalize sem brief e sem insumo retorna 422"
    - "DELETE .../[sessionId] em session draft retorna 204 e remove a session"
    - "DELETE em session já finalizada (status!='draft') é no-op/403"
    - "Nenhuma row em PrdQuickAskJob é criada"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "PATCH /api/sessions/prd/quick-ask/[id]/finalize {} em draft sem brief e sem insumo"
      expected: "status 422"
  dependsOn: [QAL-001]
  estimateMinutes: 30
  touches:
    - src/app/api/sessions/prd/quick-ask/draft/route.ts
    - src/app/api/sessions/prd/quick-ask/[sessionId]/route.ts
    - src/lib/sessions/prd-session/dal.ts

- id: QAL-004
  title: Launcher sheet refatorado (draft no open + insumos ao vivo + finalize)
  description: |
    quick-ask-sheet.tsx remove polling/jobStatus/lista-de-PRDs. Ao abrir, cria session draft (POST
    draft) e usa o sessionId pra linkar insumos AO VIVO via context-import (InsumosButton +
    transcript/planilha/github). Brief opcional. Botão "Criar e abrir chat" habilita com >=1 insumo
    OU brief>=10; chama finalize e router.push pro chat. Cancelar/fechar sem finalizar chama DELETE.
  acceptanceCriteria:
    - "Shell preservado: continua o mesmo ResponsiveSheet size=lg (não trocar por dialog/página)"
    - "Abrir a sheet cria a session draft (POST draft) e a usa pra linkar insumos"
    - "Sheet exibe InsumosButton + textarea de brief marcado como opcional"
    - "Botão de submit desabilitado quando sem insumo E brief<10 chars"
    - "Submit chama PATCH finalize e navega pra /projects/[id]/sessions/[sessionId]"
    - "Cancelar/fechar sem finalizar chama DELETE da draft"
    - "Nenhum setInterval/poll remanescente no componente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir launcher, anexar 1 transcript sem brief, clicar Criar e abrir chat"
      expected: "navega pro chat da session com o insumo linkado; fechar antes deleta a draft"
  dependsOn: [QAL-003]
  estimateMinutes: 30
  touches:
    - src/components/sessions/prd-session/quick-ask-sheet.tsx

- id: QAL-005
  title: Prompt da 1ª análise adaptativa + regra PRD-000 sempre
  description: |
    Step prd_briefing em src/lib/agent/prompt.ts ganha diretriz de 1ª análise: ler insumos via
    read_context_source; se ricos, propor scaffold macro com propose_prd + link_prd_dependency
    (todos dependsOn o PRD-000); se ralos/ambíguos, fazer 2-3 perguntas antes. Regra dura: SEMPRE
    emitir PRD-000 Setup & Stack como raiz (usar buildSetupStackPrd como base).
  acceptanceCriteria:
    - "Prompt prd_briefing instrui comportamento adaptativo (scaffold vs perguntar) explícito"
    - "Prompt obriga PRD-000 Setup & Stack como raiz do DAG, referenciando o template"
    - "Smoke: kickoff com insumo rico produz >=2 PRDs incluindo um PRD-000 com dependencies vazio"
    - "Smoke: kickoff sem insumo e brief curto produz perguntas (nenhum propose_prd no 1º turno)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Criar session via launcher com transcript rico e observar 1º turno do Vitor"
      expected: "scaffold com PRD-000 raiz + features dependsOn 000"
  dependsOn: [QAL-002]
  estimateMinutes: 30
  touches:
    - src/lib/agent/prompt.ts

- id: QAL-006
  title: Kickoff trigger (chat auto-roda 1ª análise + marca status)
  description: |
    prd-briefing-step.tsx: on mount, se thread vazio e firstAnalysisStatus==='pending', auto-submete
    um kickoff pro /api/design-sessions/[id]/chat com kickoff=true (guard via useRef pra não duplicar).
    A rota /chat trata kickoff=true: injeta launcherBrief + insumos no 1º turno, roda a análise e
    marca firstAnalysisStatus='done' ao concluir.
  acceptanceCriteria:
    - "Mount de session pending com thread vazio dispara exatamente 1 kickoff (sem duplicar em re-render)"
    - "Rota /chat com kickoff=true injeta brief+insumos e roda 1ª análise"
    - "Ao concluir o turno, firstAnalysisStatus vira 'done' no DB"
    - "Re-abrir a session (status já 'done') NÃO re-dispara kickoff"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Criar session via launcher e observar: Vitor responde sozinho 1x; recarregar página não re-dispara"
      expected: "1ª análise automática única; status=done após"
  dependsOn: [QAL-001, QAL-004, QAL-005]
  estimateMinutes: 30
  touches:
    - src/components/sessions/prd-session/prd-briefing-step.tsx
    - src/app/api/design-sessions/[id]/chat/route.ts

- id: QAL-007
  title: Cleanup — aposentar caminho single-shot
  description: |
    Remover generatePrdsFromBrief (prd-quickask.ts), o worker runPrdQuickAskJob/enqueuePrdQuickAskJob
    (jobs.ts) e as rotas antigas start/route.ts + jobs/[id]/route.ts, confirmando que não há call-sites
    remanescentes após o fluxo novo. Não remover a tabela PrdQuickAskJob nesta story (drop de schema em
    migration separada futura).
  acceptanceCriteria:
    - "grep por generatePrdsFromBrief|runPrdQuickAskJob|enqueuePrdQuickAskJob retorna 0 call-sites"
    - "Arquivos start/route.ts e jobs/[id]/route.ts removidos"
    - "Build e typecheck verdes após remoção"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "grep -rn 'generatePrdsFromBrief\\|runPrdQuickAskJob\\|enqueuePrdQuickAskJob' src/ | wc -l"
      expected: "0"
  dependsOn: [QAL-006]
  estimateMinutes: 20
  touches:
    - src/lib/sessions/prd-session/jobs.ts
    - src/lib/agent/vitor/prompts/prd-quickask.ts
    - src/app/api/sessions/prd/quick-ask/start/route.ts
    - src/app/api/sessions/prd/quick-ask/jobs/[id]/route.ts
```

**Total estimado:** 185 minutos (~3h05min) — 7 stories, cabem em context windows separadas.

**DAG:**

```
QAL-001 ─┬─ QAL-003 ── QAL-004 ─┐
         │                       ├─ QAL-006 ── QAL-007
QAL-002 ─┴─ QAL-005 ────────────┘
```

Fase 1 = QAL-001 + QAL-002 + QAL-003 + QAL-004. Fase 2 = QAL-005 + QAL-006. Fase 3 = QAL-007.
