# Chat Unification — V2

**Status:** plano V2, calibrado contra estado atual do código (auditoria 2026-05-07)
**Início:** 2026-05-07
**Escopo:** unificar 5 implementações de chat (Alpha sidebar/fullpage + Vitor briefing/pre-work/session-wide) num único `<ConversationPanel>` reutilizável, com tema por agente, mobile-first em todos, virtualizer em todos, thinking indicator único, tool call rendering padronizado em chips definidos por estado.

**Mudanças vs V1:**
- Reconhece que **4 dos 5 chats não têm virtualizer hoje** → harness de stress test antes de migrar.
- Reconhece que **mobile Vitor briefing/pre-work é feature nova**, não migração.
- Reconhece que **thinking indicator hoje é inconsistente entre os 5** (Loader2 spin / "Analisando…" / "Pensando…") → V2 traz spec visual única e screenshot before/after obrigatório antes da troca.
- `ChatComposer` ganha **migração explícita do focus-ring** pra evitar janela de inconsistência entre fases.
- Chips de tool call têm **3 estados visuais bem definidos** (spec na seção 4) com tokens de tema por agente.
- `collapseThreshold` vira **propriedade do agente** no registry, não global.
- Plan mode CustomEvent passa a ser **namespaced por agente** pra evitar cross-talk futuro.
- Cleanup (Fase 8) inclui **smoke E2E manual obrigatório** antes de deletar arquivos antigos.

---

## 1. Estado atual (linha de base auditada)

| Chat | Arquivo | Hook | Virtualizer | Mobile Sheet/FAB | Plan mode | File upload |
|---|---|---|---|---|---|---|
| Alpha sidebar | `src/components/alpha-chat/panel.tsx` | `useAlphaChat` (context) | ❌ | Sheet right ✅ | ❌ | ❌ |
| Alpha fullpage | `src/app/(dashboard)/ops/page.tsx` | `useChat` direto | ❌ | n/a (fullpage) | ❌ | ❌ |
| Vitor briefing | `src/components/design-session/briefing-task-chat.tsx` | `useChat` + `useChatPlanMode` | ❌ | ❌ desktop-only | ✅ | ❌ |
| Vitor pre-work | `src/components/design-session/pre-work-step.tsx` | `useChat` + `useChatPlanMode` | ❌ | ❌ desktop-only | ✅ | ✅ |
| Vitor session-wide | `src/components/design-session/ai-chat-panel.tsx` | `useDesignSessionChat` | ✅ `@tanstack/react-virtual` | Sheet bottom ✅ | ✅ | ❌ |

**Thinking indicator atual (inconsistente):**
- Alpha sidebar: string nua "Pensando…"
- Alpha fullpage: idem
- Vitor briefing: string nua "Analisando briefing…"
- Vitor pre-work: string nua "Analisando…"
- Vitor session-wide: `<Loader2 spin>` + texto

**Tool call rendering atual:**
- Apenas Vitor (3 chats) usa `tool-call-card.tsx` — chip rounded-full com Loader2/Check/Icon. Spec em `src/components/design-session/tool-call-card.tsx:34`.
- Alpha (2 chats) **não renderiza tool calls visualmente** hoje (passa direto pro markdown ou ignora).

**Composer atual:** `src/components/ui/chat-composer.tsx` — focus ring hardcoded em `primary/20` (cor Alpha). Sem prop `agent`, sem `mobileMode`. Usado pelos 3 chats Vitor.

---

## 2. Decisões fechadas

| Tópico | Decisão |
|---|---|
| Tool call rendering | **Chip com 3 estados visuais** (queued / running / done) durante streaming + **summary collapsível** (`▸ Aplicou N alterações`) quando `toolParts.length >= agent.collapseThreshold` |
| Thinking indicator | **`<ThinkingIndicator>` único**: Sparkles 3.5×3.5 com `animate-pulse` + texto shimmer "Analisando…" em `text-muted-foreground text-xs`. Substitui Loader2 + strings nuas em todos os 5 chats |
| Virtualizer | **Obrigatório em todas as variants** via `<MessageList>`. Migra os 4 chats sem virtualizer hoje + mantém o do session-wide |
| Composer focus ring | Props `agent` migra **TODOS os consumidores na Fase 1** (não-default) — sem janela de inconsistência. Composer fica agnóstico, accent vem do registry |
| Cor por agente | `AGENT_THEMES` registry com `accent`, `accentSoft`, `glow`, `collapseThreshold`, `emptyHint`, `icon`, `label` |
| Memoização | `MessageBubble` com `React.memo` + comparator estável (`id` + `extractText` íntegro + `extractToolStates` serializado) — evita re-parse de markdown a cada chunk |
| Sticky-bottom inicial | `useLayoutEffect` no mount (`behavior: instant`); subsequente `behavior: smooth`. Listener de scroll desativa sticky se user rola > 80px do fim |
| Mobile padrão | Sheet bottom 90dvh + `pb-safe` + `overscroll-contain` + `enterkeyhint="send"` no textarea + drag handle. FAB toggle (`<ConversationFab>`) com pulse durante streaming, escondido quando `isOpen` |
| Plan mode events | CustomEvent `chat:planmode:<agent>` — não global. Hook `useChatPlanMode` recebe `agent` |
| Alpha context | **Mantido intocado** — `AlphaChatProvider` no dashboard layout; `<ConversationPanel>` é agnóstico ao orquestrador, recebe `messages/status/input/onSubmit` por prop |
| Stress test | Fase 1 inclui harness com 200 mensagens mockadas + 5 tool calls por mensagem pra validar virtualizer + memo antes de migrar consumidor real |

