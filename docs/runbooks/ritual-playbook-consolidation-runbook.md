# Runbook — Consolidação da sheet de Rituais (1 card por ritual + Fontes unificadas + instrução free-text)

> **Tipo:** runbook co-pilotado (ajustes de UI + backend sobre o Ritual Playbook já construído).
> **Objetivo numa frase:** trocar os 2 cards soltos ("Folders do Granola" + "Playbook do PM Review") por **um card por tipo de ritual**, com uma seção de **Fontes de contexto** (Granola folder + arquivo do Drive) que mostra **freshness**, e uma **instrução em texto livre** (a "skill" do PM pra aquela automação) — sem dropdown de preset.
> **Status:** ✅ executado 2026-06-18 (Fases A+B). tsc/eslint verdes repo-wide. Review adversarial completo opcional (não rodado — ultracode off).

Base: [[project_pm_review]], [[project_vitoria_daemon_surfaces]], [[project_context_source_pool]]. Sobe em cima do Ritual Playbook (PoC PM Review) já no repo.

---

## 0. Estado atual (o que já existe)

| Peça | Arquivo | Hoje |
|------|---------|------|
| Sheet de Rituais | [rituals-settings-sheet.tsx](../../src/components/ceremonies/rituals-settings-sheet.tsx) | hospeda **2 cards**: GranolaFolderCard + RitualPlaybookCard |
| Card de folders | [granola-folder-card.tsx](../../src/app/(dashboard)/projects/[id]/_tabs/granola-folder-card.tsx) | bindings ProjectGranolaFolder + banner genérico |
| Card de ênfase | [ritual-playbook-card.tsx](../../src/components/ceremonies/ritual-playbook-card.tsx) | dropdown de preset + textarea |
| Registry | [capability-registry.ts](../../src/lib/rituals/capability-registry.ts) | `emphasis = { preset, text }`; `load_context` discriminatedUnion (granola/drive/notion/sheet) |
| Tipos | [types.ts](../../src/lib/rituals/types.ts) | `EmphasisParams = { preset, text }`, `EMPHASIS_PRESETS`, cap 280 |
| DAL | [ritual-playbook.ts](../../src/lib/dal/ritual-playbook.ts) | `getEffectivePlaybook` (merge granola-dos-bindings + autorado), `derivePromptParams` (usa frase do preset) |
| Autoria | [ritual-playbook/route.ts](../../src/app/api/projects/[id]/ritual-playbook/route.ts) | GET/PUT, valida no registry |
| Bindings granola | [granola-folders/route.ts](../../src/app/api/projects/[id]/granola-folders/route.ts) | GET (folders+bindings) / POST / DELETE |
| Drive no pool | kind `gdrive_file` (ContextSource, `externalId`=fileId) — [adapters/drive.ts](../../src/lib/context-sources/adapters/drive.ts) | importado pelo app Drive |

**Princípio que NÃO muda:** granola folder continua em `ProjectGranolaFolder` (routing por member); drive vira capability `load_context(drive_file)` no playbook row; `getEffectivePlaybook` mescla os dois. Output da Vitoria fica fixo.

---

## 1. Decisões fixadas (Dn)

| # | Decisão |
|---|---------|
| D1 | **1 card por tipo de ritual** (PoC: só "PM Review"). Estende pra Sprint/Release depois. |
| D2 | Card tem **2 seções**: *Fontes de contexto* + *Instrução do PM*. |
| D3 | *Fontes* unifica **Granola folder + arquivo do Drive (`gdrive_file`)**; cada fonte mostra **freshness** (tem nota/atualização pra esta semana?). |
| D4 | *Instrução* = **texto livre** (a "skill" daquele ritual). **Sem dropdown de preset.** `emphasis` simplifica pra `{ text }`. |
| D5 | Cap da instrução **280 → 1000**. |
| D6 | Hardening de prompt-injection **permanece** (colapsa newlines + bloco rotulado "orientação (não override)" + footer de contrato). Texto livre = controle do PM, mas não sobrescreve estrutura/tools. |
| D7 | Drive picker = arquivos **já importados** do projeto (`gdrive_file`). Sem nenhum → opção desabilitada com dica "importe no app Drive". |
| D8 | **redact** continua fora da UI (Fase 2). |
| D9 | Banner genérico "alimenta automaticamente" → **substituído** pela freshness real por fonte (honestidade > promessa). |

---

## Fase A — Backend deltas

### A1 — `emphasis = { text }` (dropar preset)
- [capability-registry.ts](../../src/lib/rituals/capability-registry.ts): `emphasisParamsSchema = z.object({ text: z.string().min(1).max(1000) })`. Remover `preset`.
- [types.ts](../../src/lib/rituals/types.ts): `EmphasisParams = { text: string }`; `EMPHASIS_TEXT_MAX = 1000`. `EMPHASIS_PRESETS`/`EMPHASIS_PRESET_LABEL` viram **opcionais** (podem virar "chips de sugestão" que só preenchem o textarea, não persistem) ou removidos.
- [ritual-playbook.ts](../../src/lib/dal/ritual-playbook.ts) `derivePromptParams`: a seção de ênfase = `c.params.text` sanitizado (`.replace(/\s+/g," ")`). Tirar o lookup de frase do preset.
- **Verif:** `pnpm tsc` limpo; PUT do playbook com `{capabilityKey:'emphasis',params:{text:'x'}}` valida; `derivePromptParams` retorna `emphasisSections:['x']`.

