import type { ToolSet } from "ai";
import { createReadTranscriptContentTool } from "../../tools/read-transcript-content";

/**
 * Vitor-specific tools.
 * Imports shared tool factories and assembles the toolset.
 */
export function buildVitorTools(): ToolSet {
  return {
    read_transcript_content: createReadTranscriptContentTool(),
  };
}
