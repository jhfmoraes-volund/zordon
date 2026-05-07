# Chat Unification — Plano + Runbook

**Status:** plano aprovado, pronto pra executar
**Início:** 2026-05-07
**Escopo:** unificar 5 implementações de chat (Alpha + Vitor) num único `<ConversationPanel>` reutilizável, com tema por agente, mobile-first, e renderização consistente de tool calls / thinking.

---

## 1. Decisões fechadas

| Tópico | Decisão |
|---|---|
| Tool call rendering | **Chip durante streaming** (estado `partial-call`/`call`/`result`) + **summary collapsível pós-fato** ("▸ Aplicou 3 alterações") quando a mensagem fica longa |
| Thinking state | **Sparkles + shimmer "Analisando…"** como padrão único (visual Vitor atual) |
| Alpha context global | Mantido — `AlphaChatProvider` no dashboard layout segue intocado. `<ConversationPanel>` é agnóstico ao orquestrador |
| Cor por agente | `AGENT_THEMES` registry. Hoje: `alpha` (primary) + `vitor` (oklch 0.74 0.18 55). Adicionar agente = 1 entrada |
| Memoização | `MessageBubble` com `React.memo` + comparator estável (id + textContent + toolParts length/states) — evita re-parse de markdown a cada chunk de streaming |
| Sticky-bottom inicial | `useLayoutEffect` no mount com `behavior: instant`; subsequente vira `smooth`. Resolve flicker em chats com history pré-carregado |
| Mobile padrão | Sheet bottom 90dvh + `pb-safe` + `overscroll-contain` + `enterkeyhint="send"` no textarea. FAB toggle (`<ConversationFab>`) com pulse durante streaming |

---

## 2. Estrutura final

```
src/components/ui/conversation/
├─ index.ts                       # re-exports públicos
├─ conversation-panel.tsx         # <ConversationPanel agent variant=desktop|mobile|fullpage>
├─ conversation-fab.tsx           # FAB toggle (mobile/desktop opcional)
├─ message-list.tsx               # virtualizer + sticky-bottom + initial-jump-instant
├─ message-bubble.tsx             # React.memo, role-aware
├─ tool-call-chip.tsx             # chip durante streaming (3 estados)
├─ tool-call-summary.tsx          # collapse pós-fato "▸ Aplicou X alterações"
├─ thinking-indicator.tsx         # Sparkles + shimmer canônico
├─ agent-badge.tsx                # genérico via AGENT_THEMES
├─ agent-themes.ts                # registry: cor, glow, label, ícone por agente
└─ tool-registry.ts               # mapa toolName→{label(args), icon} extensível
```

**APIs públicas:**

```ts
// Componente principal
<ConversationPanel
  agent="alpha" | "vitor"          // tema
  variant="desktop" | "mobile" | "fullpage"
  messages={UIMessage[]}
  status="idle" | "streaming" | "submitted"
  input={string}
  onInputChange={(v) => void}
  onSubmit={() => void}
  onStop?={() => void}
  // optional
  isOpen?={boolean}                // mobile sheet only
  onOpenChange?={(o) => void}
  onClose?={() => void}            // X button no header
  planMode?={boolean}
  onPlanModeChange?={(p) => void}
  onExecutePlan?={() => void}
  headerSlot?={ReactNode}          // step badge, history btn, etc
  composerLeftActions?={ReactNode} // file upload, etc
  composerAboveSlot?={ReactNode}   // file previews, "load more history"
  emptyState?={ReactNode}
/>

// FAB (opcional)
<ConversationFab
  agent="alpha" | "vitor"
  isOpen={boolean}
  isStreaming={boolean}
  onClick={() => void}
/>
```

---

## 3. Componentes — especificação

### 3.1 `agent-themes.ts`

