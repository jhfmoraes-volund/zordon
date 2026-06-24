# Planning Ceremony UX Rebuild — Plano de Implementação

## Contexto e objetivo

O Ritual de Planning (`/rituals/[id]`) é a tela onde o PM planeja uma sprint com a Vitória (agente de IA). A experiência atual é fragmentada: seções separadas de Reuniões e Transcripts, notas em lista plana, propostas inline sem detalhe.

A reescrita transforma isso em uma experiência coesa em três partes:

1. **ContextSheet** — side sheet acessível por botão, com `TranscriptModal` (Granola/Roam) integrado. Substitui dois pickers separados (reuniões + transcripts).
2. **BriefingTree** — notas da Vitória como accordion agrupado por `kind` (summary, theme, risk, capacity_signal, code_observation, open_question).
3. **ProposalCard grid** — cards clicáveis (estilo DS Briefing) que abrem `MeetingTaskActionSheet` com URL de decisão da planning. Substitui `ActionRow` inline.

---

## O que já está feito

### 1. `TranscriptRef.fullText` (schema + tipos)
Migration rodada: `supabase/migrations/20260528c_transcript_fulltext.sql`
- Coluna `fullText text` adicionada à tabela `TranscriptRef`
- Tipos regenerados: `src/lib/supabase/database.types.ts` já tem `fullText: string | null`

### 2. `TranscriptModal` generalizado
`src/components/design-session/transcript-modal.tsx` — antes acoplado a `sessionId`, agora aceita `apiUrl: string` genérico + `subtitle?: string`.

Props novo:
```typescript
export function TranscriptModal({
  apiUrl,       // GET lista + POST importa (mesmo URL)
  open,
  onOpenChange,
  onImported,
  subtitle,     // opcional; default: "Vitor vai usar a transcrição como contexto da sessão."
}: { ... })
```

`src/components/design-session/pre-work-step.tsx` atualizado (callsites passam `apiUrl={\`/api/design-sessions/${sessionId}/transcripts\``).

---

## O que falta — 6 tarefas em sequência

### Tarefa 1 — DAL: `findOrCreateTranscriptRef` aceitar `fullText`

**Arquivo:** `src/lib/dal/planning.ts:457`

Adicionar `fullText?: string | null` ao input e ao insert:

```typescript
export async function findOrCreateTranscriptRef(input: {
  source: "roam" | "granola" | "manual";
  sourceId: string;
  fullText?: string | null;   // ← ADICIONAR
  title?: string | null;
  byline?: string | null;
  capturedAt?: string | null;
  meetingId?: string | null;
  importedById?: string | null;
}): Promise<TranscriptRefRow>
```

No insert, passar `fullText: input.fullText ?? null`.

---

### Tarefa 2 — Vitória: `read_transcript_content` ler `fullText` primeiro

**Arquivo:** `src/lib/agent/agents/vitoria/tools.ts:161`

Atualmente a ferramenta busca `TranscriptRef` sem `fullText` e cai no `Meeting.transcript`. Agora deve:

1. Selecionar `fullText` junto: `.select("id, title, source, sourceId, capturedAt, meetingId, fullText")`
2. Se `ref.fullText` existir, retornar direto (sem ir ao `Meeting`)
3. Só buscar `Meeting` como fallback se `!ref.fullText`

```typescript
// após buscar ref:
if (ref.fullText) {
  return { ok: true, id: ref.id, title: ref.title, capturedAt: ref.capturedAt, content: ref.fullText };
}
// fallback: busca Meeting...
```

---

### Tarefa 3 — `ProposalShell` + `MeetingTaskActionSheet`: `decisionUrl` override

`ProposalShell` hardcoda `/api/meetings/${meetingId}/task-actions/${action.id}`.
Para planning o endpoint é `/api/planning/${planningId}/actions/${actionId}`.

**`src/components/meetings/proposal-shell.tsx`**