---

## 3. Estrutura final

```
src/components/ui/conversation/
├─ index.ts                       # re-exports públicos
├─ conversation-panel.tsx         # <ConversationPanel agent variant=desktop|mobile|fullpage>
├─ conversation-fab.tsx           # FAB toggle (mobile e desktop)
├─ message-list.tsx               # virtualizer + sticky-bottom + initial-jump-instant
├─ message-bubble.tsx             # React.memo, role-aware
├─ tool-call-chip.tsx             # chip durante streaming (3 estados, ver seção 4)
├─ tool-call-summary.tsx          # collapse pós-fato "▸ Aplicou X alterações"
├─ thinking-indicator.tsx         # Sparkles + shimmer canônico
├─ agent-badge.tsx                # genérico via AGENT_THEMES (substitui Alpha + Vitor badges)
├─ agent-themes.ts                # registry: cor, glow, label, ícone, collapseThreshold por agente
├─ tool-registry.ts               # mapa toolName→{label(args), icon} extensível
└─ harness/
   └─ stress.tsx                  # rota dev /dev/chat-stress com 200 msgs mockadas (Fase 1)
```

**APIs públicas:**

```ts
<ConversationPanel
  agent="alpha" | "vitor"
  variant="desktop" | "mobile" | "fullpage"
  messages={UIMessage[]}
  status="idle" | "streaming" | "submitted"
  input={string}
  onInputChange={(v) => void}
  onSubmit={() => void}
  onStop?={() => void}

  isOpen?={boolean}                // mobile sheet
  onOpenChange?={(o) => void}
  onClose?={() => void}            // X header (desktop sidebar)

  planMode?={boolean}
  onPlanModeChange?={(p) => void}
  onExecutePlan?={() => void}      // bottom-sticky button quando planMode=true e há plano

  headerSlot?={ReactNode}          // step badge, history btn, maximize, etc
  composerLeftActions?={ReactNode} // file upload, etc
  composerAboveSlot?={ReactNode}   // file previews, "carregar mais"
  emptyState?={ReactNode}
/>

<ConversationFab
  agent="alpha" | "vitor"
  isOpen={boolean}
  isStreaming={boolean}
  onClick={() => void}
  position?="bottom-right" | "bottom-left"  // default bottom-right
/>
```

---

## 4. Tool call chips — spec definitiva

### 4.1 Estados visuais

Cada chip tem 3 estados, mapeados 1:1 do `state` do AI SDK (`partial-call` | `call` | `result`):

| Estado interno | Mapeamento SDK | Visual |
|---|---|---|
| **queued** | `partial-call` (args ainda chegando) | Border `agent.accentSoft`, bg transparente, ícone do tool em `text-muted-foreground/60`, label normal, **sem** animação |
| **running** | `call` (executando) | Border `agent.accent` em 30% opacidade, bg `agent.accentSoft`, `<Loader2 spin>` em `agent.accent`, label em `shimmer-text font-medium` |
| **done** | `result` (finalizado) | Border `border` (neutro), bg `muted/50`, `<Check>` verde-500, label em `text-muted-foreground` (sem ênfase — chip recua visualmente) |

### 4.2 Anatomia do chip

```
┌──────────────────────────────────────────────┐
│  [icon 12×12]  Label do tool com args         │
└──────────────────────────────────────────────┘
   ↑ rounded-full  px-2.5 py-1  text-xs  border
   gap-1.5
```

- **Width**: `inline-flex` (auto) com `flex-wrap` no container pai. Nunca scroll horizontal.
- **Truncate**: label com `max-w-[280px] truncate` em mobile (≤640px), `max-w-none` em desktop. Hover/long-press mostra label completo via `title`.
- **Touch target**: chip não é interativo; só o summary toggle é (44px).

### 4.3 Tokens de tema aplicados

```css
/* running, agent=alpha */
border-color: oklch(var(--primary) / 0.30);
background: oklch(var(--primary) / 0.08);
loader-color: oklch(var(--primary));

/* running, agent=vitor */
border-color: oklch(0.74 0.18 55 / 0.30);
background: oklch(0.74 0.18 55 / 0.08);
loader-color: oklch(0.74 0.18 55);

/* done — neutro pros dois agentes (chip "recuado") */
border-color: var(--border);
background: oklch(var(--muted) / 0.50);
check-color: rgb(34 197 94); /* green-500 */
```

