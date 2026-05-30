# PRD — Context Import Unificado (Vitor + Vitoria)

**Status:** backlog
**Autor:** João (capturado por Claude em 2026-05-29)
**Parent / relacionados:** [prd-vitor-output-as-prd](../backlog/prd-vitor-output-as-prd.md), [prd-vitor-discovery-only](../done/prd-vitor-discovery-only.md)

---

## §1 Problema

1. **Vitor e Vitoria importam contexto de jeitos diferentes**, mesmo consumindo a mesma SSOT (`TranscriptRef`). Vitoria tem **ribbon + InsumosSheet** com curadoria explícita (linkar/deslinkar do pool, weight, contadores), enquanto Vitor depende de paperclip/mic embutidos no composer — sem visualização do que já está atrelado, sem pool, sem curadoria.
2. **Vitor não consegue "olhar e planejar" sobre insumos curados.** Hoje transcripts da DS são injetados inteiros no system prompt ([vitor/index.ts:220](../../src/lib/agent/agents/vitor/index.ts#L220)), o que estoura contexto e impede leitura sob demanda. Vitoria já tem a tool `read_transcript_content` ([vitoria/tools.ts:350](../../src/lib/agent/agents/vitoria/tools.ts#L350)); Vitor não.
3. **A InsumosSheet da Vitoria** ([pm-review-insumos-sheet.tsx](../../src/components/pm-review/pm-review-insumos-sheet.tsx)) está acoplada a `pmReviewId` e a links de PM Review (Meeting + Transcript). Não dá pra reaproveitar pelo Vitor sem extrair primitivo.

## §2 Solução em uma frase

Extrair `ContextRibbon` + `ContextInsumosSheet` para `src/components/agent/context-import/` como primitivos parametrizados por **scope** (`session` pra Vitor, `project` pra Vitoria), e plugar no Vitor com a tool `read_transcript_content` pra que ele leia transcripts sob demanda em vez de receber tudo no system prompt.

## §3 Não-objetivos

- **Não** unificar a semântica de negócio (Vitoria tem weight + Meeting links; Vitor não vai ter Meeting link nesta entrega).
- **Não** mexer no composer atual do Vitor (paperclip/mic continuam funcionando como atalho rápido).
- **Não** introduzir compartilhamento de transcripts entre DSs do mesmo projeto — pool do Vitor é **session-scoped por design** (ver [[project-vitor-context-pool]]).
- **Não** criar tabela `DesignSessionMeetingLink` — Vitor opera só sobre transcripts da DS.
- **Não** substituir `TranscriptModal` por nada novo — só relocar.

## §4 Personas e jornada

- **PM (João, Vitor):** "Antes de o Vitor me ajudar a escrever PRD, quero ver **quais transcripts desta DS** ele já está olhando, conseguir tirar um que está poluindo o raciocínio, e adicionar outro que esqueci de linkar — sem sair do pre-work."
- **PM (João, Vitoria):** "No PM Review, o ribbon + sheet de insumos já são minha forma favorita de curar contexto. Quero que **o resto do Volund use o mesmo padrão**, sem que eu reaprenda nada."
- **Dev (Claude/futuro PR):** "Preciso criar um novo agente que aceita transcripts como contexto. Quero importar `<ContextRibbon scope='...' />` e `<ContextInsumosSheet />` sem reimplementar 400 linhas."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Primitivo vive em `src/components/agent/context-import/` (não em `ui/`) | É padrão de agente (acopla a TranscriptRef), não primitivo genérico de UI |
| D2 | Prop `scope: 'session' \| 'project'` controla qual pool listar | Vitor não pode contaminar contexto cross-DS ([[project-vitor-context-pool]]); Vitoria continua project-wide |
| D3 | Sheet aceita props `linkedTranscripts`, `poolTranscripts`, `onLink`, `onUnlink`, `onImportNew` — sem fetcher próprio | Stateless = reaproveitável; cada consumidor controla data fetching e mutation |
| D4 | `weight` é prop opcional (`showWeight?: boolean`) | Vitor não usa weight na entrega; deixar opt-in evita gerar UI inútil |
| D5 | Vitor adota apenas a parte de **transcripts** (não Meeting) | Vitor só linka transcripts hoje; Meeting linking fica fora de escopo |
| D6 | `TranscriptModal` move de `design-session/` pra `agent/context-import/` | Já é agnóstico de DS; é primitivo genuíno |
| D7 | Tool `read_transcript_content` é extraída pra `src/lib/agent/tools/read-transcript-content.ts` e compartilhada entre Vitoria e Vitor | Evitar duplicação; mantém comportamento idêntico |
| D8 | Vitor **deixa de receber `fullText` no system prompt**; recebe apenas título + transcriptRefId + summary curta | Reduz consumo de tokens; força leitura sob demanda via tool |
| D9 | Composer existente do Vitor (paperclip/mic) **fica inalterado** | Atalho rápido pra arquivos one-shot; ribbon é pra curadoria persistente |
| D10 | Sem migration nova | `DesignSessionTranscriptLink` (mig 20260529b) já tem `weight`; PM Review já usa `PMReviewTranscriptLink` |

## §6 Arquitetura

```
                    src/components/agent/context-import/
                    ├── context-ribbon.tsx          (NOVO — barra topo do panel)
                    ├── context-insumos-sheet.tsx   (NOVO — extraído de pm-review-*)
                    ├── context-link-list.tsx       (NOVO — lista interna do sheet)
                    └── transcript-modal.tsx        (MOVIDO de design-session/)

                              ▲                  ▲
                              │                  │
            ┌─────────────────┘                  └─────────────────┐
            │                                                      │
   src/components/pm-review/                          src/components/design-session/
   pm-review-ribbon.tsx                               pre-work-step.tsx
   pm-review-insumos-sheet.tsx (consome              (consome primitivos, scope='session',
   primitivos via wrapper fino,                       sem weight)
   scope='project', com weight)

                              ▲                                    ▲
                              │                                    │
                              └─── src/lib/agent/tools/ ───────────┘
                                   read-transcript-content.ts (NOVO — shared)

                                              ▲
                                              │
                          ┌───────────────────┴────────────────────┐
                          │                                        │
                  src/lib/agent/agents/vitoria/tools.ts    src/lib/agent/agents/vitor/tools.ts
                  (já existe — apontar pro shared)         (NOVO — registrar tool)
```

**Caixas reais:**
- `ContextRibbon` — barra horizontal, mostra `{N transcripts}` + botão "Insumos" + slot pra ações extras.
- `ContextInsumosSheet` — `ResponsiveSheet` com 3 seções: Linkados / Pool (filtrado por scope) / Importar novo (abre TranscriptModal).
- `ContextLinkList` — lista atomizada (item + remove + tipo).
- `read_transcript_content` tool — chama loader interno por `transcriptRefId`, retorna `fullText` + metadata.

## §7 Schema

**Não há mudança de schema.** Todas as tabelas necessárias já existem:

- `TranscriptRef` (SSOT) — [supabase/migrations/20260520_meeting_transcript_source.sql](../../supabase/migrations/20260520_meeting_transcript_source.sql)
- `DesignSessionTranscriptLink` (N:N com weight) — [supabase/migrations/20260529b_design_session_transcript_link.sql](../../supabase/migrations/20260529b_design_session_transcript_link.sql)
- `PMReviewTranscriptLink` (N:N com weight) — [supabase/migrations/20260529d_pm_review.sql](../../supabase/migrations/20260529d_pm_review.sql)

RLS já configurada nas três. Nenhum DDL nesta entrega.

## §8 APIs

Sem endpoint novo. Reuso de endpoints existentes:

| Método | Path | Contrato | Status |
|--------|------|----------|--------|
| GET | `/api/design-sessions/[id]/transcripts` | `{ linked: TranscriptRef[], pool: TranscriptRef[] }` | **AJUSTAR** — hoje retorna só `linked`; adicionar `pool` (vazio array — Vitor não tem pool cross-DS, mas a forma fica consistente) |
| POST | `/api/design-sessions/[id]/transcripts/link` | body `{ transcriptRefId: string }` → `201` | já existe |
| DELETE | `/api/design-sessions/[id]/transcripts/[linkId]` | `204` | já existe |
| GET | `/api/pm-reviews/[id]/insumos` | `{ linkedTranscripts, linkedMeetings, poolTranscripts, poolMeetings }` | já existe — inalterado |

**Tool (chamada pelo agente, não HTTP):**
- `read_transcript_content({ transcriptRefId: string })` → `{ id, title, source, fullText, summary, capturedAt }` — síncrono, sem job.

## §9 UX

**Vitor pre-work — antes:**
```
┌─ Conversation Panel ──────────────────────────────────┐
│                                                       │
│  [chat messages…]                                     │
│                                                       │
│  ┌─ Composer ──────────────────────────────────────┐ │
│  │ 📎 🎤 [_______________________________] [Send] │ │
│  └────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

**Vitor pre-work — depois:**
```
┌─ Conversation Panel ──────────────────────────────────┐
│ ▸ 3 transcripts desta DS · 0 arquivos    [📚 Insumos]│  ← ContextRibbon
│                                                       │
│  [chat messages…]                                     │
│                                                       │
│  ┌─ Composer ──────────────────────────────────────┐ │
│  │ 📎 🎤 [_______________________________] [Send] │ │  ← inalterado
│  └────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘

[📚 Insumos] → abre ContextInsumosSheet (side-sheet desktop / bottom-sheet mobile):

┌─ Insumos desta DS ────────────────────────────────────┐
│ Linkados (3)                                          │
│ ☑ Daily 28/05      Granola  [x]                       │
│ ☑ Roam: Onboarding (Apr/12)   [x]                     │
│ ☑ Reunião com Bia  Granola  [x]                       │
│                                                       │
│ Importar novo                                         │
│   [+ Importar transcript]  → abre TranscriptModal     │
└───────────────────────────────────────────────────────┘
```

**PM Review — inalterado visualmente**, mas internamente consumindo os primitivos. Mantém seção "Pool do projeto" (scope='project') que Vitor não tem.

## §10 Integrações

- **DS pre-work step** ([pre-work-step.tsx](../../src/components/design-session/pre-work-step.tsx)) — ganha `ContextRibbon` no topo do panel.
- **Vitor agent** ([vitor/index.ts](../../src/lib/agent/agents/vitor/index.ts), [vitor/prompt.ts](../../src/lib/agent/agents/vitor/prompt.ts)) — system prompt deixa de receber `fullText`; ganha tool `read_transcript_content` e instrução pra usá-la.
- **PM Review** ([pm-review-insumos-sheet.tsx](../../src/components/pm-review/pm-review-insumos-sheet.tsx), [pm-review-ribbon.tsx](../../src/components/pm-review/pm-review-ribbon.tsx)) — refatorada pra consumir primitivos, sem mudança de comportamento visível.
- **TranscriptRef SSOT** ([[project-transcript-ssot]]) — nenhum impacto; primitivos só consomem.

## §11 Faseamento

**Fase 1 (esta entrega):**
- Extrair primitivos (`ContextRibbon`, `ContextInsumosSheet`, `ContextLinkList`).
- Mover `TranscriptModal` pra `agent/context-import/`.
- Extrair `read_transcript_content` tool pra shared.
- Vitor adota ribbon + sheet (scope='session', sem weight).
- Vitor ganha tool `read_transcript_content` e prompt revisado.
- PM Review refatorada pra consumir primitivos (sem regressão visual).

**Fase 1 entrega mais que o sistema atual:** PM Review fica idêntica visualmente, Vitor ganha curadoria visual + tool de leitura sob demanda (hoje não tem nada disso).

**Fase 2 (fora desta entrega):** Vitor com pool cross-DS opt-in via setting de projeto (se decidirmos quebrar D2). Meeting linking pra Vitor.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Refactor PM Review regrade visualmente | Baixa | Médio | Story de smoke visual: rodar PM Review pre/pós, comparar (manual_browser) |
| Vitor perder qualidade por não receber fullText no prompt | Média | Alto | Prompt instrui chamar `read_transcript_content` em transcripts linkados; story de eval com fixture antes/depois |
| `ContextInsumosSheet` ficar over-engineered tentando cobrir os 2 casos | Média | Médio | D3 fixa shape stateless; props opcionais (`showWeight`, `showMeetings`) |
| Acoplamento ao endpoint atual de PM Review | Baixa | Baixo | Sheet recebe arrays e callbacks; não chama API direto |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| 0 duplicações de código de sheet entre Vitor e Vitoria | `grep -c "TranscriptLink" src/components/pm-review/*.tsx src/components/design-session/*.tsx` antes vs depois |
| Vitor chama `read_transcript_content` em ≥ 80% das conversas com transcript linkado | Query `AgentMessage WHERE agent='vitor' AND toolCalls @> '[{"name":"read_transcript_content"}]'` últimos 7 dias |
| Redução de tokens médios no system prompt do Vitor | Log de `system_prompt_tokens` em `AgentRun` — comparar p50 antes/depois |
| Zero regressões visuais em PM Review | Smoke browser manual da story P1-006 |

## §14 Open questions

(vazio — todas as decisões em §5 estão fixadas)

## §15 Referências

- [src/components/pm-review/pm-review-insumos-sheet.tsx](../../src/components/pm-review/pm-review-insumos-sheet.tsx) — código fonte do padrão Vitoria
- [src/components/pm-review/pm-review-ribbon.tsx](../../src/components/pm-review/pm-review-ribbon.tsx)
- [src/components/design-session/pre-work-step.tsx](../../src/components/design-session/pre-work-step.tsx) — onde Vitor vai ganhar a ribbon
- [src/components/design-session/transcript-modal.tsx](../../src/components/design-session/transcript-modal.tsx) — primitivo a relocar
- [src/lib/agent/agents/vitoria/tools.ts:350](../../src/lib/agent/agents/vitoria/tools.ts#L350) — `read_transcript_content` original
- [src/lib/agent/agents/vitor/index.ts:156-220](../../src/lib/agent/agents/vitor/index.ts#L156) — onde Vitor monta contexto hoje
- Memory: [[project-vitor-context-pool]], [[project-transcript-ssot]], [[project-ui-patterns]]

---

## §16 Stories implementáveis

```yaml
- id: CTXIMP-001
  title: Criar diretório src/components/agent/context-import/ e mover TranscriptModal pra ele
  description: |
    Criar pasta src/components/agent/context-import/ com index.ts re-exportando.
    Mover src/components/design-session/transcript-modal.tsx pra esse diretório.
    Atualizar todos os imports (vitor pre-work, pm-review insumos sheet).
    Sem mudança de comportamento.
  acceptanceCriteria:
    - "src/components/agent/context-import/transcript-modal.tsx existe"
    - "src/components/design-session/transcript-modal.tsx NÃO existe"
    - "Nenhum import quebrado: tsc --noEmit passa"
    - "ESLint sem warning de import não resolvido"
  verifiable:
    - kind: sql
      command_or_query: "test -f src/components/agent/context-import/transcript-modal.tsx && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "test ! -f src/components/design-session/transcript-modal.tsx && echo ok"
      expected: "ok"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -rEn \"from .*design-session/transcript-modal\" src/ | wc -l | tr -d ' '"
      expected: "0"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - src/components/agent/context-import/transcript-modal.tsx
    - src/components/agent/context-import/index.ts
    - src/components/design-session/pre-work-step.tsx
    - src/components/pm-review/pm-review-insumos-sheet.tsx

- id: CTXIMP-002
  title: Extrair ContextLinkList primitivo
  description: |
    Criar src/components/agent/context-import/context-link-list.tsx.
    Props: items: Array<{id, title, source, capturedAt, weight?}>, onRemove?: (id) => void,
    showWeight?: boolean, emptyLabel?: string.
    Visual: lista vertical com source badge + título + ações; sem dependência de pmReviewId ou
    designSessionId. Reproduz visual atual da seção "Insumos deste PM Review"
    (pm-review-insumos-sheet.tsx linhas 158-202) mas agnóstica.
  acceptanceCriteria:
    - "Arquivo existe e exporta default ContextLinkList"
    - "Componente não importa nada de pm-review/ ou design-session/"
    - "Props tipadas via Zod ou TS puro (sem any)"
    - "Renderiza items.length === 0 com emptyLabel"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE \"from .*(pm-review|design-session)/\" src/components/agent/context-import/context-link-list.tsx"
      expected: "0"
    - kind: sql
      command_or_query: "grep -c \"export default\" src/components/agent/context-import/context-link-list.tsx"
      expected: "1"
  dependsOn: [CTXIMP-001]
  estimateMinutes: 25
  touches:
    - src/components/agent/context-import/context-link-list.tsx

- id: CTXIMP-003
  title: Extrair ContextInsumosSheet primitivo
  description: |
    Criar src/components/agent/context-import/context-insumos-sheet.tsx.
    Props:
      open: boolean, onOpenChange, title: string,
      scope: 'session' | 'project',
      linkedTranscripts: TranscriptRefSummary[],
      poolTranscripts: TranscriptRefSummary[],
      onLink: (transcriptRefId) => Promise<void>,
      onUnlink: (transcriptRefId) => Promise<void>,
      onImportNew: () => void,
      showWeight?: boolean (default false),
      scopeLabel?: { linked: string, pool: string, empty: string }
    Estrutura: ResponsiveSheet com 3 seções (Linkados / Pool / Importar novo).
    Se scope='session' E poolTranscripts vazio, esconder seção Pool.
    Reutiliza ContextLinkList.
    NÃO importa de pm-review/ ou design-session/.
  acceptanceCriteria:
    - "Arquivo existe e exporta default ContextInsumosSheet"
    - "Usa ResponsiveSheet de src/components/ui/"
    - "Esconde seção Pool quando scope='session' e pool vazio"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE \"from .*(pm-review|design-session)/\" src/components/agent/context-import/context-insumos-sheet.tsx"
      expected: "0"
    - kind: sql
      command_or_query: "grep -c \"ResponsiveSheet\" src/components/agent/context-import/context-insumos-sheet.tsx"
      expected_min: "1"
      expected: "regex:^[1-9]"
  dependsOn: [CTXIMP-002]
  estimateMinutes: 30
  touches:
    - src/components/agent/context-import/context-insumos-sheet.tsx

- id: CTXIMP-004
  title: Criar ContextRibbon primitivo
  description: |
    Criar src/components/agent/context-import/context-ribbon.tsx.
    Props:
      counts: { transcripts: number, files?: number, notes?: number },
      onOpenInsumos: () => void,
      actions?: Array<{ icon, label, onClick }>  // slot para ações extras (futuro)
    Visual: barra horizontal fina (h-9), texto resumo à esquerda, botão "Insumos" à direita.
    Layout responsivo: em mobile colapsa o texto pra apenas contadores.
  acceptanceCriteria:
    - "Arquivo existe e exporta default ContextRibbon"
    - "tsc passa"
    - "Aceita actions opcional (slot)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/components/agent/context-import/context-ribbon.tsx && echo ok"
      expected: "ok"
  dependsOn: [CTXIMP-001]
  estimateMinutes: 20
  touches:
    - src/components/agent/context-import/context-ribbon.tsx

- id: CTXIMP-005
  title: Extrair read_transcript_content tool pra shared
  description: |
    Criar src/lib/agent/tools/read-transcript-content.ts com factory:
      createReadTranscriptContentTool(opts: { supabase, projectId?, sessionId? })
        : Tool
    Migrar lógica de src/lib/agent/agents/vitoria/tools.ts:350 pra essa factory.
    Vitoria passa a importar do shared. Mantém comportamento idêntico.
  acceptanceCriteria:
    - "src/lib/agent/tools/read-transcript-content.ts existe e exporta factory"
    - "vitoria/tools.ts importa do shared (não duplica lógica)"
    - "tsc passa"
    - "Sem regressão: Vitoria continua resolvendo transcriptRefId"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/tools/read-transcript-content.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -c \"from .*lib/agent/tools/read-transcript-content\" src/lib/agent/agents/vitoria/tools.ts"
      expected: "1"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/agent/tools/read-transcript-content.ts
    - src/lib/agent/agents/vitoria/tools.ts

- id: CTXIMP-006
  title: Refatorar PM Review insumos sheet pra consumir primitivos
  description: |
    Substituir corpo de src/components/pm-review/pm-review-insumos-sheet.tsx por
    wrapper fino que monta props e renderiza <ContextInsumosSheet scope="project"
    showWeight />. Manter section de Meetings linkados (Vitor não usa Meetings)
    inline no wrapper — não extrair Meetings pro primitivo nesta entrega.
    Comportamento visual idêntico: smoke browser manual.
  acceptanceCriteria:
    - "pm-review-insumos-sheet.tsx tem < 200 linhas (era 423)"
    - "Importa ContextInsumosSheet"
    - "tsc passa"
    - "Smoke: abrir PM Review → botão Insumos → linkar/deslinkar transcript funciona"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "wc -l < src/components/pm-review/pm-review-insumos-sheet.tsx | tr -d ' '"
      expected: "regex:^(1[0-9]{2}|[1-9][0-9])$"
    - kind: sql
      command_or_query: "grep -c \"ContextInsumosSheet\" src/components/pm-review/pm-review-insumos-sheet.tsx"
      expected: "1"
    - kind: manual_browser
      command_or_query: "Abrir PM Review existente → botão Insumos → linkar 1 transcript do pool → deslinkar"
      expected: "Sem erro console; sheet abre/fecha; lista atualiza"
  dependsOn: [CTXIMP-003]
  estimateMinutes: 30
  touches:
    - src/components/pm-review/pm-review-insumos-sheet.tsx

- id: CTXIMP-007
  title: Adicionar ContextRibbon ao Vitor pre-work step
  description: |
    Em src/components/design-session/pre-work-step.tsx:
    1. Adicionar <ContextRibbon> no topo do panel, antes da lista de mensagens.
    2. counts.transcripts = transcripts.length (já carregado, linha 121-133).
    3. State `insumosOpen` controla abertura do <ContextInsumosSheet scope='session' />.
    4. Sheet recebe linkedTranscripts=transcripts, poolTranscripts=[],
       onLink/onUnlink usando endpoints existentes
       (/api/design-sessions/[id]/transcripts/link e DELETE).
    5. onImportNew abre TranscriptModal existente.
    NÃO remover paperclip/mic do composer.
  acceptanceCriteria:
    - "pre-work-step.tsx importa ContextRibbon + ContextInsumosSheet"
    - "tsc passa"
    - "Smoke: abrir DS em pre-work → ribbon mostra contador correto → botão Insumos abre sheet → linkar transcript via 'Importar novo' funciona → deslinkar funciona"
    - "Composer paperclip + mic continuam funcionando"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE \"ContextRibbon|ContextInsumosSheet\" src/components/design-session/pre-work-step.tsx"
      expected: "regex:^[2-9]"
    - kind: manual_browser
      command_or_query: "DS em pre-work → ver ribbon → abrir sheet → linkar/deslinkar transcript"
      expected: "Ribbon renderiza; sheet funciona; contador atualiza"
  dependsOn: [CTXIMP-003, CTXIMP-004]
  estimateMinutes: 30
  touches:
    - src/components/design-session/pre-work-step.tsx

- id: CTXIMP-008
  title: Registrar read_transcript_content tool no Vitor
  description: |
    Em src/lib/agent/agents/vitor/tools.ts (criar se não existir):
    importar createReadTranscriptContentTool e registrar no toolset do Vitor.
    Em src/lib/agent/agents/vitor/index.ts:198-220: deixar de injetar fullText no
    agentContext.transcripts; passar apenas { id, title, source, summary, capturedAt }.
    Em vitor/prompt.ts: adicionar bloco "Fontes de contexto linkadas" listando IDs
    + instrução "use read_transcript_content(transcriptRefId) quando precisar do conteúdo"
    (espelha vitoria/prompt.ts:430).
  acceptanceCriteria:
    - "src/lib/agent/agents/vitor/tools.ts registra read_transcript_content"
    - "vitor/index.ts não passa fullText em agentContext.transcripts"
    - "vitor/prompt.ts contém 'read_transcript_content' e 'transcriptRefId'"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -c \"read_transcript_content\" src/lib/agent/agents/vitor/tools.ts"
      expected: "regex:^[1-9]"
    - kind: sql
      command_or_query: "grep -c \"fullText\" src/lib/agent/agents/vitor/index.ts"
      expected: "0"
    - kind: sql
      command_or_query: "grep -cE \"read_transcript_content|transcriptRefId\" src/lib/agent/agents/vitor/prompt.ts"
      expected: "regex:^[2-9]"
  dependsOn: [CTXIMP-005]
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitor/tools.ts
    - src/lib/agent/agents/vitor/index.ts
    - src/lib/agent/agents/vitor/prompt.ts

- id: CTXIMP-009
  title: Smoke E2E manual — Vitor com ribbon + tool de leitura
  description: |
    Cenário 1: Abrir DS em pre-work com 2+ transcripts linkados → ribbon mostra contador
    → conversar com Vitor sobre "o que discutiram no daily?" → confirmar via logs/network
    que Vitor chamou read_transcript_content (não recebeu fullText no system prompt).
    Cenário 2: Linkar novo transcript via sheet → confirmar que aparece nas próximas
    respostas do Vitor (re-fetch funciona).
    Cenário 3: Deslinkar transcript → confirmar que Vitor para de citá-lo (não está no
    contexto de fontes).
  acceptanceCriteria:
    - "Cenário 1 passa: tool call visível em logs"
    - "Cenário 2 passa: novo transcript aparece em até 1 mensagem"
    - "Cenário 3 passa: deslinkado some das fontes"
  verifiable:
    - kind: manual_browser
      command_or_query: "Executar 3 cenários acima em DS com transcripts reais"
      expected: "Todos passam sem console error"
  dependsOn: [CTXIMP-007, CTXIMP-008]
  estimateMinutes: 25
  touches: []
```

---

**Total stories:** 9
**Total estimate:** ~230 min (~4h)
**DAG:** CTXIMP-001 → 002 → 003 → 006; 001 → 004; 005 (independente); (003,004) → 007; 005 → 008; (007,008) → 009.
