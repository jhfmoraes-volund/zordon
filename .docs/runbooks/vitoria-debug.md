# Runbook: Vitória / Planning Ceremony — Debug

## Sintomas conhecidos (2026-05-28)

| Sintoma | Causa | Status |
|---------|-------|--------|
| Agente não responde no chat | `/api/planning/[id]/chat` era stub 501 | **Corrigido** |
| BriefingTree vazio | Sem notas — consequência do item acima | **Resolvido junto** |

---

## Arquitetura do fluxo

```
UI (useChat)
  └─ POST /api/planning/[id]/chat
       └─ planningChatConnector.handle()           ← src/lib/agent/connectors/planning-chat.ts
            └─ runAgent({ agent: vitoriaAgent })   ← src/lib/agent/agents/vitoria/index.ts
                 ├─ vitoriaAgent.loadContext()      ← carrega planning, notas, transcripts
                 ├─ vitoriaAgent.buildPrompt()      ← src/lib/agent/agents/vitoria/prompt.ts
                 └─ vitoriaAgent.buildTools()       ← src/lib/agent/agents/vitoria/tools.ts
                      ├─ add_context_note           → INSERT PlanningContextNote
                      ├─ read_transcript_content    → SELECT TranscriptRef.fullText
                      ├─ begin_reading              → PATCH phase → reading
                      ├─ propose_actions            → PATCH phase → proposing
                      └─ add_task_action            → INSERT MeetingTaskAction
```

### BriefingTree — quando aparece

O `BriefingTree` só renderiza quando há notas com `dismissedAt = null` em `PlanningContextNote`.
O empty-state "Vitória está lendo os insumos…" é exibido enquanto a fase é `reading` e o agente
ainda não gerou notas. Isso é comportamento correto.

---

## Fluxo de uso esperado

```
1. PM importa ≥1 transcrição via "Contexto" → ContextSheet → TranscriptModal
   → POST /api/planning/[id]/transcripts/sources (grava fullText)

2. PM clica "Iniciar leitura" → fase muda para "reading"

3. PM abre o chat e manda mensagem para Vitória, ex:
   "Leia os transcripts importados e monte o briefing da sprint"

4. Vitória:
   a. Lê cada transcript via read_transcript_content (usa fullText se disponível)
   b. Gera notas via add_context_note (kind: summary, theme, risk, ...)
   c. Chama propose_actions quando pronto → fase → "proposing"

5. BriefingTree aparece com notas agrupadas por kind
6. ProposalCards aparecem para cada MeetingTaskAction gerada
```

---

## Debugging passo a passo

### Agente não responde

1. **Verificar 5xx no Network**
   - Dev Tools → Network → filtrar `/api/planning/` → inspecionar response
   - 401 → auth não resolvida (verificar cookie/sessão)
   - 404 → planningId errado ou planning não existe no DB
   - 502/504 → OpenRouter timeout (modelo `anthropic/claude-haiku-4-5`)

2. **Verificar logs do servidor**
   ```bash
   # Terminal com o Next.js dev — filtrar erros do planning chat
   grep "planning\|vitoria\|runAgent" <server-stdout>
   ```

3. **Verificar variáveis de ambiente**
   ```bash
   grep "OPENROUTER\|ANTHROPIC" .env
   # OPENROUTER_API_KEY deve estar presente — é o modelo da Vitória
   ```

4. **Testar o endpoint diretamente**
   ```bash
   curl -X POST http://localhost:3000/api/planning/<id>/chat \
     -H "Content-Type: application/json" \
     -H "Cookie: <auth-cookie>" \
     -d '{"messages":[{"role":"user","content":"olá"}]}'
   ```

### BriefingTree não mostra notas após agente responder

1. **Verificar PlanningContextNote no DB**
   ```sql
   SELECT id, kind, content, "dismissedAt", priority
   FROM "PlanningContextNote"
   WHERE "planningCeremonyId" = '<id>'
   ORDER BY priority DESC;
   ```

2. **Verificar se loadPlanning está sendo chamado após a conversa**
   - O chat não auto-recarrega `planning` — PM precisa dar F5 ou navegar para recarregar
   - TODO: conectar o `onFinish` do `useChat` a `loadPlanning()` para auto-refresh

3. **Verificar se notas têm `dismissedAt != null`**
   - Se todas estão com `dismissedAt`, o filter `activeNotes` vai omiti-las
   - Update manual: `UPDATE "PlanningContextNote" SET "dismissedAt" = NULL WHERE "planningCeremonyId" = '<id>';`

### Ferramenta `read_transcript_content` retorna "conteúdo não disponível"

1. **Verificar se fullText foi gravado no TranscriptRef**
   ```sql
   SELECT id, source, "sourceId", title,
          length("fullText") as fulltext_len
   FROM "TranscriptRef"
   WHERE id IN (
     SELECT "transcriptRefId" FROM "PlanningTranscriptLink"
     WHERE "planningCeremonyId" = '<id>'
   );
   ```

2. **Se `fulltext_len` é NULL**: a transcrição foi importada antes da migration `20260528c_transcript_fulltext.sql`
   ou via rota antiga (link manual). Re-importar via ContextSheet.

3. **Se `fulltext_len` é 0**: a fonte (Roam/Granola) não retornou `transcriptText` em `getMeetingDetail()`.
   Verificar `/api/planning/[id]/transcripts/sources` POST response no Network.

---

## Arquivos chave

| Arquivo | Papel |
|---------|-------|
| `src/app/api/planning/[id]/chat/route.ts` | Entry point HTTP → planningChatConnector |
| `src/lib/agent/connectors/planning-chat.ts` | Auth, thread, runAgent, stream |
| `src/lib/agent/agents/vitoria/index.ts` | AgentDefinition: loadContext + buildPrompt + buildTools |
| `src/lib/agent/agents/vitoria/tools.ts` | Ferramentas: add_context_note, read_transcript_content, etc. |
| `src/lib/agent/agents/vitoria/prompt.ts` | System prompt da Vitória |
| `src/app/api/planning/[id]/transcripts/sources/route.ts` | Import de transcrição com fullText |
| `src/components/planning/briefing-tree.tsx` | Renderiza PlanningContextNote agrupadas por kind |
| `src/components/planning/proposal-card.tsx` | Card de MeetingTaskAction com MeetingTaskActionSheet |
| `src/components/planning/context-sheet.tsx` | Sheet de contexto + TranscriptModal |
