# Projects page — mobile parity + UX standardization

Data: 2026-04-30
Status: planejado (substitui versão anterior)
Origem: regressão mobile após migração `_deprecated/page-legacy.tsx` → `page.tsx` (commits ZRD-JM-03 a ZRD-JM-06).

## Resumo executivo

A primeira versão deste plano tratava o problema como "trocar classes de mobile". Análise mais funda mostra que o problema é estrutural:

1. **Não existe primitivo `ResponsiveSheet`.** O snippet `side={isMobile ? "bottom" : "right"}` está duplicado em 8 arquivos (busca em [src/](../src/) por essa string), cada um repetindo as mesmas classes (`h-[90dvh] max-h-[90dvh] gap-0 rounded-t-xl p-0`, drag handle, `w-full sm:max-w-xl gap-0 p-0`). É o gêmeo de [`ResponsiveDialog`](../src/components/ui/responsive-dialog.tsx) que nunca foi escrito.
2. **Padrão de criar item está inconsistente.** No projeto:
   - `StoryCreateDialog` → `Sheet side="right"` hardcoded (nome do arquivo é mentira: é um Sheet, não um Dialog).
   - `TaskCreateDialog` → `Dialog` central (1 form com ~16 campos espremido em modal — desktop ruim, mobile quebrado).
   - `ModuleDialog`, `PersonaDialog` → `Dialog` central (formulário de 2 campos — OK como dialog).
   - `SprintDialog` → `ResponsiveDialog` (correto).
   - `ProjectEditSheet`, `task-sheet.tsx` legacy, `todo-sheet.tsx`, `meeting-task-action-sheet.tsx` → `Sheet` com `side` responsivo manual (correto, mas duplicado).
