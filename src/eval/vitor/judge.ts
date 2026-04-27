import type { CaseResult, EvalCase, ToolCallExpectation } from "./types";

export interface RunOutput {
  toolCalls: { name: string; args: unknown }[];
  responseText: string;
}

/**
 * Rule-based judge — evaluates a run against a case's expectations.
 * Returns CaseResult with pass/partial/fail + per-failure details.
 *
 * Does NOT evaluate `judgeRubric` — that's an LLM judge step,
 * intentionally left as a follow-up so this layer stays deterministic.
 */
export function judgeRun(
  evalCase: EvalCase,
  output: RunOutput,
): Pick<CaseResult, "status" | "failures" | "reason"> {
  const failures: string[] = [];
  const expected = evalCase.expected;

  if (expected.toolCalls) {
    for (const exp of expected.toolCalls) {
      const failure = checkToolCall(exp, output.toolCalls);
      if (failure) failures.push(failure);
    }
  }

  if (expected.responseContains) {
    for (const needle of expected.responseContains) {
      if (!output.responseText.toLowerCase().includes(needle.toLowerCase())) {
        failures.push(`responseContains missing: "${needle}"`);
      }
    }
  }

  if (expected.responseNotContains) {
    for (const needle of expected.responseNotContains) {
      if (output.responseText.toLowerCase().includes(needle.toLowerCase())) {
        failures.push(`responseNotContains found: "${needle}"`);
      }
    }
  }

  const hasJudgeRubric = !!expected.judgeRubric;
  const noFailures = failures.length === 0;

  if (noFailures && hasJudgeRubric) {
    return {
      status: "partial",
      failures: [],
      reason:
        "Rule-based checks passed. judgeRubric still requires LLM judge (not wired in v1).",
    };
  }

  if (noFailures) {
    return { status: "pass", failures: [], reason: "All rule-based checks passed." };
  }

  return {
    status: "fail",
    failures,
    reason: `${failures.length} rule-based check(s) failed.`,
  };
}

function checkToolCall(
  exp: ToolCallExpectation,
  actual: { name: string; args: unknown }[],
): string | null {
  const matches = actual.filter((c) => c.name === exp.name);

  if (exp.forbidden) {
    if (matches.length > 0) {
      return `forbidden tool "${exp.name}" was called ${matches.length}x`;
    }
    return null;
  }

  if (matches.length === 0) {
    return `expected tool "${exp.name}" was not called`;
  }

  if (!exp.args) return null;

  const argMatch = matches.some((c) => argsContain(c.args, exp.args!));
  if (!argMatch) {
    return `tool "${exp.name}" called but args don't match: expected ${JSON.stringify(exp.args)}`;
  }
  return null;
}

function argsContain(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const actualObj = actual as Record<string, unknown>;
  return Object.entries(expected).every(([k, v]) => {
    const actualVal = actualObj[k];
    if (typeof v === "object" && v !== null) {
      return JSON.stringify(actualVal) === JSON.stringify(v);
    }
    return actualVal === v;
  });
}