```ts
import type { LucideIcon } from "lucide-react";
import { AlphaIcon } from "@/components/icons/alpha-icon";
import { VitorIcon } from "@/components/icons/vitor-icon";

export type AgentId = "alpha" | "vitor";

export type AgentTheme = {
  id: AgentId;
  label: string;          // "ALPHA" / "VITOR"
  icon: LucideIcon | typeof AlphaIcon;
  // CSS color tokens (compatíveis com tailwind arbitrary values)
  accent: string;         // cor primária do agente — usada em badge, focus ring
  accentSoft: string;     // versão soft pra background de chips em streaming
  glow: string;           // shadow box para badge
  emptyHint: string;      // "Pergunte sobre sprint…" ou "Posso preencher campos…"
};

export const AGENT_THEMES: Record<AgentId, AgentTheme> = {
  alpha: {
    id: "alpha",
    label: "ALPHA",
    icon: AlphaIcon,
    accent: "oklch(var(--primary))",
    accentSoft: "oklch(var(--primary) / 0.08)",
    glow: "0 0 18px -2px oklch(var(--primary) / 0.4)",
    emptyHint: "Pergunte sobre sprint, alocação, reuniões ou peça para criar tasks.",
  },
  vitor: {
    id: "vitor",
    label: "VITOR",
    icon: VitorIcon,
    accent: "oklch(0.74 0.18 55)",
    accentSoft: "oklch(0.74 0.18 55 / 0.08)",
    glow: "0 0 18px -2px oklch(0.74 0.18 55 / 0.4)",
    emptyHint: "Posso preencher campos, criar cards, sugerir melhorias e analisar a sessão.",
  },
};
```

**Adicionar 3º agente** = 1 entrada no objeto. Sem mudança em componentes.

### 3.2 `agent-badge.tsx`

Substitui `vitor-badge.tsx` + `alpha-badge.tsx`.

```tsx
<AgentBadge agent="alpha" size="sm" /> // ou "md"
```

Internamente lê `AGENT_THEMES[agent]` e aplica accent/glow/icon/label. Mesma estrutura visual dos badges atuais (uppercase mono, dot indicator, glow).

### 3.3 `tool-registry.ts`

```ts
import { Pencil, Plus, Trash2, Search, Database, ListTodo, Sparkles, type LucideIcon } from "lucide-react";

type ToolMeta = {
  label: (args: Record<string, unknown>) => string;
  icon: LucideIcon;
};

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  // Vitor (design-session)
  set_field:     { label: (a) => `Preenchendo ${a.field} em ${a.stepKey}`,        icon: Pencil },
  add_item:      { label: (a) => `Criando item em ${a.arrayKey}`,                  icon: Plus },
  update_item:   { label: (a) => `Atualizando item em ${a.arrayKey}`,              icon: Pencil },
  delete_item:   { label: (a) => `Removendo item de ${a.arrayKey}`,                icon: Trash2 },
  get_step_data: { label: (a) => `Consultando ${a.stepKey}`,                       icon: Database },
  web_search:    { label: (a) => `Pesquisando: "${a.query}"`,                      icon: Search },
  create_task:   { label: (a) => `Criando task: ${a.title}`,                       icon: ListTodo },

  // Alpha (ops)
  // adicionar conforme tools do alpha forem mapeadas — fallback abaixo cobre genéricos
};

export function resolveToolMeta(toolName: string, args: Record<string, unknown>) {
  const meta = TOOL_REGISTRY[toolName];
  return meta
    ? { label: meta.label(args), icon: meta.icon }
    : { label: toolName, icon: Sparkles };
}
```

### 3.4 `tool-call-chip.tsx`

Reescrita do atual `tool-call-card.tsx`:

- **3 estados** (`partial-call`, `call`, `result`) com ícone + label do registry.
- `flex-wrap` no container pai (resolve overflow horizontal mobile).
- Shimmer durante streaming, checkmark verde no result.
- Mantém visual rounded-full + border + bg.

### 3.5 `tool-call-summary.tsx` (novo)

Quando uma mensagem do assistant tem `>= 3` tool calls **finalizadas**, colapsa em:

```
▸ Aplicou 5 alterações  [click pra expandir]
   └─ ↓ (expandido) lista os chips em coluna
```

Critério de colapso: configurável (`collapseThreshold` prop), default 3.