3. **Legacy unificava create+edit em um único Sheet.** [task-sheet.tsx:83-115](../src/components/task-sheet.tsx#L83-L115) abre com `taskId=null` para criar, `taskId="..."` para editar. O novo código tem **dois** componentes (`TaskCreateDialog` + story-hierarchy `TaskSheet`) que compartilham ~80% dos campos e zero código. Mesma redundância em stories.
4. **Plano anterior do botão de voltar estava quebrado.** [`PageTitle`](../src/components/app-shell/page-title/page-title.tsx) é portal — empurra título pro shell header sticky e renderiza `null` no body. Adicionar `<ArrowLeft>` "antes de PageTitle" gera um botão órfão sem título ao lado. Back-link precisa ser primitivo do shell, não código repetido em cada page (já está duplicado em `agents/[slug]/layout.tsx`, `profile/capacity/page.tsx`, `profile/pdi/page.tsx`, `sprints/[id]/board/page.tsx`).
5. **Tabela de stories/tasks em grid de ~710px** estoura em qualquer viewport <800px sem fallback.

A correção é: extrair primitivos, padronizar o vocabulário de container, eliminar duplicações, e só **depois** ajustar classes responsivas.

## Reclamações do usuário (origem)

1. Mobile tem padrão bottom sheet para criar coisas (sprint, task e story) — quebrado em story/task.
2. Todos os modais devem ser bottom sheet em mobile — quebrado em ModuleDialog, PersonaDialog, StorySheet, TaskSheet, StoryCreateDialog, TaskCreateDialog.
3. Filtros e toggle de visão estão deslocados.
4. Não tem botão de voltar (mobile ou desktop).
5. (Implícito) Criar task em desktop hoje é um modal central de 16 campos — fora do padrão da legacy, que usava painel lateral mantendo a lista visível.

## Princípios de design — vocabulário de container

Toda interação no app cai em **uma de três categorias**. A categoria define o container. Não há outra escolha.

### 1. Detail panel (Sheet lateral / bottom)

**Quando**: editar/criar um item rico que vive numa lista visível (story, task, project, design session). O usuário precisa do contexto da lista enquanto edita.

**Container**:
- Desktop: `Sheet side="right"`, `sm:max-w-[640px]` (700px+ para tasks).
- Mobile: `Sheet side="bottom"`, `h-[90dvh]`, drag handle no topo.
- Header sticky com título, breadcrumb opcional e botão de fechar.
- Body com scroll interno.
- Footer sticky para CTAs (em formulários longos).

**Casos**: StorySheet, TaskSheet, StoryCreate, TaskCreate, ProjectEditSheet, ProjectAccessSheet, MeetingTaskActionSheet, TodoSheet.

### 2. Decision dialog (ResponsiveDialog central / bottom)

**Quando**: decisão atômica com ≤3 campos ou confirmação. O usuário não precisa do contexto ao redor — ele para, decide, segue.

**Container**: `ResponsiveDialog` (já existe — Dialog central no desktop, Sheet bottom no mobile).

**Casos**: ModuleDialog (nome + descrição), PersonaDialog (nome + descrição), SprintDialog (4 campos), confirmações de delete, "aprovar módulo proposto".

### 3. Inline edit

**Quando**: campo único editável na própria lista (status, sprint, assignee em row de task). Já existe e está ok — não mexe.

### Regra de bolso

- **Mais de 5 campos OU campos contextuais à lista** → Detail panel.
- **Até 3 campos OU decisão isolada** → Decision dialog.
- **1 campo + nenhuma decisão** → Inline.

Aplicando: TaskCreate hoje tem 9 campos visíveis (title, desc, story, status, type, scope, complexity, area, fp). É **detail panel**, não dialog. StoryCreate tem 5 campos + AC list. **Detail panel**. ModuleDialog tem 2 campos. **Decision dialog**. Esse é o erro de classificação atual.

## Primitivos a criar/estender

### 1. `ResponsiveSheet` — novo

Localização: [src/components/ui/responsive-sheet.tsx](../src/components/ui/responsive-sheet.tsx) (não existe).

API espelha `ResponsiveDialog`:

```tsx
<ResponsiveSheet open={open} onOpenChange={setOpen}>
  <ResponsiveSheetContent size="md">         {/* sm | md | lg → 480 / 640 / 760 px no desktop */}
    <ResponsiveSheetHeader>
      <ResponsiveSheetTitle>...</ResponsiveSheetTitle>
      <ResponsiveSheetDescription>...</ResponsiveSheetDescription>
    </ResponsiveSheetHeader>
    <ResponsiveSheetBody>...</ResponsiveSheetBody>
    <ResponsiveSheetFooter>
      <Button variant="ghost">Cancelar</Button>
      <Button>Salvar</Button>
    </ResponsiveSheetFooter>
  </ResponsiveSheetContent>
</ResponsiveSheet>
```

Implementação:
- `useIsMobile` interno via Context (mesmo padrão do `ResponsiveDialog`).
- Mobile: `<SheetContent side="bottom" className="h-[90dvh] gap-0 rounded-t-xl p-0 flex flex-col">` + drag handle no topo + body com `overflow-y-auto`.
- Desktop: `<SheetContent side="right" className="w-full sm:max-w-[640px] gap-0 p-0 flex flex-col">` (size sm=480, md=640, lg=760).
- Footer sticky `border-t bg-popover` em ambos.
- Header sticky `border-b bg-popover` em ambos.

Substitui (deduplicação):
- [project-edit-sheet.tsx:177-191](../src/components/project-edit-sheet.tsx#L177-L191)
- [task-sheet.tsx:88-115](../src/components/task-sheet.tsx#L88-L115)
- [todo-sheet.tsx:62-71](../src/components/todo-sheet.tsx#L62-L71)
- [meeting-task-action-sheet.tsx:92-101](../src/components/meetings/meeting-task-action-sheet.tsx#L92-L101)
- [history-sheet.tsx:94-101](../src/components/alpha-chat/history-sheet.tsx#L94-L101)
- [super-session-modal.tsx:123-130](../src/components/design-session/super-session-modal.tsx#L123-L130)
- [roam-transcript-modal.tsx:123-130](../src/components/design-session/roam-transcript-modal.tsx#L123-L130)
- e os 4 sheets novos de story-hierarchy.

Passo 1.1 do plano só extrai e migra **os 4 de story-hierarchy + ProjectEditSheet** (escopo deste plano). Migrações dos outros 5 ficam fora — virar issue separado de "tech debt UI".

### 2. `BackLink` / `PageHeader` — novo

Hoje, "botão de voltar com label" é repetido em 4 lugares (`agents/[slug]/layout.tsx`, `profile/capacity/page.tsx`, `profile/pdi/page.tsx`, `sprints/[id]/board/page.tsx`) com classes ligeiramente diferentes em cada um. Mais a regressão de não ter em `projects/[id]`.

Opção A — `<BackLink>` simples:

```tsx
<BackLink href="/projects" label="Projetos" />
```

Render: `<Link>` com `<ArrowLeft className="size-3" />` + label, classes consistentes (`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground`). Esse é o padrão que `agents/[slug]/layout.tsx:71-77` já usa — só falta extrair.

Opção B — extender `PageTitle` com prop `backHref`:

```tsx
<PageTitle title="..." subtitle="..." backHref="/projects" />
```

Renderiza um chevron clicável **dentro do shell header sticky** (à esquerda do título), via [page-title-context.tsx](../src/components/app-shell/page-title/page-title-context.tsx) + [page-title-slot.tsx](../src/components/app-shell/page-title/page-title-slot.tsx). Vantagem: o back fica sempre visível mesmo com scroll, no header sticky, fora do flow do conteúdo. É a paradigma certa pra mobile (single-back-button no top bar, padrão iOS/Android).

**Recomendação: opção B**, com fallback `<BackLink>` para casos in-page (raros).

Implementação opção B:
- Estender `PageTitleContextValue` com `backHref?: string | null`.
- Em `PageTitleSlot`, antes do título: se `backHref`, renderizar `<Link href={backHref} className="-ml-1 mr-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>`.
- Em `PageTitle`, propagar `backHref` via `set({...})`.

### 3. `EntityList` / `DataGrid` mobile-aware — fora de escopo deste plano

A grid `grid-cols-[110px_1fr_120px_110px_140px_110px_110px]` aparece literalmente em [stories-list.tsx:127, 173](../src/components/story-hierarchy/stories-list.tsx#L127), e a versão dinâmica em [tasks-list.tsx:428-432](../src/components/story-hierarchy/tasks-list.tsx#L428). O ideal é um primitivo `<EntityList columns={[…]} rows={…}>` que esconde colunas com `priority` em viewport menor. **Não fazer agora** — virar plano separado. Aqui aplicamos uma correção tática (passo 6 abaixo).

## Plano de execução — fases

Cada fase é 1 PR. Ordem por dependência: primitivos antes dos consumidores.

---

### Fase 1 — Primitivos

#### 1.1 — `ResponsiveSheet`

Criar [src/components/ui/responsive-sheet.tsx](../src/components/ui/responsive-sheet.tsx) com a API descrita acima. Exportar `ResponsiveSheet`, `ResponsiveSheetContent`, `ResponsiveSheetHeader`, `ResponsiveSheetTitle`, `ResponsiveSheetDescription`, `ResponsiveSheetBody`, `ResponsiveSheetFooter`.

Validar com snapshot manual: abrir `ProjectEditSheet` migrado lado a lado com a versão atual em desktop e mobile. Nenhuma diferença visual.

Commit: `ZRD-JM-NN: ui — ResponsiveSheet primitivo (Sheet right desktop, bottom mobile)`

#### 1.2 — `PageTitle` com `backHref`

Estender contexto + slot ([page-title-context.tsx](../src/components/app-shell/page-title/page-title-context.tsx), [page-title-slot.tsx](../src/components/app-shell/page-title/page-title-slot.tsx), [page-title.tsx](../src/components/app-shell/page-title/page-title.tsx)).

Commit: `ZRD-JM-NN: app-shell — PageTitle com backHref no shell header`

---

### Fase 2 — Padronização de containers em `projects/[id]`

#### 2.1 — Migrar 4 sheets/dialogs de story-hierarchy

Trocar para `ResponsiveSheet` ou `ResponsiveDialog` conforme classificação:

| Componente | Hoje | Vai virar | Motivo |
|---|---|---|---|
| [story-create-dialog.tsx](../src/components/story-hierarchy/story-create-dialog.tsx) | Sheet right hardcoded | **`ResponsiveSheet` size="md"** | 5+ campos + AC list, contextual |
| [story-sheet.tsx](../src/components/story-hierarchy/story-sheet.tsx) | Sheet right hardcoded | **`ResponsiveSheet` size="md"** | view/edit de story |
| [task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) | Sheet right hardcoded | **`ResponsiveSheet` size="lg"** | 13+ campos inline-editáveis |
| [task-create-dialog.tsx](../src/components/story-hierarchy/task-create-dialog.tsx) | Dialog central | **`ResponsiveSheet` size="md"** | 9 campos — não é dialog |
| [dialogs.tsx](../src/components/story-hierarchy/dialogs.tsx) ModuleDialog | Dialog central | **`ResponsiveDialog`** | 2 campos — segue dialog, mas mobile-aware |
| [dialogs.tsx](../src/components/story-hierarchy/dialogs.tsx) PersonaDialog | Dialog central | **`ResponsiveDialog`** | idem |

Renomes (correção da mentira no nome):
- `story-create-dialog.tsx` → `story-create-sheet.tsx`
- `task-create-dialog.tsx` → `task-create-sheet.tsx`
- Atualizar imports em [page.tsx:30-44](../src/app/(dashboard)/projects/[id]/page.tsx#L30-L44).

**Atenção ao `ResponsiveSheetBody`**: como é `flex-1 overflow-y-auto`, todo formulário longo precisa estar dentro dele. Se o componente atual usa `<form>` direto no SheetContent, envolver no Body para garantir scroll mobile.

Commit: `ZRD-JM-NN: story-hierarchy — sheets/dialogs migrados pra primitivos responsivos`

#### 2.2 — Unificar `TaskCreateSheet` ↔ `TaskSheet` (legacy pattern)

Hoje há duas implementações com ~80% sobreposição:
- [task-create-dialog.tsx](../src/components/story-hierarchy/task-create-dialog.tsx) — 337 linhas, usado SÓ em "Nova task".
- [task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) — 671 linhas, usado SÓ em "abrir task existente".

Legacy [task-sheet.tsx:83-115](../src/components/task-sheet.tsx#L83-L115) resolveu isso há tempos: um único componente que aceita `taskId: string | null`. `null` = create mode (cria draft local, persiste no submit), `string` = edit mode (load + inline-save em cada blur).

Aplicar a mesma estratégia em story-hierarchy:

```tsx
<TaskSheet
  task={null}                  // ← create mode
  defaultStoryRef={...}        // ← já que não há task ainda
  onCreate={handleCreateTask}  // ← persiste tudo de uma vez
  // ...
/>

<TaskSheet
  task={selectedTask}          // ← edit mode (existing flow)
  onSave={handleSaveTask}
  // ...
/>
```

Internamente: `if (task === null) return <TaskCreateForm onSubmit={onCreate} />` reutilizando os mesmos `<FieldBlock>` + selects do edit mode. Modo create tem footer com Cancelar/Criar; modo edit é inline-save sem footer (já é hoje).

Resultado: deletar `task-create-dialog.tsx` por completo. Mesma economia para story (`<StorySheet story={null} onCreate={...} />`).

Commit: `ZRD-JM-NN: story-hierarchy — TaskSheet/StorySheet unificam create+edit (deleta CreateDialog)`

> Nota: este passo é **mais arriscado** que o resto. Se o usuário preferir ir mais rápido, pular 2.2 e parar em 2.1 — a UI já fica padronizada, só fica o débito de duas implementações redundantes.

---

### Fase 3 — `projects/[id]` page — header, tabs, listas

#### 3.1 — Back link no shell header

Em [page.tsx:853](../src/app/(dashboard)/projects/[id]/page.tsx#L853):

```tsx
<PageTitle
  title={project.name}
  subtitle={`${project.client?.name ?? "—"} · ${project.status}`}
  backHref="/projects"
/>
```

Aproveitar para migrar também `agents/[slug]/layout.tsx`, `sprints/[id]/board/page.tsx`, `profile/capacity/page.tsx`, `profile/pdi/page.tsx` para usar `backHref` (deletar back-links inline duplicados). Quatro arquivos extra, ~40 linhas removidas.

Commit: `ZRD-JM-NN: pages — backHref no PageTitle (deduplica back-links)`

#### 3.2 — Header de ações: labels colapsáveis em mobile

[page.tsx:896-913](../src/app/(dashboard)/projects/[id]/page.tsx#L896-L913):

```tsx
<Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
  <Pencil className="size-4" />
  <span className="hidden sm:inline">Editar projeto</span>
</Button>
<Button variant="outline" size="sm" onClick={() => setAccessOpen(true)}>
  <Shield className="size-4" />
  <span className="hidden sm:inline">Access</span>
</Button>
```

Ainda na mesma row: a meta line (referenceKey + status + PM + N membros) deve quebrar em duas linhas em mobile sem alinhar tudo num bloco só. Trocar `flex flex-wrap items-center gap-2` por `flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center`. Botões `Editar/Access` ficam num cluster com `sm:ml-auto` (sem `ml-auto` em mobile pra não saltar pra direita).

Commit: `ZRD-JM-NN: projects/[id] — header de ações com labels colapsáveis e flow mobile`

#### 3.3 — Tab bar: bleed lateral + shrink-0

[page.tsx:917](../src/app/(dashboard)/projects/[id]/page.tsx#L917):

```tsx
<div className="flex gap-1 border-b overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
```

Botões em [page.tsx:919-942](../src/app/(dashboard)/projects/[id]/page.tsx#L919-L942) recebem `shrink-0`:

```tsx
className={`flex shrink-0 items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${...}`}
```

Classe `scrollbar-none` já existe em [globals.css:246-247](../src/app/globals.css#L246-L247). Sem registro novo.

Commit: `ZRD-JM-NN: projects/[id] — tab bar com bleed mobile e shrink-0`

#### 3.4 — Toolbar de tasks-list

[tasks-list.tsx:128-218](../src/components/story-hierarchy/tasks-list.tsx#L128-L218): reorganizar pra que filtros e CTA tenham layout previsível em mobile.

```tsx
<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
  {/* Filtros (3 selects) */}
  <div className="flex flex-wrap gap-2">
    {/* Cada select: trocar w-[Npx] por min-w-[140px] flex-1 sm:flex-none sm:w-[Npx] */}
  </div>
  {/* Toggle + CTA */}
  <div className="flex items-center gap-1 sm:ml-auto">
    {/* Story/Flat toggle + Nova task */}
  </div>
</div>
```

Selects:
- Linha 133: `h-8 w-[160px] text-xs` → `h-8 w-full min-w-[140px] flex-1 sm:flex-none sm:w-[160px] text-xs`
- Linhas 151, 170: idem com 140px.

Commit: `ZRD-JM-NN: tasks-list — toolbar reorganizada para mobile`

#### 3.5 — Stories/Tasks list: card stack em mobile

A grid de 7 colunas com 710px de largura mínima é hostil em mobile. Duas opções já discutidas; **escolher card stack (Opção B)** porque já é o padrão da legacy nessa página.

Estratégia:

```tsx
{/* Desktop: grid */}
<div className="hidden md:block">
  <div className="grid grid-cols-[110px_1fr_120px_110px_140px_110px_110px] ...">
    {/* header + rows existentes */}
  </div>
</div>

{/* Mobile: cards */}
<div className="md:hidden divide-y rounded-xl border">
  {rows.map((row) => (
    <StoryCardRow key={row.reference} story={row} ... />
    /* ou TaskCardRow para tasks-list */
  ))}
</div>
```

`StoryCardRow` mostra: ref + título (1ª linha), módulo + refinement + status (2ª linha de chips), tasks/FP counters (3ª linha em mono pequeno). Mesmos chips reutilizados de [chips.tsx](../src/components/story-hierarchy/chips.tsx).

`TaskCardRow` (em tasks-list): ref + título (1ª linha), story breadcrumb se grouped (2ª linha), area + status + FP + assignee (3ª linha de chips).

Não criar componentes novos por arquivo — declarar inline em [stories-list.tsx](../src/components/story-hierarchy/stories-list.tsx) e [tasks-list.tsx](../src/components/story-hierarchy/tasks-list.tsx) como funções locais (`function StoryCardRow(...)`). Se ficar grande (>80 linhas), aí extrair pra `entity-card-row.tsx` no mesmo diretório.

**Cuidado** com [tasks-list.tsx:428-432](../src/components/story-hierarchy/tasks-list.tsx#L428-L432): inline style `gridTemplateColumns` é dinâmico (depende de `storyHint` e `editing.showSprint`) — preservar no branch desktop.

Commit: `ZRD-JM-NN: story-hierarchy — card stack em mobile pra stories/tasks list`

---

### Fase 4 — Polimento opcional

Itens menores, podem virar 1 PR só ou ficar pra depois:

- **Sprint timeline + capacity** ([src/components/sprint/](../src/components/sprint/)): verificar se algum modal interno também é Dialog desalinhado. Triagem rápida — fora do escopo se OK.
- **Migrar TodoSheet, MeetingTaskActionSheet, etc** para `ResponsiveSheet` (deduplicação restante). Issue separado de tech debt.
- **`EntityList` primitivo** com colunas priorizadas (issue separado).

## Inventário de quebras (resumo)

| # | Arquivo:linha | Problema | Fix |
|---|---|---|---|
| A | [story-create-dialog.tsx:107-110](../src/components/story-hierarchy/story-create-dialog.tsx#L107-L110) | Sheet right hardcoded | ResponsiveSheet (2.1) |
| B | [story-sheet.tsx:73-75](../src/components/story-hierarchy/story-sheet.tsx#L73-L75) | idem | idem |
| C | [task-sheet.tsx:106-109](../src/components/story-hierarchy/task-sheet.tsx#L106-L109) | idem | idem |
| D | [task-create-dialog.tsx:148-149](../src/components/story-hierarchy/task-create-dialog.tsx#L148-L149) | Dialog central pra form de 9 campos | ResponsiveSheet + unificar com TaskSheet (2.1, 2.2) |
| E | [dialogs.tsx:67](../src/components/story-hierarchy/dialogs.tsx#L67) ModuleDialog | Dialog hardcoded | ResponsiveDialog (2.1) |
| F | [dialogs.tsx:162](../src/components/story-hierarchy/dialogs.tsx#L162) PersonaDialog | idem | idem |
| G | [page.tsx:853](../src/app/(dashboard)/projects/[id]/page.tsx#L853) | sem back-link | PageTitle backHref (3.1) |
| H | [page.tsx:858, 896](../src/app/(dashboard)/projects/[id]/page.tsx#L858) | meta line + ações em mesma row, labels longos | flex-col mobile + labels colapsáveis (3.2) |
| I | [page.tsx:917](../src/app/(dashboard)/projects/[id]/page.tsx#L917) | tab bar sem bleed mobile, sem shrink-0 | bleed + shrink-0 (3.3) |
| J | [tasks-list.tsx:128-218](../src/components/story-hierarchy/tasks-list.tsx#L128-L218) | toolbar com `ml-auto` salta em mobile | flex-col mobile (3.4) |
| K | [stories-list.tsx:127, 173](../src/components/story-hierarchy/stories-list.tsx#L127), [tasks-list.tsx:428-432](../src/components/story-hierarchy/tasks-list.tsx#L428-L432) | grid 7 cols ~710px estoura <800px | card stack mobile (3.5) |

## Validação

Para cada fase:
- `pnpm type-check` (ou equivalente).
- Abrir `/projects/<id>` em viewports: iPhone SE (375×667), iPhone 14 Pro Max (430×932), iPad mini (768×1024), desktop 1440. Validar:

| Verificação | Mobile | Desktop |
|---|---|---|
| Criar story | Bottom sheet 90dvh, drag handle, scroll interno, footer sticky | Right sheet 640px, sem reflow |
| Criar task | idem | idem |
| Abrir story | idem (90dvh) | idem (640px) |
| Abrir task | idem (90dvh) | Right sheet 760px (tem mais campos) |
| Criar módulo/persona | Bottom sheet curto, drag handle | Dialog central pequeno |
| Tabs do projeto | Scroll horizontal, sem barra visível, bleed nas laterais | Sem scroll, todas visíveis |
| Botão de voltar | No top bar sticky, ícone só | No top bar, ícone só |
| Header de ações | Botões em row separada, label oculto, ícone visível | Inline com meta line, labels visíveis |
| Toolbar tasks-list | Filtros em 1ª linha (encolhem), CTA em 2ª | Tudo numa linha, CTA `ml-auto` |
| Lista de stories/tasks | Card stack | Grid 7 colunas |

Para cada PR: print de antes/depois nos 4 viewports, anexado na descrição.

## Fora do escopo

- Migrar Sheets fora de `projects/[id]` para `ResponsiveSheet` (TodoSheet, MeetingTaskActionSheet, history-sheet, super-session-modal, roam-transcript-modal). Issue separado de tech debt.
- `EntityList` primitivo com priorização de colunas. Issue separado.
- Redesign do header (PageTitle + meta line + ações). Hoje funciona; foco aqui é parar de quebrar.
- Remover `_deprecated/page-legacy.tsx`. Esperar paridade confirmada por mais um sprint.

## Commits sugeridos (resumo, ordem)

```
ZRD-JM-NN: ui — ResponsiveSheet primitivo (Sheet right desktop, bottom mobile)
ZRD-JM-NN: app-shell — PageTitle com backHref no shell header
ZRD-JM-NN: story-hierarchy — sheets/dialogs migrados pra primitivos responsivos
ZRD-JM-NN: story-hierarchy — TaskSheet/StorySheet unificam create+edit (deleta CreateDialog)   [opcional, mais arriscado]
ZRD-JM-NN: pages — backHref no PageTitle (deduplica back-links em 4 pages)
ZRD-JM-NN: projects/[id] — header de ações com labels colapsáveis e flow mobile
ZRD-JM-NN: projects/[id] — tab bar com bleed mobile e shrink-0
ZRD-JM-NN: tasks-list — toolbar reorganizada para mobile
ZRD-JM-NN: story-hierarchy — card stack em mobile pra stories/tasks list
```
