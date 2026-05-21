# Plano — Optimistic em Story + descartar indicações do Vitor (Briefing)

**Escopo:** step de briefing das Design Sessions (`/design-sessions/:id/steps/9`).
**Data:** 2026-05-21
**Status:** plano, aguardando confirmação das decisões pendentes em [Riscos](#riscos--decisões-pendentes).

---

## Contexto

3 lacunas no fluxo de edição de US/Task dentro do briefing:

1. **StorySheet edita AC sem optimistic** — toggle/criar/editar/deletar AC roda `await fetch` + `await refreshStory()` (6 queries paralelas). UX: lag visível, flicker, "deleta AC e ele volta por meio segundo".
2. **Banner "Alpha sugeriu módulo X"** só tem botão "Aprovar". Pra descartar, user precisa abrir o Select e escolher outra opção — não há ação direta de "Descartar sugestão".
3. **Stories/tasks criadas pelo Vitor não têm botão de excluir** dentro do sheet. Hoje só via Supabase direto.

---

## Etapa 1 — Optimistic em AC do StorySheet (espelhar TaskSheet)

**Arquivo:** [src/components/story-sheet-by-ref.tsx](../src/components/story-sheet-by-ref.tsx)

### a) Helper `patchAcInCtx`

Análogo ao [task-sheet-by-ref.tsx:450-462](../src/components/task-sheet-by-ref.tsx#L450-L462):

```ts
function patchAcInCtx(
  updater: (acs: AdaptedStory["acceptanceCriteria"]) => AdaptedStory["acceptanceCriteria"],
) {
  setCtx((cur) =>
    cur
      ? {
          ...cur,
          story: {
            ...cur.story,
            acceptanceCriteria: updater(cur.story.acceptanceCriteria),
          },
        }
      : cur,
  );
}
```

### b) Reescrever os 4 handlers de AC

Seguindo o padrão validado no TaskSheet (memory `feedback_optimistic_reconcile_create.md`):

- **`handleAcCreate`** ([linha 294](../src/components/story-sheet-by-ref.tsx#L294)) — gerar `tempId = ac-tmp-${Date.now()}`, append otimista, no sucesso substituir temp pelo `data.acceptance.id` real (filter temp + append real, não map), no erro filtrar temp + toast.
- **`handleAcUpdateText`** ([linha 311](../src/components/story-sheet-by-ref.tsx#L311)) — guardar `prev.text`, aplicar otimista, no erro reverter pro `prev.text`.
- **`handleAcToggle`** ([linha 328](../src/components/story-sheet-by-ref.tsx#L328)) — guardar `prev.checked`, aplicar otimista, no erro reverter.
- **`handleAcDelete`** ([linha 345](../src/components/story-sheet-by-ref.tsx#L345)) — guardar `prev` (objeto inteiro), filtrar otimista, no erro re-append `prev`.

### c) Remover `refreshStory()` desses 4 handlers

Manter só `onAfterChange?.()` no sucesso (pra árvore do briefing re-renderizar). `refreshStory()` continua útil pro `handlePatch` ([linha 250](../src/components/story-sheet-by-ref.tsx#L250)) como fallback de erro.

### Por quê

Elimina round-trip + 6 queries por toggle. Padrão já validado no TaskSheet.

---

## Etapa 2 — Botão "Descartar sugestão de módulo"

**Arquivo:** [src/components/story-hierarchy/story-sheet.tsx](../src/components/story-hierarchy/story-sheet.tsx) ([linhas 221-236](../src/components/story-hierarchy/story-sheet.tsx#L221-L236))

Adicionar segundo botão no banner amber, ao lado de "Aprovar e criar módulo":

```tsx
<div className="flex gap-2">
  <Button size="sm" variant="ghost" onClick={() => onPatch({ proposedModuleName: null })}>
    Descartar
  </Button>
  <Button size="sm" variant="outline" onClick={() => onApproveProposedModule(story)}>
    Aprovar e criar módulo
  </Button>
</div>
```

**Não precisa de prop nova** — `onPatch` já existe e a API ([api/stories/[ref]/route.ts:19-23](../src/app/api/stories/[ref]/route.ts#L19-L23)) já aceita `proposedModuleName: null`. Optimistic herda do `handlePatch` que já existe em `story-sheet-by-ref.tsx`.

**Bônus:** o badge `proposed:` ([linha 166](../src/components/story-hierarchy/story-sheet.tsx#L166)) e o `Field.Hint` ([linha 330](../src/components/story-hierarchy/story-sheet.tsx#L330)) somem automaticamente porque dependem de `story.proposedModuleName` truthy.

---

## Etapa 3 — Excluir story/task gerada pelo Vitor

### Permissões já existentes nos endpoints

- **Story** DELETE → manager-only, via [api/stories/[ref]/route.ts:94-115](../src/app/api/stories/[ref]/route.ts#L94-L115).
- **Task** DELETE → qualquer membro do projeto, via [api/tasks/[id]/route.ts:154-176](../src/app/api/tasks/[id]/route.ts#L154-L176).

### Comportamento proposto

- **Delete hard** (sem soft-delete; schema não tem `archivedAt` em story/task).
- **Gate de visibilidade do botão:**
  - Story: `story.createdByAgent === true && story.refinementStatus === "draft"`
  - Task: `task.createdByAgent === true`
- Proteção: depois que o PM refinou/commitou, já não é "indicação do Vitor", é trabalho aprovado.
- Confirmação via `ConfirmDialog` (padrão da casa, sem `window.confirm`).
- Errors via Sonner toast (`showErrorToast`).

### Mudanças

#### a) StorySheet header

[story-sheet.tsx perto da linha 209](../src/components/story-hierarchy/story-sheet.tsx#L209): adicionar `<Button variant="ghost">` com `Trash2` ao lado do `X`, condicional a `story.createdByAgent && story.refinementStatus === "draft"`.

#### b) TaskSheet header

Análogo, condicional a `task.createdByAgent`. Sem checagem de refinement (task não tem esse campo).

#### c) Nova prop `onDelete` nos dois sheets

```ts
onDelete?: (ref: string) => void | Promise<void>;
```

Wire em `story-sheet-by-ref.tsx` e `task-sheet-by-ref.tsx`:

```ts
const handleDelete = async () => {
  const res = await fetch(`/api/stories/${storyRef}`, { method: "DELETE" });
  if (!res.ok) {
    showErrorToast(new Error("Falha ao excluir"), { label: "Excluir story" });
    return;
  }
  onClose();
  onAfterChange?.();  // árvore do briefing re-renderiza
};
```

#### d) Manager-only no client (story)

Esconder o botão pra não-manager (DAL/role hook já existe). Decisão pendente — ver [Riscos](#riscos--decisões-pendentes).

---

## Etapa 4 — Validação manual

Rodar `npm run dev`, abrir `/design-sessions/0d0cf3f9-e16e-4ebd-a632-0cf02fc4c40d/steps/9`:

- [ ] Marcar/desmarcar AC numa story → instantâneo, sem flicker.
- [ ] Criar AC vazio → aparece imediato com input focável.
- [ ] Editar texto de AC → blur persiste; valor já está no DOM.
- [ ] Deletar AC → some imediato; em erro volta + toast.
- [ ] Banner "Alpha sugeriu" → clicar "Descartar" → banner some, badge `proposed:` some, hint do Select some.
- [ ] Story `createdByAgent + draft` → ícone Trash2 aparece, abre confirm, deleta, sheet fecha, árvore atualiza.
- [ ] Task `createdByAgent` → mesmo.
- [ ] Story `refined/committed` → SEM botão de delete (proteção).
- [ ] Não-manager não vê botão de delete em story (se [Decisão (c)](#riscos--decisões-pendentes) = sim).

---

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `src/components/story-sheet-by-ref.tsx` | 4 handlers AC com optimistic + `handleDelete` |
| `src/components/story-hierarchy/story-sheet.tsx` | botão "Descartar" no banner + botão Trash2 condicional no header + prop `onDelete` |
| `src/components/task-sheet-by-ref.tsx` | `handleDelete` |
| `src/components/story-hierarchy/task-sheet*.tsx` | botão Trash2 condicional + prop `onDelete` |

Sem migração. Sem mudança de API. Tudo client-side.

---

## Riscos / decisões pendentes

1. **Delete de story em cascata** — confirmar que cascateia AC + tasks via FK ON DELETE CASCADE (provavelmente sim, conferir antes do botão). Se cascateia tasks de uma story `committed`, user pode perder trabalho. Por isso o gate `refinementStatus === "draft"`.
2. **Delete hard vs soft** — manter hard (mais simples; gate `createdByAgent && draft` limita blast radius), ou criar campo `dismissedAt`/`archivedAt`?
3. **Manager-only no delete de story no client** — bloquear no botão além do RLS server-side, ou deixar o server retornar 403 e exibir toast?

**Perguntas pro João antes de implementar (3):**

- (a) Delete hard tá OK?
- (b) Gate `createdByAgent && refinementStatus === "draft"` em story / `createdByAgent` em task tá OK?
- (c) Escondo o botão pra não-manager no client também ou deixo só o RLS?

(1) e (2) podem ser implementadas sem novas perguntas.
