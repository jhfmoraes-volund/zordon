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
): string {
  const provider = source === "roam" ? "Roam" : "Granola";

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
