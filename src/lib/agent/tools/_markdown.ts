/**
 * Shared markdown mutation helper for memory tools (Project / Session memoryMd).
 *
 * Compartilhado entre Vitor (tools/memory.ts) e Vitoria (agents/vitoria/tools.ts).
 */

export type MemoryAction = "replace" | "append_section" | "edit_section";

export function applyMarkdownMutation(
  current: string,
  action: MemoryAction,
  section: string | undefined,
  content: string,
): string {
  if (action === "replace") return content;
  if (!section) {
    throw new Error("section is required for append_section/edit_section");
  }
  const heading = `## ${section}`;
  const body = current ?? "";
  if (action === "append_section") {
    if (body.includes(heading)) {
      const lines = body.split("\n");
      const idx = lines.findIndex((l) => l.trim() === heading);
      const after = lines.slice(idx + 1);
      const nextHeadingOffset = after.findIndex((l) => /^## /.test(l));
      const insertAt = idx + 1 + (nextHeadingOffset === -1 ? after.length : nextHeadingOffset);
      lines.splice(insertAt, 0, content.trim(), "");
      return lines.join("\n");
    }
    return `${body.trim()}\n\n${heading}\n${content.trim()}\n`.trimStart();
  }
  if (action === "edit_section") {
    const lines = body.split("\n");
    const idx = lines.findIndex((l) => l.trim() === heading);
    if (idx === -1) {
      return `${body.trim()}\n\n${heading}\n${content.trim()}\n`.trimStart();
    }
    const after = lines.slice(idx + 1);
    const nextHeadingOffset = after.findIndex((l) => /^## /.test(l));
    const replaceUntil = idx + 1 + (nextHeadingOffset === -1 ? after.length : nextHeadingOffset);
    return [
      ...lines.slice(0, idx + 1),
      content.trim(),
      "",
      ...lines.slice(replaceUntil),
    ].join("\n");
  }
  return current;
}