Mudar Props:
```typescript
export type ProposalShellProps = {
  action: MeetingTaskAction;
  meetingId?: string;          // era: meetingId: string  (obrigatório)
  decisionUrl?: string;        // NOVO — override completo da URL
  buildDecisionPayload: () => ProposalDecisionPayload;
  loading?: boolean;
  onClose: () => void;
  onChange?: () => void;
  children: React.ReactNode;
};
```

Na função `putAction` (linha ~67):
```typescript
const url = decisionUrl ?? `/api/meetings/${meetingId}/task-actions/${action.id}`;
const res = await fetch(url, { ... });
```

**`src/components/meetings/meeting-task-action-sheet.tsx`**

Mudar Props:
```typescript
export type MeetingTaskActionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId?: string;          // era obrigatório
  decisionUrl?: string;        // NOVO
  action: MeetingTaskAction;
  projectId: string;
  onChange?: () => void;
};
```

Propagar `decisionUrl` ao `ProposalShell` dentro do componente `Body` (linha ~104).

---

### Tarefa 4 — Nova API: `/api/planning/[id]/transcripts/sources/route.ts`

O `TranscriptModal` (já generalizado) precisa de um endpoint que:
- **GET** — lista reuniões importáveis do Roam/Granola, marcando as já linkadas a esta planning
- **POST** — cria `TranscriptRef` com `fullText`, linka à planning via `PlanningTranscriptLink`

**Referência exata:** `src/app/api/design-sessions/[id]/transcripts/route.ts` (mesma estrutura; só muda a entidade de destino).

**Criar:** `src/app/api/planning/[id]/transcripts/sources/route.ts`

GET — mesma lógica de Roam/Granola do design-session, mas `alreadyImported` verifica `PlanningTranscriptLink` em vez de `DesignSessionTranscript`:
```typescript
const linked = await db()
  .from("PlanningTranscriptLink")
  .select("transcriptRefId, transcript:TranscriptRef(sourceId, source)")
  .eq("planningCeremonyId", planningId);
// Montar set de (source, sourceId) já linkados
```

POST — recebe `{ source, sourceId }`, chama `getMeetingDetail()` para obter `transcriptText`, depois:
```typescript
const ref = await findOrCreateTranscriptRef({
  source, sourceId, fullText: detail.transcriptText,
  title: detail.title, capturedAt: detail.start, importedById: member.id,
});
await linkTranscriptToPlanning({ planningCeremonyId: planningId, transcriptRefId: ref.id });
```

Retornar o `TranscriptRef` criado/encontrado (como `onImported` do `TranscriptModal` espera `ImportedTranscript` — adaptar shape ou ajustar o type de retorno).

> **Nota sobre tipos:** `TranscriptModal` importa `ImportedTranscript` de `design-session/transcript-modal.tsx` como `Database["public"]["Tables"]["DesignSessionTranscript"]["Row"]`. Para planning, o retorno do POST deve ser o row de `TranscriptRef`. Ajustar o `onImported` prop no `ContextSheet` (tarefa 5) para trabalhar com `TranscriptRef` em vez de `DesignSessionTranscript`.

---

### Tarefa 5 — Novos componentes em `src/components/planning/`

A pasta não existe; criar os três arquivos abaixo.

#### 5a. `briefing-tree.tsx`

Accordion de notas da Vitória agrupadas por `kind`.

```typescript
// Props
interface BriefingTreeProps {
  notes: Array<{
    id: string;
    kind: "summary" | "theme" | "risk" | "capacity_signal" | "code_observation" | "open_question";
    content: string;
    priority: number;
    dismissedAt: string | null;
  }>;
  onDismiss: (noteId: string) => void;
}
```

- Usar `Accordion` de `@/components/ui/accordion`
- Cada grupo = um `AccordionItem` com ícone + label + count badge
- Dentro: lista de cards com conteúdo e botão de dispensar (X)
- Labels: `NOTE_KIND_LABEL` já definido na `page.tsx`
- Tones: `NOTE_KIND_TONE` já definido na `page.tsx`
- Notas com `kind === "summary"` ficam abertas por padrão (`defaultValue`)

#### 5b. `proposal-card.tsx`

Card clicável que ao ser clicado abre `MeetingTaskActionSheet`.