### 4.4 Sequência durante streaming

```
T0: tool call detectado (partial-call)
    └─ chip queued aparece com fade-in 150ms

T1: args completos, execução começa (call)
    └─ chip transita pra running: ícone vira Loader2 spin, border ganha cor agente, shimmer no label

T2: result chega
    └─ chip transita pra done: Loader2 → Check verde, cores recuam pra neutro (250ms)
    └─ se mensagem agora tem >= agent.collapseThreshold chips done E o assistant ainda está streamando texto, NÃO colapsa ainda (espera fim da mensagem)

T3: mensagem do assistant termina (status volta a idle)
    └─ se total chips done >= agent.collapseThreshold, anima collapse pra summary
```

### 4.5 Collapse summary

Quando `toolParts.filter(t => t.state === 'result').length >= agent.collapseThreshold`:

```
▸ Aplicou 5 alterações                 [click]
```

- Ícone: `<ChevronRight>` rotaciona 90° quando aberto.
- Label: `Aplicou {N} alterações` (PT-BR fixo; localizar no futuro).
- Summary é **clicável** (44px touch target). Aberto: lista os chips em coluna, gap-1.5.
- `agent.collapseThreshold` defaults: Alpha=2, Vitor=3 (Vitor faz `set_field` rápidos, Alpha faz operações maiores).

### 4.6 Fallback pra tool desconhecido

```ts
{ label: toolName, icon: Sparkles }
```

Aceitável durante adoção (Alpha tools ainda não estão no registry). Após Fase 1 abrir issue follow-up pra mapear cada tool.

---

## 5. Componentes — especificação

### 5.1 `agent-themes.ts`

```ts
import type { LucideIcon } from "lucide-react";
import { AlphaIcon } from "@/components/icons/alpha-icon";
import { VitorIcon } from "@/components/icons/vitor-icon";

export type AgentId = "alpha" | "vitor";

export type AgentTheme = {
  id: AgentId;
  label: string;            // "Alpha" / "Vitor" (badge auto-uppercase)
  icon: typeof AlphaIcon;   // ou LucideIcon
  accent: string;           // cor primária (oklch)
  accentSoft: string;       // bg de chips running
  glow: string;             // box-shadow do badge
  emptyHint: string;
  collapseThreshold: number; // chips done >= isso → summary
  planEventName: string;     // CustomEvent name pro hook plan mode
};

export const AGENT_THEMES: Record<AgentId, AgentTheme> = {
  alpha: {
    id: "alpha",
    label: "Alpha",
    icon: AlphaIcon,
    accent: "oklch(var(--primary))",
    accentSoft: "oklch(var(--primary) / 0.08)",
    glow: "0 0 14px -4px oklch(var(--primary) / 0.40)",
    emptyHint: "Pergunte sobre sprint, alocação, reuniões ou peça para criar tasks.",
    collapseThreshold: 2,
    planEventName: "chat:planmode:alpha",
  },
  vitor: {
    id: "vitor",
    label: "Vitor",
    icon: VitorIcon,
    accent: "oklch(0.74 0.18 55)",
    accentSoft: "oklch(0.74 0.18 55 / 0.08)",
    glow: "0 0 14px -4px oklch(0.74 0.18 55 / 0.40)",
    emptyHint: "Posso preencher campos, criar cards, sugerir melhorias e analisar a sessão.",
    collapseThreshold: 3,
    planEventName: "chat:planmode:vitor",
  },
};
```

### 5.2 `agent-badge.tsx`

Substitui `alpha-badge.tsx` + `vitor-badge.tsx`. Mesma estrutura visual (tile + label, scan HUD low-glow), parametrizada via tema:

```tsx
<AgentBadge agent="alpha" size="sm" />
<AgentBadge agent="vitor" size="md" showDot />
```

Internamente lê `AGENT_THEMES[agent]` e aplica `accent`/`glow`/`icon`/`label`. Preserva tracking, mono font, dot indicator, repeating-linear-gradient — todas as classes idênticas aos badges atuais. Nada muda visualmente.

### 5.3 `tool-registry.ts`

```ts
import { Pencil, Plus, Trash2, Search, Database, ListTodo, Sparkles, type LucideIcon } from "lucide-react";

type ToolMeta = {
  label: (args: Record<string, unknown>) => string;
  icon: LucideIcon;
};

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  // Vitor (design-session) — migrado integralmente de tool-call-card.tsx
  set_field:     { label: (a) => `Preenchendo ${a.field} em ${a.stepKey}`,   icon: Pencil },
  add_item:      { label: (a) => `Criando item em ${a.arrayKey} (${a.stepKey})`, icon: Plus },
  update_item:   { label: (a) => `Atualizando item em ${a.arrayKey} (${a.stepKey})`, icon: Pencil },
  delete_item:   { label: (a) => `Removendo item de ${a.arrayKey} (${a.stepKey})`, icon: Trash2 },
  get_step_data: { label: (a) => `Consultando ${a.stepKey}`,                  icon: Database },
  web_search:    { label: (a) => `Pesquisando: "${a.query}"`,                 icon: Search },
  create_task:   { label: (a) => `Criando task: ${a.title}`,                  icon: ListTodo },

  // Alpha tools — adicionar conforme mapeadas (issue follow-up pós Fase 6)
};

export function resolveToolMeta(toolName: string, args: Record<string, unknown>) {
  const meta = TOOL_REGISTRY[toolName];
  return meta
    ? { label: meta.label(args), icon: meta.icon }
    : { label: toolName, icon: Sparkles };
}
```

