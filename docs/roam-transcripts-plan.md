# Roam Transcripts as Pre-Work Context — Implementation Plan

> Permite importar transcrições de reuniões do Roam HQ como contexto da step **pre_work** de uma DesignSession. Vitor (agente) lê a transcrição no `loadContext()` e responde perguntas como se tivesse participado da reunião.

## Status

- ✅ Migration criada e aplicada (`supabase/migrations/20260429_design_session_transcript.sql`)
- ✅ `database.types.ts` atualizado com `DesignSessionTranscript`
- ⏳ API routes (GET/POST/DELETE)
- ⏳ Modal de seleção
- ⏳ Wire no `PreWorkStep`
- ⏳ Vitor `loadContext` + `prompt.ts`
- ⏳ Smoke test

## Decisões já tomadas

1. **Filtro de reuniões:** sem filtro — mostra todas as últimas 30 do workspace Roam do membro logado.
2. **Auth:** qualquer membro com edit-access à sessão pode importar/remover (`requireProjectEditSessionsApi`).
3. **Auto-importação:** não — sempre manual via botão.
4. **Múltiplas reuniões:** permitido (unique constraint apenas por `(sessionId, roamTranscriptId)`).

---

## 1. Schema (já aplicado)

```sql
CREATE TABLE public."DesignSessionTranscript" (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId"          text NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "projectId"          text NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "roamTranscriptId"   text NOT NULL,
  "meetingTitle"       text NOT NULL,
  "meetingStart"       timestamptz NOT NULL,
  "meetingEnd"         timestamptz NOT NULL,
  participants         jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary              text,
  "actionItems"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "fullText"           text NOT NULL,            -- cuesToText(detail.cues) já formatado
  "importedByMemberId" text REFERENCES "Member"(id) ON DELETE SET NULL,
  "importedAt"         timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("sessionId", "roamTranscriptId")
);
```

**RLS** segue padrão da casa: `is_manager()` bypass + `can_view_project()` (select) / `can_edit_sessions()` (write).

**Notas:**
- `projectId` denormalizado (necessário pra RLS).
- Cues raw não são armazenados — só `fullText` formatado por `cuesToText()`. Se quisermos cues navegáveis depois, adicionamos coluna.

---

## 2. API Routes

### 2.1 `GET/POST /api/design-sessions/[id]/roam-transcripts/route.ts`

#### GET — lista reuniões disponíveis + já importadas

**Auth:** `requireSessionAccessApi(sessionId)` (read-level).

**Lógica:**
1. Guard de acesso.
2. Resolver `member` via `getCurrentMember()`.
3. Em paralelo:
   - `getMemberRoamClient(memberId)` — se `null`, marcar `needsAuth: true`.
   - `db().from("DesignSessionTranscript").select("*").eq("sessionId", id).order("importedAt", desc)`.
4. Se tem client: `client.listTranscriptsInRange({ max: 30 })`.
5. Marca cada `available` com `alreadyImported: boolean` (cruzando com `imported[].roamTranscriptId`).
6. Retorna:

```ts
{
  needsAuth: boolean;
  available: Array<RoamTranscriptListItem & { alreadyImported: boolean }>;
  imported: DesignSessionTranscript[];
  error?: string;  // se token Roam inválido
}
```

**Edge cases:**
- Token expirado: catch do fetch → retorna `error: "Token Roam inválido — reconecte em /settings/integrations"` mas mantém `imported` (user ainda vê o que tem).
- Session sem `projectId`: 404 (já tratado no guard).

#### POST — importa uma transcrição

**Auth:** `requireProjectEditSessionsApi(projectId)` (write-level).

**Body:** `{ roamTranscriptId: string }`

**Lógica:**
1. Parse + validação do body.
2. `lookupSessionProject(sessionId)` → projectId (404 se null).
3. `requireProjectEditSessionsApi(projectId)`.
4. `getCurrentMember()` → memberId.
5. `getMemberRoamClient(memberId)` — 400 se null ("Conecte Roam primeiro").
6. `client.getTranscript(roamTranscriptId)` — 404 do Roam → 404 nosso; 401/403 → 400.
7. Monta record:
   - `meetingTitle = detail.eventName ?? \`Reunião ${formatDate(detail.start)}\``
   - `participants = detail.participants` (manter shape original)
   - `summary = detail.summary`
   - `actionItems = detail.actionItems`
   - `fullText = cuesToText(detail.cues)`
8. `db().insert(...).select().single()` — 409 se conflict (unique).
9. Retorna o record.

### 2.2 `DELETE /api/design-sessions/[id]/roam-transcripts/[transcriptId]/route.ts`

**Auth:** `requireProjectEditSessionsApi(projectId)`.

**Lógica:**
1. `lookupSessionProject(sessionId)`.
2. Guard.
3. `db().delete().eq("id", transcriptId).eq("sessionId", sessionId)` — `eq("sessionId")` é defesa em profundidade.
4. Retorna `{ ok: true }`.

---

## 3. `RoamTranscriptModal` component

**Path:** `src/components/design-session/roam-transcript-modal.tsx`

