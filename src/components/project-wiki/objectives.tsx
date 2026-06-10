"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Check, X, Pencil } from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { SectionWrapper } from "./section-wrapper";
import type { ObjectiveItem, SectionProps } from "./types";

export function ObjectivesSection({ section, onUpdate }: SectionProps) {
  const { items, add, remove, replaceItem, adding, setAdding } =
    useWikiItems<ObjectiveItem>(section, onUpdate as (data: ObjectiveItem[]) => Promise<void>);
  const [form, setForm] = useState({ objective: "", description: "" });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ objective: "", description: "" });

  const handleAdd = () => {
    if (!form.objective) return;
    add({ ...form });
    setForm({ objective: "", description: "" });
    setAdding(false);
  };

  const startEdit = (i: number) => {
    setEditForm({ ...items[i] });
    setEditingIndex(i);
  };

  const confirmEdit = () => {
    if (editingIndex === null || !editForm.objective) return;
    replaceItem(editingIndex, { ...editForm });
    setEditingIndex(null);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="objectives"
      onAdd={() => setAdding(!adding)}
    >
      <div className="space-y-2">
        {items.map((obj, i) =>
          editingIndex === i ? (
            <div key={i} className="space-y-2 surface-inset px-3 py-2">
              <div className="flex items-end gap-2">
                <Input
                  className="flex-1"
                  value={editForm.objective}
                  onChange={(e) =>
                    setEditForm({ ...editForm, objective: e.target.value })
                  }
                />
                <Button
                  size="icon"
                  className="h-9 w-9"
                  onClick={confirmEdit}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  onClick={() => setEditingIndex(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                rows={2}
                className="text-xs resize-none"
              />
            </div>
          ) : (
            <div key={i} className="group surface-inset px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium flex-1">
                  {obj.objective}
                </span>
                <button
                  onClick={() => startEdit(i)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
                <button
                  onClick={() => remove(i)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                </button>
              </div>
              {obj.description && (
                <p className="text-xs text-muted-foreground">
                  {obj.description}
                </p>
              )}
            </div>
          )
        )}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">
            Nenhum objetivo cadastrado.
          </p>
        )}
      </div>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 flex-1">
              <Input
                placeholder="Objetivo (ex: Lançar MVP até Junho)"
                value={form.objective}
                onChange={(e) =>
                  setForm({ ...form, objective: e.target.value })
                }
              />
            </div>
            <Button size="icon" className="h-9 w-9" onClick={handleAdd}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => setAdding(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            placeholder="Descrição (opcional)"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
            rows={2}
            className="text-xs resize-none"
          />
        </div>
      )}
    </SectionWrapper>
  );
}
