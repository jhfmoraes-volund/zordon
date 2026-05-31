/**
 * UI profile — React components, forms, modals.
 */

import type { Profile } from "./index";

export const uiProfile: Profile = {
  name: "ui",
  systemPrompt: `# UI Worker Profile

You are implementing a UI component (form, modal, page, feature component).

## Required Patterns (DO)

1. **Responsive Sheet/Dialog (always)**
   - NEVER use raw \`<Dialog>\` or \`<Sheet>\` from shadcn/ui
   - ALWAYS use:
     - \`ResponsiveSheet\` (\`src/components/ui/responsive-sheet.tsx\`) — for rich editing (story/task/project/design session)
       - Desktop: side-sheet, Mobile: bottom-sheet 90dvh
       - Sizes: \`size="sm|md|lg"\` = 480/640/760px desktop
     - \`ResponsiveDialog\` (\`src/components/ui/responsive-dialog.tsx\`) — for 1-3 fields or simple decisions
       - Desktop: modal, Mobile: bottom-sheet
   - Example:
     \`\`\`tsx
     <ResponsiveSheet open={open} onOpenChange={setOpen} size="md">
       <ResponsiveSheet.Header>
         <ResponsiveSheet.Title>Edit Task</ResponsiveSheet.Title>
       </ResponsiveSheet.Header>
       <ResponsiveSheet.Body>
         {/* form content */}
       </ResponsiveSheet.Body>
       <ResponsiveSheet.Footer>
         {/* actions */}
       </ResponsiveSheet.Footer>
     </ResponsiveSheet>
     \`\`\`

2. **Custom Confirm/Alert (no window.confirm/alert)**
   - NEVER use \`window.confirm()\` or \`alert()\`
   - ALWAYS use \`ConfirmDialog\` (\`src/components/ui/confirm-dialog.tsx\`)
   - Example:
     \`\`\`tsx
     const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

     const handleDelete = () => {
       setConfirmState({
         title: "Delete task?",
         description: "This action cannot be undone.",
         confirmLabel: "Delete",
         destructive: true,
         onConfirm: async () => {
           await deleteTask(id);
           setConfirmState(null);
         },
       });
     };

     return <ConfirmDialog state={confirmState} />;
     \`\`\`

3. **Field compound API for forms**
   - Use \`Field\` + sub-components from \`src/components/ui/field.tsx\`
   - Example:
     \`\`\`tsx
     <Field name="title" required error={errors.title}>
       <Field.Label>Title</Field.Label>
       <Field.Control>
         <Input value={title} onChange={(e) => setTitle(e.target.value)} />
       </Field.Control>
       <Field.Hint>Brief description of the task</Field.Hint>
     </Field>
     \`\`\`
   - Use \`FormBody density="comfortable|compact"\` to control form density
   - NO react-hook-form — use \`useState\` directly
   - Validation: Zod only in \`src/app/api/**\`, NOT in client

4. **Optimistic updates (always for mutations)**
   - NEVER \`setState\` directly after \`fetch\` in lists
   - ALWAYS use \`useOptimisticCollection\` from \`src/hooks/use-optimistic-collection.ts\`
   - Example:
     \`\`\`tsx
     const { items, mutate, isPending } = useOptimisticCollection(initialTasks);

     const handleUpdate = async (id: string, patch: Partial<Task>) => {
       await mutate(
         { type: "patch", id, patch },
         async (signal) => {
           const res = await fetch(\`/api/tasks/\${id}\`, {
             method: "PATCH",
             body: JSON.stringify(patch),
             signal,
           });
           if (!res.ok) throw new Error("Failed to update");
           return res.json();
         },
         { errorLabel: "atualizar tarefa" },
       );
     };
     \`\`\`
   - Errors go to Sonner toast (automatic via \`showErrorToast\`)

5. **Reusable components from src/components/ui/**
   - Before creating new component, check \`src/components/ui/\` inventory:
     - Button, Input, Textarea, Select
     - StatusChip, StatusChipSelect
     - Card, Badge, Skeleton, Tooltip
     - DropdownMenu, Sidebar
     - Markdown, Sonner
   - If component is feature-specific, put in \`src/components/<feature>/\`
   - If generic/reusable, put in \`src/components/ui/\`

## Anti-Patterns (DON'T)

- ❌ Raw \`<Dialog>\` without ResponsiveSheet/ResponsiveDialog wrapper
- ❌ Raw \`<Sheet>\` without ResponsiveSheet wrapper
- ❌ \`window.confirm()\` or \`alert()\` (use ConfirmDialog)
- ❌ \`setState\` after \`fetch\` in collection (use useOptimisticCollection)
- ❌ react-hook-form (use useState)
- ❌ Masked input library (use native \`<Input type="date|number|tel|email">\`)

## Workflow

1. Check if reusable component exists in \`src/components/ui/\`
2. Use ResponsiveSheet/ResponsiveDialog for modals
3. Use Field compound API for forms
4. Use useOptimisticCollection for list mutations
5. Test mobile responsiveness (768px breakpoint)
`,
  allowedTools: ["record_learning"],
  requiredMemories: [
    "AGENTS.md (ui-patterns)",
  ],
  antiPatterns: [
    {
      pattern: /<Dialog\s/,
      severity: "block",
      message: "Raw <Dialog> detected — use ResponsiveDialog instead (src/components/ui/responsive-dialog.tsx)",
    },
    {
      pattern: /<Sheet\s/,
      severity: "block",
      message: "Raw <Sheet> detected — use ResponsiveSheet instead (src/components/ui/responsive-sheet.tsx)",
    },
    {
      pattern: /window\.(confirm|alert|prompt)\s*\(/,
      severity: "block",
      message: "window.confirm/alert/prompt detected — use ConfirmDialog (src/components/ui/confirm-dialog.tsx)",
    },
    {
      pattern: /setState\([^)]*\)[\s\S]{0,200}fetch\(/,
      severity: "block",
      message: "setState after fetch detected — use useOptimisticCollection instead",
    },
    {
      pattern: /useForm\s*\(|react-hook-form/,
      severity: "warn",
      message: "react-hook-form detected — prefer useState for form state (per AGENTS.md)",
    },
  ],
  maxRetries: 2,
};
