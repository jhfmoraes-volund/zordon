"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  SettingField,
  NumberField,
  EnumField,
  StringArrayField,
  MatrixField,
} from "@/lib/agent/settings-schema";

/** Dispatcher: renders the right input for a given SettingField. */
export function FieldInput({
  field,
  fieldKey,
  value,
  onChange,
  disabled,
}: {
  field: SettingField;
  fieldKey: string;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  switch (field.type) {
    case "number":
      return (
        <NumberInput
          field={field}
          value={typeof value === "number" ? value : 0}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "enum":
      return (
        <EnumInput
          field={field}
          fieldKey={fieldKey}
          value={typeof value === "string" ? value : field.options[0]?.value ?? ""}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "string_array":
      return (
        <StringArrayInput
          field={field}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "matrix":
      return (
        <MatrixInput
          field={field}
          value={isMatrix(value) ? (value as Record<string, Record<string, number>>) : {}}
          onChange={onChange}
          disabled={disabled}
        />
      );
  }
}

function isMatrix(v: unknown): boolean {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

// ─── Number ─────────────────────────────────────────────────────────────────

function NumberInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: NumberField;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value}
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
        disabled={disabled}
        className="max-w-40"
      />
      {field.unit && <span className="text-sm text-muted-foreground">{field.unit}</span>}
    </div>
  );
}

// ─── Enum ───────────────────────────────────────────────────────────────────

function EnumInput({
  field,
  fieldKey,
  value,
  onChange,
  disabled,
}: {
  field: EnumField;
  fieldKey: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v: string | null) => v && onChange(v)}
      disabled={disabled}
    >
      <SelectTrigger id={fieldKey} className="max-w-sm">
        <SelectValue>
          {(v: string | null) => {
            const opt = field.options.find((o) => o.value === v);
            return opt?.label ?? v ?? "Selecionar…";
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {field.options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── String array (multi-checkbox when options present) ─────────────────────

function StringArrayInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: StringArrayField;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  if (!field.options) {
    // Free-form: comma-separated
    return (
      <Input
        value={value.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        disabled={disabled}
        placeholder="item1, item2, item3"
      />
    );
  }

  const set = new Set(value);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {field.options.map((opt) => {
        const checked = set.has(opt);
        return (
          <label
            key={opt}
            className={`flex items-center gap-2 rounded border px-2 py-1.5 text-sm cursor-pointer select-none ${
              checked ? "border-primary bg-primary/5" : "border-border"
            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(opt);
                else next.delete(opt);
                onChange(Array.from(next));
              }}
            />
            <span className="font-mono text-xs">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

// ─── Matrix ─────────────────────────────────────────────────────────────────

function MatrixInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: MatrixField;
  value: Record<string, Record<string, number>>;
  onChange: (next: Record<string, Record<string, number>>) => void;
  disabled?: boolean;
}) {
  const setCell = (row: string, col: string, n: number) => {
    const next = { ...value, [row]: { ...(value[row] || {}), [col]: n } };
    onChange(next);
  };

  return (
    <div className="overflow-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            <th className="p-2 text-left text-muted-foreground font-medium">scope \\ complexity</th>
            {field.cols.map((c) => (
              <th key={c} className="p-2 text-center text-muted-foreground font-medium capitalize">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {field.rows.map((row) => (
            <tr key={row} className="border-t border-border">
              <td className="p-2 font-medium capitalize">{row}</td>
              {field.cols.map((col) => (
                <td key={col} className="p-1">
                  <Input
                    type="number"
                    value={value[row]?.[col] ?? 0}
                    min={field.min}
                    max={field.max}
                    step={1}
                    disabled={disabled}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isNaN(n)) setCell(row, col, n);
                    }}
                    className="w-16 text-center"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Label block (reused by ParamForm) ──────────────────────────────────────

export function FieldLabel({
  fieldKey,
  field,
  dirty,
}: {
  fieldKey: string;
  field: SettingField;
  dirty: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={fieldKey} className="text-sm font-medium">
          {field.label}
          {dirty && <span className="ml-2 text-xs text-amber-600">● não salvo</span>}
        </Label>
        {field.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
        )}
      </div>
      <code className="text-[10px] text-muted-foreground/70 font-mono shrink-0">{fieldKey}</code>
    </div>
  );
}
