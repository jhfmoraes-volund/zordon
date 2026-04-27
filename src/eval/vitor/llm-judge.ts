/**
 * LLM judge — Haiku evaluates judgeRubric against the actual transcript.
 *
 * Triggered when rule-based check passes (or partial-passes) AND a rubric exists.
 * Returns pass/fail/uncertain so the runner can refine the case status:
 *   rule-based pass + LLM pass     → pass
 *   rule-based pass + LLM fail     → fail (rubric violated)
 *   rule-based pass + LLM uncertain → partial
 *
 * Cost: ~$0.001 per case (Haiku, ~500 tokens prompt + ~50 tokens output).
 */

import { generateText } from "ai";
import { getModel } from "@/lib/ai/provider";
import type { EvalCase } from "./types";
import type { RunOutput } from "./judge";

const JUDGE_MODEL = "anthropic/claude-haiku-4.5";

export type LlmVerdict = "pass" | "fail" | "uncertain";

export interface LlmJudgeResult {
  verdict: LlmVerdict;
  reason: string;
}

export async function llmJudge(
  evalCase: EvalCase,
  output: RunOutput,
): Promise<LlmJudgeResult> {
  if (!evalCase.expected.judgeRubric) {
    return { verdict: "pass", reason: "no rubric to evaluate" };
  }

  const toolCallSummary = output.toolCalls
    .map((t) => `${t.name}(${JSON.stringify(t.args).slice(0, 200)})`)
    .join("\n  ");

  const prompt = `Voce e um juiz avaliando se um agente de IA (Vitor) cumpriu uma rubrica comportamental.

## Rubrica esperada
${evalCase.expected.judgeRubric}

## Tool calls que o agente fez
  ${toolCallSummary || "(nenhuma)"}

## Resposta final do agente
${output.responseText.slice(0, 2000)}

## Tarefa
Decida se o comportamento do agente cumpre a rubrica. Responda APENAS com JSON valido nesta forma:

{ "verdict": "pass" | "fail" | "uncertain", "reason": "uma frase explicando" }

- "pass": agente cumpriu a rubrica
- "fail": agente violou claramente a rubrica
- "uncertain": evidencia ambigua, depende de interpretacao

Nao adicione markdown, comentarios, ou texto fora do JSON.`;

  try {
    const { text } = await generateText({
      model: getModel(JUDGE_MODEL),
      prompt,
      temperature: 0,
    });
    const trimmed = text.trim().replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(trimmed) as LlmJudgeResult;
    if (!["pass", "fail", "uncertain"].includes(parsed.verdict)) {
      return { verdict: "uncertain", reason: `invalid verdict: ${parsed.verdict}` };
    }
    return parsed;
  } catch (e) {
    return {
      verdict: "uncertain",
      reason: `judge errored: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
