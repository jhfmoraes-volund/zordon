# Vitória — reescrita para o modelo staging-commit

> Adapta o agente Vitória ao novo modelo de Planning como staging atômico (ver [`docs/features/meetings/planning-staging-model-plan.md`](../../features/meetings/planning-staging-model-plan.md)). Foco exclusivo: prompt, tools, loadContext. Backend de planning e UI são tratados no plano de feature.

## O que muda na cabeça da Vitória

**Antes:** Vitória pensa em 6 fases (`idle → reading → proposing → approving → closed`), pede permissão pra transicionar, muda de comportamento por fase (lê em `reading`, propõe em `proposing`, só responde em `approving`).

**Depois:** Vitória opera continuamente enquanto a planning está aberta. Sem fases visíveis pra ela. Conversa-dirigida — propõe, ajusta, remove propostas conforme o PM discute. Quando a planning é concluída (pelo PM), entra em modo read-only.

## Sumário das mudanças

| Componente | Mudança |
|------------|---------|
| `prompt.ts` — seção "Fluxo de trabalho (fases)" | **Remover.** Substituir por "Modelo de trabalho: staging atômico". |
| `prompt.ts` — bloco volátil de estado | Remover linha `**Fase**: ${phase}`. Trocar por `**Status**: ${status}` (open/closed). Manter sprint, linked items, notes, sprintTasks. |
| `tools.ts` — `transition_phase` | **Remover.** Transição não é mais ação da Vitória. |
| `tools.ts` — `delete_proposed_action` | **Novo.** Remove uma MeetingTaskAction proposta quando PM discorda. |
| `tools.ts` — `update_proposed_action` | **Novo.** Edita payload/aiReasoning de uma proposta existente quando PM refina. |
| `tools.ts` — `propose_task_action` | Mantém igual. |
| `tools.ts` — `add_context_note` | Mantém igual (memória interna). Prompt deixa claro que não há UI dedicada. |
| `tools.ts` — `read_transcript_content` | Mantém igual. |
| `index.ts` (`loadContext`) | Adicionar `pendingActions` populadas (não só contagem) — Vitória precisa saber o que já propôs pra editar/deletar coerentemente. Renomear `phase` → `status` no retorno, normalizado pra `open`/`closed`. |

## 1. Prompt (`src/lib/agent/agents/vitoria/prompt.ts`)

### Substituir bloco "Fluxo de trabalho (fases)"

```markdown
## Modelo de trabalho

A planning é um espaço de **staging atômico**. Enquanto está aberta
(status="Em planejamento"), tudo que você propõe — criação, edição,
remoção de tasks — fica em rascunho. Nada toca o backlog real até o
PM clicar "Concluir planning", quando todas as propostas pendentes
aplicam de uma vez.

Você opera continuamente, sem fases. Não pede permissão pra começar
a ler nem anuncia que "terminou de propor". É conversa contínua.

Como você muta o staging:
- **Propõe** ações via `propose_task_action`. Cada uma com `aiReasoning`
  claro — o PM lê pra entender a sugestão.
- **Remove** propostas via `delete_proposed_action` quando o PM discorda
  ("não, essa não" / "esquece a X" / "remove essa proposta").
- **Atualiza** propostas via `update_proposed_action` quando o PM refina
  ("aumenta a prioridade" / "muda o scope pra backend").
- **Lê** transcripts via `read_transcript_content` quando precisa de
  detalhe pra propor com fundamento.
- **Registra** insights internos via `add_context_note` — é a sua
  memória entre turnos. Não há UI dedicada exibindo essas notas; não
  anuncie ao PM "criei uma nota X". Use silenciosamente.

Quando a planning é concluída (status="Concluída"), entre em modo
read-only: responda perguntas, mas não chame nenhuma tool de mutação.
```

### Regras importantes — manter, ajustar tom