### 5.4 `tool-call-chip.tsx`

Reescrita do atual `tool-call-card.tsx` com tema por agente:

```tsx
type Props = {
  agent: AgentId;
  toolName: string;
  args: Record<string, unknown>;
  state: "partial-call" | "call" | "result";
};

export function ToolCallChip({ agent, toolName, args, state }: Props) {
  const theme = AGENT_THEMES[agent];
  const { label, icon: Icon } = resolveToolMeta(toolName, args);
  const phase = state === "result" ? "done" : state === "call" ? "running" : "queued";

  return (
    <span
      data-phase={phase}
      style={phase === "running" ? { borderColor: `${theme.accent} / 30%`, background: theme.accentSoft } : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-250",
        "max-w-[280px] sm:max-w-none",
        phase === "queued" && "border-border/50 bg-transparent",
        phase === "done" && "border-border bg-muted/50",
      )}
    >
      {phase === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" style={{ color: theme.accent }} />
      ) : phase === "done" ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Icon className="h-3 w-3 text-muted-foreground/60" />
      )}
      <span className={cn(
        "truncate",
        phase === "running" && "shimmer-text font-medium",
        phase !== "running" && "text-muted-foreground",
      )}>
        {label}
      </span>
    </span>
  );
}
```

Container pai sempre `flex flex-wrap gap-1.5` — chips nunca causam overflow horizontal.

### 5.5 `tool-call-summary.tsx`

```tsx
type Props = {
  agent: AgentId;
  parts: ToolPart[];   // já filtradas pra state=result
  threshold: number;   // = AGENT_THEMES[agent].collapseThreshold
};

export function ToolCallSummary({ agent, parts, threshold }: Props) {
  const [open, setOpen] = useState(false);
  if (parts.length < threshold) return null; // caller decide; defensivo

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-11 items-center gap-1.5 self-start rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/50"
        aria-expanded={open}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        Aplicou {parts.length} alterações
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {parts.map((p) => <ToolCallChip key={p.toolCallId} agent={agent} {...p} />)}
        </div>
      )}
    </div>
  );
}
```

### 5.6 `thinking-indicator.tsx`

```tsx
export function ThinkingIndicator({ label = "Analisando..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
      <span className="shimmer-text text-xs">{label}</span>
    </div>
  );
}
```

Single source of truth. **Substitui** Loader2 + strings nuas em todos os 5 chats. Vide seção 7 (screenshots before/after).

### 5.7 `message-bubble.tsx`

```tsx
type Props = { message: UIMessage; agent: AgentId };

const MessageBubble = React.memo(
  function MessageBubble({ message, agent }: Props) {
    const text = extractText(message);
    const toolParts = extractToolParts(message);
    const doneParts = toolParts.filter((t) => t.state === "result");
    const threshold = AGENT_THEMES[agent].collapseThreshold;
    const shouldCollapse = doneParts.length >= threshold;

    return (
      <div className={cn(/* role-aware bubble */)}>
        {text && <Markdown>{text}</Markdown>}
        {!shouldCollapse && toolParts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {toolParts.map((p) => <ToolCallChip key={p.toolCallId} agent={agent} {...p} />)}
          </div>
        )}
        {shouldCollapse && (
          <div className="mt-2">
            <ToolCallSummary agent={agent} parts={toolParts} threshold={threshold} />
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.agent === next.agent &&
    extractText(prev.message) === extractText(next.message) &&
    serializeToolStates(prev.message) === serializeToolStates(next.message),
);

function serializeToolStates(m: UIMessage) {
  return extractToolParts(m).map((p) => `${p.toolCallId}:${p.state}`).join("|");
}
```

`extractText` e `extractToolParts` são helpers determinísticos: sempre coercem `parts[i].text` a string (`?? ""`). Comparator falso-negativo é preferível a falso-positivo (re-render extra > bubble travado em estado antigo).

### 5.8 `message-list.tsx`

