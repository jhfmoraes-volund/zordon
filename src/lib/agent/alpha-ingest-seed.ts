/**
 * Prompt seed pro Alpha ingerir uma transcrição do Roam numa Meeting.
 * Usado tanto pelo /ops (kickoff via query params) quanto pelo side sheet
 * (kickoffIngest do AlphaChatProvider).
 */
export function buildIngestSeed(
  meetingId: string,
  roamTranscriptId: string,
  overwrite: boolean,
): string {
  const lines = [
    overwrite
      ? `Quero que você ingira o conteúdo da transcrição Roam ${roamTranscriptId} na reunião ${meetingId} que já existe. O user já confirmou que pode sobrescrever conteúdo existente.`
      : `Acabei de criar a reunião ${meetingId} e quero que você ingira o conteúdo da transcrição Roam ${roamTranscriptId} nela.`,
    "",
    "Faça em piloto automático, sem pedir confirmação:",
    `1) Chame \`get_meeting_transcript\` com transcriptId=${roamTranscriptId} pra carregar a transcrição completa.`,
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
