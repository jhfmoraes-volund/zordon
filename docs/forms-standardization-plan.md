# Forms Standardization Plan — Project Forms (v2)

**Escopo**: formulários do contexto **Projeto** (story, task, module, persona, sprint, project, task-clone, task-duplicate, dependencies-block, status-cell em listas). Out-of-scope: meetings, members, profile, agentes, settings.

**Status**: proposta v2. Iniciado 2026-05-07. Revisão 2026-05-07 incorpora: refactor de primitivos, A11y compound API, RHF-readiness, densidade como prop, `StatusChipSelect` integrado, lint enforcement.

---

## 1. Problema

Formulários do projeto não têm sistema. Cada autor improvisa altura, espaçamento, label/control, A11y, validação. O sintoma visível é altura divergente; o problema real é **ausência de contrato**.

### Sintomas observados (factual, com evidência)

- **`SelectTrigger` default é `h-8` + `w-fit`** ([select.tsx:44](../src/components/ui/select.tsx#L44)): qualquer override `className="h-9 w-full"` perde por ordem de declaração CSS. Tailwind-merge não desambigua variantes `data-*`. Resultado: 6 ocorrências de `h-9 w-full` em [task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) sem efeito.
- **`Input` é `h-8`** ([input.tsx:12](../src/components/ui/input.tsx#L12)) e **`Textarea` não declara altura mínima compatível** ([textarea.tsx:8](../src/components/ui/textarea.tsx#L8)): mistura forçada com selects de `h-9` vira misalignment vertical.
- **`StatusChipSelect variant="input"` usa `!h-9`** ([status-chip-select.tsx:65](../src/components/ui/status-chip-select.tsx#L65)) — o `!important` é a evidência física de que wrappers não vencem o primitivo. Já tem hack em produção contra exatamente este bug.
- **`<Label>` não declara `htmlFor`** ([label.tsx](../src/components/ui/label.tsx)) e nenhum call-site passa: A11y quebrada em todos os 9 forms. Screen reader não associa label↔control.
- **`FieldBlock` duplicado** em [task-sheet.tsx:689](../src/components/story-hierarchy/task-sheet.tsx#L689) e [todo-sheet.tsx:338](../src/components/todo-sheet.tsx#L338): dois componentes com mesmo nome, APIs ligeiramente diferentes, ninguém percebeu.
- **Layout repetido manualmente**: `grep "space-y-1.5"` retorna 30+ ocorrências, `grep "grid grid-cols-2 gap-3"` retorna 7 só no escopo Projeto.
- **State management cru**: 10+ `useState` paralelos em [task-sheet.tsx:211-225](../src/components/story-hierarchy/task-sheet.tsx#L211); zero validação em [sprint-dialog.tsx](../src/components/sprint-dialog.tsx); zero error UI em todos os 9 forms.

### Causa raiz

Não há **token de altura**, não há **primitivo de Field**, não há **schema de validação**, não há **contrato A11y**. Cada call-site decide tudo.

---

## 2. Inventário (auditado via grep)

| Arquivo | Tipo | O que edita | Notas |
|---|---|---|---|
| [src/components/story-hierarchy/story-sheet.tsx](../src/components/story-hierarchy/story-sheet.tsx) | Sheet | User Story | 5 fields, `space-y-5` body |
| [src/components/story-hierarchy/task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) | Sheet | Task | ~12 fields, FieldBlock local, mistura Select/StatusChipSelect/DropdownMenu/TagPicker |
| [src/components/story-hierarchy/dialogs.tsx](../src/components/story-hierarchy/dialogs.tsx) | Dialog | Module + Persona | 4 ocorrências de `space-y-1.5` |
| [src/components/story-hierarchy/task-clone-dialog.tsx](../src/components/story-hierarchy/task-clone-dialog.tsx) | Dialog | Task → outro projeto | 2 fields |
| [src/components/story-hierarchy/task-duplicate-dialog.tsx](../src/components/story-hierarchy/task-duplicate-dialog.tsx) | Dialog | Task duplicate | 2 fields |
| [src/components/story-hierarchy/dependencies-block.tsx](../src/components/story-hierarchy/dependencies-block.tsx) | Inline | Task dependencies | 1 field |
| [src/components/sprint-dialog.tsx](../src/components/sprint-dialog.tsx) | Dialog | Sprint | 3 fields, zero validação |
| [src/app/(dashboard)/projects/page.tsx](../src/app/(dashboard)/projects/page.tsx) `L410-549` | Dialog inline | Project | 4 fields, `<Label>` sem htmlFor, `grid gap-2` ad-hoc |
| [src/components/story-hierarchy/tasks-list.tsx](../src/components/story-hierarchy/tasks-list.tsx) `L1108` | Cell editor | Status em row | **Caso especial** — não é form, ver §6 |

**9 call-sites.** Critério de aceite no §10 trata cada um.

---

## 3. Princípios (não negociáveis)

1. **Token na fonte, não no wrapper.** Altura de campo é definida no primitivo (`Input`, `SelectTrigger`, `Textarea`, `Button[variant=field]`), lendo `--field-h`. Wrapper `<Field>` é layout puro, sem regra de altura.
2. **Compound API com context.** `<Field>` cria um `useId()`, expõe via context; `<Field.Label>`, `<Field.Control>`, `<Field.Hint>`, `<Field.Error>` consomem e injetam `htmlFor`/`id`/`aria-describedby`/`aria-invalid` automaticamente. A11y por construção, não por disciplina.
3. **RHF-ready desde o dia 1, sem importar RHF.** `<Field>` aceita `error?: string`, `name?: string`, `required?: boolean`. Hoje passa-se manual; amanhã o `<Controller>` passa. API é estável.
4. **Densidade no body, não no campo.** `<FormBody density>` redefine `--field-h` no escopo, propagando pra todos os filhos. Autor de campo não escolhe altura.
5. **Lint > grep.** Critério de aceite tem regra de lint que falha o CI, não checagem manual.
6. **Schemas Zod prontos, mas sem RHF agora.** Schema em `src/lib/schemas/<entity>.ts` é declarado nesta fase como deliverable. Migrar pra RHF é Fase B (não bloqueia).

---

## 4. Solução em 4 camadas

### Camada A — Tokens (`src/app/globals.css`)

```css
:root {
  /* Form field tokens (escopo: form controls) */
  --field-h: 2.25rem;        /* 36px — altura canônica de control */
  --field-gap: 0.375rem;     /* 6px — gap label↔control */
  --field-row-gap: 1.25rem;  /* 20px — gap entre rows */
  --field-col-gap: 0.75rem;  /* 12px — gap entre colunas */
  --field-hint-size: 0.6875rem; /* 11px */
}

/* Density override no escopo do FormBody */
[data-density="compact"] {
  --field-h: 2rem;           /* 32px */
  --field-row-gap: 0.875rem; /* 14px */
}
```

**Decisões:**

- 36px é a altura canônica. É o que `StatusChipSelect variant="input"` e o Assignees do task-sheet já usam organicamente (mesmo que via hack).
- **Não criamos `--field-h-sm`** neste plano. Densidade é prop do body, não fork de token. Tabelas/cells (que querem 28-32px) ficam fora deste sistema — pertencem a outro escopo (`--row-h`).
- Tokens vivem em `:root` pra permitir override por theme/scope. Não migrar pra `tailwind.config` — JIT não consegue gerar `h-(--field-h)` se o token estiver lá.

### Camada B — Refactor de primitivos (1 commit, antes de tudo)

**Esta é a mudança crítica que v1 evitava por medo de regressão.** Sem ela, a Camada C vira patch frágil.

#### B.1 — `select.tsx`

```diff
- "data-[size=default]:h-8 data-[size=sm]:h-7"
+ "data-[size=default]:h-(--field-h) data-[size=sm]:h-(--field-h-sm,2rem)"
- "flex w-fit items-center"
+ "flex w-fit items-center" /* mantém w-fit como default; <Field.Control> sobrescreve */
```

#### B.2 — `input.tsx`

```diff
- "h-8 w-full min-w-0 rounded-lg ..."
+ "h-(--field-h) w-full min-w-0 rounded-lg ..."
```

#### B.3 — `textarea.tsx`

Textarea não tem altura fixa (`field-sizing-content` cresce com conteúdo). Garantir que o `min-h` mínimo bate com `--field-h`:

```diff
- "flex field-sizing-content min-h-16 w-full"
+ "flex field-sizing-content min-h-(--field-h) w-full" /* min-h igual ao field-h; cresce daí */
```

#### B.4 — `button.tsx` — nova variant `field`

Pra `DropdownMenuTrigger` em forms (caso Assignees do task-sheet, que hoje tem className gigante hardcoded em [task-sheet.tsx:347](../src/components/story-hierarchy/task-sheet.tsx#L347)):

```diff
+ field: "h-(--field-h) w-full justify-between gap-1.5 px-2.5 rounded-lg border border-input bg-transparent text-sm ..."
```

Substitui o className de 200 caracteres por `<Button variant="field" asChild><DropdownMenuTrigger>...</DropdownMenuTrigger></Button>`.

#### B.5 — `status-chip-select.tsx`

Remove o `!h-9`. Trigger herda de `SelectTrigger`:

```diff
- "!h-9 w-full justify-between rounded-lg border px-2.5 ..."
+ "w-full justify-between rounded-lg border px-2.5 ..." /* altura vem do SelectTrigger via token */
```

**Risco da Camada B mensurado:** `git grep "h-8" src/` retorna ~80 ocorrências; só 4 estão em primitivos. Os outros 76 são intencionais (badges, ícones, etc.) — não são tocados. A Camada B é **4 linhas de diff**, não refactor.

### Camada C — Primitivo `<Field>` (compound + context + A11y)

Novo arquivo: `src/components/ui/field.tsx`.

```tsx
"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldContext = {
  id: string;
  hintId: string;
  errorId: string;
  required: boolean;
  invalid: boolean;
  describedBy: string | undefined;
};

const FieldCtx = React.createContext<FieldContext | null>(null);

function useField() {
  const ctx = React.useContext(FieldCtx);
  if (!ctx) throw new Error("Field.* must be used inside <Field>");
  return ctx;
}

type FieldProps = {
  name?: string;          /* opcional hoje; futuramente passado por RHF Controller */
  required?: boolean;
  error?: string;
  hint?: string;          /* alternativa a <Field.Hint> filho */
  children: React.ReactNode;
  className?: string;
};

function Field({ name, required = false, error, children, className }: FieldProps) {
  const reactId = React.useId();
  const id = name ? `field-${name}` : `field-${reactId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy = [invalid && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldCtx.Provider value={{ id, hintId, errorId, required, invalid, describedBy }}>
      <div
        data-slot="field"
        data-invalid={invalid || undefined}
        className={cn("flex flex-col gap-(--field-gap)", className)}
      >
        {children}
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </FieldCtx.Provider>
  );
}

/* Label row: label + opcional addon à direita (botão +, ?, contador, AI suggest…) */
function FieldLabel({
  children,
  addon,
  className,
}: { children: React.ReactNode; addon?: React.ReactNode; className?: string }) {
  const { id, required } = useField();
  return (
    <div className={cn("flex items-center justify-between gap-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {children}
        {required ? <span aria-hidden className="text-destructive">*</span> : null}
      </Label>
      {addon}
    </div>
  );
}

/* Control: usa Slot pra injetar id/aria sem cloneElement leak */
function FieldControl({ children, className }: { children: React.ReactNode; className?: string }) {
  const { id, describedBy, invalid } = useField();
  return (
    <Slot
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={cn("w-full", className)}
    >
      {children}
    </Slot>
  );
}

function FieldHint({
  children,
  tone = "default",
}: { children: React.ReactNode; tone?: "default" | "warning" }) {
  const { hintId } = useField();
  return (
    <p
      id={hintId}
      className={cn(
        "text-(length:--field-hint-size) leading-tight",
        tone === "default" && "text-muted-foreground",
        tone === "warning" && "text-amber-600 dark:text-amber-400",
      )}
    >
      {children}
    </p>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  const { errorId } = useField();
  return (
    <p
      id={errorId}
      role="alert"
      aria-live="polite"
      className="text-(length:--field-hint-size) leading-tight text-destructive"
    >
      {children}
    </p>
  );
}

/* Layout helpers */
function FieldRow({ cols = 2, className, children }: {
  cols?: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="field-row"
      className={cn(
        "grid gap-(--field-col-gap) items-start",
        cols === 2 && "grid-cols-2",
        cols === 3 && "grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FormBody({
  density = "comfortable",
  className,
  children,
  asChild = false,
}: {
  density?: "comfortable" | "compact";
  className?: string;
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      data-slot="form-body"
      data-density={density}
      className={cn("flex flex-col gap-(--field-row-gap)", className)}
    >
      {children}
    </Comp>
  );
}

Field.Label = FieldLabel;
Field.Control = FieldControl;
Field.Hint = FieldHint;
Field.Error = FieldError;
Field.Row = FieldRow;

export { Field, FormBody };
```

**Diferenças críticas vs v1:**

1. **`Field.Control` usa `<Slot>`** (de `@radix-ui/react-slot`, já transitivamente disponível via base-ui). Slot faz merge de props no filho direto — injeta `id`, `aria-describedby`, `aria-invalid` no `<Input>` ou `<SelectTrigger>` sem `cloneElement`. **Não força altura via `[&>*]`** — altura vem do primitivo via token (Camada B).
2. **`useId` + context** garante associação label↔control automática. A11y por construção.
3. **`<Field.Error>` declarado**. Hoje recebe via prop `error`; amanhã RHF passa direto. Zero refactor futuro.
4. **`required` propagado** — render `*` no label, `aria-required` no control.
5. **Label addon é genérico**, não "Action". Aceita `<Button>+</Button>`, `<Tooltip>?</Tooltip>`, contadores.

### Camada D — Schemas Zod (preparação Fase B)

Cria `src/lib/schemas/` com schemas para os 9 forms. Não há consumo de schema hoje (nenhum `useForm`). Mas **declarar agora** força:

- Definir o que é "válido" antes de migrar (não mistura refactor de UI com debate de regras).
- Server actions podem importar e validar (`schema.safeParse(input)`) — ganho imediato no backend.
- Quando Fase B chegar, schema já existe.

Estrutura sugerida:

```
src/lib/schemas/
├── story.ts        export const storySchema = z.object({...})
├── task.ts
├── module.ts
├── persona.ts
├── sprint.ts
├── project.ts
└── index.ts        re-export
```

Critério de aceite Camada D: schemas existem, server actions correspondentes validam via `schema.safeParse`. Forms ainda usam `useState` — migração de form é Fase B.

---

## 5. Uso (anatomia completa)

```tsx
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

<ResponsiveSheetBody asChild>
  <FormBody density="comfortable">
    <Field name="title" required error={errors.title}>
      <Field.Label>Título</Field.Label>
      <Field.Control>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field.Control>
    </Field>

    <Field.Row cols={2}>
      <Field name="status">
        <Field.Label>Status</Field.Label>
        <Field.Control>
          <StatusChipSelect variant="input" value={status} options={TASK_STATUS} onValueChange={setStatus} />
        </Field.Control>
      </Field>

      <Field name="module">
        <Field.Label addon={
          <Button size="sm" variant="ghost" onClick={openCreateModule}>
            <Plus className="size-3" /> Novo
          </Button>
        }>
          Módulo
        </Field.Label>
        <Field.Control>
          <Select value={moduleId} onValueChange={setModuleId}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>{modules.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field.Control>
        <Field.Hint tone="warning">Alpha sugeriu: Onboarding</Field.Hint>
      </Field>
    </Field.Row>
  </FormBody>
</ResponsiveSheetBody>
```

**Note:**

- Zero `className="h-9 w-full"`. Altura vem de `--field-h`, largura é `w-full` no Slot.
- Zero `htmlFor` manual. `Field` injeta.
- Zero `aria-invalid` manual. `Field.Control` injeta quando `error` está setado.
- Zero `<div className="space-y-1.5">` repetido. `Field` é o container.

---

## 6. Caso especial: `tasks-list.tsx:1108` (Status cell em row)

[tasks-list.tsx:1108](../src/components/story-hierarchy/tasks-list.tsx#L1108) usa `<StatusChipSelect variant="input">` **dentro de uma cell de tabela**, não em form.

Decisão: **trocar pra `variant="inline"`**. Razões:

- Tabela é contexto denso. Trigger de 36px com border quebra o ritmo visual da row.
- Resto da row usa chips inline (assignees, tags). Status é a anomalia.
- `variant="inline"` (h-7, sem border) é o que o resto do sistema chama de "chip clicável".

Se rejeitarmos a troca, alternativa: envolver a cell em `data-density="compact"` pra forçar `--field-h: 2rem`. Mas isso é workaround — a UX correta é chip inline.

**Esta mudança é Fase 4 do plano (cleanup), não bloqueia o restante.**

---

## 7. O que NÃO vamos fazer

- **Migrar pra React Hook Form agora.** É Fase B. Schemas Zod (Camada D) são a ponte. Forms continuam com `useState` interno.
- **Tocar em forms fora do escopo Projeto** (members, profile, meetings, settings, dev/tags, onboarding). Inventário §2 lista 30+ ocorrências de `space-y-1.5` fora do escopo — não é deste plano.
- **Refatorar `<Label>` pra ser auto-associado.** O `Label` continua dumb; `Field.Label` injeta `htmlFor` via context.
- **Storybook.** Não temos. Substituto: `src/app/(dev)/field-demo/page.tsx` com matriz de variantes (deliverable da Fase 1).
- **Animações de erro** (shake, fade-in). `aria-live="polite"` é o contrato; visual fica pra outro PR.

---

## 8. Plano de execução

### Fase 0 — Refactor de primitivos (1 commit)

Camada B inteira. **Antes de tudo.**

- `select.tsx`: data-size lê `--field-h`.
- `input.tsx`: `h-(--field-h)`.
- `textarea.tsx`: `min-h-(--field-h)`.
- `button.tsx`: nova variant `field`.
- `status-chip-select.tsx`: remove `!h-9`.
- `globals.css`: tokens `--field-*`.

**Critério de aceite:** zero diff visual em telas existentes (todos os call-sites com `className="h-9"` agora ficam alinhados em 36px porque o `h-9` perde mas o token entrega 36px). Validar com inspeção manual em: task-sheet, story-sheet, sprint-dialog, project-dialog.

### Fase 1 — Primitivo `<Field>` + dev route (1 commit)

- Criar `src/components/ui/field.tsx` (Camada C).
- Criar `src/app/(dev)/field-demo/page.tsx` com:
  - Matriz: comfortable × compact × com-erro × com-hint × com-addon.
  - Cada control: Input, Textarea, Select, StatusChipSelect, Button[field], DropdownMenuTrigger.
  - Field.Row cols={2}, cols={3}.

**Critério de aceite:** `<Field><Field.Label>X</Field.Label><Field.Control><Input/></Field.Control></Field>` renderiza com label clicável (htmlFor), screen reader anuncia "X, edit text", erro lido via aria-live.

### Fase 2 — Migrar sheets (2 commits)

Ordem por complexidade crescente — cada um valida e expõe gaps:

1. **story-sheet.tsx** — 5 fields, simples. É o que motivou o bug original.
2. **task-sheet.tsx** — 12 fields, mistura todos os controls. Vai forçar `Field.Control` a aceitar StatusChipSelect, DropdownMenuTrigger (via `Button variant=field asChild`), TagPicker. Remove `FieldBlock` local.

**Critério de aceite:** todos os controls com 36px, zero `className="h-9"` ou `className="w-full"` em call-sites de form, A11y validada (Cmd+F5 no Safari, ler labels).

### Fase 3 — Migrar dialogs (1 commit)

- dialogs.tsx (Module + Persona)
- task-clone-dialog.tsx
- task-duplicate-dialog.tsx
- sprint-dialog.tsx
- projects/page.tsx (Project dialog inline)
- dependencies-block.tsx

Migração mecânica — todos têm < 5 fields.

**Critério de aceite:** zero `<div className="space-y-1.5"><Label>` nos arquivos do escopo. Zero `grid grid-cols-2 gap-3` ad-hoc.

### Fase 4 — Cleanup + lint enforcement (1 commit)

- Remover `FieldBlock` local de [task-sheet.tsx:689](../src/components/story-hierarchy/task-sheet.tsx#L689) e [todo-sheet.tsx:338](../src/components/todo-sheet.tsx#L338) (todo-sheet fora do escopo formal mas o `FieldBlock` é compartilhado por nome — ambos somem).
- Trocar `tasks-list.tsx:1108` `StatusChipSelect variant="input"` → `variant="inline"` (ver §6).
- **Lint rule custom** (em `eslint.config.mjs` ou via plugin `eslint-plugin-tailwindcss` com regex):
  - `no-restricted-syntax`: proíbe `className` literal contendo `h-8|h-9|h-10|h-11` em `**/components/**/*-sheet.tsx`, `**/components/**/*-dialog.tsx`, `**/story-hierarchy/**`. Exceto em `field.tsx`, `select.tsx`, `input.tsx`, `textarea.tsx`, `button.tsx`, `status-chip-select.tsx`.
  - `no-restricted-syntax`: proíbe combinação `<div className=".*space-y-1\.5.*"><Label`.
- CI roda `pnpm lint` — falha o PR se voltar regressão.

### Fase 5 (Camada D) — Schemas Zod (1 commit, paralelo a Fase 4)

- `src/lib/schemas/{story,task,module,persona,sprint,project}.ts`.
- Server actions correspondentes validam via `schema.safeParse`.
- Forms ainda usam `useState` — migração pra RHF é fora deste plano (Fase B futura).

---

## 9. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Refactor de primitivos (Fase 0) quebra altura em locais inesperados | Baixa | Token bate com altura atual onde já é 36px (StatusChipSelect input). Onde era 32px (Input, Select default), vai pra 36px — testar visualmente os 9 forms. Diff é 4 linhas, fácil reverter. |
| `Slot` do Radix não merge corretamente com `<DropdownMenuTrigger>` (que já é Slot) | Média | Para triggers, usar `<Button variant="field" asChild><DropdownMenuTrigger>...</DropdownMenuTrigger></Button>`. Test no field-demo. |
| `<Textarea>` com `min-h-(--field-h)` fica baixo demais (36px) | Alta | Override no call-site: `<Textarea className="min-h-24" />`. Valeu o trade — caso minoritário. Documentar em field.tsx. |
| `tasks-list.tsx:1108` mudança de `input` → `inline` quebra UX esperada | Média | Validar com PM/design antes do merge. Se rejeitado, fica como está + `data-density="compact"` futuramente. |
| Lint rule muito agressiva bloqueia mudanças legítimas | Baixa | Allowlist explícita de arquivos de primitivos. Allowlist por comentário (`// eslint-disable-next-line ...`) onde justificável. |
| Schemas Zod (Camada D) ficam órfãos sem Fase B | Média | Server actions consomem imediatamente — ROI vem do backend, não do form. |

---

## 10. Critérios de aceite (mensuráveis)

- **A11y**: `axe-core` (manual via DevTools Lighthouse) zera erros de "form element must have label" nos 9 forms migrados.
- **Tokens**: `git grep "h-8\|h-9\|h-10" -- 'src/components/story-hierarchy/' 'src/components/sprint-dialog.tsx'` retorna **zero**. Mesma busca em `src/components/ui/` retorna apenas dentro dos primitivos canônicos.
- **Lint**: `pnpm lint` falha se algum dos arquivos do §2 reintroduzir `h-8/h-9/h-10` literal.
- **Bug original**: Status e Assignees no [task-sheet.tsx:333](../src/components/story-hierarchy/task-sheet.tsx#L333) renderizam com altura idêntica (36px), bit-perfect alinhados. Validar via screenshot.
- **Linhas removidas > adicionadas** nos 9 call-sites (esperado: ~200 linhas a menos por dedup de label/grid/className).
- **Um lugar pra mudar altura de form**: alterar `--field-h` em `globals.css` reflete em todos os controls de todos os forms.
- **Schemas Zod**: 6 schemas em `src/lib/schemas/`, todos consumidos por pelo menos uma server action.
- **Dev route**: `/dev/field-demo` renderiza sem console errors, cobre matriz documentada na Fase 1.

---

## 11. Fora do escopo (Fase B — plano futuro)

Quando este plano fechar, abre-se o caminho pra:

- Migrar forms de `useState` → `react-hook-form` + `@hookform/resolvers/zod`.
- `<Field>` recebe `error` direto do `formState.errors`.
- `Controller` trabalha com Slot do `Field.Control` sem ajuste.
- Forms fora do escopo Projeto adotam `<Field>` organicamente.
- `--field-h` ganha breakpoints responsivos (`@media (min-width: ...)`).
- Animações de erro/success.

Nada disso bloqueia este plano. Mas a API foi desenhada pra suportar.

---

## 12. Resumo executivo

| Camada | Esforço | Reverter | Payoff |
|---|---|---|---|
| A — Tokens | 5min | trivial | habilita tudo |
| B — Primitivos | 1h (4 linhas + teste) | 1 commit | resolve bug original definitivamente |
| C — `<Field>` + Slot + context | 1 dia | 1 commit | A11y, padronização visual, RHF-ready |
| D — Schemas Zod | 1 dia | 1 commit | validação backend imediata, prepara RHF |
| Migração 9 forms | 2 dias | 4 commits | dedup, consistência, lint enforcement |

**Total**: ~5 dias de trabalho focado. Resultado: padrão ouro de form pra contexto Projeto, com extensão clara pro resto da app.
