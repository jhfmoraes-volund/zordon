import type { EvalScenario } from "../types";

export const case06MultiSource: EvalScenario = {
  name: "multi-source",
  title: "Consolida signal único de planilha + transcript sobrepostos",
  description:
    "Planilha e transcript citam a mesma issue (alta taxa de churn no plano pro). Outcome Reflector (G7) + multi_source_synthesis_patterns skill devem fazer Vitoria emitir UM signal consolidado com 2 sources, não 2 notes duplicadas.",
  phaseDependency: 7,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Sem normalized sources nem dedup heuristic, Vitoria atual emite 2 notes paralelas — uma do transcript, outra da planilha. Consolidação cross-source é G7.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — multi source",
    },
    transcripts: [
      {
        id: "trn-eval-06",
        title: "Weekly review",
        capturedAt: "2026-05-26T15:00:00Z",
        fullText:
          "Ana: o churn do plano Pro tá alto, 4.2% no mês passado. Bruno: confirmo, o dashboard da Stripe puxou esse número.",
      },
    ],
    spreadsheets: [
      {
        id: "att-eval-06",
        title: "Métricas Mensais Abril",
        content: [
          "| Métrica | Valor | Trend |",
          "|---------|-------|-------|",
          "| MRR | 187k | ↑ |",
          "| Churn Plano Pro | 4.2% | ↑ |",
          "| NPS | 58 | → |",
        ].join("\n"),
      },
    ],
  },

  turns: [
    {
      role: "user",
      content: "olha as 2 fontes e levanta o que precisa virar prioridade",
    },
  ],

  expected: {
    toolCalls: [
      // Espera 1 add_context_note (consolidado), não 2.
      { name: "add_context_note", args: { kind: "risk" } },
    ],
    judgeRubric:
      "Vitoria cria UMA nota de risco sobre churn Pro citando AMBAS as fontes (transcript + planilha) — sourceMeetingIds e/ou sourceTranscriptIds preenchidos. NÃO cria 2 notas separadas com o mesmo signal.",
  },
};
