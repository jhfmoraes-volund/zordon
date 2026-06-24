# Plano — Unificação da UI de Insumos (importação + consumo de contexto)

> **Status (2026-06-01):** ENTREGUE o núcleo (U1–U5). Decisão do João: NÃO mexer
> nos rituais que funcionam — PM Review fica transcript-only, U6 (unlink único)
> adiado, Planning mantém modais próprios (manifest/branch). Detalhe no fim (§7).
> **Contexto:** o backend já foi unificado em `ContextSource` (ver [context-source-unification-plan](context-source-unification-plan.md) + [[project_entitylink_unification]]). Isto é o **último quilômetro na UI**.
> **Decisões fixadas:** (1) nome único = **"Insumos"** na UI (`ContextSource` segue como termo técnico/código); (2) capabilities completas (`transcript + spreadsheet + github`) em **todas as superfícies de curadoria**.
> **Conclui:** o PRD `prd-context-import-unified.md` (status blocked).

---

## 1. Diagnóstico (estado atual)

Base **compartilhada e boa**: `ContextSheet` + `TranscriptModal` em `src/components/agent/context-import/`. Mas a integração diverge por superfície:

| Superfície | Componente | Importa hoje | Ribbon próprio |
|---|---|---|---|
| Inception (DS) | `design-session/pre-work-step.tsx` | só transcript | briefing-ribbon / ds-ribbon |
| PRD Session | `sessions/prd-session/prd-briefing-step.tsx` | **só transcript** | prd-briefing-ribbon |
| Quick Ask | `sessions/prd-session/quick-ask-sheet.tsx` (próprio) | fora da infra | — |
| Meetings | — | sem painel | — |
| Planning (Ritual) | `planning/context-sheet.tsx` | transcript+planilha+github | planning-ribbon |
| PM Review (Ritual) | `pm-review/pm-review-context-sheet.tsx` | só transcript | pm-review-ribbon |
| Sprint | `sprint/sprint-context-sheet.tsx` (próprio) | (próprio) | sprint-ribbon |

**Problemas:**
1. **Label:** botões/ribbons dizem "Insumos"; PM Review chama "Contexto". → padronizar p/ **"Insumos"**.
2. **Capabilities ad-hoc:** PRD briefing é `capabilities={{ transcript: true }}` → Vitor não vê import de planilha/github (bug observado).
3. **Duplicação sobre a base:** 6+ ribbons com botão "Insumos" próprio (`context-ribbon.tsx` genérico está órfão); modais duplicados (Planning tem `SpreadsheetImportModal`/`GitHubRepoModal` próprios; os genéricos `SpreadsheetModal`/`GithubSourceModal` nunca são usados); Quick Ask com sheet próprio; 3 contratos de unlink divergentes.

---

## 2. Wrinkle importante (rota, não só prop)

Ligar `capabilities` não basta. Hoje **só o Planning tem as rotas de import de planilha/github wired** (`/api/planning/[id]/sources/spreadsheet`, `/api/projects/[id]/repo`) — específicas de planning/projeto.

Pras superfícies DS (Inception/PRD/QuickAsk), importar planilha/github precisa de um fluxo **criar + linkar** genérico:
- `POST /api/context-sources` (cria o ContextSource — já existe, já escreve ContextSource pós-cutover)
- `POST /api/design-sessions/[id]/context/link` (linka via EntityLink.contextSourceId — já existe)

Os modais genéricos órfãos (`SpreadsheetModal`/`GithubSourceModal`) já apontam pro `POST /api/context-sources` — falta o **segundo passo de link** e plugá-los. Decisão de design: ou (a) modal faz as 2 chamadas, ou (b) um endpoint combinado `POST /api/<host>/[id]/context/import` que cria+linka atômico. **Recomendo (b)** — 1 contrato por host, atômico, espelha o que o Planning já faz inline.

---

## 3. Alvo

- **Um nome:** "Insumos" em botão, título e ribbon de toda superfície.
- **Um botão de Insumos compartilhado (NÃO um ribbon único):** cada superfície mantém seu próprio ribbon e seu conteúdo específico (sprint = pills de capacidade, DS = progresso de step, planning = fase, etc.). Extrai-se só o **`InsumosButton`** (label "Insumos" + contador + ícone + `onClick`) como primitivo único que cada ribbon embeda. Padroniza o botão sem achatar os ribbons — mesmo princípio de não forçar conceitos diferentes na mesma caixa.
- **Um `ContextSheet`** (já existe) com `capabilities` completas em todas as superfícies de curadoria.
- **Um par de modais:** `SpreadsheetModal` + `GithubModal` canônicos (matar órfãos + duplicatas do Planning), abertos via handlers do `ContextSheet`.
- **Um endpoint de import por host** (`create+link` atômico) — Planning migra do seu fluxo próprio pra esse.
- **Um contrato de unlink:** `DELETE /api/<host>/[id]/context/[linkId]`.
- **Quick Ask** migra pro `ContextSheet`. **Meetings**: fora de escopo nesta entrega (transcript é intrínseco; decidir painel depois).

---

## 4. Fases