### 3.6 `message-bubble.tsx`

```tsx
const MessageBubble = React.memo(
  function MessageBubble({ message, agent }) {
    // ...renderiza bubble + chips/summary
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.parts?.length === next.message.parts?.length &&
    extractText(prev.message) === extractText(next.message) &&
    extractToolStates(prev.message) === extractToolStates(next.message) &&
    prev.agent === next.agent,
);
```

Lógica de chip vs summary: `toolParts.length < 3` → chips inline. `>= 3` → summary collapsível.

### 3.7 `message-list.tsx`

Encapsula:

- `useVirtualizer` (overscan 4, estimateSize 120).
- Sticky-bottom: ref `stickToBottomRef = useRef(true)`. Listener de scroll desativa quando user rola pra cima > 80px do fim.
- **Initial mount**: `useLayoutEffect` com `virtualizer.scrollToIndex(last, { align: 'end', behavior: 'instant' })` no primeiro render com mensagens. Subsequentes: `behavior: 'smooth'`.
- Renderiza `<ThinkingIndicator>` como item virtual extra quando `status === 'streaming'` e última msg não é do assistant.
- Empty state via slot.

### 3.8 `thinking-indicator.tsx`

```tsx
<div className="flex items-center gap-2 text-muted-foreground">
  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
  <span className="shimmer-text text-xs">Analisando...</span>
</div>
```

Padrão único. Remove "Pensando…" + Loader2 dos chats antigos.

### 3.9 `conversation-panel.tsx`

3 variants:

- **`desktop`** — `<aside>` flex sibling de main. Width controlada pelo caller (não anima w-0→w-96 internamente; o caller decide via wrapper). Internamente `flex h-full flex-col`.
- **`mobile`** — `<Sheet side="bottom">` 90dvh, `pb-safe`, drag handle. `useIsMobile` interno **não** decide — o caller decide qual variant montar (permite SSR consistente).
- **`fullpage`** — div ocupa container pai (max-w-3xl centered configurável via className). Sem sheet, sem aside. Pra `/ops`.

**Composição interna** (todas variants):

```
[Header] (slot opcional + AgentBadge + close button)
[MessageList virtualizer]
[Composer] (ChatComposer com agent theme aplicado)
```

### 3.10 `conversation-fab.tsx`

Extrai `ai-chat-bubble.tsx`. Genérico:

```tsx
<ConversationFab
  agent="vitor"
  isOpen={isOpen}
  isStreaming={status === 'streaming'}
  onClick={() => setOpen(true)}
/>
```

Esconde quando `isOpen`. Pulse na cor do agente quando streaming.

### 3.11 `ChatComposer` — extensão

Adicionar prop `agent?: AgentId` que controla focus ring color (hoje hardcoded em `primary/20`). Default ao tema atual (alpha=primary) se omitido.

Adicionar prop `mobileMode?: boolean` que:
- desativa autoresize (rows fixo em 1, scroll interno)
- adiciona `enterkeyhint="send"` no textarea
- aumenta touch target dos botões pra 44px

---

## 4. Mobile — checklist obrigatório

Cada migração precisa validar:

- [ ] Sheet abre com FAB no canto bottom-right
- [ ] `pb-safe` aplicado (notch iOS não cobre composer)
- [ ] `overscroll-contain` no scroll container (sem pull-to-refresh acidental)
- [ ] `enterkeyhint="send"` no textarea (teclado iOS mostra "enviar")
- [ ] Sheet 90dvh **não** pula quando teclado abre (validar em iPhone real ou Safari mobile)
- [ ] Tool call chips com `flex-wrap` (não fazem scroll horizontal)
- [ ] Touch targets ≥ 44px (composer buttons, close, FAB)
- [ ] FAB pulse durante streaming visível
- [ ] Drag handle visível no top do Sheet
- [ ] Keyboard fechado ao clicar fora do textarea (Sheet handler)

---

## 5. Plano de execução — fases

### Fase 1: Primitivos (sem migração ainda)

