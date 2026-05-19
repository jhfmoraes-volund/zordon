import type { MeetingSource } from "@/lib/meetings";

/**
 * Prompt seed pro Alpha ingerir a transcrição de uma reunião externa numa
 * Meeting do Volund. Usado tanto pelo /ops (kickoff via query params) quanto
 * pelo side sheet (kickoffIngest do AlphaChatProvider).
 *
 * Source-aware: a tool `get_meeting_transcript` do Alpha já aceita `source`,
 * então o seed só precisa monta-la corretamente.
 */
export function buildIngestSeed(
  meetingId: string,
  source: MeetingSource,
  sourceId: string,
  overwrite: boolean,
  meetingType?: string,
): string {
  const provider = source === "roam" ? "Roam" : "Granola";

  if (meetingType === "private") {
    const lines = [
      overwrite
        ? `Quero que você ingira a transcrição ${provider} ${sourceId} na reunião PRIVADA ${meetingId} (já existe). Posso sobrescrever conteúdo existente.`
        : `Acabei de criar a reunião PRIVADA ${meetingId} e quero que você ingira a transcrição ${provider} ${sourceId} nela.`,
      "",
      "Esta é uma reunião PRIVADA: só o owner vê. Escopo restrito.",
      "",
      "Faça em piloto automático, sem pedir confirmação:",
      `1) Chame \`get_meeting_transcript\` com source="${source}" e meetingId="${sourceId}" pra carregar a transcrição completa.`,
      "2) Salve a transcrição BRUTA no campo `transcript` da Meeting (use update_meeting com transcript=<texto>).",
      "3) Escreva um RESUMO conciso da transcrição no campo `notes` da Meeting (use update_meeting com notes=<resumo>).",
      "4) Crie To-dos pessoais AO OWNER (createdById da Meeting) com `create_todo`. Não atribua a outros members.",
      "5) Se a reunião tiver projetos vinculados (veja `## Reunião ativa`), use `propose_task_action` SOMENTE nesses projetos. Sem projetos vinculados → não proponha Tasks.",
      "6) NÃO chame `update_meeting_review` (não há reviews) e NÃO toque em sprints/tasks fora dos projetos vinculados.",
    ];
    if (overwrite) {
      lines.push(
        "7) Pode haver notes/To-dos prévios. Substitua o resumo de notes; não duplique To-dos (compare por descrição similar).",
      );
    }
    lines.push(
      `${overwrite ? "8" : "7"}) Ao final, mostre um resumo curto do que foi salvo (notes, To-dos, Tasks propostas).`,
    );
    return lines.join("\n");
  }

  const lines = [
    overwrite
      ? `Quero que você ingira o conteúdo da transcrição ${provider} ${sourceId} na reunião ${meetingId} que já existe. O user já confirmou que pode sobrescrever conteúdo existente.`
      : `Acabei de criar a reunião ${meetingId} e quero que você ingira o conteúdo da transcrição ${provider} ${sourceId} nela.`,
    "",
    "Faça em piloto automático, sem pedir confirmação:",
    `1) Chame \`get_meeting_transcript\` com source="${source}" e meetingId="${sourceId}" pra carregar a transcrição completa.`,
    "2) Veja o `Tipo` da reunião no bloco `## Reunião ativa` no contexto e aplique as regras do tipo (pm_review / daily / super_planning / general) pra popular a reunião.",
    "3) Execute todas as ações compatíveis com o tipo (update_meeting_review, propose_task_action, create_todo, etc.) — sem pausar pra perguntar 'confirma?'.",
  ];
  if (overwrite) {
    lines.push(
      "4) Reunião pode já ter notes/reviews/To-dos preenchidos. Substitua o conteúdo pelos valores derivados da transcrição. Pra To-dos existentes que ainda fazem sentido, não duplique — só crie novos.",
      "5) Ao final, mostre um resumo do que foi criado/atualizado.",
    );
  } else {
    lines.push("4) Ao final, mostre um resumo do que foi criado/preenchido.");
  }
  return lines.join("\n");
}

/**
 * Variante focada em "Sugerir To-dos com IA" disparada do header da seção
 * To-dos. Diferente do `buildIngestSeed`, aqui o objetivo é estreito:
 * extrair APENAS To-dos da transcrição (não mexe em notes, reviews, tasks).
 *
 * O Meeting já existe (vem da página da reunião) e tem o link
 * transcriptSource/transcriptSourceId salvo do import anterior.
 */
export function buildSuggestTodosSeed(
  meetingId: string,
  source: MeetingSource,
  sourceId: string,
): string {
  const provider = source === "roam" ? "Roam" : "Granola";

  return [
    `Quero gerar To-dos para a reunião ${meetingId} a partir da transcrição ${provider} ${sourceId}.`,
    "",
    "Faça em piloto automático, sem pedir confirmação:",
    `1) Chame \`get_meeting_transcript\` com source="${source}" e meetingId="${sourceId}" pra carregar a transcrição completa.`,
    "2) Chame `extract_meeting_actions` passando a transcrição inteira — você vai usar APENAS o array `todos` do resultado (ignore `tasks` e `skipped` nesta operação).",
    "3) Pra cada item em `todos`, execute `create_todo` em paralelo. Resolva assigneeName→memberId via lista de members do contexto.",
    "4) NÃO crie/atualize tasks, reviews ou notes — escopo aqui é só To-dos.",
    "5) NÃO duplique To-dos que já existem na reunião (compare por descrição similar).",
    "6) Ao final, mostre um resumo curto com a lista dos To-dos criados.",
  ].join("\n");
}