```typescript
interface ProposalCardProps {
  action: PlanningAction;     // tipo já definido em rituals/[id]/page.tsx
  planningId: string;         // para montar o decisionUrl
  onDecide: () => void;       // callback após aprovação/rejeição (reload)
}
```

- Layout: ícone de tipo + título da task (ou payload.title) + reasoning truncado
- Badge de confiança (`aiConfidence`) se disponível
- `StatusChip` com tone por `action.type` (create=green, delete=red, etc.)
- Ao clicar: abre `MeetingTaskActionSheet` com:
  ```typescript
  <MeetingTaskActionSheet
    open={open}
    onOpenChange={setOpen}
    action={action}
    projectId={action.projectId}
    decisionUrl={`/api/planning/${planningId}/actions/${action.id}`}
    onChange={onDecide}
  />
  ```
- Cards `decided` (aprovados/rejeitados) ficam com opacity reduzida e sem hover

#### 5c. `context-sheet.tsx`

`ResponsiveSheet` com TranscriptModal integrado. Substitui os dois pickers separados da page atual.

```typescript
interface ContextSheetProps {
  planningId: string;
  linkedTranscripts: Array<{
    transcriptRefId: string;
    transcript: { id: string; title: string | null; source: string; capturedAt: string | null } | null;
    weight: string;
  }>;
  onUnlink: (transcriptRefId: string, title: string) => void;
  onImported: () => void;   // reload planning após importação bem-sucedida
}
```

- Botão "Contexto" (externo, com count badge) fica na `page.tsx`
- Sheet lateral (desktop right, mobile bottom)
- Dentro:
  1. Header com título "Contexto da planning"
  2. Lista dos transcripts já linkados (com botão de remover)
  3. Botão "Importar transcrição" → abre `TranscriptModal` sobreposto:
     ```typescript
     <TranscriptModal
       apiUrl={`/api/planning/${planningId}/transcripts/sources`}
       open={transcriptModalOpen}
       onOpenChange={setTranscriptModalOpen}
       subtitle="Vitória vai usar a transcrição como contexto da planning."
       onImported={() => { setTranscriptModalOpen(false); onImported(); }}
     />
     ```

---

### Tarefa 6 — Reescrita de `src/app/(dashboard)/rituals/[id]/page.tsx`

A página atual tem 1079 linhas. A reescrita mantém toda a lógica de estado/fetch mas troca o layout do painel esquerdo.

**O que remover:**
- `MeetingPickerDialog` (componente inline na página, ~50 linhas)
- `TranscriptPickerDialog` (componente inline, ~50 linhas)
- `handleLinkMeeting` / `handleUnlinkMeeting` (reuniões não são mais linkadas diretamente)
- `linkedMeetingIds` memo
- `meetingPickerOpen` state
- Seções "Reuniões" e "Transcripts" inline no `leftPane`
- Seção "Notas do briefing" com lista flat
- `ActionRow` (componente no final do arquivo, ~80 linhas)
- Import de `FileText`, `BookOpen`, `Unlink`, `MessageSquare`, `Sparkles` que não serão mais usados

**O que adicionar:**
```typescript
import { BriefingTree } from "@/components/planning/briefing-tree";
import { ProposalCard } from "@/components/planning/proposal-card";
import { ContextSheet } from "@/components/planning/context-sheet";
```

