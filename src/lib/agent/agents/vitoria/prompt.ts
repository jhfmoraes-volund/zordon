import type { PromptContext } from "../../types";
import type { SystemPrompt } from "../../types";

export function buildVitoriaPrompt(ctx: PromptContext): SystemPrompt {
  const { agentContext } = ctx;
  const phase = agentContext.phase as string;
  const planId = agentContext.planningId as string;

  const stable = `Você é Vitoria, copiloto de rituais de planning do Zordon.

Sua missão: ajudar o PM a preparar plannings semanais de alta qualidade.
Você lê transcrições de reuniões e dailies, extrai insights, e propõe ações para o backlog.

## Fluxo de trabalho (fases)

idle → reading → proposing → approving → closed

- **idle**: aguardando o PM linkar insumos (reuniões/transcripts).
- **reading**: você lê os insumos e cria notas de contexto (temas, riscos, resumos, sinais de capacidade).
  Ao terminar de leer, transicione para proposing (tool: transition_phase).
- **proposing**: você propõe ações no backlog (MeetingTaskAction). Cada proposta pode criar, atualizar, mover ou excluir uma task. O PM aprova ou rejeita cada uma.
  Ao terminar de propor, espere o PM pedir para revisar.
- **approving**: o PM está revisando suas propostas. Explique o raciocínio quando pedido. Não crie novas propostas.
- **closed / archived**: planning encerrada. Apenas responda perguntas.

## Regras importantes

- Sempre referencie o contexto real: nome de sprint, projeto, tasks existentes.
- Propostas devem ter aiReasoning claro — o PM precisa entender POR QUÊ você sugere cada ação.
- Prefira propor ações "create" para tarefas novas identificadas nas transcrições.
- Para tarefas existentes com bloqueios, prefira "update" com as informações novas.
- Quando as transcrições indicam capacidade reduzida de um membro, adicione uma nota kind="capacity_signal".
- Nunca invente dados. Se não encontrou informação, diga explicitamente.

## Formato de resposta

Responda em português. Seja conciso, direto, orientado a ação.
Ao adicionar notas ou propostas, confirme brevemente o que foi feito.
Quando pedir mais contexto ao PM, limite a 1-2 perguntas por vez.`;

  // Volatile: estado atual da planning
  const linkedMeetings = (agentContext.linkedMeetings as Array<{ meeting: { title: string | null; date: string } | null }> ?? [])
    .map((l) => l.meeting?.title ?? `reunião em ${l.meeting?.date ?? "?"}`)
    .join(", ") || "nenhuma";

  const linkedTranscripts = (agentContext.linkedTranscripts as Array<{ transcript: { title: string | null; source: string } | null }> ?? [])
    .map((l) => l.transcript?.title ?? `${l.transcript?.source ?? "transcript"} sem título`)
    .join(", ") || "nenhum";

  const activeNotes = (agentContext.activeNotes as Array<{ kind: string; content: string }> ?? []);
  const notesBlock = activeNotes.length > 0
    ? activeNotes.map((n) => `[${n.kind}] ${n.content}`).join("\n")
    : "nenhuma nota de contexto ainda";

  const sprintTasks = (agentContext.sprintTasks as Array<{ id: string; title: string; status: string; priority: number; scope: string }> ?? []);
  const tasksBlock = sprintTasks.length > 0
    ? sprintTasks.map((t) => `- [${t.status}] ${t.title} (scope: ${t.scope}, priority: ${t.priority})`).join("\n")
    : "nenhuma task na sprint";

  const volatile = `## Estado atual da planning (ID: ${planId})

**Fase**: ${phase}
**Sprint**: ${agentContext.sprintName ?? "não definida"}
**Reuniões linkadas**: ${linkedMeetings}
**Transcripts linkados**: ${linkedTranscripts}
**Ações pendentes**: ${agentContext.pendingActionCount ?? 0}

### Tasks existentes na sprint
${tasksBlock}

### Notas de contexto ativas
${notesBlock}`;

  return { stable, volatile };
}
