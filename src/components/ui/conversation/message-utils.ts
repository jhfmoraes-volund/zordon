import type { UIMessage } from "@ai-sdk/react";
import type { ToolInvocationState } from "./tool-call-chip";
import type { ToolPart } from "./tool-call-summary";

type AnyPart = NonNullable<UIMessage["parts"]>[number] & Record<string, unknown>;

function mapToolState(state: unknown): ToolInvocationState {
  if (state === "input-streaming" || state === "partial-call") return "partial-call";
  if (state === "input-available" || state === "call") return "call";
  return "result";
}

export function extractText(message: UIMessage): string {
  if (!message.parts) return "";
  let out = "";
  for (const p of message.parts) {
    if (p.type === "text") {
      const text = (p as { type: "text"; text?: string }).text;
      if (typeof text === "string") out += text;
    }
  }
  return out;
}

export function extractReasoning(message: UIMessage): {
  text: string;
  streaming: boolean;
} {
  if (!message.parts) return { text: "", streaming: false };
  let out = "";
  let streaming = false;
  for (const p of message.parts) {
    if (p.type === "reasoning") {
      const part = p as {
        type: "reasoning";
        text?: string;
        state?: "streaming" | "done";
      };
      if (typeof part.text === "string") out += part.text;
      if (part.state !== "done") streaming = true;
    }
  }
  return { text: out, streaming };
}

export function extractToolParts(message: UIMessage): ToolPart[] {
  if (!message.parts) return [];
  const out: ToolPart[] = [];
  for (const raw of message.parts as AnyPart[]) {
    const type = String(raw.type ?? "");
    const isToolPart =
      type === "tool-invocation" || type.startsWith("tool-");
    if (!isToolPart) continue;
    const toolName =
      typeof raw.toolName === "string" && raw.toolName.length > 0
        ? raw.toolName
        : type.replace(/^tool-/, "");
    const args =
      (raw.input as Record<string, unknown> | undefined) ??
      (raw.args as Record<string, unknown> | undefined) ??
      {};
    const toolCallId =
      typeof raw.toolCallId === "string"
        ? raw.toolCallId
        : `${toolName}-${out.length}`;
    out.push({
      toolCallId,
      toolName,
      args,
      state: mapToolState(raw.state),
    });
  }
  return out;
}

export function serializeToolStates(message: UIMessage): string {
  return extractToolParts(message)
    .map((p) => `${p.toolCallId}:${p.state}`)
    .join("|");
}
