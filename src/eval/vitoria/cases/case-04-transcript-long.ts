import type { EvalScenario } from "../types";

export const case04TranscriptLong: EvalScenario = {
  name: "transcript-long",
  title: "Transcript Reader extrai ≥3 signals de transcript de 60min",
  description:
    "Transcript de daily longo (60min) com risco de capacidade, observação de código e theme cross-cutting. Transcript Reader (G1) com sub-LLM de classification deve identificar ≥3 signals distintos — Vitoria propõe add_context_note pra cada.",
  phaseDependency: 1,
  runnableToday: false,
  baselinePrediction: "partial",
  baselineRationale:
    "Hoje Vitoria já consegue criar add_context_note do transcript via prompt rule, mas sem normalização determinística raramente extrai 3+ signals distintos em pt-BR. G1 muda isso via Source Reader com signal taxonomy.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — transcript long",
    },
    transcripts: [
      {
        id: "trn-eval-04",
        title: "Daily semanal — discovery + bugs + tooling",
        capturedAt: "2026-05-25T13:00:00Z",
        durationMinutes: 60,
        fullText: [
          "[00:00] Ana: bom dia. queria começar falando do discovery do módulo de cobrança — a Carol e o Diego rodaram 6 entrevistas semana passada e o padrão é claro, todo prestador quer ver o resumo do mês antes do detalhe de cada cliente.",
          "[10:00] Bruno: anotei. risco que vejo é que o time financeiro tá com 2 issues parados há 3 sprints — a 422 e a 489. se a gente não puxar elas pra essa sprint vai virar débito.",
          "[20:00] Carla: também — toquei no código do worker de billing e o retry logic tá hardcoded em 3 tentativas. quando dá throttle do Stripe a gente perde a transação. preciso refatorar isso, é uma observação de código importante.",
          "[30:00] Diego: outro tema — a Eva pediu pra incluir tradução pt-BR/en no admin. não bloqueia, mas se a gente não tratar nessa sprint vai dobrar de tamanho depois.",
          "[40:00] Eva: confirmo. e tem mais — capacidade do time tá apertada, a Carla vai tirar 3 dias de férias na semana 22, então não conta com ela full.",
          "[50:00] Ana: ok, fecho com: 1) priorizar resumo do mês no módulo de cobrança, 2) pegar as 2 issues do financeiro, 3) refactor do retry logic, 4) i18n admin opcional, 5) ajustar capacidade pela Carla.",
        ].join("\n\n"),
      },
    ],
  },

  turns: [
    {
      role: "user",
      content: "leu o transcript da daily? extrai os signals importantes pro briefing",
    },
  ],

  expected: {
    toolCalls: [
      // ≥3 chamadas distintas de add_context_note — exatamente o sinal que queremos.
      // O judge conta múltiplas chamadas no log; aqui só asseguramos pelo menos uma.
      { name: "add_context_note" },
      { name: "read_transcript_content" },
    ],
    judgeRubric:
      "Vitoria chama add_context_note ≥3 vezes cobrindo pelo menos: (a) risco de capacidade (férias da Carla / issues parados), (b) code observation (retry logic hardcoded), (c) theme (i18n admin opcional ou discovery cobrança). Não duplica signals nem inventa nada fora do transcript.",
  },
};