**Objetivo:** criar pasta `conversation/` com todos os componentes novos isolados. Não toca em nenhum chat existente. Compila e roda.

**Tarefas:**
1. Criar `agent-themes.ts` com Alpha + Vitor.
2. Criar `tool-registry.ts` migrando labels/icons do `tool-call-card.tsx` atual.
3. Criar `agent-badge.tsx` (substituirá os dois badges atuais — mas eles seguem existindo nesta fase).
4. Criar `thinking-indicator.tsx`.
5. Criar `tool-call-chip.tsx` (reescrita do `tool-call-card.tsx`, com `flex-wrap`).
6. Criar `tool-call-summary.tsx`.
7. Criar `message-bubble.tsx` com memo + comparator.
8. Criar `message-list.tsx` com virtualizer + sticky-bottom inteligente.
9. Criar `conversation-panel.tsx` (3 variants).
10. Criar `conversation-fab.tsx`.
11. Estender `ChatComposer` com `agent` + `mobileMode` props (não-breaking).
12. `index.ts` exporta tudo.

**Validação:**
- `bun run typecheck` passa
- `bun run lint` passa
- `bun run build` passa
- Nada visualmente mudou (componentes não usados em lugar nenhum ainda)

**Commit:** `ZRD-JM-XX: ui/conversation — add reusable conversation primitives`

---

### Fase 2: Migrar Vitor briefing

**Objetivo:** primeiro consumidor do `<ConversationPanel>`. Briefing tem o setup mais simples (chat lateral, sem file upload).

**Arquivo:** [src/components/design-session/briefing-task-chat.tsx](src/components/design-session/briefing-task-chat.tsx)

**Tarefas:**
1. Substituir JSX de mensagens/composer pelo `<ConversationPanel agent="vitor" variant="desktop">`.
2. Manter lógica de `useChat()` + transport intocada.
3. "Carregar mensagens anteriores" vai como `composerAboveSlot` ou prepend dentro da `messages` list.
4. Adicionar versão mobile: `<ConversationPanel agent="vitor" variant="mobile" isOpen onOpenChange>` + `<ConversationFab>` no canto.
5. Empty state via prop `emptyState`.

**Validação:**
- Conversa abre com scroll no fim (sem flicker)
- Tool calls aparecem como chips durante streaming
- "Analisando…" durante thinking
- Mobile: Sheet abre via FAB, pb-safe ok, sem overflow
- Plan mode toggle funciona
- Stop button funciona

**Commit:** `ZRD-JM-XX: design-session/briefing — migrate to ConversationPanel`

---

### Fase 3: Migrar Vitor pre-work

**Arquivo:** [src/components/design-session/pre-work-step.tsx](src/components/design-session/pre-work-step.tsx)

**Tarefas:**
1. Igual à Fase 2 + manter file upload via `composerLeftActions` (botão clip) e file previews via `composerAboveSlot`.
2. Importação de Roam transcript continua nas left actions.
3. Adicionar versão mobile com FAB.

**Validação:**
- File upload funciona (preview + remove)
- Roam transcript import funciona
- Itens da Fase 2 todos ok

**Commit:** `ZRD-JM-XX: design-session/pre-work — migrate to ConversationPanel`

---

### Fase 4: Migrar Vitor session-wide (`ai-chat-panel.tsx`)

**Arquivo:** [src/components/design-session/ai-chat-panel.tsx](src/components/design-session/ai-chat-panel.tsx) → deletar
**Caller:** [src/components/design-session/wizard-layout.tsx](src/components/design-session/wizard-layout.tsx)

**Tarefas:**
1. `wizard-layout.tsx` passa a importar `<ConversationPanel>` direto + `<ConversationFab>`.
2. Apaga `ai-chat-panel.tsx`.
3. Mantém `useDesignSessionChat()` hook.
4. "Executar plano" button vai dentro do panel — `onExecutePlan` prop já existe no design.

**Validação:**
- Wizard abre, chat funciona em todos os steps
- Plan mode + execute plano funciona
- Mobile: Sheet bottom abre via FAB, mobile/desktop split ok
- Visual: chips durante streaming, summary se >= 3 tools