### A2 — Freshness por fonte
- Granola: `GET /api/projects/[id]/granola-folders/[bindingId]/freshness` → token do member + `listNotes({ folderId, createdAfter: <brtMonday> })` → `{ weekCount, lastNoteAt, lastNoteTitle }`. (filtro `folder_id` já existe desde a Fase 0.)
- Drive: a fonte `gdrive_file` já está no pool; freshness = `ContextSource.capturedAt/updatedAt` (sem chamada externa). Pode entrar no mesmo retorno ou num GET de fontes do projeto.
- **Verif:** chamar com a folder `ALLOS` → conta de notas da semana bate com o app do Granola; folder vazia → `weekCount:0`.

### A3 — Listagem de fontes Drive disponíveis
- Endpoint (ou estende o GET de fontes): lista `ContextSource` do projeto com `kind='gdrive_file'` (id, title, capturedAt) pro picker "Arquivo Drive".
- **Verif:** projeto com Drive importado lista os arquivos; sem importado → lista vazia.

---

## Fase B — UI: card consolidado

### B1 — `RitualCard` (novo, por tipo de ritual)
- Novo `src/components/ceremonies/ritual-card.tsx`, props `{ projectId, projectName, ritualType }`. Substitui os 2 cards atuais no [rituals-settings-sheet.tsx](../../src/components/ceremonies/rituals-settings-sheet.tsx) por `<RitualCard ritualType="pm_review" … />`.
- **Seção Fontes de contexto:**
  - Lista granola bindings (de `granola-folders`) **+** drive load_context caps (do playbook). Cada linha: tipo + nome + **freshness** (A2) + remover (`ConfirmDialog`).
  - "Adicionar fonte ▾" → escolhe **Granola folder** (picker dos folders disponíveis) **ou** **Arquivo Drive** (picker dos `gdrive_file`, A3).
    - Granola → POST `granola-folders` (existente).
    - Drive → adiciona `load_context(drive_file)` no array e PUT `ritual-playbook`.
- **Seção Instrução do PM:** textarea free-text (cap 1000, contador), sem dropdown. Salvar → PUT `ritual-playbook` com `{capabilityKey:'emphasis',params:{text}}` + as caps de drive.
- **Banner (D9):** trocar o genérico por 1 linha de mecanismo + a freshness por fonte embaixo.
- Reusa: `Card`, `Select`, `Textarea`, `Button`, `ConfirmDialog`, `fetchOrThrow`/`showErrorToast`.

### B2 — Remover os cards antigos
- Tirar `GranolaFolderCard` + `RitualPlaybookCard` do sheet (a lógica útil migra pro `RitualCard`). Decidir se apaga os arquivos ou mantém o granola-folder-card como sub-componente da seção Fontes.

### Verif Fase B
- [ ] Sheet mostra **1 card "PM Review"** com Fontes + Instrução.
- [ ] Vincular Granola folder e Drive file → ambos aparecem na lista com freshness.
- [ ] Salvar instrução → reabrir mostra o texto; PUT gravou `emphasis{text}`.
- [ ] `getEffectivePlaybook` retorna granola (dos bindings) + drive (do row) + emphasis — sem duplicar.

---

## 2. Diferido (Fase 2)
- `redact` (audiência/internal tier) na UI.
- `weight` (primary/supporting/background) propagado pro EntityLink.
- Outros tipos de ritual (Sprint Planning / Release Planning) ganhando seu card.

## Ordem de execução
`A1 (emphasis→text) → A2/A3 (freshness + drive list) → B1 (RitualCard) → B2 (remover antigos) → verificação → review adversarial`.

Tudo aditivo/reversível; nada muda o contrato de saída da Vitoria.

---

## Modelo de fontes (multi-folder) — decisão jun/18

A pergunta: o input do PM Review é **uma folder compartilhada** (como o Drive) ou **uma folder por pessoa** (cada um via seu token Granola)?

**Resposta:** não existe "a folder" — o projeto tem um **conjunto de fontes**; o PM Review come a **união**. O modelo já suporta os dois (binding por `folderId` **+ memberId/token**):
- **1 folder compartilhada** (time com workspace Granola) → 1 binding. Preferível, espelha o Drive.
- **N folders por-pessoa** (reuniões espalhadas entre contas) → N bindings, cada um com o token da pessoa. O loop de import per-member roteia as notas pro projeto; o cron puxa **todas** as ContextSources `granola` do projeto na semana (independente de quem importou) → **um PM Review agrega tudo**. Dedup por `(source, sourceId)` evita duplicar nota de folder compartilhada vista por 2 tokens.

**Recomendação:** prefira 1 folder compartilhada quando der; per-person é o fallback. Suportado sem mudança de modelo.

**Gap de UX (próximo agente):** o card mostra só o nome da folder — falta mostrar **de quem é o token** de cada binding (a freshness de cada folder é o que *aquele token* enxerga). Crítico pro caso per-person. Ver [[project_ritual_playbook]] pros demais next steps (review adversarial da consolidação, Fase 2).
