# 04 — Catálogo de Componentes Reutilizáveis

Inventário do que existe **antes** de a skill criar qualquer task UI/API. Toda task UI deve verificar este catálogo e marcar `qualityFlags=['REUSE_EXISTING_COMPONENT']` ou justificar a exceção.

---

## A. Componentes UI (`src/components/ui/`)

### Layout & estrutura
| Componente | Uso | Quando |
|---|---|---|
| `card.tsx` | Card padrão | Listas, painéis, agrupamentos |
| `separator.tsx` | Divisor horizontal/vertical | Separar seções |
| `sidebar.tsx` | Sidebar responsiva | Layout admin |
| `table.tsx` | Tabela com header/rows | Listagens densas (preferir cards mobile) |

### Inputs & forms (Field compound API)
| Componente | Uso | Quando |
|---|---|---|
| `field.tsx` | `Field` + `Field.Label` + `Field.Control` + `Field.Hint` + `FormBody` + `Field.Row` | **Sempre** em formulários |
| `input.tsx` | Input nativo (date, number, tel, email) | Dentro de `Field.Control` |
| `textarea.tsx` | Textarea | Dentro de `Field.Control` |
| `select.tsx` | Select | Dentro de `Field.Control` |
| `label.tsx` | Label standalone | Raro — preferir `Field.Label` |
| `slider.tsx` | Slider | Configurações |

> **Padrão obrigatório (memory `project_ui_patterns`):** Sem `<input>` cru. Sem `react-hook-form`. Validação Zod **só no servidor**, não no client. Estado via `useState` direto.

### Modais & sheets
| Componente | Uso | Quando |
|---|---|---|
| `responsive-sheet.tsx` | Sheet desktop / bottom-sheet mobile (90dvh) | Edição rica de item de lista (story, task, design session, perfil) |
| `responsive-dialog.tsx` | Modal desktop / bottom-sheet mobile | Decisão pontual (1-3 fields, confirmação) |
| `confirm-dialog.tsx` | `ConfirmDialog` stateless | Substitui `window.confirm()` (proibido) |
| `dialog.tsx` | Dialog cru shadcn | **Não usar diretamente** — sempre via `responsive-dialog` |
| `sheet.tsx` | Sheet cru shadcn | **Não usar diretamente** — sempre via `responsive-sheet` |
| `dropdown-menu.tsx` | Menu dropdown | Ações secundárias em listas |

> **Padrão obrigatório:** sem `<Dialog>` ou `<Sheet>` nu. Sem `window.confirm()` / `alert()`. Erros via `Sonner` toast, não em alert.

### Feedback & status
| Componente | Uso | Quando |
|---|---|---|
| `button.tsx` | Botão | Ações primárias/secundárias/destrutivas |
| `badge.tsx` | Badge | Status, contadores |
| `status-chip.tsx` | StatusChip | Status visual padrão da plataforma |
| `status-chip-select.tsx` | StatusChipSelect | StatusChip clicável que abre menu de mudança |
| `skeleton.tsx` | Skeleton loader | Carregamento de listas/detalhes |
| `tooltip.tsx` | Tooltip | Esclarecimentos curtos |
| `sonner.tsx` | Toaster | Erros + confirmações (importado em layout root) |
| `pixel-bar.tsx` | Barra de progresso pixelada | Loaders divertidos |

### Conteúdo
| Componente | Uso | Quando |
|---|---|---|
| `markdown.tsx` | Renderizador de markdown | Descrições, conteúdo gerado por agente |
| `chat-composer.tsx` | Composer de chat | Chat interno (US-025) |
| `conversation/` | Componentes de conversa | Chat interno |

---

## B. Hooks (`src/hooks/`)

| Hook | Uso |
|---|---|
| `use-mobile.ts` | `useIsMobile()` — true se viewport < 768px (context-driven) |
| `use-optimistic-collection.ts` | `useOptimisticCollection<T, X>(initial, reducer?)` — **obrigatório** em listas mutáveis. Mutations: `patch \| create \| delete \| bulkPatch \| bulkDelete \| external_update` |
| `use-field-debounce.ts` | Debounce para campos de busca |
| `use-notifications.ts` | Notificações in-app |
| `use-design-session-chat.ts` | Chat de design session (referência de chat com agente) |
| `use-chat-plan-mode.ts` | Modo de planejamento de chat |
| `use-telegram-connection.ts` | Conexão Telegram |
| `use-wiki-items.ts` | Itens de wiki |

---

## C. Libs (`src/lib/`)

### Optimistic & rede
| Lib | Uso |
|---|---|
| `lib/optimistic/reconcile.ts` | `reconcileById(prev, server, idKey)`, `replaceTempId(prev, tempId, real)` |
| `lib/optimistic/toast.ts` | `showErrorToast(mutation, error)` — distingue 403/409/5xx/network |
| **`fetchOrThrow`** (em algum lugar do utils) | Wrapper de fetch que lança `HttpError` com status preservado |

> **Padrão obrigatório:** nunca `setState` direto após `fetch` em listas. Sempre `mutate(...)`.