**Commit:** `ZRD-JM-XX: design-session/wizard — migrate to ConversationPanel; drop ai-chat-panel`

---

### Fase 5: Migrar Alpha sidebar

**Arquivo:** [src/components/alpha-chat/panel.tsx](src/components/alpha-chat/panel.tsx)

**Tarefas:**
1. Reescrever `AlphaChatPanel` usando `<ConversationPanel agent="alpha">`.
2. **Manter** `AlphaChatProvider` + `useAlphaChat()` + idle reset (intocado).
3. **Manter** comportamento desktop "transition w-0 → w-96" — wrapper externo cuida disso, interno é `<ConversationPanel variant="desktop">`.
4. Header customizado via `headerSlot`: botão Maximize2 (link `/ops`), History, Close.
5. Trocar textarea cru pelo `ChatComposer agent="alpha"` (pelo wrapper do panel).
6. Mobile: sheet existente já é compatível, vira `variant="mobile"`.

**Validação:**
- ⌘⇧A toggle funciona
- History sheet abre/fecha
- Maximize2 leva pra `/ops`
- Idle reset (30min) funciona — testar mockando timer
- Visual Alpha (cor primary) aplicado no badge, focus ring, FAB pulse
- Tool calls de Alpha renderizam como chips (mesmo que ainda não estejam no registry, fallback Sparkles cobre)

**Commit:** `ZRD-JM-XX: alpha-chat/panel — migrate to ConversationPanel`

---

### Fase 6: Migrar Alpha fullpage `/ops`

**Arquivo:** [src/app/(dashboard)/ops/page.tsx](src/app/(dashboard)/ops/page.tsx)

**Tarefas:**
1. Trocar JSX de mensagens/composer por `<ConversationPanel agent="alpha" variant="fullpage">`.
2. Threads sidebar (desktop) + history sheet (mobile) — manter código atual, ortogonal ao panel.
3. `useChat` + transport intocados.

**Validação:**
- Threads list funciona
- Conversa funciona igual à sidebar
- Layout fullpage centered (max-w-3xl)
- Visual idêntico ao Alpha sidebar (mesma cor, mesmas chips)

**Commit:** `ZRD-JM-XX: app/ops — migrate to ConversationPanel fullpage`

---

### Fase 7: Cleanup

**Tarefas:**
1. Deletar `src/components/design-session/tool-call-card.tsx`
2. Deletar `src/components/design-session/vitor-badge.tsx`
3. Deletar `src/components/alpha-chat/alpha-badge.tsx`
4. Deletar `src/components/design-session/ai-chat-bubble.tsx` (substituído por `ConversationFab`)
5. Atualizar imports remanescentes (grep `vitor-badge` / `alpha-badge` / `tool-call-card` / `ai-chat-bubble` / `ai-chat-panel`)
6. Remover classes CSS órfãs em `globals.css` se houver

**Validação:**
- `bun run build` passa
- `bun run lint` passa
- Grep dos arquivos deletados retorna 0 hits
- App sobe limpo, sem warnings de import

**Commit:** `ZRD-JM-XX: chat — drop deprecated badge/card/bubble files`

---

## 6. Runbook de execução

### Antes de começar cada fase

```bash
# Confirma que está em main limpo
git status
git pull --rebase
```

### Durante a fase

```bash
# Type check incremental enquanto edita
bun run typecheck --watch  # em outro terminal

# Validar visualmente
bun run dev
# Navegar por:
# - /design-sessions/<id>/steps/briefing  (Fase 2/4)
# - /design-sessions/<id>/steps/pre_work  (Fase 3/4)
# - qualquer página do dashboard com Alpha sidebar  (Fase 5)
# - /ops  (Fase 6)
# Em mobile: usar DevTools responsive mode + iPhone real (Safari)
```

### Critérios pra fechar fase

