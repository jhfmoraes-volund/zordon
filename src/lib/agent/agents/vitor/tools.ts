import type { ToolSet } from "ai";
import { createReadContextSourceTool } from "../../tools/read-context-source";

/**
 * Vitor-specific tools.
 * Imports shared tool factories and assembles the toolset.
 */
export function buildVitorTools(): ToolSet {
  return {
    read_context_source: createReadContextSourceTool(),
  };
}
