"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export type PairFieldConfig = {
  key: string;
  placeholder: string;
  textarea?: boolean;
};

type Row = Record<string, string>;

type Props = {
  items: Row[];
  onChange: (items: Row[]) => void;
  fields: PairFieldConfig[];
  addLabel: string;
};

export function PairListInput({ items, onChange, fields, addLabel }: Props) {
  function emptyRow(): Row {
    return Object.fromEntries(fields.map((f) => [f.key, ""]));
  }

  function updateField(rowIdx: number, key: string, value: string) {
    onChange(
      items.map((row, i) => (i === rowIdx ? { ...row, [key]: value } : row)),
    );
  }

  function removeRow(rowIdx: number) {
    onChange(items.filter((_, i) => i !== rowIdx));
  }

  function addRow() {
    onChange([...items, emptyRow()]);
  }

  return (
    <div className="space-y-3">
      {items.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-start gap-2 rounded-lg border bg-muted/20 p-2.5"
        >
          <div className="flex flex-1 flex-col gap-2">
            {fields.map((f) =>
              f.textarea ? (
                <Textarea
                  key={f.key}
                  value={row[f.key] ?? ""}
                  onChange={(e) => updateField(rowIdx, f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={2}
                />
              ) : (
                <Input
                  key={f.key}
                  value={row[f.key] ?? ""}
                  onChange={(e) => updateField(rowIdx, f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              ),
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remover item"
            onClick={() => removeRow(rowIdx)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-1 size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
