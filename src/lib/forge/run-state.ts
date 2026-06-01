import type { ChipTone } from "@/lib/status-chips";

/**
 * Execution state of a PRD inside the Forge — the "PRD turning into code" axis.
 *
 * This is distinct from the PRD *spec* status (draft/review/approved/superseded),
 * which belongs to the session/spec world. Every PRD that reaches the Forge is
 * already `approved`, so showing the spec status there is noise — Forge surfaces
 * show the run state instead.
 */
export type PrdRunState = "idle" | "pending" | "running" | "done" | "failed";

/** Canonical chip (tone + label) for a Forge run state. Shared across the Forge
 * tab PRD list, the kanban, and the deep-dive so the language is consistent. */
export function forgeRunChip(state: PrdRunState): {
  tone: ChipTone;
  label: string;
} {
  switch (state) {
    case "running":
      return { tone: "amber", label: "Rodando" };
    case "done":
      return { tone: "green", label: "Concluído" };
    case "failed":
      return { tone: "red", label: "Falhou" };
    case "pending":
      return { tone: "slate", label: "Na fila" };
    case "idle":
    default:
      return { tone: "blue", label: "Pronto" };
  }
}