**Props:**

```ts
{
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (transcript: ImportedTranscript) => void;
}
```

**Estado interno:**
- `loading`, `error`
- `data: { needsAuth, available, imported, error? } | null`
- `selectedRoamId: string | null`
- `importing: boolean`

**Estrutura (Sheet — segue `super-session-modal.tsx`):**

```
┌─ Header ─────────────────────────────────────┐
│ Importar reunião do Roam                     │
│ Vitor vai usar a transcrição como contexto.  │
├──────────────────────────────────────────────┤
│ [estado: loading | needsAuth | error | ok]   │
│                                              │
│ Loading: skeleton de 3 cards                 │
│                                              │
│ NeedsAuth:                                   │
│   "Conecte sua conta Roam pra ver reuniões"  │
│   [Botão → /settings/integrations]           │
│                                              │
│ Error: mensagem + [Tentar novamente]         │
│                                              │
│ Lista (radio cards, scroll):                 │
│ ┌────────────────────────────────────────┐  │
│ │ ○ Kickoff Acme                         │  │
│ │   28/04 10:00 · 45min · 3 pessoas      │  │
│ │   João, Vitor, Camila                  │  │
│ └────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────┐  │
│ │ ✓ Discovery (já importada)  [disabled] │  │
│ └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│ [Cancelar]  [Importar transcrição]           │
└──────────────────────────────────────────────┘
```

**Click "Importar":**
1. `setImporting(true)`, `POST /api/design-sessions/{sessionId}/roam-transcripts` body `{ roamTranscriptId }`.
2. Sucesso → `onImported(record)` → `onOpenChange(false)`.
3. 409 → mostra "Já importada" inline.
4. Outros erros → mostra inline.

**UX:**
- Lista das 30 últimas, sem busca/filtro (MVP).
- Já importadas aparecem desabilitadas com badge ✓.
- Sem preview da transcrição antes de importar (MVP).
- Datas em pt-BR via `Intl.DateTimeFormat("pt-BR")`.

---

## 4. Wire no `PreWorkStep`

**Arquivo:** `src/components/design-session/pre-work-step.tsx`

### 4.1 Novos states

```ts
const [roamModalOpen, setRoamModalOpen] = useState(false);
const [transcripts, setTranscripts] = useState<ImportedTranscript[]>([]);
```

### 4.2 Carregar no mount (efeito paralelo ao chat history)

```ts
useEffect(() => {
  fetch(`/api/design-sessions/${sessionId}/roam-transcripts`)
    .then(r => r.json())
    .then(({ imported }) => setTranscripts(imported ?? []))
    .catch(() => {});
}, [sessionId]);
```

### 4.3 Botão na input bar

Ao lado do `Paperclip` (linha ~349):

```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-10 w-10 shrink-0"
  onClick={() => setRoamModalOpen(true)}
  disabled={isStreaming}
  title="Importar reunião do Roam"
>
  <Video className="h-4 w-4" />
</Button>
```

### 4.4 Lista de transcrições importadas

Acima do chat scroll, dentro do `surface`:

```tsx
{transcripts.length > 0 && (
  <div className="border-b border-border/50 px-4 py-2 flex flex-wrap gap-2">
    {transcripts.map(t => (
      <TranscriptChip
        key={t.id}
        transcript={t}
        onRemove={() => handleRemoveTranscript(t.id)}
      />
    ))}
  </div>
)}
```

`TranscriptChip` mostra: 🎙 + título truncado + data curta + `[✕]`. Click no corpo abre popover com summary.

### 4.5 Modal montado no fim do JSX

```tsx
<RoamTranscriptModal
  sessionId={sessionId}
  open={roamModalOpen}
  onOpenChange={setRoamModalOpen}
  onImported={(t) => setTranscripts(prev => [t, ...prev])}
/>
```

### 4.6 Handler de remove

```ts
async function handleRemoveTranscript(transcriptId: string) {
  await fetch(
    `/api/design-sessions/${sessionId}/roam-transcripts/${transcriptId}`,
    { method: "DELETE" }
  );
  setTranscripts(prev => prev.filter(t => t.id !== transcriptId));
}
```

### 4.7 Welcome text

Atualizar pra mencionar a opção:

```
"Olá! Sou o Vitor... pode descrever em texto livre, anexar documentos, 
ou importar transcrições de reuniões do Roam pelo botão de vídeo."
```

---

## 5. Vitor — `loadContext`

**Arquivo:** `src/lib/agent/agents/vitor/index.ts`

### 5.1 Adicionar à `Promise.all`

```ts
db()
  .from("DesignSessionTranscript")
  .select(
    "id, meetingTitle, meetingStart, meetingEnd, participants, summary, actionItems, fullText"
  )
  .eq("sessionId", sessionId)
  .order("meetingStart", { ascending: false }),
```

### 5.2 Retornar no contexto

```ts
return {
  ...,
  transcripts: transcripts.data ?? [],
};
```

### 5.3 Passar pro `buildPrompt`