- [ ] Type check passa
- [ ] Lint passa
- [ ] Build passa
- [ ] Validação visual desktop (golden path do chat: enviar mensagem, ver streaming, ver tool call, ver thinking)
- [ ] Validação visual mobile (mesmo golden path + checklist da seção 4)
- [ ] Testes unitários passam (se houver pra component) — `bun test`
- [ ] Commit com tag `ZRD-JM-XX` via `bash scripts/sync-main.sh -m "..."`

### Se algo quebrar mid-fase

- **Não** dar revert se já tem progresso útil. Comitar parcial com WIP, abrir issue com root cause, e seguir consertando incrementalmente.
- Type errors em massa após renomeação? Provável import de barrel desatualizado — checar `index.ts` da pasta nova.
- Sticky-bottom flicker? Provável `useEffect` em vez de `useLayoutEffect` no scroll inicial.
- Mobile keyboard pulando viewport? Validar `interactive-widget=resizes-content` no `<meta viewport>` do layout.

---

## 7. Riscos & mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Memoização de bubble quebra streaming (mensagem nova não atualiza) | Média | Alto | Comparator olha `extractText(message)` na íntegra — se text muda, bubble re-renderiza. Validar com console.log no comparator durante streaming inicial |
| Virtualizer + dynamic content quebra altura no resize | Baixa | Médio | `measureElement` já configurado no panel atual. Manter. Se mensagem cresce muito (>800px) testar overscan maior |
| Mobile Sheet 90dvh não funciona com teclado iOS | Média | Alto | Plan B: trocar pra `100dvh` quando `visualViewport.height < window.innerHeight`. Implementar hook `useViewportAdjust` se Sheet pular |
| Alpha tool calls não estão no registry — fallback feia | Alta | Baixo | Fallback usa Sparkles + toolName cru. Aceitável até Alpha tools serem mapeadas (issue follow-up) |
| `ChatComposer` extensão com `mobileMode` quebra callers atuais | Baixa | Médio | Prop opcional, default off. Migração explícita por consumidor |
| Plan mode persistence (`useChatPlanMode`) quebra entre instâncias | Baixa | Médio | Hook já tem CustomEvent sync — não mexer. Validar no smoke test |

---

## 8. Não-objetivos (escopo cortado)

- **Não** unificar `useChat` orquestrador (Alpha mantém context, Vitor mantém useChat direto). Refator de arquitetura é outro plano.
- **Não** mexer no backend (`/api/agents/alpha/chat`, `/api/design-sessions/.../chat`). Frontend only.
- **Não** redesenhar tool calls do agente — só padroniza visual.
- **Não** adicionar attachments/files no Alpha (segue text-only).
- **Não** adicionar history threads no Vitor (segue session-bound).

---

## 9. Métricas de sucesso

Pós-migração, qualquer chat (Alpha sidebar, Alpha fullpage, Vitor briefing, Vitor pre-work, Vitor session-wide) deve ter:

- ✅ Mesma estética de bubble (rounded-2xl, max-w-85%, role-aware corner)
- ✅ Mesma estética de tool call (chip durante, summary se >=3)
- ✅ Mesma estética de thinking (Sparkles + "Analisando…")
- ✅ Mesmo input (`ChatComposer`)
- ✅ Cor distinta por agente (badge, focus ring, FAB)
- ✅ Mobile coerente (Sheet, FAB, safe-area, sem overflow)
- ✅ Sem flicker de scroll no mount
- ✅ Memoização ativa (sem re-parse de markdown a cada chunk)

**Sinal de fim:** screenshots side-by-side dos 5 chats em desktop + mobile mostrando consistência total.

---

## 10. Checklist macro

- [ ] Fase 1: Primitivos `conversation/`
- [ ] Fase 2: Vitor briefing
- [ ] Fase 3: Vitor pre-work
- [ ] Fase 4: Vitor session-wide (drop `ai-chat-panel`)
- [ ] Fase 5: Alpha sidebar
- [ ] Fase 6: Alpha fullpage `/ops`
- [ ] Fase 7: Cleanup
- [ ] Screenshots de validação anexados em PR de fechamento
