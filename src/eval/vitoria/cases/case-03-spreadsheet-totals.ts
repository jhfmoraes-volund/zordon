import type { EvalScenario } from "../types";

export const case03SpreadsheetTotals: EvalScenario = {
  name: "spreadsheet-totals",
  title: "Spreadsheet Reader cita totais determinísticos sem alucinar",
  description:
    "Planilha de OKRs com 12 linhas e total no rodapé. PM pergunta quantos OKRs ativos existem. Spreadsheet Reader (G1) parseia structuredData e devolve total exato; Vitoria responde 12 sem chutar.",
  phaseDependency: 1,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Hoje não existe SourceReader. Vitoria recebe transcript/planilha como texto crú no prompt e tende a aproximar totais. Reader determinístico nasce na G1.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — spreadsheet",
    },
    spreadsheets: [
      {
        id: "att-eval-03",
        title: "OKRs Q2 2026",
        content: [
          "| # | OKR | Status | Owner |",
          "|---|-----|--------|-------|",
          "| 1 | NPS 60 | active | Ana |",
          "| 2 | MRR R$ 200k | active | Bruno |",
          "| 3 | CSAT 4.5 | active | Ana |",
          "| 4 | Churn < 3% | active | Carla |",
          "| 5 | Onboarding 7d | active | Diego |",
          "| 6 | Coverage 80% | active | Eva |",
          "| 7 | Latency p95 < 200ms | active | Fabio |",
          "| 8 | Bug intake < 5/sem | active | Gabi |",
          "| 9 | Conversão 12% | active | Henrique |",
          "| 10 | Retention M3 > 70% | active | Ivan |",
          "| 11 | Activation 60% | active | Júlia |",
          "| 12 | LTV/CAC > 3 | active | Karen |",
          "| - | Total OKRs ativos | 12 | - |",
        ].join("\n"),
        knownTotals: { activeOkrs: 12 },
      },
    ],
  },

  turns: [
    {
      role: "user",
      content: "quantos OKRs ativos a gente tem agora? consulta a planilha que linkei",
    },
  ],

  expected: {
    toolCalls: [
      // Spreadsheets sobem como TranscriptRef.source='spreadsheet' (decisão da
      // migration 20260530_transcript_ref_spreadsheet). Leitura é read_transcript_content.
      // G1 muda o RETURN da tool de fullText pra NormalizedSource — a tool fica.
      { name: "read_transcript_content" },
    ],
    responseContains: ["12"],
    responseNotContains: ["aproximadamente", "cerca de", "uns 1"],
    judgeRubric:
      "Resposta cita exatamente 12 OKRs ativos. Pode listar nomes ou só dizer o número, mas não chuta nem arredonda.",
  },
};