**Novo `leftPane`:**
```tsx
const leftPane = (
  <div className="space-y-4 min-w-0">
    {/* Header */}
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/rituals"><Button variant="ghost" size="icon" ...><ArrowLeft /></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{title}</h1>
          {planning.scheduledFor && <p className="text-xs text-muted-foreground">{fmtDate(planning.scheduledFor)}</p>}
        </div>
        {/* Botão Contexto — abre ContextSheet */}
        <Button
          size="sm" variant="outline"
          onClick={() => setContextSheetOpen(true)}
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Contexto
          {planning.linkedTranscriptCount > 0 && (
            <Badge className="ml-1.5">{planning.linkedTranscriptCount}</Badge>
          )}
        </Button>
      </div>
      <PhaseRibbon ... />
    </div>

    {/* Briefing Tree — notas da Vitória */}
    {(activeNotes.length > 0 || planning.phase === "reading" || planning.phase === "proposing") && (
      <BriefingTree notes={activeNotes} onDismiss={handleDismissNote} />
    )}

    {/* Propostas pendentes */}
    {(planning.phase === "proposing" || planning.phase === "approving" || pendingActions.length > 0) && (
      <section className="surface p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h2 className="text-sm font-semibold ...">
            Propostas ({pendingActions.length} pendente{pendingActions.length !== 1 ? "s" : ""})
          </h2>
        </div>
        {pendingActions.length === 0
          ? <p className="text-xs text-muted-foreground">...</p>
          : <div className="grid gap-2 sm:grid-cols-2">
              {pendingActions.map((action) => (
                <ProposalCard
                  key={action.id}
                  action={action}
                  planningId={id}
                  onDecide={loadActions}
                />
              ))}
            </div>
        }
      </section>
    )}

    {/* Decididas */}
    {decidedActions.length > 0 && (
      <section className="surface p-4 space-y-3">
        <h2 ...>Revisadas ({decidedActions.length})</h2>
        <div className="grid gap-2 sm:grid-cols-2 opacity-60">
          {decidedActions.map((action) => (
            <ProposalCard key={action.id} action={action} planningId={id} onDecide={loadActions} />
          ))}
        </div>
      </section>
    )}
  </div>
);
```

**Novo state/dialog:**
```typescript
const [contextSheetOpen, setContextSheetOpen] = useState(false);
```

**Adicionar ao JSX (antes de `ConfirmDialog`):**
```tsx
<ContextSheet
  planningId={id}
  linkedTranscripts={planning.linkedTranscripts}
  onUnlink={handleUnlinkTranscript}
  onImported={loadPlanning}
  open={contextSheetOpen}
  onOpenChange={setContextSheetOpen}
/>
```

Manter `handleUnlinkTranscript` e `handleDismissNote` intactos.
Manter `loadPlanning` e `loadActions` intactos.

---

## Referências importantes

| Arquivo | Papel |
|---------|-------|
| `src/components/design-session/transcript-modal.tsx` | TranscriptModal já generalizado — reutilizado no ContextSheet |
| `src/app/api/design-sessions/[id]/transcripts/route.ts` | Modelo exato para a nova rota de sources da planning |
| `src/components/meetings/meeting-task-action-sheet.tsx` | Sheet de proposta — recebe `decisionUrl` após tarefa 3 |
| `src/components/meetings/proposal-shell.tsx` | Shell interno — recebe `decisionUrl` após tarefa 3 |
| `src/lib/dal/planning.ts` | DAL — `findOrCreateTranscriptRef` + `linkTranscriptToPlanning` |
| `src/lib/meetings.ts` | `getMeetingDetail()` — retorna `{ title, start, end, participants, transcriptText }` |
| `src/lib/agent/agents/vitoria/tools.ts` | Ferramenta `read_transcript_content` — ler `fullText` primeiro (tarefa 2) |

## Ordem de execução recomendada

```
1 (DAL) → 2 (Vitória) → 3 (ProposalShell) → 4 (API sources) → 5 (componentes) → 6 (page rewrite)
```

As tarefas 1–3 são independentes entre si e podem ser feitas em paralelo.
A tarefa 4 depende de 1 (para poder passar `fullText`).
A tarefa 5 depende de 3 (para `ProposalCard`) e 4 (para `ContextSheet`).
A tarefa 6 depende de 5.

## Regras do projeto a respeitar

- Migrations de schema via `psql "$DIRECT_URL" -f <arquivo>.sql` (nunca pelo Dashboard)
- Componentes genéricos → `src/components/ui/`; acoplados à feature → `src/components/planning/`
- Sem `window.confirm()` — usar `ConfirmDialog`
- Sem `Dialog`/`Sheet` nu — usar `ResponsiveSheet` / `ResponsiveDialog`
- Commit via `bash scripts/sync-main.sh -m "ZRD-JM-NN: área — descrição"`
- `tsc --noEmit` deve passar antes de commitar