```tsx
type Props = {
  agent: AgentId;
  messages: UIMessage[];
  status: ChatStatus;
  emptyState?: ReactNode;
};

export function MessageList({ agent, messages, status, emptyState }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  const didInitialJumpRef = useRef(false);

  const showThinking = status === "streaming" && messages.at(-1)?.role !== "assistant";
  const items = useMemo(() => (showThinking ? [...messages, { __thinking: true }] : messages), [messages, showThinking]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 4,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 120,
  });

  // Sticky-bottom: instant no mount, smooth depois
  useLayoutEffect(() => {
    if (!didInitialJumpRef.current && messages.length > 0 && parentRef.current) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "instant" as ScrollBehavior });
      didInitialJumpRef.current = true;
    }
  }, [items.length, messages.length, virtualizer]);

  useEffect(() => {
    if (didInitialJumpRef.current && stickyRef.current) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior: "smooth" });
    }
  }, [items.length, virtualizer]);

  // Detecta scroll up do user (desativa sticky se > 80px do fim)
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distance < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (messages.length === 0 && !showThinking) {
    return <div className="flex flex-1 items-center justify-center p-6">{emptyState}</div>;
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto overscroll-contain">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const item = items[vi.index];
          return (
            <div
              key={vi.key}
              ref={virtualizer.measureElement}
              data-index={vi.index}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
            >
              {(item as any).__thinking ? <ThinkingIndicator /> : <MessageBubble agent={agent} message={item as UIMessage} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### 5.9 `conversation-panel.tsx`

3 variants compartilham composição interna (Header → MessageList → Composer). Diferença é apenas o invólucro:

| Variant | Wrapper | Quem decide montagem |
|---|---|---|
| `desktop` | `<aside class="flex h-full flex-col">` | Caller decide width via wrapper externo (anim w-0→w-96 fica no caller, painel não se preocupa) |
| `mobile` | `<Sheet side="bottom">` 90dvh, `pb-safe`, drag handle, `overscroll-contain` | Caller decide via `useIsMobile` qual variant montar (panel não detecta — SSR-safe) |
| `fullpage` | `<div class="mx-auto flex h-full w-full max-w-3xl flex-col">` | `/ops` |

Composer recebe `agent` prop sempre (V2 não tem default).

### 5.10 `conversation-fab.tsx`

```tsx
<ConversationFab agent="vitor" isOpen={isOpen} isStreaming={status === "streaming"} onClick={() => setOpen(true)} />
```

- Esconde quando `isOpen` (returns null).
- Pulse `animate-pulse` aplicado quando `isStreaming`, cor = `agent.accent`.
- Position default `bottom-right` com `bottom-4 right-4` + `pb-safe`.
- Touch target 56×56.

### 5.11 `ChatComposer` — extensão

**V2: migra todos os consumidores na Fase 1, sem default fallback.**

Props novas obrigatórias quando consumidor migrar:

```ts
type ChatComposerProps = {
  // ...existing
  agent: AgentId;          // controla focus ring color (lê AGENT_THEMES[agent].accent)
  mobileMode?: boolean;    // rows fixo, enterkeyhint="send", touch targets 44px
};
```

Implementação do focus ring:

```tsx
<div
  style={{ "--composer-accent": theme.accent } as CSSProperties}
  className="focus-within:border-[color:var(--composer-accent)]/50 focus-within:ring-2 focus-within:ring-[color:var(--composer-accent)]/20"
