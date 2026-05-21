import "server-only";

// Thin OpenRouter client tuned for ProjectInsight.
//
// We call the HTTP API directly with `response_format: { type: "json_object" }`
// (any valid JSON) plus an explicit schema example in the prompt. Two reasons
// for not using @openrouter/ai-sdk-provider here: (a) we want the OpenRouter
// `usage.cost` value back so we can persist it in cents without re-pricing,
// and (b) we only need a single one-shot completion — the SDK's streaming
// helpers don't buy us anything.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type LlmCallResult = {
  parsed: unknown;
  raw: string;
  model: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
};

export async function callOpenRouterJson(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<LlmCallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const body = {
    model: input.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    response_format: { type: "json_object" },
    usage: { include: true },
  };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://volund.com.br",
      "X-Title": "Volund · Alpha Project Insights",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "(no body)");
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: LlmCallResult["usage"];
  };

  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("empty completion");
  }

  // Some providers ignore response_format and wrap output in markdown code
  // fences. Easiest robust strip: find the outermost {...} block, since the
  // response is supposed to be a single JSON object.
  let cleaned = raw.trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `json parse failed: ${(e as Error).message}; head=${cleaned.slice(0, 200)}`,
    );
  }

  return {
    parsed,
    raw,
    model: data.model ?? input.model,
    usage: data.usage ?? {},
  };
}