```ts
return buildSystemPrompt({
  ...,
  transcripts: agentContext.transcripts as TranscriptContextItem[],
});
```

### 5.4 Novo tipo exportado

```ts
export interface TranscriptContextItem {
  id: string;
  meetingTitle: string;
  meetingStart: string;
  meetingEnd: string;
  participants: { name: string; email?: string }[];
  summary: string | null;
  actionItems: { title: string; description: string }[];
  fullText: string;
}
```

---

## 6. `prompt.ts` — injetar no `preWorkSection`

**Arquivo:** `src/lib/agent/prompt.ts`

### 6.1 Adicionar `transcripts` em `PromptInput`

```ts
transcripts?: TranscriptContextItem[];
```

### 6.2 Helper `buildTranscriptsBlock`

```ts
function buildTranscriptsBlock(transcripts: TranscriptContextItem[]): string {
  if (!transcripts?.length) return "";

  const blocks = transcripts.map(t => {
    const start = new Date(t.meetingStart);
    const date = `${start.getDate()}/${start.getMonth() + 1} ${start.getHours()}:${String(start.getMinutes()).padStart(2, "0")}`;
    const people = t.participants.map(p => p.name).join(", ");
    const actions = t.actionItems
      .map(a => `- ${a.title}${a.description ? `: ${a.description}` : ""}`)
      .join("\n") || "(nenhum)";

    return `### ${t.meetingTitle} — ${date}
Participantes: ${people}
Resumo: ${t.summary ?? "(sem resumo)"}
Action items:
${actions}

<transcript id="${t.id}">
${t.fullText}
</transcript>`;
  }).join("\n\n---\n\n");

  return `
## Transcrições de reuniões importadas
Você tem acesso a ${transcripts.length} transcrição(ões) de reuniões reais sobre este projeto.
**Use como fonte de verdade primária** — são falas literais dos stakeholders.
Quando o usuário fizer perguntas factuais sobre o que foi discutido, cite a fala literalmente
(referencie o speaker e use aspas) em vez de parafrasear.

${blocks}
`;
}
```

### 6.3 Inserir no `preWorkSection`

Antes do "Como agir":

```ts
const preWorkSection =
  currentStepKey === "pre_work"
    ? `
## Modo Pre-Trabalho
${buildTranscriptsBlock(transcripts ?? [])}
Voce esta no step de Pre-Trabalho. Seu objetivo e entender o projeto do usuario...
[resto inalterado]
```

### 6.4 Truncamento

Sem truncamento no MVP. Reunião 2h ≈ ~30k tokens. Se virar problema, adiciono tool `read_transcript(id)` numa fase 2 e injeto só metadados na primeira leitura.

---

## 7. Smoke test

1. **DB sanity:** `psql "$DIRECT_URL" -c '\d "DesignSessionTranscript"'` — confirma estrutura.
2. **Connect Roam** (se ainda não): UI em `/settings/integrations`.
3. **Build:** `npm run build` — captura erros de tipo.
4. **Dev server:** `npm run dev`, abrir uma design session existente na step `pre_work`.
5. **Click no botão de vídeo** → modal abre → ver lista de reuniões.
6. **Importar uma reunião** → chip aparece acima do chat.
7. **Mandar pra Vitor:** "Resume essa reunião pra mim" — verificar que ele cita conteúdo real.
8. **Pergunta específica:** "Quem falou X sobre Y?" — espera-se citação literal com nome do speaker.
9. **Remover a transcrição** — chip some + DB confirma delete.
10. **Reimportar a mesma reunião** — deve dar 409 com mensagem clara.

---

## 8. Fora do MVP

- ❌ Filtro de reuniões por participantes do projeto.
- ❌ Auto-importação de reuniões recentes.
- ❌ Tool `read_transcript(id)` / `search_transcript(id, query)`.
- ❌ Preview da transcrição dentro do modal antes de importar.
- ❌ Edit do título/summary depois de importado.
- ❌ Citação com timestamp clicável no chat (cues raw não são guardadas).

---

## 9. Arquivos tocados

| Tipo | Arquivo |
|------|---------|
| ✅ Migration | `supabase/migrations/20260429_design_session_transcript.sql` |
| ✅ Types | `src/lib/supabase/database.types.ts` |
| 🆕 Route | `src/app/api/design-sessions/[id]/roam-transcripts/route.ts` |
| 🆕 Route | `src/app/api/design-sessions/[id]/roam-transcripts/[transcriptId]/route.ts` |
| 🆕 Component | `src/components/design-session/roam-transcript-modal.tsx` |
| ✏️ Edit | `src/components/design-session/pre-work-step.tsx` |
| ✏️ Edit | `src/lib/agent/agents/vitor/index.ts` |
| ✏️ Edit | `src/lib/agent/prompt.ts` |

---

## 10. Pontos de revisão antes de seguir

1. **Erro de "token Roam inválido":** inline no modal (sugerido) vs toast?
2. **Welcome text:** mencionar Roam ali ou deixar a descoberta pelo botão?
3. **Chip do transcript:** popover (mais espaço pro summary) vs tooltip (mais leve)?