/>
```

Migração: na Fase 1, junto com criação dos primitivos, **todos os 3 callers Vitor** (briefing, pre-work, ai-chat-panel) recebem `agent="vitor"` no composer. Nenhuma janela de inconsistência.

---

## 6. Mobile — checklist obrigatório por fase

Cada migração com mobile precisa validar:

- [ ] Sheet abre via FAB no `bottom-right`, FAB esconde quando aberto
- [ ] `pb-safe` no Sheet (notch iOS não cobre composer)
- [ ] `overscroll-contain` no MessageList (sem pull-to-refresh acidental)
- [ ] `enterkeyhint="send"` no textarea (teclado iOS mostra "enviar")
- [ ] Sheet 90dvh **não pula** quando teclado abre — validar em iPhone real ou Safari mobile com `interactive-widget=resizes-content` no viewport meta
- [ ] Tool call chips com `flex-wrap` (sem scroll horizontal); chips truncate em `max-w-[280px]`
- [ ] Touch targets ≥ 44px (composer buttons, summary toggle, close, FAB 56px)
- [ ] FAB pulse durante streaming visível com cor do agente
- [ ] Drag handle visível no top do Sheet
- [ ] Virtualizer renderiza após anim do Sheet (ver risco § 9)

---

## 7. Visual handoff — screenshots before/after (obrigatório)

Antes de Fase 1 fechar:

1. Screenshot dos **5 thinking indicators atuais** (desktop + mobile cada).
2. Screenshot dos **3 estados de chip** (queued/running/done) propostos, em Alpha e Vitor — render via harness.
3. Screenshot do **summary collapse** abrindo/fechando.
4. Screenshot dos **2 badges atuais** vs `<AgentBadge>` novo (deve ser pixel-equivalente — qualquer diff é regressão).

Anexar ao PR de Fase 1. Aprovação visual antes de Fase 2 começar.

---

## 8. Plano de execução — fases

### Fase 1: Primitivos + harness + composer migration

**Objetivo:** criar `conversation/`, validar virtualizer + memo com 200 mensagens mockadas, migrar todos os callers do `ChatComposer` pra usar prop `agent` (sem mudar JSX dos chats ainda).

**Tarefas:**
1. Criar `agent-themes.ts` com Alpha + Vitor + planEventName.
2. Criar `tool-registry.ts` migrando labels/icons do `tool-call-card.tsx`.
3. Criar `agent-badge.tsx` (lê tema; substitui visualmente os 2 atuais — manter os antigos vivos pra rollback).
4. Criar `thinking-indicator.tsx`.
5. Criar `tool-call-chip.tsx` (3 estados, tema por agente).
6. Criar `tool-call-summary.tsx` (collapseThreshold do tema).
7. Criar `message-bubble.tsx` com memo + comparator + serializeToolStates.
8. Criar `message-list.tsx` com virtualizer + sticky-bottom inteligente + thinking item virtual.
9. Criar `conversation-panel.tsx` (3 variants, sem useIsMobile interno).
10. Criar `conversation-fab.tsx`.
11. Estender `ChatComposer` com props `agent` (obrigatória nos 3 callers Vitor) + `mobileMode` (opcional).
12. **Migrar focus ring de TODOS os 3 callers Vitor pra `agent="vitor"`** — esse é o ajuste crítico que evita janela de inconsistência em fases seguintes.
13. Atualizar `useChatPlanMode` pra receber `agent: AgentId` e usar `theme.planEventName` como nome do CustomEvent. Migrar callers (briefing, pre-work, ai-chat-panel).
14. Criar harness `/dev/chat-stress` com 200 mensagens (50% assistant com 5 tool calls cada). Validar:
    - Virtualizer overscan correto (sem janelas em branco no scroll rápido)
    - Memo não re-renderiza bubbles antigos durante streaming na última
    - Sticky-bottom não flicka no mount
    - Mobile Sheet abre/anima sem render-zero do virtualizer
15. `index.ts` exporta tudo.

**Validação:**
- `bun run typecheck` passa
- `bun run lint` passa
- `bun run build` passa
- Harness em `/dev/chat-stress` valida 200 msgs sem lag, sem flicker, sem re-renders extras (medir com React DevTools profiler)
- Screenshots before/after capturados (seção 7)

**Commit:** `ZRD-JM-XX: ui/conversation — primitives + harness + composer agent migration`

---

### Fase 2: Migrar Vitor briefing (desktop)

**Objetivo:** primeiro consumidor real do `<ConversationPanel>`. **Mobile fica fora desta fase** — é feature nova, vai numa fase separada (Fase 2.5).

**Arquivo:** `src/components/design-session/briefing-task-chat.tsx`

**Tarefas:**
1. Substituir JSX de mensagens/composer por `<ConversationPanel agent="vitor" variant="desktop">`.
2. Manter `useChat()` + `useChatPlanMode("vitor")` + transport intocados.
3. "Carregar mensagens anteriores" via `composerAboveSlot` ou prepend em `messages`.
4. Empty state via prop `emptyState`.
5. Substituir string nua "Analisando briefing…" — `MessageList` já injeta `<ThinkingIndicator>` automaticamente.

**Validação:**
- Conversa abre com scroll no fim (sem flicker)
- Tool calls aparecem como chips Vitor (laranja)
- Plan mode toggle funciona; CustomEvent `chat:planmode:vitor` sincroniza com pre-work
- Stop button funciona
- Markdown não re-parsa a cada chunk (profiler)

**Commit:** `ZRD-JM-XX: design-session/briefing — migrate to ConversationPanel`

---

### Fase 2.5: Adicionar mobile ao Vitor briefing (feature nova)

**Objetivo:** explicitar que briefing nunca teve Sheet/FAB; isto é feature nova, não migração.

**Tarefas:**
1. Wrap caller do briefing com `useIsMobile()` decidindo entre `variant="desktop"` e `variant="mobile"`.
2. Adicionar `<ConversationFab agent="vitor">` quando mobile.
3. Validar checklist mobile § 6.

**Commit:** `ZRD-JM-XX: design-session/briefing — add mobile sheet + FAB`

---

### Fase 3: Migrar Vitor pre-work (desktop + mobile)

**Arquivo:** `src/components/design-session/pre-work-step.tsx`

**Tarefas:**
1. Igual à Fase 2 + manter file upload via `composerLeftActions` (botão clip) e file previews via `composerAboveSlot`.
2. Importação de Roam transcript continua nas left actions.
3. Mobile (também feature nova aqui): `<ConversationFab>` + `variant="mobile"`.

**Validação:**
- File upload funciona (preview + remove)
- Roam transcript import funciona
- Itens da Fase 2 todos ok
- Checklist mobile § 6

**Commit:** `ZRD-JM-XX: design-session/pre-work — migrate to ConversationPanel + mobile`

---

### Fase 4: Migrar Vitor session-wide

**Arquivos:**
- `src/components/design-session/ai-chat-panel.tsx` → deletar
- `src/components/design-session/wizard-layout.tsx` → caller passa a montar `<ConversationPanel>` direto

**Tarefas:**
1. `wizard-layout.tsx` importa `<ConversationPanel agent="vitor">` + `<ConversationFab>`.
2. Apaga `ai-chat-panel.tsx`.
3. Mantém `useDesignSessionChat()` hook (chamado dentro do `wizard-layout`).
4. "Executar plano" via prop `onExecutePlan`.
5. **Trocar `<Loader2 spin>` pelo `<ThinkingIndicator>` automático do MessageList** — esta é a mudança visual mais sensível (validar com screenshot).

**Validação:**
- Wizard abre, chat funciona em todos os steps
- Plan mode + execute plano funciona
- Mobile: Sheet bottom abre via FAB
- Visual: chips durante streaming, summary se >= 3 tools (threshold Vitor)
- ThinkingIndicator substitui Loader2 sem regressão visual percebida (screenshot diff approved)

**Commit:** `ZRD-JM-XX: design-session/wizard — migrate to ConversationPanel; drop ai-chat-panel`

---

### Fase 5: Migrar Alpha sidebar

**Arquivo:** `src/components/alpha-chat/panel.tsx`

**Tarefas:**
1. Reescrever `AlphaChatPanel` usando `<ConversationPanel agent="alpha">`.
2. **Manter** `AlphaChatProvider` + `useAlphaChat()` + idle reset (intocado).
3. **Manter** comportamento desktop "transition w-0 → w-96" — wrapper externo cuida disso, `<ConversationPanel variant="desktop">` é flex h-full no interno.
4. Header customizado via `headerSlot`: botão Maximize2 (link `/ops`), History, Close.
5. Trocar textarea cru pelo `ChatComposer agent="alpha"`.
6. Mobile: `variant="mobile"` (Sheet existente já é compatível visualmente — usa nosso Sheet bottom em vez de side=right; mudança intencional pra padronizar).
7. Adicionar tool call chips no Alpha (hoje não renderiza nada). Fallback Sparkles cobre tools não mapeadas.
8. Validar idle reset com `vi.useFakeTimers()` em teste unitário do hook.

**Validação:**
- ⌘⇧A toggle funciona
- History sheet abre/fecha
- Maximize2 leva pra `/ops`
- Idle reset (30min) funciona — teste unitário + manual
- Visual Alpha (cor primary) aplicado em badge, focus ring, FAB pulse, chip running
- Tool calls de Alpha renderizam como chips (fallback aceitável)

**Commit:** `ZRD-JM-XX: alpha-chat/panel — migrate to ConversationPanel`

---

### Fase 6: Migrar Alpha fullpage `/ops`

**Arquivo:** `src/app/(dashboard)/ops/page.tsx`

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

### Fase 7: Mapear Alpha tools no registry (issue follow-up)

**Objetivo:** remover fallback Sparkles+toolName cru do Alpha. Não bloqueia outras fases.

**Tarefas:**
1. Listar todas as tools do Alpha em `src/lib/agents/alpha/tools/`.
2. Adicionar entrada em `TOOL_REGISTRY` pra cada uma com label PT-BR + ícone Lucide.

**Commit:** `ZRD-JM-XX: ui/conversation — register alpha tool labels`

---

### Fase 8: Cleanup + smoke E2E

**Tarefas:**
1. Smoke E2E manual obrigatório nos 5 chats (desktop + mobile cada):
   - Enviar mensagem
   - Ver streaming
   - Ver chip queued → running → done
   - Ver summary se aplicável
   - Ver thinking indicator
   - Stop streaming
   - Plan mode toggle (Vitor)
   - File upload (pre-work)
2. **Só após smoke passar:** deletar
   - `src/components/design-session/tool-call-card.tsx`
   - `src/components/design-session/vitor-badge.tsx`
   - `src/components/alpha-chat/alpha-badge.tsx`
   - `src/components/design-session/ai-chat-bubble.tsx`
3. Atualizar imports remanescentes (grep `vitor-badge` / `alpha-badge` / `tool-call-card` / `ai-chat-bubble` / `ai-chat-panel`).
4. Remover classes CSS órfãs em `globals.css`.

**Validação:**
- `bun run build` passa
- `bun run lint` passa
- Grep dos arquivos deletados retorna 0 hits
- Smoke E2E checklist completo

**Commit:** `ZRD-JM-XX: chat — drop deprecated badge/card/bubble files`

---

## 9. Riscos & mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Memo comparator quebra streaming (mensagem nova não atualiza) | Média | Alto | `serializeToolStates` + `extractText` íntegro; harness Fase 1 valida com 200 msgs |
| Virtualizer + Sheet anim render zero items no mount | Média | Médio | Hook `useResizeObserver` no parent; harness Fase 1 testa Sheet open/close + virtualizer |
| Bubble cresce mid-stream (markdown longo + tool calls) e virtualizer salta | Média | Médio | `measureElement` ativo; overscan 4. Se persistir, aumentar overscan dinamicamente quando última msg está streamando |
| Mobile Sheet 90dvh pula com teclado iOS | Média | Alto | `interactive-widget=resizes-content` no `<meta viewport>`; fallback hook `useViewportAdjust` que troca pra 100dvh quando `visualViewport.height < window.innerHeight` |
| Alpha tool calls fallback feio (Sparkles + toolName cru) | Alta | Baixo | Aceitável até Fase 7. Fallback é honesto, não quebrado |
| ThinkingIndicator unificado parece regressão visual em ai-chat-panel (Loader2 atual) | Baixa | Médio | Screenshot before/after no PR Fase 4; aprovação visual antes de merge |
| Plan mode CustomEvent vaza entre Alpha e Vitor (futuro) | Baixa | Médio | `theme.planEventName` namespaced (`chat:planmode:alpha` vs `chat:planmode:vitor`) — V2 já resolve |
| `ChatComposer.agent` quebra callers ao migrar | Baixa | Baixo | Migração explícita na Fase 1 (não-default), todos os 3 callers Vitor + futuros Alpha entram com prop preenchida |
| `useLayoutEffect` SSR warning em `/ops` fullpage | Baixa | Baixo | `/ops` já é client component (`useChat`); validar em build |
| Idle reset Alpha quebra silenciosamente após refactor | Média | Médio | Teste unitário do hook com `vi.useFakeTimers()` na Fase 5 |

---

## 10. Não-objetivos (escopo cortado)

- **Não** unificar `useChat` orquestrador (Alpha mantém context, Vitor mantém useChat direto). Refator de arquitetura é outro plano.
- **Não** mexer no backend (`/api/agents/alpha/chat`, `/api/design-sessions/.../chat`). Frontend only.
- **Não** redesenhar tool calls do agente — só padroniza visual.
- **Não** adicionar attachments/files no Alpha (segue text-only).
- **Não** adicionar history threads no Vitor (segue session-bound).
- **Não** localizar labels de tool call (segue PT-BR fixo até decisão de i18n).

---

## 11. Métricas de sucesso

Pós-migração, qualquer chat (Alpha sidebar, Alpha fullpage, Vitor briefing, Vitor pre-work, Vitor session-wide) deve ter:

- ✅ Mesma estética de bubble (rounded-2xl, max-w-85%, role-aware corner)
- ✅ Mesma estética de tool call: chip em 3 estados visualmente coerentes (queued/running/done) com tema do agente; summary collapsível em `>= agent.collapseThreshold`
- ✅ Mesmo thinking indicator: Sparkles + shimmer "Analisando…"
- ✅ Mesmo input (`ChatComposer` com `agent` prop dirigindo focus ring)
- ✅ Cor distinta por agente (badge, focus ring, FAB pulse, chip running)
- ✅ Mobile coerente: Sheet bottom 90dvh, FAB, safe-area, sem overflow horizontal, enterkeyhint
- ✅ Sem flicker de scroll no mount; sticky-bottom inteligente
- ✅ Memoização ativa (sem re-parse de markdown a cada chunk)
- ✅ Virtualizer ativo em todos os 5 chats (não só no session-wide)
- ✅ Plan mode events namespaced por agente (sem cross-talk)

**Sinal de fim:** screenshots side-by-side dos 5 chats em desktop + mobile mostrando consistência total + harness `/dev/chat-stress` rodando 200 msgs em 60fps.

---

## 12. Checklist macro

- [ ] Fase 1: Primitivos `conversation/` + harness + composer agent migration
- [ ] Fase 2: Vitor briefing (desktop)
- [ ] Fase 2.5: Vitor briefing mobile (feature nova)
- [ ] Fase 3: Vitor pre-work (desktop + mobile)
- [ ] Fase 4: Vitor session-wide (drop `ai-chat-panel`)
- [ ] Fase 5: Alpha sidebar
- [ ] Fase 6: Alpha fullpage `/ops`
- [ ] Fase 7: Alpha tools no registry
- [ ] Fase 8: Cleanup + smoke E2E
- [ ] Screenshots de validação anexados em PR de fechamento

---

## 13. Runbook resumido

```bash
# Antes de cada fase
git status && git pull --rebase

# Durante (em terminais separados)
bun run typecheck --watch
bun run dev

# Validar visualmente
# Fase 1: /dev/chat-stress
# Fase 2/2.5: /design-sessions/<id>/steps/briefing
# Fase 3: /design-sessions/<id>/steps/pre_work
# Fase 4: qualquer step com chat session-wide aberto
# Fase 5: qualquer página dashboard com Alpha sidebar (⌘⇧A)
# Fase 6: /ops

# Mobile: DevTools responsive + iPhone real (Safari)

# Fechar fase
bun run typecheck && bun run lint && bun run build
bash scripts/sync-main.sh -m "ZRD-JM-XX: <area> — <message>"
```