```markdown
## Regras importantes

- Sempre referencie contexto real: nome de sprint, projeto, tasks existentes.
- `aiReasoning` é o que o PM lê pra decidir manter ou pedir pra remover.
  Seja específico — cite a transcript/decisão que justifica a proposta.
- Antes de propor uma task nova, confira se já existe na sprint (lista
  abaixo) — evite duplicata.
- Quando o PM pedir pra remover/ajustar uma proposta sua, use
  `delete_proposed_action`/`update_proposed_action` em vez de criar uma
  nova. As propostas atuais estão listadas no contexto.
- Nunca invente dados. Se faltou informação na transcript, diga
  explicitamente e ofereça perguntar ao PM.
```

### Bloco volátil — substituir `phase` por `status`

```markdown
## Estado atual da planning (ID: ${planId})

**Status**: ${status}        // "open" ou "closed"
**Sprint**: ${sprintName ?? "não definida"}
**Reuniões linkadas**: ${linkedMeetings}
**Transcripts linkados**: ${linkedTranscripts}

### Tasks existentes na sprint
${tasksBlock}

### Propostas já feitas nesta planning (${pendingActions.length})
${pendingActionsBlock}    // lista com id, type, alvo, aiReasoning

### Notas internas (memória)
${notesBlock}
```

## 2. Tools (`src/lib/agent/agents/vitoria/tools.ts`)

### Remover

```ts
transition_phase: tool({ ... })  // deletar inteiro
```

### Adicionar — `delete_proposed_action`

```ts
delete_proposed_action: tool({
  description:
    "Remove uma proposta de ação (MeetingTaskAction) que você havia criado. Use quando o PM discordar dela ou pedir pra esquecer. Só remove propostas com decision='pending' — propostas já decididas (caso raro) ficam intactas.",
  inputSchema: z.object({
    actionId: z.string().describe("ID da MeetingTaskAction a remover"),
    reason: z.string().describe("Motivo curto — registrado pra audit/debug"),
  }),
  execute: async ({ actionId, reason }) => {
    const { error } = await db()
      .from("MeetingTaskAction")
      .delete()
      .eq("id", actionId)
      .eq("planningCeremonyId", planningId)
      .eq("decision", "pending");
    if (error) throw new Error(`Falha ao remover proposta: ${error.message}`);
    return { ok: true, actionId, reason };
  },
}),
```

### Adicionar — `update_proposed_action`

```ts
update_proposed_action: tool({
  description:
    "Edita uma proposta de ação (MeetingTaskAction) já criada — payload, aiReasoning, targetSprintId, etc. Use quando o PM refinar a proposta sem precisar de uma nova.",
  inputSchema: z.object({
    actionId: z.string().describe("ID da MeetingTaskAction a editar"),
    payload: z.record(z.string(), z.unknown()).optional(),
    aiReasoning: z.string().optional(),
    targetSprintId: z.string().optional(),
    aiConfidence: z.number().min(0).max(1).optional(),
  }),
  execute: async ({ actionId, ...patch }) => {
    const update: Record<string, unknown> = {};
    if (patch.payload !== undefined) update.payload = patch.payload as Json;
    if (patch.aiReasoning !== undefined) update.aiReasoning = patch.aiReasoning;
    if (patch.targetSprintId !== undefined) update.targetSprintId = patch.targetSprintId;
    if (patch.aiConfidence !== undefined) update.aiConfidence = patch.aiConfidence;
    update.updatedAt = new Date().toISOString();

    const { data, error } = await db()
      .from("MeetingTaskAction")
      .update(update)
      .eq("id", actionId)
      .eq("planningCeremonyId", planningId)
      .eq("decision", "pending")
      .select("id, type")
      .single();
    if (error) throw new Error(`Falha ao atualizar proposta: ${error.message}`);
    return { ok: true, actionId: data.id, type: data.type };
  },
}),
```

Ambas usam o filtro `decision='pending'` e `planningCeremonyId=planningId` — guardrails básicos.

### Manter inalterados

- `add_context_note`
- `propose_task_action`
- `read_transcript_content`

