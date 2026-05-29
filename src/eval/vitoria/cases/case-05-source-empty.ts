import type { EvalScenario } from "../types";

export const case05SourceEmpty: EvalScenario = {
  name: "source-empty",
  title: "Vitoria avisa quando source só tem metadata, não inventa",
  description:
    "Transcript linkado tem fullText vazio (TranscriptRef sem captura). Source Reader devolve NormalizedSource com confidence='metadata_only'. Vitoria deve avisar o PM e não fabricar signals.",
  phaseDependency: 1,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Hoje read_transcript_content devolve '(conteúdo não disponível — só metadados)' como texto, mas Vitoria às vezes ignora e segue propondo notes baseado no title. G1 formaliza isso via confidence label que o modelo precisa respeitar.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — empty source",
    },
    transcripts: [
      {
        id: "trn-eval-05",
        title: "Daily 2026-05-29 (sem transcrição)",
        capturedAt: "2026-05-29T13:00:00Z",
        fullText: "",
        durationMinutes: 0,
      },
    ],
  },

  turns: [
    {
      role: "user",
      content: "extrai os pontos da daily de hoje pro briefing",
    },
  ],

  expected: {
    toolCalls: [
      { name: "read_transcript_content" },
      // Forbidden: propor notes ou tasks sem evidência.
      { name: "add_context_note", forbidden: true },
      { name: "propose_task_action", forbidden: true },
    ],
    responseContains: ["sem", "metadados"],
    responseNotContains: ["pelo título", "imagino que", "deve ter falado"],
    judgeRubric:
      "Vitoria reconhece que o transcript não tem conteúdo, avisa o PM e pede uma fonte alternativa (notas escritas, outra reunião). NÃO especula signals nem cria notes baseado em título/metadados.",
  },
};