| Fase | Escopo | Arquivos | Risco |
|---|---|---|---|
| **U1 — Label** | "Contexto" → "Insumos" em PM Review + garantir "Insumos" em todos os ribbons | `pm-review-wizard.tsx`, ribbons | baixo |
| **U2 — Endpoint import genérico** | `POST /api/design-sessions/[id]/context/import` (create+link) + idem outras hosts; ou generalizar | rotas API novas | médio |
| **U3 — Modais canônicos** | adotar `SpreadsheetModal`+`GithubModal` genéricos, wired via handlers; matar duplicatas do Planning + órfãos | `agent/context-import/*`, `planning/*-modal.tsx` | médio |
| **U4 — Capabilities full** | ligar `transcript+spreadsheet+github` em Inception, PRD, Quick Ask, PM Review (Planning já tem) + wire handlers | `pre-work-step`, `prd-briefing-step`, `pm-review-context-sheet`, `quick-ask-sheet` | médio |
| **U5 — `InsumosButton` compartilhado** | extrair 1 botão Insumos (label+contador+ícone+onClick); cada ribbon existente embeda. NÃO colapsa os ribbons — respeita o conteúdo de cada superfície. Inclui padronizar "Contexto"→"Insumos" no planning-ribbon | novo `agent/context-import/insumos-button.tsx` + os 6 ribbons | baixo-médio |
| **U6 — Unlink contract** | normalizar pra `DELETE /.../context/[linkId]` em todas as hosts | rotas + chamadas client | baixo |

**Ordem:** U1 (quick win, destrava o label) → U2/U3 (infra de import) → U4 (liga capabilities, conserta o bug do briefing) → U5 (ribbon) → U6 (unlink). U1 e U4 sozinhas já resolvem os 2 sintomas que o João viu.

---

## 5. Riscos

| Risco | Mitigação |
|---|---|
| Endpoint create+link novo quebrar fluxo do Planning | migrar Planning por último; manter rota antiga até validar |
| Modal canônico não cobrir caso do Planning (repo manifest/branch) | Github do Planning tem extras (manifest) — manter painel custom do Planning OU portar os extras pro modal canônico |
| Quick Ask tem semântica própria | revisar `quick-ask-sheet` antes de migrar; pode precisar de prop nova |
| Paridade Vitor/Vitoria | seguir [[feedback_agent_ui_parity]] — diferença só por prop |

---

## 6. Próximo passo

Revisar. Se ok, começo por **U1 + U4** (resolvem os 2 sintomas visíveis: label "Insumos" unificado + Vitor briefing passa a mostrar planilha/github), depois U2/U3/U5/U6.

---

## 7. Entregue (2026-06-01)

**Núcleo — DONE, verificado (tsc 0 + eslint 0), nada commitado:**

- **U1 (label)** — "Insumos" em todo lugar: `InsumosButton` nos 3 ribbons (planning/pm-review/prd-briefing) + step action da Inception; título do `ContextSheet` ("Contexto da X" → "Insumos · X"); wizard PM Review ("Contexto" → "Insumos"); `ritualLabel` "planning" → "Planning".
- **U5 (`InsumosButton`)** — novo primitivo `src/components/agent/context-import/insumos-button.tsx` (label + ícone FileText + contador). Embedado em cada ribbon **sem colapsá-los**. `variant` por superfície.
- **U4 (capabilities full)** — Inception (`pre-work-step`) + PRD (`prd-briefing-step`) agora têm transcript+planilha+github via novo wrapper `src/components/design-session/design-session-context-sheet.tsx`. Conserta o sintoma do Vitor briefing.
- **U2 (create+link)** — SEM endpoint novo: o modal cria o `ContextSource` (`POST /api/context-sources`) e o wrapper linka (`POST /api/design-sessions/[id]/context/link`), unlink via `DELETE /context/[linkId]`. Reusa rotas que já existiam.
- **U3 (modais canônicos)** — adotados `SpreadsheetModal` + `GitHubSourceModal` (eram órfãos); corrigidos 2 bugs reais (mandavam `fileBase64` em vez de `file`; faltava `title` em gsheets/github). Removido `context-ribbon.tsx` (órfão, 0 usos).

**Fora de escopo / decidido NÃO fazer (João, 2026-06-01):**

- **Quick Ask** — não é superfície de curadoria (brief → gera PRDs; sem sessionId pra anexar). Sem insumos panel.
- **PM Review capabilities full** — fica transcript-only (ritual funciona; rotas plural `/api/pm-reviews/[id]/context/*` existem se um dia ligar).
- **U6 (unlink único)** — adiado. Hoje 3 contratos (DS `/context/[linkId]`, PM Review `/transcripts/[id]`, Planning próprio) — todos batem em `EntityLink` por id, funciona. Normalização é higiene, não bug.
- **Planning** — mantém modais próprios (`SpreadsheetImportModal`/`GitHubRepoModal`); o github dele é config de repo do projeto (manifest/branch), semanticamente distinto de "linkar source".

**Pendente de teste do João → depois drop:** validar fluxo planilha/github no Vitor briefing + Inception (criar→linkar→desvincular). Drop dos modais Planning NÃO se aplica (mantidos). Bucket `context-source-files` precisa existir pro upload CSV.