### Supabase
| Lib | Uso |
|---|---|
| `lib/supabase/server.ts` | `createClient()` para Server Components / route handlers / server actions |
| `lib/supabase/client.ts` | `createBrowserClient()` para componentes `'use client'` |
| `lib/supabase/admin.ts` | `createAdminClient()` com service_role — **server-only**, jobs e Edge Functions |
| `lib/supabase/database.types.ts` | Tipos gerados — **regenerar após cada migration** |
| `lib/supabase/types.ts` | Helpers de tipos derivados |

### Utilidades de domínio (já existentes — checar antes de criar)
| Lib | Uso |
|---|---|
| `lib/dal.ts` + `lib/dal/` | Data Access Layer — funções server-only que encapsulam queries |
| `lib/sprint-dates.ts` | Helper único pra cálculo de Sprint week (memory `project_sprint_week_model`) |
| `lib/roles.ts` | Helpers de role + matriz de permissão (memory `feedback_role_helpers_postgres`) |
| `lib/status-chips.ts` | Configuração de status chips por entidade |
| `lib/task-constants.ts` + `lib/task-generator.ts` | Constantes e geração de tasks (do método anterior — referência, mas Zelar v2 usa schema próprio) |
| `lib/function-points.ts` | Cálculo de FP (não usar em Zelar v2 nesta fase) |
| `lib/design-session-steps.ts` + `lib/design-sessions/` | Lógica de DS |
| `lib/agent/` + `lib/ai/` | Agentes (Alpha, design session, telegram) |
| `lib/email.ts` | Envio de email |
| `lib/github.ts` | Operações GitHub |
| `lib/composio/` | Integrações externas via Composio |
| `lib/meetings/` | Lógica de meetings |
| `lib/member-integrations.ts`, `lib/memberSkills.ts` | Member metadata |
| `lib/mentions.ts` | Mentions parsing |
| `lib/pdiCycles.ts` | PDI cycles |
| `lib/project-reference-key.ts` | Geração de reference keys |
| `lib/roam.ts` | Roam (legacy) |
| `lib/todos/` | Todos |

---

## D. Padrões UI obrigatórios (memory `project_ui_patterns`)

1. **Componentes reutilizáveis vivem em `src/components/ui/`** — checar antes de criar
2. **Responsive Sheet/Dialog sempre** — nunca `<Dialog>` ou `<Sheet>` cru
3. **Custom Confirm/Alert** — proibido `window.confirm()` / `alert()`. Use `ConfirmDialog`
4. **Forms — Field compound API** — sem react-hook-form, sem masked-input lib
5. **Optimistic updates sempre que mutar coleção** — `useOptimisticCollection`

---

## E. Convenções de path

```
src/app/                    # rotas Next 16 (App Router)
  (client)/                 # rotas do PWA do cliente
  (provider)/               # rotas do PWA do prestador
  admin/                    # rotas do painel admin
  api/                      # route handlers
src/components/             # componentes específicos de feature
  ui/                       # design system (catálogo acima)
  <feature>/                # componentes da feature
src/hooks/                  # hooks reutilizáveis
src/lib/                    # libs reutilizáveis
supabase/migrations/        # migrations SQL
supabase/functions/         # Edge Functions
docs/task-gen/              # docs operacionais (este diretório)
```

---

## F. Dependências externas instaladas (referência)

- **Supabase:** `@supabase/supabase-js`, `@supabase/ssr`
- **Validação:** `zod`
- **UI primitives:** `@radix-ui/*` (via shadcn)
- **Toast:** `sonner` (^2.0.7)
- **Utility:** `clsx`, `tailwind-merge`, `lucide-react`
- **Date:** date-fns (provavelmente — verificar package.json)
- **Markdown:** verificar (likely react-markdown)

> **Antes de adicionar nova dep**: justificar na task description e checar se já existe equivalente.

---

## G. Antipatterns a evitar

- ❌ `<input>` cru sem `Field` wrapper
- ❌ `<Dialog>` direto do shadcn
- ❌ `window.confirm()` ou `alert()`
- ❌ `setState` direto após `fetch` em listas (usar `useOptimisticCollection`)
- ❌ Validação Zod no client (Zod só no servidor)
- ❌ react-hook-form
- ❌ Masked-input libs (input nativo type="date|number|tel" basta)
- ❌ Service role no client
- ❌ String literal de role/status em código (usar constantes/enums)
- ❌ Componente novo quando existe um do design system que cobre

---

## H. Como uma task UI declara reuso

```markdown
## Reuso
- `ResponsiveSheet` (size="md") — para edição
- `Field` + `Input` + `Select` — formulário
- `useOptimisticCollection` — lista de endereços
- `ConfirmDialog` — confirmação de exclusão
- `Sonner` (`showErrorToast`) — feedback de erro

## qualityFlags
REUSE_EXISTING_COMPONENT, REUSE_EXISTING_HOOK,
RESPONSIVE_SHEET_REQUIRED, CONFIRM_DIALOG_REQUIRED,
FIELD_COMPOUND_API, OPTIMISTIC_UPDATE
```
