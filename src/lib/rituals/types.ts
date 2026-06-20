// Ritual Playbook — tipos compartilhados (PUROS: importáveis no client e no
// server, sem Zod nem server-only). O comportamento das capabilities vive no
// registry (capability-registry.ts); aqui ficam só os shapes + constantes que
// a UI e o runtime compartilham.

export type RitualType = "pm_review" | "release_planning";

export type CapabilityKey = "load_context" | "redact" | "emphasis";

/** Fontes que load_context sabe puxar. granola_folder é a 1ª instância. */
export type LoadContextKind =
  | "granola_folder"
  | "drive_folder"
  | "drive_file"
  | "notion_page"
  | "spreadsheet";

/** Eixo de audiência — reusa PMReviewNote.audience / o filtro do loader. */
export type Audience = "detail" | "executive";

export type LoadContextParams = {
  kind: LoadContextKind;
  /** granola_folder → { folderId }; demais kinds → { contextSourceId }. */
  ref: { folderId?: string; contextSourceId?: string };
  weight?: "primary" | "supporting" | "background";
};

export type RedactParams = { audience: Audience };

/** Instrução livre do PM pra este ritual — a "skill" daquela automação.
 *  Sem preset: o texto é a orientação. Clampado (EMPHASIS_TEXT_MAX) + hardened
 *  no prompt (colapsa newlines, footer de contrato). */
export type EmphasisParams = { text: string };

/** Instância persistida (1 elemento de RitualPlaybook.capabilities[]). */
export type RitualCapability =
  | { capabilityKey: "load_context"; enabled: boolean; params: LoadContextParams }
  | { capabilityKey: "redact"; enabled: boolean; params: RedactParams }
  | { capabilityKey: "emphasis"; enabled: boolean; params: EmphasisParams };

/** Rótulos curtos pros kinds de load_context (UI). */
export const LOAD_CONTEXT_KIND_LABEL: Record<LoadContextKind, string> = {
  granola_folder: "Folder do Granola",
  drive_folder: "Pasta do Drive",
  drive_file: "Arquivo do Drive",
  notion_page: "Página do Notion",
  spreadsheet: "Planilha",
};

export const EMPHASIS_TEXT_MAX = 1000;
