/**
 * Decode literal `\uXXXX` escape sequences into their real characters.
 *
 * Some providers (notably OpenRouter routing to Anthropic Sonnet) occasionally
 * emit tool-call arguments with ASCII-escaped Unicode — the JSON arrives as
 * `"básico"` where the backslash is a literal character, not a JSON
 * escape. The AI SDK passes those args through to `execute(input)` without
 * re-decoding, so by the time we receive `input.title` the string contains
 * 6 literal characters (`á`) instead of `á`.
 *
 * Apply at the boundary of each tool that writes free-form text into the DB.
 */
export function decodeUnicodeEscapes(text: string): string {
  if (!text || !text.includes("\\u")) return text;
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

export function decodeUnicodeEscapesMaybe<T extends string | null | undefined>(
  text: T,
): T {
  if (typeof text !== "string") return text;
  return decodeUnicodeEscapes(text) as T;
}