## 3. Context (`src/lib/agent/agents/vitoria/index.ts`)

### Trazer propostas populadas, não só contagem

```ts
// Trocar: const { count: pendingActionCount } = ...
// Por:
const { data: pendingActions } = await db()
  .from("MeetingTaskAction")
  .select(
    "id, type, taskId, targetSprintId, payload, aiReasoning, aiConfidence",
  )
  .eq("planningCeremonyId", planningId)
  .eq("decision", "pending")
  .order("createdAt", { ascending: true });
```

### Normalizar `phase` em `status`

```ts
const isOpen = !["closed", "archived"].includes(planning.phase);
return {
  ...
  status: isOpen ? "open" : "closed",   // novo
  // phase: planning.phase,             // remover do retorno
  pendingActions: pendingActions ?? [], // novo (substitui pendingActionCount)
  ...
};
```

O prompt usa `agentContext.status` e renderiza "Em planejamento" / "Concluída" pra Vitória.

## 4. Testes manuais (smoke)

Depois de mergear, validar no chat de uma planning real:

1. **Continuidade** — fazer 3 turnos sem mencionar "fase". Vitória não deve pedir transição nem dizer "agora vou propor".
2. **Remoção de proposta** — pedir "remove essa proposta da VLD-105". Vitória chama `delete_proposed_action` e confirma. Verificar no banco que a row sumiu.
3. **Edição de proposta** — pedir "aumenta a prioridade da proposta de criar VLD-107 pra alta". Vitória chama `update_proposed_action`. Verificar row atualizada.
4. **Read-only em concluída** — concluir planning via UI. Pedir "cria uma task nova". Vitória deve recusar, citando que a planning está concluída.
5. **Awareness das propostas atuais** — após 5 propostas feitas, perguntar "quais propostas você fez até agora?". Vitória responde citando da lista no contexto, sem precisar de tool call.

## 5. Riscos

- **Drift entre prompt e tools.** Se removermos `transition_phase` dos tools mas o prompt ainda mencionar fases, Vitória pode tentar usar uma tool que não existe (erro de runtime). Garantir que o prompt seja reescrito **junto** com a remoção da tool.
- **Histórico em chat existente.** Planning ainda aberta com chat onde Vitória já falou em "fase reading" — quando recarregar, a Vitória vai ver mensagens antigas com a vocabulary antiga. Aceitar essa inconsistência ou começar nova thread (preferível — `threadId=null` no primeiro turno pós-deploy).
- **`PlanningContextNote` órfãs.** Notas criadas em plannings antigas continuam no DB. Não removemos — Vitória pode usar como memória se carregadas. Sem impacto negativo, só ruído potencial. Decisão: deixar.

## 6. Ordem dentro deste plano

1. Reescrever `prompt.ts` (incluindo bloco volátil novo).
2. Atualizar `tools.ts` — remover `transition_phase`, adicionar `delete_proposed_action` + `update_proposed_action`.
3. Atualizar `index.ts` (`loadContext`) — pendingActions populadas + `status` normalizado.
4. Validar build (`tsc --noEmit` no escopo do agente).
5. Smoke test no chat de uma planning de dev.

Cada passo cabe num commit. Order é importante: 3→2→1 também funciona, mas 1→2→3 deixa o agente quebrado entre os passos (prompt fala de tool que ainda existe → ok; ou tool existe que prompt removeu → ok). Sem ordem destrutiva.

## Dependências externas

- O plano de feature ([planning-staging-model-plan.md](../../features/meetings/planning-staging-model-plan.md)) precisa ter o `POST /api/planning/[id]/complete` rodando antes da Vitória mudar — senão o PM clica "Concluir planning" e nada acontece, e Vitória ainda fala "vamos concluir" sem entender o efeito.
- Ordem geral recomendada: backend `/complete` + UI ribbon → Vitória rewrite. Vitória depois porque ela só *fala* sobre o fluxo; sem o fluxo funcionando, o que ela diz é mentira.
