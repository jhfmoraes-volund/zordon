/**
 * Schema primitives for agent settings UI.
 *
 * Each agent declares what it tunes as a map of key → SettingField.
 * The UI reads this schema, fetches values from AgentConfig, and renders
 * an input per field based on its `type`.
 *
 * To add a new agent: write a settings-schema.ts in its folder and register
 * it in settings-registry.ts.
 */

export type SettingField =
  | NumberField
  | EnumField
  | StringArrayField
  | MatrixField;

interface BaseField {
  label: string;
  description?: string;
  /** Optional category; used to group fields in the UI. */
  category?: string;
}

export interface NumberField extends BaseField {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  /** Optional unit suffix for display (e.g. "PFV", "dias", "%"). */
  unit?: string;
}

export interface EnumField extends BaseField {
  type: "enum";
  options: Array<{ value: string; label: string }>;
}

export interface StringArrayField extends BaseField {
  type: "string_array";
  /** Optional closed list of allowed values. When present the input becomes a multiselect. */
  options?: string[];
}

export interface MatrixField extends BaseField {
  type: "matrix";
  rows: readonly string[];
  cols: readonly string[];
  min?: number;
  max?: number;
}

export type SettingsSchema = Record<string, SettingField>;
